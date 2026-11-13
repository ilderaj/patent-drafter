import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'tsx/esm/api';
register();
const { createGenerationEngine } = await import('../../../../apps/web/src/v6/features/generation/generation.ts');
const { ingestFiles } = await import('../../../../apps/web/src/v6/features/sources/ingest.ts');
const { parseSource } = await import('../../../../apps/web/src/v6/features/sources/parse.ts');
const { DEFAULT_AI_CONFIG, grantConsent, loadAiView } = await import('../../../../apps/web/src/v6/features/ai/ai.ts');
const { ACTOR, MATTER_ID, TARGET_ID, T0, createFixture, waitForJob, CountingProvider, TEST_PROFILE } = await import('../V6-17/harness.mjs');

const LIMITS = { maxInputTokens: 100000, maxOutputTokens: 20000, maxCostMinor: 100000, maxDurationSeconds: 300 };
const engineFor = (fixture, provider, consentId) => createGenerationEngine({ repository: fixture.repository, actor: ACTOR,
  storage: fixture.storage, provider, profileId: TEST_PROFILE.id, profileVersion: TEST_PROFILE.version, consentId,
  config: DEFAULT_AI_CONFIG, pipeline: fixture.pipeline, limits: LIMITS, now: () => new Date(T0) });
async function grantCurrent(fixture, overrides = {}) {
  const view = await loadAiView(fixture.repository, ACTOR, MATTER_ID, { targetId: TARGET_ID, config: DEFAULT_AI_CONFIG, now: () => T0 });
  assert.equal(view.ok, true);
  const granted = await grantConsent(fixture.repository, ACTOR, MATTER_ID, {
    providerProfileId: TEST_PROFILE.id, providerProfileVersion: TEST_PROFILE.version, purpose: 'draft', targetId: TARGET_ID,
    manifestHash: view.data.manifest.payloadManifestHash, scope: view.data.manifest.scope, ...overrides,
  }, { config: DEFAULT_AI_CONFIG, now: () => T0, requestKey: overrides.requestKey ?? crypto.randomUUID() });
  assert.equal(granted.ok, true, granted.ok ? '' : JSON.stringify(granted.error));
  return granted.data.consent;
}
async function failedJob(fixture) {
  const started = await fixture.engine.start(MATTER_ID, TARGET_ID);
  assert.equal(started.ok, true);
  const done = await waitForJob(fixture.engine, started.data.job.id);
  assert.equal(done.job.state, 'failed');
  assert.equal(done.job.errorCode, 'RATE_LIMITED');
  return started.data.job.id;
}
const sourceVersion = async fixture => (await fixture.repository.loadMatter(ACTOR, MATTER_ID)).data.data.matter.sourceVersion;

/** A real UI-equivalent upload + parse: ingestFiles commits the asset, parseSource writes the chunks. */
async function uploadAndParse(fixture, text, name) {
  const file = new Blob([new TextEncoder().encode(text)], { type: 'text/plain' });
  Object.defineProperty(file, 'name', { value: name });
  const outcomes = await ingestFiles(fixture.repository, ACTOR, MATTER_ID, [file], { now: () => new Date(T0) });
  const saved = outcomes.find(o => o.status === 'saved');
  assert.ok(saved, JSON.stringify(outcomes));
  const parsed = await parseSource(fixture.repository, ACTOR, MATTER_ID, saved.assetId, { now: () => new Date(T0).toISOString() });
  assert.equal(parsed.ok, true, JSON.stringify(parsed));
  assert.ok(parsed.chunkCount > 0);
  return saved.assetId;
}

test('G2 content identity: parsed new material with an unchanged sourceVersion makes retry INPUT_STALE and start succeed', async () => {
  const fixture = await createFixture({ provider: new CountingProvider({ failStages: new Map([['extract_invention_facts', 1]]) }) });
  const jobId = await failedJob(fixture);
  const before = await sourceVersion(fixture);
  await uploadAndParse(fixture, '第二份交底材料：在原有水表上增加远程阀控与异常上报。', 'extra-source.txt');
  const after = await sourceVersion(fixture);
  assert.equal(after, before, 'ingest/parse bump the matter version, not the fact snapshot version — this is the gap');

  const consent = await grantCurrent(fixture);
  assert.notEqual(consent.id, fixture.consent.id, 'new material needs a new consent');
  const provider = new CountingProvider();
  const engine = engineFor(fixture, provider, consent.id);
  const retried = await engine.retry(jobId);
  assert.equal(retried.ok, false);
  assert.equal(retried.error.code, 'INPUT_STALE');
  assert.match(retried.error.message, /材料已变化，请开始新任务/);
  assert.equal(provider.calls.length, 0, 'a stale retry never calls the provider');

  const started = await engine.start(MATTER_ID, TARGET_ID);
  assert.equal(started.ok, true, started.ok ? '' : JSON.stringify(started.error));
  const done = await waitForJob(engine, started.data.job.id, 10000);
  assert.equal(done.job.state, 'succeeded', JSON.stringify(done));
  assert.ok(provider.calls.length > 0, 'the new task runs');
});

test('G2 content identity: same content with only a new authorization still retries', async () => {
  const fixture = await createFixture({ provider: new CountingProvider({ failStages: new Map([['extract_invention_facts', 1]]) }) });
  const jobId = await failedJob(fixture);
  // Same scope/profile, different expiry: a new consent row, identical material.
  const consent = await grantCurrent(fixture, { expiresAt: '2026-11-05T15:00:00.000Z' });
  assert.notEqual(consent.id, fixture.consent.id);
  const provider = new CountingProvider();
  const retried = await engineFor(fixture, provider, consent.id).retry(jobId);
  assert.equal(retried.ok, false);
  assert.equal(retried.error.code, 'CONSENT_REQUIRED', 'authorization-only change is not INPUT_STALE');
  assert.match(retried.error.message, /重新确认/);
  assert.equal(provider.calls.length, 0);
});

test('G2 content identity: a legacy job without a fingerprint is not assumed unchanged', async () => {
  const fixture = await createFixture({ provider: new CountingProvider({ failStages: new Map([['extract_invention_facts', 1]]) }) });
  const jobId = await failedJob(fixture);
  await fixture.storage.transaction(async tx => {
    const row = await tx.get(`job/${jobId}`);
    assert.ok(row);
    delete row.inputContentFingerprint;
    await tx.put(`job/${jobId}`, row);
  });
  const consent = await grantCurrent(fixture, { expiresAt: '2026-11-05T15:00:00.000Z' });
  const retried = await engineFor(fixture, new CountingProvider(), consent.id).retry(jobId);
  assert.equal(retried.ok, false);
  assert.equal(retried.error.code, 'INPUT_STALE');
  assert.match(retried.error.message, /无法确认材料未变化/);
});

test('G2 content identity: confirming new facts through saveIntake is also a content change', async () => {
  const fixture = await createFixture({ provider: new CountingProvider({ failStages: new Map([['extract_invention_facts', 1]]) }) });
  const jobId = await failedJob(fixture);
  const { saveIntake } = await import('../../../../apps/web/src/v6/features/intake/intake.ts');
  const before = await sourceVersion(fixture);
  // The synthetic snapshot predates per-question provenance; a real intake save always writes it.
  await fixture.backend.transaction('readwrite', async tx => {
    const key = `intake/snapshot/${MATTER_ID}/${before}`;
    const row = await tx.get('blobs', key);
    row.provenance = {};
    await tx.put('blobs', key, row);
  });
  const saved = await saveIntake(fixture.repository, ACTOR, MATTER_ID, {
    baseSourceVersion: before,
    answers: { problem: '手工抄表成本高。', difference: '三模通讯模块自动上报。', inventorIds: [], disclosure: 'none', maturity: 'drawing', disclosureDetail: null },
    questionSources: { problem: { kind: 'direct' }, difference: { kind: 'direct' }, disclosure: { kind: 'direct' }, maturity: { kind: 'direct' } },
    facts: [], conflicts: [], parties: [], adoptCandidateIds: [],
  }, { now: () => '2026-11-05T12:05:00.000Z', requestKey: crypto.randomUUID() });
  assert.equal(saved.ok, true, JSON.stringify(saved));
  assert.equal(await sourceVersion(fixture), before + 1, 'intake save bumps sourceVersion by contract');
  const consent = await grantCurrent(fixture);
  const retried = await engineFor(fixture, new CountingProvider(), consent.id).retry(jobId);
  assert.equal(retried.ok, false);
  assert.equal(retried.error.code, 'INPUT_STALE');
});