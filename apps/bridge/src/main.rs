use std::sync::Arc;

use patent_bridge::api::{router, AppState};
use patent_bridge::auth::AuthStore;
use patent_bridge::credentials::default_store;
use patent_bridge::provider::{DeepSeekProvider, LlmProvider, MockProvider};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let store: Arc<Box<dyn patent_bridge::credentials::CredentialStore>> = Arc::new(default_store());

    // Provider selection: PATENT_BRIDGE_MOCK=1 → MockProvider (CI/tests); otherwise DeepSeek.
    let provider: Box<dyn LlmProvider> = if std::env::var("PATENT_BRIDGE_MOCK").is_ok() {
        Box::new(MockProvider { canned: serde_json::json!({"role":"assistant","content":"[mock]"}) })
    } else {
        Box::new(DeepSeekProvider {
            http: reqwest::Client::new(),
            credentials: store.clone(),
            base_url: "https://api.deepseek.com".into(),
        })
    };

    let state = AppState {
        auth: Arc::new(AuthStore::default()),
        credentials: store,
        provider: Arc::new(provider),
        version: env!("CARGO_PKG_VERSION"),
    };

    let addr = patent_bridge::config::bind_addr();
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    eprintln!("patent-bridge listening on {addr} (loopback only)");
    axum::serve(listener, router(state)).await?;
    Ok(())
}
