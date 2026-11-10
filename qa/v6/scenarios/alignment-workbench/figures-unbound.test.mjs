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
  importDrawing,
  loadFigurePanel,
} from "../../../../apps/web/src/v6/features/sources/drawings.ts";
import { CONTRACT_VERSION, openLocalRepository } from "../../../../apps/web/src/v6/lib/repository.ts";
import {
  ACTOR_A,
  EMPTY_SET_A,
  MATTER_ID,
  MemoryBackend,
  T0,
  TARGET_A,
  fixture,
  REQUEST_ID,
  clock,
} from "../V6-12/harness.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../../../..");
const SOURCE = join(ROOT, "apps/web/src/v6/features/sources/Figures.tsx");
const FIG_1 = "88888888-8888-4888-8888-888888888881";

let outdir;
let ui;

before(async () => {
  outdir = mkdtempSync(join(tmpdir(), "v6-unbound-figures-"));
  const outfile = join(outdir, "figures.cjs");
  const harness = `
    import { renderToStaticMarkup } from "react-dom/server";
    import { FiguresPanel } from ${JSON.stringify(SOURCE)};
    export { appendEntry, unboundFigureRevision } from ${JSON.stringify(SOURCE)};
    export const renderPanel = (props) => renderToStaticMarkup(<FiguresPanel {...props} />);
  `;
  await esbuild.build({
    stdin: { contents: harness, resolveDir: ROOT, sourcefile: "alignment-figures-harness.tsx", loader: "tsx" },
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

after(() => { if (outdir) rmSync(outdir, { recursive: true, force: true }); });

/** A matter whose target names its first revision id but has no set row yet. */
async function seedUnbound() {
  const backend = new MemoryBackend();
  const repository = openLocalRepository(backend);
  const created = await repository.commit(ACTOR_A, {
    contractVersion: CONTRACT_VERSION,
    expectedVersion: 0,
    payload: {
      matter: {
        id: MATTER_ID,
        tenantId: ACTOR_A.tenantId,
        version: 1,
        title: "未绑定图集案件",
        status: "active",
        sourceVersion: 1,
        createdBy: ACTOR_A.userId,
        createdAt: T0,
        updatedAt: T0,
      },
      targets: [{
        id: TARGET_A,
        matterId: MATTER_ID,
        status: "active",
        configVersion: 1,
        draftRevisionId: null,
        figureRevisionId: EMPTY_SET_A,
      }],
      assets: [],
      events: [],
      blobs: [],
    },
  }, { requestId: REQUEST_ID });
  assert.equal(created.ok, true, created.ok ? "" : JSON.stringify(created.error));
  return { backend, repository };
}

const noop = () => {};

function render(view) {
  return ui.renderPanel({
    view,
    busy: false,
    onImport: noop,
    onDelete: noop,
    onAppend: noop,
    onRemove: noop,
    onReload: noop,
  });
}

test("a target without a first set row still offers the bind entry", async () => {
  const { repository } = await seedUnbound();
  const imported = await importDrawing(repository, ACTOR_A, MATTER_ID, {
    bytes: fixture("drawing-valid.png"),
    fileName: "drawing-valid.png",
  }, { now: clock });
  assert.equal(imported.ok, true, imported.ok ? "" : JSON.stringify(imported.error));

  const view = await loadFigurePanel(repository, ACTOR_A, MATTER_ID, { targetId: TARGET_A, now: clock });
  assert.equal(view.kind, "library");
  assert.equal(view.data.revisions.has(TARGET_A), false, "no persisted set row yet");
  const html = render(view);
  assert.match(html, /data-testid="figures-set-missing"/);
  assert.match(html, new RegExp(`figure-append-${imported.data.drawing.id}`));
  assert.match(html, /编入图集/);
  assert.doesNotMatch(html, /data-testid="figures-set"/);
});

test("binding from the empty entry creates the first set at the target's own revision id", async () => {
  const { repository } = await seedUnbound();
  const imported = await importDrawing(repository, ACTOR_A, MATTER_ID, {
    bytes: fixture("drawing-valid.jpg"),
    fileName: "drawing-valid.jpg",
  }, { now: clock });
  assert.equal(imported.ok, true);

  const base = ui.unboundFigureRevision({ figureRevisionId: EMPTY_SET_A });
  assert.equal(base.id, EMPTY_SET_A);
  assert.deepEqual(base.entries, []);
  const bound = await bindFigures(repository, ACTOR_A, MATTER_ID, {
    targetId: TARGET_A,
    baseFigureRevisionId: base.id,
    entries: ui.appendEntry(base, imported.data.drawing.id, FIG_1),
  }, { now: clock });
  assert.equal(bound.ok, true, bound.ok ? "" : JSON.stringify(bound.error));

  const after = await loadFigurePanel(repository, ACTOR_A, MATTER_ID, { targetId: TARGET_A, now: clock });
  assert.equal(after.kind, "library");
  const current = after.data.revisions.get(TARGET_A);
  assert.ok(current);
  assert.equal(current.parentId, EMPTY_SET_A);
  assert.deepEqual(current.entries.map((item) => [item.number, item.drawingId]), [[1, imported.data.drawing.id]]);
  const html = render(after);
  assert.doesNotMatch(html, /data-testid="figures-set-missing"/);
  assert.match(html, /data-testid="figure-entry-1"/);
  repository.close();
});
