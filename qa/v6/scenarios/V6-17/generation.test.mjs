import test from "node:test";
import assert from "node:assert/strict";
import { register } from "tsx/esm/api";
import { draftAstSchema } from "../../../../packages/contracts/src/draft.ts";
import { ACTOR, MATTER_ID, TARGET_ID, createFixture, revokeFixtureConsent, waitForJob, CountingProvider } from "./harness.mjs";

register();

const prompts = {
  "system-core.md": "synthetic system prompt",
  "extract-facts.md": "synthetic facts prompt",
  "detect-conflicts.md": "synthetic conflicts prompt",
  "readiness.md": "synthetic readiness prompt",
  "intake.md": "synthetic intake prompt",
  "patent-strategy.md": "synthetic strategy prompt",
  "claim-skeleton.md": "synthetic skeleton prompt",
  "draft-claims.md": "synthetic claims prompt",
  "draft-specification.md": "synthetic specification prompt",
  "figure-spec.md": "synthetic figure prompt",
  "draft-abstract.md": "synthetic abstract prompt",
  "audit-support.md": "synthetic support prompt",
  "audit-consistency.md": "synthetic consistency prompt",
  "audit-formal-rules.md": "synthetic checks prompt",
};
const limits = { maxInputTokens: 100000, maxOutputTokens: 20000, maxCostMinor: 100000, maxDurationSeconds: 300 };

test("V6-17 A01: completed output is a candidate until explicit adoption creates a viewable revision", async () => {
  const fixture = await createFixture();
  const started = await fixture.engine.start(MATTER_ID, TARGET_ID);
  assert.equal(started.ok, true, started.ok ? "" : JSON.stringify(started.error));
  const completed = await waitForJob(fixture.engine, started.data.job.id);
  assert.equal(completed.job.state, "succeeded");
  assert.equal(completed.job.disposition, "ready");
  assert.deepEqual(completed.progress, { completed: 5, total: 5, unit: "stage" });
  assert.deepEqual(completed.stages.map((stage) => stage.state), ["completed", "completed", "completed", "completed", "completed"]);
  assert.equal(draftAstSchema.safeParse(completed.result.ast).success, true);
  assert.equal((await fixture.repository.loadMatter(ACTOR, MATTER_ID)).data.data.targets[0].draftRevisionId, null);
  const adopted = await fixture.engine.adopt(started.data.job.id);
  assert.equal(adopted.ok, true, adopted.ok ? "" : JSON.stringify(adopted.error));
  assert.equal(adopted.data.status, "adopted");
  assert.equal(adopted.data.job.job.disposition, "adopted");
  assert.equal(adopted.data.revision.reason, "generated");
  const viewed = await fixture.engine.getRevision(adopted.data.revision.id);
  assert.equal(viewed.ok, true, viewed.ok ? "" : JSON.stringify(viewed.error));
  assert.deepEqual(viewed.data.ast, completed.result.ast);
});

test("V6-17 A02: cancellation fences a late response and leaves the draft pointer unchanged", async () => {
  let entered;
  let release;
  const blocked = new Promise((resolve) => { entered = resolve; });
  const late = new Promise((resolve) => { release = resolve; });
  const provider = new CountingProvider({ beforeResponse: async () => { entered(); await late; } });
  const fixture = await createFixture({ provider });
  const started = await fixture.engine.start(MATTER_ID, TARGET_ID);
  assert.equal(started.ok, true, started.ok ? "" : JSON.stringify(started.error));
  await blocked;
  const cancelled = await fixture.engine.cancel(started.data.job.id);
  assert.equal(cancelled.ok, true, cancelled.ok ? "" : JSON.stringify(cancelled.error));
  assert.equal(cancelled.data.job.state, "cancelled");
  release();
  await new Promise((resolve) => setTimeout(resolve, 30));
  const observed = await fixture.engine.get(started.data.job.id);
  assert.equal(observed.data.job.state, "cancelled");
  assert.equal(observed.data.stages[0].state, "cancelled");
  assert.equal((await fixture.repository.loadMatter(ACTOR, MATTER_ID)).data.data.targets[0].draftRevisionId, null);
});

test("V6-17 A02: stale candidate returns obsolete_result and is never adopted over the current draft", async () => {
  const fixture = await createFixture();
  const started = await fixture.engine.start(MATTER_ID, TARGET_ID);
  assert.equal(started.ok, true);
  await waitForJob(fixture.engine, started.data.job.id);
  const original = await fixture.repository.loadMatter(ACTOR, MATTER_ID);
  const write = await fixture.repository.commit(ACTOR, {
    contractVersion: "v6.1",
    expectedVersion: original.data.version,
    payload: {
      matter: { ...original.data.data.matter, sourceVersion: 2, version: original.data.version + 1, updatedAt: "2026-11-05T12:01:00.000Z" },
      targets: original.data.data.targets,
      assets: original.data.data.assets,
      events: [],
      blobs: [],
    },
  }, { requestId: "77777777-7777-4777-8777-777777777777" });
  assert.equal(write.ok, true);
  const adopted = await fixture.engine.adopt(started.data.job.id);
  assert.equal(adopted.ok, true);
  assert.equal(adopted.data.status, "obsolete_result");
  assert.equal(adopted.data.job.job.disposition, "obsolete_result");
  assert.equal(adopted.data.revision, null);
  assert.equal((await fixture.repository.loadMatter(ACTOR, MATTER_ID)).data.data.targets[0].draftRevisionId, null);
});

test("V6-17 A03: failed retry creates a new job and retains successful stage checkpoints", async () => {
  const provider = new CountingProvider({ failStages: new Map([["draft_claims", 1]]) });
  const fixture = await createFixture({ provider });
  const started = await fixture.engine.start(MATTER_ID, TARGET_ID);
  assert.equal(started.ok, true);
  const failed = await waitForJob(fixture.engine, started.data.job.id);
  assert.equal(failed.job.state, "failed");
  assert.equal(failed.job.errorCode, "RATE_LIMITED");
  assert.equal(failed.progress.completed, 2, JSON.stringify({ job: failed.job, stages: failed.stages.map((stage) => [stage.stage, stage.state, stage.errorCode]), message: failed.errorMessage }));
  const retried = await fixture.engine.retry(started.data.job.id);
  assert.equal(retried.ok, true, retried.ok ? "" : JSON.stringify(retried.error));
  assert.notEqual(retried.data.job.id, started.data.job.id);
  assert.equal(retried.data.retryOfJobId, started.data.job.id);
  const done = await waitForJob(fixture.engine, retried.data.job.id);
  assert.equal(done.job.state, "succeeded");
  assert.equal(provider.count("extract_invention_facts"), 1);
  assert.equal(provider.count("audit_support"), 1);
  assert.equal(provider.count("draft_claims"), 2);
  assert.deepEqual(done.stages[0].output, failed.stages[0].output);
  assert.deepEqual(done.stages[1].output, failed.stages[1].output);
  assert.equal(done.stages[0].outputMeta.outputHash, failed.stages[0].outputMeta.outputHash);
});

test("V6-17 S04-A07: schema-invalid output makes one provider call and preserves earlier results", async () => {
  const provider = new CountingProvider({ invalidStages: new Set(["draft_claims"]) });
  const fixture = await createFixture({ provider });
  const started = await fixture.engine.start(MATTER_ID, TARGET_ID);
  assert.equal(started.ok, true);
  const failed = await waitForJob(fixture.engine, started.data.job.id);
  assert.equal(failed.job.state, "failed");
  assert.equal(failed.job.errorCode, "PROVIDER_SCHEMA_INVALID");
  assert.equal(provider.count("draft_claims"), 1);
  assert.equal(failed.stages[0].state, "completed");
  assert.equal(failed.stages[1].state, "completed", JSON.stringify({ job: failed.job, stages: failed.stages.map((stage) => [stage.stage, stage.state, stage.errorCode]), message: failed.errorMessage }));
  assert.equal(failed.stages[2].state, "failed");
  assert.equal(failed.stages[0].outputMeta.outputHash.length, 64);
});

test("V6-17 S04-A08: revoked consent blocks the next provider call", async () => {
  const provider = new CountingProvider({ beforeResponse: async (_call, index) => {
    if (index === 0) await new Promise((resolve) => setTimeout(resolve, 15));
  } });
  const fixture = await createFixture({ provider });
  const started = await fixture.engine.start(MATTER_ID, TARGET_ID);
  assert.equal(started.ok, true);
  while (provider.calls.length === 0) await new Promise((resolve) => setTimeout(resolve, 1));
  const revoked = await revokeFixtureConsent(fixture);
  assert.equal(revoked.ok, true);
  const failed = await waitForJob(fixture.engine, started.data.job.id);
  assert.equal(failed.job.state, "failed");
  assert.equal(failed.job.errorCode, "CONSENT_REVOKED");
  assert.equal(provider.count("extract_invention_facts"), 1);
  assert.equal(provider.count("detect_conflicts"), 0);
});

test("V6-17 S04-A09: refresh recovery resumes from saved stages after consent validation", async () => {
  const { createGenerationEngine, MemoryGenerationStore } = await import("../../../../apps/web/src/v6/features/generation/generation.ts");
  const { DEFAULT_AI_CONFIG } = await import("../../../../apps/web/src/v6/features/ai/ai.ts");
  const { TEST_PROFILE } = await import("./harness.mjs");
  const storage = new MemoryGenerationStore(ACTOR);
  const provider = new CountingProvider({ beforeResponse: async (call) => {
    if (call.stage === "detect_conflicts") await new Promise((resolve) => setTimeout(resolve, 80));
  } });
  const fixture = await createFixture({ provider, storage });
  const started = await fixture.engine.start(MATTER_ID, TARGET_ID);
  assert.equal(started.ok, true);
  for (let count = 0; count < 100; count += 1) {
    const view = await fixture.engine.get(started.data.job.id);
    if (view.data.stages[0].state === "completed" && view.data.stages[1].state === "completed") break;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  const fresh = createGenerationEngine({
    repository: fixture.repository,
    actor: ACTOR,
    storage,
    provider,
    profileId: TEST_PROFILE.id,
    profileVersion: TEST_PROFILE.version,
    consentId: fixture.consent.id,
    config: DEFAULT_AI_CONFIG,
    pipeline: { prompts, promptVersion: "synthetic-prompt-v1", rulePackVersion: "synthetic-rules-v1" },
    limits,
  });
  const interrupted = await fresh.get(started.data.job.id);
  assert.equal(interrupted.data.job.state, "interrupted");
  assert.equal(interrupted.data.progress.completed, 2);
  assert.equal(provider.count("extract_invention_facts"), 1);
  assert.equal(provider.count("audit_support"), 0);
  const resumed = await fresh.resume(started.data.job.id);
  assert.equal(resumed.ok, true);
  const done = await waitForJob(fresh, started.data.job.id);
  assert.equal(done.job.state, "succeeded");
  assert.equal(provider.count("extract_invention_facts"), 1);
  assert.equal(provider.count("audit_support"), 1);
  assert.equal(provider.count("draft_claims"), 1);
});

test("V6-17 S04-A09: interrupted work refuses resume if consent is revoked", async () => {
  const { createGenerationEngine, MemoryGenerationStore } = await import("../../../../apps/web/src/v6/features/generation/generation.ts");
  const { DEFAULT_AI_CONFIG } = await import("../../../../apps/web/src/v6/features/ai/ai.ts");
  const { TEST_PROFILE } = await import("./harness.mjs");
  const storage = new MemoryGenerationStore(ACTOR);
  const provider = new CountingProvider({ beforeResponse: async (call) => {
    if (call.stage === "detect_conflicts") await new Promise((resolve) => setTimeout(resolve, 80));
  } });
  const fixture = await createFixture({ provider, storage });
  const started = await fixture.engine.start(MATTER_ID, TARGET_ID);
  assert.equal(started.ok, true);
  for (let count = 0; count < 100; count += 1) {
    const view = await fixture.engine.get(started.data.job.id);
    if (view.data.stages[0].state === "completed" && view.data.stages[1].state === "completed") break;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  const fresh = createGenerationEngine({
    repository: fixture.repository,
    actor: ACTOR,
    storage,
    provider,
    profileId: TEST_PROFILE.id,
    profileVersion: TEST_PROFILE.version,
    consentId: fixture.consent.id,
    config: DEFAULT_AI_CONFIG,
    pipeline: { prompts, promptVersion: "synthetic-prompt-v1", rulePackVersion: "synthetic-rules-v1" },
    limits,
  });
  await revokeFixtureConsent(fixture);
  const interrupted = await fresh.get(started.data.job.id);
  assert.equal(interrupted.data.job.state, "interrupted");
  const callCount = provider.calls.length;
  const refused = await fresh.resume(started.data.job.id);
  assert.equal(refused.ok, true);
  assert.equal(refused.data.job.state, "failed");
  assert.equal(refused.data.job.errorCode, "CONSENT_REVOKED");
  assert.equal(provider.calls.length, callCount);
});

test("V6-17 S04-A10: invocation rows contain metadata only, never prompts, body or keys", async () => {
  const fixture = await createFixture();
  const started = await fixture.engine.start(MATTER_ID, TARGET_ID);
  assert.equal(started.ok, true);
  await waitForJob(fixture.engine, started.data.job.id);
  const calls = await fixture.engine.listInvocations(started.data.job.id);
  assert.equal(calls.ok, true);
  assert.ok(calls.data.length > 0);
  const serialized = JSON.stringify(calls.data).toLowerCase();
  for (const forbidden of ["prompt", "body", "content", "apikey", "secret", "credential"]) assert.equal(serialized.includes(forbidden), false);
  assert.ok(calls.data.every((call) => /^[0-9a-f]{64}$/.test(call.requestHash)));
});

test("V6-17 S04-A10: stub execution records local location without consent or injected provider calls", async () => {
  const { createGenerationEngine } = await import("../../../../apps/web/src/v6/features/generation/generation.ts");
  const { DEFAULT_AI_CONFIG } = await import("../../../../apps/web/src/v6/features/ai/ai.ts");
  const fixture = await createFixture();
  const provider = new CountingProvider();
  const engine = createGenerationEngine({
    repository: fixture.repository,
    actor: ACTOR,
    storage: fixture.storage,
    pipeline: { prompts, promptVersion: "synthetic-prompt-v1", rulePackVersion: "synthetic-rules-v1" },
    limits,
    execution: "stub",
    provider,
    profileId: DEFAULT_AI_CONFIG.profiles.find((profile) => profile.mode === "stub").id,
    profileVersion: 1,
    consentId: null,
    config: DEFAULT_AI_CONFIG,
  });
  const started = await engine.start(MATTER_ID, TARGET_ID);
  assert.equal(started.ok, true);
  await waitForJob(engine, started.data.job.id);
  const calls = await engine.listInvocations(started.data.job.id);
  assert.equal(calls.ok, true);
  assert.equal(provider.calls.length, 0);
  assert.ok(calls.data.every((call) => call.consentId === null && call.executionLocation === "device:stub"));
});

test("V6-17 A03: exported revision seam loads head and CAS-saves an edited DraftRevision", async () => {
  const { createGenerationRevisionStore } = await import("../../../../apps/web/src/v6/features/generation/generation.ts");
  const fixture = await createFixture();
  const started = await fixture.engine.start(MATTER_ID, TARGET_ID);
  assert.equal(started.ok, true);
  const done = await waitForJob(fixture.engine, started.data.job.id);
  const adopted = await fixture.engine.adopt(started.data.job.id);
  assert.equal(adopted.ok, true);
  const revisions = createGenerationRevisionStore({ repository: fixture.repository, actor: ACTOR, storage: fixture.storage });
  const head = await revisions.loadHeadRevision(MATTER_ID, TARGET_ID);
  assert.equal(head.ok, true);
  assert.equal(head.data.revision.id, adopted.data.revision.id);
  const edited = structuredClone(done.result.ast);
  edited.title = "人工编辑后的合成标题";
  const saved = await revisions.saveEditedRevision(MATTER_ID, TARGET_ID, adopted.data.revision.id, edited);
  assert.equal(saved.ok, true, saved.ok ? "" : JSON.stringify(saved.error));
  assert.equal(saved.data.reason, "edited");
  assert.equal(saved.data.parentId, adopted.data.revision.id);
});
