import test from "node:test";
import assert from "node:assert/strict";
import { register } from "tsx/esm/api";
import { ACTOR, MATTER_ID, TARGET_ID, createFixture, waitForJob, CountingProvider } from "./harness.mjs";

register();

test("V6-17 S04-A06: a fact/input change during generation marks the result obsolete", async () => {
  let entered;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const blocked = new Promise((resolve) => { entered = resolve; });
  const provider = new CountingProvider({ beforeResponse: async (call) => {
    if (call.stage === "detect_conflicts") { entered(); await gate; }
  } });
  const fixture = await createFixture({ provider });
  const started = await fixture.engine.start(MATTER_ID, TARGET_ID);
  assert.equal(started.ok, true);
  await blocked;
  const current = await fixture.repository.loadMatter(ACTOR, MATTER_ID);
  const commit = await fixture.repository.commit(ACTOR, {
    contractVersion: "v6.1",
    expectedVersion: current.data.version,
    payload: {
      matter: { ...current.data.data.matter, sourceVersion: 2, version: current.data.version + 1, updatedAt: "2026-11-05T12:05:00.000Z" },
      targets: current.data.data.targets,
      assets: current.data.data.assets,
      events: [],
      blobs: [],
    },
  }, { requestId: "88888888-8888-4888-8888-888888888888" });
  assert.equal(commit.ok, true);
  release();
  const done = await waitForJob(fixture.engine, started.data.job.id);
  assert.equal(done.job.state, "succeeded", JSON.stringify({ job: done.job, stages: done.stages.map((stage) => [stage.stage, stage.state, stage.errorCode]), message: done.errorMessage }));
  assert.equal(done.job.disposition, "obsolete_result");
  const adopted = await fixture.engine.adopt(started.data.job.id);
  assert.equal(adopted.ok, true);
  assert.equal(adopted.data.status, "obsolete_result");
  assert.equal((await fixture.repository.loadMatter(ACTOR, MATTER_ID)).data.data.targets[0].draftRevisionId, null);
});

test("V6-17 A03: repeated adoption has one side effect and replays the same revision", async () => {
  const fixture = await createFixture();
  const started = await fixture.engine.start(MATTER_ID, TARGET_ID);
  assert.equal(started.ok, true);
  await waitForJob(fixture.engine, started.data.job.id);
  const first = await fixture.engine.adopt(started.data.job.id);
  assert.equal(first.ok, true);
  const second = await fixture.engine.adopt(started.data.job.id);
  assert.equal(second.ok, true);
  assert.equal(second.replayed, true);
  assert.equal(second.data.revision.id, first.data.revision.id);
  const events = await fixture.repository.listEvents(ACTOR, MATTER_ID);
  assert.equal(events.data.items.filter((event) => event.action === "revision.created" && event.resourceId === first.data.revision.id).length, 1);
});

test("V6-17 A02: a queued job can be cancelled before any provider call", async () => {
  const provider = new CountingProvider();
  const fixture = await createFixture({ provider });
  const started = await fixture.engine.start(MATTER_ID, TARGET_ID);
  assert.equal(started.ok, true);
  assert.equal(started.data.job.state, "queued");
  const cancelled = await fixture.engine.cancel(started.data.job.id);
  assert.equal(cancelled.ok, true);
  assert.equal(cancelled.data.job.state, "cancelled");
  assert.equal(provider.calls.length, 0);
  assert.equal((await fixture.repository.loadMatter(ACTOR, MATTER_ID)).data.data.targets[0].draftRevisionId, null);
});

test("V6-17 A02: cancelling a completed job is refused and cannot remove its result", async () => {
  const fixture = await createFixture();
  const started = await fixture.engine.start(MATTER_ID, TARGET_ID);
  assert.equal(started.ok, true);
  const done = await waitForJob(fixture.engine, started.data.job.id);
  assert.equal(done.job.state, "succeeded");
  const refused = await fixture.engine.cancel(started.data.job.id);
  assert.equal(refused.ok, false);
  assert.equal(refused.error.code, "INVALID_TRANSITION");
  const after = await fixture.engine.get(started.data.job.id);
  assert.equal(after.data.job.state, "succeeded");
  assert.equal(after.data.result.ast.title, done.result.ast.title);
});

test("V6-17 A03: retry with a different consent/provider configuration is refused, not silently switched", async () => {
  const { createGenerationEngine } = await import("../../../../apps/web/src/v6/features/generation/generation.ts");
  const { DEFAULT_AI_CONFIG } = await import("../../../../apps/web/src/v6/features/ai/ai.ts");
  const { TEST_PROFILE } = await import("./harness.mjs");
  const provider = new CountingProvider({ failStages: new Map([["draft_claims", 1]]) });
  const fixture = await createFixture({ provider });
  const started = await fixture.engine.start(MATTER_ID, TARGET_ID);
  assert.equal(started.ok, true);
  const failed = await waitForJob(fixture.engine, started.data.job.id);
  assert.equal(failed.job.state, "failed");
  const calls = provider.calls.length;
  const other = createGenerationEngine({
    repository: fixture.repository,
    actor: ACTOR,
    storage: fixture.storage,
    provider,
    profileId: TEST_PROFILE.id,
    profileVersion: TEST_PROFILE.version,
    consentId: "99999999-9999-4999-8999-999999999999",
    config: DEFAULT_AI_CONFIG,
    pipeline: { prompts: {}, promptVersion: "p", rulePackVersion: "r" },
    limits: { maxInputTokens: 1000, maxOutputTokens: 1000, maxCostMinor: 1000, maxDurationSeconds: 60 },
  });
  const refused = await other.retry(started.data.job.id);
  assert.equal(refused.ok, false);
  assert.equal(refused.error.code, "CONSENT_REQUIRED");
  assert.equal(provider.calls.length, calls);
});
