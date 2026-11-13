/**
 * Workbench generation consent sheet: the disclosure is rendered from the
 * resolved runtime and unknown values stay visibly unknown.
 *
 * This renders the pure sheet only; it does not call a model, a provider or the
 * status endpoint and is not a live-provider acceptance run.
 */
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../../../..");
const SOURCE = join(ROOT, "apps/web/src/v6/features/workbench/GenerationRuntime.tsx");
let outdir;
let sheet;

before(async () => {
  outdir = mkdtempSync(join(tmpdir(), "v6-alignment-consent-"));
  const outfile = join(outdir, "consent.cjs");
  const harness = `
    import { renderToStaticMarkup } from "react-dom/server";
    import { MemoryRouter } from "react-router-dom";
    import { WorkbenchConsentSheet } from ${JSON.stringify(SOURCE)};
    export const renderSheet = (props) => renderToStaticMarkup(<MemoryRouter><WorkbenchConsentSheet {...props} /></MemoryRouter>);
  `;
  await esbuild.build({
    stdin: { contents: harness, resolveDir: ROOT, sourcefile: "consent-harness.tsx", loader: "tsx" },
    bundle: true,
    outfile,
    format: "cjs",
    platform: "node",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
    logLevel: "silent",
    plugins: [{
      name: "vite-raw",
      setup(build) {
        build.onResolve({ filter: /\?raw$/ }, (args) => ({
          path: resolve(args.resolveDir, args.path.replace(/\?raw$/, "")),
          namespace: "vite-raw",
        }));
        build.onLoad({ filter: /.*/, namespace: "vite-raw" }, (args) => ({
          contents: `export default ${JSON.stringify(readFileSync(args.path, "utf8"))}`,
          loader: "js",
        }));
      },
    }],
  });
  sheet = createRequire(outfile)(outfile);
});

after(() => { if (outdir) rmSync(outdir, { recursive: true, force: true }); });

function ready(code = "") {
  return sheet.renderSheet({
    runtime: null,
    accessCode: code,
    busy: false,
    error: null,
    onCode() {},
    onClose() {},
    onAuthenticate() {},
    onAgree() {},
    onRefresh() {},
  });
}

const MANIFEST = {
  matterId: "11111111-1111-4111-8111-111111111111",
  targetId: "22222222-2222-4222-8222-222222222222",
  sourceVersion: 3,
  title: "合成案件标题",
  titleSent: true,
  files: [{ assetId: "44444444-4444-4444-8444-444444444444", name: "fixture-a.txt", pageCount: 2, byteLength: 12 }],
  factCount: 4,
  factIds: [],
  chunkIds: ["a", "b"],
  draftRevisionIds: [],
  figureRevisionIds: ["c"],
  answers: {
    total: 5, answered: 5, sentCount: 2, complete: true, missing: [],
    items: [
      { questionNo: 1, key: "problem", label: "问题", answered: true, sent: true, characters: 12, chunkId: "answer-problem" },
      { questionNo: 2, key: "difference", label: "区别", answered: true, sent: true, characters: 24, chunkId: "answer-difference" },
      { questionNo: 3, key: "inventorIds", label: "发明人", answered: true, sent: false, characters: null, chunkId: null },
      { questionNo: 4, key: "disclosure", label: "公开历史", answered: true, sent: false, characters: null, chunkId: null },
      { questionNo: 5, key: "maturity", label: "成熟度", answered: true, sent: false, characters: null, chunkId: null },
    ],
  },
  scope: { targetId: "22222222-2222-4222-8222-222222222222", assetIds: [], factIds: [], chunkIds: [], draftRevisionIds: [], figureRevisionIds: [] },
  payloadManifestHash: "f".repeat(64),
};

const REAL = {
  mode: "real",
  engineOptions: {},
  consent: { required: true, manifest: MANIFEST, grant: async () => { throw new Error("not called"); } },
  processor: { name: "Synthetic Processor", region: "cn-test-1", retention: "retention-1", trainingPolicy: "no_training", termsVersion: "terms-1", model: "model-1" },
  unavailableReason: null,
};

test("the sheet never invents processor facts: unknown values stay 「未知」 and no real start is possible", () => {
  const html = ready();
  assert.match(html, /data-testid="workbench-consent-disclosure"/);
  assert.match(html, /用途/);
  assert.match(html, /处理方/);
  assert.match(html, /区域/);
  assert.match(html, /保留/);
  assert.match(html, /<span class="cb-k">处理方<\/span><span class="cb-v">未知<\/span>/);
  assert.match(html, /data-testid="workbench-consent-materials"[^>]*>[\s\S]*?未知；建立访问会话后读取本次材料清单/);
  assert.match(html, /data-testid="workbench-consent-title"[^>]*>\s*未知；建立访问会话后读取本次外发清单/);
  assert.match(html, /data-testid="workbench-consent-access-code"/);
  assert.match(/<button[^>]*data-testid="workbench-consent-agree"[^>]*>/.exec(html)[0], /disabled=""/);
  assert.doesNotMatch(html, /0 条事实/);
});

test("the access code is never pre-filled and is required before verification", () => {
  const empty = ready("");
  assert.match(/<button[^>]*data-testid="workbench-consent-authenticate"[^>]*>/.exec(empty)[0], /disabled=""/);
  assert.doesNotMatch(empty, /value="[^"]+"/);
});

test("a real runtime discloses its processor, policy and exact material list before consent", () => {
  const html = sheet.renderSheet({
    runtime: REAL,
    accessCode: "",
    busy: false,
    error: null,
    onCode() {},
    onClose() {},
    onAuthenticate() {},
    onAgree() {},
    onRefresh() {},
  });
  assert.match(html, /Synthetic Processor/);
  assert.match(html, /cn-test-1/);
  assert.match(html, /retention-1/);
  assert.match(html, /不用于训练/);
  assert.match(html, /terms-1/);
  assert.match(html, /model-1/);
  assert.match(html, /fixture-a\.txt · 2 页/);
  assert.match(html, /data-testid="workbench-consent-title-sent">合成案件标题</);
  assert.match(html, /可能作为主题背景随本次请求外发/);
  assert.match(html, /4 条事实 · 2 个材料片段 · 0 份草稿修订 · 1 份附图修订/);
  assert.ok(html.includes('data-testid="workbench-consent-answers"'));
  assert.ok(html.includes("已回答 5/5 题；将外发其中 2 条技术回答"));
  assert.match(html, /第 1 题 · 问题 · 约 12 字/);
  assert.match(html, /第 2 题 · 区别 · 约 24 字/);
  assert.match(html, /发明人、公开历史、成熟度只在本机/);
  assert.doesNotMatch(html, /data-testid="workbench-consent-no-files"/);
  assert.doesNotMatch(html, /data-testid="workbench-consent-access-code"/);
  assert.doesNotMatch(/<button[^>]*data-testid="workbench-consent-agree"[^>]*>/.exec(html)[0], /disabled=""/);
  assert.doesNotMatch(html, /测试输出/);
});

test("answer-only consent lists outbound answers, keeps the other three local, and blocks real start until complete", () => {
  const incomplete = {
    ...MANIFEST,
    files: [],
    chunkIds: ["answer-problem", "answer-difference"],
    answers: {
      ...MANIFEST.answers,
      answered: 4,
      complete: false,
      missing: ["第 5 题（成熟度）"],
      items: MANIFEST.answers.items.map((item) => item.questionNo === 5 ? { ...item, answered: false } : item),
    },
  };
  const runtime = { ...REAL, consent: { ...REAL.consent, manifest: incomplete } };
  const html = sheet.renderSheet({
    runtime, answerHref: "/v6/new/matter/questions", accessCode: "", busy: false, error: null,
    onCode() {}, onClose() {}, onAuthenticate() {}, onAgree() {}, onRefresh() {},
  });
  assert.match(html, /没有上传文档；本次内容来自你保存的回答与事实/);
  assert.doesNotMatch(html, /0 个文件|0 份文件|fixture-a\\.txt/);
  assert.match(html, /第 1 题 · 问题 · 约 12 字/);
  assert.match(html, /第 2 题 · 区别 · 约 24 字/);
  assert.match(html, /还缺：第 5 题（成熟度）/);
  assert.match(html, /发明人、公开历史、成熟度只在本机/);
  assert.ok(html.includes('href="/v6/new/matter/questions"'), "answer link returns to the question step");
  assert.match(html, /data-testid="workbench-consent-answer-gate"/);
  assert.match(/<button[^>]*data-testid="workbench-consent-agree"[^>]*>/.exec(html)[0], /disabled=""/);
});

test("the case title is disclosed as exact text when sent, escaped, and marked as not sent otherwise", () => {
  const renderTitle = (title, titleSent) => sheet.renderSheet({
    runtime: { ...REAL, consent: { ...REAL.consent, manifest: { ...MANIFEST, title, titleSent } } },
    accessCode: "", busy: false, error: null,
    onCode() {}, onClose() {}, onAuthenticate() {}, onAgree() {}, onRefresh() {},
  });
  const sent = renderTitle("一种<b>防倾倒</b>杯", true);
  assert.ok(sent.includes("一种&lt;b&gt;防倾倒&lt;/b&gt;杯"), "title is a text node, escaped");
  assert.doesNotMatch(sent, /<b>防倾倒<\/b>/);
  const local = renderTitle("仅本机标题", false);
  assert.match(local, /data-testid="workbench-consent-title-local">不外发；标题仅留在本机：仅本机标题</);
  assert.doesNotMatch(local, /data-testid="workbench-consent-title-sent"/);
  const empty = renderTitle(null, true);
  assert.match(empty, /data-testid="workbench-consent-title-local">案件标题不外发。/);
  assert.doesNotMatch(empty, /data-testid="workbench-consent-title-sent"/);
});

test("a failed grant or access check is reported inside the sheet without starting anything", () => {
  const html = sheet.renderSheet({
    runtime: REAL,
    accessCode: "",
    busy: false,
    error: "外发确认没有完成，材料没有开始发送。",
    onCode() {},
    onClose() {},
    onAuthenticate() {},
    onAgree() {},
    onRefresh() {},
  });
  assert.match(html, /data-testid="workbench-consent-error"/);
  assert.match(html, /材料没有开始发送/);
});
