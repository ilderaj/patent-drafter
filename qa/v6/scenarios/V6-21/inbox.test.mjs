import test from "node:test";
import assert from "node:assert/strict";

import { loadInbox, loadInboxItem, markInboxItemRead } from "../../../../apps/web/src/v6/features/inbox/inbox.ts";
import { addTarget, ACTOR, OTHER_ACTOR, createInput, matterId, memoryRepository, T0, T1 } from "./harness.mjs";
import { listMatterRows, readMatterContext } from "../../../../apps/web/src/v6/features/matters/matters.ts";

const targetId = "66666666-6666-4666-8666-000000000901";
const draftId = "99999999-9999-4999-8999-000000000901";
const conflictId = "aaaaaaaa-aaaa-4aaa-8aaa-000000000901";

async function createCase(repository, id = matterId(), suffix = Number(id.slice(-12)) || 1) {
  const created = await import("../../../../apps/web/src/v6/features/matters/matters.ts").then(({ createMatter }) =>
    createMatter(repository, ACTOR, createInput(id, "合成案件", suffix)),
  );
  assert.equal(created.ok, true, created.ok ? "" : created.error.message);
  return id;
}

async function putSnapshot(backend, id, conflicts = []) {
  await backend.transaction("readwrite", (tx) => tx.put("blobs", `intake/snapshot/${id}/1`, {
    kind: "intake.snapshot",
    snapshot: {
      matterId: id,
      version: 1,
      sourceIds: [],
      facts: [],
      conflicts,
      answers: { problem: "问题", difference: "区别", inventorIds: [ACTOR.userId], disclosure: "none", maturity: "idea", disclosureDetail: null },
      parties: [],
      createdBy: ACTOR.userId,
      createdAt: T0,
    },
    provenance: {},
    requestKey: null,
  }));
}

test("S06-A01 empty inbox is distinct from a failed read and contains no sample tasks", async () => {
  const { backend, repository } = memoryRepository();
  const empty = await loadInbox(repository, ACTOR);
  assert.equal(empty.ok, true);
  assert.equal(empty.data.items.length, 0);

  backend.closed = true;
  const failed = await loadInbox(repository, ACTOR);
  assert.equal(failed.ok, false);
  assert.equal(failed.error.code, "STORAGE_UNAVAILABLE");
});

test("S06-A02 an open fact conflict outranks a stale target input", async () => {
  const { backend, repository } = memoryRepository();
  const id = await createCase(repository);
  const target = await addTarget(repository, backend, id, 901, "cn_invention");
  const loaded = await repository.loadMatter(ACTOR, id);
  const newTarget = { ...loaded.data.data.targets[0], draftRevisionId: draftId };
  const savedTarget = await repository.commit(ACTOR, {
    contractVersion: "v6.1",
    expectedVersion: loaded.data.version,
    payload: {
      matter: { ...loaded.data.data.matter, version: loaded.data.version + 1, updatedAt: T1 },
      targets: [newTarget],
      assets: loaded.data.data.assets,
      events: [],
      blobs: [],
    },
  }, { requestId: "cccccccc-cccc-4ccc-8ccc-000000000901" });
  assert.equal(savedTarget.ok, true);
  await putSnapshot(backend, id, [{ id: conflictId, factIds: [], state: "open", chosenFactIds: [], reason: null }]);
  await backend.transaction("readwrite", (tx) => tx.put("blobs", `draft/revision/${draftId}`, {
    kind: "draft.revision",
    revision: {
      id: draftId,
      matterId: id,
      targetId: target.id,
      input: { matterId: id, targetId: target.id, sourceVersion: 0, targetConfigVersion: 1, figureRevisionId: target.figureRevisionId },
      ast: { schemaVersion: "draft.v1", title: "合成草稿", claims: [], sections: [] },
      createdAt: T0,
    },
  }));

  const listed = await repository.loadMatter(ACTOR, id);
  const { listMatterRows } = await import("../../../../apps/web/src/v6/features/matters/matters.ts");
  const rows = await listMatterRows(repository, ACTOR);
  assert.equal(rows.ok, true, rows.ok ? "" : rows.error.message);
  assert.equal(rows.data.rows.find((row) => row.matter.id === id).targets[0].nextAction, "resolve_conflict");
  assert.equal(listed.data.data.targets[0].draftRevisionId, draftId);
});

test("S06-A04 reading a conflict keeps it open until the conflict state is resolved", async () => {
  const { backend, repository } = memoryRepository();
  const id = await createCase(repository);
  await putSnapshot(backend, id, [{ id: conflictId, factIds: [], state: "open", chosenFactIds: [], reason: null }]);
  const initial = await loadInbox(repository, ACTOR);
  assert.equal(initial.ok, true, initial.ok ? "" : initial.error.message);
  const item = initial.data.items.find((entry) => entry.resourceId === conflictId);
  assert.equal(item.state, "open");
  const matterBefore = await repository.loadMatter(ACTOR, id);

  const read = await markInboxItemRead(repository, ACTOR, id, item.id, T1);
  assert.equal(read.ok, true, read.ok ? "" : read.error.message);
  assert.equal(read.data.state, "open");
  assert.equal(read.data.readAt, T1);
  assert.equal((await repository.loadMatter(ACTOR, id)).data.version, matterBefore.data.version);

  await putSnapshot(backend, id, [{ id: conflictId, factIds: [], state: "resolved", chosenFactIds: [], reason: null }]);
  const fixed = await loadInboxItem(repository, ACTOR, id, item.id);
  assert.equal(fixed.ok, true, fixed.ok ? "" : fixed.error.message);
  assert.equal(fixed.data.state, "resolved");
  assert.equal(fixed.data.readAt, T1);
});

test("S06-A05 inaccessible matters have no inbox items and direct lookup returns not found", async () => {
  const { backend, repository } = memoryRepository();
  const id = await createCase(repository);
  await putSnapshot(backend, id, [{ id: conflictId, factIds: [], state: "open", chosenFactIds: [], reason: null }]);
  const ownerView = await loadInbox(repository, ACTOR);
  const item = ownerView.data.items.find((entry) => entry.resourceId === conflictId);
  const otherView = await loadInbox(repository, OTHER_ACTOR);
  assert.equal(otherView.ok, true);
  assert.equal(otherView.data.items.length, 0);
  const direct = await loadInboxItem(repository, OTHER_ACTOR, id, item.id);
  assert.equal(direct.ok, false);
  assert.equal(direct.error.code, "RESOURCE_NOT_FOUND");
});

test("S06-A07 suggested deadlines stay out while confirmed deadlines enter with a due time", async () => {
  const { backend, repository } = memoryRepository();
  const id = await createCase(repository);
  const target = await addTarget(repository, backend, id, 902, "pct");
  const deadline = (suffix, status) => ({
    kind: "deadline",
    deadline: {
      id: `dddddddd-dddd-4ddd-8ddd-0000000009${suffix}`,
      targetId: target.id,
      receiptId: null,
      title: `合成期限${suffix}`,
      dueOn: suffix === "01" ? "2027-01-12" : "2027-01-13",
      timeZone: "Asia/Shanghai",
      remindAt: null,
      basis: "manual",
      basisNote: "合成测试期限",
      ruleId: null,
      status,
      confirmedBy: status === "confirmed" ? ACTOR.userId : null,
      confirmedAt: status === "confirmed" ? T1 : null,
    },
  });
  await backend.transaction("readwrite", async (tx) => {
    await tx.put("blobs", "deadline/suggested", deadline("01", "suggested"));
    await tx.put("blobs", "deadline/confirmed", deadline("02", "confirmed"));
  });

  const view = await loadInbox(repository, ACTOR);
  assert.equal(view.ok, true, view.ok ? "" : view.error.message);
  assert.equal(view.data.items.some((entry) => entry.title === "合成期限01"), false);
  const confirmed = view.data.items.find((entry) => entry.title === "合成期限02");
  assert.ok(confirmed);
  assert.equal(confirmed.kind, "deadline");
  assert.equal(confirmed.group, "期限");
  assert.equal(confirmed.state, "open");
  assert.ok(confirmed.dueAt);
});

test("V6-21-A03 refreshing and reading use persisted state without repeating a business write", async () => {
  const { backend, repository } = memoryRepository();
  const id = await createCase(repository);
  await putSnapshot(backend, id, [{ id: conflictId, factIds: [], state: "open", chosenFactIds: [], reason: null }]);
  const first = await loadInbox(repository, ACTOR);
  const item = first.data.items[0];
  const versionBefore = (await repository.loadMatter(ACTOR, id)).data.version;
  await markInboxItemRead(repository, ACTOR, id, item.id, T1);
  const second = await loadInbox(repository, ACTOR);
  const same = second.data.items.find((entry) => entry.id === item.id);
  assert.equal(same.state, "open");
  assert.equal(same.readAt, T1);
  assert.equal((await repository.loadMatter(ACTOR, id)).data.version, versionBefore);
});

async function putStaleDraft(repository, backend, id, target) {
  const loaded = await repository.loadMatter(ACTOR, id);
  const newTarget = { ...loaded.data.data.targets[0], draftRevisionId: draftId };
  const saved = await repository.commit(ACTOR, {
    contractVersion: "v6.1",
    expectedVersion: loaded.data.version,
    payload: {
      matter: { ...loaded.data.data.matter, version: loaded.data.version + 1, updatedAt: T1 },
      targets: [newTarget],
      assets: loaded.data.data.assets,
      events: [],
      blobs: [],
    },
  }, { requestId: `cccccccc-cccc-4ccc-8ccc-${String(Number(target.id.slice(-3))).padStart(12, "0")}` });
  assert.equal(saved.ok, true);
  await backend.transaction("readwrite", (tx) => tx.put("blobs", `draft/revision/${draftId}`, {
    kind: "draft.revision",
    revision: {
      id: draftId,
      matterId: id,
      targetId: target.id,
      input: { matterId: id, targetId: target.id, sourceVersion: 0, targetConfigVersion: 1, figureRevisionId: target.figureRevisionId },
      ast: { schemaVersion: "draft.v1", title: "合成草稿", claims: [], sections: [] },
      createdAt: T0,
    },
  }));
}

test("B1 inbox actionKind is the shared nextAction projection for the target", async () => {
  const { backend, repository } = memoryRepository();
  const id = await createCase(repository);
  const target = await addTarget(repository, backend, id, 903, "cn_invention");
  await putSnapshot(backend, id, []);
  await putStaleDraft(repository, backend, id, target);

  const rows = await listMatterRows(repository, ACTOR);
  assert.equal(rows.ok, true, rows.ok ? "" : rows.error.message);
  const row = rows.data.rows.find((entry) => entry.matter.id === id);
  assert.equal(row.targets[0].nextAction, "refresh_inputs");
  const view = await loadInbox(repository, ACTOR);
  assert.equal(view.ok, true, view.ok ? "" : view.error.message);
  const check = view.data.items.find((entry) => entry.kind === "check" && entry.targetId === target.id);
  const confirmation = view.data.items.find((entry) => entry.kind === "ai_confirmation" && entry.targetId === target.id);
  assert.ok(check, "check item exists for a target with a draft");
  assert.equal(check.actionKind, row.targets[0].nextAction);
  assert.equal(confirmation.actionKind, row.targets[0].nextAction);
});

test("B2 one deletion_pending matter does not hide readable matters or inbox items", async () => {
  const { backend, repository } = memoryRepository();
  const readableId = await createCase(repository, matterId(910), 910);
  await putSnapshot(backend, readableId, [{ id: conflictId, factIds: [], state: "open", chosenFactIds: [], reason: null }]);
  const pendingId = await createCase(repository, matterId(911));
  await backend.transaction("readwrite", async (tx) => {
    const aggregate = await tx.get("matters", pendingId);
    aggregate.matter.status = "deletion_pending";
    await tx.put("matters", pendingId, aggregate);
  });

  const rows = await listMatterRows(repository, ACTOR);
  assert.equal(rows.ok, true, rows.ok ? "" : rows.error.message);
  assert.deepEqual(rows.data.rows.map((row) => row.matter.id), [readableId]);
  const view = await loadInbox(repository, ACTOR);
  assert.equal(view.ok, true, view.ok ? "" : view.error.message);
  assert.ok(view.data.items.some((item) => item.matterId === readableId && item.resourceId === conflictId));
  assert.equal(view.data.items.some((item) => item.matterId === pendingId), false);
  const direct = await readMatterContext(repository, ACTOR, pendingId);
  assert.equal(direct.ok, false);
  assert.equal(direct.error.code, "RESOURCE_NOT_FOUND");
});

test("B3 a successful parse job resolves on its parser terminal state while other job kinds keep their rule", async () => {
  const { backend, repository } = memoryRepository();
  const id = await createCase(repository, matterId(912));
  const parseJobId = "aaaaaaaa-aaaa-4aaa-8aaa-000000000912";
  const generateJobId = "aaaaaaaa-aaaa-4aaa-8aaa-000000000913";
  const job = (jobId, kind, disposition) => ({
    id: jobId,
    tenantId: ACTOR.tenantId,
    matterId: id,
    targetId: null,
    version: 1,
    kind,
    state: "succeeded",
    createdBy: ACTOR.userId,
    input: null,
    baseDraftRevisionId: null,
    payloadHash: "a".repeat(64),
    consentId: null,
    providerProfileId: null,
    providerProfileVersion: null,
    promptVersion: "v1",
    stageVersion: "v1",
    rulePackVersion: null,
    stage: null,
    attempt: 1,
    leaseOwner: null,
    leaseExpiresAt: null,
    progress: { completed: 1, total: 1, unit: "stage" },
    cancelRequestedAt: null,
    resultId: null,
    disposition,
    errorCode: null,
    usageUnknown: false,
    createdAt: T1,
  });
  await backend.transaction("readwrite", async (tx) => {
    await tx.put("blobs", `parse/job/${parseJobId}`, {
      kind: "parse.job",
      job: job(parseJobId, "parse", "ready"),
      sourceId: "88888888-8888-4888-8888-000000000912",
      assetId: "77777777-7777-4777-8777-000000000912",
      parserVersion: "v1",
      previousJobId: null,
      resumedFromStage: null,
      abandonedAt: null,
      ownerPageId: null,
    });
    await tx.put("blobs", `job/${generateJobId}`, { kind: "job", job: job(generateJobId, "generate", "ready") });
  });

  const view = await loadInbox(repository, ACTOR);
  assert.equal(view.ok, true, view.ok ? "" : view.error.message);
  const parseItem = view.data.items.find((item) => item.resourceId === parseJobId);
  const generateItem = view.data.items.find((item) => item.resourceId === generateJobId);
  assert.equal(parseItem.kind, "job");
  assert.equal(parseItem.state, "resolved");
  assert.equal(generateItem.kind, "job");
  assert.equal(generateItem.state, "open");
});

test("S06-A04 review item stays open after read until its feedback is processed", async () => {
  const { backend, repository } = memoryRepository();
  const id = await createCase(repository, matterId(914));
  const target = await addTarget(repository, backend, id, 914, "pct");
  const reviewId = "aaaaaaaa-aaaa-4aaa-8aaa-000000000914";
  const review = {
    id: reviewId,
    snapshot: {
      matterId: id,
      targetId: target.id,
      sourceVersion: 1,
      targetConfigVersion: 1,
      draftRevisionId: "99999999-9999-4999-8999-000000000914",
      figureRevisionId: target.figureRevisionId,
    },
    recipientUserId: ACTOR.userId,
    grantId: "bbbbbbbb-bbbb-4bbb-8bbb-000000000914",
    status: "sent",
    dueOn: null,
    expiresAt: T1,
    createdBy: ACTOR.userId,
    createdAt: T0,
  };
  const feedback = {
    id: "cccccccc-cccc-4ccc-8ccc-000000000914",
    reviewId,
    authorId: ACTOR.userId,
    nodeId: null,
    quoteHash: null,
    comment: "合成审阅意见",
    replacementText: null,
    attachmentIds: [],
    resolution: "open",
    resolutionReason: null,
  };
  await backend.transaction("readwrite", async (tx) => {
    await tx.put("blobs", "review/synthetic", { kind: "review", review });
    await tx.put("blobs", "review/feedback/synthetic", { kind: "review.feedback", feedback });
  });

  const initial = await loadInbox(repository, ACTOR);
  assert.equal(initial.ok, true, initial.ok ? "" : initial.error.message);
  const item = initial.data.items.find((entry) => entry.kind === "review" && entry.resourceId === reviewId);
  assert.equal(item.state, "open");
  const read = await markInboxItemRead(repository, ACTOR, id, item.id, T1);
  assert.equal(read.ok, true, read.ok ? "" : read.error.message);
  assert.equal(read.data.state, "open");
  assert.equal(read.data.readAt, T1);

  await backend.transaction("readwrite", (tx) => tx.put("blobs", "review/feedback/synthetic", {
    kind: "review.feedback",
    feedback: { ...feedback, resolution: "accepted", resolutionReason: "已处理" },
  }));
  const processed = await loadInboxItem(repository, ACTOR, id, item.id);
  assert.equal(processed.ok, true, processed.ok ? "" : processed.error.message);
  assert.equal(processed.data.state, "resolved");
  assert.equal(processed.data.readAt, T1);
});

