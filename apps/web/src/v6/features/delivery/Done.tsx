import React, { useEffect, useMemo, useRef, useState } from "react";
import { technicalDetailLabel, userMessageFor } from "../../lib/user-messages.ts";
import { Button, Callout, Icon } from "../../components/ui/index.ts";
import {
  ExportSession,
  type ExportFileView,
  type ExportSessionOptions,
  type ExportSessionState,
} from "./export-adapter.ts";

export interface DoneProps extends Omit<ExportSessionOptions, "passphrase"> {
  initialPassphrase?: string;
  refreshToken?: number;
  /** Counts from the current draft, used for human-readable file descriptions. */
  documentStats?: { claims: number; paragraphs: number; figures: number };
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

function errorText(code: string): string {
  return userMessageFor(code);
}

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
    mode={props.confirmationMode === "self_read" ? "self" : "professional"}
    documentStats={props.documentStats}
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
  mode?: "self" | "professional";
  documentStats?: { claims: number; paragraphs: number; figures: number };
  state: ExportSessionState;
  passphrase: string;
  busy: boolean;
  actionError: { code: string; message: string } | null;
  onPassphrase: (value: string) => void;
  onRefresh: () => void | Promise<void>;
  onCreate: () => void | Promise<void>;
  onDownload: (file: ExportFileView) => void | Promise<void>;
}

function formatSize(bytes: number): string {
  if (bytes <= 0) return "0 KB";
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function fileDescription(name: string, stats?: { claims: number; paragraphs: number; figures: number }): string {
  if (/^附图原件-/.test(name)) return `附图原件 · ${name.replace(/^附图原件-/, "")}`;
  if (/权利要求书.*\.docx$/i.test(name)) return stats?.claims ? `DOCX，${stats.claims} 项权利要求` : "DOCX，权利要求书";
  if (/摘要.*\.docx$/i.test(name)) return "DOCX，说明书摘要";
  if (/说明书.*\.docx$/i.test(name)) {
    if (stats?.paragraphs) return `DOCX，${stats.paragraphs} 段${stats.figures ? `，含 ${stats.figures} 张附图` : ""}`;
    return "DOCX，说明书";
  }
  if (/检查清单.*\.pdf$/i.test(name)) return "PDF，提交前检查项";
  if (/\.pdf$/i.test(name)) return "PDF";
  if (/\.patentpack$/i.test(name)) return "加密备份，可在设置中恢复";
  if (/\.json$/i.test(name)) return "JSON，文件清单与校验值";
  if (/\.docx$/i.test(name)) return "DOCX";
  return name;
}

/** Exported for static state rendering and shell composition. */
export function DoneView({ route, mode = "professional", documentStats, state, passphrase, busy, actionError, onPassphrase, onRefresh, onCreate, onDownload }: DoneViewProps) {
  const hasUnavailableRecord = state.files.some((file) => file.status !== "ready");
  const actionLabel = hasUnavailableRecord ? "重新导出材料包" : state.record ? "再次导出材料包" : "生成材料包";
  const self = mode === "self";
  const allowed = state.gate?.allowed === true;
  const blockers = state.gate?.reasons?.length
    ? state.gate.reasons
    : state.phase === "error" && state.error ? [{ code: state.error.code }] : [];
  const gateTarget = (code: string) => state.snapshot
    ? `/v6/matters/${state.snapshot.matterId}/targets/${state.snapshot.targetId}/${REASON_TABS[code] ?? "overview"}`
    : null;
  const heroTitle = self
    ? allowed || blockers.length === 0 ? "可以下载了" : `还差 ${blockers.length} 步才能下载`
    : allowed ? "材料已生成" : "交付材料";

  const fileList = <div className="card pad0"><div style={{ padding: "6px 14px" }} data-testid="done-files">
    {state.files.length === 0
      ? <div className="dl-row"><div className="grow"><div className="dl-n">本机尚无导出文件</div><div className="dl-m">满足前置条件后可生成材料包。</div></div></div>
      : state.files.map((file) => <div className="dl-row" key={file.id} data-testid={`done-file-${file.id}`} data-status={file.status}>
          <span className="file-ic"><Icon name="doc" /></span>
          <div className="grow">
            <div className="dl-n">{file.name}</div>
            <div className="dl-m">{fileDescription(file.name, documentStats)} · {formatSize(file.bytes)} · {STATUS_LABELS[file.status]}</div>
            <details className="tech"><summary>技术详情</summary><code>SHA-256：{file.sha256 || "—"}</code></details>
            {file.unavailableReasons.map((reason, index) => <div className="small muted" key={`${reason.code}-${index}`}>
              {errorText(reason.code)}
              <details className="tech"><summary>技术详情</summary><code>{technicalDetailLabel(reason.code)}</code>{reason.resourceId ? <span> · {reason.resourceId}</span> : null}</details>
            </div>)}
          </div>
          {file.status === "ready" ? <Button size="sm" icon="download" disabled={busy} onClick={() => void onDownload(file)}>下载</Button> : null}
        </div>)}
  </div></div>;

  const gateDetails = <details className="group" data-testid="done-gate">
    <summary className="section-h"><span>导出前置条件（技术详情）</span><span className="sh-r">{allowed ? "已满足" : "待处理"}</span></summary>
    {self ? <div className="row"><div className="r-main"><div className="r-sub">刷新会重新读取当前门禁和导出记录。</div></div><Button size="sm" icon="refresh" onClick={() => void onRefresh()} data-testid="done-refresh">刷新状态</Button></div> : null}
    {allowed
      ? <div className="row"><div className="r-main"><div className="r-title">当前材料、检查和确认记录允许生成材料。</div>
        {state.snapshot ? <details className="tech"><summary>技术详情</summary><code>SnapshotRef：{state.snapshot.matterId} / {state.snapshot.targetId} / {state.snapshot.draftRevisionId}</code></details> : null}
      </div></div>
      : <div className="card"><div className="checkrowline"><div className="cr-b">
          <div className="cr-t"><span className="tag risk">前置条件</span> 暂不能生成材料</div>
          <div className="cr-d">{blockers.length ? <ul>{blockers.map((reason, index) => <li key={`${reason.code}-${reason.resourceId ?? ""}-${index}`}>
            {errorText(reason.code)}
            <details className="tech"><summary>技术详情</summary><code>{technicalDetailLabel(reason.code)}</code>{reason.resourceId ? <span> · {reason.resourceId}</span> : null}</details>
            {gateTarget(reason.code) ? <a className="link" data-testid={`done-reason-link-${reason.code}`} href={gateTarget(reason.code)!}>去处理</a> : null}
          </li>)}</ul> : <p>{state.error?.message ?? "当前目标没有可用的导出门禁结果。"}</p>}</div>
        </div></div></div>}
    {state.inputStale ? <p className="small muted">草稿依据的材料已变化，请刷新并重新检查。</p> : null}
  </details>;

  const formatDetails = <details className="group" data-testid="done-formats">
    <summary className="section-h"><span>其他格式状态（技术详情）</span><span className="sh-r">{state.unavailableFormats.length} 项</span></summary>
    {state.unavailableFormats.map((format) => <div className="row" key={format.format} data-testid={`done-format-${format.format}`}>
      <div className="r-main"><div className="r-title">{format.format.toUpperCase()} · {errorText(format.code)}</div><div className="r-sub">{format.reason}</div>
      <details className="tech"><summary>技术详情</summary><code>{technicalDetailLabel(format.code)}</code></details></div>
    </div>)}
  </details>;

  const exportAction = <div className="group" data-testid="done-export-action">
    <div className="row" style={{ flexDirection: "column", alignItems: "stretch", gap: 6 }}>
      <div className="r-main"><div className="r-title">备份口令</div><div className="r-sub">口令只用于本机加密，不会保存。</div></div>
      <input className="input" type="password" autoComplete="new-password" value={passphrase}
        onChange={(event) => onPassphrase(event.currentTarget.value)} data-testid="done-passphrase" />
    </div>
    <div className="row"><div className="r-main">
      <Button variant="primary" disabled={busy || !allowed || passphrase.trim().length === 0} onClick={() => void onCreate()} data-testid="done-export-button">
        {busy ? "正在本机生成或校验文件…" : actionLabel}
      </Button>
      {actionError ? <Callout tone="warn"><div data-testid="done-action-error" data-code={actionError.code}>
        <strong>{userMessageFor(actionError.code)}</strong>
        <details className="tech"><summary>技术详情</summary><code>{technicalDetailLabel(actionError.code)}</code></details>
        <p>{actionError.message}</p>
      </div></Callout> : null}
    </div></div>
  </div>;

  const steps = <div className="card"><div className="steps3">
    <div><b>1</b><div><div className="dl-n">核对申请人与发明人</div><div className="dl-m">姓名、类型和顺序以真实信息为准。</div></div></div>
    <div><b>2</b><div><div className="dl-n">按官方客户端校验并递交</div><div className="dl-m">产品不代为提交，也不生成官方 XML。</div></div></div>
    <div><b>3</b><div><div className="dl-n">保存受理与缴费凭证</div><div className="dl-m">取得实际回执后再确认申请基线。</div></div></div>
  </div></div>;

  const upsells = <>
    <div className="upsell"><div><b>需要专业复核？</b><div className="small muted">人工服务由专业人员按范围承接，当前不自动下单。</div></div><Button size="sm" to="/v6/services">查看服务目录</Button></div>
    <div className="upsell"><div><b>想继续编辑？</b><div className="small muted">回到同一案件的专业工作台，继续修改、检查或处理其他目标。</div></div><Button size="sm" to={`/v6/matters/${state.snapshot?.matterId ?? ""}`}>进入专业工作台</Button></div>
  </>;

  const professionalFormatTable = <div className="card pad0"><table className="tbl">
    <thead><tr><th>目标</th><th>提交格式与前置条件</th><th>核实状态</th></tr></thead>
    <tbody>
      <tr><td>中国实用新型 / 发明</td><td>规定范围内的电子文件要求官方 XML；当前不生成 XML</td><td><span className="tag warn">需官方工具</span></td></tr>
      <tr><td>美国非临时</td><td>DOCX 可用；费用与代理要求按个案核实</td><td><span className="tag plain">未核实</span></td></tr>
      <tr><td>EP / PCT</td><td>格式与译文需按官方渠道核实</td><td><span className="tag plain">未核实</span></td></tr>
    </tbody>
  </table></div>;

  return <main className="v6-page" data-testid="done-page" data-state={state.phase}>
    <div className="done-hero">
      <div className="dh-i"><Icon name={allowed || blockers.length === 0 ? "check" : "alert"} size="lg" /></div>
      <h1>{heroTitle}</h1>
      <p data-testid="done-preparation-label">申请准备材料，不是递交回执；产品不代为提交。下一步：核对申请人信息后按步骤办理。</p>
      {self && !allowed ? <div className="steps3" data-testid="done-blockers">
        {blockers.map((reason, index) => <div key={`${reason.code}-${index}`}>
          <b>{index + 1}</b>
          <div><div className="dl-n">{errorText(reason.code)}</div>
            <div className="dl-m">{reason.code === "APPROVAL_REQUIRED" ? "需要先记录内部批准。" : "按提示处理后可继续。"}</div>
            {gateTarget(reason.code) ? <a className="link" data-testid={`done-blocker-${reason.code}`} href={gateTarget(reason.code)!}>去处理</a> : null}
            {reason.code === "APPROVAL_REQUIRED" ? <a className="link" href="#approval-details" data-testid="done-record-approval">记录批准</a> : null}
          </div>
        </div>)}
      </div> : null}
    </div>

    {state.testOutput ? <Callout tone="warn" icon="alert"><b data-testid="done-test-output-label">测试输出：本地固定测试结果，非真实 AI 生成或正式申请稿。</b></Callout> : null}

    {!self ? <div className="spread" style={{ marginTop: 10 }}>
      <span className="small muted">交付与内部批准</span>
      <Button size="sm" icon="refresh" onClick={() => void onRefresh()} data-testid="done-refresh">刷新状态</Button>
    </div> : null}

    {state.phase === "stale" ? <Callout tone="warn" icon="alert"><span data-testid="done-stale">
      {state.files.some((file) => file.unavailableReasons.some((reason) => reason.code === "CACHE_EXPIRED"))
        ? "导出文件已超过七天，旧文件不能再下载，请重新导出。"
        : "旧导出不是当前版本，文件只保留说明，不能下载，请重新导出。"}
      <details className="tech"><summary>技术详情</summary>
        <code>{state.files.some((file) => file.unavailableReasons.some((reason) => reason.code === "CACHE_EXPIRED")) ? "CACHE_EXPIRED" : "STALE_BINDING"}</code>
      </details>
    </span></Callout> : null}

    {state.phase === "error" && !self ? <Callout tone="risk" icon="alert"><div data-testid="done-read-error" data-code={state.error?.code}>
      <strong>{errorText(state.error?.code ?? "")}</strong>
      <p>{state.error?.message}</p>
      {state.error?.code ? <details className="tech"><summary>技术详情</summary><code>{technicalDetailLabel(state.error.code)}</code></details> : null}
      <Button size="sm" onClick={() => void onRefresh()}>重试读取或导出</Button>
    </div></Callout> : null}

    {self ? <>
      {allowed ? <div className="section-h"><span>文件</span><span className="sh-r">{state.files.length} 份</span></div> : null}
      {allowed ? fileList : null}
      <Callout tone="warn" icon="alert"><b>XML 不可用：</b>规定范围内的电子文件需要官方 XML；本产品不生成 XML，也不会把其他格式改名为 .xml。请在官方工具中转换并校验。</Callout>
      {exportAction}
      {allowed ? steps : null}
      {allowed ? upsells : null}
    </> : <>
      {professionalFormatTable}
      <div className="section-h"><span>文件</span><span className="sh-r">{state.files.length} 份</span></div>
      {fileList}
      <div className="exportcard"><div className="ec-h"><Icon name="doc" /><span className="ec-t">材料包</span><span className="ec-r"><span className="tag plain">本机生成</span></span></div>
        <div className="gates"><div className="gate"><span className="g-t">导出记录：{state.record ? `${state.record.manifest.exportId.slice(0, 8)}… · ${state.record.manifest.createdAt}` : "尚无导出记录"}</span></div></div>
      </div>
      {exportAction}
    </>}

    {gateDetails}
    {formatDetails}
  </main>;
}

export default Done;
