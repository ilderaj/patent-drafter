import React, { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { Actor, LocalRepository } from "../../lib/repository.ts";
import { Intake } from "../intake/Intake.tsx";
import { DraftEditor } from "../draft/Editor.tsx";
import { DraftReviewPanel } from "../draft/Review.tsx";
import { GenerationPanel } from "../generation/Generation.tsx";
import type { GenerationEngineOptions } from "../generation/generation.ts";
import { Figures } from "../sources/Figures.tsx";
import { Parse } from "../sources/Parse.tsx";
import { Upload } from "../sources/Upload.tsx";
import { TargetsPanel } from "../targets/Targets.tsx";
import { ActivityFeed } from "./ActivityFeed.tsx";
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
  const onSettled = () => { void refresh(true); };
  const archivedReadOnlyTab = overview.matterStatus === "archived" && WRITE_TABS.has(props.tab);

  return <main className="v6-page" data-testid="professional-workbench" data-state={state.error ? "stale" : "ready"}
    data-matter-id={overview.matterId} data-tab={props.tab}>
    <header className="stack-3">
      <div className="row-between" style={{ flexWrap: "wrap" }}>
        <div>
          <p className="muted">专业工作台 · {overview.matterStatus === "archived" ? "已归档，只读" : "本机案件"}</p>
          <h1 className="v6-title">{overview.title}</h1>
        </div>
        <Link className="btn btn-outline btn-sm" to={professionalMatterPath(overview.matterId)}>打开同一案件概览</Link>
      </div>
      <MatterTargetNav overview={overview} selectedTargetId={props.targetId} tab={props.tab} />
      <nav className="tabs-list v6-tabs" aria-label="专业工作台标签">
        {MATTER_TABS.map((item) => <Link key={item.key}
          to={v6Path({ kind: "matter", matterId: overview.matterId, targetId: props.targetId, tab: item.key })}
          className="tabs-trigger" data-state={item.key === props.tab ? "active" : "inactive"}
          aria-current={item.key === props.tab ? "page" : undefined}>
          {item.label}
        </Link>)}
      </nav>
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
              : props.tab === "check" ? <ChecksPanel overview={overview} />
                : props.tab === "review" ? <ReviewPanel repository={props.repository} actor={props.actor} matterId={overview.matterId} target={selectedTarget} />
                  : props.tab === "deliver" ? <DeliveryPanel target={selectedTarget} />
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
  return <div className="stack-3" data-testid="workbench-overview">
    <section className="card stack-3">
      <div className="row-between" style={{ flexWrap: "wrap" }}>
        <h2 className="card-title">案件概览</h2>
        <span className="field-hint">案件 v{overview.matterVersion} · 输入 v{overview.sourceVersion}</span>
      </div>
      {overview.targets.length === 0 ? <p className="muted">尚无目标；没有示例目标或待办。</p> : <TargetOverviewTable targets={overview.targets} />}
    </section>
    <TargetsPanel repository={repository} actor={actor} matterId={overview.matterId} onSettled={onSettled} />
    <ActivityFeed repository={repository} actor={actor} currentMatterId={overview.matterId} />
  </div>;
}

export interface TargetOverviewTableProps {
  targets: readonly WorkbenchTargetSummary[];
}

/** Read-only target aggregate: route, language, versions, check, confirmation, approval and next action. */
export function TargetOverviewTable({ targets }: TargetOverviewTableProps) {
  return <div style={{ overflowX: "auto" }}>
    <table className="table" data-testid="workbench-target-summary">
      <thead><tr><th>目标</th><th>路线 / 状态</th><th>语言</th><th>配置 / 修订</th><th>检查</th><th>AI 确认</th><th>内部批准</th><th>下一步</th></tr></thead>
      <tbody>{targets.map((target, index) => <TargetSummaryRow key={target.id} target={target} index={index} />)}</tbody>
    </table>
  </div>;
}

function TargetSummaryRow({ target, index }: { target: WorkbenchTargetSummary; index: number }) {
  return <tr data-testid={`workbench-target-${target.id}`} data-check-state={target.check.state} data-approval-state={target.approval.state} data-language={target.language ?? ""}>
    <td>目标 {index + 1}<div className="field-hint">{target.id}</div></td>
    <td>{routeLabel(target.route)}<div className="field-hint">{target.status === "active" ? "进行中" : "已归档"}</div></td>
    <td>{languageLabel(target.language)}</td>
    <td>配置 v{target.configVersion}<div className="field-hint">{target.revisionId ? `修订 ${target.revisionId}` : "尚无修订"}{target.inputStale ? " · 输入陈旧" : ""}</div></td>
    <td>{checkLabel(target.check.state)}<div className="field-hint">{target.check.rulePackVersion ?? "无检查版本"}</div></td>
    <td>{target.confirmations.confirmed}/{target.confirmations.required}</td>
    <td>{approvalLabel(target.approval)}</td>
    <td><code>{target.nextAction}</code></td>
  </tr>;
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
  return <div className="stack-3" data-testid="workbench-draft">
    {props.generation ? <GenerationPanel repository={props.repository} actor={props.actor} matterId={props.matterId} targetId={props.targetId} engineOptions={props.generation} />
      : <div className="notice" data-testid="workbench-generation-unavailable">本工作台没有配置可用的生成执行引擎。不会运行测试输出或联系外部处理方；可继续编辑已保存草稿。</div>}
    <DraftEditor repository={props.repository} actor={props.actor} matterId={props.matterId} targetId={props.targetId} />
  </div>;
}

function ChecksPanel({ overview }: { overview: WorkbenchOverview }) {
  if (overview.targets.length === 0) return <section className="card" data-testid="workbench-checks-empty"><h2 className="card-title">检查</h2><p className="muted">没有目标，也没有检查记录。</p></section>;
  return <section className="card stack-3" data-testid="workbench-checks">
    <h2 className="card-title">检查状态</h2>
    <p className="muted">检查运行面板尚未接入。这里仅展示本机持久记录派生的状态；没有当前检查时不会显示“无风险”。</p>
    <ul className="v6-list">{overview.targets.map((target) => <li className="v6-entry" key={target.id} data-testid={`workbench-check-${target.id}`} data-state={target.check.state}>
      <strong>{target.id}</strong> · {checkLabel(target.check.state)}
      {target.check.runId ? <div className="field-hint">检查 {target.check.runId} · 规则包 {target.check.rulePackVersion ?? "未记录"}</div> : null}
    </li>)}</ul>
  </section>;
}

function ReviewPanel({ repository, actor, matterId, target }: {
  repository: LocalRepository;
  actor: Actor;
  matterId: string;
  target: WorkbenchTargetSummary | null;
}) {
  if (!target) return <TargetRequired />;
  return <DraftReviewPanel repository={repository} actor={actor} matterId={matterId} targetId={target.id} />;
}

function DeliveryPanel({ target }: { target: WorkbenchTargetSummary | null }) {
  return <section className="card stack-3" data-testid="workbench-delivery">
    <h2 className="card-title">交付准备</h2>
    {!target ? <p className="muted">选择目标后查看它的准备状态。</p> : <>
      <p>目标 {target.id} · 检查：{checkLabel(target.check.state)} · 确认：{target.confirmations.confirmed}/{target.confirmations.required}</p>
      <p>内部批准：{approvalLabel(target.approval)}</p>
      <div className="notice">导出面板尚未接入。本页面不表示文件已提交或取得官方回执。</div>
    </>}
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
