// Drives headless Chrome over CDP through the V6-12 figure surface (S02, C02 R1).
// Usage: node browser-drive.mjs <outDir> <baseUrl>
//   e.g. node browser-drive.mjs qa/v6/evidence/V6-12 http://127.0.0.1:4176/patent
//
// Run it against the production build (`vite preview`), not the dev server,
// for the same reason as V6-11: in this worktree node_modules is a symlink
// outside the project root, and the build is what ships.
//
// The panel is reached through the real UI: create a matter, open its overview,
// then click the 材料 tab. Persisted state is read straight from IndexedDB, not
// through the app's modules. Every fixture is synthetic and copied from (or
// derived from) qa/v6/scenarios/V6-12/fixtures; the progressive JPEG is
// drawing-valid.jpg with its SOF0 marker changed to SOF2, the same bytes the
// unit test inspects.
//
// What is NOT faked: no target is created and no draft is injected. Target-only
// states (figure set, export gate, stale draft) are recorded as not reachable
// in R1, and the run asserts that a fabricated target URL is refused by the
// route instead.
import { spawn } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

export async function recordStep(name, fn, { log, state, shot }) {
  try {
    const result = await fn();
    log.push({ step: name, ok: true, state: await state(), ...(result ? { notes: result } : {}) });
    await shot(name);
  } catch (error) {
    log.push({ step: name, ok: false, error: String(error), state: await state().catch(() => ({})) });
    await shot(name).catch(() => {});
  }
}

export function reportResult({ steps, consoleErrors, finalState, notReachable }) {
  const ok = steps.length > 0 && steps.every((step) => step.ok) && consoleErrors.length === 0;
  console.log(
    JSON.stringify(
      {
        ok,
        passed: steps.filter((step) => step.ok).length,
        failed: steps.filter((step) => !step.ok),
        notReachable,
        finalState,
        errors: consoleErrors,
      },
      null,
      2,
    ),
  );
  process.exitCode = ok ? 0 : 1;
}

/** drawing-valid.jpg with SOF0 changed to SOF2: a progressive frame header. */
function progressiveJpeg(bytes) {
  const out = Uint8Array.from(bytes);
  const sof = out.findIndex((byte, index) => byte === 0xff && out[index + 1] === 0xc0);
  if (sof < 0) throw new Error("fixture has no SOF0 marker");
  out[sof + 1] = 0xc2;
  return out;
}

async function main() {
  const [outDir, base] = process.argv.slice(2);
  if (!outDir || !base) throw new Error("usage: node browser-drive.mjs <outDir> <baseUrl>");

  const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  const profile = mkdtempSync(join(tmpdir(), "v6-12-profile-"));
  const fixtures = mkdtempSync(join(tmpdir(), "v6-12-fixtures-"));
  const fx = (name) => join(HERE, "..", "..", "scenarios", "V6-12", "fixtures", name);

  const files = {
    png: join(fixtures, "合成-附图.png"),
    jpg: join(fixtures, "合成-附图.jpg"),
    corrupt: join(fixtures, "合成-损坏.png"),
    big: join(fixtures, "合成-17MP.png"),
    progressive: join(fixtures, "合成-渐进式.jpg"),
    notImage: join(fixtures, "合成-不是图片.png"),
  };
  copyFileSync(fx("drawing-valid.png"), files.png);
  copyFileSync(fx("drawing-valid.jpg"), files.jpg);
  copyFileSync(fx("drawing-corrupt.png"), files.corrupt);
  copyFileSync(fx("drawing-17mp.png"), files.big);
  copyFileSync(fx("drawing-not-an-image.png"), files.notImage);
  writeFileSync(files.progressive, progressiveJpeg(readFileSync(fx("drawing-valid.jpg"))));

  const port = 9338;
  const chrome = spawn(
    CHROME,
    [
      "--headless=new",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--window-size=1280,1600",
      "about:blank",
    ],
    { stdio: "ignore" },
  );

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let targets = [];
  for (let i = 0; i < 60; i += 1) {
    try {
      targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      if (targets.some((t) => t.type === "page")) break;
    } catch {}
    await sleep(200);
  }
  const page = targets.find((t) => t.type === "page");
  if (!page) throw new Error("headless Chrome never exposed a page target");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  let id = 0;
  const pending = new Map();
  ws.addEventListener("message", (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const n = ++id;
      pending.set(n, (m) => (m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result)));
      ws.send(JSON.stringify({ id: n, method, params }));
    });
  const evaluate = async (expression, { userGesture = false } = {}) => {
    const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    }
    return result.result.value;
  };
  const waitFor = async (expression, label, tries = 240) => {
    for (let i = 0; i < tries; i += 1) {
      if (await evaluate(`!!(${expression})`)) return;
      await sleep(150);
    }
    throw new Error(`timeout waiting for ${label}`);
  };
  const assert = (condition, message, current) => {
    if (!condition) throw new Error(`${message} :: ${JSON.stringify(current)}`);
  };
  const go = async (path) => {
    await send("Page.navigate", { url: base + path });
    await sleep(700);
  };
  const reload = async () => {
    await send("Page.reload");
    await sleep(1000);
    await waitFor(`document.querySelector("[data-testid=figures][data-figures-state]")`, "figures panel after reload", 400);
    await instrument();
  };
  const shot = async (name) => {
    const { data } = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
    writeFileSync(join(outDir, `${name}.png`), Buffer.from(data, "base64"));
  };
  /**
   * Count `File.arrayBuffer()` calls in the page. Every import path (valid or
   * refused after inspection) reads the file once, so this is how the run
   * proves the change event reached onImport even when the visible notice is
   * identical to the previous one (two refusals can share BAD_DRAWING).
   */
  const instrument = () =>
    evaluate(`(() => {
      if (!globalThis.__v6ReadHooked) {
        globalThis.__v6ReadHooked = true;
        globalThis.__v6FileReads = 0;
        const original = File.prototype.arrayBuffer;
        File.prototype.arrayBuffer = function () {
          globalThis.__v6FileReads += 1;
          return original.call(this);
        };
      }
      return true;
    })()`);
  // DOM.setFileInputFiles fires the input's change event itself.
  const setFiles = async (selector, paths) => {
    const { root } = await send("DOM.getDocument", { depth: -1 });
    const { nodeId } = await send("DOM.querySelector", { nodeId: root.nodeId, selector });
    if (!nodeId) throw new Error(`file input not found: ${selector}`);
    await send("DOM.setFileInputFiles", { nodeId, files: paths });
  };
  const click = async (selector) => {
    const found = await evaluate(
      `(() => { const b = document.querySelector(${JSON.stringify(selector)}); if (!b || b.disabled) return false; b.click(); return true; })()`,
    );
    if (!found) throw new Error(`cannot click ${selector}`);
  };
  const figureRows = () =>
    evaluate(`[...document.querySelectorAll("[data-testid^=figure-row-]")].map((row) => {
      const id = row.getAttribute("data-testid").slice("figure-row-".length);
      return {
        id,
        name: row.querySelector(".file-name")?.textContent ?? null,
        detail: row.querySelector("[data-testid='figure-detail-" + id + "']")?.textContent ?? null,
        bound: row.textContent.includes("已编入图集"),
        canDelete: !!row.querySelector("[data-testid='figure-delete-" + id + "']"),
      };
    })`);
  const panel = () =>
    evaluate(`(() => {
      const root = document.querySelector("[data-testid=figures]");
      const text = (sel) => document.querySelector(sel)?.textContent ?? null;
      return {
        present: root !== null,
        count: document.querySelectorAll("[data-testid=figures]").length,
        kind: root?.dataset.figuresState ?? null,
        empty: text("[data-testid=figures-empty]"),
        noTarget: text("[data-testid=figures-no-target]"),
        stale: text("[data-testid=figures-stale]"),
        set: document.querySelector("[data-testid=figures-set]")?.dataset.revision ?? null,
        setVersion: text("[data-testid=figures-set-version]"),
        setEntries: document.querySelectorAll("[data-testid^=figure-entry-]").length,
        setMissing: text("[data-testid=figures-set-missing]"),
        gateBlocked: text("[data-testid=figures-gate-blocked]"),
        loadError: text("[data-testid=figures-load-error]"),
        action: (() => {
          const el = document.querySelector("[data-testid=figures-action-error]");
          return el ? { code: el.dataset.code ?? null, text: el.textContent } : null;
        })(),
        importInput: !!document.querySelector("[data-testid=figures-import] input"),
      };
    })()`);
  const state = async () => ({
    path: await evaluate("location.pathname"),
    figures: await panel().catch(() => null),
    rows: await figureRows().catch(() => []),
    unavailable: await evaluate(`document.querySelector("[data-testid=unavailable]")?.textContent ?? null`).catch(() => null),
  });
  /** The persisted drawing record of this matter, straight from IndexedDB. */
  let matterId = null;
  const dbState = async () => {
    const result = await evaluate(`new Promise((resolve, reject) => {
      const open = indexedDB.open("patent.v6.local");
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction(["matters", "events", "blobs"], "readonly");
        const getAll = (store) => new Promise((res, rej) => {
          const req = tx.objectStore(store).getAll();
          req.onsuccess = () => res(req.result);
          req.onerror = () => rej(req.error);
        });
        const getMatter = new Promise((res, rej) => {
          const req = tx.objectStore("matters").get(${JSON.stringify(matterId)});
          req.onsuccess = () => res(req.result ?? null);
          req.onerror = () => rej(req.error);
        });
        Promise.all([getMatter, getAll("events"), getAll("blobs")]).then(([aggregate, events, blobs]) => {
          db.close();
          const mine = (value) => value && value.matterId === ${JSON.stringify(matterId)};
          const assets = (aggregate?.assets ?? []).filter((asset) => asset.purpose === "drawing");
          const rows = blobs.filter((value) => value?.kind === "drawings.drawing" && mine(value));
          const bytes = blobs.filter((value) => mine(value) && value.asset?.purpose === "drawing");
          const revisions = blobs.filter((value) => value?.kind === "figures.set" && mine(value));
          resolve({
            matterVersion: aggregate?.matter?.version ?? null,
            eventCount: events.filter(mine).length,
            drawingAssets: assets.length,
            drawingAssetIds: assets.map((asset) => asset.id),
            drawingRows: rows.length,
            drawingRowIds: rows.map((row) => row.drawing.id),
            drawingBlobs: bytes.length,
            revisionRows: revisions.length,
          });
        }, reject);
      };
    })`);
    return result;
  };
  /** Wait until the file change event reached onImport at least once. */
  const waitFileRead = async (label) => {
    for (let i = 0; i < 240; i += 1) {
      if ((await evaluate("globalThis.__v6FileReads || 0")) >= 1) return;
      await sleep(25);
    }
    throw new Error(`the change event never reached onImport (${label})`);
  };
  const waitActionCode = async (code, label, tries = 240) => {
    for (let i = 0; i < tries; i += 1) {
      const action = (await panel()).action;
      if (action && action.code === code) return action;
      await sleep(50);
    }
    throw new Error(`no action error ${code} for ${label} :: ${JSON.stringify(await panel())}`);
  };
  const importNewRow = async (path, name, detail, label) => {
    const before = await figureRows();
    const dbBefore = await dbState();
    await evaluate("globalThis.__v6FileReads = 0");
    await setFiles("[data-testid=figures-import] input", [path]);
    await waitFileRead(name);
    let row = null;
    for (let i = 0; i < 400; i += 1) {
      const rows = await figureRows();
      row = rows.find((candidate) => candidate.name === name && !before.some((old) => old.id === candidate.id)) ?? null;
      if (row) break;
      await sleep(50);
    }
    if (!row) throw new Error(`no new drawing row for ${name} :: ${JSON.stringify(await figureRows())}`);
    assert(detail.test(row.detail ?? ""), `${label}: the row shows the decoder-verified size`, row);
    const action = await panel();
    assert(action.action === null, `${label}: no error is shown after a successful import`, action);
    return { row, dbBefore, dbAfter: await dbState(), countBefore: before.length };
  };
  const attemptBad = async (path, code, message, label) => {
    const rowsBefore = await figureRows();
    const dbBefore = await dbState();
    await evaluate("globalThis.__v6FileReads = 0");
    await setFiles("[data-testid=figures-import] input", [path]);
    await waitFileRead(label);
    const action = await waitActionCode(code, label);
    assert((action.text ?? "").includes(message), `${label}: the notice shows the ${code} copy`, action);
    // Give a stray write time to land, then require the store to be untouched.
    await sleep(600);
    const rowsAfter = await figureRows();
    const dbAfter = await dbState();
    assert(rowsAfter.length === rowsBefore.length, `${label}: no drawing row is added`, { rowsBefore, rowsAfter });
    assert(
      JSON.stringify(dbAfter) === JSON.stringify(dbBefore),
      `${label}: nothing is written (same rows, assets, blobs, events and matter version)`,
      { dbBefore, dbAfter },
    );
    return { code, notice: action.text, rows: rowsAfter.length, db: dbAfter };
  };

  const log = [];
  const errors = [];
  const step = (name, fn) => recordStep(name, fn, { log, state, shot });
  const notReachable = [
    {
      state: "figures-set / figures-gate-blocked / figures-set-missing (target-bound panel)",
      reason: "Requires a target. No ticket before V6-12 creates one and the UI has no target command, so targetId is null on both pages. Not faked; the run asserts an unknown target URL is refused with 案件不可用.",
    },
    {
      state: "figures-stale",
      reason: "Requires draftFigureRevisionId. V6App passes none (there is no draft store yet), so the panel never claims a draft is stale. Not injected.",
    },
    {
      state: "figures-action-error INPUT_STALE",
      reason: "Requires binding a figure set to a target; the library-only surface cannot reach it.",
    },
    {
      state: "figures-failed / figures-load-error (STORAGE_UNAVAILABLE)",
      reason: "Requires a repository read fault. The shell renders its own unavailable page before the panel mounts, and the run may not inject storage faults. Covered by the unit/UI-render tests in the suite.",
    },
  ];

  await send("Page.enable");
  await send("Runtime.enable");
  await send("DOM.enable");
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
    if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") {
      errors.push(m.params.args.map((a) => a.value ?? a.description).join(" "));
    }
  });

  await step("01-create-matter-sources-tab", async () => {
    await go("/v6");
    await waitFor(`document.querySelector("[data-testid=entry-self]")`, "start entry");
    await evaluate(
      `[...document.querySelectorAll("[data-testid=entry-self] button")].find((b) => b.textContent.includes("创建案件")).click()`,
    );
    await waitFor(`document.querySelector("[data-testid=upload-input]")`, "upload panel after create");
    matterId = await evaluate("location.pathname.split('/')[4]");
    assert(/^[0-9a-f-]{36}$/.test(matterId), "matter id read from the URL", { matterId, path: await evaluate("location.pathname") });
    // Real navigation: the overview link, then the 材料 tab.
    await click(`a.link-button[href$='/overview']`);
    await waitFor(`document.querySelector("[data-testid=matter]")`, "matter overview");
    await evaluate(
      `[...document.querySelectorAll(".tabs-trigger")].find((tab) => tab.textContent.trim() === "材料").click()`,
    );
    await waitFor(`document.querySelector("[data-testid=figures][data-figures-state]")`, "figures panel on 材料");
    await instrument();
    await evaluate(`globalThis.__v6PageMarker = "s1"; undefined`);
    const p = await panel();
    const path = await evaluate("location.pathname");
    const tab = await evaluate(`document.querySelector(".tabs-trigger[data-state=active]")?.textContent ?? null`);
    assert(path.endsWith(`/matters/${matterId}/sources`), "the 材料 tab route is open", { path });
    assert(tab === "材料", "the 材料 tab is active", { tab });
    assert(p.present && p.count === 1, "one figures panel", p);
    assert(await evaluate(`!!document.querySelector("[data-testid=upload-input]")`), "the source upload surface is on the same tab", {});
    return { matterId, path, tab };
  });

  await step("02-empty-drawings-state", async () => {
    const p = await panel();
    const db = await dbState();
    assert(p.kind === "empty", "the figure panel is in the empty state", p);
    assert(p.empty && p.empty.includes("附图库里还没有图"), "the empty copy is shown", p);
    assert(p.importInput, "导入附图 is offered", p);
    assert(p.count === 1, "no second (upload-route) panel on this page", p);
    assert(p.set === null && p.setEntries === 0, "no figure set is invented", p);
    assert(p.noTarget === "案件还没有目标；目标建立后才能绑定图集。", "the no-target hint explains why there is no binding", p);
    assert(p.stale === null && p.gateBlocked === null && p.loadError === null, "no stale, blocked or failed state", p);
    assert(db.drawingAssets === 0 && db.drawingRows === 0 && db.drawingBlobs === 0, "no drawing is stored", db);
    assert(db.revisionRows === 0, "no figure set is stored", db);
    return { figuresKind: p.kind, db };
  });

  await step("03-import-png-and-jpeg-without-reload", async () => {
    const first = await importNewRow(files.png, "合成-附图.png", /^128 × 96 · PNG · 36\.2 KB · [0-9a-f]{12}$/, "PNG");
    const second = await importNewRow(files.jpg, "合成-附图.jpg", /^40 × 16 · JPEG · 143 B · [0-9a-f]{12}$/, "JPEG");
    const marker = await evaluate("globalThis.__v6PageMarker ?? null");
    assert(marker === "s1", "both imports appeared without a page reload", { marker });
    const rows = await figureRows();
    const p = await panel();
    assert(rows.length === 2, "both drawings are listed once", rows);
    assert(p.kind === "library", "the panel is in the library state", p);
    const db = await dbState();
    assert(db.drawingAssets === first.dbBefore.drawingAssets + 2, "two drawing assets are stored", db);
    assert(db.drawingRows === 2 && db.drawingBlobs === 2, "two drawing rows and two byte blobs", db);
    assert(db.matterVersion === first.dbBefore.matterVersion + 2, "each import committed one matter version", db);
    assert(db.eventCount === first.dbBefore.eventCount + 2, "each import wrote one source.committed event", db);
    return { png: first.row.detail, jpeg: second.row.detail, marker, db };
  });

  await step("04-reload-keeps-drawings", async () => {
    const before = (await figureRows()).map((row) => [row.id, row.name, row.detail]);
    const dbBefore = await dbState();
    await reload();
    await evaluate(`globalThis.__v6PageMarker = "s2"; undefined`);
    let after = [];
    for (let i = 0; i < 200; i += 1) {
      after = (await figureRows()).map((row) => [row.id, row.name, row.detail]);
      if (after.length === before.length) break;
      await sleep(50);
    }
    const p = await panel();
    const dbAfter = await dbState();
    assert(p.kind === "library", "the panel is still the library after reload", p);
    assert(JSON.stringify(after) === JSON.stringify(before), "same drawing ids, names and sizes after reload", { before, after });
    assert(JSON.stringify(dbAfter) === JSON.stringify(dbBefore), "the reload wrote nothing", { dbBefore, dbAfter });
    return { before, after };
  });

  await step("05a-corrupt-png-refused", async () => {
    const result = await attemptBad(files.corrupt, "BAD_DRAWING", "PNG 的图像数据无法解压", "corrupt PNG");
    await shot("05a-corrupt-png-refused");
    return result;
  });

  await step("05b-17mp-png-refused", async () => {
    const result = await attemptBad(files.big, "IMAGE_TOO_LARGE", "图片超过 16 MP 上限", "17 MP PNG");
    await shot("05b-17mp-png-refused");
    return result;
  });

  await step("05c-progressive-jpeg-refused", async () => {
    const result = await attemptBad(files.progressive, "BAD_DRAWING", "暂不支持渐进式 JPEG", "progressive JPEG");
    await shot("05c-progressive-jpeg-refused");
    return result;
  });

  await step("05d-not-an-image-refused", async () => {
    const result = await attemptBad(files.notImage, "BAD_DRAWING", "附图必须是 PNG 或 JPEG", "non-image");
    await shot("05d-not-an-image-refused");
    return result;
  });

  await step("06-delete-and-reimport-new-id", async () => {
    const markerBefore = await evaluate("globalThis.__v6PageMarker ?? null");
    const before = await figureRows();
    const png = before.find((row) => row.name === "合成-附图.png");
    assert(png, "the PNG is in the library", before);
    const dbBefore = await dbState();
    await click(`[data-testid=figure-delete-${png.id}]`);
    for (let i = 0; i < 400; i += 1) {
      if (!(await figureRows()).some((row) => row.id === png.id)) break;
      await sleep(50);
    }
    const afterDelete = await figureRows();
    assert(!afterDelete.some((row) => row.id === png.id), "the drawing row is gone", afterDelete);
    const dbDeleted = await dbState();
    assert(dbDeleted.drawingAssets === dbBefore.drawingAssets - 1 && dbDeleted.drawingRows === dbBefore.drawingRows - 1,
      "the asset and drawing row are removed", { dbBefore, dbDeleted });
    assert(dbDeleted.matterVersion === dbBefore.matterVersion + 1, "the delete committed one version", dbDeleted);
    assert(dbDeleted.eventCount === dbBefore.eventCount + 1, "the delete wrote one source.retired event", dbDeleted);

    // Same bytes again: new drawing id, same decoder-verified detail.
    const reimport = await importNewRow(files.png, "合成-附图.png", /^128 × 96 · PNG · 36\.2 KB · [0-9a-f]{12}$/, "re-imported PNG");
    assert(reimport.row.id !== png.id, "the re-import got a new drawing id", { old: png.id, new: reimport.row.id });
    assert(reimport.row.detail === png.detail, "the same bytes decode to the same size", { old: png.detail, new: reimport.row.detail });
    const dbAfter = await dbState();
    assert(dbAfter.drawingAssets === dbBefore.drawingAssets && dbAfter.drawingRows === dbBefore.drawingRows,
      "the library is back to two drawings", { dbBefore, dbAfter });
    assert(!dbDeleted.drawingRowIds.includes(reimport.row.id) && dbAfter.drawingRowIds.includes(reimport.row.id),
      "the persisted row id is the new one", { dbDeleted, dbAfter });
    const marker = await evaluate("globalThis.__v6PageMarker ?? null");
    assert(marker === markerBefore && marker === "s2", "delete and re-import never reloaded the page", { marker, markerBefore });
    return {
      oldId: png.id,
      newId: reimport.row.id,
      detail: reimport.row.detail,
      orphanBytesKept: dbDeleted.drawingBlobs,
      blobsAfter: dbAfter.drawingBlobs,
      matterVersionBefore: dbBefore.matterVersion,
      matterVersionAfter: dbAfter.matterVersion,
    };
  });

  await step("07-duplicate-import-no-second-row", async () => {
    const rowsBefore = await figureRows();
    const dbBefore = await dbState();
    const jpg = rowsBefore.find((row) => row.name === "合成-附图.jpg");
    assert(jpg, "the JPEG is in the library", rowsBefore);
    await evaluate("globalThis.__v6FileReads = 0");
    await setFiles("[data-testid=figures-import] input", [files.jpg]);
    await waitFileRead("duplicate JPEG");
    const action = await waitActionCode("INVALID_INPUT", "duplicate JPEG");
    assert((action.text ?? "").includes("已经在附图库里"), "the refusal explains the duplicate", action);
    await sleep(600);
    const rowsAfter = await figureRows();
    const dbAfter = await dbState();
    const sameName = rowsAfter.filter((row) => row.name === "合成-附图.jpg");
    assert(sameName.length === 1, "exactly one row for the same bytes", sameName);
    assert(rowsAfter.length === rowsBefore.length, "no row is added", { rowsBefore, rowsAfter });
    assert(JSON.stringify(dbAfter) === JSON.stringify(dbBefore), "no asset, row, blob, event or version is written", { dbBefore, dbAfter });
    return { code: action.code, notice: action.text, rows: rowsAfter.length, sameName: sameName.length };
  });

  await step("08-target-states-not-reachable", async () => {
    const p = await panel();
    assert(p.set === null && p.setEntries === 0, "no figure set is shown without a target", p);
    assert(p.stale === null && p.gateBlocked === null && p.setMissing === null, "no target-only notice is shown", p);
    assert(p.noTarget === "案件还没有目标；目标建立后才能绑定图集。", "the no-target hint is the reachable state", p);
    // A fabricated target URL is refused by the route, not turned into state.
    const fakeTarget = "99999999-9999-4999-8999-999999999999";
    await go(`/v6/matters/${matterId}/targets/${fakeTarget}/sources`);
    await waitFor(`document.querySelector("[data-testid=unavailable]")`, "unavailable page for a fabricated target", 200);
    const unavailablePath = await evaluate("location.pathname");
    const figuresOnUnavailable = await evaluate(`document.querySelectorAll("[data-testid=figures]").length`);
    assert(figuresOnUnavailable === 0, "no figures panel is mounted for a target that does not exist", { figuresOnUnavailable });
    assert((await evaluate(`document.querySelector("[data-testid=unavailable]").textContent`)).includes("案件不可用"),
      "the route says 案件不可用", { unavailablePath });
    await shot("08a-fabricated-target-refused");
    // Back to the real surface: the library is unchanged.
    await go(`/v6/matters/${matterId}/sources`);
    await waitFor(`document.querySelector("[data-testid=figures][data-figures-state]")`, "figures panel back on 材料");
    const marker = await evaluate("globalThis.__v6PageMarker ?? null");
    const rows = await figureRows();
    assert(rows.length === 2, "both drawings are still there after the refused URL", rows);
    assert(marker === null, "control: the direct navigation was a real document load", { marker });
    return { noTarget: p.noTarget, unavailablePath, figuresOnUnavailable, rows: rows.length };
  });

  const finalState = await state();
  const summary = {
    base,
    matterId,
    fixtures: Object.fromEntries(Object.entries(files).map(([key, value]) => [key, value.split("/").pop()])),
    notReachable,
    consoleErrors: errors,
    steps: log,
    finalState,
  };
  writeFileSync(join(outDir, "browser-log.json"), JSON.stringify(summary, null, 2) + "\n");
  ws.close();
  chrome.kill();
  return { log, errors, finalState, notReachable };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const outcome = await main();
  reportResult({ steps: outcome.log, consoleErrors: outcome.errors, finalState: outcome.finalState, notReachable: outcome.notReachable });
}
