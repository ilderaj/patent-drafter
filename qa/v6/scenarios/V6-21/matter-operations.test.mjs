import test from "node:test";
import assert from "node:assert/strict";

import {
  archiveMatter,
  createMatter,
  renameMatter,
  unarchiveMatter,
} from "../../../../apps/web/src/v6/features/matters/matters.ts";
import {
  ACTOR,
  OTHER_ACTOR,
  actionInput,
  addTarget,
  command,
  createInput,
  matterId,
  memoryRepository,
  T1,
} from "./harness.mjs";
import { sha256Hex } from "../../../../apps/web/src/v6/lib/repository.ts";

test("create retry with the same matter id returns the persisted matter without a duplicate creation event", async () => {
  const { repository } = memoryRepository();
  const id = matterId(9);
  const first = await createMatter(repository, ACTOR, createInput(id, "幂等创建", 9));
  const retried = await createMatter(repository, ACTOR, createInput(id, "幂等创建", 9));
  assert.equal(first.ok, true);
  assert.equal(retried.ok, true, retried.ok ? "" : retried.error.message);
  assert.equal(retried.data.version, 1);
  const events = await repository.listEvents(ACTOR, id);
  assert.equal(events.data.items.filter((event) => event.action === "matter.created").length, 1);
});

test("create retry with a colliding id from another actor remains RESOURCE_NOT_FOUND", async () => {
  const { repository } = memoryRepository();
  const id = matterId(10);
  const first = await createMatter(repository, ACTOR, createInput(id));
  const foreign = await createMatter(repository, OTHER_ACTOR, createInput(id, "不能读取", 10));
  assert.equal(first.ok, true);
  assert.equal(foreign.ok, false);
  assert.equal(foreign.error.code, "RESOURCE_NOT_FOUND");
});

test("matter create, rename and archive retain version checks and reject ordinary archived writes", async () => {
  const { repository } = memoryRepository();
  const id = matterId();

  const created = await createMatter(repository, ACTOR, createInput(id));
  assert.equal(created.ok, true, created.ok ? "" : created.error.message);
  assert.equal(created.data.version, 1);
  assert.equal(created.data.data.matter.title, "合成案件");

  const renamed = await renameMatter(repository, ACTOR, {
    ...actionInput(id, 1, 2, T1),
    title: "  更新后的案件  ",
  });
  assert.equal(renamed.ok, true, renamed.ok ? "" : renamed.error.message);
  assert.equal(renamed.data.data.matter.title, "更新后的案件");
  assert.equal(renamed.data.version, 2);

  const archived = await archiveMatter(repository, ACTOR, actionInput(id, 2, 3));
  assert.equal(archived.ok, true, archived.ok ? "" : archived.error.message);
  assert.equal(archived.data.data.matter.status, "archived");
  assert.equal(archived.data.version, 3);

  const refusedRename = await renameMatter(repository, ACTOR, {
    ...actionInput(id, 3, 4),
    title: "不能保存",
  });
  assert.equal(refusedRename.ok, false);
  assert.equal(refusedRename.error.code, "INVALID_TRANSITION");

  const read = await repository.loadMatter(ACTOR, id);
  assert.equal(read.ok, true);
  assert.equal(read.data.version, 3);
  assert.equal(read.data.data.matter.status, "archived");
  assert.equal(read.data.data.matter.title, "更新后的案件");
});

test("repository unarchive updates only archived matter state with one version bump and no event or blob writes", async () => {
  const { backend, repository } = memoryRepository();
  const id = matterId(21);
  const created = await createMatter(repository, ACTOR, createInput(id, "待取消归档", 21));
  assert.equal(created.ok, true);
  const target = await addTarget(repository, backend, id, 21, "pct");
  const beforeTargeted = await repository.loadMatter(ACTOR, id);
  const assetBytes = new TextEncoder().encode("合成附件字节");
  const sha256 = await sha256Hex(assetBytes);
  const asset = {
    id: "77777777-7777-4777-8777-000000000021",
    tenantId: ACTOR.tenantId,
    matterId: id,
    serviceOrderId: null,
    purpose: "source",
    originalName: "synthetic.txt",
    mime: "text/plain",
    byteLength: assetBytes.byteLength,
    sha256,
    state: "available",
    objectKey: `local/${id}/synthetic.txt`,
    createdAt: T1,
  };
  const addedAsset = await repository.commit(ACTOR, command(beforeTargeted.data.version, {
    matter: { ...beforeTargeted.data.data.matter, version: beforeTargeted.data.version + 1, updatedAt: T1 },
    targets: beforeTargeted.data.data.targets,
    assets: [...beforeTargeted.data.data.assets, asset],
    events: [],
    blobs: [{ assetId: asset.id, bytes: assetBytes, sha256, byteLength: assetBytes.byteLength }],
  }), { requestId: "aaaaaaaa-aaaa-4aaa-8aaa-000000000021" });
  assert.equal(addedAsset.ok, true);
  const archived = await archiveMatter(repository, ACTOR, actionInput(id, addedAsset.data.version, 22));
  assert.equal(archived.ok, true);
  const before = await repository.loadMatter(ACTOR, id);
  const eventsBefore = await repository.listEvents(ACTOR, id);
  const blobsBefore = await backend.transaction("readonly", (tx) => tx.getAll("blobs"));
  const blobRowBefore = blobsBefore.find((row) => row && row.asset?.id === asset.id);

  const result = await repository.unarchiveMatter(ACTOR, {
    matterId: id,
    expectedVersion: before.data.version,
    updatedAt: "2026-11-01T02:00:00.000Z",
  });
  assert.equal(result.ok, true, result.ok ? "" : JSON.stringify(result.error));
  assert.equal(result.data.version, before.data.version + 1);
  assert.equal(result.data.matter.status, "active");
  assert.equal(result.data.matter.updatedAt, "2026-11-01T02:00:00.000Z");

  const after = await repository.loadMatter(ACTOR, id);
  assert.equal(after.data.version, result.data.version);
  assert.deepEqual(after.data.data.targets, before.data.data.targets);
  assert.deepEqual(after.data.data.assets, before.data.data.assets);
  assert.deepEqual((await repository.listEvents(ACTOR, id)).data.items, eventsBefore.data.items);
  const blobsAfter = await backend.transaction("readonly", (tx) => tx.getAll("blobs"));
  assert.deepEqual(blobsAfter, blobsBefore);
  assert.deepEqual(blobsAfter.find((row) => row && row.asset?.id === asset.id), blobRowBefore);
  assert.deepEqual((await repository.readBlob(ACTOR, asset.id)).data.data.bytes, assetBytes);
  assert.equal(after.data.data.targets[0].id, target.id);
});

test("repository unarchive rejects a stale expectedVersion with the stored version", async () => {
  const { repository } = memoryRepository();
  const id = matterId(22);
  const created = await createMatter(repository, ACTOR, createInput(id, "旧版本", 22));
  await archiveMatter(repository, ACTOR, actionInput(id, created.data.version, 23));
  const latest = await repository.loadMatter(ACTOR, id);
  const result = await repository.unarchiveMatter(ACTOR, { matterId: id, expectedVersion: 1, updatedAt: T1 });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "VERSION_CONFLICT");
  assert.equal(result.error.latestVersion, latest.data.version);
});

test("repository unarchive accepts only archived matters", async () => {
  const { backend, repository } = memoryRepository();
  const activeId = matterId(23);
  const active = await createMatter(repository, ACTOR, createInput(activeId, "进行中", 23));
  const activeResult = await repository.unarchiveMatter(ACTOR, { matterId: activeId, expectedVersion: active.data.version, updatedAt: T1 });
  assert.equal(activeResult.ok, false);
  assert.equal(activeResult.error.code, "INVALID_TRANSITION");

  const pendingId = matterId(24);
  const pending = await createMatter(repository, ACTOR, createInput(pendingId, "待删除", 24));
  await backend.transaction("readwrite", async (tx) => {
    const aggregate = await tx.get("matters", pendingId);
    aggregate.matter.status = "deletion_pending";
    await tx.put("matters", pendingId, aggregate);
  });
  const pendingResult = await repository.unarchiveMatter(ACTOR, { matterId: pendingId, expectedVersion: pending.data.version, updatedAt: T1 });
  assert.equal(pendingResult.ok, false);
  assert.equal(pendingResult.error.code, "INVALID_TRANSITION");
});

const FOREIGN_TENANT_ACTOR = Object.freeze({
  tenantId: "22222222-2222-4222-8222-222222222222",
  userId: "33333333-3333-4333-8333-333333333333",
});

test("repository unarchive hides missing and inaccessible matters as RESOURCE_NOT_FOUND", async () => {
  const { repository } = memoryRepository();
  const id = matterId(25);
  const created = await createMatter(repository, ACTOR, createInput(id, "私有", 25));
  await archiveMatter(repository, ACTOR, actionInput(id, created.data.version, 26));
  const archived = await repository.loadMatter(ACTOR, id);
  const missing = await repository.unarchiveMatter(ACTOR, { matterId: matterId(99), expectedVersion: 1, updatedAt: T1 });
  assert.equal(missing.ok, false);
  assert.equal(missing.error.code, "RESOURCE_NOT_FOUND");
  const sameTenantOtherUser = await repository.unarchiveMatter(OTHER_ACTOR, { matterId: id, expectedVersion: archived.data.version, updatedAt: T1 });
  assert.equal(sameTenantOtherUser.ok, false);
  assert.equal(sameTenantOtherUser.error.code, "RESOURCE_NOT_FOUND");
  const otherTenant = await repository.unarchiveMatter(FOREIGN_TENANT_ACTOR, { matterId: id, expectedVersion: archived.data.version, updatedAt: T1 });
  assert.equal(otherTenant.ok, false);
  assert.equal(otherTenant.error.code, "RESOURCE_NOT_FOUND");
});

test("archived commits stay refused before unarchive and succeed with a newer version afterward", async () => {
  const { repository } = memoryRepository();
  const id = matterId(26);
  const created = await createMatter(repository, ACTOR, createInput(id, "归档写入门", 26));
  const archived = await archiveMatter(repository, ACTOR, actionInput(id, created.data.version, 27));
  const before = await repository.loadMatter(ACTOR, id);
  const refused = await renameMatter(repository, ACTOR, { ...actionInput(id, before.data.version, 28), title: "归档时不允许" });
  assert.equal(refused.ok, false);
  assert.equal(refused.error.code, "INVALID_TRANSITION");

  const restored = await repository.unarchiveMatter(ACTOR, { matterId: id, expectedVersion: before.data.version, updatedAt: "2026-11-01T03:00:00.000Z" });
  assert.equal(restored.ok, true);
  const saved = await renameMatter(repository, ACTOR, { ...actionInput(id, restored.data.version, 29), title: "重新开放后保存" });
  assert.equal(saved.ok, true, saved.ok ? "" : JSON.stringify(saved.error));
  assert.equal(saved.data.version, archived.data.version + 2);
  assert.equal(saved.data.data.matter.title, "重新开放后保存");
});
