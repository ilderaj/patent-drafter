// Drives the isolated V6-19 review harness in headless Chrome.
// Usage: node browser-drive.mjs <outDir> <baseUrl>
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const [outDirArg, base] = process.argv.slice(2);
const outDir = resolve(outDirArg ?? ".");
if (!base) throw new Error("usage: node browser-drive.mjs <outDir> <baseUrl>");
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../../../..");
const VITE_CACHE = process.env.VITE_CACHE_DIR ?? resolve(tmpdir(), "v6-19-vite-cache");
const SHARED_CACHE = "/Users/jared/Personal Projects/Patent/node_modules/.vite";
const sharedCacheMtimeBefore = statSync(SHARED_CACHE).mtimeMs;
let vite;

const log = { steps: [], consoleErrors: [], network: [], screenshots: [] };
const pause = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
const assert = (condition, message, detail) => { if (!condition) throw new Error(`${message}: ${JSON.stringify(detail)}`); };
const isExternalRequest = (value, localOrigin) => {
  if (value.startsWith("data:")) return false;
  try { return new URL(value).origin !== localOrigin; }
  catch { return true; }
};

async function main() {
  const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  const profile = mkdtempSync(join(tmpdir(), "v6-19-browser-profile-"));
  const port = 9362;
  let serverReady = false;
  try {
    serverReady = (await fetch(`${base}/qa/v6/evidence/V6-19/browser-mount.html`)).ok;
  } catch {}
  if (!serverReady) {
    vite = spawn(process.execPath, [join(ROOT, "node_modules/vite/bin/vite.js"), "--config", join(ROOT, "apps/web/vite.config.ts"), "--host", "127.0.0.1", "--port", "4189", "--strictPort"], {
      cwd: ROOT,
      env: { ...process.env, VITE_CACHE_DIR: VITE_CACHE },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let viteOutput = "";
    vite.stdout.on("data", (chunk) => { viteOutput += String(chunk); });
    vite.stderr.on("data", (chunk) => { viteOutput += String(chunk); });
    for (let attempt = 0; attempt < 120; attempt += 1) {
      try {
        if ((await fetch(`${base}/qa/v6/evidence/V6-19/browser-mount.html`)).ok) { serverReady = true; break; }
      } catch {}
      await pause(100);
    }
    if (!serverReady) throw new Error(`Vite did not start: ${viteOutput}`);
  }
  const chrome = spawn(chromePath, [
    "--headless=new",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--window-size=1440,1800",
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
    const waitFor = async (expression, name, attempts = 300) => {
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        if (await evaluate(`Boolean(${expression})`)) return;
        await pause(100);
      }
      throw new Error(`Timed out waiting for ${name}`);
    };
    const screenshot = async (name) => {
      const result = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
      writeFileSync(join(outDir, `${name}.png`), Buffer.from(result.data, "base64"));
      log.screenshots.push(`${name}.png`);
    };
    const click = async (testId) => {
      const clicked = await evaluate(`(() => { const button = document.querySelector('[data-testid="${testId}"]'); if (!button || button.disabled) return false; button.click(); return true; })()`);
      if (!clicked) throw new Error(`Cannot click ${testId}`);
    };

    await send("Runtime.enable");
    await send("Network.enable");
    await send("Page.enable");
    await send("Page.navigate", { url: `${base}/qa/v6/evidence/V6-19/browser-mount.html` });
    await waitFor(`document.querySelector('[data-testid="draft-editor"][data-state="ready"]') && document.querySelector('[data-testid="draft-review"][data-state="ready"]')`, "editor and review ready");
    const fixture = await evaluate("window.__v619 ?? null");
    assert(typeof fixture?.revisionId === "string", "synthetic revision loaded", fixture);
    assert(await evaluate(`(() => { const row = document.querySelector('[data-testid="draft-review-source-refs"] tbody tr'); return row?.textContent.includes(window.__v619.sourceId) && row?.textContent.includes(window.__v619.chunkId) && row?.textContent.includes('热量'); })()`), "source ref table includes locator and quote");
    assert(await evaluate(`document.querySelectorAll('[data-testid^="draft-review-confirm-"]').length === 1`), "confirmation control appears for the AI paragraph only");
    await screenshot("01-review-ready");
    log.steps.push({ step: "01-review-ready", revisionId: fixture.revisionId, ok: true });

    const sourceClicked = await evaluate(`(() => { const button = [...document.querySelectorAll('[data-testid="draft-review-source-refs"] button')].find((item) => item.textContent.includes('定位来源片段')); if (!button) return false; button.click(); return true; })()`);
    assert(sourceClicked, "source marker can be activated");
    await waitFor(`document.querySelector('[data-testid="draft-review-source-chunk"] mark')?.textContent === '热量'`, "source quote highlighted");
    await waitFor(`document.activeElement?.dataset?.testid === 'draft-review-source-chunk'`, "source chunk receives DOM focus");
    await screenshot("02-source-located");
    log.steps.push({ step: "02-source-located", quote: "热量", focus: "source-chunk", ok: true });

    const claimClicked = await evaluate(`(() => { const button = [...document.querySelectorAll('[data-testid="draft-review-support"] button')].find((item) => item.textContent.includes('定位权利要求')); if (!button) return false; button.click(); return true; })()`);
    assert(claimClicked, "claim locator can be activated");
    await waitFor(`document.activeElement?.id === 'draft-node-${fixture.claimId}'`, "claim receives DOM focus");

    const riskButton = `draft-review-risk-locate-${"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb9"}`;
    await click(riskButton);
    await waitFor(`document.activeElement?.id === 'draft-node-${fixture.featureId}'`, "risk anchor receives DOM focus");
    log.steps.push({ step: "03-risk-claim-focus", claimId: fixture.claimId, riskNodeId: fixture.featureId, ok: true });
    await screenshot("03-risk-claim-focus");

    await click(`draft-review-confirm-${fixture.paragraphId}`);
    await waitFor(`document.querySelector('[data-testid="draft-review-paragraph-${fixture.paragraphId}"]')?.dataset.confirmed === 'true'`, "paragraph confirmation saved");
    const paragraphClicked = await evaluate(`(() => { const article = document.querySelector('[data-testid="draft-review-paragraph-${fixture.paragraphId}"]'); const button = article?.querySelector('button[aria-expanded="false"]'); if (!button) return false; button.click(); return true; })()`);
    assert(paragraphClicked, "confirmed paragraph can open its record");
    await waitFor(`document.querySelector('[data-testid="draft-review-confirmation-history"]')?.textContent.includes('local_self_reported')`, "confirmer details displayed");
    const confirmation = await evaluate(`(() => { const panel = document.querySelector('[data-testid="draft-review-confirmation-history"]'); const reason = panel?.querySelector('input[data-testid^="draft-review-revoke-reason-"]'); const button = panel?.querySelector('button[data-testid^="draft-review-revoke-"]'); return { text: panel?.textContent ?? '', input: reason?.dataset.testid ?? null, button: button?.dataset.testid ?? null }; })()`);
    assert(confirmation.text.includes(fixture.actorId) && confirmation.text.includes("2026-11-05T12:00:00.000Z"), "actor and time shown", confirmation);
    assert(typeof confirmation.input === "string" && typeof confirmation.button === "string", "revoke control shown", confirmation);
    await evaluate(`(() => { const input = document.querySelector('[data-testid="${confirmation.input}"]'); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(input, '浏览器合成撤销原因'); input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await waitFor(`document.querySelector('[data-testid="${confirmation.button}"]')?.disabled === false`, "revoke action enabled");
    await click(confirmation.button);
    await waitFor(`document.querySelector('[data-testid^="draft-review-revocation-"]')?.textContent.includes('浏览器合成撤销原因')`, "append-only revocation shown");
    await screenshot("04-confirmation-revoked");
    log.steps.push({ step: "04-confirmation-and-revocation", identity: "local_self_reported", actorId: fixture.actorId, ok: true });

    const localOrigin = new URL(base).origin;
    const externalRequests = log.network.filter((url) => isExternalRequest(url, localOrigin));
    assert(externalRequests.length === 0, "no external requests", externalRequests);
    assert(log.consoleErrors.length === 0, "no browser console errors", log.consoleErrors);
    log.steps.push({ step: "05-no-external-network-or-console-errors", ok: true });
  } finally {
    ws?.close();
    chrome.kill("SIGTERM");
    vite?.kill("SIGTERM");
    await pause(300);
    try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch {}
  }

  const sharedCacheMtimeAfter = statSync(SHARED_CACHE).mtimeMs;
  const result = {
    ok: log.steps.every((step) => step.ok) && log.consoleErrors.length === 0
      && sharedCacheMtimeBefore === sharedCacheMtimeAfter,
    url: `${base}/qa/v6/evidence/V6-19/browser-mount.html`,
    steps: log.steps,
    screenshots: log.screenshots,
    consoleErrors: log.consoleErrors,
    network: log.network,
    externalRequests: log.network.filter((url) => isExternalRequest(url, new URL(base).origin)),
    viteCacheDir: VITE_CACHE,
    sharedCache: {
      path: SHARED_CACHE,
      mtimeBefore: sharedCacheMtimeBefore,
      mtimeAfter: sharedCacheMtimeAfter,
      unchanged: sharedCacheMtimeBefore === sharedCacheMtimeAfter,
    },
  };
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "vite-cache-path.txt"), `${VITE_CACHE}\n`);
  writeFileSync(join(outDir, "browser-log.json"), JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify(result, null, 2));
  return result;
}

try {
  const result = await main();
  process.exitCode = result.ok ? 0 : 1;
} catch (error) {
  writeFileSync(join(outDir, "browser-log.json"), JSON.stringify({
    ok: false,
    error: String(error),
    steps: log.steps,
    consoleErrors: log.consoleErrors,
    network: log.network,
  }, null, 2) + "\n");
  console.error(String(error));
  process.exitCode = 1;
}
