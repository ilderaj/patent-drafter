// Real SelfService "done" step in headless Chrome: the page must show the figure
// status, require the acknowledgement when the draft references figures, and then
// export through the same code path the online smoke uses. In-memory repository.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import * as esbuild from "esbuild";
import { chromeSelfCheck, createCdpClient, launchChromeWithPageTarget, withTimeout } from "../../helpers/chrome.mjs";

let browser, server, client, downloadDir;
const errors = [];
const TEST_TIMEOUT_MS = 90_000;
const it = (name, fn) => test(name, { timeout: TEST_TIMEOUT_MS }, fn);
const evaluate = (expression, options) => client.evaluate(expression, options);
const waitFor = (expression, label = expression, options = { timeoutMs: 20_000 }) => client.waitFor(expression, label, options);
const exists = (selector) => evaluate(`!!document.querySelector(${JSON.stringify(selector)})`);
const text = (selector) => evaluate(`document.querySelector(${JSON.stringify(selector)})?.textContent ?? null`);
const click = (selector) => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) throw new Error('missing ${selector}'); el.click(); return true; })()`);

before(async () => {
  const root = resolve(import.meta.dirname, "../../../..");
  const build = await esbuild.build({
    stdin: { resolveDir: root, sourcefile: "self-done.tsx", loader: "tsx", contents: `
      import { createRoot } from 'react-dom/client';
      import { MemoryRouter } from 'react-router-dom';
      import { SelfService } from './apps/web/src/v6/features/self-service/SelfService.tsx';
      import { createSelfServiceMatter } from './apps/web/src/v6/routes/navigation.ts';
      import { createTarget } from './apps/web/src/v6/features/targets/targets.ts';
      import { createGenerationRevisionStore } from './apps/web/src/v6/features/generation/generation.ts';
      import { readIntake } from './apps/web/src/v6/features/intake/intake.ts';
      import { loadTargetsView } from './apps/web/src/v6/features/targets/targets.ts';
      import { requiredSelfServiceStep } from './apps/web/src/v6/features/self-service/route-state.ts';
      import { confirmLocalFullRead } from './apps/web/src/v6/features/preview/preview.ts';
      import { MemoryBackend } from './qa/v6/scenarios/V6-21/harness.mjs';
      import { openLocalRepository, STORES } from './apps/web/src/v6/lib/repository.ts';
      import { renderReportPages } from './apps/web/src/lib/export-render.ts';

      const actor = { tenantId: '11111111-1111-4111-8111-111111111111', userId: '22222222-2222-4222-8222-222222222222' };
      const T0 = '2026-11-15T10:00:00.000Z';
      const FIGURE_ID = '99999999-9999-4999-8999-999999999991';
      const paragraph = (id, text, extra = {}) => ({ id, text, origin: 'human', sourceRefs: [], factIds: [], figureIds: [], generationJobId: null, ...extra });
      const ast = {
        schemaVersion: 'draft.v1', language: 'zh-CN', title: '合成温控装置',
        claims: [{ id: '66666666-6666-4666-8666-666666666661', number: 1, dependsOn: [],
          paragraphs: [paragraph('77777777-7777-4777-8777-777777777771', '一种合成温控装置，包括温控组件。')], features: [] }],
        sections: [
          { kind: 'technical_field', paragraphs: [paragraph('77777777-7777-4777-8777-777777777772', '本实用新型涉及温控装置。')] },
          { kind: 'background', paragraphs: [paragraph('77777777-7777-4777-8777-777777777773', '现有温控装置结构复杂。')] },
          { kind: 'summary', paragraphs: [paragraph('77777777-7777-4777-8777-777777777774', '本方案简化温控结构。')] },
          { kind: 'figures_description', paragraphs: [paragraph('77777777-7777-4777-8777-777777777775', '图1为本实用新型结构示意图。', { figureIds: [FIGURE_ID] })] },
          { kind: 'embodiments', paragraphs: [paragraph('77777777-7777-4777-8777-777777777776', '以下结合图1说明实施方式。')] },
          { kind: 'abstract', paragraphs: [paragraph('77777777-7777-4777-8777-777777777777', '一种合成温控装置。')] },
        ],
      };

      window.fixture = {
        async renderLongChecklist() {
          window.__drawn = [];
          window.__canvasCount = 0;
          const items = [];
          for (let i = 0; i < 30; i++) items.push({ text: '内容确认 ID：' + crypto.randomUUID(), tone: 'ink' });
          items.push({ text: '附图：0 张（本次材料包不含附图）', tone: 'warn' });
          for (let i = 0; i < 4; i++) items.push({ text: '测试输出-说明书.docx · 1604 bytes · SHA-256 ' + 'a'.repeat(64), tone: 'ink' });
          await renderReportPages({
            title: '测试输出，仅用于验证流程，不能作为正式申请材料：申请准备材料：全文与提交检查清单',
            meta: [
              { label: '案件', value: '合成案件' },
              { label: '附图', value: '0 张（本次材料包不含附图）' },
            ],
            sections: [{ heading: '提交检查清单', items, emptyText: '（无检查项目）' }],
            footer: '测试输出，非正式申请稿；申请准备材料，非递交回执。',
          });
          return window.__drawn;
        },
        async seed() {
          const repository = openLocalRepository(new MemoryBackend());
          const matterId = crypto.randomUUID();
          const created = await createSelfServiceMatter(repository, actor, {
            matterId, eventId: crypto.randomUUID(), requestId: crypto.randomUUID(), now: T0, title: '自助无附图案件',
          });
          if (!created.ok) throw new Error(JSON.stringify(created));
          const partyId = crypto.randomUUID();
          const provenance = {};
          for (const key of ['problem', 'difference', 'inventorIds', 'disclosure', 'maturity']) {
            provenance[key] = { key, source: { kind: 'direct' }, basedOnVersion: 1, savedAt: T0 };
          }
          await repository.backend.transaction('readwrite', (tx) => tx.put(STORES.blobs, 'intake/snapshot/' + matterId + '/1', {
            kind: 'intake.snapshot',
            provenance,
            snapshot: {
              matterId, version: 1, sourceIds: [], facts: [], conflicts: [],
              answers: { problem: '结构复杂', difference: '简化温控结构', inventorIds: [partyId], disclosure: 'none', maturity: 'drawing', disclosureDetail: null },
              parties: [{ id: partyId, kind: 'person', name: '合成发明人', roles: ['inventor'], country: 'CN' }],
              createdBy: actor.userId, createdAt: T0,
            },
          }));
          const target = await createTarget(repository, actor, matterId, {
            config: { route: 'cn_um', language: 'zh-CN', applicantIds: [], inventorIds: [partyId], priorityClaims: [] },
          }, { requestKey: crypto.randomUUID() });
          if (!target.ok) throw new Error(JSON.stringify(target.error));
          const targetId = target.data.target.id;
          const revisions = createGenerationRevisionStore({ repository, actor, now: () => new Date(T0) });
          const saved = await revisions.saveEditedRevision(matterId, targetId, null, ast);
          if (!saved.ok) throw new Error(JSON.stringify(saved.error));
          const snapshot = {
            matterId, targetId, sourceVersion: 1, targetConfigVersion: 1,
            draftRevisionId: saved.data.id, figureRevisionId: target.data.target.figureRevisionId,
          };
          const read = await confirmLocalFullRead({ repository, actor, snapshot, access: 'local_unmetered', now: () => T0 });
          if (!read.ok) throw new Error(JSON.stringify(read.error));
          const rootEl = document.getElementById('root');
          createRoot(rootEl).render(
            <MemoryRouter initialEntries={['/v6/new/' + matterId + '/done?target=' + targetId]}>
              <SelfService repository={repository} actor={actor} matterId={matterId} step="done" />
            </MemoryRouter>,
          );
          this.diag = async () => {
            const intake = await readIntake(repository, actor, matterId);
            const targets = await loadTargetsView(repository, actor, matterId);
            const loaded = await repository.loadMatter(actor, matterId);
            const active = targets.ok ? targets.view.targets.filter((t) => t.status === 'active') : [];
            const targetRecord = loaded.ok ? loaded.data.data.targets.find((t) => t.id === targetId) : null;
            return JSON.stringify({
              intakeOk: intake.ok, missing: intake.ok ? intake.view.missing : null,
              targetsOk: targets.ok, active: active.length,
              configs: active.map((t) => t.config !== null),
              draftRevisionId: targetRecord ? targetRecord.draftRevisionId : null,
              step: intake.ok && targets.ok ? requiredSelfServiceStep('done', { intake: intake.view, target: active[0] ?? null, targetRecord }) : null,
            });
          };
          return { matterId, targetId };
        },
      };
    ` },
    bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    loader: { ".css": "empty" },
    define: { "process.env.NODE_ENV": '"production"' }, logLevel: "silent",
    plugins: [{
      name: "node-builtin-shim",
      setup(build) {
        build.onResolve({ filter: /^node:(fs\/promises|path)$/ }, (args) => ({ path: args.path, namespace: "node-builtin-shim" }));
        build.onLoad({ filter: /.*/, namespace: "node-builtin-shim" }, (args) => ({
          loader: "js",
          contents: args.path === "node:fs/promises"
            ? "export async function readFile() { throw new Error('文件系统在浏览器 fixture 中不可用'); }\nexport default { readFile };"
            : "export function join(...parts) { return parts.join('/'); }\nexport default { join };",
        }));
      },
    }, {
      name: "vite-raw",
      setup(build) {
        build.onResolve({ filter: /\?raw$/ }, (args) => ({ path: resolve(args.resolveDir, args.path.replace(/\?raw$/, "")), namespace: "vite-raw" }));
        build.onLoad({ filter: /.*/, namespace: "vite-raw" }, (args) => ({ contents: `export default ${JSON.stringify(readFileSync(args.path, "utf8"))}`, loader: "js" }));
      },
    }],
  });
  server = createServer((request, response) => {
    response.setHeader("content-type", request.url === "/fixture.js" ? "application/javascript" : "text/html; charset=utf-8");
    response.end(request.url === "/fixture.js" ? build.outputFiles[0].contents : '<div id="root"></div><script src="/fixture.js"></script>');
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  await withTimeout((async () => {
    await chromeSelfCheck({ profilePrefix: "v6-selfdone-selfcheck-", timeoutMs: 60_000 });
    browser = await launchChromeWithPageTarget({ profilePrefix: "v6-selfdone-" });
    downloadDir = mkdtempSync(join(tmpdir(), "v6-selfdone-dl-"));
    client = createCdpClient(browser.socket, { requestTimeoutMs: 10_000, onEvent: (message) => {
      if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails.text);
    } });
    await client.send("Runtime.enable");
    await client.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: downloadDir, eventsEnabled: true });
    await client.send("Page.navigate", { url: `http://127.0.0.1:${server.address().port}` });
    await client.waitFor("!!window.fixture", "fixture loaded", { timeoutMs: 20_000 });
  })(), 90_000, "self done browser setup");
});
after(async () => {
  await withTimeout(browser?.close() ?? Promise.resolve(), 20_000, "browser close").catch((error) => console.error(`cleanup: ${error.message}`));
  if (server) await new Promise((done) => server.close(done));
  if (downloadDir) rmSync(downloadDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

it("self-service done without figures requires the acknowledgement, then exports through the real page", async () => {
  const { matterId, targetId } = await evaluate("fixture.seed()");
  await waitFor(`!!document.querySelector('[data-testid="self-done-step"]')`, "self done step");
  await waitFor(`!!document.querySelector('[data-testid="done-figures"]')`, "figure block in self done");

  assert.match(await text('[data-testid="done-figure-status"]'), /附图：0 张/);
  assert.match(await text('[data-testid="done-figures-none"]'), /未添加附图：本次材料包不含附图，提交前请按需要补充/);
  assert.equal(await evaluate("document.querySelector('[data-testid=done-add-figures]').getAttribute('href')"),
    `/v6/matters/${matterId}/targets/${targetId}/sources`);
  assert.equal(await exists('[data-testid="done-figure-ack"]'), true, "referenced draft asks for the acknowledgement");
  assert.equal(await evaluate("document.querySelector('[data-testid=done-export-button]').disabled"), true);

  await evaluate(`(() => {
    const input = document.querySelector('[data-testid="done-passphrase"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'synthetic-self-passphrase');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true; })()`);
  await click('[data-testid="done-figure-ack"]');
  await waitFor("document.querySelector('[data-testid=done-export-button]').disabled === false", "export enabled after acknowledgement");

  await evaluate(`(() => {
    window.__drawn = [];
    window.__canvasCount = 0;
    const ctxProto = CanvasRenderingContext2D.prototype;
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (...args) {
      const ctx = getContext.apply(this, args);
      if (ctx && this.__v6Page === undefined) this.__v6Page = ++window.__canvasCount;
      return ctx;
    };
    if (!ctxProto.__v6Patched) {
      const original = ctxProto.fillText;
      ctxProto.fillText = function (text, x, y, ...rest) {
        window.__drawn.push({ page: this.canvas.__v6Page ?? 0, text: String(text), x, y, font: this.font });
        return original.call(this, text, x, y, ...rest);
      };
      ctxProto.__v6Patched = true;
    }
    return true; })()`);
  await click('[data-testid="done-export-button"]');
  await waitFor(`document.querySelectorAll('[data-testid^="done-file-"]').length > 0`, "exported files listed", { timeoutMs: 60_000 });
  const names = await evaluate(`[...document.querySelectorAll('[data-testid^="done-file-"] .dl-n')].map((node) => node.textContent)`);
  assert.ok(names.some((name) => name.endsWith("权利要求书.docx")), JSON.stringify(names));
  assert.equal(names.some((name) => name.startsWith("附图原件-")), false, "no figure originals in a no-figure package");
  assert.match(await text('[data-testid="done-figures-none"]'), /未添加附图/);

  // The checklist PDF is drawn on a canvas; check what the renderer actually wrote.
  const drawn = JSON.parse(await evaluate("JSON.stringify(window.__drawn)"));
  const pages = [...new Set(drawn.map((entry) => entry.page))];
  const figureLines = drawn.filter((entry) => entry.text.includes("附图：0 张（本次材料包不含附图）"));
  assert.ok(figureLines.length >= 1, "the checklist renderer draws the figure line");
  assert.match(drawn.map((entry) => entry.text).join("|"), /检索状态：未检索/);
  // Every drawn line stays inside its page canvas (no clipped overflow).
  for (const entry of drawn) {
    assert.ok(entry.y > 0 && entry.y < 1684, `drawn outside the page: ${entry.page} ${entry.y} ${entry.text}`);
  }
  assert.ok(pages.length >= 1);

  // A long checklist must paginate without losing the figure line or its font.
  const longDrawn = JSON.parse(await evaluate("fixture.renderLongChecklist().then((entries) => JSON.stringify(entries))"));
  const longPages = [...new Set(longDrawn.map((entry) => entry.page))];
  assert.ok(longPages.length >= 2, `a long checklist paginates: ${JSON.stringify(longPages)}`);
  const longFigure = longDrawn.filter((entry) => entry.text.includes("附图：0 张（本次材料包不含附图）"));
  assert.ok(longFigure.length >= 1, "the figure line survives pagination");
  for (const entry of longFigure) {
    assert.ok(entry.y > 0 && entry.y < 1684, `figure line drawn outside a page: ${JSON.stringify(entry)}`);
  }
  const itemLine = longFigure.find((entry) => /19px/.test(entry.font));
  assert.ok(itemLine, `the checklist item keeps its own font across pages: ${JSON.stringify(longFigure.map((entry) => entry.font))}`);
  assert.ok(itemLine.page >= 2, `the checklist item landed on a later page: ${JSON.stringify(itemLine)}`);
  const pageOneMeta = longDrawn.some((entry) => entry.page === 1 && entry.text.includes("附图：0 张（本次材料包不含附图）"));
  assert.equal(pageOneMeta, true, "the meta header carries the figure state on page 1");

  // The JSON sidecar downloaded by the user carries the same note.
  await evaluate(`(() => {
    const row = [...document.querySelectorAll('[data-testid^="done-file-"]')]
      .find((item) => item.textContent.includes('导出清单.json'));
    if (!row) throw new Error('missing manifest row');
    const button = [...row.querySelectorAll('button')].find((item) => item.textContent.trim() === '下载');
    if (!button) throw new Error('missing manifest download');
    button.click(); return true;
  })()`);
  let manifestFile = null;
  for (let i = 0; i < 100 && manifestFile === null; i++) {
    await new Promise((done) => setTimeout(done, 100));
    manifestFile = readdirSync(downloadDir).find((name) => name.endsWith(".json")) ?? null;
  }
  assert.ok(manifestFile, "the manifest sidecar was downloaded");
  const manifest = JSON.parse(readFileSync(join(downloadDir, manifestFile), "utf8"));
  assert.deepEqual(manifest.figures, { count: 0, included: false, note: "附图：0 张（本次材料包不含附图）" });

  // The self approval panel (inside the collapsed details) shows the same state after expanding.
  await evaluate(`(() => { const d = document.querySelector('[data-testid="delivery-approval-details"]'); if (d) d.open = true; return true; })()`);
  await waitFor(`!!document.querySelector('[data-testid="approval-panel"]')`, "approval panel in self details");
  await waitFor(`!!document.querySelector('[data-testid="approval-figures-none"]')`, "approval no-figure tip");
  assert.match(await text('[data-testid="approval-figure-set"]'), /附图：0 张/);
  assert.match(await text('[data-testid="approval-figures-none"]'), /未添加附图：本次材料包不含附图，提交前请按需要补充/);
  assert.equal(await evaluate("document.querySelector('[data-testid=approval-add-figures]')?.getAttribute('href')"),
    `/v6/matters/${matterId}/targets/${targetId}/sources`);
});
