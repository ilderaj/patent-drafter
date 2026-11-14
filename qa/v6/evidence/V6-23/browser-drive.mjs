// Drives the standalone V6-23 checks panel in headless Chrome.
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

async function main() {
  const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  const profile = mkdtempSync(join(tmpdir(), "v6-23-browser-profile-"));
  const port = 9363;
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
    await send("Page.navigate", { url: `${base}/qa/v6/evidence/V6-23/browser-mount.html` });
    await waitFor(`document.querySelector('[data-testid="checks-panel"][data-state="ready"]')`, "ready checks panel");
    assert(await evaluate(`["blocker","risk","unverified","policy"].every((category) => document.querySelector('[data-testid="checks-count-' + category + '"]'))`), "all four groups and counts render");
    assert((await evaluate(`document.querySelector('[data-testid="checks-search-state"]')?.textContent`)).includes("未检索"), "search is labelled not searched");
    await screenshot("01-checks-ready");
    log.steps.push({ step: "01-checks-ready-four-groups", ok: true });

    const ackButton = await evaluate(`document.querySelector('[data-testid^="check-ack-"]')?.getAttribute('data-testid') ?? null`);
    assert(typeof ackButton === "string", "risk acknowledgement callback is available");
    await click(ackButton);
    await waitFor(`window.__readCounts()?.ackCalls === 1`, "one risk acknowledgement callback");
    assert(await evaluate(`!document.querySelector('[data-testid="${ackButton}"]')`), "acknowledged risk action is not duplicated");
    log.steps.push({ step: "02-risk-ack-callback-once", ackCalls: 1, ok: true });

    await click("checks-run");
    await waitFor(`window.__runCalls === 1 && document.querySelector('[data-testid="checks-rerunning"]')`, "rerun retaining previous result");
    assert(await evaluate(`document.querySelectorAll('[data-testid^="check-finding-"]').length > 0`), "old findings remain visible while rerunning");
    await evaluate(`document.querySelector('[data-testid="checks-run"]')?.click()`);
    assert(await evaluate(`window.__runCalls === 1`), "a repeated click does not start a duplicate run");
    await screenshot("02-checks-rerunning");
    await evaluate(`window.__releasePendingRun()`);
    await waitFor(`!document.querySelector('[data-testid="checks-rerunning"]') && window.__runCalls === 1`, "rerun completion");
    log.steps.push({ step: "03-rerun-retains-results-and-deduplicates", runCalls: 1, ok: true });

    await evaluate(`window.__setFailureMode()`);
    await click("checks-run");
    await waitFor(`document.querySelector('[data-testid="checks-error"]')?.getAttribute('data-code') === 'SYNTHETIC_CHECK_FAILURE'`, "failed rerun error state");
    assert(await evaluate(`document.querySelectorAll('[data-testid^="check-finding-"]').length > 0`), "failure keeps previous findings without showing a clean state");
    await screenshot("03-checks-error-retains-previous");
    log.steps.push({ step: "04-failed-rerun-keeps-old-result-and-error-code", ok: true });

    await evaluate(`window.__setStale()`);
    await waitFor(`document.querySelector('[data-testid="checks-panel"]')?.getAttribute('data-state') === 'stale'`, "snapshot stale state");
    assert(await evaluate(`!document.querySelector('[data-testid^="check-ack-"]')`), "stale results disable risk acknowledgement");
    assert((await evaluate(`document.querySelector('[data-testid="checks-run"]')?.textContent`)).includes("重新检查"), "stale results offer rerun");
    await screenshot("04-checks-stale");
    log.steps.push({ step: "05-stale-snapshot-requires-rerun", ok: true });

    await evaluate(`window.__setPackStale()`);
    await waitFor(`document.querySelector('[data-testid="checks-panel"]')?.getAttribute('data-state') === 'stale'`, "rule pack stale state");
    assert(await evaluate(`!document.querySelector('[data-testid^="check-ack-"]')`), "stale rule pack disables risk acknowledgement");
    log.steps.push({ step: "06-stale-rule-pack-requires-rerun", ok: true });

    const localOrigin = new URL(base).origin;
    const externalRequests = log.network.filter((url) => !url.startsWith("data:") && new URL(url).origin !== localOrigin);
    assert(externalRequests.length === 0, "no external requests", externalRequests);
    assert(log.consoleErrors.length === 0, "no console errors", log.consoleErrors);
    log.steps.push({ step: "07-no-external-network-or-console-errors", ok: true });
  } finally {
    ws?.close();
    chrome.kill("SIGTERM");
    await pause(300);
    try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch {}
  }

  const result = {
    ok: log.steps.every((step) => step.ok) && log.consoleErrors.length === 0,
    url: `${base}/qa/v6/evidence/V6-23/browser-mount.html`,
    steps: log.steps,
    screenshots: log.screenshots,
    consoleErrors: log.consoleErrors,
    network: log.network,
    externalRequests: log.network.filter((url) => !url.startsWith("data:") && new URL(url).origin !== new URL(base).origin),
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
