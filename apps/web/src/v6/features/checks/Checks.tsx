import * as React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { RiskCategory } from "../../../../../../packages/domain/src/v6/gate.js";
import { draftAstSchema } from "../../../../../../packages/contracts/src/draft.ts";
import {
  isCurrentCheckRun,
  runChecks,
  type CheckActionKind,
  type CheckAstIssue,
  type CheckFinding,
  type CheckInput,
  type CheckRulePack,
  type CheckRunResult,
} from "../../../../../../packages/domain/src/v6/checks.js";
import type { SnapshotRef } from "../../../../../../packages/domain/src/v6/revision.js";

export interface RiskAckRequest {
  snapshot: SnapshotRef;
  checkRunId: string;
  riskId: string;
}

export interface CheckActionRequest {
  action: CheckActionKind;
  finding: CheckFinding;
  snapshot: SnapshotRef;
  checkRunId: string;
}

export interface ChecksPanelProps {
  input: CheckInput;
  rulePack: CheckRulePack;
  currentSnapshot: SnapshotRef;
  activeRulePackVersion: string;
  initialResult?: CheckRunResult | null;
  confirmedRiskIds?: readonly string[];
  onResult?: (result: CheckRunResult) => void | Promise<void>;
  loading?: boolean;
  loadError?: { code: string; message: string } | null;
  run?: (input: CheckInput, pack: CheckRulePack, at: string) => CheckRunResult | Promise<CheckRunResult>;
  onRiskAck: (request: RiskAckRequest) => void | Promise<void>;
  onAction?: (request: CheckActionRequest) => void;
}

const GROUPS: readonly { category: RiskCategory; title: string }[] = Object.freeze([
  { category: "blocker", title: "阻断" },
  { category: "risk", title: "风险" },
  { category: "unverified", title: "待核实" },
  { category: "policy", title: "产品政策" },
]);

const ACTION_LABELS: Readonly<Record<CheckActionKind, string>> = Object.freeze({
  go_to_edit: "去修改",
  acknowledge_risk: "确认风险",
  ask_expert: "请专家",
  view_policy: "查看产品规则",
});

const LABELS: Readonly<Record<RiskCategory, string>> = Object.freeze({
  blocker: "阻断",
  risk: "风险",
  unverified: "待核实",
  policy: "产品政策",
});

const STACK = { flexDirection: "column", alignItems: "flex-start" } as const;
const EMPTY_CONFIRMED_RISK_IDS: readonly string[] = Object.freeze([]);

function formatTimestamp(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString("zh-CN", { hour12: false });
}

function basisText(finding: CheckFinding): string[] {
  const basis: string[] = [];
  if (finding.basis.quote) basis.push(finding.basis.quote);
  if (finding.basis.url) basis.push(finding.basis.url);
  if (finding.basis.effectiveFrom || finding.basis.effectiveTo) {
    basis.push(`有效期：${finding.basis.effectiveFrom ?? "未注明"} 至 ${finding.basis.effectiveTo ?? "未注明"}`);
  }
  basis.push(`核实人：${finding.basis.verifier ?? "未提供"}`);
  basis.push(`核实时间：${finding.basis.verifiedAt ?? "未提供"}`);
  return basis;
}

function inputWithAstValidation(input: CheckInput): CheckInput {
  if (input.astValidation?.valid === false) return input;
  const parsed = draftAstSchema.safeParse(input.ast);
  if (parsed.success) return { ...input, astValidation: { valid: true } };
  const ast = typeof input.ast === "object" && input.ast !== null ? input.ast as Record<string, unknown> : null;
  const issues: CheckAstIssue[] = parsed.error.issues.map((issue) => {
    const path = issue.path.map(String);
    let section: CheckAstIssue["section"] = null;
    let nodeId: string | null = null;
    if (path[0] === "claims" && typeof issue.path[1] === "number" && Array.isArray(ast?.claims)) {
      const claim = ast.claims[issue.path[1]] as Record<string, unknown> | undefined;
      nodeId = typeof claim?.id === "string" ? claim.id : null;
      section = "claims";
      if (path[2] === "features" && typeof issue.path[3] === "number" && Array.isArray(claim?.features)) {
        const feature = claim.features[issue.path[3]] as Record<string, unknown> | undefined;
        if (typeof feature?.id === "string") nodeId = feature.id;
      } else if (path[2] === "paragraphs" && typeof issue.path[3] === "number" && Array.isArray(claim?.paragraphs)) {
        const paragraph = claim.paragraphs[issue.path[3]] as Record<string, unknown> | undefined;
        if (typeof paragraph?.id === "string") nodeId = paragraph.id;
      }
    } else if (path[0] === "sections" && typeof issue.path[1] === "number" && Array.isArray(ast?.sections)) {
      const draftSection = ast.sections[issue.path[1]] as Record<string, unknown> | undefined;
      const kind = draftSection?.kind;
      if (kind === "technical_field" || kind === "background" || kind === "summary"
        || kind === "figures_description" || kind === "embodiments" || kind === "abstract") section = kind;
      if (path[2] === "paragraphs" && typeof issue.path[3] === "number" && Array.isArray(draftSection?.paragraphs)) {
        const paragraph = draftSection.paragraphs[issue.path[3]] as Record<string, unknown> | undefined;
        if (typeof paragraph?.id === "string") nodeId = paragraph.id;
      }
    }
    return { path: path.join("."), reason: issue.message, nodeId, section };
  });
  return { ...input, astValidation: { valid: false, issues } };
}

function FindingCard({
  finding,
  stale,
  busy,
  acknowledged,
  onRiskAck,
  onAction,
}: {
  finding: CheckFinding;
  stale: boolean;
  busy: boolean;
  acknowledged: boolean;
  onRiskAck: () => void;
  onAction: (action: CheckActionKind) => void;
}) {
  const location = [finding.locator.label, finding.locator.section ? `章节 ${finding.locator.section}` : null,
    finding.locator.nodeId ? `节点 ${finding.locator.nodeId}` : null].filter(Boolean).join(" · ");
  const actions = stale || busy ? [] : finding.actions;
  return (
    <article className="card" data-testid={`check-finding-${finding.id}`} data-category={finding.category}>
      <div className="row" style={{ flexWrap: "wrap" }}>
        <span className="badge badge-outline">{LABELS[finding.category]}</span>
        <span className="badge badge-outline">{stale ? "已过期" : finding.verificationLabel}</span>
        <span className="field-hint">{finding.ruleId}</span>
      </div>
      <h3 className="card-title">{finding.title}</h3>
      <p>{finding.explanation}</p>
      {finding.ruleId === "ast.invalid" ? <details data-testid={`check-raw-error-${finding.id}`}>
        <summary>查看原始校验错误</summary>
        <pre style={{ whiteSpace: "pre-wrap" }}>{finding.locator.label}: {finding.explanation}</pre>
      </details> : null}
      <dl className="kv">
        <dt>依据</dt>
        <dd>{basisText(finding).map((line, index) => <div key={`${finding.id}-basis-${index}`}>{line}</div>)}</dd>
        <dt>定位</dt>
        <dd data-testid={`check-locator-${finding.id}`}>{location || "案件输入"}</dd>
        <dt>建议处理</dt>
        <dd>{finding.suggestedAction}</dd>
      </dl>
      {actions.length > 0 ? (
        <div className="row" style={{ flexWrap: "wrap" }}>
          {actions.map((action) => action === "acknowledge_risk" ? (
            acknowledged ? <span className="muted" key={action} data-testid={`check-acknowledged-${finding.id}`}>已确认</span> : (
              <button
                key={action}
                type="button"
                className="btn btn-outline btn-sm"
                data-testid={`check-ack-${finding.id}`}
                disabled={busy}
                onClick={onRiskAck}
              >
                {ACTION_LABELS[action]}
              </button>
            )
          ) : (
            <button
              key={action}
              type="button"
              className="btn btn-outline btn-sm"
              data-testid={`check-action-${finding.id}-${action}`}
              disabled={busy}
              onClick={() => onAction(action)}
            >
              {ACTION_LABELS[action]}
            </button>
          ))}
        </div>
      ) : null}
    </article>
  );
}

export function ChecksPanel({
  input,
  rulePack,
  currentSnapshot,
  activeRulePackVersion,
  initialResult = null,
  confirmedRiskIds = EMPTY_CONFIRMED_RISK_IDS,
  onResult,
  loading = false,
  loadError = null,
  run = runChecks,
  onRiskAck,
  onAction,
}: ChecksPanelProps) {
  const [result, setResult] = useState<CheckRunResult | null>(initialResult);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ code: string; message: string } | null>(loadError);
  const [acknowledged, setAcknowledged] = useState<ReadonlySet<string>>(() => new Set(confirmedRiskIds));
  const busyRef = useRef(false);
  const ackBusy = useRef(new Set<string>());

  useEffect(() => {
    setResult(initialResult);
    setAcknowledged(new Set(confirmedRiskIds));
  }, [initialResult, confirmedRiskIds]);
  useEffect(() => setError(loadError), [loadError, currentSnapshot, activeRulePackVersion]);

  const successfulResult = result?.checkRun.state === "succeeded" ? result : null;
  const valid = successfulResult !== null && isCurrentCheckRun(
    successfulResult.checkRun,
    currentSnapshot,
    activeRulePackVersion,
  );
  const stale = successfulResult !== null && !valid;
  const findings = successfulResult?.findings ?? [];
  const grouped = useMemo(() => new Map(GROUPS.map(({ category }) => [
    category,
    findings.filter((finding) => finding.category === category),
  ])), [findings]);
  const viewError = error ?? (result && result.checkRun.state !== "succeeded"
    ? { code: "CHECK_FAILED", message: "检查失败。请查看错误码并重试。" }
    : null);

  async function runAgain() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const next = await run(inputWithAstValidation(input), rulePack, new Date().toISOString());
      if (next.checkRun.state !== "succeeded") {
        const code = "errorCode" in next && typeof next.errorCode === "string" ? next.errorCode : "CHECK_FAILED";
        throw Object.assign(new Error("检查未成功完成。结果不能作为无问题的证明。"), { code });
      }
      await onResult?.(next);
      setResult(next);
      setAcknowledged(new Set());
    } catch (failure) {
      const record = typeof failure === "object" && failure !== null ? failure as { code?: unknown; message?: unknown } : null;
      setError({
        code: typeof record?.code === "string" ? record.code : "CHECK_RUN_FAILED",
        message: typeof record?.message === "string" ? record.message : "检查失败。结果不能作为无问题的证明。请重试。",
      });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function acknowledge(finding: CheckFinding) {
    const runResult = successfulResult;
    if (!runResult || !valid || finding.category !== "risk" || !finding.requiresAcknowledgement) return;
    if (ackBusy.current.has(finding.id)) return;
    ackBusy.current.add(finding.id);
    try {
      await onRiskAck({
        snapshot: runResult.checkRun.snapshot,
        checkRunId: runResult.checkRun.id,
        riskId: finding.id,
      });
      setAcknowledged((current) => new Set([...current, finding.id]));
    } catch (failure) {
      const record = typeof failure === "object" && failure !== null ? failure as { code?: unknown; message?: unknown } : null;
      setError({
        code: typeof record?.code === "string" ? record.code : "CONFIRMATION_FAILED",
        message: typeof record?.message === "string" ? record.message : "风险确认未保存，请重试。",
      });
    } finally {
      ackBusy.current.delete(finding.id);
    }
  }

  function handleAction(finding: CheckFinding, action: CheckActionKind) {
    if (!successfulResult || !valid) return;
    const request = { action, finding, snapshot: successfulResult.checkRun.snapshot, checkRunId: successfulResult.checkRun.id };
    if (onAction) onAction(request);
    else if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("v6:checks-action", { detail: request }));
  }

  const noResult = successfulResult === null;
  const initialLoading = (loading || busy) && noResult && viewError === null;
  const time = successfulResult?.checkRun.createdAt;
  const revision = successfulResult?.checkRun.snapshot.draftRevisionId ?? input.snapshot.draftRevisionId;
  const status = successfulResult === null
    ? (viewError ? "检查失败" : "尚未检查")
    : stale ? "已过期" : "有效";
  const primaryLabel = busy
    ? successfulResult === null ? "正在检查…" : "正在重新检查…"
    : successfulResult === null
      ? "运行检查"
      : "重新检查";

  return (
    <main className="v6-page" data-testid="checks-panel" data-state={initialLoading ? "loading" : viewError ? "error" : successfulResult ? stale ? "stale" : "ready" : "empty"}>
      <div className="row-between" style={{ flexWrap: "wrap", gap: "0.75rem" }}>
        <div>
          <h1 className="v6-title">检查与依据</h1>
          <p className="muted">确定性检查会定位草稿和输入问题；未核实规则只作提示，不形成法律结论。</p>
        </div>
        <button
          type="button"
          className="btn btn-default"
          data-testid="checks-run"
          disabled={busy || initialLoading}
          onClick={() => void runAgain()}
        >
          {primaryLabel}
        </button>
      </div>

      <section className="card" data-testid="checks-summary">
        {input.ast === null || input.ast === undefined ? <div className="notice" data-testid="checks-no-draft">
          尚无可检查的草稿。请先前往“草稿”创建或生成测试草稿，再返回运行检查。
        </div> : null}
        <dl className="kv">
          <dt>检查时间</dt><dd data-testid="checks-time">{time ? formatTimestamp(time) : "尚未检查"}</dd>
          <dt>规则包版本</dt><dd data-testid="checks-rule-pack">{successfulResult?.checkRun.rulePackVersion ?? activeRulePackVersion}</dd>
          <dt>绑定修订</dt><dd data-testid="checks-revision">{revision}</dd>
          <dt>有效状态</dt><dd data-testid="checks-validity">{status}</dd>
        </dl>
        {successfulResult === null ? <p className="field-hint">当前没有可用的检查结果；尚未检查不能表示没有风险。</p> : null}
        {stale ? <p className="notice" role="status" data-testid="checks-stale">检查已过期。请重新检查后再使用结果或确认风险。</p> : null}
        {busy && successfulResult ? <p className="notice" role="status" data-testid="checks-rerunning">正在重新检查；以下保留上次结果。</p> : null}
        {viewError ? (
          <div className="notice" role="alert" data-testid="checks-error" data-code={viewError.code} style={STACK}>
            <strong>检查失败（{viewError.code}）</strong>
            <p>{viewError.message}</p>
            <button type="button" className="btn btn-outline btn-sm" data-testid="checks-retry" disabled={busy} onClick={() => void runAgain()}>
              重试检查
            </button>
          </div>
        ) : null}
        <p className="field-hint" data-testid="checks-search-state">现有技术检索：未检索</p>
      </section>

      {initialLoading ? (
        <section className="card" aria-busy="true" data-testid="checks-loading">
          <p className="muted">正在读取检查结果…</p>
          <div className="skeleton v6-skeleton" />
        </section>
      ) : null}
      {successfulResult === null && !initialLoading && !viewError ? (
        <section className="card v6-empty" data-testid="checks-empty">
          <h2 className="card-title">尚未运行检查</h2>
          <p>运行后会分别列出阻断、风险、待核实和产品政策；失败或过期结果不会显示为无问题。</p>
        </section>
      ) : null}

      {successfulResult !== null ? GROUPS.map(({ category, title }) => {
        const items = grouped.get(category) ?? [];
        return (
          <section className="card stack-3" key={category} data-testid={`checks-group-${category}`}>
            <div className="row-between">
              <h2 className="card-title">{title}</h2>
              <span className="badge badge-outline" data-testid={`checks-count-${category}`}>{items.length}</span>
            </div>
            {items.length === 0 ? <p className="muted">本组无项目</p> : (
              <div className="stack-3">
                {items.map((finding) => (
                  <FindingCard
                    key={finding.id}
                    finding={finding}
                    stale={stale}
                    busy={busy}
                    acknowledged={acknowledged.has(finding.id)}
                    onRiskAck={() => void acknowledge(finding)}
                    onAction={(action) => handleAction(finding, action)}
                  />
                ))}
              </div>
            )}
          </section>
        );
      }) : null}

      <p className="field-hint">检查结果绑定到修订 {revision} 和规则包 {activeRulePackVersion}。法律规则尚未通过 G-RULES 核实，不作法律结论。</p>
    </main>
  );
}

export default ChecksPanel;
