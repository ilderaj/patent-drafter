import assert from "node:assert/strict";
import test from "node:test";
import { register } from "tsx/esm/api";
import { unzipSync } from "fflate";
import { PDFDocument } from "pdf-lib";

register();

const [exportAdapter, exportPackage, v624] = await Promise.all([
  import("../../../../apps/web/src/v6/features/delivery/export-adapter.ts"),
  import("../../../../packages/export/src/index.ts"),
  import("../V6-24/harness.mjs"),
]);

const PNG_1PX = Uint8Array.from(Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
));
const PASS_PHRASE = "synthetic-v6-25-passphrase";

const renderReport = async () => [PNG_1PX];

test("V6-25-A01 / S08-A02: current local export downloads bytes matching its manifest", async () => {
  const fixture = await v624.makeApprovalFixture();
  await v624.addFullReadConfirmation(fixture);
  let checklistSpec = null;
  const session = new exportAdapter.ExportSession({
    ...v624.approvalProps(fixture, { confirmationMode: "self_read" }),
    access: "local_unmetered",
    route: "cn_invention",
    passphrase: PASS_PHRASE,
    now: () => v624.T0,
    renderReport: async (spec) => { checklistSpec = spec; return [PNG_1PX]; },
  });
  await session.load();
  const created = await session.createExport();
  assert.equal(created.ok, true, created.ok ? "" : JSON.stringify(created.error));
  assert.equal(created.record.manifest.searchState, "not_searched");
  assert.equal(created.record.manifest.packageKind, "preparation");
  assert.equal(created.record.manifest.testOutput, undefined, "ordinary exports do not force a false test-output marker");
  assert.equal(created.record.manifest.snapshot.draftRevisionId, fixture.checkResult.checkRun.snapshot.draftRevisionId);
  assert.equal(created.record.manifest.astHash, fixture.session.getSnapshot().revision.revision.astHash);
  assert.equal(created.record.manifest.figureSetHash, fixture.figureRevision.hash);
  assert.equal(created.record.manifest.rulePackVersion, "synthetic-rules-v1");
  assert.equal(created.record.manifest.checkRunId, fixture.checkResult.checkRun.id);
  assert.equal(created.record.manifest.approvalId, null);
  assert.ok(created.record.manifest.confirmationIds.length > 0);
  assert.match(created.record.manifest.createdAt, /^\d{4}-\d{2}-\d{2}T/);

  const byName = new Map(created.record.files.map((file) => [file.name, file]));
  for (const name of ["权利要求书.docx", "说明书.docx", "说明书摘要.docx", "提交检查清单.pdf", "项目备份.patentpack", "合成附图.png", "导出清单.json"]) {
    assert.ok(byName.has(name), `missing ${name}`);
  }
  assert.equal(created.record.manifest.files.length, 6, "six generated artifacts are hashed in manifest.files");
  assert.equal(created.record.files.length, 7, "manifest sidecar adds one separately hashed view");
  assert.equal(byName.get("合成附图.png").mime, "image/png", "original figure bytes keep their image MIME type");
  assert.equal(byName.get("合成附图.png").sha256, fixture.imported.data.asset.sha256, "standalone figure bytes equal the stored original digest");
  assert.ok(checklistSpec, "the checklist renderer received a real page spec");
  const checklistText = JSON.stringify(checklistSpec);
  assert.match(checklistSpec.title, /申请准备材料/);
  assert.match(checklistText, /一种合成温控装置/);
  assert.match(checklistText, /检索状态：未检索/);
  assert.match(checklistText, /风险 ID/);
  assert.match(checklistText, /内容确认 ID/);
  const prePdf = created.record.manifest.files.filter((file) => file.name !== "提交检查清单.pdf" && file.name !== "项目备份.patentpack");
  assert.ok(prePdf.every((file) => checklistText.includes(file.sha256)), "the checklist names each pre-PDF artifact hash");
  assert.equal(created.record.files.some((file) => file.name.endsWith(".xml")), false);
  for (const entry of created.record.manifest.files) {
    const file = byName.get(entry.name);
    assert.ok(file, `manifest names absent file ${entry.name}`);
    const downloaded = await session.download(file.id);
    assert.equal(downloaded.ok, true, downloaded.ok ? "" : JSON.stringify(downloaded.error));
    assert.equal(downloaded.bytes.byteLength, entry.bytes);
    assert.equal(await v624.modules.repositoryModule.sha256Hex(downloaded.bytes), entry.sha256);
  }

  const claims = byName.get("权利要求书.docx");
  const downloadedClaims = await session.download(claims.id);
  const document = new TextDecoder().decode(unzipSync(downloadedClaims.bytes)["word/document.xml"]);
  assert.match(document, /一种合成温控装置/);
  assert.doesNotMatch(document, /测试输出，仅用于验证流程，不能作为正式申请材料/);
  const checklistFile = byName.get("提交检查清单.pdf");
  const downloadedChecklist = await session.download(checklistFile.id);
  assert.equal(downloadedChecklist.ok, true);
  const ordinaryPdf = await PDFDocument.load(downloadedChecklist.bytes);
  assert.doesNotMatch(`${ordinaryPdf.getTitle() ?? ""} ${ordinaryPdf.getSubject() ?? ""}`, /测试输出，仅用于验证流程，不能作为正式申请材料/);

  const pack = await session.download(byName.get("项目备份.patentpack").id);
  assert.equal(pack.ok, true);
  const unpacked = await exportPackage.openPatentPack(pack.bytes, PASS_PHRASE);
  assert.equal(unpacked.schemaVersion, "patentpack.v1");
  assert.equal(unpacked.snapshot.project.name, "合成测试案件");
  assert.equal(unpacked.manifest.schemaVersion, "export.v1");
  assert.equal(unpacked.manifest.searchState, "not_searched");
  assert.equal(unpacked.manifest.files.length, 5, "embedded manifest cannot include its own container; standalone manifest adds it");
  assert.ok(unpacked.figures[0].sha256);
  assert.equal(unpacked.figures[0].originalName, "合成附图.png");
  const original = await fixture.repository.readBlob(v624.ACTOR, fixture.imported.data.asset.id);
  assert.equal(original.ok, true);
  const packedOriginal = new Uint8Array(Buffer.from(unpacked.figures[0].base64, "base64"));
  assert.deepEqual(packedOriginal, original.data.data.bytes, "patentpack retains the original figure bytes");

  const events = await fixture.repository.listEvents(v624.ACTOR, v624.MATTER_ID);
  assert.equal(events.ok, true);
  assert.equal(events.data.items.filter((event) => event.action === "export.created").length, 1);
});

test("test-output export keeps its provenance in the manifest, checklist and generated filenames", async () => {
  const fixture = await v624.makeApprovalFixture();
  await v624.addFullReadConfirmation(fixture);
  const baseRead = await fixture.revisions.loadHeadRevision(v624.MATTER_ID, v624.TARGET_ID);
  assert.equal(baseRead.ok, true);
  const revisions = {
    ...fixture.revisions,
    async loadHeadRevision(matterId, targetId) {
      const loaded = await fixture.revisions.loadHeadRevision(matterId, targetId);
      if (!loaded.ok || loaded.data === null) return loaded;
      const revision = { ...loaded.data.revision, testOutput: true };
      return { ...loaded, data: { ...loaded.data, revision } };
    },
  };
  let checklistSpec = null;
  const session = new exportAdapter.ExportSession({
    ...v624.approvalProps(fixture, { confirmationMode: "self_read", revisions }),
    access: "local_unmetered",
    route: "cn_invention",
    passphrase: PASS_PHRASE,
    now: () => v624.T0,
    renderReport: async (spec) => { checklistSpec = spec; return [PNG_1PX]; },
  });
  await session.load();
  assert.equal(session.getSnapshot().testOutput, true);
  const created = await session.createExport();
  assert.equal(created.ok, true, created.ok ? "" : JSON.stringify(created.error));
  assert.equal(created.record.manifest.testOutput, true);
  assert.match(JSON.stringify(checklistSpec), /测试输出，仅用于验证流程，不能作为正式申请材料/);
  const marker = "测试输出，仅用于验证流程，不能作为正式申请材料";
  const claimsFile = created.record.files.find((file) => file.name === "测试输出-权利要求书.docx");
  assert.ok(claimsFile);
  const claimsBytes = await session.download(claimsFile.id);
  assert.equal(claimsBytes.ok, true, claimsBytes.ok ? "" : JSON.stringify(claimsBytes.error));
  const claimsXml = new TextDecoder().decode(unzipSync(claimsBytes.bytes)["word/document.xml"]);
  assert.match(claimsXml, new RegExp(marker));
  assert.ok(claimsXml.indexOf(marker) < claimsXml.indexOf("权利要求书"), "the marker is the first DOCX paragraph");
  const pdfFile = created.record.files.find((file) => file.name === "测试输出-提交检查清单.pdf");
  assert.ok(pdfFile);
  const pdfBytes = await session.download(pdfFile.id);
  assert.equal(pdfBytes.ok, true, pdfBytes.ok ? "" : JSON.stringify(pdfBytes.error));
  const pdf = await PDFDocument.load(pdfBytes.bytes);
  assert.match(`${pdf.getTitle() ?? ""} ${pdf.getSubject() ?? ""}`, new RegExp(marker));
  assert.ok(created.record.files.some((file) => file.name === "测试输出-权利要求书.docx"));
  assert.ok(created.record.files.some((file) => file.name === "测试输出-提交检查清单.pdf"));
});

test("V6-25-A02 / S08-A01: missing figure bytes block export and XML stays unavailable", async () => {
  const fixture = await v624.makeApprovalFixture();
  await v624.addFullReadConfirmation(fixture);
  await fixture.backend.transaction("readwrite", (tx) =>
    tx.delete(v624.modules.repositoryModule.STORES.blobs, fixture.imported.data.asset.id));
  const session = new exportAdapter.ExportSession({
    ...v624.approvalProps(fixture, { confirmationMode: "self_read" }),
    access: "local_unmetered",
    route: "cn_invention",
    passphrase: PASS_PHRASE,
    now: () => v624.T0,
    renderReport,
  });
  await session.load();
  assert.ok(session.getSnapshot().gate.reasons.some((reason) => reason.code === "MISSING_BYTES"));
  assert.equal(session.getSnapshot().unavailableFormats[0].code, "FORMAT_UNAVAILABLE");
  assert.match(session.getSnapshot().unavailableFormats[0].reason, /G-XML/);
  assert.equal(session.getSnapshot().files.some((file) => file.name.endsWith(".xml")), false);
  const refused = await session.createExport();
  assert.equal(refused.ok, false);
  assert.equal(refused.error.code, "GATE_BLOCKED");
  assert.ok(refused.error.reasons.some((reason) => reason.code === "MISSING_BYTES"));
  const events = await fixture.repository.listEvents(v624.ACTOR, v624.MATTER_ID);
  assert.equal(events.data.items.filter((event) => event.action === "export.created").length, 0);
});

test("V6-25-A02 / S08-A03: old files remain visible as stale and cannot be downloaded", async () => {
  const fixture = await v624.makeApprovalFixture();
  await v624.addFullReadConfirmation(fixture);
  const session = new exportAdapter.ExportSession({
    ...v624.approvalProps(fixture, { confirmationMode: "self_read" }),
    access: "local_unmetered",
    route: "cn_invention",
    passphrase: PASS_PHRASE,
    now: () => v624.T0,
    renderReport,
  });
  const created = await session.createExport();
  assert.equal(created.ok, true, created.ok ? "" : JSON.stringify(created.error));
  const file = created.record.files.find((item) => item.name === "权利要求书.docx");
  const loaded = await fixture.repository.loadMatter(v624.ACTOR, v624.MATTER_ID);
  const aggregate = loaded.data.data;
  const changed = await fixture.repository.commit(v624.ACTOR, {
    contractVersion: v624.modules.repositoryModule.CONTRACT_VERSION,
    expectedVersion: aggregate.matter.version,
    payload: {
      matter: { ...aggregate.matter, sourceVersion: aggregate.matter.sourceVersion + 1, version: aggregate.matter.version + 1, updatedAt: "2026-11-05T12:01:00.000Z" },
      targets: aggregate.targets,
      assets: aggregate.assets,
      events: [],
      blobs: [],
    },
  }, { requestId: "abababab-abab-4bab-8bab-000000000025" });
  assert.equal(changed.ok, true, changed.ok ? "" : JSON.stringify(changed.error));

  await session.refresh();
  assert.equal(session.getSnapshot().phase, "stale");
  assert.equal(session.getSnapshot().record.manifest.exportId, created.record.manifest.exportId);
  assert.equal(session.getSnapshot().files.find((item) => item.id === file.id).status, "unavailable");
  assert.ok(session.getSnapshot().files.find((item) => item.id === file.id).unavailableReasons.some((reason) => reason.code === "STALE_BINDING"));
  const refused = await session.download(file.id);
  assert.equal(refused.ok, false);
  assert.equal(refused.error.code, "STALE_BINDING");
  const events = await fixture.repository.listEvents(v624.ACTOR, v624.MATTER_ID);
  assert.equal(events.data.items.filter((event) => event.action === "export.created").length, 1);
});

test("S08-A03: an approved r4 export becomes STALE_BINDING after r5 while the record and invalid approval remain visible", async () => {
  const fixture = await v624.makeApprovalFixture();
  const approval = await fixture.session.createApproval("合成 r4 内部批准");
  assert.equal(approval.ok, true, approval.ok ? "" : JSON.stringify(approval.error));
  const session = new exportAdapter.ExportSession({
    ...v624.approvalProps(fixture, { confirmationMode: "professional_paragraphs" }),
    access: "local_unmetered",
    route: "cn_invention",
    passphrase: PASS_PHRASE,
    now: () => v624.T0,
    renderReport,
  });
  const created = await session.createExport();
  assert.equal(created.ok, true, created.ok ? "" : JSON.stringify(created.error));
  const file = created.record.files.find((item) => item.name === "权利要求书.docx");

  const loaded = await fixture.repository.loadMatter(v624.ACTOR, v624.MATTER_ID);
  const aggregate = loaded.data.data;
  const changed = await fixture.repository.commit(v624.ACTOR, {
    contractVersion: v624.modules.repositoryModule.CONTRACT_VERSION,
    expectedVersion: aggregate.matter.version,
    payload: {
      matter: { ...aggregate.matter, sourceVersion: aggregate.matter.sourceVersion + 1, version: aggregate.matter.version + 1, updatedAt: "2026-11-05T12:02:00.000Z" },
      targets: aggregate.targets,
      assets: aggregate.assets,
      events: [],
      blobs: [],
    },
  }, { requestId: "abababab-abab-4bab-8bab-000000000026" });
  assert.equal(changed.ok, true, changed.ok ? "" : JSON.stringify(changed.error));

  await fixture.session.refresh();
  const approvalDecision = fixture.session.getGateDecisionForRecord(approval.approval);
  assert.equal(approvalDecision.allowed, false);
  assert.ok(approvalDecision.reasons.some((reason) => reason.code === "STALE_BINDING"));
  await session.refresh();
  assert.equal(session.getSnapshot().phase, "stale");
  assert.equal(session.getSnapshot().record.manifest.exportId, created.record.manifest.exportId);
  const refused = await session.download(file.id);
  assert.equal(refused.ok, false);
  assert.equal(refused.error.code, "STALE_BINDING");
  const events = await fixture.repository.listEvents(v624.ACTOR, v624.MATTER_ID);
  assert.equal(events.data.items.filter((event) => event.action === "export.created").length, 1);
});

test("V6-25-A03: refresh and retry reuse the same manifest, bytes and one export event", async () => {
  const fixture = await v624.makeApprovalFixture();
  await v624.addFullReadConfirmation(fixture);
  const session = new exportAdapter.ExportSession({
    ...v624.approvalProps(fixture, { confirmationMode: "self_read" }),
    access: "local_unmetered",
    route: "cn_invention",
    passphrase: PASS_PHRASE,
    now: () => v624.T0,
    renderReport,
  });
  const first = await session.createExport();
  assert.equal(first.ok, true, first.ok ? "" : JSON.stringify(first.error));
  await session.refresh();
  const versionAfterFirst = (await fixture.repository.loadMatter(v624.ACTOR, v624.MATTER_ID)).data.version;
  const retry = await session.createExport();
  assert.equal(retry.ok, true, retry.ok ? "" : JSON.stringify(retry.error));
  assert.equal(retry.replayed, true);
  assert.deepEqual(retry.record.manifest, first.record.manifest);
  for (const file of first.record.files) {
    const replayed = await session.download(file.id);
    assert.equal(replayed.ok, true, replayed.ok ? "" : JSON.stringify(replayed.error));
    assert.deepEqual(replayed.bytes, (await session.download(file.id)).bytes);
  }
  const events = await fixture.repository.listEvents(v624.ACTOR, v624.MATTER_ID);
  assert.equal(events.data.items.filter((event) => event.action === "export.created").length, 1);
  assert.equal((await fixture.repository.loadMatter(v624.ACTOR, v624.MATTER_ID)).data.version, versionAfterFirst);
});

test("V6-25-A03 / S08 cache expires after seven days and regenerates the same snapshot", async () => {
  const fixture = await v624.makeApprovalFixture();
  await v624.addFullReadConfirmation(fixture);
  let now = v624.T0;
  const session = new exportAdapter.ExportSession({
    ...v624.approvalProps(fixture, { confirmationMode: "self_read" }),
    access: "local_unmetered",
    route: "cn_invention",
    passphrase: PASS_PHRASE,
    now: () => now,
    renderReport,
  });
  const first = await session.createExport();
  assert.equal(first.ok, true, first.ok ? "" : JSON.stringify(first.error));
  const firstDocx = await session.download(first.record.files.find((file) => file.name === "权利要求书.docx").id);
  assert.equal(firstDocx.ok, true);
  now = "2026-11-13T12:00:00.000Z";
  await session.refresh();
  assert.equal(session.getSnapshot().phase, "stale");
  assert.ok(session.getSnapshot().files.length > 0);
  assert.ok(session.getSnapshot().files.every((file) => file.status === "unavailable"));
  assert.ok(session.getSnapshot().files.some((file) => file.unavailableReasons.some((reason) => reason.code === "CACHE_EXPIRED")));
  const oldDownload = await session.download(firstDocx.file.id);
  assert.equal(oldDownload.ok, false);
  assert.equal(oldDownload.error.code, "CACHE_EXPIRED");

  const regenerated = await session.createExport();
  assert.equal(regenerated.ok, true, regenerated.ok ? "" : JSON.stringify(regenerated.error));
  assert.notEqual(regenerated.record.manifest.exportId, first.record.manifest.exportId);
  assert.equal(regenerated.record.manifest.snapshot.draftRevisionId, first.record.manifest.snapshot.draftRevisionId);
  assert.equal(regenerated.record.manifest.createdAt, now);
  const newDocx = await session.download(regenerated.record.files.find((file) => file.name === "权利要求书.docx").id);
  assert.equal(newDocx.ok, true);
  assert.deepEqual(newDocx.bytes, firstDocx.bytes, "same snapshot yields deterministic DOCX bytes");
  const newPack = await session.download(regenerated.record.files.find((file) => file.name === "项目备份.patentpack").id);
  const oldPack = await first.record.files.find((file) => file.name === "项目备份.patentpack");
  assert.ok(newPack.ok && oldPack);
  assert.notEqual(regenerated.record.manifest.files.find((file) => file.name === "项目备份.patentpack").sha256,
    first.record.manifest.files.find((file) => file.name === "项目备份.patentpack").sha256,
    "fresh encryption and manifest timestamp produce a new patentpack");
  const events = await fixture.repository.listEvents(v624.ACTOR, v624.MATTER_ID);
  assert.equal(events.data.items.filter((event) => event.action === "export.created").length, 2);
  await session.refresh();
  assert.equal(session.getSnapshot().phase, "ready");
  assert.ok(session.getSnapshot().files.every((file) => file.status === "ready"));
  const replay = await session.createExport();
  assert.equal(replay.ok, true, replay.ok ? "" : JSON.stringify(replay.error));
  assert.equal(replay.replayed, true);
  assert.equal(replay.record.manifest.exportId, regenerated.record.manifest.exportId);
  const finalEvents = await fixture.repository.listEvents(v624.ACTOR, v624.MATTER_ID);
  assert.equal(finalEvents.data.items.filter((event) => event.action === "export.created").length, 2);
});

test("V6-25-A03: every regenerated generation expires on its own seven-day clock", async () => {
  const fixture = await v624.makeApprovalFixture();
  await v624.addFullReadConfirmation(fixture);
  let now = v624.T0;
  const session = new exportAdapter.ExportSession({
    ...v624.approvalProps(fixture, { confirmationMode: "self_read" }),
    access: "local_unmetered",
    route: "cn_invention",
    passphrase: PASS_PHRASE,
    now: () => now,
    renderReport,
  });
  const gen0 = await session.createExport();
  assert.equal(gen0.ok, true, gen0.ok ? "" : JSON.stringify(gen0.error));
  now = "2026-11-13T12:00:00.000Z";
  await session.refresh();
  assert.equal(session.getSnapshot().phase, "stale");
  const gen1 = await session.createExport();
  assert.equal(gen1.ok, true, gen1.ok ? "" : JSON.stringify(gen1.error));
  assert.notEqual(gen1.record.manifest.exportId, gen0.record.manifest.exportId);

  now = "2026-11-21T12:00:00.000Z";
  await session.refresh();
  assert.equal(session.getSnapshot().phase, "stale");
  assert.equal(session.getSnapshot().record.manifest.exportId, gen1.record.manifest.exportId);
  assert.ok(session.getSnapshot().files.every((file) => file.status === "unavailable"));
  assert.ok(session.getSnapshot().files.some((file) => file.unavailableReasons.some((reason) => reason.code === "CACHE_EXPIRED")));
  const gen1File = gen1.record.files.find((file) => file.name === "权利要求书.docx");
  const oldGen1Download = await session.download(gen1File.id);
  assert.equal(oldGen1Download.ok, false);
  assert.equal(oldGen1Download.error.code, "CACHE_EXPIRED");
  const rows = await fixture.backend.transaction("readonly", (tx) => tx.getAll(v624.modules.repositoryModule.STORES.blobs));
  const gen1Row = rows.find((row) => row?.kind === "delivery.export" && row.manifest?.exportId === gen1.record.manifest.exportId);
  assert.ok(gen1Row, "generation 1 row persists for audit");
  assert.equal(gen1Row.state, "expired");
  assert.ok(gen1Row.files.every((file) => file.data.byteLength === 0), "generation 1 cached file bytes are discarded");
  assert.equal(gen1Row.manifestBytes.byteLength, 0, "generation 1 cached manifest bytes are discarded");
  assert.ok(gen1Row.manifestBytesLength > 0, "generation 1 manifest metadata length remains visible");

  const gen2 = await session.createExport();
  assert.equal(gen2.ok, true, gen2.ok ? "" : JSON.stringify(gen2.error));
  assert.notEqual(gen2.record.manifest.exportId, gen1.record.manifest.exportId);
  assert.equal(gen2.record.manifest.createdAt, now);
  const gen2File = gen2.record.files.find((file) => file.name === "权利要求书.docx");
  const gen2Download = await session.download(gen2File.id);
  assert.equal(gen2Download.ok, true, gen2Download.ok ? "" : JSON.stringify(gen2Download.error));
  const events = await fixture.repository.listEvents(v624.ACTOR, v624.MATTER_ID);
  assert.equal(events.data.items.filter((event) => event.action === "export.created").length, 3);
});

test("V6-25-A03: a stale-snapshot export also expires and is purged at seven days", async () => {
  const fixture = await v624.makeApprovalFixture();
  await v624.addFullReadConfirmation(fixture);
  let now = v624.T0;
  const session = new exportAdapter.ExportSession({
    ...v624.approvalProps(fixture, { confirmationMode: "self_read" }),
    access: "local_unmetered",
    route: "cn_invention",
    passphrase: PASS_PHRASE,
    now: () => now,
    renderReport,
  });
  const created = await session.createExport();
  assert.equal(created.ok, true, created.ok ? "" : JSON.stringify(created.error));
  const claims = created.record.files.find((file) => file.name === "权利要求书.docx");

  const loaded = await fixture.repository.loadMatter(v624.ACTOR, v624.MATTER_ID);
  const aggregate = loaded.data.data;
  const changed = await fixture.repository.commit(v624.ACTOR, {
    contractVersion: v624.modules.repositoryModule.CONTRACT_VERSION,
    expectedVersion: aggregate.matter.version,
    payload: {
      matter: { ...aggregate.matter, sourceVersion: aggregate.matter.sourceVersion + 1, version: aggregate.matter.version + 1, updatedAt: "2026-11-05T12:01:00.000Z" },
      targets: aggregate.targets,
      assets: aggregate.assets,
      events: [],
      blobs: [],
    },
  }, { requestId: "abababab-abab-4bab-8bab-000000000030" });
  assert.equal(changed.ok, true, changed.ok ? "" : JSON.stringify(changed.error));

  now = "2026-11-13T12:00:00.000Z";
  await session.refresh();
  assert.equal(session.getSnapshot().phase, "stale");
  assert.equal(session.getSnapshot().record.manifest.exportId, created.record.manifest.exportId);
  assert.ok(session.getSnapshot().files.every((file) => file.status === "unavailable"));
  assert.ok(session.getSnapshot().files.some((file) => file.unavailableReasons.some((reason) => reason.code === "CACHE_EXPIRED")));
  assert.ok(session.getSnapshot().files.some((file) => file.unavailableReasons.some((reason) => reason.code === "STALE_BINDING")));
  const refused = await session.download(claims.id);
  assert.equal(refused.ok, false);
  assert.ok(refused.error.code === "CACHE_EXPIRED" || refused.error.code === "STALE_BINDING");
  const rows = await fixture.backend.transaction("readonly", (tx) => tx.getAll(v624.modules.repositoryModule.STORES.blobs));
  const stored = rows.find((row) => row?.kind === "delivery.export" && row.manifest?.exportId === created.record.manifest.exportId);
  assert.ok(stored, "stale export row still exists for audit");
  assert.equal(stored.state, "expired");
  assert.ok(stored.files.every((file) => file.data.byteLength === 0), "stale export cached file bytes are discarded");
  assert.equal(stored.manifestBytes.byteLength, 0, "stale export cached manifest bytes are discarded");
});

test("V6-25-A03: failed export.created commit never refreshes as ready and retry completes once", async () => {
  const fixture = await v624.makeApprovalFixture();
  await v624.addFullReadConfirmation(fixture);
  const originalCommit = fixture.repository.commit.bind(fixture.repository);
  let failExportEvent = true;
  fixture.repository.commit = async (actor, command, options) => {
    if (failExportEvent && command.payload.events.some((event) => event.action === "export.created")) {
      return { ok: false, error: { code: "STORAGE_UNAVAILABLE", message: "synthetic export event write failure" } };
    }
    return originalCommit(actor, command, options);
  };
  const session = new exportAdapter.ExportSession({
    ...v624.approvalProps(fixture, { confirmationMode: "self_read" }),
    access: "local_unmetered",
    route: "cn_invention",
    passphrase: PASS_PHRASE,
    now: () => v624.T0,
    renderReport,
  });
  const failed = await session.createExport();
  assert.equal(failed.ok, false);
  assert.equal(failed.error.code, "STORAGE_UNAVAILABLE");
  await session.refresh();
  assert.equal(session.getSnapshot().phase, "error");
  assert.notEqual(session.getSnapshot().phase, "ready");
  assert.equal(session.getSnapshot().files.length, 0);
  assert.match(session.getSnapshot().error.message, /synthetic export event write failure/);
  const rows = await fixture.backend.transaction("readonly", (tx) => tx.getAll(v624.modules.repositoryModule.STORES.blobs));
  const exportRows = rows.filter((row) => row?.kind === "delivery.export");
  assert.equal(exportRows.length, 1);
  assert.equal(exportRows[0].state, "failed");
  assert.match(exportRows[0].failureMessage, /synthetic export event write failure/);
  let events = await fixture.repository.listEvents(v624.ACTOR, v624.MATTER_ID);
  assert.equal(events.data.items.filter((event) => event.action === "export.created").length, 0);

  failExportEvent = false;
  const retried = await session.createExport();
  assert.equal(retried.ok, true, retried.ok ? "" : JSON.stringify(retried.error));
  assert.equal(retried.record.manifest.exportId, exportRows[0].manifest.exportId);
  await session.refresh();
  assert.equal(session.getSnapshot().phase, "ready");
  assert.ok(session.getSnapshot().files.every((file) => file.status === "ready"));
  events = await fixture.repository.listEvents(v624.ACTOR, v624.MATTER_ID);
  assert.equal(events.data.items.filter((event) => event.action === "export.created").length, 1);
});

test("preparation export reports every unmet prerequisite and writes no export event", async () => {
  const fixture = await v624.makeApprovalFixture();
  const session = new exportAdapter.ExportSession({
    ...v624.approvalProps(fixture, { confirmationMode: "self_read" }),
    access: "local_unmetered",
    route: "cn_invention",
    passphrase: PASS_PHRASE,
    now: () => v624.T0,
    renderReport,
  });
  await session.load();
  assert.equal(session.getSnapshot().phase, "blocked");
  assert.ok(session.getSnapshot().gate.reasons.some((reason) => reason.code === "CONFIRMATION_REQUIRED"));
  assert.equal(session.getSnapshot().files.length, 0, "blocked export shows no file placeholders");
  const refused = await session.createExport();
  assert.equal(refused.ok, false);
  assert.equal(refused.error.code, "GATE_BLOCKED");
  const events = await fixture.repository.listEvents(v624.ACTOR, v624.MATTER_ID);
  assert.equal(events.data.items.filter((event) => event.action === "export.created").length, 0);
});

test("a required risk acknowledgement gates export until a current risk_ack exists", async () => {
  const fixture = await v624.makeApprovalFixture({ withConflict: true });
  await v624.addFullReadConfirmation(fixture);
  const risk = fixture.checkResult.checkRun.findings.find((finding) => finding.requiresAcknowledgement);
  assert.ok(risk, "synthetic open conflict produced an acknowledgement-required risk");
  const options = {
    ...v624.approvalProps(fixture, { confirmationMode: "self_read" }),
    access: "local_unmetered",
    route: "cn_invention",
    passphrase: PASS_PHRASE,
    now: () => v624.T0,
    renderReport,
  };
  const blocked = new exportAdapter.ExportSession(options);
  await blocked.load();
  assert.ok(blocked.getSnapshot().gate.reasons.some((reason) => reason.code === "CONFIRMATION_REQUIRED" && reason.resourceId === risk.id));
  assert.equal((await blocked.createExport()).ok, false);

  await v624.acknowledgeRisk(fixture, risk.id);
  const allowed = new exportAdapter.ExportSession(options);
  const created = await allowed.createExport();
  assert.equal(created.ok, true, created.ok ? "" : JSON.stringify(created.error));
  assert.ok(created.record.manifest.riskIds.includes(risk.id));
});

test("a stale check run blocks export with CHECK_REQUIRED", async () => {
  const fixture = await v624.makeApprovalFixture();
  await v624.addFullReadConfirmation(fixture);
  const session = new exportAdapter.ExportSession({
    ...v624.approvalProps(fixture, { confirmationMode: "self_read" }),
    access: "local_unmetered",
    route: "cn_invention",
    activeRulePackVersion: "synthetic-rules-v2",
    passphrase: PASS_PHRASE,
    now: () => v624.T0,
    renderReport,
  });
  await session.load();
  assert.ok(session.getSnapshot().gate.reasons.some((reason) => reason.code === "CHECK_REQUIRED"));
  const refused = await session.createExport();
  assert.equal(refused.ok, false);
  assert.equal(refused.error.code, "GATE_BLOCKED");
});

test("a build failure is persisted once, shown without fake files, and not repeated as an event", async () => {
  const fixture = await v624.makeApprovalFixture();
  await v624.addFullReadConfirmation(fixture);
  const session = new exportAdapter.ExportSession({
    ...v624.approvalProps(fixture, { confirmationMode: "self_read" }),
    access: "local_unmetered",
    route: "cn_invention",
    passphrase: PASS_PHRASE,
    now: () => v624.T0,
  });
  const first = await session.createExport();
  assert.equal(first.ok, false);
  assert.equal(first.error.code, "STORAGE_UNAVAILABLE");
  await session.refresh();
  assert.equal(session.getSnapshot().phase, "error");
  assert.equal(session.getSnapshot().files.length, 0);
  assert.equal(session.getSnapshot().error.code, "STORAGE_UNAVAILABLE");
  const retry = await session.createExport();
  assert.equal(retry.ok, false);
  assert.equal(retry.error.code, "STORAGE_UNAVAILABLE");
  let events = await fixture.repository.listEvents(v624.ACTOR, v624.MATTER_ID);
  assert.equal(events.data.items.filter((event) => event.action === "export.created").length, 0);

  const recoveredSession = new exportAdapter.ExportSession({
    ...v624.approvalProps(fixture, { confirmationMode: "self_read" }),
    access: "local_unmetered",
    route: "cn_invention",
    passphrase: PASS_PHRASE,
    now: () => v624.T0,
    renderReport,
  });
  const recovered = await recoveredSession.createExport();
  assert.equal(recovered.ok, true, recovered.ok ? "" : JSON.stringify(recovered.error));
  events = await fixture.repository.listEvents(v624.ACTOR, v624.MATTER_ID);
  assert.equal(events.data.items.filter((event) => event.action === "export.created").length, 1);
});

test("a viewer role cannot export even when content prerequisites are met", async () => {
  const fixture = await v624.makeApprovalFixture();
  await v624.addFullReadConfirmation(fixture);
  const session = new exportAdapter.ExportSession({
    ...v624.approvalProps(fixture, { confirmationMode: "self_read", role: "viewer" }),
    access: "local_unmetered",
    route: "cn_invention",
    passphrase: PASS_PHRASE,
    now: () => v624.T0,
    renderReport,
  });
  await session.load();
  assert.ok(session.getSnapshot().gate.reasons.some((reason) => reason.code === "ACTION_FORBIDDEN"));
  const refused = await session.createExport();
  assert.equal(refused.ok, false);
  assert.equal(refused.error.code, "GATE_BLOCKED");
});

test("professional export requires a live internal approval", async () => {
  const fixture = await v624.makeApprovalFixture();
  const session = new exportAdapter.ExportSession({
    ...v624.approvalProps(fixture, { confirmationMode: "professional_paragraphs" }),
    access: "local_unmetered",
    route: "cn_invention",
    passphrase: PASS_PHRASE,
    now: () => v624.T0,
    renderReport,
  });
  const refused = await session.createExport();
  assert.equal(refused.ok, false);
  assert.ok(refused.error.reasons.some((reason) => reason.code === "APPROVAL_REQUIRED"));
  const approval = await fixture.session.createApproval("合成内部批准");
  assert.equal(approval.ok, true, approval.ok ? "" : JSON.stringify(approval.error));
  const created = await session.createExport();
  assert.equal(created.ok, true, created.ok ? "" : JSON.stringify(created.error));
  assert.equal(created.record.manifest.packageKind, "internally_approved");
  assert.equal(created.record.manifest.approvalId, approval.approval.id);
});
