// Drives headless Chrome over CDP through the V6-13 intake surface (S03,
// ticket V6-13). Usage:
//   node browser-drive.mjs <outDir> [baseUrl]
//   e.g. node browser-drive.mjs qa/v6/evidence/V6-13 http://localhost:4177/patent
//
// Run against the production build (`vite preview`), because this worktree's
// node_modules is a symlink outside the project root. This build carries the
// temporary Intake mount documented in mount-patch.md; the mount is reverted
// after the run.
//
// Every byte is synthetic: the one fixture under qa/v6/scenarios/V6-13 is
// uploaded through the real V6-10 upload path and parsed by the real V6-11
// parser. No network call, no model call, no customer material.
//
// Two things cannot be done through V6-13's UI because the ticket's write set
// has no surface for them; both are written straight to IndexedDB, outside the
// app's modules, exactly as the V6-11 driver reads engine state:
//   - a matter target (targets are created by a later ticket), and
//   - one draft input binding (there is no drafting feature yet; this is the
//     seam `bindDraftInput` writes and `readIntake` reads).
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../../../..");
const FIXTURE = resolve(ROOT, "qa/v6/scenarios/V6-13/fixtures/intake-source.txt");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const outDir = resolve(process.argv[2] ?? HERE);
const base = process.argv[3] ?? "http://localhost:4177/patent";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PROBLEM = "现有换热装置在低温环境下效率低，运行成本高。";
const DIFFERENCE = "改进了流道结构，降低了流动阻力。";
const PERSON = "王工";
const FACT_WITH_SOURCE = "样机在低温环境下的运行成本明显低于现有装置。";
const FACT_CONFLICTING = "用户口头说明：装置已经小批量出货。";
const OTHER_TAB_PROBLEM = "另一个标签页保存的问题：低温下效率低。";
const THIS_TAB_PROBLEM = "本标签页尚未保存的问题：运行成本高。";
const CONFLICT_REASON = "材料只支持样机验证，出货说法来自口头转述，两者尚未核实。";

function connect(wsUrl, state) {
  return new Promise((resolvePromise, rejectPromise) => {
    const socket = new WebSocket(wsUrl);
    socket.addEventListener("error", rejectPromise, { once: true });
    socket.addEventListener("open", () => {
      let id = 0;
      const pending = new Map();
      socket.addEventListener("message", (event) => {
        const message = JSON.parse(event.data);
        if (message.id && pending.has(message.id)) {
          const settle = pending.get(message.id);
          pending.delete(message.id);
          settle(message);
          return;
        }
        if (message.method === "Runtime.consoleAPICalled") {
          const text = (message.params.args ?? [])
            .map((arg) => arg.value ?? arg.description ?? arg.unserializableValue ?? "")
            .join(" ");
          if (message.params.type === "error" || message.params.type === "assert") {
            state.consoleErrors.push({ kind: "console", type: message.params.type, text });
          } else {
            state.consoleLogs.push({ type: message.params.type, text });
          }
        }
        if (message.method === "Runtime.exceptionThrown") {
          state.consoleErrors.push({
            kind: "exception",
            text: message.params.exceptionDetails?.exception?.description ?? message.params.exceptionDetails?.text ?? "",
          });
        }
        if (message.method === "Log.entryAdded" && message.params.entry.level === "error") {
          state.consoleErrors.push({ kind: "log", text: message.params.entry.text ?? "" });
        }
      });
      const send = (method, params = {}) =>
        new Promise((resolveSend, rejectSend) => {
          const n = ++id;
          const timer = setTimeout(() => {
            pending.delete(n);
            rejectSend(new Error(`CDP ${method} did not answer within 60s`));
          }, 60_000);
          pending.set(n, (m) => {
            clearTimeout(timer);
            if (m.error) rejectSend(new Error(JSON.stringify(m.error)));
            else resolveSend(m.result);
          });
          socket.send(JSON.stringify({ id: n, method, params }));
        });
      resolvePromise({ socket, send });
    });
  });
}

const state = { consoleErrors: [], consoleLogs: [], steps: [] };

function step(name, fn) {
  return async () => {
    try {
      const notes = await fn();
      state.steps.push({ step: name, ok: true, ...(notes ? { notes } : {}) });
    } catch (error) {
      state.steps.push({ step: name, ok: false, error: String(error) });
      throw error;
    }
  };
}

function assert(condition, message, detail) {
  if (!condition) throw new Error(`${message} :: ${JSON.stringify(detail)}`);
}

const profile = mkdtempSync(join(tmpdir(), "v6-13-chrome-"));
const port = 9339;
const chrome = spawn(
  CHROME,
  [
    "--headless=new",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-popup-blocking",
    "--window-size=1280,1800",
    "about:blank",
  ],
  { stdio: "ignore" },
);

let targets = [];
for (let i = 0; i < 80; i += 1) {
  try {
    targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
    if (targets.some((target) => target.type === "page")) break;
  } catch {}
  await sleep(200);
}
const page = targets.find((target) => target.type === "page");
if (!page) throw new Error("headless Chrome never exposed a page target");
const cdp = await connect(page.webSocketDebuggerUrl, state);
const { send } = cdp;
await send("Runtime.enable");
await send("Log.enable");
await send("Page.enable");
await send("DOM.enable");

const evaluate = async (expression) => {
  const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  }
  return result.result.value;
};
const waitFor = async (expression, label, tries = 300) => {
  for (let i = 0; i < tries; i += 1) {
    if (await evaluate(`!!(${expression})`)) return;
    await sleep(120);
  }
  throw new Error(`timeout waiting for ${label}`);
};
const text = (testid) => evaluate(`document.querySelector("[data-testid='${testid}']")?.textContent ?? null`);
const attr = (testid, name) => evaluate(`document.querySelector("[data-testid='${testid}']")?.getAttribute(${JSON.stringify(name)}) ?? null`);
const count = (selector) => evaluate(`document.querySelectorAll(${JSON.stringify(selector)}).length`);
const shot = async (name) => {
  const { data } = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
  writeFileSync(join(outDir, `${name}.png`), Buffer.from(data, "base64"));
};
const go = async (path) => {
  await send("Page.navigate", { url: base + path });
  await sleep(500);
};
const reload = async () => {
  await send("Page.reload");
  await sleep(700);
};

/**
 * React tracks a value on the DOM node. Setting through the prototype setter and
 * dispatching `change` is what a person's keystroke ends up doing to the root.
 */
const fill = async (testid, value) =>
  evaluate(`(() => {
    const el = document.querySelector("[data-testid='${testid}']");
    if (!el) return false;
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype
      : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`);

/** Pick a select option whose visible text contains `fragment`. */
const selectByText = async (testid, fragment) => {
  const value = await evaluate(`(() => {
    const el = document.querySelector("[data-testid='${testid}']");
    if (!el) return null;
    const option = [...el.options].find((item) => item.textContent.includes(${JSON.stringify(fragment)}));
    return option ? option.value : null;
  })()`);
  assert(value !== null, `${testid} has an option containing ${fragment}`);
  await fill(testid, value);
  return value;
};

/** A real mouse press at the element's centre. */
const click = async (selector) => {
  const box = await evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return null;
    el.scrollIntoView({ block: "center" });
    const rect = el.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, disabled: !!el.disabled };
  })()`);
  assert(box, `${selector} exists`);
  assert(!box.disabled, `${selector} is enabled`);
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: box.x, y: box.y, button: "left", clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: box.x, y: box.y, button: "left", clickCount: 1 });
  await sleep(150);
};
const clickTestId = async (testid) => click(`[data-testid='${testid}']`);
const visibility = (testid) => evaluate(`(() => { const el = document.querySelector("[data-testid='${testid}']"); return !!el && el.offsetParent !== null; })()`);

const waitSaved = async (version, label) => {
  await waitFor(`document.querySelector("[data-testid=intake][data-version='${version}']")`, `${label}: version ${version}`);
  await waitFor(`document.querySelector("[data-testid=intake-save-status]")`, `${label}: save status`);
  const message = await text("intake-save-status");
  assert(/已保存为第 \d+ 版|没有变化/.test(message ?? ""), `${label}: saved message`, message);
  return message;
};

const factRowIds = () =>
  evaluate(`[...document.querySelectorAll("[data-testid^='intake-fact-']")]
    .map((el) => el.getAttribute("data-testid"))
    .filter((id) => /^intake-fact-[0-9a-f-]{36}$/.test(id))
    .map((id) => id.slice("intake-fact-".length))`);

const matterIdFromPath = () => evaluate(`location.pathname.match(/matters\\/([^/]+)/)?.[1] ?? null`);

/** Read the V6-13 fixture chunk that contains `fragment`, straight from IndexedDB. */
const chunkContaining = (fragment) =>
  evaluate(`new Promise((resolve, reject) => {
    const open = indexedDB.open("patent.v6.local");
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const out = [];
      const request = db.transaction(["blobs"], "readonly").objectStore("blobs")
        .openCursor(IDBKeyRange.bound("parse/", "parse/\\uffff"));
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          if (cursor.value?.kind === "parse.chunks") out.push(...cursor.value.chunks);
          cursor.continue();
        } else { db.close(); resolve(out); }
      };
      request.onerror = () => reject(request.error);
    };
  })`).then((chunks) => {
    const chunk = chunks.find((item) => item.text.includes(fragment));
    assert(chunk, `a parsed chunk contains ${fragment}`, chunks.map((item) => item.text));
    return chunk;
  });

const patchTargetAndDraft = (matterId, targetId, figureRevisionId) =>
  evaluate(`new Promise((resolve, reject) => {
    const open = indexedDB.open("patent.v6.local");
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      try {
        const tx = db.transaction(["matters", "blobs"], "readwrite");
        tx.oncomplete = () => { db.close(); resolve({ sourceVersion: sourceVersionRead }); };
        tx.onerror = () => { db.close(); reject(tx.error); };
        tx.onabort = () => { db.close(); reject(tx.error ?? new Error("injection aborted")); };
        const matters = tx.objectStore("matters");
        const blobs = tx.objectStore("blobs");
        let sourceVersionRead = null;
        const get = matters.get(${JSON.stringify(matterId)});
        get.onerror = () => reject(get.error);
        get.onsuccess = () => {
          try {
            const aggregate = get.result;
            if (!aggregate) throw new Error("matter aggregate missing");
            sourceVersionRead = aggregate.matter.sourceVersion;
            const matter = { ...aggregate.matter, version: aggregate.matter.version + 1, updatedAt: new Date().toISOString() };
            const target = {
              id: ${JSON.stringify(targetId)},
              matterId: ${JSON.stringify(matterId)},
              status: "active",
              configVersion: 1,
              draftRevisionId: null,
              figureRevisionId: ${JSON.stringify(figureRevisionId)},
            };
            // The matters store is out-of-line: the key is the matter id.
            matters.put({ ...aggregate, matter, targets: [...aggregate.targets, target] }, ${JSON.stringify(matterId)});
            blobs.put(
              { kind: "intake.drafts", matterId: ${JSON.stringify(matterId)},
                bindings: [{ targetId: ${JSON.stringify(targetId)},
                  input: { matterId: ${JSON.stringify(matterId)}, targetId: ${JSON.stringify(targetId)},
                    sourceVersion: aggregate.matter.sourceVersion, targetConfigVersion: 1,
                    figureRevisionId: ${JSON.stringify(figureRevisionId)} },
                  boundAt: new Date().toISOString() }] },
              "intake/drafts/" + ${JSON.stringify(matterId)},
            );
          } catch (error) {
            reject(error);
            try { tx.abort(); } catch {}
          }
        };
      } catch (error) {
        reject(error);
      }
    };
  })`);

const readSnapshotState = (matterId) =>
  evaluate(`new Promise((resolve, reject) => {
    const open = indexedDB.open("patent.v6.local");
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const out = { snapshots: [], drafts: null };
      const request = db.transaction(["blobs"], "readonly").objectStore("blobs")
        .openCursor(IDBKeyRange.bound("intake/", "intake/\\uffff"));
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          if (cursor.key.startsWith("intake/snapshot/")) out.snapshots.push({ key: cursor.key, snapshot: cursor.value?.snapshot ?? null });
          if (cursor.key === "intake/drafts/" + ${JSON.stringify(matterId)}) out.drafts = cursor.value;
          cursor.continue();
        } else { db.close(); resolve(out); }
      };
      request.onerror = () => reject(request.error);
    };
  })`);

// Fix round 1 (B1): leave the store exactly as a post-commit snapshot failure
// does — the matter row and its event at version N, no snapshot blob for N.
const dropSnapshot = (matterId, version) =>
  evaluate(`new Promise((resolve, reject) => {
    const open = indexedDB.open("patent.v6.local");
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction(["blobs"], "readwrite");
      tx.oncomplete = () => { db.close(); resolve(true); };
      tx.onerror = () => { db.close(); reject(tx.error); };
      tx.objectStore("blobs").delete("intake/snapshot/" + ${JSON.stringify(matterId)} + "/" + ${JSON.stringify(String(version))});
    };
  })`);

let matterId = null;

try {
  await step("01 start page and empty database", async () => {
    await go("/v6");
    await waitFor(`document.querySelector("[data-testid=entry-self]")`, "start page");
    const emptyView = await evaluate(`document.querySelector("[data-testid=matters-empty]") !== null || location.pathname.endsWith("/v6")`);
    assert(emptyView, "a fresh profile shows the start page");
    await shot("01-start-empty");
    return { path: await evaluate("location.pathname"), matches: await count("[data-testid=entry-self]") };
  })();

  await step("02 create a matter", async () => {
    await click(`[data-testid='entry-self'] button`);
    await waitFor(`location.pathname.includes("/matters/")`, "matter route after creation");
    matterId = await matterIdFromPath();
    assert(matterId, "the matter id is in the path", await evaluate("location.pathname"));
    return { matterId, path: await evaluate("location.pathname") };
  })();

  await step("03 upload and parse the synthetic material", async () => {
    await go(`/v6/matters/${matterId}/upload`);
    await waitFor(`document.querySelector("[data-testid=upload-input]")`, "upload input");
    const { root } = await send("DOM.getDocument", { depth: -1 });
    const { nodeId } = await send("DOM.querySelector", { nodeId: root.nodeId, selector: "[data-testid=upload-input]" });
    assert(nodeId, "upload input node");
    await send("DOM.setFileInputFiles", { nodeId, files: [FIXTURE] });
    await waitFor(`document.querySelectorAll("[data-testid^=upload-row-]").length > 0`, "upload row");
    await clickTestId("upload-save");
    await waitFor(
      `[...document.querySelectorAll("[data-testid^=upload-row-]")].some((row) => row.dataset.saved === "true")`,
      "upload saved",
      500,
    );
    await waitFor(`document.querySelector("[data-testid^=parse-start-]")`, "parse start button");
    await click(`[data-testid^='parse-start-']`);
    await waitFor(`document.querySelector("[data-testid^=parse-row-]")?.getAttribute("data-state") === "parsed"`, "parse finished", 600);
    await shot("02-material-parsed");
    return {
      rows: await evaluate(`[...document.querySelectorAll("[data-testid^=parse-row-]")].map((row) => ({
        state: row.getAttribute("data-state"), text: row.textContent.slice(0, 80) }))`),
    };
  })();

  await step("04 facts tab: empty intake, five questions, no inferred history or maturity", async () => {
    await go(`/v6/matters/${matterId}/facts`);
    await waitFor(`document.querySelector("[data-testid=intake][data-state]")`, "intake panel");
    assert((await attr("intake", "data-state")) === "empty", "first view is the empty state", await attr("intake", "data-state"));
    assert(await visibility("intake-empty"), "empty notice is visible");
    assert((await count("[data-testid^=intake-question-]")) === 5, "five questions");
    const completeness = await text("intake-completeness");
    assert(/0\/5/.test(completeness ?? ""), "completeness starts at 0/5", completeness);
    const disclosure = await evaluate(`document.querySelector("[data-testid=intake-answer-disclosure]").value`);
    const maturity = await evaluate(`document.querySelector("[data-testid=intake-answer-maturity]").value`);
    assert(disclosure === "", "disclosure is not preselected", disclosure);
    assert(maturity === "", "maturity is not preselected", maturity);
    const suggestion = await evaluate(`(() => {
      const el = document.querySelector("[data-testid=intake-source-disclosure]");
      const option = [...el.options].find((item) => item.value.startsWith("suggest:"));
      return option ? option.textContent : null;
    })()`);
    assert(suggestion && /客户/.test(suggestion), "material mentioning 客户 is offered beside question 4, not chosen", suggestion);
    await shot("03-intake-empty");
    return { completeness, disclosure, maturity, suggestion };
  })();

  await step("05 save an answer with its source and an inventor", async () => {
    await fill("intake-answer-problem", PROBLEM);
    const problemSource = await selectByText("intake-source-problem", "问题：现有换热装置在低温环境下效率低");
    await fill("intake-answer-difference", DIFFERENCE);
    await selectByText("intake-source-difference", "用户直接回答");
    await fill("intake-party-name", PERSON);
    await clickTestId("intake-party-add");
    await waitFor(`[...document.querySelectorAll("[data-testid^='intake-party-']")].some((el) => /^intake-party-[0-9a-f-]{36}$/.test(el.getAttribute("data-testid")))`, "party row");
    const partyId = await evaluate(`(() => {
      const row = [...document.querySelectorAll("[data-testid^='intake-party-']")]
        .find((el) => /^intake-party-[0-9a-f-]{36}$/.test(el.getAttribute("data-testid")));
      return row ? row.getAttribute("data-testid").slice("intake-party-".length) : null;
    })()`);
    assert(partyId, "the added party has an id");
    await click(`[data-testid='intake-inventor-${partyId}']`);
    await selectByText("intake-source-inventorIds", "用户直接回答");
    await clickTestId("intake-save");
    const message = await waitSaved(2, "first save");
    const provenance = await text("intake-provenance-problem");
    assert(/第 1 版事实/.test(provenance ?? ""), "provenance names the fact version the answer was based on", provenance);
    const quote = await text("intake-source-quote-problem");
    assert(/现有换热装置/.test(quote ?? ""), "the cited paragraph is shown", quote);
    await shot("04-answer-saved-with-source");
    return { message, problemSource, provenance, quote };
  })();

  await step("06 explicit public-history and maturity choice, saved with its own source", async () => {
    await fill("intake-answer-disclosure", "private_showing");
    await fill("intake-disclosure-date", "2026-03-15");
    await fill("intake-disclosure-audience", "客户样机评审会");
    await fill("intake-disclosure-confidentiality", "yes");
    await selectByText("intake-source-disclosure", "用户直接回答");
    await fill("intake-answer-maturity", "tested_sample");
    const maturitySource = await selectByText("intake-source-maturity", "成熟度：目前已有测试样品");
    await clickTestId("intake-save");
    const message = await waitSaved(3, "second save");
    const view = await evaluate(`({
      disclosure: document.querySelector("[data-testid=intake-answer-disclosure]").value,
      maturity: document.querySelector("[data-testid=intake-answer-maturity]").value,
      detail: document.querySelector("[data-testid=intake-disclosure-audience]").value,
      confidentiality: document.querySelector("[data-testid=intake-disclosure-confidentiality]").value,
      disclosureProvenance: document.querySelector("[data-testid=intake-provenance-disclosure]")?.textContent ?? null,
    })`);
    assert(view.disclosure === "private_showing" && view.maturity === "tested_sample", "both choices are exactly the explicit ones", view);
    await shot("05-explicit-choice-saved");
    return { message, maturitySource, view };
  })();

  await step("07 two conflicting answers are both preserved and locatable", async () => {
    const chunk = await chunkContaining("现有换热装置");
    await fill("intake-fact-statement", FACT_WITH_SOURCE);
    await fill("intake-fact-kind", "parameter");
    await fill("intake-fact-status", "source_backed");
    await fill("intake-fact-chunk", chunk.id);
    await clickTestId("intake-fact-add");
    await waitFor(`([...document.querySelectorAll("[data-testid^='intake-fact-']")].filter((el) => /^intake-fact-[0-9a-f-]{36}$/.test(el.getAttribute("data-testid"))).length) === 1`, "first fact row");
    await fill("intake-fact-statement", FACT_CONFLICTING);
    await fill("intake-fact-kind", "parameter");
    await fill("intake-fact-status", "user_confirmed");
    await clickTestId("intake-fact-add");
    await waitFor(`([...document.querySelectorAll("[data-testid^='intake-fact-']")].filter((el) => /^intake-fact-[0-9a-f-]{36}$/.test(el.getAttribute("data-testid"))).length) === 2`, "second fact row");

    const factIds = await factRowIds();
    assert(factIds.length === 2, "exactly the two new facts", factIds);
    for (const id of factIds) await click(`[data-testid='intake-conflict-new-check-${id}']`);
    await clickTestId("intake-conflict-add");
    await waitFor(`document.querySelector("[data-testid^='intake-conflict-'][data-state]")`, "conflict row");
    const conflictId = await evaluate(`document.querySelector("[data-testid^='intake-conflict-'][data-state]").getAttribute("data-testid").slice("intake-conflict-".length)`);
    await fill(`intake-conflict-state-${conflictId}`, "retained");
    await waitFor(`document.querySelector("[data-testid='intake-conflict-reason-${conflictId}']")`, "conflict reason input");
    await fill(`intake-conflict-reason-${conflictId}`, CONFLICT_REASON);
    await clickTestId("intake-save");
    const message = await waitSaved(4, "conflict save");

    const retained = await attr(`intake-conflict-${conflictId}`, "data-state");
    assert(retained === "retained", "the conflict is retained, not collapsed", retained);
    const conflictText = await text(`intake-conflict-${conflictId}`);
    assert(conflictText.includes(FACT_WITH_SOURCE) && conflictText.includes(FACT_CONFLICTING), "both sides are shown", conflictText);
    const reasonValue = await evaluate(`document.querySelector("[data-testid='intake-conflict-reason-${conflictId}']")?.value ?? null`);
    const stateValue = await evaluate(`document.querySelector("[data-testid='intake-conflict-state-${conflictId}']")?.value ?? null`);
    assert(reasonValue === CONFLICT_REASON && stateValue === "retained", "the retained reason is shown with the chosen state", { reasonValue, stateValue });
    const withSource = await evaluate(`document.querySelector("[data-testid='intake-fact-${factIds[0]}']").textContent`);
    const quoteShown = await evaluate(`document.querySelector("[data-testid='intake-fact-${factIds[0]}']").textContent.includes("现有换热装置")`);
    assert(quoteShown, "the fact cites the located paragraph", withSource);
    await shot("06-conflict-preserved");
    return { factIds, conflictId, retained, message, withSource, reasonValue, stateValue };
  })();

  await step("08 a changed fact marks a derived draft stale", async () => {
    const targetId = crypto.randomUUID();
    const figureRevisionId = crypto.randomUUID();
    const injected = await patchTargetAndDraft(matterId, targetId, figureRevisionId);
    await reload();
    await waitFor(`document.querySelector("[data-testid=intake][data-state]")`, "intake panel after reload");
    assert(await visibility(`intake-draft-${targetId}`), "the injected draft binding is shown");
    assert((await attr(`intake-draft-${targetId}`, "data-stale")) === "false", "the draft starts fresh at its bound version");

    // Change a fact: the answer text moves, and the save advances sourceVersion.
    await fill("intake-answer-problem", PROBLEM + "本次补充了维护成本数据。");
    await clickTestId("intake-save");
    const nextVersion = injected.sourceVersion + 1;
    const message = await waitSaved(nextVersion, "fact-change save");
    await waitFor(`document.querySelector("[data-testid=intake][data-state='stale']")`, "stale state");
    assert(await visibility("intake-stale-notice"), "the stale notice is shown");
    assert((await attr(`intake-draft-${targetId}`, "data-stale")) === "true", "the derived draft is stale");
    const draftText = await text(`intake-draft-${targetId}`);
    assert(new RegExp(`第 ${injected.sourceVersion} 版`).test(draftText), "the draft keeps the version it was built from", draftText);
    await shot("07-stale-derived-draft");
    return { targetId, injected, message, nextVersion, draftText };
  })();

  await step("09 reload: answers, sources, conflict and staleness all persist", async () => {
    await reload();
    await waitFor(`document.querySelector("[data-testid=intake][data-state]")`, "intake panel after final reload");
    const view = await evaluate(`({
      state: document.querySelector("[data-testid=intake]").dataset.state,
      version: document.querySelector("[data-testid=intake]").dataset.version,
      problem: document.querySelector("[data-testid=intake-answer-problem]").value,
      disclosure: document.querySelector("[data-testid=intake-answer-disclosure]").value,
      maturity: document.querySelector("[data-testid=intake-answer-maturity]").value,
      provenance: document.querySelector("[data-testid=intake-provenance-problem]")?.textContent ?? null,
      conflictCount: document.querySelectorAll("[data-testid^=intake-conflict-][data-state]").length,
      conflictState: document.querySelector("[data-testid^=intake-conflict-][data-state]")?.dataset.state ?? null,
      draftStale: document.querySelector("[data-testid^=intake-draft-]")?.dataset.stale ?? null,
      staleNotice: !!document.querySelector("[data-testid=intake-stale-notice]"),
    })`);
    assert(view.problem.startsWith("现有换热装置"), "the answer survived the reload", view);
    assert(view.disclosure === "private_showing" && view.maturity === "tested_sample", "the explicit choices survived", view);
    assert(/第 4 版事实/.test(view.provenance ?? ""), "the provenance survived and names the version the last edit was based on", view);
    assert(view.conflictCount === 1 && view.conflictState === "retained", "the conflict survived the reload", view);
    assert(view.draftStale === "true" && view.staleNotice, "the draft is still stale after the reload", view);
    const persisted = await readSnapshotState(matterId);
    assert(persisted.snapshots.length === 4, "four saved snapshots (versions 2..5 excluding unchanged)", persisted.snapshots.map((item) => item.key));
    await shot("08-reload-persisted");
    return { view, snapshotKeys: persisted.snapshots.map((item) => item.key) };
  })();

  await step("10 B1: a committed version whose snapshot is missing recovers after a reload and a save fills it", async () => {
    const version = Number(await attr("intake", "data-version"));
    await dropSnapshot(matterId, version);
    await reload();
    await waitFor(`document.querySelector("[data-testid=intake][data-state]")`, "intake panel after snapshot loss");
    const view = await evaluate(`({
      version: document.querySelector("[data-testid=intake]").dataset.version,
      error: !!document.querySelector("[data-testid=intake-error]"),
      notSavedCopy: document.body.textContent.includes("没有保存"),
      recovery: document.querySelector("[data-testid=intake-recovery]")?.textContent ?? null,
      save: !!document.querySelector("[data-testid=intake-save]"),
      problem: document.querySelector("[data-testid=intake-answer-problem]")?.value ?? null,
    })`);
    assert(!view.error && view.save, "the form and its save button render, not the error state", view);
    assert(Number(view.version) === version, "the panel names the committed version", view);
    assert(!view.notSavedCopy, "no copy says the committed version was not saved", view);
    assert(new RegExp(`第 ${version} 版[\\s\\S]*第 ${version - 1} 版`).test(view.recovery ?? ""), "the recovery notice names both versions", view);
    assert(view.problem === PROBLEM, "the older snapshot's answer is shown, labelled as older", view);
    await shot("09-recovery-after-snapshot-loss");

    await clickTestId("intake-save");
    const message = await waitSaved(version + 1, "recovery save");
    await reload();
    await waitFor(`document.querySelector("[data-testid=intake][data-state]")`, "intake panel after recovery save");
    const after = await evaluate(`({
      version: document.querySelector("[data-testid=intake]").dataset.version,
      recovery: !!document.querySelector("[data-testid=intake-recovery]"),
      problem: document.querySelector("[data-testid=intake-answer-problem]").value,
    })`);
    assert(Number(after.version) === version + 1 && !after.recovery, "the gap is filled; the next reload is a normal read", after);
    const persisted = await readSnapshotState(matterId);
    const keys = persisted.snapshots.map((item) => item.key);
    assert(!keys.includes(`intake/snapshot/${matterId}/${version}`) && keys.includes(`intake/snapshot/${matterId}/${version + 1}`), "the new version has its snapshot", keys);
    await shot("10-recovery-saved");
    return { version, view, message, after, snapshotKeys: keys };
  })();

  await step("11 B3: a second tab saves first; this tab's save on the old base shows both sides at the real latest version", async () => {
    const base = Number(await attr("intake", "data-version"));
    const url = await evaluate("location.href");
    const { targetId } = await send("Target.createTarget", { url });
    let other = null;
    for (let i = 0; i < 50 && !other; i += 1) {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      other = list.find((target) => target.id === targetId) ?? null;
      if (!other) await sleep(200);
    }
    assert(other, "the second tab exists", targetId);
    const second = await connect(other.webSocketDebuggerUrl, state);
    await second.send("Runtime.enable");
    await second.send("Log.enable");
    const evaluate2 = async (expression) => {
      const result = await second.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
      return result.result.value;
    };
    const waitFor2 = async (expression, label) => {
      for (let i = 0; i < 300; i += 1) {
        if (await evaluate2(`!!(${expression})`)) return;
        await sleep(120);
      }
      throw new Error(`timeout waiting for ${label} in the second tab`);
    };
    try {
      await waitFor2(`document.querySelector("[data-testid=intake][data-version='${base}']")`, "intake panel");
      await evaluate2(`(() => {
        const el = document.querySelector("[data-testid='intake-answer-problem']");
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(el, ${JSON.stringify(OTHER_TAB_PROBLEM)});
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        document.querySelector("[data-testid='intake-save']").click();
      })()`);
      await waitFor2(`document.querySelector("[data-testid=intake][data-version='${base + 1}']")`, "the second tab's save");
    } finally {
      second.socket.close();
      await send("Target.closeTarget", { targetId });
    }

    await fill("intake-answer-problem", THIS_TAB_PROBLEM);
    await clickTestId("intake-save");
    await waitFor(`document.querySelector("[data-testid=intake-version-conflict]")`, "version conflict panel");
    const view = await evaluate(`({
      notice: document.querySelector("[data-testid=intake-version-conflict]").textContent,
      mine: document.querySelector("[data-testid=intake-merge-mine]")?.textContent ?? null,
      latest: document.querySelector("[data-testid=intake-merge-latest]")?.textContent ?? null,
      reload: !!document.querySelector("[data-testid=intake-reload-latest]"),
      version: document.querySelector("[data-testid=intake]").dataset.version,
    })`);
    assert(view.notice.includes(`最新是第 ${base + 1} 版`), "the conflict names the real latest fact version", view);
    assert((view.mine ?? "").includes(THIS_TAB_PROBLEM), "this tab's edit is in the left column", view);
    assert((view.latest ?? "").includes(OTHER_TAB_PROBLEM), "the other tab's saved answer is in the right column", view);
    assert(!(view.latest ?? "").includes("无法读取"), "the latest answers are readable", view);
    assert(view.reload && Number(view.version) === base, "this tab keeps its edit and its base until the user reloads", view);
    await shot("11-version-conflict-side-by-side");
    return { base, latestVersion: base + 1, view };
  })();

  await step("12 N-b: keeping my edits moves the base to the latest version and the save lands on top of it", async () => {
    const base = Number(await attr("intake", "data-version"));
    const pending = await evaluate(`document.querySelector("[data-testid='intake-answer-problem']").value`);
    assert(pending.includes(THIS_TAB_PROBLEM), "the conflict panel still holds this tab's edit", pending);
    await clickTestId("intake-keep-mine");
    await waitFor(
      `document.querySelector("[data-testid=intake][data-version='${base + 1}']") && !document.querySelector("[data-testid=intake-version-conflict]")`,
      "the view refreshed to the latest version",
    );
    const kept = await evaluate(`document.querySelector("[data-testid='intake-answer-problem']").value`);
    assert(kept.includes(THIS_TAB_PROBLEM), "keeping my edits does not reset the form", kept);
    await clickTestId("intake-save");
    await waitFor(`document.querySelector("[data-testid=intake][data-version='${base + 2}']")`, "the save on the latest version");
    const status = await evaluate(`document.querySelector("[data-testid='intake-save-status']")?.textContent ?? ""`);
    assert(status.includes(`已保存为第 ${base + 2} 版`), "the save lands one version above the latest", status);
    const persisted = await readSnapshotState(matterId);
    const newest = persisted.snapshots.find((item) => item.key === `intake/snapshot/${matterId}/${base + 2}`)?.snapshot ?? null;
    assert(newest && newest.answers.problem.includes(THIS_TAB_PROBLEM), "the kept edit is what was saved", newest?.answers?.problem);
    assert(!newest.answers.problem.includes(OTHER_TAB_PROBLEM), "keeping mine saves my text, not the other tab's", newest?.answers?.problem);
    await shot("12-merge-kept-mine");
    return { base, savedVersion: base + 2, status };
  })();
} catch (error) {
  state.fatal = String(error);
  try {
    await shot("99-failure");
  } catch {}
} finally {
  const consoleErrors = state.consoleErrors.filter((entry) => entry.text.trim().length > 0);
  const ok = state.steps.length === 12 &&state.steps.every((entry) => entry.ok) && consoleErrors.length === 0 && !state.fatal;
  const log = {
    ticket: "V6-13",
    date: new Date().toISOString(),
    baseUrl: base,
    fixture: FIXTURE,
    ok,
    steps: state.steps,
    consoleErrors,
    consoleLogCount: state.consoleLogs.length,
    consoleErrorsCount: consoleErrors.length,
    screenshots: readdirSync(outDir).filter((name) => name.endsWith(".png")).sort(),
  };
  writeFileSync(join(outDir, "browser-log.json"), `${JSON.stringify(log, null, 2)}\n`);
  console.log(JSON.stringify({ ok, steps: state.steps.map((s) => ({ step: s.step, ok: s.ok, error: s.error })), consoleErrorsCount: consoleErrors.length, consoleErrors, screenshots: log.screenshots }, null, 2));
  cdp.socket.close();
  chrome.kill("SIGTERM");
  process.exitCode = ok ? 0 : 1;
}
