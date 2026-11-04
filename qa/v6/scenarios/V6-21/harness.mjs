import { CONTRACT_VERSION, STORES, openLocalRepository } from "../../../../apps/web/src/v6/lib/repository.ts";

export const ACTOR = Object.freeze({
  tenantId: "11111111-1111-4111-8111-111111111111",
  userId: "22222222-2222-4222-8222-222222222221",
});
export const OTHER_ACTOR = Object.freeze({
  tenantId: ACTOR.tenantId,
  userId: "22222222-2222-4222-8222-222222222222",
});
export const T0 = "2026-11-01T00:00:00.000Z";
export const T1 = "2026-11-01T01:00:00.000Z";

export class MemoryBackend {
  constructor() {
    this.data = new Map(Object.values(STORES).map((name) => [name, new Map()]));
    this.queue = Promise.resolve();
    this.closed = false;
  }

  transaction(mode, run) {
    if (this.closed) return Promise.reject(new Error("backend is closed"));
    if (mode !== "readwrite") return this.run(mode, run);
    const pending = this.queue.then(() => this.run(mode, run));
    this.queue = pending.then(() => undefined, () => undefined);
    return pending;
  }

  async run(mode, run) {
    const previous = new Map([...this.data].map(([name, store]) => [name, new Map(store)]));
    const store = (name) => {
      const found = this.data.get(name);
      if (!found) throw new Error(`unknown store ${name}`);
      return found;
    };
    const tx = {
      get: async (name, key) => {
        const value = store(name).get(key);
        return value === undefined ? undefined : structuredClone(value);
      },
      put: async (name, key, value) => store(name).set(key, structuredClone(value)),
      delete: async (name, key) => store(name).delete(key),
      getAll: async (name) => [...store(name).values()].map((value) => structuredClone(value)),
      getAllByIndex: async (name, index, value) =>
        [...store(name).values()]
          .filter((row) => row !== null && typeof row === "object" && row[index] === value)
          .map((row) => structuredClone(row)),
    };
    try {
      return await run(tx);
    } catch (error) {
      this.data = previous;
      throw error;
    }
  }

  close() {
    this.closed = true;
  }
}

export function memoryRepository() {
  const backend = new MemoryBackend();
  return { backend, repository: openLocalRepository(backend) };
}

export function matterId(index = 1) {
  return `55555555-5555-4555-8555-${String(index).padStart(12, "0")}`;
}

export function actionInput(id, version, suffix, now = T1) {
  return {
    matterId: id,
    expectedVersion: version,
    eventId: `bbbbbbbb-bbbb-4bbb-8bbb-${String(suffix).padStart(12, "0")}`,
    requestId: `cccccccc-cccc-4ccc-8ccc-${String(suffix).padStart(12, "0")}`,
    now,
  };
}

export function createInput(id, title = "合成案件", suffix = 1, now = T0) {
  return {
    matterId: id,
    eventId: `aaaaaaaa-aaaa-4aaa-8aaa-${String(suffix).padStart(12, "0")}`,
    requestId: `dddddddd-dddd-4ddd-8ddd-${String(suffix).padStart(12, "0")}`,
    now,
    title,
  };
}

export function command(expectedVersion, payload) {
  return { contractVersion: CONTRACT_VERSION, expectedVersion, payload };
}

export async function addTarget(repository, backend, id, index, route) {
  const loaded = await repository.loadMatter(ACTOR, id);
  if (!loaded.ok) throw new Error(loaded.error.message);
  const targetId = `66666666-6666-4666-8666-${String(index).padStart(12, "0")}`;
  const eventId = `77777777-7777-4777-8777-${String(index).padStart(12, "0")}`;
  const target = {
    id: targetId,
    matterId: id,
    status: "active",
    configVersion: 1,
    draftRevisionId: null,
    figureRevisionId: `99999999-9999-4999-8999-${String(index).padStart(12, "0")}`,
  };
  const committed = await repository.commit(ACTOR, command(loaded.data.version, {
    matter: { ...loaded.data.data.matter, version: loaded.data.version + 1, updatedAt: T1 },
    targets: [...loaded.data.data.targets, target],
    assets: loaded.data.data.assets,
    events: [{
      id: eventId,
      tenantId: ACTOR.tenantId,
      matterId: id,
      targetId,
      actorId: ACTOR.userId,
      actorKind: "user",
      action: "target.created",
      snapshot: null,
      jobId: null,
      resourceId: targetId,
      occurredAt: T1,
      metadata: { version: 1 },
    }],
    blobs: [],
  }), { requestId: `88888888-8888-4888-8888-${String(index).padStart(12, "0")}` });
  if (!committed.ok) throw new Error(committed.error.message);
  const key = [
    "targets/config",
    encodeURIComponent(ACTOR.tenantId),
    encodeURIComponent(id),
    encodeURIComponent(targetId),
    "1",
    encodeURIComponent(eventId),
  ].join("/");
  await backend.transaction("readwrite", (tx) => tx.put(STORES.blobs, key, {
    kind: "target.config",
    tenantId: ACTOR.tenantId,
    matterId: id,
    targetId,
    config: {
      targetId,
      version: 1,
      route,
      language: "zh-CN",
      purpose: "preparation",
      applicantIds: [],
      inventorIds: [],
      priorityClaims: [],
    },
    at: T1,
  }));
  return target;
}
