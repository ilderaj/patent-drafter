/**
 * Upstream protocol matrix: request shape, response parsing and endpoint policy.
 * Synthetic values only; upstream fetch is injected and no secret is printed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'tsx/esm/api';
register();
const { createWorker } = await import('../src/index.ts');
const NOW = Date.parse('2026-11-15T09:00:00Z');
const MANIFEST = 'a'.repeat(64);

function setup({ overrides = {}, upstream }) {
  const rows = new Map();
  let sent = null;
  const env = {
    ASSETS: { fetch: async () => new Response('asset') },
    RATE_LIMIT: { get: async k => rows.get(k) ?? null, put: async (k, v) => { rows.set(k, v); } },
    MODEL_API_KEY: 'fixture-key-not-real', MODEL_BASE_URL: 'https://model.example/v1', MODEL_NAME: 'fixture-model',
    ACCESS_CODE: 'fixture-access-code-long', SESSION_SECRET: 'x'.repeat(48),
    PROCESSOR_NAME: 'P', PROCESSOR_REGION: 'R', PROCESSOR_RETENTION: 'L', PROCESSOR_TRAINING_POLICY: 'no_training', PROCESSOR_TERMS_VERSION: 'T',
    ...overrides,
  };
  const worker = createWorker(env, { now: () => NOW, fetchImpl: async (url, init) => { sent = { url, init }; return upstream(url, init); } });
  const call = async (path, { cookie = '', method = 'GET', body } = {}) => {
    const response = await worker.fetch(new Request(`https://app.example${path}`, {
      method, headers: { cookie, origin: 'https://app.example', ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }));
    return { status: response.status, cookie: response.headers.get('set-cookie')?.split(';')[0] ?? null, json: await response.json().catch(() => null) };
  };
  const status = async (cookie = '') => (await call('/api/v6/status', { cookie })).json;
  const login = async () => (await call('/api/v6/session', { method: 'POST', body: { accessCode: env.ACCESS_CODE } })).cookie;
  const consent = async (cookie, profileVersion) => (await call('/api/v6/consent', { method: 'POST', cookie, body: { profileVersion, manifestHash: MANIFEST } })).json;
  const chat = async (cookie, proof, overrides2 = {}) => call('/api/v6/chat', { method: 'POST', cookie, body: {
    requestId: 'r1', prompt: 'SYNTHETIC-PROMPT', stage: 'draft_claims', profileVersion: proof.profileVersion,
    manifestHash: proof.manifestHash, consentCredential: proof.credential, context: [{ text: 'SYNTHETIC-CONTEXT' }], ...overrides2 } });
  const ready = async () => {
    const cookie = await login();
    const profileVersion = (await status(cookie)).profileVersion;
    const proof = await consent(cookie, profileVersion);
    return { cookie, proof: { ...proof, profileVersion, manifestHash: MANIFEST } };
  };
  return { env, call, status, login, consent, chat, ready, sent: () => sent };
}
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

test('openai-chat: /chat/completions with Bearer auth, json_object and message content', async () => {
  const s = setup({ overrides: { MODEL_PROTOCOL: 'openai-chat' }, upstream: async () => json({ choices: [{ message: { content: '{"ok":1}' } }] }) });
  const { cookie, proof } = await s.ready();
  const response = await s.chat(cookie, proof);
  assert.equal(response.status, 200); assert.deepEqual(response.json, { content: '{"ok":1}' });
  const { url, init } = s.sent();
  assert.equal(url, 'https://model.example/v1/chat/completions');
  assert.equal(init.headers.authorization, 'Bearer fixture-key-not-real');
  const body = JSON.parse(init.body);
  assert.equal(body.model, 'fixture-model');
  assert.equal(body.response_format.type, 'json_object');
  assert.match(body.messages[0].content, /SYNTHETIC-PROMPT/);
  assert.match(body.messages[0].content, /SYNTHETIC-CONTEXT/);
});

test('openai-responses: /responses with input and output_text (both response shapes)', async () => {
  for (const [name, payload, expected] of [
    ['top-level output_text', { output_text: '{"ok":2}' }, '{"ok":2}'],
    ['nested output items', { output: [{ type: 'message', content: [{ type: 'output_text', text: '{"ok":' }, { type: 'output_text', text: '3}' }] }] }, '{"ok":\n3}'],
  ]) {
    const s = setup({ overrides: { MODEL_PROTOCOL: 'openai-responses' }, upstream: async () => json(payload) });
    const { cookie, proof } = await s.ready();
    const response = await s.chat(cookie, proof);
    assert.equal(response.status, 200, name);
    assert.equal(response.json.content, expected, name);
    const { url, init } = s.sent();
    assert.equal(url, 'https://model.example/v1/responses');
    const body = JSON.parse(init.body);
    assert.equal(body.input.includes('SYNTHETIC-PROMPT'), true);
    assert.equal(body.text.format.type, 'json_object');
    assert.equal(body.max_output_tokens, 8192);
  }
});

test('anthropic-messages: /v1/messages with x-api-key, anthropic-version and content[] text', async () => {
  for (const base of ['https://api.anthropic.com', 'https://api.anthropic.com/v1']) {
    const s = setup({ overrides: { MODEL_PROTOCOL: 'anthropic-messages', MODEL_BASE_URL: base },
      upstream: async () => json({ content: [{ type: 'text', text: '{"ok":' }, { type: 'text', text: '4}' }] }) });
    const { cookie, proof } = await s.ready();
    const response = await s.chat(cookie, proof, { temperature: 1.7 });
    assert.equal(response.status, 200);
    assert.equal(response.json.content, '{"ok":\n4}');
    const { url, init } = s.sent();
    assert.equal(url, 'https://api.anthropic.com/v1/messages');
    assert.equal(init.headers['x-api-key'], 'fixture-key-not-real');
    assert.equal(init.headers['anthropic-version'], '2023-06-01');
    assert.equal(init.headers.authorization, undefined);
    const body = JSON.parse(init.body);
    assert.equal(body.messages[0].role, 'user');
    assert.equal('temperature' in body, false, 'temperature > 1 is omitted for Anthropic');
  }
});

test('unknown protocol is unavailable, never guessed', async () => {
  const s = setup({ overrides: { MODEL_PROTOCOL: 'gemini-things' }, upstream: async () => json({ choices: [] }) });
  const value = await s.status();
  assert.equal(value.configured, false); assert.equal(value.available, false);
  assert.equal(value.protocol, null);
  assert.match(value.unavailableReason, /协议/);
  assert.equal((await s.call('/api/v6/session', { method: 'POST', body: { accessCode: s.env.ACCESS_CODE } })).status, 503);
  assert.equal((await s.chat('', { credential: 'x', profileVersion: 1, manifestHash: MANIFEST })).status, 503);
  assert.equal(s.sent(), null, 'no upstream request');
});

test('loopback http needs the explicit flag; non-loopback http stays rejected', async () => {
  const allowed = setup({ overrides: { MODEL_BASE_URL: 'http://127.0.0.1:8791', MODEL_ALLOW_LOCAL_HTTP: 'true' },
    upstream: async () => json({ choices: [{ message: { content: '{"ok":5}' } }] }) });
  const value = await allowed.status();
  assert.equal(value.available, true); assert.equal(value.localLoopback, true);
  assert.equal(value.endpoint, 'http://127.0.0.1:8791/chat/completions');
  const { cookie, proof } = await allowed.ready();
  assert.equal((await allowed.chat(cookie, proof)).status, 200);

  for (const [label, overrides] of [
    ['without flag', { MODEL_BASE_URL: 'http://127.0.0.1:8791' }],
    ['flag off', { MODEL_BASE_URL: 'http://localhost:8791', MODEL_ALLOW_LOCAL_HTTP: 'false' }],
    ['remote http', { MODEL_BASE_URL: 'http://model.example/v1', MODEL_ALLOW_LOCAL_HTTP: 'true' }],
    ['https is unaffected', { MODEL_BASE_URL: 'https://model.example/v1', MODEL_ALLOW_LOCAL_HTTP: 'false' }],
  ]) {
    const s = setup({ overrides, upstream: async () => json({ choices: [] }) });
    const status = await s.status();
    if (label === 'https is unaffected') assert.equal(status.available, true, label);
    else { assert.equal(status.available, false, label); assert.equal(status.localLoopback, false, label); }
  }
});

test('loopback is disclosed without pretending vendor retention/training facts', async () => {
  const s = setup({ overrides: { MODEL_BASE_URL: 'http://127.0.0.1:8791', MODEL_ALLOW_LOCAL_HTTP: 'true',
    PROCESSOR_NAME: undefined, PROCESSOR_REGION: undefined, PROCESSOR_RETENTION: undefined, PROCESSOR_TRAINING_POLICY: undefined, PROCESSOR_TERMS_VERSION: undefined },
    upstream: async () => json({ choices: [] }) });
  const value = await s.status();
  assert.equal(value.localLoopback, true);
  assert.equal(value.available, true, 'local verification does not require vendor disclosure');
  assert.equal(value.processor.trainingPolicy, 'unknown');
  assert.equal(value.processor.region, '未知');
});

test('protocol and endpoint are part of profileVersion: changing protocol invalidates old consent', async () => {
  const first = setup({ overrides: { MODEL_PROTOCOL: 'openai-chat' }, upstream: async () => json({ choices: [{ message: { content: '{}' } }] }) });
  const before = await first.status();
  const { cookie, proof } = await first.ready();
  const changed = setup({ overrides: { MODEL_PROTOCOL: 'openai-responses' }, upstream: async () => json({ output_text: '{}' }) });
  const after = await changed.status();
  assert.notEqual(after.profileVersion, before.profileVersion);
  assert.equal(after.protocol, 'openai-responses');
  assert.equal(after.endpoint, 'https://model.example/v1/responses');
  // The old proof was signed for the old profile; the relay refuses it before any upstream call.
  assert.equal((await changed.chat(cookie, proof)).status, 409);
  assert.equal(changed.sent(), null);
});

test('error mapping and credential checks do not regress for non-default protocols', async () => {
  const s = setup({ overrides: { MODEL_PROTOCOL: 'anthropic-messages' }, upstream: async () => new Response('private', { status: 503 }) });
  const { cookie, proof } = await s.ready();
  const failed = await s.chat(cookie, proof);
  assert.equal(failed.status, 502);
  assert.deepEqual(failed.json, { error: { code: 'UPSTREAM_ERROR', upstreamStatus: 503 } });
  assert.equal((await s.chat(cookie, { ...proof, credential: proof.credential + 'x' })).status, 409);
  assert.equal((await s.chat(cookie, proof, { stage: 'not_a_stage' })).status, 400);
});
