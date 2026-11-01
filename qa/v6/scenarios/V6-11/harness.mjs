/**
 * Shared V6-11 scenario harness: an in-memory backend with the IndexedDB
 * adapter contract, a seeded synthetic matter, and helpers that go through the
 * real V6-10 ingest path. Not a test file; the runner collects *.test.mjs only.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  CONTRACT_VERSION,
  STORES,
  openLocalRepository,
  sha256Hex,
} from "../../../../apps/web/src/v6/lib/repository.ts";
import { ingestFiles } from "../../../../apps/web/src/v6/features/sources/ingest.ts";
import { readParseState } from "../../../../apps/web/src/v6/features/sources/parse.ts";
import { chunkSchema } from "../../../../packages/contracts/src/index.ts";

export const TENANT_A = "11111111-1111-4111-8111-111111111111";
export const USER_A = "33333333-3333-4333-8333-333333333333";
export const MATTER_ID = "55555555-5555-4555-8555-555555555555";
export const REQUEST_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
export const T0 = "2026-11-01T00:00:00.000Z";

export const ACTOR_A = Object.freeze({ tenantId: TENANT_A, userId: USER_A });

/**
 * The same backend contract the IndexedDB adapter provides: one transaction per
 * call, structured clones in and out, serialized read-write transactions, and a
 * failed transaction restored completely.
 */
export class MemoryBackend {
  constructor() {
    this.data = new Map(Object.values(STORES).map((name) => [name, new Map()]));
    this.failPut = null;
    this.closed = false;
    this.queue = Promise.resolve();
  }

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

export function uuidSource(start = 1) {
  let next = start;
  return () => `00000000-0000-4000-8000-${String(next++).padStart(12, "0")}`;
}

export function fixture(name) {
  return new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));
}

export function fileFrom(bytes, name, type = "") {
  return new File([bytes], name, { type });
}

export function createMatterWrite({ version = 1 } = {}) {
  return {
    matter: {
      id: MATTER_ID,
      tenantId: TENANT_A,
      version,
      title: "V6-11 合成案卷",
      status: "active",
      sourceVersion: 1,
      createdBy: USER_A,
      createdAt: T0,
      updatedAt: T0,
    },
    targets: [],
    assets: [],
    events: [],
    blobs: [],
  };
}

export async function seed({ newIds = uuidSource(1000) } = {}) {
  const backend = new MemoryBackend();
  const repository = openLocalRepository(backend);
  const created = await repository.commit(
    ACTOR_A,
    { contractVersion: CONTRACT_VERSION, expectedVersion: 0, payload: createMatterWrite() },
    { requestId: REQUEST_ID },
  );
  assert.equal(created.ok, true, created.ok ? "" : JSON.stringify(created.error));
  return { backend, repository, newIds };
}

/** Ingest files through the real V6-10 path; returns the stored assets by original name. */
export async function ingest(repository, newIds, files) {
  const outcomes = await ingestFiles(repository, ACTOR_A, MATTER_ID, files, {
    now: () => new Date(T0),
    newId: newIds,
  });
  for (const outcome of outcomes) assert.equal(outcome.status, "saved", JSON.stringify(outcome));
  const loaded = await repository.loadMatter(ACTOR_A, MATTER_ID);
  assert.equal(loaded.ok, true);
  // Only the assets this call saved, in input order.
  const byId = new Map(loaded.data.data.assets.map((asset) => [asset.id, asset]));
  return new Map(outcomes.map((outcome) => [outcome.name, byId.get(outcome.assetId)]));
}

/**
 * Store an `available` source asset directly, for inputs the upload gate would
 * never accept but a parser must still answer explicitly (a legacy `.doc`).
 */
export async function seedSourceAsset(repository, name, bytes, mime = "") {
  const loaded = await repository.loadMatter(ACTOR_A, MATTER_ID);
  assert.equal(loaded.ok, true);
  const asset = {
    id: "77777777-7777-4777-8777-777777777777",
    tenantId: TENANT_A,
    matterId: MATTER_ID,
    serviceOrderId: null,
    purpose: "source",
    originalName: name,
    mime,
    byteLength: bytes.byteLength,
    sha256: await sha256Hex(bytes),
    state: "available",
    objectKey: `local/${TENANT_A}/${MATTER_ID}/${name}`,
    createdAt: T0,
  };
  const committed = await repository.commit(
    ACTOR_A,
    {
      contractVersion: CONTRACT_VERSION,
      expectedVersion: loaded.data.data.matter.version,
      payload: {
        matter: { ...loaded.data.data.matter, version: loaded.data.data.matter.version + 1, updatedAt: T0 },
        targets: loaded.data.data.targets,
        assets: [...loaded.data.data.assets, asset],
        events: [],
        blobs: [{ assetId: asset.id, bytes, sha256: asset.sha256, byteLength: asset.byteLength }],
      },
    },
    { requestId: REQUEST_ID },
  );
  assert.equal(committed.ok, true, committed.ok ? "" : JSON.stringify(committed.error));
  return asset;
}

export function parseDeps(newIds, extra = {}) {
  let clock = T0;
  const deps = {
    newId: newIds,
    sessionId: "session-0001",
    now: () => clock,
    ...extra,
  };
  return {
    deps,
    advance(iso) {
      clock = iso;
    },
    now: () => clock,
  };
}

export async function stateOf(repository, assetId, options = {}) {
  const state = await readParseState(repository, ACTOR_A, MATTER_ID, assetId, options);
  assert.notEqual(state.status, "missing");
  assert.notEqual(state.status, "storage_unavailable");
  return state;
}

export async function freshRepository(backend) {
  return openLocalRepository(backend);
}

export async function assertChunksValid(chunks) {
  for (const chunk of chunks) {
    const parsed = chunkSchema.safeParse(chunk);
    assert.equal(parsed.success, true, JSON.stringify(parsed.error?.issues));
    assert.equal(chunk.hash, await sha256Hex(new TextEncoder().encode(chunk.text)));
    assert.equal(chunk.text, chunk.text.normalize("NFC"));
    assert.ok(chunk.text.length > 0);
  }
}

export function storedParseRows(backend, kind) {
  return [...backend.store(STORES.blobs).values()].filter((value) => value?.kind === kind);
}
