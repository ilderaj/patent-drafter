// Drives the standalone V6-25 Done page in headless Chrome.
// Usage: node browser-drive.mjs [outDir] [baseUrl] [port]
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(OUT, "../../../..");
const VITE_PATH = join(ROOT, "node_modules/vite/bin/vite.js");
const [outDirArg, baseArg, portArg] = process.argv.slice(2);
const outDir = resolve(outDirArg ?? OUT);
const port = Number(portArg ?? 9375);
let vite;
let base = baseArg;

const log = { ok: false, steps: [], consoleErrors: [], network: [], screenshots: [] };
const pause = (ms) => new Promise((done) => setTimeout(done, ms));
const assert = (condition, message, detail) => { if (!condition) throw new Error(`${message}: ${JSON.stringify(detail)}`); };

async function main() {
  if (!base) {
    base = "http://127.0.0.1:4195/patent";
    vite = spawn(process.execPath, [VITE_PATH, "--config", join(ROOT, "apps/web/vite.config.ts"), "--host", "127.0.0.1", "--port", "4195", "--strictPort"], {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let viteOutput = "";
    vite.stdout.on("data", (chunk) => { viteOutput += chunk.toString(); });
    vite.stderr.on("data", (chunk) => { viteOutput += chunk.toString(); });
    let ready = false;
    for (let attempt = 0; attempt < 200; attempt += 1) {
      try {
        const response = await fetch(`${base}/qa/v6/evidence/V6-25/browser-mount.html`);
        if (response.ok) { ready = true; break; }
      } catch {}
      if (vite.exitCode !== null) throw new Error(`Vite exited early: ${viteOutput}`);
      await pause(100);
    }
    if (!ready) throw new Error(`Vite harness did not respond: ${viteOutput}`);
  }
  const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  const profile = mkdtempSync(join(tmpdir(), "v6-25-browser-profile-"));
  const chrome = spawn(chromePath, [
    "--headless=new",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--window-size=1440,1900",
    "about:blank",
  ], { stdio: "ignore" });
  let ws;
  try {
    let pages = [];
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try {
        pages = await (await fetch(`http://localhost:${port}/json`)).json();
        if (pages.some((page) => page.type === "page")) break;
      } catch {}
      await pause(100);
    }
    const page = pages.find((item) => item.type === "page");
    if (!page) throw new Error("Chrome did not expose a page target");
    ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolvePromise, reject) => {
      ws.addEventListener("open", resolvePromise, { once: true });
      ws.addEventListener("error", reject, { once: true });
    });
    let id = 0;
    const pending = new Map();
    ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id && pending.has(message.id)) {
        pending.get(message.id)(message);
        pending.delete(message.id);
      } else if (message.method === "Runtime.exceptionThrown") {
        log.consoleErrors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
      } else if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") {
        log.consoleErrors.push(message.params.args.map((arg) => arg.value ?? arg.description).join(" "));
      } else if (message.method === "Network.requestWillBeSent") {
        log.network.push(message.params.request.url);
      }
    });
    const send = (method, params = {}) => new Promise((resolvePromise, reject) => {
      const commandId = ++id;
      pending.set(commandId, (message) => message.error ? reject(new Error(JSON.stringify(message.error))) : resolvePromise(message.result));
      ws.send(JSON.stringify({ id: commandId, method, params }));
    });
    const evaluate = async (expression) => {
      const response = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
      if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text);
      return response.result.value;
    };
    const waitFor = async (expression, name, attempts = 400) => {
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        if (await evaluate(`Boolean(${expression})`)) return;
        await pause(100);
      }
      throw new Error(`Timed out waiting for ${name}; page error=${await evaluate("window.__doneError ?? null")}`);
    };
    const click = async (testId) => {
      const clicked = await evaluate(`(() => { const button = document.querySelector('[data-testid="${testId}"]'); if (!button || button.disabled) return false; button.click(); return true; })()`);
      if (!clicked) throw new Error(`Cannot click ${testId}`);
    };
    const screenshot = async (name) => {
      const result = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
      writeFileSync(join(outDir, `${name}.png`), Buffer.from(result.data, "base64"));
      log.screenshots.push(`${name}.png`);
    };
    const facts = () => evaluate(`(() => {
      const fixture = window.__doneFixture;
      const store = fixture.repository.backend.data;
      const events = [...store.get("events").values()].filter((item) => item.action === "export.created");
      const rows = [...store.get("blobs").values()].filter((item) => item?.kind === "delivery.export");
      return {
        exportEvents: events.length,
        exportRows: rows.map((row) => ({ state: row.state, files: row.files.map((file) => file.name), manifestFiles: row.manifest.files.map((file) => file.name) })),
        matterVersion: [...store.get("matters").values()][0].matter.version,
      };
    })()`);

    await send("Runtime.enable");
    await send("Network.enable");
    await send("Page.enable");
    const url = `${base.replace(/\/$/, "")}/qa/v6/evidence/V6-25/browser-mount.html`;
    await send("Page.navigate", { url });

    await waitFor(`window.__doneReady && document.querySelector('[data-testid="done-page"][data-state="empty"]')`, "empty Done page");
    assert(await evaluate(`document.querySelector('[data-testid="done-gate"]')?.textContent.includes('允许生成材料')`), "current synthetic state passes the gate");
    assert(await evaluate(`document.querySelector('[data-testid="done-format-xml"]')?.textContent.includes('FORMAT_UNAVAILABLE')`), "XML has an explicit FORMAT_UNAVAILABLE reason");
    assert(await evaluate(`document.body.textContent.includes('G-XML') && !document.body.textContent.includes('已提交')`), "page does not claim submission and names the closed XML gate");
    assert(await evaluate(`!document.body.textContent.includes('将生成')`), "no will-generate placeholder copy");
    await screenshot("01-done-empty");
    log.steps.push({ step: "empty completion page shows gate, XML unavailable reason, and no submission claim", ok: true });

    await click("done-export-button");
    await waitFor(`document.querySelectorAll('[data-testid^="done-file-"]').length >= 7`, "real file list after export");
    const fileText = await evaluate(`[...document.querySelectorAll('[data-testid^="done-file-"]')].map((row) => ({ name: row.querySelector('strong')?.textContent, text: row.textContent, status: row.getAttribute('data-status'), download: Boolean(row.querySelector('button')) }))`);
    for (const expected of ["权利要求书.docx", "说明书.docx", "说明书摘要.docx", "提交检查清单.pdf", "项目备份.patentpack", "合成附图.png", "导出清单.json"]) {
      assert(fileText.some((file) => file.name === expected), `real file listed: ${expected}`, fileText.map((file) => file.name));
    }
    assert(fileText.every((file) => file.status === "ready" && file.download), "ready files have download controls", fileText);
    assert(fileText.every((file) => /SHA-256 [0-9a-f]{12}/.test(file.text)), "each file shows a 12-character SHA-256 prefix", fileText);
    assert(fileText.every((file) => /\d+ bytes/.test(file.text)), "each file shows its byte size", fileText);
    let storeFacts = await facts();
    assert(storeFacts.exportEvents === 1 && storeFacts.exportRows.length === 1, "one persisted export with one event", storeFacts);
    assert(storeFacts.exportRows[0].state === "ready", "persisted export row is ready", storeFacts.exportRows[0]);
    assert(!fileText.some((file) => file.name.endsWith(".xml")), "no XML file is listed", fileText);
    await screenshot("02-done-exported");
    log.steps.push({ step: "real export creates 7 files with size/hash/status and one export event", files: fileText.length, exportEvents: storeFacts.exportEvents, ok: true });

    const versionAfterFirst = storeFacts.matterVersion;
    await click("done-export-button");
    await pause(500);
    storeFacts = await facts();
    assert(storeFacts.exportEvents === 1 && storeFacts.exportRows.length === 1, "retry does not duplicate the export or event", storeFacts);
    assert(storeFacts.matterVersion === versionAfterFirst, "retry does not advance the matter version", storeFacts);
    log.steps.push({ step: "repeat export replays the same manifest and one event", exportEvents: 1, matterVersion: storeFacts.matterVersion, ok: true });

    await evaluate("window.__advanceSnapshot()");
    await click("done-refresh");
    await waitFor(`document.querySelector('[data-testid="done-page"]')?.getAttribute('data-state') === 'stale' && document.querySelector('[data-testid="done-stale"]') && [...document.querySelectorAll('[data-testid^="done-file-"]')].every((row) => row.getAttribute('data-status') === 'unavailable')`, "stale file state");
    assert(await evaluate(`[...document.querySelectorAll('[data-testid^="done-file-"]')].some((row) => row.textContent.includes('STALE_BINDING'))`), "old files show STALE_BINDING");
    assert(await evaluate(`[...document.querySelectorAll('[data-testid^="done-file-"]')].every((row) => !row.querySelector('button'))`), "stale files offer no download control");
    assert(await evaluate(`document.querySelector('[data-testid="done-export-button"]')?.textContent.includes('重新导出材料包')`), "stale page offers re-export");
    assert(await evaluate(`!document.body.textContent.includes('已提交')`), "stale page never claims submission");
    await screenshot("03-done-stale");
    log.steps.push({ step: "snapshot change marks old export unavailable with STALE_BINDING and re-export", ok: true });

    const localOrigin = new URL(base).origin;
    const externalRequests = log.network.filter((requestUrl) => !requestUrl.startsWith("data:") && new URL(requestUrl).origin !== localOrigin);
    assert(externalRequests.length === 0, "no external requests", externalRequests);
    assert(log.consoleErrors.length === 0, "no browser console errors", log.consoleErrors);
    log.steps.push({ step: "no external network or browser console errors", ok: true });
    log.ok = true;
    log.url = url;
    log.externalRequests = externalRequests;
  } finally {
    ws?.close();
    chrome.kill("SIGTERM");
    vite?.kill("SIGTERM");
    await pause(300);
    try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch {}
  }
  return log;
}

try {
  const result = await main();
  writeFileSync(join(outDir, "browser-log.json"), JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.ok ? 0 : 1;
} catch (error) {
  const result = {
    ok: false,
    error: String(error),
    steps: log.steps,
    consoleErrors: log.consoleErrors,
    network: log.network,
    screenshots: log.screenshots,
  };
  writeFileSync(join(outDir, "browser-log.json"), JSON.stringify(result, null, 2) + "\n");
  console.error(String(error));
  process.exitCode = 1;
}
