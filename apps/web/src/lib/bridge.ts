// Browser-side Patent Bridge client: pairing, session, credential status.
// The API key itself never leaves the bridge (macOS Keychain).

// Dev: same-origin vite proxy (/bridge -> 127.0.0.1:7878) so headless QA and
// sandboxed browsers can reach the bridge. Production: direct loopback origin.
const BRIDGE_BASE = import.meta.env.DEV ? "/bridge" : "http://127.0.0.1:7878";
const SESSION_KEY = "patent-drafter.bridge-session.v1";

export interface BridgeStatus {
  bridgeConnected: boolean;
  provider: string;
  credentialConfigured: boolean;
  loopback: boolean;
}

function token(): string | null {
  return localStorage.getItem(SESSION_KEY);
}

export function setSessionToken(t: string | null) {
  if (t === null) localStorage.removeItem(SESSION_KEY);
  else localStorage.setItem(SESSION_KEY, t);
}

export function getSessionToken(): string | null {
  return token();
}

export function bridgeBase(): string {
  return BRIDGE_BASE;
}

async function call(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const t = token();
  if (t) headers.set("x-session-token", t);
  return fetch(`${BRIDGE_BASE}${path}`, { ...init, headers });
}

export async function fetchStatus(): Promise<BridgeStatus> {
  try {
    const r = await call("/api/status");
    if (r.status === 401) {
      // Bridge is reachable but not paired yet (no session token).
      return { bridgeConnected: true, provider: "deepseek", credentialConfigured: false, loopback: true };
    }
    if (!r.ok) return { bridgeConnected: false, provider: "", credentialConfigured: false, loopback: false };
    const body = await r.json();
    return {
      bridgeConnected: body.bridgeConnected === true,
      provider: body.provider ?? "",
      credentialConfigured: body.credentialConfigured === true,
      loopback: body.loopback === true,
    };
  } catch {
    return { bridgeConnected: false, provider: "", credentialConfigured: false, loopback: false };
  }
}

/** Step 1: ask the bridge for a fresh one-time pairing code. */
export async function startPairing(): Promise<{ pairingCode: string; expiresInSecs: number }> {
  const r = await call("/api/pair/start", { method: "POST" });
  if (!r.ok) throw new Error(`pair/start failed (${r.status})`);
  return r.json();
}

/** Step 2: exchange the code for a short-lived session token (stored locally). */
export async function confirmPairing(pairingCode: string): Promise<string> {
  const r = await fetch(`${BRIDGE_BASE}/api/pair/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pairing_code: pairingCode.trim() }),
  });
  if (!r.ok) throw new Error(`pair/confirm failed (${r.status}) — 配对码错误或已过期`);
  const body = await r.json();
  setSessionToken(body.sessionToken);
  return body.sessionToken;
}

export async function revokeSession(): Promise<void> {
  await call("/api/session", { method: "DELETE" });
  setSessionToken(null);
}

export async function storeApiKey(key: string): Promise<void> {
  const r = await call("/api/credentials", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ api_key: key }),
  });
  if (!r.ok) throw new Error(`credentials store failed (${r.status})`);
}

export async function deleteApiKey(): Promise<void> {
  await call("/api/credentials", { method: "DELETE" });
}
