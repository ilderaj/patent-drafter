/**
 * V6-11 — parse surface markup (S02 four states, R1 stale state).
 *
 * `Parse.tsx` is bundled with esbuild and rendered with `react-dom/server`,
 * like the V6-10 upload suite. Every row rendered here comes from real
 * persisted state: the engine runs against the in-memory repository, then
 * `readParseState` + `buildParseRows` build the view the component would show
 * after a refresh. Clicking in a real browser is browser evidence that needs
 * the orchestrator's registration; nothing here claims it happened.
 */
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

import {
  LEASE_MS,
  buildParseRows,
  describeParseRows,
  loadPdfPagesDefault,
  markInterrupted,
  parseSource,
  readMatterSources,
} from "../../../../apps/web/src/v6/features/sources/parse.ts";
import {
  ACTOR_A,
  MATTER_ID,
  fileFrom,
  fixture,
  ingest,
  parseDeps,
  seed,
  seedSourceAsset,
  stateOf,
} from "./harness.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../../../..");
const SOURCE = join(ROOT, "apps/web/src/v6/features/sources/Parse.tsx");

let outdir;
let ui;

before(async () => {
  outdir = mkdtempSync(join(tmpdir(), "v6-11-bundle-"));
  const outfile = join(outdir, "parse.cjs");
  const harness = `
    import { renderToStaticMarkup } from "react-dom/server";
    import { Parse, ParsePanel } from ${JSON.stringify(SOURCE)};
    export function renderParse(props) { return renderToStaticMarkup(<Parse {...props} />); }
    export function renderPanel(props) { return renderToStaticMarkup(<ParsePanel {...props} />); }
    export { chunkSummary, parseStatusLabel, runningRow, stageCounter, tabSessionId, pageInstanceId, loadAll,
      writePageExitMarker, readPageExitMarker, clearPageExitMarker,
      PARSE_SESSION_STORAGE_KEY, PARSE_EXIT_STORAGE_KEY } from ${JSON.stringify(SOURCE)};
  `;
  await esbuild.build({
    stdin: { contents: harness, resolveDir: ROOT, sourcefile: "v6-11-parse-harness.tsx", loader: "tsx" },
    bundle: true,
    outfile,
    format: "cjs",
    platform: "node",
    jsx: "automatic",
    // pdf.js is loaded lazily only when a PDF is parsed; markup never needs it.
    external: ["pdfjs-dist", "pdfjs-dist/*"],
    define: { "process.env.NODE_ENV": '"production"' },
    logLevel: "silent",
  });
  ui = createRequire(outfile)(outfile);
});

after(() => {
  if (outdir) rmSync(outdir, { recursive: true, force: true });
});

test("V6-11 session identity survives reload and falls back when sessionStorage is unavailable", () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
  const values = new Map();
  try {
    Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: {
      getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value),
    } });
    const tab = ui.tabSessionId();
    assert.equal(ui.tabSessionId(), tab);
    values.clear();
    assert.notEqual(ui.tabSessionId(), tab, "a separate tab has separate sessionStorage");
    Object.defineProperty(globalThis, "sessionStorage", { configurable: true, get() { throw new Error("blocked"); } });
    assert.equal(ui.tabSessionId(), ui.tabSessionId(), "blocked storage uses a stable in-memory token");
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "sessionStorage", descriptor);
    else delete globalThis.sessionStorage;
  }
});

function installSessionStorage() {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
  const values = new Map();
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  } });
  return {
    values,
    restore() {
      if (descriptor) Object.defineProperty(globalThis, "sessionStorage", descriptor);
      else delete globalThis.sessionStorage;
    },
  };
}

test("V6-11 the page instance id is per document in memory, and the exit marker carries session, page and time", () => {
  const storage = installSessionStorage();
  try {
    const session = "session-marker";
    const page = "page-instance-marker";
    const at = "2026-11-01T00:00:01.000Z";
    assert.equal(ui.pageInstanceId(), ui.pageInstanceId(), "stable within one document");
    assert.notEqual(ui.pageInstanceId(), ui.tabSessionId(), "the page instance is not the persistent session id");
    assert.equal(ui.writePageExitMarker({ sessionId: session, pageId: page, at }), true);
    assert.deepEqual(ui.readPageExitMarker(session), { sessionId: session, pageId: page, at });
    assert.equal(ui.readPageExitMarker("another-session"), null, "a marker is only evidence for its own session");
    ui.clearPageExitMarker();
    assert.equal(ui.readPageExitMarker(session), null);
    assert.deepEqual([...storage.values.keys()], [ui.PARSE_SESSION_STORAGE_KEY]);
  } finally {
    storage.restore();
  }
});

test("V6-11 without sessionStorage the exit marker is unavailable and nothing throws", () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
  try {
    Object.defineProperty(globalThis, "sessionStorage", { configurable: true, get() { throw new Error("blocked"); } });
    assert.equal(ui.writePageExitMarker({ sessionId: "s", pageId: "p", at: "2026-11-01T00:00:00.000Z" }), false);
    assert.equal(ui.readPageExitMarker("s"), null);
    assert.doesNotThrow(() => ui.clearPageExitMarker());
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "sessionStorage", descriptor);
    else delete globalThis.sessionStorage;
  }
});

// A page that really exited leaves a marker naming the page instance that
// owned the job. A duplicated tab copies the session id but not the marker.
const MOUNT_READS = [
  {
    mode: "after this page instance exited (reload)",
    expects: "interrupted",
    marker: (ids) => ({ sessionId: ids.sessionId, pageId: ids.pageId, at: ids.at }),
  },
  {
    mode: "in a duplicated tab that copied the session id",
    expects: "running",
    marker: () => null,
  },
  {
    mode: "with refreshToken while this page runs that asset",
    expects: "running",
    running: () => true,
    marker: () => null,
  },
  {
    mode: "with a marker from a different page instance of the same session",
    expects: "running",
    marker: (ids) => ({ sessionId: ids.sessionId, pageId: "page-instance-other", at: ids.at }),
  },
  {
    mode: "with a marker from a different session",
    expects: "running",
    marker: (ids) => ({ sessionId: "session-other", pageId: ids.pageId, at: ids.at }),
  },
  {
    mode: "with a marker older than the job's latest renewal",
    expects: "running",
    marker: (ids) => ({ sessionId: ids.sessionId, pageId: ids.pageId, at: ids.beforeRenewal }),
  },
];

for (const { mode, expects, running = () => false, marker } of MOUNT_READS) {
  test(`V6-11 loadAll ${mode}`, async () => {
    const { repository, newIds } = await seed();
    const [asset] = (await ingest(repository, newIds, [fileFrom(fixture("plain-text.txt"), "mount-read.txt", "text/plain")])).values();
    const sessionId = "shared-tab-session";
    const pageId = "page-instance-1";
    const outcome = await parseSource(repository, ACTOR_A, MATTER_ID, asset.id, {
      newId: newIds,
      sessionId,
      pageId,
      extractText: async () => {
        const before = await stateOf(repository, asset.id, { sessionId });
        const expiresAt = Date.parse(before.job.job.leaseExpiresAt);
        assert.ok(expiresAt > Date.now(), "the job lease is still live while it runs");
        const ids = {
          sessionId,
          pageId,
          at: new Date().toISOString(),
          beforeRenewal: new Date(expiresAt - LEASE_MS - 1000).toISOString(),
        };
        const loaded = await ui.loadAll(repository, ACTOR_A, MATTER_ID, sessionId, {
          runningAsset: () => running() ? asset.id : null,
          pageExit: marker(ids),
          now: () => new Date().toISOString(),
        });
        assert.equal(loaded.phase, "ready");
        const state = loaded.data.states.get(asset.id);
        assert.equal(state.job.job.id, before.job.job.id);
        assert.equal(state.status, expects);
        if (expects === "interrupted") {
          assert.ok(Date.now() < expiresAt, "interrupted immediately, without waiting for the lease");
          assert.equal(state.job.job.leaseOwner, null);
          assert.equal(state.job.job.state, "interrupted");
          assert.equal(state.job.job.version, before.job.job.version + 1);
        } else {
          assert.deepEqual(state.job.job, before.job.job, "a mount read writes no job row");
          assert.deepEqual(state.checkpoints, before.checkpoints);
          assert.equal(state.source.parseStatus, before.source.parseStatus);
        }
        return { text: "text after the mount read", note: "" };
      },
    });
    if (expects === "interrupted") {
      assert.equal(outcome.ok, false);
      assert.equal(outcome.state, "interrupted");
      const persisted = await stateOf(repository, asset.id);
      assert.equal(persisted.status, "interrupted");
      assert.equal(persisted.job.job.leaseOwner, null);
    } else {
      assert.equal(outcome.ok, true, JSON.stringify(outcome));
      const persisted = await stateOf(repository, asset.id);
      assert.equal(persisted.status, "parsed", "the live job was never interrupted");
      assert.equal(persisted.jobs.length, 1, "no extra job was created");
    }
  });
}

test("V6-11 loadAll reads and spends this tab's stored exit marker without injected evidence", async () => {
  const storage = installSessionStorage();
  try {
    const { repository, newIds } = await seed();
    const [asset] = (await ingest(repository, newIds, [fileFrom(fixture("plain-text.txt"), "stored-marker.txt", "text/plain")])).values();
    const sessionId = "stored-marker-session";
    const pageId = "page-instance-stored";
    const outcome = await parseSource(repository, ACTOR_A, MATTER_ID, asset.id, {
      newId: newIds,
      sessionId,
      pageId,
      extractText: async () => {
        const before = await stateOf(repository, asset.id, { sessionId });
        assert.ok(Date.parse(before.job.job.leaseExpiresAt) > Date.now());
        assert.equal(ui.writePageExitMarker({ sessionId, pageId, at: new Date().toISOString() }), true);
        const loaded = await ui.loadAll(repository, ACTOR_A, MATTER_ID, sessionId, {
          runningAsset: () => null,
          now: () => new Date().toISOString(),
        });
        const state = loaded.data.states.get(asset.id);
        assert.equal(state.status, "interrupted");
        assert.equal(storage.values.has(ui.PARSE_EXIT_STORAGE_KEY), false, "the spent marker is cleared");
        return { text: "text after the stored marker", note: "" };
      },
    });
    assert.equal(outcome.state, "interrupted");
    const persisted = await stateOf(repository, asset.id);
    assert.equal(persisted.status, "interrupted");
    assert.equal(persisted.job.job.leaseOwner, null);
    // A second mount read has no marker left and cannot write again.
    const again = await ui.loadAll(repository, ACTOR_A, MATTER_ID, sessionId, { pageExit: null });
    assert.equal(again.data.states.get(asset.id).status, "interrupted");
    assert.equal(again.data.states.get(asset.id).job.job.state, "interrupted");
  } finally {
    storage.restore();
  }
});

test("V6-11 loadAll falls back to lease expiry when no exit marker exists (crash or blocked storage)", async () => {
  const { repository, newIds } = await seed();
  const [asset] = (await ingest(repository, newIds, [fileFrom(fixture("plain-text.txt"), "lease-fallback.txt", "text/plain")])).values();
  const run = parseDeps(newIds);
  const outcome = await parseSource(repository, ACTOR_A, MATTER_ID, asset.id, {
    ...run.deps,
    pageId: "page-instance-lost",
    extractText: async () => {
      // No marker: the page crashed. Readers see `running` until the lease ends.
      const live = await ui.loadAll(repository, ACTOR_A, MATTER_ID, run.deps.sessionId, {
        runningAsset: () => null, pageExit: null, now: run.now,
      });
      assert.equal(live.data.states.get(asset.id).status, "running");
      run.advance("2026-11-01T00:10:00.000Z");
      const expired = await ui.loadAll(repository, ACTOR_A, MATTER_ID, run.deps.sessionId, {
        runningAsset: () => null, pageExit: null, now: run.now,
      });
      const state = expired.data.states.get(asset.id);
      assert.equal(state.status, "interrupted", "an expired lease is interrupted for every reader");
      assert.equal(state.job.job.state, "interrupted");
      assert.equal(state.job.job.leaseOwner, null);
      return { text: "text after the lease expired", note: "" };
    },
  });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.state, "interrupted");
  const persisted = await stateOf(repository, asset.id, { now: run.now });
  assert.equal(persisted.status, "interrupted");
  assert.equal(persisted.jobs.length, 1);
});

const noop = () => {};

function panelProps(view, extra = {}) {
  return {
    view,
    busy: false,
    liveStage: {},
    onStart: noop,
    onCancel: noop,
    onResume: noop,
    onAbandon: noop,
    onRetry: noop,
    onReload: noop,
    onAddDocuments: noop,
    ...extra,
  };
}

/** Run a real parse for one file and return the refreshed row view. */
async function viewAfter(files, act) {
  const { repository, newIds } = await seed();
  const assets = files.length ? [...(await ingest(repository, newIds, files)).values()] : [];
  const run = parseDeps(newIds);
  if (act) await act({ repository, newIds, run, assets });
  const states = new Map();
  for (const asset of assets) {
    const snapshot = await readMatterSources(repository, ACTOR_A, MATTER_ID);
    assert.equal(snapshot.ok, true);
    if (snapshot.data.sources.has(asset.id)) {
      states.set(asset.id, await stateOf(repository, asset.id, { sessionId: "session-reader", now: run.now }));
    }
  }
  const rows = buildParseRows({ assets, states });
  return { rows, view: describeParseRows(rows, false), assets };
}

function testIds(html) {
  return [...html.matchAll(/data-testid="([^"]+)"/g)].map((match) => match[1]);
}

test("V6-11 the initial surface reads persisted records and shows no fabricated progress", () => {
  const html = ui.renderParse({
    repository: { backend: {} },
    actor: ACTOR_A,
    matterId: MATTER_ID,
  });
  assert.match(html, /data-testid="parse"/);
  assert.match(html, /aria-busy="true"/);
  assert.match(html, /正在读取本机的解析记录/);
  assert.doesNotMatch(html, /role="progressbar"/);
  assert.doesNotMatch(html, /已保存/);
});

test("V6-11 S02 empty state: no source material offers upload, not a parse", async () => {
  const { view } = await viewAfter([]);
  assert.equal(view.state, "empty");
  const html = ui.renderPanel(panelProps(view));
  assert.match(html, /data-testid="parse-empty"/);
  assert.match(html, /先上传材料/);
  assert.doesNotMatch(html, /data-testid="parse-rows"/);
});

test("V6-11 an unparsed source offers 解析 and shows 0% with no saved claim", async () => {
  const { rows, view } = await viewAfter([fileFrom(fixture("plain-text.txt"), "ui-pending.txt", "text/plain")]);
  const id = rows[0].assetId;
  const html = ui.renderPanel(panelProps(view));
  assert.match(html, new RegExp(`data-testid="parse-start-${id}"`));
  assert.match(html, /未解析/);
  assert.match(html, /aria-valuenow="0"/);
  assert.doesNotMatch(html, /已保存/);
  assert.doesNotMatch(html, /已排队|排队中/);
});

test("V6-11 S02 loading state: a running row shows its real stage counter and a cancel button", async () => {
  const { rows } = await viewAfter([fileFrom(fixture("plain-text.txt"), "ui-running.txt", "text/plain")]);
  // A live row as the component holds it while this page owns the lease.
  const running = {
    ...rows[0],
    state: "running",
    jobState: "running",
    stage: "extract_text",
    stageLabel: "提取文字",
    stageIndex: 2,
    progress: { completed: 1, total: 2, unit: "page" },
    canStart: false,
    canCancel: true,
  };
  const view = describeParseRows([running], true);
  assert.equal(view.state, "loading");
  const html = ui.renderPanel(panelProps(view, { busy: true }));
  assert.match(html, new RegExp(`data-testid="parse-cancel-${running.assetId}"`));
  assert.match(html, /3\/5 阶段 · 1\/2/);
  assert.match(html, /aria-valuenow="40"/);
  assert.doesNotMatch(html, /已保存/);
  assert.equal(ui.stageCounter(running, "chunk"), "5/5 阶段");
});

test("V6-11 S02 loading state: the row this page is parsing reads 正在… with cancel, not 未解析", async () => {
  const { rows } = await viewAfter([fileFrom(fixture("plain-text.txt"), "ui-active.txt", "text/plain")]);
  assert.equal(rows[0].state, "pending");
  const active = ui.runningRow(rows[0], "extract_text");
  assert.equal(active.canStart, false);
  assert.equal(active.canRetry, false);
  const view = describeParseRows([active], true);
  assert.equal(view.state, "loading");
  const html = ui.renderPanel(panelProps(view, { busy: true }));
  assert.match(html, /正在提取文字/);
  assert.match(html, new RegExp(`data-testid="parse-cancel-${active.assetId}"`));
  assert.doesNotMatch(html, new RegExp(`data-testid="parse-start-${active.assetId}"`));
  assert.doesNotMatch(html, /未解析|已保存/);
});

test("V6-11 a parsed source shows its chunk count and 已保存 only after the commit", async () => {
  const { rows, view } = await viewAfter(
    [fileFrom(fixture("text-two-pages.pdf"), "ui-parsed.pdf", "application/pdf")],
    async ({ repository, run, assets }) => {
      const outcome = await parseSource(repository, ACTOR_A, MATTER_ID, assets[0].id, run.deps);
      assert.equal(outcome.ok, true);
    },
  );
  assert.equal(view.state, "parsed");
  const id = rows[0].assetId;
  const html = ui.renderPanel(panelProps(view));
  assert.match(html, new RegExp(`data-state="parsed"`));
  assert.match(html, /4 段 · 2 页 · 已保存/);
  assert.match(html, /已解析/);
  assert.match(html, /aria-valuenow="100"/);
  assert.doesNotMatch(html, new RegExp(`parse-retry-${id}|parse-resume-${id}`));
});

test("V6-11-A02 a scanned PDF renders as partial with OCR copy, 手动补充 and 重试 — no text", async () => {
  const { rows, view } = await viewAfter(
    [fileFrom(fixture("scan-no-text-layer.pdf"), "ui-scan.pdf", "application/pdf")],
    async ({ repository, run, assets }) => {
      await parseSource(repository, ACTOR_A, MATTER_ID, assets[0].id, run.deps);
    },
  );
  const id = rows[0].assetId;
  assert.equal(view.state, "error");
  const html = ui.renderPanel(panelProps(view));
  assert.match(html, /部分解析/);
  assert.match(html, new RegExp(`data-testid="parse-manual-${id}"`));
  assert.match(html, new RegExp(`data-testid="parse-retry-${id}"`));
  assert.match(html, /data-testid="parse-error-hint"/);
  assert.match(html, new RegExp(`data-testid="parse-detail-${id}">—`));
  assert.equal(rows[0].errorCode, "OCR_UNAVAILABLE");
  assert.match(html, new RegExp(`data-testid="parse-error-${id}">[^<]*没有文字层[^<]*（OCR_UNAVAILABLE）`));
});

test("V6-11 S02 error state: an unsupported file shows the failure, 重试 and 换一个文件", async () => {
  const { repository, newIds } = await seed();
  const asset = await seedSourceAsset(repository, "legacy-doc.doc", fixture("legacy-doc.doc"));
  const run = parseDeps(newIds);
  await parseSource(repository, ACTOR_A, MATTER_ID, asset.id, run.deps);
  const state = await stateOf(repository, asset.id, { now: run.now });
  const rows = buildParseRows({ assets: [asset], states: new Map([[asset.id, state]]) });
  const view = describeParseRows(rows, false);
  assert.equal(view.state, "error");
  const html = ui.renderPanel(panelProps(view));
  assert.match(html, /解析失败/);
  assert.match(html, new RegExp(`data-testid="parse-retry-${asset.id}"`));
  assert.match(html, new RegExp(`data-testid="parse-replace-${asset.id}"`));
  assert.doesNotMatch(html, /已保存/);
  assert.equal(rows[0].errorCode, "UNSUPPORTED_MEDIA");
  assert.match(html, new RegExp(`data-testid="parse-error-${asset.id}">[^<]*（UNSUPPORTED_MEDIA）`));
  assert.match(html, /legacy-doc\.doc/);
});

test("V6-11-A03 R1 stale state: an interrupted job offers 从已保存阶段继续 and 放弃, never 已排队", async () => {
  const { rows, view } = await viewAfter(
    [fileFrom(fixture("text-two-pages.pdf"), "ui-interrupt.pdf", "application/pdf")],
    async ({ repository, newIds, run, assets }) => {
      let calls = 0;
      await parseSource(repository, ACTOR_A, MATTER_ID, assets[0].id, {
        ...run.deps,
        loadPdfPages: async (bytes) => {
          calls += 1;
          if (calls === 2) {
            run.advance("2026-11-01T00:10:00.000Z");
            await markInterrupted(repository, ACTOR_A, MATTER_ID, assets[0].id, {
              sessionId: "session-0002",
              now: run.now,
              newId: newIds,
            });
          }
          return loadPdfPagesDefault(bytes);
        },
      });
    },
  );
  const id = rows[0].assetId;
  assert.equal(view.state, "stale");
  const html = ui.renderPanel(panelProps(view));
  assert.match(html, new RegExp(`data-testid="parse-resume-${id}"[^>]*>从已保存阶段继续`));
  assert.match(html, new RegExp(`data-testid="parse-abandon-${id}"[^>]*>放弃`));
  assert.match(html, /data-testid="parse-stale-notice"/);
  assert.match(html, /已中断/);
  assert.match(html, /不会自己在后台继续/);
  assert.doesNotMatch(html, /已排队|排队中|queued/);
  assert.doesNotMatch(html, /已保存 ?<|· 已保存/);
  assert.equal(rows[0].resumeFrom, "extract_text");
});

test("V6-11 a storage failure on load shows 尚未保存 and a reload, not a saved claim", () => {
  const html = ui.renderPanel(
    panelProps(describeParseRows([], false), { loadError: "本机存储不可用。" }),
  );
  assert.match(html, /data-testid="parse-load-error"/);
  assert.match(html, /尚未保存/);
  assert.doesNotMatch(html, /data-testid="parse-empty"/);
  assert.doesNotMatch(html, /已保存/);
});

test("V6-11 every rendered control has a stable test id and the markup has no timer hook", async () => {
  const { view } = await viewAfter([fileFrom(fixture("plain-text.txt"), "ui-ids.txt", "text/plain")]);
  const html = ui.renderPanel(panelProps(view));
  const ids = testIds(html);
  assert.ok(ids.includes("parse"));
  assert.ok(ids.includes("parse-rows"));
  assert.equal(new Set(ids).size, ids.length, "test ids are unique");
  assert.doesNotMatch(html, /animation|setInterval|setTimeout/);
});
