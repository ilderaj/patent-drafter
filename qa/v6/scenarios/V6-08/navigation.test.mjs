/**
 * V6-08 — `/v6` route skeleton scenarios (S01).
 *
 * The suite drives `routes/navigation.ts` through its public interface over the
 * real `LocalRepository` and an in-memory `StorageBackend` with fault
 * injection. A "refresh" is a new `LocalRepository` over the same backend plus a
 * fresh parse of the URL, which is all a reloaded page has. Stored records are
 * parsed against the frozen contract schemas.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  CONTRACT_VERSION,
  STORES,
  openLocalRepository,
} from "../../../../apps/web/src/v6/lib/repository.ts";
import {
  DEFAULT_MATTER_TITLE,
  GLOBAL_NAV,
  LOCAL_ACTOR,
  MATTER_TABS,
  PAGE_ERROR_MESSAGES,
  RUNTIME_LABELS,
  createSelfServiceMatter,
  listMatterView,
  parseV6Path,
  resolveMatterView,
  v6Path,
} from "../../../../apps/web/src/v6/routes/navigation.ts";
import { activitySchema, matterSchema, targetSchema } from "../../../../packages/contracts/src/index.ts";

const OTHER_TENANT = { tenantId: "22222222-2222-4222-8222-222222222222", userId: LOCAL_ACTOR.userId };
const OTHER_USER = { tenantId: LOCAL_ACTOR.tenantId, userId: "44444444-4444-4444-8444-444444444444" };
// Contains hex letters so `toUpperCase()` yields a distinct, non-canonical id.
const MATTER_ID = "5a5a5a5a-5a5a-4a5a-8a5a-5a5a5a5a5a5a";
const TARGET_ID = "66666666-6666-4666-8666-666666666666";
const TARGET_TWO = "67676767-6767-4676-8676-676767676767";
const FIGURE_SET_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const EVENT_ONE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const EVENT_TWO = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const MISSING_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const NOW = "2026-10-31T09:00:00.000Z";

/** One transaction per call, structured clones in and out, rollback on throw. */
class MemoryBackend {
  constructor() {
    this.data = new Map(Object.values(STORES).map((name) => [name, new Map()]));
    this.fault = null;
  }

  setFault(fn) {
    this.fault = fn;
    return this;
  }

  store(name) {
    return this.data.get(name);
  }

  size() {
    return [...this.data.values()].reduce((total, store) => total + store.size, 0);
  }

  async transaction(mode, run) {
    const snapshot = new Map([...this.data].map(([name, store]) => [name, new Map(store)]));
    const check = (op, name) => {
      const fault = this.fault?.({ op, store: name, mode }) ?? null;
      if (fault) throw fault;
    };
    const tx = {
      get: async (name, key) => {
        check("get", name);
        const value = this.store(name).get(key);
        return value === undefined ? undefined : structuredClone(value);
      },
      put: async (name, key, value) => {
        check("put", name);
        this.store(name).set(key, structuredClone(value));
      },
      delete: async (name, key) => {
        check("delete", name);
        this.store(name).delete(key);
      },
      getAll: async (name) => {
        check("getAll", name);
        return [...this.store(name).values()].map((value) => structuredClone(value));
      },
      getAllByIndex: async (name, index, value) => {
        check("getAllByIndex", name);
        return [...this.store(name).values()]
          .filter((row) => row !== null && typeof row === "object" && row[index] === value)
          .map((row) => structuredClone(row));
      },
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

const storageFault = () => Object.assign(new Error("disk unplugged"), { name: "UnknownError" });

function memory() {
  const backend = new MemoryBackend();
  return { backend, repository: openLocalRepository(backend) };
}

/** A matter with two targets, written the way a later ticket's target store would. */
async function seedMatterWithTargets(repository, actor = LOCAL_ACTOR) {
  const target = (id) => ({ id, matterId: MATTER_ID, status: "active", configVersion: 1, draftRevisionId: null, figureRevisionId: FIGURE_SET_ID });
  const event = (id, action, resourceId) => ({
    id,
    tenantId: actor.tenantId,
    matterId: MATTER_ID,
    targetId: action === "target.created" ? resourceId : null,
    actorId: actor.userId,
    actorKind: "user",
    action,
    snapshot: null,
    jobId: null,
    resourceId,
    occurredAt: NOW,
    metadata: { version: 1 },
  });
  const committed = await repository.commit(
    actor,
    {
      contractVersion: CONTRACT_VERSION,
      expectedVersion: 0,
      payload: {
        matter: { id: MATTER_ID, tenantId: actor.tenantId, version: 1, title: "折叠水杯", status: "active", sourceVersion: 1, createdBy: actor.userId, createdAt: NOW, updatedAt: NOW },
        targets: [target(TARGET_ID), target(TARGET_TWO)],
        assets: [],
        events: [event(EVENT_ONE, "matter.created", MATTER_ID), event(EVENT_TWO, "target.created", TARGET_ID)],
        blobs: [],
      },
    },
    { requestId: "seed" },
  );
  assert.equal(committed.ok, true, JSON.stringify(committed));
}

test("S01: the shell's fixed navigation, eight tabs and runtime labels", () => {
  assert.deepEqual(
    GLOBAL_NAV.map((item) => item.label),
    ["收件箱", "案件", "申请", "动态", "AI 与数据", "服务", "账单", "设置"],
  );
  assert.deepEqual(
    MATTER_TABS.map((tab) => tab.label),
    ["概览", "材料", "事实", "草稿", "检查", "审阅", "交付", "申请"],
  );
  // TAB_CAPABILITIES was an unused parallel capability table; capabilities now
  // live only on GLOBAL_NAV (tabs are always shown and enabled by the workbench).
  for (const capability of GLOBAL_NAV.map((item) => item.capability)) {
    if (capability.state === "unavailable") assert.ok(capability.reason && capability.reason.length > 0);
    else assert.equal(capability.reason, null);
  }
  assert.deepEqual(Object.keys(RUNTIME_LABELS).sort(), ["cloud_web", "demo", "desktop", "local_web"]);
  matterSchema.shape.tenantId.parse(LOCAL_ACTOR.tenantId);
  matterSchema.shape.createdBy.parse(LOCAL_ACTOR.userId);
});

test("V6-08-A01: the self-service entry creates one real empty matter and opens its upload step", async () => {
  const { backend, repository } = memory();
  const created = await createSelfServiceMatter(repository, LOCAL_ACTOR, { matterId: MATTER_ID, eventId: EVENT_ONE, requestId: "r1", now: NOW });
  assert.deepEqual(created, { ok: true, matterId: MATTER_ID, next: `/v6/matters/${MATTER_ID}/upload`, created: true });
  assert.deepEqual(parseV6Path(created.next), { kind: "upload", matterId: MATTER_ID });

  // A refreshed page: a new repository over the same storage.
  const refreshed = openLocalRepository(backend);
  const view = await resolveMatterView(refreshed, LOCAL_ACTOR, MATTER_ID, null);
  assert.equal(view.state, "ready");
  matterSchema.parse(view.matter);
  assert.equal(view.matter.title, DEFAULT_MATTER_TITLE);
  // S01-A01: empty — no attachments, targets, publication history, approvals or unlocks.
  assert.deepEqual(view.targets, []);
  const loaded = await refreshed.loadMatter(LOCAL_ACTOR, MATTER_ID);
  assert.deepEqual(loaded.data.data.assets, []);
  const events = await refreshed.listEvents(LOCAL_ACTOR, MATTER_ID);
  assert.deepEqual(events.data.items.map((item) => item.action), ["matter.created"]);
  activitySchema.parse(events.data.items[0]);
  assert.equal(backend.store(STORES.blobs ?? "blobs")?.size ?? 0, 0);
});

test("V6-08-A01: a direct link to a matter, target and tab survives a refresh", async () => {
  const { backend, repository } = memory();
  await seedMatterWithTargets(repository);
  const link = v6Path({ kind: "matter", matterId: MATTER_ID, targetId: TARGET_TWO, tab: "check" });
  assert.equal(link, `/v6/matters/${MATTER_ID}/targets/${TARGET_TWO}/check`);

  const route = parseV6Path(link);
  assert.deepEqual(route, { kind: "matter", matterId: MATTER_ID, targetId: TARGET_TWO, tab: "check" });
  const view = await resolveMatterView(openLocalRepository(backend), LOCAL_ACTOR, route.matterId, route.targetId);
  assert.equal(view.state, "ready");
  assert.equal(view.matter.id, MATTER_ID);
  assert.equal(view.target.id, TARGET_TWO);
  targetSchema.parse(view.target);
  assert.equal(view.version, 1);
});

test("S01-A02: switching tabs and targets changes only the URL, never stored data", async () => {
  const { backend, repository } = memory();
  await seedMatterWithTargets(repository);
  const before = structuredClone([...backend.data].map(([name, store]) => [name, [...store]]));
  for (const targetId of [null, TARGET_ID, TARGET_TWO]) {
    for (const { key } of MATTER_TABS) {
      const link = v6Path({ kind: "matter", matterId: MATTER_ID, targetId, tab: key });
      const route = parseV6Path(link);
      assert.deepEqual(route, { kind: "matter", matterId: MATTER_ID, targetId, tab: key });
      const view = await resolveMatterView(repository, LOCAL_ACTOR, MATTER_ID, targetId);
      assert.equal(view.state, "ready");
      assert.equal(view.target?.id ?? null, targetId);
    }
  }
  const after = [...backend.data].map(([name, store]) => [name, [...store]]);
  assert.deepEqual(after, before);
});

test("routes: every page parses and round-trips; anything else is not_found", () => {
  const routes = [
    { kind: "start" },
    { kind: "matters" },
    { kind: "upload", matterId: MATTER_ID },
    { kind: "matter", matterId: MATTER_ID, targetId: null, tab: "overview" },
    { kind: "matter", matterId: MATTER_ID, targetId: TARGET_ID, tab: "filing" },
    ...GLOBAL_NAV.filter((item) => item.key !== "matters").map((item) => ({ kind: "section", key: item.key })),
  ];
  for (const route of routes) assert.deepEqual(parseV6Path(v6Path(route)), route);

  assert.deepEqual(parseV6Path("/v6/"), { kind: "start" });
  assert.deepEqual(parseV6Path(`/v6/matters/${MATTER_ID}`), { kind: "matter", matterId: MATTER_ID, targetId: null, tab: "overview" });
  assert.deepEqual(parseV6Path(`/v6/matters/${MATTER_ID}/targets/${TARGET_ID}`), { kind: "matter", matterId: MATTER_ID, targetId: TARGET_ID, tab: "overview" });
  for (const path of [
    "/projects",
    "/v6/unknown",
    "/v6/settings/extra",
    `/v6/matters/${MATTER_ID}/nope`,
    `/v6/matters/${MATTER_ID}/upload/extra`,
    `/v6/matters/${MATTER_ID}/targets/${TARGET_ID}/check/extra`,
    `/v6/matters/${MATTER_ID}/targets`,
    "/v6/matters/%E0%A4%A",
  ]) {
    assert.deepEqual(parseV6Path(path), { kind: "not_found" }, path);
  }
});

test("V6-08-A02: missing, foreign, malformed and unknown-target links all show one unavailable page and write nothing", async () => {
  const { backend, repository } = memory();
  await seedMatterWithTargets(repository);
  const sizeBefore = backend.size();
  const cases = [
    [LOCAL_ACTOR, MISSING_ID, null],
    [OTHER_TENANT, MATTER_ID, null],
    [OTHER_USER, MATTER_ID, null],
    [LOCAL_ACTOR, "not-a-uuid", null],
    [LOCAL_ACTOR, MATTER_ID, MISSING_ID],
    [LOCAL_ACTOR, MATTER_ID, "../x"],
    [LOCAL_ACTOR, MATTER_ID.toUpperCase(), null],
  ];
  for (const [actor, matterId, targetId] of cases) {
    // Repeating the request gives the same answer.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      assert.deepEqual(await resolveMatterView(repository, actor, matterId, targetId), { state: "unavailable" }, `${matterId}/${targetId}`);
    }
  }
  assert.equal(backend.size(), sizeBefore);
});

test("S01-A01: a fresh profile lists no matters and no demo content", async () => {
  const { backend, repository } = memory();
  assert.deepEqual(await listMatterView(repository, LOCAL_ACTOR), { state: "ready", matters: [] });
  assert.deepEqual(await resolveMatterView(repository, LOCAL_ACTOR, MATTER_ID, null), { state: "unavailable" });
  assert.equal(backend.size(), 0);
});

test("STORAGE_UNAVAILABLE: a read fault is reported as such, never as an empty or missing matter", async () => {
  const { backend, repository } = memory();
  await seedMatterWithTargets(repository);
  backend.setFault(({ op }) => (op === "get" || op === "getAll" ? storageFault() : null));
  const view = await resolveMatterView(repository, LOCAL_ACTOR, MATTER_ID, null);
  assert.equal(view.state, "storage_unavailable");
  const list = await listMatterView(repository, LOCAL_ACTOR);
  assert.equal(list.state, "storage_unavailable");
  backend.setFault(null);
  assert.equal((await resolveMatterView(repository, LOCAL_ACTOR, MATTER_ID, null)).state, "ready");
});

test("STORAGE_UNAVAILABLE: the storage exception's own text never reaches a page", async () => {
  const { backend, repository } = memory();
  await seedMatterWithTargets(repository);
  const secret = "claim 1: a folding cup with a hinged rim";
  const leaky = () => Object.assign(new Error(secret), { name: "UnknownError" });
  backend.setFault(({ op }) => (op === "get" || op === "getAll" || op === "getAllByIndex" ? leaky() : null));
  const view = await resolveMatterView(repository, LOCAL_ACTOR, MATTER_ID, null);
  const list = await listMatterView(repository, LOCAL_ACTOR);
  backend.setFault(({ op }) => (op === "put" ? leaky() : null));
  const created = await createSelfServiceMatter(repository, LOCAL_ACTOR, { matterId: MISSING_ID, eventId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", requestId: "r1", now: NOW });
  assert.equal(created.code, "STORAGE_UNAVAILABLE");
  for (const result of [view, list, created]) {
    assert.equal(JSON.stringify(result).includes(secret), false, JSON.stringify(result));
    assert.equal(result.message, PAGE_ERROR_MESSAGES.STORAGE_UNAVAILABLE);
  }
});

test("V6-08-A03: a failed create writes nothing; retrying with the same ids creates exactly one matter", async () => {
  const { backend, repository } = memory();
  const input = { matterId: MATTER_ID, eventId: EVENT_ONE, requestId: "r1", now: NOW };

  backend.setFault(({ op }) => (op === "put" ? storageFault() : null));
  const failed = await createSelfServiceMatter(repository, LOCAL_ACTOR, input);
  assert.equal(failed.ok, false);
  assert.equal(failed.code, "STORAGE_UNAVAILABLE");
  assert.equal(backend.size(), 0);
  assert.deepEqual(await listMatterView(repository, LOCAL_ACTOR), { state: "ready", matters: [] });

  backend.setFault(null);
  const retried = await createSelfServiceMatter(repository, LOCAL_ACTOR, { ...input, requestId: "r2" });
  assert.deepEqual(retried, { ok: true, matterId: MATTER_ID, next: `/v6/matters/${MATTER_ID}/upload`, created: true });
  // The answer was lost and the user pressed again: no second matter or event.
  const again = await createSelfServiceMatter(repository, LOCAL_ACTOR, { ...input, requestId: "r3" });
  assert.deepEqual(again, { ok: true, matterId: MATTER_ID, next: `/v6/matters/${MATTER_ID}/upload`, created: false });

  const refreshed = openLocalRepository(backend);
  const list = await listMatterView(refreshed, LOCAL_ACTOR);
  assert.deepEqual(list.matters.map((matter) => matter.id), [MATTER_ID]);
  const events = await refreshed.listEvents(LOCAL_ACTOR, MATTER_ID);
  assert.equal(events.data.items.length, 1);
  assert.deepEqual(await resolveMatterView(refreshed, LOCAL_ACTOR, MATTER_ID, null), await resolveMatterView(refreshed, LOCAL_ACTOR, MATTER_ID, null));
});

test("V6-08-A03: another user's id is never reported as a successful create", async () => {
  const { backend, repository } = memory();
  await seedMatterWithTargets(repository, OTHER_USER);
  const sizeBefore = backend.size();
  const result = await createSelfServiceMatter(repository, LOCAL_ACTOR, { matterId: MATTER_ID, eventId: MISSING_ID, requestId: "r1", now: NOW });
  assert.equal(result.ok, false);
  assert.equal(backend.size(), sizeBefore);
  const malformed = await createSelfServiceMatter(repository, LOCAL_ACTOR, { matterId: "x", eventId: EVENT_ONE, requestId: "r2", now: NOW });
  assert.deepEqual(malformed, { ok: false, code: "INVALID_INPUT", message: "matter and event ids must be lowercase UUIDs" });
});

test("V6-08-A03: parsing is pure — the same input gives the same route and nothing is mutated", () => {
  const route = { kind: "matter", matterId: MATTER_ID, targetId: TARGET_ID, tab: "draft" };
  const frozen = structuredClone(route);
  const path = v6Path(route);
  assert.deepEqual(route, frozen);
  assert.deepEqual(parseV6Path(path), parseV6Path(path));
});
