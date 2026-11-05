import assert from "node:assert/strict";
import { register } from "tsx/esm/api";

register();

const [contracts, repositoryModule, generationModule, parseModule, reviewModule] = await Promise.all([
  import("../../../../packages/contracts/src/index.ts"),
  import("../../../../apps/web/src/v6/lib/repository.ts"),
  import("../../../../apps/web/src/v6/features/generation/generation.ts"),
  import("../../../../apps/web/src/v6/features/sources/parse.ts"),
  import("../../../../apps/web/src/v6/features/draft/Review.tsx"),
]);

export const ACTOR = Object.freeze({
  tenantId: "11111111-1111-4111-8111-111111111111",
  userId: "22222222-2222-4222-8222-222222222222",
});
export const MATTER_ID = "33333333-3333-4333-8333-333333333333";
export const TARGET_ID = "44444444-4444-4444-8444-444444444444";
export const FIGURE_ID = "55555555-5555-4555-8555-555555555555";
export const CLAIM_ID = "66666666-6666-4666-8666-666666666661";
export const PARAGRAPH_ID = "77777777-7777-4777-8777-777777777771";
export const PARAGRAPH_IDS = [
  PARAGRAPH_ID,
  "77777777-7777-4777-8777-777777777772",
  "77777777-7777-4777-8777-777777777773",
  "77777777-7777-4777-8777-777777777774",
  "77777777-7777-4777-8777-777777777775",
];
export const FEATURE_ID = "88888888-8888-4888-8888-888888888881";
export const FACT_ID = "99999999-9999-4999-8999-999999999991";
export const ASSET_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
export const SOURCE_ID = await parseModule.sourceIdFor(ASSET_ID);
export const CHUNK_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
export const CHUNK_TEXT = "温控装置接收热量信号";
export const CHUNK_HASH = await repositoryModule.sha256Hex(new TextEncoder().encode(CHUNK_TEXT));
export const T0 = "2026-11-05T12:00:00.000Z";
export const QUOTE = "热量";
export const SOURCE_REF = Object.freeze({
  sourceId: SOURCE_ID,
  chunkId: CHUNK_ID,
  chunkHash: CHUNK_HASH,
  page: 1,
  start: 6,
  end: 8,
  quote: QUOTE,
});

let uuidCounter = 0;
export function nextUuid() {
  uuidCounter += 1;
  return `dddddddd-dddd-4ddd-8ddd-${String(uuidCounter).padStart(12, "0")}`;
}

export class MemoryBackend {
  constructor() {
    this.data = new Map(Object.values(repositoryModule.STORES).map((name) => [name, new Map()]));
    this.queue = Promise.resolve();
    this.failPut = null;
    this.failRead = null;
    this.readCount = 0;
  }

  setPutFault(fault) {
    this.failPut = fault;
    return this;
  }

  /** Reject the next read-only transaction(s); the counter resets on arming. */
  setReadFault(fault) {
    this.failRead = fault;
    this.readCount = 0;
    return this;
  }

  transaction(mode, run) {
    if (mode !== "readwrite") {
      if (this.failRead) {
        this.readCount += 1;
        const failure = this.failRead({ count: this.readCount }) ?? null;
        if (failure) {
          this.failRead = null;
          return Promise.reject(failure);
        }
      }
      return this.runTransaction(run);
    }
    const next = this.queue.then(() => this.runTransaction(run));
    this.queue = next.then(() => undefined, () => undefined);
    return next;
  }

  async runTransaction(run) {
    const before = new Map([...this.data].map(([name, store]) => [name, new Map(store)]));
    const tx = {
      get: async (store, key) => {
        const value = this.data.get(store).get(key);
        return value === undefined ? undefined : structuredClone(value);
      },
      put: async (store, key, value) => {
        const fault = this.failPut?.({ store, key, value }) ?? null;
        if (fault) throw fault;
        this.data.get(store).set(key, structuredClone(value));
      },
      delete: async (store, key) => this.data.get(store).delete(key),
      getAll: async (store) => [...this.data.get(store).values()].map((value) => structuredClone(value)),
      getAllByIndex: async (store, index, value) => [...this.data.get(store).values()]
        .filter((row) => row && typeof row === "object" && row[index] === value)
        .map((row) => structuredClone(row)),
    };
    try {
      return await run(tx);
    } catch (error) {
      this.data = before;
      throw error;
    }
  }

  close() {}
}

export function makeFact() {
  return {
    id: FACT_ID,
    statement: "温控装置接收热量信号",
    kind: "structure",
    status: "source_backed",
    refs: [structuredClone(SOURCE_REF)],
    confirmedBy: ACTOR.userId,
    confirmedAt: T0,
  };
}

export function makeAst({ sourceRef = SOURCE_REF, paragraphText = "温控装置接收热量信号。", paragraphCount = 1 } = {}) {
  const paragraphs = Array.from({ length: paragraphCount }, (_, index) => ({
    id: PARAGRAPH_IDS[index],
    text: index === 0 ? paragraphText : `合成 AI 段落 ${index + 1}。`,
    origin: "ai",
    sourceRefs: index === 0 && sourceRef ? [structuredClone(sourceRef)] : [],
    factIds: index === 0 ? [FACT_ID] : [],
    figureIds: [],
    generationJobId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc1",
  }));
  return {
    schemaVersion: "draft.v1",
    language: "zh-CN",
    title: "合成草稿",
    claims: [{
      id: CLAIM_ID,
      number: 1,
      dependsOn: [],
      paragraphs,
      features: [{
        id: FEATURE_ID,
        text: "温控装置",
        factIds: [FACT_ID],
        supportParagraphIds: paragraphs.map((paragraph) => paragraph.id),
        status: "supported",
      }],
    }],
    sections: [],
  };
}

export async function makeFixture({ sourceRef = SOURCE_REF, withDraft = true, paragraphCount = 1 } = {}) {
  const backend = new MemoryBackend();
  const repository = new repositoryModule.LocalRepository(backend);
  const matter = {
    id: MATTER_ID,
    tenantId: ACTOR.tenantId,
    version: 1,
    title: "合成测试案件",
    status: "active",
    sourceVersion: 1,
    createdBy: ACTOR.userId,
    createdAt: T0,
    updatedAt: T0,
  };
  const asset = {
    id: ASSET_ID,
    tenantId: ACTOR.tenantId,
    matterId: MATTER_ID,
    serviceOrderId: null,
    purpose: "source",
    originalName: "synthetic-source.txt",
    mime: "text/plain",
    byteLength: 32,
    sha256: "c".repeat(64),
    state: "available",
    objectKey: `synthetic/${ASSET_ID}`,
    createdAt: T0,
  };
  const target = {
    id: TARGET_ID,
    matterId: MATTER_ID,
    status: "active",
    configVersion: 1,
    draftRevisionId: null,
    figureRevisionId: FIGURE_ID,
  };
  const created = await repository.commit(ACTOR, {
    contractVersion: repositoryModule.CONTRACT_VERSION,
    expectedVersion: 0,
    payload: { matter, targets: [target], assets: [asset], events: [], blobs: [] },
  }, { requestId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1" });
  assert.equal(created.ok, true, created.ok ? "" : JSON.stringify(created.error));

  const fact = makeFact();
  if (sourceRef) fact.refs = [structuredClone(sourceRef)];
  const sourceSnapshot = {
    matterId: MATTER_ID,
    version: 1,
    sourceIds: [SOURCE_ID],
    facts: [fact],
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
  };
  const sourceRecord = {
    kind: "parse.source",
    source: {
      id: SOURCE_ID,
      matterId: MATTER_ID,
      assetId: ASSET_ID,
      retiredAt: null,
      parseStatus: "parsed",
      parserVersion: "synthetic-v1",
      pageCount: 1,
      ocrNeeded: false,
    },
    currentJobId: null,
    jobIds: [],
    chunkSets: [{ parserVersion: "synthetic-v1", jobId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc1", chunkCount: 1 }],
  };
  const chunkSet = {
    kind: "parse.chunks",
    sourceId: SOURCE_ID,
    parserVersion: "synthetic-v1",
    jobId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc1",
    pageCount: 1,
    createdAt: T0,
    chunks: [{
      id: CHUNK_ID,
      sourceId: SOURCE_ID,
      parserVersion: "synthetic-v1",
      index: 0,
      kind: "paragraph",
      text: CHUNK_TEXT,
      hash: CHUNK_HASH,
      page: 1,
      rect: null,
      ocrConfidence: null,
    }],
  };
  await backend.transaction("readwrite", async (tx) => {
    await tx.put(repositoryModule.STORES.blobs, `intake/snapshot/${MATTER_ID}/1`, {
      kind: "intake.snapshot",
      snapshot: sourceSnapshot,
    });
    await tx.put(repositoryModule.STORES.blobs, `parse/source/${SOURCE_ID}`, sourceRecord);
    await tx.put(repositoryModule.STORES.blobs, `parse/chunks/${SOURCE_ID}/synthetic-v1`, chunkSet);
  });

  const revisions = generationModule.createGenerationRevisionStore({
    repository,
    actor: ACTOR,
    now: () => new Date(T0),
    newId: nextUuid,
  });
  const ast = makeAst({ sourceRef, paragraphCount });
  assert.equal(contracts.draftAstSchema.safeParse(ast).success, true);
  let revision = null;
  if (withDraft) {
    const saved = await revisions.saveEditedRevision(MATTER_ID, TARGET_ID, null, ast);
    assert.equal(saved.ok, true, saved.ok ? "" : JSON.stringify(saved.error));
    revision = saved.data;
  }

  const makeReviewSession = (now = T0) => new reviewModule.DraftReviewSession({
    repository,
    actor: ACTOR,
    matterId: MATTER_ID,
    targetId: TARGET_ID,
    revisions,
    newId: nextUuid,
    now: () => now,
  });
  return { backend, repository, revisions, revision, ast, fact, makeReviewSession };
}

export const modules = { contracts, repositoryModule, generationModule, parseModule, reviewModule };
