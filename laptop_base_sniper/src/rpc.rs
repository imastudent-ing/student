//! Minimal JSON-RPC over HTTP client (reqwest, keep-alive, HTTP/2 when offered).
//!
//! Deliberately hand-rolled: the hot path needs exactly one method
//! (`eth_sendRawTransaction`) fanned out to N endpoints with per-endpoint
//! timing, and everything else is off the hot path.

use alloy::primitives::{Address, B256, U256};
use anyhow::{anyhow, bail, Context, Result};
use serde::de::DeserializeOwned;
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

#[derive(Clone)]
pub struct Rpc {
    client: reqwest::Client,
    id: std::sync::Arc<AtomicU64>,
}

#[derive(Deserialize)]
struct RpcResponse<T> {
    result: Option<T>,
    error: Option<RpcError>,
}

#[derive(Deserialize, Debug)]
pub struct RpcError {
    pub code: i64,
    pub message: String,
    #[serde(default)]
    pub data: Option<Value>,
}

impl std::fmt::Display for RpcError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "rpc error {}: {}", self.code, self.message)?;
        if let Some(d) = &self.data {
            write!(f, " ({d})")?;
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Receipt {
    #[allow(dead_code)]
    pub transaction_hash: B256,
    pub block_number: Option<String>,
    pub transaction_index: Option<String>,
    pub status: Option<String>,
    pub gas_used: Option<String>,
    pub effective_gas_price: Option<String>,
    #[serde(default)]
    pub l1_fee: Option<String>,
    #[serde(default)]
    pub logs: Vec<Value>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BlockHeader {
    pub number: String,
    pub base_fee_per_gas: Option<String>,
    pub timestamp: String,
}

pub fn hex_to_u64(s: &str) -> Result<u64> {
    let t = s.trim_start_matches("0x");
    if t.is_empty() {
        return Ok(0);
    }
    u64::from_str_radix(t, 16).with_context(|| format!("bad hex u64 '{s}'"))
}

pub fn hex_to_u128(s: &str) -> Result<u128> {
    let t = s.trim_start_matches("0x");
    if t.is_empty() {
        return Ok(0);
    }
    u128::from_str_radix(t, 16).with_context(|| format!("bad hex u128 '{s}'"))
}

pub fn hex_to_u256(s: &str) -> Result<U256> {
    U256::from_str_radix(s.trim_start_matches("0x"), 16).with_context(|| format!("bad hex u256 '{s}'"))
}

impl Rpc {
    pub fn new(timeout: Duration) -> Result<Rpc> {
        let client = reqwest::Client::builder()
            .timeout(timeout)
            .tcp_nodelay(true)
            .pool_idle_timeout(Duration::from_secs(300))
            .pool_max_idle_per_host(4)
            .build()
            .context("build reqwest client")?;
        Ok(Rpc { client, id: std::sync::Arc::new(AtomicU64::new(1)) })
    }

    pub async fn call<T: DeserializeOwned>(&self, url: &str, method: &str, params: Value) -> Result<T> {
        let id = self.id.fetch_add(1, Ordering::Relaxed);
        let body = json!({"jsonrpc": "2.0", "id": id, "method": method, "params": params});
        let resp = self
            .client
            .post(url)
            .json(&body)
            .send()
            .await
            .with_context(|| format!("{method} -> {url}: request failed"))?;
        let status = resp.status();
        let text = resp.text().await.with_context(|| format!("{method} -> {url}: body"))?;
        if !status.is_success() {
            bail!("{method} -> {url}: HTTP {status}: {}", text.chars().take(300).collect::<String>());
        }
        let parsed: RpcResponse<T> =
            serde_json::from_str(&text).with_context(|| format!("{method} -> {url}: bad JSON: {}", text.chars().take(300).collect::<String>()))?;
        if let Some(e) = parsed.error {
            return Err(anyhow!("{method} -> {url}: {e}"));
        }
        parsed.result.ok_or_else(|| anyhow!("{method} -> {url}: null result"))
    }

    pub async fn chain_id(&self, url: &str) -> Result<u64> {
        let s: String = self.call(url, "eth_chainId", json!([])).await?;
        hex_to_u64(&s)
    }

    pub async fn block_number(&self, url: &str) -> Result<u64> {
        let s: String = self.call(url, "eth_blockNumber", json!([])).await?;
        hex_to_u64(&s)
    }

    pub async fn nonce(&self, url: &str, addr: Address, tag: &str) -> Result<u64> {
        let s: String = self.call(url, "eth_getTransactionCount", json!([addr, tag])).await?;
        hex_to_u64(&s)
    }

    pub async fn balance(&self, url: &str, addr: Address, tag: &str) -> Result<U256> {
        let s: String = self.call(url, "eth_getBalance", json!([addr, tag])).await?;
        hex_to_u256(&s)
    }

    pub async fn code_len(&self, url: &str, addr: Address) -> Result<usize> {
        let s: String = self.call(url, "eth_getCode", json!([addr, "latest"])).await?;
        Ok(s.trim_start_matches("0x").len() / 2)
    }

    pub async fn latest_header(&self, url: &str, tag: &str) -> Result<BlockHeader> {
        self.call(url, "eth_getBlockByNumber", json!([tag, false])).await
    }

    pub async fn max_priority_fee(&self, url: &str) -> Result<u128> {
        let s: String = self.call(url, "eth_maxPriorityFeePerGas", json!([])).await?;
        hex_to_u128(&s)
    }

    /// Returns the tx hash reported by the node.
    pub async fn send_raw_transaction(&self, url: &str, raw_hex: &str) -> Result<B256> {
        self.call(url, "eth_sendRawTransaction", json!([raw_hex])).await
    }

    pub async fn transaction_receipt(&self, url: &str, hash: B256) -> Result<Option<Receipt>> {
        // A null result is legitimate here (not yet included).
        let id = self.id.fetch_add(1, Ordering::Relaxed);
        let body = json!({"jsonrpc": "2.0", "id": id, "method": "eth_getTransactionReceipt", "params": [hash]});
        let resp = self.client.post(url).json(&body).send().await.context("eth_getTransactionReceipt")?;
        let text = resp.text().await?;
        let parsed: RpcResponse<Receipt> = serde_json::from_str(&text).context("receipt JSON")?;
        if let Some(e) = parsed.error {
            return Err(anyhow!("eth_getTransactionReceipt: {e}"));
        }
        Ok(parsed.result)
    }

    /// `eth_call` against a block tag ("pending" resolves against Flashblocks state on Base).
    pub async fn eth_call(&self, url: &str, tx: Value, tag: &str) -> Result<String> {
        self.call(url, "eth_call", json!([tx, tag])).await
    }

    pub async fn get_logs(&self, url: &str, filter: Value) -> Result<Vec<Value>> {
        self.call(url, "eth_getLogs", json!([filter])).await
    }
}
