// Drives the standalone V6-24 panel in headless Chrome.
// Usage: node browser-drive.mjs <outDir> <baseUrl>
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const [outDirArg, base] = process.argv.slice(2);
const outDir = resolve(outDirArg ?? ".");
if (!base) throw new Error("usage: node browser-drive.mjs <outDir> <baseUrl>");

const log = { ok: false, steps: [], consoleErrors: [], network: [], screenshots: [] };
const pause = (ms) => new Promise((done) => setTimeout(done, ms));
const assert = (condition, message, detail) => { if (!condition) throw new Error(`${message}: ${JSON.stringify(detail)}`); };

async function main() {
  const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  const profile = mkdtempSync(join(tmpdir(), "v6-24-browser-profile-"));
  const port = 9364;
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
    const waitFor = async (expression, name, attempts = 300) => {
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        if (await evaluate(`Boolean(${expression})`)) return;
        await pause(100);
      }
      throw new Error(`Timed out waiting for ${name}; page error=${await evaluate("window.__approvalError ?? null")}`);
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
    const readApprovalFacts = () => evaluate(`(() => {
      const store = window.__approvalFixture.repository.backend.data;
      const events = [...store.get("events").values()].filter((item) => item.action === "approval.created" || item.action === "approval.revoked");
      const rows = [...store.get("blobs").values()].filter((item) => item?.kind === "delivery.approvals");
      return { events: events.map((item) => item.action), approvals: rows.flatMap((row) => row.ledger.approvals), revocations: rows.flatMap((row) => row.ledger.revocations) };
    })()`);

    await send("Runtime.enable");
    await send("Network.enable");
    await send("Page.enable");
    const url = `${base.replace(/\/$/, "")}/qa/v6/evidence/V6-24/browser-mount.html`;
    await send("Page.navigate", { url });
    await waitFor(`window.__approvalReady && document.querySelector('[data-testid="approval-panel"][data-state="ready"]')`, "ready approval panel");
    assert(await evaluate(`document.querySelector('[data-testid="approval-gate-approve"]')?.getAttribute('data-allowed') === 'true'`), "valid synthetic check enables approval");
    assert(await evaluate(`document.querySelector('[data-testid="approval-gate-export"]')?.textContent.includes('APPROVAL_REQUIRED')`), "approved-package export waits for an approval");
    assert(await evaluate(`document.querySelector('[data-testid="approval-ai-coverage"]')?.textContent.includes('0 / 0')`), "AI/mixed coverage is explicit for a human-only synthetic draft");
    await screenshot("01-approval-ready");
    log.steps.push({ step: "ready snapshot, check, figures, and gate reasons render", ok: true });

    await click("approval-create-button");
    await waitFor(`document.querySelectorAll('[data-testid^="approval-record-"]').length === 1 && document.querySelector('[data-testid="approval-gate-export"]')?.getAttribute('data-allowed') === 'true'`, "approval persisted and export gate recomputed");
    let facts = await readApprovalFacts();
    assert(facts.approvals.length === 1 && facts.events.filter((item) => item === "approval.created").length === 1, "one approval record and event persist", facts);
    await screenshot("02-approval-created");
    log.steps.push({ step: "valid approval is persisted and export gate recomputes", approvalCount: 1, approvalEvents: 1, ok: true });

    await click("approval-create-button");
    await waitFor(`document.querySelectorAll('[data-testid^="approval-record-"]').length === 1`, "duplicate retry retains one approval");
    facts = await readApprovalFacts();
    assert(facts.approvals.length === 1 && facts.events.filter((item) => item === "approval.created").length === 1, "retry creates no duplicate approval or event", facts);
    log.steps.push({ step: "repeat create reuses the same record without a duplicate event", approvalCount: 1, approvalEvents: 1, ok: true });

    await evaluate("window.__rebindFigures()");
    await click("approval-refresh");
    await waitFor(`document.querySelector('[data-testid="approval-panel"]')?.getAttribute('data-state') === 'stale' && document.querySelector('[data-testid="approval-stale"]')`, "figure rebind invalidates approval");
    assert(await evaluate(`document.querySelector('[data-testid="approval-record-' + window.__approvalFixture.repository.backend.data.get('events').values().next().value.resourceId + '"]') !== null || document.querySelector('[data-testid="approval-history"]')?.textContent.includes('STALE_BINDING')`), "stale approval remains visible with a binding reason");
    assert(await evaluate(`document.querySelector('[data-testid="approval-gate-export"]')?.textContent.includes('STALE_BINDING')`), "export gate reports the changed figure binding");
    await screenshot("03-approval-stale-figure-set");
    log.steps.push({ step: "figure rebind marks the approval stale and reports STALE_BINDING", ok: true });

    const approvalId = facts.approvals[0].id;
    await evaluate(`(() => {
      const input = document.querySelector('[data-testid="approval-revoke-reason-${approvalId}"]');
      if (!input) return false;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(input, '合成浏览器验收撤销');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    await waitFor(`document.querySelector('[data-testid="approval-revoke-${approvalId}"]')?.disabled === false`, "revoke action enabled");
    await click(`approval-revoke-${approvalId}`);
    await waitFor(`document.querySelector('[data-testid^="approval-revocation-"]')`, "revocation is visible");
    facts = await readApprovalFacts();
    assert(facts.approvals.length === 1 && facts.revocations.length === 1, "revocation is appended while the approval remains", facts);
    assert(facts.events.filter((item) => item === "approval.revoked").length === 1, "one revocation event is written", facts);
    await screenshot("04-approval-revoked");
    log.steps.push({ step: "revocation is append-only and visible", approvalCount: 1, revocationCount: 1, ok: true });

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
  };
  writeFileSync(join(outDir, "browser-log.json"), JSON.stringify(result, null, 2) + "\n");
  console.error(String(error));
  process.exitCode = 1;
}
