//! Configuration loaded once at startup from the environment (`.env` supported).
//!
//! Everything that can be decided before the launch is decided here so the hot
//! path never has to consult the RPC for static data.

use alloy::primitives::{Address, U256};
use anyhow::{anyhow, bail, Context, Result};
use std::path::PathBuf;
use std::str::FromStr;

/// Base mainnet chain id.
pub const BASE_CHAIN_ID: u64 = 8453;
/// Uniswap v4 PoolManager on Base (docs.uniswap.org deployments, chain 8453).
pub const BASE_POOL_MANAGER: &str = "0x498581ff718922c3f8e6a244956af099b2652b2b";
/// Uniswap Universal Router V2 (v4-enabled) on Base.
pub const BASE_UNIVERSAL_ROUTER_V2: &str = "0x6ff5693b99212da76ad316178a184ab56d299b43";
/// Uniswap Universal Router 2.1.1 on Base (per-hop price limit struct layout).
pub const BASE_UNIVERSAL_ROUTER_V2_1_1: &str = "0xfdf682f51fe81aa4898f0ae2163d8a55c127fbc7";
/// Canonical WETH9 on Base.
pub const BASE_WETH: &str = "0x4200000000000000000000000000000000000006";
/// The token we are buying.
pub const LAPTOP_TOKEN: &str = "0xb095274743941e953c746f9c228da9c18bb6ec29";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Mode {
    /// Only listen and log PoolManager events. No wallet required.
    Listen,
    /// Full pipeline including signing and (optionally) simulation, but never send.
    DryRun,
    /// Send the signed transaction on trigger.
    Live,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RouterVersion {
    /// UniversalRouterV2 (v4-periphery 444c526): ExactInputSingleParams has 5 fields.
    V2,
    /// UniversalRouter 2.1.1 (v4-periphery 3231810): adds `minHopPriceX36`.
    V2_1_1,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Trigger {
    /// Fire on the first positive ModifyLiquidity for the target pool (default).
    Liquidity,
    /// Fire on Initialize itself. Faster, but the buy reverts (gas lost) if
    /// liquidity is not added in the same transaction / before our buy lands.
    Initialize,
}

#[derive(Debug, Clone)]
pub struct Config {
    pub mode: Mode,
    pub ws_url: String,
    pub rpc_url: String,
    pub send_urls: Vec<String>,
    pub chain_id: u64,
    pub pool_manager: Address,
    pub router: Address,
    pub router_version: RouterVersion,
    pub weth: Address,
    pub target_token: Address,
    /// Currency we pay with. `Address::ZERO` = native ETH.
    pub counter_currency: Address,
    pub allowed_hooks: Vec<Address>,
    pub allowed_fees: Option<Vec<u32>>,
    pub allowed_tick_spacings: Option<Vec<i32>>,
    pub trigger: Trigger,
    pub min_liquidity_delta: U256,
    pub buy_amount_wei: U256,
    pub slippage_bps: u32,
    pub min_out_tokens: U256,
    pub gas_limit: u64,
    pub max_fee_per_gas_wei: u128,
    pub priority_fee_wei: u128,
    pub deadline_secs: u64,
    pub private_key: Option<String>,
    pub log_file: PathBuf,
    pub result_file: PathBuf,
    pub refresh_secs: u64,
    pub startup_scan_blocks: u64,
    pub receipt_poll_ms: u64,
    pub receipt_timeout_secs: u64,
    pub simulate_in_dry_run: bool,
    pub quiet: bool,
}

fn env(key: &str) -> Option<String> {
    std::env::var(key).ok().map(|v| v.trim().to_string()).filter(|v| !v.is_empty())
}

fn env_or(key: &str, default: &str) -> String {
    env(key).unwrap_or_else(|| default.to_string())
}

fn parse_addr(key: &str, default: &str) -> Result<Address> {
    let s = env_or(key, default);
    Address::from_str(&s).with_context(|| format!("{key}: invalid address '{s}'"))
}

fn parse_bool(key: &str, default: bool) -> bool {
    match env(key).as_deref().map(|s| s.to_ascii_lowercase()) {
        Some(s) => matches!(s.as_str(), "1" | "true" | "yes" | "on"),
        None => default,
    }
}

fn parse_u64(key: &str, default: u64) -> Result<u64> {
    match env(key) {
        Some(s) => s.parse::<u64>().with_context(|| format!("{key}: invalid integer '{s}'")),
        None => Ok(default),
    }
}

fn parse_list<T: FromStr>(key: &str) -> Result<Option<Vec<T>>>
where
    T::Err: std::fmt::Display,
{
    match env(key) {
        None => Ok(None),
        Some(s) if s.eq_ignore_ascii_case("any") => Ok(None),
        Some(s) => s
            .split(',')
            .map(|p| p.trim())
            .filter(|p| !p.is_empty())
            .map(|p| p.parse::<T>().map_err(|e| anyhow!("{key}: invalid entry '{p}': {e}")))
            .collect::<Result<Vec<_>>>()
            .map(Some),
    }
}

/// Parse a decimal string like "0.05" into an integer with `decimals` fractional digits.
pub fn parse_decimal(s: &str, decimals: u32) -> Result<U256> {
    let s = s.trim();
    if s.is_empty() {
        bail!("empty decimal");
    }
    let (int_part, frac_part) = match s.split_once('.') {
        Some((i, f)) => (i, f),
        None => (s, ""),
    };
    if !int_part.chars().all(|c| c.is_ascii_digit()) || !frac_part.chars().all(|c| c.is_ascii_digit()) {
        bail!("invalid decimal '{s}'");
    }
    if frac_part.len() > decimals as usize {
        bail!("'{s}' has more than {decimals} fractional digits");
    }
    let mut digits = String::with_capacity(int_part.len() + decimals as usize);
    digits.push_str(if int_part.is_empty() { "0" } else { int_part });
    digits.push_str(frac_part);
    for _ in frac_part.len()..decimals as usize {
        digits.push('0');
    }
    U256::from_str_radix(&digits, 10).map_err(|e| anyhow!("decimal parse: {e}"))
}

fn gwei_to_wei(key: &str, default: &str) -> Result<u128> {
    let v = parse_decimal(&env_or(key, default), 9).with_context(|| key.to_string())?;
    v.try_into().map_err(|_| anyhow!("{key}: value too large"))
}

impl Config {
    pub fn from_env() -> Result<Config> {
        let _ = dotenvy::dotenv();

        let mode = match env_or("MODE", "listen").to_ascii_lowercase().as_str() {
            "listen" => Mode::Listen,
            "dry_run" | "dryrun" | "dry-run" => Mode::DryRun,
            "live" => Mode::Live,
            other => bail!("MODE must be listen | dry_run | live (got '{other}')"),
        };

        let router_version = match env_or("ROUTER_VERSION", "v2").to_ascii_lowercase().as_str() {
            "v2" => RouterVersion::V2,
            "v2_1_1" | "v2.1.1" | "2.1.1" => RouterVersion::V2_1_1,
            other => bail!("ROUTER_VERSION must be v2 | v2_1_1 (got '{other}')"),
        };
        let router_default = match router_version {
            RouterVersion::V2 => BASE_UNIVERSAL_ROUTER_V2,
            RouterVersion::V2_1_1 => BASE_UNIVERSAL_ROUTER_V2_1_1,
        };

        let trigger = match env_or("TRIGGER", "liquidity").to_ascii_lowercase().as_str() {
            "liquidity" => Trigger::Liquidity,
            "initialize" | "init" => Trigger::Initialize,
            other => bail!("TRIGGER must be liquidity | initialize (got '{other}')"),
        };

        let rpc_url = env_or("RPC_URL", "https://mainnet-preconf.base.org");
        let send_urls: Vec<String> = env("SEND_URLS")
            .map(|s| s.split(',').map(|p| p.trim().to_string()).filter(|p| !p.is_empty()).collect())
            .unwrap_or_else(|| vec![rpc_url.clone()]);
        if send_urls.is_empty() {
            bail!("SEND_URLS is empty");
        }

        let counter = env_or("COUNTER_CURRENCY", "eth");
        let weth = parse_addr("WETH_ADDRESS", BASE_WETH)?;
        let counter_currency = match counter.to_ascii_lowercase().as_str() {
            "eth" | "native" | "0x0" | "0x0000000000000000000000000000000000000000" => Address::ZERO,
            "weth" => weth,
            other => Address::from_str(other).with_context(|| format!("COUNTER_CURRENCY: '{other}'"))?,
        };

        let allowed_hooks = parse_list::<Address>("ALLOWED_HOOKS")?.unwrap_or_else(|| vec![Address::ZERO]);

        let buy_amount_wei = parse_decimal(&env_or("BUY_AMOUNT_ETH", "0.01"), 18).context("BUY_AMOUNT_ETH")?;
        let max_buy = parse_decimal(&env_or("MAX_BUY_AMOUNT_ETH", "0.1"), 18).context("MAX_BUY_AMOUNT_ETH")?;
        if buy_amount_wei > max_buy {
            bail!("BUY_AMOUNT_ETH exceeds MAX_BUY_AMOUNT_ETH hard cap");
        }
        if buy_amount_wei > U256::from(u128::MAX) {
            bail!("BUY_AMOUNT_ETH does not fit uint128");
        }

        let slippage_bps = parse_u64("SLIPPAGE_BPS", 3000)? as u32;
        if slippage_bps >= 10_000 {
            bail!("SLIPPAGE_BPS must be < 10000");
        }
        let token_decimals = parse_u64("TOKEN_DECIMALS", 18)? as u32;
        let min_out_tokens = parse_decimal(&env_or("MIN_OUT_TOKENS", "0"), token_decimals).context("MIN_OUT_TOKENS")?;

        let private_key = env("PRIVATE_KEY");
        if mode != Mode::Listen && private_key.is_none() {
            bail!("PRIVATE_KEY is required for MODE={mode:?}");
        }

        Ok(Config {
            mode,
            ws_url: env_or("WS_URL", "wss://mainnet-preconf.base.org"),
            rpc_url,
            send_urls,
            chain_id: parse_u64("CHAIN_ID", BASE_CHAIN_ID)?,
            pool_manager: parse_addr("POOL_MANAGER", BASE_POOL_MANAGER)?,
            router: parse_addr("UNIVERSAL_ROUTER", router_default)?,
            router_version,
            weth,
            target_token: parse_addr("TARGET_TOKEN", LAPTOP_TOKEN)?,
            counter_currency,
            allowed_hooks,
            allowed_fees: parse_list::<u32>("ALLOWED_FEES")?,
            allowed_tick_spacings: parse_list::<i32>("ALLOWED_TICK_SPACINGS")?,
            trigger,
            min_liquidity_delta: U256::from_str_radix(&env_or("MIN_LIQUIDITY_DELTA", "1"), 10)
                .context("MIN_LIQUIDITY_DELTA")?,
            buy_amount_wei,
            slippage_bps,
            min_out_tokens,
            gas_limit: parse_u64("GAS_LIMIT", 500_000)?,
            max_fee_per_gas_wei: gwei_to_wei("MAX_FEE_PER_GAS_GWEI", "0.1")?,
            priority_fee_wei: gwei_to_wei("PRIORITY_FEE_GWEI", "0.01")?,
            deadline_secs: parse_u64("DEADLINE_SECS", 120)?,
            private_key,
            log_file: PathBuf::from(env_or("LOG_FILE", "sniper.jsonl")),
            result_file: PathBuf::from(env_or("RESULT_FILE", "result.json")),
            refresh_secs: parse_u64("REFRESH_SECS", 15)?.max(2),
            startup_scan_blocks: parse_u64("STARTUP_SCAN_BLOCKS", 0)?,
            receipt_poll_ms: parse_u64("RECEIPT_POLL_MS", 100)?.max(20),
            receipt_timeout_secs: parse_u64("RECEIPT_TIMEOUT_SECS", 90)?,
            simulate_in_dry_run: parse_bool("SIMULATE_IN_DRY_RUN", true),
            quiet: parse_bool("QUIET", false),
        })
    }

    /// Redacted view for logging (never includes the private key).
    pub fn summary(&self) -> serde_json::Value {
        serde_json::json!({
            "mode": format!("{:?}", self.mode),
            "ws_url": self.ws_url,
            "rpc_url": self.rpc_url,
            "send_urls": self.send_urls,
            "chain_id": self.chain_id,
            "pool_manager": self.pool_manager.to_string(),
            "router": self.router.to_string(),
            "router_version": format!("{:?}", self.router_version),
            "weth": self.weth.to_string(),
            "target_token": self.target_token.to_string(),
            "counter_currency": self.counter_currency.to_string(),
            "allowed_hooks": self.allowed_hooks.iter().map(|a| a.to_string()).collect::<Vec<_>>(),
            "allowed_fees": self.allowed_fees,
            "allowed_tick_spacings": self.allowed_tick_spacings,
            "trigger": format!("{:?}", self.trigger),
            "min_liquidity_delta": self.min_liquidity_delta.to_string(),
            "buy_amount_wei": self.buy_amount_wei.to_string(),
            "slippage_bps": self.slippage_bps,
            "min_out_tokens": self.min_out_tokens.to_string(),
            "gas_limit": self.gas_limit,
            "max_fee_per_gas_wei": self.max_fee_per_gas_wei,
            "priority_fee_wei": self.priority_fee_wei,
            "deadline_secs": self.deadline_secs,
            "has_private_key": self.private_key.is_some(),
            "refresh_secs": self.refresh_secs,
            "startup_scan_blocks": self.startup_scan_blocks,
            "simulate_in_dry_run": self.simulate_in_dry_run,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decimal_parsing() {
        assert_eq!(parse_decimal("1", 18).unwrap(), U256::from(10u128.pow(18)));
        assert_eq!(parse_decimal("0.05", 18).unwrap(), U256::from(5 * 10u128.pow(16)));
        assert_eq!(parse_decimal(".5", 9).unwrap(), U256::from(500_000_000u64));
        assert_eq!(parse_decimal("0.001", 9).unwrap(), U256::from(1_000_000u64));
        assert!(parse_decimal("0.0000000001", 9).is_err());
        assert!(parse_decimal("abc", 9).is_err());
    }
}
