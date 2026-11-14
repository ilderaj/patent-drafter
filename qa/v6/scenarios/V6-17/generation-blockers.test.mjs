import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { register } from "tsx/esm/api";

register();

const G = await import("../../../../apps/web/src/v6/features/generation/generation.ts");
const H = await import("./harness.mjs");
const AI = await import("../../../../apps/web/src/v6/features/ai/ai.ts");
const P = await import("../../../../packages/pipeline/src/mock.ts");

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = stable(value[key]);
    return out;
  }
  return value;
}

function digest(ast) {
  return createHash("sha256").update(JSON.stringify(stable(ast))).digest("hex");
}

test("V6-17 B1: support derives traceable facts and the AST carries factIds/sourceRefs", async () => {
  const fixture = await H.createFixture({ withFacts: true });
  const started = await fixture.engine.start(H.MATTER_ID, H.TARGET_ID);
  assert.equal(started.ok, true, started.ok ? "" : JSON.stringify(started.error));
  const done = await H.waitForJob(fixture.engine, started.data.job.id);
  assert.equal(done.job.state, "succeeded");
  assert.equal(done.support.facts.length, 3);
  assert.deepEqual(done.support.unresolvedFactIds, []);
  const mapped = new Map(done.support.pipelineFacts.map((fact) => [fact.pipelineFactId, fact.snapshotFactId]));
  assert.equal(mapped.get("f2"), H.SUPPORT_FACT_1);
  assert.equal(mapped.get("f3"), H.SUPPORT_FACT_2);
  assert.equal(mapped.get("f4"), H.SUPPORT_FACT_3);

  const features = done.result.ast.claims.flatMap((claim) => claim.features);
  const linked = features.filter((feature) => feature.factIds.length > 0);
  assert.ok(linked.length >= 2, JSON.stringify(features));
  for (const feature of linked) {
    assert.ok(feature.supportParagraphIds.length > 0, JSON.stringify(feature));
  }
  const claimParagraphs = done.result.ast.claims.flatMap((claim) => claim.paragraphs);
  assert.ok(claimParagraphs.some((paragraph) => paragraph.factIds.length > 0 && paragraph.sourceRefs.length > 0));
  const sectionParagraphs = done.result.ast.sections.flatMap((section) => section.paragraphs);
  assert.ok(sectionParagraphs.filter((paragraph) => paragraph.sourceRefs.length > 0).length >= 2);
  for (const ref of sectionParagraphs.flatMap((paragraph) => paragraph.sourceRefs)) {
    assert.match(ref.chunkId, /^[0-9a-f-]{36}$/);
    assert.match(ref.chunkHash, /^[0-9a-f]{64}$/);
  }
  const claimsPrompt = fixture.provider.calls.find((call) => call.stage === "draft_claims")?.prompt ?? "";
  assert.match(claimsPrompt, /确认事实与依据索引/);
  assert.ok(claimsPrompt.includes(H.SUPPORT_FACT_1));
});

test("V6-17 B1: changing persisted facts changes the support output and job input hash", async () => {
  const fixture = await H.createFixture({ withFacts: true });
  const first = await fixture.engine.start(H.MATTER_ID, H.TARGET_ID);
  assert.equal(first.ok, true);
  const firstDone = await H.waitForJob(fixture.engine, first.data.job.id);
  const firstSupport = firstDone.stages.find((stage) => stage.stage === "support").output;
  assert.equal(firstSupport.facts[0].statement, "表体、计量部件、控制单元、三模通讯模块");

  await fixture.backend.transaction("readwrite", async (tx) => {
    const key = `intake/snapshot/${H.MATTER_ID}/1`;
    const row = await tx.get(H.STORES.blobs, key);
    assert.ok(row && row.kind === "intake.snapshot");
    row.snapshot.facts[0].statement = "表体、计量部件、控制单元与三模通讯模块（修订）";
    await tx.put(H.STORES.blobs, key, row);
  });

  const second = await fixture.engine.start(H.MATTER_ID, H.TARGET_ID);
  assert.equal(second.ok, true, second.ok ? "" : JSON.stringify(second.error));
  const secondDone = await H.waitForJob(fixture.engine, second.data.job.id);
  const secondSupport = secondDone.stages.find((stage) => stage.stage === "support").output;
  assert.notEqual(secondDone.job.payloadHash, firstDone.job.payloadHash);
  assert.notEqual(secondSupport.facts[0].statement, firstSupport.facts[0].statement);
});

test("V6-17 B2: maxCostMinor is enforced and the next provider call fails with JOB_LIMIT_EXCEEDED", async () => {
  const provider = new H.CountingProvider({ reportCostMinor: 1 });
  const fixture = await H.createFixture({
    provider,
    engineOptions: { limits: { maxInputTokens: 100000, maxOutputTokens: 20000, maxCostMinor: 1, maxDurationSeconds: 300 } },
  });
  const started = await fixture.engine.start(H.MATTER_ID, H.TARGET_ID);
  assert.equal(started.ok, true);
  const done = await H.waitForJob(fixture.engine, started.data.job.id);
  assert.equal(done.job.state, "failed");
  assert.equal(done.job.errorCode, "JOB_LIMIT_EXCEEDED");
  assert.equal(provider.calls.length, 1);
});

test("V6-17 B2: an unknown-cost call consumes the remaining budget", async () => {
  const provider = new H.CountingProvider({ reportCostMinor: null });
  const fixture = await H.createFixture({
    provider,
    engineOptions: { limits: { maxInputTokens: 100000, maxOutputTokens: 20000, maxCostMinor: 100000, maxDurationSeconds: 300 } },
  });
  const started = await fixture.engine.start(H.MATTER_ID, H.TARGET_ID);
  assert.equal(started.ok, true);
  const done = await H.waitForJob(fixture.engine, started.data.job.id);
  assert.equal(done.job.state, "failed");
  assert.equal(done.job.errorCode, "JOB_LIMIT_EXCEEDED");
  assert.equal(done.job.usageUnknown, true);
  assert.equal(provider.calls.length, 1);
});

test("V6-17 B2: maxDurationSeconds is enforced across the whole job", async () => {
  let clock = new Date(H.T0).getTime();
  const provider = new H.CountingProvider({ beforeResponse: async () => { clock += 450; } });
  const fixture = await H.createFixture({
    provider,
    now: () => new Date(clock),
    engineOptions: { limits: { maxInputTokens: 100000, maxOutputTokens: 20000, maxCostMinor: 100000, maxDurationSeconds: 1 } },
  });
  const started = await fixture.engine.start(H.MATTER_ID, H.TARGET_ID);
  assert.equal(started.ok, true);
  const done = await H.waitForJob(fixture.engine, started.data.job.id);
  assert.equal(done.job.state, "failed");
  assert.equal(done.job.errorCode, "JOB_LIMIT_EXCEEDED");
  assert.ok(provider.calls.length >= 1 && provider.calls.length < 5, String(provider.calls.length));
});

test("V6-17 B3: generated DraftRevision.astHash is the canonical AST digest", async () => {
  const fixture = await H.createFixture();
  const started = await fixture.engine.start(H.MATTER_ID, H.TARGET_ID);
  assert.equal(started.ok, true);
  const done = await H.waitForJob(fixture.engine, started.data.job.id);
  const adopted = await fixture.engine.adopt(started.data.job.id);
  assert.equal(adopted.ok, true, adopted.ok ? "" : JSON.stringify(adopted.error));
  assert.equal(adopted.data.revision.astHash, digest(done.result.ast));
  assert.notEqual(adopted.data.revision.astHash, done.job.payloadHash);
});

class FaultyStateStore {
  constructor(inner) {
    this.inner = inner;
    this.failed = false;
  }

  transaction(run) {
    return this.inner.transaction(async (tx) => run({
      get: (key) => tx.get(key),
      delete: (key) => tx.delete(key),
      put: async (key, value) => {
        if (!this.failed && value && typeof value === "object" && value.kind === "generation.revisions") {
          this.failed = true;
          throw new Error("injected final state write failure");
        }
        return tx.put(key, value);
      },
    }));
  }
}

test("V6-17 B4: a failed final revision-state write is recoverable and the next save succeeds", async () => {
  const fixture = await H.createFixture();
  const started = await fixture.engine.start(H.MATTER_ID, H.TARGET_ID);
  assert.equal(started.ok, true);
  const done = await H.waitForJob(fixture.engine, started.data.job.id);
  const adopted = await fixture.engine.adopt(started.data.job.id);
  assert.equal(adopted.ok, true);

  const faulty = new FaultyStateStore(fixture.storage);
  const seam = G.createGenerationRevisionStore({ repository: fixture.repository, actor: H.ACTOR, storage: faulty });
  const edited1 = structuredClone(done.result.ast);
  edited1.title = "人工编辑一";
  const firstSave = await seam.saveEditedRevision(H.MATTER_ID, H.TARGET_ID, adopted.data.revision.id, edited1);
  assert.equal(firstSave.ok, true, firstSave.ok ? "" : JSON.stringify(firstSave.error));

  const head = await seam.loadHeadRevision(H.MATTER_ID, H.TARGET_ID);
  assert.equal(head.ok, true);
  assert.equal(head.data.revision.id, firstSave.data.id);
  assert.equal(faulty.failed, true);

  const edited2 = structuredClone(edited1);
  edited2.title = "人工编辑二";
  const secondSave = await seam.saveEditedRevision(H.MATTER_ID, H.TARGET_ID, head.data.revision.id, edited2);
  assert.equal(secondSave.ok, true, secondSave.ok ? "" : JSON.stringify(secondSave.error));
  assert.equal(secondSave.data.parentId, firstSave.data.id);
});

function sha256Text(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

async function mutateSupport(fixture, mutate) {
  await fixture.backend.transaction("readwrite", async (tx) => {
    const snapshotKey = `intake/snapshot/${H.MATTER_ID}/1`;
    const chunksKey = `parse/chunks/${H.SUPPORT_SOURCE_ID}`;
    const snapshotRow = await tx.get(H.STORES.blobs, snapshotKey);
    const chunkRow = await tx.get(H.STORES.blobs, chunksKey);
    assert.ok(snapshotRow && chunkRow);
    mutate({ snapshot: snapshotRow.snapshot, chunks: chunkRow });
    await tx.put(H.STORES.blobs, snapshotKey, snapshotRow);
    await tx.put(H.STORES.blobs, chunksKey, chunkRow);
  });
}

async function runWithFacts(mutate, provider) {
  const fixture = await H.createFixture({ withFacts: true, provider });
  if (mutate) await mutateSupport(fixture, mutate);
  const started = await fixture.engine.start(H.MATTER_ID, H.TARGET_ID);
  assert.equal(started.ok, true, started.ok ? "" : JSON.stringify(started.error));
  return { fixture, done: await H.waitForJob(fixture.engine, started.data.job.id) };
}

function astFeatures(done) {
  return done.result.ast.claims.flatMap((claim) => claim.features);
}

function assertFeatureNotSupported(done, textFragment) {
  const feature = astFeatures(done).find((candidate) => candidate.text.includes(textFragment));
  assert.ok(feature, textFragment);
  assert.notEqual(feature.status, "supported");
  assert.deepEqual(feature.factIds, []);
  assert.deepEqual(feature.supportParagraphIds, []);
}

function assertNoChunkRef(done, chunkId) {
  const refs = [
    ...done.result.ast.claims.flatMap((claim) => claim.paragraphs.flatMap((paragraph) => paragraph.sourceRefs)),
    ...done.result.ast.sections.flatMap((section) => section.paragraphs.flatMap((paragraph) => paragraph.sourceRefs)),
  ];
  assert.equal(refs.some((ref) => ref.chunkId === chunkId), false, JSON.stringify(refs));
}

test("V6-17 B1 probe: a short fact with substring overlap does not map a multi-component provider fact", async () => {
  const { done } = await runWithFacts(({ snapshot, chunks }) => {
    const fact = snapshot.facts[0];
    fact.statement = "表体";
    fact.refs[0].quote = "表体";
    fact.refs[0].start = 0;
    fact.refs[0].end = 2;
    const hash = sha256Text("表体");
    fact.refs[0].chunkHash = hash;
    chunks.chunks[0].text = "表体";
    chunks.chunks[0].hash = hash;
  });
  const mapped = done.support.pipelineFacts.find((fact) => fact.pipelineFactId === "f2");
  assert.equal(mapped.resolved, false);
  assertFeatureNotSupported(done, "表体、计量部件");
  assertNoChunkRef(done, H.SUPPORT_CHUNK_1);
});

test("V6-17 B1 probe: an absent chunk UUID makes the fact unresolved and never links it", async () => {
  const { done } = await runWithFacts(({ snapshot }) => {
    snapshot.facts[0].refs[0].chunkId = "00000000-0000-4000-8000-000000000000";
  });
  assert.equal(done.support.facts.find((fact) => fact.factId === H.SUPPORT_FACT_1).resolved, false);
  assert.equal(done.support.pipelineFacts.find((fact) => fact.pipelineFactId === "f2").resolved, false);
  assertFeatureNotSupported(done, "表体、计量部件");
  assertNoChunkRef(done, H.SUPPORT_CHUNK_1);
});

test("V6-17 B1 probe: a persisted unsupported fact is never linked or marked supported", async () => {
  const { done } = await runWithFacts(({ snapshot }) => {
    snapshot.facts[0].status = "unsupported";
  });
  const fact = done.support.facts.find((candidate) => candidate.factId === H.SUPPORT_FACT_1);
  assert.equal(fact.resolved, false);
  assert.equal(done.support.pipelineFacts.find((candidate) => candidate.pipelineFactId === "f2").snapshotFactId, null);
  assertFeatureNotSupported(done, "表体、计量部件");
});

test("V6-17 B1 probe: a provider source_backed feature with no factId is partial, not supported", async () => {
  const provider = new H.CountingProvider({
    respond: (stage) => {
      const output = structuredClone(P.MOCK_STAGE_OUTPUTS[stage]);
      if (stage === "draft_claims" && output && Array.isArray(output.claims)) {
        for (const claim of output.claims) {
          for (const feature of claim.features ?? []) delete feature.factId;
        }
      }
      return output;
    },
  });
  const { done } = await runWithFacts(null, provider);
  const features = astFeatures(done);
  assert.ok(features.length > 0);
  assert.ok(features.every((feature) => feature.status !== "supported"));
  assert.ok(features.every((feature) => feature.factIds.length === 0));
  assert.ok(features.every((feature) => feature.supportParagraphIds.length === 0));
});

test("V6-17 B1 probe: altered sourceId/hash/quote/offsets invalidate the ref", async () => {
  const variants = [
    (fact) => { fact.refs[0].sourceId = "66666666-aaaa-4aaa-8aaa-aaaaaaaaaaa1"; },
    (fact) => { fact.refs[0].chunkHash = "0".repeat(64); },
    (fact) => { fact.refs[0].quote = "不存在的引用"; },
    (fact) => { fact.refs[0].start = 1; fact.refs[0].end = 2; },
  ];
  for (const mutate of variants) {
    const { done } = await runWithFacts(({ snapshot }) => mutate(snapshot.facts[0]));
    assert.equal(done.support.facts.find((fact) => fact.factId === H.SUPPORT_FACT_1).resolved, false);
    assert.equal(done.support.pipelineFacts.find((fact) => fact.pipelineFactId === "f2").resolved, false);
    assertFeatureNotSupported(done, "表体、计量部件");
    assertNoChunkRef(done, H.SUPPORT_CHUNK_1);
  }
});

test("V6-17 B1 probe: numeric punctuation distinguishes 1.5mm from 15mm while NFKC/whitespace variants match", async () => {
  const featureText = "阈值为 1.5mm";
  const providerFor = (statement) => new H.CountingProvider({
    respond: (stage) => {
      if (stage === "extract_invention_facts") {
        return {
          facts: [{
            id: "f1",
            category: "parameter",
            statement,
            status: "source_backed",
            refs: [{ chunkId: "c1", page: 1 }],
            patentTypeHint: "utility_model",
          }],
        };
      }
      if (stage === "draft_claims") {
        return {
          claims: [{
            number: 1,
            independent: true,
            parentRefs: [],
            text: "1、一种合成装置，其特征在于，阈值满足限定。",
            features: [{ text: featureText, factId: "f1", status: "source_backed" }],
          }],
        };
      }
      return structuredClone(P.MOCK_STAGE_OUTPUTS[stage]);
    },
  });

  const runNumeric = async (providerStatement, persistedStatement) => {
    const provider = providerFor(providerStatement);
    const { done } = await runWithFacts(({ snapshot, chunks }) => {
      const fact = snapshot.facts[0];
      fact.statement = persistedStatement;
      fact.kind = "parameter";
      const hash = sha256Text(persistedStatement);
      fact.refs[0].quote = persistedStatement;
      fact.refs[0].start = 0;
      fact.refs[0].end = Array.from(persistedStatement).length;
      fact.refs[0].chunkHash = hash;
      fact.refs[0].page = 1;
      chunks.chunks[0].text = persistedStatement;
      chunks.chunks[0].hash = hash;
    }, provider);
    return { done, feature: astFeatures(done).find((candidate) => candidate.text === featureText) };
  };

  const different = await runNumeric("阈值为15mm", "阈值为1.5mm");
  assert.ok(different.feature);
  assert.notEqual(different.feature.status, "supported");
  assert.deepEqual(different.feature.factIds, []);
  assert.deepEqual(different.feature.supportParagraphIds, []);
  assert.equal(different.done.support.pipelineFacts.find((fact) => fact.pipelineFactId === "f1").resolved, false);
  assertNoChunkRef(different.done, H.SUPPORT_CHUNK_1);

  const exact = await runNumeric("阈值为1.5mm", "阈值为1.5mm");
  assert.ok(exact.feature);
  assert.equal(exact.feature.status, "supported");
  assert.deepEqual(exact.feature.factIds, [H.SUPPORT_FACT_1]);
  assert.ok(exact.feature.supportParagraphIds.length > 0);

  const normalizedVariant = await runNumeric("阈值为1.5mm", "阈值为 １．５mm");
  assert.ok(normalizedVariant.feature);
  assert.equal(normalizedVariant.feature.status, "supported");
  assert.deepEqual(normalizedVariant.feature.factIds, [H.SUPPORT_FACT_1]);
  assert.ok(normalizedVariant.feature.supportParagraphIds.length > 0);
});

test("V6-17 B2 probe: a cap of 2 stops after the second call inside one multi-call stage", async () => {
  const provider = new H.CountingProvider({
    reportCostMinor: (stage) => (stage === "extract_invention_facts" ? 0 : 1),
  });
  const fixture = await H.createFixture({
    provider,
    engineOptions: { limits: { maxInputTokens: 100000, maxOutputTokens: 20000, maxCostMinor: 2, maxDurationSeconds: 300 } },
  });
  const started = await fixture.engine.start(H.MATTER_ID, H.TARGET_ID);
  assert.equal(started.ok, true);
  const done = await H.waitForJob(fixture.engine, started.data.job.id);
  assert.equal(done.job.state, "failed");
  assert.equal(done.job.errorCode, "JOB_LIMIT_EXCEEDED");
  const claimsStageCalls = provider.calls.filter((call) => call.stage !== "extract_invention_facts");
  assert.equal(claimsStageCalls.length, 2, JSON.stringify(provider.calls.map((call) => call.stage)));
});

test("V6-17 B3 probe: a 2 s overrun during the final provider response fails before success", async () => {
  let clock = new Date(H.T0).getTime();
  const provider = new H.CountingProvider({
    beforeResponse: async (call) => {
      clock += call.stage === "audit_formal_rules" ? 2000 : 20;
    },
  });
  const fixture = await H.createFixture({
    provider,
    now: () => new Date(clock),
    engineOptions: { limits: { maxInputTokens: 100000, maxOutputTokens: 20000, maxCostMinor: 100000, maxDurationSeconds: 1 } },
  });
  const started = await fixture.engine.start(H.MATTER_ID, H.TARGET_ID);
  assert.equal(started.ok, true);
  const done = await H.waitForJob(fixture.engine, started.data.job.id);
  assert.equal(done.job.state, "failed");
  assert.equal(done.job.errorCode, "JOB_LIMIT_EXCEEDED");
  assert.ok(provider.calls.some((call) => call.stage === "audit_formal_rules"));
});

test("V6-17 B3 probe: resume reuses the original deadline and 0.7 s + 0.7 s fails a 1 s cap", async () => {
  let clock = new Date(H.T0).getTime();
  let entered;
  let release;
  const blocked = new Promise((resolve) => { entered = resolve; });
  const gate = new Promise((resolve) => { release = resolve; });
  const provider = new H.CountingProvider({
    beforeResponse: async (call) => {
      if (call.stage === "extract_invention_facts") clock += 700;
      if (call.stage === "draft_claims") { entered(); await gate; }
    },
  });
  const fixture = await H.createFixture({
    provider,
    now: () => new Date(clock),
    engineOptions: { limits: { maxInputTokens: 100000, maxOutputTokens: 20000, maxCostMinor: 100000, maxDurationSeconds: 1 } },
  });
  const started = await fixture.engine.start(H.MATTER_ID, H.TARGET_ID);
  assert.equal(started.ok, true);
  await blocked;
  const fresh = G.createGenerationEngine({
    repository: fixture.repository,
    actor: H.ACTOR,
    storage: fixture.storage,
    provider,
    profileId: H.TEST_PROFILE.id,
    profileVersion: H.TEST_PROFILE.version,
    consentId: fixture.consent.id,
    config: AI.DEFAULT_AI_CONFIG,
    pipeline: fixture.pipeline,
    limits: { maxInputTokens: 100000, maxOutputTokens: 20000, maxCostMinor: 100000, maxDurationSeconds: 1 },
    now: () => new Date(clock),
  });
  const interrupted = await fresh.get(started.data.job.id);
  assert.equal(interrupted.data.job.state, "interrupted");
  clock += 700;
  const callCount = provider.calls.length;
  const resumed = await fresh.resume(started.data.job.id);
  assert.equal(resumed.ok, true);
  const done = await H.waitForJob(fresh, started.data.job.id);
  assert.equal(done.job.state, "failed");
  assert.equal(done.job.errorCode, "JOB_LIMIT_EXCEEDED");
  assert.equal(provider.calls.length, callCount);
  release();
  await new Promise((resolve) => setTimeout(resolve, 10));
});
