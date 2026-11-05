/**
 * V6-26 — encrypted recovery packages and one-shot import (S08 恢复包与导入).
 *
 * The public seam is deliberately small:
 *
 * - `createRecoveryPackage(repository, actor, matterId, { passphrase, access })`
 *   writes a `recovery.v1` JSON payload and returns its encrypted `.patentpack`
 *   bytes. The payload contains a versioned asset manifest with SHA-256 hashes,
 *   original asset bytes (base64), figure references, source/parse rows needed
 *   to remap references, and a migration report. A missing asset is listed as
 *   `missing_bytes`; it is never replaced by a placeholder. When `access` is
 *   `preview`, generated draft content is trimmed to the PreviewDTO scope and
 *   every omitted paragraph is listed in the report. User original bytes stay
 *   complete (C05/C10).
 * - `validateRecoveryPackage(repository, actor, bytes, passphrase)` decrypts and
 *   dry-runs schema, version, path, budget, reference and hash checks. It
 *   persists one `recovery.validation` row only after a valid dry-run and
 *   returns a `MigrationReport`, a deterministic `validationId` and the planned
 *   new matter id. A wrong passphrase, a tampered ciphertext, a bad hash/path/
 *   budget or an unresolved required reference returns an error and writes
 *   nothing.
 * - `commitRecoveryImport(repository, actor, validationId)` writes exactly one
 *   new matter. All ids (matter, targets, assets, drawings, figures, revisions,
 *   parties, facts, sources, chunks, intake rows) are remapped; approvals,
 *   auth identity, entitlements, payments, service grants and shares are never
 *   restored. Old local review records become `legacy_unverified` rows.
 *   Repeating the commit with the same validationId replays the committed
 *   matter; it never creates a second one. Every row of the new case is written
 *   in one repository transaction, so an injected write failure leaves no half
 *   case (A02). A successful commit deletes the decrypted validation row in the
 *   same transaction and leaves only a small `recovery.commit` marker (ids and
 *   the report, no package bytes/AST/chunks/passphrase/key) for idempotent
 *   replay and refresh.
 * - A validated dry-run row is deleted after `RECOVERY_VALIDATION_TTL_MS`
 *   (15 minutes); `validateRecoveryPackage`, `readRecoveryValidation` and
 *   `commitRecoveryImport` sweep the actor's expired rows. An expired row can
 *   never be committed. The passphrase is never persisted.
 * - `readRecoveryValidation` and `readRecoveredDraft` read persisted state only,
 *   so a refresh or a retry shows the same result instead of guessing.
 *
 * Encryption reuses `packages/export/src/patentpack.ts`: PBKDF2-SHA-256 with a
 * random 16-byte salt and 200,000 iterations derives a 256-bit AES-GCM key; a
 * fresh random 12-byte IV encrypts the JSON; the envelope is
 * `{v:1, alg, salt, iv, ciphertext}` and the ciphertext is authenticated. The
 * passphrase is never stored, logged, returned or written to evidence.
 *
 * Budget: one package may carry at most 256 MiB of asset bytes and 2,000 asset
 * records; one asset may be at most 50 MiB. Names are checked as plain file
 * names (no path separators, `..`, control characters or overlong text).
 */
import {
  draftAstSchema,
  sourceSnapshotSchema,
  targetConfigSchema,
  type DraftAST,
  type SourceSnapshot,
  type TargetConfig,
} from "../../../../../../packages/contracts/src/index.ts";
import {
  base64ToBytes,
  bytesToBase64,
  buildPatentPack,
  openPatentPack,
  PATENTPACK_ALG,
  PATENTPACK_ITERATIONS,
  PATENTPACK_VERSION,
} from "../../../../../../packages/export/src/index.ts";
import {
  STORES,
  sha256Hex,
  type Actor,
  type ActivityRecord,
  type AssetRecord,
  type BlobWrite,
  type LocalRepository,
  type MatterAggregate,
  type MatterRecord,
  type TargetRecord,
} from "../../lib/repository.ts";
import type { DraftRevision } from "../../../../../../packages/contracts/src/draft.ts";

export const RECOVERY_SCHEMA_VERSION = "recovery.v1" as const;
export const RECOVERY_CRYPTO = Object.freeze({
  envelopeVersion: PATENTPACK_VERSION,
  algorithm: PATENTPACK_ALG,
  kdf: "PBKDF2",
  hash: "SHA-256",
  iterations: PATENTPACK_ITERATIONS,
  keyLengthBits: 256,
  cipher: "AES-GCM",
  saltBytes: 16,
  ivBytes: 12,
});
export const RECOVERY_MAX_ASSET_BYTES = 50 * 1024 * 1024;
export const RECOVERY_MAX_PACKAGE_BYTES = 256 * 1024 * 1024;
export const RECOVERY_MAX_ASSETS = 2_000;
export const RECOVERY_MAX_RECORDS = 20_000;
/** A decrypted dry-run payload is retained for at most this long. */
export const RECOVERY_VALIDATION_TTL_MS = 15 * 60 * 1000;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;
const SAFE_NAME_PATTERN = /^[^\u0000-\u001f/\\]{1,200}$/;

export type RecoveryAccess = "local_unmetered" | "preview" | "full";
export type RecoveryErrorCode =
  | "INVALID_INPUT"
  | "RECOVERY_DECRYPT_FAILED"
  | "IMPORT_INVALID"
  | "HASH_MISMATCH"
  | "RESOURCE_NOT_FOUND"
  | "VERSION_CONFLICT"
  | "STORAGE_UNAVAILABLE"
  | "QUOTA_EXCEEDED";

export interface RecoveryFailure {
  code: RecoveryErrorCode;
  message: string;
}

export class RecoveryError extends Error {
  readonly code: RecoveryErrorCode;
  constructor(code: RecoveryErrorCode, message: string) {
    super(message);
    this.name = "RecoveryError";
    this.code = code;
  }
}

export interface RecoveryAsset {
  id: string;
  purpose: AssetRecord["purpose"];
  originalName: string;
  mime: string;
  byteLength: number;
  sha256: string;
  state: "available" | "missing_bytes";
  /** Base64 original bytes; null exactly when state is missing_bytes. */
  base64: string | null;
}

export interface RecoveryTarget {
  id: string;
  status: "active" | "archived";
  configVersion: number;
  draftRevisionId: string | null;
  figureRevisionId: string;
  config: TargetConfig | null;
}

export interface RecoveryFigureRef {
  figureId: string;
  number: number;
  title: string;
  drawingId: string | null;
  drawingAssetId: string | null;
  sha256: string | null;
  figureRevisionId: string;
}

export interface RecoveryLegacyReview {
  /** Old record id, kept only inside the encrypted package. */
  id: string;
  kind: string;
  identity: "legacy_unverified";
  recordedAt: string | null;
}

export interface RecoveryRecord {
  kind: string;
  value: Record<string, unknown>;
}

export interface RecoveryPackageReport {
  generatedAt: string;
  access: RecoveryAccess;
  assetCount: number;
  missingBytes: readonly { assetId: string; originalName: string; sha256: string }[];
  omittedGeneratedContent: readonly {
    revisionId: string;
    paragraphId: string;
    section: string;
    reason: "PREVIEW_SCOPE" | "GENERATED_CONTENT";
  }[];
  legacyUnverified: readonly RecoveryLegacyReview[];
  unknownVersions: readonly { ref: string; version: string }[];
  unconvertible: readonly { ref: string; reason: string }[];
  incomplete: boolean;
  mappingCounts: Record<string, number>;
}

export interface RecoveryPackage {
  schemaVersion: typeof RECOVERY_SCHEMA_VERSION;
  packageId: string;
  sourceMatterId: string;
  sourceTenantId: string;
  sourceActorId: string;
  createdAt: string;
  access: RecoveryAccess;
  source: { title: string; sourceVersion: number; targetCount: number; assetCount: number };
  assets: readonly RecoveryAsset[];
  /** Same manifest under the S08 name; exported packages carry both keys. */
  assetManifest: readonly RecoveryAsset[];
  targets: readonly RecoveryTarget[];
  figureRefs: readonly RecoveryFigureRef[];
  records: readonly RecoveryRecord[];
  sourceSnapshot: SourceSnapshot | null;
  legacyReviews: readonly RecoveryLegacyReview[];
  migrationReport: RecoveryPackageReport;
}

export interface RecoveryExportOptions {
  passphrase: string;
  /**
   * local_unmetered returns all generated content. preview follows C10's
   * PreviewDTO scope. full is accepted only as an explicit R2 full-access
   * package; this local ticket never acquires that entitlement itself.
   */
  access: RecoveryAccess;
  now?: () => string;
}

export interface RecoveryClockOptions {
  /** Injected RFC3339 UTC clock; defaults to the wall clock. */
  now?: () => string;
}

export interface MigrationIssue {
  code: string;
  ref: string;
  reason: string;
}

export interface MigrationReport {
  validationId: string;
  packageId: string;
  sourceMatterId: string;
  access: RecoveryAccess;
  canCommit: boolean;
  incomplete: boolean;
  /**
   * Counts derived only from the package, so the dry-run and the committed
   * report are identical. `figures` counts figure entries across all
   * figure-set revisions; `drawings` counts drawing records; `revisions`
   * counts draft revisions.
   */
  mappingCounts: Record<string, number>;
  missingBytes: readonly { assetId: string; originalName: string; sha256: string; state: "missing_bytes" }[];
  unknownVersions: readonly { ref: string; version: string }[];
  unconvertible: readonly MigrationIssue[];
  omittedGeneratedContent: readonly RecoveryPackageReport["omittedGeneratedContent"][number][];
  legacyUnverified: readonly RecoveryLegacyReview[];
}

export interface ValidatedRecovery {
  validationId: string;
  packageHash: string;
  packageId: string;
  sourceMatterId: string;
  plannedMatterId: string;
  canCommit: boolean;
  report: MigrationReport;
}

export type RecoveryResult<T> = { ok: true; data: T } | { ok: false; error: RecoveryFailure; report?: MigrationReport };

export interface RecoveryValidationView {
  validationId: string;
  packageId: string;
  sourceMatterId: string;
  plannedMatterId: string;
  status: "validated" | "committed";
  matterId: string | null;
  canCommit: boolean;
  report: MigrationReport;
  createdAt: string;
  committedAt: string | null;
}

export interface RecoveryCommitResult {
  validationId: string;
  matterId: string;
  replayed: boolean;
  report: MigrationReport;
}

export interface RecoveryDraftView {
  revision: DraftRevision;
  ast: DraftAST;
}

interface StoredValidation {
  kind: "recovery.validation";
  tenantId: string;
  actorId: string;
  validationId: string;
  packageHash: string;
  /** SHA-256 of the canonical decrypted payload, so a tampered local row is refused. */
  payloadHash: string;
  package: RecoveryPackage;
  sourceMatterId: string;
  plannedMatterId: string;
  status: "validated";
  matterId: null;
  report: MigrationReport;
  createdAt: string;
  /** The decrypted package is deleted at or after this instant. */
  expiresAt: string;
}

/**
 * The small post-commit record. It contains no package, asset bytes, AST,
 * passphrase or derived key: only the id needed to replay the one committed
 * matter and the user-facing report. It is not subject to the 15-minute
 * plaintext-package TTL because it holds no package content.
 */
interface StoredCommit {
  kind: "recovery.commit";
  tenantId: string;
  actorId: string;
  validationId: string;
  matterId: string;
  report: MigrationReport;
  committedAt: string;
}

const SOURCE_KEY_PREFIX = "parse/source/";
const CHUNK_KEY_PREFIX = "parse/chunks/";
const DRAWING_KEY_PREFIX = "drawings/";
const FIGURE_KEY_PREFIX = "figures/";
const GENERATION_REVISION_PREFIX = "generation/revision/";
const GENERATION_REVISIONS_PREFIX = "generation/revisions/";
const TARGET_CONFIG_PREFIX = "targets/config";
const INTAKE_SNAPSHOT_PREFIX = "intake/snapshot/";
const INTAKE_CANDIDATES_PREFIX = "intake/candidates/";
const INTAKE_DRAFTS_PREFIX = "intake/drafts/";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isText(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function isIso(value: unknown): value is string {
  return typeof value === "string" && ISO_PATTERN.test(value) && Number.isFinite(Date.parse(value));
}

function isSha(value: unknown): value is string {
  return typeof value === "string" && SHA256_PATTERN.test(value);
}

function defaultNow(): string {
  return new Date().toISOString();
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isRecord(value)) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) if (value[key] !== undefined) out[key] = canonicalize(value[key]);
    return out;
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

async function derivedId(seed: string): Promise<string> {
  const digest = await sha256Hex(new TextEncoder().encode(seed));
  const hex = digest.slice(0, 32).split("");
  hex[12] = "5";
  hex[16] = "8";
  const raw = hex.join("");
  return `${raw.slice(0, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}-${raw.slice(16, 20)}-${raw.slice(20, 32)}`;
}

async function astHash(ast: DraftAST): Promise<string> {
  return sha256Hex(new TextEncoder().encode(canonicalJson(ast)));
}

async function figureHash(entries: readonly FigureEntry[]): Promise<string> {
  const canonical = [...entries]
    .sort((a, b) => a.number - b.number || a.figureId.localeCompare(b.figureId))
    .map((entry) => ({
      figureId: entry.figureId,
      number: entry.number,
      title: entry.title.normalize("NFC"),
      drawingId: entry.drawingId,
      numerals: entry.numerals.map((numeral) => ({
        value: numeral.value.normalize("NFC"),
        label: numeral.label.normalize("NFC"),
      })),
    }));
  return sha256Hex(new TextEncoder().encode(JSON.stringify(canonical)));
}

function safeName(name: unknown): string | null {
  if (typeof name !== "string" || name.length === 0 || name.length > 200) return null;
  if (!SAFE_NAME_PATTERN.test(name) || name.includes("..")) return null;
  return name;
}

function magicMatches(mime: string, bytes: Uint8Array): boolean {
  if (mime === "image/png") return bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  if (mime === "image/jpeg") return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  return true;
}

function rowKeyForValidation(actor: Actor, validationId: string): string {
  return `recovery/validation/${encodeURIComponent(actor.tenantId)}/${encodeURIComponent(actor.userId)}/${validationId}`;
}

function rowKeyForCommit(actor: Actor, validationId: string): string {
  return `recovery/commit/${encodeURIComponent(actor.tenantId)}/${encodeURIComponent(actor.userId)}/${validationId}`;
}

function isExpired(row: StoredValidation, now: string): boolean {
  const expires = Date.parse(row.expiresAt);
  const at = Date.parse(now);
  return !Number.isFinite(expires) || !Number.isFinite(at) || expires <= at;
}

/**
 * Remove this actor's expired dry-run rows, which are the only rows that
 * contain the decrypted package. Commit markers contain no package and are
 * deliberately left alone.
 */
async function cleanupExpiredValidations(repository: LocalRepository, actor: Actor, now: string): Promise<void> {
  try {
    await repository.backend.transaction("readwrite", async (tx) => {
      const rows = await tx.getAll(STORES.blobs);
      for (const row of rows) {
        if (!isRecord(row) || row.kind !== "recovery.validation" || row.tenantId !== actor.tenantId
          || row.actorId !== actor.userId || !isText(row.validationId)) continue;
        const expires = isText(row.expiresAt) ? Date.parse(row.expiresAt) : Number.NaN;
        if (!Number.isFinite(expires) || expires <= Date.parse(now)) {
          await tx.delete(STORES.blobs, rowKeyForValidation(actor, row.validationId));
        }
      }
    });
  } catch {
    // Cleanup is best effort; reads still refuse an expired row by timestamp.
  }
}

interface PackageBuildContext {
  matter: MatterRecord;
  aggregate: MatterAggregate;
  rows: readonly unknown[];
  access: RecoveryAccess;
  now: string;
  passphrase: string;
}

interface FigureEntry {
  figureId: string;
  number: number;
  title: string;
  drawingId: string | null;
  numerals: { value: string; label: string }[];
}

interface StoredDrawingRow {
  kind: "drawings.drawing";
  tenantId: string;
  matterId: string;
  drawing: {
    id: string;
    matterId: string;
    assetId: string;
    width: number;
    height: number;
    mime: "image/png" | "image/jpeg";
    sha256: string;
    derivedFromAssetId: string | null;
  };
}

interface StoredFigureSetRow {
  kind: "figures.set";
  tenantId: string;
  matterId: string;
  revision: {
    id: string;
    matterId: string;
    targetId: string;
    parentId: string | null;
    entries: FigureEntry[];
    hash: string;
    createdAt: string;
  };
}

function isDrawingRow(value: unknown): value is StoredDrawingRow {
  return isRecord(value) && value.kind === "drawings.drawing" && isRecord(value.drawing)
    && isUuid(value.drawing.id) && isUuid(value.drawing.assetId) && isUuid(value.matterId);
}

function isFigureSetRow(value: unknown): value is StoredFigureSetRow {
  return isRecord(value) && value.kind === "figures.set" && isRecord(value.revision)
    && isUuid(value.revision.id) && isUuid(value.revision.targetId) && isUuid(value.matterId)
    && Array.isArray(value.revision.entries);
}

function isGenerationRevisionRow(value: unknown): value is { kind: "generation.revision"; tenantId: string; actorId: string; matterId: string; targetId: string; revision: DraftRevision } {
  return isRecord(value) && value.kind === "generation.revision" && isRecord(value.revision)
    && isUuid(value.matterId) && isUuid(value.targetId) && isUuid(value.revision.id);
}

function figureEntries(value: unknown): FigureEntry[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((entry) => ({
    figureId: String(entry.figureId),
    number: Number(entry.number),
    title: String(entry.title ?? ""),
    drawingId: typeof entry.drawingId === "string" ? entry.drawingId : null,
    numerals: Array.isArray(entry.numerals)
      ? entry.numerals.filter(isRecord).map((numeral) => ({ value: String(numeral.value ?? ""), label: String(numeral.label ?? "") }))
      : [],
  }));
}

function targetConfigFromRow(value: unknown): TargetConfig | null {
  if (!isRecord(value) || value.kind !== "target.config" || !isRecord(value.config)) return null;
  return value.config as unknown as TargetConfig;
}

/** Build the encrypted recovery package payload. */
export async function createRecoveryPackage(
  repository: LocalRepository,
  actor: Actor,
  matterId: string,
  options: RecoveryExportOptions,
): Promise<Uint8Array> {
  if (!isText(options?.passphrase) || options.passphrase.trim().length === 0) {
    throw new RecoveryError("INVALID_INPUT", "生成加密恢复包需要非空口令。");
  }
  if (!["local_unmetered", "preview", "full"].includes(options.access)) {
    throw new RecoveryError("INVALID_INPUT", "恢复包访问级别无效。");
  }
  const loaded = await repository.loadMatter(actor, matterId);
  if (!loaded.ok) throw new RecoveryError(loaded.error.code === "RESOURCE_NOT_FOUND" ? "RESOURCE_NOT_FOUND" : "STORAGE_UNAVAILABLE", loaded.error.message);
  const aggregate = loaded.data.data;
  const sourceVersion = aggregate.matter.sourceVersion;
  let rows: readonly unknown[];
  try {
    rows = await repository.backend.transaction("readonly", (tx) => tx.getAll(STORES.blobs));
  } catch {
    throw new RecoveryError("STORAGE_UNAVAILABLE", "无法读取本机恢复数据。");
  }
  const now = (options.now ?? defaultNow)();
  const context: PackageBuildContext = { matter: aggregate.matter, aggregate, rows, access: options.access, now, passphrase: options.passphrase };
  const report = emptyPackageReport(context);
  const assets = await buildAssets(context, report);
  const assetById = new Map(assets.map((asset) => [asset.id, asset]));
  const drawings = rows.filter(isDrawingRow).filter((row) => row.matterId === matterId && row.tenantId === actor.tenantId);
  const figureRows = rows.filter(isFigureSetRow).filter((row) => row.matterId === matterId && row.tenantId === actor.tenantId);
  const targets = await buildTargets(context);
  const records: RecoveryRecord[] = [];

  for (const row of drawings) records.push({ kind: "drawings.drawing", value: structuredClone(row as unknown as Record<string, unknown>) });
  for (const row of figureRows) records.push({ kind: "figures.set", value: structuredClone(row as unknown as Record<string, unknown>) });
  collectTargetConfigRecords(rows, context, targets, records);
  collectParseRecords(rows, context, records, report);
  const revisionRecords = collectRevisionRecords(rows, context, records, report);
  collectIntakeRecords(rows, context, records, report);

  const figureRefs = buildFigureRefs(figureRows, drawings, assetById);
  const legacyReviews = collectLegacyReviews(rows, context, report);
  const sourceSnapshot = await buildSourceSnapshot(context, report);
  for (const revision of revisionRecords) {
    if (options.access === "preview") {
      trimRevisionForPreview(revision, report);
      const storedRevision = records.find((record) => record.kind === "generation.revision"
        && isRecord(record.value.revision) && record.value.revision.id === revision.id);
      if (storedRevision) storedRevision.value.revision = structuredClone(revision);
    }
  }

  report.mappingCounts = {
    targets: targets.length,
    assets: assets.length,
    drawings: drawings.length,
    figures: figureRows.reduce((total, row) => total + row.revision.entries.length, 0),
    revisions: revisionRecords.length,
    parties: sourceSnapshot?.parties.length ?? 0,
    facts: sourceSnapshot?.facts.length ?? 0,
    sourceRecords: records.filter((record) => record.kind === "parse.source").length,
    legacyReviews: legacyReviews.length,
  };
  report.incomplete = report.missingBytes.length > 0 || report.unconvertible.length > 0 || report.unknownVersions.length > 0;
  report.assetCount = assets.length;
  report.generatedAt = now;
  report.access = options.access;

  const packageId = await derivedId(`v6/recovery/package/${actor.tenantId}/${actor.userId}/${matterId}/${now}/${report.assetCount}`);
  const body: RecoveryPackage = {
    schemaVersion: RECOVERY_SCHEMA_VERSION,
    packageId,
    sourceMatterId: matterId,
    sourceTenantId: actor.tenantId,
    sourceActorId: actor.userId,
    createdAt: now,
    access: options.access,
    source: {
      title: aggregate.matter.title,
      sourceVersion,
      targetCount: targets.length,
      assetCount: assets.length,
    },
    assets,
    assetManifest: assets,
    targets,
    figureRefs,
    records,
    sourceSnapshot,
    legacyReviews,
    migrationReport: report,
  };
  const payloadBytes = new TextEncoder().encode(JSON.stringify(body));
  if (assets.length > RECOVERY_MAX_ASSETS || payloadBytes.byteLength > RECOVERY_MAX_PACKAGE_BYTES) {
    throw new RecoveryError("IMPORT_INVALID", "恢复包超过资产条目或 256 MiB 预算；未生成文件。");
  }
  try {
    return await buildPatentPack(body, options.passphrase);
  } catch {
    throw new RecoveryError("STORAGE_UNAVAILABLE", "恢复包加密失败；未写入任何案件数据。");
  }
}

function emptyPackageReport(context: PackageBuildContext): {
  generatedAt: string;
  access: RecoveryAccess;
  assetCount: number;
  missingBytes: { assetId: string; originalName: string; sha256: string }[];
  omittedGeneratedContent: { revisionId: string; paragraphId: string; section: string; reason: "PREVIEW_SCOPE" | "GENERATED_CONTENT" }[];
  legacyUnverified: RecoveryLegacyReview[];
  unknownVersions: { ref: string; version: string }[];
  unconvertible: { ref: string; reason: string }[];
  incomplete: boolean;
  mappingCounts: Record<string, number>;
} {
  return {
    generatedAt: context.now,
    access: context.access,
    assetCount: 0,
    missingBytes: [],
    omittedGeneratedContent: [],
    legacyUnverified: [],
    unknownVersions: [],
    unconvertible: [],
    incomplete: false,
    mappingCounts: {},
  };
}

async function buildAssets(
  context: PackageBuildContext,
  report: ReturnType<typeof emptyPackageReport>,
): Promise<RecoveryAsset[]> {
  const output: RecoveryAsset[] = [];
  const seen = new Set<string>();
  for (const asset of context.aggregate.assets) {
    if (asset.tenantId !== context.matter.tenantId || seen.has(asset.id)) continue;
    seen.add(asset.id);
    const name = safeName(asset.originalName);
    if (name === null) {
      report.unconvertible.push({ ref: `asset:${asset.id}`, reason: "INVALID_PATH" });
      continue;
    }
    const row = context.rows.find((candidate) => isRecord(candidate)
      && isRecord(candidate.asset) && candidate.asset.id === asset.id);
    let bytes: Uint8Array | null = null;
    if (isRecord(row) && row.bytes instanceof Uint8Array && row.tenantId === context.matter.tenantId) {
      const candidate = row.bytes;
      const digest = await sha256Hex(candidate);
      if (digest === asset.sha256 && candidate.byteLength === asset.byteLength && candidate.byteLength <= RECOVERY_MAX_ASSET_BYTES) {
        bytes = new Uint8Array(candidate);
      }
    }
    if (bytes === null) {
      report.missingBytes.push({ assetId: asset.id, originalName: name, sha256: asset.sha256 });
      output.push({
        id: asset.id,
        purpose: asset.purpose,
        originalName: name,
        mime: asset.mime,
        byteLength: asset.byteLength,
        sha256: asset.sha256,
        state: "missing_bytes",
        base64: null,
      });
      continue;
    }
    if (!magicMatches(asset.mime, bytes) && (asset.mime === "image/png" || asset.mime === "image/jpeg")) {
      report.unconvertible.push({ ref: `asset:${asset.id}`, reason: "MIME_MISMATCH" });
      report.missingBytes.push({ assetId: asset.id, originalName: name, sha256: asset.sha256 });
      output.push({
        id: asset.id,
        purpose: asset.purpose,
        originalName: name,
        mime: asset.mime,
        byteLength: asset.byteLength,
        sha256: asset.sha256,
        state: "missing_bytes",
        base64: null,
      });
      continue;
    }
    output.push({
      id: asset.id,
      purpose: asset.purpose,
      originalName: name,
      mime: asset.mime,
      byteLength: bytes.byteLength,
      sha256: asset.sha256,
      state: "available",
      base64: bytesToBase64(bytes),
    });
  }
  return output.sort((left, right) => left.id.localeCompare(right.id));
}

async function buildTargets(context: PackageBuildContext): Promise<RecoveryTarget[]> {
  const output: RecoveryTarget[] = [];
  const configByTarget = new Map<string, TargetConfig>();
  for (const row of context.rows) {
    const config = targetConfigFromRow(row);
    if (!config || !isRecord(row) || row.matterId !== context.matter.id) continue;
    const target = context.aggregate.targets.find((item) => item.id === config.targetId);
    if (!target || config.version !== target.configVersion) continue;
    configByTarget.set(config.targetId, config);
  }
  for (const target of context.aggregate.targets) {
    output.push({
      id: target.id,
      status: target.status,
      configVersion: target.configVersion,
      draftRevisionId: target.draftRevisionId,
      figureRevisionId: target.figureRevisionId,
      config: configByTarget.get(target.id) ?? null,
    });
  }
  return output;
}

function collectTargetConfigRecords(
  rows: readonly unknown[],
  context: PackageBuildContext,
  targets: readonly RecoveryTarget[],
  records: RecoveryRecord[],
): void {
  const wanted = new Set(targets.map((target) => target.id));
  for (const row of rows) {
    const config = targetConfigFromRow(row);
    if (!config || !isRecord(row) || row.matterId !== context.matter.id) continue;
    if (!wanted.has(config.targetId)) continue;
    records.push({ kind: "target.config", value: structuredClone(row) });
  }
}

function collectParseRecords(
  rows: readonly unknown[],
  context: PackageBuildContext,
  records: RecoveryRecord[],
  report: ReturnType<typeof emptyPackageReport>,
): void {
  const sourceRows = rows.filter((row) => isRecord(row) && row.kind === "parse.source" && isRecord(row.source)
    && row.source.matterId === context.matter.id);
  const sourceIds = new Set(sourceRows.map((row) => String((row as { source: { id: unknown } }).source.id)));
  for (const row of sourceRows) records.push({ kind: "parse.source", value: structuredClone(row as Record<string, unknown>) });
  for (const row of rows) {
    if (!isRecord(row) || row.kind !== "parse.chunks" || !isText(row.sourceId) || !sourceIds.has(row.sourceId)) continue;
    if (!Array.isArray(row.chunks)) {
      report.unconvertible.push({ ref: `parse.chunks:${row.sourceId}`, reason: "MALFORMED_CHUNKS" });
      continue;
    }
    records.push({ kind: "parse.chunks", value: structuredClone(row) });
  }
}

function collectRevisionRecords(
  rows: readonly unknown[],
  context: PackageBuildContext,
  records: RecoveryRecord[],
  report: ReturnType<typeof emptyPackageReport>,
): DraftRevision[] {
  const revisions: DraftRevision[] = [];
  for (const row of rows) {
    if (!isGenerationRevisionRow(row) || row.matterId !== context.matter.id || row.tenantId !== context.matter.tenantId) continue;
    const parsed = row.revision;
    if (context.access === "preview") {
      const head = context.aggregate.targets.find((target) => target.id === row.targetId)?.draftRevisionId;
      if (head !== null && head !== undefined && parsed.id !== head) {
        report.omittedGeneratedContent.push({
          revisionId: parsed.id,
          paragraphId: "revision",
          section: "revision_history",
          reason: "PREVIEW_SCOPE",
        });
        continue;
      }
    }
    if (!isRecord(parsed.ast) || parsed.ast.schemaVersion !== "draft.v1") {
      report.unknownVersions.push({ ref: `revision:${parsed.id}`, version: String((parsed.ast as { schemaVersion?: unknown })?.schemaVersion ?? "unknown") });
      report.unconvertible.push({ ref: `revision:${parsed.id}`, reason: "UNKNOWN_AST_VERSION" });
      continue;
    }
    if (!draftAstSchema.safeParse(parsed.ast).success) {
      report.unconvertible.push({ ref: `revision:${parsed.id}`, reason: "INVALID_AST" });
      continue;
    }
    records.push({
      kind: "generation.revision",
      value: { kind: "generation.revision", tenantId: row.tenantId, actorId: row.actorId, matterId: row.matterId, targetId: row.targetId, revision: structuredClone(parsed) },
    });
    revisions.push(structuredClone(parsed));
  }
  return revisions;
}

function collectIntakeRecords(
  rows: readonly unknown[],
  context: PackageBuildContext,
  records: RecoveryRecord[],
  report: ReturnType<typeof emptyPackageReport>,
): void {
  for (const row of rows) {
    if (!isRecord(row)) continue;
    if (row.kind === "intake.snapshot" && isRecord(row.snapshot) && row.snapshot.matterId === context.matter.id
      && row.snapshot.version === context.matter.sourceVersion) {
      records.push({ kind: "intake.snapshot", value: structuredClone(row) });
    } else if (row.kind === "intake.drafts" && row.matterId === context.matter.id) {
      records.push({ kind: "intake.drafts", value: structuredClone(row) });
    } else if (row.kind === "intake.candidates" && row.matterId === context.matter.id && context.access !== "preview") {
      records.push({ kind: "intake.candidates", value: structuredClone(row) });
    }
  }
  if (context.access === "preview") {
    const candidate = rows.find((row) => isRecord(row) && row.kind === "intake.candidates" && row.matterId === context.matter.id);
    if (candidate) {
      report.omittedGeneratedContent.push({
        revisionId: "intake.candidates",
        paragraphId: "candidates",
        section: "extract_candidates",
        reason: "GENERATED_CONTENT",
      });
    }
  }
}

function buildFigureRefs(
  figureRows: readonly StoredFigureSetRow[],
  drawings: readonly StoredDrawingRow[],
  assetById: ReadonlyMap<string, RecoveryAsset>,
): RecoveryFigureRef[] {
  const drawingById = new Map(drawings.map((row) => [row.drawing.id, row.drawing]));
  const output: RecoveryFigureRef[] = [];
  for (const row of figureRows) {
    for (const entry of figureEntries(row.revision.entries)) {
      const drawing = entry.drawingId === null ? undefined : drawingById.get(entry.drawingId);
      const asset = drawing ? assetById.get(drawing.assetId) : undefined;
      output.push({
        figureId: entry.figureId,
        number: entry.number,
        title: entry.title,
        drawingId: entry.drawingId,
        drawingAssetId: drawing?.assetId ?? null,
        sha256: asset?.sha256 ?? null,
        figureRevisionId: row.revision.id,
      });
    }
  }
  return output;
}

function collectLegacyReviews(
  rows: readonly unknown[],
  context: PackageBuildContext,
  report: ReturnType<typeof emptyPackageReport>,
): RecoveryLegacyReview[] {
  const output: RecoveryLegacyReview[] = [];
  for (const row of rows) {
    if (!isRecord(row)) continue;
    if (row.kind === "draft-review.confirmations" && row.matterId === context.matter.id && isRecord(row.ledger)) {
      const confirmations = Array.isArray(row.ledger.confirmations) ? row.ledger.confirmations : [];
      for (const confirmation of confirmations) {
        if (!isRecord(confirmation)) continue;
        output.push({
          id: String(confirmation.id ?? "legacy-review"),
          kind: String(confirmation.kind ?? "legacy_review"),
          identity: "legacy_unverified",
          recordedAt: typeof confirmation.createdAt === "string" ? confirmation.createdAt : null,
        });
      }
    }
    if (row.kind === "recovery.legacy_review" && row.matterId === context.matter.id) {
      output.push({
        id: String(row.legacyReviewId ?? "legacy-review"),
        kind: String(row.itemKind ?? "legacy_review"),
        identity: "legacy_unverified",
        recordedAt: typeof row.recordedAt === "string" ? row.recordedAt : null,
      });
    }
  }
  report.legacyUnverified = output;
  return output;
}

async function buildSourceSnapshot(
  context: PackageBuildContext,
  report: ReturnType<typeof emptyPackageReport>,
): Promise<SourceSnapshot | null> {
  const row = context.rows.find((candidate) => isRecord(candidate) && candidate.kind === "intake.snapshot"
    && isRecord(candidate.snapshot) && candidate.snapshot.matterId === context.matter.id
    && candidate.snapshot.version === context.matter.sourceVersion) as Record<string, unknown> | undefined;
  if (!row || !isRecord(row.snapshot)) return null;
  const parsed = sourceSnapshotSchema.safeParse(row.snapshot);
  if (!parsed.success) {
    report.unconvertible.push({ ref: "intake.snapshot", reason: "INVALID_SNAPSHOT" });
    return null;
  }
  return structuredClone(parsed.data);
}

function trimRevisionForPreview(revision: DraftRevision, report: ReturnType<typeof emptyPackageReport>): void {
  const ast = revision.ast;
  const keepSections = new Set(["technical_field", "background"]);
  for (const section of ast.sections) {
    if (keepSections.has(section.kind)) continue;
    for (const paragraph of section.paragraphs) {
      report.omittedGeneratedContent.push({
        revisionId: revision.id,
        paragraphId: paragraph.id,
        section: section.kind,
        reason: "PREVIEW_SCOPE",
      });
    }
    section.paragraphs = [];
  }
  const allParagraphs = [
    ...ast.claims.flatMap((claim) => claim.paragraphs),
    ...ast.sections.flatMap((section) => section.paragraphs),
  ];
  for (const paragraph of allParagraphs) {
    if (paragraph.origin === "ai" || paragraph.origin === "mixed") {
      paragraph.sourceRefs = [];
      paragraph.generationJobId = null;
    }
  }
}

/** Decrypt and dry-run validation. Nothing is written when the package is bad. */
export async function validateRecoveryPackage(
  repository: LocalRepository,
  actor: Actor,
  bytes: Uint8Array,
  passphrase: string,
  options: RecoveryClockOptions = {},
): Promise<RecoveryResult<ValidatedRecovery>> {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) {
    return failure("INVALID_INPUT", "请选择加密恢复包。");
  }
  if (!isText(passphrase)) return failure("INVALID_INPUT", "请输入恢复包口令。");
  if (bytes.byteLength > RECOVERY_MAX_PACKAGE_BYTES) {
    return failure("IMPORT_INVALID", "恢复包超过 256 MiB 预算，未读取任何案件数据。");
  }
  let opened: unknown;
  try {
    opened = await openPatentPack(bytes, passphrase);
  } catch {
    return failure("RECOVERY_DECRYPT_FAILED", "无法解密恢复包：口令错误，或备份包已被篡改。未写入任何数据。");
  }
  const packageHash = await sha256Hex(bytes);
  return validatePackageObject(repository, actor, opened, packageHash, options.now ?? defaultNow);
}

async function validatePackageObject(
  repository: LocalRepository,
  actor: Actor,
  value: unknown,
  packageHash: string,
  now: () => string,
): Promise<RecoveryResult<ValidatedRecovery>> {
  if (!isRecord(value)) return failure("IMPORT_INVALID", "恢复包内容不是 JSON 对象。");
  const schemaVersion = value.schemaVersion;
  if (schemaVersion !== RECOVERY_SCHEMA_VERSION) {
    return {
      ok: false,
      error: { code: "IMPORT_INVALID", message: "恢复包版本不受支持，未写入任何数据。" },
      report: unsupportedVersionReport(value),
    };
  }
  if (!isUuid(value.packageId) || !isUuid(value.sourceMatterId) || !isIso(value.createdAt)
    || !["local_unmetered", "preview", "full"].includes(String(value.access))
    || !isRecord(value.source) || !Array.isArray(value.assets) || !Array.isArray(value.targets)
    || !Array.isArray(value.figureRefs) || !Array.isArray(value.records) || !Array.isArray(value.legacyReviews)
    || !isRecord(value.migrationReport)) {
    return failure("IMPORT_INVALID", "恢复包结构无效，未写入任何数据。");
  }
  const pkg = value as unknown as RecoveryPackage;
  const report = emptyValidationReport(pkg);
  if (pkg.assets.length > RECOVERY_MAX_ASSETS || pkg.records.length > RECOVERY_MAX_RECORDS) {
    return { ok: false, error: { code: "IMPORT_INVALID", message: "恢复包条目超过预算，未写入任何数据。" }, report };
  }
  const assetIds = new Set<string>();
  let totalBytes = 0;
  const available = new Map<string, Uint8Array>();
  let blocking = false;
  for (const asset of pkg.assets) {
    if (!isRecord(asset) || !isUuid(asset.id) || assetIds.has(asset.id)
      || !["source", "drawing", "receipt", "review_attachment", "service_attachment", "export"].includes(String(asset.purpose))
      || !isSha(asset.sha256) || !Number.isSafeInteger(asset.byteLength) || asset.byteLength < 0
      || (asset.state !== "available" && asset.state !== "missing_bytes")) {
      blocking = true;
      report.unconvertible.push(issue("INVALID_ASSET", "asset", "asset record is malformed"));
      continue;
    }
    assetIds.add(asset.id);
    const name = safeName(asset.originalName);
    if (name === null) {
      blocking = true;
      report.unconvertible.push(issue("INVALID_PATH", `asset:${asset.id}`, "asset name is not a plain file name"));
      continue;
    }
    if (asset.byteLength > RECOVERY_MAX_ASSET_BYTES) {
      blocking = true;
      report.unconvertible.push(issue("FILE_TOO_LARGE", `asset:${asset.id}`, "asset exceeds the 50 MiB budget"));
      continue;
    }
    if (asset.state === "missing_bytes") {
      report.missingBytes.push({ assetId: asset.id, originalName: name, sha256: asset.sha256, state: "missing_bytes" });
      continue;
    }
    if (typeof asset.base64 !== "string") {
      blocking = true;
      report.unconvertible.push(issue("INVALID_ASSET", `asset:${asset.id}`, "available asset has no bytes"));
      continue;
    }
    let bytes: Uint8Array;
    try {
      bytes = base64ToBytes(asset.base64);
    } catch {
      blocking = true;
      report.unconvertible.push(issue("INVALID_ASSET", `asset:${asset.id}`, "asset bytes are not base64"));
      continue;
    }
    if (bytes.byteLength !== asset.byteLength) {
      blocking = true;
      report.unconvertible.push(issue("HASH_MISMATCH", `asset:${asset.id}`, "asset length does not match its record"));
      continue;
    }
    if ((await sha256Hex(bytes)) !== asset.sha256) {
      blocking = true;
      report.unconvertible.push(issue("HASH_MISMATCH", `asset:${asset.id}`, "asset bytes do not match their SHA-256"));
      continue;
    }
    if (!magicMatches(asset.mime, bytes)) {
      blocking = true;
      report.unconvertible.push(issue("MIME_MISMATCH", `asset:${asset.id}`, "asset bytes do not match their MIME type"));
      continue;
    }
    totalBytes += bytes.byteLength;
    if (totalBytes > RECOVERY_MAX_PACKAGE_BYTES) {
      blocking = true;
      report.unconvertible.push(issue("FILE_TOO_LARGE", "package", "asset bytes exceed the 256 MiB budget"));
    }
    available.set(asset.id, bytes);
  }

  // A stable figureId legitimately appears in several figure-set revisions
  // when the user changes a title or numerals. Uniqueness is per revision.
  const figureSlots = new Set<string>();
  for (const ref of pkg.figureRefs) {
    if (!isRecord(ref) || !isUuid(ref.figureId) || !isUuid(ref.figureRevisionId)
      || !Number.isSafeInteger(ref.number) || !isText(ref.title)
      || (ref.drawingAssetId !== null && !isUuid(ref.drawingAssetId))) {
      blocking = true;
      report.unconvertible.push(issue("INVALID_REFERENCE", "figure", "figure reference is malformed"));
      continue;
    }
    const slot = `${ref.figureRevisionId}:${ref.figureId}`;
    if (figureSlots.has(slot)) {
      blocking = true;
      report.unconvertible.push(issue("INVALID_REFERENCE", `figure:${ref.figureId}`, "figure id is duplicated inside one figure revision"));
      continue;
    }
    figureSlots.add(slot);
    if (ref.drawingAssetId !== null && !assetIds.has(ref.drawingAssetId)) {
      blocking = true;
      report.unconvertible.push(issue("INVALID_REFERENCE", `figure:${ref.figureId}`, "drawing asset is not listed in the manifest"));
    }
  }

  const targetIds = new Set<string>();
  for (const target of pkg.targets) {
    if (!isRecord(target) || !isUuid(target.id) || targetIds.has(target.id)
      || (target.status !== "active" && target.status !== "archived")
      || !Number.isSafeInteger(target.configVersion) || target.configVersion < 1
      || !isUuid(target.figureRevisionId)
      || (target.draftRevisionId !== null && !isUuid(target.draftRevisionId))) {
      blocking = true;
      report.unconvertible.push(issue("INVALID_REFERENCE", "target", "target is malformed"));
      continue;
    }
    targetIds.add(target.id);
    if (target.config !== null) {
      const parsedConfig = targetConfigSchema.safeParse(target.config);
      if (!parsedConfig.success || parsedConfig.data.targetId !== target.id) {
        blocking = true;
        report.unconvertible.push(issue("INVALID_REFERENCE", `target:${target.id}`, "target config does not belong to the target"));
      }
      const evidence = parsedConfig.success && Array.isArray(parsedConfig.data.priorityClaims)
        ? parsedConfig.data.priorityClaims
        : [];
      for (const claim of evidence) {
        if (isRecord(claim) && claim.evidenceAssetId !== null && isText(claim.evidenceAssetId) && !assetIds.has(claim.evidenceAssetId)) {
          blocking = true;
          report.unconvertible.push(issue("INVALID_REFERENCE", `target:${target.id}`, "priority evidence asset is not in the package"));
        }
      }
    }
  }

  for (const record of pkg.records) {
    if (!isRecord(record) || !isText(record.kind) || !isRecord(record.value)) {
      blocking = true;
      report.unconvertible.push(issue("INVALID_RECORD", "record", "record is malformed"));
      continue;
    }
    if (record.kind === "generation.revision") {
      const revision = record.value.revision;
      if (!isRecord(revision) || !isRecord(revision.ast)) {
        blocking = true;
        report.unconvertible.push(issue("INVALID_AST", "revision", "draft revision is missing"));
        continue;
      }
      if (revision.ast.schemaVersion !== "draft.v1") {
        blocking = true;
        report.unknownVersions.push({ ref: `revision:${String(revision.id ?? "unknown")}`, version: String(revision.ast.schemaVersion) });
        report.unconvertible.push(issue("UNKNOWN_VERSION", `revision:${String(revision.id ?? "unknown")}`, "draft AST version is unknown"));
        continue;
      }
      if (!draftAstSchema.safeParse(revision.ast).success) {
        blocking = true;
        report.unconvertible.push(issue("INVALID_AST", `revision:${String(revision.id ?? "unknown")}`, "draft AST is invalid"));
      }
    }
    if (record.kind === "parse.source" && !isRecord(record.value.source)) {
      report.unconvertible.push(issue("INVALID_RECORD", "parse.source", "source row is malformed"));
    }
    if (record.kind === "parse.chunks" && !Array.isArray(record.value.chunks)) {
      report.unconvertible.push(issue("INVALID_RECORD", "parse.chunks", "chunk row is malformed"));
    }
  }

  if (pkg.sourceSnapshot !== null) {
    const parsed = sourceSnapshotSchema.safeParse(pkg.sourceSnapshot);
    if (!parsed.success || parsed.data.matterId !== pkg.sourceMatterId) {
      blocking = true;
      report.unconvertible.push(issue("INVALID_SNAPSHOT", "intake.snapshot", "source snapshot is invalid"));
    }
  }

  const legacyReviews: RecoveryLegacyReview[] = [];
  for (const review of pkg.legacyReviews) {
    if (!isRecord(review) || !isText(review.id) || !isText(review.kind)) {
      report.unconvertible.push(issue("INVALID_RECORD", "legacy_review", "legacy review is malformed"));
      continue;
    }
    legacyReviews.push({ id: review.id, kind: review.kind, identity: "legacy_unverified", recordedAt: isIso(review.recordedAt) ? review.recordedAt : null });
  }
  report.legacyUnverified = legacyReviews;

  const omitted = Array.isArray(pkg.migrationReport.omittedGeneratedContent)
    ? pkg.migrationReport.omittedGeneratedContent.filter(isRecord).map((entry) => ({
        revisionId: String(entry.revisionId ?? ""),
        paragraphId: String(entry.paragraphId ?? ""),
        section: String(entry.section ?? ""),
        reason: entry.reason === "GENERATED_CONTENT" ? "GENERATED_CONTENT" as const : "PREVIEW_SCOPE" as const,
      }))
    : [];
  report.omittedGeneratedContent = omitted;
  report.incomplete = report.missingBytes.length > 0 || report.unconvertible.length > 0 || report.unknownVersions.length > 0 || omitted.length > 0;
  report.mappingCounts = countMappings(pkg);
  report.canCommit = !blocking;

  if (!report.canCommit) {
    return {
      ok: false,
      error: { code: "IMPORT_INVALID", message: "恢复包未通过路径、预算、引用或哈希校验；未写入任何案件数据。" },
      report,
    };
  }

  const validationId = await derivedId(`v6/recovery/validation/${actor.tenantId}/${actor.userId}/${packageHash}`);
  const plannedMatterId = await derivedId(`v6/recovery/matter/${actor.tenantId}/${actor.userId}/${validationId}`);
  report.validationId = validationId;
  report.packageId = pkg.packageId;
  report.sourceMatterId = pkg.sourceMatterId;
  report.access = pkg.access;
  // Re-validating an already committed package must not recreate a decrypted
  // payload row; the existing package-free marker is enough for replay.
  try {
    const marker = await repository.backend.transaction("readonly", (tx) =>
      tx.get(STORES.blobs, rowKeyForCommit(actor, validationId)));
    if (isStoredCommit(marker) && marker.tenantId === actor.tenantId && marker.actorId === actor.userId) {
      return {
        ok: true,
        data: {
          validationId,
          packageHash,
          packageId: pkg.packageId,
          sourceMatterId: pkg.sourceMatterId,
          plannedMatterId,
          canCommit: true,
          report,
        },
      };
    }
  } catch {
    return failure("STORAGE_UNAVAILABLE", "无法读取本机提交标记；未写入任何数据。");
  }
  const createdAt = now();
  const expiresAtMs = Date.parse(createdAt) + RECOVERY_VALIDATION_TTL_MS;
  if (!Number.isFinite(expiresAtMs)) return failure("INVALID_INPUT", "校验时钟无效；未写入任何数据。");
  const expiresAt = new Date(expiresAtMs).toISOString();
  await cleanupExpiredValidations(repository, actor, createdAt);
  const row: StoredValidation = {
    kind: "recovery.validation",
    tenantId: actor.tenantId,
    actorId: actor.userId,
    validationId,
    packageHash,
    payloadHash: await sha256Hex(new TextEncoder().encode(canonicalJson(pkg))),
    package: structuredClone(pkg),
    sourceMatterId: pkg.sourceMatterId,
    plannedMatterId,
    status: "validated",
    matterId: null,
    report,
    createdAt,
    expiresAt,
  };
  try {
    await repository.backend.transaction("readwrite", async (tx) => {
      const existing = await tx.get(STORES.blobs, rowKeyForValidation(actor, validationId));
      if (isStoredValidation(existing) && !isExpired(existing, createdAt)) return;
      await tx.put(STORES.blobs, rowKeyForValidation(actor, validationId), row);
    });
  } catch {
    return failure("STORAGE_UNAVAILABLE", "无法保存校验结果；请重试，尚未创建案件。");
  }
  return {
    ok: true,
    data: {
      validationId,
      packageHash,
      packageId: pkg.packageId,
      sourceMatterId: pkg.sourceMatterId,
      plannedMatterId,
      canCommit: true,
      report,
    },
  };
}

function unsupportedVersionReport(value: Record<string, unknown>): MigrationReport {
  return {
    validationId: "",
    packageId: isUuid(value.packageId) ? value.packageId : "",
    sourceMatterId: isUuid(value.sourceMatterId) ? value.sourceMatterId : "",
    access: "preview",
    canCommit: false,
    incomplete: true,
    mappingCounts: {},
    missingBytes: [],
    unknownVersions: [{ ref: "recovery", version: String(value.schemaVersion ?? "unknown") }],
    unconvertible: [{ code: "UNKNOWN_VERSION", ref: "recovery", reason: "recovery package version is not supported" }],
    omittedGeneratedContent: [],
    legacyUnverified: [],
  };
}

type MutableMigrationReport = {
  -readonly [K in keyof MigrationReport]: MigrationReport[K] extends readonly (infer T)[] ? T[] : MigrationReport[K];
};

function emptyValidationReport(pkg: RecoveryPackage): MutableMigrationReport {
  return {
    validationId: "",
    packageId: pkg.packageId,
    sourceMatterId: pkg.sourceMatterId,
    access: pkg.access,
    canCommit: false,
    incomplete: false,
    mappingCounts: {},
    missingBytes: [],
    unknownVersions: [],
    unconvertible: [],
    omittedGeneratedContent: [],
    legacyUnverified: [],
  };
}

function issue(code: string, ref: string, reason: string): MigrationIssue {
  return { code, ref, reason };
}

function countMappings(pkg: RecoveryPackage): Record<string, number> {
  return {
    targets: pkg.targets.length,
    assets: pkg.assets.length,
    drawings: pkg.records.filter((record) => record.kind === "drawings.drawing").length,
    figures: pkg.figureRefs.length,
    revisions: pkg.records.filter((record) => record.kind === "generation.revision").length,
    parties: pkg.sourceSnapshot?.parties.length ?? 0,
    facts: pkg.sourceSnapshot?.facts.length ?? 0,
    sourceRecords: pkg.records.filter((record) => record.kind === "parse.source").length,
    legacyReviews: pkg.legacyReviews.length,
  };
}

function failure(code: RecoveryErrorCode, message: string): { ok: false; error: RecoveryFailure } {
  return { ok: false, error: { code, message } };
}

function isStoredValidation(value: unknown): value is StoredValidation {
  return isRecord(value) && value.kind === "recovery.validation" && isText(value.validationId)
    && isText(value.payloadHash) && isText(value.expiresAt) && value.status === "validated"
    && isRecord(value.package) && isRecord(value.report);
}

function isStoredCommit(value: unknown): value is StoredCommit {
  return isRecord(value) && value.kind === "recovery.commit" && isText(value.validationId)
    && isText(value.matterId) && isRecord(value.report) && isText(value.committedAt);
}

/** Read a persisted validation/commit result; used by refresh and retry. */
export async function readRecoveryValidation(
  repository: LocalRepository,
  actor: Actor,
  validationId: string,
  options: RecoveryClockOptions = {},
): Promise<RecoveryResult<RecoveryValidationView>> {
  if (!isUuid(validationId)) return failure("INVALID_INPUT", "校验编号无效。");
  const now = (options.now ?? defaultNow)();
  let commitRow: unknown;
  let validationRow: unknown;
  try {
    const rows = await repository.backend.transaction("readonly", async (tx) => ({
      commit: await tx.get(STORES.blobs, rowKeyForCommit(actor, validationId)),
      validation: await tx.get(STORES.blobs, rowKeyForValidation(actor, validationId)),
    }));
    commitRow = rows.commit;
    validationRow = rows.validation;
  } catch {
    return failure("STORAGE_UNAVAILABLE", "无法读取本机校验记录。");
  }
  if (isStoredCommit(commitRow) && commitRow.tenantId === actor.tenantId && commitRow.actorId === actor.userId) {
    return {
      ok: true,
      data: {
        validationId: commitRow.validationId,
        packageId: commitRow.report.packageId,
        sourceMatterId: commitRow.report.sourceMatterId,
        plannedMatterId: commitRow.matterId,
        status: "committed",
        matterId: commitRow.matterId,
        canCommit: true,
        report: structuredClone(commitRow.report),
        createdAt: commitRow.committedAt,
        committedAt: commitRow.committedAt,
      },
    };
  }
  if (!isStoredValidation(validationRow) || validationRow.tenantId !== actor.tenantId || validationRow.actorId !== actor.userId) {
    return failure("RESOURCE_NOT_FOUND", "校验记录不存在。");
  }
  if (isExpired(validationRow, now)) {
    await cleanupExpiredValidations(repository, actor, now);
    return failure("RESOURCE_NOT_FOUND", "校验已过期，解密内容已清理；请重新校验恢复包。");
  }
  return {
    ok: true,
    data: {
      validationId: validationRow.validationId,
      packageId: validationRow.report.packageId,
      sourceMatterId: validationRow.sourceMatterId,
      plannedMatterId: validationRow.plannedMatterId,
      status: "validated",
      matterId: null,
      canCommit: validationRow.report.canCommit,
      report: structuredClone(validationRow.report),
      createdAt: validationRow.createdAt,
      committedAt: null,
    },
  };
}

/**
 * Commit one validated package into one new matter. Every write is in one
 * transaction; a committed validationId replays its matter id. A successful
 * commit deletes the decrypted validation row and leaves only a small commit
 * marker with ids and the report (no package bytes, AST, chunks, passphrase or
 * key). A validated row is usable for RECOVERY_VALIDATION_TTL_MS only.
 */
export async function commitRecoveryImport(
  repository: LocalRepository,
  actor: Actor,
  validationId: string,
  options: RecoveryClockOptions = {},
): Promise<RecoveryResult<RecoveryCommitResult>> {
  if (!isUuid(validationId)) return failure("INVALID_INPUT", "校验编号无效。");
  const now = (options.now ?? defaultNow)();
  let commitRow: unknown;
  let row: unknown;
  try {
    const rows = await repository.backend.transaction("readonly", async (tx) => ({
      commit: await tx.get(STORES.blobs, rowKeyForCommit(actor, validationId)),
      validation: await tx.get(STORES.blobs, rowKeyForValidation(actor, validationId)),
    }));
    commitRow = rows.commit;
    row = rows.validation;
  } catch {
    return failure("STORAGE_UNAVAILABLE", "无法读取本机校验记录。");
  }
  if (isStoredCommit(commitRow) && commitRow.tenantId === actor.tenantId && commitRow.actorId === actor.userId) {
    return { ok: true, data: { validationId, matterId: commitRow.matterId, replayed: true, report: structuredClone(commitRow.report) } };
  }
  if (!isStoredValidation(row) || row.tenantId !== actor.tenantId || row.actorId !== actor.userId) {
    return failure("RESOURCE_NOT_FOUND", "校验记录不存在。");
  }
  if (isExpired(row, now)) {
    await cleanupExpiredValidations(repository, actor, now);
    return failure("RESOURCE_NOT_FOUND", "校验已过期，解密内容已清理；请重新校验恢复包。");
  }
  if (!row.report.canCommit) {
    return { ok: false, error: { code: "IMPORT_INVALID", message: "恢复包未通过校验，不能提交。" }, report: structuredClone(row.report) };
  }
  if ((await sha256Hex(new TextEncoder().encode(canonicalJson(row.package)))) !== row.payloadHash) {
    return failure("IMPORT_INVALID", "本机校验记录与原始包不一致；未写入任何案件。");
  }
  let plan: ImportPlan;
  try {
    plan = await buildImportPlan(actor, row, now);
  } catch (error) {
    return failure("IMPORT_INVALID", error instanceof RecoveryError ? error.message : "恢复包无法转换；未写入任何案件。");
  }
  let replayed = false;
  try {
    await repository.backend.transaction("readwrite", async (tx) => {
      const commit = await tx.get(STORES.blobs, rowKeyForCommit(actor, validationId));
      if (isStoredCommit(commit) && commit.tenantId === actor.tenantId && commit.actorId === actor.userId) {
        replayed = true;
        return;
      }
      const current = await tx.get(STORES.blobs, rowKeyForValidation(actor, validationId));
      if (!isStoredValidation(current) || current.tenantId !== actor.tenantId || current.actorId !== actor.userId) {
        throw new RecoveryError("RESOURCE_NOT_FOUND", "校验记录已不可用。");
      }
      if (isExpired(current, now)) {
        await tx.delete(STORES.blobs, rowKeyForValidation(actor, validationId));
        throw new RecoveryError("RESOURCE_NOT_FOUND", "校验已过期，解密内容已清理；未写入任何数据。");
      }
      const existingMatter = await tx.get(STORES.matters, plan.matter.id);
      if (existingMatter !== undefined) {
        // A different validation must never reuse a planned matter id.
        throw new RecoveryError("VERSION_CONFLICT", "目标案件编号已被占用；未写入任何数据。");
      }
      await tx.put(STORES.matters, plan.matter.id, {
        matter: structuredClone(plan.matter),
        targets: structuredClone(plan.targets),
        assets: structuredClone(plan.assets),
      });
      for (const event of plan.events) await tx.put(STORES.events, event.id, structuredClone(event));
      for (const blob of plan.blobs) {
        const asset = plan.assets.find((item) => item.id === blob.assetId);
        if (!asset) throw new RecoveryError("INVALID_INPUT", "恢复包资产引用无效。");
        await tx.put(STORES.blobs, blob.assetId, {
          asset: structuredClone(asset),
          matterId: plan.matter.id,
          tenantId: actor.tenantId,
          sha256: blob.sha256,
          byteLength: blob.byteLength,
          bytes: new Uint8Array(blob.bytes),
        });
      }
      for (const write of plan.rows) await tx.put(STORES.blobs, write.key, structuredClone(write.value));
      // The decrypted validation row is removed in the same transaction that
      // commits the case. Only this metadata-only marker remains for replay.
      await tx.delete(STORES.blobs, rowKeyForValidation(actor, validationId));
      await tx.put(STORES.blobs, rowKeyForCommit(actor, validationId), {
        kind: "recovery.commit",
        tenantId: actor.tenantId,
        actorId: actor.userId,
        validationId,
        matterId: plan.matter.id,
        report: plan.report,
        committedAt: plan.createdAt,
      } satisfies StoredCommit);
    });
  } catch (error) {
    if (error instanceof RecoveryError) {
      return failure(error.code, error.message);
    }
    return failure("STORAGE_UNAVAILABLE", "导入事务未完成；未创建半个案件，请重试。");
  }
  // If another tab committed first, its marker is the authoritative result.
  if (replayed) {
    const marker = await repository.backend.transaction("readonly", (tx) =>
      tx.get(STORES.blobs, rowKeyForCommit(actor, validationId)));
    if (isStoredCommit(marker) && marker.tenantId === actor.tenantId && marker.actorId === actor.userId) {
      return { ok: true, data: { validationId, matterId: marker.matterId, replayed: true, report: structuredClone(marker.report) } };
    }
  }
  return { ok: true, data: { validationId, matterId: plan.matter.id, replayed, report: plan.report } };
}

interface ImportPlan {
  matter: MatterRecord;
  targets: TargetRecord[];
  assets: AssetRecord[];
  events: ActivityRecord[];
  blobs: BlobWrite[];
  rows: { key: string; value: unknown }[];
  report: MigrationReport;
  createdAt: string;
}

interface ImportMaps {
  asset: Map<string, string>;
  target: Map<string, string>;
  figure: Map<string, string>;
  drawing: Map<string, string>;
  revision: Map<string, string>;
  party: Map<string, string>;
  fact: Map<string, string>;
  conflict: Map<string, string>;
  source: Map<string, string>;
  /** Old source id -> mapped asset id, so a parse.source row names its asset. */
  sourceAsset: Map<string, string>;
  chunk: Map<string, { id: string; hash: string }>;
  figureSet: Map<string, string>;
}

async function buildImportPlan(actor: Actor, row: StoredValidation, createdAt: string): Promise<ImportPlan> {
  const pkg = row.package;
  const validationId = row.validationId;
  const id = (kind: string, old: string) => derivedId(`v6/recovery/${validationId}/${kind}/${old}`);
  const maps: ImportMaps = {
    asset: new Map(),
    target: new Map(),
    figure: new Map(),
    drawing: new Map(),
    revision: new Map(),
    party: new Map(),
    fact: new Map(),
    conflict: new Map(),
    source: new Map(),
    sourceAsset: new Map(),
    chunk: new Map(),
    figureSet: new Map(),
  };
  for (const asset of pkg.assets) maps.asset.set(asset.id, await id("asset", asset.id));
  for (const target of pkg.targets) maps.target.set(target.id, await id("target", target.id));
  for (const ref of pkg.figureRefs) {
    if (!maps.figure.has(ref.figureId)) maps.figure.set(ref.figureId, await id("figure", ref.figureId));
    if (ref.drawingId !== null && !maps.drawing.has(ref.drawingId)) maps.drawing.set(ref.drawingId, await id("drawing", ref.drawingId));
  }
  for (const record of pkg.records) {
    if (record.kind === "drawings.drawing" && isRecord(record.value.drawing) && isText(record.value.drawing.id)) {
      maps.drawing.set(record.value.drawing.id, await id("drawing", record.value.drawing.id));
    }
  }
  const drawings = new Map<string, Record<string, unknown>>();
  for (const record of pkg.records) {
    if (record.kind === "drawings.drawing" && isRecord(record.value.drawing)) {
      const drawing = record.value.drawing;
      if (isText(drawing.id)) drawings.set(drawing.id, drawing);
    }
  }
  for (const source of pkg.records.filter((record) => record.kind === "parse.source")) {
    if (!isRecord(source.value.source)) continue;
    const oldId = source.value.source.id;
    const oldAsset = source.value.source.assetId;
    if (!isText(oldId) || !isText(oldAsset)) continue;
    const newAsset = maps.asset.get(oldAsset);
    if (!newAsset) continue;
    const newSource = await derivedId(`v6/source/${newAsset}`);
    maps.source.set(oldId, newSource);
    maps.sourceAsset.set(oldId, newAsset);
  }
  const chunkSets = new Map<string, { sourceId: string; parserVersion: string; jobId: string; pageCount: number; createdAt: string; chunks: Record<string, unknown>[] }>();
  for (const record of pkg.records.filter((item) => item.kind === "parse.chunks")) {
    const oldSource = record.value.sourceId;
    const newSource = typeof oldSource === "string" ? maps.source.get(oldSource) : undefined;
    if (!newSource || !Array.isArray(record.value.chunks)) continue;
    const parserVersion = String(record.value.parserVersion ?? "imported");
    const chunks: Record<string, unknown>[] = [];
    for (const [index, chunk] of record.value.chunks.entries()) {
      if (!isRecord(chunk)) continue;
      const text = String(chunk.text ?? "");
      const hash = await sha256Hex(new TextEncoder().encode(text));
      const newChunk = await derivedId(`v6/chunk/${newSource}/${parserVersion}/${index}`);
      maps.chunk.set(String(chunk.id ?? `${oldSource}/${index}`), { id: newChunk, hash });
      chunks.push({
        id: newChunk,
        sourceId: newSource,
        parserVersion,
        index,
        kind: ["paragraph", "table", "image", "ocr_page"].includes(String(chunk.kind)) ? chunk.kind : "paragraph",
        text,
        hash,
        page: Number.isSafeInteger(chunk.page) ? chunk.page : null,
        rect: isRecord(chunk.rect) ? chunk.rect : null,
        ocrConfidence: typeof chunk.ocrConfidence === "number" ? chunk.ocrConfidence : null,
      });
    }
    const newJobId = await derivedId(`v6/recovery/${validationId}/source-job/${oldSource}/${parserVersion}`);
    chunkSets.set(`${newSource}/${parserVersion}`, {
      sourceId: newSource,
      parserVersion,
      jobId: newJobId,
      pageCount: Number.isSafeInteger(record.value.pageCount) ? record.value.pageCount as number : chunks.length,
      createdAt,
      chunks,
    });
  }
  if (isRecord(pkg.sourceSnapshot)) {
    for (const party of pkg.sourceSnapshot.parties) {
      if (isText(party.id)) maps.party.set(party.id, await id("party", party.id));
    }
    for (const fact of pkg.sourceSnapshot.facts) {
      if (isText(fact.id)) maps.fact.set(fact.id, await id("fact", fact.id));
    }
    for (const conflict of pkg.sourceSnapshot.conflicts) {
      if (isText(conflict.id)) maps.conflict.set(conflict.id, await id("conflict", conflict.id));
    }
    for (const inventorId of pkg.sourceSnapshot.answers.inventorIds) {
      if (!maps.party.has(inventorId)) maps.party.set(inventorId, await id("party", inventorId));
    }
  }
  // A target config can name a party that the source snapshot did not carry;
  // it still receives a new local id rather than leaking the old one.
  for (const target of pkg.targets) {
    if (!target.config) continue;
    for (const party of [...target.config.applicantIds, ...target.config.inventorIds]) {
      if (!maps.party.has(party)) maps.party.set(party, await id("party", party));
    }
  }
  for (const record of pkg.records.filter((item) => item.kind === "generation.revision")) {
    const revision = record.value.revision;
    if (isRecord(revision) && isText(revision.id)) maps.revision.set(revision.id, await id("revision", revision.id));
    if (isRecord(revision) && isRecord(revision.ast)) {
      const paragraphs = [
        ...(Array.isArray(revision.ast.claims) ? revision.ast.claims.flatMap((claim) => isRecord(claim) && Array.isArray(claim.paragraphs) ? claim.paragraphs : []) : []),
        ...(Array.isArray(revision.ast.sections) ? revision.ast.sections.flatMap((section) => isRecord(section) && Array.isArray(section.paragraphs) ? section.paragraphs : []) : []),
      ];
      for (const paragraph of paragraphs) {
        if (!isRecord(paragraph)) continue;
        for (const figureId of Array.isArray(paragraph.figureIds) ? paragraph.figureIds : []) {
          if (isText(figureId) && !maps.figure.has(figureId)) maps.figure.set(figureId, await id("figure", figureId));
        }
        for (const factId of Array.isArray(paragraph.factIds) ? paragraph.factIds : []) {
          if (isText(factId) && !maps.fact.has(factId)) maps.fact.set(factId, await id("fact", factId));
        }
      }
    }
  }
  for (const record of pkg.records.filter((item) => item.kind === "figures.set")) {
    const revision = record.value.revision;
    if (isRecord(revision) && isText(revision.id)) maps.figureSet.set(revision.id, await id("figure-set", revision.id));
  }

  const assets: AssetRecord[] = [];
  const blobs: BlobWrite[] = [];
  const importedEvents: ActivityRecord[] = [];
  for (const asset of pkg.assets) {
    const newId = maps.asset.get(asset.id)!;
    const available = asset.state === "available" && typeof asset.base64 === "string";
    const bytes = available ? base64ToBytes(asset.base64 as string) : null;
    assets.push({
      id: newId,
      tenantId: actor.tenantId,
      matterId: row.plannedMatterId,
      serviceOrderId: null,
      purpose: asset.purpose,
      originalName: asset.originalName,
      mime: asset.mime,
      byteLength: asset.byteLength,
      sha256: asset.sha256,
      state: bytes ? "available" : "missing_bytes",
      objectKey: `local/${actor.tenantId}/${row.plannedMatterId}/${newId}`,
      createdAt,
    });
    if (bytes) blobs.push({ assetId: newId, bytes, sha256: asset.sha256, byteLength: bytes.byteLength });
  }

  const rows: { key: string; value: unknown }[] = [];
  const drawingsById = new Map<string, Record<string, unknown>>();
  for (const record of pkg.records) {
    if (record.kind !== "drawings.drawing" || !isRecord(record.value.drawing)) continue;
    const drawing = record.value.drawing;
    const oldDrawingId = isText(drawing.id) ? drawing.id : null;
    const oldAssetId = isText(drawing.assetId) ? drawing.assetId : null;
    if (!oldDrawingId || !oldAssetId) continue;
    const newDrawingId = maps.drawing.get(oldDrawingId);
    const newAssetId = maps.asset.get(oldAssetId);
    if (!newDrawingId || !newAssetId) continue;
    const value = {
      kind: "drawings.drawing",
      tenantId: actor.tenantId,
      matterId: row.plannedMatterId,
      drawing: {
        id: newDrawingId,
        matterId: row.plannedMatterId,
        assetId: newAssetId,
        width: Number(drawing.width),
        height: Number(drawing.height),
        mime: drawing.mime,
        sha256: String(drawing.sha256),
        derivedFromAssetId: typeof drawing.derivedFromAssetId === "string" ? maps.asset.get(drawing.derivedFromAssetId) ?? null : null,
      },
    };
    drawingsById.set(newDrawingId, value);
    rows.push({ key: `${DRAWING_KEY_PREFIX}${newDrawingId}`, value });
  }

  const figureRows: { oldId: string; value: Record<string, unknown> }[] = [];
  for (const record of pkg.records) {
    if (record.kind !== "figures.set" || !isRecord(record.value.revision)) continue;
    const revision = record.value.revision;
    if (!isText(revision.id) || !isText(revision.targetId)) continue;
    const newRevisionId = maps.figureSet.get(revision.id);
    const newTargetId = maps.target.get(revision.targetId);
    if (!newRevisionId || !newTargetId) continue;
    const entries = figureEntries(revision.entries).map((entry) => ({
      figureId: maps.figure.get(entry.figureId) ?? entry.figureId,
      number: entry.number,
      title: entry.title,
      drawingId: entry.drawingId === null ? null : maps.drawing.get(entry.drawingId) ?? null,
      numerals: entry.numerals,
    }));
    const value = {
      kind: "figures.set",
      tenantId: actor.tenantId,
      matterId: row.plannedMatterId,
      revision: {
        id: newRevisionId,
        matterId: row.plannedMatterId,
        targetId: newTargetId,
        parentId: typeof revision.parentId === "string" ? maps.figureSet.get(revision.parentId) ?? null : null,
        entries,
        hash: await figureHash(entries),
        createdAt,
      },
    };
    figureRows.push({ oldId: revision.id, value });
    rows.push({ key: `${FIGURE_KEY_PREFIX}${newTargetId}/${newRevisionId}`, value });
  }

  const targets: TargetRecord[] = [];
  const targetState: Record<string, { figures: Record<string, unknown>[]; headFigure: string }> = {};
  const targetEventByOldId = new Map<string, string>();
  for (const target of pkg.targets) {
    const newTargetId = maps.target.get(target.id)!;
    const targetFigures = figureRows
      .filter((entry) => {
        const revision = entry.value.revision as Record<string, unknown>;
        return revision.targetId === newTargetId;
      })
      .map((entry) => entry.value);
    let headFigure = typeof target.figureRevisionId === "string" ? maps.figureSet.get(target.figureRevisionId) : undefined;
    if (!headFigure || !targetFigures.some((entry) => (entry.revision as Record<string, unknown>).id === headFigure)) {
      headFigure = await derivedId(`v6/recovery/${validationId}/empty-figure/${target.id}`);
      const emptyEntries: FigureEntry[] = [];
      const empty = {
        kind: "figures.set",
        tenantId: actor.tenantId,
        matterId: row.plannedMatterId,
        revision: {
          id: headFigure,
          matterId: row.plannedMatterId,
          targetId: newTargetId,
          parentId: null,
          entries: emptyEntries,
          hash: await figureHash(emptyEntries),
          createdAt,
        },
      };
      targetFigures.push(empty);
      rows.push({ key: `${FIGURE_KEY_PREFIX}${newTargetId}/${headFigure}`, value: empty });
    }
    targets.push({
      id: newTargetId,
      matterId: row.plannedMatterId,
      status: target.status,
      configVersion: 1,
      draftRevisionId: null,
      figureRevisionId: headFigure,
    });
    const targetEventId = await derivedId(`v6/recovery/${validationId}/target-config/${target.id}`);
    targetEventByOldId.set(target.id, targetEventId);
    importedEvents.push({
      id: targetEventId,
      tenantId: actor.tenantId,
      matterId: row.plannedMatterId,
      targetId: newTargetId,
      actorId: actor.userId,
      actorKind: "user",
      action: "target.created",
      snapshot: null,
      jobId: null,
      resourceId: newTargetId,
      occurredAt: createdAt,
      metadata: { version: 1 },
    });
    targetState[newTargetId] = { figures: targetFigures, headFigure };
  }

  const revisionRows: Record<string, unknown>[] = [];
  const revisionsByTarget = new Map<string, Record<string, unknown>[]>();
  for (const record of pkg.records.filter((item) => item.kind === "generation.revision")) {
    const oldRevision = record.value.revision;
    if (!isRecord(oldRevision) || !isText(oldRevision.id) || !isText(oldRevision.targetId)) continue;
    const newRevisionId = maps.revision.get(oldRevision.id);
    const newTargetId = maps.target.get(oldRevision.targetId);
    if (!newRevisionId || !newTargetId) continue;
    const target = pkg.targets.find((item) => item.id === oldRevision.targetId);
    if (!target) continue;
    const headFigure = targetState[newTargetId]?.headFigure ?? targets.find((item) => item.id === newTargetId)?.figureRevisionId;
    if (!headFigure) continue;
    const ast = await remapAst(oldRevision.ast, maps, validationId);
    const revision = {
      id: newRevisionId,
      matterId: row.plannedMatterId,
      targetId: newTargetId,
      parentId: typeof oldRevision.parentId === "string" ? maps.revision.get(oldRevision.parentId) ?? null : null,
      input: {
        matterId: row.plannedMatterId,
        targetId: newTargetId,
        sourceVersion: 1,
        targetConfigVersion: 1,
        figureRevisionId: headFigure,
      },
      ast,
      astHash: await astHash(ast),
      reason: "imported",
      restoredFrom: null,
      createdBy: actor.userId,
      createdAt,
    };
    rows.push({
      key: `${GENERATION_REVISION_PREFIX}${newTargetId}/${newRevisionId}`,
      value: {
        kind: "generation.revision",
        tenantId: actor.tenantId,
        actorId: actor.userId,
        matterId: row.plannedMatterId,
        targetId: newTargetId,
        revision,
      },
    });
    revisionRows.push(revision);
    revisionsByTarget.set(newTargetId, [...(revisionsByTarget.get(newTargetId) ?? []), revision]);
  }

  for (const target of targets) {
    const revisions = revisionsByTarget.get(target.id) ?? [];
    const oldTarget = pkg.targets.find((item) => maps.target.get(item.id) === target.id);
    const oldHead = oldTarget?.draftRevisionId ? maps.revision.get(oldTarget.draftRevisionId) : undefined;
    const head = revisions.find((revision) => revision.id === oldHead) ?? revisions.at(-1) ?? null;
    target.draftRevisionId = head ? String(head.id) : null;
    if (head) {
      const set = targetState[target.id]?.figures ?? [];
      const state = {
        kind: "generation.revisions",
        tenantId: actor.tenantId,
        actorId: actor.userId,
        matterId: row.plannedMatterId,
        targetId: target.id,
        state: {
          matterId: row.plannedMatterId,
          sourceVersion: 1,
          targets: {
            [target.id]: {
              targetId: target.id,
              status: target.status,
              configVersion: 1,
              figureRevisionId: target.figureRevisionId,
              figureSets: set.map((entry) => (entry.revision as Record<string, unknown>)),
              headRevisionId: head.id,
              revisions,
            },
          },
        },
      };
      rows.push({ key: `${GENERATION_REVISIONS_PREFIX}${target.id}`, value: state });
    }
  }

  for (const target of pkg.targets) {
    if (!target.config) continue;
    const newTargetId = maps.target.get(target.id);
    if (!newTargetId) continue;
    const config = {
      ...structuredClone(target.config),
      targetId: newTargetId,
      version: 1,
      applicantIds: target.config.applicantIds.map((party) => maps.party.get(party) ?? party),
      inventorIds: target.config.inventorIds.map((party) => maps.party.get(party) ?? party),
      priorityClaims: target.config.priorityClaims.map((claim) => ({
        ...claim,
        evidenceAssetId: claim.evidenceAssetId ? maps.asset.get(claim.evidenceAssetId) ?? null : null,
      })),
    };
    const eventId = targetEventByOldId.get(target.id);
    if (!eventId) continue;
    rows.push({ key: targetConfigKey(actor, row.plannedMatterId, newTargetId, 1, eventId), value: {
      kind: "target.config",
      tenantId: actor.tenantId,
      matterId: row.plannedMatterId,
      targetId: newTargetId,
      config,
      at: createdAt,
    } });
  }

  for (const set of chunkSets.values()) {
    const sourceRecord = buildSourceRecord(row.plannedMatterId, set, maps);
    rows.push({ key: `${SOURCE_KEY_PREFIX}${set.sourceId}`, value: sourceRecord });
    rows.push({ key: `${CHUNK_KEY_PREFIX}${set.sourceId}/${set.parserVersion}`, value: {
      kind: "parse.chunks",
      sourceId: set.sourceId,
      parserVersion: set.parserVersion,
      jobId: set.jobId,
      pageCount: set.pageCount,
      createdAt,
      chunks: set.chunks,
    } });
  }
  for (const record of pkg.records.filter((item) => item.kind === "parse.source")) {
    if (!isRecord(record.value.source) || !isText(record.value.source.id)) continue;
    const newSourceId = maps.source.get(record.value.source.id);
    if (!newSourceId) continue;
    if (chunkSets.has(`${newSourceId}/${String(record.value.source.parserVersion ?? "")}`)) continue;
    const sourceSet = {
      sourceId: newSourceId,
      parserVersion: String(record.value.source.parserVersion ?? "imported"),
      jobId: await derivedId(`v6/recovery/${validationId}/source-job/${record.value.source.id}/empty`),
      pageCount: Number.isSafeInteger(record.value.source.pageCount) ? record.value.source.pageCount as number : 0,
      createdAt,
      chunks: [] as Record<string, unknown>[],
    };
    rows.push({ key: `${SOURCE_KEY_PREFIX}${newSourceId}`, value: buildSourceRecord(row.plannedMatterId, sourceSet, maps) });
  }

  let sourceSnapshot: SourceSnapshot | null = null;
  if (pkg.sourceSnapshot !== null) {
    const parsedSnapshot = sourceSnapshotSchema.safeParse(pkg.sourceSnapshot);
    if (!parsedSnapshot.success) {
      throw new RecoveryError("IMPORT_INVALID", "源快照结构无效；未写入任何案件。");
    }
    sourceSnapshot = remapSnapshot(parsedSnapshot.data, row.plannedMatterId, actor.userId, createdAt, maps);
  }
  if (sourceSnapshot) {
    const provenance: Record<string, unknown> = {};
    rows.push({ key: `${INTAKE_SNAPSHOT_PREFIX}${row.plannedMatterId}/1`, value: {
      kind: "intake.snapshot",
      snapshot: sourceSnapshot,
      provenance,
      requestKey: null,
    } });
  }

  for (const record of pkg.records.filter((item) => item.kind === "intake.drafts")) {
    if (!Array.isArray(record.value.bindings)) continue;
    const bindings = record.value.bindings.filter(isRecord).map((binding) => {
      const newTargetId = isText(binding.targetId) ? maps.target.get(binding.targetId) : undefined;
      if (!newTargetId) return null;
      return {
        targetId: newTargetId,
        input: {
          matterId: row.plannedMatterId,
          targetId: newTargetId,
          sourceVersion: 1,
          targetConfigVersion: 1,
          figureRevisionId: targets.find((target) => target.id === newTargetId)?.figureRevisionId ?? "",
        },
        boundAt: createdAt,
      };
    }).filter((binding) => binding !== null);
    rows.push({ key: `${INTAKE_DRAFTS_PREFIX}${row.plannedMatterId}`, value: {
      kind: "intake.drafts",
      matterId: row.plannedMatterId,
      bindings,
    } });
  }

  const candidateRecord = pkg.records.find((item) => item.kind === "intake.candidates");
  if (candidateRecord && Array.isArray(candidateRecord.value.candidates)) {
    const candidates: Record<string, unknown>[] = [];
    for (const [index, candidate] of candidateRecord.value.candidates.entries()) {
      if (!isRecord(candidate) || !isText(candidate.id) || !isText(candidate.statement)) continue;
      const refs = Array.isArray(candidate.refs) ? candidate.refs.flatMap((ref) => {
        if (!isRecord(ref) || !isText(ref.chunkId)) return [];
        const mapped = maps.chunk.get(ref.chunkId);
        if (!mapped) return [];
        return [{
          ...ref,
          sourceId: isText(ref.sourceId) ? maps.source.get(ref.sourceId) ?? ref.sourceId : ref.sourceId,
          chunkId: mapped.id,
          chunkHash: mapped.hash,
        }];
      }) : [];
      candidates.push({
        id: await derivedId(`v6/recovery/${validationId}/candidate/${candidate.id}`),
        statement: candidate.statement,
        kind: candidate.kind,
        status: candidate.status,
        refs,
        stagedAt: createdAt,
        adoptedFactId: isText(candidate.adoptedFactId) ? maps.fact.get(candidate.adoptedFactId) ?? null : null,
      });
    }
    rows.push({ key: `${INTAKE_CANDIDATES_PREFIX}${row.plannedMatterId}`, value: {
      kind: "intake.candidates",
      matterId: row.plannedMatterId,
      jobId: null,
      stagedAt: createdAt,
      stagedBy: actor.userId,
      candidates,
    } });
  }

  for (const [index, review] of pkg.legacyReviews.entries()) {
    rows.push({
      key: `recovery/legacy-review/${row.plannedMatterId}/${index}`,
      value: {
        kind: "recovery.legacy_review",
        tenantId: actor.tenantId,
        matterId: row.plannedMatterId,
        legacyReviewId: await derivedId(`v6/recovery/${validationId}/legacy-review/${review.id}`),
        itemKind: review.kind,
        identity: "legacy_unverified",
        recordedAt: review.recordedAt,
      },
    });
  }

  const matter: MatterRecord = {
    id: row.plannedMatterId,
    tenantId: actor.tenantId,
    version: 1,
    title: safeName(pkg.source.title) ?? "恢复的案件",
    status: "active",
    sourceVersion: 1,
    createdBy: actor.userId,
    createdAt,
    updatedAt: createdAt,
  };
  const event: ActivityRecord = {
    id: await derivedId(`v6/recovery/${validationId}/event/matter-created`),
    tenantId: actor.tenantId,
    matterId: matter.id,
    targetId: null,
    actorId: actor.userId,
    actorKind: "user",
    action: "matter.created",
    snapshot: null,
    jobId: null,
    resourceId: matter.id,
    occurredAt: createdAt,
    metadata: { version: 1 },
  };
  const report: MigrationReport = {
    ...structuredClone(row.report),
    canCommit: true,
    // Same package-derived unit as the dry-run report: `figures` counts figure
    // entries across all figure-set revisions, not figure-set revisions.
    mappingCounts: countMappings(pkg),
  };
  return { matter, targets, assets, events: [event, ...importedEvents], blobs, rows, report, createdAt };
}

function buildSourceRecord(
  matterId: string,
  set: { sourceId: string; parserVersion: string; jobId: string; pageCount: number; createdAt: string; chunks: Record<string, unknown>[] },
  maps: ImportMaps,
): Record<string, unknown> {
  const oldSourceId = [...maps.source.entries()].find(([, newSource]) => newSource === set.sourceId)?.[0];
  const assetId = oldSourceId ? maps.sourceAsset.get(oldSourceId) ?? "" : "";
  return {
    kind: "parse.source",
    source: {
      id: set.sourceId,
      matterId,
      assetId,
      retiredAt: null,
      parseStatus: set.chunks.length > 0 ? "parsed" : "pending",
      parserVersion: set.chunks.length > 0 ? set.parserVersion : null,
      pageCount: set.chunks.length > 0 ? set.pageCount : null,
      ocrNeeded: false,
    },
    currentJobId: null,
    jobIds: [],
    chunkSets: set.chunks.length > 0
      ? [{ parserVersion: set.parserVersion, jobId: set.jobId, chunkCount: set.chunks.length }]
      : [],
  };
}

function remapSnapshot(
  snapshot: SourceSnapshot | null,
  matterId: string,
  actorId: string,
  createdAt: string,
  maps: ImportMaps,
): SourceSnapshot | null {
  if (!snapshot) return null;
  const refs = (input: SourceSnapshot["facts"][number]["refs"]) => input.flatMap((ref) => {
    const mapped = maps.chunk.get(ref.chunkId);
    if (!mapped) return [];
    return {
      ...ref,
      sourceId: maps.source.get(ref.sourceId) ?? ref.sourceId,
      chunkId: mapped.id,
      chunkHash: mapped.hash,
    };
  });
  return {
    matterId,
    version: 1,
    sourceIds: [...new Set(snapshot.sourceIds.map((sourceId) => maps.source.get(sourceId)).filter((id): id is string => Boolean(id)))],
    facts: snapshot.facts.map((fact) => ({
      ...fact,
      id: maps.fact.get(fact.id) ?? fact.id,
      refs: refs(fact.refs),
      confirmedBy: null,
      confirmedAt: null,
    })),
    conflicts: snapshot.conflicts.map((conflict) => ({
      ...conflict,
      id: maps.conflict.get(conflict.id) ?? conflict.id,
      factIds: conflict.factIds.map((factId) => maps.fact.get(factId) ?? factId),
      chosenFactIds: conflict.chosenFactIds.map((factId) => maps.fact.get(factId) ?? factId),
    })),
    answers: {
      ...snapshot.answers,
      inventorIds: snapshot.answers.inventorIds.map((party) => maps.party.get(party) ?? party),
      disclosureDetail: snapshot.answers.disclosureDetail === null
        ? null
        : {
            ...snapshot.answers.disclosureDetail,
            evidenceRefs: refs(snapshot.answers.disclosureDetail.evidenceRefs),
          },
    },
    parties: snapshot.parties.map((party) => ({ ...party, id: maps.party.get(party.id) ?? party.id })),
    createdBy: actorId,
    createdAt,
  };
}

async function remapAst(value: unknown, maps: ImportMaps, validationId: string): Promise<DraftAST> {
  const parsedResult = draftAstSchema.safeParse(value);
  if (!parsedResult.success) {
    throw new RecoveryError("IMPORT_INVALID", "草稿结构或版本无效；未写入任何案件。");
  }
  const parsed = parsedResult.data;
  const paragraphIds = new Map<string, string>();
  const claimIds = new Map<string, string>();
  const featureIds = new Map<string, string>();
  const allParagraphs = [
    ...parsed.claims.flatMap((claim) => claim.paragraphs),
    ...parsed.sections.flatMap((section) => section.paragraphs),
  ];
  for (const paragraph of allParagraphs) {
    paragraphIds.set(paragraph.id, await derivedId(`v6/recovery/${validationId}/paragraph/${paragraph.id}`));
  }
  for (const claim of parsed.claims) claimIds.set(claim.id, await derivedId(`v6/recovery/${validationId}/claim/${claim.id}`));
  for (const claim of parsed.claims) {
    for (const feature of claim.features) featureIds.set(feature.id, await derivedId(`v6/recovery/${validationId}/feature/${feature.id}`));
  }
  const remapRef = (ref: DraftAST["claims"][number]["paragraphs"][number]["sourceRefs"][number]) => {
    const mapped = maps.chunk.get(ref.chunkId);
    if (!mapped) return null;
    return { ...ref, sourceId: maps.source.get(ref.sourceId) ?? ref.sourceId, chunkId: mapped.id, chunkHash: mapped.hash };
  };
  const remapParagraph = (paragraph: DraftAST["claims"][number]["paragraphs"][number]) => ({
    ...paragraph,
    id: paragraphIds.get(paragraph.id) ?? paragraph.id,
    sourceRefs: paragraph.sourceRefs.flatMap((ref) => { const mapped = remapRef(ref); return mapped ? [mapped] : []; }),
    factIds: paragraph.factIds.map((factId) => maps.fact.get(factId) ?? factId),
    figureIds: paragraph.figureIds.map((figureId) => maps.figure.get(figureId) ?? figureId),
    generationJobId: null,
  });
  return {
    ...parsed,
    claims: parsed.claims.map((claim) => ({
      ...claim,
      id: claimIds.get(claim.id) ?? claim.id,
      dependsOn: claim.dependsOn.map((id) => claimIds.get(id) ?? id),
      paragraphs: claim.paragraphs.map(remapParagraph),
      features: claim.features.map((feature) => ({
        ...feature,
        id: featureIds.get(feature.id) ?? feature.id,
        factIds: feature.factIds.map((factId) => maps.fact.get(factId) ?? factId),
        supportParagraphIds: feature.supportParagraphIds.map((id) => paragraphIds.get(id) ?? id),
      })),
    })),
    sections: parsed.sections.map((section) => ({ ...section, paragraphs: section.paragraphs.map(remapParagraph) })),
  };
}

function targetConfigKey(actor: Actor, matterId: string, targetId: string, version: number, writeId: string): string {
  return [
    TARGET_CONFIG_PREFIX,
    encodeURIComponent(actor.tenantId),
    encodeURIComponent(matterId),
    encodeURIComponent(targetId),
    String(version),
    encodeURIComponent(writeId),
  ].join("/");
}

/** Read the imported head draft without consulting ambient state. */
export async function readRecoveredDraft(
  repository: LocalRepository,
  actor: Actor,
  matterId: string,
  targetId: string,
): Promise<RecoveryResult<RecoveryDraftView>> {
  const loaded = await repository.loadMatter(actor, matterId);
  if (!loaded.ok) return failure("RESOURCE_NOT_FOUND", "恢复的案件不可用。");
  const target = loaded.data.data.targets.find((item) => item.id === targetId);
  if (!target || target.draftRevisionId === null) return failure("RESOURCE_NOT_FOUND", "恢复的草稿不可用。");
  let row: unknown;
  try {
    row = await repository.backend.transaction("readonly", (tx) =>
      tx.get(STORES.blobs, `${GENERATION_REVISION_PREFIX}${targetId}/${target.draftRevisionId}`));
  } catch {
    return failure("STORAGE_UNAVAILABLE", "无法读取恢复的草稿。");
  }
  if (!isRecord(row) || row.kind !== "generation.revision" || !isRecord(row.revision)
    || row.tenantId !== actor.tenantId || row.matterId !== matterId || row.targetId !== targetId) {
    return failure("RESOURCE_NOT_FOUND", "恢复的草稿不可用。");
  }
  return {
    ok: true,
    data: { revision: structuredClone(row.revision) as unknown as DraftRevision, ast: structuredClone((row.revision as { ast: DraftAST }).ast) },
  };
}

/** A safe display label for a generated recovery package; never includes the passphrase. */
export function recoveryPackageFileName(now: string): string {
  return `恢复包-${now.slice(0, 10)}.patentpack`;
}
