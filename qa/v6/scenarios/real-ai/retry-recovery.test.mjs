import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'tsx/esm/api';
register();
const { requiresConsentRecovery } = await import('../../../../apps/web/src/v6/features/generation/Generation.tsx');
const { createGenerationEngine } = await import('../../../../apps/web/src/v6/features/generation/generation.ts');
const { RemoteGenerationProvider } = await import('../../../../apps/web/src/v6/features/generation/remote-provider.ts');
const { DEFAULT_AI_CONFIG, grantConsent, loadAiView } = await import('../../../../apps/web/src/v6/features/ai/ai.ts');
const { userMessageFor } = await import('../../../../apps/web/src/v6/lib/user-messages.ts');
const { ACTOR, MATTER_ID, TARGET_ID, T0, createFixture, waitForJob, CountingProvider, TEST_PROFILE } = await import('../V6-17/harness.mjs');

const LIMITS = { maxInputTokens: 100000, maxOutputTokens: 20000, maxCostMinor: 100000, maxDurationSeconds: 300 };

function engineFor(fixture, provider, consentId) {
  return createGenerationEngine({ repository: fixture.repository, actor: ACTOR, storage: fixture.storage, provider,
    profileId: TEST_PROFILE.id, profileVersion: TEST_PROFILE.version, consentId, config: DEFAULT_AI_CONFIG,
    pipeline: fixture.pipeline, limits: LIMITS, now: () => new Date(T0) });
}
async function grantAgain(fixture, overrides = {}) {
  const view = await loadAiView(fixture.repository, ACTOR, MATTER_ID, { targetId: TARGET_ID, config: DEFAULT_AI_CONFIG, now: () => T0 });
  assert.equal(view.ok, true);
  const granted = await grantConsent(fixture.repository, ACTOR, MATTER_ID, {
    providerProfileId: TEST_PROFILE.id, providerProfileVersion: TEST_PROFILE.version, purpose: 'draft', targetId: TARGET_ID,
    manifestHash: view.data.manifest.payloadManifestHash, scope: view.data.manifest.scope, ...overrides,
  }, { config: DEFAULT_AI_CONFIG, now: () => T0, requestKey: overrides.requestKey ?? crypto.randomUUID() });
  assert.equal(granted.ok, true, granted.ok ? '' : JSON.stringify(granted.error));
  return granted.data.consent;
}
async function failedJob(fixture, expectedCode = 'RATE_LIMITED') {
  const started = await fixture.engine.start(MATTER_ID, TARGET_ID);
  assert.equal(started.ok, true);
  const done = await waitForJob(fixture.engine, started.data.job.id);
  assert.equal(done.job.state, 'failed');
  assert.equal(done.job.errorCode, expectedCode);
  return started.data.job.id;
}

test('G1 signal: only consent codes ask the owner to re-show the outbound scope', () => {
  for (const code of ['CONSENT_REQUIRED', 'CONSENT_REVOKED']) assert.equal(requiresConsentRecovery(code), true, code);
  for (const code of ['RATE_LIMITED', 'PROVIDER_UNAVAILABLE', 'INPUT_STALE', 'JOB_LIMIT_EXCEEDED', 'INVALID_TRANSITION', null, undefined, ''])
    assert.equal(requiresConsentRecovery(code), false, String(code));
});

test('G1 engine outcome: a retry with no server credential fails before any provider call, then succeeds after an explicit re-consent', async () => {
  let chatCalls = 0;
  const noCredential = new RemoteGenerationProvider({
    model: 'fixture-model', profileVersion: TEST_PROFILE.version,
    beforeCall: async () => { throw Object.assign(new Error('请明确确认当前外发清单，以获取本次会话的同意凭证。'), { code: 'CONSENT_REQUIRED' }); },
    fetchImpl: async () => { chatCalls += 1; throw new Error('must not be reached'); },
  });
  const fixture = await createFixture({ provider: noCredential });
  const jobId = await failedJob(fixture, 'CONSENT_REQUIRED');
  assert.equal(chatCalls, 0, 'no outbound call without a credential');
  const failedView = await fixture.engine.get(jobId);
  assert.equal(failedView.data.job.errorCode, 'CONSENT_REQUIRED');
  assert.equal(requiresConsentRecovery(failedView.data.job.errorCode), true, 'panel would ask the owner to reopen consent');

  // Clicking retry while the credential is still missing may create a job, but it must fail at the
  // provider boundary with the same consent code and send nothing.
  const again = await fixture.engine.retry(jobId);
  assert.equal(again.ok, true);
  const againDone = await waitForJob(fixture.engine, again.data.job.id);
  assert.equal(againDone.job.state, 'failed');
  assert.equal(againDone.job.errorCode, 'CONSENT_REQUIRED');
  assert.equal(chatCalls, 0);

  // After the explicit grant the owner re-resolves with a new runtime; retrying the original failed
  // job from that runtime runs a new job and calls the provider.
  const provider = new CountingProvider();
  const engine = engineFor(fixture, provider, fixture.consent.id);
  const retried = await engine.retry(jobId);
  assert.equal(retried.ok, true, retried.ok ? '' : JSON.stringify(retried.error));
  const done = await waitForJob(engine, retried.data.job.id);
  assert.equal(done.job.state, 'succeeded');
  assert.ok(provider.calls.length > 0);
});

test('G2 branch: material changed -> INPUT_STALE with the "start a new task" message', async () => {
  const fixture = await createFixture({ provider: new CountingProvider({ failStages: new Map([['extract_invention_facts', 1]]) }) });
  const jobId = await failedJob(fixture);
  const adoptedRevision = '12121212-aaaa-4aaa-8aaa-aaaaaaaaaaa9';
  await fixture.backend.transaction('readwrite', async tx => {
    const row = await tx.get('matters', MATTER_ID);
    row.targets[0].draftRevisionId = adoptedRevision;
    await tx.put('matters', MATTER_ID, row);
  });
  const consent = await grantAgain(fixture);
  assert.notEqual(consent.id, fixture.consent.id, 'new material scope gets a new consent id');
  const retried = await engineFor(fixture, new CountingProvider(), consent.id).retry(jobId);
  assert.equal(retried.ok, false);
  assert.equal(retried.error.code, 'INPUT_STALE');
  assert.match(retried.error.message, /材料已变化，请开始新任务/);
  assert.equal(/[A-Z]{3,}_[A-Z_]+/.test(userMessageFor('INPUT_STALE')), false, 'Chinese mapping for the UI');
});

test('G2 branch: only the authorization changed -> CONSENT_REQUIRED, not INPUT_STALE', async () => {
  const fixture = await createFixture({ provider: new CountingProvider({ failStages: new Map([['extract_invention_facts', 1]]) }) });
  const jobId = await failedJob(fixture);
  // Same scope and profile, different expiry: findReusableConsent cannot reuse the old row.
  const consent = await grantAgain(fixture, { expiresAt: '2026-11-05T15:00:00.000Z' });
  assert.notEqual(consent.id, fixture.consent.id);
  const retried = await engineFor(fixture, new CountingProvider(), consent.id).retry(jobId);
  assert.equal(retried.ok, false);
  assert.equal(retried.error.code, 'CONSENT_REQUIRED');
  assert.match(retried.error.message, /重新确认/);
});

test('G2 branch: a different processor keeps CONSENT_REQUIRED even when material is unchanged', async () => {
  const fixture = await createFixture({ provider: new CountingProvider({ failStages: new Map([['extract_invention_facts', 1]]) }) });
  const jobId = await failedJob(fixture);
  // A newer processor profile version is a different authorization for the same material.
  const upgraded = { ...TEST_PROFILE, version: TEST_PROFILE.version + 1 };
  const config = { ...DEFAULT_AI_CONFIG, profiles: [upgraded, ...DEFAULT_AI_CONFIG.profiles.filter((profile) => profile.id !== TEST_PROFILE.id)] };
  const engine = createGenerationEngine({ repository: fixture.repository, actor: ACTOR, storage: fixture.storage,
    provider: new CountingProvider(), profileId: upgraded.id, profileVersion: upgraded.version, consentId: fixture.consent.id,
    config, pipeline: fixture.pipeline, limits: LIMITS, now: () => new Date(T0) });
  const retried = await engine.retry(jobId);
  assert.equal(retried.ok, false); assert.equal(retried.error.code, 'CONSENT_REQUIRED');
  assert.match(retried.error.message, /处理方配置已变化/);
});
