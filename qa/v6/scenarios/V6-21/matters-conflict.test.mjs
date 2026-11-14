// Browser test of the rename conflict branch: another window saves first, the
// stale save must say so specifically AND refresh the list so the retry works.
// Real MattersPage + real repository on the in-memory backend; no network.
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
const text = (selector) => evaluate(`document.querySelector(${JSON.stringify(selector)})?.textContent ?? null`);
const exists = (selector) => evaluate(`!!document.querySelector(${JSON.stringify(selector)})`);
const click = (selector) => evaluate(`document.querySelector(${JSON.stringify(selector)}).click(); true`);
const rowButton = (id, label) => evaluate(`(() => {
  const row = document.querySelector('[data-testid="matter-row-${id}"]');
  const button = [...row.querySelectorAll('button')].find((item) => item.textContent.trim() === ${JSON.stringify(label)});
  if (!button) throw new Error('missing ${label}');
  button.click(); return true; })()`);

before(async () => {
  const root = resolve(import.meta.dirname, "../../../..");
  const build = await esbuild.build({
    stdin: { resolveDir: root, sourcefile: "matters-conflict.tsx", loader: "tsx", contents: `
      import { createRoot } from 'react-dom/client';
      import { MemoryRouter } from 'react-router-dom';
      import { MattersPage } from './apps/web/src/v6/features/matters/Matters.tsx';
      import { ACTOR, MemoryBackend, actionInput, createInput, matterId } from './qa/v6/scenarios/V6-21/harness.mjs';
      import { createMatter, renameMatter } from './apps/web/src/v6/features/matters/matters.ts';
      import { openLocalRepository } from './apps/web/src/v6/lib/repository.ts';
      const root = createRoot(document.getElementById('root'));
      window.fixture = {
        async seed() {
          const backend = new MemoryBackend();
          const repository = openLocalRepository(backend);
          const id = matterId(41);
          await createMatter(repository, ACTOR, createInput(id, '原题', 41));
          this.repository = repository; this.id = id;
          root.render(<MemoryRouter initialEntries={['/v6/matters']}><MattersPage repository={repository} actor={ACTOR} /></MemoryRouter>);
          return id;
        },
        async otherWindowRename() {
          // Stand-in for a second window saving first: version 1 -> 2.
          const result = await renameMatter(this.repository, ACTOR, { ...actionInput(this.id, 1, 99), title: '外部改名' });
          return result.ok;
        },
        async stored() { return (await this.repository.loadMatter(ACTOR, this.id)).data.data.matter; },
      };
    ` },
    bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' }, logLevel: "silent",
  });
  server = createServer((request, response) => {
    response.setHeader("content-type", request.url === "/fixture.js" ? "application/javascript" : "text/html; charset=utf-8");
    response.end(request.url === "/fixture.js" ? build.outputFiles[0].contents : '<div id="root"></div><script src="/fixture.js"></script>');
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  await withTimeout((async () => {
    await chromeSelfCheck({ profilePrefix: "v6-matters-conflict-selfcheck-", timeoutMs: 60_000 });
    browser = await launchChromeWithPageTarget({ profilePrefix: "v6-matters-conflict-" });
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

it("a conflicting rename names the conflict, refreshes the list and the retry then succeeds", async () => {
  const id = await evaluate("fixture.seed()");
  await waitFor(`!!document.querySelector('[data-testid="matter-row-${id}"]')`, "matter row");
  assert.match(await text(`[data-testid="matter-row-${id}"]`), /原题/);

  await rowButton(id, "重命名");
  await waitFor(`!!document.querySelector('[data-testid="matter-row-${id}"] input[aria-label="案件标题"]')`, "title editor");
  await evaluate(`(() => { const input = document.querySelector('[data-testid="matter-row-${id}"] input[aria-label="案件标题"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '我的标题');
    input.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);

  // Another window saves first: the page still holds version 1.
  assert.equal(await evaluate("fixture.otherWindowRename()"), true);
  assert.equal((await evaluate("fixture.stored()")).title, "外部改名");

  await rowButton(id, "保存");
  await waitFor("!!document.querySelector('[data-testid=matters-error]')", "conflict error");
  const alertText = await text("[data-testid=matters-error]");
  assert.match(alertText, /标题已在其他窗口修改，请刷新后重试/);
  assert.doesNotMatch(alertText, /标题尚未保存。请重试。/);
  assert.equal((await evaluate("fixture.stored()")).title, "外部改名", "the conflicting save wrote nothing");

  // The branch refreshed the rows: cancelling shows the other window's title.
  await rowButton(id, "取消");
  await waitFor(`document.querySelector('[data-testid="matter-row-${id}"]')?.textContent.includes('外部改名')`, "refreshed row");
  assert.equal(await exists(`[data-testid="matter-row-${id}"] input[aria-label="案件标题"]`), false);

  // With the refreshed version the same rename now succeeds.
  await rowButton(id, "重命名");
  await waitFor(`!!document.querySelector('[data-testid="matter-row-${id}"] input[aria-label="案件标题"]')`, "title editor again");
  await evaluate(`(() => { const input = document.querySelector('[data-testid="matter-row-${id}"] input[aria-label="案件标题"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '我的标题');
    input.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  await rowButton(id, "保存");
  await waitFor(`document.querySelector('[data-testid="matter-row-${id}"]')?.textContent.includes('我的标题')`, "renamed row");
  assert.equal(await evaluate("fixture.stored().then((matter) => matter.title)"), "我的标题");
  assert.match(await text(`[data-testid="matter-row-${id}"]`), /我的标题/);
  assert.deepEqual(errors, []);
});
