// A target that never had figures must still be approvable and exportable, while
// a figure set that history proves existed but is now unreadable stays blocked.
import assert from "node:assert/strict";
import test from "node:test";
import { register } from "tsx/esm/api";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import * as esbuild from "esbuild";
import { createRequire } from "node:module";

register();

const [exportAdapter, v624, v619, drawings, checks, approvalModule] = await Promise.all([
  import("../../../../apps/web/src/v6/features/delivery/export-adapter.ts"),
  import("../V6-24/harness.mjs"),
  import("../V6-19/harness.mjs"),
  import("../../../../apps/web/src/v6/features/sources/drawings.ts"),
  import("../../../../packages/domain/src/v6/checks.ts"),
  import("../../../../apps/web/src/v6/features/delivery/Approval.tsx"),
]);

const PNG_1PX = Uint8Array.from(Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
));
const PASS_PHRASE = "synthetic-v6-25-passphrase";
const renderReport = async () => [PNG_1PX];
const FIGURE_ID = "99999999-9999-4999-8999-999999999991";

/** The same fixture as V6-24, but the target never created or bound a figure set. */
async function makeNoFigureFixture({ referenced = false } = {}) {
  const fixture = await v619.makeFixture();
  const ast = structuredClone(v624.makeApprovalAst(FIGURE_ID));
  if (!referenced) {
    for (const section of ast.sections) {
      for (const paragraph of section.paragraphs) {
        paragraph.figureIds = [];
        if (section.kind === "figures_description") paragraph.text = "本申请无附图。";
      }
    }
  }
  assert.equal(v619.modules.contracts.draftAstSchema.safeParse(ast).success, true);
  const saved = await fixture.revisions.saveEditedRevision(v619.MATTER_ID, v619.TARGET_ID, fixture.revision.id, ast);
  assert.equal(saved.ok, true, saved.ok ? "" : JSON.stringify(saved.error));
  const loaded = await fixture.repository.loadMatter(v619.ACTOR, v619.MATTER_ID);
  const target = loaded.data.data.targets.find((item) => item.id === v619.TARGET_ID);
  const snapshot = {
    matterId: v619.MATTER_ID,
    targetId: v619.TARGET_ID,
    sourceVersion: loaded.data.data.matter.sourceVersion,
    targetConfigVersion: target.configVersion,
    draftRevisionId: target.draftRevisionId,
    figureRevisionId: target.figureRevisionId,
  };
  const checkResult = checks.runChecks({
    snapshot,
    ast,
    astValidation: { valid: true, issues: [] },
    facts: [{ id: v619.FACT_ID, statement: "温控装置读取温度。", status: "user_confirmed" }],
    conflicts: [],
    disclosure: "none",
    priorityClaims: [],
    route: "cn_invention",
    assets: [],
    draftFigureRevisionId: snapshot.figureRevisionId,
  }, v624.ACTIVE_PACK, v619.T0);
  const confirmationSession = new v619.modules.reviewModule.DraftReviewSession({
    repository: fixture.repository,
    actor: v619.ACTOR,
    matterId: v619.MATTER_ID,
    targetId: v619.TARGET_ID,
    revisions: fixture.revisions,
    newId: v619.nextUuid,
    now: () => v619.T0,
  });
  await confirmationSession.load();
  for (const paragraphId of v619.PARAGRAPH_IDS.slice(0, 2)) {
    const confirmed = await confirmationSession.confirmParagraph(paragraphId);
    assert.equal(confirmed.ok, true, confirmed.ok ? "" : JSON.stringify(confirmed.error));
  }
  const fixtureWithCheck = { ...fixture, checkResult };
  await v624.addFullReadConfirmation(fixtureWithCheck);
  for (const finding of checkResult.checkRun.findings.filter((item) => item.requiresAcknowledgement)) {
    await v624.acknowledgeRisk(fixtureWithCheck, finding.id);
  }
  const options = {
    repository: fixture.repository,
    actor: v619.ACTOR,
    matterId: v619.MATTER_ID,
    targetId: v619.TARGET_ID,
    role: "owner",
    checkResult,
    activeRulePackVersion: v624.ACTIVE_PACK.version,
    filesAvailable: true,
    revisions: fixture.revisions,
    newId: v619.nextUuid,
    now: () => v619.T0,
  };
  const approval = new approvalModule.ApprovalSession(options);
  await approval.load();
  return { ...fixture, ast, snapshot, checkResult, confirmationSession, options, approval };
}

function exportSession(fixture, overrides = {}) {
  return new exportAdapter.ExportSession({
    ...v624.approvalProps(fixture, { confirmationMode: "self_read" }),
    access: "local_unmetered",
    route: "cn_invention",
    passphrase: PASS_PHRASE,
    now: () => v619.T0,
    renderReport,
    ...overrides,
  });
}

let outdir;
let doneUi;
let approvalUi;
test.before(async () => {
  outdir = mkdtempSync(join(tmpdir(), "v6-figures-optional-"));
  const outfile = join(outdir, "ui.cjs");
  const root = resolve(import.meta.dirname, "../../../..");
  const done = join(root, "apps/web/src/v6/features/delivery/Done.tsx");
  const approval = join(root, "apps/web/src/v6/features/delivery/Approval.tsx");
  await esbuild.build({
    stdin: { resolveDir: root, sourcefile: "figures-optional-ui.tsx", loader: "tsx", contents: `
      import { renderToStaticMarkup } from "react-dom/server";
      import { MemoryRouter } from "react-router-dom";
      import { DoneView } from ${JSON.stringify(done)};
      import { ApprovalPanelView } from ${JSON.stringify(approval)};
      export function renderDone(props) { return renderToStaticMarkup(<MemoryRouter><DoneView {...props} /></MemoryRouter>); }
      export function renderApproval(props) { return renderToStaticMarkup(<ApprovalPanelView {...props} />); }
    ` },
    bundle: true, outfile, format: "cjs", platform: "node", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' }, logLevel: "silent",
    plugins: [{
      name: "vite-raw",
      setup(build) {
        build.onResolve({ filter: /\?raw$/ }, (args) => ({ path: resolve(args.resolveDir, args.path.replace(/\?raw$/, "")), namespace: "vite-raw" }));
        build.onLoad({ filter: /.*/, namespace: "vite-raw" }, (args) => ({ contents: `export default ${JSON.stringify(readFileSync(args.path, "utf8"))}`, loader: "js" }));
      },
    }],
  });
  const ui = createRequire(outfile)(outfile);
  doneUi = ui.renderDone;
  approvalUi = ui.renderApproval;
});
test.after(() => { if (outdir) rmSync(outdir, { recursive: true, force: true }); });

test("a target that never had figures approves and exports without figure files", async () => {
  const fixture = await makeNoFigureFixture();
  assert.equal(fixture.approval.getSnapshot().figureStatus, "never_created");
  assert.equal(fixture.approval.getSnapshot().figureSet, null);
  const approveGate = fixture.approval.getGateDecision("approve");
  assert.equal(approveGate?.allowed, true, `approval is not blocked by an absent figure set: ${JSON.stringify(approveGate?.reasons)}`);

  const approved = await fixture.approval.createApproval("合成内部批准");
  assert.equal(approved.ok, true, approved.ok ? "" : JSON.stringify(approved.error));
  let checklistSpec = null;
  const session = exportSession(fixture, {
    confirmationMode: "professional_paragraphs",
    renderReport: async (spec) => { checklistSpec = spec; return [PNG_1PX]; },
  });
  await session.load();
  assert.equal(session.getSnapshot().gate?.allowed, true, JSON.stringify(session.getSnapshot().gate?.reasons));
  assert.deepEqual(session.getSnapshot().figures, { count: 0, status: "never_created", acknowledgementRequired: false, acknowledged: false });
  const created = await session.createExport();
  assert.equal(created.ok, true, created.ok ? "" : JSON.stringify(created.error));
  assert.equal(created.record.files.some((file) => file.name.startsWith("附图原件-")), false);
  assert.equal(created.record.manifest.figureSetHash, "");
  assert.equal(typeof created.record.manifest.approvalId, "string", "an internally approved package records the approval");
  assert.equal(created.record.manifest.files.length, 5, "no figure file in the hashed manifest");
  assert.equal(created.record.files.length, 6, "manifest sidecar adds one view");
  assert.match(JSON.stringify(checklistSpec), /附图：0 张（本次材料包不含附图）/);
  // The downloaded JSON sidecar is a different artifact from the PDF: it must carry
  // the same human-readable figure note, not only the PDF render spec.
  assert.deepEqual(created.record.manifest.figures, { count: 0, included: false, note: "附图：0 张（本次材料包不含附图）" });
});

test("a draft that mentions figures but has none needs one explicit acknowledgement", async () => {
  const fixture = await makeNoFigureFixture({ referenced: true });
  const session = exportSession(fixture);
  await session.load();
  const blocked = session.getSnapshot();
  assert.equal(blocked.gate?.allowed, false);
  assert.ok(blocked.gate?.reasons.some((reason) => reason.code === "FIGURE_ACK_REQUIRED"), JSON.stringify(blocked.gate?.reasons));
  assert.equal(blocked.figures.acknowledgementRequired, true);
  const refused = await session.createExport();
  assert.equal(refused.ok, false);

  await session.setFigureAcknowledged(true);
  assert.equal(session.getSnapshot().figures.acknowledged, true);
  assert.equal(session.getSnapshot().gate?.allowed, true, JSON.stringify(session.getSnapshot().gate?.reasons));
  const created = await session.createExport();
  assert.equal(created.ok, true, created.ok ? "" : JSON.stringify(created.error));
  assert.equal(created.record.files.some((file) => file.name.startsWith("附图原件-")), false);
});

test("a figure set that history proves existed but is now unreadable still fails with MISSING_BYTES", async () => {
  const fixture = await makeNoFigureFixture();
  const created = await drawings.createEmptyFigureSet(fixture.repository, v619.ACTOR, v619.MATTER_ID, v619.TARGET_ID, { now: () => Date.parse(v619.T0) });
  assert.equal(created.ok, true, created.ok ? "" : JSON.stringify(created.error));
  // Damage the stored row in place: the set exists but can no longer be read.
  await fixture.repository.backend.transaction("readwrite", async (tx) => {
    const store = v619.modules.repositoryModule.STORES.blobs;
    const rows = await tx.getAll(store);
    for (const row of rows) {
      if (!row || row.kind !== "figures.set" || row.revision?.targetId !== v619.TARGET_ID) continue;
      const key = `figures/${row.revision.targetId}/${row.revision.id}`;
      await tx.put(store, key, { ...row, revision: { ...row.revision, entries: "not-an-array" } });
    }
  });
  const session = exportSession(fixture);
  await session.load();
  const state = session.getSnapshot();
  assert.equal(state.phase, "error");
  assert.equal(state.error?.code, "MISSING_BYTES");
  assert.match(state.error?.message ?? "", /附图集记录缺失或已损坏/);
  const refused = await session.createExport();
  assert.equal(refused.ok, false);
});

test("Done shows the zero-figure state, a sources link and the acknowledgement checkbox", async () => {
  const base = {
    phase: "ready", snapshot: { matterId: "m", targetId: "t", sourceVersion: 1, targetConfigVersion: 1, draftRevisionId: "r", figureRevisionId: "f" },
    inputStale: false, testOutput: false, record: null, files: [], unavailableFormats: [],
    error: null, gate: { allowed: false, reasons: [{ code: "FIGURE_ACK_REQUIRED" }] },
  };
  const html = doneUi({
    route: "cn_invention", mode: "professional", state: {
      ...base,
      figures: { count: 0, status: "never_created", acknowledgementRequired: true, acknowledged: false },
    }, passphrase: "x", busy: false, actionError: null,
    onPassphrase() {}, onAcknowledgeFigures() {}, onRefresh() {}, onCreate() {}, onDownload() {},
  });
  assert.match(html, /data-testid="done-figure-status"[^>]*>附图：0 张/);
  assert.match(html, /data-testid="done-figures-none"[\s\S]*?未添加附图：本次材料包不含附图，提交前请按需要补充/);
  assert.match(html, /data-testid="done-add-figures"[^>]*href="\/v6\/matters\/m\/targets\/t\/sources"/);
  assert.match(html, /data-testid="done-figure-ack"/);
  assert.match(/<button[^>]*data-testid="done-export-button"[^>]*>/.exec(html)[0], /disabled/);
  assert.doesNotMatch(html, /附图集不可读取/);

  const withFigures = doneUi({
    route: "cn_invention", mode: "professional", state: {
      ...base, gate: { allowed: true, reasons: [] },
      figures: { count: 3, status: "present", acknowledgementRequired: false, acknowledged: false },
    }, passphrase: "x", busy: false, actionError: null,
    onPassphrase() {}, onRefresh() {}, onCreate() {}, onDownload() {},
  });
  assert.match(withFigures, /data-testid="done-figure-status"[^>]*>附图：3 张/);
  assert.equal(withFigures.includes('data-testid="done-figure-ack"'), false);
  assert.equal(withFigures.includes('data-testid="done-figures-none"'), false);
});

test("self-service Done renders the same figure status, notice, link and acknowledgement gate", async () => {
  const snapshot = { matterId: "m", targetId: "t", sourceVersion: 1, targetConfigVersion: 1, draftRevisionId: "r", figureRevisionId: "f" };
  const renderSelf = (figures, gate = { allowed: false, reasons: [{ code: "FIGURE_ACK_REQUIRED" }] }) => doneUi({
    route: "cn_invention", mode: "self",
    state: {
      phase: "ready", snapshot, inputStale: false, testOutput: false, record: null, files: [],
      unavailableFormats: [], error: null, gate, figures,
    },
    passphrase: "x", busy: false, actionError: null,
    onPassphrase() {}, onAcknowledgeFigures() {}, onRefresh() {}, onCreate() {}, onDownload() {},
  });

  // Referenced draft without figures: the block exists, the export stays disabled until checked.
  const blocked = renderSelf({ count: 0, status: "never_created", acknowledgementRequired: true, acknowledged: false });
  assert.match(blocked, /data-testid="done-figures"/);
  assert.match(blocked, /data-testid="done-figure-status"[^>]*>附图：0 张/);
  assert.match(blocked, /data-testid="done-figures-none"[\s\S]*?未添加附图：本次材料包不含附图，提交前请按需要补充/);
  assert.match(blocked, /data-testid="done-add-figures"[^>]*href="\/v6\/matters\/m\/targets\/t\/sources"/);
  assert.match(blocked, /data-testid="done-figure-ack"/);
  assert.match(/<button[^>]*data-testid="done-export-button"[^>]*>/.exec(blocked)[0], /disabled/);

  // Checked: the same page can export.
  const checked = renderSelf({ count: 0, status: "never_created", acknowledgementRequired: true, acknowledged: true },
    { allowed: true, reasons: [] });
  assert.match(checked, /data-testid="done-figure-ack"[^>]*checked/);
  assert.doesNotMatch(/<button[^>]*data-testid="done-export-button"[^>]*>/.exec(checked)[0], /disabled/);

  // No references: status and notice only, never a checkbox, immediately exportable.
  const plain = renderSelf({ count: 0, status: "never_created", acknowledgementRequired: false, acknowledged: false },
    { allowed: true, reasons: [] });
  assert.match(plain, /data-testid="done-figure-status"[^>]*>附图：0 张/);
  assert.match(plain, /data-testid="done-figures-none"/);
  assert.equal(plain.includes('data-testid="done-figure-ack"'), false);
  assert.doesNotMatch(/<button[^>]*data-testid="done-export-button"[^>]*>/.exec(plain)[0], /disabled/);

  // Figures present: count only, no notice and no checkbox.
  const withFigures = renderSelf({ count: 3, status: "present", acknowledgementRequired: false, acknowledged: false },
    { allowed: true, reasons: [] });
  assert.match(withFigures, /data-testid="done-figure-status"[^>]*>附图：3 张/);
  assert.equal(withFigures.includes('data-testid="done-figures-none"'), false);
  assert.equal(withFigures.includes('data-testid="done-figure-ack"'), false);
});

test("Approval shows the zero-figure state and keeps its blocker rule untouched", async () => {
  const fixture = await makeNoFigureFixture();
  const model = v624.readyPanelModel({ ...fixture, session: fixture.approval }, fixture.approval.getSnapshot());
  const html = approvalUi({ model, role: "owner", onRefresh() {}, onCreate() {}, onRevoke() {} });
  assert.match(html, /data-testid="approval-figure-set">附图：0 张/);
  assert.match(html, /data-testid="approval-add-figures"[^>]*href="\/v6\/matters\/[^"]*\/targets\/[^"]*\/sources"/);
  assert.match(html, /data-testid="approval-figures-none"[\s\S]*?未添加附图：本次材料包不含附图，提交前请按需要补充/);
  // The rule-pack blocker wording is unchanged; this feature never loosens checks.
  const referenced = await makeNoFigureFixture({ referenced: true });
  const referencedModel = v624.readyPanelModel({ ...referenced, session: referenced.approval }, referenced.approval.getSnapshot());
  const referencedHtml = approvalUi({ model: referencedModel, role: "owner", onRefresh() {}, onCreate() {}, onRevoke() {} });
  assert.match(referencedHtml, /草稿正文提到附图或附图说明/);
});
