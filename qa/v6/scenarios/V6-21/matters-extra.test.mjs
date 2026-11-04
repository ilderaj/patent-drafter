import test from "node:test";
import assert from "node:assert/strict";

import { loadInbox } from "../../../../apps/web/src/v6/features/inbox/inbox.ts";
import { listMatterRows } from "../../../../apps/web/src/v6/features/matters/matters.ts";
import { createMatter, renameMatter } from "../../../../apps/web/src/v6/features/matters/matters.ts";
import { ACTOR, actionInput, createInput, matterId, memoryRepository, T0, T1 } from "./harness.mjs";

test("simultaneous renames produce one winner and one VERSION_CONFLICT without a duplicate event", async () => {
  const { repository } = memoryRepository();
  const id = matterId(31);
  const created = await createMatter(repository, ACTOR, createInput(id));
  assert.equal(created.ok, true, created.ok ? "" : created.error.message);
  const [left, right] = await Promise.all([
    renameMatter(repository, ACTOR, { ...actionInput(id, 1, 301), title: "甲" }),
    renameMatter(repository, ACTOR, { ...actionInput(id, 1, 302), title: "乙" }),
  ]);
  assert.equal([left, right].filter((result) => result.ok).length, 1);
  assert.equal([left, right].find((result) => !result.ok).error.code, "VERSION_CONFLICT");
  const read = await repository.loadMatter(ACTOR, id);
  assert.equal(read.data.version, 2);
  const events = await repository.listEvents(ACTOR, id);
  assert.equal(events.data.items.filter((event) => event.action === "matter.renamed").length, 1);
});

test("create, rename and archive append one whitelisted event each and archive hides the matter from the active list", async () => {
  const { repository } = memoryRepository();
  const id = matterId(32);
  await createMatter(repository, ACTOR, createInput(id));
  await renameMatter(repository, ACTOR, { ...actionInput(id, 1, 321), title: "新标题" });
  const { archiveMatter } = await import("../../../../apps/web/src/v6/features/matters/matters.ts");
  await archiveMatter(repository, ACTOR, actionInput(id, 2, 322));
  const events = await repository.listEvents(ACTOR, id);
  assert.deepEqual(events.data.items.map((event) => event.action).sort(), ["matter.archived", "matter.created", "matter.renamed"]);
  for (const event of events.data.items) assert.deepEqual(Object.keys(event.metadata), ["version"]);
  const rows = await listMatterRows(repository, ACTOR);
  assert.equal(rows.ok, true);
  const { filterAndPaginateMatterRows } = await import("../../../../apps/web/src/v6/features/matters/matters.ts");
  assert.equal(filterAndPaginateMatterRows(rows.data.rows, { status: "active" }).total, 0);
  assert.equal(filterAndPaginateMatterRows(rows.data.rows, { status: "archived" }).total, 1);
});

test("V6-21-A01 inbox derives an accessible item whose root-cause fix resolves it", async () => {
  const { backend, repository } = memoryRepository();
  const id = matterId(33);
  await createMatter(repository, ACTOR, createInput(id));
  await backend.transaction("readwrite", (tx) => tx.put("blobs", `intake/snapshot/${id}/1`, {
    kind: "intake.snapshot",
    snapshot: {
      matterId: id,
      version: 1,
      sourceIds: [],
      facts: [],
      conflicts: [{ id: "aaaaaaaa-aaaa-4aaa-8aaa-000000000033", factIds: [], state: "open", chosenFactIds: [], reason: null }],
      answers: { problem: "", difference: "", inventorIds: [], disclosure: null, maturity: null, disclosureDetail: null },
      parties: [],
      createdBy: ACTOR.userId,
      createdAt: T0,
    },
    provenance: {},
    requestKey: null,
  }));
  const before = await loadInbox(repository, ACTOR);
  assert.equal(before.ok, true, before.ok ? "" : before.error.message);
  assert.equal(before.data.items.length, 1);
  assert.equal(before.data.items[0].state, "open");
  await backend.transaction("readwrite", (tx) => tx.put("blobs", `intake/snapshot/${id}/1`, {
    kind: "intake.snapshot",
    snapshot: {
      matterId: id,
      version: 1,
      sourceIds: [],
      facts: [],
      conflicts: [{ id: "aaaaaaaa-aaaa-4aaa-8aaa-000000000033", factIds: [], state: "resolved", chosenFactIds: [], reason: null }],
      answers: { problem: "", difference: "", inventorIds: [], disclosure: null, maturity: null, disclosureDetail: null },
      parties: [],
      createdBy: ACTOR.userId,
      createdAt: T0,
    },
    provenance: {},
    requestKey: null,
  }));
  const after = await loadInbox(repository, ACTOR);
  assert.equal(after.data.items[0].state, "resolved");
  assert.equal(after.data.items[0].id, before.data.items[0].id);
});

test("inbox ignores manually authored message rows and shows only derived domain conditions", async () => {
  const { backend, repository } = memoryRepository();
  const id = matterId(34);
  await createMatter(repository, ACTOR, createInput(id));
  await backend.transaction("readwrite", (tx) => tx.put("blobs", "forged", {
    kind: "inbox.item",
    tenantId: ACTOR.tenantId,
    matterId: id,
    item: { kind: "review", targetId: null, title: "示例待办", resourceId: "bbbbbbbb-bbbb-4bbb-8bbb-000000000351", dueAt: null, createdAt: T1, actionKind: "open_review", actionContext: {}, state: "open" },
  }));
  const view = await loadInbox(repository, ACTOR);
  assert.equal(view.ok, true, view.ok ? "" : view.error.message);
  assert.equal(view.data.items.length, 0);
});

