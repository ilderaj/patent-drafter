/**
 * Bounded retries for transient upstream failures (5xx / timeout / network).
 * Only safe failures retry; 4xx, consent and schema errors fail immediately.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import { register } from 'tsx/esm/api';
register();
const { ACTOR, MATTER_ID, TARGET_ID, createFixture, waitForJob } = await import('../V6-17/harness.mjs');
// Same module identity the pipeline adapter uses, so `instanceof ProviderError` holds.
const { ProviderError } = await import('@patent/providers');
const { MOCK_STAGE_OUTPUTS } = await import('../../../../packages/pipeline/src/mock.ts');

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../../..');
const SOURCE = join(ROOT, 'apps/web/src/v6/features/generation/Generation.tsx');
let outdir;
let ui;

before(async () => {
  outdir = mkdtempSync(join(tmpdir(), 'v6-stage-retry-'));
  const outfile = join(outdir, 'ui.cjs');
  await esbuild.build({
    stdin: { contents: `
      import { renderToStaticMarkup } from "react-dom/server";
      import { GenerationViewPanel, generationView } from ${JSON.stringify(SOURCE)};
      export function renderView(props) { return renderToStaticMarkup(<GenerationViewPanel {...props} />); }
      export function makeView(job) { return generationView(job, "matter-1", "target-1"); }
    `, resolveDir: ROOT, sourcefile: 'stage-retry-harness.tsx', loader: 'tsx' },
    bundle: true, outfile, format: 'cjs', platform: 'node', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent',
  });
  ui = createRequire(outfile)(outfile);
});
after(() => { if (outdir) rmSync(outdir, { recursive: true, force: true }); });

class FlakyProvider {
  constructor({ failStage = 'draft_claims', failures = 0, code = 'UPSTREAM_ERROR', retryable = true, upstreamStatus = 502 } = {}) {
    Object.assign(this, { failStage, failures, code, retryable, upstreamStatus });
    this.calls = [];
  }
  async getCapabilities() { return { structuredOutput: true, tools: false, visionInput: false, imageGeneration: false, longContext: true, localAuth: false }; }
  async listModels() { return []; }
  async *streamText() {}
  async cancel() {}
  async generateStructured(request) {
    const perStage = this.calls.filter((call) => call.stage === request.stage).length + 1;
    this.calls.push({ stage: request.stage, attempt: perStage - 1 });
    if (request.stage === this.failStage && perStage <= this.failures) {
      const error = new ProviderError('synthetic transient upstream failure', this.code, this.retryable);
      if (this.upstreamStatus !== null) error.upstreamStatus = this.upstreamStatus;
      throw error;
    }
    return structuredClone(MOCK_STAGE_OUTPUTS[request.stage]);
  }
  stageCalls(stage) { return this.calls.filter((call) => call.stage === stage); }
}

// Retries mean more unknown-cost calls; the default one-unknown-call rule would stop them.
const LIMITS = { maxInputTokens: 100000, maxOutputTokens: 20000, maxCostMinor: 100000, maxDurationSeconds: 300, maxUnknownCostCalls: 64 };
const run = async (provider) => {
  const fixture = await createFixture({ provider, engineOptions: { limits: LIMITS } });
  const started = await fixture.engine.start(MATTER_ID, TARGET_ID);
  assert.equal(started.ok, true);
  return { fixture, jobId: started.data.job.id, done: await waitForJob(fixture.engine, started.data.job.id, 20000) };
};

test('two 5xx failures then success: job succeeds with three recorded attempts', async () => {
  const provider = new FlakyProvider({ failStage: 'draft_claims', failures: 2 });
  const { fixture, jobId, done } = await run(provider);
  assert.equal(done.job.state, 'succeeded', JSON.stringify(done));
  assert.equal(done.result?.testOutput, false);
  const stage = done.stages.find((item) => item.stage === 'claims');
  assert.equal(stage?.retries, 2);
  const invocations = await fixture.engine.listInvocations(jobId);
  assert.equal(invocations.ok, true);
  const calls = invocations.data.filter((item) => item.stage === 'draft_claims');
  assert.deepEqual(calls.map((call) => call.attempt), [0, 1, 2]);
  assert.deepEqual(calls.map((call) => call.status), ['failed', 'failed', 'succeeded']);
  assert.deepEqual(calls.map((call) => call.errorCode), ['PROVIDER_UNAVAILABLE', 'PROVIDER_UNAVAILABLE', null]);
});

test('persistent 5xx: three attempts, honest failure, no candidate or draft', async () => {
  const provider = new FlakyProvider({ failStage: 'draft_claims', failures: 99 });
  const { fixture, jobId, done } = await run(provider);
  assert.equal(done.job.state, 'failed');
  assert.equal(done.job.errorCode, 'PROVIDER_UNAVAILABLE');
  assert.equal(done.result, null);
  assert.match(done.errorMessage ?? '', /阶段 claims/);
  assert.match(done.errorMessage ?? '', /上游 HTTP 502/);
  assert.match(done.errorMessage ?? '', /已重试 2 次/);
  assert.equal(done.stages.find((item) => item.stage === 'claims')?.retries, 2);
  assert.equal(provider.stageCalls('draft_claims').length, 3);
  const invocations = await fixture.engine.listInvocations(jobId);
  assert.deepEqual(invocations.data.filter((item) => item.stage === 'draft_claims').map((call) => call.status), ['failed', 'failed', 'failed']);
  const adopted = await fixture.engine.adopt(jobId);
  assert.equal(adopted.ok, false);
});

test('401 and non-retryable 4xx are never retried', async () => {
  for (const [label, code, retryable, expected] of [
    ['auth', 'AUTH_FAILED', false, 'PROVIDER_AUTH'],
    ['4xx', 'UPSTREAM_ERROR', false, 'PROVIDER_REJECTED'],
    ['rate limit', 'RATE_LIMITED', false, 'RATE_LIMITED'],
  ]) {
    const provider = new FlakyProvider({ failStage: 'draft_claims', failures: 99, code, retryable, upstreamStatus: label === 'auth' ? 401 : 400 });
    const { done } = await run(provider);
    assert.equal(done.job.state, 'failed', label);
    assert.equal(done.job.errorCode, expected, label);
    assert.equal(provider.stageCalls('draft_claims').length, 1, label);
    assert.equal(done.stages.find((item) => item.stage === 'claims')?.retries ?? 0, 0, label);
  }
});

test('cancelling during backoff stops further attempts', async () => {
  const provider = new FlakyProvider({ failStage: 'draft_claims', failures: 99 });
  const fixture = await createFixture({ provider, engineOptions: { limits: LIMITS } });
  const started = await fixture.engine.start(MATTER_ID, TARGET_ID);
  assert.equal(started.ok, true);
  // First call fails, then the engine waits 1s before the retry; cancel inside that window.
  for (let i = 0; i < 50 && provider.stageCalls('draft_claims').length === 0; i += 1) await new Promise((r) => setTimeout(r, 50));
  const cancelled = await fixture.engine.cancel(started.data.job.id);
  assert.equal(cancelled.ok, true);
  await new Promise((r) => setTimeout(r, 1500));
  assert.equal(provider.stageCalls('draft_claims').length, 1);
  const view = await fixture.engine.get(started.data.job.id);
  assert.equal(view.data.job.state, 'cancelled');
});

test('UI shows the retry count without hiding it', () => {
  const job = {
    job: { id: 'job-1', tenantId: 't', matterId: 'matter-1', targetId: 'target-1', version: 3, kind: 'generate', state: 'failed',
      createdBy: 'u', input: { matterId: 'matter-1', targetId: 'target-1', sourceVersion: 1, targetConfigVersion: 1, figureRevisionId: 'f' },
      baseDraftRevisionId: null, payloadHash: 'a'.repeat(64), consentId: 'c', providerProfileId: 'p', providerProfileVersion: 1,
      promptVersion: 'p', stageVersion: 's', rulePackVersion: 'r', stage: 'claims', attempt: 0, leaseOwner: null, leaseExpiresAt: null,
      progress: { completed: 2, total: 5, unit: 'stage' }, cancelRequestedAt: null, resultId: 'job-1', disposition: 'pending',
      errorCode: 'PROVIDER_UNAVAILABLE', usageUnknown: true, createdAt: '2026-11-17T00:00:00.000Z' },
    stages: [{ stage: 'claims', state: 'failed', errorCode: 'PROVIDER_UNAVAILABLE', output: null, outputMeta: null, retries: 2 }],
    progress: { completed: 2, total: 5, unit: 'stage' }, result: null, support: null, errorMessage: null, retryOfJobId: null,
  };
  const html = ui.renderView({ view: ui.makeView(job), loading: false, loadError: null, busy: false, notice: null, actionError: null,
    actions: { start() {}, refresh() {}, cancel() {}, retry() {}, resume() {}, discard() {}, adopt() {}, compare() {} } });
  assert.match(html, /data-testid="generation-stage-retry-claims"/);
  assert.match(html, /第 2 次重试/);
});
