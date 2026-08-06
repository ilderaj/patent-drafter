//! HTTP API surface. All routes are loopback-only (bind addr from config.rs).
//! Security gates: origin_guard (allowlist + PNA) → session_guard (authed routes).

use axum::extract::State;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::{delete, get, post};
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::sync::Arc;

use crate::auth::{origin_guard, session_guard, SharedAuth};
use crate::credentials::CredentialStore;
use crate::log::Meter;
use crate::provider::{ChatRequest, LlmProvider};

#[derive(Clone)]
pub struct AppState {
    pub auth: SharedAuth,
    pub credentials: Arc<Box<dyn CredentialStore>>,
    pub provider: Arc<Box<dyn LlmProvider>>,
    pub version: &'static str,
}

pub fn router(state: AppState) -> Router {
    let authed = Router::new()
        .route("/api/session", delete(session_revoke))
        .route("/api/status", get(status))
        .route("/api/credentials", post(credentials_store).delete(credentials_delete))
        .route("/api/credentials/configured", get(credentials_configured))
        .route("/api/providers/deepseek/chat", post(chat))
        .layer(axum::middleware::from_fn_with_state(state.auth.clone(), session_guard));

    Router::new()
        .route("/healthz", get(healthz))
        .route("/api/pair/start", post(pair_start))
        .route("/api/pair/confirm", post(pair_confirm))
        .merge(authed)
        .layer(axum::middleware::from_fn_with_state(state.auth.clone(), origin_guard))
        .with_state(state)
}

async fn healthz() -> impl IntoResponse {
    Json(json!({ "ok": true, "service": "patent-bridge", "version": env!("CARGO_PKG_VERSION") }))
}

async fn pair_start(State(s): State<AppState>) -> impl IntoResponse {
    let code = s.auth.start_pairing();
    Json(json!({ "pairingCode": code, "expiresInSecs": crate::config::PAIRING_TTL_SECS }))
}

#[derive(Deserialize)]
struct PairConfirmBody {
    pairing_code: String,
}

async fn pair_confirm(
    State(s): State<AppState>,
    Json(body): Json<PairConfirmBody>,
) -> Result<Json<Value>, StatusCode> {
    match s.auth.confirm_pairing(body.pairing_code.trim()) {
        Some(token) => Ok(Json(json!({
            "sessionToken": token,
            "expiresInSecs": crate::config::SESSION_TTL_SECS,
        }))),
        None => Err(StatusCode::UNAUTHORIZED),
    }
}

async fn session_revoke(State(s): State<AppState>, headers: axum::http::HeaderMap) -> impl IntoResponse {
    if let Some(t) = headers.get("x-session-token").and_then(|v| v.to_str().ok()) {
        s.auth.revoke_session(t);
    }
    StatusCode::NO_CONTENT
}

async fn status(State(s): State<AppState>) -> impl IntoResponse {
    let configured = s.credentials.load_key().map(|k| k.is_some()).unwrap_or(false);
    Json(json!({
        "bridgeConnected": true,
        "provider": "deepseek",
        "credentialConfigured": configured,
        "loopback": true,
    }))
}

#[derive(Deserialize)]
struct CredentialBody {
    api_key: String,
}

async fn credentials_store(
    State(s): State<AppState>,
    Json(body): Json<CredentialBody>,
) -> Result<StatusCode, StatusCode> {
    let key = body.api_key.trim();
    if key.len() < 8 || !key.starts_with("sk-") {
        return Err(StatusCode::BAD_REQUEST);
    }
    s.credentials.store_key(key).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(StatusCode::NO_CONTENT)
}

async fn credentials_delete(State(s): State<AppState>) -> Result<StatusCode, StatusCode> {
    s.credentials.delete_key().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(StatusCode::NO_CONTENT)
}

async fn credentials_configured(State(s): State<AppState>) -> impl IntoResponse {
    let configured = s.credentials.load_key().map(|k| k.is_some()).unwrap_or(false);
    Json(json!({ "configured": configured }))
}

async fn chat(
    State(s): State<AppState>,
    headers: axum::http::HeaderMap,
    Json(req): Json<ChatRequest>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let meter = Meter::default();
    let rid = crate::log::request_id();
    let path = "/api/providers/deepseek/chat";

    // 发送预览确认门（安全验收第 8 项）：必须先确认将发送的确切载荷（哈希绑定）。
    let canonical = canonical_request(&req);
    let required = sha256_hex(&canonical);
    let confirmed = headers
        .get("x-preview-confirm")
        .and_then(|v| v.to_str().ok())
        .map(|v| v == required)
        .unwrap_or(false);
    if !confirmed {
        let preview = json!({
            "error": "preview_required",
            "message": "请先确认将发送的模型请求内容",
            "requiredConfirm": required,
            "preview": {
                "model": req.model,
                "messageCount": req.messages.len(),
                "contentPreview": req.messages.first().map(|m| {
                    let c = m.content.chars().take(200).collect::<String>();
                    format!("{}: {}", m.role, c)
                }).unwrap_or_default(),
            }
        });
        meter.done("POST", path, 428, &rid);
        return Err((StatusCode::PRECONDITION_REQUIRED, preview.to_string()));
    }

    let result = match s.provider.chat(&req).await {
        Ok(r) => Ok(Json(json!({
            "model": r.model,
            "content": r.content,
            "provider": r.provider,
            "usage": r.usage,
        }))),
        Err(e) => Err((
            if e.0.starts_with("no api key") { StatusCode::UNAUTHORIZED } else { StatusCode::BAD_GATEWAY },
            e.0,
        )),
    };
    let status = match &result {
        Ok(_) => 200,
        Err((st, _)) => st.as_u16(),
    };
    meter.done("POST", path, status, &rid);
    result
}

/// 将请求映射为确定性的规范字符串（预览确认哈希的绑定对象）。
fn canonical_request(req: &ChatRequest) -> String {
    let mut s = String::new();
    if let Some(m) = &req.model {
        s.push_str("model:");
        s.push_str(m);
        s.push('\n');
    }
    for m in &req.messages {
        s.push_str(&m.role);
        s.push(':');
        s.push_str(&m.content);
        s.push('\n');
    }
    s
}

fn sha256_hex(s: &str) -> String {
    let mut h = Sha256::new();
    h.update(s.as_bytes());
    format!("{:x}", h.finalize())
}
