import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'tsx/esm/api';
register();
const { resolveGenerationRuntime } = await import('../../../../apps/web/src/v6/features/generation/runtime.ts');
const { createGenerationEngine } = await import('../../../../apps/web/src/v6/features/generation/generation.ts');
const { recoveryFor } = await import('../../../../apps/web/src/v6/features/generation/Generation.tsx');
const { loadAiView } = await import('../../../../apps/web/src/v6/features/ai/ai.ts');
const { LOCAL_TEST_GENERATION_OPTIONS } = await import('../../../../apps/web/src/v6/features/generation/local-runtime.ts');
const { userMessageFor, providerRecoveryFor } = await import('../../../../apps/web/src/v6/lib/user-messages.ts');
const { targetConfigKey } = await import('../../../../apps/web/src/v6/features/targets/targets.ts');
const { ACTOR, MATTER_ID, TARGET_ID, T0, createFixture, waitForJob } = await import('../V6-17/harness.mjs');
const { MOCK_STAGE_OUTPUTS } = await import('../../../../packages/pipeline/src/mock.ts');

const PROBLEM = '现有水表读数需人工上门抄表，成本高。PRIVATE-PROBLEM-MARKER';
const DIFFERENCE = '增加三模通讯模块，使表体可自动上报读数。PRIVATE-DIFF-MARKER';
const ANSWERS = { problem: PROBLEM, difference: DIFFERENCE, inventorIds: ['44444444-4444-4444-8444-444444444441'],
  disclosure: 'none', maturity: 'idea', disclosureDetail: null };
const STATUS = { available: true, configured: true, authenticated: true, sessionId:'a'.repeat(64), model: 'fixture-real-model', profileVersion: 77,
  processor: { name: 'Fixture Processor', region: 'fixture-region', retention: 'fixture-retention', trainingPolicy: 'no_training', termsVersion: 'fixture-terms-v1' }, unavailableReason: null };
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

/** `chatReply(stage, n)` returns a Response, or throws to simulate a network failure. */
async function fixture(chatReply) {
  const f = await createFixture();
  const writeId = crypto.randomUUID();
  await f.backend.transaction('readwrite', async tx => {
    const key = `intake/snapshot/${MATTER_ID}/1`;
    const row = await tx.get('blobs', key); row.snapshot.answers = ANSWERS; await tx.put('blobs', key, row);
    await tx.put('events', writeId, { id: writeId, tenantId: ACTOR.tenantId, matterId: MATTER_ID, targetId: TARGET_ID, action: 'target.created', metadata: { version: 1 }, occurredAt: T0 });
    await tx.put('blobs', targetConfigKey(ACTOR.tenantId, MATTER_ID, TARGET_ID, 1, writeId), {
      kind: 'target.config', tenantId: ACTOR.tenantId, matterId: MATTER_ID, targetId: TARGET_ID, at: T0,
      config: { targetId: TARGET_ID, version: 1, route: 'cn_um', language: 'zh-CN', purpose: 'preparation', applicantIds: [], inventorIds: [], priorityClaims: [] },
    });
  });
  const state = { chat: 0 };
  const deps = { now: () => new Date(T0), loadPrompts: async () => f.pipeline.prompts, fetchImpl: async (url, init) => {
    if (url === '/api/v6/status') return json(STATUS);
    if (url === '/api/v6/consent') return json({credential:'fixture-proof',expiresAt:new Date(Date.parse(T0)+30*60*1000).toISOString(),allowedStages:['draft_claims']});
    state.chat++;
    const body = JSON.parse(init.body);
    return chatReply ? chatReply(body.stage, state.chat) : json({ content: JSON.stringify(MOCK_STAGE_OUTPUTS[body.stage]) });
  } };
  const runtime = await (await resolveGenerationRuntime(f.repository, ACTOR, MATTER_ID, TARGET_ID, deps)).consent.grant();
  assert.equal(runtime.mode, 'real');
  const engine = createGenerationEngine({ ...runtime.engineOptions, repository: f.repository, actor: ACTOR, now: deps.now });
  const run = async () => { const s = await engine.start(MATTER_ID, TARGET_ID); assert.equal(s.ok, true); return waitForJob(engine, s.data.job.id, 10000); };
  const rows = async () => {
    const view = await loadAiView(f.repository, ACTOR, MATTER_ID, { targetId: TARGET_ID, config: runtime.engineOptions.config, now: deps.now });
    assert.equal(view.ok, true); return view.data.invocations;
  };
  return { ...f, state, run, rows, engine };
}

test('real generation: one record per chat call, content-free, usage honestly unknown', async () => {
  const f = await fixture();
  const done = await f.run();
  assert.equal(done.job.state, 'succeeded');
  const rows = await f.rows();
  assert.ok(f.state.chat > 1);
  assert.equal(rows.length, f.state.chat, 'AI page records == chat calls');
  for (const row of rows) {
    assert.equal(row.execution, 'provider'); assert.equal(row.executionLocation, 'fixture-region');
    assert.equal(row.status, 'succeeded'); assert.equal(row.errorCode, null);
    assert.equal(row.modelId, 'fixture-real-model'); assert.ok(row.at);
    assert.equal(row.costMinor, null); assert.equal(row.usageUnknown, true);
  }
  assert.equal(new Set(rows.map(r => r.id)).size, rows.length);
  const serialized = JSON.stringify(rows);
  for (const secret of ['PRIVATE-PROBLEM-MARKER', 'PRIVATE-DIFF-MARKER', '三模通讯模块', '"prompt"', '"content"', '"context"', 'apiKey']) {
    assert.equal(serialized.includes(secret), false, `${secret} must not be in the call records`);
  }
  const allowed = ['at', 'attempt', 'consentId', 'costMinor', 'currency', 'errorCode', 'execution', 'executionLocation', 'id', 'inputTokens',
    'jobId', 'modelId', 'outputTokens', 'providerProfileId', 'requestHash', 'stage', 'status', 'usageUnknown'];
  assert.deepEqual(Object.keys(rows[0]).sort(), allowed);
});

test('a failed upstream call is recorded with its failure code, and the record count still equals chat calls', async () => {
  const f = await fixture((stage, n) => n === 2
    ? json({ error: { code: 'UPSTREAM_ERROR', upstreamStatus: 503 } }, 502)
    : json({ content: JSON.stringify(MOCK_STAGE_OUTPUTS[stage]) }));
  const done = await f.run();
  assert.equal(done.job.state, 'failed'); assert.equal(done.job.errorCode, 'PROVIDER_UNAVAILABLE');
  const rows = await f.rows();
  assert.equal(rows.length, f.state.chat);
  const failed = rows.filter(r => r.status === 'failed');
  assert.equal(failed.length, 1); assert.equal(failed[0].errorCode, 'PROVIDER_UNAVAILABLE');
  assert.ok(rows.filter(r => r.status === 'succeeded').every(r => r.errorCode === null));
  assert.ok(!JSON.stringify(rows).includes('503'), 'no upstream detail beyond the code');
});

test('test-mode (stub) calls are distinguishable from real calls on the same AI page', async () => {
  const f = await fixture();
  const stub = createGenerationEngine({ ...LOCAL_TEST_GENERATION_OPTIONS, repository: f.repository, actor: ACTOR, now: () => new Date(T0) });
  const started = await stub.start(MATTER_ID, TARGET_ID); assert.equal(started.ok, true);
  assert.equal((await waitForJob(stub, started.data.job.id)).job.state, 'succeeded');
  await f.run();
  const view = await loadAiView(f.repository, ACTOR, MATTER_ID, { targetId: TARGET_ID, now: () => T0 });
  const rows = view.data.invocations;
  const stubRows = rows.filter(r => r.execution === 'stub'), realRows = rows.filter(r => r.execution === 'provider');
  assert.ok(stubRows.length > 0 && realRows.length > 0);
  assert.ok(stubRows.every(r => r.executionLocation === 'device:stub' && r.consentId === null));
  assert.ok(realRows.every(r => r.consentId !== null));
});

test('another actor and another matter do not see these records', async () => {
  const f = await fixture(); await f.run();
  const other = await loadAiView(f.repository, { tenantId: ACTOR.tenantId, userId: '99999999-9999-4999-8999-999999999999' }, MATTER_ID, { now: () => T0 });
  assert.equal(other.ok, false);
});

const CASES = [
  ['upstream 400 (request content or parameters)', () => json({ error: { code: 'UPSTREAM_ERROR', upstreamStatus: 400 } }, 502), 'PROVIDER_REQUEST_INVALID'],
  ['upstream 503', () => json({ error: { code: 'UPSTREAM_ERROR', upstreamStatus: 503 } }, 502), 'PROVIDER_UNAVAILABLE'],
  ['upstream 500', () => json({ error: { code: 'UPSTREAM_ERROR', upstreamStatus: 500 } }, 502), 'PROVIDER_UNAVAILABLE'],
  ['relay cannot reach upstream', () => json({ error: { code: 'UPSTREAM_ERROR' } }, 502), 'PROVIDER_UNAVAILABLE'],
  ['relay 503 (not configured)', () => json({ error: { code: 'PROVIDER_UNAVAILABLE' } }, 503), 'PROVIDER_UNAVAILABLE'],
  ['network failure', () => { throw new TypeError('Failed to fetch'); }, 'PROVIDER_UNAVAILABLE'],
  ['relay timeout 504', () => json({ error: { code: 'PROVIDER_TIMEOUT' } }, 504), 'PROVIDER_TIMEOUT'],
  ['upstream 504', () => json({ error: { code: 'UPSTREAM_ERROR', upstreamStatus: 504 } }, 502), 'PROVIDER_TIMEOUT'],
  ['relay 429', () => json({ error: { code: 'RATE_LIMITED' } }, 429), 'RATE_LIMITED'],
  ['upstream 429', () => json({ error: { code: 'UPSTREAM_ERROR', upstreamStatus: 429 } }, 429), 'RATE_LIMITED'],
  ['upstream 401', () => json({ error: { code: 'UPSTREAM_ERROR', upstreamStatus: 401 } }, 502), 'PROVIDER_AUTH'],
  ['upstream 403', () => json({ error: { code: 'UPSTREAM_ERROR', upstreamStatus: 403 } }, 502), 'PROVIDER_AUTH'],
  ['session expired', () => json({ error: { code: 'AUTH_REQUIRED' } }, 401), 'PROVIDER_AUTH'],
  ['upstream redirect 302', () => json({ error: { code: 'UPSTREAM_ERROR', upstreamStatus: 302 } }, 502), 'PROVIDER_REJECTED'],
  ['upstream 404 (wrong endpoint/model)', () => json({ error: { code: 'UPSTREAM_ERROR', upstreamStatus: 404 } }, 502), 'PROVIDER_REJECTED'],
  ['relay says output invalid', () => json({ error: { code: 'PROVIDER_SCHEMA_INVALID' } }, 502), 'PROVIDER_SCHEMA_INVALID'],
  ['content is not JSON', () => json({ content: 'not json' }), 'PROVIDER_SCHEMA_INVALID'],
  ['JSON of the wrong shape', () => json({ content: '{"unexpected":true}' }), 'PROVIDER_SCHEMA_INVALID'],
];

for (const [name, reply, expected] of CASES) {
  test(`error mapping: ${name} -> ${expected}`, async () => {
    const f = await fixture(reply);
    const done = await f.run();
    assert.equal(done.job.state, 'failed');
    assert.equal(done.job.errorCode, expected);
    const rows = await f.rows();
    assert.equal(rows.at(-1).errorCode, expected, 'the failed call carries the same code');
    const text = recoveryFor(expected);
    assert.match(text, /[一-鿿]/); assert.equal(/[A-Z]{3,}_[A-Z_]+/.test(text), false, 'no English code in the user copy');
    assert.equal(/[A-Z]{3,}_[A-Z_]+/.test(userMessageFor(expected)), false);
  });
}

test('the four failure kinds have different Chinese copy with a next step', () => {
  const kinds = ['PROVIDER_UNAVAILABLE', 'RATE_LIMITED', 'PROVIDER_REJECTED', 'PROVIDER_SCHEMA_INVALID'];
  const texts = kinds.map(k => providerRecoveryFor(k));
  assert.ok(texts.every(Boolean)); assert.equal(new Set(texts).size, kinds.length);
  assert.notEqual(recoveryFor('PROVIDER_UNAVAILABLE'), '发生错误；请按错误码检查配置后重试。');
  assert.match(texts[0], /稍后重试/); assert.match(texts[1], /等几分钟/); assert.match(texts[2], /联系部署者/); assert.match(texts[3], /无法按约定结构解析/);
  assert.equal(new Set(['PROVIDER_UNAVAILABLE', 'RATE_LIMITED', 'PROVIDER_REJECTED', 'PROVIDER_SCHEMA_INVALID'].map(userMessageFor)).size, 4);
});
