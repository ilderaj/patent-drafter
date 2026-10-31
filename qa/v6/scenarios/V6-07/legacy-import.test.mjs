/**
 * V6-07 — explicit legacy migration scenarios (S08 import rules, S13,
 * migration contract legacy-import.v2 / V6-07-M01..M03).
 *
 * The suite builds a synthetic `patent-drafter.v1` workspace and legacy asset
 * records, plans the import through `planLegacyImport`, and writes it through
 * `commitLegacyImport` into the real `LocalRepository` over an in-memory
 * backend. Drawings are real, structurally valid PNG and baseline JPEG files
 * built here byte by byte. Every record the import writes is parsed against its
 * frozen contract schema. No real customer material is used.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { crc32, deflateSync } from "node:zlib";

import {
  STORES,
  openLocalRepository,
  sha256Hex,
} from "../../../../apps/web/src/v6/lib/repository.ts";
import {
  LEGACY_STATE_KEY,
  MAX_DRAWING_BYTES,
  MIGRATION_CONTRACT_VERSION,
  MIGRATION_PLAN_VERSION,
  commitLegacyImport,
  planLegacyImport,
  validateDrawing,
} from "../../../../apps/web/src/v6/lib/legacy-import.ts";
import { activitySchema, assetSchema, matterSchema } from "../../../../packages/contracts/src/index.ts";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
const USER_A = "33333333-3333-4333-8333-333333333333";
const USER_B = "44444444-4444-4444-8444-444444444444";
const ACTOR_A = Object.freeze({ tenantId: TENANT_A, userId: USER_A });
const ACTOR_B = Object.freeze({ tenantId: TENANT_B, userId: USER_B });
const NOW = "2026-10-31T00:00:00.000Z";
const LATER = "2026-10-31T00:05:00.000Z";
const REQUEST_IDS = ["dddddddd-dddd-4ddd-8ddd-dddddddddddd", "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", "ffffffff-ffff-4fff-8fff-ffffffffffff"];

/** Document text that must never reach a report or an event. */
const SECRET_CLAIM = "V6-07 合成权利要求：一种示例装置，包括壳体与传感器。";
/** Claim text that also fits the old legacy-id shape, so no regex can catch it. */
const ASCII_SECRET = "claim-1.a_housing.comprising.a_sensor";

// ---------------------------------------------------------------------------
// Synthetic image files
// ---------------------------------------------------------------------------

function u32(value) {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

function pngChunk(type, data) {
  const typed = Buffer.concat([Buffer.from(type, "latin1"), Buffer.from(data)]);
  return Buffer.concat([Buffer.from(u32(data.length)), typed, Buffer.from(u32(crc32(typed)))]);
}

/**
 * A complete PNG: signature, IHDR, optional PLTE, a zlib IDAT holding real
 * filtered scanlines, IEND. `seed` varies the pixels so each file differs.
 */
function makePng({ width = 4, height = 3, seed = 1, colourType = 2, depth = 8, extra = [], idat = null } = {}) {
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colourType];
  const rowBytes = Math.ceil((width * channels * depth) / 8);
  const raw = Buffer.alloc((rowBytes + 1) * height);
  for (let row = 0; row < height; row += 1) {
    for (let col = 0; col < rowBytes; col += 1) raw[row * (rowBytes + 1) + 1 + col] = (seed * 31 + row * 7 + col) & (colourType === 3 ? 0 : 0xff);
  }
  const chunks = [pngChunk("IHDR", [...u32(width), ...u32(height), depth, colourType, 0, 0, 0])];
  if (colourType === 3) chunks.push(pngChunk("PLTE", [0, 0, 0, 255, 255, 255]));
  chunks.push(...extra);
  chunks.push(pngChunk("IDAT", idat ?? deflateSync(raw)));
  chunks.push(pngChunk("IEND", []));
  return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), ...chunks]));
}

function segment(marker, payload) {
  return [0xff, marker, ((payload.length + 2) >> 8) & 0xff, (payload.length + 2) & 0xff, ...payload];
}

/**
 * A baseline greyscale JPEG: SOI, JFIF APP0, an optional APP1 Exif block, a
 * comment carrying `seed`, one quantisation table, SOF0, minimal DC/AC Huffman
 * tables, SOS, entropy data for one all-zero 8x8 block (DC category 0, EOB),
 * EOI. Decodable by any baseline decoder when width and height are 8; other
 * sizes are header-only fixtures.
 */
function makeJpeg({ width = 8, height = 8, seed = 1, orientation = null, exif = null } = {}) {
  return new Uint8Array([
    0xff, 0xd8,
    ...segment(0xe0, [0x4a, 0x46, 0x49, 0x46, 0x00, 1, 1, 0, 0, 1, 0, 1, 0, 0]),
    ...(exif !== null ? exif : orientation === null ? [] : exifApp1(orientation)),
    ...segment(0xfe, [...Buffer.from(`v6-07 synthetic ${seed}`, "latin1")]),
    ...segment(0xdb, [0x00, ...new Array(64).fill(1)]),
    ...segment(0xc0, [8, (height >> 8) & 0xff, height & 0xff, (width >> 8) & 0xff, width & 0xff, 1, 1, 0x11, 0]),
    ...segment(0xc4, [0x00, 1, ...new Array(15).fill(0), 0x00]),
    ...segment(0xc4, [0x10, 1, ...new Array(15).fill(0), 0x00]),
    ...segment(0xda, [1, 1, 0x00, 0, 63, 0]),
    0x3f,
    0xff, 0xd9,
  ]);
}

/** APP1 "Exif" block with one little-endian IFD0 holding the Orientation tag. */
function exifApp1(orientation, { type = 3, signature = "Exif\0\0" } = {}) {
  const tiff = [
    0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00,
    0x01, 0x00,
    0x12, 0x01, type & 0xff, 0x00, 0x01, 0x00, 0x00, 0x00, orientation & 0xff, (orientation >> 8) & 0xff, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
  ];
  return segment(0xe1, [...Buffer.from(signature, "latin1"), ...tiff]);
}

const PNG_ONE = makePng({ seed: 1 });
const JPEG_TWO = makeJpeg({ seed: 2 });
const PNG_LOST = makePng({ seed: 3 });
const PNG_TAMPERED = makePng({ seed: 4 });

async function assetMeta(id, bytes, overrides = {}) {
  const isPng = bytes[0] === 0x89;
  return {
    id,
    sha256: await sha256Hex(bytes),
    mime: isPng ? "image/png" : "image/jpeg",
    byteSize: bytes.byteLength,
    width: isPng ? 4 : 8,
    height: isPng ? 3 : 8,
    originalName: `${id}.${isPng ? "png" : "jpg"}`,
    importedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

async function legacyFigure(id, assetId, bytes, overrides = {}) {
  const asset = await assetMeta(assetId, bytes, overrides);
  return { id, title: `Figure ${id}`, mode: "auto", badge: "", previewLabel: "", asset: { ...asset, originalName: `${id}.${asset.mime === "image/png" ? "png" : "jpg"}` } };
}

function legacyInput(projects, assets = [], extra = {}) {
  return { stateKey: LEGACY_STATE_KEY, stateJson: JSON.stringify({ projects, ...extra }), assets };
}

/** Same backend contract as the V6-06 suite: one transaction, clones, abort rolls back. */
class MemoryBackend {
  constructor() {
    this.data = new Map(Object.values(STORES).map((name) => [name, new Map()]));
    this.failPut = null;
    this.queue = Promise.resolve();
  }

  transaction(mode, run) {
    if (mode === "readwrite") {
      const next = this.queue.then(() => this.runTransaction(mode, run));
      this.queue = next.then(() => undefined, () => undefined);
      return next;
    }
    return this.runTransaction(mode, run);
  }

  async runTransaction(mode, run) {
    const snapshot = new Map([...this.data].map(([name, store]) => [name, new Map(store)]));
    const store = (name) => this.data.get(name);
    const tx = {
      get: async (name, key) => {
        const value = store(name).get(key);
        return value === undefined ? undefined : structuredClone(value);
      },
      put: async (name, key, value) => {
        const fault = this.failPut?.({ store: name, key, mode }) ?? null;
        if (fault) throw fault;
        store(name).set(key, structuredClone(value));
      },
      delete: async (name, key) => {
        store(name).delete(key);
      },
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

/** A synthetic legacy workspace covering the main branches the import handles. */
async function legacyWorkspace() {
  const withDrawings = {
    id: "legacy-p1",
    name: "  Legacy sensor housing  ",
    patentType: "invention",
    updatedAt: "2026-01-02T00:00:00.000Z",
    status: "draft",
    claims: [{ id: "c1", text: SECRET_CLAIM }],
    abstractText: SECRET_CLAIM,
    figures: [
      await legacyFigure("f1", "asset-1", PNG_ONE),
      await legacyFigure("f2", "asset-2", JPEG_TWO),
      { id: "f3", title: "placeholder", mode: "brief", badge: "", previewLabel: "" },
    ],
    archivedFigures: [await legacyFigure("f0", "asset-1", PNG_ONE)],
    revisions: [{ id: "r1", no: 1 }, { id: "r2", no: 2 }],
    materials: [{ id: "m1", kind: "note", name: "note", text: SECRET_CLAIM, addedAt: NOW }],
    audit: { passed: 1, warnings: 0, errors: 0, rows: [], checks: [] },
    reviewRecords: [{ id: "rev-1", kind: "external", person: "Someone", role: "agent", scope: SECRET_CLAIM, conclusion: "no_issues", reservations: "", at: NOW }],
    ownerReview: { revisionId: "r2", at: NOW },
  };
  const damaged = {
    id: "legacy-p2",
    name: "Damaged drawings",
    figures: [
      await legacyFigure("g1", "asset-lost", PNG_LOST),
      await legacyFigure("g2", "asset-tampered", JPEG_TWO),
      await legacyFigure("g3", "asset-gif", PNG_ONE, { mime: "image/gif" }),
    ],
  };
  const demo = { id: "legacy-demo", name: "Demo", demo: true, figures: [] };
  const unknownShape = { id: "legacy-p3", title: "no name field", figures: "not-an-array" };
  const state = { projects: [withDrawings, damaged, demo, unknownShape, 42], currentId: "legacy-p1", bridgeMode: "none" };
  return {
    stateKey: LEGACY_STATE_KEY,
    stateJson: JSON.stringify(state),
    assets: [
      { id: "asset-1", bytes: PNG_ONE.slice().buffer, mime: "image/png" },
      { id: "asset-2", bytes: JPEG_TWO.slice(), mime: "image/jpeg" },
      { id: "asset-tampered", bytes: PNG_TAMPERED.slice().buffer, mime: "image/jpeg" },
    ],
  };
}

function freshConfirmed() {
  let i = 0;
  return { confirmed: true, requestId: () => REQUEST_IDS[i++ % REQUEST_IDS.length] };
}

const plan = (input, now = NOW) => planLegacyImport(input, { actor: ACTOR_A, now });
const codes = (items) => items.map((item) => [item.code, item.legacyProjectId, item.legacyItemId]);

// ---------------------------------------------------------------------------
// Fixture self-check
// ---------------------------------------------------------------------------

test("fixtures: the synthetic PNG and JPEG files pass the structural validator", () => {
  assert.deepEqual(validateDrawing("image/png", PNG_ONE), { ok: true, dimensions: { width: 4, height: 3 } });
  assert.deepEqual(validateDrawing("image/jpeg", JPEG_TWO), { ok: true, dimensions: { width: 8, height: 8 } });
  assert.deepEqual(validateDrawing("image/png", makePng({ colourType: 3, depth: 8 })).ok, true);
  assert.deepEqual(validateDrawing("image/png", makePng({ colourType: 6, depth: 16 })).ok, true);
});

// ---------------------------------------------------------------------------
// V6-07-A01..A03 (updated for legacy-import.v2)
// ---------------------------------------------------------------------------

test("V6-07-A01: a matter with PNG and JPEG drawings imports with byte-identical hashes", async () => {
  const input = await legacyWorkspace();
  const planned = await plan(input);
  assert.equal(planned.contractVersion, MIGRATION_CONTRACT_VERSION);
  assert.equal(MIGRATION_CONTRACT_VERSION, "legacy-import.v2");
  assert.equal(planned.planVersion, MIGRATION_PLAN_VERSION);
  assert.equal(planned.report.contractVersion, "legacy-import.v2");
  assert.equal(planned.report.reportVersion, 2);

  const repo = openLocalRepository(new MemoryBackend());
  const committed = await commitLegacyImport(repo, ACTOR_A, planned, freshConfirmed());
  assert.equal(committed.ok, true);
  assert.deepEqual(committed.outcomes.map((o) => [o.legacyProjectId, o.status]), [["#0", "imported"], ["#1", "imported"]]);

  const first = planned.matters[0];
  const loaded = await repo.loadMatter(ACTOR_A, first.write.matter.id);
  assert.equal(loaded.ok, true);
  matterSchema.parse(loaded.data.data.matter);
  assert.equal(loaded.data.data.matter.title, "Legacy sensor housing");
  // asset-1 is in both the current and archived set; it is one asset.
  assert.equal(loaded.data.data.assets.length, 2);
  const byName = { "f1.png": PNG_ONE, "f2.jpg": JPEG_TWO };
  for (const asset of loaded.data.data.assets) {
    assetSchema.parse(asset);
    assert.equal(asset.state, "available");
    assert.equal(asset.purpose, "drawing");
    const original = byName[asset.originalName];
    assert.ok(original, asset.originalName);
    const blob = await repo.readBlob(ACTOR_A, asset.id);
    assert.equal(blob.ok, true);
    assert.deepEqual(blob.data.data.bytes, original);
    assert.equal(asset.sha256, await sha256Hex(original));
  }
  assert.deepEqual(Object.keys(first.assetRefs), ["#asset:0", "#asset:1"]);
  assert.deepEqual(Object.values(first.assetRefs).sort(), loaded.data.data.assets.map((a) => a.id).sort());
  assert.equal(planned.report.drawingsAvailable, 2);

  const events = await repo.listEvents(ACTOR_A, first.write.matter.id);
  assert.deepEqual(events.data.items.map((e) => e.action), ["matter.created"]);
  for (const event of events.data.items) activitySchema.parse(event);
});

test("V6-07-A02: missing bytes and unknown versions are listed and never become trusted approval", async () => {
  const input = await legacyWorkspace();
  const planned = await plan(input);
  const { report } = planned;

  assert.equal(report.readable, true);
  assert.equal(report.projectsFound, 5);
  assert.equal(report.mattersPlanned, 2);
  assert.deepEqual(codes(report.missingBytes), [["MISSING_BYTES", "#1", "#asset:0"]]);
  assert.deepEqual(codes(report.hashMismatches), [["HASH_MISMATCH", "#1", "#asset:1"]]);
  assert.deepEqual(codes(report.unknownVersions), [["UNKNOWN_VERSION", "#3", null], ["UNKNOWN_VERSION", "#4", null]]);
  assert.deepEqual(codes(report.unconvertible), [["DEMO_SKIPPED", "#2", null]]);
  assert.deepEqual(codes(report.issues), [
    ["UNSUPPORTED_MEDIA", "#1", "#asset:2"],
    ["MALFORMED_COLLECTION", "#3", "#collection:figures"],
  ]);
  assert.deepEqual(report.legacyUnverified, [
    { legacyProjectId: "#0", legacyItemId: "#review:0", kind: "review_record", identity: "legacy_unverified" },
    { legacyProjectId: "#0", legacyItemId: "#owner-review", kind: "owner_review", identity: "legacy_unverified" },
  ]);
  assert.deepEqual(report.deferred, [
    { legacyProjectId: "#0", kind: "draft_revision", count: 2 },
    { legacyProjectId: "#0", kind: "material", count: 1 },
    { legacyProjectId: "#0", kind: "check", count: 1 },
    { legacyProjectId: "#0", kind: "figure_metadata", count: 4 },
    { legacyProjectId: "#1", kind: "figure_metadata", count: 3 },
  ]);

  // Unconfirmed commit writes nothing.
  const backend = new MemoryBackend();
  const repo = openLocalRepository(backend);
  const refused = await commitLegacyImport(repo, ACTOR_A, planned, { confirmed: "yes", requestId: () => REQUEST_IDS[0] });
  assert.deepEqual(refused, { ok: false, error: { code: "CONFIRMATION_REQUIRED", message: "the import report must be confirmed first" } });
  assert.equal(backend.rowCount(), 0);

  // Confirmed: damaged drawings keep their state, store no bytes, and no event
  // turns a legacy review into a confirmation, approval or check.
  const committed = await commitLegacyImport(repo, ACTOR_A, planned, freshConfirmed());
  assert.equal(committed.ok, true);
  const loaded = await repo.loadMatter(ACTOR_A, planned.matters[1].write.matter.id);
  const states = loaded.data.data.assets.map((a) => [a.originalName, a.state]).sort();
  assert.deepEqual(states, [["g1.png", "missing_bytes"], ["g2.jpg", "quarantined"]]);
  for (const asset of loaded.data.data.assets) {
    assetSchema.parse(asset);
    const blob = await repo.readBlob(ACTOR_A, asset.id);
    assert.equal(blob.ok, false);
    assert.equal(blob.error.code, "RESOURCE_NOT_FOUND");
  }
  const actions = [...backend.data.get(STORES.events).values()].map((e) => e.action);
  assert.deepEqual(actions, ["matter.created", "matter.created"]);

  // Repeating the plan lists the same problems; nothing is upgraded to trusted.
  const again = await plan(input, LATER);
  assert.deepEqual(again.report, report);
});

test("V6-07-A02: unreadable or foreign-version state imports nothing", async () => {
  const invalid = await plan({ stateKey: LEGACY_STATE_KEY, stateJson: "{not json", assets: [] });
  assert.equal(invalid.report.readable, false);
  assert.deepEqual(codes(invalid.report.unconvertible), [["IMPORT_INVALID", null, null]]);
  assert.equal(invalid.matters.length, 0);

  const notState = await plan({ stateKey: LEGACY_STATE_KEY, stateJson: "[1,2]", assets: [] });
  assert.equal(notState.report.readable, false);
  assert.equal(notState.matters.length, 0);

  const projectsNotArray = await plan({ stateKey: LEGACY_STATE_KEY, stateJson: "{\"projects\":{\"0\":{}}}", assets: [] });
  assert.equal(projectsNotArray.report.readable, false);
  assert.deepEqual(codes(projectsNotArray.report.issues), [["MALFORMED_COLLECTION", null, "#collection:projects"]]);

  const foreign = await plan({ stateKey: "patent-drafter.v2", stateJson: "{\"projects\":[]}", assets: [] });
  assert.equal(foreign.report.readable, false);
  assert.deepEqual(codes(foreign.report.unknownVersions), [["UNKNOWN_VERSION", null, null]]);
  assert.equal(foreign.matters.length, 0);

  const empty = await plan({ stateKey: LEGACY_STATE_KEY, stateJson: null, assets: [] });
  assert.equal(empty.report.readable, true);
  assert.equal(empty.matters.length, 0);
});

test("V6-07-A03: the same input plans the same result and is not mutated", async () => {
  const input = await legacyWorkspace();
  const before = structuredClone(input);
  const first = await plan(input);
  const second = await plan(input);
  assert.deepEqual(first, second);
  assert.deepEqual(input, before);
  assert.ok(Object.isFrozen(first.matters[0].write.events));
  assert.ok(Object.isFrozen(first.report.issues));

  // Changing a planned blob does not reach the caller's legacy buffer.
  first.matters[0].write.blobs[0].bytes.fill(0);
  assert.deepEqual(input, before);
});

test("V6-07-A03/M03: a storage fault retries cleanly and its exception text never reaches the outcome", async () => {
  const input = await legacyWorkspace();
  const backend = new MemoryBackend();
  const repo = openLocalRepository(backend);

  // First attempt fails while writing the second matter; the first stays.
  let writes = 0;
  backend.failPut = ({ store }) =>
    store === STORES.matters && ++writes === 2 ? new Error(`disk failed at /Users/someone/${ASCII_SECRET}: ${SECRET_CLAIM}`) : null;
  const planned = await plan(input);
  const failed = await commitLegacyImport(repo, ACTOR_A, planned, freshConfirmed());
  assert.deepEqual(failed.outcomes.map((o) => o.status), ["imported", "failed"]);
  assert.deepEqual(failed.outcomes[1].error, { code: "STORAGE_UNAVAILABLE", message: "local storage is unavailable; retry later" });
  const text = JSON.stringify(failed);
  assert.ok(!text.includes(SECRET_CLAIM) && !text.includes(ASCII_SECRET) && !text.includes("/Users/"));
  backend.failPut = null;

  // A refresh re-plans (new clock) and retries: the finished matter is reported
  // as already imported, the failed one is written now.
  const replan = await plan(input, LATER);
  const retried = await commitLegacyImport(repo, ACTOR_A, replan, freshConfirmed());
  assert.deepEqual(retried.outcomes.map((o) => o.status), ["already_imported", "imported"]);
  assert.deepEqual(retried.outcomes.map((o) => o.matterId), planned.matters.map((m) => m.write.matter.id));

  const third = await commitLegacyImport(repo, ACTOR_A, replan, freshConfirmed());
  assert.deepEqual(third.outcomes.map((o) => o.status), ["already_imported", "already_imported"]);

  assert.equal((await repo.listMatters(ACTOR_A)).data.items.length, 2);
  assert.equal(backend.data.get(STORES.events).size, 2);
  assert.equal(backend.data.get(STORES.blobs).size, 2);
});

test("V6-07-M03: a quota exception is reported by its code with static text", async () => {
  const backend = new MemoryBackend();
  backend.failPut = () => Object.assign(new Error(SECRET_CLAIM), { name: "QuotaExceededError" });
  const planned = await plan(await legacyWorkspace());
  const result = await commitLegacyImport(openLocalRepository(backend), ACTOR_A, planned, freshConfirmed());
  assert.deepEqual(result.outcomes.map((o) => [o.status, o.error.code, o.error.message]), [
    ["failed", "QUOTA_EXCEEDED", "local storage is full; free space and retry"],
    ["failed", "QUOTA_EXCEEDED", "local storage is full; free space and retry"],
  ]);
  assert.ok(!JSON.stringify(result).includes(SECRET_CLAIM));
  assert.equal(backend.rowCount(), 0);
});

test("V6-07-A01: legacy ids that concatenate alike still import to separate assets", async () => {
  const bytesA = makePng({ seed: 11 });
  const bytesB = makePng({ seed: 12 });
  const input = legacyInput(
    [
      { id: "a/b", name: "First", figures: [await legacyFigure("f1", "c", bytesA)] },
      { id: "a", name: "Second", figures: [await legacyFigure("f1", "b/c", bytesB)] },
    ],
    [{ id: "c", bytes: bytesA.slice() }, { id: "b/c", bytes: bytesB.slice() }],
  );
  const planned = await plan(input);
  const [first, second] = planned.matters.map((m) => m.write.assets[0].id);
  assert.notEqual(first, second);
  const backend = new MemoryBackend();
  const repo = openLocalRepository(backend);
  const committed = await commitLegacyImport(repo, ACTOR_A, planned, freshConfirmed());
  assert.deepEqual(committed.outcomes.map((o) => [o.legacyProjectId, o.status]), [["#0", "imported"], ["#1", "imported"]]);
  assert.equal(backend.data.get(STORES.blobs).size, 2);
  assert.deepEqual((await repo.readBlob(ACTOR_A, first)).data.data.bytes, bytesA);
  assert.deepEqual((await repo.readBlob(ACTOR_A, second)).data.data.bytes, bytesB);
});

test("V6-07-A02: historical drawings read back and older shapes are all reported", async () => {
  const history = makePng({ seed: 21 });
  const lostHistory = makePng({ seed: 22 });
  const current = await legacyFigure("h1", "asset-current", PNG_ONE);
  current.revisions = [
    { id: "fr1", no: 1, asset: await assetMeta("asset-history", history) },
    { id: "fr2", no: 2, asset: await assetMeta("asset-history-lost", lostHistory) },
    { id: "fr3", no: 3 },
    { id: "fr4", no: 4, asset: await assetMeta("asset-current", PNG_ONE) },
  ];
  const noIdAsset = await legacyFigure("h2", "unused", JPEG_TWO);
  delete noIdAsset.asset.id;
  const project = {
    id: "legacy-old",
    name: "Pre-revision project",
    claims: [{ id: "c1", label: "1", text: SECRET_CLAIM, sources: [] }],
    specSections: [{ id: "s1", title: "背景", body: SECRET_CLAIM }],
    abstractText: SECRET_CLAIM,
    files: [{ id: "file-1", name: "disclosure.docx", text: SECRET_CLAIM }],
    feedback: [{ id: "fb-1", text: SECRET_CLAIM }],
    intakeAnswers: [{ id: 1, note: SECRET_CLAIM }],
    strategy: { type: "invention", reason: SECRET_CLAIM },
    traceCheck: { scope: "source-text-match" },
    versions: [{ version: "v1", note: "", meta: "" }],
    live: { disclosure: SECRET_CLAIM },
    figureBrief: SECRET_CLAIM,
    figures: [current, noIdAsset, { id: "h3", title: "bad asset", asset: "not-a-record" }, "not-a-figure"],
  };
  const input = legacyInput([project], [
    { id: "asset-current", bytes: PNG_ONE.slice() },
    { id: "asset-history", bytes: history.slice() },
  ]);
  const planned = await plan(input);
  const { report } = planned;
  assert.equal(report.drawingsAvailable, 2);
  assert.deepEqual(codes(report.missingBytes), [["MISSING_BYTES", "#0", "#asset:2"]]);
  assert.deepEqual(codes(report.issues), [
    ["MALFORMED_ENTRY", "#0", "#1"],
    ["MALFORMED_ENTRY", "#0", "#2"],
    ["MALFORMED_ENTRY", "#0", "#3"],
  ]);
  assert.deepEqual(report.deferred, [
    { legacyProjectId: "#0", kind: "working_draft", count: 1 },
    { legacyProjectId: "#0", kind: "material", count: 1 },
    { legacyProjectId: "#0", kind: "feedback", count: 1 },
    { legacyProjectId: "#0", kind: "intake", count: 1 },
    { legacyProjectId: "#0", kind: "strategy", count: 1 },
    { legacyProjectId: "#0", kind: "check", count: 1 },
    { legacyProjectId: "#0", kind: "export_record", count: 1 },
    { legacyProjectId: "#0", kind: "pipeline_state", count: 1 },
    { legacyProjectId: "#0", kind: "figure_metadata", count: 3 },
    { legacyProjectId: "#0", kind: "figure_history", count: 4 },
    { legacyProjectId: "#0", kind: "figure_brief", count: 1 },
  ]);
  const states = planned.matters[0].write.assets.map((a) => a.state);
  assert.deepEqual(states, ["available", "available", "missing_bytes"]);
  for (const asset of planned.matters[0].write.assets) assetSchema.parse(asset);
  assert.ok(!JSON.stringify(report).includes(SECRET_CLAIM));

  // The drawing found only in a figure's history reads back byte for byte.
  const repo = openLocalRepository(new MemoryBackend());
  await commitLegacyImport(repo, ACTOR_A, planned, freshConfirmed());
  const historical = await repo.readBlob(ACTOR_A, planned.matters[0].assetRefs["#asset:1"]);
  assert.equal(historical.ok, true);
  assert.deepEqual(historical.data.data.bytes, history);
});

// ---------------------------------------------------------------------------
// V6-07-M01: everything left behind is named
// ---------------------------------------------------------------------------

test("V6-07-M01: an assetHash with no asset is reported, not treated as a placeholder", async () => {
  const input = legacyInput([
    {
      id: "p",
      name: "Hash only",
      figures: [
        { id: "f1", title: "hash only", assetHash: await sha256Hex(PNG_ONE) },
        { id: "f2", title: "placeholder" },
      ],
    },
  ], [{ id: "x", bytes: PNG_ONE.slice() }]);
  const { report, matters } = await plan(input);
  assert.deepEqual(codes(report.issues), [["ASSET_HASH_WITHOUT_ASSET", "#0", "#0"]]);
  assert.equal(matters[0].write.assets.length, 0);
  assert.deepEqual(report.orphanAssets, [{ assetRef: "#supplied:0" }]);
});

test("V6-07-M01: draft revision snapshot references are counted and dangling ones reported", async () => {
  const snapshotOnly = makePng({ seed: 31 });
  const project = {
    id: "p",
    name: "Snapshots",
    figures: [await legacyFigure("f1", "asset-1", PNG_ONE)],
    revisions: [
      { id: "r1", no: 1, snapshot: {}, figures: [{ id: "f1", title: "F1", assetId: "asset-1" }, { id: "f9", title: "gone", assetId: "asset-snapshot-only" }] },
      { id: "r2", no: 2, snapshot: {}, figures: [{ id: "f1", title: "no asset id" }, "not-an-entry"] },
      { id: "r3", no: 3, snapshot: {}, figures: "not-an-array" },
    ],
  };
  const input = legacyInput([project], [
    { id: "asset-1", bytes: PNG_ONE.slice() },
    { id: "asset-snapshot-only", bytes: snapshotOnly.slice() },
  ]);
  const { report, matters } = await plan(input);
  assert.deepEqual(codes(report.issues), [
    ["DANGLING_ASSET_REFERENCE", "#0", "#snapshot:0:1"],
    ["MALFORMED_ENTRY", "#0", "#snapshot:1:0"],
    ["MALFORMED_ENTRY", "#0", "#snapshot:1:1"],
    ["MALFORMED_COLLECTION", "#0", "#collection:revisions[].figures"],
  ]);
  assert.deepEqual(report.deferred, [
    { legacyProjectId: "#0", kind: "draft_revision", count: 3 },
    { legacyProjectId: "#0", kind: "figure_metadata", count: 1 },
    { legacyProjectId: "#0", kind: "draft_figure_snapshot", count: 4 },
  ]);
  // The snapshot-only drawing is referenced, so it is not an orphan, and it is
  // not silently imported either.
  assert.deepEqual(report.orphanAssets, []);
  assert.equal(matters[0].write.assets.length, 1);
  assert.equal(report.drawingsAvailable, 1);
});

test("V6-07-M01: orphan asset records and malformed collections are reported, not read as empty", async () => {
  const project = {
    id: "p",
    name: "Malformed",
    figures: [],
    archivedFigures: { 0: "x" },
    materials: "a string",
    feedback: 7,
    revisions: {},
    figureBrief: 12,
    reviewRecords: [null],
  };
  const input = legacyInput([project], [
    { id: "o1", bytes: PNG_ONE.slice() },
    { id: "o2", bytes: JPEG_TWO.slice() },
    { id: "", bytes: PNG_ONE.slice() },
  ]);
  const { report } = await plan(input);
  assert.deepEqual(codes(report.issues), [
    ["MALFORMED_COLLECTION", "#0", "#collection:archivedFigures"],
    ["MALFORMED_COLLECTION", "#0", "#collection:figureBrief"],
    ["MALFORMED_ENTRY", "#0", "#review:0"],
    ["MALFORMED_COLLECTION", "#0", "#collection:revisions"],
    ["MALFORMED_COLLECTION", "#0", "#collection:materials"],
    ["MALFORMED_COLLECTION", "#0", "#collection:feedback"],
  ]);
  assert.deepEqual(report.deferred, [
    { legacyProjectId: "#0", kind: "draft_revision", count: 1 },
    { legacyProjectId: "#0", kind: "material", count: 1 },
    { legacyProjectId: "#0", kind: "feedback", count: 1 },
  ]);
  assert.deepEqual(report.legacyUnverified.map((item) => item.legacyItemId), ["#review:0"]);
  assert.deepEqual(report.orphanAssets, [{ assetRef: "#supplied:0" }, { assetRef: "#supplied:1" }, { assetRef: "#supplied:2" }]);
});

test("V6-07-M01: a malformed review, owner review or singular field is reported, never read as absent", async () => {
  const project = {
    id: "p",
    name: "Reviews",
    figures: [],
    reviewRecords: "not-an-array",
    ownerReview: "signed",
    strategy: "plan",
    audit: [],
    traceCheck: 3,
    live: "on",
  };
  const { report } = await plan(legacyInput([project]));
  const found = codes(report.issues);
  assert.ok(found.some(([code, ref, item]) => code === "MALFORMED_COLLECTION" && ref === "#0" && item === "#collection:reviewRecords"), JSON.stringify(found));
  assert.ok(found.some(([code, ref, item]) => code === "MALFORMED_ENTRY" && ref === "#0" && item === "#owner-review"), JSON.stringify(found));
  for (const field of ["strategy", "audit", "traceCheck", "live"]) {
    assert.ok(found.some(([code, ref, item]) => code === "MALFORMED_ENTRY" && ref === "#0" && item === `#field:${field}`), field);
  }
  // The unusable collection still names one review item for the confirmation.
  assert.deepEqual(report.legacyUnverified, [
    { legacyProjectId: "#0", legacyItemId: "#collection:reviewRecords", kind: "review_record", identity: "legacy_unverified" },
  ]);
  // A null review collection is the old store's "no value", like other collections.
  const empty = await plan(legacyInput([{ id: "p", name: "None", figures: [], reviewRecords: null, ownerReview: null }]));
  assert.deepEqual(empty.report.issues, []);
  assert.deepEqual(empty.report.legacyUnverified, []);
});

test("V6-07-M01: a long project name is imported unchanged", async () => {
  const name = "案".repeat(503);
  const planned = await plan(legacyInput([{ id: "p", name, figures: [] }]));
  assert.equal(planned.matters[0].write.matter.title, name);
  assert.deepEqual(planned.report.issues, []);
  const committed = await commitLegacyImport(openLocalRepository(new MemoryBackend()), ACTOR_A, planned, freshConfirmed());
  assert.equal(committed.ok, true, JSON.stringify(committed));
});

test("V6-07-M01: an asset used only by an unplannable project is not reported as an orphan", async () => {
  const input = legacyInput([{ id: "p", title: "no name", figures: [await legacyFigure("f1", "a1", PNG_ONE)] }], [{ id: "a1", bytes: PNG_ONE.slice() }]);
  const { report } = await plan(input);
  assert.deepEqual(codes(report.unknownVersions), [["UNKNOWN_VERSION", "#0", null]]);
  assert.deepEqual(report.orphanAssets, []);

  // A malformed collection may still hide the only reference to an asset.
  const hidden = legacyInput(
    [{ id: "p", name: "Malformed figures", figures: { 0: { asset: { id: "a2" } } } }],
    [{ id: "a2", bytes: PNG_ONE.slice() }],
  );
  const hiddenReport = (await plan(hidden)).report;
  assert.deepEqual(codes(hiddenReport.unknownVersions), [["UNKNOWN_VERSION", "#0", null]]);
  assert.deepEqual(hiddenReport.orphanAssets, []);
});

// ---------------------------------------------------------------------------
// V6-07-M02: nothing unverified becomes an available drawing
// ---------------------------------------------------------------------------

async function singleDrawing(meta, supplied) {
  const input = legacyInput([{ id: "p", name: "One", figures: [{ id: "f", title: "F", asset: meta }] }], supplied === null ? [] : [{ id: meta.id ?? "a", ...supplied }]);
  const planned = await plan(input);
  return { planned, report: planned.report, assets: planned.matters[0].write.assets, blobs: planned.matters[0].write.blobs };
}

test("V6-07-M02: the same id with a different digest, mime or size is quarantined with no bytes", async () => {
  const other = makePng({ seed: 41 });
  for (const variant of [
    { sha256: await sha256Hex(other) },
    { mime: "image/jpeg" },
    { byteSize: PNG_ONE.byteLength + 1 },
    { width: 5 },
  ]) {
    const project = {
      id: "p",
      name: "Conflict",
      figures: [await legacyFigure("f1", "dup", PNG_ONE)],
      archivedFigures: [await legacyFigure("f2", "dup", PNG_ONE, variant)],
    };
    const { report, matters } = await plan(legacyInput([project], [{ id: "dup", bytes: PNG_ONE.slice() }]));
    assert.deepEqual(codes(report.issues), [["ASSET_CONFLICT", "#0", "#asset:0"]], JSON.stringify(variant));
    assert.deepEqual(matters[0].write.assets.map((a) => a.state), ["quarantined"]);
    assert.equal(matters[0].write.blobs.length, 0);
    assert.equal(report.drawingsAvailable, 0);
  }

  // A malformed reference sharing the id still disagrees with the good one.
  const project = {
    id: "p",
    name: "Conflict",
    figures: [await legacyFigure("f1", "dup", PNG_ONE)],
    archivedFigures: [await legacyFigure("f2", "dup", PNG_ONE, { sha256: "not-a-digest" })],
  };
  const { report, matters } = await plan(legacyInput([project], [{ id: "dup", bytes: PNG_ONE.slice() }]));
  assert.deepEqual(codes(report.issues), [["INVALID_ASSET_REFERENCE", "#0", "#asset:0"], ["ASSET_CONFLICT", "#0", "#asset:0"]]);
  assert.deepEqual(matters[0].write.assets.map((a) => a.state), ["quarantined"]);

  // Identical references to one id are deduplicated into one available asset.
  const same = {
    id: "p",
    name: "Same",
    figures: [await legacyFigure("f1", "dup", PNG_ONE)],
    archivedFigures: [await legacyFigure("f2", "dup", PNG_ONE)],
  };
  const deduped = await plan(legacyInput([same], [{ id: "dup", bytes: PNG_ONE.slice() }]));
  assert.deepEqual(deduped.matters[0].write.assets.map((a) => a.state), ["available"]);
  assert.equal(deduped.matters[0].write.blobs.length, 1);
});

test("V6-07-M02: two stored records with one id and different bytes are a conflict", async () => {
  const { report, assets, blobs } = await singleDrawing(await assetMeta("a", PNG_ONE), { bytes: PNG_ONE.slice() });
  assert.equal(assets[0].state, "available");
  assert.equal(blobs.length, 1);
  assert.equal(report.issues.length, 0);

  const input = legacyInput([{ id: "p", name: "One", figures: [{ id: "f", asset: await assetMeta("a", PNG_ONE) }] }], [
    { id: "a", bytes: PNG_ONE.slice() },
    { id: "a", bytes: makePng({ seed: 42 }) },
  ]);
  const conflicted = await plan(input);
  assert.deepEqual(codes(conflicted.report.issues), [["ASSET_CONFLICT", "#0", "#asset:0"]]);
  assert.equal(conflicted.matters[0].write.blobs.length, 0);
});

test("V6-07-M02: a wrong declared size, digest, mime or dimensions never yields an available drawing", async () => {
  const cases = [
    [{ byteSize: PNG_ONE.byteLength - 1 }, "BYTE_SIZE_MISMATCH", "issues"],
    [{ byteSize: MAX_DRAWING_BYTES + 1 }, "BYTE_SIZE_MISMATCH", "issues"],
    [{ sha256: "a".repeat(64) }, "HASH_MISMATCH", "hashMismatches"],
    [{ width: 40 }, "BAD_IMAGE_STRUCTURE", "issues"],
    [{ mime: "image/jpeg" }, "MIME_MISMATCH", "issues"],
    [{ mime: "image/webp" }, "UNSUPPORTED_MEDIA", "issues"],
    [{ sha256: "xyz" }, "INVALID_ASSET_REFERENCE", "issues"],
    [{ byteSize: -1 }, "INVALID_ASSET_REFERENCE", "issues"],
  ];
  for (const [override, code, list] of cases) {
    const { report, blobs, planned } = await singleDrawing(await assetMeta("a", PNG_ONE, override), { bytes: PNG_ONE.slice() });
    assert.deepEqual(codes(report[list]), [[code, "#0", "#asset:0"]], `${JSON.stringify(override)}`);
    assert.equal(blobs.length, 0);
    assert.equal(report.drawingsAvailable, 0);
    // The plan stays committable: a quarantined record never smuggles bytes.
    const committed = await commitLegacyImport(openLocalRepository(new MemoryBackend()), ACTOR_A, planned, freshConfirmed());
    assert.equal(committed.ok, true, JSON.stringify(override));
    assert.equal(committed.outcomes[0].status, "imported");
  }

  // The stored record's mime disagreeing with the figure is a mismatch too.
  const stored = await singleDrawing(await assetMeta("a", PNG_ONE), { bytes: PNG_ONE.slice(), mime: "image/jpeg" });
  assert.deepEqual(codes(stored.report.issues), [["MIME_MISMATCH", "#0", "#asset:0"]]);
  assert.equal(stored.blobs.length, 0);
});

test("V6-07-M02: an EXIF-rotated JPEG is imported, not quarantined as damaged", async () => {
  // A portrait phone photo: the encoded grid is 6x8, orientation 6 turns the
  // display grid to 8x6. The old app accepted either recorded grid.
  const rotated = makeJpeg({ width: 6, height: 8, seed: 7, orientation: 6 });
  const full = { width: 8, height: 6, encodedWidth: 6, encodedHeight: 8, orientation: 6 };
  const { report, assets, blobs } = await singleDrawing(await assetMeta("rot", rotated, full), { bytes: rotated.slice() });
  assert.deepEqual(report.issues, []);
  assert.deepEqual(assets.map((a) => a.state), ["available"]);
  assert.equal(blobs.length, 1);
  assert.equal(report.drawingsAvailable, 1);

  // A record that kept only the display size passes through the 5-8 swap.
  const displayOnly = await singleDrawing(await assetMeta("rot", rotated, { width: 8, height: 6 }), { bytes: rotated.slice() });
  assert.deepEqual(displayOnly.report.issues, []);
  assert.deepEqual(displayOnly.assets.map((a) => a.state), ["available"]);

  // A record that kept only the encoded grid passes too.
  const encodedOnly = await singleDrawing(await assetMeta("rot", rotated, { width: 6, height: 8 }), { bytes: rotated.slice() });
  assert.deepEqual(encodedOnly.report.issues, []);
  assert.deepEqual(encodedOnly.assets.map((a) => a.state), ["available"]);

  // An orientation that contradicts the file is quarantined.
  const wrongOrientation = await singleDrawing(await assetMeta("rot", rotated, { ...full, orientation: 1 }), { bytes: rotated.slice() });
  assert.deepEqual(codes(wrongOrientation.report.issues), [["BAD_IMAGE_STRUCTURE", "#0", "#asset:0"]]);
  assert.equal(wrongOrientation.blobs.length, 0);

  // A declared pair matching neither grid is quarantined.
  const unturned = await singleDrawing(await assetMeta("rot", rotated, { width: 6, height: 6 }), { bytes: rotated.slice() });
  assert.deepEqual(codes(unturned.report.issues), [["BAD_IMAGE_STRUCTURE", "#0", "#asset:0"]]);
  assert.equal(unturned.blobs.length, 0);

  // An orientation outside 1-8, or a lone dimension, is a malformed reference.
  for (const override of [{ ...full, orientation: 9 }, { width: 8, height: null, encodedWidth: null, encodedHeight: null, orientation: null }]) {
    const malformed = await singleDrawing(await assetMeta("rot", rotated, override), { bytes: rotated.slice() });
    assert.deepEqual(codes(malformed.report.issues), [["INVALID_ASSET_REFERENCE", "#0", "#asset:0"]], JSON.stringify(override));
    assert.equal(malformed.assets.length, 0);
    assert.equal(malformed.blobs.length, 0);
  }
});

test("V6-07-M02: EXIF shapes the old verifier accepted still import", async () => {
  // The old verifier read the Orientation value without checking the tag type
  // and skipped the two bytes after "Exif" without reading them. Files it
  // accepted must not be quarantined here.
  const longType = makeJpeg({ width: 6, height: 8, seed: 11, exif: exifApp1(6, { type: 4 }) });
  const full = { width: 8, height: 6, encodedWidth: 6, encodedHeight: 8, orientation: 6 };
  const long = await singleDrawing(await assetMeta("rot", longType, full), { bytes: longType.slice() });
  assert.deepEqual(long.report.issues, []);
  assert.deepEqual(long.assets.map((a) => a.state), ["available"]);
  assert.equal(long.blobs.length, 1);

  const oddSignature = makeJpeg({ width: 6, height: 8, seed: 12, exif: exifApp1(6, { signature: "ExifQQ" }) });
  const odd = await singleDrawing(await assetMeta("rot", oddSignature, full), { bytes: oddSignature.slice() });
  assert.deepEqual(odd.report.issues, []);
  assert.deepEqual(odd.assets.map((a) => a.state), ["available"]);
  assert.equal(odd.blobs.length, 1);
});

test("V6-07-M02: a PNG with no compressed image data is quarantined", async () => {
  const empty = makePng({ idat: Buffer.alloc(0) });
  assert.equal(validateDrawing("image/png", empty).ok, false);
  const { report, assets, blobs } = await singleDrawing(await assetMeta("empty", empty), { bytes: empty.slice() });
  assert.deepEqual(codes(report.issues), [["BAD_IMAGE_STRUCTURE", "#0", "#asset:0"]]);
  assert.deepEqual(assets.map((a) => a.state), ["quarantined"]);
  assert.equal(blobs.length, 0);

  // An empty chunk before real data is still decodable, as the old verifier's
  // total-length check allowed.
  const padded = makePng({ extra: [pngChunk("IDAT", Buffer.alloc(0))] });
  assert.equal(validateDrawing("image/png", padded).ok, true);
});

test("V6-07-M02: a stored record's own digest must describe its bytes", async () => {
  const { report, blobs } = await singleDrawing(await assetMeta("a", PNG_ONE), { bytes: PNG_ONE.slice(), sha256: "b".repeat(64) });
  assert.deepEqual(codes(report.hashMismatches), [["HASH_MISMATCH", "#0", "#asset:0"]]);
  assert.equal(blobs.length, 0);
  assert.equal(report.drawingsAvailable, 0);
});

test("V6-07-M02: duplicate stored records are judged the same in either order", async () => {
  const good = { id: "dup", bytes: PNG_ONE.slice(), mime: "image/png", sha256: await sha256Hex(PNG_ONE) };
  const bad = { id: "dup", bytes: PNG_ONE.slice(), mime: "image/png", sha256: "b".repeat(64) };
  const project = { id: "p", name: "Dup", figures: [await legacyFigure("f", "dup", PNG_ONE)] };
  for (const assets of [[good, bad], [bad, good]]) {
    const planned = await plan(legacyInput([project], assets));
    assert.deepEqual(codes(planned.report.hashMismatches), [["HASH_MISMATCH", "#0", "#asset:0"]]);
    assert.equal(planned.matters[0].write.blobs.length, 0);
    assert.deepEqual(planned.matters[0].write.assets.map((a) => a.state), ["quarantined"]);
  }
});

test("V6-07-M02: a flat figure entry names its stored asset in assetId", async () => {
  const meta = await assetMeta("asset-1", PNG_ONE);
  const flat = {
    id: "entry-1",
    assetId: "asset-1",
    sha256: meta.sha256,
    mime: meta.mime,
    byteSize: meta.byteSize,
    width: meta.width,
    height: meta.height,
    originalName: "drawing.png",
  };
  const input = legacyInput([{ id: "p", name: "Flat", figures: [flat] }], [{ id: "asset-1", bytes: PNG_ONE.slice() }]);
  const planned = await plan(input);
  assert.deepEqual(planned.report.issues, []);
  assert.deepEqual(planned.report.orphanAssets, []);
  assert.deepEqual(planned.matters[0].write.assets.map((a) => a.state), ["available"]);
  assert.equal(planned.matters[0].write.blobs.length, 1);
});

test("V6-07-M02: corrupt, truncated, disguised or over-budget images are quarantined", async () => {
  const badCrc = PNG_ONE.slice();
  badCrc[20] ^= 0xff;
  const trailing = new Uint8Array([...PNG_ONE, 0]);
  const textAsPng = new TextEncoder().encode("\u0089PNG V6-07 not really an image");
  const illegalDepth = makePng({ colourType: 2, depth: 4 }); // RGB allows only 8 or 16
  const paletteWithoutPlte = (() => {
    const raw = makePng({ colourType: 0, depth: 8 });
    raw[8 + 8 + 9] = 3; // colour type 3 in IHDR, then fix its CRC
    const crc = crc32(Buffer.from(raw.slice(12, 12 + 4 + 13)));
    raw.set(u32(crc), 8 + 8 + 13);
    return raw;
  })();
  // Header-only budget fixtures: the IHDR claims more pixels than the budget;
  // the validator rejects them from the header without inflating any data.
  const hugePng = makePng({ width: 5000, height: 4000, idat: deflateSync(Buffer.alloc(1)) });
  const hugeJpeg = makeJpeg({ width: 5000, height: 4000 });
  const oversized = makePng({ extra: [pngChunk("tEXt", Buffer.alloc(MAX_DRAWING_BYTES))] });
  const truncatedJpeg = makeJpeg().slice(0, -2);
  const jpegNoScan = (() => {
    const full = makeJpeg();
    const sos = full.findIndex((byte, index) => byte === 0xff && full[index + 1] === 0xda);
    return new Uint8Array([...full.slice(0, sos), 0xff, 0xd9]);
  })();

  const cases = [
    [badCrc, "image/png", "BAD_IMAGE_STRUCTURE"],
    [trailing, "image/png", "BAD_IMAGE_STRUCTURE"],
    [PNG_ONE.slice(0, -12), "image/png", "BAD_IMAGE_STRUCTURE"],
    [textAsPng, "image/png", "BAD_IMAGE_STRUCTURE"],
    [illegalDepth, "image/png", "BAD_IMAGE_STRUCTURE"],
    [paletteWithoutPlte, "image/png", "BAD_IMAGE_STRUCTURE"],
    [JPEG_TWO, "image/png", "MIME_MISMATCH"],
    [PNG_ONE, "image/jpeg", "MIME_MISMATCH"],
    [truncatedJpeg, "image/jpeg", "BAD_IMAGE_STRUCTURE"],
    [jpegNoScan, "image/jpeg", "BAD_IMAGE_STRUCTURE"],
    [hugePng, "image/png", "IMAGE_TOO_LARGE"],
    [hugeJpeg, "image/jpeg", "IMAGE_TOO_LARGE"],
    [oversized, "image/png", "FILE_TOO_LARGE"],
  ];
  for (const [bytes, mime, code] of cases) {
    assert.equal(validateDrawing(mime, bytes).ok, false, code);
    const meta = await assetMeta("a", bytes, { mime, width: null, height: null });
    const { report, assets, blobs } = await singleDrawing(meta, { bytes: bytes.slice() });
    assert.deepEqual(codes(report.issues), [[code, "#0", "#asset:0"]], `${code} ${mime}`);
    assert.deepEqual(assets.map((a) => a.state), ["quarantined"]);
    assert.equal(blobs.length, 0);
  }
});

// ---------------------------------------------------------------------------
// V6-07-M03 / S13-A09: positional references only
// ---------------------------------------------------------------------------

test("V6-07-M03: ASCII claim text used as ids never reaches the report, plan or outcomes", async () => {
  const project = {
    id: ASCII_SECRET,
    name: "Fine",
    figures: [{ id: ASCII_SECRET, title: "T", asset: { ...(await assetMeta(ASCII_SECRET, PNG_ONE)), originalName: "drawing.png" } }],
    revisions: [{ id: ASCII_SECRET, figures: [{ id: ASCII_SECRET, assetId: `${ASCII_SECRET}.gone` }] }],
    reviewRecords: [{ id: ASCII_SECRET }],
    ownerReview: { revisionId: ASCII_SECRET },
  };
  const unknown = { id: `${ASCII_SECRET}.2`, figures: [] };
  const input = legacyInput([project, unknown, { ...project }], [
    { id: ASCII_SECRET, bytes: PNG_ONE.slice() },
    { id: `${ASCII_SECRET}.orphan`, bytes: PNG_ONE.slice() },
  ]);
  const planned = await plan(input);
  assert.deepEqual(codes(planned.report.unknownVersions), [["UNKNOWN_VERSION", "#1", null]]);
  assert.deepEqual(codes(planned.report.unconvertible), [["IMPORT_INVALID", "#2", null]]);
  assert.deepEqual(planned.report.orphanAssets, [{ assetRef: "#supplied:1" }]);
  const backend = new MemoryBackend();
  const committed = await commitLegacyImport(openLocalRepository(backend), ACTOR_A, planned, freshConfirmed());
  assert.deepEqual(committed.outcomes.map((o) => [o.legacyProjectId, o.status]), [["#0", "imported"]]);
  for (const text of [JSON.stringify(planned), JSON.stringify(committed), JSON.stringify([...backend.data.get(STORES.events).values()]), JSON.stringify([...backend.data.get(STORES.matters).values()])]) {
    assert.ok(!text.includes(ASCII_SECRET));
  }
});

test("S13-A09: a damaged record's id never carries text into the report", async () => {
  const state = [
    { id: SECRET_CLAIM, title: "no name", figures: [] },
    { id: "legacy-ok", name: "Fine", figures: [], reviewRecords: [{ id: SECRET_CLAIM }] },
  ];
  const planned = await plan(legacyInput(state));
  assert.deepEqual(codes(planned.report.unknownVersions), [["UNKNOWN_VERSION", "#0", null]]);
  assert.deepEqual(planned.report.legacyUnverified.map((r) => r.legacyItemId), ["#review:0"]);
  assert.ok(!JSON.stringify(planned).includes(SECRET_CLAIM));
});

test("S13-A09: the report and written events carry no document text", async () => {
  const input = await legacyWorkspace();
  const backend = new MemoryBackend();
  const planned = await plan(input);
  await commitLegacyImport(openLocalRepository(backend), ACTOR_A, planned, freshConfirmed());
  assert.ok(!JSON.stringify(planned.report).includes(SECRET_CLAIM));
  assert.ok(!JSON.stringify([...backend.data.get(STORES.events).values()]).includes(SECRET_CLAIM));
  assert.ok(!JSON.stringify([...backend.data.get(STORES.matters).values()]).includes(SECRET_CLAIM));
});

test("V6-07-M03: a user's own title and file name stay in the plan, never in the report", async () => {
  const title = `Example ${SECRET_CLAIM}`;
  const name = `${ASCII_SECRET}.png`;
  const project = {
    id: "p",
    name: title,
    figures: [{ id: "f", title: "F", asset: { ...(await assetMeta("a", PNG_ONE)), originalName: name } }],
  };
  const planned = await plan(legacyInput([project], [{ id: "a", bytes: PNG_ONE.slice() }]));
  assert.equal(planned.matters[0].write.matter.title, title);
  assert.equal(planned.matters[0].write.assets[0].originalName, name);
  assert.ok(!JSON.stringify(planned.report).includes(SECRET_CLAIM));
  assert.ok(!JSON.stringify(planned.report).includes(ASCII_SECRET));
  const committed = await commitLegacyImport(openLocalRepository(new MemoryBackend()), ACTOR_A, planned, freshConfirmed());
  assert.deepEqual(committed.outcomes.map((o) => o.status), ["imported"]);
  assert.ok(!JSON.stringify(committed).includes(SECRET_CLAIM));
  assert.ok(!JSON.stringify(committed).includes(ASCII_SECRET));
});

// ---------------------------------------------------------------------------
// Plan integrity, actor binding and tenancy
// ---------------------------------------------------------------------------

test("V6-07: a mutated plan cannot inject an approval or any other write", async () => {
  const original = await plan(await legacyWorkspace());
  const tamperings = {
    "approval event": (p) => p.matters[0].write.events.push({ ...p.matters[0].write.events[0], id: p.matters[0].write.events[0].id.replace(/.$/, "0"), action: "approval.created" }),
    "renamed action": (p) => { p.matters[0].write.events[0].action = "confirmation.created"; },
    "extra metadata": (p) => { p.matters[0].write.events[0].metadata = { version: 1, approved: true }; },
    "target": (p) => p.matters[0].write.targets.push({ id: "x" }),
    "extra write key": (p) => { p.matters[0].write.reviews = []; },
    "available without bytes": (p) => { p.matters[1].write.assets[0].state = "available"; },
    "foreign tenant": (p) => { p.matters[0].write.matter.tenantId = TENANT_B; },
    "blob for quarantined asset": (p) => p.matters[1].write.blobs.push({ assetId: p.matters[1].write.assets[1].id, bytes: PNG_TAMPERED, sha256: p.matters[1].write.assets[1].sha256, byteLength: PNG_TAMPERED.byteLength }),
    "wrong contract": (p) => { p.contractVersion = "legacy-import.v1"; },
    "duplicate matter": (p) => p.matters.push(p.matters[0]),
    "leaky asset ref": (p) => { p.matters[0].assetRefs[ASCII_SECRET] = p.matters[0].write.assets[0].id; },
  };
  for (const [name, tamper] of Object.entries(tamperings)) {
    const copy = structuredClone(original);
    tamper(copy);
    const backend = new MemoryBackend();
    const result = await commitLegacyImport(openLocalRepository(backend), ACTOR_A, copy, freshConfirmed());
    assert.deepEqual(result, { ok: false, error: { code: "INVALID_INPUT", message: "the plan is not a valid unmodified migration plan" } }, name);
    assert.equal(backend.rowCount(), 0, name);
  }

  // The frozen plan itself rejects in-place mutation.
  assert.throws(() => original.matters[0].write.events.push({}), TypeError);

  // An untampered structural copy still commits (re-serialisation caveat).
  const clean = await commitLegacyImport(openLocalRepository(new MemoryBackend()), ACTOR_A, structuredClone(original), freshConfirmed());
  assert.equal(clean.ok, true);
});

test("V6-07: a plan made for one actor cannot be committed by another", async () => {
  const planned = await plan(await legacyWorkspace());
  const refused = await commitLegacyImport(openLocalRepository(new MemoryBackend()), ACTOR_B, planned, freshConfirmed());
  assert.equal(refused.ok, false);
  assert.equal(refused.error.code, "INVALID_INPUT");
});

test("S13-A01: an imported matter, its assets and activity are 404 for another tenant", async () => {
  const planned = await plan(await legacyWorkspace());
  const repo = openLocalRepository(new MemoryBackend());
  await commitLegacyImport(repo, ACTOR_A, planned, freshConfirmed());
  const write = planned.matters[0].write;
  assert.equal((await repo.loadMatter(ACTOR_B, write.matter.id)).error.code, "RESOURCE_NOT_FOUND");
  assert.equal((await repo.listEvents(ACTOR_B, write.matter.id)).error.code, "RESOURCE_NOT_FOUND");
  assert.equal((await repo.readBlob(ACTOR_B, write.assets[0].id)).error.code, "RESOURCE_NOT_FOUND");
  assert.equal((await repo.listMatters(ACTOR_B)).data.items.length, 0);
});
