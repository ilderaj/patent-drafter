import assert from "node:assert/strict";
import test from "node:test";
import { register } from "tsx/esm/api";

register();

const [recovery, patentpack, repoModule, contracts, drawingsModule, v624] = await Promise.all([
  import("../../../../apps/web/src/v6/features/recovery/recovery.ts"),
  import("../../../../packages/export/src/patentpack.ts"),
  import("../../../../apps/web/src/v6/lib/repository.ts"),
  import("../../../../packages/contracts/src/index.ts"),
  import("../../../../apps/web/src/v6/features/sources/drawings.ts"),
  import("../V6-24/harness.mjs"),
]);

const PASS_PHRASE = "synthetic-v6-26-recovery-passphrase";
const WRONG_PASSPHRASE = "synthetic-wrong-passphrase";

class MemoryBackend {
  constructor() {
    this.data = new Map(Object.values(repoModule.STORES).map((name) => [name, new Map()]));
    this.failPut = null;
    this.queue = Promise.resolve();
  }

  transaction(mode, run) {
    if (mode === "readwrite") {
      const next = this.queue.then(() => this.runTransaction(run));
      this.queue = next.then(() => undefined, () => undefined);
      return next;
    }
    return this.runTransaction(run);
  }

  async runTransaction(run) {
    const snapshot = new Map([...this.data].map(([name, store]) => [name, new Map(store)]));
    const store = (name) => this.data.get(name);
    const tx = {
      get: async (name, key) => {
        const value = store(name).get(key);
        return value === undefined ? undefined : structuredClone(value);
      },
      put: async (name, key, value) => {
        const fault = this.failPut?.({ store: name, key }) ?? null;
        if (fault) throw fault;
        store(name).set(key, structuredClone(value));
      },
      delete: async (name, key) => { store(name).delete(key); },
      getAll: async (name) => [...store(name).values()].map((value) => structuredClone(value)),
      getAllByIndex: async (name, index, value) =>
        [...store(name).values()].filter((row) => row?.[index] === value).map((row) => structuredClone(row)),
    };
    try {
      return await run(tx);
    } catch (error) {
      this.data = snapshot;
      throw error;
    }
  }

  close() {}

  rowCount() {
    return [...this.data.values()].reduce((total, store) => total + store.size, 0);
  }
}

function repository(backend = new MemoryBackend()) {
  return { backend, repository: repoModule.openLocalRepository(backend) };
}

async function buildSourcePackage(options = {}) {
  const source = await v624.makeApprovalFixture();
  const packed = await recovery.createRecoveryPackage(source.repository, v624.ACTOR, v624.MATTER_ID, {
    passphrase: PASS_PHRASE,
    access: options.access ?? "local_unmetered",
  });
  return { source, packed };
}

async function importInto(backend, packed) {
  const destination = repoModule.openLocalRepository(backend);
  const checked = await recovery.validateRecoveryPackage(destination, v624.ACTOR, packed, PASS_PHRASE);
  assert.equal(checked.ok, true, checked.ok ? "" : `${checked.error.code}: ${checked.error.message}`);
  return { destination, checked: checked.data };
}

/** Flip one byte inside the authenticated ciphertext, not the envelope JSON. */
function tamperCiphertextByte(packed) {
  const envelope = JSON.parse(new TextDecoder().decode(packed));
  const ciphertext = Buffer.from(envelope.ciphertext, "base64");
  assert.ok(ciphertext.byteLength > 0);
  ciphertext[0] ^= 0x01;
  envelope.ciphertext = ciphertext.toString("base64");
  return new TextEncoder().encode(JSON.stringify(envelope));
}

async function reencrypt(packageObject, passphrase = PASS_PHRASE) {
  return patentpack.buildPatentPack(packageObject, passphrase);
}

test("V6-26-A01 / S08-A06: valid encrypted recovery restores text and original figure hashes", async () => {
  const { source, packed } = await buildSourcePackage();
  const opened = await patentpack.openPatentPack(packed, PASS_PHRASE);
  assert.equal(opened.schemaVersion, "recovery.v1");
  assert.ok(opened.assetManifest.length > 0);
  assert.ok(opened.figureRefs.length > 0);
  assert.equal(opened.assetManifest.length, opened.assets.length);

  // The envelope uses the frozen PBKDF2-SHA-256 / AES-256-GCM parameters and
  // never carries plaintext document text or the passphrase.
  const envelope = JSON.parse(new TextDecoder().decode(packed));
  assert.equal(envelope.v, 1);
  assert.equal(envelope.alg, "PBKDF2-SHA256-AESGCM-200000");
  assert.equal(Buffer.from(envelope.salt, "base64").byteLength, 16);
  assert.equal(Buffer.from(envelope.iv, "base64").byteLength, 12);
  const envelopeText = new TextDecoder().decode(packed);
  assert.equal(envelopeText.includes("V6-26"), false);
  assert.equal(envelopeText.includes("一种合成温控装置"), false);
  assert.equal(envelopeText.includes(PASS_PHRASE), false);
  const second = await recovery.createRecoveryPackage(source.repository, v624.ACTOR, v624.MATTER_ID, {
    passphrase: PASS_PHRASE,
    access: "local_unmetered",
  });
  const secondEnvelope = JSON.parse(new TextDecoder().decode(second));
  assert.notEqual(secondEnvelope.salt, envelope.salt);
  assert.notEqual(secondEnvelope.iv, envelope.iv);

  const backend = new MemoryBackend();
  const { destination, checked } = await importInto(backend, packed);
  assert.equal(checked.canCommit, true);
  assert.ok(checked.report.mappingCounts.assets > 0);
  // The V6-24 synthetic source record has no stored bytes by design; the
  // report must say so. No drawing byte is missing, so the figure hashes below
  // are restored from real bytes rather than placeholders.
  assert.ok(checked.report.missingBytes.some((item) => item.assetId === "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1"));
  assert.equal(checked.report.missingBytes.filter((item) => item.assetId !== "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1").length, 0);
  const committed = await recovery.commitRecoveryImport(destination, v624.ACTOR, checked.validationId);
  assert.equal(committed.ok, true, committed.ok ? "" : `${committed.error.code}: ${committed.error.message}`);
  assert.deepEqual(committed.data.report.mappingCounts, checked.report.mappingCounts);
  const persisted = await recovery.readRecoveryValidation(destination, v624.ACTOR, checked.validationId);
  assert.equal(persisted.ok, true);
  assert.equal(persisted.data.status, "committed");
  assert.deepEqual(persisted.data.report.mappingCounts, checked.report.mappingCounts);

  const restored = await destination.loadMatter(v624.ACTOR, committed.data.matterId);
  assert.equal(restored.ok, true);
  contracts.matterSchema.parse(restored.data.data.matter);
  for (const asset of restored.data.data.assets) contracts.assetSchema.parse(asset);
  for (const target of restored.data.data.targets) contracts.targetSchema.parse(target);
  const activity = await destination.listEvents(v624.ACTOR, committed.data.matterId);
  assert.equal(activity.ok, true);
  for (const event of activity.data.items) contracts.activitySchema.parse(event);
  assert.ok(activity.data.items.some((event) => event.action === "target.created"));
  assert.notEqual(restored.data.data.matter.id, v624.MATTER_ID);
  assert.notEqual(restored.data.data.targets[0].id, v624.TARGET_ID);
  assert.ok(restored.data.data.targets[0].draftRevisionId);
  const revision = await recovery.readRecoveredDraft(destination, v624.ACTOR, committed.data.matterId, restored.data.data.targets[0].id);
  assert.equal(revision.ok, true, revision.ok ? "" : revision.error.message);
  assert.match(JSON.stringify(revision.data.ast), /一种合成温控装置/);

  const sourceDrawing = await source.repository.readBlob(v624.ACTOR, source.imported.data.asset.id);
  assert.equal(sourceDrawing.ok, true);
  const restoredDrawings = restored.data.data.assets.filter((asset) => asset.purpose === "drawing" && asset.state === "available");
  assert.equal(restoredDrawings.length, 1);
  const restoredDrawing = await destination.readBlob(v624.ACTOR, restoredDrawings[0].id);
  assert.equal(restoredDrawing.ok, true, restoredDrawing.ok ? "" : restoredDrawing.error.message);
  assert.deepEqual(restoredDrawing.data.data.bytes, sourceDrawing.data.data.bytes);
  assert.equal(restoredDrawings[0].sha256, source.imported.data.asset.sha256);
  assert.equal(await repoModule.sha256Hex(restoredDrawing.data.data.bytes), source.imported.data.asset.sha256);

  const text = JSON.stringify(restored.data.data);
  assert.equal(text.includes(v624.MATTER_ID), false);
  assert.equal(text.includes(v624.TARGET_ID), false);
  assert.equal(text.includes(source.imported.data.asset.id), false);
});

test("V6-26 preserves a test-output revision through encrypted .patentpack export and import", async () => {
  const source = await v624.makeApprovalFixture();
  const head = await source.revisions.loadHeadRevision(v624.MATTER_ID, v624.TARGET_ID);
  assert.equal(head.ok, true);
  const revisionKey = [
    "generation",
    encodeURIComponent(v624.ACTOR.tenantId),
    encodeURIComponent(v624.ACTOR.userId),
    "revision",
    encodeURIComponent(v624.MATTER_ID),
    encodeURIComponent(v624.TARGET_ID),
    encodeURIComponent(head.data.revision.id),
  ].join("/");
  await source.repository.backend.transaction("readwrite", async (tx) => {
    const row = await tx.get(repoModule.STORES.blobs, revisionKey);
    assert.ok(row?.revision);
    row.revision.testOutput = true;
    await tx.put(repoModule.STORES.blobs, revisionKey, row);
  });

  const packed = await recovery.createRecoveryPackage(source.repository, v624.ACTOR, v624.MATTER_ID, {
    passphrase: PASS_PHRASE,
    access: "local_unmetered",
  });
  const opened = await patentpack.openPatentPack(packed, PASS_PHRASE);
  const packedRevision = opened.records.find((record) => record.kind === "generation.revision"
    && record.value.revision.id === head.data.revision.id);
  assert.equal(packedRevision?.value.revision.testOutput, true);

  const destinationBackend = new MemoryBackend();
  const { destination, checked } = await importInto(destinationBackend, packed);
  assert.equal(checked.canCommit, true);
  const committed = await recovery.commitRecoveryImport(destination, v624.ACTOR, checked.validationId);
  assert.equal(committed.ok, true, committed.ok ? "" : `${committed.error.code}: ${committed.error.message}`);
  const matter = await destination.loadMatter(v624.ACTOR, committed.data.matterId);
  assert.equal(matter.ok, true);
  const target = matter.data.data.targets.find((item) => item.draftRevisionId !== null);
  assert.ok(target);
  const restored = await recovery.readRecoveredDraft(destination, v624.ACTOR, committed.data.matterId, target.id);
  assert.equal(restored.ok, true);
  assert.equal(restored.data.revision.testOutput, true);
});

test("V6-26-A01 / B1: a stable figureId across figure-set revisions validates and imports", async () => {
  const source = await v624.makeApprovalFixture();
  const loaded = await source.repository.loadMatter(v624.ACTOR, v624.MATTER_ID);
  assert.equal(loaded.ok, true);
  const target = loaded.data.data.targets.find((item) => item.id === v624.TARGET_ID);
  const figureId = source.figureRevision.entries[0].figureId;
  const rebound = await drawingsModule.bindFigures(source.repository, v624.ACTOR, v624.MATTER_ID, {
    targetId: v624.TARGET_ID,
    baseFigureRevisionId: target.figureRevisionId,
    entries: [{
      figureId,
      number: 1,
      title: "合成附图（修订）",
      drawingId: source.imported.data.drawing.id,
      numerals: [],
    }],
  }, { now: () => Date.parse(v624.T0) });
  assert.equal(rebound.ok, true, rebound.ok ? "" : JSON.stringify(rebound.error));

  const packed = await recovery.createRecoveryPackage(source.repository, v624.ACTOR, v624.MATTER_ID, {
    passphrase: PASS_PHRASE,
    access: "local_unmetered",
  });
  const opened = await patentpack.openPatentPack(packed, PASS_PHRASE);
  const matching = opened.figureRefs.filter((ref) => ref.figureId === figureId);
  assert.ok(matching.length >= 2);
  assert.ok(new Set(matching.map((ref) => ref.figureRevisionId)).size >= 2);
  const backend = new MemoryBackend();
  const { destination, checked } = await importInto(backend, packed);
  assert.equal(checked.canCommit, true);
  assert.equal(checked.report.mappingCounts.figures, opened.figureRefs.length);
  const committed = await recovery.commitRecoveryImport(destination, v624.ACTOR, checked.validationId);
  assert.equal(committed.ok, true, committed.ok ? "" : `${committed.error.code}: ${committed.error.message}`);
  assert.deepEqual(committed.data.report.mappingCounts, checked.report.mappingCounts);
  const figureRows = (await backend.transaction("readonly", (tx) => tx.getAll(repoModule.STORES.blobs)))
    .filter((row) => row?.kind === "figures.set" && row.matterId === committed.data.matterId);
  assert.ok(figureRows.length >= 2);
  const importedFigureIds = new Set(figureRows.flatMap((row) => row.revision.entries.map((entry) => entry.figureId)));
  assert.equal(importedFigureIds.size, 1);
  assert.notEqual([...importedFigureIds][0], figureId);
});

test("V6-26-A02 / B2: a schema-invalid source snapshot blocks validation and commit", async () => {
  const { packed } = await buildSourcePackage();
  const opened = await patentpack.openPatentPack(packed, PASS_PHRASE);
  assert.ok(opened.sourceSnapshot);
  const invalid = structuredClone(opened);
  invalid.sourceSnapshot.answers.problem = 12345;
  const backend = new MemoryBackend();
  const result = await recovery.validateRecoveryPackage(
    repoModule.openLocalRepository(backend), v624.ACTOR, await reencrypt(invalid), PASS_PHRASE,
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "IMPORT_INVALID");
  assert.equal(result.report.canCommit, false);
  assert.ok(result.report.unconvertible.some((item) => item.code === "INVALID_SNAPSHOT"));
  assert.equal(backend.rowCount(), 0);

  // A locally tampered validation row that reaches commit with the same bad
  // snapshot must still refuse before any matter/event/blob write.
  const destination = repoModule.openLocalRepository(new MemoryBackend());
  const checked = await recovery.validateRecoveryPackage(destination, v624.ACTOR, packed, PASS_PHRASE);
  assert.equal(checked.ok, true);
  const key = `recovery/validation/${encodeURIComponent(v624.ACTOR.tenantId)}/${encodeURIComponent(v624.ACTOR.userId)}/${checked.data.validationId}`;
  await destination.backend.transaction("readwrite", async (tx) => {
    const row = await tx.get(repoModule.STORES.blobs, key);
    row.package.sourceSnapshot.answers.problem = 12345;
    row.payloadHash = await repoModule.sha256Hex(new TextEncoder().encode(recovery.canonicalJson(row.package)));
    await tx.put(repoModule.STORES.blobs, key, row);
  });
  const refused = await recovery.commitRecoveryImport(destination, v624.ACTOR, checked.data.validationId);
  assert.equal(refused.ok, false);
  assert.equal(refused.error.code, "IMPORT_INVALID");
  assert.equal((await destination.listMatters(v624.ACTOR)).data.items.length, 0);
  assert.equal((await destination.listEvents(v624.ACTOR, checked.data.plannedMatterId)).ok, false);
});

test("V6-26-A02 / B3: an unknown AST version blocks validation and commit without raw Zod text", async () => {
  const { packed } = await buildSourcePackage();
  const opened = await patentpack.openPatentPack(packed, PASS_PHRASE);
  const revisionRecord = opened.records.find((record) => record.value?.kind === "generation.revision");
  assert.ok(revisionRecord);
  const invalid = structuredClone(opened);
  invalid.records.find((record) => record.value?.kind === "generation.revision").value.revision.ast.schemaVersion = "draft.v99";
  const backend = new MemoryBackend();
  const result = await recovery.validateRecoveryPackage(
    repoModule.openLocalRepository(backend), v624.ACTOR, await reencrypt(invalid), PASS_PHRASE,
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "IMPORT_INVALID");
  assert.equal(result.report.canCommit, false);
  assert.ok(result.report.unknownVersions.some((item) => item.version === "draft.v99"));
  assert.ok(result.report.unconvertible.some((item) => item.code === "UNKNOWN_VERSION"));
  assert.equal(/invalid_type|ZodError|Expected|Received/i.test(result.error.message), false);
  assert.equal(backend.rowCount(), 0);

  const destination = repoModule.openLocalRepository(new MemoryBackend());
  const checked = await recovery.validateRecoveryPackage(destination, v624.ACTOR, packed, PASS_PHRASE);
  assert.equal(checked.ok, true);
  const key = `recovery/validation/${encodeURIComponent(v624.ACTOR.tenantId)}/${encodeURIComponent(v624.ACTOR.userId)}/${checked.data.validationId}`;
  await destination.backend.transaction("readwrite", async (tx) => {
    const row = await tx.get(repoModule.STORES.blobs, key);
    const revision = row.package.records.find((record) => record.value?.kind === "generation.revision");
    revision.value.revision.ast.schemaVersion = "draft.v99";
    row.payloadHash = await repoModule.sha256Hex(new TextEncoder().encode(recovery.canonicalJson(row.package)));
    await tx.put(repoModule.STORES.blobs, key, row);
  });
  const refused = await recovery.commitRecoveryImport(destination, v624.ACTOR, checked.data.validationId);
  assert.equal(refused.ok, false);
  assert.equal(refused.error.code, "IMPORT_INVALID");
  assert.equal(/invalid_type|ZodError|Expected|Received/i.test(refused.error.message), false);
  assert.equal((await destination.listMatters(v624.ACTOR)).data.items.length, 0);
});

test("security: validation rows expire after 15 minutes and commit cleans decrypted payloads", async () => {
  const { packed } = await buildSourcePackage();
  const t0 = "2026-11-05T12:00:00.000Z";
  const afterTtl = new Date(Date.parse(t0) + recovery.RECOVERY_VALIDATION_TTL_MS + 60_000).toISOString();
  const backend = new MemoryBackend();
  const destination = repoModule.openLocalRepository(backend);
  const checked = await recovery.validateRecoveryPackage(destination, v624.ACTOR, packed, PASS_PHRASE, { now: () => t0 });
  assert.equal(checked.ok, true);
  let rows = await backend.transaction("readonly", (tx) => tx.getAll(repoModule.STORES.blobs));
  const validation = rows.find((row) => row?.kind === "recovery.validation");
  assert.ok(validation);
  assert.equal(validation.expiresAt, new Date(Date.parse(t0) + recovery.RECOVERY_VALIDATION_TTL_MS).toISOString());
  assert.equal("passphrase" in validation, false);
  assert.equal(JSON.stringify(validation).includes(PASS_PHRASE), false);
  const expired = await recovery.readRecoveryValidation(destination, v624.ACTOR, checked.data.validationId, { now: () => afterTtl });
  assert.equal(expired.ok, false);
  assert.equal(expired.error.code, "RESOURCE_NOT_FOUND");
  rows = await backend.transaction("readonly", (tx) => tx.getAll(repoModule.STORES.blobs));
  assert.equal(rows.some((row) => row?.kind === "recovery.validation"), false);

  const expiredCommit = await recovery.validateRecoveryPackage(destination, v624.ACTOR, packed, PASS_PHRASE, { now: () => t0 });
  assert.equal(expiredCommit.ok, true);
  const refused = await recovery.commitRecoveryImport(destination, v624.ACTOR, expiredCommit.data.validationId, { now: () => afterTtl });
  assert.equal(refused.ok, false);
  assert.equal(refused.error.code, "RESOURCE_NOT_FOUND");
  assert.equal((await destination.listMatters(v624.ACTOR)).data.items.length, 0);

  const fresh = await recovery.validateRecoveryPackage(destination, v624.ACTOR, packed, PASS_PHRASE, { now: () => t0 });
  assert.equal(fresh.ok, true);
  const committed = await recovery.commitRecoveryImport(destination, v624.ACTOR, fresh.data.validationId, { now: () => t0 });
  assert.equal(committed.ok, true, committed.ok ? "" : committed.error.message);
  rows = await backend.transaction("readonly", (tx) => tx.getAll(repoModule.STORES.blobs));
  assert.equal(rows.some((row) => row?.kind === "recovery.validation"), false);
  const marker = rows.find((row) => row?.kind === "recovery.commit");
  assert.ok(marker);
  assert.equal("package" in marker, false);
  assert.equal("packageHash" in marker, false);
  assert.equal("passphrase" in marker, false);
  const refreshed = await recovery.readRecoveryValidation(destination, v624.ACTOR, fresh.data.validationId);
  assert.equal(refreshed.ok, true);
  assert.equal(refreshed.data.status, "committed");
  assert.equal(refreshed.data.matterId, committed.data.matterId);

  const revalidated = await recovery.validateRecoveryPackage(destination, v624.ACTOR, packed, PASS_PHRASE, { now: () => t0 });
  assert.equal(revalidated.ok, true);
  rows = await backend.transaction("readonly", (tx) => tx.getAll(repoModule.STORES.blobs));
  assert.equal(rows.some((row) => row?.kind === "recovery.validation"), false);
  const replay = await recovery.commitRecoveryImport(destination, v624.ACTOR, revalidated.data.validationId);
  assert.equal(replay.ok, true);
  assert.equal(replay.data.matterId, committed.data.matterId);
  assert.equal(replay.data.replayed, true);
});

test("V6-26-A02: wrong passphrase, tampered package and partial write never create a half matter", async () => {
  const { packed } = await buildSourcePackage();
  const wrongBackend = new MemoryBackend();
  const wrongRepo = repoModule.openLocalRepository(wrongBackend);
  const wrong = await recovery.validateRecoveryPackage(wrongRepo, v624.ACTOR, packed, WRONG_PASSPHRASE);
  assert.equal(wrong.ok, false);
  assert.equal(wrong.error.code, "RECOVERY_DECRYPT_FAILED");
  assert.match(wrong.error.message, /口令|篡改/);
  assert.equal(wrongBackend.rowCount(), 0);

  const tampered = tamperCiphertextByte(packed);
  const tamperedBackend = new MemoryBackend();
  const tamperedResult = await recovery.validateRecoveryPackage(
    repoModule.openLocalRepository(tamperedBackend), v624.ACTOR, tampered, PASS_PHRASE,
  );
  assert.equal(tamperedResult.ok, false);
  assert.equal(tamperedResult.error.code, "RECOVERY_DECRYPT_FAILED");
  assert.equal(tamperedBackend.rowCount(), 0);

  const backend = new MemoryBackend();
  const destination = repoModule.openLocalRepository(backend);
  const checked = await recovery.validateRecoveryPackage(destination, v624.ACTOR, packed, PASS_PHRASE);
  assert.equal(checked.ok, true);
  backend.failPut = ({ store, key }) => store === repoModule.STORES.blobs && key.startsWith("drawings/")
    ? new Error("synthetic partial-write failure")
    : null;
  const failed = await recovery.commitRecoveryImport(destination, v624.ACTOR, checked.data.validationId);
  assert.equal(failed.ok, false);
  assert.equal(failed.error.code, "STORAGE_UNAVAILABLE");
  assert.equal((await destination.listMatters(v624.ACTOR)).data.items.length, 0);
  assert.equal((await destination.listEvents(v624.ACTOR, checked.data.plannedMatterId)).ok, false);
  const rows = await backend.transaction("readonly", async (tx) => ({
    matters: await tx.getAll(repoModule.STORES.matters),
    events: await tx.getAll(repoModule.STORES.events),
    blobs: await tx.getAll(repoModule.STORES.blobs),
  }));
  assert.equal(rows.matters.length, 0);
  assert.equal(rows.events.length, 0);
  assert.equal(rows.blobs.filter((row) => row?.kind !== "recovery.validation").length, 0);
});

test("V6-26-A02 / S08-A06: missing bytes remain listed and import as missing_bytes", async () => {
  const { source, packed: _unused } = await buildSourcePackage();
  const originalAsset = source.imported.data.asset;
  await source.repository.backend.transaction("readwrite", (tx) => tx.delete(repoModule.STORES.blobs, originalAsset.id));
  const repacked = await recovery.createRecoveryPackage(source.repository, v624.ACTOR, v624.MATTER_ID, {
    passphrase: PASS_PHRASE,
    access: "local_unmetered",
  });
  const backend = new MemoryBackend();
  const { destination, checked } = await importInto(backend, repacked);
  assert.ok(checked.report.missingBytes.length >= 1);
  assert.equal(checked.report.incomplete, true);
  const committed = await recovery.commitRecoveryImport(destination, v624.ACTOR, checked.validationId);
  assert.equal(committed.ok, true, committed.ok ? "" : committed.error.message);
  const restored = await destination.loadMatter(v624.ACTOR, committed.data.matterId);
  assert.ok(restored.data.data.assets.some((asset) => asset.state === "missing_bytes"));
  assert.ok(restored.data.data.assets.filter((asset) => asset.state === "missing_bytes").every((asset) =>
    !backend.data.get(repoModule.STORES.blobs).has(asset.id)));
  const stored = await backend.transaction("readonly", (tx) => tx.getAll(repoModule.STORES.blobs));
  assert.equal(stored.some((row) => /approval|entitlement|payment|grant|share/i.test(String(row?.kind ?? ""))), false);
});

test("V6-26-A02: a re-encrypted package with a bad asset hash or path is refused before any case exists", async () => {
  const { packed } = await buildSourcePackage();
  const opened = await patentpack.openPatentPack(packed, PASS_PHRASE);
  const badHash = structuredClone(opened);
  const asset = badHash.assets.find((item) => item.state === "available");
  assert.ok(asset);
  asset.sha256 = "a".repeat(64);
  const hashBytes = await patentpack.buildPatentPack(badHash, PASS_PHRASE);
  const hashBackend = new MemoryBackend();
  const hashResult = await recovery.validateRecoveryPackage(repoModule.openLocalRepository(hashBackend), v624.ACTOR, hashBytes, PASS_PHRASE);
  assert.equal(hashResult.ok, false);
  assert.equal(hashResult.error.code, "IMPORT_INVALID");
  assert.ok(hashResult.report.unconvertible.some((item) => item.code === "HASH_MISMATCH"));
  assert.equal(hashBackend.rowCount(), 0);

  const badPath = structuredClone(opened);
  const pathAsset = badPath.assets.find((item) => item.state === "available");
  pathAsset.originalName = "../../escape.png";
  const pathBytes = await patentpack.buildPatentPack(badPath, PASS_PHRASE);
  const pathBackend = new MemoryBackend();
  const pathResult = await recovery.validateRecoveryPackage(repoModule.openLocalRepository(pathBackend), v624.ACTOR, pathBytes, PASS_PHRASE);
  assert.equal(pathResult.ok, false);
  assert.equal(pathResult.error.code, "IMPORT_INVALID");
  assert.ok(pathResult.report.unconvertible.some((item) => item.code === "INVALID_PATH"));
  assert.equal(pathBackend.rowCount(), 0);
});

test("V6-26-A02: an unknown recovery version is reported and writes nothing", async () => {
  const { packed } = await buildSourcePackage();
  const opened = await patentpack.openPatentPack(packed, PASS_PHRASE);
  const future = { ...structuredClone(opened), schemaVersion: "recovery.v2" };
  const bytes = await patentpack.buildPatentPack(future, PASS_PHRASE);
  const backend = new MemoryBackend();
  const result = await recovery.validateRecoveryPackage(repoModule.openLocalRepository(backend), v624.ACTOR, bytes, PASS_PHRASE);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "IMPORT_INVALID");
  assert.ok(result.report.unknownVersions.some((item) => item.ref === "recovery" && item.version === "recovery.v2"));
  assert.ok(result.report.unconvertible.some((item) => item.code === "UNKNOWN_VERSION"));
  assert.equal(backend.rowCount(), 0);
});

test("V6-26-A02/A03: a failed commit leaves no half case and the same validation retries once", async () => {
  const { packed } = await buildSourcePackage();
  const backend = new MemoryBackend();
  const destination = repoModule.openLocalRepository(backend);
  const checked = await recovery.validateRecoveryPackage(destination, v624.ACTOR, packed, PASS_PHRASE);
  assert.equal(checked.ok, true);
  let fail = true;
  backend.failPut = ({ store, key }) => fail && store === repoModule.STORES.blobs && key.startsWith("parse/source/")
    ? new Error("synthetic source-row failure")
    : null;
  const failed = await recovery.commitRecoveryImport(destination, v624.ACTOR, checked.data.validationId);
  assert.equal(failed.ok, false);
  assert.equal(failed.error.code, "STORAGE_UNAVAILABLE");
  assert.equal((await destination.listMatters(v624.ACTOR)).data.items.length, 0);
  fail = false;
  const retried = await recovery.commitRecoveryImport(destination, v624.ACTOR, checked.data.validationId);
  assert.equal(retried.ok, true, retried.ok ? "" : retried.error.message);
  assert.equal((await destination.listMatters(v624.ACTOR)).data.items.length, 1);
  const again = await recovery.commitRecoveryImport(destination, v624.ACTOR, checked.data.validationId);
  assert.equal(again.ok, true);
  assert.equal(again.data.matterId, retried.data.matterId);
  assert.equal(again.data.replayed, true);
});

test("V6-26-A02: legacy local reviews become legacy_unverified and are not approvals", async () => {
  const { packed } = await buildSourcePackage();
  const opened = await patentpack.openPatentPack(packed, PASS_PHRASE);
  assert.ok(opened.migrationReport.legacyUnverified.length > 0);
  assert.ok(opened.migrationReport.legacyUnverified.every((item) => item.identity === "legacy_unverified"));
  const backend = new MemoryBackend();
  const { destination, checked } = await importInto(backend, packed);
  assert.ok(checked.report.legacyUnverified.length > 0);
  assert.equal(checked.report.legacyUnverified.some((item) => item.kind === "approval"), false);
  const committed = await recovery.commitRecoveryImport(destination, v624.ACTOR, checked.validationId);
  assert.equal(committed.ok, true, committed.ok ? "" : committed.error.message);
  const rows = await backend.transaction("readonly", (tx) => tx.getAll(repoModule.STORES.blobs));
  const legacy = rows.filter((row) => row?.kind === "recovery.legacy_review");
  assert.equal(legacy.length, opened.migrationReport.legacyUnverified.length);
  assert.ok(legacy.every((row) => row.identity === "legacy_unverified" && row.matterId === committed.data.matterId));
  assert.equal(rows.some((row) => row?.kind === "delivery.approvals" && row.matterId === committed.data.matterId), false);
  assert.equal(rows.some((row) => row?.kind === "draft-review.confirmations" && row.matterId === committed.data.matterId), false);
});

test("V6-26-A03 / S08-A07: refresh and repeated commit with one validationId create one matter", async () => {
  const { packed } = await buildSourcePackage();
  const backend = new MemoryBackend();
  const { destination, checked } = await importInto(backend, packed);
  const first = await recovery.commitRecoveryImport(destination, v624.ACTOR, checked.validationId);
  assert.equal(first.ok, true, first.ok ? "" : first.error.message);
  const refreshed = await recovery.readRecoveryValidation(destination, v624.ACTOR, checked.validationId);
  assert.equal(refreshed.ok, true);
  assert.equal(refreshed.data.status, "committed");
  assert.equal(refreshed.data.matterId, first.data.matterId);
  const retry = await recovery.commitRecoveryImport(destination, v624.ACTOR, checked.validationId);
  assert.equal(retry.ok, true, retry.ok ? "" : retry.error.message);
  assert.equal(retry.data.matterId, first.data.matterId);
  assert.equal(retry.data.replayed, true);
  assert.equal((await destination.listMatters(v624.ACTOR)).data.items.length, 1);
  assert.equal((await destination.listEvents(v624.ACTOR, first.data.matterId)).data.items.filter((event) => event.action === "matter.created").length, 1);
});

test("V6-26-A03 / S08-A07: concurrent commits for one validationId still create one matter", async () => {
  const { packed } = await buildSourcePackage();
  const backend = new MemoryBackend();
  const destination = repoModule.openLocalRepository(backend);
  const checked = await recovery.validateRecoveryPackage(destination, v624.ACTOR, packed, PASS_PHRASE);
  assert.equal(checked.ok, true);
  const [first, second] = await Promise.all([
    recovery.commitRecoveryImport(destination, v624.ACTOR, checked.data.validationId),
    recovery.commitRecoveryImport(destination, v624.ACTOR, checked.data.validationId),
  ]);
  assert.equal(first.ok, true, first.ok ? "" : first.error.message);
  assert.equal(second.ok, true, second.ok ? "" : second.error.message);
  assert.equal(first.data.matterId, second.data.matterId);
  assert.ok([first.data.replayed, second.data.replayed].includes(true));
  assert.equal((await destination.listMatters(v624.ACTOR)).data.items.length, 1);
  const events = await destination.listEvents(v624.ACTOR, first.data.matterId);
  assert.equal(events.data.items.filter((event) => event.action === "matter.created").length, 1);
});

test("S08-A09: preview-only package keeps allowed preview nodes and lists omitted generated content", async () => {
  const { packed } = await buildSourcePackage({ access: "preview" });
  const opened = await patentpack.openPatentPack(packed, PASS_PHRASE);
  assert.equal(opened.schemaVersion, "recovery.v1");
  assert.ok(opened.migrationReport.omittedGeneratedContent.length > 0);
  const revisionRow = opened.records.find((entry) => entry.value?.kind === "generation.revision");
  assert.ok(revisionRow);
  const ast = revisionRow.value.revision.ast;
  const paragraphs = [
    ...ast.claims.flatMap((claim) => claim.paragraphs),
    ...ast.sections.flatMap((section) => section.paragraphs),
  ];
  assert.ok(paragraphs.some((paragraph) => paragraph.text === "一种合成温控装置。"));
  assert.equal(paragraphs.some((paragraph) => paragraph.text === "以下为合成实施方式。 "), false);
  assert.ok(paragraphs.filter((paragraph) => paragraph.origin === "ai" || paragraph.origin === "mixed")
    .every((paragraph) => paragraph.sourceRefs.length === 0 && paragraph.generationJobId === null));
});
