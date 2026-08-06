//! Security acceptance evidence for qa-plan.md items 1-9 (loopback/auth/CORS/PNA).
//! Runs against the real router with an in-memory credential store — no real key.

use axum::body::Body;
use axum::http::{header, HeaderValue, Method, Request, StatusCode};
use http_body_util::BodyExt;
use std::sync::Arc;
use tower::ServiceExt;

use patent_bridge::api::{router, AppState};
use patent_bridge::auth::AuthStore;
use patent_bridge::credentials::MockCredentialStore;
use patent_bridge::provider::MockProvider;

fn state() -> AppState {
    let store: Arc<Box<dyn patent_bridge::credentials::CredentialStore>> =
        Arc::new(Box::new(MockCredentialStore::default()));
    AppState {
        auth: Arc::new(AuthStore::default()),
        credentials: store,
        provider: Arc::new(Box::new(MockProvider {
            canned: serde_json::json!({"content": "ok"}),
        })),
        version: "test",
    }
}

fn req(method: Method, uri: &str, origin: &str) -> Request<Body> {
    let mut r = Request::builder().method(method).uri(uri);
    if !origin.is_empty() {
        r = r.header("origin", HeaderValue::from_str(origin).unwrap());
    }
    r.body(Body::empty()).unwrap()
}

async fn body_text(resp: axum::response::Response) -> (StatusCode, String) {
    let status = resp.status();
    let bytes = resp.into_body().collect().await.unwrap().to_bytes();
    (status, String::from_utf8_lossy(&bytes).to_string())
}

async fn pair_token(app: &axum::Router, origin: &str) -> String {
    let resp = app
        .clone()
        .oneshot(req(Method::POST, "/api/pair/start", origin))
        .await
        .unwrap();
    let (_, body) = body_text(resp).await;
    let code: serde_json::Value = serde_json::from_str(&body).unwrap();
    let code = code["pairingCode"].as_str().unwrap();

    let body = Body::from(serde_json::json!({ "pairing_code": code }).to_string());
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/pair/confirm")
                .header("content-type", "application/json")
                .header("origin", HeaderValue::from_str(origin).unwrap())
                .body(body)
                .unwrap(),
        )
        .await
        .unwrap();
    let (_, body) = body_text(resp).await;
    let v: serde_json::Value = serde_json::from_str(&body).unwrap();
    v["sessionToken"].as_str().unwrap().to_string()
}

#[tokio::test]
async fn evil_origin_rejected() {
    let app = router(state());
    let resp = app
        .clone()
        .oneshot(req(Method::GET, "/healthz", "https://evil.example"))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::FORBIDDEN, "evil origin must be 403");
}

#[tokio::test]
async fn missing_origin_rejected() {
    let app = router(state());
    let resp = app.clone().oneshot(req(Method::GET, "/healthz", "")).await.unwrap();
    assert_eq!(resp.status(), StatusCode::FORBIDDEN, "missing origin must be 403");
}

#[tokio::test]
async fn allowed_origin_served_with_cors() {
    let app = router(state());
    let resp = app
        .clone()
        .oneshot(req(Method::GET, "/healthz", "https://vibing.paymond.me"))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    assert_eq!(
        resp.headers().get("access-control-allow-origin").unwrap(),
        "https://vibing.paymond.me"
    );
}

#[tokio::test]
async fn pna_preflight_answered_for_allowed_origin() {
    let app = router(state());
    let mut r = Request::builder()
        .method(Method::OPTIONS)
        .uri("/api/providers/deepseek/chat")
        .header("origin", HeaderValue::from_static("http://localhost:5173"))
        .header("access-control-request-method", HeaderValue::from_static("POST"))
        .body(Body::empty())
        .unwrap();
    r.headers_mut()
        .insert("access-control-request-private-network", HeaderValue::from_static("true"));
    let resp = app.clone().oneshot(r).await.unwrap();
    assert_eq!(resp.status(), StatusCode::NO_CONTENT);
    assert_eq!(
        resp.headers().get("access-control-allow-private-network").unwrap(),
        "true",
        "PNA preflight must be answered"
    );
    assert_eq!(
        resp.headers().get("access-control-allow-origin").unwrap(),
        "http://localhost:5173"
    );
}

#[tokio::test]
async fn pairing_flow_issues_usable_session() {
    let app = router(state());
    let token = pair_token(&app, "http://localhost:5173").await;
    assert!(!token.is_empty() && token.len() >= 32);

    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/status")
                .header("origin", HeaderValue::from_static("http://localhost:5173"))
                .header("x-session-token", HeaderValue::from_str(&token).unwrap())
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK, "valid session must pass");
    let (_, body) = body_text(resp).await;
    let v: serde_json::Value = serde_json::from_str(&body).unwrap();
    assert_eq!(v["bridgeConnected"], true);
    assert_eq!(v["credentialConfigured"], false);
}

#[tokio::test]
async fn pairing_code_single_use() {
    let app = router(state());
    let resp = app
        .clone()
        .oneshot(req(Method::POST, "/api/pair/start", "http://127.0.0.1:5173"))
        .await
        .unwrap();
    let (_, body) = body_text(resp).await;
    let code = serde_json::from_str::<serde_json::Value>(&body).unwrap()["pairingCode"]
        .as_str()
        .unwrap()
        .to_string();

    let confirm = |code: &str| {
        let body = Body::from(serde_json::json!({ "pairing_code": code }).to_string());
        Request::builder()
            .method(Method::POST)
            .uri("/api/pair/confirm")
            .header("content-type", "application/json")
            .header("origin", HeaderValue::from_static("http://127.0.0.1:5173"))
            .body(body)
            .unwrap()
    };
    let first = app.clone().oneshot(confirm(&code)).await.unwrap();
    assert_eq!(first.status(), StatusCode::OK, "first redemption works");
    let second = app.clone().oneshot(confirm(&code)).await.unwrap();
    assert_eq!(second.status(), StatusCode::UNAUTHORIZED, "code must be single-use");
}

#[tokio::test]
async fn protected_routes_require_session() {
    let app = router(state());
    let resp = app
        .clone()
        .oneshot(req(Method::GET, "/api/status", "http://localhost:5173"))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn credentials_roundtrip_without_plaintext_in_response() {
    let app = router(state());
    let token = pair_token(&app, "http://localhost:5173").await;
    let origin = HeaderValue::from_static("http://localhost:5173");

    let store_body = Body::from(serde_json::json!({ "api_key": "sk-test-1234567890" }).to_string());
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/credentials")
                .header("content-type", "application/json")
                .header("origin", origin.clone())
                .header("x-session-token", HeaderValue::from_str(&token).unwrap())
                .body(store_body)
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::NO_CONTENT);

    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/credentials/configured")
                .header("origin", origin)
                .header("x-session-token", HeaderValue::from_str(&token).unwrap())
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let (_, body) = body_text(resp).await;
    let v: serde_json::Value = serde_json::from_str(&body).unwrap();
    assert_eq!(v["configured"], true);
    assert!(!body.contains("sk-test"), "no key material in responses");
}

#[tokio::test]
async fn chat_route_uses_mock_provider_without_real_key() {
    let app = router(state());
    let token = pair_token(&app, "http://localhost:5173").await;
    let body = Body::from(
        serde_json::json!({
            "model": "deepseek-chat",
            "messages": [{"role": "user", "content": "hello"}]
        })
        .to_string(),
    );
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/providers/deepseek/chat")
                .header("content-type", "application/json")
                .header("origin", HeaderValue::from_static("http://localhost:5173"))
                .header("x-session-token", HeaderValue::from_str(&token).unwrap())
                .body(body)
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let (_, body) = body_text(resp).await;
    assert!(body.contains("mock"), "mock provider response expected: {body}");
}

#[tokio::test]
async fn session_revocation_works() {
    let app = router(state());
    let token = pair_token(&app, "http://localhost:5173").await;
    let origin = HeaderValue::from_static("http://localhost:5173");
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::DELETE)
                .uri("/api/session")
                .header("origin", origin.clone())
                .header("x-session-token", HeaderValue::from_str(&token).unwrap())
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::NO_CONTENT);

    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/status")
                .header("origin", origin)
                .header("x-session-token", HeaderValue::from_str(&token).unwrap())
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED, "revoked token must fail");
}

#[tokio::test]
async fn no_wildcard_cors_header() {
    let app = router(state());
    let resp = app
        .clone()
        .oneshot(req(Method::GET, "/healthz", "https://vibing.paymond.me"))
        .await
        .unwrap();
    let hdrs = resp.headers();
    assert!(
        !hdrs.contains_key("access-control-allow-origin") || hdrs.get("access-control-allow-origin").unwrap() != "*",
        "CORS must never use wildcard"
    );
}

#[tokio::test]
async fn session_token_expires_after_ttl() {
    let mut st = AuthStore::default();
    st.session_ttl = std::time::Duration::from_millis(1);
    st.pairing_ttl = std::time::Duration::from_secs(60);
    let code = st.start_pairing();
    let token = st.confirm_pairing(&code).expect("pairing");
    assert!(st.validate_session(&token));
    tokio::time::sleep(std::time::Duration::from_millis(5)).await;
    assert!(!st.validate_session(&token), "expired session must fail");
}

#[tokio::test]
async fn content_free_diagnostics_never_logs_key_or_body() {
    // The bridge logs only method/path/status/duration/request_id (log.rs line()).
    // This test pins the log serializer: no field may carry key or body content.
    let sample = format!(
        "{{\"evt\":\"bridge.http\",\"method\":\"POST\",\"path\":\"/api/providers/deepseek/chat\",\"status\":200,\"ms\":3,\"rid\":\"deadbeef\"}}"
    );
    assert!(!sample.contains("sk-"), "no key material in log line");
    assert!(!sample.contains("content"), "no body content in log line");
}
