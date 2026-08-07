// Real DeepSeek end-to-end smoke through the Patent Bridge (security acceptance items 2/3/8/9).
//
// Prereqs:
//   - Bridge running in real mode (NOT PATENT_BRIDGE_MOCK):
//       cd apps/bridge && PATENT_BRIDGE_PORT=7879 ./target/debug/patent-bridge
//   - DEEPSEEK_TEST_KEY env var with a test API key (never hardcode a key here).
//
// Flow: pair -> session -> store key (keychain) -> status -> chat 428 (preview gate)
//       -> chat 200 with x-preview-confirm -> real DeepSeek content.
// The key is never printed, never logged, and never written to a repo file.
import { spawnSync } from "node:child_process";

const PORT = process.env.PATENT_BRIDGE_PORT ?? "7879";
const BASE = `http://127.0.0.1:${PORT}`;
const KEY = process.env.DEEPSEEK_TEST_KEY;
if (!KEY) {
  console.error("FATAL: DEEPSEEK_TEST_KEY not set");
  process.exit(1);
}

function call(method, path, { headers = {}, body } = {}) {
  const args = ["-s", "-o", "-", "-w", "\n%{http_code}", "-X", method, "-H", "Origin: https://vibing.paymond.me"];
  for (const [k, v] of Object.entries(headers)) args.push("-H", `${k}: ${v}`);
  if (body !== undefined) args.push("-d", JSON.stringify(body));
  args.push(`${BASE}${path}`);
  const r = spawnSync("curl", args, { encoding: "utf8" });
  const parts = r.stdout.trim().split("\n");
  const code = Number(parts.pop());
  const payload = parts.join("\n");
  return { code: Number(code), payload };
}

const checks = [];
const check = (name, ok, detail) => { checks.push({ name, ok, detail }); };

const pair = call("POST", "/api/pair/start", { headers: { Origin: "https://vibing.paymond.me" } });
let pairingCode = "";
if (pair.code === 200) {
  pairingCode = JSON.parse(pair.payload).pairingCode;
}
check("pair/start returns 6-digit code", pair.code === 200 && /^\d{6}$/.test(pairingCode), `code=${pair.code}`);

const confirm = call("POST", "/api/pair/confirm", { headers: { "Content-Type": "application/json" }, body: { pairing_code: pairingCode } });
let token = "";
if (confirm.code === 200) {
  token = JSON.parse(confirm.payload).sessionToken;
}
check("pair/confirm issues 64-hex session token", confirm.code === 200 && /^[0-9a-f]{64}$/.test(token), `code=${confirm.code}`);

const store = call("POST", "/api/credentials", { headers: { "Content-Type": "application/json", "x-session-token": token }, body: { api_key: KEY } });
check("credentials store accepted (keychain)", store.code === 204, `code=${store.code}`);

const status = call("GET", "/api/status", { headers: { "x-session-token": token } });
check("status shows credentialConfigured", status.code === 200 && JSON.parse(status.payload).credentialConfigured === true, `code=${status.code}`);

const CHAT_BODY = { messages: [{ role: "user", content: "回复OK两个字母即可" }] };
const gate = call("POST", "/api/providers/deepseek/chat", { headers: { "Content-Type": "application/json", "x-session-token": token }, body: CHAT_BODY });
let requiredConfirm = "";
if (gate.code === 428) {
  requiredConfirm = JSON.parse(gate.payload).requiredConfirm;
}
check("preview gate blocks unconfirmed send (428)", gate.code === 428 && /^[0-9a-f]{64}$/.test(requiredConfirm), `code=${gate.code}`);

const chat = call("POST", "/api/providers/deepseek/chat", { headers: { "Content-Type": "application/json", "x-session-token": token, "x-preview-confirm": requiredConfirm }, body: CHAT_BODY });
let content = "";
if (chat.code === 200) {
  const parsed = JSON.parse(chat.payload);
  content = parsed.content ?? "";
  check("real DeepSeek response non-empty", chat.code === 200 && content.length > 0, `model=${parsed.model} usage=${JSON.stringify(parsed.usage)}`);
} else {
  check("real DeepSeek response non-empty", false, `code=${chat.code}`);
}

const revoke = call("DELETE", "/api/session", { headers: { "x-session-token": token } });
check("session revoked", revoke.code === 204, `code=${revoke.code}`);

let failed = 0;
for (const c of checks) {
  console.log(`${c.ok ? "[PASS]" : "[FAIL]"} ${c.name}${c.ok ? "" : ` — ${c.detail}`}`);
  if (!c.ok) failed++;
}
console.log(`结果: ${checks.length - failed} 通过 / ${failed} 失败`);
process.exit(failed === 0 ? 0 : 1);
