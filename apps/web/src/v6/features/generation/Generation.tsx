/**
 * V6-17 — generation panel (S04 任务进度与结果采纳).
 *
 * The panel is thin: all job rules live in `generation.ts`. This file renders
 * the five real stages (待处理/进行中/完成/失败/已取消), true completed/total
 * progress, cancellation, retry, interrupted resume/discard, the candidate
 * preview and explicit adoption. It never invents a stage, a timer or a result.
 */
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
  PROVIDER_SCHEMA_INVALID: "处理方输出不符合约定结构。检查处理方配置后重试；不会自动重试。",
  CONSENT_REVOKED: "外发授权已撤回，下次调用不会发出。已发出的调用无法撤回；需要重新授权。",
  CONSENT_REQUIRED: "生成前需要有效的外发授权；请先在 AI 页授权当前材料。",
  QUOTA_EXCEEDED: "额度不足，不能自动切换处理方；请充值、手工编辑或改用其他处理方（需新授权）。",
  JOB_LIMIT_EXCEEDED: "任务超过输入、输出、费用或时长限制；调整限制配置后再启动。",
  PROVIDER_TIMEOUT: "处理方超时；这属于可重试的临时错误，重试会新建任务。",
  RATE_LIMITED: "处理方限流；稍后重试会新建任务，不会自动换处理方。",
  RELEASE_GATE_CLOSED: "真实外发门已关闭；没有发出请求。",
  INVALID_TRANSITION: "任务状态已变化；请刷新后查看当前状态。",
  INPUT_STALE: "输入已变化，结果未采纳；请比较后再人工合并。",
  CAPABILITY_UNAVAILABLE: "当前能力不可用；请检查处理方或测试输出标记。",
  STORAGE_UNAVAILABLE: "本机存储暂时不可用；内容没有保存。",
});

export function recoveryFor(code: GenerationErrorCode | null): string | null {
  return code === null ? null : RECOVERY[code] ?? "发生错误；请按错误码检查配置后重试。";
}

export interface GenerationView {
  matterId: string;
  targetId: string;
  job: GenerationJobView | null;
  stages: readonly GenerationStageView[];
  progress: { completed: number; total: number | null; unit: string };
  /** `obsolete_result`: input or base revision changed before completion/adoption. */
  inputStale: boolean;
  /** True when the result is a fixture/stub output and cannot be adopted. */
  testOutput: boolean;
  canStart: boolean;
  canCancel: boolean;
  canRetry: boolean;
  canResume: boolean;
  canDiscard: boolean;
  canAdopt: boolean;
  /** The draft revision produced by adoption; null until adopted. */
  revisionId: string | null;
}

export function generationView(job: GenerationJobView | null, matterId: string, targetId: string, canStart = true): GenerationView {
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
  const canAdopt = state === "succeeded" && job?.result !== null && !inputStale && !testOutput && job?.job.disposition === "ready";
  return {
    matterId,
    targetId,
    job,
    stages,
    progress: job?.progress ?? { completed: 0, total: GENERATE_STAGES.length, unit: "stage" },
    inputStale,
    testOutput,
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
}

export interface GenerationViewProps {
  view: GenerationView | null;
  loading: boolean;
  loadError: { code: string; message: string } | null;
  busy: boolean;
  notice: string | null;
  actionError: { code: string; message: string } | null;
  actions: GenerationActions;
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
  return (
    <li
      className="v6-entry"
      data-testid={`generation-stage-${stage.stage}`}
      data-state={stage.state}
      data-error-code={stage.errorCode ?? undefined}
    >
      <div className="row" style={{ flexWrap: "wrap" }}>
        <strong>{label}</strong>
        <span className="badge badge-outline" data-testid={`generation-stage-state-${stage.stage}`}>
          {STAGE_STATE_LABELS[stage.state]}
        </span>
        {stage.errorCode !== null ? <code data-testid={`generation-stage-error-${stage.stage}`}>{stage.errorCode}</code> : null}
      </div>
      {stage.outputMeta !== null ? (
        <span className="field-hint" data-testid={`generation-stage-meta-${stage.stage}`}>
          检查点 {stage.outputMeta.outputHash.slice(0, 12)}… · 完成于 {stage.outputMeta.completedAt}
        </span>
      ) : null}
    </li>
  );
}

function CandidatePreview({ view, actions }: { view: GenerationView; actions: GenerationActions }) {
  if (view.job?.result === null || view.job?.result === undefined) return null;
  const ast = view.job.result.ast;
  return (
    <div className="stack-3" data-testid="generation-result" data-test-output={view.job.result.testOutput}>
      <h3 className="card-title">候选结果</h3>
      {view.job.support != null ? (
        <p className="field-hint" data-testid="generation-support">
          依据索引：{view.job.support.facts.length} 条确认事实，未解析 {view.job.support.unresolvedFactIds.length} 条
          {view.job.support.unresolvedFactIds.length > 0 ? `（${view.job.support.unresolvedFactIds.join("、")}）` : ""}
        </p>
      ) : null}
      {view.job.result.testOutput ? (
        <p className="notice" data-testid="generation-test-output">
          测试输出：这是固定测试结果，可预览，不能采纳为正式生成修订。
        </p>
      ) : null}
      {ast.claims.map((claim) => (
        <article key={claim.id} className="card" data-testid={`generation-claim-${claim.number}`}>
          <h4 className="card-title">权利要求 {claim.number}</h4>
          {claim.paragraphs.map((paragraph) => (
            <p key={paragraph.id}>{paragraph.text}</p>
          ))}
        </article>
      ))}
      {ast.sections.map((section) => (
        <section key={section.kind} className="stack-3" data-testid={`generation-section-${section.kind}`}>
          <h4 className="card-title">{SECTION_LABELS[section.kind] ?? section.kind}</h4>
          {section.paragraphs.map((paragraph) => (
            <p key={paragraph.id}>{paragraph.text}</p>
          ))}
        </section>
      ))}
      {view.inputStale ? (
        <div className="notice" role="alert" data-testid="generation-input-stale" style={STACK}>
          <strong>输入已变化，结果未采纳</strong>
          <p>生成期间事实、草稿或基础修订发生变化。请比较当前稿与本候选后再人工合并。</p>
          <button type="button" className="btn btn-outline btn-sm" data-testid="generation-compare" onClick={() => void actions.compare?.()}>
            比较当前稿
          </button>
        </div>
      ) : null}
      {view.testOutput ? null : (
        <button
          type="button"
          className="btn btn-default"
          data-testid="generation-adopt"
          disabled={!view.canAdopt}
          title={view.inputStale ? "输入已变化，结果未采纳" : undefined}
          onClick={() => void actions.adopt()}
        >
          采纳为新修订
        </button>
      )}
    </div>
  );
}

export function GenerationViewPanel(props: GenerationViewProps) {
  const { view, loading, loadError, busy, notice, actionError, actions } = props;
  if (loading) {
    return (
      <section className="card" data-testid="generation" data-state="loading" aria-busy="true">
        <h2 className="card-title">生成任务</h2>
        <p className="muted" data-testid="generation-loading">正在读取本机生成任务…</p>
        <div className="skeleton v6-skeleton" />
      </section>
    );
  }
  if (loadError !== null) {
    return (
      <section className="card" data-testid="generation" data-state="error">
        <h2 className="card-title">生成任务</h2>
        <div className="notice" role="alert" data-testid="generation-load-error" data-code={loadError.code} style={STACK}>
          <strong>读取失败</strong>
          <p>{loadError.message}</p>
          <button type="button" className="btn btn-outline btn-sm" data-testid="generation-refresh" onClick={() => void actions.refresh()}>
            重试
          </button>
        </div>
      </section>
    );
  }
  if (view === null || view.job === null) {
    return (
      <section className="card" data-testid="generation" data-state="empty">
        <h2 className="card-title">生成任务</h2>
        <p className="muted" data-testid="generation-empty">
          本案还没有生成任务。启动后会按五个阶段写入本机检查点；刷新或关闭页面会标为中断。
        </p>
        <button
          type="button"
          className="btn btn-default"
          data-testid="generation-start"
          disabled={busy || !view?.canStart}
          onClick={() => void actions.start()}
        >
          {busy ? "正在启动…" : "开始生成"}
        </button>
      </section>
    );
  }
  const job = view.job;
  const state = job.job.state;
  const failed = job.stages.find((stage) => stage.state === "failed") ?? null;
  return (
    <section className="card stack-3" data-testid="generation" data-state="ready" data-job-state={state}>
      <div className="row-between">
        <h2 className="card-title">生成任务</h2>
        <span className="field-hint" data-testid="generation-job-state">{JOB_STATE_LABELS[state]}</span>
      </div>
      <p className="field-hint" data-testid="generation-progress" data-completed={view.progress.completed} data-total={view.progress.total ?? ""}>
        进度 {view.progress.completed}/{view.progress.total ?? "?"} 阶段
      </p>
      {view.inputStale ? (
        <div className="notice" role="alert" data-testid="generation-input-stale" style={STACK}>
          <strong>输入已变化，结果未采纳</strong>
          <p>生成期间事实、草稿或基础修订发生变化。请比较当前稿与本候选后再人工合并。</p>
          <button type="button" className="btn btn-outline btn-sm" data-testid="generation-compare" onClick={() => void actions.compare?.()}>
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
          <strong>阶段失败：{STAGE_LABELS[failed.stage]}（{failed.errorCode}）</strong>
          <p data-testid="generation-recovery">{recoveryFor(failed.errorCode)}</p>
          <p className="field-hint">{job.errorMessage}</p>
        </div>
      ) : null}
      <ol className="v6-list" data-testid="generation-stages">
        {view.stages.map((stage) => <StageRow key={stage.stage} stage={stage} />)}
      </ol>
      <div className="row" style={{ flexWrap: "wrap" }}>
        {view.canStart ? (
          <button type="button" className="btn btn-default btn-sm" data-testid="generation-start" disabled={busy} onClick={() => void actions.start()}>
            新建任务
          </button>
        ) : null}
        {view.canCancel ? (
          <button type="button" className="btn btn-outline btn-sm" data-testid="generation-cancel" disabled={busy} onClick={() => void actions.cancel()}>
            取消
          </button>
        ) : null}
        {view.canResume ? (
          <button type="button" className="btn btn-default btn-sm" data-testid="generation-resume" disabled={busy} onClick={() => void actions.resume()}>
            从已保存阶段继续
          </button>
        ) : null}
        {view.canRetry ? (
          <button type="button" className="btn btn-default btn-sm" data-testid="generation-retry" disabled={busy} onClick={() => void actions.retry()}>
            重试为新任务
          </button>
        ) : null}
        {view.canDiscard ? (
          <button type="button" className="btn btn-outline btn-sm" data-testid="generation-discard" disabled={busy} onClick={() => void actions.discard()}>
            放弃
          </button>
        ) : null}
        <button type="button" className="btn btn-outline btn-sm" data-testid="generation-refresh" disabled={busy} onClick={() => void actions.refresh()}>
          刷新
        </button>
      </div>
      <CandidatePreview view={view} actions={actions} />
      {actionError !== null ? (
        <div className="notice" role="alert" data-testid="generation-action-error" data-code={actionError.code} style={STACK}>
          <p>{actionError.message}</p>
        </div>
      ) : null}
      <p className="field-hint" role="status" aria-live="polite" data-testid="generation-notice">{notice ?? ""}</p>
    </section>
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
    setView(generationView(listed.data[0] ?? null, props.matterId, props.targetId));
  }, [injected, engine, props.matterId, props.targetId]);

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
        if (!result.ok) setActionError(result.error);
        else setView(generationView(result.data, props.matterId, props.targetId));
        return;
      }
      const jobId = view?.job?.job.id;
      if (!jobId) return;
      if (operation === "adopt") {
        const result = await engine.adopt(jobId);
        if (!result.ok) {
          setActionError(result.error);
        } else if (result.data.status === "obsolete_result") {
          setView(generationView(result.data.job, props.matterId, props.targetId));
          setNotice("输入已变化，结果未采纳。");
        } else {
          setView(generationView(result.data.job, props.matterId, props.targetId));
          setNotice(`已采纳为修订 ${result.data.revision.id}。`);
        }
        return;
      }
      const result = await engine[operation](jobId);
      if (!result.ok) setActionError(result.error);
      else setView(generationView(result.data, props.matterId, props.targetId));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [engine, props.matterId, props.targetId, view]);

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

  return (
    <GenerationViewPanel
      view={injected ? (props.initialView ?? null) : view}
      loading={injected ? (props.loading ?? false) : loading}
      loadError={injected ? (props.loadError ?? null) : loadError}
      busy={busy}
      notice={notice}
      actionError={actionError}
      actions={injected ? { ...NOOP_ACTIONS, ...(props.engineOptions ? actions : {}) } : actions}
    />
  );
}

export default GenerationPanel;
