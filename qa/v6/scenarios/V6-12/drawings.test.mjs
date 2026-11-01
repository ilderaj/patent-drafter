/**
 * V6-12 real drawings and figure references — engine scenarios.
 *
 * Every test drives the public interface of `features/sources/drawings.ts`
 * over the real V6-06 repository on the V6-11 in-memory backend, and checks
 * what was persisted (stores, events, rows), not what a function returned.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { CONTRACT_VERSION, STORES } from "../../../../apps/web/src/v6/lib/repository.ts";
import { ACTIVITY_METADATA_KEYS_BY_ACTION as ACTIVITY_METADATA_ALLOWLIST } from "../../../../packages/contracts/src/records.ts";
import { figureSetRevisionSchema } from "../../../../packages/contracts/src/matter.ts";
import {
  bindFigures,
  checkFigureExportGate,
  checkFigureNumbers,
  collectFigureIds,
  deleteDrawing,
  figureSetHash,
  importDrawing,
  inspectDrawing,
  loadFigurePanel,
  readDrawingLibrary,
  readFigureLibrary,
  resolveFigureReferences,
} from "../../../../apps/web/src/v6/features/sources/drawings.ts";
import {
  ACTOR_A,
  ACTOR_OTHER_TENANT,
  ACTOR_OTHER_USER,
  EMPTY_SET_A,
  EMPTY_SET_B,
  MATTER_ID,
  TARGET_A,
  TARGET_B,
  aggregateOf,
  clock,
  dump,
  entry,
  events,
  fixture,
  rowsOfKind,
  seed,
} from "./harness.mjs";

const FIG_1 = "88888888-8888-4888-8888-888888888881";
const FIG_2 = "88888888-8888-4888-8888-888888888882";
const LEGACY_SET_A = "77777777-7777-4777-8777-77777777777a";

async function importOk(repository, name, options = {}) {
  const result = await importDrawing(
    repository,
    ACTOR_A,
    MATTER_ID,
    { bytes: fixture(name), fileName: name },
    { now: clock, ...options },
  );
  assert.equal(result.ok, true, result.ok ? "" : JSON.stringify(result.error));
  return result.data;
}

async function bindOk(repository, targetId, baseFigureRevisionId, entries) {
  const result = await bindFigures(repository, ACTOR_A, MATTER_ID, { targetId, baseFigureRevisionId, entries }, { now: clock });
  assert.equal(result.ok, true, result.ok ? "" : JSON.stringify(result.error));
  return result.data;
}

function assertEventsWithinAllowlist(backend) {
  for (const event of events(backend)) {
    const allowed = ACTIVITY_METADATA_ALLOWLIST[event.action];
    assert.ok(allowed, `action ${event.action} is a contract action`);
    for (const key of Object.keys(event.metadata)) assert.ok(allowed.includes(key), `${event.action}.${key} allowed`);
  }
}

// ---------------------------------------------------------------------------
// Image validation by real bytes
// ---------------------------------------------------------------------------

test("V6-12 valid PNG and baseline JPEG pass with the dimensions their data really carries", () => {
  assert.deepEqual(inspectDrawing(fixture("drawing-valid.png")), {
    ok: true,
    image: { kind: "png", mime: "image/png", width: 128, height: 96 },
  });
  assert.deepEqual(inspectDrawing(fixture("drawing-valid.jpg")), {
    ok: true,
    image: { kind: "jpeg", mime: "image/jpeg", width: 40, height: 16 },
  });
  assert.deepEqual(inspectDrawing(fixture("drawing-valid-restart.jpg")), {
    ok: true,
    image: { kind: "jpeg", mime: "image/jpeg", width: 40, height: 16 },
  });
});

test("V6-12 corrupt bytes, wrong magic, truncation and dimension lies are BAD_DRAWING", () => {
  for (const name of [
    "drawing-corrupt.png",
    "drawing-not-an-image.png",
    "drawing-truncated.jpg",
    "drawing-dimension-lie.png",
    "drawing-dimension-lie.jpg",
    "drawing-restart-order.jpg",
  ]) {
    const result = inspectDrawing(fixture(name));
    assert.equal(result.ok, false, name);
    assert.equal(result.error.code, "BAD_DRAWING", name);
  }
  // A PDF is not a drawing however it is named.
  const pdf = new TextEncoder().encode("%PDF-1.4\n%synthetic\n");
  assert.equal(inspectDrawing(pdf).error.code, "BAD_DRAWING");
  assert.equal(inspectDrawing(new Uint8Array(0)).error.code, "INVALID_INPUT");
  // A progressive frame header (SOF2) is refused: its scans are not walked, so
  // its declared size could not be checked against the data.
  const progressive = fixture("drawing-valid.jpg");
  const sof = progressive.findIndex((byte, index) => byte === 0xff && progressive[index + 1] === 0xc0);
  assert.ok(sof > 0);
  progressive[sof + 1] = 0xc2;
  assert.equal(inspectDrawing(progressive).error.code, "BAD_DRAWING");
});

test("V6-12 B1 a non-interleaved scan is counted on its component's own block grid", () => {
  // SOF0 4000x3000 with 2x2 luma: the luma scan must code 500x375 = 187,500
  // blocks. This file codes 47,000 (the per-MCU count) and no chroma at all.
  const lie = inspectDrawing(fixture("drawing-noninterleaved-lie.jpg"));
  assert.equal(lie.ok, false);
  assert.equal(lie.error.code, "BAD_DRAWING");
  // A legal 4:2:0 file with one scan per component and DRI = 2 still passes:
  // Y codes 5x2 blocks, Cb and Cr 3x1 each.
  assert.deepEqual(inspectDrawing(fixture("drawing-valid-noninterleaved.jpg")), {
    ok: true,
    image: { kind: "jpeg", mime: "image/jpeg", width: 40, height: 16 },
  });
});

test("V6-12 B1 every component the frame declares must be scanned before EOI", async () => {
  const missing = inspectDrawing(fixture("drawing-missing-component-scan.jpg"));
  assert.equal(missing.ok, false);
  assert.equal(missing.error.code, "BAD_DRAWING");
  // And the import path refuses it with no write.
  const { backend, repository } = await seed();
  const before = dump(backend);
  for (const name of ["drawing-missing-component-scan.jpg", "drawing-noninterleaved-lie.jpg"]) {
    const result = await importDrawing(repository, ACTOR_A, MATTER_ID, { bytes: fixture(name), fileName: name }, { now: clock });
    assert.equal(result.ok, false, name);
    assert.equal(result.error.code, "BAD_DRAWING", name);
  }
  assert.deepEqual(dump(backend), before);
});

test("V6-12 B1 an interlaced PNG is walked pass by pass, so a bad filter byte is BAD_DRAWING", async () => {
  // A genuine Adam7 33x7 RGB image: accepted and importable.
  assert.deepEqual(inspectDrawing(fixture("drawing-interlaced-valid.png")), {
    ok: true,
    image: { kind: "png", mime: "image/png", width: 33, height: 7 },
  });
  // The same image with one pass row's filter byte set to 7: no decoder can
  // apply it, so the import is refused before anything is written.
  const bad = fixture("drawing-interlaced-bad-filter.png");
  const inspected = inspectDrawing(bad);
  assert.equal(inspected.ok, false);
  assert.equal(inspected.error.code, "BAD_DRAWING");

  const { backend, repository } = await seed();
  const before = dump(backend);
  const refused = await importDrawing(repository, ACTOR_A, MATTER_ID, { bytes: bad, fileName: "bad.png" }, { now: clock });
  assert.equal(refused.ok, false);
  assert.equal(refused.error.code, "BAD_DRAWING");
  assert.deepEqual(dump(backend), before, "no asset, drawing row, byte row or event is written");

  // The valid interlaced image imports, binds and leaves the export gate open.
  const imported = await importOk(repository, "drawing-interlaced-valid.png");
  assert.equal(imported.status, "created");
  const bound = await bindOk(repository, TARGET_A, EMPTY_SET_A, [entry(FIG_1, 1, imported.drawing.id)]);
  const gate = await checkFigureExportGate(
    repository,
    ACTOR_A,
    MATTER_ID,
    { targetId: TARGET_A, figureRevisionId: bound.current.id },
    { now: clock },
  );
  assert.equal(gate.data.allowed, true, JSON.stringify(gate.data.reasons));
});

test("V6-12 a JPEG frame marker other than SOF0 or SOF1 is refused", async () => {
  const valid = fixture("drawing-valid.jpg");
  const sof = valid.findIndex((byte, index) => byte === 0xff && valid[index + 1] === 0xc0);
  assert.ok(sof > 0);
  const { backend, repository } = await seed();
  const before = dump(backend);
  // SOF2..SOF15, excluding the non-frame markers DHT (C4), JPG (C8) and DAC (CC).
  for (const marker of [0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]) {
    const copy = Uint8Array.from(valid);
    copy[sof + 1] = marker;
    const label = `SOF${marker - 0xc0}`;
    const inspected = inspectDrawing(copy);
    assert.equal(inspected.ok, false, `${label} is refused`);
    assert.equal(inspected.error.code, "BAD_DRAWING", label);
    const stored = await importDrawing(repository, ACTOR_A, MATTER_ID, { bytes: copy, fileName: `${label}.jpg` }, { now: clock });
    assert.equal(stored.ok, false, label);
    assert.equal(stored.error.code, "BAD_DRAWING", label);
  }
  assert.deepEqual(dump(backend), before, "no refused coding process writes anything");
  // SOF1 is extended sequential Huffman, the same entropy layout as SOF0.
  const sof1 = Uint8Array.from(valid);
  sof1[sof + 1] = 0xc1;
  assert.equal(inspectDrawing(sof1).ok, true);
});

test("V6-12 a JPEG frame that lists one component id twice is refused", async () => {
  const duplicate = fixture("drawing-duplicate-component.jpg");
  const inspected = inspectDrawing(duplicate);
  assert.equal(inspected.ok, false);
  assert.equal(inspected.error.code, "BAD_DRAWING");

  const { backend, repository } = await seed();
  const before = dump(backend);
  const refused = await importDrawing(repository, ACTOR_A, MATTER_ID, { bytes: duplicate, fileName: "dup.jpg" }, { now: clock });
  assert.equal(refused.ok, false);
  assert.equal(refused.error.code, "BAD_DRAWING");
  assert.deepEqual(dump(backend), before);
});

test("V6-12 an interleaved scan with more than 10 blocks per MCU is refused", async () => {
  const overflow = fixture("drawing-mcu-overflow.jpg");
  const inspected = inspectDrawing(overflow);
  assert.equal(inspected.ok, false);
  assert.equal(inspected.error.code, "BAD_DRAWING");

  const { backend, repository } = await seed();
  const before = dump(backend);
  const refused = await importDrawing(repository, ACTOR_A, MATTER_ID, { bytes: overflow, fileName: "mcu.jpg" }, { now: clock });
  assert.equal(refused.ok, false);
  assert.equal(refused.error.code, "BAD_DRAWING");
  assert.deepEqual(dump(backend), before);
});

test("V6-12 activity source.committed and source.retired carry the committed matter version", async () => {
  const { backend, repository } = await seed();
  const first = await importOk(repository, "drawing-valid.png");
  await importOk(repository, "drawing-valid.jpg");
  await deleteDrawing(repository, ACTOR_A, MATTER_ID, first.drawing.id);

  const committed = events(backend).filter((event) => event.action === "source.committed");
  const retired = events(backend).filter((event) => event.action === "source.retired");
  assert.equal(committed.length, 2);
  assert.equal(retired.length, 1);
  // The seed commit is version 1; two imports and one delete each commit once.
  assert.deepEqual(committed.map((event) => event.metadata.version).sort(), [2, 3]);
  assert.deepEqual(retired.map((event) => event.metadata.version), [4]);
  assert.equal((await aggregateOf(repository)).matter.version, 4);
  assertEventsWithinAllowlist(backend);
});

test("S02-A02 a 17 MP PNG is refused as IMAGE_TOO_LARGE and no reduced copy is stored", async () => {
  const bytes = fixture("drawing-17mp.png");
  const inspected = inspectDrawing(bytes);
  assert.equal(inspected.ok, false);
  assert.equal(inspected.error.code, "IMAGE_TOO_LARGE");

  const { backend, repository } = await seed();
  const before = dump(backend);
  const result = await importDrawing(repository, ACTOR_A, MATTER_ID, { bytes, fileName: "big.png" }, { now: clock });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "IMAGE_TOO_LARGE");
  assert.deepEqual(dump(backend), before, "nothing written: no asset, no drawing row, no thumbnail");
});

test("V6-12 bytes over 8 MiB are IMAGE_TOO_LARGE before any decode", () => {
  const big = new Uint8Array(8 * 1024 * 1024 + 1);
  big.set(fixture("drawing-valid.png"));
  assert.equal(inspectDrawing(big).error.code, "IMAGE_TOO_LARGE");
});

// ---------------------------------------------------------------------------
// V6-12-A01 delete and re-import is a new version
// ---------------------------------------------------------------------------

test("V6-12-A01 deleting and re-importing a figure creates a new drawing and a new figure-set version; the old one is not mutated", async () => {
  const { backend, repository } = await seed();

  const first = await importOk(repository, "drawing-valid.png");
  assert.equal(first.status, "created");
  assert.equal(first.drawing.width, 128);
  assert.equal(first.drawing.height, 96);
  assert.equal(first.asset.purpose, "drawing");
  // Bytes are in V6-10 byte storage under the asset id, digest-checked.
  const blob = backend.store(STORES.blobs).get(first.asset.id);
  assert.equal(blob.sha256, first.drawing.sha256);
  assert.deepEqual(new Uint8Array(blob.bytes), fixture("drawing-valid.png"));

  const v1 = await bindOk(repository, TARGET_A, EMPTY_SET_A, [entry(FIG_1, 1, first.drawing.id)]);
  assert.equal(v1.current.parentId, EMPTY_SET_A);
  const v1Row = structuredClone(rowsOfKind(backend, "figures.set").find((row) => row.revision.id === v1.current.id));

  const deleted = await deleteDrawing(repository, ACTOR_A, MATTER_ID, first.drawing.id);
  assert.equal(deleted.ok, true);
  const library = await readDrawingLibrary(repository, ACTOR_A, MATTER_ID);
  assert.deepEqual(library.data, [], "a deleted drawing is not shown as usable");

  const second = await importOk(repository, "drawing-valid.png");
  assert.equal(second.status, "created");
  assert.notEqual(second.drawing.id, first.drawing.id, "re-import mints a new drawing id");
  assert.notEqual(second.asset.id, first.asset.id);
  assert.equal(second.drawing.sha256, first.drawing.sha256, "same bytes, same digest");

  const v2 = await bindOk(repository, TARGET_A, v1.current.id, [entry(FIG_1, 1, second.drawing.id)]);
  assert.notEqual(v2.current.id, v1.current.id);
  assert.equal(v2.current.parentId, v1.current.id, "the new revision points at the old one");
  assert.notEqual(v2.current.hash, v1.current.hash);

  // The old revision row is byte-for-byte what it was.
  const v1After = rowsOfKind(backend, "figures.set").find((row) => row.revision.id === v1.current.id);
  assert.deepEqual(v1After, v1Row);
  assert.equal(v1After.revision.entries[0].drawingId, first.drawing.id);

  // History is append-only: empty set, v1, v2.
  const read = await readFigureLibrary(repository, ACTOR_A, MATTER_ID);
  assert.deepEqual(
    read.data.revisions.filter((revision) => revision.targetId === TARGET_A).map((revision) => revision.id).sort(),
    [EMPTY_SET_A, v1.current.id, v2.current.id].sort(),
  );
  assert.equal((await aggregateOf(repository)).targets.find((t) => t.id === TARGET_A).figureRevisionId, v2.current.id);

  // Activity: source.committed ×2, source.retired ×1, figures.bound ×2, no invented action.
  const actions = events(backend).map((event) => event.action).sort();
  assert.deepEqual(actions, ["figures.bound", "figures.bound", "source.committed", "source.committed", "source.retired"]);
  assertEventsWithinAllowlist(backend);
});

test("S02-A08 rebinding target A creates a new A revision; target B's figure-set id does not change", async () => {
  const { repository } = await seed();
  const drawing = await importOk(repository, "drawing-valid.png");
  const replacement = await importOk(repository, "drawing-valid.jpg");
  const a1 = await bindOk(repository, TARGET_A, EMPTY_SET_A, [entry(FIG_1, 1, drawing.drawing.id)]);
  const b1 = await bindOk(repository, TARGET_B, EMPTY_SET_B, [entry(FIG_2, 1, drawing.drawing.id)]);

  // Replace A's drawing (换图) only.
  const a2 = await bindOk(repository, TARGET_A, a1.current.id, [entry(FIG_1, 1, replacement.drawing.id)]);
  assert.notEqual(a2.current.id, a1.current.id);
  const targets = (await aggregateOf(repository)).targets;
  assert.equal(targets.find((t) => t.id === TARGET_A).figureRevisionId, a2.current.id);
  assert.equal(targets.find((t) => t.id === TARGET_B).figureRevisionId, b1.current.id, "B unchanged");

  // Importing into the shared library alone never moves any target (C02).
  await importOk(repository, "drawing-valid-restart.jpg");
  const after = (await aggregateOf(repository)).targets;
  assert.deepEqual(after.map((t) => t.figureRevisionId), targets.map((t) => t.figureRevisionId));
});

// ---------------------------------------------------------------------------
// V6-12-A02 invalid / stale / failed state blocks export
// ---------------------------------------------------------------------------

test("V6-12-A02 corrupt or lying images are refused at import and leave no asset, row or event", async () => {
  const { backend, repository } = await seed();
  const before = dump(backend);
  for (const name of ["drawing-corrupt.png", "drawing-dimension-lie.png", "drawing-dimension-lie.jpg", "drawing-truncated.jpg", "drawing-not-an-image.png"]) {
    const result = await importDrawing(repository, ACTOR_A, MATTER_ID, { bytes: fixture(name), fileName: name }, { now: clock });
    assert.equal(result.ok, false, name);
    assert.equal(result.error.code, "BAD_DRAWING", name);
  }
  assert.deepEqual(dump(backend), before);
});

test("V6-12-A02 a deleted drawing that a figure still needs blocks export with MISSING_BYTES", async () => {
  const { repository } = await seed();
  const drawing = await importOk(repository, "drawing-valid.png");
  const bound = await bindOk(repository, TARGET_A, EMPTY_SET_A, [entry(FIG_1, 1, drawing.drawing.id)]);

  const ok = await checkFigureExportGate(repository, ACTOR_A, MATTER_ID, { targetId: TARGET_A, referencedFigureIds: [FIG_1] }, { now: clock });
  assert.deepEqual(ok.data, { allowed: true, filesAvailable: true, evaluatedAt: "2026-11-01T00:00:00.000Z", reasons: [] });

  await deleteDrawing(repository, ACTOR_A, MATTER_ID, drawing.drawing.id);
  const gate = await checkFigureExportGate(repository, ACTOR_A, MATTER_ID, { targetId: TARGET_A, figureRevisionId: bound.current.id }, { now: clock });
  assert.equal(gate.data.allowed, false);
  assert.equal(gate.data.filesAvailable, false);
  assert.deepEqual(gate.data.reasons, [{ code: "MISSING_BYTES", resourceId: drawing.drawing.id }]);
});

test("V6-12-A02 stored bytes that no longer match their digest block export with MISSING_BYTES", async () => {
  const { backend, repository } = await seed();
  const drawing = await importOk(repository, "drawing-valid.png");
  await bindOk(repository, TARGET_A, EMPTY_SET_A, [entry(FIG_1, 1, drawing.drawing.id)]);
  const blob = backend.store(STORES.blobs).get(drawing.asset.id);
  const flipped = new Uint8Array(blob.bytes);
  flipped[40] ^= 0xff;
  backend.store(STORES.blobs).set(drawing.asset.id, { ...blob, bytes: flipped });

  const gate = await checkFigureExportGate(repository, ACTOR_A, MATTER_ID, { targetId: TARGET_A }, { now: clock });
  assert.deepEqual(gate.data.reasons, [{ code: "MISSING_BYTES", resourceId: drawing.drawing.id }]);

  backend.store(STORES.blobs).delete(drawing.asset.id);
  const gone = await checkFigureExportGate(repository, ACTOR_A, MATTER_ID, { targetId: TARGET_A }, { now: clock });
  assert.deepEqual(gone.data.reasons, [{ code: "MISSING_BYTES", resourceId: drawing.drawing.id }]);
});

test("V6-12-A02 a draft built on an older figure set is STALE_BINDING; a reference the set does not address is RESOURCE_NOT_FOUND", async () => {
  const { repository } = await seed();
  const drawing = await importOk(repository, "drawing-valid.png");
  const v1 = await bindOk(repository, TARGET_A, EMPTY_SET_A, [entry(FIG_1, 1, drawing.drawing.id)]);
  const v2 = await bindOk(repository, TARGET_A, v1.current.id, [entry(FIG_1, 1, drawing.drawing.id, "图1 修订标题")]);

  const stale = await checkFigureExportGate(
    repository,
    ACTOR_A,
    MATTER_ID,
    { targetId: TARGET_A, figureRevisionId: v1.current.id, referencedFigureIds: [FIG_1, FIG_2] },
    { now: clock },
  );
  assert.equal(stale.data.allowed, false);
  assert.deepEqual(stale.data.reasons, [
    { code: "STALE_BINDING", resourceId: v1.current.id },
    { code: "RESOURCE_NOT_FOUND", resourceId: FIG_2 },
  ]);
  // A stale draft and an unaddressed figure are not missing files: every
  // drawing's bytes are present, so the gate's byte flag must stay true.
  assert.equal(stale.data.filesAvailable, true);

  // The same draft rebuilt on v2 with only addressed figures exports.
  const current = await checkFigureExportGate(
    repository,
    ACTOR_A,
    MATTER_ID,
    { targetId: TARGET_A, figureRevisionId: v2.current.id, referencedFigureIds: [FIG_1] },
    { now: clock },
  );
  assert.equal(current.data.allowed, true);

  // A figure entry without a drawing cannot be exported either.
  const placeholder = await bindOk(repository, TARGET_A, v2.current.id, [entry(FIG_1, 1, drawing.drawing.id), entry(FIG_2, 2, null)]);
  const gate = await checkFigureExportGate(repository, ACTOR_A, MATTER_ID, { targetId: TARGET_A }, { now: clock });
  assert.equal(placeholder.current.entries.length, 2);
  assert.deepEqual(gate.data.reasons, [{ code: "MISSING_BYTES", resourceId: FIG_2 }]);
});

test("V6-12-A02 the export gate reads only: two calls agree and nothing is written", async () => {
  const { backend, repository } = await seed();
  const drawing = await importOk(repository, "drawing-valid.png");
  await bindOk(repository, TARGET_A, EMPTY_SET_A, [entry(FIG_1, 1, drawing.drawing.id)]);
  await deleteDrawing(repository, ACTOR_A, MATTER_ID, drawing.drawing.id);
  const before = dump(backend);
  const one = await checkFigureExportGate(repository, ACTOR_A, MATTER_ID, { targetId: TARGET_A }, { now: clock });
  const two = await checkFigureExportGate(repository, ACTOR_A, MATTER_ID, { targetId: TARGET_A }, { now: clock });
  assert.deepEqual(one, two);
  assert.deepEqual(dump(backend), before);
});

test("V6-12-A02 numbering must be 1..n contiguous and unique; a refused bind writes nothing", async () => {
  assert.equal(checkFigureNumbers([{ number: 1 }, { number: 1 }]).code, "DUPLICATE_FIGURE_NUMBER");
  assert.equal(checkFigureNumbers([{ number: 1 }, { number: 3 }]).code, "DUPLICATE_FIGURE_NUMBER");
  assert.equal(checkFigureNumbers([{ number: 0 }]).code, "DUPLICATE_FIGURE_NUMBER");
  assert.equal(checkFigureNumbers([{ number: 2 }, { number: 1 }]), null);

  const { backend, repository } = await seed();
  const drawing = await importOk(repository, "drawing-valid.png");
  const before = dump(backend);
  const duplicate = await bindFigures(repository, ACTOR_A, MATTER_ID, {
    targetId: TARGET_A,
    baseFigureRevisionId: EMPTY_SET_A,
    entries: [entry(FIG_1, 1, drawing.drawing.id), entry(FIG_2, 1, drawing.drawing.id)],
  });
  assert.equal(duplicate.error.code, "DUPLICATE_FIGURE_NUMBER");
  const unknown = await bindFigures(repository, ACTOR_A, MATTER_ID, {
    targetId: TARGET_A,
    baseFigureRevisionId: EMPTY_SET_A,
    entries: [entry(FIG_1, 1, "99999999-9999-4999-8999-999999999999")],
  });
  assert.equal(unknown.error.code, "RESOURCE_NOT_FOUND");
  assert.deepEqual(dump(backend), before);
});

test("V6-12-A02 a persisted revision with repeated numbers (legacy import) is reported as DUPLICATE_FIGURE_NUMBER by the export gate", async () => {
  const { backend, repository } = await seed();
  const png = await importOk(repository, "drawing-valid.png");
  const jpg = await importOk(repository, "drawing-valid.jpg");
  // BindFigures refuses repeated numbers, so seed the row the way a legacy
  // import would: a schema-valid revision (the contract allows repeats; they
  // are a check finding) plus a target pointer committed through the repository.
  const entries = [entry(FIG_1, 1, png.drawing.id), entry(FIG_2, 1, jpg.drawing.id)];
  const legacy = {
    id: LEGACY_SET_A,
    matterId: MATTER_ID,
    targetId: TARGET_A,
    parentId: EMPTY_SET_A,
    entries,
    hash: await figureSetHash(entries),
    createdAt: "2026-11-01T00:00:00.000Z",
  };
  assert.equal(figureSetRevisionSchema.safeParse(legacy).success, true, "repeated numbers are schema-valid");
  backend
    .store(STORES.blobs)
    .set(`figures/${TARGET_A}/${LEGACY_SET_A}`, { kind: "figures.set", tenantId: ACTOR_A.tenantId, matterId: MATTER_ID, revision: legacy });
  const aggregate = await aggregateOf(repository);
  const moved = await repository.commit(
    ACTOR_A,
    {
      contractVersion: CONTRACT_VERSION,
      expectedVersion: aggregate.matter.version,
      payload: {
        matter: { ...aggregate.matter, version: aggregate.matter.version + 1 },
        targets: aggregate.targets.map((item) => (item.id === TARGET_A ? { ...item, figureRevisionId: LEGACY_SET_A } : item)),
        assets: aggregate.assets,
        events: [],
        blobs: [],
      },
    },
    { requestId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" },
  );
  assert.equal(moved.ok, true, moved.ok ? "" : JSON.stringify(moved.error));

  const before = dump(backend);
  const gate = await checkFigureExportGate(repository, ACTOR_A, MATTER_ID, { targetId: TARGET_A, referencedFigureIds: [FIG_1, FIG_2] }, { now: clock });
  assert.equal(gate.ok, true);
  assert.equal(gate.data.allowed, false);
  assert.deepEqual(gate.data.reasons, [{ code: "DUPLICATE_FIGURE_NUMBER", resourceId: LEGACY_SET_A }]);
  assert.equal(gate.data.filesAvailable, true, "a numbering finding is not missing bytes");
  assert.deepEqual(dump(backend), before, "the gate reports; it does not repair the legacy row");

  // The panel shows the same refusal, and target B is unaffected.
  const view = await loadFigurePanel(repository, ACTOR_A, MATTER_ID, { targetId: TARGET_A, now: clock });
  assert.deepEqual(view.data.gate.reasons, gate.data.reasons);
  const other = await checkFigureExportGate(repository, ACTOR_A, MATTER_ID, { targetId: TARGET_B }, { now: clock });
  assert.equal(other.data.allowed, true);
});

test("V6-12-A02 a bind from a stale base is INPUT_STALE and names the current revision", async () => {
  const { backend, repository } = await seed();
  const drawing = await importOk(repository, "drawing-valid.png");
  const v1 = await bindOk(repository, TARGET_A, EMPTY_SET_A, [entry(FIG_1, 1, drawing.drawing.id)]);
  const before = dump(backend);
  const stale = await bindFigures(repository, ACTOR_A, MATTER_ID, {
    targetId: TARGET_A,
    baseFigureRevisionId: EMPTY_SET_A,
    entries: [entry(FIG_1, 1, drawing.drawing.id, "另一张标题")],
  });
  assert.equal(stale.ok, false);
  assert.equal(stale.error.code, "INPUT_STALE");
  assert.equal(stale.error.currentFigureRevisionId, v1.current.id);
  assert.deepEqual(dump(backend), before);
});

test("V6-12 body-text references bind to one figure-set revision and unknown numbers are never dropped", async () => {
  const { repository } = await seed();
  const drawing = await importOk(repository, "drawing-valid.png");
  const v1 = await bindOk(repository, TARGET_A, EMPTY_SET_A, [entry(FIG_1, 1, drawing.drawing.id)]);
  const resolution = resolveFigureReferences("如图1所示，结合图 3 与 FIG. 1 说明。", v1.current);
  assert.deepEqual(resolution.references.map((ref) => [ref.text, ref.number, ref.figureId]), [
    ["图1", 1, FIG_1],
    ["图 3", 3, null],
    ["FIG. 1", 1, FIG_1],
  ]);
  assert.deepEqual(resolution.missing.map((ref) => ref.number), [3]);

  // The same text against the empty set resolves nothing, so the revision decides.
  const empty = (await readFigureLibrary(repository, ACTOR_A, MATTER_ID)).data.revisions.find((r) => r.id === EMPTY_SET_A);
  assert.equal(resolveFigureReferences("如图1所示", empty).missing.length, 1);

  const ast = {
    claims: [{ paragraphs: [{ figureIds: [FIG_1] }] }],
    sections: [{ paragraphs: [{ figureIds: [FIG_2, FIG_1] }] }],
  };
  assert.deepEqual(collectFigureIds(ast), [FIG_1, FIG_2]);
});

test("V6-12 fromAssetId must name an existing asset of this matter; nothing else is accepted", async () => {
  const { backend, repository } = await seed();
  const png = await importOk(repository, "drawing-valid.png");
  const before = dump(backend);
  for (const fromAssetId of [
    "99999999-9999-4999-8999-999999999999", // no such asset
    TARGET_A, // an id of this matter, but not an asset
  ]) {
    const result = await importDrawing(
      repository,
      ACTOR_A,
      MATTER_ID,
      { bytes: fixture("drawing-valid.jpg"), fileName: "x.jpg", fromAssetId },
      { now: clock },
    );
    assert.equal(result.ok, false, fromAssetId);
    assert.equal(result.error.code, "RESOURCE_NOT_FOUND", fromAssetId);
  }
  assert.deepEqual(dump(backend), before, "a refused provenance writes nothing");

  const fromOwnAsset = await importDrawing(
    repository,
    ACTOR_A,
    MATTER_ID,
    { bytes: fixture("drawing-valid.jpg"), fileName: "x.jpg", fromAssetId: png.asset.id },
    { now: clock },
  );
  assert.equal(fromOwnAsset.ok, true, fromOwnAsset.ok ? "" : JSON.stringify(fromOwnAsset.error));
  assert.equal(fromOwnAsset.data.drawing.derivedFromAssetId, png.asset.id);
});

test("V6-12 ownership: another user or tenant can neither import into nor read the matter's drawings", async () => {
  const { backend, repository } = await seed();
  const before = dump(backend);
  for (const actor of [ACTOR_OTHER_USER, ACTOR_OTHER_TENANT]) {
    const imported = await importDrawing(repository, actor, MATTER_ID, { bytes: fixture("drawing-valid.png"), fileName: "x.png" });
    assert.equal(imported.ok, false);
    const read = await readDrawingLibrary(repository, actor, MATTER_ID);
    assert.equal(read.ok, false);
    const bind = await bindFigures(repository, actor, MATTER_ID, { targetId: TARGET_A, baseFigureRevisionId: EMPTY_SET_A, entries: [entry(FIG_1, 1, null)] });
    assert.equal(bind.ok, false);
  }
  assert.deepEqual(dump(backend), before);
});

// ---------------------------------------------------------------------------
// V6-12-A03 refresh / retry matches persisted state with no duplicate effect
// ---------------------------------------------------------------------------

test("V6-12-A03 importing the same bytes again writes nothing: duplicate is refused or reused", async () => {
  const { backend, repository } = await seed();
  const first = await importOk(repository, "drawing-valid.png");
  const before = dump(backend);

  const again = await importDrawing(repository, ACTOR_A, MATTER_ID, { bytes: fixture("drawing-valid.png"), fileName: "again.png" }, { now: clock });
  assert.equal(again.ok, false);
  assert.equal(again.error.code, "INVALID_INPUT");
  assert.deepEqual(again.error.resourceIds, [first.drawing.id]);

  const reused = await importOk(repository, "drawing-valid.png", { reuseExisting: true });
  assert.equal(reused.status, "duplicate");
  assert.equal(reused.wrote, false);
  assert.equal(reused.drawing.id, first.drawing.id);
  assert.deepEqual(dump(backend), before, "no new asset, row, blob or event");
});

test("V6-12-A03 retrying a completed bind returns the persisted revision and appends nothing", async () => {
  const { backend, repository } = await seed();
  const drawing = await importOk(repository, "drawing-valid.png");
  const entries = [entry(FIG_1, 1, drawing.drawing.id)];
  const first = await bindOk(repository, TARGET_A, EMPTY_SET_A, entries);
  const before = dump(backend);

  // The page refreshed before it saw the answer and sends the same request.
  const retry = await bindOk(repository, TARGET_A, EMPTY_SET_A, entries);
  assert.equal(retry.current.id, first.current.id);
  // Sending the current base with the same entries is also a no-op.
  const same = await bindOk(repository, TARGET_A, first.current.id, entries);
  assert.equal(same.current.id, first.current.id);
  assert.deepEqual(dump(backend), before);
  assert.equal(events(backend).filter((event) => event.action === "figures.bound").length, 1);
});

test("V6-12-A03 a failed import leaves no partial state and a retry lands exactly once", async () => {
  const { backend, repository } = await seed();
  const before = dump(backend);
  backend.setPutFault(({ store }) => (store === STORES.events ? new Error("disk full") : null));
  const failed = await importDrawing(repository, ACTOR_A, MATTER_ID, { bytes: fixture("drawing-valid.png"), fileName: "a.png" }, { now: clock });
  assert.equal(failed.ok, false);
  assert.deepEqual(dump(backend), before, "asset, blob, event and drawing row all absent");

  backend.setPutFault(null);
  const retried = await importOk(repository, "drawing-valid.png");
  assert.equal(retried.status, "created");
  const again = await importOk(repository, "drawing-valid.png", { reuseExisting: true });
  assert.equal(again.drawing.id, retried.drawing.id);
  const aggregate = await aggregateOf(repository);
  assert.equal(aggregate.assets.filter((asset) => asset.purpose === "drawing").length, 1);
  assert.equal(rowsOfKind(backend, "drawings.drawing").length, 1);
  assert.equal(events(backend).filter((event) => event.action === "source.committed").length, 1);
});

test("V6-12-A03 concurrent imports both land through the version check, each exactly once", async () => {
  const { backend, repository } = await seed();
  const [png, jpg] = await Promise.all([
    importDrawing(repository, ACTOR_A, MATTER_ID, { bytes: fixture("drawing-valid.png"), fileName: "a.png" }, { now: clock }),
    importDrawing(repository, ACTOR_A, MATTER_ID, { bytes: fixture("drawing-valid.jpg"), fileName: "b.jpg" }, { now: clock }),
  ]);
  assert.equal(png.ok, true, JSON.stringify(png.error));
  assert.equal(jpg.ok, true, JSON.stringify(jpg.error));
  const library = await readDrawingLibrary(repository, ACTOR_A, MATTER_ID);
  assert.equal(library.data.length, 2);
  assert.equal(rowsOfKind(backend, "drawings.drawing").length, 2, "the losing attempt's row was removed");
  assert.equal(events(backend).filter((event) => event.action === "source.committed").length, 2);
});

test("V6-12-A03 concurrent identical imports never leave a dangling drawing id", async () => {
  const { backend, repository } = await seed();
  const bytes = fixture("drawing-valid.png");
  const attempts = await Promise.all([
    importDrawing(repository, ACTOR_A, MATTER_ID, { bytes, fileName: "a.png" }, { now: clock }),
    importDrawing(repository, ACTOR_A, MATTER_ID, { bytes, fileName: "b.png" }, { now: clock }),
  ]);
  // One caller stores the bytes; the other must answer duplicate (the same
  // drawing) or reuse it. It must never claim a created row of its own.
  const assets = (await aggregateOf(repository)).assets.filter((asset) => asset.purpose === "drawing");
  assert.equal(assets.length, 1, "exactly one drawing asset");
  assert.equal(rowsOfKind(backend, "drawings.drawing").length, 1, "exactly one drawing row");
  assert.equal(events(backend).filter((event) => event.action === "source.committed").length, 1);
  let created = 0;
  let duplicates = 0;
  for (const attempt of attempts) {
    if (attempt.ok) {
      if (attempt.data.status === "created") created += 1;
      else duplicates += 1;
      assert.equal(attempt.data.asset.id, assets[0].id, "the answer names the persisted asset");
    } else {
      duplicates += 1;
      assert.equal(attempt.error.code, "INVALID_INPUT");
      assert.deepEqual(attempt.error.resourceIds, [rowsOfKind(backend, "drawings.drawing")[0].drawing.id]);
    }
  }
  assert.equal(created, 1);
  assert.equal(duplicates, 1);
  // Every id the caller may have received resolves against persisted state.
  const library = await readDrawingLibrary(repository, ACTOR_A, MATTER_ID);
  assert.deepEqual(library.data.map((item) => item.drawing.id), [rowsOfKind(backend, "drawings.drawing")[0].drawing.id]);
  const libraryBySha = new Map(library.data.map((item) => [item.asset.sha256, item.drawing.id]));
  for (const attempt of attempts) {
    if (attempt.ok) assert.equal(libraryBySha.get(attempt.data.drawing.sha256), attempt.data.drawing.id);
  }
});

test("V6-12-A03 concurrent identical binds keep the pointer on a persisted revision and no orphan rows", async () => {
  const { backend, repository } = await seed();
  const drawing = await importOk(repository, "drawing-valid.png");
  const entries = [entry(FIG_1, 1, drawing.drawing.id)];
  const ofTarget = () => rowsOfKind(backend, "figures.set").filter((row) => row.revision.targetId === TARGET_A);
  const seedRows = ofTarget().length;

  // Force the interleaving the reviewer could not schedule: both binds have
  // read the base revision (so both decided "bind on EMPTY_SET_A") before
  // either writes anything. Read-only transactions are not queued by the
  // backend, so the first read of the base row is held until the second binder
  // has read it too (or a short grace period passes). If an implementation
  // also asks "does my new revision row exist yet?", the first such miss is
  // held the same way, so both binders see "no row" before either writes it:
  // the order in which a shared-key cleanup would delete the winner's row.
  const realTransaction = backend.transaction.bind(backend);
  const pair = () => {
    let release;
    const arrived = new Promise((resolve) => {
      release = resolve;
    });
    const timer = setTimeout(() => release(), 200);
    return { count: 0, arrived, release, timer };
  };
  const base = pair();
  const fresh = pair();
  const hold = async (gate) => {
    gate.count += 1;
    if (gate.count === 1) await gate.arrived;
    else gate.release();
  };
  backend.transaction = (mode, run) => {
    if (mode !== "readonly") return realTransaction(mode, run);
    return realTransaction(mode, (transaction) =>
      run({
        ...transaction,
        get: async (store, key) => {
          const value = await transaction.get(store, key);
          if (store !== STORES.blobs || typeof key !== "string") return value;
          if (base.count < 2 && key === `figures/${TARGET_A}/${EMPTY_SET_A}`) await hold(base);
          else if (fresh.count < 2 && value === undefined && key.startsWith(`figures/${TARGET_A}/`)) await hold(fresh);
          return value;
        },
      }),
    );
  };

  const run = () =>
    bindFigures(repository, ACTOR_A, MATTER_ID, { targetId: TARGET_A, baseFigureRevisionId: EMPTY_SET_A, entries }, { now: clock });
  const results = await Promise.all([run(), run()]);
  clearTimeout(base.timer);
  clearTimeout(fresh.timer);
  backend.transaction = realTransaction;
  const lookups = base.count;
  assert.equal(lookups, 2, "both binders read the base revision before either wrote");

  const target = (await aggregateOf(repository)).targets.find((item) => item.id === TARGET_A);
  const rows = ofTarget();
  assert.equal(rows.length, seedRows + 1, "the seed revision plus exactly one bind revision");
  assert.ok(
    rows.some((row) => row.revision.id === target.figureRevisionId),
    `the target pointer ${target.figureRevisionId} must name an existing revision row`,
  );
  // A bind either landed (both answers name the live revision) or one saw the
  // other's commit first and was told to reload; either way nothing dangles.
  for (const result of results) {
    if (result.ok) assert.equal(result.data.current.id, target.figureRevisionId);
    else assert.equal(result.error.code, "INPUT_STALE");
  }
  assert.equal(events(backend).filter((event) => event.action === "figures.bound").length, 1);
  const gate = await checkFigureExportGate(repository, ACTOR_A, MATTER_ID, { targetId: TARGET_A }, { now: clock });
  assert.equal(gate.data.allowed, true, JSON.stringify(gate.data.reasons));
});

test("V6-12-A03 a reload through a fresh repository shows exactly the persisted library and binding", async () => {
  const { backend, repository } = await seed();
  const drawing = await importOk(repository, "drawing-valid.jpg");
  const bound = await bindOk(repository, TARGET_A, EMPTY_SET_A, [entry(FIG_1, 1, drawing.drawing.id)]);

  const { openLocalRepository } = await import("../../../../apps/web/src/v6/lib/repository.ts");
  const reloaded = openLocalRepository(backend);
  const view = await loadFigurePanel(reloaded, ACTOR_A, MATTER_ID, {
    targetId: TARGET_A,
    draftFigureRevisionId: bound.current.id,
    now: clock,
  });
  assert.equal(view.kind, "library");
  assert.equal(view.stale, false);
  assert.deepEqual(view.data.drawings.map((item) => [item.drawing.id, item.drawing.width, item.drawing.height]), [
    [drawing.drawing.id, 40, 16],
  ]);
  assert.equal(view.data.revisions.get(TARGET_A).id, bound.current.id);
  assert.equal(view.data.revisions.get(TARGET_B).id, EMPTY_SET_B);
  assert.equal(view.data.gate.allowed, true);

  // After a rebind the same draft is reported stale on reload.
  await bindOk(reloaded, TARGET_A, bound.current.id, [entry(FIG_1, 1, drawing.drawing.id, "新标题")]);
  const after = await loadFigurePanel(openLocalRepository(backend), ACTOR_A, MATTER_ID, {
    targetId: TARGET_A,
    draftFigureRevisionId: bound.current.id,
    now: clock,
  });
  assert.equal(after.stale, true);
});
