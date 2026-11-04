import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { register } from "tsx/esm/api";

register();

const [
  { createElement },
  { renderToStaticMarkup },
  contracts,
  checkModule,
  gateModule,
  confirmationModule,
  drawingModule,
  figureHarness,
  checksUi,
] = await Promise.all([
  import("react"),
  import("react-dom/server"),
  import("../../../../packages/contracts/src/index.ts"),
  import("../../../../packages/domain/src/v6/checks.ts"),
  import("../../../../packages/domain/src/v6/gate.ts"),
  import("../../../../packages/domain/src/v6/confirmation.ts"),
  import("../../../../apps/web/src/v6/features/sources/drawings.ts"),
  import("../V6-12/harness.mjs"),
  import("../../../../apps/web/src/v6/features/checks/Checks.tsx"),
]);

const T0 = "2026-11-05T12:00:00.000Z";
const T1 = "2026-11-05T12:01:00.000Z";
const ids = Object.freeze({
  matter: "11111111-1111-4111-8111-111111111111",
  target: "22222222-2222-4222-8222-222222222222",
  draft: "33333333-3333-4333-8333-333333333333",
  claim1: "44444444-4444-4444-8444-444444444441",
  claim2: "44444444-4444-4444-8444-444444444442",
  feature: "55555555-5555-4555-8555-555555555551",
  fact1: "66666666-6666-4666-8666-666666666661",
  fact2: "66666666-6666-4666-8666-666666666662",
  paragraph1: "77777777-7777-4777-8777-777777777771",
  paragraph2: "77777777-7777-4777-8777-777777777772",
  paragraph3: "77777777-7777-4777-8777-777777777773",
  paragraph4: "77777777-7777-4777-8777-777777777774",
  paragraph5: "77777777-7777-4777-8777-777777777775",
  paragraph6: "77777777-7777-4777-8777-777777777776",
  paragraph7: "77777777-7777-4777-8777-777777777777",
  conflict: "88888888-8888-4888-8888-888888888881",
  figure2: "99999999-9999-4999-8999-999999999992",
});

const EMPTY_PACK = Object.freeze({ version: "synthetic-rules-v1", rules: [] });
const SNAPSHOT_BASE = Object.freeze({
  matterId: ids.matter,
  targetId: ids.target,
  sourceVersion: 1,
  targetConfigVersion: 1,
  draftRevisionId: ids.draft,
  figureRevisionId: figureHarness.EMPTY_SET_A,
});

function paragraph(id, text, figureIds = []) {
  return {
    id,
    text,
    origin: "human",
    sourceRefs: [],
    factIds: [],
    figureIds,
    generationJobId: null,
  };
}

function makeAst() {
  return {
    schemaVersion: "draft.v1",
    language: "zh-CN",
    title: "合成结构装置",
    claims: [
      {
        id: ids.claim1,
        number: 1,
        dependsOn: [],
        paragraphs: [paragraph(ids.paragraph1, "一种合成结构装置。")],
        features: [{
          id: ids.feature,
          text: "温控组件",
          factIds: [ids.fact1],
          supportParagraphIds: [ids.paragraph1],
          status: "supported",
        }],
      },
      {
        id: ids.claim2,
        number: 2,
        dependsOn: [ids.claim1],
        paragraphs: [paragraph(ids.paragraph2, "根据权利要求1所述的装置。")],
        features: [],
      },
    ],
    sections: [
      { kind: "technical_field", paragraphs: [paragraph(ids.paragraph3, "本申请涉及合成结构。 ")] },
      { kind: "background", paragraphs: [paragraph(ids.paragraph4, "现有结构仍有待改进。 ")] },
      { kind: "summary", paragraphs: [paragraph(ids.paragraph5, "提供一种合成结构。 ")] },
      { kind: "figures_description", paragraphs: [paragraph(ids.paragraph6, "图1示出结构。", [])] },
      { kind: "embodiments", paragraphs: [paragraph(ids.paragraph7, "以下描述一个实施例。 ")] },
      { kind: "abstract", paragraphs: [paragraph("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1", "一种合成结构装置。 ")] },
    ],
  };
}

function astValidation(ast) {
  const parsed = contracts.draftAstSchema.safeParse(ast);
  return {
    valid: parsed.success,
    issues: parsed.success ? [] : parsed.error.issues.map((issue) => ({
      path: issue.path.map(String).join("."),
      reason: issue.message,
      nodeId: null,
      section: null,
    })),
  };
}

function makeInput(overrides = {}) {
  const ast = makeAst();
  return {
    snapshot: { ...SNAPSHOT_BASE },
    ast,
    astValidation: astValidation(ast),
    facts: [{ id: ids.fact1, statement: "温控组件读取温度。", status: "user_confirmed" }],
    conflicts: [],
    disclosure: "none",
    priorityClaims: [],
    route: "cn_invention",
    ...overrides,
  };
}

function completeSnapshot(figureRevisionId = SNAPSHOT_BASE.figureRevisionId) {
  return { ...SNAPSHOT_BASE, figureRevisionId };
}

function makeRule(overrides = {}) {
  return {
    id: "LEGAL-SYNTH-001",
    packVersion: "synthetic-legal-v1",
    category: "blocker",
    authority: "official",
    verification: "verified",
    jurisdiction: "cn_invention",
    documentKind: "合成法律条目",
    action: "export",
    basisUrl: "https://example.invalid/official-rule",
    citation: "合成官方规则：仅用于测试闭门规则集。",
    effectiveFrom: "2026-01-01",
    effectiveTo: null,
    verifiedBy: ids.matter,
    verifiedAt: T0,
    title: "合成法律规则提示",
    explanation: "合成规则命中。",
    suggestedAction: "由人工核对合成材料。",
    deterministicCheck: "always",
    ...overrides,
  };
}

async function figureFixture() {
  const seeded = await figureHarness.seed({ targets: 1 });
  const imported = await drawingModule.importDrawing(
    seeded.repository,
    figureHarness.ACTOR_A,
    figureHarness.MATTER_ID,
    { bytes: figureHarness.fixture("drawing-valid.png"), fileName: "合成附图.png" },
    { reuseExisting: true, now: figureHarness.clock },
  );
  assert.equal(imported.ok, true, imported.ok ? "" : JSON.stringify(imported.error));
  const bound = await drawingModule.bindFigures(
    seeded.repository,
    figureHarness.ACTOR_A,
    figureHarness.MATTER_ID,
    {
      targetId: figureHarness.TARGET_A,
      baseFigureRevisionId: figureHarness.EMPTY_SET_A,
      entries: [figureHarness.entry(ids.feature, 1, imported.data.drawing.id, "合成结构图")],
    },
    { now: figureHarness.clock },
  );
  assert.equal(bound.ok, true, bound.ok ? "" : JSON.stringify(bound.error));
  assert.equal(contracts.figureSetRevisionSchema.safeParse(bound.data.current).success, true);
  return { ...seeded, imported: imported.data, revision: bound.data.current };
}

function inputForFigure(figure, overrides = {}) {
  const ast = makeAst();
  const snapshot = { ...SNAPSHOT_BASE, figureRevisionId: figure.revision.id };
  return {
    snapshot,
    ast,
    astValidation: astValidation(ast),
    figureSet: {
      id: figure.revision.id,
      entries: figure.revision.entries.map((entry) => ({
        figureId: entry.figureId,
        number: entry.number,
        title: entry.title,
        drawingId: entry.drawingId,
      })),
    },
    assets: [{ id: figure.imported.asset.id, drawingId: figure.imported.drawing.id, state: figure.imported.asset.state }],
    draftFigureRevisionId: figure.revision.id,
    ...overrides,
  };
}

function gateFor(result, overrides = {}) {
  return {
    action: "export",
    snapshot: result.checkRun.snapshot,
    snapshotCurrent: true,
    filesAvailable: true,
    rulePackVersion: result.checkRun.rulePackVersion,
    activeRulePackVersion: result.checkRun.rulePackVersion,
    checkRun: result.checkRun,
    approval: null,
    confirmations: [],
    risks: result.checkRun.findings.map(({ id, category, title, explanation, ruleId, requiresAcknowledgement, anchor }) => ({
      id, category, title, explanation, ruleId, requiresAcknowledgement, anchor,
    })),
    now: result.checkRun.createdAt,
    ...overrides,
  };
}

function gateFacts(overrides = {}) {
  return {
    packageKind: "preparation",
    confirmationMode: "self_read",
    inputStale: false,
    aiParagraphIds: [],
    blockingPolicyRuleIds: [],
    ...overrides,
  };
}

function renderChecks({ result, currentSnapshot = result?.checkRun.snapshot ?? SNAPSHOT_BASE, pack = EMPTY_PACK, ...extra }) {
  return renderToStaticMarkup(createElement(checksUi.ChecksPanel, {
    input: makeInput({ snapshot: currentSnapshot }),
    rulePack: pack,
    currentSnapshot,
    activeRulePackVersion: pack.version,
    initialResult: result,
    onRiskAck() {},
    ...extra,
  }));
}

test("V6-23-A01: each finding carries an actionable cause locator and auditable basis", async () => {
  const figure = await figureFixture();
  const input = inputForFigure(figure, {
    facts: [
      { id: ids.fact1, statement: "未经支持的合成事实。", status: "unsupported" },
      { id: ids.fact2, statement: "外部背景数据。", status: "external_context" },
    ],
    conflicts: [{ id: ids.conflict, factIds: [ids.fact1], state: "open" }],
    disclosure: "public_event",
    priorityClaims: [{ country: "CN", applicationNumber: "SYNTHETIC-1", verification: "unverified" }],
    route: "pct",
    inputStale: true,
    inventionUsesAi: true,
    badDrawingIds: [figure.imported.drawing.id],
    assets: [{ id: figure.imported.asset.id, drawingId: figure.imported.drawing.id, state: "missing_bytes" }],
    draftFigureSetMismatch: true,
  });
  input.ast.claims[0].features[0].factIds = [ids.fact1, ids.fact2];
  input.ast.claims[0].features[0].status = "partial";
  input.ast.sections.find((section) => section.kind === "summary").paragraphs = [];
  const cycle = structuredClone(input.ast);
  cycle.claims[0].dependsOn = [ids.claim2];
  cycle.claims[1].dependsOn = [ids.claim1];
  input.ast = cycle;
  input.astValidation = astValidation(cycle);

  const result = checkModule.runChecks(input, EMPTY_PACK, T0);
  assert.equal(result.checkRun.state, "succeeded");
  assert.equal(contracts.checkRunSchema.safeParse(result.checkRun).success, true);
  assert.ok(result.findings.length >= 10);
  for (const finding of result.findings) {
    assert.ok(finding.locator.label.length > 0, `${finding.ruleId} needs a cause locator`);
    assert.ok(finding.locator.nodeId || finding.locator.section || finding.locator.label, `${finding.ruleId} needs a node or section locator`);
    assert.ok(finding.suggestedAction.trim().length > 0, `${finding.ruleId} needs an action`);
    assert.ok(finding.actions.length > 0, `${finding.ruleId} needs action kinds`);
    assert.ok(finding.basis.quote || finding.basis.url, `${finding.ruleId} needs a basis quote or URL`);
    assert.ok(finding.verificationLabel.length > 0);
  }
  for (const ruleId of [
    "ast.invalid",
    "claim.dependency_cycle",
    "claim.unsupported_fact",
    "claim.external_context",
    "asset.missing_bytes",
    "asset.bad_drawing",
    "figure.draft_set_mismatch",
    "section.required_empty",
    "fact.open_conflict",
    "disclosure.not_none",
    "claim.support_partial_or_unsupported",
    "priority.unverified",
    "route.chinese_prep_draft",
    "input.stale",
  ]) assert.ok(result.findings.some((finding) => finding.ruleId === ruleId), `${ruleId} should be reported`);
  assert.deepEqual(input.snapshot, { ...SNAPSHOT_BASE, figureRevisionId: figure.revision.id }, "the snapshot input is not mutated");
});

test("V6-23-A02 and S07-A01: a matched legal rule from the closed CN pack stays unverified and never blocks", () => {
  const packFile = new URL("../../../../packages/rules-cn/2026-01-01/ai-related.json", import.meta.url);
  const raw = JSON.parse(readFileSync(packFile, "utf8"));
  const adapted = checkModule.adaptCnRulePack(raw);
  const sourceFiles = [
    "2023-baseline/common.json",
    "2023-baseline/claims.json",
    "2023-baseline/invention.json",
    "2023-baseline/utility-model.json",
    "2026-01-01/ai-related.json",
  ].map((path) => JSON.parse(readFileSync(new URL(`../../../../packages/rules-cn/${path}`, import.meta.url), "utf8")));
  const combined = checkModule.adaptCnRulePacks(sourceFiles);
  assert.equal(combined.version, "cnipa-2026-01-01");
  assert.equal(combined.rules.length, 26, "later rules replace the two repeated rule ids from the baseline");
  assert.ok(combined.rules.every((rule) => rule.packVersion === combined.version));
  assert.ok(combined.rules.filter((rule) => rule.authority !== "engineering").every((rule) => rule.verification === "unverified"));
  const combinedRun = checkModule.runChecks(makeInput({ inventionUsesAi: true }), combined, T0);
  const combinedLegalFindings = combinedRun.findings.filter((finding) => finding.category === "unverified");
  assert.ok(combinedLegalFindings.length > 0);
  assert.ok(combinedLegalFindings.every((finding) => finding.verificationLabel === "二手来源"));
  assert.ok(combinedRun.checkRun.findings.every((finding) => finding.category !== "blocker"));

  const aiRule = adapted.rules.find((rule) => rule.id === "AI-INV-001");
  assert.ok(aiRule);
  assert.equal(aiRule.authority, "secondary");
  assert.equal(aiRule.verification, "unverified", "G-RULES closed overrides partially verified package metadata");

  const officialButUnverified = makeRule({ verification: "unverified" });
  const forgedVerifiedLegalRule = makeRule({ id: "LEGAL-SYNTH-VERIFIED", verification: "verified" });
  const pack = { version: "synthetic-legal-v1", rules: [officialButUnverified, forgedVerifiedLegalRule] };
  const result = checkModule.runChecks(makeInput(), pack, T0);
  assert.equal(result.findings.length, 2);
  assert.ok(result.findings.every((finding) => finding.category === "unverified"));
  assert.ok(result.findings.every((finding) => finding.verificationLabel === "未核实"));
  assert.equal(contracts.checkRunSchema.safeParse(result.checkRun).success, true);

  const decision = gateModule.evaluateGate(gateFor(result), gateFacts({ confirmationMode: "professional_paragraphs" }));
  assert.equal(decision.allowed, true, JSON.stringify(decision.reasons));
  assert.deepEqual(decision.reasons, []);
});

test("S07-A02: duplicate figure numbers block export with DUPLICATE_FIGURE_NUMBER", async () => {
  const figure = await figureFixture();
  const duplicated = {
    ...figure.revision,
    entries: [
      { ...figure.revision.entries[0], number: 1 },
      { ...figure.revision.entries[0], figureId: ids.figure2, number: 1, title: "第二张合成图" },
    ],
  };
  assert.equal(contracts.figureSetRevisionSchema.safeParse(duplicated).success, true, "legacy duplicate numbers remain schema-readable");
  const input = inputForFigure(figure, {
    snapshot: { ...SNAPSHOT_BASE, figureRevisionId: duplicated.id },
    figureSet: {
      id: duplicated.id,
      entries: duplicated.entries.map(({ figureId, number, title, drawingId }) => ({ figureId, number, title, drawingId })),
    },
    draftFigureRevisionId: duplicated.id,
  });
  const result = checkModule.runChecks(input, EMPTY_PACK, T0);
  const duplicate = result.checkRun.findings.find((finding) => finding.ruleId === "figure.duplicate_number");
  assert.ok(duplicate);
  assert.equal(duplicate.category, "blocker");
  const decision = gateModule.evaluateGate(gateFor(result), gateFacts({ confirmationMode: "professional_paragraphs" }));
  assert.equal(decision.allowed, false);
  assert.ok(decision.reasons.some((reason) => reason.code === "DUPLICATE_FIGURE_NUMBER" && reason.resourceId === duplicate.id));
  const parsedDecision = contracts.gateDecisionSchema.safeParse(decision);
  assert.equal(parsedDecision.success, true, parsedDecision.success ? "" : JSON.stringify(parsedDecision.error.issues));
  for (const reason of decision.reasons) assert.equal(contracts.errorCodeSchema.safeParse(reason.code).success, true);
});

test("V6-23-A03 and S07-A03/A07: repeated runs are pure; snapshot and pack changes expire results", async () => {
  const figure = await figureFixture();
  const input = inputForFigure(figure);
  const before = structuredClone(input);
  const pack = Object.freeze({ version: "synthetic-rules-v1", rules: Object.freeze([]) });
  const first = checkModule.runChecks(input, pack, T0);
  const second = checkModule.runChecks(input, pack, T0);
  assert.deepEqual(second, first);
  assert.deepEqual(input, before, "a check run does not mutate the input AST, set, or metadata");
  assert.equal(checkModule.isCurrentCheckRun(first.checkRun, input.snapshot, pack.version), true);

  const reboundResult = await drawingModule.bindFigures(
    figure.repository,
    figureHarness.ACTOR_A,
    figureHarness.MATTER_ID,
    {
      targetId: figureHarness.TARGET_A,
      baseFigureRevisionId: figure.revision.id,
      entries: [
        ...figure.revision.entries,
        figureHarness.entry(ids.figure2, 2, figure.imported.drawing.id, "第二张合成图"),
      ],
    },
    { now: figureHarness.clock },
  );
  assert.equal(reboundResult.ok, true, reboundResult.ok ? "" : JSON.stringify(reboundResult.error));
  const rebound = { ...input.snapshot, figureRevisionId: reboundResult.data.current.id };
  assert.notEqual(rebound.figureRevisionId, input.snapshot.figureRevisionId);
  assert.equal(checkModule.isCurrentCheckRun(first.checkRun, rebound, pack.version), false);
  const staleSnapshotDecision = gateModule.evaluateGate(
    gateFor(first, { snapshot: rebound, risks: [] }),
    gateFacts(),
  );
  assert.equal(staleSnapshotDecision.allowed, false);
  assert.ok(staleSnapshotDecision.reasons.some((reason) => reason.code === "CHECK_REQUIRED"));

  assert.equal(checkModule.isCurrentCheckRun(first.checkRun, input.snapshot, "synthetic-rules-v2"), false);
  const missingCheck = gateModule.evaluateGate(
    gateFor(first, { checkRun: null, risks: [] }),
    gateFacts({ confirmationMode: "professional_paragraphs" }),
  );
  assert.ok(missingCheck.reasons.some((reason) => reason.code === "CHECK_REQUIRED"));
  assert.equal(first.checkRun.findings.some((finding) => finding.ruleId === "no_current_check"), false);
  const staleMarkup = renderChecks({
    result: first,
    currentSnapshot: rebound,
    pack: { version: "synthetic-rules-v1", rules: [] },
  });
  assert.match(staleMarkup, /已过期/);
  assert.match(staleMarkup, /重新检查/);
  assert.doesNotMatch(staleMarkup, /data-testid="check-ack-/);
});

test("S07-A04: risk acknowledgements are tied to one check run and reopen after rerun", () => {
  const input = makeInput({
    conflicts: [{ id: ids.conflict, factIds: [ids.fact1], state: "open" }],
  });
  const first = checkModule.runChecks(input, EMPTY_PACK, T0);
  const risk = first.checkRun.findings.find((finding) => finding.ruleId === "fact.open_conflict");
  assert.ok(risk);
  const ledger = { matterId: input.snapshot.matterId, confirmations: [], revocations: [] };
  let sequence = 0;
  const commandContext = {
    newId: () => `bbbbbbbb-bbbb-4bbb-8bbb-${String(++sequence).padStart(12, "0")}`,
    now: () => T0,
  };
  const ack = confirmationModule.confirm(ledger, {
    kind: "risk_ack",
    snapshot: input.snapshot,
    actorId: ids.matter,
    identity: "local_self_reported",
    riskId: risk.id,
    checkRunId: first.checkRun.id,
  }, commandContext);
  assert.equal(ack.ok, true);
  assert.equal(confirmationModule.confirm(ack.state, {
    kind: "risk_ack",
    snapshot: input.snapshot,
    actorId: ids.matter,
    identity: "local_self_reported",
    riskId: risk.id,
    checkRunId: first.checkRun.id,
  }, commandContext).created, false, "retrying the same acknowledgement adds no duplicate row");

  const second = checkModule.runChecks(input, EMPTY_PACK, T1);
  const reopened = second.checkRun.findings.find((finding) => finding.ruleId === "fact.open_conflict");
  assert.ok(reopened);
  assert.equal(reopened.status, "open");
  assert.notEqual(second.checkRun.id, first.checkRun.id);
  const decision = gateModule.evaluateGate(
    gateFor(second, { confirmations: ack.state.confirmations }),
    gateFacts(),
  );
  assert.ok(decision.reasons.some((reason) => reason.code === "CONFIRMATION_REQUIRED" && reason.resourceId === reopened.id));
});

test("S07-A05: a present blocker cannot be manually resolved; only a clean rerun removes it", async () => {
  const figure = await figureFixture();
  const duplicated = {
    ...figure.revision,
    entries: [
      { ...figure.revision.entries[0], number: 1 },
      { ...figure.revision.entries[0], figureId: ids.figure2, number: 1 },
    ],
  };
  const badInput = inputForFigure(figure, {
    snapshot: { ...SNAPSHOT_BASE, figureRevisionId: duplicated.id },
    figureSet: { id: duplicated.id, entries: duplicated.entries.map(({ figureId, number, title, drawingId }) => ({ figureId, number, title, drawingId })) },
    draftFigureRevisionId: duplicated.id,
  });
  const result = checkModule.runChecks(badInput, EMPTY_PACK, T0);
  const blocker = result.checkRun.findings.find((finding) => finding.ruleId === "figure.duplicate_number");
  assert.ok(blocker);
  const forgedResolved = {
    ...result.checkRun,
    findings: result.checkRun.findings.map((finding) => finding.id === blocker.id ? { ...finding, status: "resolved" } : finding),
  };
  const decision = gateModule.evaluateGate(gateFor(result, { checkRun: forgedResolved }), gateFacts());
  assert.ok(decision.reasons.some((reason) => reason.code === "DUPLICATE_FIGURE_NUMBER"));
  const markup = renderChecks({ result, currentSnapshot: badInput.snapshot });
  assert.doesNotMatch(markup, /标记已解决/);

  const fixedInput = inputForFigure(figure);
  const rerun = checkModule.runChecks(fixedInput, EMPTY_PACK, T1);
  assert.equal(rerun.checkRun.findings.some((finding) => finding.ruleId === "figure.duplicate_number"), false);
});

test("S07-A06: the check panel states that prior-art search was not performed", () => {
  const result = checkModule.runChecks(makeInput(), EMPTY_PACK, T0);
  const markup = renderChecks({ result });
  assert.match(markup, /现有技术检索：未检索/);
  for (const category of ["blocker", "risk", "unverified", "policy"]) {
    assert.match(markup, new RegExp(`data-testid="checks-count-${category}"`));
  }
});

test("S07-A08: a failed run shows an error and retry, never an empty-problems claim", () => {
  const result = checkModule.runChecks(makeInput(), EMPTY_PACK, T0);
  const failed = {
    ...result,
    checkRun: { ...result.checkRun, state: "failed" },
  };
  const markup = renderChecks({ result: failed });
  assert.match(markup, /CHECK_FAILED/);
  assert.match(markup, /重试检查/);
  assert.doesNotMatch(markup, /本组无项目|本次检查无风险|本次检查无问题/);
  assert.match(markup, /尚未检查不能表示没有风险/);
});

test("check panel renders loading and empty states without claiming a clean result", () => {
  const loading = renderToStaticMarkup(createElement(checksUi.ChecksPanel, {
    input: makeInput(),
    rulePack: EMPTY_PACK,
    currentSnapshot: SNAPSHOT_BASE,
    activeRulePackVersion: EMPTY_PACK.version,
    initialResult: null,
    loading: true,
    onRiskAck() {},
  }));
  assert.match(loading, /checks-loading/);
  assert.doesNotMatch(loading, /无风险/);

  const empty = renderToStaticMarkup(createElement(checksUi.ChecksPanel, {
    input: makeInput(),
    rulePack: EMPTY_PACK,
    currentSnapshot: SNAPSHOT_BASE,
    activeRulePackVersion: EMPTY_PACK.version,
    initialResult: null,
    onRiskAck() {},
  }));
  assert.match(empty, /尚未运行检查/);
  assert.match(empty, /尚未检查不能表示没有风险/);
});

test("product policy rules are labelled and block only their declared action", () => {
  const policy = makeRule({
    id: "policy.synthetic.export-only",
    packVersion: "synthetic-policy-v1",
    category: "policy",
    authority: "engineering",
    verification: "verified",
    citation: "产品规则：仅用于合成验收。",
    deterministicCheck: "always",
  });
  const pack = { version: "synthetic-policy-v1", rules: [policy] };
  const result = checkModule.runChecks(makeInput(), pack, T0);
  const finding = result.findings[0];
  assert.equal(finding.category, "policy");
  assert.equal(finding.verificationLabel, "产品规则");
  assert.deepEqual(result.blockingPolicyRuleIds.export, [policy.id]);
  assert.deepEqual(result.blockingPolicyRuleIds.prepare, []);
  const decision = gateModule.evaluateGate(gateFor(result), gateFacts({ blockingPolicyRuleIds: result.blockingPolicyRuleIds.export }));
  assert.equal(decision.allowed, false);
  assert.equal(decision.reasons[0].code, "GATE_BLOCKED");
  const prepareDecision = gateModule.evaluateGate(
    { ...gateFor(result), action: "prepare" },
    gateFacts({
      confirmationMode: "professional_paragraphs",
      blockingPolicyRuleIds: result.blockingPolicyRuleIds.prepare,
    }),
  );
  assert.equal(prepareDecision.allowed, true, "the export-only policy does not block prepare");
});

test("a stale policy version cannot add an action the active rule does not declare", () => {
  const id = "policy.versioned.synthetic";
  const oldRule = makeRule({
    id,
    packVersion: "old-v1",
    category: "policy",
    authority: "engineering",
    action: "export",
    deterministicCheck: "always",
  });
  const activeRule = { ...oldRule, packVersion: "active-v2", action: "prepare" };
  const pack = { version: "active-v2", rules: [oldRule, activeRule] };
  const result = checkModule.runChecks(makeInput(), pack, T0);
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].ruleId, id);
  assert.deepEqual(result.blockingPolicyRuleIds.export, []);
  assert.deepEqual(result.blockingPolicyRuleIds.prepare, [id]);

  const exportDecision = gateModule.evaluateGate(
    { ...gateFor(result), action: "export" },
    gateFacts({ confirmationMode: "professional_paragraphs", blockingPolicyRuleIds: result.blockingPolicyRuleIds.export }),
  );
  assert.equal(exportDecision.allowed, true, "the stale export rule is ignored");

  const prepareDecision = gateModule.evaluateGate(
    { ...gateFor(result), action: "prepare" },
    gateFacts({ confirmationMode: "professional_paragraphs", blockingPolicyRuleIds: result.blockingPolicyRuleIds.prepare }),
  );
  assert.equal(prepareDecision.allowed, false);
  assert.deepEqual(prepareDecision.reasons, [{ code: "GATE_BLOCKED", resourceId: result.findings[0].id }]);
});

 test("missing bytes, damaged drawings, placeholders and figure binding mismatch each have distinct causes", async () => {
  const figure = await figureFixture();
  const base = inputForFigure(figure);
  const placeholder = {
    ...base,
    figureSet: { ...base.figureSet, entries: [{ ...base.figureSet.entries[0], drawingId: null }] },
  };
  assert.ok(checkModule.runChecks(placeholder, EMPTY_PACK, T0).checkRun.findings.some((item) => item.ruleId === "figure.missing_or_placeholder"));
  assert.ok(checkModule.runChecks({ ...base, assets: [{ ...base.assets[0], state: "missing_bytes" }] }, EMPTY_PACK, T0)
    .checkRun.findings.some((item) => item.ruleId === "asset.missing_bytes"));
  assert.ok(checkModule.runChecks({ ...base, badDrawingIds: [figure.imported.drawing.id] }, EMPTY_PACK, T0)
    .checkRun.findings.some((item) => item.ruleId === "asset.bad_drawing"));
  assert.ok(checkModule.runChecks({ ...base, draftFigureSetMismatch: true }, EMPTY_PACK, T0)
    .checkRun.findings.some((item) => item.ruleId === "figure.draft_set_mismatch"));
});
