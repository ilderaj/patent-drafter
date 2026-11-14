// Browser tests of the workbench 「生成任务」 strip: the expanded state is React
// state, so re-renders, refreshes and focus events never collapse it, and a
// consent sheet or a typed access code survives them. Runtime and generation
// panel are isolated fakes; no provider is contacted.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { chromeSelfCheck, createCdpClient, launchChromeWithPageTarget, withTimeout } from "../../helpers/chrome.mjs";
import * as esbuild from "esbuild";

let browser, server, client;
const errors = [];
const SUITE_SETUP_TIMEOUT_MS = 90_000;
const TEST_TIMEOUT_MS = 90_000;
const it = (name, fn) => test(name, { timeout: TEST_TIMEOUT_MS }, fn);
const evaluate = (expression, options) => client.evaluate(expression, options);
const waitFor = (expression, label = expression, options = { timeoutMs: 15_000 }) => client.waitFor(expression, label, options);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const strip = "document.querySelector('[data-testid=workbench-generation-panel]')";
const isOpen = () => evaluate(`${strip}.open`);
const click = (selector) => evaluate(`document.querySelector(${JSON.stringify(selector)}).click(); true`);
const exists = (selector) => evaluate(`!!document.querySelector(${JSON.stringify(selector)})`);
const rerender = async (times = 1) => {
  for (let i = 0; i < times; i++) { await evaluate("fixture.rerender(); true"); await pause(30); }
};
async function mount(mode, required, target = "synthetic-target") {
  await evaluate(`fixture.reset(${JSON.stringify(mode)}, ${required}, ${JSON.stringify(target)}); true`);
  await waitFor(`!!document.querySelector('[data-testid="workbench-runtime-${mode === "real" ? (required ? "consent-required" : "real") : "test"}"]')`);
  await pause(80);
}

before(async () => {
  const root = resolve(import.meta.dirname, "../../../..");
  const build = await esbuild.build({
    stdin: { resolveDir: root, sourcefile: "strip-browser.tsx", loader: "tsx", contents: `
      import { useState } from 'react';
      import { createRoot } from 'react-dom/client';
      import { MemoryRouter } from 'react-router-dom';
      import { WorkbenchGenerationStrip } from './apps/web/src/v6/features/workbench/GenerationRuntime.tsx';
      const root = createRoot(document.getElementById('root'));
      const answers = { total:5, answered:5, sentCount:2, complete:true, missing:[], items:[
        {questionNo:1,key:'problem',label:'问题',answered:true,sent:true,characters:12,chunkId:'a1'},
        {questionNo:2,key:'difference',label:'区别',answered:true,sent:true,characters:24,chunkId:'a2'},
        {questionNo:3,key:'inventorIds',label:'发明人',answered:true,sent:false,characters:null,chunkId:null},
        {questionNo:4,key:'disclosure',label:'公开历史',answered:true,sent:false,characters:null,chunkId:null},
        {questionNo:5,key:'maturity',label:'成熟度',answered:true,sent:false,characters:null,chunkId:null}]};
      const makeRuntime = (mode, required) => ({ mode, engineOptions:{execution: mode === 'real' ? 'provider' : 'test'},
        processor:{name:'合成处理方',region:'合成区域',retention:'合成保留',trainingPolicy:'no_training',termsVersion:'v1',model:'m'},
        unavailableReason: mode === 'test' ? '真实起草需要访问码。' : null,
        consent:{required, manifest: mode === 'test' ? null : {files:[],factCount:2,chunkIds:['a1','a2'],draftRevisionIds:[],figureRevisionIds:[],answers},
          grant: async () => makeRuntime('real', false)} });
      const repository = {};
      let tick = 0, key = 0, target = 'synthetic-target', token = 0;
      const render = () => root.render(<MemoryRouter><WorkbenchGenerationStrip key={key} repository={repository} actor={{userId:'u',tenantId:'t'}}
        matterId='m' targetId={target} onAdopted={() => { tick++; }} revealToken={token} /></MemoryRouter>);
      window.fixture = {
        reset(mode, required, nextTarget) { key++; token = 0; target = nextTarget; this.runtime = makeRuntime(mode, required); this.job = null; this.listeners = []; render(); },
        rerender() { tick++; render(); },
        retarget(nextTarget) { target = nextTarget; render(); },
        reveal() { token++; render(); },
        setJob(state) { this.job = state; this.listeners.forEach((fn) => fn()); },
        authenticated() { this.runtime = makeRuntime('real', true); },
      };
    ` },
    bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' }, logLevel: "silent",
    plugins: [{ name: "isolated-seams", setup(b) {
      b.onResolve({ filter: /\/generation\/(runtime\.ts|Generation\.tsx)$/ }, (args) => ({ path: args.path, namespace: "fixture" }));
      b.onLoad({ filter: /runtime\.ts$/, namespace: "fixture" }, () => ({ loader: "js", contents: `
        export async function resolveGenerationRuntime() { return window.fixture.runtime; }
        export async function createGenerationSession() { window.fixture.authenticated(); }` }));
      b.onLoad({ filter: /Generation\.tsx$/, namespace: "fixture" }, () => ({ loader: "tsx", resolveDir: root, contents: `
        import { useEffect, useState } from 'react';
        export function GenerationPanel() {
          const [, force] = useState(0);
          useEffect(() => { window.fixture.listeners.push(() => force((v) => v + 1)); }, []);
          const job = window.fixture.job;
          return <div data-testid="generation" data-state="ready" {...(job ? { 'data-job-state': job } : {})}>panel</div>;
        }` }));
    } }],
  });
  server = createServer((request, response) => {
    response.setHeader("content-type", request.url === "/fixture.js" ? "application/javascript" : "text/html; charset=utf-8");
    response.end(request.url === "/fixture.js" ? build.outputFiles[0].contents : '<div id="root"></div><script src="/fixture.js"></script>');
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  await withTimeout((async () => {
    await chromeSelfCheck({ profilePrefix: "v6-strip-browser-selfcheck-", timeoutMs: 60_000 });
    browser = await launchChromeWithPageTarget({ profilePrefix: "v6-strip-browser-" });
    client = createCdpClient(browser.socket, { requestTimeoutMs: 10_000, onEvent: (message) => {
      if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails.text);
    } });
    await client.send("Runtime.enable");
    await client.send("Page.navigate", { url: `http://127.0.0.1:${server.address().port}` });
    await client.waitFor("!!window.fixture", "fixture loaded", { timeoutMs: 20_000 });
  })(), SUITE_SETUP_TIMEOUT_MS, "browser suite setup (self-check, launch, first page)");
});
after(async () => {
  await withTimeout(browser?.close() ?? Promise.resolve(), 20_000, "browser close").catch((error) => console.error(`cleanup: ${error.message}`));
  if (server) await new Promise((done) => server.close(done));
});

it("a user-expanded strip stays expanded across re-renders, refreshes and window focus", async () => {
  await mount("test", false);
  assert.equal(await isOpen(), false, "collapsed by default when nothing needs attention");
  await click("[data-testid=workbench-generation-panel] > summary");
  await waitFor(`${strip}.open === true`);
  await pause(50);
  await rerender(3);
  await evaluate("window.dispatchEvent(new Event('focus')); true");
  await click("[data-testid=workbench-runtime-refresh]");
  await pause(150);
  assert.equal(await isOpen(), true);
});

it("a user-collapsed strip is not reopened by re-renders", async () => {
  await mount("test", false);
  await click("[data-testid=workbench-generation-panel] > summary");
  await waitFor(`${strip}.open === true`);
  await click("[data-testid=workbench-generation-panel] > summary");
  await waitFor(`${strip}.open === false`);
  await rerender(3);
  await pause(100);
  assert.equal(await isOpen(), false);
});

it("re-consent opens the strip and the consent sheet survives re-renders without remounting", async () => {
  await mount("real", true);
  assert.equal(await isOpen(), true, "consent required opens the strip");
  assert.equal(await exists("[role=dialog]"), true);
  await evaluate("window.__sheet = document.querySelector('[role=dialog]'); true");
  await rerender(4);
  await evaluate("window.dispatchEvent(new Event('focus')); true");
  await pause(150);
  assert.equal(await isOpen(), true);
  assert.equal(await evaluate("document.querySelector('[role=dialog]') === window.__sheet"), true, "sheet node is the same: not unmounted and remounted");
});

it("an access code being typed survives a refresh while the sheet is open", async () => {
  await mount("test", false);
  await click("[data-testid=workbench-runtime-consent-open]");
  await waitFor("!!document.querySelector('[data-testid=workbench-consent-access-code]')");
  await waitFor(`${strip}.open === true`);
  await evaluate(`(() => { const input = document.querySelector('[data-testid="workbench-consent-access-code"]');
    window.__input = input;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'synthetic-typing');
    input.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  await rerender(3);
  await evaluate("window.dispatchEvent(new Event('focus')); true");
  await pause(150);
  assert.equal(await isOpen(), true);
  assert.equal(await evaluate("document.querySelector('[data-testid=workbench-consent-access-code]') === window.__input"), true);
  assert.equal(await evaluate("document.querySelector('[data-testid=workbench-consent-access-code]').value"), "synthetic-typing");
});

it("a running or failed job opens the strip by default", async () => {
  await mount("test", false);
  assert.equal(await isOpen(), false);
  await evaluate("fixture.setJob('running'); true");
  await waitFor(`${strip}.open === true`);
  await click("[data-testid=workbench-generation-panel] > summary");
  await waitFor(`${strip}.open === false`);
  await evaluate("fixture.setJob('failed'); true");
  await waitFor(`${strip}.open === true`);
});

it("the editor's reveal request opens the strip; switching target resets it", async () => {
  await mount("test", false);
  await evaluate("fixture.reveal(); true");
  await waitFor(`${strip}.open === true`);
  await evaluate("fixture.retarget('synthetic-other-target'); true");
  await waitFor(`${strip}.open === false`);
  assert.deepEqual(errors, []);
});
