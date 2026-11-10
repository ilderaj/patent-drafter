import {
  activitySchema,
  approvalSchema,
  confirmationSchema,
  revocationSchema,
  type Approval,
  type Confirmation,
  type Revocation,
  type SnapshotRef,
} from "../../../../../../packages/contracts/src/index.ts";
import { currentConfirmations, type ConfirmationLedger } from "../../../../../../packages/domain/src/v6/confirmation.js";
import { evaluateGate, type GateDecision } from "../../../../../../packages/domain/src/v6/gate.js";
import { isCurrent } from "../../../../../../packages/domain/src/v6/revision.js";
import { isCurrentCheckRun, type CheckRunResult } from "../../../../../../packages/domain/src/v6/checks.js";
import {
  assembleExportArtifacts,
  buildPatentPack,
  buildReviewPdf,
  buildSnapshot,
  bytesToBase64,
  sanitizeFileName,
  type ExportArtifact,
  type ExportProjectData,
  type ReportPageSpec,
} from "../../../../../../packages/export/src/index.ts";
import {
  checkFigureExportGate,
  collectFigureIds,
  readFigureLibrary,
  type FigureSetRead,
} from "../sources/drawings.ts";
import {
  createGenerationRevisionStore,
  type GenerationRevisionStore,
  type GenerationRevisionView,
} from "../generation/generation.ts";
import { legacyConfirmationLedgerStorageKey, mergeLedgerRows } from "../preview/preview.ts";
import {
  ACTIVITY_METADATA_KEYS_BY_ACTION,
  CONTRACT_VERSION,
  sha256Hex,
  STORES,
  type ActivityRecord,
  type Actor,
  type LocalRepository,
  type MatterAggregate,
} from "../../lib/repository.ts";

export type ExportRoute = "cn_um" | "cn_invention" | "us_nonprovisional" | "pct";
export type ExportConfirmationMode = "self_read" | "professional_paragraphs";
export type ExportPackageKind = "preparation" | "internally_approved";
export type ExportErrorCode =
  | "INVALID_INPUT"
  | "RESOURCE_NOT_FOUND"
  | "ACTION_FORBIDDEN"
  | "STALE_BINDING"
  | "MISSING_BYTES"
  | "GATE_BLOCKED"
  | "HASH_MISMATCH"
  | "FORMAT_UNAVAILABLE"
  | "CACHE_EXPIRED"
  | "STORAGE_UNAVAILABLE";

export interface ExportManifestFile {
  id: string;
  name: string;
  mime: string;
  bytes: number;
  sha256: string;
}

/** Contract-shaped delivery receipt for one immutable SnapshotRef. */
export interface ExportManifest {
  schemaVersion: "export.v1";
  exportId: string;
  snapshot: SnapshotRef;
  astHash: string;
  figureSetHash: string;
  rulePackVersion: string;
  checkRunId: string;
  approvalId: string | null;
  confirmationIds: string[];
  riskIds: string[];
  searchState: "not_searched";
  packageKind: ExportPackageKind;
  testOutput?: boolean;
  language: "zh-CN" | "en-US";
  createdAt: string;
  files: ExportManifestFile[];
}

export interface ExportFileView extends ExportManifestFile {
  status: "ready" | "unavailable" | "failed";
  unavailableReasons: readonly ExportGateReason[];
}

export interface ExportGateReason {
  code: string;
  resourceId?: string;
}

/** evaluateGate result plus the R1 access and persisted figure-gate reasons. */
export interface ExportGateDecision extends Omit<GateDecision, "reasons"> {
  reasons: readonly ExportGateReason[];
}

export interface ExportRecord {
  manifest: ExportManifest;
  files: readonly ExportFileView[];
  /** Hash of the serialised manifest sidecar; it is outside manifest.files to avoid self-reference. */
  manifestSha256: string;
  manifestBytes: Uint8Array;
}

export interface ExportSessionOptions {
  repository: LocalRepository;
  actor: Actor;
  matterId: string;
  targetId: string;
  route: ExportRoute;
  access: "local_unmetered" | "preview" | "full";
  role: "owner" | "admin" | "editor" | "reviewer" | "viewer";
  checkResult: CheckRunResult | null;
  activeRulePackVersion: string;
  /** Availability resolved by the host for non-figure references. */
  filesAvailable: boolean;
  confirmationMode: ExportConfirmationMode;
  /** Defaults from confirmation mode: professional => internally_approved. */
  packageKind?: ExportPackageKind;
  passphrase: string;
  revisions?: GenerationRevisionStore;
  now?: () => string;
  renderReport?: (spec: ReportPageSpec) => Promise<Uint8Array[]>;
}

export interface ExportSessionState {
  phase: "loading" | "empty" | "ready" | "blocked" | "stale" | "error";
  snapshot: SnapshotRef | null;
  inputStale: boolean;
  testOutput: boolean;
  gate: ExportGateDecision | null;
  record: ExportRecord | null;
  files: readonly ExportFileView[];
  unavailableFormats: readonly { format: "xml"; code: "FORMAT_UNAVAILABLE"; reason: string }[];
  error: { code: string; message: string } | null;
}

export type ExportActionResult =
  | { ok: true; record: ExportRecord; replayed: boolean }
  | { ok: false; error: { code: ExportErrorCode; message: string; reasons?: readonly ExportGateReason[] } };

interface StoredExportFile extends ExportManifestFile {
  data: Uint8Array;
}

interface StoredExportRow {
  kind: "delivery.export";
  tenantId: string;
  actorId: string;
  matterId: string;
  targetId: string;
  cacheKey: string;
  /** Monotonic logical cache generation; retry after expiry gets a fresh manifest id. */
  generation?: number;
  state: "prepared" | "ready" | "failed" | "expired";
  manifest: ExportManifest;
  manifestBytes: Uint8Array;
  manifestBytesLength?: number;
  manifestSha256: string;
  files: StoredExportFile[];
  failureCode?: ExportErrorCode;
  failureMessage?: string;
  expiredAt?: string;
  expiredReason?: "CACHE_EXPIRED";
  supersededByExportId?: string;
}

interface LoadedExportContext {
  aggregate: MatterAggregate;
  snapshot: SnapshotRef;
  revision: GenerationRevisionView;
  figures: FigureSetRead;
  confirmations: ConfirmationLedger;
  liveConfirmations: readonly Confirmation[];
  approval: Approval | null;
  checkRun: CheckRunResult["checkRun"] | null;
  gate: ExportGateDecision;
  inputStale: boolean;
  referencedFigureGateReasons: readonly ExportGateReason[];
  figureAssets: readonly { figureId: string; number: number; drawingId: string; originalName: string; mime: string; sha256: string; bytes: Uint8Array }[];
}

export const EXPORT_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const XML_UNAVAILABLE = "G-XML 未通过，官方 XML 格式不可用；不会生成或改名伪造 .xml 文件。";
export const TEST_OUTPUT_NOTICE = "测试输出，仅用于验证流程，不能作为正式申请材料";

function effectivePackageKind(options: ExportSessionOptions): ExportPackageKind {
  return options.packageKind ?? (options.confirmationMode === "professional_paragraphs" ? "internally_approved" : "preparation");
}
const EMPTY_CONFIRMATIONS = (matterId: string): ConfirmationLedger => ({ matterId, confirmations: [], revocations: [] });

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function defaultNow(): string {
  return new Date().toISOString();
}

function allParagraphs(ast: GenerationRevisionView["ast"]): GenerationRevisionView["ast"]["claims"][number]["paragraphs"][number][] {
  return [
    ...ast.claims.flatMap((claim) => claim.paragraphs),
    ...ast.sections.flatMap((section) => section.paragraphs),
  ];
}

function paragraphIds(ast: GenerationRevisionView["ast"]): string[] {
  return allParagraphs(ast)
    .filter((paragraph) => paragraph.origin === "ai" || paragraph.origin === "mixed")
    .map((paragraph) => paragraph.id);
}

function sameInput(revision: GenerationRevisionView, snapshot: SnapshotRef): boolean {
  const input = revision.revision.input;
  return input.matterId === snapshot.matterId
    && input.targetId === snapshot.targetId
    && input.sourceVersion === snapshot.sourceVersion
    && input.targetConfigVersion === snapshot.targetConfigVersion
    && input.figureRevisionId === snapshot.figureRevisionId;
}

function confirmationKey(actor: Actor, matterId: string): string {
  return `draft-review/confirmations/${encodeURIComponent(actor.tenantId)}/${encodeURIComponent(actor.userId)}/${encodeURIComponent(matterId)}`;
}

function approvalKey(actor: Actor, matterId: string): string {
  return `delivery/approvals/${encodeURIComponent(actor.tenantId)}/${encodeURIComponent(actor.userId)}/${encodeURIComponent(matterId)}`;
}

function emptyApprovalLedger(matterId: string): { matterId: string; approvals: Approval[]; revocations: Revocation[] } {
  return { matterId, approvals: [], revocations: [] };
}

function readConfirmations(raw: unknown, actor: Actor, matterId: string): ConfirmationLedger {
  if (raw === undefined) return EMPTY_CONFIRMATIONS(matterId);
  if (!isRecord(raw) || raw.kind !== "draft-review.confirmations" || raw.tenantId !== actor.tenantId
    || raw.actorId !== actor.userId || raw.matterId !== matterId || !isRecord(raw.ledger)
    || raw.ledger.matterId !== matterId || !Array.isArray(raw.ledger.confirmations) || !Array.isArray(raw.ledger.revocations)) {
    throw new ExportReadFailure("STORAGE_UNAVAILABLE", "确认记录格式或归属无效。");
  }
  return {
    matterId,
    confirmations: raw.ledger.confirmations.map((item) => confirmationSchema.parse(item)),
    revocations: raw.ledger.revocations.map((item) => {
      const parsed = revocationSchema.parse(item);
      if (parsed.objectType !== "confirmation") throw new Error("确认账本包含非确认撤销记录。");
      return { ...parsed, objectType: "confirmation" as const };
    }),
  };
}

function withLegacyConfirmations(canonical: ConfirmationLedger, legacy: ConfirmationLedger): ConfirmationLedger {
  const confirmations = new Map(canonical.confirmations.map((item) => [item.id, item]));
  const revocations = new Map(canonical.revocations.map((item) => [item.id, item]));
  for (const item of legacy.confirmations) if (!confirmations.has(item.id)) confirmations.set(item.id, item);
  for (const item of legacy.revocations) if (!revocations.has(item.id)) revocations.set(item.id, item);
  return { matterId: canonical.matterId, confirmations: [...confirmations.values()], revocations: [...revocations.values()] };
}

function readApprovalLedger(raw: unknown, actor: Actor, matterId: string): { matterId: string; approvals: Approval[]; revocations: Revocation[] } {
  if (raw === undefined) return emptyApprovalLedger(matterId);
  if (!isRecord(raw) || raw.kind !== "delivery.approvals" || raw.tenantId !== actor.tenantId
    || raw.actorId !== actor.userId || raw.matterId !== matterId || !isRecord(raw.ledger)
    || raw.ledger.matterId !== matterId || !Array.isArray(raw.ledger.approvals) || !Array.isArray(raw.ledger.revocations)) {
    throw new ExportReadFailure("STORAGE_UNAVAILABLE", "批准记录格式或归属无效。");
  }
  return {
    matterId,
    approvals: raw.ledger.approvals.map((item) => approvalSchema.parse(item)),
    revocations: raw.ledger.revocations.map((item) => {
      const parsed = revocationSchema.parse(item);
      if (parsed.objectType !== "approval") throw new Error("批准账本包含非批准撤销记录。");
      return parsed;
    }),
  };
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function latestUsableApproval(
  ledger: { approvals: readonly Approval[]; revocations: readonly Revocation[] },
  snapshot: SnapshotRef,
  checkRunId: string | null,
  confirmationIds: readonly string[],
): Approval | null {
  const revoked = new Set(ledger.revocations.map((item) => item.objectId));
  return [...ledger.approvals].reverse().find((approval) =>
    !revoked.has(approval.id)
    && isCurrent(approval.snapshot, snapshot)
    && approval.checkRunId === checkRunId
    && sameStrings(approval.confirmationIds, confirmationIds)) ?? null;
}

function orderReasons(reasons: readonly ExportGateReason[]): ExportGateReason[] {
  const seen = new Set<string>();
  const output: ExportGateReason[] = [];
  for (const reason of reasons) {
    const key = `${reason.code}/${reason.resourceId ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(reason);
  }
  return output;
}

function exportStorageKey(actor: Actor, matterId: string, cacheKey: string): string {
  return `delivery/exports/${encodeURIComponent(actor.tenantId)}/${encodeURIComponent(actor.userId)}/${encodeURIComponent(matterId)}/${cacheKey}`;
}

function eventIdFor(exportId: string): string {
  const hex = exportId.replaceAll("-", "");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

async function idFor(seed: string): Promise<string> {
  const digest = await sha256Hex(new TextEncoder().encode(seed));
  const hex = digest.slice(0, 32).split("");
  hex[12] = "5";
  hex[16] = "8";
  const raw = hex.join("");
  return `${raw.slice(0, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}-${raw.slice(16, 20)}-${raw.slice(20, 32)}`;
}

function manifestSidecar(row: StoredExportRow): ExportFileView {
  return {
    id: `${row.manifest.exportId}:manifest`,
    name: "导出清单.json",
    mime: "application/json",
    bytes: row.manifestBytesLength ?? row.manifestBytes.byteLength,
    sha256: row.manifestSha256,
    status: "ready",
    unavailableReasons: [],
  };
}

function cacheExpired(row: StoredExportRow, now: string): boolean {
  const createdAt = Date.parse(row.manifest.createdAt);
  const evaluatedAt = Date.parse(now);
  return Number.isFinite(createdAt) && Number.isFinite(evaluatedAt) && evaluatedAt - createdAt >= EXPORT_CACHE_TTL_MS;
}

function expirationTime(row: StoredExportRow): string | null {
  const createdAt = Date.parse(row.manifest.createdAt);
  return Number.isFinite(createdAt) ? new Date(createdAt + EXPORT_CACHE_TTL_MS).toISOString() : null;
}

function fileViewsForRow(
  row: StoredExportRow,
  status: ExportFileView["status"],
  reasons: readonly ExportGateReason[],
): ExportFileView[] {
  return [
    ...row.files.map(({ data: _data, ...file }) => ({ ...file, status, unavailableReasons: [...reasons] })),
    { ...manifestSidecar(row), status, unavailableReasons: [...reasons] },
  ];
}

function withFileStatus(row: StoredExportRow, status: ExportFileView["status"], reasons: readonly ExportGateReason[]): ExportRecord {
  return {
    manifest: structuredClone(row.manifest),
    files: fileViewsForRow(row, status, reasons),
    manifestSha256: row.manifestSha256,
    manifestBytes: new Uint8Array(row.manifestBytes),
  };
}

function rowFrom(value: unknown, actor: Actor, matterId: string, targetId?: string): StoredExportRow | null {
  if (!isRecord(value) || value.kind !== "delivery.export" || value.tenantId !== actor.tenantId
    || value.actorId !== actor.userId || value.matterId !== matterId
    || (targetId !== undefined && value.targetId !== targetId)
    || (value.state !== "prepared" && value.state !== "ready" && value.state !== "failed" && value.state !== "expired")
    || !Array.isArray(value.files) || !isRecord(value.manifest)) return null;
  return value as unknown as StoredExportRow;
}

async function readExportRows(repository: LocalRepository, actor: Actor, matterId: string, targetId: string): Promise<StoredExportRow[]> {
  try {
    const rows = await repository.backend.transaction("readonly", (tx) => tx.getAll(STORES.blobs));
    return rows.map((row) => rowFrom(row, actor, matterId, targetId)).filter((row): row is StoredExportRow => row !== null)
      .sort((left, right) => right.manifest.createdAt.localeCompare(left.manifest.createdAt)
        || left.manifest.exportId.localeCompare(right.manifest.exportId));
  } catch {
    throw new ExportReadFailure("STORAGE_UNAVAILABLE", "无法读取本机导出记录。");
  }
}

async function readCurrentContext(options: ExportSessionOptions): Promise<LoadedExportContext> {
  const { repository, actor, matterId, targetId } = options;
  const loaded = await repository.loadMatter(actor, matterId);
  if (!loaded.ok) throw new ExportReadFailure(loaded.error.code, loaded.error.message);
  const aggregate = loaded.data.data;
  const target = aggregate.targets.find((item) => item.id === targetId && item.matterId === matterId);
  if (!target || target.status !== "active") throw new ExportReadFailure("RESOURCE_NOT_FOUND", "当前目标不可用。");

  const revisions = options.revisions ?? createGenerationRevisionStore({ repository, actor });
  const [head, figureRead, ledgers] = await Promise.all([
    revisions.loadHeadRevision(matterId, targetId),
    readFigureLibrary(repository, actor, matterId),
    repository.backend.transaction("readonly", async (tx) => ({
      confirmations: await tx.get(STORES.blobs, confirmationKey(actor, matterId)),
      legacyConfirmations: await tx.get(STORES.blobs, legacyConfirmationLedgerStorageKey(actor, matterId)),
      approvals: await tx.get(STORES.blobs, approvalKey(actor, matterId)),
    })),
  ]);
  if (!head.ok) throw new ExportReadFailure(head.error.code, head.error.message);
  if (!figureRead.ok) throw new ExportReadFailure(figureRead.error.code, figureRead.error.message);
  if (head.data === null) throw new ExportReadFailure("RESOURCE_NOT_FOUND", "当前目标没有可导出的草稿修订。");
  const revision = head.data;
  const figureSet = figureRead.data.current.get(targetId);
  if (!figureSet) throw new ExportReadFailure("MISSING_BYTES", "当前附图集不可读取。");

  const snapshot: SnapshotRef = {
    matterId,
    targetId,
    sourceVersion: aggregate.matter.sourceVersion,
    targetConfigVersion: target.configVersion,
    draftRevisionId: target.draftRevisionId ?? revision.revision.id,
    figureRevisionId: target.figureRevisionId,
  };
  const snapshotCurrent = target.draftRevisionId !== null && target.draftRevisionId === revision.revision.id;
  const inputStale = !sameInput(revision, snapshot);
  const confirmations = withLegacyConfirmations(
    readConfirmations(ledgers.confirmations, actor, matterId),
    mergeLedgerRows(undefined, ledgers.legacyConfirmations, actor, matterId),
  );
  const liveConfirmations = currentConfirmations(confirmations, snapshot);
  const checkRun = options.checkResult?.checkRun ?? null;
  const approvalLedger = readApprovalLedger(ledgers.approvals, actor, matterId);
  const approval = latestUsableApproval(
    approvalLedger,
    snapshot,
    checkRun?.id ?? null,
    liveConfirmations.map((item) => item.id),
  );
  const figureGate = await checkFigureExportGate(repository, actor, matterId, {
    targetId,
    figureRevisionId: snapshot.figureRevisionId,
    referencedFigureIds: collectFigureIds(revision.ast),
  }, { now: () => Date.parse((options.now ?? defaultNow)()) });
  if (!figureGate.ok) throw new ExportReadFailure(figureGate.error.code, figureGate.error.message);
  const figureReasons: ExportGateReason[] = figureGate.data.reasons.map((item) => ({
    code: item.code,
    ...(item.resourceId ? { resourceId: item.resourceId } : {}),
  }));

  const sourceReasons = await referencedSourceAvailability(repository, actor, aggregate, revision.ast);
  sourceReasons.push(...await referencedPriorityAssetReasons(repository, actor, aggregate, targetId, target.configVersion));
  const figuresByDrawing = new Map(figureRead.data.drawings.map((item) => [item.drawing.id, item]));
  const figureAssets: LoadedExportContext["figureAssets"][number][] = [];
  for (const entry of figureSet.entries) {
    if (entry.drawingId === null) continue;
    const linked = figuresByDrawing.get(entry.drawingId);
    if (!linked || linked.asset.state !== "available") continue;
    const bytes = await repository.readBlob(actor, linked.asset.id);
    if (!bytes.ok) continue;
    figureAssets.push({
      figureId: entry.figureId,
      number: entry.number,
      drawingId: entry.drawingId,
      originalName: linked.asset.originalName,
      mime: linked.asset.mime,
      sha256: linked.asset.sha256,
      bytes: bytes.data.data.bytes,
    });
  }

  const accessReasons: ExportGateReason[] = options.access === "local_unmetered"
    ? []
    : [{ code: "ENTITLEMENT_REQUIRED" }];
  if (options.role === "viewer") accessReasons.push({ code: "ACTION_FORBIDDEN" });
  if (!options.filesAvailable) sourceReasons.push({ code: "MISSING_BYTES" });
  const decision = evaluateGate({
    action: "export",
    snapshot,
    snapshotCurrent,
    filesAvailable: figureGate.data.filesAvailable && sourceReasons.length === 0 && options.filesAvailable,
    rulePackVersion: checkRun?.rulePackVersion ?? options.activeRulePackVersion,
    activeRulePackVersion: options.activeRulePackVersion,
    checkRun,
    approval,
    confirmations: liveConfirmations,
    risks: checkRun?.findings ?? [],
    now: (options.now ?? defaultNow)(),
  }, {
    packageKind: effectivePackageKind(options),
    confirmationMode: options.confirmationMode,
    inputStale,
    aiParagraphIds: paragraphIds(revision.ast),
    blockingPolicyRuleIds: options.checkResult?.blockingPolicyRuleIds.export ?? [],
  });
  const gate: ExportGateDecision = {
    ...decision,
    reasons: orderReasons([
      ...decision.reasons,
      ...accessReasons,
      ...figureReasons,
      ...sourceReasons,
      ...(!snapshotCurrent ? [{ code: "STALE_BINDING" }] : []),
    ]),
  };
  gate.allowed = gate.reasons.length === 0;
  return {
    aggregate,
    snapshot,
    revision,
    figures: figureRead.data,
    confirmations,
    liveConfirmations,
    approval,
    checkRun,
    gate,
    inputStale,
    referencedFigureGateReasons: figureReasons,
    figureAssets,
  };
}

async function referencedSourceAvailability(
  repository: LocalRepository,
  actor: Actor,
  aggregate: MatterAggregate,
  ast: GenerationRevisionView["ast"],
): Promise<ExportGateReason[]> {
  const sourceIds = [...new Set(allParagraphs(ast).flatMap((paragraph) => paragraph.sourceRefs.map((reference) => reference.sourceId)))];
  if (sourceIds.length === 0) return [];
  const result: ExportGateReason[] = [];
  for (const sourceId of sourceIds) {
    let row: unknown;
    try {
      row = await repository.backend.transaction("readonly", (tx) => tx.get(STORES.blobs, `parse/source/${sourceId}`));
    } catch {
      result.push({ code: "MISSING_BYTES", resourceId: sourceId });
      continue;
    }
    const source = isRecord(row) ? row.source : null;
    if (!isRecord(row) || row.kind !== "parse.source" || !isRecord(source)
      || source.id !== sourceId || source.matterId !== aggregate.matter.id || typeof source.assetId !== "string") {
      result.push({ code: "MISSING_BYTES", resourceId: sourceId });
      continue;
    }
    const asset = aggregate.assets.find((item) => item.id === source.assetId && item.tenantId === actor.tenantId);
    if (!asset || asset.state !== "available") {
      result.push({ code: "MISSING_BYTES", resourceId: sourceId });
      continue;
    }
    const bytes = await repository.readBlob(actor, asset.id);
    if (!bytes.ok) result.push({ code: "MISSING_BYTES", resourceId: sourceId });
  }
  return result;
}

async function referencedPriorityAssetReasons(
  repository: LocalRepository,
  actor: Actor,
  aggregate: MatterAggregate,
  targetId: string,
  configVersion: number,
): Promise<ExportGateReason[]> {
  // Only the config row named by the committed target event is authoritative;
  // scan-all could pick an orphan row left by a losing write (V6-14 precedent).
  const events = await repository.listEvents(actor, aggregate.matter.id);
  if (!events.ok) return [{ code: "STORAGE_UNAVAILABLE" }];
  const event = events.data.items.find((item) =>
    item.targetId === targetId
    && (item.action === "target.created" || item.action === "target.config_updated")
    && item.metadata.version === configVersion);
  if (!event) return [];
  const key = [
    "targets/config",
    encodeURIComponent(actor.tenantId),
    encodeURIComponent(aggregate.matter.id),
    encodeURIComponent(targetId),
    String(configVersion),
    encodeURIComponent(event.id),
  ].join("/");
  let configRow: unknown;
  try {
    configRow = await repository.backend.transaction("readonly", (tx) => tx.get(STORES.blobs, key));
  } catch {
    return [{ code: "STORAGE_UNAVAILABLE" }];
  }
  if (!isRecord(configRow) || !isRecord(configRow.config) || !Array.isArray(configRow.config.priorityClaims)) return [];
  const reasons: ExportGateReason[] = [];
  for (const claim of configRow.config.priorityClaims) {
    if (!isRecord(claim) || (claim.evidenceAssetId !== null && typeof claim.evidenceAssetId !== "string")) continue;
    if (claim.evidenceAssetId === null) continue;
    const asset = aggregate.assets.find((item) => item.id === claim.evidenceAssetId && item.tenantId === actor.tenantId);
    if (!asset || asset.state !== "available") {
      reasons.push({ code: "MISSING_BYTES", resourceId: claim.evidenceAssetId });
      continue;
    }
    const bytes = await repository.readBlob(actor, asset.id);
    if (!bytes.ok) reasons.push({ code: "MISSING_BYTES", resourceId: asset.id });
  }
  return reasons;
}

function sectionLabel(kind: string): string {
  const labels: Readonly<Record<string, string>> = {
    technical_field: "技术领域",
    background: "背景技术",
    summary: "发明内容",
    figures_description: "附图说明",
    embodiments: "具体实施方式",
    abstract: "说明书摘要",
  };
  return labels[kind] ?? kind;
}

function projectData(context: LoadedExportContext, route: ExportRoute): ExportProjectData {
  const { ast } = context.revision;
  const figureEntries = context.figures.current.get(context.snapshot.targetId)?.entries ?? [];
  const filesByFigure = new Map(context.figureAssets.map((item) => [item.figureId, item]));
  const abstractSection = ast.sections.find((section) => section.kind === "abstract");
  const specSections = ast.sections.filter((section) => section.kind !== "abstract").map((section) => ({
    title: sectionLabel(section.kind),
    body: section.paragraphs.map((paragraph) => paragraph.text).join("\n"),
  }));
  return {
    name: context.revision.revision.testOutput === true ? `${context.aggregate.matter.title}（测试输出，非正式申请稿）` : context.aggregate.matter.title,
    patentType: route,
    claims: ast.claims.map((claim) => ({
      id: claim.id,
      label: `权利要求 ${claim.number}`,
      text: claim.paragraphs.map((paragraph) => paragraph.text).join("\n"),
    })),
    specSections,
    abstractText: abstractSection?.paragraphs.map((paragraph) => paragraph.text).join("\n") ?? "",
    figures: figureEntries.map((entry) => {
      const file = filesByFigure.get(entry.figureId);
      return {
        id: entry.figureId,
        title: entry.title || `图 ${entry.number}`,
        mode: file ? ("brief" as const) : undefined,
        badge: file ? "原始附图字节" : "缺少附图字节",
        previewLabel: file?.originalName ?? "原始附图不可用",
      };
    }),
    audit: null,
    versions: [],
    rulePackVersion: context.checkRun?.rulePackVersion ?? "",
  };
}

function makeChecklist(
  data: ExportProjectData,
  context: LoadedExportContext,
  packageKind: ExportPackageKind,
  generatedAt: string,
  baseFiles: readonly ExportManifestFile[],
  route: ExportRoute,
): ReportPageSpec {
  const fullText = [
    ...data.claims.map((claim) => ({ text: claim.text, tone: "ink" as const })),
    ...data.specSections.map((section) => ({ text: `${section.title}\n${section.body}`, tone: "ink" as const })),
    { text: `说明书摘要\n${data.abstractText}`, tone: "ink" as const },
  ];
  const riskIds = (context.checkRun?.findings ?? []).filter((finding) => finding.category === "risk").map((finding) => finding.id);
  const testOutput = context.revision.revision.testOutput === true;
  const checkItems = [
    ...(testOutput ? [{ text: TEST_OUTPUT_NOTICE, tone: "warn" as const }] : []),
    { text: `目标路线：${route}`, tone: "ink" as const },
    { text: `导出包：${packageKind === "preparation" ? "准备包" : "内部批准包"}`, tone: "ink" as const },
    { text: `检查记录：${context.checkRun?.id ?? "无"} · 当前规则包 ${context.checkRun?.rulePackVersion ?? "无"}`, tone: "ink" as const },
    { text: `风险 ID：${riskIds.join("、") || "当前检查未列出风险"}`, tone: "warn" as const },
    { text: `内容确认 ID：${context.liveConfirmations.map((item) => item.id).join("、") || "无"}`, tone: "ink" as const },
    { text: "检索状态：未检索", tone: "warn" as const },
    ...baseFiles.map((file) => ({ text: `${file.name} · ${file.bytes} bytes · SHA-256 ${file.sha256}`, tone: "ink" as const })),
    { text: `生成时间：${generatedAt}`, tone: "muted" as const },
  ];
  return {
    title: testOutput ? `${TEST_OUTPUT_NOTICE}：申请准备材料：全文与提交检查清单` : "申请准备材料：全文与提交检查清单",
    meta: [
      { label: "案件", value: data.name },
      { label: "SnapshotRef", value: `${context.snapshot.matterId} / ${context.snapshot.targetId} / ${context.snapshot.draftRevisionId}` },
      { label: "AST SHA-256", value: context.revision.revision.astHash },
      { label: "附图集 SHA-256", value: context.figures.current.get(context.snapshot.targetId)?.hash ?? "" },
    ],
    sections: [
      { heading: "权利要求书", items: fullText.slice(0, data.claims.length), emptyText: "（无权利要求）" },
      { heading: "说明书与摘要全文", items: fullText.slice(data.claims.length), emptyText: "（无说明书正文）" },
      { heading: "提交检查清单", items: checkItems, emptyText: "（无检查项目）" },
    ],
    footer: testOutput ? "测试输出，非正式申请稿；申请准备材料，非递交回执；产品不代为提交。" : "申请准备材料，非递交回执；产品不代为提交。",
  };
}

function mimeFor(name: string): string {
  if (name.endsWith(".docx")) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (name.endsWith(".pdf")) return "application/pdf";
  if (name.endsWith(".patentpack")) return "application/vnd.patent-drafter.patentpack+json";
  if (name.endsWith(".json")) return "application/json";
  return "application/octet-stream";
}

async function manifestFile(exportId: string, name: string, data: Uint8Array, originalName = name, mime = mimeFor(name)): Promise<ExportManifestFile> {
  return { id: await idFor(`${exportId}/${name}`), name: originalName, mime, bytes: data.byteLength, sha256: await sha256Hex(data) };
}

async function packageKindKey(options: ExportSessionOptions, context: LoadedExportContext, passphrase: string): Promise<{ packageKind: ExportPackageKind; cacheKey: string }> {
  const packageKind = effectivePackageKind(options);
  const passphraseHash = await sha256Hex(new TextEncoder().encode(passphrase));
  const input = JSON.stringify({
    actor: options.actor,
    matterId: options.matterId,
    targetId: options.targetId,
    snapshot: context.snapshot,
    astHash: context.revision.revision.astHash,
    testOutput: context.revision.revision.testOutput === true,
    figureSetHash: context.figures.current.get(options.targetId)?.hash,
    checkRunId: options.checkResult?.checkRun.id ?? null,
    approvalId: packageKind === "internally_approved" ? context.approval?.id ?? null : null,
    confirmationIds: context.liveConfirmations.map((item) => item.id),
    riskIds: (options.checkResult?.checkRun.findings ?? []).filter((item) => item.category === "risk").map((item) => item.id),
    packageKind,
    language: context.revision.ast.language,
    route: options.route,
    passphraseHash,
  });
  return { packageKind, cacheKey: await sha256Hex(new TextEncoder().encode(input)) };
}

async function buildFiles(options: ExportSessionOptions, context: LoadedExportContext, exportId: string, createdAt: string, packageKind: ExportPackageKind, passphrase: string): Promise<StoredExportFile[]> {
  const data = projectData(context, options.route);
  const artifacts = await assembleExportArtifacts(data, {
    bundle: false,
    claims: true,
    specification: true,
    abstract: true,
    figures: false,
    report: false,
    patentpack: false,
  }, { exportedAt: createdAt, ...(context.revision.revision.testOutput === true ? { notice: TEST_OUTPUT_NOTICE } : {}) });
  const testOutput = context.revision.revision.testOutput === true;
  const output: { name: string; manifestName: string; data: Uint8Array; mime: string }[] = artifacts.map((artifact: ExportArtifact) => {
    const fileName = testOutput ? `测试输出-${artifact.fileName}` : artifact.fileName;
    return { name: fileName, manifestName: fileName, data: artifact.data, mime: mimeFor(fileName) };
  });
  for (const figure of context.figureAssets) {
    const originalName = figure.originalName.normalize("NFC");
    output.push({
      name: `附图原件-${figure.number}-${sanitizeFileName(originalName)}`,
      manifestName: originalName,
      data: new Uint8Array(figure.bytes),
      mime: figure.mime,
    });
  }
  const baseFiles: ExportManifestFile[] = [];
  for (const file of output) baseFiles.push(await manifestFile(exportId, file.name, file.data, file.manifestName, file.mime));

  const renderReport = options.renderReport ?? await browserReportRenderer();
  const checklistPdf = await buildReviewPdf(
    makeChecklist(data, context, packageKind, createdAt, baseFiles, options.route),
    {
      renderPages: renderReport,
      ...(testOutput ? { metadata: { title: TEST_OUTPUT_NOTICE, subject: TEST_OUTPUT_NOTICE, keywords: TEST_OUTPUT_NOTICE } } : {}),
    },
  );
  const pdfName = testOutput ? "测试输出-提交检查清单.pdf" : "提交检查清单.pdf";
  output.push({ name: pdfName, manifestName: pdfName, data: checklistPdf, mime: "application/pdf" });
  const withPdf: ExportManifestFile[] = [...baseFiles, await manifestFile(exportId, pdfName, checklistPdf, pdfName, "application/pdf")];
  const riskIds = (options.checkResult?.checkRun.findings ?? [])
    .filter((item) => item.category === "risk")
    .map((item) => item.id);
  const manifestFiles = [...withPdf];
  const shellManifest: ExportManifest = {
    schemaVersion: "export.v1",
    exportId,
    snapshot: context.snapshot,
    astHash: context.revision.revision.astHash,
    figureSetHash: context.figures.current.get(options.targetId)?.hash ?? "",
    rulePackVersion: options.activeRulePackVersion,
    checkRunId: options.checkResult!.checkRun.id,
    approvalId: packageKind === "internally_approved" ? context.approval?.id ?? null : null,
    confirmationIds: context.liveConfirmations.map((item) => item.id),
    riskIds,
    searchState: "not_searched",
    packageKind,
    ...(testOutput ? { testOutput: true } : {}),
    language: context.revision.ast.language,
    createdAt,
    files: manifestFiles,
  };
  const snapshot = buildSnapshot(data, options.activeRulePackVersion, createdAt);
  const packed = await buildPatentPack({
    schemaVersion: "patentpack.v1",
    snapshotRef: context.snapshot,
    snapshot,
    manifest: shellManifest,
    figures: await Promise.all(context.figureAssets.map(async (figure) => ({
      figureId: figure.figureId,
      drawingId: figure.drawingId,
      name: sanitizeFileName(figure.originalName),
      originalName: figure.originalName,
      mime: figure.mime,
      bytes: figure.bytes.byteLength,
      sha256: figure.sha256,
      base64: bytesToBase64(figure.bytes),
    }))),
  }, passphrase);
  const packName = "项目备份.patentpack";
  output.push({ name: packName, manifestName: packName, data: packed, mime: mimeFor(packName) });

  const files: StoredExportFile[] = [];
  for (const file of output) {
    const meta = await manifestFile(exportId, file.name, file.data, file.manifestName, file.mime);
    files.push({ ...meta, data: new Uint8Array(file.data) });
  }
  return files;
}

async function browserReportRenderer(): Promise<(spec: ReportPageSpec) => Promise<Uint8Array[]>> {
  if (typeof document === "undefined") throw new ExportBuildFailure("STORAGE_UNAVAILABLE", "本机 PDF 页面渲染器不可用。");
  const renderer = await import("../../../lib/export-render.ts");
  return renderer.renderReportPages;
}

function recordFromRow(row: StoredExportRow): ExportRecord {
  return withFileStatus(row, "ready", []);
}

function gateMessage(reasons: readonly ExportGateReason[]): string {
  return reasons.map((reason) => `${reason.code}${reason.resourceId ? ` · ${reason.resourceId}` : ""}`).join("；") || "导出门禁不允许此操作。";
}

/**
 * Public R1 export seam. It reloads the current LocalRepository snapshot, applies
 * V6-05's gate, builds and caches actual bytes, and rechecks the binding before
 * returning any downloaded bytes. Repeated creation with the same inputs replays
 * the same persisted manifest, files and single export.created event.
 */
export class ExportSession {
  private readonly options: ExportSessionOptions;
  private passphrase: string;
  private readonly listeners = new Set<(state: ExportSessionState) => void>();
  private state: ExportSessionState;

  constructor(options: ExportSessionOptions) {
    this.options = options;
    this.passphrase = options.passphrase;
    this.state = {
      phase: "loading",
      snapshot: null,
      inputStale: false,
      testOutput: false,
      gate: null,
      record: null,
      files: [],
      unavailableFormats: [{ format: "xml", code: "FORMAT_UNAVAILABLE", reason: XML_UNAVAILABLE }],
      error: null,
    };
  }

  getSnapshot(): ExportSessionState {
    return structuredClone(this.state);
  }

  subscribe(listener: (state: ExportSessionState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Update the export passphrase without rebuilding the loaded session. */
  setPassphrase(value: string): void {
    this.passphrase = value;
  }

  async load(): Promise<void> {
    await this.refresh();
  }

  async refresh(): Promise<void> {
    this.setState({ ...this.state, phase: "loading", error: null });
    try {
      const context = await readCurrentContext(this.options);
      const records = await readExportRows(this.options.repository, this.options.actor, this.options.matterId, this.options.targetId);
      const now = (this.options.now ?? defaultNow)();
      const boundRows = records.filter((row) => isCurrent(row.manifest.snapshot, context.snapshot));
      const expiredRows: StoredExportRow[] = records.filter((row) => row.state === "expired");
      for (const row of records) {
        if (row.state === "expired" || !cacheExpired(row, now)) continue;
        await this.markExpired(exportStorageKey(this.options.actor, this.options.matterId, row.cacheKey), row, now, null);
        expiredRows.push({ ...row, state: "expired", expiredAt: now, expiredReason: "CACHE_EXPIRED" });
      }
      const newestFirst = (left: StoredExportRow, right: StoredExportRow) =>
        (right.generation ?? 0) - (left.generation ?? 0)
        || right.manifest.createdAt.localeCompare(left.manifest.createdAt)
        || right.manifest.exportId.localeCompare(left.manifest.exportId);
      const expired = expiredRows.sort(newestFirst)[0] ?? null;
      const current = boundRows
        .filter((row) => row.state !== "failed" && row.state !== "expired" && !cacheExpired(row, now))
        .sort(newestFirst)[0] ?? null;
      const currentFailed = boundRows.filter((row) => row.state === "failed").sort(newestFirst)[0] ?? null;
      const currentFiles = current?.state === "ready" ? current : null;
      const stale = records.find((row) => row.state !== "failed" && row.state !== "expired" && !isCurrent(row.manifest.snapshot, context.snapshot)) ?? null;
      const shownExpired = !currentFiles && !current ? expired : null;
      const staleExpired = shownExpired !== null && !isCurrent(shownExpired.manifest.snapshot, context.snapshot);
      const shown = currentFiles ?? shownExpired ?? current ?? stale;
      const expiredReasons: ExportGateReason[] = shownExpired
        ? [
            { code: "CACHE_EXPIRED", ...(expirationTime(shownExpired) ? { resourceId: expirationTime(shownExpired)! } : {}) },
            ...(staleExpired ? [{ code: "STALE_BINDING" }] : []),
          ]
        : [];
      const fileReasons = currentFiles
        ? context.gate.reasons
        : shownExpired
          ? expiredReasons
          : current?.state === "prepared"
            ? [{ code: "STORAGE_UNAVAILABLE", resourceId: current.manifest.exportId }]
            : stale
              ? [{ code: "STALE_BINDING" }]
              : context.gate.reasons;
      const fileStatus = fileReasons.length === 0 && shown?.state === "ready" ? "ready" : "unavailable";
      const record = shown ? { ...withFileStatus(shown, fileStatus, fileReasons), files: fileViewsForRow(shown, fileStatus, fileReasons) } : null;
      const blocked = !context.gate.allowed;
      this.setState({
        phase: shownExpired || (stale && !currentFiles) ? "stale" : blocked ? "blocked" : currentFailed ? "error" : current?.state === "prepared" ? "error" : record ? "ready" : "empty",
        snapshot: context.snapshot,
        inputStale: context.inputStale,
        testOutput: context.revision.revision.testOutput === true,
        gate: context.gate,
        record,
        files: record?.files ?? [],
        unavailableFormats: [{ format: "xml", code: "FORMAT_UNAVAILABLE", reason: XML_UNAVAILABLE }],
        error: currentFailed
          ? { code: currentFailed.failureCode ?? "STORAGE_UNAVAILABLE", message: currentFailed.failureMessage ?? "上次导出失败。" }
          : current?.state === "prepared"
            ? { code: "STORAGE_UNAVAILABLE", message: `导出事件尚未写入，结果未完成（${current.manifest.exportId}）。请重试。` }
            : null,
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : "导出状态读取失败。";
      const code = error instanceof ExportReadFailure ? error.code : "STORAGE_UNAVAILABLE";
      this.setState({
        ...this.state,
        phase: "error",
        files: [],
        unavailableFormats: [{ format: "xml", code: "FORMAT_UNAVAILABLE", reason: XML_UNAVAILABLE }],
        error: { code, message: detail },
      });
    }
  }

  async createExport(): Promise<ExportActionResult> {
    let context: LoadedExportContext;
    try {
      context = await readCurrentContext(this.options);
    } catch (error) {
      const result = this.readError(error);
      await this.refresh();
      return result;
    }
    if (!context.gate.allowed) {
      await this.refresh();
      return { ok: false, error: { code: "GATE_BLOCKED", message: gateMessage(context.gate.reasons), reasons: context.gate.reasons } };
    }
    if (this.passphrase.trim().length === 0) {
      this.setState({ ...this.state, phase: "blocked", snapshot: context.snapshot, gate: context.gate, files: [] });
      return { ok: false, error: { code: "FORMAT_UNAVAILABLE", message: "生成加密 patentpack 需要本机备份口令。" } };
    }
    if (this.options.checkResult === null || !isCurrentCheckRun(this.options.checkResult.checkRun, context.snapshot, this.options.activeRulePackVersion)) {
      await this.refresh();
      return { ok: false, error: { code: "GATE_BLOCKED", message: gateMessage(context.gate.reasons), reasons: context.gate.reasons } };
    }

    const { packageKind, cacheKey: baseCacheKey } = await packageKindKey(this.options, context, this.passphrase);
    const allRows = await readExportRows(this.options.repository, this.options.actor, this.options.matterId, this.options.targetId);
    const familyPrefix = `${baseCacheKey}/g`;
    const familyRows = allRows.filter((row) => row.cacheKey === baseCacheKey || row.cacheKey.startsWith(familyPrefix));
    const prior = familyRows.sort((left, right) => (right.generation ?? 0) - (left.generation ?? 0)
      || right.manifest.createdAt.localeCompare(left.manifest.createdAt))[0] ?? null;
    const now = (this.options.now ?? defaultNow)();
    let generation = prior?.generation ?? 0;
    let cacheKey = prior?.cacheKey ?? baseCacheKey;
    if (prior && prior.state !== "failed" && cacheExpired(prior, now)) {
      generation += 1;
      cacheKey = `${baseCacheKey}/g${generation}`;
      await this.markExpired(exportStorageKey(this.options.actor, this.options.matterId, prior.cacheKey), prior, now, null);
    }
    const storageKey = exportStorageKey(this.options.actor, this.options.matterId, cacheKey);
    try {
      const cached = prior && prior.cacheKey === cacheKey ? await this.readRow(storageKey) : null;
      if (cached?.state === "failed") {
        // A failed row is a visible explanation, not a permanent lock: retry
        // rebuilds and replaces it if the cause has since cleared.
      } else if (cached) {
        const eventStatus = await this.ensureCreatedEvent(cached);
        if (!eventStatus.ok) {
          await this.markFailed(storageKey, cached, eventStatus.error.code, eventStatus.error.message);
          await this.refresh();
          return eventStatus;
        }
        await this.markReady(storageKey, cached);
        await this.refresh();
        return { ok: true, record: recordFromRow({ ...cached, state: "ready" }), replayed: true };
      }

      const createdAt = now;
      const exportId = await idFor(`v6/export/${cacheKey}`);
      const files = await buildFiles(this.options, context, exportId, createdAt, packageKind, this.passphrase);
      const manifest: ExportManifest = {
        schemaVersion: "export.v1",
        exportId,
        snapshot: context.snapshot,
        astHash: context.revision.revision.astHash,
        figureSetHash: context.figures.current.get(this.options.targetId)?.hash ?? "",
        rulePackVersion: this.options.activeRulePackVersion,
        checkRunId: this.options.checkResult.checkRun.id,
        approvalId: packageKind === "internally_approved" ? context.approval?.id ?? null : null,
        confirmationIds: context.liveConfirmations.map((item) => item.id),
        riskIds: (this.options.checkResult.checkRun.findings ?? []).filter((item) => item.category === "risk").map((item) => item.id),
        searchState: "not_searched",
        packageKind,
        ...(context.revision.revision.testOutput === true ? { testOutput: true } : {}),
        language: context.revision.ast.language,
        createdAt,
        files: files.map(({ data: _data, ...file }) => file),
      };
      const manifestBytes = new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`);
      const manifestSha256 = await sha256Hex(manifestBytes);
      const prepared: StoredExportRow = {
        kind: "delivery.export",
        tenantId: this.options.actor.tenantId,
        actorId: this.options.actor.userId,
        matterId: this.options.matterId,
        targetId: this.options.targetId,
        cacheKey,
        generation,
        state: "prepared",
        manifest,
        manifestBytes,
        manifestSha256,
        files,
      };
      const selected = await this.options.repository.backend.transaction("readwrite", async (tx) => {
        const existing = rowFrom(await tx.get(STORES.blobs, storageKey), this.options.actor, this.options.matterId, this.options.targetId);
        if (existing && existing.state !== "failed") return existing;
        await tx.put(STORES.blobs, storageKey, prepared);
        return prepared;
      });
      if (selected.state === "failed") {
        return { ok: false, error: { code: selected.failureCode ?? "STORAGE_UNAVAILABLE", message: selected.failureMessage ?? "上次导出失败。" } };
      }
      const eventStatus = await this.ensureCreatedEvent(selected);
      if (!eventStatus.ok) {
        await this.markFailed(storageKey, selected, eventStatus.error.code, eventStatus.error.message);
        await this.refresh();
        return eventStatus;
      }
      await this.markReady(storageKey, selected);
      await this.refresh();
      const latest = await this.readRow(storageKey);
      if (!latest) return { ok: false, error: { code: "STORAGE_UNAVAILABLE", message: "导出结果没有保存在本机。" } };
      return { ok: true, record: recordFromRow({ ...latest, state: "ready" }), replayed: selected !== prepared };
    } catch (error) {
      const code = error instanceof ExportBuildFailure ? error.code : "STORAGE_UNAVAILABLE";
      const message = error instanceof Error ? error.message : "本机导出失败。";
      await this.storeFailure(cacheKey, generation, storageKey, context, code, message);
      await this.refresh();
      return { ok: false, error: { code, message } };
    }
  }

  private async readRow(storageKey: string): Promise<StoredExportRow | null> {
    return this.options.repository.backend.transaction("readonly", async (tx) =>
      rowFrom(await tx.get(STORES.blobs, storageKey), this.options.actor, this.options.matterId, this.options.targetId),
    );
  }

  private async markExpired(storageKey: string, row: StoredExportRow, expiredAt: string, _nextCacheKey: string | null): Promise<void> {
    try {
      await this.options.repository.backend.transaction("readwrite", async (tx) => {
        const current = rowFrom(await tx.get(STORES.blobs, storageKey), this.options.actor, this.options.matterId, this.options.targetId);
        if (!current || current.manifest.exportId !== row.manifest.exportId || current.state === "expired") return;
        await tx.put(STORES.blobs, storageKey, {
          ...current,
          state: "expired",
          expiredAt,
          expiredReason: "CACHE_EXPIRED",
          manifestBytesLength: current.manifestBytesLength ?? current.manifestBytes.byteLength,
          manifestBytes: new Uint8Array(),
          files: current.files.map((file) => ({ ...file, data: new Uint8Array() })),
        } satisfies StoredExportRow);
      });
    } catch {
      // Reads also check age, so a storage failure cannot make the expired bytes ready.
    }
  }

  private async markFailed(storageKey: string, row: StoredExportRow, code: ExportErrorCode, message: string): Promise<void> {
    try {
      await this.options.repository.backend.transaction("readwrite", async (tx) => {
        const current = rowFrom(await tx.get(STORES.blobs, storageKey), this.options.actor, this.options.matterId, this.options.targetId);
        if (!current || current.manifest.exportId !== row.manifest.exportId || current.state === "ready") return;
        await tx.put(STORES.blobs, storageKey, { ...current, state: "failed", failureCode: code, failureMessage: message });
      });
    } catch {
      // Never expose a prepared artifact as ready; refresh independently refuses prepared rows.
    }
  }

  private async storeFailure(
    cacheKey: string,
    generation: number,
    storageKey: string,
    context: LoadedExportContext,
    code: ExportErrorCode,
    message: string,
  ): Promise<void> {
    const at = (this.options.now ?? defaultNow)();
    const exportId = await idFor(`v6/export/${cacheKey}`);
    const manifest: ExportManifest = {
      schemaVersion: "export.v1",
      exportId,
      snapshot: context.snapshot,
      astHash: context.revision.revision.astHash,
      figureSetHash: context.figures.current.get(this.options.targetId)?.hash ?? "",
      rulePackVersion: this.options.activeRulePackVersion,
      checkRunId: this.options.checkResult?.checkRun.id ?? "",
      approvalId: context.approval?.id ?? null,
      confirmationIds: context.liveConfirmations.map((item) => item.id),
      riskIds: (this.options.checkResult?.checkRun.findings ?? []).filter((item) => item.category === "risk").map((item) => item.id),
      searchState: "not_searched",
      packageKind: effectivePackageKind(this.options),
      language: context.revision.ast.language,
      createdAt: at,
      files: [],
    };
    const manifestBytes = new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`);
    const failed: StoredExportRow = {
      kind: "delivery.export",
      tenantId: this.options.actor.tenantId,
      actorId: this.options.actor.userId,
      matterId: this.options.matterId,
      targetId: this.options.targetId,
      cacheKey,
      generation,
      state: "failed",
      manifest,
      manifestBytes,
      manifestSha256: await sha256Hex(manifestBytes),
      files: [],
      failureCode: code,
      failureMessage: message,
    };
    try {
      await this.options.repository.backend.transaction("readwrite", async (tx) => {
        const existing = rowFrom(await tx.get(STORES.blobs, storageKey), this.options.actor, this.options.matterId, this.options.targetId);
        if (existing?.state === "ready") return;
        await tx.put(STORES.blobs, storageKey, failed);
      });
    } catch {
      // The failed row is only a persistent explanation; the caller still gets the real error.
    }
  }

  async download(fileId: string): Promise<{ ok: true; bytes: Uint8Array; file: ExportFileView } | { ok: false; error: { code: ExportErrorCode; message: string; reasons?: readonly ExportGateReason[] } }> {
    let context: LoadedExportContext;
    try {
      context = await readCurrentContext(this.options);
    } catch (error) {
      return this.readError(error);
    }
    const rows = await readExportRows(this.options.repository, this.options.actor, this.options.matterId, this.options.targetId);
    const now = (this.options.now ?? defaultNow)();
    const row = rows.find((item) => item.files.some((file) => file.id === fileId) || manifestSidecar(item).id === fileId);
    if (!row) return { ok: false, error: { code: "RESOURCE_NOT_FOUND", message: "导出文件不可用。" } };
    if (row.state === "expired" || cacheExpired(row, now)) {
      return { ok: false, error: { code: "CACHE_EXPIRED", message: "导出缓存已超过七天；请重新导出。", reasons: [{ code: "CACHE_EXPIRED" }] } };
    }
    if (row.state !== "ready") return { ok: false, error: { code: "STORAGE_UNAVAILABLE", message: "导出尚未完成，不能下载。" } };
    if (!isCurrent(row.manifest.snapshot, context.snapshot)) {
      return { ok: false, error: { code: "STALE_BINDING", message: "SnapshotRef 已变化，请重新导出。", reasons: [{ code: "STALE_BINDING" }] } };
    }
    if (!context.gate.allowed) {
      return { ok: false, error: { code: "GATE_BLOCKED", message: gateMessage(context.gate.reasons), reasons: context.gate.reasons } };
    }
    if (manifestSidecar(row).id === fileId) {
      if (row.manifestBytes.byteLength === 0 || (await sha256Hex(row.manifestBytes)) !== row.manifestSha256) {
        return { ok: false, error: { code: "HASH_MISMATCH", message: "下载清单字节与其 SHA-256 不符。" } };
      }
      return { ok: true, bytes: new Uint8Array(row.manifestBytes), file: manifestSidecar(row) };
    }
    const file = row.files.find((item) => item.id === fileId)!;
    const manifestEntry = row.manifest.files.find((item) => item.id === fileId);
    if (!manifestEntry || file.bytes !== file.data.byteLength || manifestEntry.bytes !== file.data.byteLength
      || manifestEntry.sha256 !== file.sha256 || (await sha256Hex(file.data)) !== manifestEntry.sha256) {
      return { ok: false, error: { code: "HASH_MISMATCH", message: "下载字节与 manifest SHA-256 不符。" } };
    }
    const { data: _data, ...view } = file;
    return { ok: true, bytes: new Uint8Array(file.data), file: { ...view, status: "ready", unavailableReasons: [] } };
  }

  private async ensureCreatedEvent(row: StoredExportRow): Promise<ExportActionResult | { ok: true }> {
    const eventId = eventIdFor(row.manifest.exportId);
    const existingEvents = await this.options.repository.listEvents(this.options.actor, this.options.matterId);
    if (!existingEvents.ok) return { ok: false, error: { code: "STORAGE_UNAVAILABLE", message: existingEvents.error.message } };
    if (existingEvents.data.items.some((event) => event.id === eventId && event.action === "export.created")) return { ok: true };

    const latest = await this.options.repository.loadMatter(this.options.actor, this.options.matterId);
    if (!latest.ok) return { ok: false, error: { code: "STORAGE_UNAVAILABLE", message: latest.error.message } };
    const rechecked = await readCurrentContext(this.options);
    if (!isCurrent(row.manifest.snapshot, rechecked.snapshot)) {
      return { ok: false, error: { code: "STALE_BINDING", message: "SnapshotRef 已变化，未创建导出记录。", reasons: [{ code: "STALE_BINDING" }] } };
    }
    if (!rechecked.gate.allowed) {
      return { ok: false, error: { code: "GATE_BLOCKED", message: gateMessage(rechecked.gate.reasons), reasons: rechecked.gate.reasons } };
    }
    const occurredAt = row.manifest.createdAt;
    const metadata = { count: row.files.length };
    const allowed = ACTIVITY_METADATA_KEYS_BY_ACTION["export.created"];
    if (Object.keys(metadata).some((key) => !allowed.includes(key as "count"))) {
      return { ok: false, error: { code: "INVALID_INPUT", message: "导出活动元数据不符合合同。" } };
    }
    const event = activitySchema.parse({
      id: eventId,
      tenantId: this.options.actor.tenantId,
      matterId: this.options.matterId,
      targetId: this.options.targetId,
      actorId: this.options.actor.userId,
      actorKind: "user",
      action: "export.created",
      snapshot: row.manifest.snapshot,
      jobId: null,
      resourceId: row.manifest.exportId,
      occurredAt,
      metadata,
    }) as ActivityRecord;
    const aggregate = latest.data.data;
    const committed = await this.options.repository.commit(this.options.actor, {
      contractVersion: CONTRACT_VERSION,
      expectedVersion: aggregate.matter.version,
      payload: {
        matter: { ...aggregate.matter, version: aggregate.matter.version + 1, updatedAt: occurredAt },
        targets: aggregate.targets,
        assets: aggregate.assets,
        events: [event],
        blobs: [],
      },
    }, { requestId: eventId });
    if (committed.ok) return { ok: true };
    if (committed.error.code === "INVALID_INPUT") {
      const afterRace = await this.options.repository.listEvents(this.options.actor, this.options.matterId);
      if (afterRace.ok && afterRace.data.items.some((item) => item.id === eventId && item.action === "export.created")) return { ok: true };
    }
    if (committed.error.code === "VERSION_CONFLICT") {
      const afterConflict = await this.options.repository.listEvents(this.options.actor, this.options.matterId);
      if (afterConflict.ok && afterConflict.data.items.some((item) => item.id === eventId && item.action === "export.created")) return { ok: true };
      return { ok: false, error: { code: "STORAGE_UNAVAILABLE", message: "案件在导出期间发生变化，请刷新后重试。" } };
    }
    return { ok: false, error: { code: "STORAGE_UNAVAILABLE", message: committed.error.message } };
  }

  private async markReady(storageKey: string, row: StoredExportRow): Promise<void> {
    await this.options.repository.backend.transaction("readwrite", async (tx) => {
      const current = rowFrom(await tx.get(STORES.blobs, storageKey), this.options.actor, this.options.matterId, this.options.targetId);
      if (current?.manifest.exportId === row.manifest.exportId) await tx.put(STORES.blobs, storageKey, { ...current, state: "ready" });
    });
  }

  private readError(error: unknown): Extract<ExportActionResult, { ok: false }> {
    const code = error instanceof ExportReadFailure ? error.code : "STORAGE_UNAVAILABLE";
    const message = error instanceof Error ? error.message : "导出数据读取失败。";
    return { ok: false, error: { code, message } };
  }

  private setState(state: ExportSessionState): void {
    this.state = state;
    for (const listener of this.listeners) listener(this.getSnapshot());
  }
}

/** Explicit XML capability; the component can show its real unavailable reason. */
export const XML_FORMAT_CAPABILITY = Object.freeze({
  format: "xml" as const,
  state: "unavailable" as const,
  code: "FORMAT_UNAVAILABLE" as const,
  reason: XML_UNAVAILABLE,
});

class ExportReadFailure extends Error {
  readonly code: ExportErrorCode;
  constructor(code: string, message: string) {
    super(message);
    this.code = code as ExportErrorCode;
  }
}

class ExportBuildFailure extends Error {
  readonly code: ExportErrorCode;
  constructor(code: ExportErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}
