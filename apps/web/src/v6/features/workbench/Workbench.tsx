import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { Actor, LocalRepository } from "../../lib/repository.ts";
import { Intake } from "../intake/Intake.tsx";
import { DraftEditor } from "../draft/Editor.tsx";
import { DraftReviewPanelView, DraftReviewSession } from "../draft/Review.tsx";
import type { DraftReviewState } from "../draft/Review.tsx";
import { currentConfirmations } from "../../../../../../packages/domain/src/v6/confirmation.ts";
import { GenerationPanel } from "../generation/Generation.tsx";
import type { GenerationEngineOptions } from "../generation/generation.ts";
import { Figures } from "../sources/Figures.tsx";
import { Parse } from "../sources/Parse.tsx";
import { Upload } from "../sources/Upload.tsx";
import { TargetsPanel } from "../targets/Targets.tsx";
import { ChecksWorkspace, DeliveryWorkspace } from "../delivery/Workspace.tsx";
import type { CheckRulePack } from "@patent/domain";
import { ActivityFeed } from "./ActivityFeed.tsx";
import { TestOutputNotice } from "./TestOutputNotice.tsx";
import {
  loadWorkbenchOverview,
  type ApprovalValidity,
  type CheckState,
  type TargetLanguage,
  type WorkbenchOverview,
  type WorkbenchTargetSummary,
} from "./workbench.ts";
import { MATTER_TABS, v6Path, type MatterTab } from "../../routes/navigation.ts";

const STALE_AFTER_MS = 60_000;
const REFRESH_CHECK_MS = 15_000;
const WRITE_TABS: ReadonlySet<MatterTab> = new Set(["sources", "facts", "draft", "review"]);

/**
 * A read/write composition surface over one existing `LocalRepository` matter.
 * It expects the V6 router, keeps selection in the supplied route ids, and never
 * creates or copies a matter. `generation` is omitted unless the host has a
 * configured engine; the workbench never enables test output or calls a provider
 * on its own.
 */
export interface ProfessionalWorkbenchProps {
  repository: LocalRepository;
  actor: Actor;
  matterId: string;
  targetId: string | null;
  tab: MatterTab;
  /** Active check rule version from the host registry, when available. */
  activeRulePackVersion?: string | null;
  /** Optional V6-17 engine configuration supplied by the owning application. */
  generation?: Omit<GenerationEngineOptions, "repository" | "actor">;
  /** Host-loaded V6-23 rule pack; omitted in tests/synthetic mounts. */
  rulePack?: CheckRulePack;
  rulePackVersion?: string;
}

type LoadState =
  | { phase: "loading" }
  | { phase: "failed"; error: string }
  | { phase: "ready"; overview: WorkbenchOverview; error: string | null; refreshing: boolean };

/** Build the professional view URL for the same matter id. No repository write occurs. */
export function professionalMatterPath(matterId: string): string {
  return v6Path({ kind: "matter", matterId, targetId: null, tab: "overview" });
}

export function ProfessionalWorkbench(props: ProfessionalWorkbenchProps) {
  const navigate = useNavigate();
  const [state, setState] = useState<LoadState>({ phase: "loading" });
  const [attempt, setAttempt] = useState(0);
  const request = useRef(0);
  const refresh = useCallback(async (retain = true) => {
    const serial = ++request.current;
    setState((previous) => !retain || previous.phase !== "ready"
      ? { phase: "loading" }
      : { ...previous, refreshing: true, error: null });
    const result = await loadWorkbenchOverview(props.repository, props.actor, props.matterId, props.targetId, {
      activeRulePackVersion: props.activeRulePackVersion,
    });
    if (serial !== request.current) return;
    if (!result.ok) {
      const message = result.error.code === "RESOURCE_NOT_FOUND"
        ? "案件不可用。"
        : "无法读取工作台数据。上次读取的结果仍保留；请重试。";
      setState((previous) => previous.phase === "ready"
        ? { ...previous, refreshing: false, error: message }
        : { phase: "failed", error: message });
      return;
    }
    setState({ phase: "ready", overview: result.data, error: null, refreshing: false });
  }, [props.repository, props.actor, props.matterId, props.targetId, props.activeRulePackVersion]);

  useEffect(() => {
    void refresh(false);
    return () => { request.current += 1; };
  }, [refresh, attempt, props.tab]);
  useEffect(() => {
    const onFocus = () => void refresh(true);
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (state.phase !== "ready" || Date.now() - state.overview.loadedAt > STALE_AFTER_MS) void refresh(true);
    }, REFRESH_CHECK_MS);
    return () => window.clearInterval(timer);
  }, [state, refresh]);

  if (state.phase === "loading") return <WorkbenchLoading />;
  if (state.phase === "failed") return <WorkbenchError message={state.error} onRetry={() => setAttempt((value) => value + 1)} />;
  const { overview } = state;
  const stale = Date.now() - overview.loadedAt > STALE_AFTER_MS;
  const selectedTarget = overview.targets.find((target) => target.id === props.targetId) ?? null;
  const testOutput = selectedTarget?.testOutput ?? overview.targets.some((target) => target.testOutput);
  const onSettled = () => { void refresh(true); };
  const archivedReadOnlyTab = overview.matterStatus === "archived" && WRITE_TABS.has(props.tab);

  return <main className="v6-page v6-professional" data-testid="professional-workbench" data-state={state.error ? "stale" : "ready"}
    data-matter-id={overview.matterId} data-tab={props.tab}>
    <header className="v6-workbench-header">
      <div className="v6-workbench-heading">
        <div>
          <p className="muted">专业工作台 · {overview.matterStatus === "archived" ? "已归档，只读" : "本机案件"}</p>
          <h1 className="v6-title">{overview.title}</h1>
        </div>
        <Link className="btn btn-outline btn-sm" to={professionalMatterPath(overview.matterId)}>打开同一案件概览</Link>
      </div>
      <MatterTargetNav overview={overview} selectedTargetId={props.targetId} tab={props.tab} />
      <nav className="v6-workbench-tabs" aria-label="专业工作台标签">
        {MATTER_TABS.map((item) => <Link key={item.key}
          to={v6Path({ kind: "matter", matterId: overview.matterId, targetId: props.targetId, tab: item.key })}
          className="tabs-trigger" data-state={item.key === props.tab ? "active" : "inactive"}
          aria-current={item.key === props.tab ? "page" : undefined}>
          {item.key === "review" ? "客户审阅（R3）" : item.label}
        </Link>)}
      </nav>
      {testOutput ? <TestOutputNotice revision={{ testOutput: true }} testId="workbench-test-output" /> : null}
      {overview.matterStatus === "archived" ? <div className="notice" role="status" data-testid="workbench-archived">
        案件已归档，现为只读。<Link to="/v6/matters">返回案件列表后可取消归档。</Link>
      </div> : null}
      {stale ? <div className="notice" role="status" data-testid="workbench-stale">工作台数据已陈旧，正在重新读取。</div> : null}
      {state.error ? <div className="notice" role="alert" data-testid="workbench-refresh-error">
        {state.error} <button type="button" className="btn btn-outline btn-sm" onClick={() => setAttempt((value) => value + 1)}>重试</button>
      </div> : null}
      {state.refreshing ? <p className="field-hint" aria-live="polite">正在读取最新状态…</p> : null}
    </header>

    {archivedReadOnlyTab ? <ArchivedReadOnlyTab />
      : props.tab === "overview" ? <OverviewPanel overview={overview} repository={props.repository} actor={props.actor} onSettled={onSettled} />
        : props.tab === "sources" ? <MaterialsPanel {...props} onSettled={onSettled} onOpenFacts={() => navigate(v6Path({ kind: "matter", matterId: overview.matterId, targetId: props.targetId, tab: "facts" }))} />
          : props.tab === "facts" ? <Intake repository={props.repository} actor={props.actor} matterId={overview.matterId} />
            : props.tab === "draft" ? <DraftPanel {...props} overview={overview} />
              : props.tab === "check" ? <ChecksWorkspace repository={props.repository} actor={props.actor} matterId={overview.matterId} targetId={selectedTarget?.id ?? null} rulePack={props.rulePack} rulePackVersion={props.rulePackVersion} />
                : props.tab === "review" ? <ReviewPanel matterId={overview.matterId} target={selectedTarget} />
                  : props.tab === "deliver" ? <DeliveryWorkspace repository={props.repository} actor={props.actor} matterId={overview.matterId} targetId={selectedTarget?.id ?? null} rulePack={props.rulePack} rulePackVersion={props.rulePackVersion} onSettled={onSettled} />
                    : <ApplicationPanel />}
  </main>;
}

function WorkbenchLoading() {
  return <main className="v6-page" data-testid="professional-workbench-loading" aria-busy="true">
    <p className="muted">正在读取本机工作台…</p><div className="skeleton v6-skeleton" /><div className="skeleton v6-skeleton" />
  </main>;
}

function WorkbenchError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <main className="v6-page" data-testid="professional-workbench-error" data-state="error">
    <div className="notice" role="alert"><strong>无法读取工作台</strong><p>{message}</p>
      <button type="button" className="btn btn-outline btn-sm" onClick={onRetry}>重试</button>
    </div>
  </main>;
}

function ArchivedReadOnlyTab() {
  return <section className="card" data-testid="workbench-archived-readonly">
    <h2 className="card-title">案件已归档</h2>
    <p className="muted">材料、事实、草稿和审阅操作已停用。返回案件列表后可取消归档。</p>
    <Link className="btn btn-outline btn-sm" to="/v6/matters">返回案件列表</Link>
  </section>;
}

function MatterTargetNav({ overview, selectedTargetId, tab }: { overview: WorkbenchOverview; selectedTargetId: string | null; tab: MatterTab }) {
  if (overview.targets.length === 0) return <p className="field-hint" data-testid="workbench-no-targets">本案还没有目标。可在概览中创建目标；案件与目标均来自同一份本机记录。</p>;
  return <nav className="v6-targets" aria-label="目标">
    <Link className={selectedTargetId === null ? "chip active" : "chip"}
      to={v6Path({ kind: "matter", matterId: overview.matterId, targetId: null, tab })}>整个案件</Link>
    {overview.targets.map((target, index) => <Link key={target.id}
      className={selectedTargetId === target.id ? "chip active" : "chip"}
      to={v6Path({ kind: "matter", matterId: overview.matterId, targetId: target.id, tab })}>
      目标 {index + 1} · {routeLabel(target.route)}
    </Link>)}
  </nav>;
}

function OverviewPanel({ overview, repository, actor, onSettled }: {
  overview: WorkbenchOverview;
  repository: LocalRepository;
  actor: Actor;
  onSettled: () => void;
}) {
  return <div className="stack-3 v6-overview-targets" data-testid="workbench-overview">
    <section className="card stack-3">
      <div className="row-between" style={{ flexWrap: "wrap" }}>
        <h2 className="card-title">案件概览</h2>
        <span className="field-hint">案件 v{overview.matterVersion} · 输入 v{overview.sourceVersion}</span>
      </div>
      {overview.targets.length === 0 ? <p className="muted">尚无目标。选择路线并保存后，可在这里查看进度和下一步。</p> : <TargetOverviewTable targets={overview.targets} matterId={overview.matterId} />}
    </section>
    {overview.targets.length > 0 ? <section className="card stack-3" data-testid="workbench-next-actions">
      <h2 className="card-title">下一步</h2>
      <ul className="v6-list">{overview.targets.map((target, index) => {
        const next = nextActionPresentation(target.nextAction);
        return <li className="v6-entry" key={target.id}>
          <div className="row-between" style={{ flexWrap: "wrap" }}>
            <strong>目标 {index + 1} · {routeLabel(target.route)}</strong>
            {next.tab ? <Link className="btn btn-outline btn-sm" to={v6Path({ kind: "matter", matterId: overview.matterId, targetId: target.id, tab: next.tab })}>{next.linkLabel}</Link> : <span className="badge badge-ok">暂无待处理动作</span>}
          </div>
          <p className="muted">{next.description}</p>
        </li>;
      })}</ul>
    </section> : null}
    <details className="v6-overview-config" data-testid="workbench-target-settings">
      <summary>目标与路线设置</summary>
      <TargetsPanel repository={repository} actor={actor} matterId={overview.matterId} onSettled={onSettled} />
    </details>
    <ActivityFeed repository={repository} actor={actor} currentMatterId={overview.matterId} />
  </div>;
}

export interface TargetOverviewTableProps {
  targets: readonly WorkbenchTargetSummary[];
  matterId?: string;
}

/** Read-only target aggregate: route, language, versions, check, confirmation, approval and next action. */
export function TargetOverviewTable({ targets, matterId }: TargetOverviewTableProps) {
  return <div className="v6-overview-table-wrap">
    <table className="table v6-target-summary" data-testid="workbench-target-summary">
      <thead><tr><th>目标</th><th>路线 / 状态</th><th>语言</th><th>配置 / 修订</th><th>检查</th><th>AI 确认</th><th>内部批准</th><th>下一步</th></tr></thead>
      <tbody>{targets.map((target, index) => <TargetSummaryRow key={target.id} target={target} index={index} matterId={matterId} />)}</tbody>
    </table>
  </div>;
}

function TargetSummaryRow({ target, index, matterId }: { target: WorkbenchTargetSummary; index: number; matterId?: string }) {
  const next = nextActionPresentation(target.nextAction);
  return <tr data-testid={`workbench-target-${target.id}`} data-check-state={target.check.state} data-approval-state={target.approval.state} data-language={target.language ?? ""}>
    <td>目标 {index + 1}<details className="v6-tech-details"><summary>技术详情</summary><code>{target.id}</code></details></td>
    <td>{routeLabel(target.route)}<div className="field-hint">{target.status === "active" ? "进行中" : "已归档"}</div></td>
    <td>{languageLabel(target.language)}</td>
    <td>配置 v{target.configVersion}<div className="field-hint">{target.revisionId ? "已有当前修订" : "尚无修订"}{target.inputStale ? " · 输入陈旧" : ""}</div>{target.revisionId ? <details className="v6-tech-details"><summary>修订编号</summary><code>{target.revisionId}</code></details> : null}</td>
    <td>{checkLabel(target.check.state)}<div className="field-hint">{target.check.rulePackVersion ? "已记录检查规则版本" : "无检查记录"}</div></td>
    <td>{target.confirmations.confirmed}/{target.confirmations.required}<div className="field-hint">段落确认</div></td>
    <td>{approvalLabel(target.approval)}</td>
    <td className="v6-target-next">{matterId && next.tab ? <Link to={v6Path({ kind: "matter", matterId, targetId: target.id, tab: next.tab })}>{next.label}</Link> : next.label}</td>
  </tr>;
}

function nextActionPresentation(action: WorkbenchTargetSummary["nextAction"]): { label: string; description: string; tab: MatterTab | null; linkLabel: string } {
  switch (action) {
    case "add_sources": return { label: "补充材料或事实", description: "添加可用材料，或完成案件事实信息。", tab: "sources", linkLabel: "打开材料" };
    case "resolve_conflict": return { label: "处理事实冲突", description: "查看冲突记录，选择处理意见或保留不确定状态。", tab: "facts", linkLabel: "查看事实" };
    case "generate_draft": return { label: "生成或撰写草稿", description: "准备好当前输入后，运行配置的生成方式或开始手工撰写。", tab: "draft", linkLabel: "打开草稿" };
    case "refresh_inputs": return { label: "核对最新输入", description: "事实、目标配置或附图已变化，请核对后再继续。", tab: "facts", linkLabel: "核对输入" };
    case "confirm_content": return { label: "确认草稿内容", description: "检查当前修订中的 AI 或混合段落，并记录逐段确认。", tab: "draft", linkLabel: "确认内容" };
    case "run_check": return { label: "运行检查", description: "对当前草稿和输入运行规则检查。", tab: "check", linkLabel: "运行检查" };
    case "ack_risk": return { label: "处理检查风险", description: "阅读风险依据并记录需要的人工确认。", tab: "check", linkLabel: "查看风险" };
    case "approve": return { label: "记录内部批准", description: "检查当前导出门禁后，记录本机内部批准。", tab: "deliver", linkLabel: "打开交付" };
    case "export": return { label: "准备导出", description: "查看当前导出门禁和可用文件格式。", tab: "deliver", linkLabel: "查看导出" };
    case "record_receipt": return { label: "核对回执记录", description: "只有取得真实回执后，才能确认提交后的基线。", tab: "filing", linkLabel: "查看申请记录" };
    case "none": return { label: "当前没有待处理动作", description: "当前案件状态没有派生出下一项工作。", tab: null, linkLabel: "" };
  }
}

function MaterialsPanel(props: ProfessionalWorkbenchProps & { onSettled: () => void; onOpenFacts: () => void }) {
  return <div className="stack-3" data-testid="workbench-materials">
    <Upload repository={props.repository} actor={props.actor} matterId={props.matterId} onAnswerWithoutDocuments={props.onOpenFacts} onSettled={props.onSettled} />
    <Parse repository={props.repository} actor={props.actor} matterId={props.matterId} />
    <Figures repository={props.repository} actor={props.actor} matterId={props.matterId} targetId={props.targetId} onSettled={props.onSettled} />
  </div>;
}

function DraftPanel(props: ProfessionalWorkbenchProps & { overview: WorkbenchOverview }) {
  if (!props.targetId) return <TargetRequired />;
  const target = props.overview.targets.find((item) => item.id === props.targetId);
  if (!target) return <MatterUnavailable />;
  return <DraftWorkspacePanel repository={props.repository} actor={props.actor} matterId={props.matterId} targetId={props.targetId} generation={props.generation} />;
}

function DraftWorkspacePanel(props: Pick<ProfessionalWorkbenchProps, "repository" | "actor" | "matterId" | "generation"> & { targetId: string }) {
  const session = useMemo(() => new DraftReviewSession({
    repository: props.repository,
    actor: props.actor,
    matterId: props.matterId,
    targetId: props.targetId,
  }), [props.repository, props.actor, props.matterId, props.targetId]);
  const [reviewState, setReviewState] = useState<DraftReviewState>(() => session.getSnapshot());
  const [editorRefreshToken, setEditorRefreshToken] = useState(0);
  const generationRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const unsubscribe = session.subscribe(setReviewState);
    void session.load();
    return unsubscribe;
  }, [session]);

  const revealGeneration = useCallback(() => {
    const node = generationRef.current;
    if (!node) return;
    node.scrollIntoView?.({ block: "center", behavior: "smooth" });
    node.focus?.({ preventScroll: true });
  }, []);
  const onAdopted = useCallback(() => {
    // Load the adopted head in the editor; an unsaved local buffer stays in conflict view.
    setEditorRefreshToken((value) => value + 1);
    void session.refresh();
  }, [session]);
  const onEditorSaved = useCallback(() => {
    void session.refresh();
  }, [session]);

  const liveConfirmations = reviewState.currentSnapshot
    ? currentConfirmations(reviewState.ledger, reviewState.currentSnapshot)
    : [];
  const confirmedParagraphIds = liveConfirmations
    .filter((item) => item.kind === "ai_paragraph" && typeof item.paragraphId === "string")
    .map((item) => item.paragraphId as string);
  const confirmationRevisionId = reviewState.isCurrent
    ? reviewState.currentSnapshot?.draftRevisionId ?? null
    : null;

  return <div className="stack-3 v6-draft-workspace" data-testid="workbench-draft-workspace">
    {props.generation ? <div ref={generationRef} tabIndex={-1} data-testid="workbench-generation-panel">
      <GenerationPanel repository={props.repository} actor={props.actor} matterId={props.matterId} targetId={props.targetId}
        engineOptions={props.generation} onAdopted={onAdopted} />
    </div>
      : <div className="notice" data-testid="workbench-generation-unavailable">本工作台没有配置可用的生成执行引擎。不会运行测试输出或联系外部处理方；可继续编辑已保存草稿。</div>}
    <div className="v6-draft-columns" data-testid="workbench-draft-columns">
      <DraftEditor repository={props.repository} actor={props.actor} matterId={props.matterId} targetId={props.targetId}
        confirmationRevisionId={confirmationRevisionId} confirmedParagraphIds={confirmedParagraphIds}
        onGenerateDraft={props.generation ? revealGeneration : undefined}
        generateEntryLabel={props.generation ? "查看生成面板" : undefined}
        onSaved={onEditorSaved}
        refreshToken={editorRefreshToken} />
      <div className="v6-draft-review">
        <DraftReviewPanelView
          state={reviewState}
          onRefresh={() => session.refresh()}
          onConfirm={(paragraphId) => session.confirmParagraph(paragraphId)}
          onRevoke={(confirmationId, reason) => session.revokeParagraphConfirmation(confirmationId, reason)}
        />
      </div>
    </div>
  </div>;
}

function ReviewPanel({ matterId, target }: {
  matterId: string;
  target: WorkbenchTargetSummary | null;
}) {
  if (!target) return <TargetRequired />;
  return <section className="card stack-3 v6-client-review" data-testid="workbench-client-review" data-release="R3">
    <h2 className="card-title">客户审阅往返 · R3</h2>
    <p>客户审阅包、外部回复和往返状态将在 R3 提供。此版本不会向客户发送材料，也不会把内部记录显示为客户意见。</p>
    <div className="notice" role="status">
      当前可在草稿页编辑修订并确认 AI/混合段落；内部批准和可用导出状态在交付页查看。
    </div>
    <div className="row" style={{ flexWrap: "wrap" }}>
      <Link className="btn btn-outline btn-sm" to={v6Path({ kind: "matter", matterId, targetId: target.id, tab: "draft" })}>打开草稿</Link>
    </div>
  </section>;
}

function ApplicationPanel() {
  return <section className="card stack-3" data-testid="workbench-application">
    <h2 className="card-title">申请记录</h2>
    <p className="muted">此工作台尚未接入申请记录功能。没有示例申请、签名或提交状态。</p>
    <div className="notice">本页面不表示已签署、已提交或已取得官方回执。</div>
  </section>;
}

function TargetRequired() {
  return <div className="notice" data-testid="workbench-target-required">请先在概览中创建或选择一个目标。</div>;
}

function MatterUnavailable() {
  return <div className="notice" role="alert" data-testid="workbench-target-unavailable">目标不可用。</div>;
}

function routeLabel(route: string | null): string {
  if (route === null) return "路线未配置";
  const labels: Readonly<Record<string, string>> = {
    cn_um: "中国实用新型",
    cn_invention: "中国发明",
    us_nonprovisional: "美国非临时申请",
    pct: "PCT",
  };
  return labels[route] ?? route;
}

function languageLabel(language: TargetLanguage | null): string {
  if (language === null) return "未配置";
  return language === "zh-CN" ? "中文（zh-CN）" : "英文（en-US）";
}

function checkLabel(state: CheckState): string {
  switch (state) {
    case "none": return "尚未检查";
    case "current": return "当前检查";
    case "stale": return "检查已过期";
    case "failed": return "检查失败";
  }
}

function approvalLabel(approval: ApprovalValidity): string {
  if (approval.state === "none") return "无";
  if (approval.state === "valid") return "有效";
  return `无效 · ${approval.reason ?? "依赖已变化"}`;
}
