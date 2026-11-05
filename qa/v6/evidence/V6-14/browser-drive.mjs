// Drives headless Chrome over CDP through the V6-14 targets panel.
// Usage: node browser-drive.mjs <outDir> <baseUrl>
//   e.g. node qa/v6/evidence/V6-14/browser-drive.mjs qa/v6/evidence/V6-14 http://localhost:4176/patent
//
// The temporary V6-14 mount (mount-patch.md) puts TargetsPanel on the matter
// 概览 tab. The app is the production build served by `vite preview` from this
// worktree on port 4176, and the run uses a throwaway Chrome profile.
//
// Fixtures are synthetic: the matter is created through the real start page
// (title, ids and time come from the app), and every target config is typed
// into the panel. No intake snapshot is written, so the recommendation runs on
// an empty fact set (fallback); the S03-A09 rule trace is covered by the
// UI-render and engine tests instead. Persisted state is read straight from
// IndexedDB, not through the app's modules. No model, key, real material or
// external network is used.
//
// EP: the route select only lists the four supported routes. To prove the
// engine refusal end to end, the run appends a synthetic `<option value="EP">`
// to the update form's select (a forged client value), saves, and requires
// INVALID_INPUT with the EP copy and an unchanged store.
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const WARNING = "中文准备稿，需翻译并由适格人员核对，不能直接作为该法域申请文件";
const EP_MESSAGE = "EP 不是可生成的目标路线";

const [outDirArg, base] = process.argv.slice(2);
if (!outDirArg || !base) throw new Error("usage: node browser-drive.mjs <outDir> <baseUrl>");
const outDir = resolve(outDirArg);

const log = { base, matterId: null, steps: [], consoleErrors: [], network: [], nonLocalRequests: [], screenshots: [] };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function assert(condition, message, current) {
  if (!condition) throw new Error(`${message} :: ${JSON.stringify(current)}`);
}

async function main() {
  const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  const profile = mkdtempSync(join(tmpdir(), "v6-14-profile-"));
  const port = 9346;
  const chrome = spawn(
    CHROME,
    [
      "--headless=new",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--window-size=1280,2200",
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
      log.consoleErrors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
    }
    if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") {
      log.consoleErrors.push(message.params.args.map((arg) => arg.value ?? arg.description).join(" "));
    }
    if (message.method === "Log.entryAdded" && message.params.entry.level === "error") {
      log.consoleErrors.push(`${message.params.entry.source}: ${message.params.entry.text}`);
    }
    if (message.method === "Network.requestWillBeSent") {
      const url = message.params.request.url;
      log.network.push(url);
      if (!/^(https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/|data:|blob:)/.test(url)) log.nonLocalRequests.push(url);
    }
  });
  const send = (method, params = {}) =>
    new Promise((resolvePromise, reject) => {
      const n = ++id;
      pending.set(n, (message) => (message.error ? reject(new Error(JSON.stringify(message.error))) : resolvePromise(message.result)));
      ws.send(JSON.stringify({ id: n, method, params }));
    });
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
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
    const file = `${name}.png`;
    writeFileSync(join(outDir, file), Buffer.from(data, "base64"));
    log.screenshots.push(file);
  };
  const q = (testid) => `document.querySelector(${JSON.stringify(`[data-testid="${testid}"]`)})`;
  const text = (testid) => evaluate(`${q(testid)}?.textContent ?? null`);
  const click = async (testid) => {
    const ok = await evaluate(`(() => { const el = ${q(testid)}; if (!el || el.disabled) return false; el.click(); return true; })()`);
    if (!ok) throw new Error(`cannot click ${testid}`);
  };
  /** React-controlled select: set through the native setter, then fire change. */
  const choose = (testid, value) =>
    evaluate(`(() => {
      const el = ${q(testid)};
      if (!el) throw new Error("no select ${testid}");
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return el.value;
    })()`);
  const panel = () =>
    evaluate(`(() => {
      const root = document.querySelector("[data-testid=targets]");
      const t = (id) => document.querySelector('[data-testid="' + id + '"]')?.textContent ?? null;
      const err = document.querySelector("[data-testid=targets-action-error]");
      return {
        state: root?.dataset.state ?? null,
        matterVersion: root?.dataset.matterVersion ?? null,
        empty: t("targets-empty"),
        switches: [...document.querySelectorAll("[data-testid^=targets-switch-]")].map((b) => ({
          id: b.dataset.testid.slice("targets-switch-".length),
          version: b.dataset.targetVersion,
          active: b.classList.contains("active"),
          text: b.textContent,
        })),
        selected: document.querySelector("[data-testid=targets-selected]")?.dataset.targetId ?? null,
        selectedVersion: t("targets-selected-version"),
        selectedConfig: t("targets-selected-config"),
        notice: t("targets-notice"),
        actionError: err ? { code: err.dataset.code ?? null, text: err.textContent } : null,
        createDisabledReason: t("targets-create-disabled-reason"),
        createSaveDisabled: document.querySelector("[data-testid=targets-create-save]")?.disabled ?? null,
        fallback: document.querySelector("[data-testid=targets-recommendation]")?.dataset.fallback ?? null,
      };
    })()`);
  const dbState = () =>
    evaluate(`new Promise((resolve, reject) => {
      const open = indexedDB.open("patent.v6.local");
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction(["matters", "events", "blobs"], "readonly");
        const all = (store) => new Promise((res, rej) => {
          const req = tx.objectStore(store).getAll();
          req.onsuccess = () => res(req.result);
          req.onerror = () => rej(req.error);
        });
        const get = new Promise((res, rej) => {
          const req = tx.objectStore("matters").get(${JSON.stringify(log.matterId)});
          req.onsuccess = () => res(req.result ?? null);
          req.onerror = () => rej(req.error);
        });
        Promise.all([get, all("events"), all("blobs")]).then(([aggregate, events, blobs]) => {
          db.close();
          const mid = ${JSON.stringify(log.matterId)};
          const mine = (v) => v && v.matterId === mid;
          const targetEvents = events.filter((e) => mine(e) && typeof e.action === "string" && e.action.startsWith("target."));
          const configs = blobs.filter((v) => mine(v) && v.kind === "target.config");
          resolve({
            matterVersion: aggregate?.matter?.version ?? null,
            targets: (aggregate?.targets ?? []).map((t) => ({ id: t.id, status: t.status, configVersion: t.configVersion })),
            eventCount: events.filter(mine).length,
            targetEvents: targetEvents.map((e) => ({ action: e.action, targetId: e.targetId ?? e.metadata?.targetId ?? null, keys: Object.keys(e).sort() })),
            configRows: configs.map((c) => ({ targetId: c.targetId, route: c.config.route, language: c.config.language, version: c.config.version ?? null })),
            idempotency: blobs.filter((v) => v && v.kind === "targets.idempotency").map((v) => v.state),
          });
        }, reject);
      };
    })`);

  const step = async (name, fn) => {
    try {
      const notes = await fn();
      log.steps.push({ step: name, ok: true, notes: notes ?? null });
      await shot(name);
    } catch (error) {
      log.steps.push({ step: name, ok: false, error: String(error), panel: await panel().catch(() => null) });
      await shot(name).catch(() => {});
    }
  };

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Network.enable");
  await send("Log.enable");

  let a = null;
  let b = null;

  await step("01-empty-state", async () => {
    await send("Page.navigate", { url: `${base}/v6` });
    await waitFor(`document.querySelector("[data-testid=entry-self] button")`, "start page");
    await evaluate(`[...document.querySelectorAll("[data-testid=entry-self] button")].find((x) => x.textContent.includes("创建案件")).click()`);
    await waitFor(`location.pathname.split("/").length > 4`, "matter route after create");
    log.matterId = await evaluate(`location.pathname.split("/")[4]`);
    assert(/^[0-9a-f-]{36}$/.test(log.matterId), "matter id from the URL", log.matterId);
    await send("Page.navigate", { url: `${base}/v6/matters/${log.matterId}/overview` });
    await waitFor(`document.querySelector("[data-testid=targets][data-state=ready]")`, "targets panel ready");
    const p = await panel();
    const db = await dbState();
    assert(p.empty && p.empty.includes("本案还没有目标"), "empty copy", p);
    assert(p.switches.length === 0 && p.selected === null, "no switcher and no selection", p);
    assert(db.targets.length === 0 && db.targetEvents.length === 0 && db.configRows.length === 0, "nothing stored", db);
    assert(p.fallback === "true", "no snapshot facts: the trace says no rule fired", p);
    return { panel: p, db };
  });

  await step("02-create-target-a-cn_invention", async () => {
    const before = await dbState();
    await choose("targets-create-route", "cn_invention");
    await click("targets-create-save");
    await waitFor(`document.querySelectorAll("[data-testid^=targets-switch-]").length === 1`, "one target");
    const p = await panel();
    const db = await dbState();
    a = p.switches[0].id;
    assert(p.switches[0].version === "1" && p.selected === a, "A is v1 and selected", p);
    assert((p.selectedConfig ?? "").includes("中国发明"), "A shows its route", p);
    assert(db.matterVersion === before.matterVersion + 1, "one matter version", { before, db });
    assert(db.targets.length === 1 && db.targets[0].configVersion === 1, "one target at v1", db);
    assert(db.targetEvents.length === 1 && db.targetEvents[0].action === "target.created", "one target.created event", db);
    assert(db.configRows.length === 1 && db.configRows[0].route === "cn_invention", "one config row", db);
    return { a, panel: p, db };
  });

  await step("03-create-target-b-pct", async () => {
    const before = await dbState();
    await choose("targets-create-route", "pct");
    const language = await evaluate(`document.querySelector('[data-testid="targets-create-language"] input:checked')?.value ?? null`);
    assert(language === "zh-CN", "PCT defaults to zh-CN", language);
    await click("targets-create-save");
    await waitFor(`document.querySelectorAll("[data-testid^=targets-switch-]").length === 2`, "two targets");
    const p = await panel();
    const db = await dbState();
    b = p.switches.find((s) => s.id !== a).id;
    assert(p.selected === b, "B is selected after create", p);
    assert(db.matterVersion === before.matterVersion + 1, "one matter version", { before, db });
    assert(db.targets.length === 2, "two targets", db);
    assert(db.targets.find((t) => t.id === a).configVersion === 1, "A unchanged at v1", db);
    assert(p.createSaveDisabled === false && p.createDisabledReason === null, "create stays available after two targets", p);
    return { b, language, panel: p, db };
  });

  await step("04-switch-no-version-bump", async () => {
    const before = await dbState();
    await click(`targets-switch-${a}`);
    await waitFor(`${q("targets-selected")}?.dataset.targetId === ${JSON.stringify(a)}`, "A selected");
    const onA = await panel();
    const hashA = await evaluate("location.hash");
    await click(`targets-switch-${b}`);
    await waitFor(`${q("targets-selected")}?.dataset.targetId === ${JSON.stringify(b)}`, "B selected");
    const onB = await panel();
    await click(`targets-switch-${a}`);
    await waitFor(`${q("targets-selected")}?.dataset.targetId === ${JSON.stringify(a)}`, "A selected again");
    await sleep(400);
    const after = await dbState();
    assert(JSON.stringify(after) === JSON.stringify(before), "switching wrote nothing (same versions, events, rows)", { before, after });
    assert((onA.selectedConfig ?? "").includes("中国发明") && (onB.selectedConfig ?? "").includes("PCT"), "each selection shows its own config", { onA, onB });
    assert(hashA === `#target=${a}`, "the selection is in the URL hash", hashA);
    const chip = await evaluate(`(() => {
      const el = ${q(`targets-switch-${a}`)};
      const s = getComputedStyle(el);
      return { active: el.classList.contains("active"), color: s.color, background: s.backgroundColor, text: el.textContent };
    })()`);
    assert(chip.active && chip.color !== chip.background, "the active chip's label is readable (text colour differs from its background)", chip);
    return { hashA, chip, matterVersion: after.matterVersion, versions: after.targets };
  });

  await step("05-update-a-b-unchanged", async () => {
    const before = await dbState();
    const bRowBefore = JSON.stringify(before.configRows.filter((r) => r.targetId === b));
    await choose("targets-update-route", "cn_um");
    await click("targets-update-save");
    await waitFor(`${q(`targets-switch-${a}`)}?.dataset.targetVersion === "2"`, "A at v2");
    const p = await panel();
    const db = await dbState();
    const tA = db.targets.find((t) => t.id === a);
    const tB = db.targets.find((t) => t.id === b);
    assert(tA.configVersion === 2 && tB.configVersion === 1, "only A's configVersion moved", db);
    assert(db.matterVersion === before.matterVersion + 1, "matter version moved once", { before, db });
    const updates = db.targetEvents.filter((e) => e.action === "target.config_updated");
    assert(updates.length === 1, "one target.config_updated event", db);
    assert(JSON.stringify(db.configRows.filter((r) => r.targetId === b)) === bRowBefore, "B's config rows are unchanged", db);
    assert(p.switches.find((s) => s.id === b).version === "1", "B shows v1", p);
    assert((p.notice ?? "").includes("其他目标没有变化"), "save notice", p);
    return { panel: p, db, updateEventKeys: updates[0].keys };
  });

  await step("06-ep-refused", async () => {
    const before = await dbState();
    await evaluate(`(() => {
      const el = ${q("targets-update-route")};
      const option = document.createElement("option");
      option.value = "EP";
      option.textContent = "EP（合成伪造值）";
      el.appendChild(option);
      return true;
    })()`);
    const chosen = await choose("targets-update-route", "EP");
    assert(chosen === "EP", "forged EP value selected", chosen);
    await click("targets-update-save");
    await waitFor(`${q("targets-action-error")}`, "action error");
    const p = await panel();
    await sleep(400);
    const after = await dbState();
    assert(p.actionError.code === "INVALID_INPUT", "INVALID_INPUT", p);
    assert(p.actionError.text.includes(EP_MESSAGE), "the EP copy is shown", p);
    assert(JSON.stringify(after) === JSON.stringify(before), "nothing written", { before, after });
    return { actionError: p.actionError, db: after };
  });

  await step("07-us-pct-warning", async () => {
    const us = await text("targets-foreign-warning-us_nonprovisional");
    const pct = await text("targets-foreign-warning-pct");
    const um = await text("targets-foreign-warning-cn_um");
    const inv = await text("targets-foreign-warning-cn_invention");
    assert(us === WARNING && pct === WARNING, "US and PCT cards carry the exact sentence", { us, pct });
    assert(um === null && inv === null, "CN cards carry no foreign warning", { um, inv });
    const unverified = await evaluate(`["cn_um","cn_invention","us_nonprovisional","pct"].map((r) => [r, ["cycle","fee","term"].map((s) => document.querySelector('[data-testid="targets-' + s + '-' + r + '"]')?.textContent)])`);
    assert(unverified.every(([, values]) => values.every((v) => v === "未核实")), "numbers show 未核实", unverified);
    await evaluate(`${q("targets-card-pct")}.scrollIntoView()`);
    return { us, pct, unverified };
  });

  await step("08-en-us-disabled-reason", async () => {
    await click(`targets-switch-${b}`);
    await waitFor(`${q("targets-selected")}?.dataset.targetId === ${JSON.stringify(b)}`, "B selected");
    const result = await evaluate(`(() => {
      const label = document.querySelector('[data-testid="targets-update-language-en-US"]');
      const input = label?.querySelector("input");
      return {
        present: !!label,
        disabled: input?.disabled ?? null,
        reason: document.querySelector('[data-testid="targets-update-language-reason-en-US"]')?.textContent ?? null,
        attrReason: input?.dataset.disabledReason ?? null,
        zhChecked: document.querySelector('[data-testid="targets-update-language-zh-CN"] input')?.checked ?? null,
        createReason: document.querySelector('[data-testid="targets-create-language-reason-en-US"]')?.textContent ?? null,
      };
    })()`);
    assert(result.present && result.disabled === true, "en-US is disabled on the PCT target", result);
    assert(result.reason && result.reason.length > 0 && result.reason === result.attrReason, "the reason is visible", result);
    assert(result.zhChecked === true, "zh-CN stays selected", result);
    await evaluate(`${q("targets-update-language-en-US")}.scrollIntoView()`);
    return result;
  });

  log.finalDb = await dbState().catch(() => null);
  log.finalPanel = await panel().catch(() => null);
  ws.close();
  chrome.kill();
  await sleep(500);
  rmSync(profile, { recursive: true, force: true });
  log.profileRemoved = true;
  writeFileSync(join(outDir, "browser-log.json"), `${JSON.stringify(log, null, 2)}\n`);
  const ok = log.steps.length === 8 && log.steps.every((s) => s.ok) && log.consoleErrors.length === 0 && log.nonLocalRequests.length === 0;
  console.log(JSON.stringify({ ok, passed: log.steps.filter((s) => s.ok).length, failed: log.steps.filter((s) => !s.ok), consoleErrors: log.consoleErrors, nonLocalRequests: log.nonLocalRequests, requests: log.network.length }, null, 2));
  process.exitCode = ok ? 0 : 1;
}

await main();
