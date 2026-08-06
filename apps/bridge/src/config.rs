//! Static configuration: bind address, origin allowlist, TTLs.

pub const DEFAULT_PORT: u16 = 7878;

/// Origins allowed to talk to the bridge. Strict allowlist — never `*`.
pub const ALLOWED_ORIGINS: &[&str] = &[
    "https://vibing.paymond.me",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
];

/// One-time pairing code lifetime.
pub const PAIRING_TTL_SECS: u64 = 300;
/// Session token lifetime (short-lived, per threat model).
pub const SESSION_TTL_SECS: u64 = 1800;

pub fn bind_addr() -> String {
    // Loopback only: never binds a non-loopback interface.
    let port = std::env::var("PATENT_BRIDGE_PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(DEFAULT_PORT);
    format!("127.0.0.1:{port}")
}
