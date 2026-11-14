import test from "node:test";
import assert from "node:assert/strict";

import { ACTOR, createInput, matterId, memoryRepository } from "./harness.mjs";
import { createMatter } from "../../../../apps/web/src/v6/features/matters/matters.ts";
import { filterAndPaginateMatterRows, listMatterRows } from "../../../../apps/web/src/v6/features/matters/matters.ts";
import { loadInbox, markInboxItemRead } from "../../../../apps/web/src/v6/features/inbox/inbox.ts";

test("pagination pages keep their existing results when a later list refresh fails", async () => {
  const { backend, repository } = memoryRepository();
  for (let index = 1; index <= 27; index += 1) {
    const result = await createMatter(repository, ACTOR, createInput(matterId(50 + index), `案件 ${index}`, 50 + index));
    assert.equal(result.ok, true);
  }
  const firstRead = await listMatterRows(repository, ACTOR);
  assert.equal(firstRead.ok, true);
  const firstPage = filterAndPaginateMatterRows(firstRead.data.rows, { page: 2 });
  assert.equal(firstPage.items.length, 2);
  const loadedRows = firstRead.data.rows;
  backend.closed = true;
  const failedRefresh = await listMatterRows(repository, ACTOR);
  assert.equal(failedRefresh.ok, false);
  assert.equal(failedRefresh.error.code, "STORAGE_UNAVAILABLE");
  const retainedPage = filterAndPaginateMatterRows(loadedRows, { page: 2 });
  assert.equal(retainedPage.items[0].matter.id, matterId(76));
  assert.equal(retainedPage.items[1].matter.id, matterId(77));
});

test("read cursor belongs to the actor and leaves underlying open business condition unchanged", async () => {
  const { backend, repository } = memoryRepository();
  const id = matterId(88);
  await createMatter(repository, ACTOR, createInput(id, "已读光标", 88));
  const conflictId = "aaaaaaaa-aaaa-4aaa-8aaa-000000000088";
  await backend.transaction("readwrite", (tx) => tx.put("blobs", `intake/snapshot/${id}/1`, {
    kind: "intake.snapshot",
    snapshot: {
      matterId: id,
      version: 1,
      conflicts: [{ id: conflictId, factIds: [], state: "open", chosenFactIds: [], reason: null }],
      answers: { problem: "", difference: "", inventorIds: [], disclosure: null, maturity: null },
      createdAt: "2026-11-01T00:00:00.000Z",
    },
  }));
  const view = await loadInbox(repository, ACTOR);
  const item = view.data.items[0];
  const ownerRead = await markInboxItemRead(repository, ACTOR, id, item.id, "2026-11-01T01:00:00.000Z");
  assert.equal(ownerRead.ok, true);
  assert.equal(ownerRead.data.state, "open");
  const outsider = Object.freeze({ tenantId: ACTOR.tenantId, userId: "22222222-2222-4222-8222-222222222222" });
  const outsiderView = await loadInbox(repository, outsider);
  assert.equal(outsiderView.ok, true);
  assert.equal(outsiderView.data.items.length, 0);
  const ownerAgain = await loadInbox(repository, ACTOR);
  assert.equal(ownerAgain.data.items[0].readAt, "2026-11-01T01:00:00.000Z");
  assert.equal((await repository.loadMatter(ACTOR, id)).data.version, 1);
});
