/**
 * Final R1 workspace wiring (orchestrator-owned integration).
 *
 * Mounts the accepted V6-23 check panel, V6-24 approval panel and V6-25 export /
 * completion view over the same local matter. Preview remains a separate workspace.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Actor, LocalRepository } from "../../lib/repository.ts";
import { STORES } from "../../lib/repository.ts";
import type { AssetRecord } from "../../lib/repository.ts";
import type { LibraryDrawing } from "../sources/drawings.ts";
import { v6Path, type MatterTab } from "../../routes/navigation.ts";
import { createGenerationRevisionStore, type GenerationRevisionView } from "../generation/generation.ts";
import { loadTargetsView, type TargetView } from "../targets/targets.ts";
import { readIntake } from "../intake/intake.ts";
import { loadFigurePanel, type FigurePanelEntry } from "../sources/drawings.ts";
import { ChecksPanel } from "../checks/Checks.tsx";
import { EMPTY_R1_RULE_PACK, R1_ACTIVE_RULE_PACK_VERSION } from "../checks/rule-pack.ts";
import { ApprovalPanel } from "./Approval.tsx";
import type { ApprovalConfirmationMode } from "./Approval.tsx";
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
import { activitySchema, confirmationSchema, revocationSchema } from "../../../../../../packages/contracts/src/index.ts";
import { confirm, currentConfirmations, type ConfirmationLedger } from "../../../../../../packages/domain/src/v6/confirmation.js";
import { isCurrent } from "../../../../../../packages/domain/src/v6/revision.js";

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

interface LoadedWorkspace {
  target: TargetView;
  snapshot: SnapshotRef;
  checkInput: CheckInput;
  checkResult: CheckRunResult | null;
  risks: readonly RiskDTO[];
  filesAvailable: boolean;
  archived: boolean;
  confirmedRiskIds: readonly string[];
  testOutput: boolean;
}

interface StoredCheckRun {
  kind: "checks.run";
  tenantId: string;
  actorId: string;
  matterId: string;
  targetId: string;
  snapshot: SnapshotRef;
  rulePackVersion: string;
  createdAt: string;
}

function checkRunKey(actor: Actor, matterId: string, targetId: string): string {
  return `checks/run/${encodeURIComponent(actor.tenantId)}/${encodeURIComponent(actor.userId)}/${encodeURIComponent(matterId)}/${encodeURIComponent(targetId)}`;
}

function confirmationKey(actor: Actor, matterId: string): string {
  return `draft-review/confirmations/${encodeURIComponent(actor.tenantId)}/${encodeURIComponent(actor.userId)}/${encodeURIComponent(matterId)}`;
}

function emptyConfirmations(matterId: string): ConfirmationLedger {
  return { matterId, confirmations: [], revocations: [] };
}

function readConfirmationLedger(value: unknown, actor: Actor, matterId: string): ConfirmationLedger {
  if (value === undefined) return emptyConfirmations(matterId);
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("确认记录格式无效。");
  const row = value as Record<string, unknown>;
  const ledger = row.ledger as Record<string, unknown> | null;
  if (row.kind !== "draft-review.confirmations" || row.tenantId !== actor.tenantId || row.actorId !== actor.userId
    || row.matterId !== matterId || !ledger || ledger.matterId !== matterId
    || !Array.isArray(ledger.confirmations) || !Array.isArray(ledger.revocations)) throw new Error("确认记录归属或格式无效。");
  return {
    matterId,
    confirmations: ledger.confirmations.map((item) => confirmationSchema.parse(item)),
    revocations: ledger.revocations.map((item) => {
      const parsed = revocationSchema.parse(item);
      if (parsed.objectType !== "confirmation") throw new Error("确认记录包含其他对象类型的撤销。");
      return { ...parsed, objectType: "confirmation" as const };
    }),
  };
}

async function persistCheckRun(repository: LocalRepository, actor: Actor, result: CheckRunResult): Promise<void> {
  const { snapshot, rulePackVersion, createdAt } = result.checkRun;
  const row: StoredCheckRun = {
    kind: "checks.run",
    tenantId: actor.tenantId,
    actorId: actor.userId,
    matterId: snapshot.matterId,
    targetId: snapshot.targetId,
    snapshot,
    rulePackVersion,
    createdAt,
  };
  await repository.backend.transaction("readwrite", (tx) => tx.put(STORES.blobs, checkRunKey(actor, snapshot.matterId, snapshot.targetId), row));
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

export function mapCheckAssets(
  assets: readonly Pick<AssetRecord, "id" | "state" | "purpose">[],
  drawings: readonly Pick<LibraryDrawing, "drawing" | "asset">[],
): CheckAsset[] {
  const drawingIdByAsset = new Map(drawings.map((entry) => [entry.asset.id, entry.drawing.id]));
  return assets.map((asset) => ({
    id: asset.id,
    state: asset.state,
    purpose: asset.purpose,
    ...(drawingIdByAsset.has(asset.id) ? { drawingId: drawingIdByAsset.get(asset.id)! } : {}),
  }));
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
  const assets: CheckAsset[] = mapCheckAssets(aggregate.assets, figureData?.drawings ?? []);
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
  const storedRows = await repository.backend.transaction("readonly", async (tx) => ({
    checkRun: await tx.get(STORES.blobs, checkRunKey(actor, matterId, targetId)),
    confirmations: await tx.get(STORES.blobs, confirmationKey(actor, matterId)),
  }));
  const stored = storedRows.checkRun as Partial<StoredCheckRun> | undefined;
  const reusable = stored?.kind === "checks.run" && stored.tenantId === actor.tenantId && stored.actorId === actor.userId
    && stored.matterId === matterId && stored.targetId === targetId && stored.rulePackVersion === rulePack.version
    && typeof stored.createdAt === "string" && typeof stored.snapshot === "object" && stored.snapshot !== null
    && isCurrent(stored.snapshot as SnapshotRef, snapshot);
  const checkResult = runChecks(checkInput, rulePack, reusable ? stored.createdAt! : now());
  if (!reusable) await persistCheckRun(repository, actor, checkResult);
  const ledger = readConfirmationLedger(storedRows.confirmations, actor, matterId);
  const confirmedRiskIds = checkResult.findings.filter((finding) => finding.category === "risk" && finding.requiresAcknowledgement
    && currentConfirmations(ledger, snapshot).some((item) => item.kind === "risk_ack" && item.riskId === finding.id && item.checkRunId === checkResult.checkRun.id))
    .map((finding) => finding.id);
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
      confirmedRiskIds,
      testOutput: head?.revision.testOutput === true,
    },
  };
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
    const matter = await repository.loadMatter(actor, matterId);
    if (!matter.ok) throw new Error(matter.error.message);
    const aggregate = matter.data.data;
    const target = aggregate.targets.find((item) => item.id === targetId);
    const currentSnapshot = target && target.draftRevisionId !== null ? {
      matterId,
      targetId: target.id,
      sourceVersion: aggregate.matter.sourceVersion,
      targetConfigVersion: target.configVersion,
      draftRevisionId: target.draftRevisionId,
      figureRevisionId: target.figureRevisionId,
    } : null;
    if (!currentSnapshot || !isCurrent(snapshot, currentSnapshot)) throw new Error("案件快照已变化，请刷新后重新确认。");
    const raw = await repository.backend.transaction("readonly", (tx) => tx.get(STORES.blobs, confirmationKey(actor, matterId)));
    const ledger = readConfirmationLedger(raw, actor, matterId);
    const outcome = confirm(ledger, {
      kind: "risk_ack",
      snapshot,
      actorId: actor.userId,
      identity: "local_self_reported",
      riskId,
      checkRunId,
    }, { newId: () => crypto.randomUUID(), now: () => new Date().toISOString() });
    if (!outcome.ok) throw new Error(outcome.error.message);
    if (outcome.created) {
      const event = activitySchema.parse({
        id: crypto.randomUUID(), tenantId: actor.tenantId, matterId, targetId,
        actorId: actor.userId, actorKind: "user", action: "confirmation.created", snapshot,
        jobId: null, resourceId: outcome.confirmation.id, occurredAt: outcome.confirmation.createdAt, metadata: { count: 1 },
      });
      const written = await repository.writeConfirmationLedger(actor, matterId, matter.data.data.matter.version, outcome.state, event, event.occurredAt);
      if (!written.ok) throw new Error(written.error.message);
    }
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
  return <div className="stack-3">
    {data.testOutput ? <p className="notice" role="status" data-testid="delivery-test-output-label">
      测试输出：本地固定测试结果，非真实 AI 生成或正式申请稿。
    </p> : null}
    <ApprovalPanel
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
      confirmationMode={confirmationMode}
      refreshToken={refreshToken}
    />
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
