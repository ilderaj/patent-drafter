import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  approvalSchema,
  gateDecisionSchema,
  revocationSchema,
} from "../../../../packages/contracts/src/index.ts";
import { runChecks } from "../../../../packages/domain/src/v6/checks.ts";
import { bindFigures } from "../../../../apps/web/src/v6/features/sources/drawings.ts";
import { register } from "tsx/esm/api";

register();

const [{ ApprovalPanelView, ApprovalSession }, harness] = await Promise.all([
  import("../../../../apps/web/src/v6/features/delivery/Approval.tsx"),
  import("./harness.mjs"),
]);
const {
  ACTIVE_PACK,
  ACTOR,
  MATTER_ID,
  TARGET_ID,
  T0,
  acknowledgeRisk,
  addFullReadConfirmation,
  approvalProps,
  makeApprovalFixture,
  makePolicySession,
  readyPanelModel,
  modules,
  nextUuid,
} = harness;

const T1 = "2026-11-05T12:01:00.000Z";

async function approvalRows(fixture) {
  const key = `delivery/approvals/${encodeURIComponent(ACTOR.tenantId)}/${encodeURIComponent(ACTOR.userId)}/${encodeURIComponent(MATTER_ID)}`;
  return (await fixture.repository.backend.transaction("readonly", async (tx) => tx.get(modules.repositoryModule.STORES.blobs, key)))
    ?? { ledger: { approvals: [], revocations: [] } };
}

async function approvalEvents(fixture) {
  const events = await fixture.repository.listEvents(ACTOR, MATTER_ID);
  assert.equal(events.ok, true, events.ok ? "" : JSON.stringify(events.error));
  return events.data.items.filter((event) => event.action === "approval.created" || event.action === "approval.revoked");
}

function renderReady(fixture, role = "owner") {
  const model = readyPanelModel(fixture, fixture.session.getSnapshot(), role);
  return renderToStaticMarkup(createElement(ApprovalPanelView, {
    model,
    role,
    onRefresh() {},
    onCreate() { return { ok: true, created: false, approval: model.state.ledger.approvals[0] }; },
    onRevoke() { return { ok: false, error: { code: "INVALID_INPUT", message: "" } }; },
  }));
}

test("V6-24-A01: valid professional state creates a contract approval and revocation appends history", async () => {
  const fixture = await makeApprovalFixture();
  const gate = fixture.session.getGateDecision("approve");
  assert.equal(gate.allowed, true, JSON.stringify(gate.reasons));
  assert.equal(gateDecisionSchema.safeParse(gate).success, true);

  const created = await fixture.session.createApproval("合成材料已复核");
  assert.equal(created.ok, true, created.ok ? "" : JSON.stringify(created.error));
  assert.equal(created.created, true);
  assert.equal(approvalSchema.safeParse(created.approval).success, true);
  assert.equal(created.approval.purpose, "internal_release");
  assert.deepEqual(created.approval.snapshot, fixture.checkResult.checkRun.snapshot);
  assert.equal(created.approval.checkRunId, fixture.checkResult.checkRun.id);
  assert.deepEqual(created.approval.confirmationIds.length, 2);

  const exported = fixture.session.getGateDecision("export", created.approval);
  assert.equal(exported.allowed, true, JSON.stringify(exported.reasons));
  const rowAfterCreate = await approvalRows(fixture);
  assert.equal(rowAfterCreate.ledger.approvals.length, 1);
  assert.equal(rowAfterCreate.ledger.revocations.length, 0);
  const createdEvents = await approvalEvents(fixture);
  assert.equal(createdEvents.filter((event) => event.action === "approval.created").length, 1);

  const revoked = await fixture.session.revokeApproval(created.approval.id, "复核后撤销合成批准");
  assert.equal(revoked.ok, true, revoked.ok ? "" : JSON.stringify(revoked.error));
  assert.equal(revocationSchema.safeParse(revoked.revocation).success, true);
  assert.equal(revoked.revocation.objectType, "approval");
  assert.equal(revoked.revocation.objectId, created.approval.id);
  const rowAfterRevoke = await approvalRows(fixture);
  assert.equal(rowAfterRevoke.ledger.approvals.length, 1, "approval history remains append-only");
  assert.equal(rowAfterRevoke.ledger.revocations.length, 1);
  assert.equal(rowAfterRevoke.ledger.revocations[0].reason, "复核后撤销合成批准");
  assert.equal((await approvalEvents(fixture)).length, 2);
  assert.equal((await fixture.session.getSnapshot()).ledger.revocations.length, 1);
});

test("V6-24-A02 and S08-A03: internal copy is accurate and figure rebinding invalidates the old approval", async () => {
  const fixture = await makeApprovalFixture();
  const created = await fixture.session.createApproval("图集变更用合成批准");
  assert.equal(created.ok, true, created.ok ? "" : JSON.stringify(created.error));
  const markup = renderReady(fixture);
  assert.match(markup, /申请准备材料，非已提交文件/);
  assert.match(markup, /仅记录团队内部放行决定/);
  assert.doesNotMatch(markup, /法定签署|已递交/);

  const rebound = await bindFigures(
    fixture.repository,
    ACTOR,
    MATTER_ID,
    {
      targetId: TARGET_ID,
      baseFigureRevisionId: fixture.figureRevision.id,
      entries: fixture.figureRevision.entries.map((entry) => ({ ...entry, title: "更新后的合成附图" })),
    },
    { now: () => Date.parse(T1) },
  );
  assert.equal(rebound.ok, true, rebound.ok ? "" : JSON.stringify(rebound.error));
  await fixture.session.refresh();
  const state = fixture.session.getSnapshot();
  assert.equal(state.phase, "stale");
  assert.equal(state.snapshot.figureRevisionId, rebound.data.current.id);
  assert.equal(state.ledger.approvals.length, 1, "historical approval is retained");
  const validity = fixture.session.getGateDecisionForRecord(created.approval);
  assert.equal(validity.allowed, false);
  assert.ok(validity.reasons.some((reason) => reason.code === "STALE_BINDING"), JSON.stringify(validity.reasons));
  assert.equal(fixture.session.getGateDecision("approve").allowed, false);
  const blocked = await fixture.session.createApproval("改图后不得沿用");
  assert.equal(blocked.ok, false);
  assert.equal(blocked.error.code, "GATE_BLOCKED");
  assert.equal((await approvalRows(fixture)).ledger.approvals.length, 1, "a stale snapshot cannot create another approval");
  assert.equal((await approvalEvents(fixture)).length, 1);
});

test("V6-24 live validity: check replacement and cited confirmation revocation invalidate with APPROVAL_REQUIRED", async () => {
  const fixture = await makeApprovalFixture();
  const created = await fixture.session.createApproval("依赖变化用合成批准");
  assert.equal(created.ok, true, created.ok ? "" : JSON.stringify(created.error));

  const replacement = runChecks(fixture.input, ACTIVE_PACK, T1);
  assert.notEqual(replacement.checkRun.id, fixture.checkResult.checkRun.id);
  const checkChanged = new ApprovalSession(approvalProps(fixture, { checkResult: replacement }));
  await checkChanged.load();
  const afterCheck = checkChanged.getGateDecisionForRecord(created.approval);
  assert.equal(afterCheck.allowed, false);
  assert.ok(afterCheck.reasons.some((reason) => reason.code === "APPROVAL_REQUIRED" && reason.resourceId === created.approval.id), JSON.stringify(afterCheck.reasons));

  const citedConfirmation = created.approval.confirmationIds[0];
  assert.ok(citedConfirmation);
  const revoked = await fixture.confirmationSession.revokeParagraphConfirmation(citedConfirmation, "撤销批准所依赖的段落确认");
  assert.equal(revoked.ok, true, revoked.ok ? "" : JSON.stringify(revoked.error));
  await fixture.session.refresh();
  const afterRevocation = fixture.session.getGateDecisionForRecord(created.approval);
  assert.equal(afterRevocation.allowed, false);
  assert.ok(afterRevocation.reasons.some((reason) => reason.code === "APPROVAL_REQUIRED" && reason.resourceId === created.approval.id), JSON.stringify(afterRevocation.reasons));
  assert.equal((await approvalRows(fixture)).ledger.revocations.length, 0, "a confirmation revocation does not silently revoke the approval record");
});

test("V6-24-A03: refresh and retry reuse one approval event and recompute live rule-pack/input validity", async () => {
  const fixture = await makeApprovalFixture();
  const first = await fixture.session.createApproval("同输入重试用合成批准");
  assert.equal(first.ok, true, first.ok ? "" : JSON.stringify(first.error));
  assert.equal(first.created, true);
  const initialEvents = await approvalEvents(fixture);
  assert.equal(initialEvents.length, 1);

  await fixture.session.refresh();
  const retry = await fixture.session.createApproval("同输入重试用合成批准");
  assert.equal(retry.ok, true, retry.ok ? "" : JSON.stringify(retry.error));
  assert.equal(retry.created, false);
  assert.equal(retry.approval.id, first.approval.id);
  assert.equal((await approvalRows(fixture)).ledger.approvals.length, 1);
  assert.equal((await approvalEvents(fixture)).length, 1);

  const refreshedSession = new ApprovalSession(approvalProps(fixture));
  await refreshedSession.load();
  assert.equal(refreshedSession.getSnapshot().ledger.approvals[0].id, first.approval.id);
  assert.equal((await approvalEvents(fixture)).length, 1);

  await addFullReadConfirmation(fixture);
  await refreshedSession.refresh();
  const confirmationChanged = refreshedSession.getGateDecisionForRecord(first.approval);
  assert.equal(confirmationChanged.allowed, false);
  assert.ok(confirmationChanged.reasons.some((reason) => reason.code === "APPROVAL_REQUIRED" && reason.resourceId === first.approval.id), JSON.stringify(confirmationChanged.reasons));
  assert.equal((await approvalRows(fixture)).ledger.approvals.length, 1);
  assert.equal((await approvalEvents(fixture)).length, 1);

  const changedPack = makePolicySession(fixture, "owner", { activeRulePackVersion: "synthetic-rules-v2" });
  await changedPack.load();
  const rulePackDecision = changedPack.getGateDecisionForRecord(first.approval);
  assert.equal(rulePackDecision.allowed, false);
  assert.ok(rulePackDecision.reasons.some((reason) => reason.code === "CHECK_REQUIRED"), JSON.stringify(rulePackDecision.reasons));

  const matterRead = await fixture.repository.loadMatter(ACTOR, MATTER_ID);
  assert.equal(matterRead.ok, true, matterRead.ok ? "" : JSON.stringify(matterRead.error));
  const aggregate = matterRead.data.data;
  const committed = await fixture.repository.commit(ACTOR, {
    contractVersion: modules.repositoryModule.CONTRACT_VERSION,
    expectedVersion: aggregate.matter.version,
    payload: {
      matter: {
        ...aggregate.matter,
        version: aggregate.matter.version + 1,
        sourceVersion: aggregate.matter.sourceVersion + 1,
        updatedAt: T1,
      },
      targets: aggregate.targets,
      assets: aggregate.assets,
      events: [],
      blobs: [],
    },
  }, { requestId: nextUuid("source-version-update") });
  assert.equal(committed.ok, true, committed.ok ? "" : JSON.stringify(committed.error));
  const current = await fixture.repository.loadMatter(ACTOR, MATTER_ID);
  assert.equal(current.ok, true, current.ok ? "" : JSON.stringify(current.error));
  const target = current.data.data.targets.find((item) => item.id === TARGET_ID);
  const newSnapshot = {
    matterId: MATTER_ID,
    targetId: TARGET_ID,
    sourceVersion: current.data.data.matter.sourceVersion,
    targetConfigVersion: target.configVersion,
    draftRevisionId: target.draftRevisionId,
    figureRevisionId: target.figureRevisionId,
  };
  const staleCheck = runChecks({ ...fixture.input, snapshot: newSnapshot, inputStale: true }, ACTIVE_PACK, T1);
  const staleSession = new ApprovalSession(approvalProps(fixture, { checkResult: staleCheck }));
  await staleSession.load();
  const staleGate = staleSession.getGateDecision("approve");
  assert.equal(staleGate.allowed, false);
  assert.ok(staleGate.reasons.some((reason) => reason.code === "INPUT_STALE"), JSON.stringify(staleGate.reasons));
  const oldApprovalValidity = staleSession.getGateDecisionForRecord(first.approval);
  assert.ok(oldApprovalValidity.reasons.some((reason) => reason.code === "STALE_BINDING"), JSON.stringify(oldApprovalValidity.reasons));
  assert.equal((await approvalRows(fixture)).ledger.approvals.length, 1);
  assert.equal((await approvalEvents(fixture)).length, 1);
});

test("S08-A04: an unacknowledged risk blocks and V6-05 risk_ack clears only its current check run", async () => {
  const fixture = await makeApprovalFixture({ withConflict: true });
  const risk = fixture.checkResult.checkRun.findings.find((finding) => finding.ruleId === "fact.open_conflict");
  assert.ok(risk);
  assert.equal(risk.requiresAcknowledgement, true);
  const before = fixture.session.getGateDecision("approve");
  assert.equal(before.allowed, false);
  assert.ok(before.reasons.some((reason) => reason.code === "CONFIRMATION_REQUIRED" && reason.resourceId === risk.id));

  await acknowledgeRisk(fixture, risk.id);
  await fixture.session.refresh();
  const after = fixture.session.getGateDecision("approve");
  assert.equal(after.allowed, true, JSON.stringify(after.reasons));
  const acked = fixture.session.getSnapshot().confirmations.confirmations.find((item) => item.riskId === risk.id);
  assert.ok(acked);
  assert.equal(acked.checkRunId, fixture.checkResult.checkRun.id);
});

test("S08-A05: editor approval is ACTION_FORBIDDEN and has no stored record or event", async () => {
  const fixture = await makeApprovalFixture();
  const editor = makePolicySession(fixture, "editor");
  await editor.load();
  const refused = await editor.createApproval("编辑者不得批准");
  assert.equal(refused.ok, false);
  assert.equal(refused.error.code, "ACTION_FORBIDDEN");
  assert.equal((await approvalRows(fixture)).ledger.approvals.length, 0);
  assert.equal((await approvalEvents(fixture)).length, 0);

  const markup = renderToStaticMarkup(createElement(ApprovalPanelView, {
    model: readyPanelModel(fixture, editor.getSnapshot(), "editor"),
    role: "editor",
    onRefresh() {},
    onCreate() { return refused; },
    onRevoke() { return { ok: false, error: refused.error }; },
  }));
  assert.match(markup, /ACTION_FORBIDDEN/);
  assert.match(markup, /disabled=""[^>]*data-testid="approval-create-button"|data-testid="approval-create-button"[^>]*disabled=""/);
});
