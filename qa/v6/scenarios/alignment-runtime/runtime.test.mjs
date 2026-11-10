import assert from "node:assert/strict";
import test from "node:test";
import { register } from "tsx/esm/api";
import { ACTOR, MATTER_ID, TARGET_ID, createFixture, waitForJob } from "../V6-17/harness.mjs";

register();

const { LOCAL_TEST_GENERATION_OPTIONS } = await import("../../../../apps/web/src/v6/features/generation/local-runtime.ts");
const { createGenerationEngine, createGenerationRevisionStore } = await import("../../../../apps/web/src/v6/features/generation/generation.ts");
const { draftRevisionSchema } = await import("../../../../packages/contracts/src/draft.ts");
const [{ createElement }, { renderToStaticMarkup }, { runChecks }, { ChecksPanel }] = await Promise.all([
  import("react"),
  import("react-dom/server"),
  import("../../../../packages/domain/src/v6/checks.ts"),
  import("../../../../apps/web/src/v6/features/checks/Checks.tsx"),
]);
const previewModule = await import("../../../../apps/web/src/v6/features/preview/preview.ts");
const workspaceModule = await import("../../../../apps/web/src/v6/features/delivery/workspace-data.ts");
const drawingsModule = await import("../../../../apps/web/src/v6/features/sources/drawings.ts");
const v624 = await import("../V6-24/harness.mjs");
const confirmationModule = await import("../../../../packages/domain/src/v6/confirmation.ts");
const repositoryModule = await import("../../../../apps/web/src/v6/lib/repository.ts");
const exportAdapter = await import("../../../../apps/web/src/v6/features/delivery/export-adapter.ts");
const PNG_1PX = Uint8Array.from(Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
));

test("R1 local test generation runs against a real local matter without consent or provider calls", async () => {
  const fixture = await createFixture();
  const defaultOptions = { ...LOCAL_TEST_GENERATION_OPTIONS };
  delete defaultOptions.allowTestAdoption;
  const engine = createGenerationEngine({
    ...defaultOptions,
    repository: fixture.repository,
    actor: ACTOR,
    storage: fixture.storage,
  });
  const started = await engine.start(MATTER_ID, TARGET_ID);
  assert.equal(started.ok, true, started.ok ? "" : JSON.stringify(started.error));
  const completed = await waitForJob(engine, started.data.job.id);
  assert.equal(completed.job.state, "succeeded");
  assert.equal(completed.result?.testOutput, true);
  assert.equal(completed.job.consentId, null);
  const invocations = await engine.listInvocations(completed.job.id);
  assert.equal(invocations.ok, true);
  assert.ok(invocations.data.length > 0);
  assert.ok(invocations.data.every((item) => item.consentId === null && item.executionLocation === "device:stub"));
  const adopted = await engine.adopt(completed.job.id);
  assert.equal(adopted.ok, false);
  if (!adopted.ok) assert.equal(adopted.error.code, "CAPABILITY_UNAVAILABLE");
});

test("explicit local test adoption creates a durable marked revision", async () => {
  const fixture = await createFixture();
  const engine = createGenerationEngine({
    ...LOCAL_TEST_GENERATION_OPTIONS,
    allowTestAdoption: true,
    repository: fixture.repository,
    actor: ACTOR,
    storage: fixture.storage,
  });
  const started = await engine.start(MATTER_ID, TARGET_ID);
  assert.equal(started.ok, true, started.ok ? "" : JSON.stringify(started.error));
  const completed = await waitForJob(engine, started.data.job.id);
  const adopted = await engine.adopt(completed.job.id);
  assert.equal(adopted.ok, true, adopted.ok ? "" : JSON.stringify(adopted.error));
  assert.equal(adopted.data.status, "adopted");
  assert.equal(adopted.data.revision.testOutput, true);
  assert.equal(draftRevisionSchema.safeParse(adopted.data.revision).success, true);
  const revisions = createGenerationRevisionStore({ repository: fixture.repository, actor: ACTOR, storage: fixture.storage });
  const edited = await revisions.saveEditedRevision(MATTER_ID, TARGET_ID, adopted.data.revision.id, adopted.data.revision.ast);
  assert.equal(edited.ok, true, edited.ok ? "" : JSON.stringify(edited.error));
  assert.equal(edited.data.testOutput, true, "editing a test revision cannot remove its test marker");
  const loaded = await engine.getRevision(adopted.data.revision.id);
  assert.equal(loaded.ok, true);
  assert.equal(loaded.data.revision.testOutput, true);
});

test("provider execution cannot enable test-output adoption", async () => {
  const fixture = await createFixture();
  const { DEFAULT_AI_CONFIG } = await import("../../../../apps/web/src/v6/features/ai/ai.ts");
  const { TEST_PROFILE } = await import("../V6-17/harness.mjs");
  assert.throws(() => createGenerationEngine({
    repository: fixture.repository,
    actor: ACTOR,
    storage: fixture.storage,
    provider: fixture.provider,
    profileId: TEST_PROFILE.id,
    profileVersion: TEST_PROFILE.version,
    consentId: fixture.consent.id,
    config: DEFAULT_AI_CONFIG,
    pipeline: fixture.pipeline,
    limits: { maxInputTokens: 100_000, maxOutputTokens: 20_000, maxCostMinor: 100_000, maxDurationSeconds: 300 },
    execution: "provider",
    allowTestAdoption: true,
  }), /allowTestAdoption/);
});

test("R1 runtime remains explicitly stub-only and bounded", () => {
  assert.equal(LOCAL_TEST_GENERATION_OPTIONS.execution, "stub");
  assert.equal(LOCAL_TEST_GENERATION_OPTIONS.allowTestAdoption, true);
  assert.equal(LOCAL_TEST_GENERATION_OPTIONS.consentId, null);
  assert.equal(LOCAL_TEST_GENERATION_OPTIONS.pipeline.promptVersion, "v6-local-test-v1");
  assert.equal(LOCAL_TEST_GENERATION_OPTIONS.limits.maxInputTokens > 0, true);
  assert.equal(LOCAL_TEST_GENERATION_OPTIONS.limits.maxOutputTokens > 0, true);
});

test("confirmed risk ids render from persisted confirmation state", () => {
  const snapshot = {
    matterId: MATTER_ID,
    targetId: TARGET_ID,
    sourceVersion: 1,
    targetConfigVersion: 1,
    draftRevisionId: "33333333-3333-4333-8333-333333333333",
    figureRevisionId: "55555555-5555-4555-8555-555555555555",
  };
  const input = {
    snapshot,
    ast: null,
    disclosure: "public_event",
    requiredSections: [],
  };
  const rulePack = { version: "runtime-test-v1", rules: [] };
  const result = runChecks(input, rulePack, "2026-11-10T12:00:00.000Z");
  const risk = result.findings.find((finding) => finding.category === "risk" && finding.requiresAcknowledgement);
  assert.ok(risk);
  const html = renderToStaticMarkup(createElement(ChecksPanel, {
    input,
    rulePack,
    currentSnapshot: snapshot,
    activeRulePackVersion: rulePack.version,
    initialResult: result,
    confirmedRiskIds: [risk.id],
    onRiskAck() {},
  }));
  assert.match(html, new RegExp(`check-acknowledged-${risk.id}`));
  assert.doesNotMatch(html, new RegExp(`check-ack-${risk.id}`));
});

test("preview full_read is written to the shared ledger and lets the export gate pass", async () => {
  const fixture = await v624.makeApprovalFixture();
  const preview = await previewModule.loadLocalPreview(
    fixture.repository, v624.ACTOR, v624.MATTER_ID, v624.TARGET_ID, "local_unmetered", [],
  );
  assert.equal(preview.kind, "ready");
  const confirmed = await previewModule.confirmLocalFullRead({
    repository: fixture.repository,
    actor: v624.ACTOR,
    snapshot: preview.projection.preview.snapshot,
    access: "local_unmetered",
  });
  assert.equal(confirmed.ok, true, confirmed.ok ? "" : JSON.stringify(confirmed.error));
  const rows = [...fixture.backend.data.get(repositoryModule.STORES.blobs).values()]
    .filter((row) => row?.kind === "draft-review.confirmations");
  assert.equal(rows.length, 1);
  assert.ok(rows[0].ledger.confirmations.some((item) => item.id === confirmed.confirmation.id));

  const session = new exportAdapter.ExportSession({
    ...v624.approvalProps(fixture, { confirmationMode: "self_read" }),
    access: "local_unmetered",
    route: "cn_invention",
    passphrase: "synthetic-alignment-passphrase",
    now: () => v624.T0,
    renderReport: async () => [PNG_1PX],
  });
  await session.load();
  assert.equal(session.getSnapshot().gate?.allowed, true, JSON.stringify(session.getSnapshot().gate?.reasons));
  const created = await session.createExport();
  assert.equal(created.ok, true, created.ok ? "" : JSON.stringify(created.error));
});

test("a legacy preview confirmation ledger migrates into the shared ledger without loss", async () => {
  const fixture = await v624.makeApprovalFixture();
  const preview = await previewModule.loadLocalPreview(
    fixture.repository, v624.ACTOR, v624.MATTER_ID, v624.TARGET_ID, "local_unmetered", [],
  );
  assert.equal(preview.kind, "ready");
  const snapshot = preview.projection.preview.snapshot;
  const legacyKey = previewModule.legacyConfirmationLedgerStorageKey(v624.ACTOR, v624.MATTER_ID);
  const legacy = confirmationModule.confirm(
    { matterId: v624.MATTER_ID, confirmations: [], revocations: [] },
    { kind: "full_read", snapshot, actorId: v624.ACTOR.userId, identity: "local_self_reported", contentAccess: "local_unmetered" },
    { newId: () => "10101010-1010-4010-8010-101010101010", now: () => v624.T0 },
  );
  assert.equal(legacy.ok, true);
  await fixture.backend.transaction("readwrite", (tx) => tx.put(repositoryModule.STORES.blobs, legacyKey, {
    kind: "preview.confirmation-ledger",
    tenantId: v624.ACTOR.tenantId,
    actorId: v624.ACTOR.userId,
    matterId: v624.MATTER_ID,
    ledger: legacy.state,
  }));
  const reloaded = await previewModule.loadLocalPreview(
    fixture.repository, v624.ACTOR, v624.MATTER_ID, v624.TARGET_ID, "local_unmetered", [],
  );
  assert.equal(reloaded.kind, "ready");
  assert.equal(reloaded.confirmation?.id, legacy.confirmation.id);
  const canonical = [...fixture.backend.data.get(repositoryModule.STORES.blobs).values()]
    .find((row) => row?.kind === "draft-review.confirmations");
  assert.ok(canonical);
  assert.ok(canonical.ledger.confirmations.some((item) => item.id === legacy.confirmation.id));
  assert.ok(fixture.backend.data.get(repositoryModule.STORES.blobs).get(legacyKey), "the legacy row is kept for compatibility");
});

test("bound figure drawings carry their drawing id into checks and no longer report MISSING_BYTES", async () => {
  const fixture = await v624.makeApprovalFixture();
  const loaded = await fixture.repository.loadMatter(v624.ACTOR, v624.MATTER_ID);
  assert.equal(loaded.ok, true);
  const library = await drawingsModule.readDrawingLibrary(fixture.repository, v624.ACTOR, v624.MATTER_ID);
  assert.equal(library.ok, true);
  const assets = workspaceModule.mapCheckAssets(loaded.data.data.assets, library.data);
  const importedAsset = assets.find((asset) => asset.id === fixture.imported.data.asset.id);
  assert.equal(importedAsset?.drawingId, fixture.imported.data.drawing.id);
  const rulePack = { version: "alignment-runtime-v1", rules: [] };
  const input = {
    snapshot: fixture.input.snapshot,
    ast: fixture.ast,
    facts: [],
    conflicts: [],
    disclosure: "none",
    figureSet: {
      id: fixture.figureRevision.id,
      entries: fixture.figureRevision.entries.map((entry) => ({
        figureId: entry.figureId,
        number: entry.number,
        title: entry.title,
        drawingId: entry.drawingId,
      })),
    },
    assets,
    draftFigureRevisionId: fixture.input.snapshot.figureRevisionId,
    requiredSections: [],
  };
  const result = runChecks(input, rulePack, "2026-11-10T12:00:00.000Z");
  assert.equal(result.findings.some((finding) => finding.ruleId === "asset.missing_bytes"), false);
  const broken = assets.map((asset) => asset.id === fixture.imported.data.asset.id
    ? { ...asset, state: "missing_bytes" }
    : asset);
  const negative = runChecks({ ...input, assets: broken }, rulePack, "2026-11-10T12:00:00.000Z");
  assert.equal(negative.findings.some((finding) => finding.ruleId === "asset.missing_bytes"), true, "missing bytes still block");
});

test("check results expose honest rule coverage for implemented and unimplemented pack rows", () => {
  const rule = (id, deterministicCheck) => ({
    id, packVersion: "coverage-v1", category: "unverified", authority: "secondary", verification: "unverified",
    jurisdiction: "all", documentKind: "synthetic", action: "prepare", basisUrl: null, citation: null,
    effectiveFrom: null, effectiveTo: null, verifiedBy: null, verifiedAt: null, title: id,
    explanation: "", suggestedAction: "", deterministicCheck, requiresAcknowledgement: false,
  });
  const pack = { version: "coverage-v1", rules: [rule("IMPLEMENTED", "titleLengthMax25"), rule("UNIMPLEMENTED", "notYetImplemented")] };
  const input = { snapshot: { matterId: MATTER_ID, targetId: TARGET_ID, sourceVersion: 1, targetConfigVersion: 1, draftRevisionId: "33333333-3333-4333-8333-333333333333", figureRevisionId: "55555555-5555-4555-8555-555555555555" }, ast: null, disclosure: "none", requiredSections: [] };
  const result = runChecks(input, pack, "2026-11-10T12:00:00.000Z");
  assert.equal(result.ruleCoverage.totalRules, 2);
  assert.equal(result.ruleCoverage.executedRules, 1);
  assert.deepEqual(result.ruleCoverage.executedRuleIds, ["IMPLEMENTED"]);
  assert.deepEqual(result.ruleCoverage.unexecutedRuleIds, ["UNIMPLEMENTED"]);
  assert.equal(result.ruleCoverage.rulesThatCanReport, 1);
});

const makePackRule = (id, deterministicCheck, extra = {}) => ({
  id, packVersion: "rules-v2", category: "unverified", authority: "secondary", verification: "unverified",
  jurisdiction: "all", documentKind: "synthetic", action: "prepare", basisUrl: null, citation: null,
  effectiveFrom: null, effectiveTo: null, verifiedBy: null, verifiedAt: null, title: id,
  explanation: "", suggestedAction: "", deterministicCheck, requiresAcknowledgement: false, ...extra,
});
const T_RULE = "2026-11-10T12:00:00.000Z";
const SNAP = {
  matterId: MATTER_ID, targetId: TARGET_ID, sourceVersion: 1, targetConfigVersion: 1,
  draftRevisionId: "33333333-3333-4333-8333-333333333333",
  figureRevisionId: "55555555-5555-4555-8555-555555555555",
};
const para = (id, text, figureIds = []) => ({ id, text, origin: "human", sourceRefs: [], factIds: [], figureIds, generationJobId: null });
const ruleAst = (overrides = {}) => ({
  schemaVersion: "draft.v1", language: "zh-CN", title: "一种测试装置",
  claims: [{ id: "66666666-6666-4666-8666-666666666661", number: 1, dependsOn: [], paragraphs: [para("77777777-7777-4777-8777-777777777771", "一种装置。")], features: [] }],
  sections: [{ kind: "abstract", paragraphs: [para("77777777-7777-4777-8777-777777777772", "一种装置。")] }],
  ...overrides,
});
const ruleInput = (override = {}) => ({ snapshot: SNAP, ast: ruleAst(), disclosure: "none", requiredSections: [], ...override });

test("formal rule checks report violations and stay quiet on clean input", () => {
  const pack = (checks) => ({ version: "rules-v2", rules: checks.map(([id, check]) => makePackRule(id, check)) });
  const has = (result, id) => result.findings.some((finding) => finding.ruleId === id);

  const titleBad = runChecks(ruleInput({ ast: ruleAst({ title: "最佳测试装置" }) }), pack([["COM-TITLE-002", "titleNoPromoWords"]]), T_RULE);
  assert.equal(has(titleBad, "COM-TITLE-002"), true);
  const titleClean = runChecks(ruleInput(), pack([["COM-TITLE-002", "titleNoPromoWords"]]), T_RULE);
  assert.equal(has(titleClean, "COM-TITLE-002"), false);

  const abstractBad = runChecks(ruleInput({ ast: ruleAst({ sections: [{ kind: "abstract", paragraphs: [para("77777777-7777-4777-8777-777777777772", "本产品为第一品牌。")] }] }) }), pack([["COM-SECT-003", "abstractNoPromoNoNoise"]]), T_RULE);
  assert.equal(has(abstractBad, "COM-SECT-003"), true);

  const bodyBad = runChecks(ruleInput({ ast: ruleAst({ sections: [{ kind: "abstract", paragraphs: [para("77777777-7777-4777-8777-777777777772", "待补充")] }] }) }), pack([["COM-NOISE-001", "noPromoNoiseContent"]]), T_RULE);
  assert.equal(has(bodyBad, "COM-NOISE-001"), true);

  const noIndependent = runChecks(ruleInput({ ast: ruleAst({ claims: [{ id: "66666666-6666-4666-8666-666666666661", number: 1, dependsOn: [], paragraphs: [], features: [] }] }) }), pack([["CLAIM-IND-001", "atLeastOneIndependent"]]), T_RULE);
  assert.equal(has(noIndependent, "CLAIM-IND-001"), false);
  const dependentOnly = runChecks(ruleInput({ ast: ruleAst({ claims: [
    { id: "66666666-6666-4666-8666-666666666661", number: 1, dependsOn: ["66666666-6666-4666-8666-666666666662"], paragraphs: [], features: [] },
    { id: "66666666-6666-4666-8666-666666666662", number: 2, dependsOn: ["66666666-6666-4666-8666-666666666661"], paragraphs: [], features: [] },
  ] }) }), pack([["CLAIM-IND-001", "atLeastOneIndependent"]]), T_RULE);
  assert.equal(has(dependentOnly, "CLAIM-IND-001"), true);

  const forward = runChecks(ruleInput({ ast: ruleAst({ claims: [
    { id: "66666666-6666-4666-8666-666666666661", number: 1, dependsOn: ["66666666-6666-4666-8666-666666666662"], paragraphs: [], features: [] },
    { id: "66666666-6666-4666-8666-666666666662", number: 2, dependsOn: [], paragraphs: [], features: [] },
  ] }) }), pack([["CLAIM-REF-001", "refsExistAndForward"]]), T_RULE);
  assert.equal(has(forward, "CLAIM-REF-001"), true);

  const multiBase = runChecks(ruleInput({ ast: ruleAst({ claims: [
    { id: "66666666-6666-4666-8666-666666666661", number: 1, dependsOn: [], paragraphs: [], features: [] },
    { id: "66666666-6666-4666-8666-666666666662", number: 2, dependsOn: ["66666666-6666-4666-8666-666666666661"], paragraphs: [], features: [] },
    { id: "66666666-6666-4666-8666-666666666663", number: 3, dependsOn: ["66666666-6666-4666-8666-666666666661", "66666666-6666-4666-8666-666666666662"], paragraphs: [], features: [] },
    { id: "66666666-6666-4666-8666-666666666664", number: 4, dependsOn: ["66666666-6666-4666-8666-666666666663"], paragraphs: [], features: [] },
  ] }) }), pack([["CLAIM-REF-002", "multiDependentNotBaseOfMulti"]]), T_RULE);
  assert.equal(has(multiBase, "CLAIM-REF-002"), true);

  const cycle = runChecks(ruleInput({ ast: ruleAst({ claims: [
    { id: "66666666-6666-4666-8666-666666666661", number: 1, dependsOn: ["66666666-6666-4666-8666-666666666662"], paragraphs: [], features: [] },
    { id: "66666666-6666-4666-8666-666666666662", number: 2, dependsOn: ["66666666-6666-4666-8666-666666666661"], paragraphs: [], features: [] },
  ] }) }), pack([["CLAIM-REF-003", "noCircularRefs"]]), T_RULE);
  assert.equal(has(cycle, "CLAIM-REF-003"), true);

  const figures = { id: SNAP.figureRevisionId, entries: [
    { figureId: "88888888-8888-4888-8888-888888888881", number: 1, drawingId: null },
    { figureId: "88888888-8888-4888-8888-888888888882", number: 2, drawingId: null },
  ] };
  const figureMismatch = runChecks(ruleInput({ figureSet: figures, ast: ruleAst({ sections: [{ kind: "figures_description", paragraphs: [para("77777777-7777-4777-8777-777777777773", "图1。", [figures.entries[0].figureId])] }] }) }), pack([["COM-REF-001", "numeralBidirectionalMatch"]]), T_RULE);
  assert.equal(has(figureMismatch, "COM-REF-001"), true);
  const figureClean = runChecks(ruleInput({ figureSet: figures, ast: ruleAst({ sections: [{ kind: "figures_description", paragraphs: [para("77777777-7777-4777-8777-777777777773", "图1、图2。", figures.entries.map((entry) => entry.figureId))] }] }) }), pack([["COM-REF-001", "numeralBidirectionalMatch"]]), T_RULE);
  assert.equal(has(figureClean, "COM-REF-001"), false);
});

test("an organization listed as inventor is a blocker; a person is not", () => {
  const org = runChecks(ruleInput({ parties: [{ id: "99999999-9999-4999-8999-999999999991", name: "合成公司", kind: "organization", roles: ["inventor"] }] }), { version: "empty-v1", rules: [] }, T_RULE);
  const finding = org.findings.find((item) => item.ruleId === "inventor.natural_person");
  assert.ok(finding);
  assert.equal(finding.category, "blocker");
  const person = runChecks(ruleInput({ parties: [{ id: "99999999-9999-4999-8999-999999999992", name: "合成人", kind: "person", roles: ["inventor"] }] }), { version: "empty-v1", rules: [] }, T_RULE);
  assert.equal(person.findings.some((item) => item.ruleId === "inventor.natural_person"), false);
});

test("unimplemented rules produce a non-blocking 未自动检查 entry while coverage stays honest", () => {
  const rule = makePackRule("LEGAL-UNIMPLEMENTED", "notYetImplemented");
  const result = runChecks(ruleInput(), { version: "rules-v2", rules: [rule] }, T_RULE);
  const placeholder = result.findings.find((item) => item.ruleId === "LEGAL-UNIMPLEMENTED");
  assert.ok(placeholder);
  assert.equal(placeholder.category, "unverified");
  assert.equal(placeholder.requiresAcknowledgement, false);
  assert.match(placeholder.explanation, /本版未自动检查/);
  assert.deepEqual(result.blockingPolicyRuleIds.export, []);
  assert.equal(result.ruleCoverage.executedRules, 0);
  assert.deepEqual(result.ruleCoverage.unexecutedRuleIds, ["LEGAL-UNIMPLEMENTED"]);
});

test("the shipped pack keeps all 28 rows and the product-policy row after unique ids", async () => {
  const fs = await import("node:fs");
  const paths = [
    "2023-baseline/common.json", "2023-baseline/claims.json", "2023-baseline/invention.json",
    "2023-baseline/utility-model.json", "2026-01-01/ai-related.json",
  ];
  const sources = paths.map((path) => JSON.parse(fs.readFileSync(new URL(`../../../../packages/rules-cn/${path}`, import.meta.url), "utf8")));
  const combined = (await import("../../../../packages/domain/src/v6/checks.ts")).adaptCnRulePacks(sources);
  assert.equal(combined.rules.length, 28);
  const policy = combined.rules.find((rule) => rule.id === "AI-POL-002");
  assert.ok(policy);
  assert.equal(policy.category, "policy");
  const run = runChecks(ruleInput(), combined, T_RULE);
  assert.ok(run.findings.some((finding) => finding.ruleId === "AI-POL-002" && finding.category === "policy"));
  assert.deepEqual(run.blockingPolicyRuleIds.export, []);
});

test("check finding copy uses Chinese support labels instead of raw enums", () => {
  const ast = ruleAst({
    claims: [{
      id: "66666666-6666-4666-8666-666666666661", number: 1, dependsOn: [],
      paragraphs: [para("77777777-7777-4777-8777-777777777771", "一种装置。")],
      features: [{
        id: "88888888-8888-4888-8888-888888888881", text: "温控组件", factIds: [],
        supportParagraphIds: [], status: "partial",
      }],
    }],
  });
  const result = runChecks({
    snapshot: SNAP, ast, disclosure: "none", requiredSections: [],
    facts: [{ id: "99999999-9999-4999-8999-999999999991", statement: "未经支持的事实", status: "unsupported" }],
  }, { version: "empty-v1", rules: [] }, T_RULE);
  const support = result.findings.find((finding) => finding.ruleId === "claim.support_partial_or_unsupported");
  assert.ok(support);
  assert.match(support.explanation, /部分支持/);
  assert.doesNotMatch(support.explanation, /partial/);
  const unsupported = result.findings.find((finding) => finding.ruleId === "claim.unsupported_fact");
  if (unsupported) assert.doesNotMatch(unsupported.explanation, /unsupported/);
});

test("figure-matching copy does not expose raw figure UUIDs", () => {
  const figures = { id: SNAP.figureRevisionId, entries: [
    { figureId: "88888888-8888-4888-8888-888888888881", number: 1, drawingId: null },
    { figureId: "88888888-8888-4888-8888-888888888882", number: 2, drawingId: null },
  ] };
  const result = runChecks(ruleInput({ figureSet: figures, ast: ruleAst({ sections: [{ kind: "figures_description", paragraphs: [para("77777777-7777-4777-8777-777777777773", "图1。", [figures.entries[0].figureId])] }] }) }), { version: "rules-v2", rules: [makePackRule("COM-REF-001", "numeralBidirectionalMatch")] }, T_RULE);
  const finding = result.findings.find((item) => item.ruleId === "COM-REF-001");
  assert.ok(finding);
  assert.doesNotMatch(finding.explanation, /[0-9a-f]{8}-[0-9a-f]{4}/i);
});
