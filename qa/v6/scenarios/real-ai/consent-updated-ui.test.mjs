import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../../..');
const SOURCE = join(ROOT, 'apps/web/src/v6/features/generation/Generation.tsx');
let outdir;
let ui;

before(async () => {
  outdir = mkdtempSync(join(tmpdir(), 'v6-consent-updated-'));
  const outfile = join(outdir, 'generation.cjs');
  const harness = `
    import { renderToStaticMarkup } from "react-dom/server";
    import { GenerationPanel, GenerationViewPanel, generationView, shouldOfferNewAuthorization } from ${JSON.stringify(SOURCE)};
    export function renderPanel(props) { return renderToStaticMarkup(<GenerationPanel {...props} />); }
    export function renderView(props) { return renderToStaticMarkup(<GenerationViewPanel {...props} />); }
    export function makeView(...args) { return generationView(...args); }
    export function decide(...args) { return shouldOfferNewAuthorization(...args); }
  `;
  await esbuild.build({
    stdin: { contents: harness, resolveDir: ROOT, sourcefile: 'consent-updated-harness.tsx', loader: 'tsx' },
    bundle: true, outfile, format: 'cjs', platform: 'node', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent',
  });
  ui = createRequire(outfile)(outfile);
});

after(() => { if (outdir) rmSync(outdir, { recursive: true, force: true }); });

const OLD_CONSENT = '11111111-1111-4111-8111-111111111111';
const NEW_CONSENT = '22222222-2222-4222-8222-222222222222';
const T0 = '2026-11-14T10:00:00.000Z';
const providerOptions = (consentId) => ({ execution: 'provider', consentId, pipeline: { promptVersion: 'p', rulePackVersion: 'r' } });
const noop = () => undefined;
const ACTIONS = { start: noop, refresh: noop, cancel: noop, retry: noop, resume: noop, discard: noop, adopt: noop, compare: noop };

function makeJob(state = 'failed', consentId = OLD_CONSENT) {
  return {
    job: {
      id: 'job-1', tenantId: 'tenant-1', matterId: 'matter-1', targetId: 'target-1', version: 2, kind: 'generate',
      state, createdBy: 'user-1', input: { matterId: 'matter-1', targetId: 'target-1', sourceVersion: 1, targetConfigVersion: 1, figureRevisionId: 'f' },
      baseDraftRevisionId: null, payloadHash: 'a'.repeat(64), consentId, providerProfileId: 'profile-1', providerProfileVersion: 1,
      promptVersion: 'p', stageVersion: 's', rulePackVersion: 'r', stage: 'facts', attempt: 0, leaseOwner: null, leaseExpiresAt: null,
      progress: { completed: 0, total: 5, unit: 'stage' }, cancelRequestedAt: null, resultId: 'job-1', disposition: 'pending',
      errorCode: state === 'failed' ? 'RATE_LIMITED' : null, usageUnknown: false, createdAt: T0,
    },
    stages: [{ stage: 'facts', state: state === 'failed' ? 'failed' : 'pending', errorCode: state === 'failed' ? 'RATE_LIMITED' : null, output: null, outputMeta: null }],
    progress: { completed: 0, total: 5, unit: 'stage' },
    result: null, support: null, errorMessage: null, retryOfJobId: null,
  };
}
const viewOf = (state, consentId) => ui.makeView(makeJob(state, consentId), 'matter-1', 'target-1');
const renderPanel = (state, consentId, options) => ui.renderPanel({ initialView: viewOf(state, consentId), engineOptions: options });

test('shared decision: only a failed job bound to another authorization offers a new task', () => {
  assert.equal(ui.decide(makeJob('failed', OLD_CONSENT), providerOptions(NEW_CONSENT)), true);
  assert.equal(ui.decide(makeJob('failed', OLD_CONSENT), providerOptions(OLD_CONSENT)), false);
  assert.equal(ui.decide(makeJob('succeeded', OLD_CONSENT), providerOptions(NEW_CONSENT)), false);
  assert.equal(ui.decide(makeJob('failed', null), providerOptions(null)), false, 'no grant -> no executable action');
  assert.equal(ui.decide(makeJob('failed', OLD_CONSENT), { execution: 'stub', consentId: NEW_CONSENT }), false);
  assert.equal(ui.decide(null, providerOptions(NEW_CONSENT)), false);
});

test('UI branch: authorization updated hides retry and offers an explicit start, without exposing ids', () => {
  const html = renderPanel('failed', OLD_CONSENT, providerOptions(NEW_CONSENT));
  assert.match(html, /data-testid="generation-consent-updated"/);
  assert.match(html, /授权已更新，请以新授权开始新任务/);
  assert.match(html, /data-testid="generation-start-new-authorization"/);
  assert.match(html, /以新授权开始任务/);
  assert.equal(html.includes('data-testid="generation-retry"'), false, 'old retry is not offered');
  assert.equal(html.includes('data-testid="generation-start"'), false, 'the plain new-task button is replaced');
  assert.equal(/[0-9a-f]{8}-[0-9a-f]{4}/i.test(html.replace(/data-[a-z-]+="[^"]*"/g, '')), false, 'no ids in visible copy');
});

test('UI branch: same authorization keeps the normal retry (the 429 case)', () => {
  const html = renderPanel('failed', OLD_CONSENT, providerOptions(OLD_CONSENT));
  assert.match(html, /data-testid="generation-retry"/);
  assert.equal(html.includes('data-testid="generation-consent-updated"'), false);
  assert.equal(html.includes('data-testid="generation-start-new-authorization"'), false);
});

test('UI branch: no grant and stub mode never show the new-authorization action', () => {
  for (const options of [providerOptions(null), { execution: 'stub', consentId: NEW_CONSENT }]) {
    const html = renderPanel('failed', OLD_CONSENT, options);
    assert.equal(html.includes('data-testid="generation-start-new-authorization"'), false);
    assert.equal(html.includes('data-testid="generation-consent-updated"'), false);
  }
});

test('UI branch: material change (INPUT_STALE) still shows the error and a new-task entry', () => {
  const html = ui.renderView({
    view: viewOf('failed', OLD_CONSENT), loading: false, loadError: null, busy: false, notice: null,
    actionError: { code: 'INPUT_STALE', message: '材料已变化，请开始新任务。' }, actions: ACTIONS,
  });
  assert.match(html, /data-testid="generation-action-error"/);
  assert.match(html, /data-code="INPUT_STALE"/);
  assert.match(html, /材料已变化，请开始新任务/);
  assert.match(html, /data-testid="generation-start"/);
  assert.equal(html.includes('data-testid="generation-consent-updated"'), false);
});
