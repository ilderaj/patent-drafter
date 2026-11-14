// Drives the standalone V6-20 preview harness in local headless Chrome.
// Usage: node browser-drive.mjs
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(OUT, "../../../..");
const ORIGIN = "http://127.0.0.1:4188";
const MOUNT_URL = `${ORIGIN}/patent/qa/v6/evidence/V6-20/browser-mount.html`;
const CDP_PORT = 9362;
const CHROME_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const VITE_PATH = join(ROOT, "node_modules/vite/bin/vite.js");
const pause = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
const log = { ok: false, url: MOUNT_URL, steps: [], screenshots: [], consoleErrors: [], network: [], externalRequests: [] };
let vite;
let chrome;
let ws;
let profile;

const assert = (condition, message, detail) => {
  if (!condition) throw new Error(`${message}: ${JSON.stringify(detail)}`);
};

async function main() {
  vite = spawn(process.execPath, [VITE_PATH, "--config", join(ROOT, "apps/web/vite.config.ts"), "--host", "127.0.0.1", "--port", "4188", "--strictPort"], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let viteOutput = "";
  vite.stdout.on("data", (chunk) => { viteOutput += chunk.toString(); });
  vite.stderr.on("data", (chunk) => { viteOutput += chunk.toString(); });
  let serverReady = false;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await fetch(MOUNT_URL);
      if (response.ok) { serverReady = true; break; }
    } catch {}
    if (vite.exitCode !== null) throw new Error(`Vite exited early: ${viteOutput}`);
    await pause(100);
  }
  assert(serverReady, "local Vite harness responds", viteOutput);

  profile = mkdtempSync(join(tmpdir(), "v6-20-browser-profile-"));
  chrome = spawn(CHROME_PATH, [
    "--headless=new",
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--window-size=1440,1900",
    "about:blank",
  ], { stdio: "ignore" });
  let pages = [];
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      pages = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json`)).json();
      if (pages.some((page) => page.type === "page")) break;
    } catch {}
    await pause(100);
  }
  const page = pages.find((item) => item.type === "page");
  assert(page, "Chrome exposes a page target", pages);
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolvePromise, reject) => {
    ws.addEventListener("open", resolvePromise, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  let commandId = 0;
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
    const id = ++commandId;
    pending.set(id, (message) => message.error ? reject(new Error(JSON.stringify(message.error))) : resolvePromise(message.result));
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  };
  const waitFor = async (expression, label, attempts = 300) => {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (await evaluate(`Boolean(${expression})`)) return;
      await pause(100);
    }
    throw new Error(`Timed out waiting for ${label}`);
  };
  const click = async (selector) => {
    const didClick = await evaluate(`(() => { const node = document.querySelector(${JSON.stringify(selector)}); if (!node || node.disabled) return false; node.click(); return true; })()`);
    assert(didClick, `click ${selector}`, didClick);
  };
  const screenshot = async (name) => {
    const image = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
    writeFileSync(join(OUT, `${name}.png`), Buffer.from(image.data, "base64"));
    log.screenshots.push(`${name}.png`);
  };

  await send("Runtime.enable");
  await send("Network.enable");
  await send("Page.enable");
  await send("Page.navigate", { url: MOUNT_URL });
  await waitFor("document.querySelector('[data-testid=\"preview\"][data-preview-access=\"preview\"]')", "preview-only view");
  const redacted = await evaluate(`({
    hasLockedText: [window.__v620.lockedText, ...window.__v620.lockedQuotes].some((text) => document.querySelector('[data-testid="preview"]')?.innerHTML.includes(text) ?? true),
    hasReadConfirmation: Boolean(document.querySelector('[data-testid="preview-confirmation"]')),
    hasRisks: Boolean(document.querySelector('[data-testid="preview-risk-88888888-8888-4888-8888-888888888881"]')),
  })`);
  assert(!redacted.hasLockedText && !redacted.hasReadConfirmation && redacted.hasRisks, "preview mode keeps locked text out and has visible risks", redacted);
  await click('[data-testid="preview-annotation-88888888-8888-4888-8888-888888888881"]');
  await waitFor('document.querySelector("[data-testid=\\"preview-section-embodiments\\"][data-highlighted=\\"true\\"]")', "locked risk annotation section highlight");
  await screenshot("01-preview-risk-redacted");
  log.steps.push({ step: "01-preview-risk-redacted-and-located", ok: true });

  await click('[data-testid="switch-local"]');
  await waitFor('document.querySelector("[data-testid=\\"preview\\"][data-preview-access=\\"local_unmetered\\"]")', "local full preview");
  const local = await evaluate(`({
    fullText: document.body.innerText.includes(window.__v620.lockedText),
    localLabel: document.body.innerText.includes("本地预览，未接入付费"),
    payControls: [...document.querySelectorAll("button, a")].some((node) => /支付|解锁/.test(node.textContent ?? "")),
    confirmButton: Boolean(document.querySelector('[data-testid="preview-confirmation"] button')),
    aiMark: document.body.innerText.includes("◇"),
  })`);
  assert(local.fullText && local.localLabel && !local.payControls && local.confirmButton && local.aiMark, "local preview is full, unmetered, read-only and marked", local);
  await click('[data-testid="preview-risk-88888888-8888-4888-8888-888888888881"]');
  await waitFor('document.querySelector("[data-testid=\\"preview-paragraph-77777777-7777-4777-8777-777777777776\\"][data-highlighted=\\"true\\"]")', "full paragraph highlight");
  await screenshot("02-local-full-preview");
  log.steps.push({ step: "02-local-full-preview-and-paragraph-highlight", ok: true });

  await click('[data-testid="preview-confirmation"] input[type="checkbox"]');
  await click('[data-testid="preview-confirmation"] button');
  await waitFor('document.querySelector("[data-testid=\\"preview-confirmed\\"]")', "persisted read confirmation");
  const confirmed = await evaluate(`document.querySelector('[data-testid="preview-confirmed"]')?.innerText ?? ""`);
  assert(confirmed.includes("本机自报身份") && /2026/.test(confirmed), "confirmation displays local identity and timestamp", confirmed);
  await screenshot("03-full-read-confirmed");
  log.steps.push({ step: "03-full-read-confirmed", ok: true });

  await click('[data-testid="preview-actions"] a[href$="/facts"]');
  await click('[data-testid="preview-actions"] a[href$="/draft"]');
  const links = await evaluate(`({
    matterId: window.__v620.matterId,
    targetId: window.__v620.targetId,
    hrefs: [...document.querySelectorAll('[data-testid="preview-actions"] a')].map((link) => link.getAttribute("href")),
    actions: window.__v620.actions,
  })`);
  assert(links.hrefs[0].includes(links.matterId) && links.hrefs[0].endsWith("/facts"), "materials link retains the same matter", links);
  assert(links.hrefs[1].includes(links.targetId) && links.hrefs[1].endsWith("/draft"), "draft link retains the same matter and target", links);
  assert(links.actions.some((item) => item.action === "modify" && item.matterId === links.matterId)
    && links.actions.some((item) => item.action === "draft" && item.matterId === links.matterId && item.targetId === links.targetId), "action callbacks retain matter and target", links.actions);
  log.steps.push({ step: "04-same-matter-navigation", ok: true });

  await evaluate("window.__v620.advanceSource()");
  await evaluate("window.__v620.setMode('preview')");
  await waitFor('document.querySelector("[data-testid=\\"preview\\"][data-preview-access=\\"preview\\"]")', "refreshed preview mode");
  await click('[data-testid="switch-local"]');
  await waitFor('document.querySelector("[data-testid=\\"preview-stale\\"][data-stale-kind=\\"input\\"]")', "source-version stale banner");
  await click('[data-testid="preview-stale"] button:nth-of-type(1)');
  await click('[data-testid="preview-stale"] button:nth-of-type(2)');
  const staleState = await evaluate("({ matterId: window.__v620.matterId, targetId: window.__v620.targetId, actions: window.__v620.actions.slice(-2) })");
  assert(staleState.actions[0].action === "regenerate" && staleState.actions[0].matterId === staleState.matterId
    && staleState.actions[1].action === "adopt" && staleState.actions[1].targetId === staleState.targetId, "stale callbacks target the same matter", staleState);
  await screenshot("04-stale-input-actions");
  log.steps.push({ step: "05-stale-input-banner-callbacks", ok: true, actions: staleState.actions });

  const origin = new URL(MOUNT_URL).origin;
  log.externalRequests = log.network.filter((url) => {
    if (url.startsWith("data:")) return false;
    try { return new URL(url).origin !== origin; } catch { return true; }
  });
  assert(log.externalRequests.length === 0, "browser makes no external requests", log.externalRequests);
  assert(log.consoleErrors.length === 0, "browser has no console errors", log.consoleErrors);
  log.steps.push({ step: "06-no-external-requests-or-console-errors", ok: true });
  log.ok = true;
}

try {
  await main();
  writeFileSync(join(OUT, "browser-log.json"), JSON.stringify(log, null, 2) + "\n");
  console.log(JSON.stringify(log, null, 2));
} catch (error) {
  log.error = String(error);
  writeFileSync(join(OUT, "browser-log.json"), JSON.stringify(log, null, 2) + "\n");
  console.error(String(error));
  process.exitCode = 1;
} finally {
  ws?.close();
  chrome?.kill("SIGTERM");
  vite?.kill("SIGTERM");
  await pause(300);
  if (profile) {
    try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch {}
  }
}
