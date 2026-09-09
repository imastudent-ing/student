//! Base Flashblocks WebSocket client.
//!
//! Subscribes with `eth_subscribe("pendingLogs", {address, topics})` on a
//! Flashblocks-aware WSS endpoint (Base docs: base-chain/api-reference/
//! flashblocks-api/pendingLogs). Each notification carries exactly one log
//! from a pre-confirmed transaction, ~200ms after the sequencer included it.

use alloy::primitives::{hex, Address, B256};
use anyhow::{anyhow, bail, Context, Result};
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use serde_json::{json, Value};
use std::borrow::Cow;
use std::time::{Duration, Instant};
use tokio::net::TcpStream;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream};

pub type WsStream = WebSocketStream<MaybeTlsStream<TcpStream>>;

/// A decoded pre-confirmed log with receive timing.
#[derive(Debug, Clone)]
pub struct PendingLog {
    pub t_recv: Instant,
    pub t_decoded: Instant,
    pub address: Address,
    pub topics: Vec<B256>,
    pub data: Vec<u8>,
    pub block_number: u64,
    pub block_timestamp: Option<u64>,
    pub tx_hash: B256,
    pub tx_index: u64,
    pub log_index: u64,
    pub removed: bool,
}

#[derive(Deserialize)]
struct WsMessage<'a> {
    #[serde(borrow, default)]
    method: Option<Cow<'a, str>>,
    #[serde(borrow, default)]
    params: Option<SubParams<'a>>,
    #[serde(default)]
    id: Option<Value>,
    #[serde(default)]
    result: Option<Value>,
    #[serde(default)]
    error: Option<Value>,
}

#[derive(Deserialize)]
struct SubParams<'a> {
    #[serde(borrow, default)]
    subscription: Option<Cow<'a, str>>,
    #[serde(borrow)]
    result: RawLog<'a>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawLog<'a> {
    #[serde(borrow)]
    address: Cow<'a, str>,
    #[serde(borrow)]
    topics: Vec<Cow<'a, str>>,
    #[serde(borrow)]
    data: Cow<'a, str>,
    #[serde(borrow, default)]
    block_number: Option<Cow<'a, str>>,
    #[serde(borrow, default)]
    block_timestamp: Option<Cow<'a, str>>,
    #[serde(borrow, default)]
    transaction_hash: Option<Cow<'a, str>>,
    #[serde(borrow, default)]
    transaction_index: Option<Cow<'a, str>>,
    #[serde(borrow, default)]
    log_index: Option<Cow<'a, str>>,
    #[serde(default)]
    removed: Option<bool>,
}

/// What the reader loop hands to the engine.
pub enum WsEvent {
    Log(PendingLog),
    /// Non-log JSON-RPC frame (subscription ack, error, other subscription).
    Other(Value),
}

fn parse_hex_u64(v: &Option<Cow<'_, str>>) -> u64 {
    v.as_deref()
        .map(|s| s.trim_start_matches("0x"))
        .filter(|s| !s.is_empty())
        .and_then(|s| u64::from_str_radix(s, 16).ok())
        .unwrap_or(0)
}

/// Parse one text frame. Called on the hot path: borrows from the frame and
/// allocates only for topics/data.
pub fn parse_frame(text: &str, t_recv: Instant) -> Result<WsEvent> {
    let msg: WsMessage<'_> = serde_json::from_str(text).context("ws frame json")?;
    if msg.method.as_deref() == Some("eth_subscription") {
        let params = msg.params.ok_or_else(|| anyhow!("eth_subscription without params"))?;
        let raw = params.result;
        let address: Address = raw.address.parse().context("log address")?;
        let mut topics = Vec::with_capacity(raw.topics.len());
        for t in &raw.topics {
            topics.push(t.parse::<B256>().context("log topic")?);
        }
        let data = hex::decode(raw.data.as_ref()).context("log data")?;
        let tx_hash = match &raw.transaction_hash {
            Some(h) => h.parse::<B256>().context("log txHash")?,
            None => B256::ZERO,
        };
        let block_timestamp = raw.block_timestamp.as_ref().map(|_| parse_hex_u64(&raw.block_timestamp));
        let _ = params.subscription;
        return Ok(WsEvent::Log(PendingLog {
            t_recv,
            t_decoded: Instant::now(),
            address,
            topics,
            data,
            block_number: parse_hex_u64(&raw.block_number),
            block_timestamp,
            tx_hash,
            tx_index: parse_hex_u64(&raw.transaction_index),
            log_index: parse_hex_u64(&raw.log_index),
            removed: raw.removed.unwrap_or(false),
        }));
    }
    Ok(WsEvent::Other(json!({
        "id": msg.id,
        "result": msg.result,
        "error": msg.error,
        "method": msg.method,
    })))
}

/// Connect and subscribe. Returns the stream and the subscription id.
pub async fn connect_and_subscribe(ws_url: &str, address: Address, topic0s: &[B256]) -> Result<(WsStream, String)> {
    let (mut ws, _resp) = tokio::time::timeout(Duration::from_secs(15), tokio_tungstenite::connect_async(ws_url))
        .await
        .context("ws connect timeout")?
        .context("ws connect")?;

    let filter = json!({
        "address": address,
        "topics": [topic0s],
    });
    let req = json!({"jsonrpc": "2.0", "id": 1, "method": "eth_subscribe", "params": ["pendingLogs", filter]});
    ws.send(Message::Text(req.to_string().into())).await.context("send subscribe")?;

    // Wait for the ack (id == 1). Skip anything else.
    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            bail!("no subscription ack within 15s");
        }
        let frame = tokio::time::timeout(remaining, ws.next()).await.context("subscribe ack timeout")?;
        let frame = frame.ok_or_else(|| anyhow!("ws closed before ack"))?.context("ws frame")?;
        match frame {
            Message::Text(t) => {
                let v: Value = serde_json::from_str(t.as_str()).context("ack json")?;
                if v.get("id").and_then(|i| i.as_u64()) == Some(1) {
                    if let Some(err) = v.get("error") {
                        bail!("eth_subscribe(pendingLogs) rejected: {err}");
                    }
                    let id = v
                        .get("result")
                        .and_then(|r| r.as_str())
                        .ok_or_else(|| anyhow!("subscribe ack without result: {v}"))?;
                    return Ok((ws, id.to_string()));
                }
            }
            Message::Ping(p) => ws.send(Message::Pong(p)).await?,
            Message::Close(c) => bail!("ws closed during subscribe: {c:?}"),
            _ => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_pending_logs_notification() {
        // Shape per Base docs (flashblocks-api-overview "Log Object") — one log per message.
        // 5 static words: fee=10000, tickSpacing=200, hooks=0, sqrtPriceX96=2^96, tick=0
        let mut data = String::from("0x");
        for w in [
            "0000000000000000000000000000000000000000000000000000000000002710",
            "00000000000000000000000000000000000000000000000000000000000000c8",
            "0000000000000000000000000000000000000000000000000000000000000000",
            "0000000000000000000000000000000001000000000000000000000000000000",
            "0000000000000000000000000000000000000000000000000000000000000000",
        ] {
            data.push_str(w);
        }
        let frame = format!(
            r#"{{"jsonrpc":"2.0","method":"eth_subscription","params":{{"subscription":"0x2a7b","result":{{
            "address":"0x498581ff718922c3f8e6a244956af099b2652b2b",
            "topics":["0xdd466e674ea557f56295e2d0218a125ea4b4f0f6f3307b95f85e6110838d6438",
                      "0x1111111111111111111111111111111111111111111111111111111111111111",
                      "0x0000000000000000000000000000000000000000000000000000000000000000",
                      "0x000000000000000000000000b095274743941e953c746f9c228da9c18bb6ec29"],
            "data":"{data}",
            "blockHash":null,"blockNumber":"0x2c679a1","blockTimestamp":"0x67bf8332",
            "transactionHash":"0x6a010a5ce041ff0ee5a926db65d1ef512836cae822d5f2d58b63981bfa40aa7f",
            "transactionIndex":"0x83","logIndex":"0x1f","removed":false}}}}}}"#
        );
        let frame = frame.as_str();
        match parse_frame(frame, Instant::now()).unwrap() {
            WsEvent::Log(l) => {
                assert_eq!(l.address, "0x498581ff718922c3f8e6a244956af099b2652b2b".parse::<Address>().unwrap());
                assert_eq!(l.topics.len(), 4);
                assert_eq!(l.block_number, 0x2c679a1);
                assert_eq!(l.block_timestamp, Some(0x67bf8332));
                assert_eq!(l.tx_index, 0x83);
                assert_eq!(l.log_index, 0x1f);
                assert!(!l.removed);
                assert_eq!(l.data.len(), 5 * 32);
            }
            WsEvent::Other(_) => panic!("expected log"),
        }
    }

    #[test]
    fn non_subscription_frames_are_other() {
        let ack = r#"{"jsonrpc":"2.0","id":1,"result":"0x2a7b"}"#;
        assert!(matches!(parse_frame(ack, Instant::now()).unwrap(), WsEvent::Other(_)));
        let err = r#"{"jsonrpc":"2.0","id":1,"error":{"code":-32601,"message":"unsupported"}}"#;
        assert!(matches!(parse_frame(err, Instant::now()).unwrap(), WsEvent::Other(_)));
    }
}
