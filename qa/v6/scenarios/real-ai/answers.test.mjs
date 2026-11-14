import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'tsx/esm/api';
register();
const { sourceRefSchema } = await import('../../../../packages/contracts/src/matter.ts');
const { buildAnswerSources, answerSourceLabel } = await import('../../../../apps/web/src/v6/features/intake/answer-sources.ts');
const { resolveGenerationRuntime } = await import('../../../../apps/web/src/v6/features/generation/runtime.ts');
const { createGenerationEngine } = await import('../../../../apps/web/src/v6/features/generation/generation.ts');
const { loadAiView, validateConsentForUse } = await import('../../../../apps/web/src/v6/features/ai/ai.ts');
const { targetConfigKey } = await import('../../../../apps/web/src/v6/features/targets/targets.ts');
const { DraftReviewSession } = await import('../../../../apps/web/src/v6/features/draft/Review.tsx');
const { renderReview } = await import('./render-review.tsx');
const { ACTOR, MATTER_ID, TARGET_ID, T0, createFixture, waitForJob } = await import('../V6-17/harness.mjs');
const { MOCK_STAGE_OUTPUTS } = await import('../../../../packages/pipeline/src/mock.ts');

const INVENTOR = '44444444-4444-4444-8444-444444444441';
const PROBLEM = '现有水表读数需人工上门抄表，成本高。';
const DIFFERENCE = '增加三模通讯模块，使表体可自动上报读数。';
const STATUS = { available: true, configured: true, authenticated: true, sessionId:'a'.repeat(64), model: 'fixture-real-model', profileVersion: 321,
  processor: { name: 'Fixture Processor', region: 'fixture-region', retention: 'fixture-retention', trainingPolicy: 'no_training', termsVersion: 'fixture-terms-v1' }, unavailableReason: null };
const FULL = { problem: PROBLEM, difference: DIFFERENCE, inventorIds: [INVENTOR], disclosure: 'none', maturity: 'idea', disclosureDetail: null };
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

async function setAnswers(f, answers) {
  await f.backend.transaction('readwrite', async tx => {
    const key = `intake/snapshot/${MATTER_ID}/1`;
    const row = await tx.get('blobs', key);
    row.snapshot.answers = answers;
    await tx.put('blobs', key, row);
  });
}
async function fixture(answers = FULL) {
  const f = await createFixture();
  const writeId = crypto.randomUUID();
  await f.backend.transaction('readwrite', async tx => {
    await tx.put('events', writeId, { id: writeId, tenantId: ACTOR.tenantId, matterId: MATTER_ID, targetId: TARGET_ID, action: 'target.created', metadata: { version: 1 }, occurredAt: T0 });
    await tx.put('blobs', targetConfigKey(ACTOR.tenantId, MATTER_ID, TARGET_ID, 1, writeId), {
      kind: 'target.config', tenantId: ACTOR.tenantId, matterId: MATTER_ID, targetId: TARGET_ID, at: T0,
      config: { targetId: TARGET_ID, version: 1, route: 'cn_um', language: 'zh-CN', purpose: 'preparation', applicantIds: [], inventorIds: [], priorityClaims: [] },
    });
  });
  await setAnswers(f, answers);
  const bodies = [];
  const state = { chatCalls: 0 };
  const deps = { now: () => new Date(T0), loadPrompts: async () => f.pipeline.prompts, fetchImpl: async (url, init) => {
    if (url === '/api/v6/status') return json(STATUS);
    if (url === '/api/v6/consent') return json({credential:'fixture-proof',expiresAt:new Date(Date.parse(T0)+30*60*1000).toISOString(),allowedStages:['draft_claims']});
    state.chatCalls++;
    const body = JSON.parse(init.body); bodies.push(body);
    let output = structuredClone(MOCK_STAGE_OUTPUTS[body.stage]);
    if (body.stage === 'extract_invention_facts') {
      const chunkId = /"id": "([0-9a-f-]{36})"/.exec(body.prompt)?.[1];
      output = { facts: [{ category: 'subject', statement: '通过三模通讯模块自动上报读数', status: 'source_backed', refs: chunkId ? [{ chunkId }] : [] }] };
    }
    if (body.stage === 'draft_claims') {
      output = { claims: [{ number: 1, independent: true, parentRefs: [], text: '1、一种水表，包括三模通讯模块。', features: [{ text: '三模通讯模块', factId: 'f1', status: 'source_backed' }] }] };
    }
    return json({ content: JSON.stringify(output) });
  } };
  return { ...f, deps, bodies, state };
}

test('contract: document refs stay valid and user_answer refs need questionNo and no page', () => {
  const base = { sourceId: 'a'.repeat(8) + '-aaaa-4aaa-8aaa-aaaaaaaaaaaa', chunkId: 'b'.repeat(8) + '-bbbb-4bbb-8bbb-bbbbbbbbbbbb', chunkHash: 'c'.repeat(64), page: 1, start: 0, end: 3, quote: 'abc' };
  assert.equal(sourceRefSchema.safeParse(base).success, true, 'older rows without the new fields still parse');
  const answer = { ...base, page: null, origin: 'user_answer', questionNo: 1 };
  assert.equal(sourceRefSchema.safeParse(answer).success, true);
  assert.equal(sourceRefSchema.safeParse({ ...answer, page: 1 }).success, false);
  assert.equal(sourceRefSchema.safeParse({ ...answer, questionNo: undefined }).success, false);
  assert.equal(sourceRefSchema.safeParse({ ...base, questionNo: 2 }).success, false);
  assert.equal(sourceRefSchema.safeParse({ ...answer, questionNo: 6 }).success, false);
});

test('answer sources: only the two technical answers are sent; ids follow the text', async () => {
  const input = { answers: FULL, confirmedBy: ACTOR.userId, confirmedAt: T0 };
  const a = await buildAnswerSources(input);
  assert.equal(a.complete, true); assert.equal(a.answered, 5); assert.equal(a.chunks.length, 2);
  assert.deepEqual(a.items.map(i => [i.questionNo, i.sent]), [[1, true], [2, true], [3, false], [4, false], [5, false]]);
  assert.ok(!JSON.stringify(a.chunks).includes(INVENTOR));
  const ref = a.facts[0].refs[0];
  assert.equal(ref.origin, 'user_answer'); assert.equal(ref.questionNo, 1); assert.equal(ref.page, null);
  assert.equal(ref.end, Array.from(PROBLEM).length); assert.equal(ref.quote, PROBLEM);
  assert.equal(sourceRefSchema.safeParse(ref).success, true);
  assert.equal(answerSourceLabel(2), '用户直接回答 · 第 2 题');
  const again = await buildAnswerSources(input);
  assert.deepEqual(again.chunks.map(c => c.id), a.chunks.map(c => c.id));
  const changed = await buildAnswerSources({ ...input, answers: { ...FULL, problem: PROBLEM + '。' } });
  assert.notEqual(changed.chunks[0].id, a.chunks[0].id);
  const partial = await buildAnswerSources({ ...input, answers: { ...FULL, maturity: null, inventorIds: [] } });
  assert.equal(partial.complete, false); assert.deepEqual(partial.missing, ['第 3 题（发明人）', '第 5 题（成熟度）']);
});

test('manifest lists the answers with counts and labels, and a changed answer voids the old consent', async () => {
  const f = await fixture();
  const view = await loadAiView(f.repository, ACTOR, MATTER_ID, { targetId: TARGET_ID, now: () => T0 });
  assert.equal(view.ok, true);
  const { manifest } = view.data;
  assert.equal(manifest.answers.sentCount, 2); assert.equal(manifest.answers.complete, true);
  assert.equal(manifest.answers.items[0].characters, Array.from(PROBLEM).length);
  assert.equal(manifest.chunkIds.length, 2); assert.equal(manifest.files.length, 0);
  assert.ok(!JSON.stringify(manifest.answers).includes(PROBLEM), 'counts and labels only');
  const runtime = await (await resolveGenerationRuntime(f.repository, ACTOR, MATTER_ID, TARGET_ID, f.deps)).consent.grant();
  assert.equal(runtime.mode, 'real'); assert.equal(runtime.consent.required, false);
  await setAnswers(f, { ...FULL, difference: DIFFERENCE + '并增加电池。' });
  const stale = await validateConsentForUse(f.repository, ACTOR, MATTER_ID, { consentId: runtime.engineOptions.consentId, purpose: 'draft', targetId: TARGET_ID },
    { config: runtime.engineOptions.config, now: () => T0 });
  assert.equal(stale.ok, false); assert.equal(stale.error.code, 'CONSENT_REQUIRED');
  await assert.rejects(runtime.engineOptions.provider.generateStructured({ requestId: 'x:1', prompt: 'p', stage: 'draft_claims' }, { parse: v => v, safeParse: v => ({ success: true, data: v }) }),
    e => e.code === 'CONSENT_REQUIRED');
  assert.equal(f.state.chatCalls, 0);
});

test('answers-only: incomplete or empty answers cannot draft for real and say why', async () => {
  for (const [answers, pattern] of [[{ ...FULL, maturity: null }, /第 5 题/], [{ ...FULL, problem: '', difference: '' , inventorIds: [], disclosure: null, maturity: null }, /五题回答/]]) {
    const f = await fixture(answers);
    const runtime = await resolveGenerationRuntime(f.repository, ACTOR, MATTER_ID, TARGET_ID, f.deps);
    assert.equal(runtime.mode, 'test'); assert.match(runtime.unavailableReason, pattern);
    assert.equal(f.state.chatCalls, 0);
  }
});

test('answers-only: a complete set drafts for real, cites the answer as 用户直接回答, and never sends unneeded answers', async () => {
  const f = await fixture();
  const runtime = await (await resolveGenerationRuntime(f.repository, ACTOR, MATTER_ID, TARGET_ID, f.deps)).consent.grant();
  assert.equal(runtime.mode, 'real');
  const engine = createGenerationEngine({ ...runtime.engineOptions, repository: f.repository, actor: ACTOR, now: f.deps.now });
  const start = await engine.start(MATTER_ID, TARGET_ID);
  assert.equal(start.ok, true, start.ok ? '' : JSON.stringify(start.error));
  const done = await waitForJob(engine, start.data.job.id, 10000);
  assert.equal(done.job.state, 'succeeded', JSON.stringify(done.stages?.map(s => [s.stage, s.state, s.errorCode])));
  const extract = f.bodies.find(b => b.stage === 'extract_invention_facts');
  assert.ok(extract.prompt.includes(PROBLEM) && extract.prompt.includes(DIFFERENCE));
  assert.ok(extract.prompt.includes('用户直接回答（不是文件，没有页码）') && extract.prompt.includes('用户直接回答 · 第 1 题'));
  assert.ok(!f.bodies.some(b => b.prompt.includes(INVENTOR) || JSON.stringify(b.context ?? []).includes(INVENTOR)));
  const adopted = await engine.adopt(done.job.id);
  assert.equal(adopted.ok, true, adopted.ok ? '' : JSON.stringify(adopted.error));
  const feature = adopted.data.revision.ast.claims[0].features[0];
  assert.equal(feature.status, 'supported');
  const paragraphRefs = adopted.data.revision.ast.claims[0].paragraphs[0].sourceRefs;
  assert.ok(paragraphRefs.length > 0);
  for (const ref of paragraphRefs) {
    assert.equal(ref.origin, 'user_answer'); assert.equal(ref.page, null); assert.equal(sourceRefSchema.safeParse(ref).success, true);
  }
  assert.equal(adopted.data.revision.testOutput, undefined);

  // The review panel locates the reference inside the real answer text and names it honestly.
  const session = new DraftReviewSession({ repository: f.repository, actor: ACTOR, matterId: MATTER_ID, targetId: TARGET_ID, now: f.deps.now });
  await session.load();
  const state = session.getSnapshot();
  const locator = state.locators.find(item => item.ref.origin === 'user_answer');
  assert.ok(locator, JSON.stringify(state.error));
  assert.equal(locator.status, 'located'); assert.equal(locator.sourceName, '用户直接回答 · 第 1 题'); assert.equal(locator.chunkText, PROBLEM);

  // The support mapping and source table name the answer instead of showing a file or chunk UUID.
  const html = renderReview(state);
  assert.ok(html.includes('用户直接回答 · 第 1 题'), 'support/source table shows the answer label');
  assert.ok(!html.includes('来源标记 ·'), 'answer refs are not shown as file sources');
});
