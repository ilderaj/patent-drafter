/**
 * V6-12 — the figure surface (S02 附图: drawing library and a target's figure set).
 *
 * Thin by design. Every rule — byte validation, the 8 MiB / 16 MP budget,
 * import/delete, 1..n numbering, the figure-set compare-and-swap, the export
 * gate and the stale check — lives in `drawings.ts`. Here we only:
 *
 * - load the persisted library and figure sets (`loadFigurePanel`),
 * - import / delete drawings and append or remove a figure through that module,
 * - render the S02 states: empty, loading, failed (code and recovery) and stale
 *   (the draft on screen was built on an older figure set).
 *
 * Nothing is invented: the list shows only drawings whose row and asset are
 * persisted, with the dimensions the decoder verified. There is no thumbnail,
 * no optimistic row and no "已保存" before the commit returned.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { Actor, LocalRepository } from "../../lib/repository.ts";
import {
  DRAWING_MAX_BYTES,
  bindFigures,
  deleteDrawing,
  figureErrorMessage,
  importDrawing,
  loadFigurePanel,
  type FigureEntryInput,
  type FigureError,
  type FigurePanelRevision,
  type FigurePanelView,
  type LibraryDrawing,
} from "./drawings.ts";

export interface FiguresProps {
  repository: LocalRepository;
  actor: Actor;
  matterId: string;
  /** The target whose figure set is shown; none means library only. */
  targetId?: string | null;
  /** The figure revision the draft on screen was built against, if any. */
  draftFigureRevisionId?: string | null;
  /** Bumped by the shell to re-read persisted state. */
  refreshToken?: number;
  /** Called after an import, delete or bind committed. */
  onSettled?: () => void;
}

const ACCEPT = "image/png,image/jpeg,.png,.jpg,.jpeg";

/** "128 × 96 · PNG · 12.3 KB" from persisted, decoder-verified values. */
export function drawingSummary(item: LibraryDrawing): string {
  const kind = item.drawing.mime === "image/png" ? "PNG" : "JPEG";
  return `${item.drawing.width} × ${item.drawing.height} · ${kind} · ${formatBytes(item.asset.byteLength)}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

/**
 * The entries a bind sends when one drawing is appended as the next figure.
 * Existing entries keep their figure ids, numbers and numerals; the new one
 * gets n+1 and no numerals yet.
 */
export function appendEntry(
  current: FigurePanelRevision,
  drawingId: string,
  figureId: string,
): FigureEntryInput[] {
  const entries = current.entries.map((entry) => ({ ...entry, numerals: copyNumerals(entry.numerals) }));
  const number = entries.length + 1;
  return [...entries, { figureId, number, title: `图${number}`, drawingId, numerals: [] }];
}

/**
 * The entries after one figure is removed, renumbered 1..n in their order.
 * The remaining figures keep their numerals.
 */
export function removeEntry(current: FigurePanelRevision, figureId: string): FigureEntryInput[] {
  return current.entries
    .filter((entry) => entry.figureId !== figureId)
    .sort((a, b) => a.number - b.number)
    .map((entry, index) => ({ ...entry, number: index + 1, numerals: copyNumerals(entry.numerals) }));
}

function copyNumerals(numerals: FigurePanelRevision["entries"][number]["numerals"]): FigureEntryInput["numerals"] {
  return numerals.map((numeral) => ({ value: numeral.value, label: numeral.label }));
}

/**
 * The empty base for a target whose first set row has not been written yet.
 * The target already names its first revision id; binding with that id creates
 * the first version at that pointer instead of inventing a second one.
 */
export function unboundFigureRevision(target: { figureRevisionId: string }): FigurePanelRevision {
  return { id: target.figureRevisionId, parentId: null, hash: "", createdAt: "", entries: [] };
}

type LoadState = { phase: "loading" } | { phase: "ready"; view: FigurePanelView };

export function Figures({
  repository,
  actor,
  matterId,
  targetId = null,
  draftFigureRevisionId = null,
  refreshToken = 0,
  onSettled,
}: FiguresProps) {
  const [state, setState] = useState<LoadState>({ phase: "loading" });
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<FigureError | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadFigurePanel(repository, actor, matterId, { targetId, draftFigureRevisionId }).then(
      (view) => {
        if (!cancelled) setState({ phase: "ready", view });
      },
      () => {
        if (!cancelled) {
          setState({ phase: "ready", view: { kind: "storage_unavailable", message: figureErrorMessage("STORAGE_UNAVAILABLE") } });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [repository, actor, matterId, targetId, draftFigureRevisionId, refreshToken, reloadKey]);

  const settle = useCallback(
    (result: { ok: true } | { ok: false; error: FigureError }) => {
      if (!alive.current) return;
      setBusy(false);
      setActionError(result.ok ? null : result.error);
      // Always re-read: after a failure the persisted state is what the user sees.
      setReloadKey((key) => key + 1);
      if (result.ok) onSettled?.();
    },
    [onSettled],
  );

  const onImport = useCallback(
    async (file: File) => {
      setBusy(true);
      setActionError(null);
      if (file.size > DRAWING_MAX_BYTES) {
        settle({ ok: false, error: { code: "IMAGE_TOO_LARGE", message: figureErrorMessage("IMAGE_TOO_LARGE") } });
        return;
      }
      let bytes: Uint8Array;
      try {
        bytes = new Uint8Array(await file.arrayBuffer());
      } catch {
        settle({ ok: false, error: { code: "INVALID_INPUT", message: "无法读取这个文件。" } });
        return;
      }
      settle(await importDrawing(repository, actor, matterId, { bytes, fileName: file.name }));
    },
    [repository, actor, matterId, settle],
  );

  const onDelete = useCallback(
    async (drawingId: string) => {
      setBusy(true);
      setActionError(null);
      settle(await deleteDrawing(repository, actor, matterId, drawingId));
    },
    [repository, actor, matterId, settle],
  );

  const bind = useCallback(
    async (current: FigurePanelRevision, entries: FigureEntryInput[]) => {
      if (targetId === null) return;
      setBusy(true);
      setActionError(null);
      settle(await bindFigures(repository, actor, matterId, { targetId, baseFigureRevisionId: current.id, entries }));
    },
    [repository, actor, matterId, targetId, settle],
  );

  if (state.phase === "loading") return <FiguresLoading />;
  return (
    <FiguresPanel
      view={state.view}
      busy={busy}
      actionError={actionError}
      onImport={onImport}
      onDelete={onDelete}
      onAppend={(current, drawingId) => bind(current, appendEntry(current, drawingId, globalThis.crypto.randomUUID()))}
      onRemove={(current, figureId) => bind(current, removeEntry(current, figureId))}
      onReload={() => setReloadKey((key) => key + 1)}
    />
  );
}

export function FiguresLoading() {
  return (
    <section className="card v6-upload" aria-busy="true" data-testid="figures" data-figures-state="loading">
      <h2 className="card-title">附图</h2>
      <p className="muted">正在读取本机的附图记录…</p>
    </section>
  );
}

export interface FiguresPanelProps {
  view: FigurePanelView;
  busy: boolean;
  actionError?: FigureError | null;
  onImport: (file: File) => void;
  onDelete: (drawingId: string) => void;
  onAppend: (current: FigurePanelRevision, drawingId: string) => void;
  onRemove: (current: FigurePanelRevision, figureId: string) => void;
  onReload: () => void;
}

/**
 * Pure markup for every state, exported so each S02 state can be rendered and
 * inspected without a browser.
 */
export function FiguresPanel({
  view,
  busy,
  actionError = null,
  onImport,
  onDelete,
  onAppend,
  onRemove,
  onReload,
}: FiguresPanelProps) {
  if (view.kind === "loading") return <FiguresLoading />;
  const data = "data" in view ? view.data : null;
  const targetId = view.kind === "library" ? view.targetId : null;
  const target = data && targetId !== null ? (data.targets.find((item) => item.id === targetId) ?? null) : null;
  const current = data && targetId ? (data.revisions.get(targetId) ?? null) : null;
  // A target whose first figure-set row is absent still names its first
  // revision id; binding against that id creates the first version.
  const bindBase = current ?? (target !== null ? unboundFigureRevision(target) : null);
  const gate = data && targetId ? data.gate : null;
  const bound = new Set(current?.entries.map((entry) => entry.drawingId).filter((id): id is string => id !== null) ?? []);
  const drawingsById = new Map((data?.drawings ?? []).map((item) => [item.drawing.id, item]));

  return (
    <section className="card v6-upload" data-testid="figures" data-figures-state={view.kind} aria-labelledby="figures-title">
      <h2 className="card-title" id="figures-title">
        附图
      </h2>
      <p className="muted">PNG 或 JPEG，单张不超过 8 MiB、16 MP；超限会被拒绝，不会被缩小后保存。</p>

      {view.kind === "storage_unavailable" || view.kind === "failed" ? (
        <div className="notice" role="alert" data-testid="figures-load-error">
          <strong>无法读取附图</strong>
          <p>
            {view.message}
            {view.kind === "failed" ? `（${view.code}）` : ""}
          </p>
          <button type="button" className="btn btn-outline btn-sm" onClick={onReload}>
            重试
          </button>
        </div>
      ) : null}

      {actionError ? (
        <div className="notice" role="alert" data-testid="figures-action-error" data-code={actionError.code}>
          <strong>未保存</strong>
          <p>
            {actionError.message}（{actionError.code}）
          </p>
          {actionError.code === "INPUT_STALE" ? (
            <button type="button" className="btn btn-outline btn-sm" onClick={onReload}>
              刷新图集
            </button>
          ) : null}
        </div>
      ) : null}

      {view.kind === "library" && view.stale ? (
        <div className="notice" role="status" data-testid="figures-stale">
          <strong>图集已更新</strong>
          <p>正文是按旧图集写的，图号可能已对不上。导出前请按当前图集检查正文。</p>
        </div>
      ) : null}

      {data || view.kind === "empty" ? (
        <label className="btn btn-outline btn-sm" data-testid="figures-import" aria-disabled={busy}>
          导入附图
          <input
            type="file"
            accept={ACCEPT}
            hidden
            disabled={busy}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (file) onImport(file);
            }}
          />
        </label>
      ) : null}

      {view.kind === "empty" || (data !== null && data.drawings.length === 0) ? (
        <div className="v6-empty" data-testid="figures-empty">
          <p>附图库里还没有图。导入 PNG 或 JPEG 后才能编入图集。</p>
        </div>
      ) : null}

      {data && data.drawings.length > 0 ? (
        <ul className="group v6-upload-rows" role="list" data-testid="figures-library">
          {data.drawings.map((item) => (
            <li key={item.drawing.id} className="filerow" data-testid={`figure-row-${item.drawing.id}`}>
              <span className="file-ic" aria-hidden="true">
                ▣
              </span>
              <div className="v6-upload-file">
                <span className="file-name">{item.asset.originalName}</span>
                <span className="field-hint" data-testid={`figure-detail-${item.drawing.id}`}>
                  {drawingSummary(item)} · {item.drawing.sha256.slice(0, 12)}
                </span>
              </div>
              {bound.has(item.drawing.id) ? <span className="badge badge-ok">已编入图集</span> : null}
              {bindBase && !bound.has(item.drawing.id) ? (
                <button
                  type="button"
                  className="btn btn-default btn-sm"
                  disabled={busy}
                  data-testid={`figure-append-${item.drawing.id}`}
                  onClick={() => onAppend(bindBase, item.drawing.id)}
                >
                  编入图集
                </button>
              ) : null}
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={busy}
                data-testid={`figure-delete-${item.drawing.id}`}
                onClick={() => onDelete(item.drawing.id)}
              >
                删除
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {data && targetId === null ? (
        <p className="field-hint" data-testid="figures-no-target">
          {data.targets.length === 0 ? "案件还没有目标；目标建立后才能绑定图集。" : "选择一个目标后才能编排它的图集。"}
        </p>
      ) : null}

      {data && targetId !== null && current === null ? (
        <div className="notice" role="status" data-testid="figures-set-missing">
          <strong>找不到这个目标的图集</strong>
          <p>这个目标还没有第一版图集。把图库中的图编入后，第一版图集将按目标当前的图集版本创建；不会自动加入任何图。</p>
        </div>
      ) : null}

      {current ? (
        <div data-testid="figures-set" data-revision={current.id}>
          <h3 className="card-title">当前图集</h3>
          <p className="field-hint" data-testid="figures-set-version">
            版本 {current.id.slice(0, 8)} · {current.entries.length} 张图
          </p>
          {current.entries.length === 0 ? (
            <p className="muted" data-testid="figures-set-empty">
              图集为空。正文里引用的图号会在导出时被拦下。
            </p>
          ) : (
            <ol className="group v6-upload-rows" data-testid="figures-set-entries">
              {current.entries.map((entry) => {
                const drawing = entry.drawingId === null ? null : (drawingsById.get(entry.drawingId) ?? null);
                return (
                  <li key={entry.figureId} className="filerow" data-testid={`figure-entry-${entry.number}`}>
                    <span className="file-name">
                      图{entry.number} {entry.title === `图${entry.number}` ? "" : entry.title}
                    </span>
                    <span className="field-hint">
                      {drawing ? drawingSummary(drawing) : "附图已不在图库中"}
                    </span>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={busy}
                      data-testid={`figure-remove-${entry.number}`}
                      onClick={() => onRemove(current, entry.figureId)}
                    >
                      移出图集
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      ) : null}

      {gate && !gate.allowed ? (
        <div className="notice" role="alert" data-testid="figures-gate-blocked">
          <strong>导出会被拦下</strong>
          <ul>
            {gate.reasons.map((reason, index) => (
              <li key={`${reason.code}-${reason.resourceId ?? index}`} data-code={reason.code}>
                {figureErrorMessage(reason.code)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
