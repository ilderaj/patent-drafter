/**
 * V6-11 — the parse surface (S02 解析进度与失败恢复, C11 R1).
 *
 * This file is deliberately thin. Every rule — the five real stages, the 200
 * page budget, the scanned-PDF outcome, checkpoints, resume/abandon/retry
 * semantics, the view model — lives in `parse.ts`. Here we only:
 *
 * - load persisted parse state for the matter's source assets,
 * - run/cancel/resume/abandon/retry through that module,
 * - render the four S02 states: empty, loading (per-file stage and progress,
 *   with cancel), error (code, affected file, recovery actions) and stale
 *   (interrupted, with 「从已保存阶段继续」 and 「放弃」).
 *
 * There is no timer and no simulated progress bar: the percentage only moves
 * when a real stage or a real page finishes, and 「已保存」 is only ever shown
 * for a source whose parse reached a committed result.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { Actor, AssetRecord, LocalRepository } from "../../lib/repository.ts";
import {
  PARSE_ERROR_MESSAGES,
  PARSE_STAGES,
  STAGE_LABELS,
  abandonParse,
  buildParseRows,
  cancelParse,
  describeParseRows,
  markInterrupted,
  parseSource,
  readMatterSources,
  readParseState,
  retryParse,
  resumeParse,
  type ParseErrorCode,
  type ParseProgressEvent,
  type ParseRow,
  type ParseStage,
  type ParseView,
  type PageExitEvidence,
  type SourceParseState,
} from "./parse.ts";

export interface ParseProps {
  repository: LocalRepository;
  actor: Actor;
  matterId: string;
  /** Re-read saved sources without replacing this component's running job. */
  refreshToken?: number;
  /** Optional: show the upload surface so a failed file can be replaced. */
  onAddDocuments?: () => void;
}

interface Loaded {
  assets: AssetRecord[];
  states: Map<string, SourceParseState>;
}

type LoadState = { phase: "loading" } | { phase: "ready"; data: Loaded } | { phase: "failed"; errorCode: ParseErrorCode };

/** Short, fixed label for the state chip; never a promise of work in progress. */
export function parseStatusLabel(row: ParseRow): string {
  switch (row.state) {
    case "pending":
      return "未解析";
    case "running":
      return row.stageLabel ? `正在${row.stageLabel}` : "正在解析";
    case "parsed":
      return "已解析";
    case "partial":
      return "部分解析";
    case "failed":
      return "解析失败";
    case "cancelled":
      return "已取消";
    case "interrupted":
      return "已中断";
  }
}

/** The real stage counter shown next to a running job, e.g. "2/5 阶段". */
export function stageCounter(row: ParseRow, live: ParseStage | null): string | null {
  const stage = live ?? row.stage;
  if (stage === null) return null;
  const index = PARSE_STAGES.indexOf(stage);
  return index < 0 ? null : `${index + 1}/${PARSE_STAGES.length} 阶段`;
}

function badgeTone(row: ParseRow): "ok" | "err" | "outline" {
  if (row.state === "failed" || row.state === "partial" || row.state === "interrupted") return "err";
  if (row.state === "parsed") return "ok";
  return "outline";
}

/**
 * The row this page is parsing right now. The stored state only changes when a
 * transition commits, so without this the row would read 未解析 until the job
 * ended. `stage` is the stage being worked on, not the last one saved.
 */
export function runningRow(row: ParseRow, stage: ParseStage): ParseRow {
  return {
    ...row,
    state: "running",
    stage,
    stageLabel: STAGE_LABELS[stage],
    stageIndex: PARSE_STAGES.indexOf(stage),
    errorCode: null,
    errorMessage: null,
    resumeFrom: null,
    canStart: false,
    canCancel: true,
    canResume: false,
    canAbandon: false,
    canRetry: false,
  };
}

/** The stage that runs after `saved` finished; the last stage stays itself. */
function stageAfter(saved: ParseStage): ParseStage {
  return PARSE_STAGES[PARSE_STAGES.indexOf(saved) + 1] ?? saved;
}

/** "2 段 · 3 页" when a chunk set exists, "—" when nothing was saved. */
export function chunkSummary(row: ParseRow): string {
  if (row.chunkCount > 0) {
    const pages = row.pageCount === null ? "" : ` · ${row.pageCount} 页`;
    return `${row.chunkCount} 段${pages}`;
  }
  return "—";
}

let memorySessionId: string | undefined;
let memoryPageId: string | undefined;

/** Persistent tab session id; a reload keeps it and a duplicated tab copies it. */
export const PARSE_SESSION_STORAGE_KEY = "patent.v6.parse.session";
/** Synchronous page-exit marker; written on pagehide, consumed by the next page. */
export const PARSE_EXIT_STORAGE_KEY = "patent.v6.parse.exit";

/** sessionStorage survives a reload but is separate for each independently opened tab. */
export function tabSessionId(): string {
  try {
    const stored = globalThis.sessionStorage.getItem(PARSE_SESSION_STORAGE_KEY);
    if (stored) return stored;
    const id = globalThis.crypto.randomUUID();
    globalThis.sessionStorage.setItem(PARSE_SESSION_STORAGE_KEY, id);
    return id;
  } catch {
    return memorySessionId ??= globalThis.crypto.randomUUID();
  }
}

/**
 * The identity of this JavaScript page instance, memory only. A reload, a
 * duplicated tab and a restored tab each run a new document and get a new id,
 * so a page-exit marker can prove *which* document disappeared even when the
 * persistent session id is shared. Never persisted outside the marker.
 */
export function pageInstanceId(): string {
  return (memoryPageId ??= globalThis.crypto.randomUUID());
}

/**
 * Records, synchronously, that this page instance is going away. Called from
 * `pagehide`; sessionStorage is per tab, so only the same tab (a reload) or a
 * restore that carries the storage back can read it.
 */
export function writePageExitMarker(marker: PageExitEvidence): boolean {
  try {
    globalThis.sessionStorage.setItem(PARSE_EXIT_STORAGE_KEY, JSON.stringify(marker));
    return true;
  } catch {
    return false;
  }
}

/**
 * Reads the tab's page-exit marker without removing it. It is evidence only
 * for the session that wrote it; a marker from another session is not evidence
 * here. `loadAll` clears it after a successful pass, when every source had a
 * chance to claim it (the page instance id inside scopes it to one job).
 */
export function readPageExitMarker(sessionId: string): PageExitEvidence | null {
  let raw: string | null = null;
  try {
    raw = globalThis.sessionStorage.getItem(PARSE_EXIT_STORAGE_KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<PageExitEvidence> | null;
    if (parsed === null || typeof parsed !== "object") return null;
    if (typeof parsed.sessionId !== "string" || typeof parsed.pageId !== "string" || typeof parsed.at !== "string") {
      return null;
    }
    if (parsed.sessionId !== sessionId) return null;
    return { sessionId: parsed.sessionId, pageId: parsed.pageId, at: parsed.at };
  } catch {
    return null;
  }
}

/** Drops a marker without using it (bfcache restore: the page instance is alive). */
export function clearPageExitMarker(): void {
  try {
    globalThis.sessionStorage.removeItem(PARSE_EXIT_STORAGE_KEY);
  } catch {
    // Nothing to clear when storage is unavailable.
  }
}

export function Parse({ repository, actor, matterId, refreshToken, onAddDocuments }: ParseProps) {
  const [state, setState] = useState<LoadState>({ phase: "loading" });
  const [busy, setBusy] = useState(false);
  // The asset this page is parsing and the stage it is on; null when idle.
  const [active, setActive] = useState<{ assetId: string; stage: ParseStage | null } | null>(null);
  const [sessionId] = useState(tabSessionId);
  const runningAsset = useRef<string | null>(null);
  const loadGeneration = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const [attempt, setAttempt] = useState(0);
  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  const refresh = useCallback(async () => {
    const generation = ++loadGeneration.current;
    const next = await loadAll(repository, actor, matterId, sessionId, {
      runningAsset: () => runningAsset.current,
      now: () => new Date().toISOString(),
    });
    if (generation === loadGeneration.current) setState(next);
  }, [repository, actor, matterId, sessionId]);

  useEffect(() => {
    void refresh();
    return () => { loadGeneration.current += 1; };
  }, [refresh, refreshToken, attempt]);

  useEffect(() => () => { abortRef.current?.abort(); }, []);

  // A page that owns a running job writes a synchronous exit marker as it
  // leaves. A reload or close of *this* document leaves a marker; another tab
  // that merely copies sessionStorage does not produce one, and a bfcache
  // round trip keeps this document alive, so it writes none and clears any
  // inherited marker when restored.
  useEffect(() => {
    const onPageHide = (event: PageTransitionEvent) => {
      if (event.persisted) return;
      if (runningAsset.current === null) return;
      writePageExitMarker({ sessionId, pageId: pageInstanceId(), at: new Date().toISOString() });
    };
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) clearPageExitMarker();
    };
    globalThis.addEventListener("pagehide", onPageHide);
    globalThis.addEventListener("pageshow", onPageShow);
    return () => {
      globalThis.removeEventListener("pagehide", onPageHide);
      globalThis.removeEventListener("pageshow", onPageShow);
    };
  }, [sessionId]);

  const onProgress = useCallback((assetId: string) => (event: ParseProgressEvent) => {
    setActive({ assetId, stage: stageAfter(event.stage) });
  }, []);

  const start = useCallback(
    async (assetId: string) => {
      if (runningAsset.current !== null) return;
      const controller = new AbortController();
      abortRef.current = controller;
      runningAsset.current = assetId;
      setBusy(true);
      setActive({ assetId, stage: "verify" });
      try {
        await parseSource(repository, actor, matterId, assetId, {
          sessionId,
          pageId: pageInstanceId(),
          signal: controller.signal,
          onProgress: onProgress(assetId),
        });
      } finally {
        abortRef.current = null;
        runningAsset.current = null;
        // Keep the live row until the finished state is read, so it never
        // falls back to the pre-job snapshot (未解析, 0%) in between.
        try {
          await refresh();
        } finally {
          setBusy(false);
          setActive(null);
        }
      }
    },
    [busy, repository, actor, matterId, refresh, onProgress, sessionId],
  );

  const resume = useCallback(
    async (assetId: string) => {
      if (runningAsset.current !== null) return;
      const controller = new AbortController();
      abortRef.current = controller;
      runningAsset.current = assetId;
      setBusy(true);
      // The first stage is the row's resumeFrom until a stage saves.
      setActive({ assetId, stage: null });
      try {
        await resumeParse(repository, actor, matterId, assetId, {
          sessionId,
          pageId: pageInstanceId(),
          signal: controller.signal,
          onProgress: onProgress(assetId),
        });
      } finally {
        abortRef.current = null;
        runningAsset.current = null;
        // Keep the live row until the finished state is read, so it never
        // falls back to the pre-job snapshot (未解析, 0%) in between.
        try {
          await refresh();
        } finally {
          setBusy(false);
          setActive(null);
        }
      }
    },
    [busy, repository, actor, matterId, refresh, onProgress, sessionId],
  );

  const retry = useCallback(
    async (assetId: string) => {
      if (runningAsset.current !== null) return;
      const controller = new AbortController();
      abortRef.current = controller;
      runningAsset.current = assetId;
      setBusy(true);
      setActive({ assetId, stage: "verify" });
      try {
        await retryParse(repository, actor, matterId, assetId, {
          sessionId,
          pageId: pageInstanceId(),
          signal: controller.signal,
          onProgress: onProgress(assetId),
        });
      } finally {
        abortRef.current = null;
        runningAsset.current = null;
        // Keep the live row until the finished state is read, so it never
        // falls back to the pre-job snapshot (未解析, 0%) in between.
        try {
          await refresh();
        } finally {
          setBusy(false);
          setActive(null);
        }
      }
    },
    [busy, repository, actor, matterId, refresh, onProgress, sessionId],
  );

  const cancel = useCallback(
    async (assetId: string) => {
      if (runningAsset.current === assetId) {
        abortRef.current?.abort();
        return;
      }
      await cancelParse(repository, actor, matterId, assetId, { sessionId });
      await refresh();
    },
    [repository, actor, matterId, refresh, sessionId],
  );

  const abandon = useCallback(
    async (assetId: string) => {
      if (busy) return;
      setBusy(true);
      try {
        await abandonParse(repository, actor, matterId, assetId, { sessionId: sessionId });
      } finally {
        setBusy(false);
        await refresh();
      }
    },
    [busy, repository, actor, matterId, refresh, sessionId],
  );

  if (state.phase === "loading") return <ParseLoading />;
  if (state.phase === "failed") {
    return (
      <ParsePanel
        view={describeParseRows([], false)}
        busy={false}
        loadError={PARSE_ERROR_MESSAGES[state.errorCode]}
        liveStage={{}}
        onStart={() => {}}
        onCancel={() => {}}
        onResume={() => {}}
        onAbandon={() => {}}
        onRetry={() => {}}
        onReload={reload}
        onAddDocuments={onAddDocuments}
      />
    );
  }

  const rows = buildRows(state.data).map((row) =>
    active !== null && row.assetId === active.assetId
      ? runningRow(row, active.stage ?? row.resumeFrom ?? row.stage ?? "verify")
      : row,
  );
  return (
    <ParsePanel
      view={describeParseRows(rows, busy)}
      busy={busy}
      liveStage={{}}
      onStart={start}
      onCancel={cancel}
      onResume={resume}
      onAbandon={abandon}
      onRetry={retry}
      onReload={reload}
      onAddDocuments={onAddDocuments}
    />
  );
}


function buildRows(data: Loaded): ParseRow[] {
  return buildParseRows({ assets: data.assets, states: data.states });
}

export interface LoadAllOptions {
  /** The asset this page instance is running right now, if any. */
  runningAsset?: () => string | null;
  /**
   * Overrides the tab's page-exit marker lookup. Scenario tests inject the
   * evidence explicitly; the app reads the marker sessionStorage wrote.
   */
  pageExit?: PageExitEvidence | null;
  now?: () => string;
}

/**
 * Reads every source of the matter. A job left running by a page that exited
 * is persisted as `interrupted` right away, but only with positive evidence:
 * the same session owns it *and* this tab carries the exit marker of the very
 * page instance that started it (or its lease already expired). A duplicated
 * or restored tab that merely copied sessionStorage has no marker, so it reads
 * the first page's live job as `running` and writes nothing.
 */
export async function loadAll(
  repository: LocalRepository,
  actor: Actor,
  matterId: string,
  sessionId: string,
  options: LoadAllOptions | (() => string | null) = {},
): Promise<LoadState> {
  const opts: LoadAllOptions = typeof options === "function" ? { runningAsset: options } : options;
  const runningAsset = opts.runningAsset ?? (() => null);
  const now = opts.now ?? (() => new Date().toISOString());
  const snapshot = await readMatterSources(repository, actor, matterId);
  if (!snapshot.ok) return { phase: "failed", errorCode: snapshot.errorCode };
  const assets = snapshot.data.assets.filter((asset) => asset.purpose === "source");
  const fromStorage = opts.pageExit === undefined;
  const pageExit = fromStorage ? readPageExitMarker(sessionId) : opts.pageExit;
  const states = new Map<string, SourceParseState>();
  for (const asset of assets) {
    const first = await readParseState(repository, actor, matterId, asset.id, { sessionId, now });
    if (first.status === "storage_unavailable") return { phase: "failed", errorCode: "STORAGE_UNAVAILABLE" };
    if (first.status === "missing") continue;
    if ((first.status === "running" || first.status === "interrupted") &&
      first.job.job.leaseOwner === sessionId && runningAsset() !== asset.id) {
      // A live lease means the owning page may still be running the job. Only
      // its exit marker (checked against the job's owner page id) can prove it
      // died; without one, leave the row and let the lease expire.
      if (first.status === "running" && pageExit === null) {
        states.set(asset.id, first);
        continue;
      }
      const marked = await markInterrupted(repository, actor, matterId, asset.id, {
        sessionId, now, orphanedJobId: first.job.job.id, pageExit,
      });
      if (!marked.ok && marked.errorCode !== "INVALID_INPUT") return { phase: "failed", errorCode: marked.errorCode };
      const again = await readParseState(repository, actor, matterId, asset.id, { sessionId, now });
      states.set(asset.id, again.status === "storage_unavailable" || again.status === "missing" ? first : again);
      continue;
    }
    states.set(asset.id, first);
  }
  // Every source had its chance to claim it; a marker that matched no live job
  // is spent and must not leak into a later read (or a duplicated tab).
  if (fromStorage && pageExit !== null) clearPageExitMarker();
  return { phase: "ready", data: { assets, states } };
}

function ParseLoading() {
  return (
    <section className="card v6-upload" aria-busy="true" data-testid="parse">
      <h2 className="card-title">解析材料</h2>
      <p className="muted">正在读取本机的解析记录…</p>
    </section>
  );
}

export interface ParsePanelProps {
  view: ParseView;
  busy: boolean;
  liveStage: Record<string, ParseStage>;
  loadError?: string | null;
  onStart: (assetId: string) => void;
  onCancel: (assetId: string) => void;
  onResume: (assetId: string) => void;
  onAbandon: (assetId: string) => void;
  onRetry: (assetId: string) => void;
  onReload: () => void;
  onAddDocuments?: () => void;
}

/**
 * Pure markup for every state. Exported so each S02 state (empty, in progress,
 * error, stale) and the scanned-PDF outcome can be rendered and inspected
 * without a browser.
 */
export function ParsePanel({
  view,
  busy,
  liveStage,
  loadError = null,
  onStart,
  onCancel,
  onResume,
  onAbandon,
  onRetry,
  onReload,
  onAddDocuments,
}: ParsePanelProps) {
  return (
    <section className="card v6-upload" data-testid="parse" data-parse-state={view.state} aria-labelledby="parse-title">
      <h2 className="card-title" id="parse-title">
        解析材料
      </h2>
      <p className="muted">解析全部在这台设备上完成，不会上传。</p>

      {loadError ? (
        <div className="notice" role="alert" data-testid="parse-load-error">
          <strong>尚未保存</strong>
          <p>{loadError}</p>
          <button type="button" className="btn btn-outline btn-sm" onClick={onReload}>
            重试
          </button>
        </div>
      ) : null}

      {view.state === "empty" && !loadError ? (
        <div className="v6-empty" data-testid="parse-empty">
          <p>还没有可解析的材料。</p>
          {onAddDocuments ? (
            <button type="button" className="btn btn-outline" onClick={onAddDocuments}>
              先上传材料
            </button>
          ) : null}
        </div>
      ) : null}

      {view.rows.length > 0 ? (
        <ul className="group v6-upload-rows" role="list" data-testid="parse-rows">
          {view.rows.map((row) => (
            <li
              key={row.assetId}
              className="filerow"
              data-testid={`parse-row-${row.assetId}`}
              data-state={row.state}
              data-stage={row.stage ?? ""}
            >
              <span className="file-ic" aria-hidden="true">
                ▤
              </span>
              <div className="v6-upload-file">
                <span className="file-name" data-testid={`parse-name-${row.assetId}`}>
                  {row.name}
                </span>
                {row.state === "pending" || row.state === "running" ? <ProgressLine row={row} live={liveStage[row.sourceId] ?? null} /> : null}
                <span className="field-hint" data-testid={`parse-detail-${row.assetId}`}>
                  {chunkSummary(row)}
                  {row.state === "parsed" || row.state === "partial" ? " · 已保存" : ""}
                </span>
                {row.errorMessage && row.state !== "running" ? (
                  <span className="field-hint" data-testid={`parse-error-${row.assetId}`}>
                    {row.errorMessage}（{row.errorCode}）
                  </span>
                ) : null}
              </div>
              <span
                className={`tag ${badgeTone(row) === "ok" ? "ok" : badgeTone(row) === "err" ? "risk" : "plain"}`}
                data-testid={`parse-status-${row.assetId}`}
              >
                {parseStatusLabel(row)}
              </span>
              {row.canCancel ? (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  data-testid={`parse-cancel-${row.assetId}`}
                  onClick={() => onCancel(row.assetId)}
                >
                  取消
                </button>
              ) : row.canStart ? (
                <button
                  type="button"
                  className="btn btn-default btn-sm"
                  data-testid={`parse-start-${row.assetId}`}
                  disabled={busy}
                  onClick={() => onStart(row.assetId)}
                >
                  解析
                </button>
              ) : null}
              <RowRecovery
                row={row}
                busy={busy}
                onResume={onResume}
                onAbandon={onAbandon}
                onRetry={onRetry}
                onAddDocuments={onAddDocuments}
              />
            </li>
          ))}
        </ul>
      ) : null}

      {view.state === "stale" ? (
        <div className="notice" role="alert" data-testid="parse-stale-notice">
          <span className="ic" aria-hidden="true">
            !
          </span>
          <span>
            上一次解析在保存的阶段之后中断了；它不会自己在后台继续。可以从已保存的阶段继续，或者放弃。
          </span>
        </div>
      ) : null}

      {view.state === "error" ? (
        <p className="field-hint" data-testid="parse-error-hint">
          有材料没有解析完成；它们不会成为可引用的事实来源。可以换一个文件、重试，或手动补充文字。
        </p>
      ) : null}
    </section>
  );
}

function ProgressLine({ row, live }: { row: ParseRow; live: ParseStage | null }) {
  const running = row.state === "running";
  const percent = row.state === "parsed" || row.state === "partial" ? 100 : Math.round((row.stageIndex / PARSE_STAGES.length) * 100);
  const counter = stageCounter(row, live);
  return (
    <>
      <div
        className="progress"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-label={`${row.name}：${running ? (live ? STAGE_LABELS[live] : (row.stageLabel ?? "解析中")) : parseStatusLabel(row)}`}
        data-testid={`parse-progress-${row.assetId}`}
      >
        <div className="bar" style={{ width: `${percent}%` }} />
      </div>
      {running && counter ? (
        <span className="field-hint" data-testid={`parse-stage-${row.assetId}`}>
          {counter}
          {row.progress?.total ? ` · ${row.progress.completed}/${row.progress.total}` : ""}
        </span>
      ) : null}
    </>
  );
}

function RowRecovery({
  row,
  busy,
  onResume,
  onAbandon,
  onRetry,
  onAddDocuments,
}: {
  row: ParseRow;
  busy: boolean;
  onResume: (assetId: string) => void;
  onAbandon: (assetId: string) => void;
  onRetry: (assetId: string) => void;
  onAddDocuments?: () => void;
}) {
  if (row.state === "interrupted") {
    return (
      <>
        <button
          type="button"
          className="btn btn-default btn-sm"
          data-testid={`parse-resume-${row.assetId}`}
          disabled={busy}
          onClick={() => onResume(row.assetId)}
        >
          从已保存阶段继续
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          data-testid={`parse-abandon-${row.assetId}`}
          disabled={busy}
          onClick={() => onAbandon(row.assetId)}
        >
          放弃
        </button>
      </>
    );
  }
  if (row.state === "failed" || row.state === "cancelled") {
    return (
      <>
        <button
          type="button"
          className="btn btn-outline btn-sm"
          data-testid={`parse-retry-${row.assetId}`}
          disabled={busy}
          onClick={() => onRetry(row.assetId)}
        >
          重试
        </button>
        {onAddDocuments ? (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            data-testid={`parse-replace-${row.assetId}`}
            onClick={onAddDocuments}
          >
            换一个文件
          </button>
        ) : null}
      </>
    );
  }
  if (row.state === "partial") {
    return (
      <>
        <button type="button" className="btn btn-outline btn-sm" data-testid={`parse-manual-${row.assetId}`} disabled>
          手动补充
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          data-testid={`parse-retry-${row.assetId}`}
          disabled={busy}
          onClick={() => onRetry(row.assetId)}
        >
          重试
        </button>
      </>
    );
  }
  return null;
}
