import assert from "node:assert/strict";
import {
  CONTRACT_VERSION,
  STORES,
  openLocalRepository,
  sha256Hex,
} from "../../../../apps/web/src/v6/lib/repository.ts";
export { STORES };
import {
  DEFAULT_AI_CONFIG,
  grantConsent,
  loadAiView,
  revokeConsent,
} from "../../../../apps/web/src/v6/features/ai/ai.ts";
let MOCK_STAGE_OUTPUTS;

export const ACTOR = Object.freeze({
  tenantId: "11111111-1111-4111-8111-111111111111",
  userId: "22222222-2222-4222-8222-222222222222",
});
export const MATTER_ID = "33333333-3333-4333-8333-333333333333";
export const TARGET_ID = "44444444-4444-4444-8444-444444444444";
export const FIGURE_ID = "55555555-5555-4555-8555-555555555555";
export const SUPPORT_SOURCE_ID = "88888888-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
export const SUPPORT_ASSET_ID = "77777777-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
export const SUPPORT_CHUNK_1 = "99999999-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
export const SUPPORT_CHUNK_2 = "99999999-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
export const SUPPORT_CHUNK_3 = "99999999-aaaa-4aaa-8aaa-aaaaaaaaaaa3";
export const SUPPORT_FACT_1 = "bbbbbbbb-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
export const SUPPORT_FACT_2 = "bbbbbbbb-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
export const SUPPORT_FACT_3 = "bbbbbbbb-aaaa-4aaa-8aaa-aaaaaaaaaaa3";
export const T0 = "2026-11-05T12:00:00.000Z";
export const TEST_PROFILE = DEFAULT_AI_CONFIG.profiles.find((profile) => profile.mode === "platform" && profile.status === "approved");
assert.ok(TEST_PROFILE);

export class MemoryBackend {
  constructor() {
    this.data = new Map(Object.values(STORES).map((name) => [name, new Map()]));
    this.queue = Promise.resolve();
  }

  store(name) {
    const store = this.data.get(name);
    assert.ok(store, `unknown store ${name}`);
    return store;
  }

  transaction(mode, run) {
    if (mode !== "readwrite") return this.runTransaction(run);
    const next = this.queue.then(() => this.runTransaction(run));
    this.queue = next.then(() => undefined, () => undefined);
    return next;
  }

  async runTransaction(run) {
    const snapshot = new Map([...this.data].map(([name, store]) => [name, new Map(store)]));
    const tx = {
      get: async (name, key) => {
        const value = this.store(name).get(key);
        return value === undefined ? undefined : structuredClone(value);
      },
      put: async (name, key, value) => this.store(name).set(key, structuredClone(value)),
      delete: async (name, key) => this.store(name).delete(key),
      getAll: async (name) => [...this.store(name).values()].map((value) => structuredClone(value)),
      getAllByIndex: async (name, index, value) => [...this.store(name).values()]
        .filter((row) => row && typeof row === "object" && row[index] === value)
        .map((row) => structuredClone(row)),
    };
    try {
      return await run(tx);
    } catch (error) {
      this.data = snapshot;
      throw error;
    }
  }

  close() {}
}

export class CountingProvider {
  constructor({ beforeResponse, failStages = new Map(), invalidStages = new Set(), reportCostMinor = 1, respond } = {}) {
    this.calls = [];
    this.beforeResponse = beforeResponse;
    this.failStages = new Map(failStages);
    this.invalidStages = new Set(invalidStages);
    this.reportCostMinor = reportCostMinor;
    this.respond = respond;
  }

  async getCapabilities() {
    return { structuredOutput: true, tools: false, visionInput: false, imageGeneration: false, longContext: true, localAuth: false };
  }

  async listModels() { return []; }

  async generateStructured(request) {
    const call = { stage: request.stage, requestId: request.requestId, prompt: request.prompt };
    this.calls.push(call);
    await this.beforeResponse?.(call, this.calls.length - 1);
    const count = this.failStages.get(request.stage) ?? 0;
    if (count > 0) {
      this.failStages.set(request.stage, count - 1);
      const error = new Error("synthetic rate limit");
      error.code = "RATE_LIMITED";
      throw error;
    }
    if (this.invalidStages.has(request.stage)) return { facts: [] };
    const output = this.respond
      ? this.respond(request.stage, this.calls.length - 1, request)
      : structuredClone(MOCK_STAGE_OUTPUTS[request.stage]);
    const cost = typeof this.reportCostMinor === "function"
      ? this.reportCostMinor(request.stage, this.calls.length - 1)
      : this.reportCostMinor;
    if (cost !== null && output && typeof output === "object") {
      output.metadata = { costMinor: cost };
    }
    return output;
  }

  async *streamText() {}
  async cancel() {}
  count(stage) { return this.calls.filter((call) => call.stage === stage).length; }
}

export async function createFixture({ provider = new CountingProvider(), storage, now = () => new Date(T0), engineOptions = {}, withFacts = false } = {}) {
  MOCK_STAGE_OUTPUTS ??= (await import("../../../../packages/pipeline/src/mock.ts")).MOCK_STAGE_OUTPUTS;
  const { STAGES } = await import("../../../../packages/pipeline/src/stages.ts");
  const promptNames = new Set(["system-core.md", ...STAGES.map((stage) => stage.promptFile).filter(Boolean)]);
  const pipeline = {
    prompts: Object.fromEntries([...promptNames].map((name) => [name, `synthetic prompt ${name}`])),
    promptVersion: "synthetic-prompt-v1",
    rulePackVersion: "synthetic-rules-v1",
  };
  const backend = new MemoryBackend();
  const repository = openLocalRepository(backend);
  const matter = {
    id: MATTER_ID,
    tenantId: ACTOR.tenantId,
    version: 1,
    title: "合成测试案卷",
    status: "active",
    sourceVersion: 1,
    createdBy: ACTOR.userId,
    createdAt: T0,
    updatedAt: T0,
  };
  const target = {
    id: TARGET_ID,
    matterId: MATTER_ID,
    status: "active",
    configVersion: 1,
    draftRevisionId: null,
    figureRevisionId: FIGURE_ID,
  };
  const created = await repository.commit(
    ACTOR,
    {
      contractVersion: CONTRACT_VERSION,
      expectedVersion: 0,
      payload: { matter, targets: [target], assets: [], events: [], blobs: [] },
    },
    { requestId: "66666666-6666-4666-8666-666666666666" },
  );
  assert.equal(created.ok, true, created.ok ? "" : JSON.stringify(created.error));
  const supportSpecs = withFacts
    ? [
        { factId: SUPPORT_FACT_1, statement: "表体、计量部件、控制单元、三模通讯模块", kind: "structure", chunkId: SUPPORT_CHUNK_1, page: 1 },
        { factId: SUPPORT_FACT_2, statement: "蓝牙mesh、470MHz 无线、NB-IoT 三种通讯方式", kind: "structure", chunkId: SUPPORT_CHUNK_2, page: 2 },
        { factId: SUPPORT_FACT_3, statement: "集中抄表效率提升、通讯可靠", kind: "effect", chunkId: SUPPORT_CHUNK_3, page: 3 },
      ]
    : [];
  const supportChunks = [];
  const supportFacts = [];
  for (const [index, spec] of supportSpecs.entries()) {
    const hash = await sha256Hex(new TextEncoder().encode(spec.statement));
    supportChunks.push({
      id: spec.chunkId,
      sourceId: SUPPORT_SOURCE_ID,
      parserVersion: "fixture-parser-v1",
      index,
      kind: "paragraph",
      text: spec.statement,
      hash,
      page: spec.page,
      rect: null,
      ocrConfidence: null,
    });
    supportFacts.push({
      id: spec.factId,
      statement: spec.statement,
      kind: spec.kind,
      status: "user_confirmed",
      refs: [{
        sourceId: SUPPORT_SOURCE_ID,
        chunkId: spec.chunkId,
        chunkHash: hash,
        page: spec.page,
        start: 0,
        end: spec.statement.length,
        quote: spec.statement,
      }],
      confirmedBy: ACTOR.userId,
      confirmedAt: T0,
    });
  }
  await backend.transaction("readwrite", async (tx) => {
    if (withFacts) {
      await tx.put(STORES.blobs, `parse/source/${SUPPORT_SOURCE_ID}`, {
        kind: "parse.source",
        source: {
          id: SUPPORT_SOURCE_ID,
          matterId: MATTER_ID,
          assetId: SUPPORT_ASSET_ID,
          retiredAt: null,
          parseStatus: "parsed",
          parserVersion: "fixture-parser-v1",
          pageCount: 3,
          ocrNeeded: false,
        },
        currentJobId: null,
        jobIds: [],
        chunkSets: [],
      });
      await tx.put(STORES.blobs, `parse/chunks/${SUPPORT_SOURCE_ID}`, {
        kind: "parse.chunks",
        sourceId: SUPPORT_SOURCE_ID,
        parserVersion: "fixture-parser-v1",
        jobId: "12121212-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
        pageCount: 3,
        createdAt: T0,
        chunks: supportChunks,
      });
    }
    await tx.put(STORES.blobs, `intake/snapshot/${MATTER_ID}/1`, {
      kind: "intake.snapshot",
      snapshot: {
        matterId: MATTER_ID,
        version: 1,
        sourceIds: withFacts ? [SUPPORT_SOURCE_ID] : [],
        facts: supportFacts,
        conflicts: [],
        answers: {
          problem: "",
          difference: "",
          inventorIds: [],
          disclosure: null,
          maturity: null,
          disclosureDetail: null,
        },
        parties: [],
        createdBy: ACTOR.userId,
        createdAt: T0,
      },
    });
  });

  const profile = TEST_PROFILE;
  const view = await loadAiView(repository, ACTOR, MATTER_ID, { targetId: TARGET_ID, config: DEFAULT_AI_CONFIG, now: () => T0 });
  assert.equal(view.ok, true, view.ok ? "" : JSON.stringify(view.error));
  const grant = await grantConsent(
    repository,
    ACTOR,
    MATTER_ID,
    {
      providerProfileId: profile.id,
      providerProfileVersion: profile.version,
      purpose: "draft",
      targetId: TARGET_ID,
      manifestHash: view.data.manifest.payloadManifestHash,
      scope: view.data.manifest.scope,
    },
    { config: DEFAULT_AI_CONFIG, now: () => T0, requestKey: "generation-consent" },
  );
  assert.equal(grant.ok, true, grant.ok ? "" : JSON.stringify(grant.error));

  const { createGenerationEngine, MemoryGenerationStore } = await import(
    "../../../../apps/web/src/v6/features/generation/generation.ts"
  );
  const generationStore = storage ?? new MemoryGenerationStore(ACTOR);
  const engine = createGenerationEngine({
    repository,
    actor: ACTOR,
    storage: generationStore,
    provider,
    profileId: profile.id,
    profileVersion: profile.version,
    consentId: grant.data.consent.id,
    config: DEFAULT_AI_CONFIG,
    pipeline,
    limits: { maxInputTokens: 100000, maxOutputTokens: 20000, maxCostMinor: 100000, maxDurationSeconds: 300 },
    now,
    ...engineOptions,
  });
  return { backend, repository, engine, provider, storage: generationStore, consent: grant.data.consent, matter, target, pipeline };
}

export async function revokeFixtureConsent(fixture, now = () => new Date("2026-11-05T13:00:00.000Z")) {
  return revokeConsent(
    fixture.repository,
    ACTOR,
    MATTER_ID,
    { consentId: fixture.consent.id },
    { now: () => now().toISOString() },
  );
}

export async function waitForJob(engine, jobId, timeoutMs = 3000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const result = await engine.get(jobId);
    assert.equal(result.ok, true, result.ok ? "" : JSON.stringify(result.error));
    if (["succeeded", "failed", "cancelled", "interrupted"].includes(result.data.job.state)) return result.data;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`job ${jobId} did not reach a terminal state`);
}
