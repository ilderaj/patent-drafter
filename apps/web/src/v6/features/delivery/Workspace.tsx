/**
 * Final R1 workspace wiring (orchestrator-owned integration).
 *
 * Mounts the accepted V6-23 check panel, V6-24 approval panel and V6-25 export /
 * completion view over the same local matter. Preview remains a separate workspace.
 */
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Actor, LocalRepository } from "../../lib/repository.ts";
import { v6Path, type MatterTab } from "../../routes/navigation.ts";
import { ChecksPanel } from "../checks/Checks.tsx";
import { EMPTY_R1_RULE_PACK, R1_ACTIVE_RULE_PACK_VERSION } from "../checks/rule-pack.ts";
import { ApprovalPanel } from "./Approval.tsx";
import type { ApprovalConfirmationMode } from "./Approval.tsx";
import { Done } from "./Done.tsx";
import { Preview } from "../preview/Preview.tsx";
import type { CheckRulePack } from "../../../../../../packages/domain/src/v6/checks.ts";
import type { SnapshotRef } from "../../../../../../packages/contracts/src/index.ts";
import { isCurrent } from "../../../../../../packages/domain/src/v6/revision.js";
import {
  acknowledgeWorkspaceRisk,
  documentStatsOf,
  loadWorkspace,
  persistCheckRun,
  type LoadedWorkspace,
} from "./workspace-data.ts";

export interface WorkspaceProps {
  repository: LocalRepository;
  actor: Actor;
  matterId: string;
  targetId: string | null;
  /** Host-supplied rule pack; tests/embedders may omit it and get an empty pack. */
  rulePack?: CheckRulePack;
  rulePackVersion?: string;
  confirmationMode?: ApprovalConfirmationMode;
  onSettled?: () => void;
}

export function ChecksWorkspace({ repository, actor, matterId, targetId, rulePack, rulePackVersion }: WorkspaceProps) {
  const navigate = useNavigate();
  const pack = rulePack ?? EMPTY_R1_RULE_PACK;
  const version = rulePackVersion ?? R1_ACTIVE_RULE_PACK_VERSION;
  const [state, setState] = useState<{ phase: "loading" } | { phase: "failed"; message: string } | { phase: "ready"; data: LoadedWorkspace }>({ phase: "loading" });
  const refresh = useCallback(async () => {
    if (!targetId) { setState({ phase: "failed", message: "请先选择一个目标。" }); return; }
    setState({ phase: "loading" });
    try {
      const result = await loadWorkspace(repository, actor, matterId, targetId, pack, version, () => new Date().toISOString());
      setState(result.ok ? { phase: "ready", data: result.data } : { phase: "failed", message: result.message });
    } catch {
      setState({ phase: "failed", message: "检查结果或确认记录无法保存，请重试。" });
    }
  }, [repository, actor, matterId, targetId, pack, version]);
  useEffect(() => { void refresh(); }, [refresh]);
  if (state.phase === "loading") return <p className="muted">正在读取检查状态…</p>;
  if (state.phase === "failed") return <div className="notice" role="alert">{state.message}</div>;
  const data = state.data;
  const activeCheckResult = data.checkResult;
  const acknowledgeRisk = async ({ snapshot, checkRunId, riskId }: { snapshot: SnapshotRef; checkRunId: string; riskId: string }) => {
    if (!activeCheckResult || !isCurrent(snapshot, data.snapshot) || checkRunId !== activeCheckResult.checkRun.id
      || !activeCheckResult.findings.some((finding) => finding.id === riskId && finding.category === "risk" && finding.requiresAcknowledgement)) {
      throw new Error("检查或案件快照已变化，请刷新后重新确认。");
    }
    if (!targetId) throw new Error("请先选择一个目标。");
    await acknowledgeWorkspaceRisk(repository, actor, matterId, targetId, { snapshot, checkRunId, riskId });
    await refresh();
  };
  const tabByAction: Readonly<Record<string, MatterTab>> = {
    go_to_edit: "draft",
    ask_expert: "review",
    view_policy: "overview",
    acknowledge_risk: "check",
  };
  return <ChecksPanel
    input={data.checkInput}
    rulePack={pack}
    currentSnapshot={data.snapshot}
    activeRulePackVersion={version}
    initialResult={data.checkResult}
    confirmedRiskIds={data.confirmedRiskIds}
    onResult={async (result) => {
      await persistCheckRun(repository, actor, result);
      setState((current) => current.phase === "ready"
        ? { ...current, data: { ...current.data, checkResult: result, confirmedRiskIds: [] } }
        : current);
    }}
    onRiskAck={acknowledgeRisk}
    onAction={({ action }) => navigate(v6Path({ kind: "matter", matterId, targetId, tab: tabByAction[action] }))}
  />;
}

export function DeliveryWorkspace({ repository, actor, matterId, targetId, rulePack, rulePackVersion, confirmationMode = "professional_paragraphs", onSettled }: WorkspaceProps) {
  const pack = rulePack ?? EMPTY_R1_RULE_PACK;
  const version = rulePackVersion ?? R1_ACTIVE_RULE_PACK_VERSION;
  const [state, setState] = useState<{ phase: "loading" } | { phase: "failed"; message: string } | { phase: "ready"; data: LoadedWorkspace }>({ phase: "loading" });
  const [refreshToken, setRefreshToken] = useState(0);
  useEffect(() => {
    let live = true;
    if (!targetId) { setState({ phase: "failed", message: "请先选择一个目标。" }); return; }
    setState({ phase: "loading" });
    void loadWorkspace(repository, actor, matterId, targetId, pack, version, () => new Date().toISOString()).then((result) => {
      if (!live) return;
      setState(result.ok ? { phase: "ready", data: result.data } : { phase: "failed", message: result.message });
    });
    return () => { live = false; };
  }, [repository, actor, matterId, targetId]);
  if (state.phase === "loading") return <p className="muted">正在读取交付状态…</p>;
  if (state.phase === "failed") return <div className="notice" role="alert">{state.message}</div>;
  const data = state.data;
  const route = data.target.config?.route;
  const settled = () => {
    setRefreshToken((value) => value + 1);
    onSettled?.();
  };
  if (!route) return <div className="notice">请先在概览中配置目标路线。</div>;
  const selfMode = confirmationMode === "self_read";
  const approval = <ApprovalPanel
    repository={repository}
    actor={actor}
    matterId={matterId}
    targetId={targetId!}
    role="owner"
    checkResult={data.checkResult}
    activeRulePackVersion={version}
    filesAvailable={data.filesAvailable}
    confirmationMode={confirmationMode}
    onSettled={settled}
  />;
  const done = <Done
    repository={repository}
    actor={actor}
    matterId={matterId}
    targetId={targetId!}
    route={route}
    access="local_unmetered"
    role="owner"
    checkResult={data.checkResult}
    activeRulePackVersion={version}
    filesAvailable={data.filesAvailable}
    confirmationMode={confirmationMode}
    refreshToken={refreshToken}
    documentStats={documentStatsOf(data.checkInput)}
  />;
  return <div className="stack-3">
    {selfMode ? <>
      {done}
      <details className="group" id="approval-details" data-testid="delivery-approval-details">
        <summary className="section-h"><span>批准与门禁详情</span><span className="sh-r">技术详情</span></summary>
        {approval}
      </details>
    </> : <>{approval}{done}</>}
  </div>;
}

export function PreviewWorkspace({ repository, actor, matterId, targetId, rulePack, rulePackVersion }: WorkspaceProps) {
  const pack = rulePack ?? EMPTY_R1_RULE_PACK;
  const version = rulePackVersion ?? R1_ACTIVE_RULE_PACK_VERSION;
  const [data, setData] = useState<LoadedWorkspace | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    if (!targetId) { setError("请先选择一个目标。"); return; }
    void loadWorkspace(repository, actor, matterId, targetId, pack, version, () => new Date().toISOString()).then((result) => {
      if (!live) return;
      if (result.ok) setData(result.data); else setError(result.message);
    });
    return () => { live = false; };
  }, [repository, actor, matterId, targetId]);
  if (error) return <div className="notice" role="alert">{error}</div>;
  if (!data) return <p className="muted">正在读取预览…</p>;
  return <Preview
    repository={repository}
    actor={actor}
    matterId={matterId}
    targetId={targetId!}
    access="local_unmetered"
    risks={data.risks}
  />;
}
