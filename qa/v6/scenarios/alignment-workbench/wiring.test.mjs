import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const fixtureHarness = await import("../V6-19/harness.mjs");
const [editor, preview] = await Promise.all([
  import("../../../../apps/web/src/v6/features/draft/Editor.tsx"),
  import("../../../../apps/web/src/v6/features/preview/Preview.tsx"),
]);
const { ACTOR, CLAIM_ID, MATTER_ID, TARGET_ID, makeFixture } = fixtureHarness;

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../../../..");
const EDITOR_SOURCE = join(ROOT, "apps/web/src/v6/features/draft/Editor.tsx");
const PREVIEW_SOURCE = join(ROOT, "apps/web/src/v6/features/preview/Preview.tsx");
let outdir;
let ui;

before(async () => {
  outdir = mkdtempSync(join(tmpdir(), "v6-alignment-wiring-"));
  const outfile = join(outdir, "ui.cjs");
  const harness = `
    import { renderToStaticMarkup } from "react-dom/server";
    import { DraftEditorEmptyState } from ${JSON.stringify(EDITOR_SOURCE)};
    import { PreviewEmpty } from ${JSON.stringify(PREVIEW_SOURCE)};
    export const renderEmpty = (props) => renderToStaticMarkup(<DraftEditorEmptyState {...props} />);
    export const renderPreviewEmpty = (props) => renderToStaticMarkup(<PreviewEmpty {...props} />);
  `;
  await esbuild.build({
    stdin: { contents: harness, resolveDir: ROOT, sourcefile: "alignment-wiring-harness.tsx", loader: "tsx" },
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

class MemoryBuffers {
  constructor() { this.active = null; }
  async loadActive() { return this.active === null ? null : structuredClone(this.active); }
  async save(buffer) { this.active = structuredClone(buffer); }
  async delete() { this.active = null; }
}

test("the empty state never dispatches a generation command it cannot serve", () => {
  const unavailable = ui.renderEmpty({ matterId: MATTER_ID, targetId: TARGET_ID, onManualWrite() {} });
  assert.match(unavailable, /data-testid="draft-generate"[^>]*disabled/);
  assert.match(unavailable, /当前工作台没有可用的生成面板/);
  assert.doesNotMatch(unavailable, /v6:draft-generate/);

  const reveal = ui.renderEmpty({
    matterId: MATTER_ID,
    targetId: TARGET_ID,
    onGenerateDraft() {},
    generateEntryLabel: "查看生成面板",
    onManualWrite() {},
  });
  assert.match(reveal, /查看生成面板/);
  assert.doesNotMatch(reveal, /data-testid="draft-generate"[^>]*disabled/);
});

test("the empty preview keeps generation reachable through the real draft route", () => {
  const markup = ui.renderPreviewEmpty({
    repository: {},
    actor: ACTOR,
    matterId: MATTER_ID,
    targetId: TARGET_ID,
    access: "local_unmetered",
  });
  assert.match(markup, /data-testid="preview-empty-generate"/);
  assert.match(markup, new RegExp(`href="/v6/matters/${MATTER_ID}/targets/${TARGET_ID}/draft"`));
});

test("reloading the editor after an adopted head keeps the unsaved local buffer", async () => {
  const fixture = await makeFixture();
  const buffers = new MemoryBuffers();
  const session = new editor.DraftEditorSession({
    repository: fixture.repository,
    actor: ACTOR,
    matterId: MATTER_ID,
    targetId: TARGET_ID,
    revisions: fixture.revisions,
    bufferStore: buffers,
  });
  await session.load();
  const original = session.getSnapshot();
  assert.ok(original.model);
  await session.updateParagraph({ claimId: CLAIM_ID }, 0, "本机尚未保存的内容");
  assert.equal(session.getSnapshot().dirty, true);

  const adoptedAst = structuredClone(fixture.ast);
  adoptedAst.title = "采纳后的新标题";
  const adopted = await fixture.revisions.saveEditedRevision(MATTER_ID, TARGET_ID, fixture.revision.id, adoptedAst);
  assert.equal(adopted.ok, true, adopted.ok ? "" : adopted.error.message);

  await session.refresh();
  const after = session.getSnapshot();
  assert.equal(after.latestRevision?.revision.id, adopted.data.id);
  assert.equal(after.baseRevisionId, fixture.revision.id);
  assert.equal(after.conflict, true);
  assert.ok(after.model);
  assert.equal(after.model.claims[0]?.paragraphs[0]?.text, "本机尚未保存的内容");
  assert.ok(buffers.active, "the unsaved buffer must still be stored");
  fixture.repository.close();
});
