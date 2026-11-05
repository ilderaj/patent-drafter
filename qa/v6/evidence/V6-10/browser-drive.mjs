// Drives headless Chrome over CDP through the V6-10 upload panel.
// Usage: node browser-drive.mjs <outDir> <baseUrl>
// The DOCX fixture is generated here, in /tmp — synthetic, no customer material.
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { deflateRawSync } from "node:zlib";

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

const CRC_TABLE = new Array(256).fill(0).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (bytes) => {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

/** Minimal stored/deflated ZIP writer for the DOCX fixture. */
function zip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data, deflate = true } of entries) {
    const nameBytes = Buffer.from(name, "utf8");
    const body = deflate ? deflateRawSync(data) : Buffer.from(data);
    const method = deflate ? 8 : 0;
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, body);
    centrals.push(central, nameBytes);
    offset += 30 + nameBytes.length + body.length;
  }
  const centralBytes = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBytes, end]);
}

function docxFixture(title) {
  return zip([
    {
      name: "[Content_Types].xml",
      data: Buffer.from(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Default Extension="xml" ContentType="application/xml"/>' +
          '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
          "</Types>",
      ),
    },
    {
      name: "_rels/.rels",
      data: Buffer.from(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
          "</Relationships>",
      ),
    },
    {
      name: "word/document.xml",
      data: Buffer.from(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
          `<w:p><w:r><w:t>${title}</w:t></w:r></w:p>` +
          "</w:body></w:document>",
      ),
    },
  ]);
}

async function main() {
const [outDir, base] = process.argv.slice(2);
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const profile = mkdtempSync(join(tmpdir(), "v6-10-profile-"));
const fixtures = mkdtempSync(join(tmpdir(), "v6-10-fixtures-"));
const goodDocx = join(fixtures, "检索报告.docx");
const fakeDocx = join(fixtures, "其实是图片.docx");
const fakeTxt = join(fixtures, "名字.txt");
writeFileSync(goodDocx, docxFixture("一种折叠支架的实施例"));
writeFileSync(fakeDocx, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("not a docx")]));
writeFileSync(fakeTxt, Buffer.from([0xff, 0xfe, 0x00, 0x00, 0xc3, 0x28]));
console.log(JSON.stringify({ goodDocx, fakeDocx, fakeTxt }));
const port = 9335;
const chrome = spawn(CHROME, [
  "--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
  "--no-first-run", "--no-default-browser-check", "--window-size=1280,860", "about:blank",
], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let targets;
for (let i = 0; i < 50; i++) {
  try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (targets.some((t) => t.type === "page")) break; } catch {}
  await sleep(200);
}
const page = targets.find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let id = 0;
const pending = new Map();
ws.addEventListener("message", (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
});
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const n = ++id; pending.set(n, (m) => (m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result)));
  ws.send(JSON.stringify({ id: n, method, params }));
});
const evaluate = async (expression) => {
  const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result.value;
};
const waitFor = async (expression, label) => {
  for (let i = 0; i < 90; i++) { if (await evaluate(`!!(${expression})`)) return; await sleep(150); }
  throw new Error(`timeout waiting for ${label}`);
};
const go = async (path) => { await send("Page.navigate", { url: base + path }); await sleep(500); };
const reload = async () => { await send("Page.reload"); await sleep(900); };
const shot = async (name) => {
  const { data } = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(outDir, `${name}.png`), Buffer.from(data, "base64"));
};
const setFile = async (path) => {
  const { root } = await send("DOM.getDocument", { depth: -1 });
  const { nodeId } = await send("DOM.querySelector", { nodeId: root.nodeId, selector: "[data-testid=upload-input]" });
  if (!nodeId) throw new Error("upload input not found");
  await send("DOM.setFileInputFiles", { nodeId, files: [path] });
  await sleep(400);
};
const rows = () => evaluate(`[...document.querySelectorAll("[data-testid^=upload-row-]")].map((row) => ({
  stage: row.dataset.stage, saved: row.dataset.saved,
  status: row.querySelector("[data-testid^=upload-status-]")?.textContent ?? null,
  name: row.querySelector(".file-name")?.textContent ?? null,
}))`);
const blobCount = () => evaluate(`new Promise((resolve, reject) => {
  const open = indexedDB.open("patent.v6.local");
  open.onerror = () => reject(open.error);
  open.onsuccess = () => {
    const db = open.result;
    const tx = db.transaction(["blobs"], "readonly");
    const req = tx.objectStore("blobs").count();
    req.onsuccess = () => { resolve(req.result); db.close(); };
    req.onerror = () => reject(req.error);
  };
})`);
const state = async () => ({
  path: await evaluate("location.pathname"),
  rows: await rows(),
  problems: await evaluate(`document.querySelector("[data-testid=upload-problems]")?.textContent ?? null`),
  batchError: await evaluate(`document.querySelector("[data-testid=upload-batch-error]")?.textContent ?? null`),
  allSaved: await evaluate(`document.querySelector("[data-testid=upload-all-saved]")?.textContent ?? null`),
  blobs: await blobCount(),
});
const assert = (condition, message, current) => {
  if (!condition) throw new Error(`${message} :: ${JSON.stringify(current)}`);
};

const log = [];
const step = (name, fn) => recordStep(name, fn, { log, state, shot });

await send("Page.enable");
await send("Runtime.enable");
await send("DOM.enable");
const errors = [];
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.text);
  if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") errors.push(m.params.args.map((a) => a.value ?? a.description).join(" "));
});

await step("01-create-matter", async () => {
  await go("/patent/v6");
  await waitFor(`document.querySelector("[data-testid=entry-self]")`, "start entries");
  await evaluate(`[...document.querySelectorAll("[data-testid=entry-self] button")].find((b) => b.textContent.includes("创建案件")).click()`);
  await waitFor(`document.querySelector("[data-testid=upload-input]")`, "upload panel after create");
  const s = await state();
  assert(s.rows.length === 0, "empty upload area", s);
  assert(s.blobs === 0, "no blobs before upload", s);
});

await step("02-select-docx", async () => {
  await setFile(goodDocx);
  await waitFor(`document.querySelectorAll("[data-testid^=upload-row-]").length === 1`, "one row");
  let s = await state();
  assert(s.rows[0].name === "检索报告.docx", "row names the file", s);
  assert(s.rows[0].saved === "false", "not saved before the click", s);
  await evaluate(`document.querySelector("[data-testid=upload-save]").click()`);
  await waitFor(`document.querySelector("[data-testid^=upload-row-]")?.dataset.saved === "true"`, "docx saved");
  s = await state();
  assert(s.rows[0].status === "已保存", "已保存 only after the commit", s);
  assert(s.blobs === 1, "exactly one blob stored", s);
  assert(s.problems === null, "no problem notice", s);
  return { blobs: s.blobs };
});

await step("03-refresh-dedupe", async () => {
  const before = await blobCount();
  await reload();
  await waitFor(`document.querySelector("[data-testid=upload-input]")`, "upload panel after refresh");
  await setFile(goodDocx);
  await waitFor(`document.querySelectorAll("[data-testid^=upload-row-]").length === 1`, "row after re-pick");
  await evaluate(`document.querySelector("[data-testid=upload-save]").click()`);
  await waitFor(`document.querySelector("[data-testid^=upload-row-]")?.dataset.saved === "true"`, "duplicate saved");
  const s = await state();
  assert(s.rows[0].status === "已保存", "same file reads as stored after refresh", s);
  assert(s.blobs === before, "no second blob for the same bytes", s);
});

await step("04-fake-docx", async () => {
  await setFile(fakeDocx);
  await waitFor(`document.querySelectorAll("[data-testid^=upload-row-]").length === 2`, "two rows");
  await evaluate(`document.querySelector("[data-testid=upload-save]").click()`);
  await waitFor(`!!document.querySelector("[data-testid=upload-problems]")`, "problem notice");
  const s = await state();
  const fake = s.rows.find((row) => row.name === "其实是图片.docx");
  assert(fake && fake.saved === "false", "fake docx not saved", s);
  assert(fake.status && fake.status.includes("不一致"), "MIME_MISMATCH message", s);
  assert(s.blobs === 1, "fake file stored no blob", s);
});

await step("05-bad-txt", async () => {
  await setFile(fakeTxt);
  await waitFor(`document.querySelectorAll("[data-testid^=upload-row-]").length === 3`, "three rows");
  await evaluate(`document.querySelector("[data-testid=upload-save]").click()`);
  await sleep(600);
  const s = await state();
  const bad = s.rows.find((row) => row.name === "名字.txt");
  assert(bad && bad.saved === "false", "non-UTF-8 txt rejected", s);
  assert(s.blobs === 1, "no blob for the bad text", s);
});

await step("06-answer-without-documents", async () => {
  const before = await blobCount();
  await evaluate(`document.querySelector("[data-testid=answer-without-documents]").click()`);
  await waitFor(`location.pathname.endsWith("/facts")`, "facts view");
  const s = await state();
  assert(s.blobs === before, "answering writes no attachment", s);
  const notice = await evaluate(`document.querySelector("[data-testid=tab-unavailable]")?.textContent ?? null`);
  assert(notice && notice.includes("事实"), "S03 placeholder shown until the question flow lands", { notice });
  return { notice };
});

await step("07-matter-sources-tab", async () => {
  const matter = await evaluate(`location.pathname`);
  const sources = matter.replace(/\/facts$/, "/sources");
  await go(sources);
  await waitFor(`!!document.querySelector(".v6-tabs")`, "matter tabs");
  let s = await state();
  assert(s.rows.length === 0, "sources tab starts with an empty upload area", s);
  await setFile(goodDocx);
  await evaluate(`document.querySelector("[data-testid=upload-save]").click()`);
  await waitFor(`document.querySelector("[data-testid^=upload-row-]")?.dataset.saved === "true"`, "stored file dedupes in the tab");
  s = await state();
  assert(s.rows[0].status === "已保存", "persisted material is recognised", s);
  assert(s.blobs === 1, "still one blob", s);
});

const finalState = await state();
writeFileSync(join(outDir, "browser-log.json"), JSON.stringify({
  base,
  fixtures: { goodDocx, fakeDocx, fakeTxt },
  finalState,
  consoleErrors: errors,
  steps: log,
}, null, 2) + "\n");
ws.close();
chrome.kill();
return { log, errors, finalState };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const outcome = await main();
  reportResult({ steps: outcome.log, consoleErrors: outcome.errors, finalState: outcome.finalState });
}
