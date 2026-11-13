/**
 * V6-17 — generation panel (S04 任务进度与结果采纳).
 *
 * The panel is thin: all job rules live in `generation.ts`. This file renders
 * the five real stages (待处理/进行中/完成/失败/已取消), true completed/total
 * progress, cancellation, retry, interrupted resume/discard, the candidate
 * preview and explicit adoption. It never invents a stage, a timer or a result.
 */
import { providerRecoveryFor, technicalDetailLabel, userMessageFor } from "../../lib/user-messages.ts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  GENERATE_STAGES,
  createGenerationEngine,
  type GenerateStage,
  type GenerationEngine,
  type GenerationEngineOptions,
  type GenerationJobView,
  type GenerationStageView,
  type GenerationErrorCode,
} from "./generation.ts";
import type { Actor, LocalRepository } from "../../lib/repository.ts";

export const STAGE_LABELS: Readonly<Record<GenerateStage, string>> = Object.freeze({
  facts: "事实",
  support: "依据",
  claims: "权利要求",
  specification: "说明书",
  checks: "检查",
});

export const STAGE_STATE_LABELS: Readonly<Record<GenerationStageView["state"], string>> = Object.freeze({
  pending: "待处理",
  running: "进行中",
  completed: "完成",
  failed: "失败",
  cancelled: "已取消",
});

const JOB_STATE_LABELS: Readonly<Record<GenerationJobView["job"]["state"], string>> = Object.freeze({
  queued: "排队中",
  running: "进行中",
  cancel_requested: "正在取消",
  cancelled: "已取消",
  succeeded: "已完成",
  failed: "失败",
  interrupted: "已中断",
});

const RECOVERY: Readonly<Record<string, string>> = Object.freeze({
  CONSENT_REVOKED: "外发授权已撤回，下次调用不会发出。已发出的调用无法撤回；需要重新授权。",
  CONSENT_REQUIRED: "生成前需要有效的外发授权；请先在 AI 页授权当前材料。",
  QUOTA_EXCEEDED: "额度不足，不能自动切换处理方；请充值、手工编辑或改用其他处理方（需新授权）。",
  JOB_LIMIT_EXCEEDED: "任务超过输入、输出、费用或时长限制；调整限制配置后再启动。",
  RELEASE_GATE_CLOSED: "真实外发门已关闭；没有发出请求。",
  INVALID_TRANSITION: "任务状态已变化；请刷新后查看当前状态。",
  INPUT_STALE: "输入已变化，结果未采纳；请比较后再人工合并。",
  CAPABILITY_UNAVAILABLE: "当前能力不可用；请检查处理方或测试输出标记。",
  STORAGE_UNAVAILABLE: "本机存储暂时不可用；内容没有保存。",
});

export function recoveryFor(code: GenerationErrorCode | null): string | null {
  if (code === null) return null;
  return RECOVERY[code] ?? providerRecoveryFor(code) ?? "这一步没有完成。可以稍后重试；如反复出现，请把技术详情里的错误码告知部署者。";
}

export interface GenerationView {
  matterId: string;
  targetId: string;
  job: GenerationJobView | null;
  stages: readonly GenerationStageView[];
  progress: { completed: number; total: number | null; unit: string };
  /** `obsolete_result`: input or base revision changed before completion/adoption. */
  inputStale: boolean;
  /** True when the result is a fixture/stub output; adopting must keep that marker. */
  testOutput: boolean;
  /** True when the engine was explicitly configured to adopt test output. */
  testAdoptionAllowed: boolean;
  canStart: boolean;
  canCancel: boolean;
  canRetry: boolean;
  canResume: boolean;
  canDiscard: boolean;
  canAdopt: boolean;
  /** The draft revision produced by adoption; null until adopted. */
  revisionId: string | null;
}

export function generationView(job: GenerationJobView | null, matterId: string, targetId: string, canStart = true, allowTestAdoption = false): GenerationView {
  const stages = job?.stages ?? GENERATE_STAGES.map((stage) => ({
    stage,
    state: "pending" as const,
    errorCode: null,
    output: null,
    outputMeta: null,
  }));
  const state = job?.job.state ?? null;
  const inputStale = job?.job.disposition === "obsolete_result";
  const testOutput = job?.result?.testOutput === true;
  const canRetry = state === "failed";
  const canResume = state === "interrupted";
  const canDiscard = canResume || state === "succeeded" || state === "failed" || state === "cancelled";
  const canAdopt = state === "succeeded" && job?.result !== null && !inputStale
    && (!testOutput || allowTestAdoption) && job?.job.disposition === "ready";
  return {
    matterId,
    targetId,
    job,
    stages,
    progress: job?.progress ?? { completed: 0, total: GENERATE_STAGES.length, unit: "stage" },
    inputStale,
    testOutput,
    testAdoptionAllowed: allowTestAdoption,
    canStart: canStart && (state === null || ["succeeded", "failed", "cancelled", "interrupted"].includes(state)),
    canCancel: state === "queued" || state === "running",
    canRetry,
    canResume,
    canDiscard,
    canAdopt,
    revisionId: job?.job.disposition === "adopted" ? job.job.resultId : null,
  };
}

export interface GenerationActions {
  start: () => Promise<void> | void;
  refresh: () => Promise<void> | void;
  cancel: () => Promise<void> | void;
  retry: () => Promise<void> | void;
  resume: () => Promise<void> | void;
  discard: () => Promise<void> | void;
  adopt: () => Promise<void> | void;
  compare?: () => Promise<void> | void;
}

/** Only these codes mean "the user must look at the outbound scope again"; other errors stay local. */
export function requiresConsentRecovery(code: string | null | undefined): boolean {
  return code === "CONSENT_REQUIRED" || code === "CONSENT_REVOKED";
}

export interface GenerationPanelProps {
  repository?: LocalRepository;
  actor?: Actor;
  matterId?: string;
  targetId?: string;
  engine?: GenerationEngine;
  engineOptions?: Omit<GenerationEngineOptions, "repository" | "actor">;
  initialView?: GenerationView | null;
  loading?: boolean;
  loadError?: { code: string; message: string } | null;
  /** Optional cap on polling while a job is running; default 2000 ms. */
  pollMs?: number;
  /** Called after a successful adoption so the owning editor/review can reload. */
  onAdopted?: () => void;
  /**
   * Start/retry reported CONSENT_REQUIRED or CONSENT_REVOKED. The owner should drop its
   * runtime snapshot and re-resolve so the outbound consent sheet can be shown again.
   * This never issues a credential by itself and never resends the request.
   */
  onConsentRequired?: () => void;
}

/**
 * The failed job was authorized under a different consent than the one the engine now holds.
 * Retrying it would reuse a stale binding, so the panel offers an explicit new task instead.
 * No consent id is ever rendered: this only decides which control to show.
 */
export function shouldOfferNewAuthorization(
  job: GenerationJobView | null,
  engineOptions: GenerationPanelProps["engineOptions"],
): boolean {
  if (!job || !engineOptions || engineOptions.execution === "stub") return false;
  if (job.job.state !== "failed") return false;
  const current = engineOptions.consentId ?? null;
  // Without an explicit grant there is no executable action to offer.
  if (current === null) return false;
  return current !== (job.job.consentId ?? null);
}

export interface GenerationViewProps {
  view: GenerationView | null;
  loading: boolean;
  loadError: { code: string; message: string } | null;
  busy: boolean;
  notice: string | null;
  actionError: { code: string; message: string } | null;
  actions: GenerationActions;
  /** Show the "authorization updated" notice and the new-task control instead of retry. */
  consentUpdated?: boolean;
}

const SECTION_LABELS: Readonly<Record<string, string>> = Object.freeze({
  technical_field: "技术领域",
  background: "背景技术",
  summary: "发明内容",
  figures_description: "附图说明",
  embodiments: "具体实施方式",
  abstract: "摘要",
});

const STACK = { flexDirection: "column", alignItems: "flex-start" } as const;

function StageRow({ stage }: { stage: GenerationStageView }) {
  const label = STAGE_LABELS[stage.stage];
  const done = stage.state === "completed";
  const current = stage.state === "running";
  return (
    <li
      className={`gen-item${done ? " done" : current ? " cur" : ""}`}
      data-testid={`generation-stage-${stage.stage}`}
      data-state={stage.state}
      data-error-code={stage.errorCode ?? undefined}
    >
      <span className="gi-ic" aria-hidden="true">{done ? "✓" : current ? <span className="spin" /> : ""}</span>
      <span>{label}</span>
      <span className="gi-note" data-testid={`generation-stage-state-${stage.stage}`}>
        {STAGE_STATE_LABELS[stage.state]}
        {stage.errorCode !== null ? <span data-testid={`generation-stage-error-${stage.stage}`}> {userMessageFor(stage.errorCode)}</span> : null}
      </span>
      {stage.outputMeta !== null ? (
        <details className="tech">
          <summary>技术详情</summary>
          <span data-testid={`generation-stage-meta-${stage.stage}`}>
            检查点 {stage.outputMeta.outputHash.slice(0, 12)}… · 完成于 {stage.outputMeta.completedAt}
          </span>
        </details>
      ) : null}
    </li>
  );
}

function CandidatePreview({ view, actions }: { view: GenerationView; actions: GenerationActions }) {
  if (view.job?.result === null || view.job?.result === undefined) return null;
  const ast = view.job.result.ast;
  return (
    <div className="gen-live" data-testid="generation-result" data-test-output={view.job.result.testOutput}>
      <div className="gl-h">候选结果<span style={{ marginLeft: "auto" }}>{view.job.job.state === "succeeded" ? "已完成" : "生成中"}</span></div>
      <div className="gl-b">
      {view.job.support != null ? (
        <p className="field-hint" data-testid="generation-support">
          依据索引：{view.job.support.facts.length} 条确认事实，未解析 {view.job.support.unresolvedFactIds.length} 条
          {view.job.support.unresolvedFactIds.length > 0 ? `（${view.job.support.unresolvedFactIds.join("、")}）` : ""}
        </p>
      ) : null}
      {view.job.result.testOutput ? (
        <p className="notice" data-testid="generation-test-output">
          {view.testAdoptionAllowed
            ? "测试输出：这是固定测试结果，可预览；采纳后仍带测试标记，不能作为正式申请材料。"
            : "测试输出：这是固定测试结果，可预览，不能采纳为正式生成修订。"}
        </p>
      ) : null}
      {ast.claims.map((claim) => (
        <article key={claim.id} data-testid={`generation-claim-${claim.number}`}>
          <b>{claim.number}.</b> {claim.paragraphs.map((paragraph) => <span key={paragraph.id}>{paragraph.text}</span>)}
        </article>
      ))}
      {ast.sections.map((section) => (
        <section key={section.kind} data-testid={`generation-section-${section.kind}`}>
          <h4>{SECTION_LABELS[section.kind] ?? section.kind}</h4>
          {section.paragraphs.map((paragraph) => (
            <p key={paragraph.id}>{paragraph.text}</p>
          ))}
        </section>
      ))}
      </div>
      {view.inputStale ? (
        <div className="notice" role="alert" data-testid="generation-input-stale" style={STACK}>
          <strong>输入已变化，结果未采纳</strong>
          <p>生成期间事实、草稿或基础修订发生变化。请比较当前稿与本候选后再人工合并。</p>
          <button type="button" className="btn ghost sm" data-testid="generation-compare" onClick={() => void actions.compare?.()}>
            比较当前稿
          </button>
        </div>
      ) : null}
      {view.testOutput && !view.testAdoptionAllowed ? null : (
        <button
          type="button"
          className="btn btn-default"
          data-testid="generation-adopt"
          disabled={!view.canAdopt}
          title={view.inputStale ? "输入已变化，结果未采纳" : undefined}
          onClick={() => void actions.adopt()}
        >
          {view.testOutput ? "采纳为测试修订（带测试标记，不能作为正式申请材料）" : "采纳为新修订"}
        </button>
      )}
    </div>
  );
}

export function GenerationViewPanel(props: GenerationViewProps) {
  const { view, loading, loadError, busy, notice, actionError, actions, consentUpdated = false } = props;
  if (loading) {
    return (
      <div className="gen-wrap" data-testid="generation" data-state="loading" aria-busy="true">
        <h1 className="wiz-h1">生成任务</h1>
        <p className="wiz-sub" data-testid="generation-loading">正在读取本机生成任务…</p>
        <div className="skeleton v6-skeleton" />
      </div>
    );
  }
  if (loadError !== null) {
    return (
      <div className="gen-wrap" data-testid="generation" data-state="error">
        <h1 className="wiz-h1">生成任务</h1>
        <div className="callout warn" role="alert" data-testid="generation-load-error" data-code={loadError.code}>
          <strong>读取失败</strong>
          <p>{loadError.message}</p>
          <button type="button" className="btn sm" data-testid="generation-refresh" onClick={() => void actions.refresh()}>
            重试
          </button>
        </div>
      </div>
    );
  }
  if (view === null || view.job === null) {
    return (
      <div className="gen-wrap" data-testid="generation" data-state="empty">
        <h1 className="wiz-h1">准备生成材料</h1>
        <p className="wiz-sub" data-testid="generation-empty">
          本案还没有生成任务。启动后会按五个阶段写入本机检查点；刷新或关闭页面会标为中断。
        </p>
        <div className="wiz-foot">
          <button
            type="button"
            className="btn primary lg"
            data-testid="generation-start"
            disabled={busy || !view?.canStart}
            onClick={() => void actions.start()}
          >
            {busy ? "正在启动…" : "开始生成"}
          </button>
        </div>
      </div>
    );
  }
  const job = view.job;
  const state = job.job.state;
  const failed = job.stages.find((stage) => stage.state === "failed") ?? null;
  return (
    <div className="gen-wrap" data-testid="generation" data-state="ready" data-job-state={state}>
      <h1 className="wiz-h1">{state === "succeeded" ? "材料写完了" : "正在写申请材料"}</h1>
      <p className="wiz-sub">按你确认的事实起草权利要求和说明书；每一步都可以在专业工作台重新生成。</p>
      <div className="wiz-sec">
      <div className="progress"><div className="bar" style={{ width: `${Math.round((view.progress.completed / (view.progress.total || 1)) * 100)}%` }} /></div>
      <div className="small muted" data-testid="generation-progress" data-completed={view.progress.completed} data-total={view.progress.total ?? ""}>
        第 {Math.min(view.progress.completed + 1, view.progress.total ?? 5)} 步，共 {view.progress.total ?? "?"} 步 · <span data-testid="generation-job-state">{JOB_STATE_LABELS[state]}</span>
      </div>
      {view.inputStale ? (
        <div className="notice" role="alert" data-testid="generation-input-stale" style={STACK}>
          <strong>输入已变化，结果未采纳</strong>
          <p>生成期间事实、草稿或基础修订发生变化。请比较当前稿与本候选后再人工合并。</p>
          <button type="button" className="btn ghost sm" data-testid="generation-compare" onClick={() => void actions.compare?.()}>
            比较当前稿
          </button>
        </div>
      ) : null}
      {state === "interrupted" ? (
        <div className="notice" role="alert" data-testid="generation-interrupted" style={STACK}>
          <strong>生成已中断</strong>
          <p>页面中断；已保存的阶段不会重算。继续前会重新验证外发授权。</p>
        </div>
      ) : null}
      {failed !== null ? (
        <div className="notice" role="alert" data-testid="generation-error" data-code={failed.errorCode} style={STACK}>
          <strong>阶段失败：{STAGE_LABELS[failed.stage]}（{userMessageFor(failed.errorCode)}）</strong>
          <p data-testid="generation-recovery">{recoveryFor(failed.errorCode)}</p>
          <details className="tech"><summary>技术详情</summary><code data-testid="generation-error-code">{technicalDetailLabel(failed.errorCode ?? "")}</code><p className="field-hint">{job.errorMessage}</p></details>
        </div>
      ) : null}
      <ol className="gen-list" data-testid="generation-stages">
        {view.stages.map((stage) => <StageRow key={stage.stage} stage={stage} />)}
      </ol>
      {consentUpdated ? (
        <div className="notice" role="status" data-testid="generation-consent-updated" style={STACK}>
          <strong>授权已更新，请以新授权开始新任务。</strong>
          <p>旧的失败任务保留在记录里，不会按旧授权重试。</p>
        </div>
      ) : null}
      <div className="wiz-foot">
        {view.canStart && !consentUpdated ? (
          <button type="button" className="btn sm" data-testid="generation-start" disabled={busy} onClick={() => void actions.start()}>
            新建任务
          </button>
        ) : null}
        {consentUpdated ? (
          <button type="button" className="btn primary sm" data-testid="generation-start-new-authorization" disabled={busy} onClick={() => void actions.start()}>
            以新授权开始任务
          </button>
        ) : null}
        {view.canCancel ? (
          <button type="button" className="btn ghost sm" data-testid="generation-cancel" disabled={busy} onClick={() => void actions.cancel()}>
            取消
          </button>
        ) : null}
        {view.canResume ? (
          <button type="button" className="btn sm" data-testid="generation-resume" disabled={busy} onClick={() => void actions.resume()}>
            从已保存阶段继续
          </button>
        ) : null}
        {view.canRetry && !consentUpdated ? (
          <button type="button" className="btn sm" data-testid="generation-retry" disabled={busy} onClick={() => void actions.retry()}>
            重试为新任务
          </button>
        ) : null}
        {view.canDiscard ? (
          <button type="button" className="btn ghost sm" data-testid="generation-discard" disabled={busy} onClick={() => void actions.discard()}>
            放弃
          </button>
        ) : null}
        <button type="button" className="btn ghost sm" data-testid="generation-refresh" disabled={busy} onClick={() => void actions.refresh()}>
          刷新
        </button>
      </div>
      <CandidatePreview view={view} actions={actions} />
      {actionError !== null ? (
        <div className="notice" role="alert" data-testid="generation-action-error" data-code={actionError.code} style={STACK}>
          <p>{actionError.message}</p>
        </div>
      ) : null}
      <p className="small muted" role="status" aria-live="polite" data-testid="generation-notice">{notice ?? ""}</p>
      </div>
    </div>
  );
}

const NOOP_ACTIONS: GenerationActions = Object.freeze({
  start: () => undefined,
  refresh: () => undefined,
  cancel: () => undefined,
  retry: () => undefined,
  resume: () => undefined,
  discard: () => undefined,
  adopt: () => undefined,
  compare: () => undefined,
});

export function GenerationPanel(props: GenerationPanelProps) {
  const injected = props.initialView !== undefined;
  const [view, setView] = useState<GenerationView | null>(props.initialView ?? null);
  const [loading, setLoading] = useState(props.loading ?? !injected);
  const [loadError, setLoadError] = useState<{ code: string; message: string } | null>(props.loadError ?? null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<{ code: string; message: string } | null>(null);
  const busyRef = useRef(false);
  const testAdoptionAllowed = props.engineOptions?.allowTestAdoption === true;
  const viewFor = useCallback((job: GenerationJobView | null) =>
    generationView(job, props.matterId ?? "", props.targetId ?? "", true, testAdoptionAllowed),
  [props.matterId, props.targetId, testAdoptionAllowed]);

  const engine = useMemo<GenerationEngine | null>(() => {
    if (props.engine) return props.engine;
    if (!props.repository || !props.actor || !props.matterId || !props.targetId || !props.engineOptions) return null;
    return createGenerationEngine({ ...props.engineOptions, repository: props.repository, actor: props.actor });
  }, [props.engine, props.repository, props.actor, props.matterId, props.targetId, props.engineOptions?.execution, props.engineOptions?.profileId, props.engineOptions?.profileVersion, props.engineOptions?.consentId]);

  const refresh = useCallback(async () => {
    if (injected || engine === null || !props.matterId || !props.targetId) {
      if (!injected) setLoading(false);
      return;
    }
    const listed = await engine.list(props.matterId, props.targetId);
    setLoading(false);
    if (!listed.ok) {
      setLoadError(listed.error);
      return;
    }
    setLoadError(null);
    setView(viewFor(listed.data[0] ?? null));
  }, [injected, engine, props.matterId, props.targetId, viewFor]);

  useEffect(() => {
    if (injected) return;
    void refresh();
  }, [refresh, injected]);

  useEffect(() => {
    if (injected || engine === null || view?.job === null || view?.job === undefined) return;
    const state = view.job.job.state;
    if (state !== "running" && state !== "queued" && state !== "cancel_requested") return;
    const interval = setInterval(() => { void refresh(); }, Math.max(250, props.pollMs ?? 2000));
    return () => clearInterval(interval);
  }, [injected, engine, view, refresh, props.pollMs]);

  const act = useCallback(async (operation: "start" | "cancel" | "retry" | "resume" | "discard" | "adopt") => {
    if (busyRef.current || engine === null || !props.matterId || !props.targetId) return;
    busyRef.current = true;
    setBusy(true);
    setActionError(null);
    setNotice(null);
    try {
      if (operation === "start") {
        const result = await engine.start(props.matterId, props.targetId);
        if (!result.ok) {
          setActionError(result.error);
          if (requiresConsentRecovery(result.error.code)) props.onConsentRequired?.();
        } else setView(viewFor(result.data));
        return;
      }
      const jobId = view?.job?.job.id;
      if (!jobId) return;
      if (operation === "adopt") {
        const result = await engine.adopt(jobId);
        if (!result.ok) {
          setActionError(result.error);
        } else if (result.data.status === "obsolete_result") {
          setView(viewFor(result.data.job));
          setNotice("输入已变化，结果未采纳。");
        } else {
          setView(viewFor(result.data.job));
          setNotice(result.data.revision.testOutput === true
            ? `已采纳为测试修订 ${result.data.revision.id}（带测试标记，不能作为正式申请材料）。`
            : `已采纳为修订 ${result.data.revision.id}。`);
          props.onAdopted?.();
        }
        return;
      }
      const result = await engine[operation](jobId);
      if (!result.ok) {
        setActionError(result.error);
        if (operation === "retry" && requiresConsentRecovery(result.error.code)) props.onConsentRequired?.();
      } else setView(viewFor(result.data));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [engine, props.matterId, props.targetId, props.onAdopted, props.onConsentRequired, view, viewFor]);

  const actions = useMemo<GenerationActions>(() => ({
    start: () => act("start"),
    refresh,
    cancel: () => act("cancel"),
    retry: () => act("retry"),
    resume: () => act("resume"),
    discard: () => act("discard"),
    adopt: () => act("adopt"),
    compare: () => {
      if (typeof window === "undefined") return;
      window.dispatchEvent(new CustomEvent("v6:generation-compare", { detail: { jobId: view?.job?.job.id ?? null } }));
    },
  }), [act, refresh, view]);

  const shownView = injected ? (props.initialView ?? null) : view;
  return (
    <GenerationViewPanel
      view={shownView}
      loading={injected ? (props.loading ?? false) : loading}
      loadError={injected ? (props.loadError ?? null) : loadError}
      busy={busy}
      notice={notice}
      actionError={actionError}
      consentUpdated={shouldOfferNewAuthorization(shownView?.job ?? null, props.engineOptions)}
      actions={injected ? { ...NOOP_ACTIONS, ...(props.engineOptions ? actions : {}) } : actions}
    />
  );
}

export default GenerationPanel;
