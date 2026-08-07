// Browser-side provider client: cloud mode (shared-password Worker) or local
// loopback Bridge. The DeepSeek API key never reaches the browser in either
// mode: cloud keeps it in Worker secrets, local keeps it in the OS keychain.

// Cloud: same-origin API served by the Worker next to the static assets.
// BASE_URL is "/patent/" in both dev and prod; API routes live under
// "/patent/api/..." so the base here is "/patent" and callers append "/api/...".
const CLOUD_API = import.meta.env.BASE_URL.replace(/\/$/, "");
// Local bridge dev: same-origin vite proxy (/bridge -> 127.0.0.1:7878) so
// headless QA and sandboxed browsers can reach the bridge. Production local
// mode: direct loopback origin.
const LOCAL_API = import.meta.env.DEV ? "/bridge" : "http://127.0.0.1:7878";
const SESSION_KEY = "patent-drafter.bridge-session.v1";
const MODE_KEY = "patent-drafter.provider-mode.v1";

export type ProviderMode = "cloud" | "local";

export interface BridgeStatus {
  bridgeConnected: boolean;
  provider: string;
  credentialConfigured: boolean;
  loopback: boolean;
  mode: ProviderMode;
  /** Session token accepted by the backend (false = needs unlock/pairing). */
  authenticated: boolean;
}

function disconnected(mode: ProviderMode): BridgeStatus {
  return { bridgeConnected: false, provider: "", credentialConfigured: false, loopback: false, mode, authenticated: false };
}

export function getProviderMode(): ProviderMode | null {
  const m = localStorage.getItem(MODE_KEY);
  return m === "cloud" || m === "local" ? m : null;
}

/**
 * Probe the same-origin cloud API first; fall back to the local bridge.
 * The result is cached in localStorage so the probe runs once per backend
 * change, not per page load. Call clearProviderModeCache() to re-probe.
 */
export async function detectProviderMode(): Promise<ProviderMode> {
  const cached = getProviderMode();
  if (cached) return cached;
  try {
    const r = await fetch(`${CLOUD_API}/api/healthz`);
    if (r.ok) {
      const body = (await r.json()) as { mode?: string };
      if (body.mode === "cloud") {
        localStorage.setItem(MODE_KEY, "cloud");
        return "cloud";
      }
    }
  } catch {
    /* cloud API absent → local bridge mode */
  }
  localStorage.setItem(MODE_KEY, "local");
  return "local";
}

export function clearProviderModeCache(): void {
  localStorage.removeItem(MODE_KEY);
}

function apiBase(mode: ProviderMode): string {
  return mode === "cloud" ? CLOUD_API : LOCAL_API;
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

/** Base URL for provider calls; requires detectProviderMode() to have run. */
export function bridgeBase(): string {
  return apiBase(getProviderMode() ?? "local");
}

async function call(path: string, init: RequestInit = {}, mode?: ProviderMode): Promise<Response> {
  const m = mode ?? getProviderMode() ?? "local";
  const headers = new Headers(init.headers);
  const t = token();
  if (t) headers.set("x-session-token", t);
  return fetch(`${apiBase(m)}${path}`, { ...init, headers });
}

export async function fetchStatus(): Promise<BridgeStatus> {
  const mode = await detectProviderMode();
  try {
    const r = await call("/api/status", {}, mode);
    if (r.status === 401) {
      // Reachable but the session token is missing/expired: cloud → unlock,
      // local → pair. Cloud credentials live server-side, so they count as
      // configured even before unlock.
      return {
        bridgeConnected: true,
        provider: "deepseek",
        credentialConfigured: mode === "cloud",
        loopback: mode === "local",
        mode,
        authenticated: false,
      };
    }
    if (!r.ok) return disconnected(mode);
    const body = await r.json();
    return {
      bridgeConnected: body.bridgeConnected === true,
      provider: body.provider ?? "",
      credentialConfigured: body.credentialConfigured === true,
      loopback: body.loopback === true,
      mode,
      authenticated: true,
    };
  } catch {
    return disconnected(mode);
  }
}

/** Cloud mode: exchange the shared access password for a session token. */
export async function cloudLogin(password: string): Promise<void> {
  const r = await fetch(`${CLOUD_API}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  if (r.status === 429) throw new Error("尝试次数过多，请一小时后再试");
  if (!r.ok) throw new Error("密码不正确");
  const body = (await r.json()) as { sessionToken: string };
  localStorage.setItem(MODE_KEY, "cloud");
  setSessionToken(body.sessionToken);
}

/** Local bridge step 1: ask the bridge for a fresh one-time pairing code. */
export async function startPairing(): Promise<{ pairingCode: string; expiresInSecs: number }> {
  const r = await call("/api/pair/start", { method: "POST" }, "local");
  if (!r.ok) throw new Error(`pair/start failed (${r.status})`);
  return r.json();
}

/** Local bridge step 2: exchange the code for a short-lived session token. */
export async function confirmPairing(pairingCode: string): Promise<string> {
  const r = await fetch(`${LOCAL_API}/api/pair/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pairing_code: pairingCode.trim() }),
  });
  if (!r.ok) throw new Error(`pair/confirm failed (${r.status}) — 配对码错误或已过期`);
  const body = await r.json();
  localStorage.setItem(MODE_KEY, "local");
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
