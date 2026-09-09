//! Detection engine and one-shot state machine.
//!
//! ```text
//! ARMED ──Initialize(target pool, guards pass)──▶ POOL_SEEN (buy pre-signed)
//! POOL_SEEN ──ModifyLiquidity(+, same poolId)──▶ TRIGGERED ──▶ SENT ──▶ DONE
//! ```
//! Everything in `on_log` runs on the WebSocket reader task; it must stay
//! short. Sending is spawned so the reader is never blocked by RPC latency.

use alloy::primitives::{Address, B256, U256};
use alloy::sol_types::SolEvent;
use anyhow::{anyhow, Result};
use serde_json::json;
use std::collections::HashSet;
use std::sync::atomic::{AtomicU64, AtomicU8, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use crate::abi::{self, PoolKey};
use crate::config::{Config, Mode, Trigger};
use crate::executor::{self, SignedBuy, Wallet};
use crate::flashblocks::PendingLog;
use crate::logger::Logger;
use crate::rpc::{hex_to_u64, Rpc};
use crate::timing::{micros_between, micros_since, unix_nanos};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum Phase {
    Armed = 0,
    PoolSeen = 1,
    Triggered = 2,
    Sent = 3,
    Done = 4,
}

impl Phase {
    fn from_u8(v: u8) -> Phase {
        match v {
            0 => Phase::Armed,
            1 => Phase::PoolSeen,
            2 => Phase::Triggered,
            3 => Phase::Sent,
            _ => Phase::Done,
        }
    }
    pub fn name(self) -> &'static str {
        match self {
            Phase::Armed => "ARMED",
            Phase::PoolSeen => "POOL_SEEN",
            Phase::Triggered => "TRIGGERED",
            Phase::Sent => "SENT",
            Phase::Done => "DONE",
        }
    }
}

/// Shared with background refresh tasks (nonce / fee updates) — lock-free.
pub struct Shared {
    pub phase: AtomicU8,
    pub nonce: AtomicU64,
    pub base_fee_wei: AtomicU64,
    pub suggested_priority_wei: AtomicU64,
}

impl Shared {
    pub fn new() -> Arc<Shared> {
        Arc::new(Shared {
            phase: AtomicU8::new(Phase::Armed as u8),
            nonce: AtomicU64::new(0),
            base_fee_wei: AtomicU64::new(0),
            suggested_priority_wei: AtomicU64::new(0),
        })
    }
    pub fn phase(&self) -> Phase {
        Phase::from_u8(self.phase.load(Ordering::Acquire))
    }
    /// Compare-and-swap phase transition. Returns false if someone else moved first.
    pub fn transition(&self, from: Phase, to: Phase) -> bool {
        self.phase
            .compare_exchange(from as u8, to as u8, Ordering::AcqRel, Ordering::Acquire)
            .is_ok()
    }
}

#[derive(Debug, Clone)]
pub struct TargetPool {
    pub pool_id: B256,
    pub key: PoolKey,
    pub zero_for_one: bool,
    pub sqrt_price_x96: U256,
    pub tick: i32,
    pub init_block: u64,
    pub init_tx: B256,
    pub init_tx_index: u64,
    pub init_log_index: u64,
    pub t_init_recv: Instant,
    pub swaps_seen_before_trigger: u32,
}

#[derive(Debug, Clone)]
pub struct LaunchInfo {
    pub trigger_event: &'static str,
    pub block_number: u64,
    pub tx_hash: B256,
    pub tx_index: u64,
    pub log_index: u64,
    pub liquidity_delta: Option<String>,
    pub t_recv: Instant,
    pub t_decoded: Instant,
    pub t_trigger: Instant,
}

pub struct Engine {
    pub cfg: Arc<Config>,
    pub log: Logger,
    pub rpc: Rpc,
    pub shared: Arc<Shared>,
    pub wallet: Option<Arc<Wallet>>,
    pub pool: Option<TargetPool>,
    pub presigned: Option<SignedBuy>,
    pub launch: Option<LaunchInfo>,
    seen: HashSet<(B256, u64)>,
    events_seen: u64,
}

fn now_unix() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

impl Engine {
    pub fn new(cfg: Arc<Config>, log: Logger, rpc: Rpc, shared: Arc<Shared>, wallet: Option<Arc<Wallet>>) -> Engine {
        Engine { cfg, log, rpc, shared, wallet, pool: None, presigned: None, launch: None, seen: HashSet::new(), events_seen: 0 }
    }

    pub fn topic0s() -> Vec<B256> {
        vec![abi::Initialize::SIGNATURE_HASH, abi::ModifyLiquidity::SIGNATURE_HASH, abi::Swap::SIGNATURE_HASH]
    }

    /// Hot path entry point.
    pub fn on_log(&mut self, log: PendingLog) {
        self.events_seen += 1;
        if log.address != self.cfg.pool_manager {
            return;
        }
        if log.removed {
            self.log.warn("log_removed", json!({"tx": log.tx_hash, "block": log.block_number, "log_index": log.log_index}));
            return;
        }
        if !self.seen.insert((log.tx_hash, log.log_index)) {
            self.log.debug("duplicate_log", json!({"tx": log.tx_hash, "log_index": log.log_index}));
            return;
        }
        let Some(topic0) = log.topics.first().copied() else { return };

        if topic0 == abi::Initialize::SIGNATURE_HASH {
            self.on_initialize(&log);
        } else if topic0 == abi::ModifyLiquidity::SIGNATURE_HASH {
            self.on_modify_liquidity(&log);
        } else if topic0 == abi::Swap::SIGNATURE_HASH {
            self.on_swap(&log);
        }
    }

    fn base_fields(log: &PendingLog) -> serde_json::Value {
        json!({
            "block": log.block_number,
            "block_ts": log.block_timestamp,
            "tx": log.tx_hash,
            "tx_index": log.tx_index,
            "log_index": log.log_index,
            "decode_us": micros_between(log.t_recv, log.t_decoded),
        })
    }

    fn on_initialize(&mut self, log: &PendingLog) {
        let ev = match abi::Initialize::decode_raw_log(log.topics.iter().copied(), &log.data) {
            Ok(e) => e,
            Err(e) => {
                self.log.warn("decode_error", json!({"event": "Initialize", "err": e.to_string(), "tx": log.tx_hash}));
                return;
            }
        };
        let key = PoolKey {
            currency0: ev.currency0,
            currency1: ev.currency1,
            fee: ev.fee,
            tickSpacing: ev.tickSpacing,
            hooks: ev.hooks,
        };
        let involves_target = ev.currency0 == self.cfg.target_token || ev.currency1 == self.cfg.target_token;
        let mut fields = Self::base_fields(log);
        let sqrt_price = U256::from(ev.sqrtPriceX96);
        if let serde_json::Value::Object(m) = &mut fields {
            m.insert("pool_id".into(), json!(ev.id));
            m.insert("currency0".into(), json!(ev.currency0));
            m.insert("currency1".into(), json!(ev.currency1));
            m.insert("fee".into(), json!(key.fee.to::<u32>()));
            m.insert("tick_spacing".into(), json!(key.tickSpacing.as_i32()));
            m.insert("hooks".into(), json!(ev.hooks));
            m.insert("sqrt_price_x96".into(), json!(sqrt_price.to_string()));
            m.insert("tick".into(), json!(ev.tick.as_i32()));
            m.insert("involves_target".into(), json!(involves_target));
        }
        if !involves_target {
            self.log.debug("initialize", fields);
            return;
        }
        // Sanity: PoolId must equal keccak(abi.encode(key)) — protects against a malformed feed.
        let computed = abi::pool_id(&key);
        if computed != ev.id {
            self.log.error("pool_id_mismatch", json!({"emitted": ev.id, "computed": computed}));
            return;
        }
        self.log.info("initialize_target", fields.clone());

        if self.shared.phase() != Phase::Armed {
            self.log.warn("extra_target_pool_ignored", json!({"pool_id": ev.id, "phase": self.shared.phase().name()}));
            return;
        }
        if let Err(reason) = self.verify_pool(&key) {
            self.log.warn("pool_rejected", json!({"pool_id": ev.id, "reason": reason.to_string(), "hooks": ev.hooks, "fee": key.fee.to::<u32>()}));
            return;
        }

        let zero_for_one = key.currency0 == self.cfg.counter_currency;
        let pool = TargetPool {
            pool_id: ev.id,
            key: key.clone(),
            zero_for_one,
            sqrt_price_x96: sqrt_price,
            tick: ev.tick.as_i32(),
            init_block: log.block_number,
            init_tx: log.tx_hash,
            init_tx_index: log.tx_index,
            init_log_index: log.log_index,
            t_init_recv: log.t_recv,
            swaps_seen_before_trigger: 0,
        };
        self.pool = Some(pool);
        if !self.shared.transition(Phase::Armed, Phase::PoolSeen) {
            return;
        }
        self.log.info("phase", json!({"phase": "POOL_SEEN", "pool_id": ev.id, "zero_for_one": zero_for_one}));

        // Pre-sign now so the liquidity trigger only has to send.
        self.presign("initialize");

        if self.cfg.trigger == Trigger::Initialize {
            self.fire(log, "Initialize", None);
        }
    }

    fn on_modify_liquidity(&mut self, log: &PendingLog) {
        let Some(pool) = self.pool.as_ref() else { return };
        // topics[1] is the PoolId: compare before decoding.
        if log.topics.get(1).copied() != Some(pool.pool_id) {
            return;
        }
        let ev = match abi::ModifyLiquidity::decode_raw_log(log.topics.iter().copied(), &log.data) {
            Ok(e) => e,
            Err(e) => {
                self.log.warn("decode_error", json!({"event": "ModifyLiquidity", "err": e.to_string(), "tx": log.tx_hash}));
                return;
            }
        };
        let delta = ev.liquidityDelta;
        let mut fields = Self::base_fields(log);
        if let serde_json::Value::Object(m) = &mut fields {
            m.insert("pool_id".into(), json!(ev.id));
            m.insert("sender".into(), json!(ev.sender));
            m.insert("tick_lower".into(), json!(ev.tickLower.as_i32()));
            m.insert("tick_upper".into(), json!(ev.tickUpper.as_i32()));
            m.insert("liquidity_delta".into(), json!(delta.to_string()));
        }
        self.log.info("modify_liquidity_target", fields);

        if self.shared.phase() != Phase::PoolSeen {
            return;
        }
        if delta.is_negative() || delta.is_zero() {
            return;
        }
        let delta_u = delta.into_raw();
        if delta_u < self.cfg.min_liquidity_delta {
            self.log.info("liquidity_below_threshold", json!({"delta": delta.to_string(), "min": self.cfg.min_liquidity_delta.to_string()}));
            return;
        }
        self.fire(log, "ModifyLiquidity", Some(delta.to_string()));
    }

    fn on_swap(&mut self, log: &PendingLog) {
        let Some(pool) = self.pool.as_mut() else { return };
        if log.topics.get(1).copied() != Some(pool.pool_id) {
            return;
        }
        let phase = self.shared.phase();
        if phase == Phase::PoolSeen {
            pool.swaps_seen_before_trigger += 1;
        }
        let ev = abi::Swap::decode_raw_log(log.topics.iter().copied(), &log.data).ok();
        let mut fields = Self::base_fields(log);
        if let serde_json::Value::Object(m) = &mut fields {
            m.insert("phase".into(), json!(phase.name()));
            if let Some(ev) = ev {
                m.insert("sender".into(), json!(ev.sender));
                m.insert("amount0".into(), json!(ev.amount0.to_string()));
                m.insert("amount1".into(), json!(ev.amount1.to_string()));
                m.insert("sqrt_price_x96".into(), json!(U256::from(ev.sqrtPriceX96).to_string()));
                m.insert("tick".into(), json!(ev.tick.as_i32()));
            }
        }
        self.log.info("swap_target", fields);
    }

    /// Pool verification guards (section 9 of the handoff).
    fn verify_pool(&self, key: &PoolKey) -> Result<()> {
        let (c0, c1) = abi::sort_currencies(self.cfg.target_token, self.cfg.counter_currency);
        if key.currency0 != c0 || key.currency1 != c1 {
            return Err(anyhow!("counter currency mismatch: pool is {}/{}, expected {}/{}", key.currency0, key.currency1, c0, c1));
        }
        if !self.cfg.allowed_hooks.contains(&key.hooks) {
            return Err(anyhow!("hooks {} not in ALLOWED_HOOKS", key.hooks));
        }
        if let Some(fees) = &self.cfg.allowed_fees {
            if !fees.contains(&key.fee.to::<u32>()) {
                return Err(anyhow!("fee {} not in ALLOWED_FEES", key.fee));
            }
        }
        if let Some(ts) = &self.cfg.allowed_tick_spacings {
            if !ts.contains(&key.tickSpacing.as_i32()) {
                return Err(anyhow!("tickSpacing {} not in ALLOWED_TICK_SPACINGS", key.tickSpacing));
            }
        }
        Ok(())
    }

    fn fee_params(&self) -> (u128, u128) {
        let base = self.shared.base_fee_wei.load(Ordering::Relaxed) as u128;
        let prio = self.cfg.priority_fee_wei;
        // Max fee: enough headroom for base fee growth over a few blocks, but never above the hard cap.
        let wanted = base.saturating_mul(3).saturating_add(prio);
        let max_fee = wanted.min(self.cfg.max_fee_per_gas_wei).max(prio);
        (max_fee, prio)
    }

    /// (Re)sign the buy for the current pool with the current nonce/fees.
    pub fn presign(&mut self, reason: &str) {
        if self.cfg.mode == Mode::Listen {
            return;
        }
        let (Some(wallet), Some(pool)) = (self.wallet.clone(), self.pool.as_ref()) else { return };
        let min_out = match executor::min_out_for(&self.cfg, pool.sqrt_price_x96, pool.zero_for_one) {
            Ok(v) => v,
            Err(e) => {
                self.log.error("min_out_error", json!({"err": e.to_string()}));
                return;
            }
        };
        let nonce = self.shared.nonce.load(Ordering::Acquire);
        let (max_fee, prio) = self.fee_params();
        match executor::sign_buy(&self.cfg, &wallet, &pool.key, pool.zero_for_one, min_out, nonce, max_fee, prio, now_unix()) {
            Ok(buy) => {
                self.log.info(
                    "presigned",
                    json!({
                        "reason": reason,
                        "tx_hash": buy.tx_hash,
                        "nonce": buy.nonce,
                        "max_fee_per_gas": buy.max_fee_per_gas,
                        "priority_fee": buy.priority_fee,
                        "amount_in": buy.amount_in.to_string(),
                        "min_out": buy.min_out.to_string(),
                        "deadline": buy.deadline,
                        "raw_len": buy.raw_len,
                        "sign_us": buy.sign_micros,
                    }),
                );
                self.presigned = Some(buy);
            }
            Err(e) => self.log.error("sign_error", json!({"err": e.to_string()})),
        }
    }

    /// Trigger: transition PoolSeen -> Triggered -> Sent exactly once.
    fn fire(&mut self, log: &PendingLog, trigger_event: &'static str, liquidity_delta: Option<String>) {
        let t_trigger = Instant::now();
        if !self.shared.transition(Phase::PoolSeen, Phase::Triggered) {
            self.log.warn("trigger_ignored", json!({"phase": self.shared.phase().name(), "tx": log.tx_hash}));
            return;
        }
        let launch = LaunchInfo {
            trigger_event,
            block_number: log.block_number,
            tx_hash: log.tx_hash,
            tx_index: log.tx_index,
            log_index: log.log_index,
            liquidity_delta,
            t_recv: log.t_recv,
            t_decoded: log.t_decoded,
            t_trigger,
        };
        self.log.info(
            "TRIGGER",
            json!({
                "trigger_event": trigger_event,
                "launch_block": launch.block_number,
                "launch_tx": launch.tx_hash,
                "launch_tx_index": launch.tx_index,
                "launch_log_index": launch.log_index,
                "recv_to_trigger_us": micros_between(log.t_recv, t_trigger),
                "swaps_before_trigger": self.pool.as_ref().map(|p| p.swaps_seen_before_trigger),
                "mode": format!("{:?}", self.cfg.mode),
            }),
        );
        self.launch = Some(launch.clone());

        if self.cfg.mode == Mode::Listen {
            self.shared.transition(Phase::Triggered, Phase::Done);
            self.log.info("phase", json!({"phase": "DONE", "note": "listen mode: nothing sent"}));
            return;
        }

        // Use the pre-signed transaction if present; otherwise sign now (CPU only).
        let buy = match self.presigned.take() {
            Some(b) => b,
            None => {
                self.presign("trigger");
                match self.presigned.take() {
                    Some(b) => b,
                    None => {
                        self.log.error("no_signed_tx", json!({}));
                        self.shared.transition(Phase::Triggered, Phase::Done);
                        return;
                    }
                }
            }
        };

        if self.cfg.mode == Mode::DryRun {
            self.shared.transition(Phase::Triggered, Phase::Done);
            self.log.info(
                "DRY_RUN_WOULD_SEND",
                json!({
                    "tx_hash": buy.tx_hash,
                    "raw_len": buy.raw_len,
                    "recv_to_ready_us": micros_since(log.t_recv),
                    "calldata": buy.calldata,
                    "value_wei": buy.value.to_string(),
                }),
            );
            if self.cfg.simulate_in_dry_run {
                let cfg = self.cfg.clone();
                let rpc = self.rpc.clone();
                let logger = self.log.clone();
                let from = self.wallet.as_ref().map(|w| w.address).unwrap_or_default();
                tokio::spawn(async move {
                    let call = executor::simulation_call(&cfg, from, &buy);
                    let t0 = Instant::now();
                    match rpc.eth_call(&cfg.rpc_url, call, "pending").await {
                        Ok(ret) => logger.info("simulation_ok", json!({"return": ret, "rtt_us": micros_since(t0)})),
                        Err(e) => logger.warn("simulation_reverted", json!({"err": e.to_string(), "rtt_us": micros_since(t0)})),
                    }
                });
            }
            return;
        }

        // LIVE: fan out eth_sendRawTransaction to all send endpoints, then track inclusion.
        self.shared.transition(Phase::Triggered, Phase::Sent);
        let t_send_start = Instant::now();
        self.log.info(
            "SEND",
            json!({
                "tx_hash": buy.tx_hash,
                "nonce": buy.nonce,
                "endpoints": self.cfg.send_urls.len(),
                "recv_to_send_us": micros_between(log.t_recv, t_send_start),
                "trigger_to_send_us": micros_between(t_trigger, t_send_start),
            }),
        );
        let cfg = self.cfg.clone();
        let rpc = self.rpc.clone();
        let logger = self.log.clone();
        let shared = self.shared.clone();
        let raw = Arc::new(buy.raw_hex.clone());
        let tx_hash = buy.tx_hash;
        for url in cfg.send_urls.clone() {
            let rpc = rpc.clone();
            let logger = logger.clone();
            let raw = raw.clone();
            tokio::spawn(async move {
                let t0 = Instant::now();
                match rpc.send_raw_transaction(&url, &raw).await {
                    Ok(h) => logger.info("send_ok", json!({"url": url, "tx_hash": h, "rtt_us": micros_since(t0), "ts_response_ns": unix_nanos().to_string()})),
                    Err(e) => logger.error("send_error", json!({"url": url, "err": e.to_string(), "rtt_us": micros_since(t0)})),
                }
            });
        }
        self.log.info(
            "send_timing",
            json!({"signed_to_send_us": micros_between(buy.t_signed, t_send_start), "presigned": true}),
        );
        let pool_info = self.pool.as_ref().map(|p| json!({
            "pool_id": p.pool_id,
            "init_block": p.init_block,
            "init_tx": p.init_tx,
            "init_tx_index": p.init_tx_index,
            "init_log_index": p.init_log_index,
            "init_tick": p.tick,
            "init_sqrt_price_x96": p.sqrt_price_x96.to_string(),
            "init_recv_to_trigger_us": micros_between(p.t_init_recv, t_trigger),
            "swaps_before_trigger": p.swaps_seen_before_trigger,
            "fee": p.key.fee.to::<u32>(),
            "tick_spacing": p.key.tickSpacing.as_i32(),
            "hooks": p.key.hooks,
        }));
        tokio::spawn(track_inclusion(cfg, rpc, logger, shared, launch, pool_info, tx_hash, t_send_start));
    }

    pub fn events_seen(&self) -> u64 {
        self.events_seen
    }
}

/// Poll for our receipt (pre-confirmed receipts are served by Flashblocks-aware
/// nodes) and write the same-block verdict.
#[allow(clippy::too_many_arguments)]
async fn track_inclusion(
    cfg: Arc<Config>,
    rpc: Rpc,
    log: Logger,
    shared: Arc<Shared>,
    launch: LaunchInfo,
    pool_info: Option<serde_json::Value>,
    tx_hash: B256,
    t_send_start: Instant,
) {
    let deadline = Instant::now() + Duration::from_secs(cfg.receipt_timeout_secs);
    let mut receipt = None;
    let mut polls = 0u32;
    while Instant::now() < deadline {
        polls += 1;
        match rpc.transaction_receipt(&cfg.rpc_url, tx_hash).await {
            Ok(Some(r)) => {
                receipt = Some(r);
                break;
            }
            Ok(None) => {}
            Err(e) => log.debug("receipt_poll_error", json!({"err": e.to_string()})),
        }
        tokio::time::sleep(Duration::from_millis(cfg.receipt_poll_ms)).await;
    }
    let t_receipt = Instant::now();
    shared.transition(Phase::Sent, Phase::Done);

    let Some(r) = receipt else {
        log.error("receipt_timeout", json!({"tx_hash": tx_hash, "polls": polls, "waited_s": cfg.receipt_timeout_secs}));
        write_result(&cfg, &log, json!({
            "outcome": "receipt_timeout",
            "our_tx_hash": tx_hash,
            "launch_block_number": launch.block_number,
            "launch_tx_hash": launch.tx_hash,
            "launch_tx_index": launch.tx_index,
        })).await;
        return;
    };
    let our_block = r.block_number.as_deref().and_then(|s| hex_to_u64(s).ok());
    let our_index = r.transaction_index.as_deref().and_then(|s| hex_to_u64(s).ok());
    let status_ok = r.status.as_deref().map(|s| s == "0x1").unwrap_or(false);
    let same_block = our_block == Some(launch.block_number);

    // Double-check the launch tx's final block (pre-confirmed block numbers do not change under normal operation).
    let launch_final_block = match rpc.transaction_receipt(&cfg.rpc_url, launch.tx_hash).await {
        Ok(Some(lr)) => lr.block_number.as_deref().and_then(|s| hex_to_u64(s).ok()),
        _ => None,
    };

    let result = json!({
        "outcome": if !status_ok { "reverted" } else if same_block { "same_block" } else { "later_block" },
        "pool": pool_info,
        "same_block": same_block && status_ok,
        "status_ok": status_ok,
        "launch_trigger_event": launch.trigger_event,
        "launch_block_number": launch.block_number,
        "launch_block_number_final": launch_final_block,
        "launch_tx_hash": launch.tx_hash,
        "launch_tx_index": launch.tx_index,
        "launch_log_index": launch.log_index,
        "launch_liquidity_delta": launch.liquidity_delta,
        "our_tx_hash": tx_hash,
        "our_buy_block_number": our_block,
        "our_buy_tx_index": our_index,
        "our_gas_used": r.gas_used,
        "our_effective_gas_price": r.effective_gas_price,
        "our_l1_fee": r.l1_fee,
        "our_log_count": r.logs.len(),
        "block_delta": our_block.map(|b| b as i64 - launch.block_number as i64),
        "latency_us": {
            "ws_recv_to_decoded": micros_between(launch.t_recv, launch.t_decoded),
            "ws_recv_to_trigger": micros_between(launch.t_recv, launch.t_trigger),
            "trigger_to_send_start": micros_between(launch.t_trigger, t_send_start),
            "ws_recv_to_send_start": micros_between(launch.t_recv, t_send_start),
            "send_start_to_receipt": micros_between(t_send_start, t_receipt),
            "ws_recv_to_receipt": micros_between(launch.t_recv, t_receipt),
        },
        "receipt_polls": polls,
        "wallet": cfg.private_key.as_ref().map(|_| "set"),
    });
    log.info("RESULT", result.clone());
    write_result(&cfg, &log, result).await;
}

async fn write_result(cfg: &Config, log: &Logger, v: serde_json::Value) {
    match serde_json::to_string_pretty(&v) {
        Ok(s) => {
            if let Err(e) = tokio::fs::write(&cfg.result_file, s).await {
                log.error("result_write_error", json!({"err": e.to_string(), "path": cfg.result_file}));
            }
        }
        Err(e) => log.error("result_serialize_error", json!({"err": e.to_string()})),
    }
}

/// Background: keep nonce and fee data fresh and connections warm. Off the hot path.
pub async fn refresh_loop(cfg: Arc<Config>, rpc: Rpc, log: Logger, shared: Arc<Shared>, wallet: Option<Address>, resign: tokio::sync::mpsc::Sender<()>) {
    let mut interval = tokio::time::interval(Duration::from_secs(cfg.refresh_secs));
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    loop {
        interval.tick().await;
        if matches!(shared.phase(), Phase::Triggered | Phase::Sent | Phase::Done) {
            continue;
        }
        let mut changed = false;
        match rpc.latest_header(&cfg.rpc_url, "pending").await {
            Ok(h) => {
                if let Some(bf) = h.base_fee_per_gas.as_deref().and_then(|s| hex_to_u64(s).ok()) {
                    let old = shared.base_fee_wei.swap(bf, Ordering::AcqRel);
                    changed |= old != bf;
                }
                log.debug("refresh_header", json!({"pending_block": h.number, "timestamp": h.timestamp, "base_fee_wei": h.base_fee_per_gas}));
            }
            Err(e) => log.warn("refresh_header_error", json!({"err": e.to_string()})),
        }
        if let Some(addr) = wallet {
            match rpc.nonce(&cfg.rpc_url, addr, "pending").await {
                Ok(n) => {
                    let old = shared.nonce.swap(n, Ordering::AcqRel);
                    if old != n {
                        changed = true;
                        log.info("nonce_changed", json!({"old": old, "new": n}));
                    }
                }
                Err(e) => log.warn("refresh_nonce_error", json!({"err": e.to_string()})),
            }
        }
        // Keep send endpoints' TCP/TLS sessions warm.
        for url in &cfg.send_urls {
            if url != &cfg.rpc_url {
                let _ = rpc.chain_id(url).await;
            }
        }
        if changed && shared.phase() == Phase::PoolSeen {
            let _ = resign.try_send(());
        }
    }
}

/// Optional startup scan: was the target pool already initialized recently?
pub async fn startup_scan(cfg: &Config, rpc: &Rpc, log: &Logger) -> Result<Vec<PendingLog>> {
    if cfg.startup_scan_blocks == 0 {
        return Ok(vec![]);
    }
    let head = rpc.block_number(&cfg.rpc_url).await?;
    let from = head.saturating_sub(cfg.startup_scan_blocks);
    let target_topic = cfg.target_token.into_word();
    let mut out = Vec::new();
    for pos in [2usize, 3usize] {
        let mut topics = vec![json!(abi::Initialize::SIGNATURE_HASH), serde_json::Value::Null, serde_json::Value::Null, serde_json::Value::Null];
        topics[pos] = json!(target_topic);
        let filter = json!({
            "address": cfg.pool_manager,
            "fromBlock": format!("0x{from:x}"),
            "toBlock": "latest",
            "topics": topics,
        });
        for v in rpc.get_logs(&cfg.rpc_url, filter).await? {
            let text = json!({"jsonrpc": "2.0", "method": "eth_subscription", "params": {"subscription": "0x0", "result": v}}).to_string();
            if let Ok(crate::flashblocks::WsEvent::Log(l)) = crate::flashblocks::parse_frame(&text, Instant::now()) {
                out.push(l);
            }
        }
    }
    log.info("startup_scan", json!({"from_block": from, "to_block": head, "initialize_logs_for_target": out.len()}));
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn one_shot_transitions() {
        let s = Shared::new();
        assert_eq!(s.phase(), Phase::Armed);
        assert!(s.transition(Phase::Armed, Phase::PoolSeen));
        assert!(!s.transition(Phase::Armed, Phase::PoolSeen));
        assert!(s.transition(Phase::PoolSeen, Phase::Triggered));
        assert!(!s.transition(Phase::PoolSeen, Phase::Triggered), "second trigger must be rejected");
        assert!(s.transition(Phase::Triggered, Phase::Sent));
        assert!(s.transition(Phase::Sent, Phase::Done));
        assert_eq!(s.phase(), Phase::Done);
    }
}

#[cfg(test)]
mod pipeline_tests {
    use super::*;
    use crate::config::RouterVersion;
    use alloy::primitives::{address, aliases::{I24, U24, U160}, Signed, I256};
    use alloy::sol_types::SolEvent;

    fn cfg(mode: Mode) -> Arc<Config> {
        Arc::new(Config {
            mode,
            ws_url: String::new(),
            rpc_url: "http://127.0.0.1:1".into(),
            send_urls: vec![],
            chain_id: 8453,
            pool_manager: address!("498581ff718922c3f8e6a244956af099b2652b2b"),
            router: address!("6ff5693b99212da76ad316178a184ab56d299b43"),
            router_version: RouterVersion::V2,
            weth: address!("4200000000000000000000000000000000000006"),
            target_token: address!("b095274743941e953c746f9c228da9c18bb6ec29"),
            counter_currency: Address::ZERO,
            allowed_hooks: vec![Address::ZERO],
            allowed_fees: None,
            allowed_tick_spacings: None,
            trigger: Trigger::Liquidity,
            min_liquidity_delta: U256::from(1),
            buy_amount_wei: U256::from(10u128.pow(16)),
            slippage_bps: 3000,
            min_out_tokens: U256::ZERO,
            gas_limit: 500_000,
            max_fee_per_gas_wei: 100_000_000,
            priority_fee_wei: 10_000_000,
            deadline_secs: 120,
            private_key: None,
            log_file: std::env::temp_dir().join("laptop_sniper_test.jsonl"),
            result_file: std::env::temp_dir().join("laptop_sniper_test_result.json"),
            refresh_secs: 15,
            startup_scan_blocks: 0,
            receipt_poll_ms: 100,
            receipt_timeout_secs: 1,
            simulate_in_dry_run: false,
            quiet: true,
        })
    }

    fn log_from(ev_topics: Vec<B256>, data: Vec<u8>, block: u64, tx: u8, tx_index: u64, log_index: u64) -> PendingLog {
        let now = Instant::now();
        PendingLog {
            t_recv: now,
            t_decoded: now,
            address: address!("498581ff718922c3f8e6a244956af099b2652b2b"),
            topics: ev_topics,
            data,
            block_number: block,
            block_timestamp: None,
            tx_hash: B256::repeat_byte(tx),
            tx_index,
            log_index,
            removed: false,
        }
    }

    fn initialize_log(key: &PoolKey, block: u64, tx: u8) -> (B256, PendingLog) {
        let id = abi::pool_id(key);
        let ev = abi::Initialize {
            id,
            currency0: key.currency0,
            currency1: key.currency1,
            fee: key.fee,
            tickSpacing: key.tickSpacing,
            hooks: key.hooks,
            sqrtPriceX96: U160::from(1u8) << 96,
            tick: I24::ZERO,
        };
        let data = ev.encode_log_data();
        (id, log_from(data.topics().to_vec(), data.data.to_vec(), block, tx, 5, 7))
    }

    fn liquidity_log(id: B256, delta: i128, block: u64, tx: u8) -> PendingLog {
        let ev = abi::ModifyLiquidity {
            id,
            sender: address!("7c5f5a4bbd8fd63184577525326123b519429bdc"),
            tickLower: I24::try_from(-887200).unwrap(),
            tickUpper: I24::try_from(887200).unwrap(),
            liquidityDelta: I256::try_from(delta).unwrap(),
            salt: B256::ZERO,
        };
        let data = ev.encode_log_data();
        log_from(data.topics().to_vec(), data.data.to_vec(), block, tx, 6, 9)
    }

    fn key(hooks: Address) -> PoolKey {
        PoolKey {
            currency0: Address::ZERO,
            currency1: address!("b095274743941e953c746f9c228da9c18bb6ec29"),
            fee: U24::from(10_000u32),
            tickSpacing: Signed::try_from(200).unwrap(),
            hooks,
        }
    }

    #[tokio::test]
    async fn listen_mode_detects_and_triggers_once() {
        let cfg = cfg(Mode::Listen);
        let log = Logger::start(cfg.log_file.clone(), true);
        let shared = Shared::new();
        let mut eng = Engine::new(cfg.clone(), log, Rpc::new(Duration::from_secs(1)).unwrap(), shared.clone(), None);

        // Unrelated pool: ignored.
        let other = PoolKey { currency1: address!("833589fcd6edb6e08f4c7c32d4f71b54bda02913"), ..key(Address::ZERO) };
        let (_, l) = initialize_log(&other, 100, 0xa1);
        eng.on_log(l);
        assert_eq!(shared.phase(), Phase::Armed);

        // Target pool with an unknown hook: rejected, stays ARMED.
        let hooked = key(address!("00000000000000000000000000000000000000c0"));
        let (_, l) = initialize_log(&hooked, 100, 0xa2);
        eng.on_log(l);
        assert_eq!(shared.phase(), Phase::Armed);

        // Target pool, hooks = 0: POOL_SEEN.
        let k = key(Address::ZERO);
        let (id, l) = initialize_log(&k, 101, 0xa3);
        eng.on_log(l);
        assert_eq!(shared.phase(), Phase::PoolSeen);
        assert!(eng.presigned.is_none(), "listen mode never signs");

        // Negative delta: no trigger.
        eng.on_log(liquidity_log(id, -5, 101, 0xbb));
        assert_eq!(shared.phase(), Phase::PoolSeen);

        // Positive delta: trigger -> DONE (listen).
        eng.on_log(liquidity_log(id, 1_000_000, 101, 0xcc));
        assert_eq!(shared.phase(), Phase::Done);
        let launch = eng.launch.clone().expect("launch recorded");
        assert_eq!(launch.block_number, 101);
        assert_eq!(launch.tx_hash, B256::repeat_byte(0xcc));
        assert_eq!(launch.trigger_event, "ModifyLiquidity");

        // Second liquidity add: ignored (one-shot).
        eng.on_log(liquidity_log(id, 5_000_000, 102, 0xdd));
        assert_eq!(eng.launch.as_ref().unwrap().tx_hash, B256::repeat_byte(0xcc));
    }

    #[tokio::test]
    async fn dry_run_presigns_on_initialize_and_consumes_on_trigger() {
        let cfg = cfg(Mode::DryRun);
        let log = Logger::start(cfg.log_file.clone(), true);
        let shared = Shared::new();
        shared.nonce.store(42, Ordering::Release);
        shared.base_fee_wei.store(1_000_000, Ordering::Release);
        let wallet = Arc::new(Wallet::from_hex("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80").unwrap());
        let mut eng = Engine::new(cfg.clone(), log, Rpc::new(Duration::from_secs(1)).unwrap(), shared.clone(), Some(wallet));

        let k = key(Address::ZERO);
        let (id, l) = initialize_log(&k, 200, 0xa4);
        eng.on_log(l);
        assert_eq!(shared.phase(), Phase::PoolSeen);
        let pre = eng.presigned.clone().expect("pre-signed on Initialize");
        assert_eq!(pre.nonce, 42);
        assert_eq!(pre.priority_fee, 10_000_000);
        assert_eq!(pre.max_fee_per_gas, 13_000_000); // 3*base + prio, under the cap
        // quote at 1:1 = 1e16, minus 30% slippage
        assert_eq!(pre.min_out, 7 * 10u128.pow(15));

        // Duplicate delivery of the same log (same tx + logIndex) must be ignored.
        let (_, dup) = initialize_log(&k, 200, 0xa4);
        eng.on_log(dup);

        eng.on_log(liquidity_log(id, 10, 200, 0xee));
        assert_eq!(shared.phase(), Phase::Done);
        assert!(eng.presigned.is_none(), "signed tx consumed by the trigger");
    }

    #[tokio::test]
    async fn initialize_trigger_mode_fires_immediately() {
        let mut c = (*cfg(Mode::Listen)).clone();
        c.trigger = Trigger::Initialize;
        let cfg = Arc::new(c);
        let log = Logger::start(cfg.log_file.clone(), true);
        let shared = Shared::new();
        let mut eng = Engine::new(cfg.clone(), log, Rpc::new(Duration::from_secs(1)).unwrap(), shared.clone(), None);
        let (_, l) = initialize_log(&key(Address::ZERO), 300, 0xa5);
        eng.on_log(l);
        assert_eq!(shared.phase(), Phase::Done);
        assert_eq!(eng.launch.as_ref().unwrap().trigger_event, "Initialize");
    }
}
