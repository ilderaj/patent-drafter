// Drives headless Chrome over CDP through the V6-08 slice. Usage: node drive.mjs <outDir> <baseUrl>
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [outDir, base] = process.argv.slice(2);
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const profile = mkdtempSync(join(tmpdir(), "v6-profile-"));
const port = 9333;
const chrome = spawn(CHROME, [
  "--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
  "--no-first-run", "--no-default-browser-check", "--window-size=1280,860", "about:blank",
], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let targets;
for (let i = 0; i < 50; i++) {
  try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (targets.some((t) => t.type === "page")) break; } catch {}
  await sleep(200);
}
const page = targets.find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let id = 0;
const pending = new Map();
ws.addEventListener("message", (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
});
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const n = ++id; pending.set(n, (m) => (m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result)));
  ws.send(JSON.stringify({ id: n, method, params }));
});
const evaluate = async (expression) => (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result.value;
const waitFor = async (expression, label) => {
  for (let i = 0; i < 60; i++) { if (await evaluate(expression)) return; await sleep(150); }
  throw new Error(`timeout waiting for ${label}`);
};
const go = async (path) => { await send("Page.navigate", { url: base + path }); await sleep(300); };
const shot = async (name) => {
  const { data } = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(outDir, `${name}.png`), Buffer.from(data, "base64"));
};
const state = () => evaluate(`({ path: location.pathname, runtime: document.querySelector('[data-testid=runtime-label]')?.textContent ?? null, h1: document.querySelector('h1')?.textContent ?? null, notice: document.querySelector('.notice')?.textContent ?? null })`);

const log = [];
const step = async (name, fn) => {
  try { await fn(); const s = await state(); log.push({ step: name, ok: true, ...s }); await shot(name); }
  catch (error) { log.push({ step: name, ok: false, error: String(error), ...(await state().catch(() => ({}))) }); await shot(name).catch(() => {}); }
};

await send("Page.enable"); await send("Runtime.enable");
const errors = [];
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.text); if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") errors.push(m.params.args.map((a) => a.value ?? a.description).join(" ")); });

let matterUrl = null;
await step("01-start", async () => { await go("/patent/v6"); await waitFor(`!!document.querySelector('[data-testid=entry-self]')`, "entries"); });
await step("02-matters-empty", async () => { await go("/patent/v6/matters"); await waitFor(`!!document.querySelector('[data-testid=matters-empty]')`, "empty state"); });
await step("03-self-service-create", async () => {
  await go("/patent/v6"); await waitFor(`!!document.querySelector('[data-testid=entry-self] button')`, "create button");
  await evaluate(`document.querySelector('[data-testid=entry-self] button').click()`);
  await waitFor(`location.pathname.endsWith('/upload') && !!document.querySelector('[data-testid=upload]')`, "upload page");
});
await step("04-upload-after-refresh", async () => {
  await send("Page.reload"); await sleep(300);
  await waitFor(`!!document.querySelector('[data-testid=upload]')`, "upload after reload");
  matterUrl = (await evaluate("location.pathname")).replace(/\/upload$/, "");
});
await step("05-matter-overview", async () => { await go(matterUrl.replace("/patent", "") === matterUrl ? matterUrl : matterUrl); await waitFor(`!!document.querySelector('[data-testid=matter] .v6-overview')`, "overview"); });
await step("06-tab-check-unavailable", async () => {
  await evaluate(`[...document.querySelectorAll('.v6-tabs a')].find(a => a.textContent === '检查').click()`);
  await waitFor(`location.pathname.endsWith('/check') && !!document.querySelector('[data-testid=tab-unavailable]')`, "check tab");
});
await step("07-tab-direct-link-refresh", async () => { await send("Page.reload"); await sleep(300); await waitFor(`location.pathname.endsWith('/check') && !!document.querySelector('[data-testid=tab-unavailable]')`, "check tab after reload"); });
await step("08-matters-list", async () => { await go("/patent/v6/matters"); await waitFor(`document.querySelectorAll('[data-testid=matters-list] li').length === 1`, "one matter"); });
await step("09-missing-matter", async () => { await go("/patent/v6/matters/dddddddd-dddd-4ddd-8ddd-dddddddddddd"); await waitFor(`!!document.querySelector('[data-testid=unavailable]')`, "unavailable"); });
await step("10-malformed-link", async () => { await go("/patent/v6/matters/not-a-uuid/draft"); await waitFor(`!!document.querySelector('[data-testid=unavailable]')`, "unavailable"); });
await step("11-services-section", async () => { await go("/patent/v6/services"); await waitFor(`!!document.querySelector('[data-testid=section]')`, "section"); });
await step("12-legacy-still-works", async () => { await go("/patent/projects"); await waitFor(`!!document.querySelector('.app-shell') && !document.querySelector('.v6-shell')`, "legacy shell"); });

const matterCount = await (async () => { await go("/patent/v6/matters"); await sleep(800); return evaluate(`document.querySelectorAll('[data-testid=matters-list] li').length`); })();
writeFileSync(join(outDir, "browser-log.json"), JSON.stringify({ base, matterCountAfterRetries: matterCount, consoleErrors: errors, steps: log }, null, 2) + "\n");
ws.close(); chrome.kill();
console.log(JSON.stringify({ ok: log.every((s) => s.ok), failed: log.filter((s) => !s.ok), matterCount, errors }, null, 2));
process.exit(0);
