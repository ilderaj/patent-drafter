/** Workspace data access: check-run persistence, confirmation ledger and check input assembly. */
import { z } from "zod";
import {
  idSchema,
  isoDateTimeSchema,
  snapshotRefSchema,
  type DraftAST,
  type RiskDTO,
  type SnapshotRef,
} from "../../../../../../packages/contracts/src/index.ts";
import { activitySchema, confirmationSchema, revocationSchema } from "../../../../../../packages/contracts/src/index.ts";
import {
  runChecks,
  type CheckAsset,
  type CheckFact,
  type CheckFactConflict,
  type CheckInput,
  type CheckParty,
  type CheckPriorityClaim,
  type CheckRulePack,
  type CheckRunResult,
  type CheckSection,
} from "../../../../../../packages/domain/src/v6/checks.ts";
import { confirm, currentConfirmations, type ConfirmationLedger } from "../../../../../../packages/domain/src/v6/confirmation.js";
import { isCurrent } from "../../../../../../packages/domain/src/v6/revision.js";
import type { Actor, AssetRecord, LocalRepository } from "../../lib/repository.ts";
import { STORES } from "../../lib/repository.ts";
import { createGenerationRevisionStore, type GenerationRevisionView } from "../generation/generation.ts";
import { loadTargetsView, type TargetView } from "../targets/targets.ts";
import { readIntake } from "../intake/intake.ts";
import { loadFigurePanel, type FigurePanelEntry, type LibraryDrawing } from "../sources/drawings.ts";

export interface LoadedWorkspace {
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

export interface StoredCheckRun {
  kind: "checks.run";
  tenantId: string;
  actorId: string;
  matterId: string;
  targetId: string;
  snapshot: SnapshotRef;
  rulePackVersion: string;
  createdAt: string;
}

const storedCheckRunSchema = z.object({
  kind: z.literal("checks.run"),
  tenantId: idSchema,
  actorId: idSchema,
  matterId: idSchema,
  targetId: idSchema,
  snapshot: snapshotRefSchema,
  rulePackVersion: z.string().min(1),
  createdAt: isoDateTimeSchema,
}).strict();

const REQUIRED_SECTIONS: readonly Exclude<CheckSection, "claims">[] = [
  "technical_field",
  "background",
  "summary",
  "figures_description",
  "embodiments",
  "abstract",
];

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

export function documentStatsOf(input: CheckInput): { claims: number; paragraphs: number; figures: number } {
  const ast = input.ast && typeof input.ast === "object" ? input.ast as { claims?: unknown; sections?: unknown } : null;
  const claims = Array.isArray(ast?.claims) ? ast.claims.length : 0;
  const sections = Array.isArray(ast?.sections) ? ast.sections : [];
  const paragraphs = sections.reduce((total, section) => {
    if (!section || typeof section !== "object") return total;
    const values = (section as { paragraphs?: unknown }).paragraphs;
    return total + (Array.isArray(values) ? values.length : 0);
  }, 0);
  const figures = input.figureSet?.entries.length ?? 0;
  return { claims, paragraphs, figures };
}

export async function persistCheckRun(repository: LocalRepository, actor: Actor, result: CheckRunResult): Promise<void> {
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

function mapFigure(entry: FigurePanelEntry) {
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

export async function loadWorkspace(
  repository: LocalRepository,
  actor: Actor,
  matterId: string,
  targetId: string,
  rulePack: CheckRulePack,
  rulePackVersion: string,
  now: () => string,
): Promise<{ ok: true; data: LoadedWorkspace } | { ok: false; message: string }> {
  const matter = await repository.loadMatter(actor, matterId);
  if (!matter.ok) return { ok: false, message: matter.error.message };
  const aggregate = matter.data.data;
  const targets = await loadTargetsView(repository, actor, matterId, undefined, aggregate);
  if (!targets.ok) return { ok: false, message: targets.error.message };
  const target = targets.view.targets.find((item) => item.id === targetId);
  if (!target) return { ok: false, message: "目标不可用。" };
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
  const targetRecord = aggregate.targets.find((item) => item.id === targetId);
  const currentInput = {
    matterId,
    targetId,
    sourceVersion: aggregate.matter.sourceVersion,
    targetConfigVersion: target.configVersion,
    figureRevisionId: targetRecord?.figureRevisionId ?? "",
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
    draftRevisionId: targetRecord?.draftRevisionId ?? "",
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
  const parties: CheckParty[] = intake.view.parties.map((party) => ({
    id: party.id,
    name: party.name,
    kind: party.kind,
    roles: party.roles,
  }));
  const checkInput: CheckInput = {
    snapshot,
    ast,
    facts,
    conflicts,
    disclosure: intake.view.answers.disclosure ?? "none",
    priorityClaims,
    parties,
    route: target.config?.route,
    figureSet: figureRevision
      ? { id: figureRevision.id, entries: figureRevision.entries.map(mapFigure) }
      : null,
    assets: mapCheckAssets(aggregate.assets, figureData?.drawings ?? []),
    draftFigureRevisionId: snapshot.figureRevisionId,
    inputStale,
    requiredSections: REQUIRED_SECTIONS,
  };
  const storedRows = await repository.backend.transaction("readonly", async (tx) => ({
    checkRun: await tx.get(STORES.blobs, checkRunKey(actor, matterId, targetId)),
    confirmations: await tx.get(STORES.blobs, confirmationKey(actor, matterId)),
  }));
  const parsedStored = storedCheckRunSchema.safeParse(storedRows.checkRun);
  const stored = parsedStored.success ? parsedStored.data : null;
  const reusable = stored !== null && stored.tenantId === actor.tenantId && stored.actorId === actor.userId
    && stored.matterId === matterId && stored.targetId === targetId && stored.rulePackVersion === rulePack.version
    && isCurrent(stored.snapshot, snapshot);
  const checkResult = runChecks(checkInput, rulePack, reusable ? stored.createdAt : now());
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

export interface RiskAckTarget {
  snapshot: SnapshotRef;
  checkRunId: string;
  riskId: string;
}

/** Persist one risk acknowledgement against the current snapshot and check run. Throws on refusal. */
export async function acknowledgeWorkspaceRisk(
  repository: LocalRepository,
  actor: Actor,
  matterId: string,
  targetId: string,
  request: RiskAckTarget,
): Promise<void> {
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
  if (!currentSnapshot || !isCurrent(request.snapshot, currentSnapshot)) throw new Error("案件快照已变化，请刷新后重新确认。");
  const raw = await repository.backend.transaction("readonly", (tx) => tx.get(STORES.blobs, confirmationKey(actor, matterId)));
  const ledger = readConfirmationLedger(raw, actor, matterId);
  const outcome = confirm(ledger, {
    kind: "risk_ack",
    snapshot: request.snapshot,
    actorId: actor.userId,
    identity: "local_self_reported",
    riskId: request.riskId,
    checkRunId: request.checkRunId,
  }, { newId: () => crypto.randomUUID(), now: () => new Date().toISOString() });
  if (!outcome.ok) throw new Error(outcome.error.message);
  if (!outcome.created) return;
  const event = activitySchema.parse({
    id: crypto.randomUUID(), tenantId: actor.tenantId, matterId, targetId,
    actorId: actor.userId, actorKind: "user", action: "confirmation.created", snapshot: request.snapshot,
    jobId: null, resourceId: outcome.confirmation.id, occurredAt: outcome.confirmation.createdAt, metadata: { count: 1 },
  });
  const written = await repository.writeConfirmationLedger(actor, matterId, aggregate.matter.version, outcome.state, event, event.occurredAt);
  if (!written.ok) throw new Error(written.error.message);
}
