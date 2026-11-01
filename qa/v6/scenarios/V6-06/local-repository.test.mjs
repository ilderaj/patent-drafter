/**
 * V6-06 — local repository scenarios (S06, 05-contracts §3–§5).
 *
 * The suite drives the real `LocalRepository` through its public interface over
 * two adapters of the same `StorageBackend` seam: an in-memory backend defined
 * here (with fault injection for quota and transaction failures) and a small
 * in-memory implementation of the parts of IndexedDB the browser adapter uses.
 * The second one runs the real `indexeddb-repository.ts` code, so the suite
 * exercises store creation, the events index, reopen, request wrapping and
 * transaction abort — not a mock of the adapter's own logic.
 *
 * Every record the repository stores or returns is parsed against its frozen
 * contract schema, so a shape drift fails here rather than at the page.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";

import {
  ACTIVITY_ACTIONS,
  ACTIVITY_METADATA_KEYS,
  ACTIVITY_METADATA_KEYS_BY_ACTION,
  CONTRACT_ERROR_CODES,
  CONTRACT_VERSION,
  STORES,
  openLocalRepository,
  sha256Hex,
} from "../../../../apps/web/src/v6/lib/repository.ts";
import {
  DATABASE_NAME,
  DATABASE_VERSION,
  EVENTS_MATTER_INDEX,
  openIndexedDbBackend,
} from "../../../../apps/web/src/v6/lib/indexeddb-repository.ts";
import {
  ACTIVITY_METADATA_KEYS_BY_ACTION as CONTRACT_ACTIVITY_METADATA_KEYS_BY_ACTION,
  ERROR_CODES,
  activityActionSchema,
  activityMetadataKeySchema,
  activitySchema,
  assetSchema,
  errorCodeSchema,
  matterSchema,
  resultSchema,
  targetSchema,
} from "../../../../packages/contracts/src/index.ts";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
const USER_A = "33333333-3333-4333-8333-333333333333";
const USER_B = "44444444-4444-4444-8444-444444444444";
const USER_C = "14141414-1414-4414-8414-141414141414";
const MATTER_ID = "55555555-5555-4555-8555-555555555555";
const TARGET_ID = "66666666-6666-4666-8666-666666666666";
const SOURCE_ASSET_ID = "77777777-7777-4777-8777-777777777777";
const FIGURE_ASSET_ID = "88888888-8888-4888-8888-888888888888";
const DRAFT_ID = "99999999-9999-4999-8999-999999999999";
const FIGURE_SET_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const EVENT_ONE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const EVENT_TWO = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const EVENT_THREE = "12121212-1212-4212-8212-121212121212";
const EVENT_FOUR = "13131313-1313-4313-8313-131313131313";
const REQUEST_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const T0 = "2026-10-30T00:00:00.000Z";
const T1 = "2026-10-30T00:01:00.000Z";
const T2 = "2026-10-30T00:02:00.000Z";

const SOURCE_TEXT = "V6-06 合成来源文本：一种示例装置，包括壳体与传感器。";
const FIGURE_TEXT = "V6-06 合成附图字节";

const ACTOR_A = Object.freeze({ tenantId: TENANT_A, userId: USER_A });
const ACTOR_B = Object.freeze({ tenantId: TENANT_B, userId: USER_B });
/** Another member of the same tenant who did not create the matter. */
const ACTOR_A_COLLEAGUE = Object.freeze({ tenantId: TENANT_A, userId: USER_C });
const COMMIT_OPTIONS = Object.freeze({ requestId: REQUEST_ID });

/**
 * An in-memory backend with the same contract as the IndexedDB adapter:
 * one transaction per call, structured clones in and out, and an abort that
 * restores everything the failed transaction wrote. Read-write transactions
 * are serialized like browser IndexedDB transactions on the same database, so
 * a compare-and-swap race is decided by the repository, not by test timing.
 */
class MemoryBackend {
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
      // The transaction aborts: every write it made is invisible afterwards.
      this.data = snapshot;
      throw error;
    }
  }

  close() {
    this.closed = true;
  }
}

/**
 * The smallest IndexedDB that runs `indexeddb-repository.ts` for real: open and
 * upgrade, object stores and one index, requests delivered asynchronously,
 * transactions that complete when idle and abort (rolling back) on error.
 * `options.failPut(info)` injects a request failure for one write.
 */
function createFakeIndexedDb(options = {}) {
  const databases = new Map();
  const opens = [];

  const quotaError = () => new DOMException("The quota has been exceeded.", "QuotaExceededError");
  const inactive = () => new DOMException("The transaction is not active.", "TransactionInactiveError");

  function stateOf(name) {
    let state = databases.get(name);
    if (!state) {
      state = { version: 0, stores: new Map() };
      databases.set(name, state);
    }
    return state;
  }

  function makeRequest() {
    return { result: undefined, error: null, onsuccess: null, onerror: null };
  }

  class FakeTransaction {
    constructor(state, storeNames, mode) {
      this.state = state;
      this.mode = mode;
      this.status = "active";
      this.error = null;
      this.pending = 0;
      this.journal = [];
      this.journalKeys = new Set();
      this.oncomplete = null;
      this.onerror = null;
      this.onabort = null;
      for (const name of storeNames) {
        if (!state.stores.has(name)) {
          throw new DOMException(`object store ${name} does not exist`, "NotFoundError");
        }
      }
      this.schedule();
    }

    schedule() {
      setTimeout(() => {
        if (this.status !== "active" || this.pending > 0) return;
        this.status = "finished";
        this.journal = [];
        this.oncomplete?.({ target: this });
      }, 0);
    }

    begin() {
      this.pending += 1;
    }

    end() {
      this.pending -= 1;
      this.schedule();
    }

    ensureActive() {
      if (this.status !== "active") throw inactive();
    }

    fail(error) {
      if (this.status !== "active") return;
      this.status = "aborted";
      this.error = error;
      for (let index = this.journal.length - 1; index >= 0; index -= 1) {
        const entry = this.journal[index];
        const store = this.state.stores.get(entry.storeName);
        if (entry.had) store.data.set(entry.key, entry.previous);
        else store.data.delete(entry.key);
      }
      this.journal = [];
      setTimeout(() => this.onabort?.({ target: this }), 0);
    }

    abort() {
      this.fail(new DOMException("The transaction was aborted.", "AbortError"));
    }

    record(storeName, key) {
      const journalKey = `${storeName}\u0000${key}`;
      if (this.journalKeys.has(journalKey)) return;
      this.journalKeys.add(journalKey);
      const store = this.state.stores.get(storeName);
      this.journal.push({ storeName, key, had: store.data.has(key), previous: store.data.get(key) });
    }

    objectStore(name) {
      const transaction = this;
      return {
        get(key) {
          transaction.ensureActive();
          const request = makeRequest();
          transaction.begin();
          setTimeout(() => {
            const store = transaction.state.stores.get(name);
            const value = store.data.get(key);
            request.result = value === undefined ? undefined : structuredClone(value);
            transaction.end();
            request.onsuccess?.({ target: request });
          }, 0);
          return request;
        },

        put(value, key) {
          transaction.ensureActive();
          const request = makeRequest();
          transaction.begin();
          setTimeout(() => {
            const fault = options.failPut?.({ store: name, key, value }) ?? null;
            if (fault) {
              request.error = fault;
              transaction.fail(fault);
              request.onerror?.({ target: request });
              transaction.end();
              return;
            }
            transaction.record(name, key);
            transaction.state.stores.get(name).data.set(key, structuredClone(value));
            request.result = key;
            transaction.end();
            request.onsuccess?.({ target: request });
          }, 0);
          return request;
        },

        delete(key) {
          transaction.ensureActive();
          const request = makeRequest();
          transaction.begin();
          setTimeout(() => {
            transaction.record(name, key);
            transaction.state.stores.get(name).data.delete(key);
            request.result = undefined;
            transaction.end();
            request.onsuccess?.({ target: request });
          }, 0);
          return request;
        },

        getAll() {
          transaction.ensureActive();
          const request = makeRequest();
          transaction.begin();
          setTimeout(() => {
            request.result = [...transaction.state.stores.get(name).data.values()].map((value) =>
              structuredClone(value),
            );
            transaction.end();
            request.onsuccess?.({ target: request });
          }, 0);
          return request;
        },

        index(indexName) {
          transaction.ensureActive();
          const store = transaction.state.stores.get(name);
          if (!store.indexes.has(indexName)) {
            throw new DOMException(`index ${indexName} does not exist`, "NotFoundError");
          }
          const keyPath = store.indexes.get(indexName);
          return {
            getAll(value) {
              const request = makeRequest();
              transaction.begin();
              setTimeout(() => {
                request.result = [...store.data.values()]
                  .filter((row) => row !== null && typeof row === "object" && row[keyPath] === value)
                  .map((row) => structuredClone(row));
                transaction.end();
                request.onsuccess?.({ target: request });
              }, 0);
              return request;
            },
          };
        },
      };
    }
  }

  class FakeDatabase {
    constructor(state) {
      this.state = state;
      this.onversionchange = null;
      this.closed = false;
    }

    get objectStoreNames() {
      const names = [...this.state.stores.keys()];
      return {
        contains: (name) => names.includes(name),
        length: names.length,
        item: (index) => names[index] ?? null,
        [Symbol.iterator]: () => names[Symbol.iterator](),
      };
    }

    createObjectStore(name) {
      const store = { data: new Map(), indexes: new Map() };
      this.state.stores.set(name, store);
      return { createIndex: (indexName, keyPath) => store.indexes.set(indexName, keyPath) };
    }

    transaction(storeNames, mode = "readonly") {
      const names = typeof storeNames === "string" ? [storeNames] : [...storeNames];
      return new FakeTransaction(this.state, names, mode);
    }

    close() {
      this.closed = true;
    }
  }

  return {
    opens,
    quotaError,
    database: (name) => stateOf(name),
    open(name, version = 1) {
      opens.push({ name, version });
      const state = stateOf(name);
      const request = makeRequest();
      setTimeout(() => {
        request.result = new FakeDatabase(state);
        if (state.version < version) {
          state.version = version;
          request.onupgradeneeded?.({ target: request });
        }
        setTimeout(() => request.onsuccess?.({ target: request }), 0);
      }, 0);
      return request;
    },
  };
}

async function makeFixture() {
  const sourceBytes = new TextEncoder().encode(SOURCE_TEXT);
  const figureBytes = new TextEncoder().encode(FIGURE_TEXT);
  const sourceSha = await sha256Hex(sourceBytes);
  const figureSha = await sha256Hex(figureBytes);
  const assets = [
    {
      id: SOURCE_ASSET_ID,
      tenantId: TENANT_A,
      matterId: MATTER_ID,
      serviceOrderId: null,
      purpose: "source",
      originalName: "source.txt",
      mime: "text/plain",
      byteLength: sourceBytes.byteLength,
      sha256: sourceSha,
      state: "available",
      objectKey: "local/source.txt",
      createdAt: T0,
    },
    {
      id: FIGURE_ASSET_ID,
      tenantId: TENANT_A,
      matterId: MATTER_ID,
      serviceOrderId: null,
      purpose: "drawing",
      originalName: "figure.png",
      mime: "image/png",
      byteLength: figureBytes.byteLength,
      sha256: figureSha,
      state: "available",
      objectKey: "local/figure.png",
      createdAt: T0,
    },
  ];
  const snapshot = {
    matterId: MATTER_ID,
    targetId: TARGET_ID,
    sourceVersion: 1,
    targetConfigVersion: 1,
    draftRevisionId: DRAFT_ID,
    figureRevisionId: FIGURE_SET_ID,
  };
  const events = [
    {
      id: EVENT_ONE,
      tenantId: TENANT_A,
      matterId: MATTER_ID,
      targetId: null,
      actorId: USER_A,
      actorKind: "user",
      action: "matter.created",
      snapshot: null,
      jobId: null,
      resourceId: MATTER_ID,
      occurredAt: T0,
      metadata: { version: 1 },
    },
    {
      id: EVENT_TWO,
      tenantId: TENANT_A,
      matterId: MATTER_ID,
      targetId: TARGET_ID,
      actorId: USER_A,
      actorKind: "user",
      action: "target.created",
      snapshot,
      jobId: null,
      resourceId: TARGET_ID,
      occurredAt: T0,
      metadata: { version: 1 },
    },
  ];
  return {
    sourceBytes,
    figureBytes,
    sourceSha,
    figureSha,
    matter: {
      id: MATTER_ID,
      tenantId: TENANT_A,
      version: 1,
      title: "合成案卷",
      status: "active",
      sourceVersion: 1,
      createdBy: USER_A,
      createdAt: T0,
      updatedAt: T0,
    },
    target: {
      id: TARGET_ID,
      matterId: MATTER_ID,
      status: "active",
      configVersion: 1,
      draftRevisionId: DRAFT_ID,
      figureRevisionId: FIGURE_SET_ID,
    },
    assets,
    events,
    snapshot,
  };
}

function createWrite(fixture) {
  return {
    matter: { ...fixture.matter },
    targets: [{ ...fixture.target }],
    assets: fixture.assets.map((asset) => ({ ...asset })),
    events: fixture.events.map((event) => structuredClone(event)),
    blobs: [
      {
        assetId: SOURCE_ASSET_ID,
        bytes: new Uint8Array(fixture.sourceBytes),
        sha256: fixture.sourceSha,
        byteLength: fixture.sourceBytes.byteLength,
      },
      {
        assetId: FIGURE_ASSET_ID,
        bytes: new Uint8Array(fixture.figureBytes),
        sha256: fixture.figureSha,
        byteLength: fixture.figureBytes.byteLength,
      },
    ],
  };
}

function updateWrite(
  fixture,
  { version = 2, title = "合成案卷（更新）", status = "active", eventId = EVENT_THREE, occurredAt = T1 } = {},
) {
  return {
    matter: {
      ...fixture.matter,
      version,
      title,
      status,
      sourceVersion: version,
      updatedAt: occurredAt,
    },
    targets: [{ ...fixture.target }],
    assets: fixture.assets.map((asset) => ({ ...asset })),
    events: [
      {
        id: eventId,
        tenantId: TENANT_A,
        matterId: MATTER_ID,
        targetId: null,
        actorId: USER_A,
        actorKind: "user",
        action: "matter.renamed",
        snapshot: null,
        jobId: null,
        resourceId: MATTER_ID,
        occurredAt,
        metadata: { version },
      },
    ],
    blobs: [],
  };
}

const command = (expectedVersion, payload) => ({ contractVersion: CONTRACT_VERSION, expectedVersion, payload });

function memoryRepository() {
  const backend = new MemoryBackend();
  return { backend, repository: openLocalRepository(backend) };
}

async function indexedDbRepository(options = {}) {
  const factory = options.factory ?? createFakeIndexedDb(options);
  const backend = await openIndexedDbBackend({ factory });
  return { factory, backend, repository: openLocalRepository(backend) };
}

function parseAggregate(aggregate) {
  matterSchema.parse(aggregate.matter);
  for (const target of aggregate.targets) targetSchema.parse(target);
  for (const asset of aggregate.assets) assetSchema.parse(asset);
}

function parseEvents(events) {
  for (const event of events) activitySchema.parse(event);
}

test("A01 a committed matter, target and assets survive closing and reopening the database", async () => {
  const fixture = await makeFixture();
  const first = await indexedDbRepository();
  const created = await first.repository.commit(ACTOR_A, command(0, createWrite(fixture)), COMMIT_OPTIONS);
  assert.equal(created.ok, true, JSON.stringify(created));
  assert.equal(created.data.version, 1);
  first.repository.close();

  // A refresh: a fresh backend over the same database, no state carried over.
  const second = await indexedDbRepository({ factory: first.factory });
  const read = await second.repository.loadMatter(ACTOR_A, MATTER_ID);
  assert.equal(read.ok, true, JSON.stringify(read));
  assert.deepEqual(read.data.data.matter, fixture.matter);
  assert.deepEqual(read.data.data.targets, [fixture.target]);
  assert.deepEqual(
    read.data.data.assets.map((asset) => asset.id),
    [SOURCE_ASSET_ID, FIGURE_ASSET_ID],
  );
  parseAggregate(read.data.data);
  assert.equal(read.data.version, 1);
  second.repository.close();
});

test("A01 stored bytes come back byte-for-byte and re-hash to the asset digest", async () => {
  const fixture = await makeFixture();
  const { repository, factory } = await indexedDbRepository();
  await repository.commit(ACTOR_A, command(0, createWrite(fixture)), COMMIT_OPTIONS);
  repository.close();

  const reopened = openLocalRepository(await openIndexedDbBackend({ factory }));
  const source = await reopened.readBlob(ACTOR_A, SOURCE_ASSET_ID);
  assert.equal(source.ok, true, JSON.stringify(source));
  assert.deepEqual(source.data.data.bytes, fixture.sourceBytes);
  assert.equal(source.data.data.asset.sha256, fixture.sourceSha);
  assetSchema.parse(source.data.data.asset);
  assert.equal(await sha256Hex(source.data.data.bytes), fixture.sourceSha);
  assert.equal(source.data.data.bytes.byteLength, source.data.data.asset.byteLength);

  const figure = await reopened.readBlob(ACTOR_A, FIGURE_ASSET_ID);
  assert.equal(figure.ok, true);
  assert.deepEqual(figure.data.data.bytes, fixture.figureBytes);
  reopened.close();
});

test("A01 a fresh local database lists no matters and no example cases", async () => {
  const { repository } = memoryRepository();
  const listed = await repository.listMatters(ACTOR_A);
  assert.equal(listed.ok, true);
  assert.deepEqual(listed.data, { items: [], nextCursor: null });
});

test("A01 activity carries ids and counts, never document content, newest first", async () => {
  const fixture = await makeFixture();
  const { repository } = memoryRepository();
  await repository.commit(ACTOR_A, command(0, createWrite(fixture)), COMMIT_OPTIONS);
  const updated = await repository.commit(ACTOR_A, command(1, updateWrite(fixture)), COMMIT_OPTIONS);
  assert.equal(updated.ok, true);

  const listed = await repository.listEvents(ACTOR_A, MATTER_ID);
  assert.equal(listed.ok, true, JSON.stringify(listed));
  // S06 orders the activity feed by occurredAt desc: the T1 event precedes the
  // two T0 events, which tie-break on id.
  assert.deepEqual(
    listed.data.items.map((event) => event.id),
    [EVENT_THREE, EVENT_ONE, EVENT_TWO],
  );
  parseEvents(listed.data.items);
  const serialized = JSON.stringify(listed.data.items);
  assert.equal(serialized.includes("示例装置"), false, "an event must not carry document content");
  assert.equal(serialized.includes(SOURCE_TEXT), false);
  for (const event of listed.data.items) {
    assert.deepEqual(Object.keys(event.metadata).sort(), ["version"]);
  }
});

test("A01 the adapter opens the named database and indexes events by matter", async () => {
  const { repository, factory } = await indexedDbRepository();
  assert.deepEqual(factory.opens, [{ name: DATABASE_NAME, version: DATABASE_VERSION }]);
  const state = factory.database(DATABASE_NAME);
  assert.equal(state.version, DATABASE_VERSION);
  assert.deepEqual([...state.stores.keys()].sort(), ["blobs", "events", "matters"]);
  assert.equal(state.stores.get(STORES.events).indexes.get(EVENTS_MATTER_INDEX), "matterId");
  repository.close();
});

test("A02 a quota failure on a blob refuses the commit and leaves the previous version readable", async () => {
  const fixture = await makeFixture();
  let fault = null;
  const { repository, factory } = await indexedDbRepository({
    failPut: (info) => fault?.(info) ?? null,
  });
  const created = await repository.commit(ACTOR_A, command(0, createWrite(fixture)), COMMIT_OPTIONS);
  assert.equal(created.ok, true);

  fault = (info) => (info.store === STORES.blobs && info.key === SOURCE_ASSET_ID ? factory.quotaError() : null);
  const next = updateWrite(fixture);
  next.blobs = [
    {
      assetId: SOURCE_ASSET_ID,
      bytes: new Uint8Array(fixture.sourceBytes),
      sha256: fixture.sourceSha,
      byteLength: fixture.sourceBytes.byteLength,
    },
  ];
  const refused = await repository.commit(ACTOR_A, command(1, next), COMMIT_OPTIONS);
  assert.equal(refused.ok, false);
  assert.equal(refused.error.code, "QUOTA_EXCEEDED");
  assert.equal(errorCodeSchema.parse(refused.error.code), "QUOTA_EXCEEDED");

  // The failed save never shows as saved: the version, title and events are
  // exactly what version 1 wrote, and the old bytes are still readable.
  const read = await repository.loadMatter(ACTOR_A, MATTER_ID);
  assert.equal(read.ok, true);
  assert.equal(read.data.version, 1);
  assert.equal(read.data.data.matter.title, fixture.matter.title);
  const events = await repository.listEvents(ACTOR_A, MATTER_ID);
  assert.equal(events.data.items.length, 2);
  const blob = await repository.readBlob(ACTOR_A, SOURCE_ASSET_ID);
  assert.equal(blob.ok, true);
  assert.deepEqual(blob.data.data.bytes, fixture.sourceBytes);
  repository.close();
});

test("A02 a transaction failure after the aggregate write rolls the whole version back", async () => {
  const fixture = await makeFixture();
  let fault = null;
  const { repository } = await indexedDbRepository({ failPut: (info) => fault?.(info) ?? null });
  await repository.commit(ACTOR_A, command(0, createWrite(fixture)), COMMIT_OPTIONS);

  fault = (info) => (info.store === STORES.events ? new Error("disk went away") : null);
  const refused = await repository.commit(ACTOR_A, command(1, updateWrite(fixture)), COMMIT_OPTIONS);
  assert.equal(refused.ok, false);
  assert.equal(refused.error.code, "STORAGE_UNAVAILABLE");
  assert.match(refused.error.message, /disk went away/);

  // The aggregate was written before the failing event, and it was rolled back
  // with the rest of the transaction.
  const read = await repository.loadMatter(ACTOR_A, MATTER_ID);
  assert.equal(read.data.version, 1);
  assert.equal(read.data.data.matter.title, fixture.matter.title);
  const events = await repository.listEvents(ACTOR_A, MATTER_ID);
  assert.deepEqual(
    events.data.items.map((event) => event.id),
    [EVENT_ONE, EVENT_TWO],
  );
  repository.close();
});

test("A02 a stale expectedVersion is refused with the stored version", async () => {
  const fixture = await makeFixture();
  const { repository } = memoryRepository();
  await repository.commit(ACTOR_A, command(0, createWrite(fixture)), COMMIT_OPTIONS);
  const updated = await repository.commit(ACTOR_A, command(1, updateWrite(fixture)), COMMIT_OPTIONS);
  assert.equal(updated.ok, true);

  const stale = updateWrite(fixture, { version: 2, eventId: EVENT_FOUR, occurredAt: T2 });
  const refused = await repository.commit(ACTOR_A, command(1, stale), COMMIT_OPTIONS);
  assert.equal(refused.ok, false);
  assert.equal(refused.error.code, "VERSION_CONFLICT");
  assert.equal(refused.error.latestVersion, 2);

  const read = await repository.loadMatter(ACTOR_A, MATTER_ID);
  assert.equal(read.data.version, 2);
  assert.equal(read.data.data.matter.title, "合成案卷（更新）");
  assert.equal((await repository.listEvents(ACTOR_A, MATTER_ID)).data.items.length, 3);
});

test("A02 a duplicate event id cannot be recorded twice", async () => {
  const fixture = await makeFixture();
  const { repository } = memoryRepository();
  await repository.commit(ACTOR_A, command(0, createWrite(fixture)), COMMIT_OPTIONS);

  const repeated = updateWrite(fixture, { eventId: EVENT_TWO });
  const refused = await repository.commit(ACTOR_A, command(1, repeated), COMMIT_OPTIONS);
  assert.equal(refused.ok, false);
  assert.equal(refused.error.code, "INVALID_INPUT");
  assert.match(refused.error.message, /already recorded/);

  const read = await repository.loadMatter(ACTOR_A, MATTER_ID);
  assert.equal(read.data.version, 1);
  assert.equal((await repository.listEvents(ACTOR_A, MATTER_ID)).data.items.length, 2);
});

test("A02 an archived matter refuses writes with INVALID_TRANSITION", async () => {
  const fixture = await makeFixture();
  const { repository } = memoryRepository();
  await repository.commit(ACTOR_A, command(0, createWrite(fixture)), COMMIT_OPTIONS);
  const archived = await repository.commit(
    ACTOR_A,
    command(1, updateWrite(fixture, { status: "archived", title: "合成案卷（归档）" })),
    COMMIT_OPTIONS,
  );
  assert.equal(archived.ok, true);

  const refused = await repository.commit(
    ACTOR_A,
    command(2, {
      ...updateWrite(fixture, { version: 3, title: "合成案卷（归档后编辑）", eventId: EVENT_FOUR, occurredAt: T2 }),
    }),
    COMMIT_OPTIONS,
  );
  assert.equal(refused.ok, false);
  assert.equal(refused.error.code, "INVALID_TRANSITION");
  assert.match(refused.error.message, /archived/);

  const read = await repository.loadMatter(ACTOR_A, MATTER_ID);
  assert.equal(read.data.version, 2);
  assert.equal(read.data.data.matter.status, "archived");
  assert.equal(read.data.data.matter.title, "合成案卷（归档）");
});

test("A02 another tenant's matter is not found for this actor", async () => {
  const fixture = await makeFixture();
  const { repository } = memoryRepository();
  await repository.commit(ACTOR_A, command(0, createWrite(fixture)), COMMIT_OPTIONS);

  const read = await repository.loadMatter(ACTOR_B, MATTER_ID);
  assert.equal(read.ok, false);
  assert.equal(read.error.code, "RESOURCE_NOT_FOUND");
  assert.deepEqual((await repository.listMatters(ACTOR_B)).data.items, []);
  const events = await repository.listEvents(ACTOR_B, MATTER_ID);
  assert.equal(events.ok, false);
  assert.equal(events.error.code, "RESOURCE_NOT_FOUND");
  const blob = await repository.readBlob(ACTOR_B, SOURCE_ASSET_ID);
  assert.equal(blob.ok, false);
  assert.equal(blob.error.code, "RESOURCE_NOT_FOUND");

  // A create with the same matter id from the other tenant is refused without
  // confirming that the id exists.
  const hijack = createWrite(fixture);
  hijack.matter = { ...hijack.matter, tenantId: TENANT_B, createdBy: USER_B };
  hijack.assets = hijack.assets.map((asset) => ({ ...asset, tenantId: TENANT_B }));
  hijack.events = hijack.events.map((event) => ({ ...event, tenantId: TENANT_B }));
  hijack.blobs = [];
  const hijackResult = await repository.commit(ACTOR_B, command(0, hijack), COMMIT_OPTIONS);
  assert.equal(hijackResult.ok, false);
  assert.equal(hijackResult.error.code, "RESOURCE_NOT_FOUND");
  assert.equal((await repository.loadMatter(ACTOR_A, MATTER_ID)).data.version, 1);
});

test("A02 a same-tenant user who did not create the matter is not found for this actor", async () => {
  const fixture = await makeFixture();
  const { repository } = memoryRepository();
  await repository.commit(ACTOR_A, command(0, createWrite(fixture)), COMMIT_OPTIONS);
  assert.deepEqual(
    (await repository.listMatters(ACTOR_A)).data.items.map((item) => item.matter.id),
    [MATTER_ID],
  );

  // The R1 local rule: within a tenant, only the creator reaches the matter.
  // S06-A05's no-access answer is RESOURCE_NOT_FOUND, not an empty aggregate.
  const read = await repository.loadMatter(ACTOR_A_COLLEAGUE, MATTER_ID);
  assert.equal(read.ok, false);
  assert.equal(read.error.code, "RESOURCE_NOT_FOUND");
  assert.deepEqual((await repository.listMatters(ACTOR_A_COLLEAGUE)).data.items, []);
  const events = await repository.listEvents(ACTOR_A_COLLEAGUE, MATTER_ID);
  assert.equal(events.ok, false);
  assert.equal(events.error.code, "RESOURCE_NOT_FOUND");
  const blob = await repository.readBlob(ACTOR_A_COLLEAGUE, SOURCE_ASSET_ID);
  assert.equal(blob.ok, false);
  assert.equal(blob.error.code, "RESOURCE_NOT_FOUND");

  // Neither an update nor a create that reuses the id may reach it.
  const update = await repository.commit(ACTOR_A_COLLEAGUE, command(1, updateWrite(fixture)), COMMIT_OPTIONS);
  assert.equal(update.ok, false);
  assert.equal(update.error.code, "RESOURCE_NOT_FOUND");
  const recreate = createWrite(fixture);
  recreate.matter = { ...recreate.matter, version: 1 };
  recreate.events = recreate.events.map((event) => ({ ...event, actorId: USER_C }));
  const recreateResult = await repository.commit(ACTOR_A_COLLEAGUE, command(0, recreate), COMMIT_OPTIONS);
  assert.equal(recreateResult.ok, false);
  assert.equal(recreateResult.error.code, "RESOURCE_NOT_FOUND");

  // Nothing changed for the creator's matter.
  const creator = await repository.loadMatter(ACTOR_A, MATTER_ID);
  assert.equal(creator.data.version, 1);
  assert.deepEqual(creator.data.data.matter, fixture.matter);
});

test("A02 a commit cannot record another user as creator or as the user actor", async () => {
  const fixture = await makeFixture();
  const { repository } = memoryRepository();

  // A create must record the acting user, not a forged creator id.
  const forged = createWrite(fixture);
  forged.matter = { ...forged.matter, createdBy: USER_C };
  const forgedResult = await repository.commit(ACTOR_A, command(0, forged), COMMIT_OPTIONS);
  assert.equal(forgedResult.ok, false);
  assert.equal(forgedResult.error.code, "INVALID_INPUT");
  assert.equal((await repository.loadMatter(ACTOR_A, MATTER_ID)).ok, false);

  // A user-kind event must name the acting user, so it cannot speak for someone else.
  const spoken = createWrite(fixture);
  spoken.events = spoken.events.map((event) => ({ ...event, actorId: USER_C }));
  const spokenResult = await repository.commit(ACTOR_A, command(0, spoken), COMMIT_OPTIONS);
  assert.equal(spokenResult.ok, false);
  assert.equal(spokenResult.error.code, "INVALID_INPUT");
  assert.equal((await repository.loadMatter(ACTOR_A, MATTER_ID)).ok, false);

  const created = await repository.commit(ACTOR_A, command(0, createWrite(fixture)), COMMIT_OPTIONS);
  assert.equal(created.ok, true, JSON.stringify(created));

  // An update cannot reassign the creator.
  const reassigned = updateWrite(fixture);
  reassigned.matter = { ...reassigned.matter, createdBy: USER_C };
  const reassignedResult = await repository.commit(ACTOR_A, command(1, reassigned), COMMIT_OPTIONS);
  assert.equal(reassignedResult.ok, false);
  assert.equal(reassignedResult.error.code, "INVALID_INPUT");

  // An update cannot add an event attributed to another user.
  const attributed = updateWrite(fixture);
  attributed.events = attributed.events.map((event) => ({ ...event, actorId: USER_C }));
  const attributedResult = await repository.commit(ACTOR_A, command(1, attributed), COMMIT_OPTIONS);
  assert.equal(attributedResult.ok, false);
  assert.equal(attributedResult.error.code, "INVALID_INPUT");

  assert.equal((await repository.loadMatter(ACTOR_A, MATTER_ID)).data.version, 1);
  assert.deepEqual(
    (await repository.listEvents(ACTOR_A, MATTER_ID)).data.items.map((event) => event.id),
    [EVENT_ONE, EVENT_TWO],
  );

  // A worker-kind event carries no user identity, so it is accepted and parses.
  const worker = updateWrite(fixture, { eventId: EVENT_FOUR, occurredAt: T1 });
  worker.events = [
    {
      ...worker.events[0],
      actorId: null,
      actorKind: "worker",
      action: "job.started",
      metadata: { stage: "parse", provider: "synthetic", model: "fixture-model" },
    },
  ];
  const workerResult = await repository.commit(ACTOR_A, command(1, worker), COMMIT_OPTIONS);
  assert.equal(workerResult.ok, true, JSON.stringify(workerResult));
  const workerEvents = await repository.listEvents(ACTOR_A, MATTER_ID);
  parseEvents(workerEvents.data.items);
  assert.equal(
    workerEvents.data.items.find((event) => event.id === EVENT_FOUR).actorKind,
    "worker",
  );
});

test("A03 repeating a successful commit changes nothing", async () => {
  const fixture = await makeFixture();
  const { repository } = memoryRepository();
  await repository.commit(ACTOR_A, command(0, createWrite(fixture)), COMMIT_OPTIONS);
  const write = updateWrite(fixture);
  const first = await repository.commit(ACTOR_A, command(1, write), COMMIT_OPTIONS);
  assert.equal(first.ok, true);
  const before = await repository.loadMatter(ACTOR_A, MATTER_ID);
  const eventsBefore = await repository.listEvents(ACTOR_A, MATTER_ID);

  const repeated = await repository.commit(ACTOR_A, command(1, write), COMMIT_OPTIONS);
  assert.equal(repeated.ok, false);
  assert.equal(repeated.error.code, "VERSION_CONFLICT");

  const after = await repository.loadMatter(ACTOR_A, MATTER_ID);
  assert.deepEqual(after.data, before.data);
  const eventsAfter = await repository.listEvents(ACTOR_A, MATTER_ID);
  assert.deepEqual(eventsAfter.data, eventsBefore.data);
  assert.equal(eventsAfter.data.items.filter((event) => event.id === EVENT_THREE).length, 1);
});

test("A03 a failed commit can be retried once the fault clears", async () => {
  const fixture = await makeFixture();
  let fault = null;
  const { backend, repository } = memoryRepository();
  backend.setPutFault((info) => fault?.(info) ?? null);
  await repository.commit(ACTOR_A, command(0, createWrite(fixture)), COMMIT_OPTIONS);

  fault = (info) => (info.store === STORES.matters ? new DOMException("quota", "QuotaExceededError") : null);
  const write = updateWrite(fixture);
  const failed = await repository.commit(ACTOR_A, command(1, write), COMMIT_OPTIONS);
  assert.equal(failed.ok, false);
  assert.equal(failed.error.code, "QUOTA_EXCEEDED");

  fault = null;
  const retried = await repository.commit(ACTOR_A, command(1, write), COMMIT_OPTIONS);
  assert.equal(retried.ok, true, JSON.stringify(retried));
  assert.equal(retried.data.version, 2);

  const read = await repository.loadMatter(ACTOR_A, MATTER_ID);
  assert.equal(read.data.version, 2);
  const events = await repository.listEvents(ACTOR_A, MATTER_ID);
  assert.equal(events.data.items.filter((event) => event.id === EVENT_THREE).length, 1);
  assert.equal(events.data.items.length, 3);
});

test("A03 two writers racing from the same version: exactly one wins", async () => {
  const fixture = await makeFixture();
  const { repository } = memoryRepository();
  await repository.commit(ACTOR_A, command(0, createWrite(fixture)), COMMIT_OPTIONS);

  const [left, right] = await Promise.all([
    repository.commit(ACTOR_A, command(1, updateWrite(fixture, { title: "A 的更新", eventId: EVENT_THREE })), COMMIT_OPTIONS),
    repository.commit(ACTOR_A, command(1, updateWrite(fixture, { title: "B 的更新", eventId: EVENT_FOUR })), COMMIT_OPTIONS),
  ]);
  const outcomes = [left, right];
  assert.equal(outcomes.filter((outcome) => outcome.ok).length, 1);
  const loser = outcomes.find((outcome) => !outcome.ok);
  assert.equal(loser.error.code, "VERSION_CONFLICT");
  assert.equal(loser.error.latestVersion, 2);

  const read = await repository.loadMatter(ACTOR_A, MATTER_ID);
  assert.equal(read.data.version, 2);
  const events = await repository.listEvents(ACTOR_A, MATTER_ID);
  assert.equal(events.data.items.length, 3, "only the winner's event is recorded");
  const winner = outcomes.find((outcome) => outcome.ok);
  assert.deepEqual(
    events.data.items.map((event) => event.id),
    [winner.data.eventIds[0], EVENT_ONE, EVENT_TWO],
  );
});

test("A03 reads never hand out references to stored state", async () => {
  const fixture = await makeFixture();
  const { repository } = memoryRepository();
  await repository.commit(ACTOR_A, command(0, createWrite(fixture)), COMMIT_OPTIONS);

  const first = await repository.loadMatter(ACTOR_A, MATTER_ID);
  first.data.data.matter.title = "被修改";
  first.data.data.targets[0].status = "archived";
  first.data.data.assets[0].sha256 = "0".repeat(64);

  const blob = await repository.readBlob(ACTOR_A, SOURCE_ASSET_ID);
  blob.data.data.bytes[0] ^= 0xff;
  blob.data.data.asset.originalName = "被修改";

  const second = await repository.loadMatter(ACTOR_A, MATTER_ID);
  assert.equal(second.data.data.matter.title, fixture.matter.title);
  assert.equal(second.data.data.targets[0].status, "active");
  assert.equal(second.data.data.assets[0].sha256, fixture.sourceSha);

  const reread = await repository.readBlob(ACTOR_A, SOURCE_ASSET_ID);
  assert.deepEqual(reread.data.data.bytes, fixture.sourceBytes);
  assert.equal(reread.data.data.asset.originalName, "source.txt");
});

test("A03 corrupted stored bytes are refused with HASH_MISMATCH", async () => {
  const fixture = await makeFixture();
  const { backend, repository } = memoryRepository();
  await repository.commit(ACTOR_A, command(0, createWrite(fixture)), COMMIT_OPTIONS);

  const stored = backend.store(STORES.blobs).get(SOURCE_ASSET_ID);
  stored.bytes = new Uint8Array(stored.bytes);
  stored.bytes[0] ^= 0xff;

  const read = await repository.readBlob(ACTOR_A, SOURCE_ASSET_ID);
  assert.equal(read.ok, false);
  assert.equal(read.error.code, "HASH_MISMATCH");
});

test("A03 an asset's digest cannot change without new bytes", async () => {
  const fixture = await makeFixture();
  const { repository } = memoryRepository();
  await repository.commit(ACTOR_A, command(0, createWrite(fixture)), COMMIT_OPTIONS);

  const write = updateWrite(fixture);
  write.assets = write.assets.map((asset) =>
    asset.id === SOURCE_ASSET_ID ? { ...asset, sha256: "0".repeat(64) } : asset,
  );
  const refused = await repository.commit(ACTOR_A, command(1, write), COMMIT_OPTIONS);
  assert.equal(refused.ok, false);
  assert.equal(refused.error.code, "HASH_MISMATCH");
  assert.match(refused.error.message, /changed its digest without new bytes/);

  // Nothing moved: the version, the asset record and the bytes are version 1's.
  const read = await repository.loadMatter(ACTOR_A, MATTER_ID);
  assert.equal(read.data.version, 1);
  assert.equal(read.data.data.assets.find((asset) => asset.id === SOURCE_ASSET_ID).sha256, fixture.sourceSha);
  const blob = await repository.readBlob(ACTOR_A, SOURCE_ASSET_ID);
  assert.equal(blob.ok, true);
  assert.deepEqual(blob.data.data.bytes, fixture.sourceBytes);
  assert.equal(blob.data.data.asset.sha256, fixture.sourceSha);
});

test("A03 new bytes and their digest land in the same commit", async () => {
  const fixture = await makeFixture();
  const { repository } = memoryRepository();
  await repository.commit(ACTOR_A, command(0, createWrite(fixture)), COMMIT_OPTIONS);

  const replacement = new TextEncoder().encode("V6-06 替换后的合成来源文本");
  const replacementSha = await sha256Hex(replacement);
  const write = updateWrite(fixture);
  write.assets = write.assets.map((asset) =>
    asset.id === SOURCE_ASSET_ID
      ? { ...asset, sha256: replacementSha, byteLength: replacement.byteLength }
      : asset,
  );
  write.blobs = [
    {
      assetId: SOURCE_ASSET_ID,
      bytes: replacement,
      sha256: replacementSha,
      byteLength: replacement.byteLength,
    },
  ];
  const committed = await repository.commit(ACTOR_A, command(1, write), COMMIT_OPTIONS);
  assert.equal(committed.ok, true, JSON.stringify(committed));

  const matter = await repository.loadMatter(ACTOR_A, MATTER_ID);
  const asset = matter.data.data.assets.find((item) => item.id === SOURCE_ASSET_ID);
  assert.equal(asset.sha256, replacementSha);
  assert.equal(asset.byteLength, replacement.byteLength);
  const blob = await repository.readBlob(ACTOR_A, SOURCE_ASSET_ID);
  assert.equal(blob.ok, true);
  assert.deepEqual(blob.data.data.bytes, replacement);
  assert.equal(blob.data.data.asset.sha256, replacementSha);
  parseAggregate(matter.data.data);
});

test("A03 bytes whose asset record moved are refused", async () => {
  const fixture = await makeFixture();
  const { backend, repository } = memoryRepository();
  await repository.commit(ACTOR_A, command(0, createWrite(fixture)), COMMIT_OPTIONS);

  // Simulate a record that moved past its stored bytes by another path.
  const aggregate = backend.store(STORES.matters).get(MATTER_ID);
  aggregate.assets.find((asset) => asset.id === SOURCE_ASSET_ID).sha256 = "0".repeat(64);

  const read = await repository.readBlob(ACTOR_A, SOURCE_ASSET_ID);
  assert.equal(read.ok, false);
  assert.equal(read.error.code, "HASH_MISMATCH");
  assert.match(read.error.message, /do not match the asset record/);
});

test("A01 activity metadata is confined to the action's whitelist", async () => {
  const fixture = await makeFixture();
  const { repository } = memoryRepository();

  const contentWrite = createWrite(fixture);
  contentWrite.events[0] = { ...contentWrite.events[0], metadata: { version: 1, body: SOURCE_TEXT } };
  const content = await repository.commit(ACTOR_A, command(0, contentWrite), COMMIT_OPTIONS);
  assert.equal(content.ok, false);
  assert.equal(content.error.code, "INVALID_INPUT");
  assert.match(content.error.message, /metadata key body is not allowed for matter.created/);

  const unknownAction = createWrite(fixture);
  unknownAction.events[0] = { ...unknownAction.events[0], action: "matter.scraped" };
  const unknown = await repository.commit(ACTOR_A, command(0, unknownAction), COMMIT_OPTIONS);
  assert.equal(unknown.ok, false);
  assert.equal(unknown.error.code, "INVALID_INPUT");
  assert.match(unknown.error.message, /not in the §10 whitelist/);

  const missingProcessor = createWrite(fixture);
  missingProcessor.events[0] = {
    ...missingProcessor.events[0],
    action: "job.succeeded",
    metadata: { stage: "draft", count: 1 },
  };
  const missing = await repository.commit(ACTOR_A, command(0, missingProcessor), COMMIT_OPTIONS);
  assert.equal(missing.ok, false);
  assert.equal(missing.error.code, "INVALID_INPUT");
  assert.match(missing.error.message, /provider is required for job.succeeded/);

  const freeText = createWrite(fixture);
  freeText.events[0] = { ...freeText.events[0], action: "job.started", metadata: { stage: SOURCE_TEXT } };
  const rejectedStage = await repository.commit(ACTOR_A, command(0, freeText), COMMIT_OPTIONS);
  assert.equal(rejectedStage.ok, false);
  assert.equal(rejectedStage.error.code, "INVALID_INPUT");
  assert.match(rejectedStage.error.message, /must be a lowercase stage token/);

  // None of the refusals wrote anything.
  const empty = await repository.loadMatter(ACTOR_A, MATTER_ID);
  assert.equal(empty.ok, false);
  assert.equal(empty.error.code, "RESOURCE_NOT_FOUND");

  const valid = createWrite(fixture);
  valid.events = [
    {
      id: EVENT_ONE,
      tenantId: TENANT_A,
      matterId: MATTER_ID,
      targetId: null,
      actorId: USER_A,
      actorKind: "user",
      action: "job.succeeded",
      snapshot: null,
      jobId: null,
      resourceId: MATTER_ID,
      occurredAt: T0,
      metadata: {
        stage: "draft",
        count: 1,
        provider: "synthetic-provider",
        model: "synthetic-model",
      },
    },
  ];
  const accepted = await repository.commit(ACTOR_A, command(0, valid), COMMIT_OPTIONS);
  assert.equal(accepted.ok, true, JSON.stringify(accepted));
  const events = await repository.listEvents(ACTOR_A, MATTER_ID);
  parseEvents(events.data.items);
});

test("A03 the activity contract mirror matches packages/contracts", () => {
  assert.deepEqual([...ACTIVITY_ACTIONS].sort(), [...activityActionSchema.options].sort());
  assert.deepEqual([...ACTIVITY_METADATA_KEYS].sort(), [...activityMetadataKeySchema.options].sort());
  assert.deepEqual([...CONTRACT_ERROR_CODES], [...ERROR_CODES]);
  assert.deepEqual(Object.keys(ACTIVITY_METADATA_KEYS_BY_ACTION).sort(), [...activityActionSchema.options].sort());
  for (const action of ACTIVITY_ACTIONS) {
    assert.deepEqual(
      [...ACTIVITY_METADATA_KEYS_BY_ACTION[action]].sort(),
      [...CONTRACT_ACTIVITY_METADATA_KEYS_BY_ACTION[action]].sort(),
      `metadata keys for ${action} drifted from the contract`,
    );
  }
});

test("A03 every refusal code is a §10 error code", async () => {
  const fixture = await makeFixture();
  const codes = new Set();
  let fault = null;
  const { backend, repository } = memoryRepository();
  backend.setPutFault((info) => fault?.(info) ?? null);

  const invalidEnvelope = await repository.commit(ACTOR_A, { ...command(0, createWrite(fixture)), contractVersion: "v6.0" }, COMMIT_OPTIONS);
  assert.equal(invalidEnvelope.ok, false);
  codes.add(invalidEnvelope.error.code);

  const missing = await repository.loadMatter(ACTOR_A, MATTER_ID);
  assert.equal(missing.ok, false);
  codes.add(missing.error.code);

  await repository.commit(ACTOR_A, command(0, createWrite(fixture)), COMMIT_OPTIONS);
  const conflict = await repository.commit(ACTOR_A, command(0, createWrite(fixture)), COMMIT_OPTIONS);
  assert.equal(conflict.ok, false);
  codes.add(conflict.error.code);

  const archived = await repository.commit(
    ACTOR_A,
    command(1, updateWrite(fixture, { status: "archived" })),
    COMMIT_OPTIONS,
  );
  assert.equal(archived.ok, true);
  const transition = await repository.commit(
    ACTOR_A,
    command(2, updateWrite(fixture, { version: 3, eventId: EVENT_FOUR })),
    COMMIT_OPTIONS,
  );
  assert.equal(transition.ok, false);
  codes.add(transition.error.code);

  // A fresh matter for the storage faults: the archived one refuses first.
  const otherId = "14141414-1414-4414-8414-141414141414";
  const otherWrite = () => {
    const write = createWrite(fixture);
    write.matter = { ...write.matter, id: otherId, createdBy: USER_A };
    write.targets = [];
    write.assets = [];
    write.events = [];
    write.blobs = [];
    return write;
  };
  fault = () => new DOMException("quota", "QuotaExceededError");
  const quota = await repository.commit(ACTOR_A, command(0, otherWrite()), COMMIT_OPTIONS);
  assert.equal(quota.ok, false);
  codes.add(quota.error.code);

  fault = () => new Error("disk went away");
  const unavailable = await repository.commit(ACTOR_A, command(0, otherWrite()), COMMIT_OPTIONS);
  assert.equal(unavailable.ok, false);
  codes.add(unavailable.error.code);
  fault = null;

  const digestMatterId = "15151515-1515-4515-8515-151515151515";
  const badDigest = createWrite(fixture);
  badDigest.matter = { ...badDigest.matter, id: digestMatterId };
  badDigest.targets = [];
  badDigest.assets = [{ ...fixture.assets[0], matterId: digestMatterId, sha256: "e".repeat(64) }];
  badDigest.events = [];
  badDigest.blobs = [{ ...badDigest.blobs[0], sha256: "f".repeat(64) }];
  const mismatch = await repository.commit(ACTOR_A, command(0, badDigest), COMMIT_OPTIONS);
  assert.equal(mismatch.ok, false);
  codes.add(mismatch.error.code);

  assert.deepEqual([...codes].sort(), [
    "HASH_MISMATCH",
    "INVALID_INPUT",
    "INVALID_TRANSITION",
    "QUOTA_EXCEEDED",
    "RESOURCE_NOT_FOUND",
    "STORAGE_UNAVAILABLE",
    "VERSION_CONFLICT",
  ]);
  for (const code of codes) assert.equal(errorCodeSchema.parse(code), code);
});

test("A03 a commit result parses against the contract Result envelope", async () => {
  const fixture = await makeFixture();
  const { repository } = memoryRepository();
  await repository.commit(ACTOR_A, command(0, createWrite(fixture)), COMMIT_OPTIONS);
  const committed = await repository.commit(ACTOR_A, command(1, updateWrite(fixture)), COMMIT_OPTIONS);
  assert.equal(committed.ok, true);
  const envelope = resultSchema(z.any()).parse(committed.data);
  assert.equal(envelope.version, 2);
  assert.deepEqual(envelope.eventIds, [EVENT_THREE]);
  assert.equal(envelope.requestId, REQUEST_ID);
});
