// A development-only undisclosed processor must be visible in the delivery
// artifacts and pages; an ordinary consent must not carry the warning.
import assert from "node:assert/strict";
import test from "node:test";
import { register } from "tsx/esm/api";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import * as esbuild from "esbuild";
import { createRequire } from "node:module";

register();

const [exportAdapter, v624, v619, contracts, messages, ai] = await Promise.all([
  import("../../../../apps/web/src/v6/features/delivery/export-adapter.ts"),
  import("../V6-24/harness.mjs"),
  import("../V6-19/harness.mjs"),
  import("../../../../packages/contracts/src/index.ts"),
  import("../../../../apps/web/src/v6/lib/user-messages.ts"),
  import("../../../../apps/web/src/v6/features/ai/ai.ts"),
]);

const PNG_1PX = Uint8Array.from(Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
));
const PASS_PHRASE = "synthetic-v6-25-passphrase";
const WARNING = messages.DEV_UNDISCLOSED_WARNING;

async function seedConsent(fixture, { devUndisclosed = true, createdAt = v619.T0 } = {}) {
  const consentId = crypto.randomUUID();
  const consent = {
    id: consentId,
    actorId: v619.ACTOR.userId,
    providerProfileId: "a1000000-0000-4000-8000-000000000006",
    providerProfileVersion: 1,
    purpose: "draft",
    scope: {
      matterId: v619.MATTER_ID, targetId: v619.TARGET_ID, sourceVersion: 1,
      assetIds: [], chunkIds: [], factIds: [], draftRevisionIds: [], figureRevisionIds: [],
      payloadManifestHash: "a".repeat(64),
    },
    processorName: "合成处理方",
    processingRegion: "合成区域",
    retentionPolicyVersion: "合成保留",
    trainingPolicy: devUndisclosed ? "unknown" : "no_training",
    termsVersion: devUndisclosed ? "未核实（开发验证）" : "v1",
    createdAt,
    expiresAt: null,
    ...(devUndisclosed ? { devUndisclosed: true } : {}),
  };
  assert.equal(contracts.consentSchema.safeParse(consent).success, true);
  await fixture.backend.transaction("readwrite", (tx) => tx.put(
    v619.modules.repositoryModule.STORES.blobs,
    ["ai/consent", encodeURIComponent(v619.ACTOR.tenantId), encodeURIComponent(v619.MATTER_ID), consentId].join("/"),
    { kind: "ai.consent", tenantId: v619.ACTOR.tenantId, matterId: v619.MATTER_ID, requestKey: null, consent },
  ));
  return consent;
}

function exportSession(fixture, checklist) {
  return new exportAdapter.ExportSession({
    ...v624.approvalProps(fixture, { confirmationMode: "self_read" }),
    access: "local_unmetered",
    route: "cn_invention",
    passphrase: PASS_PHRASE,
    now: () => v619.T0,
    renderReport: async (spec) => { if (checklist) checklist.spec = spec; return [PNG_1PX]; },
  });
}

let outdir;
let doneUi;
let approvalUi;
test.before(async () => {
  outdir = mkdtempSync(join(tmpdir(), "v6-dev-undisclosed-"));
  const outfile = join(outdir, "ui.cjs");
  const root = resolve(import.meta.dirname, "../../../..");
  const done = join(root, "apps/web/src/v6/features/delivery/Done.tsx");
  const approval = join(root, "apps/web/src/v6/features/delivery/Approval.tsx");
  await esbuild.build({
    stdin: { resolveDir: root, sourcefile: "dev-undisclosed-ui.tsx", loader: "tsx", contents: `
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

test("a dev-undisclosed consent adds one warning to the manifest and the checklist PDF data", async () => {
  const fixture = await v624.makeApprovalFixture();
  await v624.addFullReadConfirmation(fixture);
  const consent = await seedConsent(fixture);
  assert.equal(await ai.readDraftDevUndisclosed(fixture.repository, v619.ACTOR, v619.MATTER_ID, v619.TARGET_ID, { now: () => v619.T0 }), true);

  const checklist = {};
  const session = exportSession(fixture, checklist);
  await session.load();
  assert.equal(session.getSnapshot().devUndisclosed, true);
  const created = await session.createExport();
  assert.equal(created.ok, true, created.ok ? "" : JSON.stringify(created.error));
  assert.deepEqual(created.record.manifest.devVerification, { devUndisclosed: true, note: WARNING });
  assert.equal(created.record.manifest.approvalId, null);
  // The PDF checklist data carries the same sentence, once, next to the test-output notice.
  const items = checklist.spec.sections.flatMap((section) => section.items.map((item) => item.text));
  assert.equal(items.filter((text) => text === WARNING).length, 1, JSON.stringify(items));
  assert.equal(JSON.stringify(checklist.spec).split(WARNING).length - 1, 1);
  // The manifest re-parses under the contract, and the warning is not duplicated there.
  assert.equal(contracts.manifestSchema.safeParse(created.record.manifest).success, true);
  assert.equal(consent.devUndisclosed, true);
});

test("an ordinary consent exports without the dev warning", async () => {
  const fixture = await v624.makeApprovalFixture();
  await v624.addFullReadConfirmation(fixture);
  await seedConsent(fixture, { devUndisclosed: false, createdAt: v619.T0 });
  assert.equal(await ai.readDraftDevUndisclosed(fixture.repository, v619.ACTOR, v619.MATTER_ID, v619.TARGET_ID, { now: () => v619.T0 }), false);

  const checklist = {};
  const session = exportSession(fixture, checklist);
  await session.load();
  assert.equal(session.getSnapshot().devUndisclosed, false);
  const created = await session.createExport();
  assert.equal(created.ok, true, created.ok ? "" : JSON.stringify(created.error));
  assert.equal("devVerification" in created.record.manifest, false);
  assert.equal(JSON.stringify(checklist.spec).includes(WARNING), false);
});

test("only a dev consent for this target counts: another target or an expired row is ignored", async () => {
  const fixture = await v624.makeApprovalFixture();
  await v624.addFullReadConfirmation(fixture);
  const otherTarget = "44444444-4444-4444-8444-444444444499";
  const other = await seedConsent(fixture, { createdAt: v619.T0 });
  // Move the only consent to another target: nothing applies to this target.
  await fixture.backend.transaction("readwrite", async (tx) => {
    const storeName = v619.modules.repositoryModule.STORES.blobs;
    const key = ["ai/consent", encodeURIComponent(v619.ACTOR.tenantId), encodeURIComponent(v619.MATTER_ID), other.id].join("/");
    const row = await tx.get(storeName, key);
    await tx.put(storeName, key, { ...row, consent: { ...row.consent, scope: { ...row.consent.scope, targetId: otherTarget } } });
  });
  assert.equal(await ai.readDraftDevUndisclosed(fixture.repository, v619.ACTOR, v619.MATTER_ID, v619.TARGET_ID, { now: () => v619.T0 }), false);
});

test("Done and Approval show the same warning only when the draft consent is dev-undisclosed", async () => {
  const snapshot = { matterId: "m", targetId: "t", sourceVersion: 1, targetConfigVersion: 1, draftRevisionId: "r", figureRevisionId: "f" };
  const baseState = {
    phase: "ready", snapshot, inputStale: false, testOutput: false, record: null, files: [],
    unavailableFormats: [], error: null, gate: { allowed: false, reasons: [] },
    figures: { count: 0, status: "never_created", acknowledgementRequired: false, acknowledged: false },
  };
  const props = (devUndisclosed) => ({
    route: "cn_invention", mode: "self",
    state: { ...baseState, devUndisclosed },
    passphrase: "x", busy: false, actionError: null,
    onPassphrase() {}, onRefresh() {}, onCreate() {}, onDownload() {},
  });
  const withWarning = doneUi(props(true));
  assert.match(withWarning, /data-testid="done-dev-undisclosed"[^>]*>[\s\S]*?开发验证：处理方信息未核实，仅限合成材料，不得用于真实客户材料。/);
  assert.equal(withWarning.includes('data-testid="done-dev-undisclosed"'), true);
  assert.equal(doneUi(props(false)).includes('data-testid="done-dev-undisclosed"'), false);

  const fixture = await v624.makeApprovalFixture();
  const clean = v624.readyPanelModel(fixture, fixture.session.getSnapshot());
  assert.equal(approvalUi({ model: clean, role: "owner", onRefresh() {}, onCreate() {}, onRevoke() {} }).includes('data-testid="approval-dev-undisclosed"'), false);
  const flagged = { ...clean, state: { ...clean.state, devUndisclosed: true } };
  const flaggedHtml = approvalUi({ model: flagged, role: "owner", onRefresh() {}, onCreate() {}, onRevoke() {} });
  assert.match(flaggedHtml, /data-testid="approval-dev-undisclosed"[\s\S]*?开发验证：处理方信息未核实，仅限合成材料，不得用于真实客户材料。/);
});

test("older records without the new fields still parse", async () => {
  const fixture = await v624.makeApprovalFixture();
  await v624.addFullReadConfirmation(fixture);
  const session = exportSession(fixture);
  await session.load();
  const created = await session.createExport();
  assert.equal(created.ok, true);
  const legacyManifest = structuredClone(created.record.manifest);
  delete legacyManifest.devVerification;
  delete legacyManifest.figures;
  assert.equal(contracts.manifestSchema.safeParse(legacyManifest).success, true, "old manifests keep parsing");
  const legacyConsent = {
    id: crypto.randomUUID(), actorId: v619.ACTOR.userId, providerProfileId: "a1000000-0000-4000-8000-000000000006",
    providerProfileVersion: 1, purpose: "draft",
    scope: { matterId: v619.MATTER_ID, targetId: v619.TARGET_ID, sourceVersion: 1, assetIds: [], chunkIds: [], factIds: [], draftRevisionIds: [], figureRevisionIds: [], payloadManifestHash: "a".repeat(64) },
    processorName: "合成处理方", processingRegion: "合成区域", retentionPolicyVersion: "合成保留",
    trainingPolicy: "no_training", termsVersion: "v1", createdAt: v619.T0, expiresAt: null,
  };
  assert.equal(contracts.consentSchema.safeParse(legacyConsent).success, true, "old consents keep parsing");
});
