/**
 * OpenCode Go upstream header support: User-Agent and deterministic RFC 4122 UUID v4 x-opencode-session.
 * Synthetic values only; upstream fetch is injected and no secret is printed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'tsx/esm/api';
register();
const { createWorker } = await import('../src/index.ts');

const NOW = Date.parse('2026-11-22T04:00:00Z');
const MANIFEST = 'b'.repeat(64);
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function setup(overrides = {}) {
  const rows = new Map();
  const requests = [];
  const env = {
    ASSETS: { fetch: async () => new Response('asset') },
    RATE_LIMIT: { get: async (k) => rows.get(k) ?? null, put: async (k, v) => { rows.set(k, v); } },
    MODEL_API_KEY: 'fixture-key-not-real',
    MODEL_BASE_URL: 'https://model.example/v1',
    MODEL_NAME: 'fixture-model',
    ACCESS_CODE: 'fixture-access-code-long',
    SESSION_SECRET: 'y'.repeat(48),
    PROCESSOR_NAME: 'P',
    PROCESSOR_REGION: 'R',
    PROCESSOR_RETENTION: 'L',
    PROCESSOR_TRAINING_POLICY: 'no_training',
    PROCESSOR_TERMS_VERSION: 'T',
    ...overrides,
  };
  const worker = createWorker(env, {
    now: () => NOW,
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });
  const call = async (path, { cookie = '', method = 'GET', body } = {}) => {
    const response = await worker.fetch(new Request(`https://app.example${path}`, {
      method,
      headers: { cookie, origin: 'https://app.example', ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }));
    return {
      status: response.status,
      cookie: response.headers.get('set-cookie')?.split(';')[0] ?? null,
      json: await response.json().catch(() => null),
    };
  };
  const ready = async () => {
    const cookie = (await call('/api/v6/session', { method: 'POST', body: { accessCode: env.ACCESS_CODE } })).cookie;
    const profileVersion = (await call('/api/v6/status', { cookie })).json.profileVersion;
    const proof = (await call('/api/v6/consent', { method: 'POST', cookie, body: { profileVersion, manifestHash: MANIFEST } })).json;
    return { cookie, proof: { ...proof, profileVersion, manifestHash: MANIFEST } };
  };
  const chat = async (cookie, proof, requestId = 'r1') => call('/api/v6/chat', {
    method: 'POST',
    cookie,
    body: {
      requestId,
      prompt: 'SYNTHETIC-PROMPT',
      stage: 'draft_claims',
      profileVersion: proof.profileVersion,
      manifestHash: proof.manifestHash,
      consentCredential: proof.credential,
      context: [{ text: 'SYNTHETIC-CONTEXT' }],
    },
  });
  return { env, ready, chat, requests };
}

test('upstream requests set default user-agent and honor custom MODEL_USER_AGENT', async () => {
  const defaultSetup = setup();
  const a = await defaultSetup.ready();
  assert.equal((await defaultSetup.chat(a.cookie, a.proof)).status, 200);
  assert.equal(defaultSetup.requests[0].init.headers['user-agent'], 'patent-v6-worker/1.0');

  const customSetup = setup({ MODEL_USER_AGENT: '  patent-v6-custom/2.1  ' });
  const b = await customSetup.ready();
  assert.equal((await customSetup.chat(b.cookie, b.proof)).status, 200);
  assert.equal(customSetup.requests[0].init.headers['user-agent'], 'patent-v6-custom/2.1');
});

test('opencode.ai inference/zen go endpoints automatically carry valid UUID v4 x-opencode-session', async () => {
  for (const baseUrl of ['https://opencode.ai/inference/go/v1', 'https://opencode.ai/zen/go/v1']) {
    const s = setup({ MODEL_BASE_URL: baseUrl });
    const sessionA = await s.ready();
    assert.equal((await s.chat(sessionA.cookie, sessionA.proof, 'r1')).status, 200);
    assert.equal((await s.chat(sessionA.cookie, sessionA.proof, 'r2')).status, 200);

    const header1 = s.requests[0].init.headers['x-opencode-session'];
    const header2 = s.requests[1].init.headers['x-opencode-session'];
    assert.match(header1, UUID_V4, `${baseUrl} should emit RFC 4122 UUID v4`);
    assert.equal(header1, header2, 'same session must produce identical x-opencode-session');

    const rawToken = sessionA.cookie.split('=').slice(1).join('=');
    const tokenNonce = rawToken.split('.')[2];
    assert.equal(header1.includes(rawToken), false);
    assert.equal(header1.includes(tokenNonce), false);
    assert.equal(header1.includes(s.env.SESSION_SECRET), false);

    const sessionB = await s.ready();
    assert.equal((await s.chat(sessionB.cookie, sessionB.proof, 'r3')).status, 200);
    const header3 = s.requests[2].init.headers['x-opencode-session'];
    assert.match(header3, UUID_V4);
    assert.notEqual(header3, header1, 'new login session must produce a distinct x-opencode-session');
  }
});

test('non-OpenCode Go endpoints omit x-opencode-session unless MODEL_SEND_OPENCODE_SESSION is "true"', async () => {
  for (const overrides of [
    { MODEL_BASE_URL: 'https://model.example/v1' },
    { MODEL_BASE_URL: 'https://opencode.ai/other/v1' },
    { MODEL_BASE_URL: 'https://model.example/v1', MODEL_SEND_OPENCODE_SESSION: 'false' },
  ]) {
    const s = setup(overrides);
    const sessionA = await s.ready();
    assert.equal((await s.chat(sessionA.cookie, sessionA.proof)).status, 200);
    assert.equal(s.requests[0].init.headers['x-opencode-session'], undefined);
  }

  const forced = setup({
    MODEL_BASE_URL: 'https://model.example/v1',
    MODEL_SEND_OPENCODE_SESSION: 'true',
  });
  const sessionA = await forced.ready();
  assert.equal((await forced.chat(sessionA.cookie, sessionA.proof)).status, 200);
  assert.match(forced.requests[0].init.headers['x-opencode-session'], UUID_V4);
});
