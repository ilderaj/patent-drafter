// Drives headless Chrome over CDP through the V6-15 AI and data surface.
// Usage: node browser-drive.mjs <outDir> <baseUrl>
//   e.g. node browser-drive.mjs qa/v6/evidence/V6-15 http://localhost:4178/patent
//
// The V6-15 mount is applied temporarily to V6App.tsx/navigation.ts, the app is
// built and served from this worktree on port 4178, and the run uses a throwaway
// Chrome profile. The matter, the text file and all profile facts are synthetic.
// No model, provider adapter, key, real material or external network is used.
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const GOOD_PROFILE_ID = "a1000000-0000-4000-8000-000000000001";
const UNKNOWN_PROFILE_ID = "a1000000-0000-4000-8000-000000000002";
const FIXTURE_NAME = "v6-15-合成材料.txt";
const FIXTURE_TEXT = "V6-15 合成测试材料。本文件不是客户材料，也不含任何真实案件内容。\n第一段：合成段落。\n";

const [outDirArg, base] = process.argv.slice(2);
const outDir = resolve(outDirArg ?? join(HERE));
if (!base) throw new Error("usage: node browser-drive.mjs <outDir> <baseUrl>");

const log = { steps: [], consoleErrors: [], network: [], db: {}, screenshots: [] };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function recordStep(name, fn, api) {
  try {
    const notes = await fn();
    log.steps.push({ step: name, ok: true, notes: notes ?? null });
    await api.shot(name);
  } catch (error) {
    log.steps.push({ step: name, ok: false, error: String(error) });
    await api.shot(name).catch(() => {});
    throw error;
  }
}

function assert(condition, message, current) {
  if (!condition) throw new Error(`${message} :: ${JSON.stringify(current)}`);
}

async function main() {
  const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  const profile = mkdtempSync(join(tmpdir(), "v6-15-profile-"));
  const fixtures = mkdtempSync(join(tmpdir(), "v6-15-fixtures-"));
  const fixturePath = join(fixtures, FIXTURE_NAME);
  writeFileSync(fixturePath, FIXTURE_TEXT, "utf8");

  const port = 9349;
  const chrome = spawn(
    CHROME,
    [
      "--headless=new",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--window-size=1280,1800",
      "about:blank",
    ],
    { stdio: "ignore" },
  );

  let targets = [];
  for (let i = 0; i < 80; i += 1) {
    try {
      targets = await (await fetch(`http://localhost:${port}/json`)).json();
      if (targets.some((target) => target.type === "page")) break;
    } catch {}
    await sleep(200);
  }
  const page = targets.find((target) => target.type === "page");
  if (!page) throw new Error("headless Chrome never exposed a page target");

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
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
      log.consoleErrors.push(
        message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text,
      );
    }
    if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") {
      log.consoleErrors.push(message.params.args.map((arg) => arg.value ?? arg.description).join(" "));
    }
    if (message.method === "Network.requestWillBeSent") {
      log.network.push(message.params.request.url);
    }
  });
  const send = (method, params = {}) =>
    new Promise((resolvePromise, reject) => {
      const n = ++id;
      pending.set(n, (message) =>
        message.error ? reject(new Error(JSON.stringify(message.error))) : resolvePromise(message.result),
      );
      ws.send(JSON.stringify({ id: n, method, params }));
    });
  const evaluate = async (expression, { userGesture = false } = {}) => {
    const result = await send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    }
    return result.result.value;
  };
  const waitFor = async (expression, label, tries = 400) => {
    for (let i = 0; i < tries; i += 1) {
      if (await evaluate(`!!(${expression})`)) return;
      await sleep(100);
    }
    throw new Error(`timeout waiting for ${label}`);
  };
  const go = async (path) => {
    await send("Page.navigate", { url: base + path });
    await sleep(600);
  };
  const shot = async (name) => {
    const { data } = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
    const file = `${name}.png`;
    writeFileSync(join(outDir, file), Buffer.from(data, "base64"));
    log.screenshots.push(file);
  };
  const setFiles = async (selector, paths) => {
    const { root } = await send("DOM.getDocument", { depth: -1 });
    const { nodeId } = await send("DOM.querySelector", { nodeId: root.nodeId, selector });
    if (!nodeId) throw new Error(`file input not found: ${selector}`);
    await send("DOM.setFileInputFiles", { nodeId, files: paths });
  };
  const click = async (selector) => {
    const clicked = await evaluate(
      `(() => { const node = document.querySelector(${JSON.stringify(selector)}); if (!node || node.disabled) return false; node.click(); return true; })()`,
      { userGesture: true },
    );
    if (!clicked) throw new Error(`cannot click ${selector}`);
  };
  const ai = () =>
    evaluate(`(() => {
      const panel = document.querySelector("[data-testid=ai-panel]");
      const text = (selector) => document.querySelector(selector)?.textContent?.trim() ?? null;
      const html = panel?.innerHTML ?? "";
      const grants = [...document.querySelectorAll("[data-testid^=ai-grant-]")]
        .filter((node) => node.hasAttribute("data-grantable"))
        .map((node) => ({
          id: node.getAttribute("data-testid").slice("ai-grant-".length),
          grantable: node.getAttribute("data-grantable"),
          disabled: node.disabled === true,
        }));
      const revokes = [...document.querySelectorAll("[data-testid^=ai-revoke-]")].map((node) => ({
        id: node.getAttribute("data-testid").slice("ai-revoke-".length),
        disabled: node.disabled === true,
      }));
      const consents = [...document.querySelectorAll("[data-testid^=ai-consent-]")]
        .filter((node) => /^ai-consent-[0-9a-f-]{36}$/.test(node.getAttribute("data-testid") ?? ""))
        .map((node) => ({
          id: node.getAttribute("data-testid").slice("ai-consent-".length),
          text: node.textContent,
        }));
      const invocations = [...document.querySelectorAll("[data-testid^=ai-invocation-]")]
        .filter((node) => /^ai-invocation-[0-9a-f-]{36}$/.test(node.getAttribute("data-testid") ?? ""))
        .length;
      return {
        state: panel?.getAttribute("data-ai-state") ?? null,
        empty: text("[data-testid=ai-empty]"),
        emptyReason: document.querySelector("[data-testid=ai-empty]")?.getAttribute("data-reason") ?? null,
        loading: !!document.querySelector("[data-testid=ai-loading]"),
        loadError: text("[data-testid=ai-load-error]"),
        releaseGate: text("[data-testid=ai-release-gate]"),
        releaseState: document.querySelector("[data-testid=ai-release-gate]")?.getAttribute("data-state") ?? null,
        currentMode: text("[data-testid=ai-current-mode]"),
        matter: text("[data-testid=ai-matter]"),
        matterLink: text("[data-testid=ai-matter-link]"),
        manifest: text("[data-testid=ai-manifest]"),
        manifestHash: text("[data-testid=ai-manifest-hash]"),
        profileCapabilities: text("[data-testid=ai-profile-capabilities-${GOOD_PROFILE_ID}]"),
        unknownRegion: document.querySelector("[data-testid=ai-profile-region-${UNKNOWN_PROFILE_ID}]")?.getAttribute("data-known") ?? null,
        unknownFieldText: text("[data-testid=ai-profile-region-${UNKNOWN_PROFILE_ID}]"),
        consentsEmpty: !!document.querySelector("[data-testid=ai-consents-empty]"),
        invocationsEmpty: !!document.querySelector("[data-testid=ai-invocations-empty]"),
        notice: text("[data-testid=ai-notice]"),
        actionError: text("[data-testid=ai-action-error]"),
        stale: text("[data-testid=ai-stale]"),
        grants,
        revokes,
        consents,
        invocations,
        hasPromptMarkers: /PROMPT-MUST-NOT-LEAK|CASE-CONTENT-MUST-NOT-LEAK|sk-KEY-MUST-NOT-LEAK/.test(html),
      };
    })()`);
  const db = () =>
    evaluate(`new Promise((resolve, reject) => {
      const open = indexedDB.open("patent.v6.local");
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const database = open.result;
        const tx = database.transaction(["matters", "events", "blobs"], "readonly");
        const all = (store) => new Promise((res, rej) => {
          const request = tx.objectStore(store).getAll();
          request.onsuccess = () => res(request.result);
          request.onerror = () => rej(request.error);
        });
        Promise.all([all("matters"), all("events"), all("blobs")]).then(([matters, events, blobs]) => {
          database.close();
          resolve({ matters, events, blobs });
        }, reject);
      };
    })`);
  const dbSummary = async () => {
    const raw = await db();
    const aggregate = raw.matters[0] ?? null;
    const matterId = aggregate?.matter?.id ?? null;
    const mine = (row) => row?.matterId === matterId;
    const events = raw.events.filter(mine);
    const blobs = raw.blobs.filter((row) => !row?.matterId || mine(row));
    return {
      matterId,
      title: aggregate?.matter?.title ?? null,
      status: aggregate?.matter?.status ?? null,
      version: aggregate?.matter?.version ?? null,
      sourceVersion: aggregate?.matter?.sourceVersion ?? null,
      assets: (aggregate?.assets ?? []).map((asset) => ({
        id: asset.id,
        name: asset.originalName,
        purpose: asset.purpose,
        state: asset.state,
        byteLength: asset.byteLength,
      })),
      parseSources: blobs.filter((row) => row?.kind === "parse.source").length,
      chunkSets: blobs.filter((row) => row?.kind === "parse.chunks").length,
      snapshotRows: blobs.filter((row) => row?.kind === "intake.snapshot").length,
      consentRows: blobs.filter((row) => row?.kind === "ai.consent").length,
      invocationRows: blobs.filter((row) => row?.kind === "ai.invocation").length,
      grantedEvents: events.filter((event) => event.action === "consent.granted").length,
      revokedEvents: events.filter((event) => event.action === "consent.revoked").length,
      eventActions: events.map((event) => event.action),
    };
  };

  await send("Page.enable");
  await send("Runtime.enable");
  await send("DOM.enable");
  await send("Network.enable");

  try {
    let matterId = null;
    let assetId = null;

    await recordStep("01-ai-empty-no-matter", async () => {
      await go("/v6/ai");
      await waitFor(`document.querySelector("[data-testid=ai-panel][data-ai-state=empty]")`, "AI empty state");
      const state = await ai();
      assert(state.emptyReason === "no_matters", "the empty state explains that no matter exists", state);
      assert(state.currentMode?.includes("R1 本地浏览器版"), "the current mode is named", state);
      assert(state.releaseState === "closed", "the release gate is closed", state);
      const manual = await evaluate(`document.querySelector("[data-testid=ai-manual-writing]")?.textContent ?? null`);
      assert(manual?.includes("手工"), "the manual-writing entry is present", { manual });
      assert(state.grants.every((grant) => grant.disabled && grant.grantable === "false"), "no grant is possible", state.grants);
      return { state: state.state, emptyReason: state.emptyReason, manual };
    }, { shot });

    await recordStep("02-create-matter-and-upload", async () => {
      await go("/v6");
      await waitFor(`document.querySelector("[data-testid=entry-self]")`, "self-service entry");
      await evaluate(
        `[...document.querySelectorAll("[data-testid=entry-self] button")].find((button) => button.textContent.includes("创建案件")).click()`,
        { userGesture: true },
      );
      await waitFor(`document.querySelector("[data-testid=upload-input]")`, "upload panel");
      matterId = await evaluate("location.pathname.split('/')[4]");
      assert(/^[0-9a-f-]{36}$/.test(matterId), "a matter id is in the URL", { matterId });
      await setFiles("[data-testid=upload-input]", [fixturePath]);
      await waitFor(`!document.querySelector("[data-testid=upload-save]")?.disabled`, "upload save enabled");
      await click("[data-testid=upload-save]");
      await waitFor(`document.querySelector("[data-testid=upload-all-saved]")`, "upload saved");
      await waitFor(`document.querySelector("[data-testid^=parse-start-]")`, "parse start button");
      const summary = await dbSummary();
      assert(summary.assets.some((asset) => asset.name === FIXTURE_NAME && asset.purpose === "source"), "synthetic source asset saved", summary);
      assetId = summary.assets.find((asset) => asset.name === FIXTURE_NAME).id;
      return { matterId, assetId, upload: documentStatus(await evaluate("document.querySelector('[data-testid=upload-all-saved]')?.textContent")) };
    }, { shot });

    await recordStep("03-parse-synthetic-source", async () => {
      await click(`[data-testid="parse-start-${assetId}"]`);
      await waitFor(
        `document.querySelector("[data-testid=parse-status-${assetId}]")?.textContent?.includes("已解析")`,
        "parse finished",
        600,
      );
      const summary = await dbSummary();
      assert(summary.parseSources === 1, "one parse source row", summary);
      assert(summary.chunkSets === 1, "one chunk set row", summary);
      return {
        parseState: await evaluate(`document.querySelector("[data-testid=parse-status-${assetId}]")?.textContent ?? null`),
        parseDetail: await evaluate(`document.querySelector("[data-testid=parse-detail-${assetId}]")?.textContent ?? null`),
        parseSources: summary.parseSources,
        chunkSets: summary.chunkSets,
      };
    }, { shot });

    await recordStep("04-ai-ready", async () => {
      await go("/v6/ai");
      await waitFor(`document.querySelector("[data-testid=ai-panel][data-ai-state=ready]")`, "AI ready state");
      const state = await ai();
      const summary = await dbSummary();
      assert(state.releaseState === "closed" && state.releaseGate?.includes("RELEASE_GATE_CLOSED"), "release gate closed", state);
      assert(state.matter?.includes("案件：") && state.matterLink?.includes("返回案件页"), "matter context is shown", state);
      assert(state.manifest?.includes(FIXTURE_NAME), "the synthetic file is listed", state);
      assert(state.manifestHash?.match(/[0-9a-f]{64}/), "a deterministic manifest hash is shown", state);
      assert(state.profileCapabilities?.includes("结构化输出"), "profile capabilities are shown", state);
      assert(state.unknownRegion === "false" && state.unknownFieldText?.includes("未知"), "unknown fields say 未知", state);
      const good = state.grants.find((grant) => grant.id === GOOD_PROFILE_ID);
      const unknown = state.grants.find((grant) => grant.id === UNKNOWN_PROFILE_ID);
      assert(good?.grantable === "true" && good.disabled === false, "the complete platform profile can be confirmed", state.grants);
      assert(unknown?.grantable === "false" && unknown.disabled === true, "the incomplete profile cannot be confirmed", state.grants);
      assert(state.consentsEmpty && state.invocationsEmpty, "no consent or invocation is invented", state);
      assert(state.currentMode?.includes("本机模型与 BYOK 不可用"), "local and BYOK are honestly unavailable", state);
      assert(!state.hasPromptMarkers, "no prompt, case content or key marker is in the panel", state);
      assert(summary.parseSources === 1 && summary.chunkSets === 1, "parse rows are visible in storage", summary);
      return { matter: state.matter, manifest: state.manifest, manifestHash: state.manifestHash, profiles: state.grants };
    }, { shot });

    await recordStep("05-consent-granted", async () => {
      await click(`[data-testid="ai-grant-${GOOD_PROFILE_ID}"]`);
      await waitFor(`document.querySelector("[data-testid^=ai-revoke-]")`, "consent row after grant");
      await waitFor(
        `document.querySelector("[data-testid=ai-notice]")?.textContent?.includes("已保存外发授权")`,
        "grant notice",
      );
      const state = await ai();
      const summary = await dbSummary();
      assert(state.consents.length === 1, "one consent is listed", state.consents);
      assert(state.consents[0].text.includes("生效中"), "the consent is active", state.consents[0]);
      assert(state.consents[0].text.includes("Synthetic Processor A"), "the processor is named", state.consents[0]);
      assert(state.revokes.length === 1 && state.revokes[0].disabled === false, "revocation is offered", state.revokes);
      assert(summary.consentRows === 1 && summary.grantedEvents === 1, "one consent row and one granted event", summary);
      return { notice: state.notice, consent: state.consents[0], db: summary };
    }, { shot });

    await recordStep("06-consent-revoked", async () => {
      await click(`[data-testid="ai-revoke-${(await ai()).revokes[0].id}"]`);
      await waitFor(
        `document.querySelector("[data-testid=ai-notice]")?.textContent?.includes("已撤回授权")`,
        "revoke notice",
      );
      await waitFor(
        `document.querySelector("[data-testid^=ai-consent-]")?.textContent?.includes("已撤回")`,
        "revoked consent status",
      );
      const state = await ai();
      const summary = await dbSummary();
      assert(state.revokes.length === 1 && state.revokes[0].disabled === true, "the revoked consent cannot be revoked again", state.revokes);
      assert(summary.consentRows === 1 && summary.grantedEvents === 1 && summary.revokedEvents === 1, "history is kept once", summary);
      return { notice: state.notice, consent: state.consents[0], db: summary };
    }, { shot });

    await recordStep("07-ai-reload-persisted", async () => {
      await send("Page.reload");
      await sleep(900);
      await waitFor(`document.querySelector("[data-testid=ai-panel][data-ai-state=ready]")`, "AI ready after reload");
      const state = await ai();
      const summary = await dbSummary();
      assert(state.consents.length === 1 && state.consents[0].text.includes("已撤回"), "revocation persists after reload", state.consents);
      assert(summary.revokedEvents === 1 && summary.grantedEvents === 1, "no duplicate event after reload", summary);
      assert(state.invocations === 0, "no invocation row exists", state);
      return { consent: state.consents[0], invocations: state.invocations, db: summary };
    }, { shot });

    const allowedOrigins = new Set(["http://localhost:4178"]);
    const external = log.network.filter((url) => {
      try {
        const parsed = new URL(url);
        return !["data:", "blob:", "about:"].includes(parsed.protocol) && !allowedOrigins.has(parsed.origin);
      } catch {
        return false;
      }
    });
    log.steps.push({
      step: "08-no-external-network",
      ok: external.length === 0,
      notes: { external, totalRequests: log.network.length },
    });
    log.db = await dbSummary();
    assert(external.length === 0, "no request left the local preview server", external);
    assert(log.consoleErrors.length === 0, "no console errors", log.consoleErrors);
    log.ok = log.steps.every((step) => step.ok);
  } catch (error) {
    log.ok = false;
    log.failure = String(error);
  } finally {
    writeFileSync(join(outDir, "browser-log.json"), `${JSON.stringify(log, null, 2)}\n`);
    ws.close();
    chrome.kill("SIGKILL");
    await sleep(500);
    rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    rmSync(fixtures, { recursive: true, force: true });
  }

  console.log(JSON.stringify({ ok: log.ok, steps: log.steps.map((step) => ({ step: step.step, ok: step.ok })), failure: log.failure ?? null }, null, 2));
  process.exitCode = log.ok ? 0 : 1;
}

function documentStatus(node) {
  return node?.textContent?.trim() ?? null;
}

await main();
