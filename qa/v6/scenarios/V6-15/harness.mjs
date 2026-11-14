/**
 * V6-15 scenario harness.
 *
 * Only synthetic fixtures: an in-memory backend implementing the IndexedDB
 * adapter contract, a seeded active matter with source assets, parse rows, an
 * intake snapshot and two targets. Nothing here imports intake, a provider
 * adapter, a key or the network. The AI module reads these rows structurally,
 * exactly as it would in the browser.
 */
import assert from "node:assert/strict";

import {
  CONTRACT_VERSION,
  STORES,
  openLocalRepository,
  sha256Hex,
} from "../../../../apps/web/src/v6/lib/repository.ts";
import {
  DEFAULT_AI_CONFIG,
  loadAiView,
} from "../../../../apps/web/src/v6/features/ai/ai.ts";

export const TENANT_A = "11111111-1111-4111-8111-111111111111";
export const TENANT_C = "44444444-4444-4444-8444-444444444444";
export const USER_A = "22222222-2222-4222-8222-222222222221";
export const USER_B = "22222222-2222-4222-8222-222222222222";
export const USER_C = "33333333-3333-4333-8333-333333333331";

export const ACTOR_A = Object.freeze({ tenantId: TENANT_A, userId: USER_A });
export const ACTOR_B = Object.freeze({ tenantId: TENANT_A, userId: USER_B });
export const ACTOR_C = Object.freeze({ tenantId: TENANT_C, userId: USER_C });

export const MATTER_A = "55555555-5555-4555-8555-555555555551";
export const MATTER_B = "55555555-5555-4555-8555-555555555552";
export const TARGET_A = "66666666-6666-4666-8666-666666666661";
export const TARGET_B = "66666666-6666-4666-8666-666666666662";
export const ASSET_1 = "77777777-7777-4777-8777-777777777771";
export const ASSET_2 = "77777777-7777-4777-8777-777777777772";
export const ASSET_3 = "77777777-7777-4777-8777-777777777773";
export const SOURCE_1 = "88888888-8888-4888-8888-888888888881";
export const SOURCE_2 = "88888888-8888-4888-8888-888888888882";
export const SOURCE_3 = "88888888-8888-4888-8888-888888888883";
export const CHUNK_1 = "99999999-9999-4999-8999-999999999991";
export const CHUNK_2 = "99999999-9999-4999-8999-999999999992";
export const CHUNK_3 = "99999999-9999-4999-8999-999999999993";
export const FACT_1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
export const FACT_2 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
export const DRAFT_1 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
export const DRAFT_2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";
export const FIG_1 = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
export const FIG_2 = "cccccccc-cccc-4ccc-8ccc-ccccccccccc2";
export const JOB_ID = "dddddddd-dddd-4ddd-8ddd-ddddddddddd1";
export const INVOCATION_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1";
export const REQUEST_ID = "dfdfdfdf-dfdf-4dfd-8fdf-dfdfdfdfdfdf";
export const ADD_REQUEST_ID = "dededede-dede-4ede-8ede-dededededede";

export const T0 = "2026-11-01T00:00:00.000Z";
export const T1 = "2026-11-01T01:00:00.000Z";
export const T2 = "2026-11-01T02:00:00.000Z";
export const T3 = "2026-11-01T03:00:00.000Z";

export const CHUNK_MARKER = "CHUNK-CONTENT-MUST-NOT-LEAK";
export const FACT_MARKER = "FACT-CONTENT-MUST-NOT-LEAK";
export const PROMPT_MARKER = "PROMPT-MUST-NOT-LEAK";
export const KEY_MARKER = "sk-KEY-MUST-NOT-LEAK";
export const CASE_MARKER = "CASE-CONTENT-MUST-NOT-LEAK";

const GOOD_PROFILE = DEFAULT_AI_CONFIG.profiles.find(
  (profile) => profile.mode === "platform" && profile.status === "approved",
);
assert.ok(GOOD_PROFILE, "the synthetic config must contain an approved platform profile");
export const GOOD_PROFILE_ID = GOOD_PROFILE.id;
export const GOOD_PROFILE_VERSION = GOOD_PROFILE.version;
const UNKNOWN_PROFILE = DEFAULT_AI_CONFIG.profiles.find(
  (profile) => profile.mode === "platform" && profile.status !== "approved",
);
assert.ok(UNKNOWN_PROFILE, "the synthetic config must contain an incomplete platform profile");
export const UNKNOWN_PROFILE_ID = UNKNOWN_PROFILE.id;
export const UNKNOWN_PROFILE_VERSION = UNKNOWN_PROFILE.version;

export const ASSET_SPECS = Object.freeze([
  Object.freeze({
    id: ASSET_1,
    name: "fixture-a.txt",
    sourceId: SOURCE_1,
    chunkId: CHUNK_1,
    pageCount: 3,
    text: `synthetic source A ${CHUNK_MARKER}`,
  }),
  Object.freeze({
    id: ASSET_2,
    name: "fixture-b.txt",
    sourceId: SOURCE_2,
    chunkId: CHUNK_2,
    pageCount: 5,
    text: `synthetic source B ${CHUNK_MARKER}`,
  }),
  Object.freeze({
    id: ASSET_3,
    name: "fixture-c.txt",
    sourceId: SOURCE_3,
    chunkId: CHUNK_3,
    pageCount: 7,
    text: `synthetic source C ${CHUNK_MARKER}`,
  }),
]);

/** The same backend contract the IndexedDB adapter provides, in memory. */
export class MemoryBackend {
  constructor() {
    this.data = new Map(Object.values(STORES).map((name) => [name, new Map()]));
    this.failPut = null;
    this.closed = false;
    this.queue = Promise.resolve();
  }

  /** One hook can fail a specific put (for example, the idempotency finalize). */
  setPutFault(fn) {
    this.failPut = fn;
    return this;
  }

  store(name) {
    const store = this.data.get(name);
    if (!store) throw new Error(`unknown store ${name}`);
    return store;
  }

  transaction(mode, run) {
    if (this.closed) return Promise.reject(new Error("backend is closed"));
    if (mode === "readwrite") {
      const next = this.queue.then(() => this.runTransaction(mode, run));
      this.queue = next.then(
        () => undefined,
        () => undefined,
      );
      return next;
    }
    return this.runTransaction(mode, run);
  }

  async runTransaction(mode, run) {
    const snapshot = new Map([...this.data].map(([name, store]) => [name, new Map(store)]));
    const tx = {
      get: async (name, key) => {
        const value = this.store(name).get(key);
        return value === undefined ? undefined : structuredClone(value);
      },
      put: async (name, key, value) => {
        const fault = this.failPut?.({ store: name, key, value, mode }) ?? null;
        if (fault) throw fault;
        this.store(name).set(key, structuredClone(value));
      },
      delete: async (name, key) => {
        this.store(name).delete(key);
      },
      getAll: async (name) => [...this.store(name).values()].map((value) => structuredClone(value)),
      getAllByIndex: async (name, index, value) =>
        [...this.store(name).values()]
          .filter((row) => row !== null && typeof row === "object" && row[index] === value)
          .map((row) => structuredClone(row)),
    };
    try {
      return await run(tx);
    } catch (error) {
      this.data = snapshot;
      throw error;
    }
  }

  close() {
    this.closed = true;
  }
}

export function storedRows(backend, kind) {
  return [...backend.store(STORES.blobs).values()].filter((value) => value?.kind === kind);
}

export function allBlobRows(backend) {
  return [...backend.store(STORES.blobs).values()];
}

function sourceKey(sourceId) {
  return `parse/source/${sourceId}`;
}

function chunksKey(sourceId) {
  return `parse/chunks/${sourceId}`;
}

function snapshotKey(matterId, version) {
  return `intake/snapshot/${matterId}/${version}`;
}

async function parseRowsFor(spec, matterId) {
  const bytes = new TextEncoder().encode(spec.text);
  const hash = await sha256Hex(bytes);
  const chunk = {
    id: spec.chunkId,
    text: `${spec.text} ${CHUNK_MARKER}`,
    hash: await sha256Hex(new TextEncoder().encode(`${spec.text} ${CHUNK_MARKER}`)),
    page: 1,
  };
  return {
    bytes,
    hash,
    entries: [
      {
        key: sourceKey(spec.sourceId),
        value: {
          kind: "parse.source",
          source: {
            id: spec.sourceId,
            matterId,
            assetId: spec.id,
            retiredAt: null,
            parseStatus: "parsed",
            parserVersion: "fixture-parser-v1",
            pageCount: spec.pageCount,
            ocrNeeded: false,
          },
          currentJobId: JOB_ID,
          jobIds: [JOB_ID],
          chunkSets: [],
        },
      },
      {
        key: chunksKey(spec.sourceId),
        value: {
          kind: "parse.chunks",
          sourceId: spec.sourceId,
          parserVersion: "fixture-parser-v1",
          jobId: JOB_ID,
          pageCount: spec.pageCount,
          createdAt: T0,
          chunks: [chunk],
        },
      },
    ],
  };
}

/**
 * Create the synthetic matter. `withParse: false` leaves page counts and chunks
 * unknown; `withSnapshot: false` leaves the matter with zero saved facts.
 */
export async function seed({
  assets = 2,
  targets = 2,
  withParse = true,
  withSnapshot = true,
  archived = false,
  title = "V6-15 合成案卷 A",
} = {}) {
  const backend = new MemoryBackend();
  const repository = openLocalRepository(backend);
  const specs = ASSET_SPECS.slice(0, assets);
  const parsed = await Promise.all(specs.map((spec) => parseRowsFor(spec, MATTER_A)));
  const assetRecords = specs.map((spec, index) => ({
    id: spec.id,
    tenantId: TENANT_A,
    matterId: MATTER_A,
    serviceOrderId: null,
    purpose: "source",
    originalName: spec.name,
    mime: "text/plain",
    byteLength: parsed[index].bytes.byteLength,
    sha256: parsed[index].hash,
    state: "available",
    objectKey: `local/${TENANT_A}/${MATTER_A}/${spec.name}`,
    createdAt: T0,
  }));
  const targetRecords = [];
  if (targets >= 1) {
    targetRecords.push({
      id: TARGET_A,
      matterId: MATTER_A,
      status: "active",
      configVersion: 1,
      draftRevisionId: DRAFT_1,
      figureRevisionId: FIG_1,
    });
  }
  if (targets >= 2) {
    targetRecords.push({
      id: TARGET_B,
      matterId: MATTER_A,
      status: "active",
      configVersion: 1,
      draftRevisionId: DRAFT_2,
      figureRevisionId: FIG_2,
    });
  }
  const matter = {
    id: MATTER_A,
    tenantId: TENANT_A,
    version: 1,
    title,
    status: archived ? "archived" : "active",
    sourceVersion: 1,
    createdBy: USER_A,
    createdAt: T0,
    updatedAt: T0,
  };
  const created = await repository.commit(
    ACTOR_A,
    {
      contractVersion: CONTRACT_VERSION,
      expectedVersion: 0,
      payload: {
        matter,
        targets: targetRecords,
        assets: assetRecords,
        events: [],
        blobs: specs.map((spec, index) => ({
          assetId: spec.id,
          bytes: parsed[index].bytes,
          sha256: parsed[index].hash,
          byteLength: parsed[index].bytes.byteLength,
        })),
      },
    },
    { requestId: REQUEST_ID },
  );
  assert.equal(created.ok, true, created.ok ? "" : JSON.stringify(created.error));

  await backend.transaction("readwrite", async (tx) => {
    if (withParse) {
      for (const row of parsed) {
        for (const entry of row.entries) await tx.put(STORES.blobs, entry.key, entry.value);
      }
    }
    if (withSnapshot) {
      await tx.put(STORES.blobs, snapshotKey(MATTER_A, 1), {
        kind: "intake.snapshot",
        snapshot: {
          matterId: MATTER_A,
          version: 1,
          sourceIds: specs.map((spec) => spec.sourceId),
          facts: [
            { id: FACT_1, kind: "fact", label: "合成事实一", value: `${FACT_MARKER}-1` },
            { id: FACT_2, kind: "fact", label: "合成事实二", value: `${FACT_MARKER}-2` },
          ],
          conflicts: [],
          answers: {},
          parties: [],
        },
      });
    }
  });

  return { backend, repository, specs, assets: assetRecords, targets: targetRecords, matter };
}

/** Another matter for the same actor, used to prove idempotency is not per-matter. */
export async function createSecondMatter(repository) {
  const matter = {
    id: MATTER_B,
    tenantId: TENANT_A,
    version: 1,
    title: "V6-15 合成案卷 B",
    status: "active",
    sourceVersion: 1,
    createdBy: USER_A,
    createdAt: T0,
    updatedAt: T0,
  };
  const created = await repository.commit(
    ACTOR_A,
    {
      contractVersion: CONTRACT_VERSION,
      expectedVersion: 0,
      payload: { matter, targets: [], assets: [], events: [], blobs: [] },
    },
    { requestId: "acacacac-acac-4cac-8cac-acacacacacac" },
  );
  assert.equal(created.ok, true, created.ok ? "" : JSON.stringify(created.error));
  return matter;
}

/** Add one available source file and (optionally) its parse rows. */
export async function addSourceAsset(
  repository,
  backend,
  {
    id = ASSET_3,
    name = "fixture-c.txt",
    pageCount = 7,
    chunkId = CHUNK_3,
    withParse = true,
  } = {},
) {
  const loaded = await repository.loadMatter(ACTOR_A, MATTER_A);
  assert.equal(loaded.ok, true, loaded.ok ? "" : JSON.stringify(loaded.error));
  const spec = ASSET_SPECS.find((candidate) => candidate.id === id) ?? {
    id,
    name,
    sourceId: SOURCE_3,
    chunkId,
    pageCount,
    text: `synthetic source ${name}`,
  };
  const parsed = await parseRowsFor(spec, MATTER_A);
  const asset = {
    id: spec.id,
    tenantId: TENANT_A,
    matterId: MATTER_A,
    serviceOrderId: null,
    purpose: "source",
    originalName: spec.name,
    mime: "text/plain",
    byteLength: parsed.bytes.byteLength,
    sha256: parsed.hash,
    state: "available",
    objectKey: `local/${TENANT_A}/${MATTER_A}/${spec.name}`,
    createdAt: T1,
  };
  const committed = await repository.commit(
    ACTOR_A,
    {
      contractVersion: CONTRACT_VERSION,
      expectedVersion: loaded.data.data.matter.version,
      payload: {
        matter: { ...loaded.data.data.matter, version: loaded.data.data.matter.version + 1, updatedAt: T1 },
        targets: loaded.data.data.targets,
        assets: [...loaded.data.data.assets, asset],
        events: [],
        blobs: [
          { assetId: asset.id, bytes: parsed.bytes, sha256: asset.sha256, byteLength: asset.byteLength },
        ],
      },
    },
    { requestId: ADD_REQUEST_ID },
  );
  assert.equal(committed.ok, true, committed.ok ? "" : JSON.stringify(committed.error));
  if (withParse) {
    await backend.transaction("readwrite", async (tx) => {
      for (const entry of parsed.entries) await tx.put(STORES.blobs, entry.key, entry.value);
    });
  }
  return asset;
}

export async function archiveMatter(repository, now = T2) {
  const loaded = await repository.loadMatter(ACTOR_A, MATTER_A);
  assert.equal(loaded.ok, true);
  const committed = await repository.commit(
    ACTOR_A,
    {
      contractVersion: CONTRACT_VERSION,
      expectedVersion: loaded.data.data.matter.version,
      payload: {
        matter: {
          ...loaded.data.data.matter,
          version: loaded.data.data.matter.version + 1,
          status: "archived",
          updatedAt: now,
        },
        targets: loaded.data.data.targets,
        assets: loaded.data.data.assets,
        events: [],
        blobs: [],
      },
    },
    { requestId: "abababab-abab-4bab-8bab-abababababab" },
  );
  assert.equal(committed.ok, true, committed.ok ? "" : JSON.stringify(committed.error));
}

/** Store a contract-shaped invocation with extra prompt/content/key fields. */
export async function seedInvocation(backend, overrides = {}) {
  const id = overrides.id ?? INVOCATION_ID;
  const invocation = {
    id,
    jobId: JOB_ID,
    stage: "extract",
    attempt: 0,
    providerProfileId: GOOD_PROFILE_ID,
    modelId: "fixture-model-a",
    consentId: null,
    requestHash: "a".repeat(64),
    inputTokens: 12,
    outputTokens: 34,
    costMinor: 7,
    currency: "USD",
    usageUnknown: false,
    status: "succeeded",
    prompt: `${PROMPT_MARKER} synthetic prompt`,
    content: `${CASE_MARKER} synthetic case body`,
    apiKey: KEY_MARKER,
    ...overrides,
  };
  await backend.transaction("readwrite", async (tx) => {
    // The generation engine is the only writer of invocations: they live in its job record.
    await tx.put(STORES.blobs, `generation/${TENANT_A}/${USER_A}/job/${JOB_ID}`, {
      kind: "generation.job",
      tenantId: TENANT_A,
      actorId: USER_A,
      matterId: MATTER_A,
      targetId: TARGET_A,
      context: { chunks: [{ text: `${CASE_MARKER} synthetic case body` }] },
      invocations: [invocation],
    });
  });
  return invocation;
}

export async function eventsOf(repository, actor = ACTOR_A, matterId = MATTER_A) {
  const listed = await repository.listEvents(actor, matterId);
  assert.equal(listed.ok, true, listed.ok ? "" : JSON.stringify(listed.error));
  return listed.data.items;
}

export function consentEvents(events) {
  return events.filter(
    (event) => event.action === "consent.granted" || event.action === "consent.revoked",
  );
}

export async function matterRecord(repository, actor = ACTOR_A, matterId = MATTER_A) {
  const loaded = await repository.loadMatter(actor, matterId);
  assert.equal(loaded.ok, true, loaded.ok ? "" : JSON.stringify(loaded.error));
  return loaded.data.data.matter;
}

/** A ready view, or a loud failure naming the module error. */
export async function readyView(repository, actor = ACTOR_A, options = {}) {
  const result = await loadView(repository, actor, MATTER_A, options);
  assert.equal(result.ok, true, result.ok ? "" : JSON.stringify(result.error));
  assert.equal(result.data.kind, "ready");
  return result.data;
}

export async function loadView(repository, actor = ACTOR_A, matterId = MATTER_A, options = {}) {
  return loadAiView(repository, actor, matterId, options);
}

export function grantInput(view, overrides = {}) {
  return {
    providerProfileId: GOOD_PROFILE_ID,
    providerProfileVersion: GOOD_PROFILE_VERSION,
    purpose: "extract",
    targetId: view.manifest.targetId,
    manifestHash: view.manifest.payloadManifestHash,
    scope: view.manifest.scope,
    expiresAt: null,
    ...overrides,
  };
}

/** Copy the synthetic config with one platform profile field changed. */
export function configWithProfilePatch(profileId, patch) {
  return {
    ...DEFAULT_AI_CONFIG,
    profiles: DEFAULT_AI_CONFIG.profiles.map((profile) =>
      profile.id === profileId ? { ...profile, ...patch } : profile,
    ),
  };
}

export function configWithProfiles(profiles) {
  return { ...DEFAULT_AI_CONFIG, profiles };
}
