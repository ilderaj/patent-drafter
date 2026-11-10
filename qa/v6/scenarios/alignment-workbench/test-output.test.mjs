import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../../../..");
const TEST_OUTPUT_NOTICE = join(ROOT, "apps/web/src/v6/features/workbench/TestOutputNotice.tsx");
let outdir;
let ui;

before(async () => {
  outdir = mkdtempSync(join(tmpdir(), "v6-alignment-test-output-"));
  const outfile = join(outdir, "ui.cjs");
  const harness = `
    import { renderToStaticMarkup } from "react-dom/server";
    import { TestOutputNotice } from ${JSON.stringify(TEST_OUTPUT_NOTICE)};
    export const renderNotice = (revision, testId) => renderToStaticMarkup(<TestOutputNotice revision={revision} testId={testId} />);
  `;
  await esbuild.build({
    stdin: { contents: harness, resolveDir: ROOT, sourcefile: "alignment-test-output-harness.tsx", loader: "tsx" },
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

test("persisted test-output metadata shows a strong notice and normal revisions show none", () => {
  const testMarkup = ui.renderNotice({ id: "rev-test", testOutput: true }, "draft-test-output");
  assert.match(testMarkup, /测试输出，仅用于验证流程，不能作为正式申请材料/);
  assert.match(testMarkup, /data-testid="draft-test-output"/);

  const ordinaryMarkup = ui.renderNotice({ id: "rev-normal", testOutput: false }, "draft-test-output");
  assert.equal(ordinaryMarkup, "");
});
