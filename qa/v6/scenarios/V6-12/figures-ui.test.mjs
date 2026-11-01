/**
 * V6-12 — figure surface markup (S02 empty / loading / failed / stale states).
 *
 * `Figures.tsx` is bundled with esbuild and rendered with `react-dom/server`,
 * like the V6-10 and V6-11 suites. Every view rendered here is built by
 * `loadFigurePanel` from real persisted state in the in-memory repository, so
 * the markup is what the panel would show after a refresh. Clicking in a real
 * browser needs the orchestrator's V6App registration; nothing here claims it.
 */
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

import {
  bindFigures,
  deleteDrawing,
  importDrawing,
  loadFigurePanel,
} from "../../../../apps/web/src/v6/features/sources/drawings.ts";
import { ACTOR_A, EMPTY_SET_A, MATTER_ID, TARGET_A, clock, entry, fixture, seed } from "./harness.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../../../..");
const SOURCE = join(ROOT, "apps/web/src/v6/features/sources/Figures.tsx");
const FIG_1 = "88888888-8888-4888-8888-888888888881";

let outdir;
let ui;

before(async () => {
  outdir = mkdtempSync(join(tmpdir(), "v6-12-bundle-"));
  const outfile = join(outdir, "figures.cjs");
  const harness = `
    import { renderToStaticMarkup } from "react-dom/server";
    import { Figures, FiguresPanel } from ${JSON.stringify(SOURCE)};
    export function renderFigures(props) { return renderToStaticMarkup(<Figures {...props} />); }
    export function renderPanel(props) { return renderToStaticMarkup(<FiguresPanel {...props} />); }
    export { appendEntry, removeEntry, drawingSummary, formatBytes } from ${JSON.stringify(SOURCE)};
  `;
  await esbuild.build({
    stdin: { contents: harness, resolveDir: ROOT, sourcefile: "v6-12-figures-harness.tsx", loader: "tsx" },
    bundle: true,
    outfile,
    format: "cjs",
    platform: "node",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
    logLevel: "silent",
  });
  ui = createRequire(outfile)(outfile);
});

after(() => {
  if (outdir) rmSync(outdir, { recursive: true, force: true });
});

const noop = () => {};
function render(view, extra = {}) {
  return ui.renderPanel({
    view,
    busy: false,
    onImport: noop,
    onDelete: noop,
    onAppend: noop,
    onRemove: noop,
    onReload: noop,
    ...extra,
  });
}

async function importOk(repository, name) {
  const result = await importDrawing(repository, ACTOR_A, MATTER_ID, { bytes: fixture(name), fileName: name }, { now: clock });
  assert.equal(result.ok, true, result.ok ? "" : JSON.stringify(result.error));
  return result.data;
}

test("V6-12 UI loading: the first render reads storage and shows no rows", async () => {
  const { repository } = await seed();
  const html = ui.renderFigures({ repository, actor: ACTOR_A, matterId: MATTER_ID, targetId: TARGET_A });
  assert.match(html, /data-figures-state="loading"/);
  assert.match(html, /aria-busy="true"/);
  assert.doesNotMatch(html, /figure-row-/);
});

test("V6-12 UI empty: a matter with no drawings and no targets says so and offers import only", async () => {
  const { repository } = await seed({ targets: 0 });
  const view = await loadFigurePanel(repository, ACTOR_A, MATTER_ID, { now: clock });
  assert.equal(view.kind, "empty");
  const html = render(view);
  assert.match(html, /data-testid="figures-empty"/);
  assert.match(html, /data-testid="figures-import"/);
  assert.match(html, /data-testid="figures-no-target"/);
  assert.match(html, /目标建立后才能绑定图集/);
  assert.doesNotMatch(html, /figure-row-|figures-set"/);
});

test("V6-12 UI library: rows show the persisted, decoder-verified dimensions and the bound set", async () => {
  const { repository } = await seed();
  const png = await importOk(repository, "drawing-valid.png");
  const jpg = await importOk(repository, "drawing-valid.jpg");
  const bound = await bindFigures(repository, ACTOR_A, MATTER_ID, {
    targetId: TARGET_A,
    baseFigureRevisionId: EMPTY_SET_A,
    entries: [entry(FIG_1, 1, png.drawing.id)],
  });
  assert.equal(bound.ok, true);
  const view = await loadFigurePanel(repository, ACTOR_A, MATTER_ID, { targetId: TARGET_A, now: clock });
  const html = render(view);
  assert.match(html, /data-figures-state="library"/);
  assert.match(html, new RegExp(`figure-row-${png.drawing.id}`));
  assert.match(html, /128 × 96 · PNG/);
  assert.match(html, /40 × 16 · JPEG/);
  assert.match(html, new RegExp(`data-revision="${bound.data.current.id}"`));
  assert.match(html, /data-testid="figure-entry-1"/);
  assert.match(html, new RegExp(`figure-append-${jpg.drawing.id}`), "an unbound drawing can be appended");
  assert.doesNotMatch(html, new RegExp(`figure-append-${png.drawing.id}`), "a bound drawing is not offered again");
  assert.doesNotMatch(html, /<img/, "no invented thumbnail");
  assert.doesNotMatch(html, /figures-gate-blocked|figures-stale/);
});

test("V6-12 UI failed: unavailable storage shows the error with retry, never an empty library", async () => {
  const { backend, repository } = await seed();
  backend.close();
  const view = await loadFigurePanel(repository, ACTOR_A, MATTER_ID, { targetId: TARGET_A, now: clock });
  assert.equal(view.kind, "storage_unavailable");
  const html = render(view);
  assert.match(html, /data-testid="figures-load-error"/);
  assert.match(html, /重试/);
  assert.doesNotMatch(html, /figures-empty|figures-import/);
});

test("V6-12 UI failed action: a refused import shows its code and the library is unchanged", async () => {
  const { repository } = await seed();
  const refused = await importDrawing(repository, ACTOR_A, MATTER_ID, { bytes: fixture("drawing-dimension-lie.jpg"), fileName: "lie.jpg" });
  assert.equal(refused.ok, false);
  const view = await loadFigurePanel(repository, ACTOR_A, MATTER_ID, { targetId: TARGET_A, now: clock });
  const html = render(view, { actionError: refused.error });
  assert.match(html, /data-testid="figures-action-error"/);
  assert.match(html, /data-code="BAD_DRAWING"/);
  assert.match(html, /data-testid="figures-empty"/, "nothing was added");
});

test("V6-12 UI stale and blocked: a draft on an older set is marked stale and a missing drawing blocks export", async () => {
  const { repository } = await seed();
  const png = await importOk(repository, "drawing-valid.png");
  const v1 = await bindFigures(repository, ACTOR_A, MATTER_ID, {
    targetId: TARGET_A,
    baseFigureRevisionId: EMPTY_SET_A,
    entries: [entry(FIG_1, 1, png.drawing.id)],
  });
  await deleteDrawing(repository, ACTOR_A, MATTER_ID, png.drawing.id);
  const view = await loadFigurePanel(repository, ACTOR_A, MATTER_ID, {
    targetId: TARGET_A,
    draftFigureRevisionId: EMPTY_SET_A,
    now: clock,
  });
  assert.equal(view.stale, true);
  assert.equal(view.data.revisions.get(TARGET_A).id, v1.data.current.id);
  const html = render(view);
  assert.match(html, /data-testid="figures-stale"/);
  assert.match(html, /data-testid="figures-gate-blocked"/);
  assert.match(html, /data-code="MISSING_BYTES"/);
  assert.match(html, /附图已不在图库中/);
});

test("V6-12 UI bind inputs: append numbers the next figure and remove renumbers 1..n", () => {
  const current = {
    id: "r",
    parentId: null,
    hash: "h",
    createdAt: "2026-11-01T00:00:00.000Z",
    entries: [
      { figureId: "a", number: 1, title: "图1", drawingId: "d1", numerals: [{ value: "1", label: "标记" }] },
      { figureId: "b", number: 2, title: "图2", drawingId: "d2", numerals: [] },
    ],
  };
  assert.deepEqual(ui.appendEntry(current, "d3", "c").map((e) => [e.figureId, e.number, e.drawingId]), [
    ["a", 1, "d1"],
    ["b", 2, "d2"],
    ["c", 3, "d3"],
  ]);
  assert.deepEqual(ui.removeEntry(current, "a").map((e) => [e.figureId, e.number]), [["b", 1]]);
  assert.equal(ui.formatBytes(2048), "2.0 KB");
});

test("V6-12 UI numerals survive append, remove and a reload through the persisted panel", async () => {
  const FIG_2 = "88888888-8888-4888-8888-888888888882";
  const { repository } = await seed();
  const png = await importOk(repository, "drawing-valid.png");
  const jpg = await importOk(repository, "drawing-valid.jpg");
  const bound = await bindFigures(repository, ACTOR_A, MATTER_ID, {
    targetId: TARGET_A,
    baseFigureRevisionId: EMPTY_SET_A,
    entries: [
      {
        figureId: FIG_1,
        number: 1,
        title: "图1",
        drawingId: png.drawing.id,
        numerals: [
          { value: "10", label: "卡口" },
          { value: "12", label: "壳体" },
        ],
      },
    ],
  });
  assert.equal(bound.ok, true, bound.ok ? "" : JSON.stringify(bound.error));

  // appendEntry works on the panel's own revision model, so the numerals must
  // travel through it: a dropped field here would silently unbind them.
  const shown = await loadFigurePanel(repository, ACTOR_A, MATTER_ID, { targetId: TARGET_A, now: clock });
  assert.equal(shown.kind, "library");
  const current = shown.data.revisions.get(TARGET_A);
  assert.deepEqual(current.entries[0].numerals, [
    { value: "10", label: "卡口" },
    { value: "12", label: "壳体" },
  ]);

  const appended = ui.appendEntry(current, jpg.drawing.id, FIG_2);
  assert.deepEqual(appended[0].numerals, current.entries[0].numerals, "append keeps figure 1's numerals");
  const second = await bindFigures(repository, ACTOR_A, MATTER_ID, {
    targetId: TARGET_A,
    baseFigureRevisionId: current.id,
    entries: appended,
  });
  assert.equal(second.ok, true, second.ok ? "" : JSON.stringify(second.error));
  const afterAppend = await loadFigurePanel(repository, ACTOR_A, MATTER_ID, { targetId: TARGET_A, now: clock });
  assert.deepEqual(
    afterAppend.data.revisions.get(TARGET_A).entries.map((e) => [e.number, e.numerals]),
    [
      [1, [{ value: "10", label: "卡口" }, { value: "12", label: "壳体" }]],
      [2, []],
    ],
  );

  const removed = ui.removeEntry(afterAppend.data.revisions.get(TARGET_A), FIG_1);
  const third = await bindFigures(repository, ACTOR_A, MATTER_ID, {
    targetId: TARGET_A,
    baseFigureRevisionId: afterAppend.data.revisions.get(TARGET_A).id,
    entries: removed,
  });
  assert.equal(third.ok, true, third.ok ? "" : JSON.stringify(third.error));
  const finalView = await loadFigurePanel(repository, ACTOR_A, MATTER_ID, { targetId: TARGET_A, now: clock });
  assert.deepEqual(
    finalView.data.revisions.get(TARGET_A).entries.map((e) => [e.figureId, e.number, e.numerals]),
    [[FIG_2, 1, []]],
    "figure 2 keeps its (empty) numerals after renumbering",
  );
});

test("V6-12 UI numerals of untouched figures survive removing another figure", async () => {
  const FIG_2 = "88888888-8888-4888-8888-888888888882";
  const current = {
    id: "r",
    parentId: null,
    hash: "h",
    createdAt: "2026-11-01T00:00:00.000Z",
    entries: [
      { figureId: FIG_1, number: 1, title: "图1", drawingId: "d1", numerals: [] },
      { figureId: FIG_2, number: 2, title: "图2", drawingId: "d2", numerals: [{ value: "20", label: "盖板" }] },
    ],
  };
  const kept = ui.removeEntry(current, FIG_1);
  assert.deepEqual(kept.map((e) => [e.figureId, e.number, e.numerals]), [[FIG_2, 1, [{ value: "20", label: "盖板" }]]]);
  assert.deepEqual(current.entries[1].numerals, [{ value: "20", label: "盖板" }], "the input is not mutated");
});
