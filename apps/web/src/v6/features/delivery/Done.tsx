import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ExportSession,
  type ExportFileView,
  type ExportSessionOptions,
  type ExportSessionState,
} from "./export-adapter.ts";

export interface DoneProps extends Omit<ExportSessionOptions, "passphrase"> {
  initialPassphrase?: string;
  refreshToken?: number;
}

const STATUS_LABELS: Readonly<Record<ExportFileView["status"], string>> = Object.freeze({
  ready: "可下载",
  unavailable: "不可下载",
  failed: "生成失败",
});

const REASON_TABS: Readonly<Record<string, string>> = Object.freeze({
  CHECK_REQUIRED: "check",
  CONFIRMATION_REQUIRED: "draft",
  APPROVAL_REQUIRED: "deliver",
  INPUT_STALE: "overview",
  STALE_BINDING: "overview",
  MISSING_BYTES: "sources",
  BAD_DRAWING: "sources",
  DUPLICATE_FIGURE_NUMBER: "sources",
  INVALID_AST: "draft",
  GATE_BLOCKED: "overview",
});

const ERROR_LABELS: Readonly<Record<string, string>> = Object.freeze({
  ENTITLEMENT_REQUIRED: "需要本地完整内容权限。",
  STALE_BINDING: "案件快照已变化，请重新检查并导出。",
  INPUT_STALE: "草稿输入与当前案件不一致。",
  CHECK_REQUIRED: "需要当前快照和规则包下的有效检查。",
  CONFIRMATION_REQUIRED: "仍有内容或风险确认未完成。",
  APPROVAL_REQUIRED: "需要与当前检查和确认相符的内部批准。",
  MISSING_BYTES: "有引用的原始文件字节不可用。",
  BAD_DRAWING: "有附图无法通过文件检查。",
  DUPLICATE_FIGURE_NUMBER: "附图编号需要修正。",
  INVALID_AST: "草稿结构需要修复。",
  GATE_BLOCKED: "当前导出门禁阻止生成。",
  FORMAT_UNAVAILABLE: "此格式当前不可用。",
  CACHE_EXPIRED: "导出缓存已超过七天，请重新导出。",
  STORAGE_UNAVAILABLE: "本机存储暂时不可用。",
});

export function DoneHeader({ route, testOutput = false }: { route: ExportSessionOptions["route"]; testOutput?: boolean }) {
  const nextStep = route === "cn_um" || route === "cn_invention"
    ? "下一步：使用官方客户端校验材料并办理递交；需要时可请代理师协助。"
    : "下一步：安排专业翻译，再由适格人员核对和办理。";
  return <header className="stack-2">
    <h1 className="v6-title">交付材料</h1>
    <p className="notice" data-testid="done-preparation-label">申请准备材料</p>
    {testOutput ? <p className="notice" role="status" data-testid="done-test-output-label">
      测试输出：本地固定测试结果，非真实 AI 生成或正式申请稿。
    </p> : null}
    <p className="muted">{nextStep}</p>
    <p className="field-hint">产品不代为提交。</p>
  </header>;
}

/** Completion page backed by ExportSession; downloads are hash-checked at click time. */
export function Done(props: DoneProps) {
  const [passphrase, setPassphrase] = useState(props.initialPassphrase ?? "");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<{ code: string; message: string } | null>(null);
  const session = useMemo(() => new ExportSession({ ...props, passphrase }), [
    props.repository,
    props.actor,
    props.matterId,
    props.targetId,
    props.route,
    props.access,
    props.role,
    props.checkResult,
    props.activeRulePackVersion,
    props.filesAvailable,
    props.confirmationMode,
    props.revisions,
    props.now,
    props.renderReport,
  ]);
  const [state, setState] = useState<ExportSessionState>(() => session.getSnapshot());
  const previousRefreshToken = useRef(props.refreshToken);

  useEffect(() => {
    const unsubscribe = session.subscribe(setState);
    void session.load();
    return unsubscribe;
  }, [session]);

  useEffect(() => {
    if (previousRefreshToken.current === props.refreshToken) return;
    previousRefreshToken.current = props.refreshToken;
    void session.refresh();
  }, [session, props.refreshToken]);

  useEffect(() => {
    session.setPassphrase(passphrase);
  }, [session, passphrase]);

  const createExport = async () => {
    if (busy || !state.gate?.allowed || !passphrase.trim()) return;
    setBusy(true);
    setActionError(null);
    const result = await session.createExport();
    if (!result.ok) setActionError(result.error);
    setBusy(false);
  };

  const download = async (file: ExportFileView) => {
    if (busy || file.status !== "ready") return;
    setBusy(true);
    setActionError(null);
    const result = await session.download(file.id);
    if (!result.ok) {
      setActionError(result.error);
      await session.refresh();
      setBusy(false);
      return;
    }
    const buffer = new ArrayBuffer(result.bytes.byteLength);
    new Uint8Array(buffer).set(result.bytes);
    const url = URL.createObjectURL(new Blob([buffer], { type: result.file.mime }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = result.file.name;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    setBusy(false);
  };

  if (state.phase === "loading") return <section className="v6-page" data-testid="done-page" data-state="loading" aria-busy="true">
    <DoneHeader route={props.route} />
    <p className="muted">正在读取当前案件、门禁和本机导出记录。</p>
    <div className="skeleton v6-skeleton" />
  </section>;

  return <DoneView
    route={props.route}
    state={state}
    passphrase={passphrase}
    busy={busy}
    actionError={actionError}
    onPassphrase={setPassphrase}
    onRefresh={() => session.refresh()}
    onCreate={() => createExport()}
    onDownload={download}
  />;
}

export interface DoneViewProps {
  route: ExportSessionOptions["route"];
  state: ExportSessionState;
  passphrase: string;
  busy: boolean;
  actionError: { code: string; message: string } | null;
  onPassphrase: (value: string) => void;
  onRefresh: () => void | Promise<void>;
  onCreate: () => void | Promise<void>;
  onDownload: (file: ExportFileView) => void | Promise<void>;
}

/** Exported for static state rendering and shell composition. */
export function DoneView({ route, state, passphrase, busy, actionError, onPassphrase, onRefresh, onCreate, onDownload }: DoneViewProps) {
  const hasUnavailableRecord = state.files.some((file) => file.status !== "ready");
  const actionLabel = hasUnavailableRecord ? "重新导出材料包" : state.record ? "再次导出材料包" : "生成材料包";
  return <main className="v6-page" data-testid="done-page" data-state={state.phase}>
    <DoneHeader route={route} testOutput={state.testOutput} />
    <div className="row" style={{ justifyContent: "flex-end" }}>
      <button type="button" className="btn btn-outline btn-sm" data-testid="done-refresh" onClick={() => void onRefresh()}>刷新状态</button>
    </div>

    {state.phase === "stale" ? <p className="notice" role="status" data-testid="done-stale">
      {state.files.some((file) => file.unavailableReasons.some((reason) => reason.code === "CACHE_EXPIRED"))
        ? "导出缓存已超过七天（CACHE_EXPIRED）；旧文件不能再下载，请重新导出。"
        : "旧导出不是当前版本（STALE_BINDING）；文件只保留说明，不能下载，请重新导出。"}
    </p> : null}

    {state.phase === "error" ? <section className="notice stack-2" role="alert" data-testid="done-read-error" data-code={state.error?.code}>
      <strong>导出未完成或交付状态不可用（{state.error?.code}）</strong>
      <p>{state.error?.message}</p>
      <button type="button" className="btn btn-outline btn-sm" onClick={() => void onRefresh()}>重试读取或导出</button>
    </section> : null}

    <section className="stack-2" data-testid="done-gate">
      <h2 className="card-title">导出前置条件</h2>
      {state.gate?.allowed
        ? <p role="status">当前 SnapshotRef、检查和确认记录允许生成材料。</p>
        : <div className="notice" role="status">
            <strong>暂不能生成材料</strong>
            {state.gate?.reasons.length ? <ul>{state.gate.reasons.map((reason, index) => <li key={`${reason.code}-${reason.resourceId ?? ""}-${index}`}>
              <code>{reason.code}</code>{reason.resourceId ? ` · ${reason.resourceId}` : ""} · {ERROR_LABELS[reason.code] ?? "请检查当前案件状态。"}
              {state.snapshot ? <a className="btn btn-outline btn-sm" style={{ marginLeft: "0.5rem" }} data-testid={`done-reason-link-${reason.code}`}
                href={`/v6/matters/${state.snapshot.matterId}/targets/${state.snapshot.targetId}/${REASON_TABS[reason.code] ?? "overview"}`}>去处理</a> : null}
            </li>)}</ul> : <p>{state.error?.message ?? "当前目标没有可用的导出门禁结果。"}</p>}
          </div>}
      {state.inputStale ? <p role="status">草稿输入陈旧（INPUT_STALE）。</p> : null}
    </section>

    <section className="stack-2" data-testid="done-files">
      <h2 className="card-title">文件</h2>
      {state.files.length === 0
        ? <p className="muted">本机尚无导出文件。</p>
        : <ul className="stack-2" style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {state.files.map((file) => <li className="v6-entry row-between" key={file.id} data-testid={`done-file-${file.id}`} data-status={file.status}>
              <div className="stack-1" style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
                <strong style={{ display: "block" }}>{file.name}</strong>
                <span className="muted" style={{ display: "block" }}>{file.bytes} bytes · SHA-256 {file.sha256 ? file.sha256.slice(0, 12) : "—"} · {STATUS_LABELS[file.status]}</span>
                {file.unavailableReasons.map((reason, index) => <span className="field-hint" style={{ display: "block" }} key={`${reason.code}-${index}`}>
                  {reason.code}{reason.resourceId ? ` · ${reason.resourceId}` : ""} · {ERROR_LABELS[reason.code] ?? "文件当前不可用。"}
                </span>)}
              </div>
              {file.status === "ready" ? <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => void onDownload(file)}>下载</button> : null}
            </li>)}
          </ul>}
    </section>

    <section className="stack-2" data-testid="done-formats">
      <h2 className="card-title">格式状态</h2>
      {state.unavailableFormats.map((format) => <p className="notice" key={format.format} data-testid={`done-format-${format.format}`}>
        <strong>{format.format.toUpperCase()} · {format.code}</strong><br />{format.reason}
      </p>)}
    </section>

    <section className="stack-2" data-testid="done-export-action">
      <label className="field">
        <span className="field-label">patentpack 备份口令</span>
        <input className="input" type="password" autoComplete="new-password" value={passphrase}
          onChange={(event) => onPassphrase(event.currentTarget.value)} data-testid="done-passphrase" />
        <span className="field-hint">口令只用于本机加密，不会保存。</span>
      </label>
      <button type="button" className="btn btn-default" data-testid="done-export-button"
        disabled={busy || !state.gate?.allowed || passphrase.trim().length === 0}
        onClick={() => void onCreate()}>
        {busy ? "正在本机生成或校验文件…" : actionLabel}
      </button>
      {actionError ? <div className="notice" role="alert" data-testid="done-action-error" data-code={actionError.code}>
        <strong>操作未完成（{actionError.code}）</strong><p>{actionError.message}</p>
      </div> : null}
    </section>
  </main>;
}

export default Done;
