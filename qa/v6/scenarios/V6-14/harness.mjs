/**
 * V6-14 scenario harness.
 *
 * Only synthetic fixtures: an in-memory backend implementing the IndexedDB
 * adapter contract, one active matter with two evidence assets and a
 * contract-shaped intake snapshot (parties, facts, five-question answers). The
 * targets module reads the snapshot structurally, exactly as in the browser.
 * Nothing here imports intake, a provider, a key or the network.
 */
import assert from "node:assert/strict";

import {
  CONTRACT_VERSION,
  STORES,
  openLocalRepository,
  sha256Hex,
} from "../../../../apps/web/src/v6/lib/repository.ts";
import { loadTargetsView } from "../../../../apps/web/src/v6/features/targets/targets.ts";

export const TENANT_A = "11111111-1111-4111-8111-111111111111";
export const TENANT_C = "33333333-3333-4333-8333-333333333333";
export const USER_A = "22222222-2222-4222-8222-222222222221";
export const USER_B = "22222222-2222-4222-8222-222222222222";
export const USER_C = "33333333-3333-4333-8333-333333333331";

export const ACTOR_A = Object.freeze({ tenantId: TENANT_A, userId: USER_A });
/** Same tenant, different user: not the matter's creator. */
export const ACTOR_B = Object.freeze({ tenantId: TENANT_A, userId: USER_B });
/** Another tenant. */
export const ACTOR_C = Object.freeze({ tenantId: TENANT_C, userId: USER_C });

export const MATTER_A = "55555555-5555-4555-8555-555555555551";
export const MATTER_B = "55555555-5555-4555-8555-555555555552";
export const ASSET_1 = "77777777-7777-4777-8777-777777777771";
export const ASSET_2 = "77777777-7777-4777-8777-777777777772";
/** An asset id that belongs to another matter. */
export const FOREIGN_ASSET = "77777777-7777-4777-8777-777777777779";
export const SOURCE_1 = "88888888-8888-4888-8888-888888888881";
export const PERSON_1 = "44444444-4444-4444-8444-444444444441";
export const PERSON_2 = "44444444-4444-4444-8444-444444444442";
export const ORG_1 = "44444444-4444-4444-8444-444444444443";
export const UNKNOWN_PARTY = "44444444-4444-4444-8444-444444444449";
export const FACT_STRUCTURE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
export const FACT_METHOD = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
export const FACT_EFFECT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3";
export const REQUEST_ID = "dfdfdfdf-dfdf-4dfd-8fdf-dfdfdfdfdfdf";

export const T0 = "2026-11-01T00:00:00.000Z";
export const T1 = "2026-11-01T01:00:00.000Z";
export const T2 = "2026-11-01T02:00:00.000Z";
export const T3 = "2026-11-01T03:00:00.000Z";

export const PARTIES = Object.freeze([
  Object.freeze({ id: PERSON_1, kind: "person", name: "合成发明人甲", roles: ["inventor"], country: "CN" }),
  Object.freeze({ id: PERSON_2, kind: "person", name: "合成发明人乙", roles: ["inventor", "applicant"], country: "CN" }),
  Object.freeze({ id: ORG_1, kind: "organization", name: "合成申请人有限公司", roles: ["applicant"], country: "CN" }),
]);

function fact(id, kind, statement) {
  return {
    id,
    statement,
    kind,
    status: "user_confirmed",
    refs: [],
    confirmedBy: USER_A,
    confirmedAt: T0,
  };
}

export const FACTS = Object.freeze({
  structure: fact(FACT_STRUCTURE, "structure", "合成结构：卡扣连接的外壳"),
  method: fact(FACT_METHOD, "method", "合成方法：分两步装配"),
  effect: fact(FACT_EFFECT, "effect", "合成效果：装配更快"),
});

/** The same backend contract the IndexedDB adapter provides, in memory. */
export class MemoryBackend {
  constructor() {
    this.data = new Map(Object.values(STORES).map((name) => [name, new Map()]));
    this.failPut = null;
    this.readGate = null;
    this.closed = false;
    this.queue = Promise.resolve();
  }

  /** One hook can fail a specific put (for example, the idempotency finalize). */
  setPutFault(fn) {
    this.failPut = fn;
    return this;
  }

  /**
   * Pause a readonly `get` (readonly transactions are not serialized, so a
   * paused reader never blocks another caller's claim). Returns a promise or null.
   */
  setReadGate(fn) {
    this.readGate = fn;
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
        if (mode === "readonly" && this.readGate) {
          const wait = this.readGate({ store: name, key });
          if (wait) await wait;
        }
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
}

/** A manually opened gate: `wait` resolves when `open()` is called. */
export function gate() {
  let open;
  const wait = new Promise((resolve) => {
    open = resolve;
  });
  return { wait, open };
}

function snapshotKey(matterId, version) {
  return `intake/snapshot/${matterId}/${version}`;
}

async function assetFor(id, name, matterId = MATTER_A, tenantId = TENANT_A) {
  const bytes = new TextEncoder().encode(`synthetic evidence ${name}`);
  const hash = await sha256Hex(bytes);
  return {
    record: {
      id,
      tenantId,
      matterId,
      serviceOrderId: null,
      purpose: "source",
      originalName: name,
      mime: "text/plain",
      byteLength: bytes.byteLength,
      sha256: hash,
      state: "available",
      objectKey: `local/${tenantId}/${matterId}/${name}`,
      createdAt: T0,
    },
    blob: { assetId: id, bytes, sha256: hash, byteLength: bytes.byteLength },
  };
}

/**
 * Create the synthetic matter. `facts` picks fact kinds from `FACTS`;
 * `maturity` is the five-question answer; `withSnapshot: false` leaves no
 * intake snapshot at all (an empty matter).
 */
export async function seed({
  facts = ["structure", "effect"],
  maturity = "tested_sample",
  parties = PARTIES,
  withSnapshot = true,
  archived = false,
} = {}) {
  const backend = new MemoryBackend();
  const repository = openLocalRepository(backend);
  const assets = [await assetFor(ASSET_1, "evidence-a.txt"), await assetFor(ASSET_2, "evidence-b.txt")];
  const matter = {
    id: MATTER_A,
    tenantId: TENANT_A,
    version: 1,
    title: "V6-14 合成案卷",
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
        targets: [],
        assets: assets.map((asset) => asset.record),
        events: [],
        blobs: assets.map((asset) => asset.blob),
      },
    },
    { requestId: REQUEST_ID },
  );
  assert.equal(created.ok, true, created.ok ? "" : JSON.stringify(created.error));
  if (withSnapshot) {
    await backend.transaction("readwrite", async (tx) => {
      await tx.put(STORES.blobs, snapshotKey(MATTER_A, 1), {
        kind: "intake.snapshot",
        snapshot: {
          matterId: MATTER_A,
          version: 1,
          sourceIds: [SOURCE_1],
          facts: facts.map((kind) => FACTS[kind]),
          conflicts: [],
          answers: {
            problem: "合成问题",
            difference: "合成区别",
            inventorIds: [PERSON_1],
            disclosure: "none",
            maturity,
            disclosureDetail: null,
          },
          parties: [...parties],
          createdBy: USER_A,
          createdAt: T0,
        },
        provenance: {},
        requestKey: null,
      });
    });
  }
  return { backend, repository, matter };
}

/** A second matter owned by another tenant, with its own asset. */
export async function seedForeignMatter(repository) {
  const asset = await assetFor(FOREIGN_ASSET, "foreign.txt", MATTER_B, TENANT_C);
  const created = await repository.commit(
    ACTOR_C,
    {
      contractVersion: CONTRACT_VERSION,
      expectedVersion: 0,
      payload: {
        matter: {
          id: MATTER_B,
          tenantId: TENANT_C,
          version: 1,
          title: "V6-14 其他租户案卷",
          status: "active",
          sourceVersion: 1,
          createdBy: USER_C,
          createdAt: T0,
          updatedAt: T0,
        },
        targets: [],
        assets: [asset.record],
        events: [],
        blobs: [asset.blob],
      },
    },
    { requestId: "acacacac-acac-4cac-8cac-acacacacacac" },
  );
  assert.equal(created.ok, true, created.ok ? "" : JSON.stringify(created.error));
}

export async function archiveMatter(repository) {
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
          updatedAt: T2,
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

/** Minimal valid configs for each route. */
export function config(route, overrides = {}) {
  return {
    route,
    applicantIds: [ORG_1],
    inventorIds: [PERSON_1],
    priorityClaims: [],
    ...overrides,
  };
}

export async function aggregate(repository, actor = ACTOR_A) {
  const loaded = await repository.loadMatter(actor, MATTER_A);
  assert.equal(loaded.ok, true, loaded.ok ? "" : JSON.stringify(loaded.error));
  return loaded.data.data;
}

export async function eventsOf(repository, actor = ACTOR_A) {
  const listed = await repository.listEvents(actor, MATTER_A);
  assert.equal(listed.ok, true, listed.ok ? "" : JSON.stringify(listed.error));
  return listed.data.items;
}

export function targetEvents(events) {
  return events.filter((event) => event.action === "target.created" || event.action === "target.config_updated");
}

/** Every row and record in every store, as canonical JSON, for no-write proofs. */
export function storageFingerprint(backend) {
  const out = {};
  for (const [name, store] of backend.data) {
    out[name] = [...store.entries()]
      .map(([key, value]) => [key, JSON.stringify(value, (_, item) => (item instanceof Uint8Array ? [...item] : item))])
      .sort((a, b) => a[0].localeCompare(b[0]));
  }
  return JSON.stringify(out);
}

export function rowsOfKind(backend, kind) {
  return [...backend.store(STORES.blobs).values()].filter((value) => value?.kind === kind);
}

export async function readyView(repository, actor = ACTOR_A) {
  const result = await loadTargetsView(repository, actor, MATTER_A);
  assert.equal(result.ok, true, result.ok ? "" : JSON.stringify(result.error));
  return result.view;
}

/**
 * Replace `Date.now` with a controllable clock for lease tests. Returns the
 * controller; always call `restore()` (use `t.after`).
 */
export function fakeClock(startIso = T1) {
  const real = Date.now;
  let now = Date.parse(startIso);
  Date.now = () => now;
  return {
    advance(ms) {
      now += ms;
    },
    /** Advance automatically on every read, so bounded waits end without real sleeps. */
    autoAdvance(ms) {
      Date.now = () => {
        now += ms;
        return now;
      };
    },
    restore() {
      Date.now = real;
    },
  };
}
