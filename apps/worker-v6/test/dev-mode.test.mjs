/**
 * Reasoning control and the development-only undisclosed-processor switch.
 * Synthetic values only; the upstream fetch is injected.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'tsx/esm/api';
register();
const { createWorker } = await import('../src/index.ts');
const NOW = Date.parse('2026-11-16T09:00:00Z');
const MANIFEST = 'a'.repeat(64);

function setup({ overrides = {}, upstream } = {}) {
  const rows = new Map();
  let sent = null;
  const env = {
    ASSETS: { fetch: async () => new Response('asset') },
    RATE_LIMIT: { get: async k => rows.get(k) ?? null, put: async (k, v) => { rows.set(k, v); } },
    MODEL_API_KEY: 'fixture-key-not-real', MODEL_BASE_URL: 'https://relay.example/v1', MODEL_NAME: 'fixture-model',
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
    requestId: 'r1', prompt: 'SYNTHETIC', stage: 'draft_claims', profileVersion: proof.profileVersion,
    manifestHash: proof.manifestHash, consentCredential: proof.credential, ...overrides2 } });
  const ready = async () => {
    const cookie = await login();
    const profileVersion = (await status(cookie)).profileVersion;
    const proof = await consent(cookie, profileVersion);
    return { cookie, proof: { ...proof, profileVersion, manifestHash: MANIFEST } };
  };
  return { env, status, login, consent, chat, ready, sent: () => sent };
}
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
const chatOk = () => json({ choices: [{ message: { content: '{"ok":true}' } }] });

test('MODEL_DISABLE_REASONING adds thinking:disabled for openai-chat only', async () => {
  const on = setup({ overrides: { MODEL_DISABLE_REASONING: 'true' }, upstream: chatOk });
  const readyOn = await on.ready();
  await on.chat(readyOn.cookie, readyOn.proof);
  assert.deepEqual(JSON.parse(on.sent().init.body).thinking, { type: 'disabled' });

  const off = setup({ upstream: chatOk });
  const readyOff = await off.ready();
  await off.chat(readyOff.cookie, readyOff.proof);
  assert.equal('thinking' in JSON.parse(off.sent().init.body), false);

  const anthropic = setup({ overrides: { MODEL_DISABLE_REASONING: 'true', MODEL_PROTOCOL: 'anthropic-messages' },
    upstream: () => json({ content: [{ type: 'text', text: '{"ok":true}' }] }) });
  const readyAnthropic = await anthropic.ready();
  await anthropic.chat(readyAnthropic.cookie, readyAnthropic.proof);
  assert.equal('thinking' in JSON.parse(anthropic.sent().init.body), false);
});

test('reasoning-only answers are rejected instead of returning an empty draft', async () => {
  const cases = [
    ['openai-chat', {}, () => json({ choices: [{ message: { content: '', reasoning_content: 'thinking…' } }] })],
    ['openai-responses', { MODEL_PROTOCOL: 'openai-responses' }, () => json({ output: [{ type: 'reasoning', summary: [] }] })],
    ['anthropic-messages', { MODEL_PROTOCOL: 'anthropic-messages' }, () => json({ content: [{ type: 'thinking', thinking: '…' }] })],
  ];
  for (const [label, overrides, upstream] of cases) {
    const s = setup({ overrides, upstream });
    const { cookie, proof } = await s.ready();
    const response = await s.chat(cookie, proof);
    assert.equal(response.status, 502, label);
    assert.equal(response.json.error.code, 'PROVIDER_SCHEMA_INVALID', label);
    assert.equal(response.json.error.reason, 'reasoning_only', label);
  }
  // Content wins over reasoning when both exist.
  const s = setup({ upstream: () => json({ choices: [{ message: { content: '{"ok":true}', reasoning_content: '…' } }] }) });
  const { cookie, proof } = await s.ready();
  assert.equal((await s.chat(cookie, proof)).status, 200);
});

test('undisclosed processor stays fail-closed without the dev switch', async () => {
  const s = setup({ overrides: {
    PROCESSOR_NAME: undefined, PROCESSOR_REGION: undefined, PROCESSOR_RETENTION: undefined,
    PROCESSOR_TRAINING_POLICY: undefined, PROCESSOR_TERMS_VERSION: undefined,
  }, upstream: chatOk });
  const value = await s.status();
  assert.equal(value.available, false);
  assert.equal(value.devUndisclosed, false);
  assert.match(value.unavailableReason, /尚未核实/);
  assert.equal((await s.chat('', { credential: 'x', profileVersion: 1, manifestHash: MANIFEST })).status, 503);
});

test('dev switch allows the call, marks status and leaves consent checks unchanged', async () => {
  const s = setup({ overrides: {
    MODEL_ALLOW_UNDISCLOSED_DEV: 'true',
    PROCESSOR_NAME: undefined, PROCESSOR_REGION: undefined, PROCESSOR_RETENTION: undefined,
    PROCESSOR_TRAINING_POLICY: undefined, PROCESSOR_TERMS_VERSION: undefined,
  }, upstream: chatOk });
  const value = await s.status();
  assert.equal(value.available, true);
  assert.equal(value.devUndisclosed, true);
  assert.equal(value.processor.trainingPolicy, 'unknown');
  assert.equal(value.processor.region, '未知');

  const { cookie, proof } = await s.ready();
  assert.equal((await s.chat(cookie, proof)).status, 200);
  // Consent and manifest checks are untouched by the dev marker.
  assert.equal((await s.chat(cookie, proof, { manifestHash: 'b'.repeat(64) })).status, 409);
  assert.equal((await s.chat(cookie, { ...proof, credential: undefined })).status, 409);
  assert.equal((await s.chat(cookie, proof, { stage: 'not_a_stage' })).status, 400);
});

test('the dev switch is not part of profileVersion', async () => {
  const base = { MODEL_BASE_URL: 'https://relay.example/v1' };
  const on = setup({ overrides: { ...base, MODEL_ALLOW_UNDISCLOSED_DEV: 'true' }, upstream: chatOk });
  const off = setup({ overrides: base, upstream: chatOk });
  assert.equal((await on.status()).profileVersion, (await off.status()).profileVersion);
});
