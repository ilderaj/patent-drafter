// Drives headless Chrome through the temporary V6-17 generation demo mount.
// Usage: node browser-drive.mjs <outDir> <baseUrl>
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const [outDirArg, base] = process.argv.slice(2);
const outDir = resolve(outDirArg ?? join(HERE));
if (!base) throw new Error("usage: node browser-drive.mjs <outDir> <baseUrl>");

const log = { steps: [], consoleErrors: [], network: [], screenshots: [] };
const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
const assert = (condition, message, current) => { if (!condition) throw new Error(`${message} :: ${JSON.stringify(current)}`); };

async function main() {
  const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  const profile = mkdtempSync(join(tmpdir(), "v6-17-profile-"));
  const port = 9357;
  const chrome = spawn(CHROME, [
    "--headless=new",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--window-size=1280,1800",
    "about:blank",
  ], { stdio: "ignore" });

  let targets = [];
  for (let i = 0; i < 80; i += 1) {
    try {
      targets = await (await fetch(`http://localhost:${port}/json`)).json();
      if (targets.some((target) => target.type === "page")) break;
    } catch {}
    await sleep(200);
  }
  const target = targets.find((item) => item.type === "page");
  if (!target) throw new Error("headless Chrome never exposed a page target");
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolvePromise) => ws.addEventListener("open", resolvePromise, { once: true }));
  let id = 0;
  const pending = new Map();
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
      return;
    }
    if (message.method === "Runtime.exceptionThrown") {
      log.consoleErrors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
    }
    if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") {
      log.consoleErrors.push(message.params.args.map((arg) => arg.value ?? arg.description).join(" "));
    }
    if (message.method === "Network.requestWillBeSent") log.network.push(message.params.request.url);
  });
  const send = (method, params = {}) => new Promise((resolvePromise, reject) => {
    const n = ++id;
    pending.set(n, (message) => message.error ? reject(new Error(JSON.stringify(message.error))) : resolvePromise(message.result));
    ws.send(JSON.stringify({ id: n, method, params }));
  });
  await send("Runtime.enable");
  await send("Network.enable");
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  };
  const waitFor = async (expression, label, tries = 300) => {
    for (let i = 0; i < tries; i += 1) {
      if (await evaluate(`!!(${expression})`)) return;
      await sleep(100);
    }
    throw new Error(`timeout waiting for ${label}`);
  };
  const shot = async (name) => {
    const { data } = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
    writeFileSync(join(outDir, `${name}.png`), Buffer.from(data, "base64"));
    log.screenshots.push(`${name}.png`);
  };
  const click = async (testid) => {
    const clicked = await evaluate(`(() => { const node = document.querySelector('[data-testid="${testid}"]'); if (!node || node.disabled) return false; node.click(); return true; })()`);
    if (!clicked) throw new Error(`cannot click ${testid}`);
  };
  const text = (testid) => evaluate(`document.querySelector('[data-testid="${testid}"]')?.textContent?.trim() ?? null`);
  const attr = (testid, name) => evaluate(`document.querySelector('[data-testid="${testid}"]')?.getAttribute(${JSON.stringify(name)}) ?? null`);

  try {
    await send("Page.navigate", { url: `${base}/v6/demo-generation` });
    await waitFor(`document.querySelector('[data-testid="generation"]')`, "generation panel", 400);
    assert((await attr("generation", "data-state")) === "empty", "empty panel before start");
    assert((await text("generation-empty"))?.includes("还没有生成任务"), "empty explanation");
    await shot("01-generation-empty");
    log.steps.push({ step: "01-generation-empty", ok: true });

    await click("generation-start");
    await waitFor(`document.querySelector('[data-testid="generation"][data-state="ready"]')`, "ready generation panel", 200);
    await shot("02-generation-running-or-done");
    log.steps.push({ step: "02-generation-running-or-done", ok: true });

    await waitFor(`document.querySelector('[data-testid="generation-stage-checks"]')?.getAttribute("data-state") === "completed"`, "checks completed", 400);
    const stages = await evaluate(`[...document.querySelectorAll("[data-testid^=generation-stage-]")].filter((node) => node.getAttribute("data-state")).map((node) => [node.getAttribute("data-testid"), node.getAttribute("data-state")])`);
    assert(stages.length === 5 && stages.every(([, state]) => state === "completed"), "five completed stages", stages);
    assert((await attr("generation-progress", "data-completed")) === "5", "progress completed 5");
    assert(await evaluate(`!!document.querySelector('[data-testid="generation-result"]')`), "candidate result present");
    assert((await text("generation-test-output"))?.includes("测试输出"), "stub output is labelled");
    assert(await evaluate(`!document.querySelector('[data-testid="generation-adopt"]')`), "stub output has no adopt action");
    await shot("03-generation-completed-stub");
    log.steps.push({ step: "03-generation-completed-stub", ok: true, stages });

    const external = log.network.filter((url) => !url.startsWith(base) && !url.startsWith("data:") && !url.includes("localhost:9357"));
    assert(external.length === 0, "no external network requests", external);
    log.steps.push({ step: "04-no-external-network", ok: true });
  } finally {
    ws.close();
    chrome.kill("SIGTERM");
    await sleep(500);
    try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch {}
  }

  const result = {
    ok: log.steps.every((step) => step.ok) && log.consoleErrors.length === 0,
    url: `${base}/v6/demo-generation`,
    steps: log.steps.map((step) => step.step),
    screenshots: log.screenshots,
    consoleErrors: log.consoleErrors,
    network: log.network,
    externalRequests: log.network.filter((url) => !url.startsWith(base) && !url.startsWith("data:")),
  };
  writeFileSync(join(outDir, "browser-log.json"), JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify(result, null, 2));
  return result;
}

try {
  const result = await main();
  process.exitCode = result.ok ? 0 : 1;
} catch (error) {
  writeFileSync(join(outDir, "browser-log.json"), JSON.stringify({ ok: false, error: String(error), steps: log.steps, consoleErrors: log.consoleErrors, network: log.network }, null, 2) + "\n");
  console.error(String(error));
  process.exitCode = 1;
}
