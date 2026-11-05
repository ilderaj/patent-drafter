import assert from "node:assert/strict";
import { activitySchema } from "../../../../packages/contracts/src/index.ts";
import { confirm, confirmationStatus } from "../../../../packages/domain/src/v6/confirmation.ts";
import { runChecks } from "../../../../packages/domain/src/v6/checks.ts";
import { bindFigures, createEmptyFigureSet, importDrawing } from "../../../../apps/web/src/v6/features/sources/drawings.ts";
import * as figureHarness from "../V6-12/harness.mjs";
import { ApprovalSession } from "../../../../apps/web/src/v6/features/delivery/Approval.tsx";
import { ACTOR, FACT_ID, MATTER_ID, PARAGRAPH_IDS, TARGET_ID, T0, makeFact, makeFixture, modules, nextUuid } from "../V6-19/harness.mjs";

export const ACTIVE_PACK = Object.freeze({ version: "synthetic-rules-v1", rules: [] });

function paragraph(id, text, origin = "human", overrides = {}) {
  return {
    id,
    text,
    origin,
    sourceRefs: [],
    factIds: [],
    figureIds: [],
    generationJobId: null,
    ...overrides,
  };
}

export function makeApprovalAst(figureId = "99999999-9999-4999-8999-999999999991") {
  const claimParagraph = paragraph(PARAGRAPH_IDS[0], "一种合成温控装置。", "ai", { factIds: [FACT_ID] });
  const technicalParagraph = paragraph(PARAGRAPH_IDS[1], "本合成方案涉及温度控制。", "mixed");
  const backgroundParagraph = paragraph("77777777-7777-4777-8777-777777777773", "合成背景说明。 ");
  const summaryParagraph = paragraph("77777777-7777-4777-8777-777777777774", "本方案提供合成温控装置。 ");
  const figureParagraph = paragraph("77777777-7777-4777-8777-777777777775", "附图说明展示合成结构关系。 ", "human", { figureIds: [figureId] });
  const embodimentParagraph = paragraph("77777777-7777-4777-8777-777777777776", "以下为合成实施方式。 ");
  const abstractParagraph = paragraph("77777777-7777-4777-8777-777777777777", "一种合成温控装置。 ");
  return {
    schemaVersion: "draft.v1",
    language: "zh-CN",
    title: "合成温控装置",
    claims: [{
      id: "66666666-6666-4666-8666-666666666661",
      number: 1,
      dependsOn: [],
      paragraphs: [claimParagraph],
      features: [{
        id: "88888888-8888-4888-8888-888888888881",
        text: "温控组件",
        factIds: [FACT_ID],
        supportParagraphIds: [claimParagraph.id],
        status: "supported",
      }],
    }],
    sections: [
      { kind: "technical_field", paragraphs: [technicalParagraph] },
      { kind: "background", paragraphs: [backgroundParagraph] },
      { kind: "summary", paragraphs: [summaryParagraph] },
      { kind: "figures_description", paragraphs: [figureParagraph] },
      { kind: "embodiments", paragraphs: [embodimentParagraph] },
      { kind: "abstract", paragraphs: [abstractParagraph] },
    ],
  };
}

export async function makeApprovalFixture({ withConflict = false } = {}) {
  const fixture = await makeFixture();
  const emptyFigures = await createEmptyFigureSet(
    fixture.repository,
    ACTOR,
    MATTER_ID,
    TARGET_ID,
    { now: () => Date.parse(T0) },
  );
  assert.equal(emptyFigures.ok, true, emptyFigures.ok ? "" : JSON.stringify(emptyFigures.error));
  const imported = await importDrawing(
    fixture.repository,
    ACTOR,
    MATTER_ID,
    { bytes: figureHarness.fixture("drawing-valid.png"), fileName: "合成附图.png" },
    { reuseExisting: true, now: figureHarness.clock },
  );
  assert.equal(imported.ok, true, imported.ok ? "" : JSON.stringify(imported.error));
  const figureId = "99999999-9999-4999-8999-999999999991";
  const figureBound = await bindFigures(
    fixture.repository,
    ACTOR,
    MATTER_ID,
    {
      targetId: TARGET_ID,
      baseFigureRevisionId: emptyFigures.data.current.id,
      entries: [{ figureId, number: 1, title: "合成附图", drawingId: imported.data.drawing.id, numerals: [] }],
    },
    { now: figureHarness.clock },
  );
  assert.equal(figureBound.ok, true, figureBound.ok ? "" : JSON.stringify(figureBound.error));
  const ast = makeApprovalAst(figureId);
  assert.equal(modules.contracts.draftAstSchema.safeParse(ast).success, true);
  const saved = await fixture.revisions.saveEditedRevision(MATTER_ID, TARGET_ID, fixture.revision.id, ast);
  assert.equal(saved.ok, true, saved.ok ? "" : JSON.stringify(saved.error));
  const loaded = await fixture.repository.loadMatter(ACTOR, MATTER_ID);
  assert.equal(loaded.ok, true, loaded.ok ? "" : JSON.stringify(loaded.error));
  const target = loaded.data.data.targets.find((item) => item.id === TARGET_ID);
  const snapshot = {
    matterId: MATTER_ID,
    targetId: TARGET_ID,
    sourceVersion: loaded.data.data.matter.sourceVersion,
    targetConfigVersion: target.configVersion,
    draftRevisionId: target.draftRevisionId,
    figureRevisionId: target.figureRevisionId,
  };
  const conflicts = withConflict ? [{ id: "88888888-8888-4888-8888-888888888882", factIds: [FACT_ID], state: "open" }] : [];
  const input = {
    snapshot,
    ast,
    astValidation: { valid: true, issues: [] },
    facts: [{ id: FACT_ID, statement: "温控装置读取温度。", status: "user_confirmed" }],
    conflicts,
    disclosure: "none",
    priorityClaims: [],
    route: "cn_invention",
    figureSet: {
      id: snapshot.figureRevisionId,
      entries: figureBound.data.current.entries.map(({ figureId, number, title, drawingId }) => ({ figureId, number, title, drawingId })),
    },
    assets: [{ id: imported.data.asset.id, drawingId: imported.data.drawing.id, state: imported.data.asset.state }],
    draftFigureRevisionId: snapshot.figureRevisionId,
  };
  const checkResult = runChecks(input, ACTIVE_PACK, T0);
  const confirmationSession = new modules.reviewModule.DraftReviewSession({
    repository: fixture.repository,
    actor: ACTOR,
    matterId: MATTER_ID,
    targetId: TARGET_ID,
    revisions: fixture.revisions,
    newId: nextUuid,
    now: () => T0,
  });
  await confirmationSession.load();
  for (const paragraph of [PARAGRAPH_IDS[0], PARAGRAPH_IDS[1]]) {
    const confirmed = await confirmationSession.confirmParagraph(paragraph);
    assert.equal(confirmed.ok, true, confirmed.ok ? "" : JSON.stringify(confirmed.error));
  }
  const options = {
    repository: fixture.repository,
    actor: ACTOR,
    matterId: MATTER_ID,
    targetId: TARGET_ID,
    role: "owner",
    checkResult,
    activeRulePackVersion: ACTIVE_PACK.version,
    filesAvailable: true,
    revisions: fixture.revisions,
    newId: nextUuid,
    now: () => T0,
  };
  const session = new ApprovalSession(options);
  await session.load();
  return { ...fixture, ast, imported, emptyFigures: emptyFigures.data, figureRevision: figureBound.data.current, input, checkResult, confirmationSession, options, session };
}

export async function acknowledgeRisk(fixture, riskId) {
  const { repository } = fixture;
  const ledgerKey = `draft-review/confirmations/${encodeURIComponent(ACTOR.tenantId)}/${encodeURIComponent(ACTOR.userId)}/${encodeURIComponent(MATTER_ID)}`;
  const loaded = await repository.loadMatter(ACTOR, MATTER_ID);
  assert.equal(loaded.ok, true, loaded.ok ? "" : JSON.stringify(loaded.error));
  const ledger = await repository.backend.transaction("readonly", async (tx) => tx.get(modules.repositoryModule.STORES.blobs, ledgerKey));
  const currentLedger = ledger?.ledger ?? { matterId: MATTER_ID, confirmations: [], revocations: [] };
  const acknowledged = confirm(currentLedger, {
    kind: "risk_ack",
    snapshot: fixture.checkResult.checkRun.snapshot,
    actorId: ACTOR.userId,
    identity: "local_self_reported",
    riskId,
    checkRunId: fixture.checkResult.checkRun.id,
  }, { newId: nextUuid, now: () => T0 });
  assert.equal(acknowledged.ok, true, acknowledged.ok ? "" : JSON.stringify(acknowledged.error));
  const event = activitySchema.parse({
    id: nextUuid("risk-ack-event"),
    tenantId: ACTOR.tenantId,
    matterId: MATTER_ID,
    targetId: TARGET_ID,
    actorId: ACTOR.userId,
    actorKind: "user",
    action: "confirmation.created",
    snapshot: fixture.checkResult.checkRun.snapshot,
    jobId: null,
    resourceId: acknowledged.confirmation.id,
    occurredAt: T0,
    metadata: { count: 1 },
  });
  const written = await repository.writeConfirmationLedger(
    ACTOR,
    MATTER_ID,
    loaded.data.version,
    acknowledged.state,
    event,
    T0,
  );
  assert.equal(written.ok, true, written.ok ? "" : JSON.stringify(written.error));
}

export async function addFullReadConfirmation(fixture) {
  const { repository } = fixture;
  const ledgerKey = `draft-review/confirmations/${encodeURIComponent(ACTOR.tenantId)}/${encodeURIComponent(ACTOR.userId)}/${encodeURIComponent(MATTER_ID)}`;
  const loaded = await repository.loadMatter(ACTOR, MATTER_ID);
  assert.equal(loaded.ok, true, loaded.ok ? "" : JSON.stringify(loaded.error));
  const row = await repository.backend.transaction("readonly", async (tx) => tx.get(modules.repositoryModule.STORES.blobs, ledgerKey));
  const currentLedger = row?.ledger ?? { matterId: MATTER_ID, confirmations: [], revocations: [] };
  const result = confirm(currentLedger, {
    kind: "full_read",
    snapshot: fixture.checkResult.checkRun.snapshot,
    actorId: ACTOR.userId,
    identity: "local_self_reported",
    contentAccess: "local_unmetered",
  }, { newId: nextUuid, now: () => T0 });
  assert.equal(result.ok, true, result.ok ? "" : JSON.stringify(result.error));
  const event = activitySchema.parse({
    id: nextUuid("full-read-event"),
    tenantId: ACTOR.tenantId,
    matterId: MATTER_ID,
    targetId: TARGET_ID,
    actorId: ACTOR.userId,
    actorKind: "user",
    action: "confirmation.created",
    snapshot: fixture.checkResult.checkRun.snapshot,
    jobId: null,
    resourceId: result.confirmation.id,
    occurredAt: T0,
    metadata: { count: 1 },
  });
  const written = await repository.writeConfirmationLedger(ACTOR, MATTER_ID, loaded.data.version, result.state, event, T0);
  assert.equal(written.ok, true, written.ok ? "" : JSON.stringify(written.error));
  return result.confirmation;
}

export function approvalProps(fixture, overrides = {}) {
  return { ...fixture.options, ...overrides };
}

export function readyPanelModel(fixture, state = fixture.session.getSnapshot(), role = "owner", overrides = {}) {
  const snapshot = state.snapshot;
  const checkRun = fixture.options.checkResult?.checkRun ?? null;
  const paragraphs = [
    ...state.revision.ast.claims.flatMap((claim) => claim.paragraphs),
    ...state.revision.ast.sections.flatMap((section) => section.paragraphs),
  ];
  const aiParagraphIds = paragraphs.filter((item) => item.origin === "ai" || item.origin === "mixed").map((item) => item.id);
  const coverage = confirmationStatus(state.confirmations, snapshot, aiParagraphIds, checkRun?.id ?? null);
  const records = [...state.ledger.approvals].reverse().map((approval) => {
    const revocation = state.ledger.revocations.find((item) => item.objectId === approval.id) ?? null;
    return { approval, revocation, decision: revocation ? null : fixture.session.getGateDecisionForRecord(approval) };
  });
  const latest = [...state.ledger.approvals].reverse().find((approval) => !state.ledger.revocations.some((item) => item.objectId === approval.id)) ?? null;
  return {
    state,
    approveDecision: fixture.session.getGateDecision("approve"),
    exportDecision: fixture.session.getGateDecision("export", latest),
    checkStatus: checkRun ? `有效 · ${checkRun.id}` : "无当前结果 · CHECK_REQUIRED",
    rulePackStatus: `检查 ${checkRun?.rulePackVersion ?? "无"} · 当前启用 ${fixture.options.activeRulePackVersion}`,
    checkValid: Boolean(checkRun),
    aiParagraphIds,
    confirmedAiParagraphIds: coverage.confirmedAiParagraphIds,
    fullReadConfirmed: coverage.fullRead,
    risks: (checkRun?.findings ?? []).map((risk) => ({
      id: risk.id,
      title: risk.title,
      acknowledged: coverage.acknowledgedRiskIds.includes(risk.id),
      requiresAcknowledgement: risk.requiresAcknowledgement,
    })),
    records,
    filesAvailable: fixture.options.filesAvailable && state.figureAssetsAvailable,
    roleCanApprove: ["owner", "admin", "reviewer"].includes(role),
    ...overrides,
  };
}

export function makePolicySession(fixture, role, overrides = {}) {
  return new ApprovalSession(approvalProps(fixture, { role, ...overrides }));
}

export { ACTOR, MATTER_ID, TARGET_ID, T0, makeFact, modules, nextUuid };
