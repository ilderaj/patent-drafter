import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const fixtureHarness = await import("../V6-19/harness.mjs");
const [navigation, workbench, activityUi, mattersFeature, workbenchUi] = await Promise.all([
  import("../../../../apps/web/src/v6/routes/navigation.ts"),
  import("../../../../apps/web/src/v6/features/workbench/workbench.ts"),
  import("../../../../apps/web/src/v6/features/workbench/ActivityFeed.tsx"),
  import("../../../../apps/web/src/v6/features/matters/matters.ts"),
  import("../../../../apps/web/src/v6/features/workbench/Workbench.tsx"),
]);
const { ACTOR, MATTER_ID, TARGET_ID, FIGURE_ID, PARAGRAPH_ID, T0, makeFixture, nextUuid, modules } = fixtureHarness;
const { createSelfServiceMatter } = navigation;
const { ActivityFeedView } = activityUi;
const { archiveMatter } = mattersFeature;
const { loadActivityFeed, loadWorkbenchOverview, filterActivity } = workbench;
const RULE_PACK = "synthetic-rules-v1";
const uuid = (tail) => `eeeeeeee-eeee-4eee-8eee-${String(tail).padStart(12, "0")}`;

async function seedApproval(fixture, targetId, checkId, approvalId, createdAt = T0) {
  const review = targetId === TARGET_ID
    ? fixture.makeReviewSession(T0)
    : new modules.reviewModule.DraftReviewSession({
      repository: fixture.repository, actor: ACTOR, matterId: MATTER_ID, targetId,
      revisions: fixture.revisions, newId: nextUuid, now: () => T0,
    });
  await review.load();
  const confirmed = await review.confirmParagraph(PARAGRAPH_ID);
  assert.equal(confirmed.ok, true, confirmed.ok ? "" : confirmed.error.message);
  const state = review.getSnapshot();
  const confirmationId = state.ledger.confirmations.find((item) => item.kind === "ai_paragraph" && item.snapshot.targetId === targetId)?.id;
  assert.ok(confirmationId);
  const checkRun = { id: checkId, snapshot: state.snapshot, rulePackVersion: RULE_PACK, state: "succeeded", findings: [], createdAt };
  const approval = {
    id: approvalId, snapshot: state.snapshot, checkRunId: checkId, confirmationIds: [confirmationId],
    actorId: ACTOR.userId, purpose: "internal_release", note: "合成验收批准", createdAt,
  };
  await fixture.backend.transaction("readwrite", async (tx) => {
    await tx.put(modules.repositoryModule.STORES.blobs, "check.registry/synthetic", {
      kind: "check.registry", tenantId: ACTOR.tenantId, activeRulePackVersion: RULE_PACK,
    });
    await tx.put(modules.repositoryModule.STORES.blobs, `check/run/${checkId}`, {
      kind: "check.run", tenantId: ACTOR.tenantId, matterId: MATTER_ID, targetId, checkRun,
    });
    await tx.put(modules.repositoryModule.STORES.blobs, `approval/${approvalId}`, {
      kind: "approval", tenantId: ACTOR.tenantId, matterId: MATTER_ID, approval,
    });
  });
  return { review, confirmationId, checkRun, approval };
}

async function addSecondTarget(fixture, language = "zh-CN") {
  const targetId = "44444444-4444-4444-8444-444444444445";
  const eventId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5";
  const loaded = await fixture.repository.loadMatter(ACTOR, MATTER_ID);
  const target = {
    id: targetId, matterId: MATTER_ID, status: "active", configVersion: 1, draftRevisionId: null,
    figureRevisionId: "55555555-5555-4555-8555-555555555556",
  };
  const committed = await fixture.repository.commit(ACTOR, {
    contractVersion: modules.repositoryModule.CONTRACT_VERSION,
    expectedVersion: loaded.data.version,
    payload: {
      matter: { ...loaded.data.data.matter, version: loaded.data.version + 1, updatedAt: "2026-11-05T12:02:00.000Z" },
      targets: [...loaded.data.data.targets, target], assets: loaded.data.data.assets,
      events: [{
        id: eventId, tenantId: ACTOR.tenantId, matterId: MATTER_ID, targetId, actorId: ACTOR.userId,
        actorKind: "user", action: "target.created", snapshot: null, jobId: null, resourceId: targetId,
        occurredAt: "2026-11-05T12:02:00.000Z", metadata: { version: 1 },
      }], blobs: [],
    },
  }, { requestId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb5" });
  assert.equal(committed.ok, true, committed.ok ? "" : committed.error.message);
  const key = ["targets/config", encodeURIComponent(ACTOR.tenantId), encodeURIComponent(MATTER_ID), encodeURIComponent(targetId), "1", encodeURIComponent(eventId)].join("/");
  await fixture.backend.transaction("readwrite", (tx) => tx.put(modules.repositoryModule.STORES.blobs, key, {
    kind: "target.config", tenantId: ACTOR.tenantId, matterId: MATTER_ID, targetId,
    config: { targetId, version: 1, route: "pct", language, purpose: "preparation", applicantIds: [], inventorIds: [], priorityClaims: [] }, at: T0,
  }));
  const revision = await fixture.revisions.saveEditedRevision(MATTER_ID, targetId, null, fixture.ast);
  assert.equal(revision.ok, true, revision.ok ? "" : revision.error.message);
  return targetId;
}

async function putTargetConfig(fixture, targetId, language, route = "cn_um", version = 1) {
  const key = ["targets/config", encodeURIComponent(ACTOR.tenantId), encodeURIComponent(MATTER_ID), encodeURIComponent(targetId), String(version), "synthetic"].join("/");
  await fixture.backend.transaction("readwrite", (tx) => tx.put(modules.repositoryModule.STORES.blobs, key, {
    kind: "target.config", tenantId: ACTOR.tenantId, matterId: MATTER_ID, targetId,
    config: { targetId, version, route, language, purpose: "preparation", applicantIds: [], inventorIds: [], priorityClaims: [] },
    at: T0,
  }));
}

async function commitEvents(fixture, events, expectedVersion) {  const loaded = await fixture.repository.loadMatter(ACTOR, MATTER_ID);
  return fixture.repository.commit(ACTOR, {
    contractVersion: modules.repositoryModule.CONTRACT_VERSION,
    expectedVersion,
    payload: {
      matter: { ...loaded.data.data.matter, version: expectedVersion + 1, updatedAt: "2026-11-05T12:03:00.000Z" },
      targets: loaded.data.data.targets, assets: loaded.data.data.assets, events, blobs: [],
    },
  }, { requestId: uuid(40 + expectedVersion) });
}

test("V6-22-A01: self-service opens the same matter without copying it", async () => {
  const backend = new fixtureHarness.MemoryBackend();
  const repository = new modules.repositoryModule.LocalRepository(backend);
  const matterId = "33333333-3333-4333-8333-333333333350";
  const created = await createSelfServiceMatter(repository, ACTOR, {
    matterId, eventId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa0",
    requestId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb0", now: T0,
  });
  assert.equal(created.ok, true);
  const before = await repository.listMatters(ACTOR);
  const eventsBefore = await repository.listEvents(ACTOR, matterId);
  const overview = await loadWorkbenchOverview(repository, ACTOR, matterId, null, { now: 10 });
  const after = await repository.listMatters(ACTOR);
  const eventsAfter = await repository.listEvents(ACTOR, matterId);
  assert.equal(overview.ok, true);
  assert.equal(overview.data.matterId, matterId);
  assert.equal(overview.data.targets.length, 0);
  assert.equal(before.data.items.length, 1);
  assert.equal(after.data.items.length, 1);
  assert.equal(eventsBefore.data.items.length, 1);
  assert.equal(eventsAfter.data.items.length, 1);
  assert.equal(navigation.v6Path({ kind: "matter", matterId, targetId: null, tab: "overview" }), `/v6/matters/${matterId}/overview`);
  repository.close();
});

test("S06 overview: target language is projected and rendered for each target", async () => {
  const fixture = await makeFixture();
  await putTargetConfig(fixture, TARGET_ID, "zh-CN", "cn_um");
  const targetB = await addSecondTarget(fixture, "en-US");
  const overview = await loadWorkbenchOverview(fixture.repository, ACTOR, MATTER_ID, null, { now: 15 });
  assert.equal(overview.ok, true);
  const targetA = overview.data.targets.find((target) => target.id === TARGET_ID);
  const summaryB = overview.data.targets.find((target) => target.id === targetB);
  assert.equal(targetA.language, "zh-CN");
  assert.equal(summaryB.language, "en-US");
  const markup = renderToStaticMarkup(createElement(workbenchUi.TargetOverviewTable, { targets: overview.data.targets }));
  assert.match(markup, /<th>语言<\/th>/);
  assert.match(markup, /中文（zh-CN）/);
  assert.match(markup, /英文（en-US）/);
  assert.match(markup, new RegExp(`data-testid="workbench-target-${targetB}"[^>]*data-language="en-US"`));
  fixture.repository.close();
});

test("V6-22-A02 and S06-A03: revoking target A confirmation invalidates only A approval", async () => {
  const fixture = await makeFixture();
  const targetB = await addSecondTarget(fixture);
  const approvedA = await seedApproval(fixture, TARGET_ID, uuid(11), uuid(21));
  const approvedB = await seedApproval(fixture, targetB, uuid(12), uuid(22));
  let overview = await loadWorkbenchOverview(fixture.repository, ACTOR, MATTER_ID, null, { activeRulePackVersion: RULE_PACK });
  assert.equal(overview.data.targets.find((target) => target.id === TARGET_ID).approval.state, "valid");
  assert.equal(overview.data.targets.find((target) => target.id === targetB).approval.state, "valid");
  const revoked = await approvedA.review.revokeParagraphConfirmation(approvedA.confirmationId, "撤回本次确认");
  assert.equal(revoked.ok, true);
  overview = await loadWorkbenchOverview(fixture.repository, ACTOR, MATTER_ID, null, { activeRulePackVersion: RULE_PACK });
  assert.deepEqual(overview.data.targets.find((target) => target.id === TARGET_ID).approval, {
    state: "invalid", reason: "确认撤销", approvalId: uuid(21),
  });
  assert.equal(overview.data.targets.find((target) => target.id === targetB).approval.state, "valid");
  fixture.repository.close();
});

test("approval validity is recomputed after revision, figure, check, and rule changes", async (t) => {
  await t.test("revision change", async () => {
    const fixture = await makeFixture();
    await seedApproval(fixture, TARGET_ID, uuid(31), uuid(41));
    const changed = structuredClone(fixture.ast);
    changed.title = "合成修改后的标题";
    const saved = await fixture.revisions.saveEditedRevision(MATTER_ID, TARGET_ID, fixture.revision.id, changed);
    assert.equal(saved.ok, true, saved.ok ? "" : saved.error.message);
    const result = await loadWorkbenchOverview(fixture.repository, ACTOR, MATTER_ID, null, { activeRulePackVersion: RULE_PACK });
    assert.equal(result.data.targets[0].approval.reason, "修订变化");
    fixture.repository.close();
  });
  await t.test("figure change", async () => {
    const fixture = await makeFixture();
    await seedApproval(fixture, TARGET_ID, uuid(32), uuid(42));
    const loaded = await fixture.repository.loadMatter(ACTOR, MATTER_ID);
    const event = {
      id: uuid(52), tenantId: ACTOR.tenantId, matterId: MATTER_ID, targetId: TARGET_ID,
      actorId: ACTOR.userId, actorKind: "user", action: "figures.bound", snapshot: null, jobId: null,
      resourceId: TARGET_ID, occurredAt: "2026-11-05T12:04:00.000Z", metadata: { version: loaded.data.version + 1, count: 0 },
    };
    const changed = await fixture.repository.commit(ACTOR, {
      contractVersion: modules.repositoryModule.CONTRACT_VERSION,
      expectedVersion: loaded.data.version,
      payload: {
        matter: { ...loaded.data.data.matter, version: loaded.data.version + 1, updatedAt: event.occurredAt },
        targets: [{ ...loaded.data.data.targets[0], figureRevisionId: "55555555-5555-4555-8555-555555555557" }],
        assets: loaded.data.data.assets, events: [event], blobs: [],
      },
    }, { requestId: uuid(62) });
    assert.equal(changed.ok, true);
    const result = await loadWorkbenchOverview(fixture.repository, ACTOR, MATTER_ID, null, { activeRulePackVersion: RULE_PACK });
    assert.equal(result.data.targets[0].approval.reason, "图集变化");
    fixture.repository.close();
  });
  await t.test("newer check run", async () => {
    const fixture = await makeFixture();
    const seeded = await seedApproval(fixture, TARGET_ID, uuid(33), uuid(43));
    await fixture.backend.transaction("readwrite", (tx) => tx.put(modules.repositoryModule.STORES.blobs, `check/run/${uuid(53)}`, {
      kind: "check.run", tenantId: ACTOR.tenantId, matterId: MATTER_ID, targetId: TARGET_ID,
      checkRun: { ...seeded.checkRun, id: uuid(53), createdAt: "2026-11-05T12:05:00.000Z", state: "failed" },
    }));
    const result = await loadWorkbenchOverview(fixture.repository, ACTOR, MATTER_ID, null, { activeRulePackVersion: RULE_PACK });
    assert.equal(result.data.targets[0].approval.reason, "检查过期");
    fixture.repository.close();
  });
  await t.test("rule-pack change", async () => {
    const fixture = await makeFixture();
    await seedApproval(fixture, TARGET_ID, uuid(34), uuid(44));
    const result = await loadWorkbenchOverview(fixture.repository, ACTOR, MATTER_ID, null, { activeRulePackVersion: "synthetic-rules-v2" });
    assert.equal(result.data.targets[0].approval.reason, "规则包变化");
    fixture.repository.close();
  });
});

test("S06-A02: open conflict has priority over stale input", async () => {
  const fixture = await makeFixture();
  const loaded = await fixture.repository.loadMatter(ACTOR, MATTER_ID);
  const event = {
    id: uuid(60), tenantId: ACTOR.tenantId, matterId: MATTER_ID, targetId: TARGET_ID,
    actorId: ACTOR.userId, actorKind: "user", action: "target.config_updated", snapshot: null, jobId: null,
    resourceId: TARGET_ID, occurredAt: "2026-11-05T12:04:00.000Z", metadata: { version: 2 },
  };
  const changed = await fixture.repository.commit(ACTOR, {
    contractVersion: modules.repositoryModule.CONTRACT_VERSION,
    expectedVersion: loaded.data.version,
    payload: {
      matter: { ...loaded.data.data.matter, version: loaded.data.version + 1, updatedAt: event.occurredAt },
      targets: [{ ...loaded.data.data.targets[0], configVersion: 2 }], assets: loaded.data.data.assets, events: [event], blobs: [],
    },
  }, { requestId: uuid(61) });
  assert.equal(changed.ok, true);
  await fixture.backend.transaction("readwrite", (tx) => tx.put(modules.repositoryModule.STORES.blobs, `intake/snapshot/${MATTER_ID}/1`, {
    kind: "intake.snapshot",
    snapshot: {
      matterId: MATTER_ID, version: 1, facts: [], conflicts: [{ id: uuid(62), state: "open" }],
      answers: { problem: "", difference: "", inventorIds: [], disclosure: null, maturity: null, disclosureDetail: null },
      parties: [], createdBy: ACTOR.userId, createdAt: T0,
    },
  }));
  const result = await loadWorkbenchOverview(fixture.repository, ACTOR, MATTER_ID, null, { activeRulePackVersion: RULE_PACK });
  assert.equal(result.data.targets[0].inputStale, true);
  assert.equal(result.data.targets[0].nextAction, "resolve_conflict");
  fixture.repository.close();
});

test("S06-A05: inaccessible matters and their activity stay absent", async () => {
  const fixture = await makeFixture();
  const other = { tenantId: ACTOR.tenantId, userId: "22222222-2222-4222-8222-222222222299" };
  const otherMatter = "33333333-3333-4333-8333-333333333399";
  const created = await fixture.repository.commit(other, {
    contractVersion: modules.repositoryModule.CONTRACT_VERSION, expectedVersion: 0,
    payload: {
      matter: { id: otherMatter, tenantId: other.tenantId, version: 1, title: "另一个合成案件", status: "active", sourceVersion: 1, createdBy: other.userId, createdAt: T0, updatedAt: T0 },
      targets: [], assets: [], events: [], blobs: [],
    },
  }, { requestId: uuid(70) });
  assert.equal(created.ok, true);
  const view = await loadWorkbenchOverview(fixture.repository, ACTOR, otherMatter, null);
  assert.equal(view.ok, false);
  assert.equal(view.error.code, "RESOURCE_NOT_FOUND");
  const feed = await loadActivityFeed(fixture.repository, ACTOR);
  assert.equal(feed.data.matters.some((matter) => matter.id === otherMatter), false);
  assert.equal(feed.data.events.some((event) => event.matterId === otherMatter), false);
  fixture.repository.close();
});

test("S06-A06: model activity shows job metadata and excludes prompt/body metadata", async () => {
  const fixture = await makeFixture();
  const loaded = await fixture.repository.loadMatter(ACTOR, MATTER_ID);
  const snapshot = { matterId: MATTER_ID, targetId: TARGET_ID, sourceVersion: 1, targetConfigVersion: 1, draftRevisionId: fixture.revision.id, figureRevisionId: FIGURE_ID };
  const jobId = "cccccccc-cccc-4ccc-8ccc-ccccccccccc8";
  const common = {
    tenantId: ACTOR.tenantId, matterId: MATTER_ID, targetId: TARGET_ID, actorId: ACTOR.userId,
    actorKind: "user", snapshot, jobId, occurredAt: "2026-11-05T12:06:00.000Z",
  };
  const committed = await commitEvents(fixture, [
    { ...common, id: uuid(81), action: "job.succeeded", resourceId: jobId, metadata: { stage: "checks", count: 3, provider: "local-stub", model: "fixture-v1" } },
    { ...common, id: uuid(82), action: "job.adopted", resourceId: jobId, metadata: { version: loaded.data.version + 1, provider: "local-stub", model: "fixture-v1" } },
  ], loaded.data.version);
  assert.equal(committed.ok, true, committed.ok ? "" : committed.error.message);
  const after = await fixture.repository.loadMatter(ACTOR, MATTER_ID);
  const refused = await fixture.repository.commit(ACTOR, {
    contractVersion: modules.repositoryModule.CONTRACT_VERSION, expectedVersion: after.data.version,
    payload: {
      matter: { ...after.data.data.matter, version: after.data.version + 1, updatedAt: "2026-11-05T12:07:00.000Z" },
      targets: after.data.data.targets, assets: after.data.data.assets,
      events: [{ ...common, id: uuid(83), action: "job.succeeded", resourceId: jobId, metadata: { stage: "checks", provider: "local-stub", model: "fixture-v1", prompt: "PROMPT_SECRET", body: "DOCUMENT_SECRET" } }],
      blobs: [],
    },
  }, { requestId: uuid(84) });
  assert.equal(refused.ok, false);
  assert.equal(refused.error.code, "INVALID_INPUT");
  const feed = await loadActivityFeed(fixture.repository, ACTOR);
  const jobs = filterActivity(feed.data.events, { matterId: MATTER_ID, targetId: "all", actorKind: "all", actionClass: "job", modelOnly: true });
  assert.deepEqual(jobs.map((event) => event.action).sort(), ["job.adopted", "job.succeeded"]);
  const markup = renderToStaticMarkup(createElement(ActivityFeedView, { data: feed.data, error: null, refreshing: false, currentMatterId: MATTER_ID, onRetry() {} }));
  assert.match(markup, /本机用户（自报）/);
  assert.match(markup, /local-stub/);
  assert.match(markup, /fixture-v1/);
  assert.match(markup, new RegExp(jobId));
  assert.match(markup, /data-action="job\.succeeded"/);
  assert.match(markup, /data-action="job\.adopted"/);
  assert.doesNotMatch(markup, /PROMPT_SECRET|DOCUMENT_SECRET/);
  fixture.repository.close();
});

test("V6-22-A02: activity derives outcomes; a failed job stays failed and a retry has its own job id", async () => {
  const fixture = await makeFixture();
  const before = await fixture.repository.loadMatter(ACTOR, MATTER_ID);
  const failedJobId = "cccccccc-cccc-4ccc-8ccc-ccccccccccc9";
  const retryJobId = "cccccccc-cccc-4ccc-8ccc-ccccccccccca";
  const failure = {
    id: uuid(91), tenantId: ACTOR.tenantId, matterId: MATTER_ID, targetId: TARGET_ID,
    actorId: ACTOR.userId, actorKind: "user", action: "job.failed", snapshot: null, jobId: failedJobId,
    resourceId: failedJobId, occurredAt: "2026-11-05T12:08:00.000Z",
    metadata: { stage: "checks", errorCode: "PROVIDER_TIMEOUT", provider: "local-stub", model: "fixture-v1" },
  };
  assert.equal((await commitEvents(fixture, [failure], before.data.version)).ok, true);
  const afterFailure = await fixture.repository.loadMatter(ACTOR, MATTER_ID);
  // V6-17 retry creates a new job id; the workbench renders each event's own outcome.
  const retrySuccess = {
    id: uuid(92), tenantId: ACTOR.tenantId, matterId: MATTER_ID, targetId: TARGET_ID,
    actorId: ACTOR.userId, actorKind: "user", action: "job.succeeded", snapshot: null, jobId: retryJobId,
    resourceId: retryJobId, occurredAt: "2026-11-05T12:09:00.000Z",
    metadata: { stage: "checks", count: 1, provider: "local-stub", model: "fixture-v1" },
  };
  const retried = await commitEvents(fixture, [retrySuccess], afterFailure.data.version);
  assert.equal(retried.ok, true, retried.ok ? "" : JSON.stringify(retried.error));
  const feed = await loadActivityFeed(fixture.repository, ACTOR);
  assert.deepEqual(feed.data.events.filter((event) => event.jobId === failedJobId).map((event) => event.action), ["job.failed"]);
  assert.deepEqual(feed.data.events.filter((event) => event.jobId === retryJobId).map((event) => event.action), ["job.succeeded"]);
  assert.equal(workbench.activityOutcome(feed.data.events.find((event) => event.jobId === failedJobId)), "failed");
  assert.equal(workbench.activityOutcome(feed.data.events.find((event) => event.jobId === retryJobId)), "succeeded");
  const markup = renderToStaticMarkup(createElement(ActivityFeedView, { data: feed.data, error: null, refreshing: false, currentMatterId: MATTER_ID, onRetry() {} }));
  assert.match(markup, /data-action="job\.failed"/);
  assert.match(markup, /失败 · PROVIDER_TIMEOUT/);
  assert.match(markup, /data-action="job\.succeeded"/);
  assert.match(markup, new RegExp(failedJobId));
  assert.match(markup, new RegExp(retryJobId));
  fixture.repository.close();
});

test("S06 UI states: activity loading, empty, error and stale are explicit", () => {
  const empty = { matters: [], events: [], loadedAt: 0 };
  const render = (data, error) => renderToStaticMarkup(createElement(ActivityFeedView, {
    data, error, refreshing: false, currentMatterId: "33333333-3333-4333-8333-333333333398", onRetry() {},
  }));
  const loading = render(null, null);
  assert.match(loading, /data-state="loading"/);
  assert.match(loading, /workbench-activity-loading/);
  const emptyMarkup = render(empty, null);
  assert.match(emptyMarkup, /data-state="ready"/);
  assert.match(emptyMarkup, /尚无记录/);
  const errorMarkup = render(null, "无法读取动态。");
  assert.match(errorMarkup, /data-state="error"/);
  assert.match(errorMarkup, /workbench-activity-error/);
  const staleMarkup = render(empty, "无法读取动态；上次结果仍保留。");
  assert.match(staleMarkup, /data-state="stale"/);
  assert.match(staleMarkup, /重试/);
});

test("V6-22-A03: refresh/retry keeps one confirmation and one event", async () => {
  const fixture = await makeFixture();
  const session = fixture.makeReviewSession();
  await session.load();
  const first = await session.confirmParagraph(PARAGRAPH_ID);
  const retry = await session.confirmParagraph(PARAGRAPH_ID);
  assert.equal(first.ok, true);
  assert.equal(retry.ok, true);
  assert.equal(retry.created, false);
  await session.refresh();
  const freshRepository = new modules.repositoryModule.LocalRepository(fixture.backend);
  const firstRead = await loadWorkbenchOverview(freshRepository, ACTOR, MATTER_ID, null);
  const secondRead = await loadWorkbenchOverview(freshRepository, ACTOR, MATTER_ID, null);
  const events = await freshRepository.listEvents(ACTOR, MATTER_ID);
  assert.equal(firstRead.data.targets[0].confirmations.confirmed, 1);
  assert.deepEqual(secondRead.data.targets[0].confirmations, firstRead.data.targets[0].confirmations);
  assert.equal(events.data.items.filter((event) => event.action === "confirmation.created").length, 1);
  assert.equal(events.data.items.filter((event) => event.action === "confirmation.revoked").length, 0);
  freshRepository.close();
  fixture.repository.close();
});

test("S06-A08: archived matter refuses a draft save", async () => {
  const fixture = await makeFixture();
  const loaded = await fixture.repository.loadMatter(ACTOR, MATTER_ID);
  const archived = await archiveMatter(fixture.repository, ACTOR, {
    matterId: MATTER_ID, expectedVersion: loaded.data.version, eventId: uuid(101), requestId: uuid(102), now: "2026-11-05T12:10:00.000Z",
  });
  assert.equal(archived.ok, true);
  const edited = structuredClone(fixture.ast);
  edited.title = "归档后修改尝试";
  const saved = await fixture.revisions.saveEditedRevision(MATTER_ID, TARGET_ID, fixture.revision.id, edited);
  assert.equal(saved.ok, false);
  assert.equal(saved.error.code, "INVALID_TRANSITION");
  const overview = await loadWorkbenchOverview(fixture.repository, ACTOR, MATTER_ID, null);
  assert.equal(overview.data.matterStatus, "archived");
  fixture.repository.close();
});
