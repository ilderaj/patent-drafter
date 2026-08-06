//! LLM provider abstraction (mirrors packages/providers contract).
//! MVP: DeepSeek via bridge (key from credential store); Mock for CI/tests.

use serde::Deserialize;
use serde_json::Value;

use crate::credentials::CredentialStore;
use std::sync::Arc;

#[derive(Debug, Deserialize)]
pub struct ChatRequest {
    pub model: Option<String>,
    pub messages: Vec<ChatMessage>,
    pub response_format: Option<Value>,
    pub temperature: Option<f64>,
}

#[derive(Debug, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Deserialize)]
pub struct ChatResponse {
    pub model: String,
    pub content: String,
    pub provider: String,
    pub usage: Option<Value>,
}

#[derive(Debug)]
pub struct BridgeError(pub String);

impl std::fmt::Display for BridgeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

#[async_trait::async_trait]
pub trait LlmProvider: Send + Sync {
    async fn chat(&self, req: &ChatRequest) -> Result<ChatResponse, BridgeError>;
}

pub struct DeepSeekProvider {
    pub http: reqwest::Client,
    pub credentials: Arc<Box<dyn CredentialStore>>,
    pub base_url: String,
}

#[async_trait::async_trait]
impl LlmProvider for DeepSeekProvider {
    async fn chat(&self, req: &ChatRequest) -> Result<ChatResponse, BridgeError> {
        let key = self
            .credentials
            .load_key()
            .map_err(BridgeError)?
            .ok_or_else(|| BridgeError("no api key configured".into()))?;
        let model = req
            .model
            .clone()
            .or_else(|| std::env::var("PATENT_BRIDGE_MODEL").ok())
            .unwrap_or_else(|| "deepseek-chat".into());
        let mut body = serde_json::json!({
            "model": model,
            "messages": req.messages.iter().map(|m| serde_json::json!({"role": m.role, "content": m.content})).collect::<Vec<_>>(),
        });
        if let Some(rt) = &req.response_format {
            body["response_format"] = rt.clone();
        }
        let resp = self
            .http
            .post(format!("{}/chat/completions", self.base_url))
            .bearer_auth(key)
            .json(&body)
            .send()
            .await
            .map_err(|e| BridgeError(format!("deepseek transport: {e}")))?;
        let status = resp.status();
        let text = resp
            .text()
            .await
            .map_err(|e| BridgeError(format!("deepseek body: {e}")))?;
        if !status.is_success() {
            // Content-free: only status is reported; body never logged.
            return Err(BridgeError(format!("deepseek http {status}")));
        }
        let v: Value = serde_json::from_str(&text)
            .map_err(|e| BridgeError(format!("deepseek json: {e}")))?;
        let content = v
            .pointer("/choices/0/message/content")
            .and_then(|c| c.as_str())
            .unwrap_or("")
            .to_string();
        Ok(ChatResponse {
            model,
            content,
            provider: "deepseek".into(),
            usage: v.get("usage").cloned(),
        })
    }
}

/// Deterministic provider used by tests and CI (no real key needed).
pub struct MockProvider {
    pub canned: Value,
}

#[async_trait::async_trait]
impl LlmProvider for MockProvider {
    async fn chat(&self, _req: &ChatRequest) -> Result<ChatResponse, BridgeError> {
        Ok(ChatResponse {
            model: "mock".into(),
            content: self.canned.to_string(),
            provider: "mock".into(),
            usage: None,
        })
    }
}
