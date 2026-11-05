import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
const [{ confirmationSchema, activitySchema }, confirmation] = await Promise.all([
  import("../../../../packages/contracts/src/index.ts"),
  import("../../../../packages/domain/src/v6/confirmation.ts"),
]);
const { confirmationStatus, currentConfirmations } = confirmation;
import {
  ACTOR,
  CHUNK_ID,
  CHUNK_TEXT,
  FACT_ID,
  MATTER_ID,
  PARAGRAPH_ID,
  PARAGRAPH_IDS,
  QUOTE,
  SOURCE_ID,
  SOURCE_REF,
  T0,
  TARGET_ID,
  makeFixture,
  modules,
} from "./harness.mjs";

const { DraftReviewPanelView } = modules.reviewModule;

test("V6-19-A01: a confirmed AI paragraph traces through its source to the confirmer", async () => {
  const current = await makeFixture();
  const session = current.makeReviewSession();
  await session.load();

  let state = session.getSnapshot();
  assert.equal(state.phase, "ready");
  assert.equal(state.revision.revision.id, current.revision.id);
  assert.deepEqual(state.supportRows[0].factIds, [FACT_ID]);
  assert.deepEqual(state.supportRows[0].supportParagraphIds, [PARAGRAPH_ID]);
  assert.deepEqual(state.locators.map((locator) => locator.status), ["located"]);
  assert.equal(state.locators[0].ref.sourceId, SOURCE_ID);
  assert.equal(state.locators[0].ref.quote, QUOTE);
  assert.equal(state.locators[0].chunkText, "温控装置接收热量信号");

  const confirmed = await session.confirmParagraph(PARAGRAPH_ID);
  assert.equal(confirmed.ok, true, confirmed.ok ? "" : confirmed.error.message);
  state = session.getSnapshot();
  const aiParagraphIds = [PARAGRAPH_ID];
  assert.deepEqual(currentConfirmations(state.ledger, state.snapshot).map((item) => item.paragraphId), aiParagraphIds);
  assert.deepEqual(confirmationStatus(state.ledger, state.snapshot, aiParagraphIds).confirmedAiParagraphIds, aiParagraphIds);
  assert.equal(confirmationSchema.safeParse(state.ledger.confirmations[0]).success, true);
  assert.equal(state.ledger.confirmations[0].actorId, ACTOR.userId);
  assert.equal(state.ledger.confirmations[0].identity, "local_self_reported");
  assert.deepEqual(state.ledger.confirmations[0].snapshot, state.snapshot);
  assert.equal(state.ledger.confirmations[0].createdAt, "2026-11-05T12:00:00.000Z");

  const markup = renderToStaticMarkup(createElement(DraftReviewPanelView, {
    state,
    onRefresh() {},
    onConfirm() {},
    onRevoke() {},
    onLocateNode() {},
    onLocateSource() {},
  }));
  assert.match(markup, /要素支持/);
  assert.match(markup, /来源定位/);
  assert.match(markup, /已确认/);
  assert.match(markup, new RegExp(SOURCE_ID));
});

test("V6-19-A02: invalid source locators stay visible and a saved revision drops old confirmations", async () => {
  const staleRef = { ...SOURCE_REF, chunkHash: "f".repeat(64) };
  const current = await makeFixture({ sourceRef: staleRef, paragraphCount: 5 });
  const session = current.makeReviewSession();
  await session.load();

  let state = session.getSnapshot();
  assert.equal(state.locators[0].status, "unlocatable");
  assert.match(state.locators[0].reason, /chunkHash/);
  const initialMarkup = renderToStaticMarkup(createElement(DraftReviewPanelView, {
    state,
    onRefresh() {},
    onConfirm() {},
    onRevoke() {},
  }));
  assert.match(initialMarkup, /不可定位/);
  assert.match(initialMarkup, new RegExp(QUOTE));

  for (const paragraphId of PARAGRAPH_IDS) {
    const confirmed = await session.confirmParagraph(paragraphId);
    assert.equal(confirmed.ok, true, confirmed.ok ? "" : confirmed.error.message);
  }
  const edited = structuredClone(current.ast);
  edited.claims[0].paragraphs[1].text = "人工核对后的合成段落";
  edited.claims[0].paragraphs[1].origin = "mixed";
  const saved = await current.revisions.saveEditedRevision(MATTER_ID, TARGET_ID, current.revision.id, edited);
  assert.equal(saved.ok, true, saved.ok ? "" : JSON.stringify(saved.error));
  await session.refresh();

  state = session.getSnapshot();
  assert.equal(state.phase, "stale");
  assert.equal(state.revision.revision.id, saved.data.id);
  assert.equal(state.snapshot.draftRevisionId, saved.data.id);
  assert.deepEqual(state.ledger.confirmations.map((item) => item.snapshot.draftRevisionId), Array(5).fill(current.revision.id));
  assert.deepEqual(currentConfirmations(state.ledger, state.currentSnapshot), []);
  assert.deepEqual(confirmationStatus(state.ledger, state.currentSnapshot, PARAGRAPH_IDS).pendingAiParagraphIds, PARAGRAPH_IDS);
  assert.equal(state.locators[0].status, "unlocatable");
});

test("V6-19-A03: refresh and retry preserve confirmations and revocations without duplicate records", async () => {
  const current = await makeFixture();
  const firstSession = current.makeReviewSession();
  await firstSession.load();

  const first = await firstSession.confirmParagraph(PARAGRAPH_ID);
  const retry = await firstSession.confirmParagraph(PARAGRAPH_ID);
  assert.equal(first.ok, true);
  assert.equal(retry.ok, true);
  assert.equal(retry.created, false);
  assert.equal(firstSession.getSnapshot().ledger.confirmations.length, 1);
  const confirmationId = firstSession.getSnapshot().ledger.confirmations[0].id;

  const revoked = await firstSession.revokeParagraphConfirmation(confirmationId, "已重新核对段落");
  assert.equal(revoked.ok, true, JSON.stringify(revoked));
  assert.equal(firstSession.getSnapshot().ledger.confirmations.length, 1, "revocation keeps the confirmation record");
  assert.equal(firstSession.getSnapshot().ledger.revocations.length, 1);
  const duplicateRevoke = await firstSession.revokeParagraphConfirmation(confirmationId, "重复撤销");
  assert.equal(duplicateRevoke.ok, false);
  assert.equal(duplicateRevoke.error.code, "INVALID_TRANSITION");

  await firstSession.refresh();
  const retrySession = current.makeReviewSession("2026-11-05T12:01:00.000Z");
  await retrySession.load();
  const recovered = retrySession.getSnapshot();
  assert.equal(recovered.ledger.confirmations.length, 1);
  assert.equal(recovered.ledger.revocations.length, 1);
  assert.equal(recovered.ledger.confirmations[0].id, confirmationId);
  assert.equal(recovered.ledger.revocations[0].objectId, confirmationId);
  assert.deepEqual(currentConfirmations(recovered.ledger, recovered.currentSnapshot), []);
  assert.deepEqual(confirmationStatus(recovered.ledger, recovered.currentSnapshot, [PARAGRAPH_ID]).pendingAiParagraphIds, [PARAGRAPH_ID]);
  const recoveredMarkup = renderToStaticMarkup(createElement(DraftReviewPanelView, {
    state: recovered,
    onRefresh() {},
    onConfirm() {},
    onRevoke() {},
  }));
  assert.match(recoveredMarkup, /此修订的确认已撤销/);
  assert.doesNotMatch(recoveredMarkup, new RegExp(`data-testid="draft-review-confirm-${PARAGRAPH_ID}"`));
});

test("unresolvable SourceRefs show 不可定位 and keep their original quote", async () => {
  const verify = async (current, reason) => {
    const session = current.makeReviewSession();
    await session.load();
    const state = session.getSnapshot();
    assert.equal(state.locators[0].status, "unlocatable");
    assert.match(state.locators[0].reason, reason);
    const markup = renderToStaticMarkup(createElement(DraftReviewPanelView, {
      state,
      onRefresh() {},
      onConfirm() {},
      onRevoke() {},
    }));
    assert.match(markup, /不可定位/);
    assert.match(markup, new RegExp(QUOTE));
  };

  const missingChunk = await makeFixture({ sourceRef: { ...SOURCE_REF, chunkId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2" } });
  await verify(missingChunk, /chunk 不存在/);

  const quoteMismatch = await makeFixture({ sourceRef: { ...SOURCE_REF, start: 0, end: 2, quote: "失效" } });
  await verify(quoteMismatch, /偏移或原文引用不匹配/);

  const retiredSource = await makeFixture();
  await retiredSource.backend.transaction("readwrite", async (tx) => {
    const key = `parse/source/${SOURCE_ID}`;
    const row = await tx.get(modules.repositoryModule.STORES.blobs, key);
    row.source.retiredAt = "2026-11-05T12:01:00.000Z";
    await tx.put(modules.repositoryModule.STORES.blobs, key, row);
  });
  await verify(retiredSource, /来源已退役/);
});

test("V6-19 integrity: foreign source ownership is unlocatable", async () => {
  const current = await makeFixture();
  await current.backend.transaction("readwrite", async (tx) => {
    const key = `parse/source/${SOURCE_ID}`;
    const row = await tx.get(modules.repositoryModule.STORES.blobs, key);
    row.source.matterId = "99999999-9999-4999-8999-999999999998";
    await tx.put(modules.repositoryModule.STORES.blobs, key, row);
  });
  const session = current.makeReviewSession();
  await session.load();
  const locator = session.getSnapshot().locators[0];
  assert.equal(locator.status, "unlocatable");
  assert.match(locator.reason, /归属不匹配|不存在/);
  assert.equal(locator.chunkText, null);
});

test("V6-19 integrity: a foreign asset reference on the same matter is unlocatable", async () => {
  const current = await makeFixture();
  const loaded = await current.repository.loadMatter(ACTOR, MATTER_ID);
  const aggregate = loaded.data.data;
  const foreignAsset = {
    ...aggregate.assets[0],
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
    originalName: "foreign-asset.txt",
  };
  const committed = await current.repository.commit(ACTOR, {
    contractVersion: modules.repositoryModule.CONTRACT_VERSION,
    expectedVersion: aggregate.matter.version,
    payload: {
      matter: { ...aggregate.matter, version: aggregate.matter.version + 1, updatedAt: "2026-11-05T12:01:00.000Z" },
      targets: aggregate.targets,
      assets: [...aggregate.assets, foreignAsset],
      events: [],
      blobs: [],
    },
  }, { requestId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee3" });
  assert.equal(committed.ok, true, committed.ok ? "" : JSON.stringify(committed.error));
  await current.backend.transaction("readwrite", async (tx) => {
    const key = `parse/source/${SOURCE_ID}`;
    const row = await tx.get(modules.repositoryModule.STORES.blobs, key);
    row.source.assetId = foreignAsset.id;
    await tx.put(modules.repositoryModule.STORES.blobs, key, row);
  });
  const session = current.makeReviewSession();
  await session.load();
  const locator = session.getSnapshot().locators[0];
  assert.equal(locator.status, "unlocatable");
  assert.match(locator.reason, /归属不匹配/);
  assert.equal(locator.chunkText, null);
});

test("V6-19 integrity: altered chunk text with the old hash is unlocatable", async () => {
  const current = await makeFixture();
  await current.backend.transaction("readwrite", async (tx) => {
    const key = `parse/chunks/${SOURCE_ID}/synthetic-v1`;
    const row = await tx.get(modules.repositoryModule.STORES.blobs, key);
    row.chunks[0].text = "温控装置吸收热量信号";
    await tx.put(modules.repositoryModule.STORES.blobs, key, row);
  });
  const session = current.makeReviewSession();
  await session.load();
  const locator = session.getSnapshot().locators[0];
  assert.equal(locator.status, "unlocatable");
  assert.match(locator.reason, /chunkHash/i);
  assert.equal(locator.chunkText, null);
  const markup = renderToStaticMarkup(createElement(DraftReviewPanelView, {
    state: session.getSnapshot(),
    onRefresh() {},
    onConfirm() {},
    onRevoke() {},
  }));
  assert.doesNotMatch(markup, /温控装置吸收热量信号/);
});

test("V6-19 integrity: a source-version bump makes the old revision locator stale", async () => {
  const current = await makeFixture();
  const loaded = await current.repository.loadMatter(ACTOR, MATTER_ID);
  assert.equal(loaded.ok, true);
  const aggregate = loaded.data.data;
  const moved = await current.repository.commit(ACTOR, {
    contractVersion: modules.repositoryModule.CONTRACT_VERSION,
    expectedVersion: aggregate.matter.version,
    payload: {
      matter: { ...aggregate.matter, version: aggregate.matter.version + 1, sourceVersion: 2, updatedAt: "2026-11-05T12:01:00.000Z" },
      targets: aggregate.targets,
      assets: aggregate.assets,
      events: [],
      blobs: [],
    },
  }, { requestId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2" });
  assert.equal(moved.ok, true, moved.ok ? "" : JSON.stringify(moved.error));
  const session = current.makeReviewSession();
  await session.load();
  const state = session.getSnapshot();
  assert.equal(state.phase, "stale");
  assert.equal(state.isCurrent, false);
  assert.equal(state.locators[0].status, "unlocatable");
  assert.match(state.locators[0].reason, /旧事实版本/);
  assert.equal(state.locators[0].chunkText, null);
});

test("V6-19 C03: confirm and revoke bump matter.version and append one event each", async () => {
  const current = await makeFixture();
  const before = await current.repository.loadMatter(ACTOR, MATTER_ID);
  const startVersion = before.data.data.matter.version;
  const session = current.makeReviewSession();
  await session.load();
  const confirmed = await session.confirmParagraph(PARAGRAPH_ID);
  assert.equal(confirmed.ok, true, JSON.stringify(confirmed));
  const afterConfirm = await current.repository.loadMatter(ACTOR, MATTER_ID);
  assert.equal(afterConfirm.data.data.matter.version, startVersion + 1);
  assert.equal(afterConfirm.data.data.matter.updatedAt, "2026-11-05T12:00:00.000Z");
  const confirmationId = session.getSnapshot().ledger.confirmations[0].id;
  const revoked = await session.revokeParagraphConfirmation(confirmationId, "C03 版本测试撤销");
  assert.equal(revoked.ok, true, JSON.stringify(revoked));
  const afterRevoke = await current.repository.loadMatter(ACTOR, MATTER_ID);
  assert.equal(afterRevoke.data.data.matter.version, startVersion + 2);
  const events = await current.repository.listEvents(ACTOR, MATTER_ID);
  assert.equal(events.ok, true);
  assert.equal(events.data.items.filter((event) => event.action === "confirmation.created").length, 1);
  assert.equal(events.data.items.filter((event) => event.action === "confirmation.revoked").length, 1);

  const repeated = await session.confirmParagraph(PARAGRAPH_ID);
  assert.equal(repeated.ok, true);
  assert.equal(repeated.created, false);
  const afterRepeat = await current.repository.loadMatter(ACTOR, MATTER_ID);
  assert.equal(afterRepeat.data.data.matter.version, startVersion + 2, "idempotent retry does not bump version");
});

test("V6-19 C03: a version conflict or write fault rolls back every confirmation write", async () => {
  const current = await makeFixture();
  const session = current.makeReviewSession();
  await session.load();
  const fixture = await current.repository.loadMatter(ACTOR, MATTER_ID);
  const aggregate = fixture.data.data;

  const currentSnapshot = session.getSnapshot().snapshot;
  const event = activitySchema.parse({
    id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee9",
    tenantId: ACTOR.tenantId,
    matterId: MATTER_ID,
    targetId: TARGET_ID,
    actorId: ACTOR.userId,
    actorKind: "user",
    action: "confirmation.created",
    snapshot: currentSnapshot,
    jobId: null,
    resourceId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee8",
    occurredAt: "2026-11-05T12:00:00.000Z",
    metadata: { count: 1 },
  });
  const conflicting = await current.repository.writeConfirmationLedger(
    ACTOR,
    MATTER_ID,
    aggregate.matter.version + 1,
    { matterId: MATTER_ID, confirmations: [], revocations: [] },
    event,
    event.occurredAt,
  );
  assert.equal(conflicting.ok, false);
  assert.equal(conflicting.error.code, "VERSION_CONFLICT");
  const unchanged = await current.repository.loadMatter(ACTOR, MATTER_ID);
  assert.equal(unchanged.data.data.matter.version, aggregate.matter.version);

  current.backend.setPutFault(({ store }) => store === "blobs" ? new Error("synthetic ledger write fault") : null);
  const failed = await current.repository.writeConfirmationLedger(
    ACTOR,
    MATTER_ID,
    aggregate.matter.version,
    { matterId: MATTER_ID, confirmations: [], revocations: [] },
    event,
    event.occurredAt,
  );
  current.backend.setPutFault(null);
  assert.equal(failed.ok, false);
  assert.equal(failed.error.code, "STORAGE_UNAVAILABLE");
  const afterFailure = await current.repository.loadMatter(ACTOR, MATTER_ID);
  assert.equal(afterFailure.data.data.matter.version, aggregate.matter.version);
  const events = await current.repository.listEvents(ACTOR, MATTER_ID);
  assert.equal(events.data.items.filter((event) => event.action === "confirmation.created").length, 0);
});

test("V6-19 round2: a historical confirmation can be revoked after a new revision is saved", async () => {
  const current = await makeFixture();
  const session = current.makeReviewSession();
  await session.load();
  const confirmed = await session.confirmParagraph(PARAGRAPH_ID);
  assert.equal(confirmed.ok, true, JSON.stringify(confirmed));
  const confirmationId = session.getSnapshot().ledger.confirmations[0].id;
  const afterConfirm = await current.repository.loadMatter(ACTOR, MATTER_ID);
  const versionAfterConfirm = afterConfirm.data.data.matter.version;

  const edited = structuredClone(current.ast);
  edited.claims[0].paragraphs[0].text = "人工修订后的合成段落";
  const saved = await current.revisions.saveEditedRevision(MATTER_ID, TARGET_ID, current.revision.id, edited);
  assert.equal(saved.ok, true, saved.ok ? "" : JSON.stringify(saved.error));
  const afterRevision = await current.repository.loadMatter(ACTOR, MATTER_ID);
  assert.equal(afterRevision.data.data.matter.version, versionAfterConfirm + 1);

  await session.refresh();
  assert.equal(session.getSnapshot().phase, "stale");
  const revoked = await session.revokeParagraphConfirmation(confirmationId, "历史修订的确认不再有效");
  assert.equal(revoked.ok, true, JSON.stringify(revoked));
  const afterRevoke = await current.repository.loadMatter(ACTOR, MATTER_ID);
  assert.equal(afterRevoke.data.data.matter.version, versionAfterConfirm + 2, "historical revocation bumps matter.version once");

  const state = session.getSnapshot();
  assert.equal(state.ledger.confirmations.length, 1);
  assert.equal(state.ledger.revocations.length, 1);
  assert.equal(state.ledger.revocations[0].objectId, confirmationId);
  assert.equal(state.ledger.revocations[0].reason, "历史修订的确认不再有效");
  assert.equal(state.ledger.confirmations[0].id, confirmationId);
  const events = await current.repository.listEvents(ACTOR, MATTER_ID);
  assert.equal(events.ok, true);
  assert.equal(events.data.items.filter((event) => event.action === "confirmation.revoked").length, 1);
  assert.equal(events.data.items.find((event) => event.action === "confirmation.revoked").snapshot.draftRevisionId, current.revision.id);
});

test("V6-19 round2: unknown or mismatched confirmation ids fail without writes", async () => {
  const current = await makeFixture();
  const session = current.makeReviewSession();
  await session.load();
  const confirmed = await session.confirmParagraph(PARAGRAPH_ID);
  assert.equal(confirmed.ok, true, JSON.stringify(confirmed));
  const confirmation = session.getSnapshot().ledger.confirmations[0];
  const before = await current.repository.loadMatter(ACTOR, MATTER_ID);
  const versionBefore = before.data.data.matter.version;

  const unknown = await session.revokeParagraphConfirmation("eeeeeeee-eeee-4eee-8eee-eeeeeeeeee99", "未知确认");
  assert.equal(unknown.ok, false);
  assert.equal(unknown.error.code, "RESOURCE_NOT_FOUND");
  const afterUnknown = await current.repository.loadMatter(ACTOR, MATTER_ID);
  assert.equal(afterUnknown.data.data.matter.version, versionBefore);

  const mismatchSnapshot = {
    ...confirmation.snapshot,
    draftRevisionId: "dddddddd-dddd-4ddd-8ddd-000000000099",
  };
  const event = activitySchema.parse({
    id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee98",
    tenantId: ACTOR.tenantId,
    matterId: MATTER_ID,
    targetId: TARGET_ID,
    actorId: ACTOR.userId,
    actorKind: "user",
    action: "confirmation.revoked",
    snapshot: mismatchSnapshot,
    jobId: null,
    resourceId: confirmation.id,
    occurredAt: T0,
    metadata: { count: 1 },
  });
  const craftedRevocation = {
    id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee97",
    objectType: "confirmation",
    objectId: confirmation.id,
    actorId: ACTOR.userId,
    reason: "伪造的撤销",
    createdAt: T0,
  };
  const ledgerKey = `draft-review/confirmations/${encodeURIComponent(ACTOR.tenantId)}/${encodeURIComponent(ACTOR.userId)}/${MATTER_ID}`;
  const storedBefore = await current.backend.transaction("readonly", (tx) => tx.get(modules.repositoryModule.STORES.blobs, ledgerKey));
  const mismatched = await current.repository.writeConfirmationLedger(
    ACTOR,
    MATTER_ID,
    versionBefore,
    { matterId: MATTER_ID, confirmations: [confirmation], revocations: [craftedRevocation] },
    event,
    event.occurredAt,
  );
  assert.equal(mismatched.ok, false);
  assert.equal(mismatched.error.code, "INVALID_INPUT");
  const afterMismatch = await current.repository.loadMatter(ACTOR, MATTER_ID);
  assert.equal(afterMismatch.data.data.matter.version, versionBefore);
  const events = await current.repository.listEvents(ACTOR, MATTER_ID);
  assert.equal(events.data.items.filter((item) => item.action === "confirmation.revoked").length, 0);
  const storedAfter = await current.backend.transaction("readonly", (tx) => tx.get(modules.repositoryModule.STORES.blobs, ledgerKey));
  assert.deepEqual(storedAfter.ledger.revocations, storedBefore.ledger.revocations);
});

test("V6-19 round2: current-snapshot revocation still succeeds", async () => {
  const current = await makeFixture();
  const session = current.makeReviewSession();
  await session.load();
  const confirmed = await session.confirmParagraph(PARAGRAPH_ID);
  assert.equal(confirmed.ok, true, JSON.stringify(confirmed));
  const confirmationId = session.getSnapshot().ledger.confirmations[0].id;
  const revoked = await session.revokeParagraphConfirmation(confirmationId, "当前修订撤销");
  assert.equal(revoked.ok, true, JSON.stringify(revoked));
  const state = session.getSnapshot();
  assert.equal(state.ledger.revocations.length, 1);
  assert.equal(state.ledger.confirmations.length, 1);
});

test("V6-19 round3: a rejected read-only transaction returns an action failure without writes", async () => {
  const current = await makeFixture();
  const session = current.makeReviewSession();
  await session.load();
  const confirmed = await session.confirmParagraph(PARAGRAPH_ID);
  assert.equal(confirmed.ok, true, JSON.stringify(confirmed));
  const confirmationId = session.getSnapshot().ledger.confirmations[0].id;
  const before = await current.repository.loadMatter(ACTOR, MATTER_ID);
  const versionBefore = before.data.data.matter.version;
  const eventsBefore = await current.repository.listEvents(ACTOR, MATTER_ID);
  const ledgerKey = `draft-review/confirmations/${encodeURIComponent(ACTOR.tenantId)}/${encodeURIComponent(ACTOR.userId)}/${MATTER_ID}`;
  const ledgerBefore = await current.backend.transaction("readonly", (tx) => tx.get(modules.repositoryModule.STORES.blobs, ledgerKey));

  let unhandled = null;
  const onUnhandled = (reason) => { unhandled = reason; };
  process.on("unhandledRejection", onUnhandled);
  try {
    current.backend.setReadFault(({ count }) => count === 2
      ? new Error("synthetic readonly transaction failure")
      : null);
    const revoked = await session.revokeParagraphConfirmation(confirmationId, "读取失败的撤销");
    assert.equal(revoked.ok, false);
    assert.equal(revoked.error.code, "STORAGE_UNAVAILABLE");
    assert.match(revoked.error.message, /重试/);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(unhandled, null, "the rejected transaction must not become an unhandled rejection");
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }

  const after = await current.repository.loadMatter(ACTOR, MATTER_ID);
  assert.equal(after.data.data.matter.version, versionBefore);
  const eventsAfter = await current.repository.listEvents(ACTOR, MATTER_ID);
  assert.equal(eventsAfter.data.items.length, eventsBefore.data.items.length);
  assert.equal(eventsAfter.data.items.filter((event) => event.action === "confirmation.revoked").length, 0);
  const ledgerAfter = await current.backend.transaction("readonly", (tx) => tx.get(modules.repositoryModule.STORES.blobs, ledgerKey));
  assert.deepEqual(ledgerAfter.ledger.revocations, ledgerBefore.ledger.revocations);
  assert.equal(session.getSnapshot().ledger.revocations.length, 0);
});

test("V6-19 round4: a rejected initial matter-version read is STORAGE_UNAVAILABLE", async () => {
  const current = await makeFixture();
  const session = current.makeReviewSession();
  await session.load();
  const confirmed = await session.confirmParagraph(PARAGRAPH_ID);
  assert.equal(confirmed.ok, true, JSON.stringify(confirmed));
  const confirmationId = session.getSnapshot().ledger.confirmations[0].id;
  const before = await current.repository.loadMatter(ACTOR, MATTER_ID);
  const versionBefore = before.data.data.matter.version;
  const eventsBefore = await current.repository.listEvents(ACTOR, MATTER_ID);
  const ledgerKey = `draft-review/confirmations/${encodeURIComponent(ACTOR.tenantId)}/${encodeURIComponent(ACTOR.userId)}/${MATTER_ID}`;
  const ledgerBefore = await current.backend.transaction("readonly", (tx) => tx.get(modules.repositoryModule.STORES.blobs, ledgerKey));

  let unhandled = null;
  const onUnhandled = (reason) => { unhandled = reason; };
  process.on("unhandledRejection", onUnhandled);
  try {
    current.backend.setReadFault(({ count }) => count === 1
      ? new Error("synthetic matter-version read failure")
      : null);
    const revoked = await session.revokeParagraphConfirmation(confirmationId, "版本读取失败的撤销");
    assert.equal(revoked.ok, false);
    assert.equal(revoked.error.code, "STORAGE_UNAVAILABLE", "a failed first read must not be reported as not-found");
    assert.match(revoked.error.message, /重试/);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(unhandled, null, "the rejected initial read must not become an unhandled rejection");
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }

  const after = await current.repository.loadMatter(ACTOR, MATTER_ID);
  assert.equal(after.data.data.matter.version, versionBefore);
  const eventsAfter = await current.repository.listEvents(ACTOR, MATTER_ID);
  assert.equal(eventsAfter.data.items.length, eventsBefore.data.items.length);
  assert.equal(eventsAfter.data.items.filter((event) => event.action === "confirmation.revoked").length, 0);
  const ledgerAfter = await current.backend.transaction("readonly", (tx) => tx.get(modules.repositoryModule.STORES.blobs, ledgerKey));
  assert.deepEqual(ledgerAfter.ledger.revocations, ledgerBefore.ledger.revocations);
  assert.equal(session.getSnapshot().ledger.revocations.length, 0);
});

test("S05 UI states: loading, empty, error and retry are explicit", async () => {
  const current = await makeFixture({ withDraft: false });
  const session = current.makeReviewSession();
  const view = (state, onRefresh = () => {}) => renderToStaticMarkup(createElement(DraftReviewPanelView, {
    state,
    onRefresh,
    onConfirm() {},
    onRevoke() {},
  }));

  assert.equal(session.getSnapshot().phase, "loading");
  assert.match(view(session.getSnapshot()), /data-state="loading"/);
  await session.load();
  assert.equal(session.getSnapshot().phase, "empty");
  assert.match(view(session.getSnapshot()), /data-state="empty"/);

  const missing = new modules.reviewModule.DraftReviewSession({
    repository: current.repository,
    actor: ACTOR,
    matterId: "99999999-9999-4999-8999-999999999998",
    targetId: TARGET_ID,
    revisions: current.revisions,
  });
  await missing.load();
  assert.equal(missing.getSnapshot().phase, "error");
  const errorMarkup = view(missing.getSnapshot());
  assert.match(errorMarkup, /data-state="error"/);
  assert.match(errorMarkup, /重试/);
});
