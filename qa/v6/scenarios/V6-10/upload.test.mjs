/**
 * V6-10 — upload surface scenarios (S02 UI states, 材料选择).
 *
 * `Upload.tsx` cannot be imported by Node directly (JSX and React), so the real
 * component is bundled with esbuild and rendered with `react-dom/server` here.
 * That proves the initial surface, the exact markup of every state S02 names,
 * and — through the exported reducer — that a repeated pick is one row, that a
 * saved row cannot be removed, and that 「已保存」 can only come from a
 * committed asset. Clicking a real browser is browser evidence added by the
 * orchestrator after registration; nothing here claims it happened.
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
  describeUploadRows,
  rowFromProgress,
} from "../../../../apps/web/src/v6/features/sources/ingest.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../../../..");
const SOURCE = join(ROOT, "apps/web/src/v6/features/sources/Upload.tsx");

const ACTOR = Object.freeze({ tenantId: "11111111-1111-4111-8111-111111111111", userId: "33333333-3333-4333-8333-333333333333" });
const MATTER_ID = "55555555-5555-4555-8555-555555555555";

let outdir;
let upload;

before(async () => {
  outdir = mkdtempSync(join(tmpdir(), "v6-10-bundle-"));
  const outfile = join(outdir, "upload.cjs");
  const harness = `
    import { renderToStaticMarkup } from "react-dom/server";
    import { Upload, UploadPanel } from ${JSON.stringify(SOURCE)};
    export function renderUpload(props) { return renderToStaticMarkup(<Upload {...props} />); }
    export function renderPanel(props) { return renderToStaticMarkup(<UploadPanel {...props} />); }
    export { initialUploadState, pendingForSave, rowsFromItems, uploadReducer } from ${JSON.stringify(SOURCE)};
  `;
  await esbuild.build({
    stdin: { contents: harness, resolveDir: ROOT, sourcefile: "v6-10-upload-harness.tsx", loader: "tsx" },
    bundle: true,
    outfile,
    format: "cjs",
    platform: "node",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
    logLevel: "silent",
  });
  upload = createRequire(outfile)(outfile);
});

after(() => {
  if (outdir) rmSync(outdir, { recursive: true, force: true });
});

const noop = () => {};

function panelProps(view, extra = {}) {
  return {
    view,
    busy: false,
    pendingCount: 1,
    onFiles: noop,
    onRemove: noop,
    onSave: noop,
    onCancel: noop,
    onAnswerWithoutDocuments: noop,
    ...extra,
  };
}

function savedRow(fileId, name) {
  return rowFromProgress(
    { fileId, name, stage: "saved", receivedBytes: 10, totalBytes: 10, assetId: "a-1" },
    {
      status: "saved",
      fileId,
      name,
      assetId: "a-1",
      sha256: "a".repeat(64),
      byteLength: 10,
      kind: "docx",
    },
  );
}

function failedRow(fileId, name, code = "STORAGE_UNAVAILABLE") {
  return rowFromProgress(
    { fileId, name, stage: "verifying", receivedBytes: 10, totalBytes: 10 },
    { status: "failed", fileId, name, code, message: "repository refused" },
  );
}

function rejectedRow(fileId, name, code = "MIME_MISMATCH") {
  return rowFromProgress(
    { fileId, name, stage: "rejected", receivedBytes: 0, totalBytes: 0, code },
    { status: "rejected", fileId, name, code, message: "content mismatch" },
  );
}

test("V6-10-S02 the initial surface offers a picker, a drop zone and answering without documents", () => {
  const markup = upload.renderUpload({
    repository: { loadMatter: noop },
    actor: ACTOR,
    matterId: MATTER_ID,
    onAnswerWithoutDocuments: noop,
  });
  assert.match(markup, /type="file"/);
  assert.match(markup, /multiple=""/);
  assert.match(markup, /accept="\.pdf,\.docx,\.txt,\.md,\.png,\.jpg,\.jpeg/);
  assert.match(markup, /data-testid="upload-dropzone"/);
  assert.match(markup, /data-testid="upload-input"/);
  assert.match(markup, /拖入文件，或点这里选择/);
  assert.match(markup, /没有现成文档，直接回答问题/);
  assert.doesNotMatch(markup, /已保存/);
  assert.doesNotMatch(markup, /data-testid="upload-row-/);
  const saveButton = markup.match(/<button[^>]*data-testid="upload-save"[^>]*>/)?.[0] ?? "";
  assert.ok(saveButton.includes("disabled"), "nothing picked yet: saving must be disabled");
});

test("V6-10-S02 a committed file shows 已保存 only after the asset exists", () => {
  const view = describeUploadRows([savedRow("row-1", "合成说明书.docx")]);
  assert.equal(view.allSaved, true);
  assert.equal(view.hasProblems, false);
  const markup = upload.renderPanel(panelProps(view, { pendingCount: 0 }));
  assert.match(markup, /已保存/);
  assert.match(markup, /data-saved="true"/);
  assert.match(markup, /data-testid="upload-all-saved"/);
  assert.match(markup, /aria-valuenow="100"/);
  assert.match(markup, /width:100%/);
  assert.doesNotMatch(markup, /data-testid="upload-problems"/);
  assert.doesNotMatch(markup, /upload-remove-row-1/, "a saved asset is not removable here");
});

test("V6-10-S02 a storage failure never shows 已保存 and stays removable and retryable", () => {
  const view = describeUploadRows([failedRow("row-2", "失败.docx")]);
  assert.equal(view.allSaved, false);
  assert.equal(view.hasProblems, true);
  const markup = upload.renderPanel(panelProps(view, { pendingCount: 1 }));
  assert.match(markup, /本机存储不可用；文件没有保存。/);
  assert.match(markup, /data-saved="false"/);
  assert.match(markup, /data-testid="upload-problems"/);
  assert.match(markup, /data-testid="upload-remove-row-2"/);
  assert.doesNotMatch(markup, /已保存/);
  assert.doesNotMatch(markup, /data-testid="upload-all-saved"/);
  const saveButton = markup.match(/<button[^>]*data-testid="upload-save"[^>]*>/)?.[0] ?? "";
  assert.ok(!saveButton.includes("disabled"), "a failed file must be retryable");
});

test("V6-10-S02 a rejected file states the reason and creates no saved state", () => {
  const view = describeUploadRows([rejectedRow("row-3", "假.docx")]);
  assert.equal(view.hasProblems, true);
  const markup = upload.renderPanel(panelProps(view, { pendingCount: 0 }));
  assert.match(markup, /文件内容与扩展名或声明类型不一致/);
  assert.match(markup, /data-saved="false"/);
  assert.match(markup, /data-testid="upload-remove-row-3"/);
  assert.doesNotMatch(markup, /已保存/);
  const saveButton = markup.match(/<button[^>]*data-testid="upload-save"[^>]*>/)?.[0] ?? "";
  assert.ok(saveButton.includes("disabled"), "a rejected-only list has nothing left to save");
});

test("V6-10-S02 progress is the real read fraction and a busy batch can be cancelled", () => {
  const row = rowFromProgress(
    { fileId: "row-4", name: "进行中.pdf", stage: "uploading", receivedBytes: 50, totalBytes: 100 },
    null,
  );
  const view = describeUploadRows([row]);
  const markup = upload.renderPanel(panelProps(view, { busy: true, pendingCount: 1 }));
  assert.match(markup, /data-stage="uploading"/);
  assert.match(markup, /aria-valuenow="50"/);
  assert.match(markup, /width:50%/);
  assert.match(markup, /正在读取/);
  assert.match(markup, /data-testid="upload-cancel"/);
  assert.match(markup, /正在保存…/);
  const saveButton = markup.match(/<button[^>]*data-testid="upload-save"[^>]*>/)?.[0] ?? "";
  assert.ok(saveButton.includes("disabled"), "a second click while saving must be disabled");
});

test("V6-10-S02 the reducer keeps one row per file and never removes a stored asset", () => {
  const first = new File([new Uint8Array([1, 2, 3])], "同一份.pdf", { type: "application/pdf" });
  const second = new File([new Uint8Array([4, 5, 6])], "另一份.pdf", { type: "application/pdf" });
  let state = upload.uploadReducer(upload.initialUploadState, {
    type: "add",
    entries: [
      { fileId: "f1", file: first },
      { fileId: "f2", file: first },
    ],
  });
  assert.equal(state.items.length, 1, "the same pick twice is one row");
  state = upload.uploadReducer(state, { type: "add", entries: [{ fileId: "f3", file: second }] });
  assert.equal(state.items.length, 2);

  state = upload.uploadReducer(state, { type: "remove", fileId: "f3" });
  assert.deepEqual(state.items.map((item) => item.fileId), ["f1"]);

  state = upload.uploadReducer(state, {
    type: "settle",
    outcomes: [
      {
        status: "saved",
        fileId: "f1",
        name: "同一份.pdf",
        assetId: "a-9",
        sha256: "b".repeat(64),
        byteLength: 3,
        kind: "pdf",
      },
    ],
  });
  assert.equal(upload.pendingForSave(state).length, 0);
  const rows = upload.rowsFromItems(state.items);
  assert.equal(rows[0].saved, true);
  assert.equal(rows[0].label, "已保存");

  const afterRemoveSaved = upload.uploadReducer(state, { type: "remove", fileId: "f1" });
  assert.equal(afterRemoveSaved.items.length, 1, "a stored asset stays on screen");
});

test("V6-10-S02 a file that has not started is an explicit selected row at zero", () => {
  const file = new File([new Uint8Array([1, 2, 3, 4])], "待上传.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
  const state = upload.uploadReducer(upload.initialUploadState, {
    type: "add",
    entries: [{ fileId: "f-5", file }],
  });
  const rows = upload.rowsFromItems(state.items);
  assert.equal(rows[0].stage, "selected");
  assert.equal(rows[0].fraction, 0);
  assert.equal(rows[0].saved, false);
  assert.equal(rows[0].error, null);
  assert.equal(upload.pendingForSave(state).length, 1);
  const markup = upload.renderPanel(panelProps(describeUploadRows(rows)));
  assert.match(markup, /data-stage="selected"/);
  assert.match(markup, /已选择/);
  assert.doesNotMatch(markup, /已保存/);
});

test("V6-10-S02 a cancelled row is removable and is not reported as a problem", () => {
  const row = rowFromProgress(
    { fileId: "row-6", name: "取消.pdf", stage: "uploading", receivedBytes: 30, totalBytes: 100 },
    { status: "cancelled", fileId: "row-6", name: "取消.pdf" },
  );
  assert.equal(row.saved, false);
  assert.equal(row.label, "已取消");
  assert.equal(row.canRemove, true);
  const view = describeUploadRows([row]);
  assert.equal(view.hasProblems, false);
  const markup = upload.renderPanel(panelProps(view, { pendingCount: 1 }));
  assert.match(markup, /已取消/);
  assert.doesNotMatch(markup, /已保存/);
});
