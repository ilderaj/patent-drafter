import test from "node:test";
import assert from "node:assert/strict";
import { register } from "tsx/esm/api";

register();

const { PipelineAdapter, MemoryPipelineStageCache, PipelineAdapterError } = await import(
  "../../../../apps/web/src/v6/lib/pipeline-adapter.ts"
);
const { MOCK_STAGE_OUTPUTS, mockPipelineContext, STAGES } = await import(
  "../../../../packages/pipeline/src/index.ts"
);
const { ProviderError } = await import("@patent/providers");

const FIXED_TIME = new Date("2026-11-04T12:00:00.000Z");

function prompts() {
  const names = new Set(["system-core.md"]);
  for (const stage of STAGES) if (stage.promptFile) names.add(stage.promptFile);
  return Object.fromEntries([...names].map((name) => [name, `synthetic prompt: ${name}`]));
}

class CountingProvider {
  constructor({ respond, failOnce = new Map() } = {}) {
    this.calls = [];
    this.respond = respond ?? ((stage) => MOCK_STAGE_OUTPUTS[stage]);
    this.failOnce = new Map(failOnce);
  }

  async getCapabilities() {
    return { structuredOutput: true, tools: false, visionInput: false, imageGeneration: false, longContext: true, localAuth: false };
  }

  async listModels() {
    return [];
  }

  async generateStructured(request) {
    const stage = request.stage;
    this.calls.push({ stage, requestId: request.requestId, prompt: request.prompt });
    const remaining = this.failOnce.get(stage) ?? 0;
    if (remaining > 0) {
      this.failOnce.set(stage, remaining - 1);
      throw new ProviderError("synthetic provider failure", "RATE_LIMITED", true);
    }
    return structuredClone(this.respond(stage, this.calls.filter((call) => call.stage === stage).length - 1));
  }

  async *streamText() {}

  async cancel() {}

  count(stage) {
    return this.calls.filter((call) => call.stage === stage).length;
  }
}

class CountingCache {
  constructor() {
    this.values = new Map();
    this.writes = 0;
    this.deletes = [];
  }

  get(key) {
    const value = this.values.get(key);
    return value === undefined ? undefined : structuredClone(value);
  }

  putIfAbsent(key, value) {
    if (!this.values.has(key)) {
      this.writes += 1;
      this.values.set(key, structuredClone(value));
    }
    return structuredClone(this.values.get(key));
  }

  delete(key) {
    this.deletes.push(key);
    this.values.delete(key);
  }
}

function createAdapter(overrides = {}) {
  const provider = overrides.provider ?? new CountingProvider();
  const authCalls = overrides.authCalls ?? [];
  const options = {
    provider,
    providerId: "synthetic-provider",
    modelId: "synthetic-model",
    purpose: "draft",
    stageVersion: "stage-1",
    pipeline: {
      prompts: prompts(),
      promptVersion: "prompt-1",
      rulePackVersion: "rules-1",
    },
    authorize: async (request) => {
      authCalls.push(request);
      return { allowed: true };
    },
    now: () => new Date(FIXED_TIME),
    ...overrides,
    provider,
    authCalls: undefined,
  };
  return { adapter: new PipelineAdapter(options), provider, authCalls };
}

function context() {
  return mockPipelineContext("synthetic-project", "Synthetic patent title");
}

function contextForProject(projectId) {
  return mockPipelineContext(projectId, "Synthetic patent title");
}

function answerByStage(provider, stage) {
  return provider.calls.filter((call) => call.stage === stage).length;
}

test("V6-16: identical snapshots resume every stage without provider or cache writes", async () => {
  const cache = new CountingCache();
  const { adapter, provider } = createAdapter({ cache });
  const input = context();

  const [first, concurrent] = await Promise.all([
    adapter.run(input, "draft_claims"),
    adapter.run(input, "draft_claims"),
  ]);
  const writesAfterFirstRun = cache.writes;
  const callsAfterFirstRun = provider.calls.length;
  const second = await adapter.run(input, "draft_claims");

  assert.deepEqual(concurrent.context.results.draft_claims.output, first.context.results.draft_claims.output);
  assert.equal(second.context.results.extract_invention_facts.meta.cached, true);
  assert.equal(provider.calls.length, callsAfterFirstRun);
  assert.equal(cache.writes, writesAfterFirstRun);
  assert.equal(first.testOutput, false);
});

test("V6-16: changing user facts invalidates dependent stages and keeps unrelated upstream branches cached", async () => {
  const { adapter, provider } = createAdapter();
  const original = context();
  await adapter.run(original, "draft_claims");
  const initialCounts = new Map(STAGES.map((stage) => [stage.id, provider.count(stage.id)]));

  const changed = structuredClone(original);
  changed.userAnswers.q1 = "Synthetic confirmed connection structure";
  await adapter.run(changed, "draft_claims");

  for (const stage of ["ingest_sources", "extract_invention_facts", "detect_conflicts", "assess_readiness", "generate_intake_questions"]) {
    assert.equal(provider.count(stage), initialCounts.get(stage), `${stage} should remain cached`);
  }
  for (const stage of ["propose_claim_strategy", "draft_claim_skeleton", "draft_claims"]) {
    assert.equal(provider.count(stage), initialCounts.get(stage) + 1, `${stage} should rerun downstream of the changed answer`);
  }
  const countsAfterInvalidation = provider.calls.length;
  const resumed = await adapter.run(changed, "draft_claims");
  assert.equal(provider.calls.length, countsAfterInvalidation, "the changed snapshot should itself resume on the next call");
  assert.equal(resumed.context.results.extract_invention_facts.meta.cached, true, "restored upstream checkpoints report cached=true");
});

test("V6-16: changing source facts invalidates ingest and dependent stages", async () => {
  const { adapter, provider } = createAdapter();
  const original = context();
  await adapter.run(original, "draft_claims");
  const counts = new Map(STAGES.map((stage) => [stage.id, provider.count(stage.id)]));

  const changed = structuredClone(original);
  changed.chunks[0].text = "合成材料修改后的结构描述。";
  const changedResult = await adapter.run(changed, "draft_claims");

  assert.equal(changedResult.context.results.ingest_sources.output.chunks[0].text, changed.chunks[0].text);
  for (const stage of ["extract_invention_facts", "draft_claims"]) {
    assert.equal(provider.count(stage), counts.get(stage) + 1, `${stage} should rerun for changed facts`);
  }
  const callsAfterChange = provider.calls.length;
  const resumed = await adapter.run(changed, "draft_claims");
  assert.equal(provider.calls.length, callsAfterChange, "changed snapshot must be resumable");
  assert.deepEqual(resumed.context.results.draft_claims.output, changedResult.context.results.draft_claims.output);
});

test("V6-16: changing one branch leaves a non-dependent branch cached", async () => {
  const { adapter, provider } = createAdapter();
  const original = context();
  await adapter.run(original, "detect_conflicts");
  const extractCalls = provider.count("extract_invention_facts");
  const detectCalls = provider.count("detect_conflicts");

  const changed = structuredClone(original);
  changed.userAnswers.q1 = "Synthetic confirmed connection structure";
  await adapter.run(changed, "merge_user_confirmations");
  const callsAfterMerge = provider.calls.length;
  await adapter.run(changed, "detect_conflicts");

  assert.equal(provider.count("extract_invention_facts"), extractCalls, "the fact-extraction branch is unaffected");
  assert.equal(provider.count("detect_conflicts"), detectCalls, "the conflict branch is unaffected");
  assert.equal(provider.calls.length, callsAfterMerge);
});

test("V6-16: provider, model, prompt, rule-pack, and stage-version changes all miss cache", async () => {
  const cache = new MemoryPipelineStageCache();
  const base = createAdapter({ cache });
  await base.adapter.run(context(), "extract_invention_facts");
  assert.equal(base.provider.count("extract_invention_facts"), 1);

  const variants = [
    { providerId: "synthetic-provider-b" },
    { modelId: "synthetic-model-b" },
    { pipeline: { prompts: prompts(), promptVersion: "prompt-2", rulePackVersion: "rules-1" } },
    { pipeline: { prompts: prompts(), promptVersion: "prompt-1", rulePackVersion: "rules-2" } },
    { stageVersion: "stage-2" },
  ];
  for (const variant of variants) {
    const run = createAdapter({ cache, ...variant });
    await run.adapter.run(context(), "extract_invention_facts");
    assert.equal(run.provider.count("extract_invention_facts"), 1, `${JSON.stringify(variant)} must miss`);
  }
});

test("V6-16: cache keys are scoped to a project when a cache is shared", async () => {
  const cache = new MemoryPipelineStageCache();
  const first = createAdapter({ cache });
  await first.adapter.run(context(), "extract_invention_facts");
  const otherProject = createAdapter({ cache });
  await otherProject.adapter.run(contextForProject("second-project"), "extract_invention_facts");
  assert.equal(first.provider.count("extract_invention_facts"), 1);
  assert.equal(otherProject.provider.count("extract_invention_facts"), 1);
});

test("V6-16: authorization refusal surfaces its contract code before any provider call", async () => {
  const provider = new CountingProvider();
  const authCalls = [];
  const { adapter } = createAdapter({
    provider,
    authCalls,
    authorize: async (request) => {
      authCalls.push(request);
      return { allowed: false, code: "RELEASE_GATE_CLOSED", message: "Synthetic release gate is closed." };
    },
  });

  await assert.rejects(adapter.run(context(), "extract_invention_facts"), (error) => {
    assert.ok(error instanceof PipelineAdapterError);
    assert.equal(error.code, "RELEASE_GATE_CLOSED");
    assert.equal(error.stage, "extract_invention_facts");
    return true;
  });
  assert.equal(provider.calls.length, 0);
  assert.equal(authCalls.length, 1);
  assert.equal(authCalls[0].providerId, "synthetic-provider");
  assert.equal(authCalls[0].modelId, "synthetic-model");
  assert.equal(authCalls[0].purpose, "draft");
  assert.match(authCalls[0].scopeHash, /^[0-9a-f]{64}$/);
});

test("V6-16: autoConfirm providers are rejected before an invocation can start", () => {
  const provider = new CountingProvider();
  provider.options = { autoConfirm: true };
  assert.throws(
    () => createAdapter({ provider }),
    (error) => error.code === "RELEASE_GATE_CLOSED" && /autoConfirm/.test(error.message),
  );
  assert.equal(provider.calls.length, 0);
});

test("V6-16: stub execution has truthful test metadata and calls no injected provider", async () => {
  const provider = new CountingProvider();
  const cache = new MemoryPipelineStageCache();
  const input = context();
  const before = structuredClone(input);
  const first = createAdapter({ provider, cache, execution: "stub" });
  const firstResult = await first.adapter.run(input, "extract_invention_facts");

  assert.equal(provider.calls.length, 0);
  assert.deepEqual(input, before);
  assert.equal(firstResult.testOutput, true);
  assert.equal(firstResult.context.results.extract_invention_facts.meta.provider, "mock");
  assert.equal(firstResult.context.results.extract_invention_facts.meta.model, null);
  assert.equal(firstResult.context.results.ingest_sources.meta.provider, "deterministic");
  assert.equal(firstResult.context.results.ingest_sources.meta.model, null);

  const second = createAdapter({ provider, cache, execution: "stub" });
  const cacheHit = await second.adapter.run(context(), "extract_invention_facts");
  assert.equal(second.provider.calls.length, 0);
  assert.equal(cacheHit.testOutput, true);
  assert.equal(cacheHit.context.results.extract_invention_facts.meta.model, null);
  assert.equal(cacheHit.context.results.extract_invention_facts.meta.cached, true);
});

test("V6-16: cache rejects forged provider/model metadata and reports valid hits", async () => {
  for (const field of ["provider", "model"]) {
    const cache = new CountingCache();
    const seed = createAdapter({ cache });
    const original = context();
    await seed.adapter.run(original, "extract_invention_facts");
    const key = [...cache.values.keys()].find((cacheKey) => cache.values.get(cacheKey).stage === "extract_invention_facts");
    const forged = cache.values.get(key);
    forged.result.meta[field] = field === "model" ? "forged-model" : "forged-provider";
    cache.values.set(key, forged);

    const second = createAdapter({ cache });
    const recovered = await second.adapter.run(original, "extract_invention_facts");
    assert.equal(second.provider.count("extract_invention_facts"), 1, `forged ${field} must trigger a provider run`);
    assert.equal(recovered.context.results.extract_invention_facts.meta.provider, "synthetic-provider");
    assert.equal(recovered.context.results.extract_invention_facts.meta.model, "synthetic-model");
    assert.equal(recovered.context.results.extract_invention_facts.meta.cached, false);

    const third = createAdapter({ cache });
    const cacheHit = await third.adapter.run(original, "extract_invention_facts");
    assert.equal(third.provider.calls.length, 0);
    assert.equal(cacheHit.context.results.extract_invention_facts.meta.cached, true);
    assert.equal(cacheHit.context.results.ingest_sources.meta.cached, true);
  }
});

test("V6-16: invalid cache hash is evicted and repaired for subsequent adapters", async () => {
  const cache = new CountingCache();
  const first = createAdapter({ cache });
  const original = context();
  await first.adapter.run(original, "draft_claims");
  const stageKeys = new Map(
    [...cache.values.entries()].map(([key, value]) => [value.stage, key]),
  );
  const poisonedKey = stageKeys.get("extract_invention_facts");
  cache.values.get(poisonedKey).outputHash = "0".repeat(64);
  cache.deletes = [];
  const writesBeforeRepair = cache.writes;

  const recompute = createAdapter({ cache });
  const firstResult = await recompute.adapter.run(original, "draft_claims");
  assert.equal(firstResult.context.results.extract_invention_facts.meta.cached, false);
  assert.equal(recompute.provider.count("extract_invention_facts"), 1);
  assert.ok(cache.deletes.includes(poisonedKey), "invalid cached entry should be evicted before provider recomputation");
  assert.equal(cache.writes, writesBeforeRepair + 1, "only the evicted stage should be rewritten");
  assert.equal(recompute.provider.calls.length, 1, "only the poisoned stage should call its provider again");
  const repaired = cache.values.get(poisonedKey);
  assert.notEqual(repaired.outputHash, "0".repeat(64));

  const reuse = createAdapter({ cache });
  const secondResult = await reuse.adapter.run(original, "draft_claims");
  assert.equal(secondResult.context.results.extract_invention_facts.meta.cached, true);
  assert.equal(reuse.provider.calls.length, 0, "the repaired full snapshot should be reused");
  assert.equal(cache.writes, writesBeforeRepair + 1, "the follow-up adapter should not write another checkpoint");
  for (const stage of STAGES) {
    assert.ok(recompute.provider.count(stage.id) <= 1, `${stage.id} should recompute at most once`);
  }
  assert.equal(recompute.provider.count("extract_invention_facts") + reuse.provider.count("extract_invention_facts"), 1);
});

test("V6-16: failed stage keeps earlier checkpoints and retry runs only that stage and dependents", async () => {
  const provider = new CountingProvider({ failOnce: new Map([["propose_claim_strategy", 1]]) });
  const { adapter } = createAdapter({ provider });
  const input = context();

  await assert.rejects(adapter.run(input, "draft_claims"), (error) => {
    assert.equal(error.code, "RATE_LIMITED");
    assert.equal(error.providerCode, "RATE_LIMITED");
    assert.equal(error.stage, "propose_claim_strategy");
    return true;
  });

  const beforeRetry = new Map(STAGES.map((stage) => [stage.id, provider.count(stage.id)]));
  assert.equal(beforeRetry.get("extract_invention_facts"), 1);
  assert.equal(beforeRetry.get("propose_claim_strategy"), 1);
  assert.equal(beforeRetry.get("draft_claim_skeleton"), 0);
  assert.equal(beforeRetry.get("draft_claims"), 0);

  await adapter.run(input, "draft_claims");
  for (const stage of ["extract_invention_facts", "detect_conflicts", "assess_readiness", "generate_intake_questions"]) {
    assert.equal(provider.count(stage), beforeRetry.get(stage), `${stage} should remain cached during retry`);
  }
  assert.equal(provider.count("propose_claim_strategy"), 2);
  assert.equal(provider.count("draft_claim_skeleton"), 1);
  assert.equal(provider.count("draft_claims"), 1);
});

test("V6-16: schema-invalid output fails after one provider call and retry uses retained checkpoints", async () => {
  const provider = new CountingProvider({
    respond: (stage) => (stage === "extract_invention_facts" ? { facts: [] } : MOCK_STAGE_OUTPUTS[stage]),
  });
  const cache = new CountingCache();
  const { adapter, authCalls } = createAdapter({ provider, cache });

  await assert.rejects(adapter.run(context(), "extract_invention_facts"), (error) => {
    assert.equal(error.code, "PROVIDER_SCHEMA_INVALID");
    assert.equal(error.providerCode, "INVALID_SCHEMA");
    assert.equal(error.stage, "extract_invention_facts");
    return true;
  });
  assert.equal(provider.count("extract_invention_facts"), 1, "the repair request must not reach the provider");
  assert.equal(authCalls.length, 1, "the blocked repair attempt must not request authorization");
  const cachedStages = [...cache.values.values()].map((entry) => entry.stage);
  assert.ok(cachedStages.includes("ingest_sources"), "the successful earlier stage remains cached");
  assert.ok(!cachedStages.includes("extract_invention_facts"), "the failed stage has no cache entry");

  provider.respond = (stage) => MOCK_STAGE_OUTPUTS[stage];
  const result = await adapter.run(context(), "extract_invention_facts");
  assert.equal(result.context.results.ingest_sources !== undefined, true);
  assert.equal(provider.count("extract_invention_facts"), 2);
  assert.equal(authCalls.length, 2);
});

test("V6-16: public calls leave caller inputs untouched", async () => {
  const { adapter } = createAdapter();
  const input = context();
  const before = structuredClone(input);
  const deepFreeze = (value) => {
    if (value && typeof value === "object") {
      for (const child of Object.values(value)) deepFreeze(child);
      Object.freeze(value);
    }
    return value;
  };
  deepFreeze(input);

  await adapter.run(input, "draft_claims");
  assert.deepEqual(input, before);
});
