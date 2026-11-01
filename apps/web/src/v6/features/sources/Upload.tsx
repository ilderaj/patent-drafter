/**
 * V6-10 — the upload surface (S02 材料选择与字节保存).
 *
 * This file is deliberately thin. Every rule (content sniffing, limits, ZIP
 * checks, hashing, dedupe, atomic write, retry) lives in `ingest.ts`, and the
 * view model (`UploadRow`, `describeUploadRows`) is pure there too. Here we
 * only:
 *
 * - collect files from the picker or a drop,
 * - keep one row per picked file (a repeated pick of the same file is the same
 *   row, not a second upload),
 * - start `ingestFiles` and render its real stage/byte progress,
 * - let a file that has not been saved be removed or retried,
 * - offer 「没有现成文档，直接回答问题」, which creates no attachment at all.
 *
 * 「已保存」 is derived from a committed (or already stored) asset; a rejection
 * or a storage failure can never produce it. The same input can also be
 * exercised headlessly through the exported reducer, so the component holds no
 * business rule of its own.
 */
import { useCallback, useReducer, useRef, useState } from "react";
import type { Actor, LocalRepository } from "../../lib/repository.ts";
import {
  describeUploadRows,
  ingestFiles,
  rowFromProgress,
  type IngestFile,
  type IngestOutcome,
  type IngestProgress,
  type UploadRow,
} from "./ingest.ts";

export interface UploadItem {
  /** Stable across retries; the row key. */
  fileId: string;
  file: IngestFile;
  progress: IngestProgress | null;
  outcome: IngestOutcome | null;
}

export interface UploadState {
  items: UploadItem[];
  phase: "idle" | "saving";
  /** A failure of the whole batch, never of one file. */
  batchError: string | null;
}

export type UploadAction =
  | { type: "add"; entries: readonly { fileId: string; file: IngestFile }[] }
  | { type: "progress"; progress: IngestProgress }
  | { type: "settle"; outcomes: readonly IngestOutcome[] }
  | { type: "batch-error"; message: string }
  | { type: "remove"; fileId: string }
  | { type: "saving" }
  | { type: "idle" };

export const initialUploadState: UploadState = { items: [], phase: "idle", batchError: null };

export const UPLOAD_ACCEPT = ".pdf,.docx,.txt,.md,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg";

/** One file's identity as the user picked it; the same pick must not repeat. */
function fileKey(file: IngestFile): string {
  const lastModified = typeof (file as File).lastModified === "number" ? (file as File).lastModified : 0;
  return `${file.name}\u0000${file.size}\u0000${lastModified}`;
}

function isStored(item: UploadItem): boolean {
  return item.outcome?.status === "saved" || item.outcome?.status === "duplicate";
}

export function uploadReducer(state: UploadState, action: UploadAction): UploadState {
  switch (action.type) {
    case "add": {
      const knownIds = new Set(state.items.map((item) => item.fileId));
      const knownFiles = new Set(state.items.map((item) => fileKey(item.file)));
      const added: UploadItem[] = [];
      for (const entry of action.entries) {
        if (knownIds.has(entry.fileId)) continue;
        const key = fileKey(entry.file);
        if (knownFiles.has(key)) continue;
        knownFiles.add(key);
        added.push({ fileId: entry.fileId, file: entry.file, progress: null, outcome: null });
      }
      return added.length === 0 ? state : { ...state, items: [...state.items, ...added], batchError: null };
    }
    case "progress": {
      const index = state.items.findIndex((item) => item.fileId === action.progress.fileId);
      if (index < 0) return state;
      const items = [...state.items];
      items[index] = { ...items[index]!, progress: action.progress };
      return { ...state, items };
    }
    case "settle": {
      const byId = new Map(action.outcomes.map((outcome) => [outcome.fileId, outcome]));
      return {
        ...state,
        items: state.items.map((item) => {
          const outcome = byId.get(item.fileId);
          return outcome ? { ...item, outcome } : item;
        }),
      };
    }
    case "batch-error":
      return { ...state, batchError: action.message };
    case "remove": {
      // A stored asset is not removed here: deleting source material is a
      // later ticket, and a saved row must not pretend to be gone.
      const item = state.items.find((candidate) => candidate.fileId === action.fileId);
      if (!item || isStored(item)) return state;
      return { ...state, items: state.items.filter((candidate) => candidate.fileId !== action.fileId) };
    }
    case "saving":
      return { ...state, phase: "saving", batchError: null };
    case "idle":
      return { ...state, phase: "idle" };
  }
}

/** The files still owed a save: never tried, cancelled, or failed for storage. */
export function pendingForSave(state: UploadState): UploadItem[] {
  return state.items.filter(
    (item) => item.outcome === null || item.outcome.status === "failed" || item.outcome.status === "cancelled",
  );
}

export function rowsFromItems(items: readonly UploadItem[]): UploadRow[] {
  return items.map((item) => {
    const progress: IngestProgress = item.progress ?? {
      fileId: item.fileId,
      name: item.file.name,
      stage: "selected",
      receivedBytes: 0,
      totalBytes: item.file.size,
    };
    return rowFromProgress(progress, item.outcome);
  });
}

export interface UploadProps {
  repository: LocalRepository;
  actor: Actor;
  matterId: string;
  /**
   * S02: answering with no material is always available. The caller navigates
   * to the question flow; this component writes nothing for it.
   */
  onAnswerWithoutDocuments: () => void;
  /** Called once a save batch settles, so sibling views can re-read the repository. */
  onSettled?: () => void;
}

export function newFileId(): string {
  return globalThis.crypto.randomUUID();
}

export function Upload({ repository, actor, matterId, onAnswerWithoutDocuments, onSettled }: UploadProps) {
  const [state, dispatch] = useReducer(uploadReducer, initialUploadState);
  const [dragOver, setDragOver] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const addFiles = useCallback((files: readonly File[]) => {
    if (files.length === 0) return;
    dispatch({
      type: "add",
      entries: files.map((file) => ({ fileId: newFileId(), file: file as IngestFile })),
    });
  }, []);

  const removeFile = useCallback((fileId: string) => dispatch({ type: "remove", fileId }), []);

  const save = useCallback(() => {
    if (state.phase === "saving") return;
    const items = pendingForSave(state);
    if (items.length === 0) return;
    const controller = new AbortController();
    abortRef.current = controller;
    dispatch({ type: "saving" });
    ingestFiles(
      repository,
      actor,
      matterId,
      items.map((item) => item.file),
      {
        fileIds: items.map((item) => item.fileId),
        signal: controller.signal,
        onProgress: (progress) => dispatch({ type: "progress", progress }),
      },
    )
      .then((outcomes) => dispatch({ type: "settle", outcomes }))
      .catch(() => dispatch({ type: "batch-error", message: "保存过程中发生意外错误；没有显示为已保存的文件都还没有存好。" }))
      .finally(() => {
        abortRef.current = null;
        dispatch({ type: "idle" });
        onSettled?.();
      });
  }, [actor, matterId, onSettled, repository, state]);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const view = describeUploadRows(rowsFromItems(state.items));
  const pendingCount = pendingForSave(state).length;

  return (
    <UploadPanel
      view={view}
      busy={state.phase === "saving"}
      pendingCount={pendingCount}
      batchError={state.batchError}
      dragOver={dragOver}
      onDragOver={setDragOver}
      onFiles={addFiles}
      onRemove={removeFile}
      onSave={save}
      onCancel={cancel}
      onAnswerWithoutDocuments={onAnswerWithoutDocuments}
    />
  );
}

export interface UploadPanelProps {
  view: ReturnType<typeof describeUploadRows>;
  busy: boolean;
  pendingCount: number;
  batchError?: string | null;
  dragOver?: boolean;
  onDragOver?: (over: boolean) => void;
  onFiles: (files: readonly File[]) => void;
  onRemove: (fileId: string) => void;
  onSave: () => void;
  onCancel: () => void;
  onAnswerWithoutDocuments: () => void;
}

/**
 * Pure markup for every state. Exported so the states S02 names (in progress,
 * rejected, storage unavailable, saved) can be rendered and inspected without
 * a browser.
 */
export function UploadPanel({
  view,
  busy,
  pendingCount,
  batchError = null,
  dragOver = false,
  onDragOver,
  onFiles,
  onRemove,
  onSave,
  onCancel,
  onAnswerWithoutDocuments,
}: UploadPanelProps) {
  const canSave = !busy && pendingCount > 0;
  return (
    <section className="card v6-upload" data-testid="upload" aria-labelledby="upload-title">
      <h1 className="v6-title" id="upload-title">
        上传材料
      </h1>
      <p className="muted">文件只保存在这台设备上，不会上传到服务器。</p>

      <label
        className={dragOver ? "dropzone drag" : "dropzone"}
        data-testid="upload-dropzone"
        onDragOver={(event) => {
          event.preventDefault();
          onDragOver?.(true);
        }}
        onDragLeave={() => onDragOver?.(false)}
        onDrop={(event) => {
          event.preventDefault();
          onDragOver?.(false);
          onFiles(Array.from(event.dataTransfer?.files ?? []));
        }}
      >
        <input
          type="file"
          multiple
          accept={UPLOAD_ACCEPT}
          data-testid="upload-input"
          style={{ position: "absolute", width: 1, height: 1, opacity: 0, overflow: "hidden" }}
          onChange={(event) => {
            const picked = Array.from(event.currentTarget.files ?? []);
            // Allow picking the same file again; the reducer keeps one row and
            // ingestion dedupes the bytes, so no second asset is created.
            event.currentTarget.value = "";
            onFiles(picked);
          }}
        />
        <span className="drop-ic" aria-hidden="true">
          ＋
        </span>
        <span>拖入文件，或点这里选择</span>
        <span className="hint">
          PDF、DOCX、TXT、MD 最大 50 MiB；PNG、JPEG 最大 8 MiB 且不超过 16 MP。同时最多读取 3 个文件。
        </span>
      </label>

      {view.rows.length > 0 ? (
        <ul className="v6-upload-rows" role="list" data-testid="upload-rows">
          {view.rows.map((row) => (
            <li
              key={row.fileId}
              className="file-row"
              data-testid={`upload-row-${row.fileId}`}
              data-file-id={row.fileId}
              data-stage={row.stage}
              data-saved={row.saved ? "true" : "false"}
            >
              <span className="ficon" aria-hidden="true">
                ▤
              </span>
              <div className="v6-upload-file">
                <span className="file-name">{row.name}</span>
                <div
                  className="progress-root"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(row.fraction * 100)}
                  aria-label={`${row.name}：${row.label}`}
                >
                  <div className="progress-indicator" style={{ width: `${Math.round(row.fraction * 100)}%` }} />
                </div>
              </div>
              <span
                className={row.error !== null ? "badge badge-err" : row.saved ? "badge badge-ok" : "badge badge-outline"}
                data-testid={`upload-status-${row.fileId}`}
              >
                {row.label}
              </span>
              {row.canRemove ? (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  data-testid={`upload-remove-${row.fileId}`}
                  disabled={busy}
                  onClick={() => onRemove(row.fileId)}
                  aria-label={`移除 ${row.name}`}
                >
                  移除
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {view.hasProblems ? (
        <div className="notice" role="alert" data-testid="upload-problems">
          <span className="ic" aria-hidden="true">
            !
          </span>
          <span>有文件没有保存，它们不会成为案件材料；请移除后换一个文件。</span>
        </div>
      ) : null}
      {batchError ? (
        <div className="notice" role="alert" data-testid="upload-batch-error">
          {batchError}
        </div>
      ) : null}
      {view.allSaved ? (
        <p className="muted" data-testid="upload-all-saved" role="status" aria-live="polite">
          材料已保存在本机。可以继续添加，或进入下一步整理。
        </p>
      ) : null}

      <div className="v6-upload-actions">
        {busy ? (
          <button type="button" className="btn btn-outline" data-testid="upload-cancel" onClick={onCancel}>
            取消
          </button>
        ) : null}
        <button type="button" className="btn btn-default" data-testid="upload-save" onClick={onSave} disabled={!canSave}>
          {busy ? "正在保存…" : pendingCount > 1 ? `保存 ${pendingCount} 个文件` : "保存材料"}
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          data-testid="answer-without-documents"
          onClick={onAnswerWithoutDocuments}
        >
          没有现成文档，直接回答问题
        </button>
      </div>
      <p className="field-hint">没有现成文档也可以直接回答问题；那不会生成任何虚拟附件。</p>
    </section>
  );
}
