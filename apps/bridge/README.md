# Patent Bridge

Loopback-only local runtime for the patent drafting web app. It is the only component that
holds the user's model credentials and patent material: the browser never sees the API key,
and no application server or Cloudflare Worker is involved in LLM calls.

## Security model

- Binds `127.0.0.1` only (never a non-loopback interface; port via `PATENT_BRIDGE_PORT`, default 7878).
- Strict origin allowlist (`https://vibing.paymond.me`, `http://localhost:5173`,
  `http://127.0.0.1:5173`) + Private Network Access (PNA) preflight response. No wildcard CORS.
- One-time pairing code (5 min TTL, stored hashed) issues a 32-byte session token
  (30 min TTL, stored hashed, revocable via `DELETE /api/session`).
- Credentials live in the OS keychain (macOS GenericPassword; `MockCredentialStore` for CI).
- Every model send must be preview-confirmed: `POST /api/providers/deepseek/chat` requires
  `x-preview-confirm` equal to the SHA-256 of the canonical request payload; otherwise it
  returns `428` with a preview and `requiredConfirm` (security acceptance item 8).
- Diagnostics log method/path/status/duration/request-id only — never keys, tokens, or bodies.

## Build & run

```bash
cd apps/bridge
cargo build

# Mock provider (no real key needed) — useful for smoke tests and CI
PATENT_BRIDGE_MOCK=1 cargo run

# Real provider — key is fetched from the keychain at request time
cargo run
```

The web app is currently driven by a mock pipeline; the real bridge client
(session token in `localStorage`, requests to `http://127.0.0.1:7878`) is wired in
the end-to-end integration phase (see `docs/final-acceptance.md` §10).

## API surface

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/healthz` | – | Liveness + version |
| POST | `/api/pair/start` | – | Start pairing; returns one-time code |
| POST | `/api/pair/confirm` | – | Exchange code for session token |
| DELETE | `/api/session` | session | Revoke current session |
| GET | `/api/status` | session | Bridge/provider/credential status |
| POST | `/api/credentials` | session | Store API key in keychain |
| DELETE | `/api/credentials` | session | Delete stored key |
| GET | `/api/credentials/configured` | session | Whether a key exists |
| POST | `/api/providers/deepseek/chat` | session + preview confirm | Proxy one LLM chat turn |

All routes pass the origin guard; authed routes additionally require
`x-session-token`.

## Smoke test (mock mode)

```bash
PATENT_BRIDGE_MOCK=1 PATENT_BRIDGE_PORT=7879 cargo run &

# Evil origin → 403
curl -H "Origin: https://evil.example" http://127.0.0.1:7879/healthz

# Allowed origin → 200 + CORS headers
curl -H "Origin: https://vibing.paymond.me" http://127.0.0.1:7879/healthz

# Pairing → session
CODE=$(curl -s -X POST http://127.0.0.1:7879/api/pair/start | jq -r .pairingCode)
TOKEN=$(curl -s -X POST -H "Content-Type: application/json" \
  -d "{\"pairing_code\":\"$CODE\"}" http://127.0.0.1:7879/api/pair/confirm | jq -r .sessionToken)

# Protected route without session → 401
curl http://127.0.0.1:7879/api/status

# Chat without preview confirmation → 428 + preview payload
curl -s -X POST -H "Content-Type: application/json" -H "x-session-token: $TOKEN" \
  -d '{"messages":[{"role":"user","content":"hi"}]}' \
  http://127.0.0.1:7879/api/providers/deepseek/chat
```

## Tests

```bash
cd apps/bridge && cargo test     # 14 integration tests, zero real keys
```

Covers: evil/missing origin rejection, PNA preflight, pairing single-use, session TTL,
revocation, credential roundtrip without plaintext leakage, preview-confirm gate (missing
and wrong hash), no wildcard CORS, and content-free diagnostics.
