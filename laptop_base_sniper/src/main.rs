//! LAPTOP Base first-block sniper.
//!
//! Pipeline: Base Flashblocks `pendingLogs` → Uniswap v4 PoolManager event decode
//! → target pool detection → pre-signed buy via Universal Router → parallel
//! `eth_sendRawTransaction` → receipt tracking → same-block verdict.

use anyhow::{bail, Context, Result};
use futures_util::{SinkExt, StreamExt};
use serde_json::json;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio_tungstenite::tungstenite::Message;

use laptop_base_sniper::config::{Config, Mode};
use laptop_base_sniper::engine::{self, Engine, Phase, Shared};
use laptop_base_sniper::executor::Wallet;
use laptop_base_sniper::flashblocks::{self, WsEvent};
use laptop_base_sniper::logger::Logger;
use laptop_base_sniper::rpc::{self, Rpc};
use laptop_base_sniper::timing::micros_since;

#[tokio::main]
async fn main() -> Result<()> {
    let cfg = Arc::new(Config::from_env()?);
    let log = Logger::start(cfg.log_file.clone(), cfg.quiet);
    log.info("startup", json!({"config": cfg.summary(), "version": env!("CARGO_PKG_VERSION")}));

    let rpc = Rpc::new(Duration::from_secs(10))?;
    let shared = Shared::new();

    // ---- Pre-flight (all RPC round trips happen here, never on the hot path) ----
    let t0 = Instant::now();
    let chain_id = rpc.chain_id(&cfg.rpc_url).await.context("eth_chainId (is RPC_URL reachable?)")?;
    if chain_id != cfg.chain_id {
        bail!("RPC chain id {chain_id} != configured {}", cfg.chain_id);
    }
    let head = rpc.block_number(&cfg.rpc_url).await?;
    let router_code = rpc.code_len(&cfg.rpc_url, cfg.router).await?;
    let pm_code = rpc.code_len(&cfg.rpc_url, cfg.pool_manager).await?;
    let token_code = rpc.code_len(&cfg.rpc_url, cfg.target_token).await?;
    if router_code == 0 || pm_code == 0 {
        bail!("router or PoolManager has no code on this chain — check addresses");
    }
    if token_code == 0 {
        log.warn("target_token_has_no_code_yet", json!({"token": cfg.target_token}));
    }
    if let Ok(h) = rpc.latest_header(&cfg.rpc_url, "pending").await {
        if let Some(bf) = h.base_fee_per_gas.as_deref().and_then(|s| rpc::hex_to_u64(s).ok()) {
            shared.base_fee_wei.store(bf, Ordering::Release);
        }
    }
    if let Ok(p) = rpc.max_priority_fee(&cfg.rpc_url).await {
        shared.suggested_priority_wei.store(p.min(u64::MAX as u128) as u64, Ordering::Release);
    }

    let wallet = match (&cfg.mode, &cfg.private_key) {
        (Mode::Listen, _) => None,
        (_, Some(pk)) => {
            let w = Arc::new(Wallet::from_hex(pk)?);
            let nonce = rpc.nonce(&cfg.rpc_url, w.address, "pending").await?;
            let balance = rpc.balance(&cfg.rpc_url, w.address, "pending").await?;
            shared.nonce.store(nonce, Ordering::Release);
            let gas_cost = alloy::primitives::U256::from(cfg.gas_limit) * alloy::primitives::U256::from(cfg.max_fee_per_gas_wei);
            let needed = cfg.buy_amount_wei + gas_cost;
            log.info("wallet", json!({"address": w.address, "nonce": nonce, "balance_wei": balance.to_string(), "needed_wei_excl_l1_fee": needed.to_string()}));
            if balance < needed {
                if cfg.mode == Mode::Live {
                    bail!("wallet balance {balance} wei < buy + max gas {needed} wei");
                }
                log.warn("insufficient_balance_for_live", json!({}));
            }
            Some(w)
        }
        (_, None) => bail!("PRIVATE_KEY required"),
    };
    log.info(
        "preflight_ok",
        json!({
            "chain_id": chain_id,
            "head_block": head,
            "router_code_bytes": router_code,
            "pool_manager_code_bytes": pm_code,
            "target_token_code_bytes": token_code,
            "base_fee_wei": shared.base_fee_wei.load(Ordering::Relaxed),
            "suggested_priority_wei": shared.suggested_priority_wei.load(Ordering::Relaxed),
            "preflight_us": micros_since(t0),
        }),
    );

    let mut engine = Engine::new(cfg.clone(), log.clone(), rpc.clone(), shared.clone(), wallet.clone());

    // Optional: catch a pool that was initialised before we started.
    for l in engine::startup_scan(&cfg, &rpc, &log).await? {
        engine.on_log(l);
    }

    let (resign_tx, mut resign_rx) = tokio::sync::mpsc::channel::<()>(1);
    tokio::spawn(engine::refresh_loop(cfg.clone(), rpc.clone(), log.clone(), shared.clone(), wallet.as_ref().map(|w| w.address), resign_tx));

    let topic0s = Engine::topic0s();
    let mut backoff = Duration::from_millis(250);
    let mut ctrl_c = Box::pin(tokio::signal::ctrl_c());

    'outer: loop {
        if shared.phase() == Phase::Done {
            break;
        }
        let t_conn = Instant::now();
        let (mut ws, sub_id) = match flashblocks::connect_and_subscribe(&cfg.ws_url, cfg.pool_manager, &topic0s).await {
            Ok(v) => v,
            Err(e) => {
                log.error("ws_connect_error", json!({"err": format!("{e:#}"), "retry_in_ms": backoff.as_millis()}));
                tokio::select! {
                    _ = tokio::time::sleep(backoff) => {},
                    _ = &mut ctrl_c => break 'outer,
                }
                backoff = (backoff * 2).min(Duration::from_secs(10));
                continue;
            }
        };
        backoff = Duration::from_millis(250);
        log.info("ws_subscribed", json!({"url": cfg.ws_url, "subscription": sub_id, "connect_us": micros_since(t_conn), "phase": shared.phase().name(), "topics": topic0s}));

        let mut stats_tick = tokio::time::interval(Duration::from_secs(60));
        stats_tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        stats_tick.tick().await; // first tick fires immediately; consume it
        let mut done_tick = tokio::time::interval(Duration::from_millis(250));
        done_tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        let mut frames: u64 = 0;
        let mut logs: u64 = 0;

        loop {
            tokio::select! {
                biased;
                frame = ws.next() => {
                    let t_recv = Instant::now();
                    let Some(frame) = frame else {
                        log.warn("ws_closed", json!({"frames": frames}));
                        break;
                    };
                    match frame {
                        Ok(Message::Text(text)) => {
                            frames += 1;
                            match flashblocks::parse_frame(text.as_str(), t_recv) {
                                Ok(WsEvent::Log(l)) => {
                                    logs += 1;
                                    engine.on_log(l);
                                }
                                Ok(WsEvent::Other(v)) => log.debug("ws_other", v),
                                Err(e) => log.warn("ws_parse_error", json!({"err": e.to_string(), "head": text.as_str().chars().take(200).collect::<String>()})),
                            }
                        }
                        Ok(Message::Ping(p)) => { let _ = ws.send(Message::Pong(p)).await; }
                        Ok(Message::Close(c)) => { log.warn("ws_close_frame", json!({"reason": format!("{c:?}")})); break; }
                        Ok(_) => {}
                        Err(e) => { log.error("ws_error", json!({"err": e.to_string()})); break; }
                    }
                    if shared.phase() == Phase::Done && cfg.mode != Mode::Listen {
                        // Keep the socket open briefly so late log lines still land, then exit.
                        tokio::time::sleep(Duration::from_secs(3)).await;
                        break 'outer;
                    }
                }
                _ = resign_rx.recv() => {
                    if shared.phase() == Phase::PoolSeen { engine.presign("refresh"); }
                }
                _ = done_tick.tick() => {
                    if shared.phase() == Phase::Done && cfg.mode != Mode::Listen {
                        tokio::time::sleep(Duration::from_secs(1)).await;
                        log.info("done", json!({"note": "state machine finished"}));
                        let _ = ws.close(None).await;
                        break 'outer;
                    }
                }
                _ = stats_tick.tick() => {
                    log.info("heartbeat", json!({"frames": frames, "logs": logs, "events_seen": engine.events_seen(), "phase": shared.phase().name(), "base_fee_wei": shared.base_fee_wei.load(Ordering::Relaxed), "nonce": shared.nonce.load(Ordering::Relaxed)}));
                }
                _ = &mut ctrl_c => {
                    log.info("shutdown", json!({"reason": "ctrl_c"}));
                    let _ = ws.close(None).await;
                    break 'outer;
                }
            }
        }
        log.warn("ws_reconnecting", json!({"phase": shared.phase().name()}));
        tokio::time::sleep(backoff).await;
    }

    log.info("exit", json!({"phase": shared.phase().name()}));
    tokio::time::sleep(Duration::from_millis(200)).await; // let the logger drain
    Ok(())
}
