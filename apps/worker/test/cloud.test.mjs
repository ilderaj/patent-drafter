// Cloud worker security tests: node --test (type-stripped TS import).
// No network, no real keys: KV is a Map, upstream DeepSeek is a stub.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createWorker } from "../src/index.ts";

function fakeKv() {
  const map = new Map();
  return {
    map,
    async get(k) {
      return map.has(k) ? map.get(k) : null;
    },
    async put(k, v) {
      map.set(k, v);
    },
  };
}

function makeEnv(overrides = {}) {
  return {
    ASSETS: { fetch: async () => new Response("asset", { status: 200 }) },
    RATE_LIMIT: fakeKv(),
    ACCESS_PASSWORD: "test-password-123",
    SESSION_SECRET: "test-session-secret",
    DEEPSEEK_API_KEY: "sk-test-key",
    RATE_LIMIT_PER_DAY: "3",
    ...overrides,
  };
}

function makeDeps(overrides = {}) {
  return {
    fetchImpl: async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: "{\"ok\":true}" } }], usage: { t: 1 } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    now: () => 1_754_500_000_000, // fixed clock
    ...overrides,
  };
}

const CHAT = "http://local/patent/api/providers/deepseek/chat";
const LOGIN = "http://local/patent/api/login";
const STATUS = "http://local/patent/api/status";

function chatRequest(token, extraHeaders = {}) {
  return new Request(CHAT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { "x-session-token": token } : {}),
      ...extraHeaders,
    },
    body: JSON.stringify({
      model: "deepseek-v4-flash",
      messages: [{ role: "user", content: "hi" }],
      response_format: { type: "json_object" },
    }),
  });
}

async function login(worker, password) {
  const r = await worker.fetch(
    new Request(LOGIN, {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.7" },
      body: JSON.stringify({ password }),
    }),
  );
  return r;
}

test("healthz reports cloud mode", async () => {
  const w = createWorker(makeEnv(), makeDeps());
  const r = await w.fetch(new Request("http://local/patent/api/healthz"));
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.mode, "cloud");
});

test("login rejects wrong password with 401", async () => {
  const w = createWorker(makeEnv(), makeDeps());
  const r = await login(w, "wrong");
  assert.equal(r.status, 401);
  const body = await r.json();
  assert.equal(body.error, "unauthorized");
  assert.ok(!("sessionToken" in body));
});

test("login accepts correct password and issues a usable token", async () => {
  const w = createWorker(makeEnv(), makeDeps());
  const r = await login(w, "test-password-123");
  assert.equal(r.status, 200);
  const { sessionToken, expiresInSecs } = await r.json();
  assert.ok(sessionToken.startsWith("v1."));
  assert.equal(expiresInSecs, 12 * 60 * 60);
  const s = await w.fetch(new Request(STATUS, { headers: { "x-session-token": sessionToken } }));
  assert.equal(s.status, 200);
  const status = await s.json();
  assert.equal(status.mode, "cloud");
  assert.equal(status.credentialConfigured, true);
});

test("login is rate-limited per IP after 10 attempts", async () => {
  const w = createWorker(makeEnv(), makeDeps());
  let last;
  for (let i = 0; i < 11; i++) last = await login(w, "wrong");
  assert.equal(last.status, 429);
  // Even the correct password is blocked once the bucket is exhausted.
  const blocked = await login(w, "test-password-123");
  assert.equal(blocked.status, 429);
});

test("status rejects missing/invalid token with 401", async () => {
  const w = createWorker(makeEnv(), makeDeps());
  assert.equal((await w.fetch(new Request(STATUS))).status, 401);
  assert.equal((await w.fetch(new Request(STATUS, { headers: { "x-session-token": "v1.0.deadbeef" } }))).status, 401);
});

test("expired token is rejected", async () => {
  const env = makeEnv();
  const issued = createWorker(env, makeDeps());
  const r = await login(issued, "test-password-123");
  const { sessionToken } = await r.json();
  const later = createWorker(env, makeDeps({ now: () => 1_754_500_000_000 + 13 * 60 * 60 * 1000 }));
  const s = await later.fetch(new Request(STATUS, { headers: { "x-session-token": sessionToken } }));
  assert.equal(s.status, 401);
});

test("chat without session returns 401 and never reaches upstream", async () => {
  let upstreamCalled = false;
  const deps = makeDeps({
    fetchImpl: async () => {
      upstreamCalled = true;
      return new Response("{}", { status: 200 });
    },
  });
  const w = createWorker(makeEnv(), deps);
  const r = await w.fetch(chatRequest(null));
  assert.equal(r.status, 401);
  assert.equal(upstreamCalled, false);
});

test("preview gate: first send gets 428 + requiredConfirm, confirmed send reaches upstream", async () => {
  const env = makeEnv();
  const deps = makeDeps();
  const w = createWorker(env, deps);
  const { sessionToken } = await (await login(w, "test-password-123")).json();

  const first = await w.fetch(chatRequest(sessionToken));
  assert.equal(first.status, 428);
  const gate = await first.json();
  assert.equal(gate.error, "preview_required");
  assert.match(gate.requiredConfirm, /^[0-9a-f]{64}$/);
  assert.equal(gate.preview.messageCount, 1);

  const confirmed = await w.fetch(chatRequest(sessionToken, { "x-preview-confirm": gate.requiredConfirm }));
  assert.equal(confirmed.status, 200);
  const body = await confirmed.json();
  assert.equal(body.provider, "deepseek");
  assert.equal(body.content, "{\"ok\":true}");
});

test("wrong preview hash still gets 428", async () => {
  const env = makeEnv();
  let upstreamCalled = false;
  const deps = makeDeps({
    fetchImpl: async () => {
      upstreamCalled = true;
      return new Response("{}", { status: 200 });
    },
  });
  const w = createWorker(env, deps);
  const { sessionToken } = await (await login(w, "test-password-123")).json();
  const r = await w.fetch(chatRequest(sessionToken, { "x-preview-confirm": "0".repeat(64) }));
  assert.equal(r.status, 428);
  assert.equal(upstreamCalled, false);
});

test("daily chat rate limit returns 429 after the configured cap", async () => {
  const env = makeEnv(); // RATE_LIMIT_PER_DAY = 3
  const w = createWorker(env, makeDeps());
  const { sessionToken } = await (await login(w, "test-password-123")).json();
  let last;
  for (let i = 0; i < 4; i++) last = await w.fetch(chatRequest(sessionToken));
  assert.equal(last.status, 429);
  const body = await last.json();
  assert.equal(body.error, "rate_limited");
});

test("upstream failure surfaces only the status, never the body", async () => {
  const env = makeEnv();
  const deps = makeDeps({
    fetchImpl: async () => new Response("sensitive-upstream-body sk-test-key", { status: 500 }),
  });
  const w = createWorker(env, deps);
  const { sessionToken } = await (await login(w, "test-password-123")).json();
  const first = await w.fetch(chatRequest(sessionToken));
  const gate = await first.json();
  const r = await w.fetch(chatRequest(sessionToken, { "x-preview-confirm": gate.requiredConfirm }));
  assert.equal(r.status, 502);
  const text = await r.text();
  assert.ok(text.includes("deepseek http 500"));
  assert.ok(!text.includes("sensitive-upstream-body"));
  assert.ok(!text.includes("sk-test-key"));
});

test("API key is sent only as an upstream Bearer header", async () => {
  const env = makeEnv();
  let seenAuth = null;
  let seenUrl = null;
  const deps = makeDeps({
    fetchImpl: async (url, init) => {
      seenUrl = url;
      seenAuth = init.headers.authorization;
      return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 });
    },
  });
  const w = createWorker(env, deps);
  const { sessionToken } = await (await login(w, "test-password-123")).json();
  const first = await w.fetch(chatRequest(sessionToken));
  const gate = await first.json();
  await w.fetch(chatRequest(sessionToken, { "x-preview-confirm": gate.requiredConfirm }));
  assert.equal(seenUrl, "https://opencode.ai/zen/go/v1/chat/completions");
  assert.equal(seenAuth, "Bearer sk-test-key");
});

test("non-API paths fall through to static assets", async () => {
  const w = createWorker(makeEnv(), makeDeps());
  const r = await w.fetch(new Request("http://local/patent/projects"));
  assert.equal(r.status, 200);
  assert.equal(await r.text(), "asset");
});
