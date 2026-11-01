// Drives headless Chrome over CDP through the V6-11 parse surface (S02, C11 R1).
// Usage: node browser-drive.mjs <outDir> <baseUrl>
//   e.g. node browser-drive.mjs qa/v6/evidence/V6-11 http://127.0.0.1:4176/patent
//
// Run it against the production build (`vite preview`), not the dev server: in
// this worktree node_modules is a symlink outside the project root, so the dev
// server answers 403 for the pdf.js worker and every PDF fails at verify. The
// build bundles the worker as an asset, as it ships. Persisted state is read
// straight from IndexedDB, not through the app's modules.
//
// Every fixture is synthetic. Four are copied from the V6-11 scenario fixtures
// (plain-text.txt, text-two-pages.pdf, scan-no-text-layer.pdf, legacy-doc.doc);
// the rest are generated here in a temp directory: two long ASCII text PDFs
// (so a parse lasts long enough to interrupt) and a 201-page empty PDF (which
// the upload gate accepts and the parse budget refuses).
//
// Interruption is the real one: the page is reloaded while a parse runs, so the
// running JavaScript dies with its job half done. The reopened page must show
// 已中断 immediately while the original lease would still be live.
import { spawn } from "node:child_process";
import { copyFileSync, mkdtempSync, writeFileSync } from "node:fs";
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

export function reportResult({ steps, consoleErrors, finalState }) {
  const ok = steps.length > 0 && steps.every((step) => step.ok) && consoleErrors.length === 0;
  console.log(JSON.stringify({ ok, failed: steps.filter((step) => !step.ok), finalState, errors: consoleErrors }, null, 2));
  process.exitCode = ok ? 0 : 1;
}

/** A minimal PDF with the standard Helvetica font. Each page is a list of ASCII lines; [] is an empty page. */
export function asciiPdf(pages) {
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  const kids = [];
  for (const lines of pages) {
    const content = lines.map((line, i) => `BT /F1 10 Tf 56 ${760 - i * 14} Td (${line}) Tj ET`).join("\n");
    objects.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    const contentId = objects.length;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`,
    );
    kids.push(objects.length);
  }
  objects[1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`;
  let out = "%PDF-1.7\n";
  const offsets = [0];
  objects.forEach((body, index) => {
    offsets.push(out.length);
    out += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i += 1) out += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

/** A long synthetic text PDF: `pageCount` pages of numbered ASCII lines. */
function longPdf(label, pageCount, linesPerPage = 48) {
  return asciiPdf(
    Array.from({ length: pageCount }, (_, p) =>
      Array.from(
        { length: linesPerPage },
        (_, l) => `${label} page ${p + 1} line ${l + 1}: synthetic local parse test text, no customer material.`,
      ),
    ),
  );
}

async function main() {
  const [outDir, base] = process.argv.slice(2);
  if (!outDir || !base) throw new Error("usage: node browser-drive.mjs <outDir> <baseUrl>");

  const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  const profile = mkdtempSync(join(tmpdir(), "v6-11-profile-"));
  const fixtures = mkdtempSync(join(tmpdir(), "v6-11-fixtures-"));
  const fx = (name) => join(HERE, "..", "..", "scenarios", "V6-11", "fixtures", name);

  const files = {
    text: join(fixtures, "合成-文字稿.txt"),
    pdf: join(fixtures, "合成-两页.pdf"),
    scan: join(fixtures, "合成-扫描件.pdf"),
    legacyDoc: join(fixtures, "合成-旧格式.doc"),
    tooLong: join(fixtures, "合成-201页.pdf"),
    interrupt: join(fixtures, "合成-长文-中断.pdf"),
    abandon: join(fixtures, "合成-长文-放弃.pdf"),
    duplicate: join(fixtures, "合成-长文-复制标签.pdf"),
    refresh: join(fixtures, "合成-上传中解析.pdf"),
    extra: join(fixtures, "合成-解析时新增.txt"),
  };
  copyFileSync(fx("plain-text.txt"), files.text);
  copyFileSync(fx("text-two-pages.pdf"), files.pdf);
  copyFileSync(fx("scan-no-text-layer.pdf"), files.scan);
  copyFileSync(fx("legacy-doc.doc"), files.legacyDoc);
  writeFileSync(files.tooLong, asciiPdf(Array.from({ length: 201 }, () => [])));
  // Enough text per page that a parse lasts past the ~1 s a reload or a
  // second page needs to mount, without crossing the 20 000-chunk guard.
  writeFileSync(files.interrupt, longPdf("Interrupt case", 190, 98));
  writeFileSync(files.abandon, longPdf("Abandon case", 190, 98));
  // Only about 55 lines fit on a page; longer lines keep the duplicate-tab
  // parse running for several seconds while the second document mounts.
  const duplicateLine = `Duplicate tab case: ${"synthetic local parse test text, no customer material. ".repeat(20)}`;
  writeFileSync(
    files.duplicate,
    asciiPdf(
      Array.from({ length: 199 }, (_, p) =>
        Array.from({ length: 55 }, (_, l) => `page ${p + 1} line ${l + 1}: ${duplicateLine}`),
      ),
    ),
  );
  // Under the 200-page cap, with as many lines as fit on a page (54 × 14 pt from
  // y=760): 199 × 54 = 10 746 chunks, so the parse is still working when an
  // upload started in the same tick settles.
  writeFileSync(files.refresh, longPdf("Refresh token case", 199, 54));
  writeFileSync(files.extra, "Synthetic extra upload during parse.");

  const port = 9337;
  const chrome = spawn(
    CHROME,
    [
      "--headless=new",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-popup-blocking",
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
  /** A second CDP client, for a second page target in the same headless browser. */
  const connectTarget = async (wsUrl) => {
    const socket = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", reject, { once: true });
    });
    let cid = 0;
    const cpending = new Map();
    socket.addEventListener("message", (e) => {
      const msg = JSON.parse(e.data);
      if (msg.id && cpending.has(msg.id)) {
        cpending.get(msg.id)(msg);
        cpending.delete(msg.id);
      }
    });
    const csend = (method, params = {}) =>
      new Promise((resolve, reject) => {
        const n = ++cid;
        cpending.set(n, (m) => (m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result)));
        socket.send(JSON.stringify({ id: n, method, params }));
      });
    const cevaluate = async (expression) => {
      const result = await csend("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
      }
      return result.result.value;
    };
    return { socket, send: csend, evaluate: cevaluate };
  };
  const go = async (path) => {
    await send("Page.navigate", { url: base + path });
    await sleep(600);
  };
  const reload = async () => {
    await send("Page.reload");
    await sleep(1000);
    await waitFor(`document.querySelector("[data-testid=parse][data-parse-state]")`, "parse panel after reload", 400);
  };
  const shot = async (name) => {
    const { data } = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
    writeFileSync(join(outDir, `${name}.png`), Buffer.from(data, "base64"));
  };
  // DOM.setFileInputFiles fires the input's change event itself.
  const setFiles = async (paths) => {
    const { root } = await send("DOM.getDocument", { depth: -1 });
    const { nodeId } = await send("DOM.querySelector", { nodeId: root.nodeId, selector: "[data-testid=upload-input]" });
    if (!nodeId) throw new Error("upload input not found");
    await send("DOM.setFileInputFiles", { nodeId, files: paths });
    await sleep(400);
  };
  const click = async (selector) => {
    const found = await evaluate(
      `(() => { const b = document.querySelector(${JSON.stringify(selector)}); if (!b || b.disabled) return false; b.click(); return true; })()`,
    );
    if (!found) throw new Error(`cannot click ${selector}`);
  };
  const uploadRows = () =>
    evaluate(`[...document.querySelectorAll("[data-testid^=upload-row-]")].map((row) => ({
      name: row.querySelector(".file-name")?.textContent ?? null,
      saved: row.dataset.saved ?? null,
      status: row.querySelector("[data-testid^=upload-status-]")?.textContent ?? null,
    }))`);
  const uploadRow = async (name) => (await uploadRows()).find((row) => row.name === name) ?? null;
  /** Pick one file, press save, and wait until that file's row has an outcome. */
  const uploadOne = async (path, name, { expectSaved = true } = {}) => {
    await setFiles([path]);
    for (let i = 0; i < 40 && !(await uploadRow(name)); i += 1) await sleep(150);
    if (!(await uploadRow(name))) throw new Error(`no upload row for ${name}`);
    await click("[data-testid=upload-save]");
    for (let i = 0; i < 400; i += 1) {
      const row = await uploadRow(name);
      if (row && row.saved === "true") return row;
      if (!expectSaved && row && row.saved !== "true" && row.status && !/已选择|正在|读取|校验|保存中/.test(row.status)) return row;
      await sleep(150);
    }
    throw new Error(`upload of ${name} never settled :: ${JSON.stringify(await uploadRows())}`);
  };
  const parseRows = () =>
    evaluate(`[...document.querySelectorAll("[data-testid^=parse-row-]")].map((row) => {
      const id = row.getAttribute("data-testid").slice("parse-row-".length);
      const q = (part) => row.querySelector("[data-testid='parse-" + part + "-" + id + "']");
      return {
        id,
        state: row.getAttribute("data-state"),
        stage: row.getAttribute("data-stage"),
        name: q("name")?.textContent ?? null,
        status: q("status")?.textContent ?? null,
        detail: q("detail")?.textContent ?? null,
        progress: q("progress")?.getAttribute("aria-valuenow") ?? null,
        canStart: !!q("start"),
        canCancel: !!q("cancel"),
        canResume: !!q("resume"),
        resumeText: q("resume")?.textContent ?? null,
        canAbandon: !!q("abandon"),
        abandonText: q("abandon")?.textContent ?? null,
        canRetry: !!q("retry"),
        manualDisabled: q("manual") ? q("manual").disabled : null,
        text: row.textContent,
      };
    })`);
  const state = async () => ({
    path: await evaluate("location.pathname"),
    parsePanels: await evaluate(`document.querySelectorAll("[data-testid=parse]").length`),
    parseState: await evaluate(`document.querySelector("[data-testid=parse]")?.dataset.parseState ?? null`),
    rows: (await parseRows().catch(() => [])).map(({ text, ...row }) => row),
    uploads: await uploadRows().catch(() => []),
    problems: await evaluate(`document.querySelector("[data-testid=upload-problems]")?.textContent ?? null`).catch(() => null),
  });
  const rowNamed = (rows, name) => rows.find((row) => row.name === name) ?? null;
  const assert = (condition, message, current) => {
    if (!condition) throw new Error(`${message} :: ${JSON.stringify(current)}`);
  };
  const expectNamed = async (name, predicate, label, tries = 400) => {
    for (let i = 0; i < tries; i += 1) {
      const row = rowNamed(await parseRows(), name);
      if (row && predicate(row)) return row;
      await sleep(100);
    }
    throw new Error(`timeout waiting for ${label} (${name}) :: ${JSON.stringify(await parseRows())}`);
  };

  let matterId = null;

  /**
   * Read the persisted parse rows for one asset straight from IndexedDB, not
   * through the app's code: the `parse/` keys of the V6-06 blobs store.
   */
  const engineState = async (assetId) => {
    const rows = await evaluate(`new Promise((resolve, reject) => {
      const open = indexedDB.open("patent.v6.local");
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const out = [];
        const req = db.transaction(["blobs"], "readonly").objectStore("blobs")
          .openCursor(IDBKeyRange.bound("parse/", "parse/\\uffff"));
        req.onsuccess = () => {
          const cursor = req.result;
          if (cursor) { out.push({ key: cursor.key, value: cursor.value }); cursor.continue(); }
          else { db.close(); resolve(out); }
        };
        req.onerror = () => reject(req.error);
      };
    })`);
    const source = rows.find((r) => r.value?.kind === "parse.source" && r.value.source.assetId === assetId)?.value ?? null;
    const job = source ? (rows.find((r) => r.key === `parse/job/${source.currentJobId}`)?.value ?? null) : null;
    const savedStages = job
      ? rows.filter((r) => r.key.startsWith(`parse/checkpoint/${job.job.id}/`)).map((r) => r.value.stage)
      : [];
    const chunkSet = source
      ? (rows.find(
          (r) =>
            r.value?.kind === "parse.chunks" &&
            r.value.sourceId === source.source.id &&
            r.value.parserVersion === source.source.parserVersion,
        )?.value ?? null)
      : null;
    const j = job?.job ?? null;
    // Mirrors effectiveStatus for a reader that owns no lease.
    const liveStates = ["running", "queued", "cancel_requested"];
    const status = !j
      ? "pending"
      : liveStates.includes(j.state)
        ? j.leaseExpiresAt !== null && j.leaseExpiresAt > new Date().toISOString()
          ? "running"
          : "interrupted"
        : j.state;
    return {
      status,
      jobId: j?.id ?? null,
      jobState: j?.state ?? null,
      jobStage: j?.stage ?? null,
      jobVersion: j?.version ?? null,
      leaseOwner: j?.leaseOwner ?? null,
      ownerPageId: job?.ownerPageId ?? null,
      errorCode: j?.errorCode ?? null,
      leaseExpiresAt: j?.leaseExpiresAt ?? null,
      previousJobId: job?.previousJobId ?? null,
      resumedFromStage: job?.resumedFromStage ?? null,
      savedStages,
      jobCount: source?.jobIds?.length ?? 0,
      sourceStatus: source?.source.parseStatus ?? null,
      ocrNeeded: source?.source.ocrNeeded ?? null,
      pageCount: source?.source.pageCount ?? null,
      chunkCount: chunkSet ? chunkSet.chunks.length : 0,
      chunkTextChars: chunkSet ? chunkSet.chunks.reduce((n, c) => n + c.text.length, 0) : 0,
    };
  };

  /** Reload during extraction and require immediate interruption in the same tab. */
  const interruptByReload = async (name, shotPrefix) => {
    const row = await expectNamed(name, (r) => r.canStart, `${name} offers 解析`);
    await click(`[data-testid="parse-start-${row.id}"]`);
    const running = await expectNamed(
      name,
      (r) => r.state === "running" && r.status !== "正在校验文件",
      `${name} running past verify`,
      600,
    );
    const before = await engineState(row.id);
    const sessionBefore = await evaluate(`sessionStorage.getItem("patent.v6.parse.session")`);
    await shot(`${shotPrefix}a-running-before-reload`);
    const reloadStartedAt = Date.now();
    await reload();
    const withinLease = await expectNamed(name, () => true, `${name} after reload`);
    const reloadToInterruptedMs = Date.now() - reloadStartedAt;
    const persisted = await engineState(row.id);
    const leaseRemainingMs = Date.parse(before.leaseExpiresAt) - Date.now();
    assert(withinLease.state === "interrupted" && withinLease.status === "已中断", "first settled render is interrupted immediately", withinLease);
    assert(leaseRemainingMs > 0, "interrupted before the original lease expires", { before, leaseRemainingMs });
    assert(await evaluate(`sessionStorage.getItem("patent.v6.parse.session")`) === sessionBefore, "session survives reload", { sessionBefore });
    assert(persisted.jobState === "interrupted" && persisted.leaseExpiresAt === null, "orphan marked interrupted durably", persisted);
    assert(persisted.jobVersion > before.jobVersion, "the persisted interruption is a real write", { before, persisted });
    assert(persisted.savedStages.includes("verify"), "verify was saved before the reload", persisted);
    await shot(`${shotPrefix}b-interrupted-after-reload`);
    return {
      id: row.id,
      running,
      withinLease,
      persisted,
      reloadToInterruptedMs,
      leaseRemainingMs,
      jobVersionBeforeReload: before.jobVersion,
    };
  };

  const log = [];
  const errors = [];
  const step = (name, fn) => recordStep(name, fn, { log, state, shot });

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

  await step("01-create-matter", async () => {
    await go("/v6");
    await waitFor(`document.querySelector("[data-testid=entry-self]")`, "start entry");
    await evaluate(
      `[...document.querySelectorAll("[data-testid=entry-self] button")].find((b) => b.textContent.includes("创建案件")).click()`,
    );
    await waitFor(`document.querySelector("[data-testid=upload-input]")`, "upload panel after create");
    matterId = await evaluate("location.pathname.split('/')[4]");
    assert(/^[0-9a-f-]{36}$/.test(matterId), "matter id read from the URL", { matterId, path: await evaluate("location.pathname") });
    await waitFor(`document.querySelector("[data-testid=parse][data-parse-state]")`, "parse panel");
    // A marker on the window: if it survives the uploads, the page never reloaded.
    await evaluate(`globalThis.__v6LoadMarker = "load-1"; undefined`);
    const s = await state();
    assert(s.parsePanels === 1, "one parse panel on the upload route", s);
    assert(s.rows.length === 0 && s.parseState === "empty", "parse starts empty for a new matter", s);
    return { matterId };
  });

  await step("02-upload-text-appears-without-reload", async () => {
    const up = await uploadOne(files.text, "合成-文字稿.txt");
    assert(up.status === "已保存", "upload says 已保存", up);
    const row = await expectNamed("合成-文字稿.txt", (r) => r.state === "pending", "the text file in Parse");
    assert(row.status === "未解析" && row.canStart, "a new source reads 未解析 and offers 解析", row);
    const marker = await evaluate("globalThis.__v6LoadMarker ?? null");
    assert(marker === "load-1", "Parse updated without a page reload", { marker });
    return { marker, status: row.status };
  });

  await step("03-upload-pdf-appears-without-reload", async () => {
    await uploadOne(files.pdf, "合成-两页.pdf");
    const row = await expectNamed("合成-两页.pdf", (r) => r.state === "pending", "the PDF in Parse");
    const s = await state();
    assert(s.rows.length === 2, "both sources are listed once", s);
    assert(row.canStart, "a pending source offers 解析", row);
    const marker = await evaluate("globalThis.__v6LoadMarker ?? null");
    assert(marker === "load-1", "still no page reload", { marker });
    return { rows: s.rows.length };
  });

  await step("04-parse-both-to-parsed", async () => {
    const text = await expectNamed("合成-文字稿.txt", (r) => r.canStart, "text start");
    await click(`[data-testid="parse-start-${text.id}"]`);
    const textRow = await expectNamed("合成-文字稿.txt", (r) => r.state === "parsed", "text parsed");
    assert(textRow.status === "已解析", "text shows 已解析", textRow);
    assert(textRow.detail === "2 段 · 1 页 · 已保存", "text chunk count is shown and saved", textRow);
    const pdf = await expectNamed("合成-两页.pdf", (r) => r.canStart, "pdf start");
    await click(`[data-testid="parse-start-${pdf.id}"]`);
    const pdfRow = await expectNamed("合成-两页.pdf", (r) => r.state === "parsed", "PDF parsed");
    assert(pdfRow.status === "已解析", "PDF shows 已解析", pdfRow);
    assert(pdfRow.detail === "4 段 · 2 页 · 已保存", "PDF chunk and page count are shown", pdfRow);
    assert(pdfRow.canStart === false && pdfRow.canRetry === false, "a parsed source offers no parse or retry", pdfRow);
    const engine = await engineState(pdf.id);
    assert(engine.chunkCount === 4 && engine.pageCount === 2, "the stored chunk set matches the screen", engine);
    return { text: textRow.detail, pdf: pdfRow.detail, engine };
  });

  await step("05-reload-keeps-parsed", async () => {
    const before = (await parseRows()).map((r) => [r.name, r.detail, r.status]);
    await reload();
    const s = await state();
    assert(s.parseState === "parsed", "the panel reads parsed after reload", s);
    const after = (await parseRows()).map((r) => [r.name, r.detail, r.status]);
    assert(JSON.stringify(after) === JSON.stringify(before), "same rows, counts and states after reload", { before, after });
    return { after };
  });

  await step("06-scanned-pdf-partial", async () => {
    await uploadOne(files.scan, "合成-扫描件.pdf");
    const pendingRow = await expectNamed("合成-扫描件.pdf", (r) => r.canStart, "scan in Parse");
    await click(`[data-testid="parse-start-${pendingRow.id}"]`);
    const row = await expectNamed("合成-扫描件.pdf", (r) => r.state === "partial", "scan partial");
    assert(row.status === "部分解析", "scan shows 部分解析", row);
    assert(row.detail === "— · 已保存", "no chunk text is invented; the partial result is saved", row);
    assert(row.manualDisabled === true, "手动补充 is shown but disabled", row);
    assert(row.canRetry, "a partial scan offers 重试", row);
    const engine = await engineState(row.id);
    assert(engine.sourceStatus === "partial" && engine.ocrNeeded === true, "source is partial with ocrNeeded", engine);
    assert(engine.jobState === "succeeded" && engine.errorCode === "OCR_UNAVAILABLE", "job ends with OCR_UNAVAILABLE", engine);
    assert(engine.chunkCount === 0 && engine.chunkTextChars === 0, "no chunk and no text stored", engine);
    return { row: { status: row.status, detail: row.detail }, engine };
  });

  await step("07-legacy-doc-refused-at-upload", async () => {
    const before = (await parseRows()).length;
    const up = await uploadOne(files.legacyDoc, "合成-旧格式.doc", { expectSaved: false });
    assert(up.saved !== "true", "the .doc is not saved", up);
    // V6-10's row copy for UNSUPPORTED_MEDIA.
    assert(up.status && up.status.includes("不接受这种文件"), "the row refuses the .doc explicitly", up);
    const problems = await evaluate(`document.querySelector("[data-testid=upload-problems]")?.textContent ?? null`);
    assert(problems !== null, "the problem notice is shown", { problems });
    await sleep(500);
    const rows = await parseRows();
    assert(rows.length === before && !rowNamed(rows, "合成-旧格式.doc"), "no parse row for a refused file", rows);
    return { status: up.status, problems };
  });

  await step("08-failed-parse-then-retry-new-job", async () => {
    await uploadOne(files.tooLong, "合成-201页.pdf");
    const pendingRow = await expectNamed("合成-201页.pdf", (r) => r.canStart, "201-page PDF in Parse");
    await click(`[data-testid="parse-start-${pendingRow.id}"]`);
    const failed = await expectNamed("合成-201页.pdf", (r) => r.state === "failed", "201-page PDF fails");
    assert(failed.status === "解析失败", "an explicit failure is shown", failed);
    assert(failed.canRetry, "a failed source offers 重试", failed);
    const errorHint = await evaluate(`document.querySelector("[data-testid=parse-error-hint]")?.textContent ?? null`);
    assert(errorHint !== null, "the S02 error hint is shown", { errorHint });
    const before = await engineState(failed.id);
    assert(before.jobState === "failed" && before.errorCode !== null, "the job is failed with a code", before);
    assert(before.jobStage === "verify" && before.chunkCount === 0, "it failed at verify before any text", before);
    await click(`[data-testid="parse-retry-${failed.id}"]`);
    await expectNamed("合成-201页.pdf", (r) => r.state === "failed", "retried job ends failed again");
    let after = await engineState(failed.id);
    for (let i = 0; i < 40 && after.jobId === before.jobId; i += 1) {
      await sleep(150);
      after = await engineState(failed.id);
    }
    assert(after.jobId !== before.jobId, "retry created a new job", { before, after });
    assert(after.previousJobId === before.jobId, "the new job is linked to the old one", { before, after });
    assert(after.jobCount === 2, "both jobs are kept in the history", after);
    return { errorCode: before.errorCode, rowText: failed.text, before: before.jobId, after: after.jobId };
  });

  await step("09-interrupt-by-reload-then-resume", async () => {
    await uploadOne(files.interrupt, "合成-长文-中断.pdf");
    const run = await interruptByReload("合成-长文-中断.pdf", "09");
    const reopened = await expectNamed("合成-长文-中断.pdf", (r) => r.state === "interrupted", "reopen shows interrupted");
    assert(reopened.status === "已中断", "the reopen says 已中断", reopened);
    assert(!/排队/.test(reopened.text), "never 排队中", reopened);
    assert(reopened.canResume && reopened.resumeText.includes("从已保存阶段继续"), "从已保存阶段继续 is offered", reopened);
    assert(reopened.canAbandon && reopened.abandonText.includes("放弃"), "放弃 is offered", reopened);
    const s = await state();
    assert(s.parseState === "stale", "the panel is in the stale state", s);
    const notice = await evaluate(`document.querySelector("[data-testid=parse-stale-notice]")?.textContent ?? null`);
    assert(notice && notice.includes("不会自己在后台继续"), "the stale notice explains recovery", { notice });
    const interrupted = await engineState(run.id);
    assert(interrupted.status === "interrupted", "persisted state reads interrupted", interrupted);
    await click(`[data-testid="parse-resume-${run.id}"]`);
    const resumed = await expectNamed("合成-长文-中断.pdf", (r) => r.state === "parsed", "resume completes", 1200);
    assert(resumed.status === "已解析" && /段 · 190 页 · 已保存/.test(resumed.detail), "the resumed job completes with counts", resumed);
    const after = await engineState(run.id);
    assert(after.jobState === "succeeded", "resume ends in a succeeded job", after);
    assert(after.previousJobId === interrupted.jobId, "resume links to the interrupted job", { interrupted, after });
    assert(after.resumedFromStage !== null && after.resumedFromStage !== "verify", "resume continued after the saved verify stage", after);
    return {
      runningBeforeReload: run.running.status,
      insideLeaseAfterReload: { state: run.withinLease.state, status: run.withinLease.status },
      savedAtReload: run.persisted.savedStages,
      reloadToInterruptedMs: run.reloadToInterruptedMs,
      leaseRemainingMsAfterReload: run.leaseRemainingMs,
      jobVersionBeforeReload: run.jobVersionBeforeReload,
      jobVersionAfterReload: run.persisted.jobVersion,
      immediatelyAfterReload: reopened.status,
      resumedFromStage: after.resumedFromStage,
      detail: resumed.detail,
    };
  });

  await step("10-interrupt-by-reload-then-abandon", async () => {
    await uploadOne(files.abandon, "合成-长文-放弃.pdf");
    const run = await interruptByReload("合成-长文-放弃.pdf", "10");
    const stale = await expectNamed("合成-长文-放弃.pdf", (r) => r.state === "interrupted", "second job interrupted");
    assert(stale.canAbandon, "放弃 is offered on an interrupted job", stale);
    await click(`[data-testid="parse-abandon-${run.id}"]`);
    const abandoned = await expectNamed("合成-长文-放弃.pdf", (r) => r.state === "cancelled", "abandoned job reads cancelled");
    assert(abandoned.status === "已取消" && abandoned.canRetry, "the row says 已取消 and offers 重试", abandoned);
    assert(!abandoned.canResume, "an abandoned job cannot be resumed", abandoned);
    const after = await engineState(run.id);
    assert(after.jobState === "cancelled" && after.chunkCount === 0, "the job is cancelled and wrote no chunks", after);
    await reload();
    const kept = await expectNamed("合成-长文-放弃.pdf", (r) => r.state === "cancelled", "abandon survives reload");
    return {
      insideLease: run.withinLease.status,
      after: kept.status,
      savedAtReload: run.persisted.savedStages,
      reloadToInterruptedMs: run.reloadToInterruptedMs,
      leaseRemainingMsAfterReload: run.leaseRemainingMs,
      jobVersionBeforeReload: run.jobVersionBeforeReload,
      jobVersionAfterReload: run.persisted.jobVersion,
    };
  });

  await step("11-upload-during-parse-keeps-progress", async () => {
    await uploadOne(files.refresh, "合成-上传中解析.pdf");
    const pendingRow = await expectNamed("合成-上传中解析.pdf", (r) => r.canStart, "long PDF ready");
    const id = pendingRow.id;
    await setFiles([files.extra]);
    // Sample the parse row inside the page on every DOM change, so the moment
    // the new source appears is compared with the parse row at that same moment.
    await evaluate(`(() => {
      const t0 = performance.now();
      const panel = document.querySelector("[data-testid=parse]");
      const timeline = [];
      globalThis.__parsePanelBefore = panel;
      globalThis.__refreshTimeline = timeline;
      const sample = () => {
        const row = document.querySelector("[data-testid='parse-row-${id}']");
        const extra = [...document.querySelectorAll("[data-testid^=parse-row-]")]
          .find((r) => r.textContent.includes("合成-解析时新增.txt"));
        const entry = {
          ms: Math.round(performance.now() - t0),
          state: row?.getAttribute("data-state") ?? null,
          stage: row?.getAttribute("data-stage") ?? null,
          progress: row?.querySelector("[aria-valuenow]")?.getAttribute("aria-valuenow") ?? null,
          canCancel: !!row?.querySelector("[data-testid='parse-cancel-${id}']"),
          extra: extra?.getAttribute("data-state") ?? null,
          samePanel: document.querySelector("[data-testid=parse]") === panel,
        };
        const last = timeline[timeline.length - 1];
        if (!last || ["state", "stage", "progress", "canCancel", "extra", "samePanel"].some((k) => last[k] !== entry[k])) timeline.push(entry);
      };
      sample();
      globalThis.__refreshObserver = new MutationObserver(sample);
      globalThis.__refreshObserver.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
    })()`);
    // Start the parse and save the extra file in the same tick: the upload's
    // onSettled (refreshToken) then lands while the parse is still working.
    await evaluate(`(() => {
      document.querySelector("[data-testid='parse-start-${id}']").click();
      document.querySelector("[data-testid=upload-save]").click();
    })()`);
    const running = await expectNamed("合成-上传中解析.pdf", (r) => r.state === "running", "parse starts");
    // The row reads running from the click; the job record lands with job.started.
    let jobBefore = await engineState(id);
    for (let i = 0; i < 200 && jobBefore.jobId === null; i += 1) {
      await sleep(25);
      jobBefore = await engineState(id);
    }
    assert(jobBefore.jobId !== null, "the parse job is recorded", jobBefore);
    await expectNamed("合成-解析时新增.txt", (r) => r.state === "pending", "refreshToken shows new source");
    const timeline = await evaluate(`globalThis.__refreshTimeline`);
    const firstExtra = timeline.findIndex((e) => e.extra !== null);
    const atArrival = timeline[firstExtra];
    assert(atArrival && atArrival.state === "running" && atArrival.canCancel,
      "same parse is running when the new source appears", { atArrival, timeline });
    const firstRunning = timeline.find((e) => e.state === "running");
    assert(Number(atArrival.progress) >= Number(firstRunning.progress), "progress does not reset", { firstRunning, atArrival });
    assert(await evaluate(`globalThis.__parsePanelBefore === document.querySelector("[data-testid=parse]")`), "refreshToken keeps the mounted panel", atArrival);
    const sameJob = await engineState(id);
    assert(sameJob.jobId === jobBefore.jobId && sameJob.jobCount === 1, "upload does not replace the running job", { jobBefore, sameJob });
    const done = await expectNamed("合成-上传中解析.pdf", (r) => r.state === "parsed", "same job completes", 2400);
    const after = await engineState(id);
    assert(after.jobId === jobBefore.jobId && after.jobCount === 1 && after.chunkCount === 199 * 54 && after.pageCount === 199, "original job saved its chunks", after);
    const full = await evaluate(`(() => { globalThis.__refreshObserver.disconnect(); return globalThis.__refreshTimeline; })()`);
    const startAt = full.findIndex((e) => e.state === "running");
    const doneAt = full.findIndex((e) => e.state === "parsed");
    const live = full.slice(startAt, doneAt);
    assert(startAt >= 0 && doneAt > firstExtra, "the new source appears before the parse completes", full);
    assert(live.every((e) => e.state === "running" && e.canCancel), "the row stays running from start to completion, never 未解析", full);
    assert(full.every((e) => e.samePanel), "the panel is never remounted", full);
    for (let i = 1; i < live.length; i += 1) {
      assert(Number(live[i].progress) >= Number(live[i - 1].progress), "progress never moves backwards", live.slice(i - 1, i + 1));
    }
    return {
      runningStatus: running.status, atArrival: { state: atArrival.state, stage: atArrival.stage, progress: atArrival.progress },
      newSourceAppearedMs: atArrival.ms, completedMs: full[doneAt].ms, samples: full.length,
      stagesSeen: [...new Set(live.map((e) => e.stage))], completion: done.detail, jobId: after.jobId,
    };
  });

  await step("12-duplicated-tab-does-not-interrupt", async () => {
    await uploadOne(files.duplicate, "合成-长文-复制标签.pdf");
    const pendingRow = await expectNamed("合成-长文-复制标签.pdf", (r) => r.canStart, "duplicate fixture ready");
    const id = pendingRow.id;

    // Open the second page from inside the document as soon as the parse enters
    // extract_text, so a fast parse cannot finish before the duplicated tab has
    // performed its mount read. window.open copies the opener's sessionStorage,
    // the same way a duplicated or restored tab does; the new document gets its
    // own in-memory page instance id.
    await evaluate(`(() => {
      const id = ${JSON.stringify(id)};
      globalThis.__duplicateOpened = false;
      globalThis.__duplicatePage = null;
      const attempt = () => {
        if (globalThis.__duplicatePage !== null) return;
        const row = document.querySelector("[data-testid='parse-row-" + id + "']");
        if (row === null) return;
        if (row.getAttribute("data-state") !== "running") return;
        if (row.getAttribute("data-stage") !== "extract_text") return;
        globalThis.__duplicatePage = window.open(location.href, "_blank");
        globalThis.__duplicateOpened = globalThis.__duplicatePage !== null;
      };
      globalThis.__duplicateObserver = new MutationObserver(attempt);
      globalThis.__duplicateObserver.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
      return true;
    })()`);
    await click(`[data-testid="parse-start-${id}"]`);

    let opened = false;
    for (let i = 0; i < 200 && !opened; i += 1) {
      opened = (await evaluate("globalThis.__duplicateOpened === true")) === true;
      if (!opened) await sleep(50);
    }
    const openProbe = await evaluate("({ opened: globalThis.__duplicateOpened, page: globalThis.__duplicatePage !== null })");
    await evaluate("(() => { globalThis.__duplicateObserver?.disconnect(); return true; })()");
    assert(opened, "the running page opens a duplicated tab with window.open", { openProbe });
    const before = await engineState(id);
    assert(before.jobState === "running", "the job is still running when the duplicated tab opens", before);
    const originalSession = await evaluate(`sessionStorage.getItem("patent.v6.parse.session")`);

    let second = null;
    for (let i = 0; i < 100 && second === null; i += 1) {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      second = list.find((t) => t.type === "page" && t.id !== page.id) ?? null;
      if (second === null) await sleep(100);
    }
    assert(second !== null, "the duplicated page target exists", { second });

    const secondClient = await connectTarget(second.webSocketDebuggerUrl);
    secondClient.socket.addEventListener("message", (e) => {
      const m = JSON.parse(e.data);
      if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
      if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") {
        errors.push(m.params.args.map((a) => a.value ?? a.description).join(" "));
      }
    });
    await secondClient.send("Runtime.enable");

    let secondRow = null;
    let copiedSession = null;
    let afterMount = null;
    let observedRunning = true;
    let completedWhileOpen = false;
    try {
      for (let i = 0; i < 300; i += 1) {
        secondRow = await secondClient.evaluate(`(() => {
          const row = document.querySelector("[data-testid='parse-row-${id}']");
          if (!row) return null;
          return {
            state: row.getAttribute("data-state"),
            status: row.querySelector("[data-testid='parse-status-${id}']")?.textContent ?? null,
          };
        })()`);
        if (secondRow !== null) break;
        await sleep(100);
      }
      assert(secondRow !== null, "the duplicated page rendered the parse row", { secondRow });
      copiedSession = await secondClient.evaluate(`sessionStorage.getItem("patent.v6.parse.session")`);
      assert(copiedSession === originalSession, "the duplicated page copied the session id", { originalSession, copiedSession });
      assert(secondRow.state === "running", "the duplicated page reads the live job as running, not interrupted", secondRow);

      // The original page's job must survive the other page's mount read.
      afterMount = await engineState(id);
      assert(afterMount.jobId === before.jobId, "the mount read kept the same job", { before, afterMount });
      assert(afterMount.jobState === "running" && afterMount.leaseExpiresAt !== null, "the mount read did not mark the job interrupted", { before, afterMount });
      assert(afterMount.jobVersion >= before.jobVersion, "the mount read did not roll the job back", { before, afterMount });
      assert(afterMount.ownerPageId === before.ownerPageId, "the job still names the first page instance", { before, afterMount });
      await shot("12a-duplicated-tab-both-running");
      // The first page may finish naturally while the second is open; what must
      // never happen is an interruption or a changed job.
      for (let i = 0; i < 10; i += 1) {
        const row = rowNamed(await parseRows(), "合成-长文-复制标签.pdf");
        assert(row !== null, "the original page still has its parse row while the second page is open", { row });
        assert(row.state !== "interrupted" && row.state !== "failed", "the second page never interrupts the original job", row);
        if (row.state === "parsed") {
          completedWhileOpen = true;
          break;
        }
        observedRunning = observedRunning && row.state === "running";
        await sleep(150);
      }
    } finally {
      if (second) await send("Target.closeTarget", { targetId: second.id }).catch(() => {});
      secondClient.socket.close();
    }

    const done = await expectNamed(
      "合成-长文-复制标签.pdf",
      (r) => r.state === "parsed",
      "the original job completes after the duplicated page closes",
      2400,
    );
    const after = await engineState(id);
    assert(after.jobId === before.jobId && after.jobCount === 1, "still the same single job", { before, after });
    assert(after.jobState === "succeeded", "the original job succeeded", after);
    assert(after.chunkCount === 199 * 55 && after.pageCount === 199, "the original job saved its chunks", after);
    await shot("12b-duplicated-tab-original-completed");
    return {
      copiedSession: copiedSession === originalSession,
      secondPageRow: { state: secondRow?.state, status: secondRow?.status },
      jobId: before.jobId,
      jobStateAfterMount: afterMount?.jobState ?? null,
      leaseExpiresAtAfterMount: afterMount?.leaseExpiresAt ?? null,
      ownerPageIdAfterMount: afterMount?.ownerPageId ?? null,
      jobVersionBeforeMount: before.jobVersion,
      jobVersionAfterMount: afterMount?.jobVersion ?? null,
      originalPageStayedRunning: observedRunning,
      completedWhileSecondPageOpen: completedWhileOpen,
      completion: done.detail,
      chunkCount: after.chunkCount,
      pageCount: after.pageCount,
    };
  });

  const finalState = await state();
  writeFileSync(
    join(outDir, "browser-log.json"),
    JSON.stringify({ base, fixtures: Object.fromEntries(Object.entries(files).map(([k, v]) => [k, v.split("/").pop()])), finalState, consoleErrors: errors, steps: log }, null, 2) + "\n",
  );
  ws.close();
  chrome.kill();
  return { log, errors, finalState };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const outcome = await main();
  reportResult({ steps: outcome.log, consoleErrors: outcome.errors, finalState: outcome.finalState });
}
