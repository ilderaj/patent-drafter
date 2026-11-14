import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const OUT = resolve(process.argv[2] ?? dirname(fileURLToPath(import.meta.url)));
const BASE = process.argv[3] ?? "http://127.0.0.1:4186/patent";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const CACHE = join(tmpdir(), "v6-22-vite-cache");
const PROFILE = mkdtempSync(join(tmpdir(), "v6-22-chrome-"));
const PORT = 9376;
const log = { steps: [], consoleErrors: [], requests: [], screenshots: [], externalRequests: 0 };
let vite;
let chrome;
let ws;
const pause = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
const assert = (condition, message, detail = null) => { if (!condition) throw new Error(`${message}${detail ? `: ${JSON.stringify(detail)}` : ""}`); };
const send = (method, params = {}) => new Promise((resolvePromise, reject) => {
  const id = ++send.id;
  send.pending.set(id, (message) => message.error ? reject(new Error(JSON.stringify(message.error))) : resolvePromise(message.result));
  ws.send(JSON.stringify({ id, method, params }));
});
send.id = 0;
send.pending = new Map();

try {
  mkdirSync(OUT, { recursive: true });
  vite = spawn(process.execPath, [join(ROOT, "node_modules/vite/bin/vite.js"), "--config", join(ROOT, "apps/web/vite.config.ts"), "--host", "127.0.0.1", "--port", "4186", "--strictPort"], {
    cwd: ROOT,
    env: { ...process.env, VITE_CACHE_DIR: CACHE },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let viteOutput = "";
  vite.stdout.on("data", (chunk) => { viteOutput += String(chunk); });
  vite.stderr.on("data", (chunk) => { viteOutput += String(chunk); });
  let ready = false;
  for (let i = 0; i < 120; i += 1) {
    try { if ((await fetch(`${BASE}/qa/v6/evidence/V6-22/browser-mount.html`)).ok) { ready = true; break; } } catch {}
    await pause(100);
  }
  assert(ready, "Vite preview did not serve the evidence mount", viteOutput);
  chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, "--no-first-run", "--no-default-browser-check", "--window-size=1440,1100", "about:blank"], { stdio: "ignore" });
  let targets = [];
  for (let i = 0; i < 100; i += 1) {
    try { targets = await (await fetch(`http://localhost:${PORT}/json`)).json(); if (targets.some((item) => item.type === "page")) break; } catch {}
    await pause(100);
  }
  const page = targets.find((item) => item.type === "page");
  assert(page, "Chrome did not expose a page");
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolvePromise, reject) => {
    ws.addEventListener("open", resolvePromise, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id && send.pending.has(message.id)) { send.pending.get(message.id)(message); send.pending.delete(message.id); return; }
    if (message.method === "Runtime.exceptionThrown") log.consoleErrors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
    if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") log.consoleErrors.push(message.params.args.map((item) => item.value ?? item.description).join(" "));
    if (message.method === "Network.requestWillBeSent") log.requests.push(message.params.request.url);
    if (message.method === "Network.loadingFailed") log.consoleErrors.push(`network-failed ${message.params.errorText}`);
  });
  await send("Runtime.enable");
  await send("Network.enable");
  await send("Page.enable");
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  };
  const waitFor = async (expression, name) => {
    for (let i = 0; i < 250; i += 1) { if (await evaluate(`Boolean(${expression})`)) return; await pause(100); }
    throw new Error(`Timed out waiting for ${name}`);
  };
  const screenshot = async (name) => {
    const result = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
    writeFileSync(join(OUT, `${name}.png`), Buffer.from(result.data, "base64"));
    log.screenshots.push(`qa/v6/evidence/V6-22/${name}.png`);
  };

  await send("Page.navigate", { url: `${BASE}/qa/v6/evidence/V6-22/browser-mount.html` });
  await waitFor("document.querySelector('[data-testid=professional-workbench][data-state=ready]')", "workbench overview");
  const entry = await evaluate("window.__v622");
  assert(entry.created === true && entry.initialCount === 1, "self-service matter is created once", entry);
  assert(await evaluate("document.querySelector('[data-testid=workbench-overview]') !== null"), "overview rendered");
  assert(await evaluate("document.querySelector('[data-action=\"matter.created\"]') !== null"), "activity row for matter.created rendered");
  assert(await evaluate("document.querySelector('[data-testid=workbench-activity]')?.dataset.state === 'ready'"), "activity feed ready");
  await screenshot("01-workbench-overview");
  log.steps.push({ name: "self-service-same-matter-overview", pass: true, matterId: entry.matterId });

  const tabs = [
    ["sources", "document.querySelector('[data-testid=workbench-materials]') && document.querySelector('[data-testid=upload]')"],
    ["facts", "document.querySelector('[data-testid=intake]')"],
    ["draft", "document.querySelector('[data-testid=workbench-target-required]')"],
    ["check", "document.querySelector('[data-testid=workbench-checks-empty]') || document.querySelector('[data-testid=workbench-checks]')"],
    ["review", "document.querySelector('[data-testid=workbench-target-required]')"],
    ["deliver", "document.querySelector('[data-testid=workbench-delivery]')"],
    ["filing", "document.querySelector('[data-testid=workbench-application]')"],
  ];
  for (const [index, [tab, selector]] of tabs.entries()) {
    await evaluate(`(() => { const link = [...document.querySelectorAll('[aria-label="专业工作台标签"] a')].find((item) => item.getAttribute('href')?.endsWith('/${tab}')); if (!link) return false; link.click(); return true; })()`);
    await waitFor(selector, `${tab} tab`);
    assert((await evaluate("document.querySelector('[data-testid=professional-workbench]').dataset.matterId")) === entry.matterId, `${tab} retains matter id`);
    await screenshot(`${String(index + 2).padStart(2, "0")}-tab-${tab}`);
    log.steps.push({ name: `tab-${tab}-same-matter`, pass: true });
  }
  await evaluate("window.__v622ShowMissing()");
  await waitFor("document.querySelector('[data-testid=professional-workbench-error]')", "workbench error state");
  assert(await evaluate("document.querySelector('[data-testid=professional-workbench-error]')?.textContent.includes('案件不可用')"), "missing matter shows error, not demo data");
  await screenshot("09-workbench-error");
  log.steps.push({ name: "missing-matter-error-state", pass: true });
  log.externalRequests = log.requests.filter((url) => !url.startsWith("http://127.0.0.1:4186") && !url.startsWith("data:")).length;
  assert(log.externalRequests === 0, "no external requests", log.requests);
  assert(log.consoleErrors.length === 0, "no browser console errors", log.consoleErrors);
  log.result = "passed";
} catch (error) {
  log.result = "failed";
  log.error = error instanceof Error ? error.message : String(error);
  try {
    if (ws) {
      const body = await send("Runtime.evaluate", { expression: "({ text: document.body.innerText, html: document.body.innerHTML.slice(0, 2000), mountError: window.__workbenchMountError ?? null })", returnByValue: true });
      log.page = body.result.value;
    }
  } catch {}
  process.exitCode = 1;
} finally {
  writeFileSync(join(OUT, "browser-log.json"), JSON.stringify(log, null, 2) + "\n");
  writeFileSync(join(OUT, "browser-run.txt"), `${log.result}: ${log.steps.length} steps, ${log.consoleErrors.length} console errors, ${log.externalRequests} external requests${log.error ? `\n${log.error}` : ""}\n`);
  ws?.close();
  chrome?.kill("SIGTERM");
  vite?.kill("SIGTERM");
  await pause(300);
  try { rmSync(PROFILE, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch {}
}
