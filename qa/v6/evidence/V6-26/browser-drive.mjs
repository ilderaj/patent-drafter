// Drives the standalone V6-26 Recovery page in headless Chrome.
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
const port = Number(portArg ?? 9376);
const passphrase = process.env.V6_26_BROWSER_PASSPHRASE;
if (!passphrase) throw new Error("V6_26_BROWSER_PASSPHRASE is required (kept out of evidence)");
let vite;
let base = baseArg;

const log = { ok: false, steps: [], consoleErrors: [], network: [], screenshots: [] };
const pause = (ms) => new Promise((done) => setTimeout(done, ms));
const assert = (condition, message, detail) => { if (!condition) throw new Error(`${message}: ${JSON.stringify(detail)}`); };

async function main() {
  if (!base) {
    base = "http://127.0.0.1:4196/patent";
    vite = spawn(process.execPath, [VITE_PATH, "--config", join(ROOT, "apps/web/vite.config.ts"), "--host", "127.0.0.1", "--port", "4196", "--strictPort"], {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, VITE_CACHE_DIR: join(tmpdir(), "v6-26-vite-cache") },
    });
    let viteOutput = "";
    vite.stdout.on("data", (chunk) => { viteOutput += chunk.toString(); });
    vite.stderr.on("data", (chunk) => { viteOutput += chunk.toString(); });
    let ready = false;
    for (let attempt = 0; attempt < 200; attempt += 1) {
      try {
        const response = await fetch(`${base}/qa/v6/evidence/V6-26/browser-mount.html`);
        if (response.ok) { ready = true; break; }
      } catch {}
      if (vite.exitCode !== null) throw new Error(`Vite exited early: ${viteOutput}`);
      await pause(100);
    }
    if (!ready) throw new Error(`Vite harness did not respond: ${viteOutput}`);
  }
  const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  const profile = mkdtempSync(join(tmpdir(), "v6-26-browser-profile-"));
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
    const waitFor = async (expression, name, attempts = 500) => {
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        if (await evaluate(`Boolean(${expression})`)) return;
        await pause(100);
      }
      throw new Error(`Timed out waiting for ${name}; page error=${await evaluate("window.__recoveryError ?? null")}`);
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
      const store = window.__recoveryFixture.repository.backend.data;
      const matters = [...store.get("matters").values()];
      const events = [...store.get("events").values()];
      const rows = [...store.get("blobs").values()];
      const imported = matters.find((row) => row.matter.id !== window.__recoveryFixture.matterId);
      return {
        matters: matters.length,
        importedMatterId: imported?.matter.id ?? null,
        matterCreated: events.filter((event) => event.action === "matter.created" && event.matterId !== window.__recoveryFixture.matterId).length,
        targetCreated: events.filter((event) => event.action === "target.created" && event.matterId !== window.__recoveryFixture.matterId).length,
        legacyRows: rows.filter((row) => row?.kind === "recovery.legacy_review" && row.matterId !== window.__recoveryFixture.matterId).length,
        validationRows: rows.filter((row) => row?.kind === "recovery.validation").length,
        commitMarkers: rows.filter((row) => row?.kind === "recovery.commit").length,
        forbiddenRows: rows.filter((row) => row.matterId && row.matterId !== window.__recoveryFixture.matterId
          && ["delivery.approvals", "draft-review.confirmations", "recovery.approval", "payment", "entitlement"].includes(row.kind)).length,
      };
    })()`);

    await send("Runtime.enable");
    await send("Network.enable");
    await send("Page.enable");
    const url = `${base.replace(/\/$/, "")}/qa/v6/evidence/V6-26/browser-mount.html`;
    await send("Page.navigate", { url });

    await waitFor(`window.__recoveryReady && document.querySelector('[data-testid="recovery-page"][data-state="empty"]')`, "empty recovery page");
    assert(await evaluate(`document.body.textContent.includes('不恢复批准') && document.body.textContent.includes('legacy_unverified')`), "page states the non-restored records and legacy marker");
    assert(await evaluate(`!document.body.textContent.includes('恢复完成')`), "empty page does not claim success");
    await screenshot("01-recovery-empty");
    log.steps.push({ step: "empty state shows prerequisites and the non-restored records; no success claim", ok: true });

    await evaluate(`(() => {
      const input = document.querySelector('[data-testid="recovery-passphrase"]');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      setter.call(input, ${JSON.stringify(passphrase)});
      input.dispatchEvent(new Event("input", { bubbles: true }));
    })()`);
    await waitFor(`!document.querySelector('[data-testid="recovery-generate"]').disabled`, "enabled generate button");
    await click("recovery-generate");
    await waitFor(`document.querySelector('[data-testid="recovery-export-hash"]')`, "generated package hash");
    const hashText = await evaluate(`document.querySelector('[data-testid="recovery-export-hash"]').textContent`);
    assert(/SHA-256 [0-9a-f]{64}/.test(hashText), "generated package shows its real SHA-256", hashText);
    assert(await evaluate(`document.querySelector('[data-testid="recovery-download"]')?.textContent.includes('.patentpack')`), "download control names the encrypted package");
    assert(!hashText.includes(passphrase), "passphrase is never shown");
    await screenshot("02-recovery-generated");
    log.steps.push({ step: "encrypted recovery package generated with a real SHA-256 and download control", ok: true });

    const selected = await evaluate(`(async () => {
      const bytes = await window.__makePackage("local_unmetered", ${JSON.stringify(passphrase)});
      const file = new File([bytes], "recovery.patentpack", { type: "application/octet-stream" });
      const transfer = new DataTransfer();
      transfer.items.add(file);
      const input = document.querySelector('[data-testid="recovery-file"]');
      input.files = transfer.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return bytes.byteLength;
    })()`);
    assert(selected > 0, "a real encrypted package was selected", selected);
    await waitFor(`document.body.textContent.includes('recovery.patentpack')`, "selected package name");
    await click("recovery-validate");
    await waitFor(`document.querySelector('[data-testid="recovery-report"]')`, "migration report");
    assert(await evaluate(`document.querySelector('[data-testid="recovery-page"]').getAttribute('data-state') === 'stale'`), "incomplete report enters stale state");
    assert(await evaluate(`document.querySelector('[data-testid="recovery-missing"]')?.textContent.includes('missing_bytes')`), "missing bytes are listed with their post-import state");
    assert(await evaluate(`document.querySelector('[data-testid="recovery-legacy"]')?.textContent.includes('legacy_unverified')`), "legacy reviews are listed as legacy_unverified");
    assert(await evaluate(`document.body.textContent.includes('15 分钟')`), "validation retention is disclosed");
    assert(await evaluate(`document.querySelector('[data-testid="recovery-commit"]').disabled`), "commit stays disabled before the report is reviewed");
    const countsBefore = await evaluate(`document.querySelector('[data-testid="recovery-counts"]').textContent`);
    await screenshot("03-recovery-stale-report");
    log.steps.push({ step: "dry-run report shows mapping counts, missing bytes and legacy_unverified; commit is gated", ok: true });

    await evaluate(`(() => { const box = document.querySelector('[data-testid="recovery-reviewed"]'); box.click(); })()`);
    await waitFor(`!document.querySelector('[data-testid="recovery-commit"]').disabled`, "enabled commit after review");
    await click("recovery-commit");
    await waitFor(`document.querySelector('[data-testid="recovery-committed"]')`, "committed recovery");
    const committedText = await evaluate(`document.querySelector('[data-testid="recovery-committed"]').textContent`);
    assert(committedText.includes("未恢复任何批准"), "success copy repeats the non-restored scope", committedText);
    let storeFacts = await facts();
    assert(storeFacts.matters === 2, "exactly one new matter exists", storeFacts);
    assert(storeFacts.matterCreated === 1, "exactly one matter.created event for the new matter", storeFacts);
    assert(storeFacts.targetCreated >= 1, "target.created event was remapped for the new target", storeFacts);
    assert(storeFacts.legacyRows > 0, "legacy reviews are persisted as legacy_unverified rows", storeFacts);
    assert(storeFacts.forbiddenRows === 0, "no approval/confirmation/payment/entitlement rows were restored", storeFacts);
    assert(storeFacts.validationRows === 0, "decrypted validation row is deleted after commit", storeFacts);
    assert(storeFacts.commitMarkers === 1, "a metadata-only commit marker remains for replay", storeFacts);
    const countsAfter = await evaluate(`document.querySelector('[data-testid="recovery-counts"]').textContent`);
    assert(countsAfter === countsBefore, "mapping counts are identical before and after commit", { countsBefore, countsAfter });
    await screenshot("04-recovery-committed");
    log.steps.push({ step: "commit creates exactly one new matter with remapped events, identical counts and legacy_unverified rows", matters: storeFacts.matters, ok: true });

    await click("recovery-refresh");
    await pause(500);
    storeFacts = await facts();
    assert(storeFacts.matters === 2, "refresh does not create another matter", storeFacts);
    assert(storeFacts.matterCreated === 1, "refresh does not duplicate matter.created", storeFacts);
    assert(storeFacts.validationRows === 0 && storeFacts.commitMarkers === 1, "refresh reads the commit marker without a package row", storeFacts);
    assert(await evaluate(`document.querySelector('[data-testid="recovery-commit"]').disabled`), "committed validation cannot be committed again");
    await screenshot("05-recovery-refreshed");
    log.steps.push({ step: "in-page refresh reads the persisted commit marker and creates no duplicate side effect", ok: true });

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
