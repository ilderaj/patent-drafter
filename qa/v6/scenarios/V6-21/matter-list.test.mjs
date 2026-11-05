import test from "node:test";
import assert from "node:assert/strict";

import {
  filterAndPaginateMatterRows,
  listMatterRows,
  shouldRefreshMatterRows,
} from "../../../../apps/web/src/v6/features/matters/matters.ts";
import { archiveMatter, createMatter } from "../../../../apps/web/src/v6/features/matters/matters.ts";
import { ACTOR, actionInput, addTarget, createInput, matterId, memoryRepository, T0, T1 } from "./harness.mjs";

test("matter list derives committed routes, sorts and paginates 25 rows, and filters by status, route, action and title", async () => {
  const { backend, repository } = memoryRepository();
  for (let index = 1; index <= 27; index += 1) {
    const id = matterId(index);
    const title = index === 2 ? "专利列表标题案件" : `列表案件 ${index}`;
    const created = await createMatter(repository, ACTOR, createInput(id, title, index, T0));
    assert.equal(created.ok, true, created.ok ? "" : created.error.message);
  }
  const target = await addTarget(repository, backend, matterId(2), 1, "pct");
  assert.equal(target.status, "active");
  const archived = await archiveMatter(repository, ACTOR, actionInput(matterId(27), 1, 80, T1));
  assert.equal(archived.ok, true, archived.ok ? "" : archived.error.message);

  const loaded = await listMatterRows(repository, ACTOR, { now: 1234 });
  assert.equal(loaded.ok, true, loaded.ok ? "" : loaded.error.message);
  assert.equal(loaded.data.loadedAt, 1234);

  const all = filterAndPaginateMatterRows(loaded.data.rows, { status: "all", page: 1 });
  const secondPage = filterAndPaginateMatterRows(loaded.data.rows, { status: "all", page: 2 });
  assert.equal(all.total, 27);
  assert.equal(all.items.length, 25);
  assert.equal(secondPage.items.length, 2);
  assert.deepEqual(all.items.slice(0, 4).map((row) => row.matter.id), [matterId(2), matterId(27), matterId(1), matterId(3)]);

  assert.equal(filterAndPaginateMatterRows(loaded.data.rows, { status: "archived" }).total, 1);
  assert.deepEqual(
    filterAndPaginateMatterRows(loaded.data.rows, { status: "all", route: "pct" }).items.map((row) => row.matter.id),
    [matterId(2)],
  );
  assert.equal(filterAndPaginateMatterRows(loaded.data.rows, { status: "all", nextAction: "add_sources" }).total, 27);
  assert.deepEqual(
    filterAndPaginateMatterRows(loaded.data.rows, { status: "all", title: "专利列表标题" }).items.map((row) => row.matter.id),
    [matterId(2)],
  );
  assert.equal(filterAndPaginateMatterRows(loaded.data.rows, { status: "all", title: "正文里不存在的词" }).total, 0);
  assert.equal(loaded.data.rows.find((row) => row.matter.id === matterId(2)).targets[0].route, "pct");
});

test("matter data refreshes after 60 seconds or when the window regains focus", () => {
  assert.equal(shouldRefreshMatterRows(null, 1), true);
  assert.equal(shouldRefreshMatterRows(1_000, 61_000), false);
  assert.equal(shouldRefreshMatterRows(1_000, 61_001), true);
  assert.equal(shouldRefreshMatterRows(61_000, 61_000, true), true);
});
