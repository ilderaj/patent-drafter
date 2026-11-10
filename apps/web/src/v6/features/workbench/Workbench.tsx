import React, { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { Actor, LocalRepository } from "../../lib/repository.ts";
import { Intake } from "../intake/Intake.tsx";
import { DraftEditor } from "../draft/Editor.tsx";
import { DraftReviewSession } from "../draft/Review.tsx";
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
import { TestOutputNotice } from "../../components/TestOutputNotice.tsx";
import { Body, Button, Callout, Group, Icon, Pane, Row, SectionHeader, Sheet, StatusShape, Tabs, Toolbar } from "../../components/ui/index.ts";
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
  const [targetSheet, setTargetSheet] = useState(false);
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
  const selectedIndex = selectedTarget === null ? -1 : overview.targets.indexOf(selectedTarget);
  const targetLabel = selectedTarget === null
    ? `整个案件 · ${overview.targets.length} 个目标`
    : `目标 ${selectedIndex + 1} · ${routeLabel(selectedTarget.route)}`;
  const factsPending = overview.targets.some((target) => target.nextAction === "resolve_conflict");
  const tabItems = MATTER_TABS.map((item) => ({
    key: item.key,
    label: item.label,
    dot: item.key === "facts" && factsPending,
    to: v6Path({ kind: "matter", matterId: overview.matterId, targetId: props.targetId, tab: item.key }),
  }));

  return <>
    <Toolbar
      title={overview.title}
      subtitle={`${overview.matterStatus === "archived" ? "已归档，只读" : "进行中"} · ${targetLabel}`}
      right={<>
        <Button size="sm" icon="globe" onClick={() => setTargetSheet(true)}>
          {selectedTarget === null ? "整个案件" : routeLabel(selectedTarget.route)}
          <Icon name="down" size="sm" />
        </Button>
        <Button variant="primary" size="sm" to={v6Path({ kind: "matter", matterId: overview.matterId, targetId: selectedTarget?.id ?? null, tab: "deliver" })}>交付</Button>
      </>}
    />
    <Tabs items={tabItems} active={props.tab} ariaLabel="案件工作台" />

    {targetSheet ? <Sheet
      title="选择目标"
      subtitle="切换目标只改变视图；修改路线配置请到概览的「目标与路线设置」。"
      onClose={() => setTargetSheet(false)}
      wide
      footer={<Button onClick={() => setTargetSheet(false)}>关闭</Button>}
    >
      <div className="optgrid">
        <button type="button" className={`optcard${props.targetId === null ? " sel" : ""}`}
          data-testid="target-sheet-matter"
          onClick={() => {
            setTargetSheet(false);
            navigate(v6Path({ kind: "matter", matterId: overview.matterId, targetId: null, tab: props.tab }));
          }}>
          <span className={`radio${props.targetId === null ? " on" : ""}`} />
          <span><span className="oc-t">整个案件</span><span className="oc-d" style={{ display: "block" }}>查看所有目标的汇总与下一步。</span></span>
        </button>
        {overview.targets.map((target, index) => <button key={target.id} type="button"
          className={`optcard${target.id === props.targetId ? " sel" : ""}`}
          data-testid={`target-sheet-${target.id}`}
          onClick={() => {
            setTargetSheet(false);
            navigate(v6Path({ kind: "matter", matterId: overview.matterId, targetId: target.id, tab: props.tab }));
          }}>
          <span className={`radio${target.id === props.targetId ? " on" : ""}`} />
          <span>
            <span className="oc-t">目标 {index + 1} · {routeLabel(target.route)}</span>
            <span className="oc-d" style={{ display: "block" }}>{target.status === "active" ? "进行中" : "已归档"} · {languageLabel(target.language)} · {approvalLabel(target.approval)}</span>
          </span>
        </button>)}
      </div>
    </Sheet> : null}

    <Body><Pane width="default">
      <div data-testid="professional-workbench" data-state={state.error ? "stale" : "ready"}
        data-matter-id={overview.matterId} data-tab={props.tab}>
        {testOutput ? <TestOutputNotice revision={{ testOutput: true }} testId="workbench-test-output" /> : null}
        {overview.matterStatus === "archived" ? <Callout tone="warn" icon="alert" testId="workbench-archived">
          案件已归档，现为只读。<Link to="/v6/matters">返回案件列表后可取消归档。</Link>
        </Callout> : null}
        {stale ? <Callout tone="info" icon="clock" testId="workbench-stale">工作台数据已陈旧，正在重新读取。</Callout> : null}
        {state.error ? <Callout tone="risk" icon="alert" testId="workbench-refresh-error">
          {state.error} <Button size="sm" onClick={() => setAttempt((value) => value + 1)}>重试</Button>
        </Callout> : null}
        {state.refreshing ? <p className="field-hint" aria-live="polite">正在读取最新状态…</p> : null}

        {archivedReadOnlyTab ? <ArchivedReadOnlyTab />
          : props.tab === "overview" ? <OverviewPanel overview={overview} repository={props.repository} actor={props.actor} onSettled={onSettled} />
            : props.tab === "sources" ? <MaterialsPanel {...props} onSettled={onSettled} onOpenFacts={() => navigate(v6Path({ kind: "matter", matterId: overview.matterId, targetId: props.targetId, tab: "facts" }))} />
              : props.tab === "facts" ? <Intake repository={props.repository} actor={props.actor} matterId={overview.matterId} />
                : props.tab === "draft" ? <DraftPanel {...props} overview={overview} />
                  : props.tab === "check" ? <ChecksWorkspace repository={props.repository} actor={props.actor} matterId={overview.matterId} targetId={selectedTarget?.id ?? null} rulePack={props.rulePack} rulePackVersion={props.rulePackVersion} />
                    : props.tab === "review" ? <ReviewPanel matterId={overview.matterId} target={selectedTarget} />
                      : props.tab === "deliver" ? <DeliveryWorkspace repository={props.repository} actor={props.actor} matterId={overview.matterId} targetId={selectedTarget?.id ?? null} rulePack={props.rulePack} rulePackVersion={props.rulePackVersion} onSettled={onSettled} />
                        : <ApplicationPanel />}
      </div>
    </Pane></Body>
  </>;
}

function WorkbenchLoading() {
  return <>
    <Toolbar title="案件工作台" subtitle="正在读取本机案件" />
    <Body><Pane><div aria-busy="true" data-testid="professional-workbench-loading">
      <div className="skeleton v6-skeleton" /><div className="skeleton v6-skeleton" />
    </div></Pane></Body>
  </>;
}

function WorkbenchError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <>
    <Toolbar title="案件工作台" subtitle="无法读取" />
    <Body><Pane><div data-testid="professional-workbench-error" data-state="error">
      <Callout tone="risk" icon="alert">
        <b>无法读取工作台</b><div>{message}</div>
        <Button size="sm" onClick={onRetry}>重试</Button>
      </Callout>
    </div></Pane></Body>
  </>;
}

function ArchivedReadOnlyTab() {
  return <div className="card stack-3" data-testid="workbench-archived-readonly">
    <h2 className="card-title">案件已归档</h2>
    <p className="muted">材料、事实、草稿和审阅操作已停用。返回案件列表后可取消归档。</p>
    <Button size="sm" to="/v6/matters">返回案件列表</Button>
  </div>;
}

function OverviewPanel({ overview, repository, actor, onSettled }: {
  overview: WorkbenchOverview;
  repository: LocalRepository;
  actor: Actor;
  onSettled: () => void;
}) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  return <div className="stack-3" data-testid="workbench-overview">
    <div className="casehead">
      <h2>{overview.title}</h2>
      <span className="tag plain">案件 v{overview.matterVersion}</span>
      {overview.targets.some((target) => target.testOutput) ? <span className="tag ai">测试输出</span> : null}
    </div>
    <div className="small muted">发明人：待核实 · 一个案件可以对应多个法域目标</div>

    {overview.targets.length === 0 ? <Callout tone="info" icon="globe">
      尚无目标。选择路线并保存后，可在这里查看进度和下一步；没有示例目标或待办。
    </Callout> : null}

    <SectionHeader title="法域目标" right={`${overview.targets.length} 个目标 · 一个案件可以对应多个法域目标`} />
    <div className="card pad0">
      {overview.targets.length === 0 ? <p className="muted" style={{ padding: 16 }}>还没有目标。</p>
        : <TargetOverviewTable targets={overview.targets} matterId={overview.matterId} />}
    </div>
    <p className="minihint">切换目标只改变视图；修改路线配置请在「目标与路线设置」中保存。旧批准是否仍然有效由当前快照和检查决定。</p>

    <SectionHeader title="下一步" />
    <div data-testid="workbench-next-actions">
      {overview.targets.length === 0 ? <div className="empty"><h3>先添加一个法域目标</h3><p>目标建立后才能生成草稿、检查并准备交付。</p></div>
        : <Group>{overview.targets.map((target, index) => {
          const next = nextActionPresentation(target.nextAction);
          return <Row key={target.id}
            title={`目标 ${index + 1} · ${routeLabel(target.route)}`}
            description={next.description}
            right={next.tab
              ? <Button size="sm" to={v6Path({ kind: "matter", matterId: overview.matterId, targetId: target.id, tab: next.tab })}>{next.linkLabel}</Button>
              : <StatusShape tone="ok" label="暂无待处理" />} />;
        })}</Group>}
    </div>

    <Callout tone="warn" icon="alert">
      <b>提交前需要人工核实。</b>公开历史、优先权、代理要求、保密审查及文件格式取决于具体事实和适用规则。检查结果是提示，不确定法律结果。
    </Callout>

    <div className="row" data-testid="workbench-target-settings">
      <div className="r-main"><div className="r-title">目标与路线设置</div><div className="r-sub">选择路线、申请语言、人员与优先权；保存后生成新的目标配置版本。</div></div>
      <div className="r-right"><Button size="sm" icon="gear" onClick={() => setSettingsOpen(true)}>打开设置</Button></div>
    </div>
    {settingsOpen ? <Sheet title="目标与路线设置" subtitle="修改会写入本机目标配置；取消不会保存。" onClose={() => setSettingsOpen(false)} wide
      footer={<Button onClick={() => setSettingsOpen(false)}>关闭</Button>}>
      <TargetsPanel repository={repository} actor={actor} matterId={overview.matterId} onSettled={() => { onSettled(); }} />
    </Sheet> : null}
  </div>;
}

export interface TargetOverviewTableProps {
  targets: readonly WorkbenchTargetSummary[];
  matterId?: string;
}

/** Read-only target aggregate: route, language, status, approval and next action. */
export function TargetOverviewTable({ targets, matterId }: TargetOverviewTableProps) {
  return <div className="v6-overview-table-wrap">
    <table className="tbl" data-testid="workbench-target-summary">
      <thead><tr><th>目标</th><th>语言</th><th>状态</th><th>内部批准</th><th>下一步</th></tr></thead>
      <tbody>{targets.map((target, index) => <TargetSummaryRow key={target.id} target={target} index={index} matterId={matterId} />)}</tbody>
    </table>
  </div>;
}

function TargetSummaryRow({ target, index, matterId }: { target: WorkbenchTargetSummary; index: number; matterId?: string }) {
  const next = nextActionPresentation(target.nextAction);
  return <tr data-testid={`workbench-target-${target.id}`} data-check-state={target.check.state} data-approval-state={target.approval.state} data-language={target.language ?? ""}>
    <td>
      <div className="r-title">目标 {index + 1} · {routeLabel(target.route)}</div>
      <div className="sub">
        {target.revisionId ? `配置 v${target.configVersion} · 已有修订` : `配置 v${target.configVersion} · 尚无修订`}
        {target.inputStale ? " · 输入陈旧" : ""} · {checkLabel(target.check.state)} · AI 确认 {target.confirmations.confirmed}/{target.confirmations.required}
      </div>
      <details className="v6-tech-details">
        <summary>技术详情</summary>
        <div>目标 ID：<code>{target.id}</code></div>
        {target.revisionId ? <div>修订 ID：<code>{target.revisionId}</code></div> : null}
        {target.check.runId ? <div>检查 ID：<code>{target.check.runId}</code></div> : null}
        {target.check.rulePackVersion ? <div>规则包：<code>{target.check.rulePackVersion}</code></div> : null}
        {target.approval.approvalId ? <div>批准 ID：<code>{target.approval.approvalId}</code></div> : null}
      </details>
    </td>
    <td>{languageLabel(target.language)}</td>
    <td><StatusShape tone={target.status === "active" ? (target.check.state === "current" ? "ok" : "warn") : "idle"}
      label={target.status === "active" ? (target.check.state === "current" ? "当前" : "进行中") : "已归档"} /></td>
    <td>{approvalLabel(target.approval)}</td>
    <td className="v6-target-next">{matterId && next.tab ? <Link className="link" to={v6Path({ kind: "matter", matterId, targetId: target.id, tab: next.tab })}>{next.label}</Link> : <span className="muted">{next.label}</span>}</td>
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
    <SectionHeader title="示例材料与来源" right="文件只保存在本机，不会上传服务器" />
    <Upload repository={props.repository} actor={props.actor} matterId={props.matterId} onAnswerWithoutDocuments={props.onOpenFacts} onSettled={props.onSettled} />
    <SectionHeader title="解析与附图" right="解析和尺寸校验都在本机完成" />
    <Parse repository={props.repository} actor={props.actor} matterId={props.matterId} />
    <Figures repository={props.repository} actor={props.actor} matterId={props.matterId} targetId={props.targetId} onSettled={props.onSettled} />
    <Callout tone="info" icon="users">
      <b>人员与来源。</b>发明人与申请人来自「事实」中的回答；请核对自然人身份、贡献与资料来源。此页不读取或上传实际文件之外的内容。
    </Callout>
  </div>;
}

function DraftPanel(props: ProfessionalWorkbenchProps & { overview: WorkbenchOverview }) {
  if (!props.targetId) return <TargetRequired />;
  const target = props.overview.targets.find((item) => item.id === props.targetId);
  if (!target) return <MatterUnavailable />;
  return <DraftWorkspacePanel repository={props.repository} actor={props.actor} matterId={props.matterId} targetId={props.targetId} route={target.route} generation={props.generation} />;
}

function DraftWorkspacePanel(props: Pick<ProfessionalWorkbenchProps, "repository" | "actor" | "matterId" | "generation"> & { targetId: string; route: string | null }) {
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
    const details = node.closest("details");
    if (details) details.open = true;
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

  const [expandedFeature, setExpandedFeature] = useState<string | null>(null);
  const liveConfirmations = reviewState.currentSnapshot
    ? currentConfirmations(reviewState.ledger, reviewState.currentSnapshot)
    : [];
  const confirmedParagraphIds = liveConfirmations
    .filter((item) => item.kind === "ai_paragraph" && typeof item.paragraphId === "string")
    .map((item) => item.paragraphId as string);
  const confirmationRevisionId = reviewState.isCurrent
    ? reviewState.currentSnapshot?.draftRevisionId ?? null
    : null;
  const ast = reviewState.revision?.ast ?? null;
  const allParagraphs = ast === null ? [] : [
    ...ast.claims.flatMap((claim) => claim.paragraphs),
    ...ast.sections.flatMap((section) => section.paragraphs),
  ];
  const requiredAi = allParagraphs.filter((paragraph) => paragraph.origin === "ai" || paragraph.origin === "mixed").length;
  const confirmedCount = confirmedParagraphIds.length;
  const paragraphNumbers = new Map<string, number>();
  let paragraphIndex = 0;
  for (const section of ast?.sections ?? []) {
    for (const paragraph of section.paragraphs) {
      paragraphIndex += 1;
      paragraphNumbers.set(paragraph.id, paragraphIndex);
    }
  }
  const viewSupport = (paragraphId: string) => {
    const row = reviewState.supportRows.find((item) => item.supportParagraphIds.includes(paragraphId));
    if (!row) return;
    setExpandedFeature(row.featureId);
    requestAnimationFrame(() => {
      document.querySelector(`[data-testid="draft-support-${row.featureId}"]`)?.scrollIntoView?.({ block: "center", behavior: "smooth" });
    });
  };
  const revisionLabel = reviewState.revision?.revision.id ? `修订 ${reviewState.revision.revision.id.slice(0, 8)}` : "尚无修订";

  return <div className="stack-3 v6-draft-workspace" data-testid="workbench-draft-workspace">
    <div className="spread" style={{ flexWrap: "wrap" }}>
      <div>
        <h2 style={{ fontSize: 16 }}>草稿与要素支持</h2>
        <div className="small muted">{routeLabel(props.route ?? null)} · {revisionLabel} · {confirmedCount}/{requiredAi} 段已确认</div>
      </div>
      <Button size="sm" to={v6Path({ kind: "matter", matterId: props.matterId, targetId: props.targetId, tab: "check" })}>查看检查</Button>
    </div>
    <Callout tone="info" icon="spark">
      <b>产品政策：</b>模拟导出前，需要人工确认当前修订的全部 AI 示例段落。确认是工作记录，不等于法律审查或认证。
    </Callout>
    {props.generation ? <details className="v6-generation-strip" data-testid="workbench-generation-panel" open={false}>
      <summary>
        <span>生成任务</span>
        <span className="sh-r">使用配置的本地测试执行引擎 · 展开查看进度与结果</span>
      </summary>
      <div ref={generationRef} tabIndex={-1}>
        <GenerationPanel repository={props.repository} actor={props.actor} matterId={props.matterId} targetId={props.targetId}
          engineOptions={props.generation} onAdopted={onAdopted} />
      </div>
    </details>
      : <div className="notice" data-testid="workbench-generation-unavailable">本工作台没有配置可用的生成执行引擎。不会运行测试输出或联系外部处理方；可继续编辑已保存草稿。</div>}
    <div className="v6-draft-columns" data-testid="workbench-draft-columns">
      <DraftEditor repository={props.repository} actor={props.actor} matterId={props.matterId} targetId={props.targetId}
        confirmationRevisionId={confirmationRevisionId} confirmedParagraphIds={confirmedParagraphIds}
        onGenerateDraft={props.generation ? revealGeneration : undefined}
        generateEntryLabel={props.generation ? "查看生成面板" : undefined}
        onConfirmParagraph={(paragraphId) => { void session.confirmParagraph(paragraphId); }}
        onViewSupport={viewSupport}
        onSaved={onEditorSaved}
        refreshToken={editorRefreshToken} />
      <section className="card stack-3 v6-support-card" data-testid="draft-support-card">
        <div className="card-h">
          <Icon name="eye" />
          要素支持
          <span className="grow" />
          <span className="small muted">{revisionLabel}</span>
        </div>
        <details className="v6-tech-details"><summary>修订与确认详情</summary>
          <div>修订 ID：<code>{reviewState.revision?.revision.id ?? "无"}</code></div>
          <div>确认绑定：<code>{confirmationRevisionId ?? "当前不适用"}</code></div>
          <div>已确认：{confirmedCount}/{requiredAi} 段</div>
        </details>
        {reviewState.supportRows.length === 0 ? <p className="muted">当前修订没有可展示的权利要求要素支持。</p> :
          <table className="supporttbl" data-testid="draft-support-table">
            <thead><tr><th>要素</th><th>说明书段落</th><th>事实</th><th>状态</th></tr></thead>
            <tbody>
              {reviewState.supportRows.map((row) => {
                const expanded = expandedFeature === row.featureId;
                return <Fragment key={row.featureId}>
                  <tr data-testid={`draft-support-${row.featureId}`} data-expanded={expanded ? "true" : "false"}
                    onClick={() => setExpandedFeature(expanded ? null : row.featureId)} style={{ cursor: "pointer" }}>
                    <td>{row.claimNumber}. {row.featureText}</td>
                    <td>{row.supportParagraphIds.length === 0 ? "未关联段落" : row.supportParagraphIds.map((id) => paragraphNumbers.has(id) ? `[${String(paragraphNumbers.get(id)).padStart(4, "0")}]` : "—").join(" ")}</td>
                    <td>{row.factIds.length === 0 ? "未关联事实" : `${row.factIds.length} 条`}</td>
                    <td><StatusShape tone={row.featureStatus === "supported" ? "ok" : row.featureStatus === "partial" ? "warn" : "risk"} label={supportStatusLabel(row.featureStatus)} /></td>
                  </tr>
                  {expanded ? <tr className="support-detail-row"><td colSpan={4}>
                    {row.facts.length === 0 ? <div className="small muted">未关联事实</div> : <ul>
                      {row.facts.map((fact) => <li key={fact.id}>{fact.statement ?? "事实不可用"} · {fact.status ?? "状态未知"}</li>)}
                    </ul>}
                    {row.sourceRefs.length === 0 ? <div className="small muted">没有来源引用。</div> : <ul>
                      {row.sourceRefs.map((ref) => <li key={`${ref.sourceId}/${ref.chunkId}/${ref.start}`}>
                        第 {ref.page ?? "?"} 页 · {ref.quote}
                      </li>)}
                    </ul>}
                  </td></tr> : null}
                </Fragment>;
              })}
            </tbody>
          </table>}
        <p className="small muted">支持映射只展示本机记录，不能证明权利要求得到充分支持；点击行查看来源。</p>
      </section>
    </div>
  </div>;
}

function supportStatusLabel(status: "supported" | "partial" | "unsupported"): string {
  return status === "supported" ? "已支持" : status === "partial" ? "部分支持" : "缺少支持";
}

function ReviewPanel({ matterId, target }: {
  matterId: string;
  target: WorkbenchTargetSummary | null;
}) {
  if (!target) return <TargetRequired />;
  return <div className="stack-3 v6-client-review" data-testid="workbench-client-review" data-release="R3">
    <SectionHeader title="客户审阅往返 · R3" right="本机不发送材料" />
    <Callout tone="info" icon="users">
      <b>客户审阅包、外部回复和往返状态将在 R3 提供。</b>此版本不会向客户发送材料，也不会把内部记录显示为客户意见。
    </Callout>
    <Group>
      <Row title="当前可在草稿页处理什么" description="编辑修订并逐段确认 AI/混合内容；确认是内部工作记录。" right={<Button size="sm" to={v6Path({ kind: "matter", matterId, targetId: target.id, tab: "draft" })}>打开草稿</Button>} />
      <Row title="内部批准与导出" description="内部批准和可用导出状态在交付页查看。" right={<Button size="sm" to={v6Path({ kind: "matter", matterId, targetId: target.id, tab: "deliver" })}>打开交付</Button>} />
    </Group>
  </div>;
}

function ApplicationPanel() {
  return <div className="stack-3" data-testid="workbench-application">
    <SectionHeader title="申请、期限与现有技术" right="R3 能力" />
    <Callout tone="warn" icon="alert">
      <b>尚未实际提交。</b>本页不提供申请号、提交日期、官费或官方回执；内部批准和导出均不构成递交。
    </Callout>
    <Group>
      <Row title="提交状态与基线" description="未实际递交；申请号、提交日期和官费均待确认。" right={<span className="tag plain">未接入</span>} />
      <Row title="优先权与期限" description="基础申请、日期和适用规则需人工核实；不提供未经核实的时效计算。" />
      <Row title="现有技术" description="需要真实检索和人工判断；本版本不提供检索结论。" />
    </Group>
  </div>;
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
