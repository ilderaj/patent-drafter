// Drives the isolated V6-18 editor harness in headless Chrome.
// Usage: node browser-drive.mjs <outDir> <baseUrl>
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const [outDirArg, base] = process.argv.slice(2);
const outDir = resolve(outDirArg ?? ".");
if (!base) throw new Error("usage: node browser-drive.mjs <outDir> <baseUrl>");

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
  const profile = mkdtempSync(join(tmpdir(), "v6-18-browser-profile-"));
  const port = 9361;
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
    await send("Page.navigate", { url: `${base}/qa/v6/evidence/V6-18/browser-mount.html` });
    await waitFor(`document.querySelector('[data-testid="draft-editor"][data-state="ready"]')`, "ready draft editor");
    const initial = await evaluate(`window.__v618?.initialRevisionId ?? null`);
    assert(typeof initial === "string", "synthetic revision is loaded", initial);
    assert(await evaluate(`document.querySelectorAll('[data-testid^="draft-section-"]').length === 6`), "all six sections render");
    await screenshot("01-editor-loaded");
    log.steps.push({ step: "01-editor-loaded", initialRevisionId: initial, ok: true });

    const changedText = "浏览器合成编辑内容已保存。";
    const changed = await evaluate(`(() => {
      const field = document.querySelector('[aria-label="权利要求段落 1"]');
      if (!field) return false;
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      setter.call(field, ${JSON.stringify(changedText)});
      field.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    assert(changed, "claim paragraph can be edited");
    await waitFor(`document.querySelector('[data-testid="draft-save"]')?.disabled === false`, "save enabled");
    await click("draft-save");
    await waitFor(`document.querySelector('[data-testid="draft-editor-notice"]')?.textContent?.includes('已保存新修订')`, "edited revision saved");
    const latest = await evaluate(`document.querySelector('[data-testid="draft-revision"]')?.textContent?.replace('修订 ', '') ?? null`);
    assert(latest && latest !== initial, "save creates a new head revision", { initial, latest });
    assert((await evaluate(`document.querySelector('[data-testid="draft-pending-ai"]')?.textContent ?? ''`)).includes("5 段"), "all AI paragraphs return to pending after edit");
    await screenshot("02-editor-saved");
    log.steps.push({ step: "02-editor-saved", revisionId: latest, pendingAi: 5, ok: true });

    await click("draft-preview");
    await click("draft-export");
    const projections = await evaluate(`({
      preview: window.__draftPreview && { revisionId: window.__draftPreview.revisionId, text: window.__draftPreview.ast.claims[0].paragraphs[0].text },
      exported: window.__draftExport && { revisionId: window.__draftExport.revisionId, text: window.__draftExport.ast.claims[0].paragraphs[0].text },
    })`);
    assert(projections.preview?.revisionId === latest && projections.preview.text === changedText, "preview references edited revision", projections.preview);
    assert(projections.exported?.revisionId === latest && projections.exported.text === changedText, "export references edited revision", projections.exported);
    log.steps.push({ step: "03-preview-export-revision-binding", ok: true, projections });

    const localOrigin = new URL(base).origin;
    const externalRequests = log.network.filter((url) => isExternalRequest(url, localOrigin));
    assert(externalRequests.length === 0, "no external requests", externalRequests);
    assert(log.consoleErrors.length === 0, "no browser console errors", log.consoleErrors);
    log.steps.push({ step: "04-no-external-network-or-console-errors", ok: true });
  } finally {
    ws?.close();
    chrome.kill("SIGTERM");
    await pause(300);
    try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch {}
  }

  const result = {
    ok: log.steps.every((step) => step.ok) && log.consoleErrors.length === 0,
    url: `${base}/qa/v6/evidence/V6-18/browser-mount.html`,
    steps: log.steps,
    screenshots: log.screenshots,
    consoleErrors: log.consoleErrors,
    network: log.network,
    externalRequests: log.network.filter((url) => isExternalRequest(url, new URL(base).origin)),
  };
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
