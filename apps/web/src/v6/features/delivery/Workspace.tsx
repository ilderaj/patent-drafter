/**
 * Final R1 workspace wiring (orchestrator-owned integration).
 *
 * Mounts the accepted V6-23 check panel, V6-24 approval panel, V6-25 export /
 * completion view and V6-20 preview over the same local matter so the deployed
 * app exposes the real end-to-end chain instead of placeholder tabs.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Actor, LocalRepository } from "../../lib/repository.ts";
import { createGenerationRevisionStore, type GenerationRevisionView } from "../generation/generation.ts";
import { loadTargetsView, type TargetView } from "../targets/targets.ts";
import { readIntake } from "../intake/intake.ts";
import { loadFigurePanel, type FigurePanelEntry } from "../sources/drawings.ts";
import { ChecksPanel } from "../checks/Checks.tsx";
import { EMPTY_R1_RULE_PACK, R1_ACTIVE_RULE_PACK_VERSION } from "../checks/rule-pack.ts";
import { ApprovalPanel } from "./Approval.tsx";
import { Done } from "./Done.tsx";
import { Preview } from "../preview/Preview.tsx";
import {
  runChecks,
  type CheckAsset,
  type CheckFact,
  type CheckFactConflict,
  type CheckFigureEntry,
  type CheckInput,
  type CheckPriorityClaim,
  type CheckRulePack,
  type CheckRunResult,
  type CheckSection,
} from "../../../../../../packages/domain/src/v6/checks.ts";
import type { DraftAST, RiskDTO, SnapshotRef } from "../../../../../../packages/contracts/src/index.ts";

export interface WorkspaceProps {
  repository: LocalRepository;
  actor: Actor;
  matterId: string;
  targetId: string | null;
  /** Host-supplied rule pack; tests/embedders may omit it and get an empty pack. */
  rulePack?: CheckRulePack;
  rulePackVersion?: string;
  onSettled?: () => void;
}

interface LoadedWorkspace {
  target: TargetView;
  snapshot: SnapshotRef;
  checkInput: CheckInput;
  checkResult: CheckRunResult | null;
  risks: readonly RiskDTO[];
  filesAvailable: boolean;
  archived: boolean;
}

const REQUIRED_SECTIONS: readonly Exclude<CheckSection, "claims">[] = [
  "technical_field",
  "background",
  "summary",
  "figures_description",
  "embodiments",
  "abstract",
];

function mapFigure(entry: FigurePanelEntry): CheckFigureEntry {
  return { figureId: entry.figureId, number: entry.number, title: entry.title, drawingId: entry.drawingId };
}

async function loadWorkspace(
  repository: LocalRepository,
  actor: Actor,
  matterId: string,
  targetId: string,
  rulePack: CheckRulePack,
  rulePackVersion: string,
  now: () => string,
): Promise<{ ok: true; data: LoadedWorkspace } | { ok: false; message: string }> {
  const targets = await loadTargetsView(repository, actor, matterId);
  if (!targets.ok) return { ok: false, message: targets.error.message };
  const target = targets.view.targets.find((item) => item.id === targetId);
  if (!target) return { ok: false, message: "目标不可用。" };
  const matter = await repository.loadMatter(actor, matterId);
  if (!matter.ok) return { ok: false, message: matter.error.message };
  const aggregate = matter.data.data;
  const intake = await readIntake(repository, actor, matterId);
  if (!intake.ok) return { ok: false, message: intake.message };
  const revisions = createGenerationRevisionStore({ repository, actor });
  const head: GenerationRevisionView | null = await (async () => {
    const loaded = await revisions.loadHeadRevision(matterId, targetId);
    return loaded.ok ? loaded.data : null;
  })();
  const figures = await loadFigurePanel(repository, actor, matterId, { targetId });
  const figureData = "data" in figures && figures.data ? figures.data : null;
  const figureRevision = figureData?.revisions.get(targetId) ?? null;
  const ast: DraftAST | null = head?.ast ?? null;
  const input = head?.revision.input ?? null;
  const currentInput = {
    matterId,
    targetId,
    sourceVersion: aggregate.matter.sourceVersion,
    targetConfigVersion: target.configVersion,
    figureRevisionId: aggregate.targets.find((item) => item.id === targetId)?.figureRevisionId ?? "",
  };
  const inputStale = input !== null && (
    input.sourceVersion !== currentInput.sourceVersion
    || input.targetConfigVersion !== currentInput.targetConfigVersion
    || input.figureRevisionId !== currentInput.figureRevisionId
  );
  const snapshot: SnapshotRef = {
    matterId,
    targetId,
    sourceVersion: aggregate.matter.sourceVersion,
    targetConfigVersion: target.configVersion,
    draftRevisionId: aggregate.targets.find((item) => item.id === targetId)?.draftRevisionId ?? "",
    figureRevisionId: currentInput.figureRevisionId,
  };
  const facts: CheckFact[] = intake.view.facts.map((fact) => ({
    id: fact.id,
    statement: fact.statement,
    status: fact.status,
  }));
  const conflicts: CheckFactConflict[] = intake.view.conflicts.map((conflict) => ({
    id: conflict.id,
    factIds: conflict.factIds,
    state: conflict.state === "resolved" || conflict.state === "retained" ? conflict.state : "open",
  }));
  const priorityClaims: CheckPriorityClaim[] = (target.config?.priorityClaims ?? []).map((claim) => ({
    country: claim.country,
    applicationNumber: claim.applicationNumber,
    verification: claim.verification,
  }));
  const assets: CheckAsset[] = aggregate.assets.map((asset) => ({
    id: asset.id,
    state: asset.state,
    purpose: asset.purpose,
  }));
  const checkInput: CheckInput = {
    snapshot,
    ast,
    facts,
    conflicts,
    disclosure: intake.view.answers.disclosure ?? "none",
    priorityClaims,
    route: target.config?.route,
    figureSet: figureRevision
      ? { id: figureRevision.id, entries: figureRevision.entries.map(mapFigure) }
      : null,
    assets,
    draftFigureRevisionId: snapshot.figureRevisionId,
    inputStale,
    requiredSections: REQUIRED_SECTIONS,
  };
  const checkResult = runChecks(checkInput, rulePack, now());
  void rulePackVersion;
  const risks: RiskDTO[] = checkResult.findings.map((finding) => ({
    id: finding.id,
    category: finding.category,
    title: finding.title,
    explanation: finding.explanation,
    ruleId: finding.ruleId,
    requiresAcknowledgement: finding.requiresAcknowledgement,
    anchor: {
      nodeId: finding.locator.nodeId ?? null,
      section: finding.locator.section ?? null,
      locked: false,
    },
  }));
  const filesAvailable = aggregate.assets.every((asset) => asset.state === "available" || asset.purpose === "export");
  return {
    ok: true,
    data: {
      target,
      snapshot,
      checkInput,
      checkResult,
      risks,
      filesAvailable,
      archived: aggregate.matter.status !== "active",
    },
  };
}

export function ChecksWorkspace({ repository, actor, matterId, targetId, rulePack, rulePackVersion }: WorkspaceProps) {
  const pack = rulePack ?? EMPTY_R1_RULE_PACK;
  const version = rulePackVersion ?? R1_ACTIVE_RULE_PACK_VERSION;
  const [state, setState] = useState<{ phase: "loading" } | { phase: "failed"; message: string } | { phase: "ready"; data: LoadedWorkspace }>({ phase: "loading" });
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
  if (state.phase === "loading") return <p className="muted">正在读取检查状态…</p>;
  if (state.phase === "failed") return <div className="notice" role="alert">{state.message}</div>;
  const data = state.data;
  return <ChecksPanel
    input={data.checkInput}
    rulePack={pack}
    currentSnapshot={data.snapshot}
    activeRulePackVersion={version}
    initialResult={data.checkResult}
    onRiskAck={() => undefined}
    onAction={() => undefined}
  />;
}

export function DeliveryWorkspace({ repository, actor, matterId, targetId, rulePack, rulePackVersion, onSettled }: WorkspaceProps) {
  const pack = rulePack ?? EMPTY_R1_RULE_PACK;
  const version = rulePackVersion ?? R1_ACTIVE_RULE_PACK_VERSION;
  const [state, setState] = useState<{ phase: "loading" } | { phase: "failed"; message: string } | { phase: "ready"; data: LoadedWorkspace }>({ phase: "loading" });
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
  if (!route) return <div className="notice">请先在概览中配置目标路线。</div>;
  return <div className="stack-3">
    <ApprovalPanel
      repository={repository}
      actor={actor}
      matterId={matterId}
      targetId={targetId!}
      role="owner"
      checkResult={data.checkResult}
      activeRulePackVersion={version}
      filesAvailable={data.filesAvailable}
      confirmationMode="professional_paragraphs"
    />
    <Done
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
      confirmationMode="professional_paragraphs"
    />
    <PreviewWorkspace repository={repository} actor={actor} matterId={matterId} targetId={targetId} rulePack={pack} rulePackVersion={version} />
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
