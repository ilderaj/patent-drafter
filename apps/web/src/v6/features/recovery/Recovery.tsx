/**
 * V6-26 recovery UI. The component owns only screen state; every decision
 * about encryption, validation and atomic import lives in `recovery.ts`.
 *
 * States shown to the user:
 * - empty: no package selected yet, with the prerequisite list;
 * - loading: encryption/decryption/validation/commit in progress;
 * - error: a real failure code and message, never a success placeholder;
 * - stale: the validated package is incomplete (missing bytes, omitted C10
 *   content or unconvertible items) or the persisted validation is no longer
 *   current. The report is shown before the second, explicit commit click.
 *
 * The passphrase is component memory only. It is never written to a URL, log,
 * evidence file, export row or the recovery package itself.
 */
import React, { useEffect, useState } from "react";
import { sha256Hex, type Actor, type LocalRepository } from "../../lib/repository.ts";
import {
  commitRecoveryImport,
  createRecoveryPackage,
  readRecoveryValidation,
  recoveryPackageFileName,
  validateRecoveryPackage,
  type MigrationReport,
  type RecoveryAccess,
  type RecoveryValidationView,
  type ValidatedRecovery,
} from "./recovery.ts";

export interface RecoveryProps {
  repository: LocalRepository;
  actor: Actor;
  /** The matter whose recovery package is generated; null disables export. */
  sourceMatterId?: string | null;
  /** Import can be used without a source matter. */
  initialPassphrase?: string;
  now?: () => string;
}

type Phase = "empty" | "loading" | "ready" | "error" | "stale";

interface ScreenError {
  code: string;
  message: string;
}

export function Recovery({ repository, actor, sourceMatterId = null, initialPassphrase = "", now }: RecoveryProps) {
  const [phase, setPhase] = useState<Phase>("empty");
  const [passphrase, setPassphrase] = useState(initialPassphrase);
  const [access, setAccess] = useState<RecoveryAccess>("local_unmetered");
  const [selectedBytes, setSelectedBytes] = useState<Uint8Array | null>(null);
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [exported, setExported] = useState<{ name: string; bytes: number; sha256: string } | null>(null);
  const [validation, setValidation] = useState<ValidatedRecovery | null>(null);
  const [persisted, setPersisted] = useState<RecoveryValidationView | null>(null);
  const [committedMatterId, setCommittedMatterId] = useState<string | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const [error, setError] = useState<ScreenError | null>(null);

  const report: MigrationReport | null = persisted?.report ?? validation?.report ?? null;
  const busy = phase === "loading";

  useEffect(() => {
    if (!validation && !persisted) return;
    setPhase(report?.incomplete ? "stale" : "ready");
  }, [validation, persisted, report?.incomplete]);

  const generate = async () => {
    if (!sourceMatterId || passphrase.trim().length === 0 || busy) return;
    setPhase("loading");
    setError(null);
    try {
      const bytes = await createRecoveryPackage(repository, actor, sourceMatterId, {
        passphrase,
        access,
        ...(now ? { now } : {}),
      });
      const sha256 = await sha256Hex(bytes);
      const name = recoveryPackageFileName((now ?? (() => new Date().toISOString()))());
      setExported({ name, bytes: bytes.byteLength, sha256 });
      setSelectedBytes(bytes);
      setSelectedName(name);
      setValidation(null);
      setPersisted(null);
      setCommittedMatterId(null);
      setReviewed(false);
      setPhase("empty");
    } catch (failure) {
      setError({
        code: failure instanceof Error && "code" in failure ? String((failure as { code: unknown }).code) : "STORAGE_UNAVAILABLE",
        message: failure instanceof Error ? failure.message : "恢复包生成失败。",
      });
      setPhase("error");
    }
  };

  const selectFile = async (file: File | null) => {
    if (!file) return;
    setError(null);
    setValidation(null);
    setPersisted(null);
    setCommittedMatterId(null);
    setReviewed(false);
    try {
      const buffer = new Uint8Array(await file.arrayBuffer());
      setSelectedBytes(buffer);
      setSelectedName(file.name);
      setPhase("empty");
    } catch {
      setSelectedBytes(null);
      setSelectedName(null);
      setError({ code: "INVALID_INPUT", message: "无法读取所选恢复包文件。" });
      setPhase("error");
    }
  };

  const validate = async () => {
    if (!selectedBytes || passphrase.trim().length === 0 || busy) return;
    setPhase("loading");
    setError(null);
    const result = await validateRecoveryPackage(repository, actor, selectedBytes, passphrase);
    if (!result.ok) {
      setValidation(null);
      setError({ code: result.error.code, message: result.error.message });
      setPhase("error");
      return;
    }
    setValidation(result.data);
    setReviewed(false);
    setPhase(result.data.report.incomplete ? "stale" : "ready");
  };

  const commit = async () => {
    if (!validation || !reviewed || busy) return;
    setPhase("loading");
    setError(null);
    const result = await commitRecoveryImport(repository, actor, validation.validationId);
    if (!result.ok) {
      setError({ code: result.error.code, message: result.error.message });
      setPhase("error");
      return;
    }
    setCommittedMatterId(result.data.matterId);
    const refreshed = await readRecoveryValidation(repository, actor, validation.validationId);
    if (refreshed.ok) setPersisted(refreshed.data);
    setPhase("ready");
  };

  const refresh = async () => {
    if (!validation && !persisted) return;
    const id = persisted?.validationId ?? validation?.validationId;
    if (!id) return;
    setPhase("loading");
    const result = await readRecoveryValidation(repository, actor, id);
    if (!result.ok) {
      setError({ code: result.error.code, message: result.error.message });
      setPhase("error");
      return;
    }
    setPersisted(result.data);
    if (result.data.matterId) setCommittedMatterId(result.data.matterId);
    setPhase(result.data.status === "committed" || !result.data.report.incomplete ? "ready" : "stale");
  };

  const downloadGenerated = () => {
    if (!selectedBytes || !exported) return;
    const buffer = new ArrayBuffer(selectedBytes.byteLength);
    new Uint8Array(buffer).set(selectedBytes);
    const url = URL.createObjectURL(new Blob([buffer], { type: "application/octet-stream" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = exported.name;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  if (phase === "loading") {
    return <div data-testid="recovery-page" data-state="loading" aria-busy="true">
      <p className="small muted">正在本机解密、校验或写入恢复包；不会调用网络或外部服务。</p>
      <div className="skeleton v6-skeleton" />
    </div>;
  }

  return <div className="stack-3" data-testid="recovery-page" data-state={phase}>
    <p className="small muted">恢复包使用口令在本机加密；导入会创建一个新案件并重映射全部 ID。不恢复批准、登录身份、使用权、支付、服务授权或分享授权。旧本地审阅记录只标为 legacy_unverified。</p>

    {error ? <div className="callout risk" role="alert" data-testid="recovery-error" data-code={error.code}>
      <strong>操作未完成（{error.code}）</strong>
      <p>{error.message}</p>
      <button type="button" className="btn btn-outline btn-sm" onClick={() => void refresh()}>刷新持久状态</button>
    </div> : null}

    {committedMatterId ? <div className="callout ok" role="status" data-testid="recovery-committed" data-matter-id={committedMatterId}>
      <strong>恢复完成</strong>
      <p>已在新的案件中导入。未恢复任何批准、身份、权益或分享。</p>
      <details className="v6-tech-details"><summary>新案件 ID</summary><code>{committedMatterId}</code></details>
    </div> : null}

    <section className="setsec" data-testid="recovery-export">
      <h3>生成恢复包</h3>
      <div className="group">
        <div className="row"><div className="r-main"><div className="r-title">来源案件</div>
          <div className="r-sub">{sourceMatterId ? "导出只读取本机加密记录，不访问网络。" : "没有可导出的来源案件；仍可导入已有恢复包。"}</div></div>
          <div className="r-right">{sourceMatterId ? <span className="tag plain">本机</span> : <span className="tag warn">无来源</span>}</div></div>
        <div className="row" style={{ alignItems: "flex-start" }}>
          <div className="r-main stack-2">
            <label className="field"><span className="field-label">恢复包口令</span>
              <input className="input" type="password" autoComplete="new-password" value={passphrase}
                onChange={(event) => setPassphrase(event.currentTarget.value)} data-testid="recovery-passphrase" />
              <span className="field-hint">口令只在本页内存中使用，不保存、不写日志。</span>
            </label>
            <label className="field"><span className="field-label">生成内容范围</span>
              <select className="input" value={access} onChange={(event) => setAccess(event.currentTarget.value as RecoveryAccess)} data-testid="recovery-access">
                <option value="local_unmetered">本机完整内容（local_unmetered）</option>
                <option value="preview">仅预览节点（C10 裁剪）</option>
                <option value="full">已授权完整内容（full）</option>
              </select>
            </label>
          </div>
        </div>
        <div className="row" style={{ justifyContent: "flex-end", flexWrap: "wrap" }}>
          <button type="button" className="btn primary" data-testid="recovery-generate"
            disabled={busy || !sourceMatterId || passphrase.trim().length === 0} onClick={() => void generate()}>
            生成加密恢复包
          </button>
          {exported ? <button type="button" className="btn" data-testid="recovery-download" onClick={downloadGenerated}>下载 {exported.name}</button> : null}
        </div>
        {exported ? <div className="row"><span className="small muted" data-testid="recovery-export-hash">
          {exported.bytes} bytes · SHA-256 {exported.sha256.slice(0, 24)}…
        </span></div> : null}
      </div>
    </section>

    <section className="setsec" data-testid="recovery-import">
      <h3>校验并导入恢复包</h3>
      <div className="group">
        <div className="row" style={{ alignItems: "flex-start" }}>
          <div className="r-main stack-2">
            <label className="field"><span className="field-label">加密恢复包</span>
              <input className="input" type="file" accept=".patentpack,application/json,application/octet-stream"
                onChange={(event) => void selectFile(event.currentTarget.files?.[0] ?? null)} data-testid="recovery-file" />
              {selectedName ? <span className="field-hint">已选择：{selectedName}</span> : <span className="field-hint">选择 .patentpack 文件；校验前不会写入任何案件。</span>}
            </label>
          </div>
        </div>
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button type="button" className="btn" data-testid="recovery-validate"
            disabled={busy || !selectedBytes || passphrase.trim().length === 0} onClick={() => void validate()}>
            预览校验结果
          </button>
        </div>
        <div className="row"><span className="small muted">校验结果（含解密包）在本机最多保留 15 分钟；提交后会删除解密包，只留不含内容的提交标记。</span></div>
        {report ? <RecoveryReport report={report} /> : <div className="row"><span className="small muted">尚未校验。校验是 dry-run，不会创建案件。</span></div>}
        {report ? <div className="row">
          <label className="rowgap"><input type="checkbox" checked={reviewed} onChange={(event) => setReviewed(event.currentTarget.checked)} data-testid="recovery-reviewed" />
            <span className="small">我已核对上述映射、缺字节、未知版本和无法转换项</span></label>
        </div> : null}
        <div className="row" style={{ justifyContent: "flex-end", flexWrap: "wrap" }}>
          <button type="button" className="btn primary" data-testid="recovery-commit"
            disabled={busy || !validation || !validation.canCommit || !reviewed || Boolean(persisted?.status === "committed")}
            onClick={() => void commit()}>
            {persisted?.status === "committed" ? "已导入（同一校验不会重复创建）" : "确认导入为新案件"}
          </button>
          {(validation || persisted) ? <button type="button" className="btn btn-sm" data-testid="recovery-refresh"
            onClick={() => void refresh()}>刷新持久状态</button> : null}
        </div>
      </div>
    </section>
  </div>;
}

export function RecoveryReport({ report }: { report: MigrationReport }) {
  const rows: [string, number][] = [
    ["目标", report.mappingCounts.targets ?? 0],
    ["资产", report.mappingCounts.assets ?? 0],
    ["图稿", report.mappingCounts.figures ?? 0],
    ["草稿修订", report.mappingCounts.revisions ?? 0],
    ["人员", report.mappingCounts.parties ?? 0],
    ["事实", report.mappingCounts.facts ?? 0],
    ["旧审阅（legacy_unverified）", report.mappingCounts.legacyReviews ?? 0],
  ];
  return <div className="stack-2" data-testid="recovery-report" data-state={report.incomplete ? "stale" : "ready"}>
    <p role="status">
      {report.incomplete
        ? "校验完成，但包内有不完整或按 C10 裁剪的内容；导入不会伪造这些内容。"
        : "校验完成，可以导入。"}
    </p>
    <ul className="stack-1" data-testid="recovery-counts">
      {rows.map(([label, count]) => <li key={label}>{label}：{count}</li>)}
    </ul>
    {report.missingBytes.length > 0 ? <section className="notice" data-testid="recovery-missing">
      <strong>缺字节资产（导入后保持 missing_bytes）</strong>
      <ul>{report.missingBytes.map((item) => <li key={item.assetId}>
        <code>{item.originalName}</code> · {item.assetId} · SHA-256 {item.sha256.slice(0, 12)}
      </li>)}</ul>
    </section> : null}
    {report.unknownVersions.length > 0 ? <section className="notice" data-testid="recovery-unknown">
      <strong>未知版本</strong>
      <ul>{report.unknownVersions.map((item) => <li key={`${item.ref}-${item.version}`}>{item.ref} · {item.version}</li>)}</ul>
    </section> : null}
    {report.unconvertible.length > 0 ? <section className="notice" data-testid="recovery-unconvertible">
      <strong>无法转换项</strong>
      <ul>{report.unconvertible.map((item, index) => <li key={`${item.ref}-${index}`}>{item.code} · {item.ref} · {item.reason}</li>)}</ul>
    </section> : null}
    {report.omittedGeneratedContent.length > 0 ? <section className="notice" data-testid="recovery-omitted">
      <strong>按 C10 省略的生成内容</strong>
      <ul>{report.omittedGeneratedContent.map((item, index) => <li key={`${item.revisionId}-${item.paragraphId}-${index}`}>
        {item.section} · {item.paragraphId} · {item.reason}
      </li>)}</ul>
    </section> : null}
    {report.legacyUnverified.length > 0 ? <section className="notice" data-testid="recovery-legacy">
      <strong>旧本地审阅（legacy_unverified）</strong>
      <p>仅保留历史标记，不会变成批准、确认或认证审阅。</p>
      <ul>{report.legacyUnverified.map((item, index) => <li key={`${item.id}-${index}`}>{item.kind} · {item.identity}</li>)}</ul>
    </section> : null}
    {!report.canCommit ? <p className="notice" role="alert">此校验结果不能提交。</p> : null}
  </div>;
}

export default Recovery;
