//! Content-free diagnostics: logs never contain request bodies, API keys,
//! patent text, or pairing/session secrets.

use std::time::{Duration, Instant};

pub fn line(method: &str, path: &str, status: u16, elapsed: Duration, request_id: &str) {
    eprintln!(
        "{{\"ts\":{},\"evt\":\"bridge.http\",\"method\":{},\"path\":{},\"status\":{},\"ms\":{},\"rid\":{}}}",
        now_ms(),
        json_str(method),
        json_str(path),
        status,
        elapsed.as_millis(),
        json_str(request_id)
    );
}

pub fn request_id() -> String {
    let n = rand::random::<u64>();
    format!("{n:016x}")
}

fn now_ms() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

fn json_str(s: &str) -> String {
    serde_json::to_string(s).unwrap_or_else(|_| "\"?\"".into())
}

pub struct Meter(pub Instant);
impl Default for Meter {
    fn default() -> Self {
        Self(Instant::now())
    }
}
impl Meter {
    pub fn done(&self, method: &str, path: &str, status: u16, request_id: &str) {
        line(method, path, status, self.0.elapsed(), request_id);
    }
}
