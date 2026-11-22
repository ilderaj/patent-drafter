/**
 * Track C regression — uploaded PNG/JPEG source assets flow idempotently into
 * the drawing library, bind to targets, pass the export gate, preview with
 * real Blob URLs in FiguresPanel, and clarify image status in ParsePanel.
 */
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

import { ingestFiles } from "../../../../apps/web/src/v6/features/sources/ingest.ts";
import {
  bindFigures,
  checkFigureExportGate,
  deleteDrawing,
  loadFigurePanel,
  readDrawingLibrary,
  syncUploadedImagesToLibrary,
} from "../../../../apps/web/src/v6/features/sources/drawings.ts";
import {
  buildParseRows,
  describeParseRows,
  parseSource,
  readParseState,
} from "../../../../apps/web/src/v6/features/sources/parse.ts";
import {
  ACTOR_A,
  EMPTY_SET_A,
  MATTER_ID,
  TARGET_A,
  aggregateOf,
  clock,
  dump,
  entry,
  fixture,
  seed,
} from "./harness.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../../../..");
const FIGURES_SOURCE = join(ROOT, "apps/web/src/v6/features/sources/Figures.tsx");
const PARSE_SOURCE = join(ROOT, "apps/web/src/v6/features/sources/Parse.tsx");

const FIG_1 = "88888888-8888-4888-8888-888888888881";
const FIG_2 = "88888888-8888-4888-8888-888888888882";

let outdir;
let ui;

before(async () => {
  outdir = mkdtempSync(join(tmpdir(), "v6-12-upload-sync-"));
  const outfile = join(outdir, "ui.cjs");
  const harness = `
    import { renderToStaticMarkup } from "react-dom/server";
    import { FiguresPanel, appendAllUnboundEntries } from ${JSON.stringify(FIGURES_SOURCE)};
    import { ParsePanel, isImageParseRow } from ${JSON.stringify(PARSE_SOURCE)};
    export function renderFiguresPanel(props) { return renderToStaticMarkup(<FiguresPanel {...props} />); }
    export function renderParsePanel(props) { return renderToStaticMarkup(<ParsePanel {...props} />); }
    export { appendAllUnboundEntries, isImageParseRow };
  `;
  await esbuild.build({
    stdin: { contents: harness, resolveDir: ROOT, sourcefile: "v6-12-sync-ui.tsx", loader: "tsx" },
    bundle: true,
    outfile,
    format: "cjs",
    platform: "node",
    jsx: "automatic",
    external: ["pdfjs-dist", "pdfjs-dist/*"],
    define: { "process.env.NODE_ENV": '"production"' },
    logLevel: "silent",
  });
  ui = createRequire(outfile)(outfile);
});

after(() => {
  if (outdir) rmSync(outdir, { recursive: true, force: true });
});

function fileFrom(bytes, name, type) {
  return new File([bytes], name, { type });
}

test("Track C: ingestFiles PNG/JPEG syncs idempotently into drawing library without inflating matter.assets, binds, and passes export gate", async () => {
  const { backend, repository } = await seed();
  const pngBytes = fixture("drawing-valid.png");
  const jpgBytes = fixture("drawing-valid.jpg");
  const txtBytes = new TextEncoder().encode("一种温控装置，包括传感器与控制板。");

  const outcomes = await ingestFiles(repository, ACTOR_A, MATTER_ID, [
    fileFrom(pngBytes, "结构示意图.png", "image/png"),
    fileFrom(jpgBytes, "剖面图.jpg", "image/jpeg"),
    fileFrom(txtBytes, "技术交底.txt", "text/plain"),
  ]);
  assert.equal(outcomes.length, 3);
  for (const outcome of outcomes) {
    assert.equal(outcome.status, "saved", JSON.stringify(outcome));
  }

  const assetsBeforeSync = (await aggregateOf(repository)).assets;
  assert.equal(assetsBeforeSync.length, 3, "ingestFiles keeps one AssetRecord per uploaded file");
  const pngAsset = assetsBeforeSync.find((asset) => asset.mime === "image/png");
  const jpgAsset = assetsBeforeSync.find((asset) => asset.mime === "image/jpeg");
  assert.ok(pngAsset && jpgAsset);

  const firstSync = await syncUploadedImagesToLibrary(repository, ACTOR_A, MATTER_ID);
  assert.equal(firstSync.ok, true, firstSync.ok ? "" : JSON.stringify(firstSync.error));
  assert.equal(firstSync.data.added.length, 2, "both PNG and JPEG are registered into drawings/");
  assert.deepEqual(firstSync.data.skipped, []);
  assert.deepEqual(firstSync.data.rejected, []);

  // Reuses existing source asset ids; matter.assets does not grow.
  const assetsAfterSync = (await aggregateOf(repository)).assets;
  assert.equal(assetsAfterSync.length, 3, "sync does not duplicate AssetRecords");
  const addedAssetIds = new Set(firstSync.data.added.map((item) => item.drawing.assetId));
  assert.deepEqual(addedAssetIds, new Set([pngAsset.id, jpgAsset.id]));

  // Second sync is strictly idempotent and writes nothing.
  const snapshotAfterFirst = dump(backend);
  const secondSync = await syncUploadedImagesToLibrary(repository, ACTOR_A, MATTER_ID);
  assert.equal(secondSync.ok, true);
  assert.equal(secondSync.data.added.length, 0);
  assert.equal(secondSync.data.skipped.length, 2);
  assert.deepEqual(dump(backend), snapshotAfterFirst, "repeated sync writes nothing");

  // loadFigurePanel directly exposes both synced drawings with decoder-verified dimensions.
  const panel = await loadFigurePanel(repository, ACTOR_A, MATTER_ID, { targetId: TARGET_A, now: clock });
  assert.equal(panel.kind, "library");
  assert.equal(panel.data.drawings.length, 2);
  const syncedPng = panel.data.drawings.find((item) => item.asset.id === pngAsset.id);
  const syncedJpg = panel.data.drawings.find((item) => item.asset.id === jpgAsset.id);
  assert.ok(syncedPng && syncedJpg);
  assert.equal(syncedPng.drawing.width, 128);
  assert.equal(syncedPng.drawing.height, 96);
  assert.equal(syncedJpg.drawing.width, 40);
  assert.equal(syncedJpg.drawing.height, 16);

  // Bind both synced drawings to TARGET_A and verify checkFigureExportGate passes.
  const bound = await bindFigures(
    repository,
    ACTOR_A,
    MATTER_ID,
    {
      targetId: TARGET_A,
      baseFigureRevisionId: EMPTY_SET_A,
      entries: [
        entry(FIG_1, 1, syncedPng.drawing.id, "图1"),
        entry(FIG_2, 2, syncedJpg.drawing.id, "图2"),
      ],
    },
    { now: clock },
  );
  assert.equal(bound.ok, true, bound.ok ? "" : JSON.stringify(bound.error));

  const gate = await checkFigureExportGate(
    repository,
    ACTOR_A,
    MATTER_ID,
    { targetId: TARGET_A, figureRevisionId: bound.data.current.id, referencedFigureIds: [FIG_1, FIG_2] },
    { now: clock },
  );
  assert.equal(gate.ok, true);
  assert.deepEqual(gate.data, {
    allowed: true,
    filesAvailable: true,
    evaluatedAt: "2026-11-01T00:00:00.000Z",
    reasons: [],
  });

  // Deleting a synced drawing retires it cleanly, prevents resurrection on re-sync,
  // and blocks export of the old revision with MISSING_BYTES.
  const deleted = await deleteDrawing(repository, ACTOR_A, MATTER_ID, syncedPng.drawing.id);
  assert.equal(deleted.ok, true);
  const resync = await syncUploadedImagesToLibrary(repository, ACTOR_A, MATTER_ID);
  assert.equal(resync.ok, true);
  assert.equal(resync.data.added.length, 0, "deleted synced drawing is not resurrected");
  const libraryAfterDelete = await readDrawingLibrary(repository, ACTOR_A, MATTER_ID);
  assert.equal(libraryAfterDelete.ok, true);
  assert.deepEqual(libraryAfterDelete.data.map((item) => item.drawing.id), [syncedJpg.drawing.id]);
  const gateAfterDelete = await checkFigureExportGate(
    repository,
    ACTOR_A,
    MATTER_ID,
    { targetId: TARGET_A, figureRevisionId: bound.data.current.id },
    { now: clock },
  );
  assert.equal(gateAfterDelete.data.allowed, false);
  assert.equal(gateAfterDelete.data.filesAvailable, false);
  assert.deepEqual(gateAfterDelete.data.reasons, [{ code: "MISSING_BYTES", resourceId: syncedPng.drawing.id }]);
});

test("Track C UI: FiguresPanel renders bind-all shortcut and real Blob URL thumbnails without inventing images", async () => {
  const { repository } = await seed();
  await ingestFiles(repository, ACTOR_A, MATTER_ID, [
    fileFrom(fixture("drawing-valid.png"), "俯视图.png", "image/png"),
    fileFrom(fixture("drawing-valid.jpg"), "侧视图.jpg", "image/jpeg"),
  ]);
  const synced = await syncUploadedImagesToLibrary(repository, ACTOR_A, MATTER_ID);
  assert.equal(synced.ok, true);

  const view = await loadFigurePanel(repository, ACTOR_A, MATTER_ID, { targetId: TARGET_A, now: clock });
  assert.equal(view.kind, "library");
  const noop = () => {};

  const htmlWithoutThumbs = ui.renderFiguresPanel({
    view,
    busy: false,
    onImport: noop,
    onDelete: noop,
    onAppend: noop,
    onAppendAll: noop,
    onRemove: noop,
    onReload: noop,
  });
  assert.match(htmlWithoutThumbs, /data-testid="figures-bind-all"/);
  assert.match(htmlWithoutThumbs, /一键按序绑定未入集附图（2 张）/);
  assert.doesNotMatch(htmlWithoutThumbs, /<img/, "no thumbnail rendered when no real blob URL is passed");

  const firstId = view.data.drawings[0].drawing.id;
  const htmlWithThumb = ui.renderFiguresPanel({
    view,
    busy: false,
    thumbnails: { [firstId]: "blob:local-test-preview-1" },
    onImport: noop,
    onDelete: noop,
    onAppend: noop,
    onAppendAll: noop,
    onRemove: noop,
    onReload: noop,
  });
  assert.match(htmlWithThumb, new RegExp(`data-testid="figure-thumb-${firstId}"`));
  assert.match(htmlWithThumb, /src="blob:local-test-preview-1"/);

  // appendAllUnboundEntries appends unbound drawings consecutively and preserves existing numerals.
  let counter = 0;
  const current = {
    id: EMPTY_SET_A,
    parentId: null,
    hash: "",
    createdAt: "",
    entries: [{ figureId: "existing-1", number: 1, title: "图1", drawingId: "d-existing", numerals: [{ value: "10", label: "外壳" }] }],
  };
  const next = ui.appendAllUnboundEntries(current, ["d-existing", "d-new-1", "d-new-2"], () => `gen-${++counter}`);
  assert.deepEqual(
    next.map((item) => [item.figureId, item.number, item.title, item.drawingId, item.numerals]),
    [
      ["existing-1", 1, "图1", "d-existing", [{ value: "10", label: "外壳" }]],
      ["gen-1", 2, "图2", "d-new-1", []],
      ["gen-2", 3, "图3", "d-new-2", []],
    ],
  );
});

test("Track C UI: ParsePanel clarifies uploaded PNG/JPEG rows while preserving V6-11 status codes and controls", async () => {
  const { repository } = await seed();
  await ingestFiles(repository, ACTOR_A, MATTER_ID, [
    fileFrom(fixture("drawing-valid.png"), "结构图.png", "image/png"),
  ]);
  const aggregate = await aggregateOf(repository);
  const pngAsset = aggregate.assets[0];

  // Before parsing (pending): friendly image note is visible alongside standard controls.
  const pendingRows = buildParseRows({ assets: [pngAsset], states: new Map() });
  assert.equal(ui.isImageParseRow(pendingRows[0]), true);
  const noop = () => {};
  const pendingHtml = ui.renderParsePanel({
    view: describeParseRows(pendingRows, false),
    busy: false,
    liveStage: {},
    onStart: noop,
    onCancel: noop,
    onResume: noop,
    onAbandon: noop,
    onRetry: noop,
    onReload: noop,
    onAddDocuments: noop,
  });
  assert.match(pendingHtml, new RegExp(`data-testid="parse-image-note-${pngAsset.id}"`));
  assert.match(pendingHtml, /说明书附图库/);
  assert.match(pendingHtml, /OCR/);
  assert.match(pendingHtml, new RegExp(`data-testid="parse-start-${pngAsset.id}"`));

  // After parsing (UNSUPPORTED_MEDIA): V6-11 status code, error, retry/replace remain intact alongside the image note.
  await parseSource(repository, ACTOR_A, MATTER_ID, pngAsset.id, { sessionId: "s-track-c", pageId: "p-track-c" });
  const parseState = await readParseState(repository, ACTOR_A, MATTER_ID, pngAsset.id, { sessionId: "s-track-c" });
  const failedRows = buildParseRows({ assets: [pngAsset], states: new Map([[pngAsset.id, parseState]]) });
  const failedHtml = ui.renderParsePanel({
    view: describeParseRows(failedRows, false),
    busy: false,
    liveStage: {},
    onStart: noop,
    onCancel: noop,
    onResume: noop,
    onAbandon: noop,
    onRetry: noop,
    onReload: noop,
    onAddDocuments: noop,
  });
  assert.equal(failedRows[0].errorCode, "UNSUPPORTED_MEDIA");
  assert.match(failedHtml, /解析失败/);
  assert.match(failedHtml, new RegExp(`data-testid="parse-error-${pngAsset.id}">[^<]*（UNSUPPORTED_MEDIA）`));
  assert.match(failedHtml, new RegExp(`data-testid="parse-retry-${pngAsset.id}"`));
  assert.match(failedHtml, new RegExp(`data-testid="parse-replace-${pngAsset.id}"`));
  assert.match(failedHtml, new RegExp(`data-testid="parse-image-note-${pngAsset.id}"`));
  assert.doesNotMatch(failedHtml, /已保存/);
});
