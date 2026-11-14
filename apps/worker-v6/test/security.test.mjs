/**
 * Threat-focused relay tests. Every value is synthetic; no token, access code or upstream body is logged.
 * Complements worker.test.mjs: this file targets tampering, expiry boundaries, size caps and KV failure.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'tsx/esm/api';
register();
const { createWorker, MAX_BODY_BYTES } = await import('../src/index.ts');
const NOW = Date.parse('2026-11-14T09:00:00Z');
const MANIFEST = 'a'.repeat(64);
const SESSION_MS = 2 * 60 * 60 * 1000;
const CONSENT_MS = 30 * 60 * 1000;

function setup({ upstream = null } = {}) {
  const rows = new Map();
  let clock = NOW, calls = 0;
  const env = { ASSETS: { fetch: async () => new Response('asset') }, RATE_LIMIT: { get: async k => rows.get(k) ?? null, put: async (k, v) => { rows.set(k, v); } },
    MODEL_API_KEY: 'synthetic-key', MODEL_BASE_URL: 'https://up.example/v1', MODEL_NAME: 'fixture-model', ACCESS_CODE: 'fixture-access-code-long',
    SESSION_SECRET: 'x'.repeat(48), PROCESSOR_NAME: 'P', PROCESSOR_REGION: 'R', PROCESSOR_RETENTION: 'L', PROCESSOR_TRAINING_POLICY: 'no_training', PROCESSOR_TERMS_VERSION: 'T' };
  const worker = createWorker(env, { now: () => clock, fetchImpl: async (...args) => {
    calls++;
    return upstream ? upstream(...args) : new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }), { headers: { 'content-type': 'application/json' } });
  } });
  const raw = (path, { cookie = '', method = 'GET', body } = {}) => worker.fetch(new Request(`https://app.example${path}`, {
    method, headers: { cookie, origin: 'https://app.example', ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  }));
  const call = async (path, options = {}) => { const r = await raw(path, options); return { status: r.status, cookie: r.headers.get('set-cookie')?.split(';')[0] ?? null, text: await r.text() }; };
  const login = async () => (await call('/api/v6/session', { method: 'POST', body: { accessCode: env.ACCESS_CODE } })).cookie;
  const status = async cookie => JSON.parse((await call('/api/v6/status', { cookie })).text);
  const consent = async cookie => {
    const profileVersion = (await status(cookie)).profileVersion;
    const granted = JSON.parse((await call('/api/v6/consent', { method: 'POST', cookie, body: { profileVersion, manifestHash: MANIFEST } })).text);
    return { ...granted, profileVersion, manifestHash: MANIFEST };
  };
  const chat = (cookie, proof, overrides = {}) => call('/api/v6/chat', { method: 'POST', cookie, body: {
    requestId: 'r1', prompt: 'fixture', stage: 'draft_claims', profileVersion: proof.profileVersion, manifestHash: proof.manifestHash,
    consentCredential: proof.credential, ...overrides } });
  return { env, rows, call, login, status, consent, chat, now: v => { clock = v; }, calls: () => calls, current: () => clock };
}

/** Decode/edit/re-encode the proof payload while keeping the original signature. */
function tamper(credential, edit) {
  const [version, encoded, signature] = credential.split('.');
  const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
  const payload = JSON.parse(Buffer.from(base64, 'base64').toString('utf8'));
  const edited = edit(payload) ?? payload;
  const next = Buffer.from(JSON.stringify(edited), 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${version}.${next}.${signature}`;
}

test('credential: any changed bit in signature or payload is rejected with zero upstream calls', async () => {
  const s = setup();
  const cookie = await s.login();
  const proof = await s.consent(cookie);
  assert.equal((await s.chat(cookie, proof)).status, 200, 'control');
  const before = s.calls();
  const cases = {
    'signature last hex bit': { ...proof, credential: proof.credential.slice(0, -1) + (proof.credential.endsWith('0') ? '1' : '0') },
    'payload manifestHash': { ...proof, credential: tamper(proof.credential, p => { p.manifestHash = 'b'.repeat(64); }) },
    'payload sessionHash': { ...proof, credential: tamper(proof.credential, p => { p.sessionHash = 'c'.repeat(64); }) },
    'payload expiresAt': { ...proof, credential: tamper(proof.credential, p => { p.expiresAt = p.expiresAt + 1; }) },
    'payload stages': { ...proof, credential: tamper(proof.credential, p => { p.stages = ['draft_claims']; }) },
    'payload version': { ...proof, credential: tamper(proof.credential, p => { p.v = 2; }) },
  };
  for (const [name, body] of Object.entries(cases)) {
    const response = await s.chat(cookie, body);
    assert.equal(response.status, 409, name);
    assert.match(response.text, /CONSENT_REQUIRED/, name);
  }
  assert.equal(s.calls(), before, 'no tampered request reached upstream');
});

test('credential: expiry boundary is exclusive at exp and inclusive one millisecond before', async () => {
  const s = setup();
  const cookie = await s.login();
  const proof = await s.consent(cookie);
  const exp = Date.parse(proof.expiresAt);
  assert.equal(exp, s.current() + CONSENT_MS);
  s.now(exp - 1);
  assert.equal((await s.chat(cookie, proof)).status, 200, 'now = exp - 1 is still valid');
  const callsAfterValid = s.calls();
  s.now(exp);
  assert.equal((await s.chat(cookie, proof)).status, 409, 'now = exp is rejected');
  s.now(exp + 1);
  assert.equal((await s.chat(cookie, proof)).status, 409);
  assert.equal(s.calls(), callsAfterValid, 'expired credentials never reach upstream');
});

test('session: tampered or expired cookies are rejected without revealing why', async () => {
  const s = setup();
  const cookie = await s.login();
  const proof = await s.consent(cookie);
  const [name, token] = cookie.split('=');
  const forged = { 'flipped signature': `${name}=${token.slice(0, -1)}${token.endsWith('0') ? '1' : '0'}`,
    'future expiry with old signature': `${name}=${token.replace(/^v1\.(\d+)\./, (_m, e) => `v1.${Number(e) + 60_000}.`)}`,
    'garbage': `${name}=not-a-token` };
  for (const [label, bad] of Object.entries(forged)) {
    const view = await s.status(bad);
    assert.equal(view.authenticated, false, label);
    const response = await s.chat(bad, proof);
    assert.equal(response.status, 401, label);
    for (const leak of ['expired', 'invalid', 'signature', 'token', s.env.ACCESS_CODE, s.env.SESSION_SECRET, token]) {
      assert.equal(response.text.includes(leak), false, `${label} leaked ${leak}`);
    }
  }
  s.now(NOW + SESSION_MS + 1);
  assert.equal((await s.status(cookie)).authenticated, false, 'expired session');
  assert.equal((await s.chat(cookie, proof)).status, 401);
});

test('request and response size caps: oversized request is not forwarded, oversized response is not returned', async () => {
  const requestSide = setup();
  const cookie = await requestSide.login();
  const proof = await requestSide.consent(cookie);
  const tooLarge = await requestSide.chat(cookie, proof, { prompt: 'x'.repeat(MAX_BODY_BYTES) });
  assert.equal(tooLarge.status, 413);
  assert.equal(requestSide.calls(), 0, 'oversized request never reaches upstream');

  const marker = 'UPSTREAM-OVERSIZED-MARKER';
  const responseSide = setup({ upstream: async () => new Response(JSON.stringify({ choices: [{ message: { content: marker + 'y'.repeat(2 * 1024 * 1024 + 1024) } }] }), { headers: { 'content-type': 'application/json' } }) });
  const cookie2 = await responseSide.login();
  const proof2 = await responseSide.consent(cookie2);
  const tooBig = await responseSide.chat(cookie2, proof2);
  assert.equal(tooBig.status, 502);
  assert.equal(tooBig.text.includes(marker), false, 'oversized upstream body is not passed through');
  assert.ok(tooBig.text.length < 1024);
});

test('RATE_LIMIT KV failure fails closed for session and chat without upstream traffic', async () => {
  const s = setup();
  const cookie = await s.login();
  const proof = await s.consent(cookie);
  const callsBefore = s.calls();
  s.env.RATE_LIMIT.get = async () => { throw new Error('synthetic kv outage with private detail'); };
  const session = await s.call('/api/v6/session', { method: 'POST', body: { accessCode: s.env.ACCESS_CODE } });
  assert.equal(session.status, 503);
  const chat = await s.chat(cookie, proof);
  assert.equal(chat.status, 503);
  assert.equal(chat.text.includes('private detail'), false);
  assert.equal(s.calls(), callsBefore, 'no upstream call when the counter store is down');
});
