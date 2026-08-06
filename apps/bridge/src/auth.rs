//! Pairing, session tokens and origin enforcement.
//!
//! Security properties (see docs/threat-model.md):
//! - Bridge binds loopback only (config.rs).
//! - Origin must match the strict allowlist; anything else is 403.
//! - OPTIONS preflight answers PNA (`Access-Control-Allow-Private-Network`).
//! - Pairing codes are one-time, short-lived, stored hashed.
//! - Session tokens are 32-byte random, stored hashed, short-lived.

use axum::extract::{Request, State};
use axum::http::{HeaderMap, HeaderName, HeaderValue, Method, StatusCode};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use rand::RngCore;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Instant;

use crate::config::{ALLOWED_ORIGINS, PAIRING_TTL_SECS, SESSION_TTL_SECS};

pub struct AuthStore {
    pairings: Mutex<HashMap<String, PairingRecord>>,
    sessions: Mutex<HashMap<String, SessionRecord>>,
    pub session_ttl: std::time::Duration,
    pub pairing_ttl: std::time::Duration,
}

struct PairingRecord {
    expires: Instant,
}

struct SessionRecord {
    expires: Instant,
}

impl Default for AuthStore {
    fn default() -> Self {
        Self {
            pairings: Mutex::new(HashMap::new()),
            sessions: Mutex::new(HashMap::new()),
            session_ttl: std::time::Duration::from_secs(SESSION_TTL_SECS),
            pairing_ttl: std::time::Duration::from_secs(PAIRING_TTL_SECS),
        }
    }
}

pub type SharedAuth = Arc<AuthStore>;

fn hash(s: &str) -> String {
    let mut h = Sha256::new();
    h.update(s.as_bytes());
    format!("{:x}", h.finalize())
}

fn random_hex(n_bytes: usize) -> String {
    let mut buf = vec![0u8; n_bytes];
    rand::thread_rng().fill_bytes(&mut buf);
    buf.iter().map(|b| format!("{b:02x}")).collect()
}

impl AuthStore {
    /// Create a one-time pairing code (6 decimal digits).
    pub fn start_pairing(&self) -> String {
        let code = format!("{:06}", rand::random::<u32>() % 1_000_000);
        let mut g = self.pairings.lock().unwrap();
        g.retain(|_, r| r.expires > Instant::now());
        g.insert(hash(&code), PairingRecord { expires: Instant::now() + self.pairing_ttl });
        code
    }

    /// Redeem a pairing code for a session token. Code is single-use.
    pub fn confirm_pairing(&self, code: &str) -> Option<String> {
        let key = hash(code);
        let mut g = self.pairings.lock().unwrap();
        let rec = g.remove(&key)?;
        if rec.expires <= Instant::now() {
            return None;
        }
        let token = random_hex(32);
        let mut s = self.sessions.lock().unwrap();
        s.retain(|_, r| r.expires > Instant::now());
        s.insert(hash(&token), SessionRecord { expires: Instant::now() + self.session_ttl });
        Some(token)
    }

    pub fn validate_session(&self, token: &str) -> bool {
        let mut s = self.sessions.lock().unwrap();
        s.retain(|_, r| r.expires > Instant::now());
        match s.get(&hash(token)) {
            Some(r) => r.expires > Instant::now(),
            None => false,
        }
    }

    pub fn revoke_session(&self, token: &str) {
        let mut s = self.sessions.lock().unwrap();
        s.remove(&hash(token));
    }
}

pub fn origin_allowed(headers: &HeaderMap) -> bool {
    match headers.get("origin").and_then(|v| v.to_str().ok()) {
        Some(o) => ALLOWED_ORIGINS.contains(&o),
        None => false,
    }
}

fn cors_headers(origin: &str) -> [(HeaderName, HeaderValue); 4] {
    [
        (
            HeaderName::from_static("access-control-allow-origin"),
            HeaderValue::from_str(origin).unwrap(),
        ),
        (
            HeaderName::from_static("access-control-allow-methods"),
            HeaderValue::from_static("GET, POST, DELETE, OPTIONS"),
        ),
        (
            HeaderName::from_static("access-control-allow-headers"),
            HeaderValue::from_static("content-type, authorization, x-session-token"),
        ),
        (
            HeaderName::from_static("access-control-allow-private-network"),
            HeaderValue::from_static("true"),
        ),
    ]
}

/// Middleware: reject non-allowlisted origins (403), answer OPTIONS preflight.
pub async fn origin_guard(
    State(auth): State<SharedAuth>,
    req: Request,
    next: Next,
) -> Response {
    let (parts, body) = req.into_parts();
    let method = parts.method.clone();
    let origin = parts
        .headers
        .get("origin")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();

    if !ALLOWED_ORIGINS.contains(&origin.as_str()) {
        return (StatusCode::FORBIDDEN, "origin not allowed").into_response();
    }

    if method == Method::OPTIONS {
        let mut resp = StatusCode::NO_CONTENT.into_response();
        let hdrs = resp.headers_mut();
        for (k, v) in cors_headers(&origin) {
            hdrs.insert(k, v);
        }
        return resp;
    }

    let _ = auth; // state kept for future per-session rate limiting
    let req = Request::from_parts(parts, body);
    let mut resp = next.run(req).await;
    if !origin.is_empty() {
        let hdrs = resp.headers_mut();
        for (k, v) in cors_headers(&origin) {
            hdrs.insert(k, v);
        }
    }
    resp
}

/// Session guard for authed routes: `x-session-token` header must be valid.
pub async fn session_guard(
    State(auth): State<SharedAuth>,
    req: Request,
    next: Next,
) -> Response {
    let token = req
        .headers()
        .get("x-session-token")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    if token.is_empty() || !auth.validate_session(&token) {
        return (StatusCode::UNAUTHORIZED, "invalid or expired session").into_response();
    }
    let mut req = req;
    req.extensions_mut().insert(token);
    next.run(req).await
}
