/**
 * Shared V6-12 scenario harness: the V6-11 in-memory backend (same IndexedDB
 * adapter contract), a seeded synthetic matter with two targets whose first
 * figure sets are empty, and read helpers over persisted state. Not a test
 * file; the runner collects *.test.mjs only.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { CONTRACT_VERSION, STORES, openLocalRepository } from "../../../../apps/web/src/v6/lib/repository.ts";
import { createEmptyFigureSet } from "../../../../apps/web/src/v6/features/sources/drawings.ts";
import { MemoryBackend } from "../V6-11/harness.mjs";

export { MemoryBackend };

export const TENANT_A = "11111111-1111-4111-8111-111111111111";
export const TENANT_B = "22222222-2222-4222-8222-222222222222";
export const USER_A = "33333333-3333-4333-8333-333333333333";
export const USER_B = "44444444-4444-4444-8444-444444444444";
export const MATTER_ID = "55555555-5555-4555-8555-555555555555";
export const TARGET_A = "66666666-6666-4666-8666-666666666661";
export const TARGET_B = "66666666-6666-4666-8666-666666666662";
export const EMPTY_SET_A = "77777777-7777-4777-8777-777777777771";
export const EMPTY_SET_B = "77777777-7777-4777-8777-777777777772";
export const REQUEST_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
export const T0 = "2026-11-01T00:00:00.000Z";
export const T0_MS = Date.parse(T0);

export const ACTOR_A = Object.freeze({ tenantId: TENANT_A, userId: USER_A });
/** Same tenant, different user: not the matter's owner. */
export const ACTOR_OTHER_USER = Object.freeze({ tenantId: TENANT_A, userId: USER_B });
/** Different tenant entirely. */
export const ACTOR_OTHER_TENANT = Object.freeze({ tenantId: TENANT_B, userId: USER_A });

export const clock = () => T0_MS;

export function fixture(name) {
  return new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));
}

function target(id, figureRevisionId) {
  return {
    id,
    matterId: MATTER_ID,
    status: "active",
    configVersion: 1,
    draftRevisionId: null,
    figureRevisionId,
  };
}

/**
 * A matter with targets A and B sharing one drawing library (S02-A08). There is
 * no target-creation command in this build, so the seed writes the targets the
 * way a future `target.created` command would, then materialises each target's
 * empty first figure set through the module under test.
 */
export async function seed({ targets = 2 } = {}) {
  const backend = new MemoryBackend();
  const repository = openLocalRepository(backend);
  const created = await repository.commit(
    ACTOR_A,
    {
      contractVersion: CONTRACT_VERSION,
      expectedVersion: 0,
      payload: {
        matter: {
          id: MATTER_ID,
          tenantId: TENANT_A,
          version: 1,
          title: "V6-12 合成案卷",
          status: "active",
          sourceVersion: 1,
          createdBy: USER_A,
          createdAt: T0,
          updatedAt: T0,
        },
        targets: [target(TARGET_A, EMPTY_SET_A), target(TARGET_B, EMPTY_SET_B)].slice(0, targets),
        assets: [],
        events: [],
        blobs: [],
      },
    },
    { requestId: REQUEST_ID },
  );
  assert.equal(created.ok, true, created.ok ? "" : JSON.stringify(created.error));
  for (const id of [TARGET_A, TARGET_B].slice(0, targets)) {
    const empty = await createEmptyFigureSet(repository, ACTOR_A, MATTER_ID, id, { now: clock });
    assert.equal(empty.ok, true, empty.ok ? "" : JSON.stringify(empty.error));
  }
  return { backend, repository };
}

export async function aggregateOf(repository) {
  const loaded = await repository.loadMatter(ACTOR_A, MATTER_ID);
  assert.equal(loaded.ok, true, loaded.ok ? "" : JSON.stringify(loaded.error));
  return loaded.data.data;
}

export function events(backend) {
  return [...backend.store(STORES.events).values()];
}

export function rowsOfKind(backend, kind) {
  return [...backend.store(STORES.blobs).values()].filter((value) => value?.kind === kind);
}

/** Every key/value in every store, cloned, so a test can prove "wrote nothing". */
export function dump(backend) {
  return Object.fromEntries(
    [...backend.data].map(([name, store]) => [name, structuredClone([...store].sort(([a], [b]) => (a < b ? -1 : 1)))]),
  );
}

export function entry(figureId, number, drawingId, title = `图${number}`) {
  return { figureId, number, title, drawingId, numerals: [] };
}
