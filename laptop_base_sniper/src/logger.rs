//! Non-blocking structured logger.
//!
//! The hot path only pushes a `serde_json::Value` onto an unbounded channel.
//! A separate task serialises it as JSON Lines to a file and prints a compact
//! line to stderr, so no disk or console I/O happens on the event thread.

use serde_json::{json, Value};
use std::path::PathBuf;
use tokio::io::AsyncWriteExt;
use tokio::sync::mpsc;

use crate::timing::unix_nanos;

#[derive(Clone)]
pub struct Logger {
    tx: mpsc::UnboundedSender<Value>,
}

impl Logger {
    /// Spawns the writer task. Returns the handle used by producers.
    pub fn start(path: PathBuf, quiet: bool) -> Logger {
        let (tx, mut rx) = mpsc::unbounded_channel::<Value>();
        tokio::spawn(async move {
            let mut file = match tokio::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(&path)
                .await
            {
                Ok(f) => Some(f),
                Err(e) => {
                    eprintln!("[logger] cannot open {}: {e}", path.display());
                    None
                }
            };
            while let Some(v) = rx.recv().await {
                let line = v.to_string();
                if !quiet || v.get("level").and_then(|l| l.as_str()) != Some("debug") {
                    eprintln!("{line}");
                }
                if let Some(f) = file.as_mut() {
                    let _ = f.write_all(line.as_bytes()).await;
                    let _ = f.write_all(b"\n").await;
                }
            }
        });
        Logger { tx }
    }

    /// Emit an event. `fields` is merged with `ts_unix_ns`, `level` and `event`.
    #[inline]
    pub fn emit(&self, level: &str, event: &str, mut fields: Value) {
        if let Value::Object(ref mut m) = fields {
            m.insert("ts_unix_ns".into(), json!(unix_nanos().to_string()));
            m.insert("level".into(), json!(level));
            m.insert("event".into(), json!(event));
            let _ = self.tx.send(fields);
        } else {
            let _ = self.tx.send(json!({
                "ts_unix_ns": unix_nanos().to_string(),
                "level": level,
                "event": event,
                "data": fields,
            }));
        }
    }

    #[inline]
    pub fn info(&self, event: &str, fields: Value) {
        self.emit("info", event, fields)
    }
    #[inline]
    pub fn warn(&self, event: &str, fields: Value) {
        self.emit("warn", event, fields)
    }
    #[inline]
    pub fn error(&self, event: &str, fields: Value) {
        self.emit("error", event, fields)
    }
    #[inline]
    pub fn debug(&self, event: &str, fields: Value) {
        self.emit("debug", event, fields)
    }
}
