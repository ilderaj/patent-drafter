// V6-21 browser evidence for the temporary matters/inbox route mount.
// Usage: node browser-drive.mjs <outDir> <baseUrl>
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const [outArg, base] = process.argv.slice(2);
if (!outArg || !base) throw new Error("usage: node browser-drive.mjs <outDir> <baseUrl>");
const out = resolve(outArg);
mkdirSync(out, { recursive: true });
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const port = 9349;
const profile = mkdtempSync(join(tmpdir(), "v6-21-profile-"));
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "--window-size=1280,1200", "about:blank"], { stdio: "ignore" });
const log = { base, steps: [], network: [], nonLocalRequests: [], consoleErrors: [], screenshots: [], profileRemoved: false };
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const assert = (condition, message, detail) => { if (!condition) throw new Error(`${message}: ${JSON.stringify(detail)}`); };

async function main() {
  let page;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      page = targets.find((target) => target.type === "page");
      if (page) break;
    } catch {}
    await wait(200);
  }
  if (!page) throw new Error("Chrome did not expose a page target");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve) => ws.addEventListener("open", resolve, { once: true }));
  let seq = 0;
  const pending = new Map();
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id); return; }
    if (message.method === "Runtime.exceptionThrown") log.consoleErrors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
    if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") log.consoleErrors.push(message.params.args.map((arg) => arg.value ?? arg.description).join(" "));
    if (message.method === "Network.requestWillBeSent") {
      const url = message.params.request.url;
      log.network.push(url);
      if (!/^(https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/|data:|blob:)/.test(url)) log.nonLocalRequests.push(url);
    }
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, (message) => message.error ? reject(new Error(JSON.stringify(message.error))) : resolve(message.result));
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  };
  const q = (id) => `document.querySelector('[data-testid="${id}"]')`;
  const waitFor = async (expression, message) => {
    for (let attempt = 0; attempt < 200; attempt += 1) { if (await evaluate(`!!(${expression})`)) return; await wait(100); }
    throw new Error(`timeout waiting for ${message}`);
  };
  const shot = async (name) => {
    const { data } = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
    writeFileSync(join(out, `${name}.png`), Buffer.from(data, "base64"));
    log.screenshots.push(`${name}.png`);
  };
  const step = async (name, run) => {
    try { const detail = await run(); log.steps.push({ name, ok: true, detail }); await shot(name); }
    catch (error) { log.steps.push({ name, ok: false, error: String(error) }); await shot(name).catch(() => {}); }
  };
  const click = async (id) => evaluate(`(() => { const node = ${q(id)}; if (!node || node.disabled) return false; node.click(); return true; })()`);
  const go = async (path) => { await send("Page.navigate", { url: `${base}${path}` }); await waitFor(`document.querySelector('[data-testid="runtime-label"]')`, "V6 shell"); };
  await send("Page.enable"); await send("Runtime.enable"); await send("Network.enable"); await send("Log.enable");

  await step("01-matters-empty", async () => {
    await go("/v6/matters");
    await waitFor(`${q("matters-empty")}`, "empty matters list");
    const result = await evaluate(`({ empty: !!${q("matters-empty")}, create: [...document.querySelectorAll("button")].some((button) => button.textContent.includes("创建案件")), upload: [...document.querySelectorAll("a,button")].some((button) => button.textContent.includes("从上传材料开始")), sample: /示例案件|示例待办/.test(document.body.innerText) })`);
    assert(result.empty && result.create && result.upload && !result.sample, "empty state has real actions only", result);
    return result;
  });
  let matterId = null;
  await step("02-create-case-upload", async () => {
    const created = await evaluate(`(() => { const button = [...document.querySelectorAll("button")].find((node) => node.textContent.includes("创建案件")); if (!button) return false; button.click(); return true; })()`);
    assert(created, "create button clicked", created);
    await waitFor(`location.pathname.includes("/upload")`, "upload route after create");
    matterId = await evaluate(`location.pathname.split("/").at(-2)`);
    const state = await evaluate(`({ path: location.pathname, title: document.querySelector("main")?.innerText.includes("上传材料") ?? false, matter: document.body.innerText.includes("未命名案件") })`);
    assert(state.title && state.matter, "new case enters the upload flow", state);
    return { matterId, ...state };
  });
  await step("03-created-case-list", async () => {
    await go("/v6/matters");
    await waitFor(`document.querySelectorAll('[data-testid^="matter-row-"]').length > 0`, "created matter in list");
    const state = await evaluate(`({ rows: document.querySelectorAll('[data-testid^="matter-row-"]').length, title: document.querySelector('[data-testid^="matter-row-"] a')?.textContent ?? null, id: document.querySelector('[data-testid^="matter-row-"]')?.dataset.testid ?? null })`);
    assert(state.title === "未命名案件" && state.id?.endsWith(matterId), "created case persists into the list", state);
    return state;
  });
  await step("04-archive-unarchive", async () => {
    const row = await evaluate(`document.querySelector('[data-testid^="matter-row-"]')?.dataset.testid ?? null`);
    assert(row !== null, "created matter row exists", row);
    const archiveButton = await evaluate(`(() => { const row = document.querySelector('[data-testid^="matter-row-"]'); const button = [...row.querySelectorAll("button")].find((node) => node.textContent.includes("归档")); if (!button) return false; button.click(); return true; })()`);
    assert(archiveButton, "archive action is available", archiveButton);
    await waitFor(`${q("matters-filter-empty")}`, "active filter hides archived case");
    await evaluate(`(() => { const select = document.querySelector("select"); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(select, "archived"); select.dispatchEvent(new Event("change", { bubbles: true })); })()`);
    await waitFor(`document.querySelector('[data-testid^="matter-row-"]')`, "archived row appears");
    const unarchive = await evaluate(`(() => { const row = document.querySelector('[data-testid^="matter-row-"]'); const button = [...row.querySelectorAll("button")].find((node) => node.textContent.includes("取消归档")); if (!button) return false; button.click(); return true; })()`);
    assert(unarchive, "unarchive action is available", unarchive);
    await waitFor(`${q("matters-filter-empty")}`, "unarchived matter leaves archived filter");
    await evaluate(`(() => { const select = document.querySelector("select"); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(select, "active"); select.dispatchEvent(new Event("change", { bubbles: true })); })()`);
    await waitFor(`document.querySelector('[data-testid^="matter-row-"] button')?.textContent.trim() === "重命名"`, "active matter row becomes editable");
    const state = await evaluate(`(() => { const row = document.querySelector('[data-testid^="matter-row-"]'); return { title: row?.querySelector("a")?.textContent ?? null, buttons: [...(row?.querySelectorAll("button") ?? [])].map((button) => button.textContent.trim()) }; })()`);
    assert(state.buttons.some((text) => text === "重命名") && state.buttons.some((text) => text === "归档"), "unarchived matter exposes edit and archive actions", state);
    return state;
  });
  await step("05-inbox-empty", async () => {
    await go("/v6/inbox");
    await waitFor(`${q("inbox-empty")}`, "empty inbox");
    const result = await evaluate(`({ text: ${q("inbox-empty")}?.innerText ?? null, sample: /示例|demo|sample/i.test(document.body.innerText), requests: performance.getEntriesByType("resource").map((entry) => entry.name) })`);
    assert(result.text?.includes("暂无待办") && !result.sample, "inbox contains no demo tasks", result);
    return result;
  });
  await step("06-no-external-network", async () => {
    await wait(300);
    assert(log.nonLocalRequests.length === 0, "only local requests observed", log.nonLocalRequests);
    return { requests: log.network.length, nonLocal: log.nonLocalRequests };
  });
  ws.close(); chrome.kill(); await wait(400); rmSync(profile, { recursive: true, force: true }); log.profileRemoved = true;
  writeFileSync(join(out, "browser-log.json"), `${JSON.stringify(log, null, 2)}\n`);
  const ok = log.steps.length === 6 && log.steps.every((step) => step.ok) && log.consoleErrors.length === 0 && log.nonLocalRequests.length === 0;
  console.log(JSON.stringify({ ok, steps: log.steps, consoleErrors: log.consoleErrors, nonLocalRequests: log.nonLocalRequests, requests: log.network.length }, null, 2));
  process.exitCode = ok ? 0 : 1;
}

await main();
