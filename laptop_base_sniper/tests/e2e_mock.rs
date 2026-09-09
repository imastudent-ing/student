//! End-to-end test: runs the real binary (MODE=live) against a local mock
//! Flashblocks WebSocket + JSON-RPC HTTP server and checks the same-block verdict.

use alloy::primitives::{address, aliases::{I24, U160, U24}, keccak256, Address, B256, I256};
use alloy::sol_types::SolEvent;
use futures_util::{SinkExt, StreamExt};
use laptop_base_sniper::abi;
use serde_json::{json, Value};
use std::process::Stdio;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio_tungstenite::tungstenite::Message;

const LAUNCH_BLOCK: u64 = 501;
const TEST_KEY: &str = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

fn pool_key() -> abi::PoolKey {
    abi::PoolKey {
        currency0: Address::ZERO,
        currency1: address!("b095274743941e953c746f9c228da9c18bb6ec29"),
        fee: U24::from(10_000u32),
        tickSpacing: I24::try_from(200).unwrap(),
        hooks: Address::ZERO,
    }
}

fn notification(topics: &[B256], data: &[u8], block: u64, tx: B256, tx_index: u64, log_index: u64) -> String {
    json!({
        "jsonrpc": "2.0",
        "method": "eth_subscription",
        "params": {
            "subscription": "0xabc",
            "result": {
                "address": "0x498581ff718922c3f8e6a244956af099b2652b2b",
                "topics": topics,
                "data": format!("0x{}", alloy::primitives::hex::encode(data)),
                "blockHash": null,
                "blockNumber": format!("0x{block:x}"),
                "blockTimestamp": "0x67bf8332",
                "transactionHash": tx,
                "transactionIndex": format!("0x{tx_index:x}"),
                "logIndex": format!("0x{log_index:x}"),
                "removed": false
            }
        }
    })
    .to_string()
}

/// Minimal HTTP/1.1 JSON-RPC responder.
async fn rpc_server(listener: TcpListener, receipt_calls: Arc<AtomicU32>, sent_raw: Arc<tokio::sync::Mutex<Vec<String>>>) {
    loop {
        let (mut sock, _) = listener.accept().await.unwrap();
        let receipt_calls = receipt_calls.clone();
        let sent_raw = sent_raw.clone();
        tokio::spawn(async move {
            let mut buf = Vec::new();
            loop {
                // Read one request (headers + body). Keep-alive: loop.
                let mut header_end;
                loop {
                    header_end = buf.windows(4).position(|w| w == b"\r\n\r\n");
                    if header_end.is_some() {
                        break;
                    }
                    let mut tmp = [0u8; 4096];
                    let n = match sock.read(&mut tmp).await {
                        Ok(0) | Err(_) => return,
                        Ok(n) => n,
                    };
                    buf.extend_from_slice(&tmp[..n]);
                }
                let header_end = header_end.unwrap() + 4;
                let headers = String::from_utf8_lossy(&buf[..header_end]).to_string();
                let content_length: usize = headers
                    .lines()
                    .find_map(|l| l.to_ascii_lowercase().strip_prefix("content-length:").map(|v| v.trim().parse().unwrap()))
                    .unwrap_or(0);
                while buf.len() < header_end + content_length {
                    let mut tmp = [0u8; 4096];
                    let n = match sock.read(&mut tmp).await {
                        Ok(0) | Err(_) => return,
                        Ok(n) => n,
                    };
                    buf.extend_from_slice(&tmp[..n]);
                }
                let body: Value = serde_json::from_slice(&buf[header_end..header_end + content_length]).unwrap();
                buf.drain(..header_end + content_length);

                let id = body["id"].clone();
                let method = body["method"].as_str().unwrap_or("");
                let params = body["params"].clone();
                let result: Value = match method {
                    "eth_chainId" => json!("0x2105"),
                    "eth_blockNumber" => json!("0x1f4"),
                    "eth_getCode" => json!("0x6080604052"),
                    "eth_getBlockByNumber" => json!({"number": "0x1f5", "baseFeePerGas": "0xf4240", "timestamp": "0x67bf8332"}),
                    "eth_maxPriorityFeePerGas" => json!("0x3e8"),
                    "eth_getTransactionCount" => json!("0x2a"),
                    "eth_getBalance" => json!("0xde0b6b3a7640000"),
                    "eth_call" => json!("0x"),
                    "eth_sendRawTransaction" => {
                        let raw = params[0].as_str().unwrap().to_string();
                        let bytes = alloy::primitives::hex::decode(&raw).unwrap();
                        let hash = keccak256(&bytes);
                        sent_raw.lock().await.push(raw);
                        json!(hash)
                    }
                    "eth_getTransactionReceipt" => {
                        let n = receipt_calls.fetch_add(1, Ordering::SeqCst);
                        let hash: B256 = serde_json::from_value(params[0].clone()).unwrap();
                        if n < 2 {
                            Value::Null
                        } else if hash == B256::repeat_byte(0xcc) {
                            // launch tx receipt
                            json!({"transactionHash": hash, "blockNumber": format!("0x{LAUNCH_BLOCK:x}"), "transactionIndex": "0x6", "status": "0x1", "gasUsed": "0x1", "logs": []})
                        } else {
                            json!({"transactionHash": hash, "blockNumber": format!("0x{LAUNCH_BLOCK:x}"), "transactionIndex": "0x9", "status": "0x1", "gasUsed": "0x2b67c", "effectiveGasPrice": "0xf4240", "l1Fee": "0x10", "logs": [{}, {}, {}]})
                        }
                    }
                    _ => json!(null),
                };
                let resp = json!({"jsonrpc": "2.0", "id": id, "result": result}).to_string();
                let http = format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{}", resp.len(), resp);
                if sock.write_all(http.as_bytes()).await.is_err() {
                    return;
                }
            }
        });
    }
}

/// Mock Flashblocks WSS: ack the pendingLogs subscription, then stream frames.
async fn ws_server(listener: TcpListener, subscribe_seen: Arc<tokio::sync::Mutex<Option<Value>>>) {
    let (stream, _) = listener.accept().await.unwrap();
    let mut ws = tokio_tungstenite::accept_async(stream).await.unwrap();
    // Expect subscribe request.
    let req = loop {
        match ws.next().await {
            Some(Ok(Message::Text(t))) => break serde_json::from_str::<Value>(t.as_str()).unwrap(),
            Some(Ok(_)) => continue,
            other => panic!("unexpected ws frame: {other:?}"),
        }
    };
    *subscribe_seen.lock().await = Some(req.clone());
    ws.send(Message::Text(json!({"jsonrpc": "2.0", "id": req["id"], "result": "0xabc"}).to_string().into())).await.unwrap();

    let key = pool_key();
    let id = abi::pool_id(&key);

    // Unrelated pool first (should be ignored).
    let other_key = abi::PoolKey { currency1: address!("833589fcd6edb6e08f4c7c32d4f71b54bda02913"), ..key.clone() };
    let ev = abi::Initialize {
        id: abi::pool_id(&other_key),
        currency0: other_key.currency0,
        currency1: other_key.currency1,
        fee: other_key.fee,
        tickSpacing: other_key.tickSpacing,
        hooks: other_key.hooks,
        sqrtPriceX96: U160::from(1u8) << 96,
        tick: I24::ZERO,
    };
    let d = ev.encode_log_data();
    ws.send(Message::Text(notification(d.topics(), &d.data, 499, B256::repeat_byte(0x11), 1, 0).into())).await.unwrap();
    tokio::time::sleep(Duration::from_millis(50)).await;

    // Target pool Initialize (block 501, tx 0xcc) ...
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
    let d = ev.encode_log_data();
    ws.send(Message::Text(notification(d.topics(), &d.data, LAUNCH_BLOCK, B256::repeat_byte(0xcc), 6, 3).into())).await.unwrap();
    // ... and liquidity in the same transaction.
    let ev = abi::ModifyLiquidity {
        id,
        sender: address!("7c5f5a4bbd8fd63184577525326123b519429bdc"),
        tickLower: I24::try_from(-887200).unwrap(),
        tickUpper: I24::try_from(887200).unwrap(),
        liquidityDelta: I256::try_from(1_000_000_000i128).unwrap(),
        salt: B256::ZERO,
    };
    let d = ev.encode_log_data();
    ws.send(Message::Text(notification(d.topics(), &d.data, LAUNCH_BLOCK, B256::repeat_byte(0xcc), 6, 4).into())).await.unwrap();
    // A second liquidity add must not trigger again.
    ws.send(Message::Text(notification(d.topics(), &d.data, LAUNCH_BLOCK + 1, B256::repeat_byte(0xdd), 2, 1).into())).await.unwrap();

    // Keep the socket open until the client closes.
    while let Some(Ok(m)) = ws.next().await {
        if let Message::Close(_) = m {
            break;
        }
    }
}

#[tokio::test]
async fn live_mode_same_block_against_mock_endpoints() {
    let rpc_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let rpc_port = rpc_listener.local_addr().unwrap().port();
    let ws_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let ws_port = ws_listener.local_addr().unwrap().port();

    let receipt_calls = Arc::new(AtomicU32::new(0));
    let sent_raw = Arc::new(tokio::sync::Mutex::new(Vec::<String>::new()));
    let subscribe_seen = Arc::new(tokio::sync::Mutex::new(None));
    tokio::spawn(rpc_server(rpc_listener, receipt_calls.clone(), sent_raw.clone()));
    tokio::spawn(ws_server(ws_listener, subscribe_seen.clone()));

    let dir = std::env::temp_dir().join(format!("laptop_sniper_e2e_{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let result_file = dir.join("result.json");
    let log_file = dir.join("sniper.jsonl");

    let mut child = tokio::process::Command::new(env!("CARGO_BIN_EXE_laptop_base_sniper"))
        .env_clear()
        .env("PATH", std::env::var("PATH").unwrap_or_default())
        .env("NO_PROXY", "127.0.0.1,localhost")
        .env("no_proxy", "127.0.0.1,localhost")
        .env("MODE", "live")
        .env("WS_URL", format!("ws://127.0.0.1:{ws_port}"))
        .env("RPC_URL", format!("http://127.0.0.1:{rpc_port}"))
        .env("SEND_URLS", format!("http://127.0.0.1:{rpc_port},http://127.0.0.1:{rpc_port}"))
        .env("PRIVATE_KEY", TEST_KEY)
        .env("BUY_AMOUNT_ETH", "0.01")
        .env("RESULT_FILE", &result_file)
        .env("LOG_FILE", &log_file)
        .env("RECEIPT_POLL_MS", "30")
        .env("RECEIPT_TIMEOUT_SECS", "10")
        .env("QUIET", "true")
        .current_dir(&dir)
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn binary");

    let status = tokio::time::timeout(Duration::from_secs(40), child.wait()).await;
    let mut stderr = String::new();
    if let Some(mut e) = child.stderr.take() {
        let _ = e.read_to_string(&mut stderr).await;
    }
    let status = match status {
        Ok(s) => s.unwrap(),
        Err(_) => {
            let _ = child.kill().await;
            panic!("binary did not exit in time; stderr:\n{stderr}");
        }
    };
    assert!(status.success(), "binary failed: {status:?}\n{stderr}");

    // Subscription request shape.
    let sub = subscribe_seen.lock().await.clone().expect("subscribe seen");
    assert_eq!(sub["method"], "eth_subscribe");
    assert_eq!(sub["params"][0], "pendingLogs");
    assert_eq!(sub["params"][1]["address"], "0x498581ff718922c3f8e6a244956af099b2652b2b");
    let topics = sub["params"][1]["topics"][0].as_array().unwrap();
    assert_eq!(topics.len(), 3);

    // Exactly one distinct raw tx, sent to both endpoints.
    let raws = sent_raw.lock().await.clone();
    assert_eq!(raws.len(), 2, "one send per endpoint");
    assert_eq!(raws[0], raws[1]);
    assert!(raws[0].starts_with("0x02"));

    // Verdict.
    let result: Value = serde_json::from_str(&std::fs::read_to_string(&result_file).unwrap()).unwrap();
    println!("RESULT: {}", serde_json::to_string_pretty(&result).unwrap());
    assert_eq!(result["outcome"], "same_block", "{result}");
    assert_eq!(result["launch_block_number"], LAUNCH_BLOCK);
    assert_eq!(result["our_buy_block_number"], LAUNCH_BLOCK);
    assert_eq!(result["launch_block_number_final"], LAUNCH_BLOCK);
    assert_eq!(result["block_delta"], 0);
    assert_eq!(result["launch_tx_index"], 6);
    assert_eq!(result["our_buy_tx_index"], 9);
    assert_eq!(result["launch_trigger_event"], "ModifyLiquidity");
    assert_eq!(result["pool"]["swaps_before_trigger"], 0);
    assert!(result["latency_us"]["ws_recv_to_send_start"].as_u64().unwrap() < 50_000);

    // Log shows one TRIGGER, one SEND and one presign (on Initialize) — no re-fire on the second liquidity add.
    let log = std::fs::read_to_string(&log_file).unwrap();
    assert_eq!(log.matches("\"event\":\"TRIGGER\"").count(), 1);
    assert_eq!(log.matches("\"event\":\"SEND\"").count(), 1);
    assert_eq!(log.matches("\"event\":\"send_ok\"").count(), 2);
    assert!(log.contains("\"event\":\"presigned\""));
    assert!(log.contains("\"event\":\"RESULT\""));
    let _ = std::fs::remove_dir_all(&dir);
}
