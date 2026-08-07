/**
 * Patent Drafter cloud worker: shared-password gate + DeepSeek proxy + static assets.
 *
 * Security model (semantics ported from apps/bridge, Rust):
 * - The DeepSeek key lives only in Worker secrets; never logged, never returned.
 * - POST /patent/api/login validates the shared access password (SHA-256
 *   pre-hash + constant-time equality) and issues a stateless HMAC session
 *   token (12 h). Failed logins are rate-limited per IP per hour (KV).
 * - Every model send passes the preview-confirm gate: the first attempt gets
 *   428 + requiredConfirm (SHA-256 of the canonical request); the call only
 *   reaches DeepSeek when the client echoes that exact hash.
 * - Chat calls are rate-limited per day (KV counter, best-effort; the DeepSeek
 *   console hard cap is the financial backstop).
 * - Diagnostics carry method/path/status/ms/rid only — never keys, tokens,
 *   passwords, or request/response bodies.
 * - No patent content is stored anywhere in this worker.
 */

export interface KVNamespaceLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
}

export interface Env {
  ASSETS: { fetch(req: Request): Promise<Response> };
  RATE_LIMIT: KVNamespaceLike;
  ACCESS_PASSWORD: string;
  SESSION_SECRET: string;
  DEEPSEEK_API_KEY: string;
  DEEPSEEK_BASE_URL?: string;
  RATE_LIMIT_PER_DAY?: string;
}

export interface Deps {
  fetchImpl: typeof fetch;
  now: () => number;
}

const API_PREFIX = "/patent/api";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 h
const LOGIN_LIMIT_PER_HOUR = 10;
const MAX_BODY_BYTES = 512 * 1024;
const VERSION = "0.1.0";

interface ChatMessage {
  role: string;
  content: string;
}

interface ChatRequestBody {
  model?: string;
  messages: ChatMessage[];
  response_format?: unknown;
  temperature?: number;
}

function json(body: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...extraHeaders },
  });
}

function requestId(): string {
  return crypto.randomUUID().slice(0, 8);
}

function logLine(rid: string, method: string, path: string, status: number, startMs: number, deps: Deps): void {
  console.log(JSON.stringify({ rid, method, path, status, ms: Math.round(deps.now() - startMs) }));
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Constant-time equality for equal-length hex strings. */
function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function issueToken(env: Env, nowMs: number): Promise<string> {
  const exp = nowMs + SESSION_TTL_MS;
  const sig = await hmacHex(env.SESSION_SECRET, `patent-cloud:v1:${exp}`);
  return `v1.${exp}.${sig}`;
}

async function validToken(env: Env, token: string | null, nowMs: number): Promise<boolean> {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return false;
  const exp = Number(parts[1]);
  if (!Number.isFinite(exp) || exp < nowMs) return false;
  const expected = await hmacHex(env.SESSION_SECRET, `patent-cloud:v1:${exp}`);
  return safeEqualHex(expected, parts[2]);
}

/** Read-and-increment a KV counter; returns the new count. Best-effort under KV eventual consistency. */
async function bumpCounter(kv: KVNamespaceLike, key: string, ttlSecs: number): Promise<number> {
  const current = Number((await kv.get(key)) ?? "0");
  const next = (Number.isFinite(current) ? current : 0) + 1;
  await kv.put(key, String(next), { expirationTtl: ttlSecs });
  return next;
}

/** Deterministic canonical form — must match apps/bridge/src/api.rs canonical_request. */
function canonicalRequest(req: ChatRequestBody): string {
  let s = "";
  if (req.model) s += `model:${req.model}\n`;
  for (const m of req.messages) s += `${m.role}:${m.content}\n`;
  return s;
}

function sessionTokenFrom(req: Request): string | null {
  return req.headers.get("x-session-token");
}

async function handleLogin(req: Request, env: Env, deps: Deps, rid: string): Promise<Response> {
  const start = deps.now();
  const ip = req.headers.get("cf-connecting-ip") ?? "unknown";
  const hourBucket = Math.floor(deps.now() / (60 * 60 * 1000));
  const attempts = await bumpCounter(env.RATE_LIMIT, `login:${ip}:${hourBucket}`, 2 * 60 * 60);
  if (attempts > LOGIN_LIMIT_PER_HOUR) {
    logLine(rid, "POST", `${API_PREFIX}/login`, 429, start, deps);
    return json({ error: "rate_limited", message: "尝试次数过多，请稍后再试" }, 429);
  }
  let password = "";
  try {
    const body = (await req.json()) as { password?: unknown };
    if (typeof body.password === "string") password = body.password;
  } catch {
    /* malformed body → treated as wrong password */
  }
  // Pre-hash both sides so comparison length does not leak the password length.
  const [givenHash, expectedHash] = await Promise.all([sha256Hex(password), sha256Hex(env.ACCESS_PASSWORD)]);
  if (!safeEqualHex(givenHash, expectedHash)) {
    logLine(rid, "POST", `${API_PREFIX}/login`, 401, start, deps);
    return json({ error: "unauthorized", message: "密码不正确" }, 401);
  }
  const token = await issueToken(env, deps.now());
  logLine(rid, "POST", `${API_PREFIX}/login`, 200, start, deps);
  return json({ sessionToken: token, expiresInSecs: SESSION_TTL_MS / 1000 });
}

async function handleStatus(req: Request, env: Env, deps: Deps, rid: string): Promise<Response> {
  const start = deps.now();
  if (!(await validToken(env, sessionTokenFrom(req), deps.now()))) {
    logLine(rid, "GET", `${API_PREFIX}/status`, 401, start, deps);
    return json({ error: "unauthorized" }, 401);
  }
  logLine(rid, "GET", `${API_PREFIX}/status`, 200, start, deps);
  return json({
    bridgeConnected: true,
    provider: "deepseek",
    credentialConfigured: true,
    loopback: false,
    mode: "cloud",
  });
}

async function handleChat(req: Request, env: Env, deps: Deps, rid: string): Promise<Response> {
  const start = deps.now();
  const path = `${API_PREFIX}/providers/deepseek/chat`;
  const done = (status: number) => logLine(rid, "POST", path, status, start, deps);

  if (!(await validToken(env, sessionTokenFrom(req), deps.now()))) {
    done(401);
    return json({ error: "unauthorized", message: "会话无效或已过期，请重新输入访问密码" }, 401);
  }

  const day = new Date(deps.now()).toISOString().slice(0, 10);
  const limit = Number(env.RATE_LIMIT_PER_DAY ?? "60") || 60;
  const used = await bumpCounter(env.RATE_LIMIT, `chat:${day}`, 48 * 60 * 60);
  if (used > limit) {
    done(429);
    return json({ error: "rate_limited", message: `今日调用次数已达上限（${limit} 次），请明天再用` }, 429);
  }

  const length = Number(req.headers.get("content-length") ?? "0");
  if (length > MAX_BODY_BYTES) {
    done(413);
    return json({ error: "too_large", message: "请求体过大" }, 413);
  }

  let body: ChatRequestBody;
  try {
    body = (await req.json()) as ChatRequestBody;
    if (!Array.isArray(body.messages) || body.messages.length === 0) throw new Error("messages required");
  } catch {
    done(400);
    return json({ error: "bad_request", message: "请求格式不正确" }, 400);
  }

  // Preview-confirm gate (security acceptance item 8): the client must echo
  // the SHA-256 of the exact canonical payload before anything is sent.
  const required = await sha256Hex(canonicalRequest(body));
  const confirmed = req.headers.get("x-preview-confirm");
  if (!confirmed || !safeEqualHex(confirmed, required)) {
    const first = body.messages[0];
    done(428);
    return json(
      {
        error: "preview_required",
        message: "请先确认将发送的模型请求内容",
        requiredConfirm: required,
        preview: {
          model: body.model,
          messageCount: body.messages.length,
          contentPreview: first ? `${first.role}: ${[...first.content].slice(0, 200).join("")}` : "",
        },
      },
      428,
    );
  }

  const upstreamBase = env.DEEPSEEK_BASE_URL ?? "https://opencode.ai/zen/go/v1";
  const upstreamBody: Record<string, unknown> = {
    model: body.model ?? "deepseek-v4-flash",
    messages: body.messages.map((m) => ({ role: m.role, content: m.content })),
  };
  if (body.response_format) upstreamBody.response_format = body.response_format;
  if (typeof body.temperature === "number") upstreamBody.temperature = body.temperature;

  let upstream: Response;
  try {
    upstream = await deps.fetchImpl(`${upstreamBase}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${env.DEEPSEEK_API_KEY}` },
      body: JSON.stringify(upstreamBody),
    });
  } catch {
    done(502);
    return json({ error: "upstream_unreachable", message: "deepseek transport error" }, 502);
  }
  if (!upstream.ok) {
    // Content-free: only the upstream status is reported; the body is never
    // forwarded or logged (it may echo sensitive context).
    done(502);
    return json({ error: "upstream_error", message: `deepseek http ${upstream.status}` }, 502);
  }
  let content = "";
  let usage: unknown;
  try {
    const v = (await upstream.json()) as { choices?: Array<{ message?: { content?: string } }>; usage?: unknown };
    content = v.choices?.[0]?.message?.content ?? "";
    usage = v.usage;
  } catch {
    done(502);
    return json({ error: "upstream_error", message: "deepseek returned invalid json" }, 502);
  }
  done(200);
  return json({ model: body.model ?? "deepseek-v4-flash", content, provider: "deepseek", usage });
}

async function handleApi(req: Request, env: Env, deps: Deps): Promise<Response> {
  const rid = requestId();
  const url = new URL(req.url);
  const path = url.pathname;
  if (path === `${API_PREFIX}/healthz` && req.method === "GET") {
    return json({ ok: true, service: "patent-cloud", version: VERSION, mode: "cloud" });
  }
  if (path === `${API_PREFIX}/login` && req.method === "POST") return handleLogin(req, env, deps, rid);
  if (path === `${API_PREFIX}/status` && req.method === "GET") return handleStatus(req, env, deps, rid);
  if (path === `${API_PREFIX}/session` && req.method === "DELETE") {
    // Stateless tokens: revocation is client-side discard. 204 either way.
    return new Response(null, { status: 204 });
  }
  if (path === `${API_PREFIX}/providers/deepseek/chat` && req.method === "POST") {
    return handleChat(req, env, deps, rid);
  }
  return json({ error: "not_found" }, 404);
}

export function createWorker(env: Env, deps: Deps) {
  return {
    async fetch(req: Request): Promise<Response> {
      const url = new URL(req.url);
      if (url.pathname.startsWith(`${API_PREFIX}/`)) {
        try {
          return await handleApi(req, env, deps);
        } catch {
          return json({ error: "internal_error" }, 500);
        }
      }
      return env.ASSETS.fetch(req);
    },
  };
}

export default {
  fetch(req: Request, env: Env): Promise<Response> {
    // `fetch` must be bound: in Workers, calling it as an object property
    // without its original `this` throws "Illegal invocation".
    return createWorker(env, { fetchImpl: fetch.bind(globalThis), now: () => Date.now() }).fetch(req);
  },
};
