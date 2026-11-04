import {
  CONTRACT_VERSION,
  type ActivityRecord,
  type Actor,
  type CommitResult,
  type LocalRepository,
  type MatterAggregate,
  type MatterRecord,
  type RepositoryError,
  type RepositoryResult,
  type TargetRecord,
} from "../../lib/repository.ts";
import { nextAction, type NextActionKind, type NextActionState } from "./actions.ts";

export const DEFAULT_MATTER_TITLE = "未命名案件";
export const MATTER_PAGE_SIZE = 25;
export const MATTER_STALE_AFTER_MS = 60_000;
export const ROUTES = Object.freeze(["cn_um", "cn_invention", "us_nonprovisional", "pct"] as const);
export type MatterRoute = (typeof ROUTES)[number];

export interface CreateMatterInput {
  matterId: string;
  eventId: string;
  requestId: string;
  now: string;
  title?: string;
}

export interface MatterChangeInput {
  matterId: string;
  expectedVersion: number;
  eventId: string;
  requestId: string;
  now: string;
  title?: string;
}

export interface MatterFilters {
  status?: "active" | "archived" | "all";
  route?: MatterRoute | null;
  nextAction?: NextActionKind | null;
  title?: string;
  page?: number;
}

export interface MatterTargetRow {
  id: string;
  status: TargetRecord["status"];
  route: MatterRoute | null;
  configVersion: number;
  nextAction: NextActionKind;
}

export interface MatterListRow {
  matter: MatterRecord;
  targets: readonly MatterTargetRow[];
  nextAction: NextActionKind;
}

export interface MatterPage {
  items: readonly MatterListRow[];
  total: number;
  page: number;
  pageSize: number;
  loadedAt: number;
}

export interface MatterReadContext {
  aggregate: MatterAggregate;
  events: readonly ActivityRecord[];
  /** Namespaced local records. Consumers must validate each row's matter/target ids. */
  blobs: readonly unknown[];
  targetRows: readonly MatterTargetRow[];
  /** The shared S06 projection chosen for the matter (active target first). */
  matterNextAction: NextActionKind;
  targetActions: ReadonlyMap<string, NextActionState>;
  snapshot: Record<string, unknown> | null;
}

export type MatterContextResult =
  | { ok: true; data: MatterReadContext }
  | { ok: false; error: RepositoryError };

export async function createMatter(
  repository: LocalRepository,
  actor: Actor,
  input: CreateMatterInput,
): Promise<RepositoryResult<CommitResult>> {
  const title = cleanTitle(input.title);
  const matter: MatterRecord = {
    id: input.matterId,
    tenantId: actor.tenantId,
    version: 1,
    title,
    status: "active",
    sourceVersion: 1,
    createdBy: actor.userId,
    createdAt: input.now,
    updatedAt: input.now,
  };
  const event = activity(actor, input.matterId, input.eventId, "matter.created", 1, input.now);
  const committed = await repository.commit(
    actor,
    {
      contractVersion: CONTRACT_VERSION,
      expectedVersion: 0,
      payload: { matter, targets: [], assets: [], events: [event], blobs: [] },
    },
    { requestId: input.requestId },
  );
  if (committed.ok || committed.error.code !== "VERSION_CONFLICT") return committed;
  const existing = await repository.loadMatter(actor, input.matterId);
  if (!existing.ok) return committed;
  const events = await repository.listEvents(actor, input.matterId);
  if (!events.ok) return { ok: false, error: events.error };
  if (!events.data.items.some((record) => record.id === input.eventId && record.action === "matter.created")) return committed;
  return {
    ok: true,
    data: {
      data: existing.data.data,
      version: existing.data.version,
      eventIds: [],
      requestId: input.requestId,
    },
  };
}

export async function renameMatter(
  repository: LocalRepository,
  actor: Actor,
  input: MatterChangeInput,
): Promise<RepositoryResult<CommitResult>> {
  return updateMatter(repository, actor, input, (matter) => ({ ...matter, title: cleanTitle(input.title) }), "matter.renamed");
}

export async function archiveMatter(
  repository: LocalRepository,
  actor: Actor,
  input: MatterChangeInput,
): Promise<RepositoryResult<CommitResult>> {
  return updateMatter(repository, actor, input, (matter) => ({ ...matter, status: "archived" }), "matter.archived");
}

export async function unarchiveMatter(
  repository: LocalRepository,
  actor: Actor,
  input: MatterChangeInput,
): Promise<RepositoryResult<{ matter: MatterRecord; version: number }>> {
  return repository.unarchiveMatter(actor, {
    matterId: input.matterId,
    expectedVersion: input.expectedVersion,
    updatedAt: input.now,
  });
}

async function updateMatter(
  repository: LocalRepository,
  actor: Actor,
  input: MatterChangeInput,
  change: (matter: MatterRecord) => MatterRecord,
  action: "matter.renamed" | "matter.archived" | null,
): Promise<RepositoryResult<CommitResult>> {
  const loaded = await repository.loadMatter(actor, input.matterId);
  if (!loaded.ok) return loaded;
  const version = input.expectedVersion + 1;
  const matter = { ...change(loaded.data.data.matter), version, updatedAt: input.now };
  const events = action === null ? [] : [activity(actor, input.matterId, input.eventId, action, version, input.now)];
  return repository.commit(
    actor,
    {
      contractVersion: CONTRACT_VERSION,
      expectedVersion: input.expectedVersion,
      payload: {
        matter,
        targets: loaded.data.data.targets,
        assets: loaded.data.data.assets,
        events,
        blobs: [],
      },
    },
    { requestId: input.requestId },
  );
}

export async function readMatterContext(
  repository: LocalRepository,
  actor: Actor,
  matterId: string,
): Promise<MatterContextResult> {
  const loaded = await repository.loadMatter(actor, matterId);
  if (!loaded.ok) return { ok: false, error: loaded.error };
  if (loaded.data.data.matter.status === "deletion_pending") {
    return { ok: false, error: { code: "RESOURCE_NOT_FOUND", message: "matter not found" } };
  }
  const eventResult = await repository.listEvents(actor, matterId);
  if (!eventResult.ok) return { ok: false, error: eventResult.error };

  try {
    const { blobs, snapshot, configs } = await repository.backend.transaction("readonly", async (tx) => {
      const blobs = await tx.getAll("blobs");
      const snapshotKey = `intake/snapshot/${matterId}/${loaded.data.data.matter.sourceVersion}`;
      const rawSnapshot = await tx.get("blobs", snapshotKey);
      const snapshot = isRecord(rawSnapshot)
        && rawSnapshot.kind === "intake.snapshot"
        && isRecord(rawSnapshot.snapshot)
        && rawSnapshot.snapshot.matterId === matterId
        && rawSnapshot.snapshot.version === loaded.data.data.matter.sourceVersion
        ? rawSnapshot.snapshot
        : null;
      if (rawSnapshot !== undefined && snapshot === null) throw new Error("saved intake snapshot is malformed");
      const configs = new Map<string, MatterRoute | null>();
      for (const target of loaded.data.data.targets) {
        const event = eventResult.data.items.find((item) =>
          (item.action === "target.created" || item.action === "target.config_updated")
          && item.targetId === target.id
          && item.metadata.version === target.configVersion,
        );
        if (!event) {
          configs.set(target.id, null);
          continue;
        }
        const key = [
          "targets/config",
          encodeURIComponent(actor.tenantId),
          encodeURIComponent(matterId),
          encodeURIComponent(target.id),
          String(target.configVersion),
          encodeURIComponent(event.id),
        ].join("/");
        const raw = await tx.get("blobs", key);
        const route = isRecord(raw)
          && raw.kind === "target.config"
          && raw.tenantId === actor.tenantId
          && raw.matterId === matterId
          && raw.targetId === target.id
          && isRecord(raw.config)
          && isMatterRoute(raw.config.route)
          ? raw.config.route
          : null;
        configs.set(target.id, route);
      }
      return { blobs, snapshot, configs };
    });
    const aggregate = loaded.data.data;
    const targetActions = new Map<string, NextActionState>();
    const targetRows = aggregate.targets.map((target) => {
      const actionState = deriveTargetActionState(aggregate, target, snapshot, blobs, eventResult.data.items);
      targetActions.set(target.id, actionState);
      return {
        id: target.id,
        status: target.status,
        route: configs.get(target.id) ?? null,
        configVersion: target.configVersion,
        nextAction: nextAction(actionState),
      };
    });
    const matterNextAction = targetRows.find((target) => target.status === "active")?.nextAction
      ?? targetRows[0]?.nextAction
      ?? nextAction(deriveMatterActionState(aggregate, snapshot, blobs));
    return {
      ok: true,
      data: { aggregate, events: eventResult.data.items, blobs, targetRows, matterNextAction, targetActions, snapshot },
    };
  } catch {
    return { ok: false, error: { code: "STORAGE_UNAVAILABLE", message: "无法读取本机案件状态。" } };
  }
}

export function deriveTargetActionState(
  aggregate: MatterAggregate,
  target: TargetRecord,
  snapshot: Record<string, unknown> | null,
  blobs: readonly unknown[],
  events: readonly ActivityRecord[] = [],
): NextActionState {
  const snapshotData = snapshot ?? {};
  const answers = isRecord(snapshotData.answers) ? snapshotData.answers : {};
  const factsComplete = typeof answers.problem === "string" && answers.problem.trim().length > 0
    && typeof answers.difference === "string" && answers.difference.trim().length > 0
    && Array.isArray(answers.inventorIds) && answers.inventorIds.length > 0
    && typeof answers.disclosure === "string"
    && typeof answers.maturity === "string";
  const conflicts = Array.isArray(snapshotData.conflicts) ? snapshotData.conflicts : [];
  const liveSources = liveSourceAssetIds(aggregate, blobs);
  const revision = findCurrentRevision(blobs, aggregate.matter.id, target.id, target.draftRevisionId);
  const currentInput = {
    matterId: aggregate.matter.id,
    targetId: target.id,
    sourceVersion: aggregate.matter.sourceVersion,
    targetConfigVersion: target.configVersion,
    figureRevisionId: target.figureRevisionId,
    draftRevisionId: target.draftRevisionId,
  };
  const draftInput = revision && isRecord(revision.input) ? revision.input : null;
  const inputStale = draftInput !== null && (
    draftInput.matterId !== currentInput.matterId
    || draftInput.targetId !== currentInput.targetId
    || draftInput.sourceVersion !== currentInput.sourceVersion
    || draftInput.targetConfigVersion !== currentInput.targetConfigVersion
    || draftInput.figureRevisionId !== currentInput.figureRevisionId
  );
  const generatedParagraphs = draftParagraphIds(revision);
  const confirmations = confirmationLedger(blobs, aggregate.matter.id, currentInput);
  const pendingParagraphIds = generatedParagraphs.filter((paragraphId) => !confirmations.confirmed.has(paragraphId));
  const currentCheck = currentCheckRun(blobs, target, currentInput);
  const hasCurrentExport = currentSnapshotExport(blobs, target, currentInput);
  const unacknowledgedRisk = currentCheck?.findings?.some((finding) =>
    isRecord(finding) && finding.requiresAcknowledgement === true && finding.status !== "acknowledged",
  ) ?? false;
  const mode = matterMode(aggregate.matter);
  return {
    hasValidSource: liveSources.size > 0,
    fiveQuestionsComplete: factsComplete,
    hasOpenConflict: conflicts.some((conflict) => isRecord(conflict) && conflict.state === "open"),
    hasDraft: target.draftRevisionId !== null,
    inputStale,
    mode,
    hasUnconfirmedGeneratedContent: pendingParagraphIds.length > 0,
    hasFullRead: confirmations.fullRead,
    hasCurrentCheck: currentCheck !== null && currentCheck.state === "succeeded",
    hasUnacknowledgedRequiredRisk: unacknowledgedRisk,
    hasInternalApproval: currentApproval(blobs, currentInput, events, currentCheck, confirmations.ids, unacknowledgedRisk),
    hasCurrentExport,
    hasConfirmedReceipt: blobs.some((row) => isConfirmedReceiptForTarget(row, target.id)),
  };
}

function deriveMatterActionState(
  aggregate: MatterAggregate,
  snapshot: Record<string, unknown> | null,
  blobs: readonly unknown[],
): NextActionState {
  const answers = snapshot && isRecord(snapshot.answers) ? snapshot.answers : {};
  const complete = typeof answers.problem === "string" && answers.problem.trim().length > 0
    && typeof answers.difference === "string" && answers.difference.trim().length > 0
    && Array.isArray(answers.inventorIds) && answers.inventorIds.length > 0
    && typeof answers.disclosure === "string" && typeof answers.maturity === "string";
  return {
    hasValidSource: liveSourceAssetIds(aggregate, blobs).size > 0,
    fiveQuestionsComplete: complete,
    hasOpenConflict: snapshot !== null && Array.isArray(snapshot.conflicts)
      && snapshot.conflicts.some((conflict) => isRecord(conflict) && conflict.state === "open"),
    hasDraft: false,
    inputStale: false,
    mode: matterMode(aggregate.matter),
    hasUnconfirmedGeneratedContent: false,
    hasFullRead: false,
    hasCurrentCheck: false,
    hasUnacknowledgedRequiredRisk: false,
    hasInternalApproval: false,
    hasCurrentExport: false,
    hasConfirmedReceipt: false,
  };
}

function liveSourceAssetIds(aggregate: MatterAggregate, blobs: readonly unknown[]): Set<string> {
  const retired = new Set<string>();
  for (const row of blobs) {
    if (!isRecord(row) || row.kind !== "parse.source" || !isRecord(row.source)) continue;
    if (row.source.matterId === aggregate.matter.id && typeof row.source.assetId === "string" && typeof row.source.retiredAt === "string") {
      retired.add(row.source.assetId);
    }
  }
  return new Set(aggregate.assets
    .filter((asset) => asset.matterId === aggregate.matter.id && asset.purpose === "source" && asset.state === "available")
    .filter((asset) => !retired.has(asset.id))
    .map((asset) => asset.id));
}

function findCurrentRevision(
  blobs: readonly unknown[],
  matterId: string,
  targetId: string,
  revisionId: string | null,
): Record<string, unknown> | null {
  if (revisionId === null) return null;
  for (const row of blobs) {
    if (!isRecord(row)) continue;
    const revision = row.kind === "draft.revision" && isRecord(row.revision) ? row.revision : row;
    if (revision.id === revisionId && revision.matterId === matterId && revision.targetId === targetId) return revision;
  }
  return null;
}

function draftParagraphIds(revision: Record<string, unknown> | null): string[] {
  if (!revision || !isRecord(revision.ast)) return [];
  const paragraphs: unknown[] = [];
  const ast = revision.ast;
  for (const section of Array.isArray(ast.sections) ? ast.sections : []) {
    if (isRecord(section) && Array.isArray(section.paragraphs)) paragraphs.push(...section.paragraphs);
  }
  for (const claim of Array.isArray(ast.claims) ? ast.claims : []) {
    if (!isRecord(claim) || !Array.isArray(claim.paragraphs)) continue;
    paragraphs.push(...claim.paragraphs);
  }
  return paragraphs
    .map((paragraph) => isRecord(paragraph) && (paragraph.origin === "ai" || paragraph.origin === "mixed") && typeof paragraph.id === "string"
      ? paragraph.id
      : null)
    .filter((id): id is string => id !== null);
}

function confirmationLedger(
  blobs: readonly unknown[],
  matterId: string,
  snapshot: Record<string, unknown>,
): { confirmed: Set<string>; fullRead: boolean; ids: readonly string[] } {
  const confirmed = new Set<string>();
  const ids: string[] = [];
  let fullRead = false;
  for (const row of blobs) {
    if (!isRecord(row) || row.kind !== "confirmation.ledger" || row.matterId !== matterId || !isRecord(row.ledger)) continue;
    const ledger = row.ledger;
    const confirmations = Array.isArray(ledger.confirmations) ? ledger.confirmations : [];
    const revocations = Array.isArray(ledger.revocations) ? ledger.revocations : [];
    const revokedIds = new Set(revocations.filter(isRecord).map((revocation) => revocation.objectId));
    for (const confirmation of confirmations) {
      if (!isRecord(confirmation) || typeof confirmation.id !== "string" || revokedIds.has(confirmation.id)
        || !sameSnapshot(confirmation.snapshot, snapshot)) continue;
      ids.push(confirmation.id);
      if (confirmation.kind === "full_read") fullRead = true;
      if (confirmation.kind === "ai_paragraph" && typeof confirmation.paragraphId === "string") {
        confirmed.add(confirmation.paragraphId);
      }
    }
  }
  return { confirmed, fullRead, ids };
}

function sameSnapshot(a: unknown, b: Record<string, unknown>): boolean {
  if (!isRecord(a)) return false;
  return a.matterId === b.matterId && a.targetId === b.targetId
    && a.sourceVersion === b.sourceVersion && a.targetConfigVersion === b.targetConfigVersion
    && a.draftRevisionId === b.draftRevisionId && a.figureRevisionId === b.figureRevisionId;
}

function currentCheckRun(
  blobs: readonly unknown[],
  target: TargetRecord,
  currentInput: Record<string, unknown>,
): { id: string; state: string; findings?: readonly unknown[] } | null {
  const runs: Record<string, unknown>[] = [];
  for (const row of blobs) {
    if (!isRecord(row)) continue;
    const run = row.kind === "check.run" && isRecord(row.checkRun) ? row.checkRun
      : row.kind === "check.run" && isRecord(row.run) ? row.run
        : null;
    const snapshot = run && isRecord(run.snapshot) ? run.snapshot : null;
    if (run && snapshot && sameSnapshot(snapshot, currentInput)) runs.push(run);
  }
  runs.sort((a, b) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")) || String(a.id ?? "").localeCompare(String(b.id ?? "")));
  const latest = runs[0];
  return latest && typeof latest.id === "string" && typeof latest.state === "string"
    ? { id: latest.id, state: latest.state, findings: Array.isArray(latest.findings) ? latest.findings : [] }
    : null;
}

function currentApproval(
  blobs: readonly unknown[],
  current: Record<string, unknown>,
  events: readonly ActivityRecord[],
  currentCheck: { id: string; state: string } | null,
  confirmationIds: readonly string[],
  unacknowledgedRisk: boolean,
): boolean {
  if (currentCheck?.state !== "succeeded" || unacknowledgedRisk) return false;
  const revoked = new Set(events.filter((event) => event.action === "approval.revoked").map((event) => event.resourceId));
  for (const row of blobs) {
    if (!isRecord(row)) continue;
    const approval = row.kind === "approval" && isRecord(row.approval) ? row.approval : null;
    const snapshot = approval && isRecord(approval.snapshot) ? approval.snapshot : null;
    const requiredConfirmations = approval && Array.isArray(approval.confirmationIds) ? approval.confirmationIds : [];
    if (approval && snapshot
      && typeof approval.id === "string" && !revoked.has(approval.id)
      && approval.checkRunId === currentCheck.id
      && requiredConfirmations.every((id) => typeof id === "string" && confirmationIds.includes(id))
      && sameSnapshot(snapshot, current)) return true;
  }
  return false;
}

function currentSnapshotExport(blobs: readonly unknown[], target: TargetRecord, current: Record<string, unknown>): boolean {
  return blobs.some((row) => {
    if (!isRecord(row)) return false;
    const record = row.kind === "export.record" && isRecord(row.export) ? row.export : null;
    const snapshot = record && isRecord(record.snapshot) ? record.snapshot : null;
    return snapshot !== null
      && snapshot.matterId === current.matterId
      && snapshot.targetId === target.id
      && snapshot.sourceVersion === current.sourceVersion
      && snapshot.targetConfigVersion === target.configVersion
      && snapshot.figureRevisionId === target.figureRevisionId
      && snapshot.draftRevisionId === target.draftRevisionId;
  });
}

function isConfirmedReceiptForTarget(value: unknown, targetId: string): boolean {
  if (!isRecord(value)) return false;
  const receipt = (value.kind === "receipt.record" || value.kind === "receipt") && isRecord(value.receipt)
    ? value.receipt
    : value;
  return typeof receipt.id === "string"
    && receipt.targetId === targetId
    && receipt.status === "confirmed"
    && typeof receipt.assetId === "string"
    && typeof receipt.applicationNumber === "string";
}

function matterMode(matter: MatterRecord): NextActionState["mode"] {
  return (matter as MatterRecord & { mode?: unknown }).mode === "professional" ? "professional" : "self_service";
}

export function filterAndPaginateMatterRows(
  rows: readonly MatterListRow[],
  filters: MatterFilters = {},
): MatterPage {
  const pageSize = MATTER_PAGE_SIZE;
  const page = Math.max(1, Math.trunc(filters.page ?? 1));
  const keyword = (filters.title ?? "").trim().toLocaleLowerCase();
  const filtered = rows
    .filter((row) => filters.status === "all" || row.matter.status === (filters.status ?? "active"))
    .filter((row) => keyword.length === 0 || row.matter.title.toLocaleLowerCase().includes(keyword))
    .filter((row) => filters.route == null || row.targets.some((target) => target.route === filters.route))
    .filter((row) => filters.nextAction == null
      || row.nextAction === filters.nextAction
      || row.targets.some((target) => target.nextAction === filters.nextAction))
    .sort((a, b) => b.matter.updatedAt.localeCompare(a.matter.updatedAt) || a.matter.id.localeCompare(b.matter.id));
  return {
    items: filtered.slice((page - 1) * pageSize, page * pageSize),
    total: filtered.length,
    page,
    pageSize,
    loadedAt: 0,
  };
}

export function shouldRefreshMatterRows(lastLoadedAt: number | null, now: number, regainedFocus = false): boolean {
  return regainedFocus || lastLoadedAt === null || now - lastLoadedAt > MATTER_STALE_AFTER_MS;
}

export async function listMatterRows(
  repository: LocalRepository,
  actor: Actor,
  options: { now?: number } = {},
): Promise<RepositoryResult<{ rows: readonly MatterListRow[]; loadedAt: number }>> {
  const listed = await repository.listMatters(actor);
  if (!listed.ok) return listed;
  const rows: MatterListRow[] = [];
  for (const item of listed.data.items) {
    if (item.matter.status === "deletion_pending") continue;
    const context = await readMatterContext(repository, actor, item.matter.id);
    if (!context.ok) return { ok: false, error: context.error };
    const targetRows = context.data.targetRows;
    rows.push({ matter: context.data.aggregate.matter, targets: targetRows, nextAction: context.data.matterNextAction });
  }
  return { ok: true, data: { rows, loadedAt: options.now ?? Date.now() } };
}

function activity(
  actor: Actor,
  matterId: string,
  id: string,
  action: "matter.created" | "matter.renamed" | "matter.archived",
  version: number,
  now: string,
): ActivityRecord {
  return {
    id,
    tenantId: actor.tenantId,
    matterId,
    targetId: null,
    actorId: actor.userId,
    actorKind: "user",
    action,
    snapshot: null,
    jobId: null,
    resourceId: matterId,
    occurredAt: now,
    metadata: { version },
  };
}

function cleanTitle(title: string | undefined): string {
  return title?.trim() || DEFAULT_MATTER_TITLE;
}

function isMatterRoute(value: unknown): value is MatterRoute {
  return typeof value === "string" && (ROUTES as readonly string[]).includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isMatterStorageError(error: RepositoryError): boolean {
  return error.code === "STORAGE_UNAVAILABLE" || error.code === "QUOTA_EXCEEDED";
}
