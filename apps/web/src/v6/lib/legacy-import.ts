/**
 * V6-07 — explicit migration of the legacy local workspace (S08 import rules,
 * 01-architecture §8, 05-contracts `legacy` origins).
 *
 * Migration contract `legacy-import.v2` (docs/implementation/patent-saas-v6/
 * migration-amendment.md). Two steps, never one:
 *
 * 1. `planLegacyImport` reads the old `patent-drafter.v1` AppState JSON and the
 *    old `patent-drafter-assets` records the caller already read, and returns a
 *    `MigrationPlan`: the matters it would write plus a `MigrationReport` that
 *    names every drawing with missing or unusable bytes, every project whose
 *    shape it does not recognise, and everything it deliberately leaves behind.
 *    It has no side effects and does not mutate its input; the same input and
 *    clock give the same plan, ids included.
 * 2. `commitLegacyImport` writes the plan through `LocalRepository.commit`, and
 *    only when the caller passes the user's explicit confirmation. It never
 *    receives a handle to the old stores, so it cannot change or delete them.
 *
 * The interface contract a caller must know:
 *
 * - Ids are derived from tenant, user and the legacy identity, so importing the
 *   same workspace twice targets the same matters: the second commit answers
 *   `already_imported` instead of writing a duplicate.
 * - The report uses positional references only (`#3` for a project or figure,
 *   `#asset:2`, `#snapshot:1:0`, `#review:0`, `#owner-review`,
 *   `#collection:field`, `#field:name`, `#supplied:n`), fixed codes and counts.
 *   A legacy id, document text or storage exception message never appears in
 *   it. The plan itself carries the user's own matter title and the drawing
 *   file name, because those are what the new matter stores.
 * - Every asset reference is validated on its own. A size must be recorded as a
 *   positive pair; a lone, zero or negative dimension, or an orientation outside
 *   1–8, makes the reference malformed. References that share an id but
 *   disagree about digest, mime, size or dimensions are a conflict: the asset is
 *   `quarantined` and no bytes are stored. The file name is not part of an
 *   asset's identity; the first usable reference supplies it. Only after
 *   validation are identical bytes deduplicated into one asset.
 * - A drawing is `available` only when stored bytes exist, hash to the recorded
 *   digest, match the declared byte size, and pass a conservative PNG/JPEG
 *   header-and-structure check (magic, chunk/segment layout, dimensions within
 *   8 MiB and 16 megapixels). That check validates structure, not a full pixel
 *   decode. Declared dimensions must agree with the header under the rule the
 *   old app itself used: the recorded `encodedWidth`/`encodedHeight` grid must
 *   equal the header; otherwise the recorded `width`/`height` pair is the
 *   display size, so a JPEG whose EXIF orientation is 5–8 is compared with the
 *   header's axes swapped. A recorded `orientation` must match the file.
 * - Legacy reviews and owner self-checks are listed as `legacy_unverified` and
 *   are never written as confirmations, approvals or checks (decision
 *   D-V6-07-01). A review collection present but not an array is reported and
 *   still named once; `null` means the old store had no value. Every other kind
 *   of work without an R1 store — including draft revisions, figure metadata,
 *   figure history, figure briefs and draft figure snapshots — is counted under
 *   `deferred`. A singular field present but not an object is reported. Supplied
 *   asset records that are left behind — unreferenced, or impossible to address
 *   — are listed under `orphanAssets`, so the report the user confirms names
 *   everything left in the old store.
 * - Drawings come from current and archived figures and from each figure's own
 *   revision history. An `assetHash` without a stored asset is a missing
 *   drawing, and an asset referenced only by a draft revision snapshot is
 *   reported rather than silently imported.
 * - `commitLegacyImport` re-checks every planned write's shape before any
 *   commit, so a plan mutated after planning (for example to inject an
 *   `approval.created` event) is refused with nothing written. A re-serialised
 *   plan object passes that structural check only; call a planner to produce a
 *   new plan instead.
 */

import {
  CONTRACT_VERSION,
  sha256Hex,
  type Actor,
  type ActivityRecord,
  type AssetRecord,
  type BlobWrite,
  type LocalRepository,
  type MatterRecord,
  type MatterWrite,
  type RepositoryError,
  type RepositoryErrorCode,
} from "./repository.ts";

/** The localStorage key the legacy app persisted its AppState under. */
export const LEGACY_STATE_KEY = "patent-drafter.v1";
/** The legacy IndexedDB database holding drawing bytes (store `assets`). */
export const LEGACY_ASSET_DB = "patent-drafter-assets";
/** The migration contract this module implements (migration-amendment.md). */
export const MIGRATION_CONTRACT_VERSION = "legacy-import.v2" as const;
/** The report/plan payload version written into every plan. */
export const MIGRATION_PLAN_VERSION = 2 as const;

const LEGACY_MIMES: ReadonlySet<string> = new Set(["image/png", "image/jpeg"]);
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
/** The migration's byte and pixel budgets for a drawing (amendments V6-07-M02). */
export const MAX_DRAWING_BYTES = 8 * 1024 * 1024;
export const MAX_DRAWING_PIXELS = 16_000_000;
const GENERIC_ORIGINAL_NAME = /^[\p{L}\p{N} ._-][\p{L}\p{N} ._()-]{0,199}$/u;
const POSITION_REF_PATTERN = /^#[A-Za-z0-9:_-]{1,48}$/;
const UUID_V8_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** One record of the legacy asset store, as the caller read it. */
export interface LegacyAssetInput {
  id: string;
  bytes: ArrayBuffer | Uint8Array;
  mime?: string;
  sha256?: string;
}

export interface LegacyImportInput {
  /** The key the state was read from; anything but v1 is an unknown version. */
  stateKey: string;
  /** The raw stored string, or null when the old app never saved anything. */
  stateJson: string | null;
  assets: readonly LegacyAssetInput[];
}

export interface PlanOptions {
  actor: Actor;
  /** Import time, RFC3339 UTC; injected so the plan is deterministic. */
  now: string;
}

/**
 * Fixed report codes. Asset-level codes answer why a referenced drawing was
 * not imported; figure codes describe the reference itself; the remaining
 * codes keep the V6-07 v1 vocabulary.
 */
export type MigrationIssueCode =
  | "IMPORT_INVALID"
  | "UNKNOWN_VERSION"
  | "MALFORMED_COLLECTION"
  | "MALFORMED_ENTRY"
  | "DEMO_SKIPPED"
  | "MISSING_BYTES"
  | "HASH_MISMATCH"
  | "ASSET_CONFLICT"
  | "ASSET_HASH_WITHOUT_ASSET"
  | "UNSUPPORTED_MEDIA"
  | "INVALID_ASSET_REFERENCE"
  | "DANGLING_ASSET_REFERENCE"
  | "BYTE_SIZE_MISMATCH"
  | "FILE_TOO_LARGE"
  | "IMAGE_TOO_LARGE"
  | "BAD_IMAGE_STRUCTURE"
  | "MIME_MISMATCH";

/**
 * A finding about one legacy item. Ids and codes only, never content: every
 * reference is a position in the input (`#n`, `#asset:n`, ...), never a legacy
 * id, so a damaged record cannot carry text into the report.
 */
export interface MigrationIssue {
  code: MigrationIssueCode;
  category: "state" | "project" | "figure" | "asset" | "snapshot" | "collection" | "review";
  legacyProjectId: string | null;
  legacyItemId: string | null;
}

/**
 * User work the R1 local repository has no store for yet. Each kind is counted
 * so the report the user confirms names everything left in the old store.
 */
export type DeferredKind =
  | "draft_revision"
  | "working_draft"
  | "material"
  | "feedback"
  | "intake"
  | "strategy"
  | "check"
  | "export_record"
  | "pipeline_state"
  | "figure_metadata"
  | "figure_history"
  | "figure_brief"
  | "draft_figure_snapshot";

export interface DeferredCount {
  legacyProjectId: string;
  kind: DeferredKind;
  count: number;
}

/**
 * A legacy review-like record. Its identity is `legacy_unverified` (C07): it is
 * shown for history only and can never become an authenticated review or an
 * approval.
 */
export interface LegacyUnverifiedItem {
  legacyProjectId: string;
  legacyItemId: string;
  kind: "review_record" | "owner_review";
  identity: "legacy_unverified";
}

/**
 * A supplied legacy asset record no project references. It is not imported and
 * its bytes were not read, so the report proves only its position and count.
 */
export interface OrphanAsset {
  /** Position in the caller's asset list (`#supplied:n`). */
  assetRef: string;
}

export interface MigrationReport {
  /** The migration contract this report was produced under. */
  contractVersion: typeof MIGRATION_CONTRACT_VERSION;
  reportVersion: typeof MIGRATION_PLAN_VERSION;
  /** False when the stored state itself cannot be read; nothing is planned. */
  readable: boolean;
  projectsFound: number;
  mattersPlanned: number;
  drawingsAvailable: number;
  missingBytes: readonly MigrationIssue[];
  hashMismatches: readonly MigrationIssue[];
  unknownVersions: readonly MigrationIssue[];
  unconvertible: readonly MigrationIssue[];
  /** Shape, reference, conflict and image findings, by position. */
  issues: readonly MigrationIssue[];
  legacyUnverified: readonly LegacyUnverifiedItem[];
  deferred: readonly DeferredCount[];
  /** Supplied asset records no drawing references; kept, never imported. */
  orphanAssets: readonly OrphanAsset[];
}

export interface PlannedMatter {
  /** Positional reference of the legacy project (`#n`). */
  legacyProjectId: string;
  /** Each report asset reference (`#asset:n`) to the asset record written for it. */
  assetRefs: Readonly<Record<string, string>>;
  write: MatterWrite;
}

export interface MigrationPlan {
  contractVersion: typeof MIGRATION_CONTRACT_VERSION;
  planVersion: typeof MIGRATION_PLAN_VERSION;
  actor: Actor;
  matters: readonly PlannedMatter[];
  report: MigrationReport;
}

/**
 * The static message for each repository refusal code. A raw backend exception
 * never reaches an import outcome, so a storage error cannot leak bytes, SQL or
 * paths through a message the page shows.
 */
const IMPORT_ERROR_MESSAGES: Readonly<Record<RepositoryErrorCode, string>> = Object.freeze({
  INVALID_INPUT: "the local repository refused the imported data",
  RESOURCE_NOT_FOUND: "the local repository could not find the imported record",
  VERSION_CONFLICT: "the matter was already imported",
  INVALID_TRANSITION: "the matter cannot be written in its current state",
  QUOTA_EXCEEDED: "local storage is full; free space and retry",
  STORAGE_UNAVAILABLE: "local storage is unavailable; retry later",
  HASH_MISMATCH: "the stored bytes do not match the recorded digest",
});

/**
 * Read the legacy workspace and decide what would be imported. Never throws on
 * bad data: unreadable input becomes an `IMPORT_INVALID` report with no matters.
 */
export async function planLegacyImport(input: LegacyImportInput, options: PlanOptions): Promise<MigrationPlan> {
  const actor = { tenantId: options.actor.tenantId, userId: options.actor.userId };
  const report = emptyReport();
  const matters: PlannedMatter[] = [];

  if (input.stateKey !== LEGACY_STATE_KEY) {
    // Another version's state is not read at all, so nothing is readable here.
    report.readable = false;
    report.unknownVersions.push(issue("UNKNOWN_VERSION", "state", null, null));
    return freezePlan({ contractVersion: MIGRATION_CONTRACT_VERSION, planVersion: MIGRATION_PLAN_VERSION, actor, matters, report });
  }
  if (input.stateJson === null) {
    return freezePlan({ contractVersion: MIGRATION_CONTRACT_VERSION, planVersion: MIGRATION_PLAN_VERSION, actor, matters, report });
  }

  let state: unknown;
  try {
    state = JSON.parse(input.stateJson);
  } catch {
    report.readable = false;
    report.unconvertible.push(issue("IMPORT_INVALID", "state", null, null));
    return freezePlan({ contractVersion: MIGRATION_CONTRACT_VERSION, planVersion: MIGRATION_PLAN_VERSION, actor, matters, report });
  }
  if (!isRecord(state) || !Array.isArray(state.projects)) {
    report.readable = false;
    report.unconvertible.push(issue("IMPORT_INVALID", "state", null, null));
    if (isRecord(state) && state.projects !== undefined) {
      malformedCollection(report, null, "projects");
    }
    return freezePlan({ contractVersion: MIGRATION_CONTRACT_VERSION, planVersion: MIGRATION_PLAN_VERSION, actor, matters, report });
  }

  const projects = state.projects as unknown[];
  const assets = indexSuppliedAssets(input.assets);
  const seen = new Set<string>();
  const referencedAssetIds = new Set<string>();
  const scope = { actor, now: options.now, report, assets, referencedAssetIds };
  report.projectsFound = projects.length;

  for (const [index, project] of projects.entries()) {
    const projectRef = `#${index}`;
    if (!isRecord(project)) {
      report.unknownVersions.push(issue("UNKNOWN_VERSION", "project", projectRef, null));
      continue;
    }
    // A lenient pass remembers every id this record references, so an asset
    // used only by a project that cannot be planned is still not an orphan.
    collectReferencedIds(project, referencedAssetIds);
    const projectId = isText(project.id) ? project.id : null;
    if (projectId === null || !isText(project.name) || !Array.isArray(project.figures)) {
      // Not a v1 project shape we recognise; listed, not guessed at.
      if (project.figures !== undefined && !Array.isArray(project.figures)) {
        malformedCollection(report, projectRef, "figures");
      }
      report.unknownVersions.push(issue("UNKNOWN_VERSION", "project", projectRef, null));
      continue;
    }
    const projectKey = `id:${projectId}`;
    if (seen.has(projectKey)) {
      report.unconvertible.push(issue("IMPORT_INVALID", "project", projectRef, null));
      continue;
    }
    seen.add(projectKey);
    if (project.demo === true) {
      // Demo projects were sample data, not the user's work.
      report.unconvertible.push(issue("DEMO_SKIPPED", "project", projectRef, null));
      continue;
    }
    matters.push(await planMatter(project, projectKey, projectRef, scope));
  }

  // Every supplied record left behind is named by position: one no project
  // references, or one that cannot be addressed because it has no usable id.
  for (const [position, asset] of (Array.isArray(input.assets) ? input.assets : []).entries()) {
    const id = isRecord(asset) && isText(asset.id) ? asset.id : null;
    if (id !== null && referencedAssetIds.has(id)) continue;
    report.orphanAssets.push({ assetRef: `#supplied:${position}` });
  }
  report.mattersPlanned = matters.length;
  return freezePlan({ contractVersion: MIGRATION_CONTRACT_VERSION, planVersion: MIGRATION_PLAN_VERSION, actor, matters, report });
}

interface PlanScope {
  actor: Actor;
  now: string;
  report: MutableReport;
  assets: SuppliedAssets;
  referencedAssetIds: Set<string>;
}

interface SuppliedAsset {
  record: LegacyAssetInput;
  position: number;
  /** Another stored record shares this id with different bytes or mime. */
  conflicting: boolean;
  /** Every stored digest recorded under this id, lowercased; all must match. */
  storedDigests: string[];
}

interface SuppliedAssets extends Map<string, SuppliedAsset> {}

async function planMatter(project: Record<string, unknown>, projectKey: string, projectRef: string, scope: PlanScope): Promise<PlannedMatter> {
  const { actor, now, report } = scope;
  const matterId = await deriveId(actor, ["matter", projectKey]);
  const title = (project.name as string).trim() || "Untitled";
  const matter: MatterRecord = {
    id: matterId,
    tenantId: actor.tenantId,
    version: 1,
    title,
    status: "active",
    sourceVersion: 1,
    createdBy: actor.userId,
    createdAt: now,
    updatedAt: now,
  };

  const corpus = collectFigureCorpus(project, projectRef, report);
  // Legacy ids stay inside this function; the plan only carries positions.
  const refByLegacyId = new Map<string, string>();
  const orderedIds: string[] = [];
  for (const reference of corpus.references) {
    scope.referencedAssetIds.add(reference.legacyAssetId);
    if (!refByLegacyId.has(reference.legacyAssetId)) {
      refByLegacyId.set(reference.legacyAssetId, `#asset:${orderedIds.length}`);
      orderedIds.push(reference.legacyAssetId);
    }
  }
  // Only this project's own figure sets count: the lenient pre-pass also holds
  // snapshot ids, which would hide a snapshot-only reference.
  const snapshotEntries = collectDraftSnapshots(project, projectRef, report, new Set(orderedIds));

  const assetRecords: AssetRecord[] = [];
  const blobs: BlobWrite[] = [];
  const assetRefs: Record<string, string> = {};
  for (const legacyId of orderedIds) {
    const references = corpus.references.filter((reference) => reference.legacyAssetId === legacyId);
    const assetRef = refByLegacyId.get(legacyId) as string;
    const before = assetRecords.length;
    await resolveAsset(references, assetRef, projectKey, projectRef, matterId, scope, assetRecords, blobs);
    if (assetRecords.length > before) assetRefs[assetRef] = assetRecords[before].id;
  }

  // A review collection present but not an array is reported and counted once,
  // never read as empty. `null` is the old store's "no value", like elsewhere.
  if (project.reviewRecords !== undefined && project.reviewRecords !== null && !Array.isArray(project.reviewRecords)) {
    malformedCollection(report, projectRef, "reviewRecords");
    report.legacyUnverified.push({ legacyProjectId: projectRef, legacyItemId: "#collection:reviewRecords", kind: "review_record", identity: "legacy_unverified" });
  }
  for (const [index, record] of arrayOf(project.reviewRecords).entries()) {
    const itemRef = `#review:${index}`;
    if (!isRecord(record) || !isText(record.id)) {
      report.issues.push(issue("MALFORMED_ENTRY", "review", projectRef, itemRef));
    }
    report.legacyUnverified.push({ legacyProjectId: projectRef, legacyItemId: itemRef, kind: "review_record", identity: "legacy_unverified" });
  }
  if (project.ownerReview !== undefined && project.ownerReview !== null && !isRecord(project.ownerReview)) {
    report.issues.push(issue("MALFORMED_ENTRY", "review", projectRef, "#owner-review"));
  }
  if (isRecord(project.ownerReview)) {
    report.legacyUnverified.push({ legacyProjectId: projectRef, legacyItemId: "#owner-review", kind: "owner_review", identity: "legacy_unverified" });
  }

  const revisions = collectionLength(report, project, projectRef, "revisions");
  const workingDraft =
    collectionLength(report, project, projectRef, "claims") > 0 ||
    collectionLength(report, project, projectRef, "specSections") > 0 ||
    isText(project.abstractText);
  defer(report, projectRef, "draft_revision", revisions);
  // A draft saved before the old app kept revisions exists only in the working fields.
  defer(report, projectRef, "working_draft", revisions === 0 && workingDraft ? 1 : 0);
  defer(report, projectRef, "material", collectionLength(report, project, projectRef, "materials") + collectionLength(report, project, projectRef, "files"));
  defer(report, projectRef, "feedback", collectionLength(report, project, projectRef, "feedback"));
  defer(report, projectRef, "intake", collectionLength(report, project, projectRef, "intakeAnswers"));
  malformedField(report, projectRef, "strategy", project.strategy);
  defer(report, projectRef, "strategy", isRecord(project.strategy) ? 1 : 0);
  malformedField(report, projectRef, "audit", project.audit);
  malformedField(report, projectRef, "traceCheck", project.traceCheck);
  defer(
    report,
    projectRef,
    "check",
    (isRecord(project.audit) ? 1 : 0) +
      (isRecord(project.traceCheck) ? 1 : 0) +
      collectionLength(report, project, projectRef, "auditHistory"),
  );
  defer(report, projectRef, "export_record", collectionLength(report, project, projectRef, "versions"));
  malformedField(report, projectRef, "live", project.live);
  defer(report, projectRef, "pipeline_state", isRecord(project.live) ? 1 : 0);
  defer(report, projectRef, "figure_metadata", corpus.figureMetadata);
  defer(report, projectRef, "figure_history", corpus.figureHistory);
  defer(report, projectRef, "figure_brief", corpus.figureBrief ? 1 : 0);
  defer(report, projectRef, "draft_figure_snapshot", snapshotEntries);

  const event: ActivityRecord = {
    id: await deriveId(actor, ["event", projectKey, "matter.created"]),
    tenantId: actor.tenantId,
    matterId,
    targetId: null,
    actorId: actor.userId,
    actorKind: "user",
    action: "matter.created",
    snapshot: null,
    jobId: null,
    resourceId: matterId,
    occurredAt: now,
    metadata: { version: 1 },
  };

  return {
    legacyProjectId: projectRef,
    assetRefs,
    write: { matter, targets: [], assets: assetRecords, events: [event], blobs },
  };
}

interface LegacyAssetReference {
  legacyAssetId: string;
  /** Position of the referencing figure, or the snapshot reference. */
  itemRef: string;
  sha256: string;
  mime: string;
  byteSize: number;
  originalName: string | null;
  /** Display size the old app recorded (EXIF orientation applied). */
  declaredWidth: number | null;
  declaredHeight: number | null;
  /** Encoded pixel grid the old app recorded, when it kept one. */
  declaredEncodedWidth: number | null;
  declaredEncodedHeight: number | null;
  /** EXIF orientation the old app recorded at import, when it kept one. */
  declaredOrientation: number | null;
  /** Set when the reference itself cannot describe an asset. */
  problem: { code: "INVALID_ASSET_REFERENCE" | "UNSUPPORTED_MEDIA"; itemRef: string } | null;
}

interface Corpus {
  references: LegacyAssetReference[];
  figureMetadata: number;
  figureHistory: number;
  figureBrief: boolean;
}

/**
 * Walk the collections this contract knows about. A field present but not an
 * array is reported instead of being read as empty, and figure entries are
 * validated one by one.
 */
function collectFigureCorpus(project: Record<string, unknown>, projectRef: string, report: MutableReport): Corpus {
  const references: LegacyAssetReference[] = [];
  let figureMetadata = 0;
  let figureHistory = 0;

  for (const field of ["figures", "archivedFigures"] as const) {
    if (project[field] !== undefined && !Array.isArray(project[field])) {
      malformedCollection(report, projectRef, field);
    }
  }
  const current = arrayOf(project.figures);
  const figures: Array<{ figure: unknown; index: number }> = [];
  for (const [index, figure] of current.entries()) figures.push({ figure, index });
  for (const [index, figure] of arrayOf(project.archivedFigures).entries()) figures.push({ figure, index: index + current.length });

  for (const { figure, index } of figures) {
    if (!isRecord(figure)) {
      report.issues.push(issue("MALFORMED_ENTRY", "figure", projectRef, `#${index}`));
      continue;
    }
    figureMetadata += 1;
    references.push(...figureReferences(figure, `#${index}`, report, projectRef));
    figureHistory += revisionCount(figure, projectRef, report);
  }

  if (project.figureBrief !== undefined && !isText(project.figureBrief)) {
    malformedCollection(report, projectRef, "figureBrief");
  }

  return { references, figureMetadata, figureHistory, figureBrief: isText(project.figureBrief) };
}

/**
 * Draft revisions carry a drawing snapshot of their moment. R1 has no store for
 * revision history, so the entries are counted as deferred, but a reference to
 * a drawing no figure set names is reported rather than trusted.
 */
function collectDraftSnapshots(
  project: Record<string, unknown>,
  projectRef: string,
  report: MutableReport,
  referencedAssetIds: ReadonlySet<string>,
): number {
  let entries = 0;
  for (const [revisionIndex, revision] of arrayOf(project.revisions).entries()) {
    if (!isRecord(revision)) continue;
    if (revision.figures !== undefined && !Array.isArray(revision.figures)) {
      malformedCollection(report, projectRef, "revisions[].figures");
      continue;
    }
    for (const [entryIndex, entry] of arrayOf(revision.figures).entries()) {
      entries += 1;
      const itemRef = `#snapshot:${revisionIndex}:${entryIndex}`;
      if (!isRecord(entry) || !isText(entry.assetId)) {
        report.issues.push(issue("MALFORMED_ENTRY", "snapshot", projectRef, itemRef));
        continue;
      }
      if (!referencedAssetIds.has(entry.assetId)) {
        report.issues.push(issue("DANGLING_ASSET_REFERENCE", "snapshot", projectRef, itemRef));
      }
    }
  }
  return entries;
}

/**
 * Every asset reference one figure holds: its current asset, its flat
 * `FigureSnapshotEntry` form, and every asset in its own revision history.
 */
function figureReferences(
  figure: Record<string, unknown>,
  figureRef: string,
  report: MutableReport,
  projectRef: string,
): LegacyAssetReference[] {
  const references: LegacyAssetReference[] = [];
  const declaredHash = figure.assetHash;
  const flatFields = [figure.sha256, figure.mime, figure.byteSize, figure.assetId, figure.width, figure.height];
  const hasFlat = flatFields.some((value) => value !== undefined);

  if (figure.asset !== undefined && figure.asset !== null) {
    const reference = assetReference(figure.asset, figureRef, declaredHash);
    if (reference === null) {
      report.issues.push(issue("MALFORMED_ENTRY", "figure", projectRef, figureRef));
    } else {
      references.push(reference);
    }
  } else if (isText(figure.assetId)) {
    // A draft snapshot entry promoted to the figure itself keeps its flat shape.
    const reference = assetReference(figure, figureRef, declaredHash);
    if (reference === null) {
      report.issues.push(issue("MALFORMED_ENTRY", "figure", projectRef, figureRef));
    } else {
      references.push(reference);
    }
  } else if (hasFlat) {
    report.issues.push(issue("MALFORMED_ENTRY", "figure", projectRef, figureRef));
  } else if (declaredHash !== undefined && declaredHash !== null) {
    // `assetHash` is documented as a mirror, never a substitute for bytes: a
    // hash with no stored asset is a missing drawing, not a placeholder.
    report.issues.push(issue("ASSET_HASH_WITHOUT_ASSET", "figure", projectRef, figureRef));
  }

  for (const revision of arrayOf(figure.revisions)) {
    if (!isRecord(revision)) {
      report.issues.push(issue("MALFORMED_ENTRY", "figure", projectRef, figureRef));
      continue;
    }
    if (revision.asset === undefined || revision.asset === null) continue;
    const reference = assetReference(revision.asset, figureRef, revision.assetHash);
    if (reference === null) {
      report.issues.push(issue("MALFORMED_ENTRY", "figure", projectRef, figureRef));
    } else {
      references.push(reference);
    }
  }
  return references;
}

/** History entries a figure keeps, and whether the field itself is malformed. */
function revisionCount(figure: Record<string, unknown>, projectRef: string, report: MutableReport): number {
  if (figure.revisions === undefined) return 0;
  if (!Array.isArray(figure.revisions)) {
    malformedCollection(report, projectRef, "figures[].revisions");
    return 0;
  }
  return figure.revisions.length;
}

/**
 * Parse one figure asset (or flat snapshot entry) into a reference. Returns
 * null when the value is not an object at all; a reference with a `problem`
 * is a record whose fields cannot describe an asset.
 */
function assetReference(value: unknown, itemRef: string, mirrorHash: unknown): LegacyAssetReference | null {
  if (!isRecord(value)) return null;
  // A flat figure or promoted snapshot entry names the stored asset in
  // `assetId`; a plain asset record names itself in `id`.
  const legacyAssetId = isText(value.assetId) ? value.assetId : isText(value.id) ? value.id : null;
  if (legacyAssetId === null) return null;
  const sha256 = typeof value.sha256 === "string" ? value.sha256.toLowerCase() : "";
  const mime = typeof value.mime === "string" ? value.mime : "";
  const rawSize = value.byteSize;
  const byteSize = Number.isSafeInteger(rawSize) && (rawSize as number) >= 0 ? (rawSize as number) : -1;
  const width = declaredSize(value.width);
  const height = declaredSize(value.height);
  const encodedWidth = declaredSize(value.encodedWidth);
  const encodedHeight = declaredSize(value.encodedHeight);
  const orientation = declaredOrientation(value.orientation);
  // A size is a pair: a lone dimension, a non-positive one, or an orientation
  // outside 1–8 cannot describe the drawing and is reported, not ignored.
  const malformedSize =
    width.state === "invalid" ||
    height.state === "invalid" ||
    encodedWidth.state === "invalid" ||
    encodedHeight.state === "invalid" ||
    orientation.state === "invalid" ||
    (width.state === "value") !== (height.state === "value") ||
    (encodedWidth.state === "value") !== (encodedHeight.state === "value");
  const problem = !SHA256_PATTERN.test(sha256) || byteSize < 0 || malformedSize
    ? ({ code: "INVALID_ASSET_REFERENCE", itemRef } as const)
    : !LEGACY_MIMES.has(mime)
      ? ({ code: "UNSUPPORTED_MEDIA", itemRef } as const)
      : null;
  // A `assetHash` outside the asset object must agree with it when both exist.
  const mirror = typeof mirrorHash === "string" ? mirrorHash.toLowerCase() : null;
  const conflictingMirror = mirror !== null && SHA256_PATTERN.test(sha256) && mirror !== sha256;
  return {
    legacyAssetId,
    itemRef,
    sha256,
    mime,
    byteSize,
    originalName: isText(value.originalName) ? value.originalName : null,
    declaredWidth: width.state === "value" ? width.value : null,
    declaredHeight: height.state === "value" ? height.value : null,
    declaredEncodedWidth: encodedWidth.state === "value" ? encodedWidth.value : null,
    declaredEncodedHeight: encodedHeight.state === "value" ? encodedHeight.value : null,
    declaredOrientation: orientation.state === "value" ? orientation.value : null,
    problem: conflictingMirror
      ? { code: "INVALID_ASSET_REFERENCE", itemRef }
      : problem,
  };
}

type DeclaredSize =
  | { state: "absent" }
  | { state: "value"; value: number }
  | { state: "invalid" };

/** A dimension as the old record stored it: absent, a positive integer, or malformed. */
function declaredSize(value: unknown): DeclaredSize {
  if (value === undefined || value === null) return { state: "absent" };
  return Number.isSafeInteger(value) && (value as number) > 0
    ? { state: "value", value: value as number }
    : { state: "invalid" };
}

/** An EXIF orientation as the old record stored it: absent, 1–8, or malformed. */
function declaredOrientation(value: unknown): DeclaredSize {
  if (value === undefined || value === null) return { state: "absent" };
  return Number.isSafeInteger(value) && (value as number) >= 1 && (value as number) <= 8
    ? { state: "value", value: value as number }
    : { state: "invalid" };
}

/**
 * Validate every reference that shares a legacy id, then resolve the id to one
 * asset. Disagreeing references quarantine the asset; identical metadata is
 * deduplicated; the bytes are hashed and checked once.
 */
async function resolveAsset(
  references: readonly LegacyAssetReference[],
  assetRef: string,
  projectKey: string,
  projectRef: string,
  matterId: string,
  scope: PlanScope,
  assetRecords: AssetRecord[],
  blobs: BlobWrite[],
): Promise<void> {
  const { actor, now, report } = scope;
  const legacyId = references[0].legacyAssetId;
  const shaped = references.filter((reference) => reference.problem === null);
  const configurations = new Set(shaped.map(configurationOf));
  const ordered = [...shaped].sort((a, b) => configurationOf(a).localeCompare(configurationOf(b)));
  const canonical = ordered[0];
  // A malformed reference sharing the id with a usable one disagrees with it too.
  const conflict = configurations.size > 1 || (shaped.length > 0 && shaped.length < references.length);

  // Report every unusable reference on its own, once per distinct reason.
  const malformedSeen = new Set<string>();
  for (const reference of references) {
    if (reference.problem === null) continue;
    const key = `${reference.problem.code}:${reference.legacyAssetId}`;
    if (malformedSeen.has(key)) continue;
    malformedSeen.add(key);
    report.issues.push(issue(reference.problem.code, "asset", projectRef, assetRef));
  }
  if (conflict) {
    report.issues.push(issue("ASSET_CONFLICT", "asset", projectRef, assetRef));
  }
  if (canonical === undefined) return;

  const assetId = await deriveId(actor, ["asset", projectKey, legacyId]);
  const mime = canonical.mime;
  const record: AssetRecord = {
    id: assetId,
    tenantId: actor.tenantId,
    matterId,
    serviceOrderId: null,
    purpose: "drawing",
    originalName: originalNameOf(canonical.originalName, mime),
    mime,
    byteLength: canonical.byteSize,
    sha256: canonical.sha256,
    state: "missing_bytes",
    objectKey: `local/${actor.tenantId}/${matterId}/${assetId}`,
    createdAt: now,
  };

  if (conflict) {
    assetRecords.push({ ...record, state: "quarantined" });
    return;
  }

  const supplied = scope.assets.get(legacyId);
  if (supplied === undefined) {
    report.missingBytes.push(issue("MISSING_BYTES", "asset", projectRef, assetRef));
    assetRecords.push(record);
    return;
  }

  if (supplied.conflicting) {
    report.issues.push(issue("ASSET_CONFLICT", "asset", projectRef, assetRef));
    assetRecords.push({ ...record, state: "quarantined" });
    return;
  }
  // Copy so the caller's buffer is never aliased into the plan.
  const bytes = new Uint8Array(toBytes(supplied.record.bytes));
  const digest = await sha256Hex(bytes);
  // Every stored record's own digest, when it kept one, must describe the bytes.
  if (digest !== canonical.sha256 || supplied.storedDigests.some((stored) => stored !== digest)) {
    // Bytes are kept in the old store but never presented as this drawing.
    report.hashMismatches.push(issue("HASH_MISMATCH", "asset", projectRef, assetRef));
    assetRecords.push({ ...record, state: "quarantined" });
    return;
  }
  if (bytes.byteLength !== canonical.byteSize) {
    report.issues.push(issue("BYTE_SIZE_MISMATCH", "asset", projectRef, assetRef));
    assetRecords.push({ ...record, state: "quarantined" });
    return;
  }
  if (supplied.record.mime !== undefined && supplied.record.mime !== canonical.mime) {
    // The store and the figure disagree about what the bytes are.
    report.issues.push(issue("MIME_MISMATCH", "asset", projectRef, assetRef));
    assetRecords.push({ ...record, state: "quarantined" });
    return;
  }
  const image = validateDrawing(canonical.mime, bytes);
  // A JPEG's display size depends on its EXIF orientation; PNG carries none.
  const orientation = image.ok && canonical.mime === "image/jpeg" ? jpegOrientation(bytes) : 1;
  if (!image.ok || !dimensionsAgree(canonical, image.dimensions, orientation)) {
    report.issues.push(issue(image.ok ? "BAD_IMAGE_STRUCTURE" : image.code, "asset", projectRef, assetRef));
    assetRecords.push({ ...record, state: "quarantined" });
    return;
  }
  const available: AssetRecord = { ...record, state: "available", byteLength: bytes.byteLength };
  assetRecords.push(available);
  blobs.push({ assetId, bytes, sha256: digest, byteLength: bytes.byteLength });
  report.drawingsAvailable += 1;
}

function configurationOf(reference: LegacyAssetReference): string {
  return JSON.stringify([
    reference.sha256,
    reference.mime,
    reference.byteSize,
    reference.declaredWidth,
    reference.declaredHeight,
    reference.declaredEncodedWidth,
    reference.declaredEncodedHeight,
    reference.declaredOrientation,
  ]);
}

/**
 * Declared dimensions must match the image header, under the old app's own
 * rule: the encoded grid when both encoded values were recorded; otherwise the
 * display pair, which for EXIF orientations 5–8 has the header's axes swapped.
 * Either grid is accepted for a single recorded pair, as the old verifier did.
 */
function dimensionsAgree(reference: LegacyAssetReference, dimensions: ImageDimensions, orientation: number): boolean {
  if (reference.declaredOrientation !== null && reference.declaredOrientation !== orientation) return false;
  if (reference.declaredEncodedWidth !== null && reference.declaredEncodedHeight !== null) {
    return reference.declaredEncodedWidth === dimensions.width && reference.declaredEncodedHeight === dimensions.height;
  }
  const display: ImageDimensions =
    orientation >= 5 && orientation <= 8
      ? { width: dimensions.height, height: dimensions.width }
      : dimensions;
  const matches = (pair: ImageDimensions) =>
    (reference.declaredWidth === null || reference.declaredWidth === pair.width) &&
    (reference.declaredHeight === null || reference.declaredHeight === pair.height);
  return matches(dimensions) || matches(display);
}

/** Remember referenced ids from projects that cannot be planned, so no false orphan. */
function collectReferencedIds(project: Record<string, unknown>, into: Set<string>): void {
  // A malformed collection may still hide a reference; reading its values only
  // suppresses an orphan claim, so the lenient read is safe here.
  const figures = [...entriesOf(project.figures), ...entriesOf(project.archivedFigures)];
  for (const figure of figures) {
    if (!isRecord(figure)) continue;
    for (const value of [figure.asset, ...entriesOf(figure.revisions).map((revision) => (isRecord(revision) ? revision.asset : undefined))]) {
      if (isRecord(value)) {
        if (isText(value.id)) into.add(value.id);
        else if (isText(value.assetId)) into.add(value.assetId);
      }
    }
    if (isText(figure.assetId)) into.add(figure.assetId);
  }
  for (const revision of entriesOf(project.revisions)) {
    if (!isRecord(revision)) continue;
    for (const entry of entriesOf(revision.figures)) {
      if (isRecord(entry) && isText(entry.assetId)) into.add(entry.assetId);
    }
  }
}

export type ImportOutcome =
  | { legacyProjectId: string; matterId: string; status: "imported" }
  | { legacyProjectId: string; matterId: string; status: "already_imported" }
  | { legacyProjectId: string; matterId: string; status: "failed"; error: RepositoryError };

export interface CommitLegacyOptions {
  /** Must be exactly true: the user confirmed this report in the UI. */
  confirmed: boolean;
  /** One request id per matter commit, injected for determinism. */
  requestId: (legacyProjectId: string) => string;
}

export type CommitLegacyResult =
  | { ok: true; outcomes: readonly ImportOutcome[] }
  | {
      ok: false;
      error: {
        code: "CONFIRMATION_REQUIRED" | "INVALID_INPUT";
        message: string;
      };
    };

/**
 * Write a plan the user confirmed. The whole plan is re-checked before any
 * write; each matter is then its own all-or-nothing commit at `expectedVersion`
 * 0, and a matter that already exists (an earlier run) is reported as
 * `already_imported` and left untouched.
 */
export async function commitLegacyImport(
  repository: LocalRepository,
  actor: Actor,
  plan: MigrationPlan,
  options: CommitLegacyOptions,
): Promise<CommitLegacyResult> {
  if (options?.confirmed !== true) {
    return { ok: false, error: { code: "CONFIRMATION_REQUIRED", message: "the import report must be confirmed first" } };
  }
  if (!isRecord(plan) || plan.actor?.tenantId !== actor.tenantId || plan.actor?.userId !== actor.userId) {
    return { ok: false, error: { code: "INVALID_INPUT", message: "the plan was made for another actor" } };
  }
  // A plan is data a caller could keep and mutate. Its integrity is checked in
  // full before commit, so a mutated or hand-built plan cannot smuggle a write.
  if (!canCommitPlan(plan)) {
    return { ok: false, error: { code: "INVALID_INPUT", message: "the plan is not a valid unmodified migration plan" } };
  }
  const outcomes: ImportOutcome[] = [];
  for (const planned of plan.matters) {
    const matterId = planned.write.matter.id;
    const committed = await repository.commit(
      actor,
      { contractVersion: CONTRACT_VERSION, expectedVersion: 0, payload: planned.write },
      { requestId: options.requestId(planned.legacyProjectId) },
    );
    if (committed.ok) {
      outcomes.push({ legacyProjectId: planned.legacyProjectId, matterId, status: "imported" });
    } else if (committed.error.code === "VERSION_CONFLICT") {
      outcomes.push({ legacyProjectId: planned.legacyProjectId, matterId, status: "already_imported" });
    } else {
      outcomes.push({
        legacyProjectId: planned.legacyProjectId,
        matterId,
        status: "failed",
        // Static text keyed by the refusal code; never the backend's message.
        error: {
          ...committed.error,
          message: IMPORT_ERROR_MESSAGES[committed.error.code] ?? "the local repository refused the imported data",
        },
      });
    }
  }
  return { ok: true, outcomes };
}

/**
 * The write shape `planMatter` produces. Anything else — another action, a
 * second event, targets, a foreign tenant, a blob that does not hash to its
 * record — is refused before the repository sees it.
 */
function canCommitPlan(plan: MigrationPlan): boolean {
  if (plan.contractVersion !== MIGRATION_CONTRACT_VERSION || plan.planVersion !== MIGRATION_PLAN_VERSION) return false;
  if (!isObject(plan.actor) || !Array.isArray(plan.matters)) return false;
  const actors = new Set<string>();
  const matterIds = new Set<string>();
  const projectRefs = new Set<string>();
  for (const planned of plan.matters) {
    if (!isObject(planned) || typeof planned.legacyProjectId !== "string" || !isObject(planned.write)) return false;
    if (!POSITION_REF_PATTERN.test(planned.legacyProjectId) || !isObject(planned.assetRefs)) return false;
    if (!canCommitWrite(planned, plan.actor)) return false;
    actors.add(planned.write.matter.createdBy);
    if (matterIds.has(planned.write.matter.id)) return false;
    matterIds.add(planned.write.matter.id);
    if (projectRefs.has(planned.legacyProjectId)) return false;
    projectRefs.add(planned.legacyProjectId);
  }
  return actors.size <= 1;
}

function canCommitWrite(planned: PlannedMatter, actor: Actor): boolean {
  const write = planned.write;
  const matter = write.matter;
  const writeKeys = Object.keys(write).sort();
  const expectedKeys = ["assets", "blobs", "events", "matter", "targets"];
  if (writeKeys.length !== expectedKeys.length || writeKeys.some((key, index) => key !== expectedKeys[index])) return false;
  if (!isObject(matter) || typeof matter.id !== "string" || !UUID_V8_PATTERN.test(matter.id)) return false;
  if (matter.tenantId !== actor.tenantId || matter.createdBy !== actor.userId) return false;
  if (matter.status !== "active" || matter.version !== 1 || matter.sourceVersion !== 1) return false;
  if (!isText(matter.createdAt) || matter.createdAt !== matter.updatedAt) return false;
  if (!isText(matter.title)) return false;
  if (!Array.isArray(write.targets) || write.targets.length !== 0) return false;
  if (!Array.isArray(write.assets) || !Array.isArray(write.events) || !Array.isArray(write.blobs)) return false;

  const assetIds = new Set<string>();
  for (const asset of write.assets) {
    if (!sameKeys(asset, ["id", "tenantId", "matterId", "serviceOrderId", "purpose", "originalName", "mime", "byteLength", "sha256", "state", "objectKey", "createdAt"])) return false;
    if (typeof asset.id !== "string" || !UUID_V8_PATTERN.test(asset.id) || assetIds.has(asset.id)) return false;
    assetIds.add(asset.id);
    if (asset.tenantId !== matter.tenantId || asset.matterId !== matter.id) return false;
    if (asset.purpose !== "drawing" || asset.serviceOrderId !== null) return false;
    if (!LEGACY_MIMES.has(asset.mime ?? "")) return false;
    if (!SHA256_PATTERN.test(asset.sha256 ?? "")) return false;
    // A missing or quarantined record keeps the legacy declared size, which may
    // be over budget; only stored bytes are held to the budget.
    if (!Number.isSafeInteger(asset.byteLength) || asset.byteLength < 0) return false;
    if (asset.state === "available" && asset.byteLength > MAX_DRAWING_BYTES) return false;
    if (asset.state !== "available" && asset.state !== "missing_bytes" && asset.state !== "quarantined") return false;
    if (!isText(asset.originalName) || asset.originalName.length > 200) return false;
    if (asset.objectKey !== `local/${matter.tenantId}/${matter.id}/${asset.id}`) return false;
    if (asset.createdAt !== matter.createdAt) return false;
  }

  const blobIds = new Set<string>();
  for (const blob of write.blobs) {
    if (!sameKeys(blob, ["assetId", "bytes", "sha256", "byteLength"])) return false;
    if (!assetIds.has(blob.assetId) || blobIds.has(blob.assetId)) return false;
    blobIds.add(blob.assetId);
    if (!(blob.bytes instanceof Uint8Array)) return false;
    const asset = write.assets.find((item) => item.id === blob.assetId) as AssetRecord;
    if (asset.state !== "available") return false;
    if (blob.sha256 !== asset.sha256 || blob.byteLength !== asset.byteLength || blob.bytes.byteLength !== asset.byteLength) return false;
  }
  for (const asset of write.assets) {
    if (asset.state === "available" && !blobIds.has(asset.id)) return false;
  }

  for (const [ref, assetId] of Object.entries(planned.assetRefs)) {
    if (!/^#asset:\d{1,9}$/.test(ref) || !assetIds.has(assetId)) return false;
  }

  if (write.events.length !== 1) return false;
  const event = write.events[0];
  if (!sameKeys(event, ["id", "tenantId", "matterId", "targetId", "actorId", "actorKind", "action", "snapshot", "jobId", "resourceId", "occurredAt", "metadata"])) return false;
  if (!UUID_V8_PATTERN.test(event.id ?? "")) return false;
  if (event.tenantId !== matter.tenantId || event.matterId !== matter.id) return false;
  if (event.actorKind !== "user" || event.actorId !== matter.createdBy) return false;
  if (event.action !== "matter.created" || event.targetId !== null || event.snapshot !== null || event.jobId !== null) return false;
  if (event.resourceId !== matter.id || event.occurredAt !== matter.createdAt) return false;
  if (!sameKeys(event.metadata, ["version"]) || event.metadata?.version !== 1) return false;
  return true;
}

function sameKeys(value: unknown, allowed: readonly string[]): boolean {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  return keys.length === allowed.length && keys.every((key) => allowed.includes(key));
}

type MutableReport = {
  -readonly [K in keyof MigrationReport]: MigrationReport[K] extends readonly (infer T)[]
    ? T[]
    : K extends "readable" | "projectsFound" | "mattersPlanned" | "drawingsAvailable"
      ? MigrationReport[K]
      : MigrationReport[K];
};

function freezePlan(plan: MigrationPlan): MigrationPlan {
  const freezeIssues = (items: readonly MigrationIssue[]) => Object.freeze(items.map((item) => Object.freeze({ ...item })));
  const frozen: MigrationPlan = {
    contractVersion: plan.contractVersion,
    planVersion: plan.planVersion,
    actor: Object.freeze({ ...plan.actor }),
    matters: Object.freeze(
      plan.matters.map((planned) =>
        Object.freeze({
          legacyProjectId: planned.legacyProjectId,
          assetRefs: Object.freeze({ ...planned.assetRefs }),
          write: Object.freeze({
            matter: Object.freeze({ ...planned.write.matter }),
            targets: Object.freeze([]),
            assets: Object.freeze(planned.write.assets.map((asset) => Object.freeze({ ...asset }))),
            events: Object.freeze(planned.write.events.map((event) => Object.freeze({ ...event }))),
            blobs: Object.freeze(planned.write.blobs.map((blob) => Object.freeze({ ...blob }))),
          }),
        }),
      ),
    ),
    report: Object.freeze({
      ...plan.report,
      missingBytes: freezeIssues(plan.report.missingBytes),
      hashMismatches: freezeIssues(plan.report.hashMismatches),
      unknownVersions: freezeIssues(plan.report.unknownVersions),
      unconvertible: freezeIssues(plan.report.unconvertible),
      issues: freezeIssues(plan.report.issues),
      legacyUnverified: Object.freeze(plan.report.legacyUnverified.map((item) => Object.freeze({ ...item }))),
      deferred: Object.freeze(plan.report.deferred.map((item) => Object.freeze({ ...item }))),
      orphanAssets: Object.freeze(plan.report.orphanAssets.map((item) => Object.freeze({ ...item }))),
    }),
  };
  return Object.freeze(frozen);
}

function emptyReport(): MutableReport {
  return {
    contractVersion: MIGRATION_CONTRACT_VERSION,
    reportVersion: MIGRATION_PLAN_VERSION,
    readable: true,
    projectsFound: 0,
    mattersPlanned: 0,
    drawingsAvailable: 0,
    missingBytes: [],
    hashMismatches: [],
    unknownVersions: [],
    unconvertible: [],
    issues: [],
    legacyUnverified: [],
    deferred: [],
    orphanAssets: [],
  };
}

function issue(
  code: MigrationIssueCode,
  category: MigrationIssue["category"],
  legacyProjectId: string | null,
  legacyItemId: string | null,
): MigrationIssue {
  return { code, category, legacyProjectId, legacyItemId };
}

function defer(report: MutableReport, legacyProjectId: string, kind: DeferredKind, count: number): void {
  if (count > 0) report.deferred.push({ legacyProjectId, kind, count });
}

function malformedCollection(report: MutableReport, legacyProjectId: string | null, field: string): void {
  report.issues.push(issue("MALFORMED_COLLECTION", "collection", legacyProjectId, `#collection:${field}`));
}

/** A singular object field present but not an object is reported, never read as absent. */
function malformedField(report: MutableReport, legacyProjectId: string, field: string, value: unknown): void {
  if (value === undefined || value === null || isRecord(value)) return;
  report.issues.push(issue("MALFORMED_ENTRY", "project", legacyProjectId, `#field:${field}`));
}

/**
 * A legacy collection's length. Present but not an array is a malformed
 * collection reported by position, and counted as one unreadable item so the
 * user's confirmation still names it.
 */
function collectionLength(report: MutableReport, project: Record<string, unknown>, projectRef: string, field: string): number {
  const value = project[field];
  if (value === undefined || value === null) return 0;
  if (Array.isArray(value)) return value.length;
  malformedCollection(report, projectRef, field);
  return 1;
}

function indexSuppliedAssets(assets: readonly LegacyAssetInput[]): SuppliedAssets {
  const index: SuppliedAssets = new Map();
  for (const [position, asset] of (Array.isArray(assets) ? assets : []).entries()) {
    if (isRecord(asset) && isText(asset.id) && (asset.bytes instanceof ArrayBuffer || asset.bytes instanceof Uint8Array)) {
      const known = index.get(asset.id);
      if (known === undefined) {
        index.set(asset.id, {
          record: asset as unknown as LegacyAssetInput,
          position,
          conflicting: false,
          storedDigests: storedDigestsOf(asset),
        });
      } else {
        const duplicate = asset as unknown as LegacyAssetInput;
        if (!sameBytes(toBytes(known.record.bytes), toBytes(asset.bytes as ArrayBuffer | Uint8Array)) || known.record.mime !== duplicate.mime) {
          // Two stored records under one id that disagree: neither is trusted.
          known.conflicting = true;
        } else {
          // Identical bytes under one id: every recorded digest must still agree
          // with them, whichever record the caller listed first.
          known.storedDigests.push(...storedDigestsOf(asset));
        }
      }
    }
  }
  return index;
}

function storedDigestsOf(record: { sha256?: unknown }): string[] {
  return typeof record.sha256 === "string" ? [record.sha256.toLowerCase()] : [];
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) if (left[index] !== right[index]) return false;
  return true;
}

function toBytes(bytes: ArrayBuffer | Uint8Array): Uint8Array {
  return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
}

function originalNameOf(name: string | null, mime: string): string {
  if (name !== null && GENERIC_ORIGINAL_NAME.test(name)) return name;
  return `drawing.${mime === "image/png" ? "png" : "jpg"}`;
}

/**
 * A stable RFC 9562 version-8 UUID from SHA-256 of the actor and legacy key, so
 * a repeated import addresses the same records and cannot create duplicates.
 * The key is JSON-encoded, so no pair of legacy ids can spell another pair.
 * Legacy ids only seed the hash; they never appear in the report or a record.
 */
async function deriveId(actor: Actor, key: readonly string[]): Promise<string> {
  const text = JSON.stringify(["patent.v6.legacy-import", actor.tenantId, actor.userId, ...key]);
  const hex = await sha256Hex(new TextEncoder().encode(text));
  const variant = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function arrayOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** Array entries, or the values of a malformed object collection, for lenient reads. */
function entriesOf(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  return isRecord(value) ? Object.values(value) : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A plain-object check that does not narrow, so typed plan fields keep their types. */
function isObject(value: unknown): boolean {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isText(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

// ---------------------------------------------------------------------------
// Conservative PNG/JPEG validation. This checks the bytes' magic, container
// structure and declared dimensions; it does not inflate image data or decode
// pixels, so a file that passes can still be rejected by a full decoder.
// ---------------------------------------------------------------------------

export interface ImageDimensions {
  width: number;
  height: number;
}

export type ImageValidation =
  | { ok: true; dimensions: ImageDimensions }
  | { ok: false; code: "UNSUPPORTED_MEDIA" | "FILE_TOO_LARGE" | "IMAGE_TOO_LARGE" | "MIME_MISMATCH" | "BAD_IMAGE_STRUCTURE" };

/**
 * Validate a drawing against the migration budget. The declared mime must be
 * PNG or JPEG, the bytes must start with that format's magic, the container
 * must be well formed end to end, and the pixel count must fit 16 MP.
 */
export function validateDrawing(mime: string, bytes: Uint8Array): ImageValidation {
  if (!LEGACY_MIMES.has(mime)) return { ok: false, code: "UNSUPPORTED_MEDIA" };
  if (bytes.byteLength > MAX_DRAWING_BYTES) return { ok: false, code: "FILE_TOO_LARGE" };
  const dimensions = mime === "image/png" ? pngDimensions(bytes) : jpegDimensions(bytes);
  if (dimensions === null) {
    const other = mime === "image/png" ? jpegDimensions(bytes) : pngDimensions(bytes);
    return { ok: false, code: other === null ? "BAD_IMAGE_STRUCTURE" : "MIME_MISMATCH" };
  }
  if (dimensions.width * dimensions.height > MAX_DRAWING_PIXELS) return { ok: false, code: "IMAGE_TOO_LARGE" };
  return { ok: true, dimensions };
}

const PNG_SIGNATURE = Object.freeze([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_ALLOWED_DEPTHS: Readonly<Record<number, readonly number[]>> = Object.freeze({
  0: [1, 2, 4, 8, 16],
  2: [8, 16],
  3: [1, 2, 4, 8],
  4: [8, 16],
  6: [8, 16],
});

/**
 * Walk the PNG container: signature, IHDR first and once, chunk bounds, CRC of
 * every chunk, at least one IDAT, IEND last with nothing after it.
 */
function pngDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (bytes.byteLength < 8 + 12 + 13 + 12) return null;
  for (let index = 0; index < PNG_SIGNATURE.length; index += 1) {
    if (bytes[index] !== PNG_SIGNATURE[index]) return null;
  }
  let offset = 8;
  let width = 0;
  let height = 0;
  let colourType = -1;
  let sawHeader = false;
  let sawPalette = false;
  let sawData = false;
  let sawEnd = false;
  while (offset < bytes.byteLength) {
    if (offset + 12 > bytes.byteLength) return null;
    const length = readUint32(bytes, offset);
    if (length > 0x7fffffff) return null;
    const typeStart = offset + 4;
    const dataStart = typeStart + 4;
    const crcStart = dataStart + length;
    if (crcStart + 4 > bytes.byteLength) return null;
    const type = String.fromCharCode(bytes[typeStart], bytes[typeStart + 1], bytes[typeStart + 2], bytes[typeStart + 3]);
    if (!/^[A-Za-z]{4}$/.test(type)) return null;
    if (crc32(bytes, typeStart, crcStart) !== readUint32(bytes, crcStart)) return null;
    if (!sawHeader) {
      if (type !== "IHDR" || length !== 13) return null;
      width = readUint32(bytes, dataStart);
      height = readUint32(bytes, dataStart + 4);
      const depth = bytes[dataStart + 8];
      colourType = bytes[dataStart + 9];
      const compression = bytes[dataStart + 10];
      const filter = bytes[dataStart + 11];
      const interlace = bytes[dataStart + 12];
      const depths = PNG_ALLOWED_DEPTHS[colourType];
      if (depth === undefined || depths === undefined || !depths.includes(depth)) return null;
      if (compression !== 0 || filter !== 0 || (interlace !== 0 && interlace !== 1)) return null;
      if (width === 0 || height === 0) return null;
      sawHeader = true;
    } else if (type === "IHDR") {
      return null;
    } else if (type === "PLTE") {
      // One palette, before the data, of 1-256 RGB entries; never in greyscale.
      if (sawPalette || sawData || colourType === 0 || colourType === 4) return null;
      if (length === 0 || length > 768 || length % 3 !== 0) return null;
      sawPalette = true;
    } else if (type === "IDAT") {
      if (colourType === 3 && !sawPalette) return null;
      // Like the old verifier, a PNG must carry at least one byte of compressed
      // image data; zero-length IDAT chunks alone are not a decodable image.
      if (length > 0) sawData = true;
    } else if (type === "IEND") {
      if (length !== 0) return null;
      sawEnd = true;
      offset = crcStart + 4;
      break;
    }
    offset = crcStart + 4;
  }
  if (!sawHeader || !sawData || !sawEnd || offset !== bytes.byteLength) return null;
  return { width, height };
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
}

let crcTable: Uint32Array | null = null;

function crc32(bytes: Uint8Array, start: number, end: number): number {
  if (crcTable === null) {
    crcTable = new Uint32Array(256);
    for (let index = 0; index < 256; index += 1) {
      let value = index;
      for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
      crcTable[index] = value >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let index = start; index < end; index += 1) crc = (crcTable[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8)) >>> 0;
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Walk a JPEG stream: SOI, length-checked segments, exactly one frame header
 * with a legal precision and nonzero dimensions, at least one scan, and EOI at
 * the final byte. Entropy data is skipped (stuffed bytes and restart markers
 * included) but not decoded.
 */
function jpegDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (bytes.byteLength < 4) return null;
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  let frame: { width: number; height: number } | null = null;
  let sawScan = false;
  let sawEnd = false;

  while (offset < bytes.byteLength) {
    if (bytes[offset] !== 0xff) return null;
    while (offset < bytes.byteLength && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.byteLength) return null;
    const marker = bytes[offset];
    offset += 1;
    if (marker === 0xd9) {
      sawEnd = true;
      break;
    }
    if (marker === 0x01) continue;
    if (marker >= 0xd0 && marker <= 0xd7) return null;
    if (offset + 2 > bytes.byteLength) return null;
    const length = (bytes[offset] << 8) | bytes[offset + 1];
    if (length < 2 || offset + length > bytes.byteLength) return null;
    if (isFrameMarker(marker)) {
      if (frame !== null || length < 8) return null;
      const precision = bytes[offset + 2];
      const height = (bytes[offset + 3] << 8) | bytes[offset + 4];
      const width = (bytes[offset + 5] << 8) | bytes[offset + 6];
      const components = bytes[offset + 7];
      const allowedPrecision = marker === 0xc0 || marker === 0xc1 || marker === 0xc2 ? precision === 8 : precision === 8 || precision === 12;
      if (!allowedPrecision || width === 0 || height === 0 || components < 1 || components > 4) return null;
      if (length !== 8 + 3 * components) return null;
      frame = { width, height };
    } else if (marker === 0xdb) {
      if (!validQuantisationTables(bytes, offset + 2, offset + length)) return null;
    } else if (marker === 0xc4) {
      if (!validHuffmanTables(bytes, offset + 2, offset + length)) return null;
    } else if (marker === 0xdd) {
      if (length !== 4) return null;
    } else if (marker === 0xda) {
      if (frame === null) return null;
      sawScan = true;
      offset += length;
      const scan = scanEnd(bytes, offset);
      if (scan === null) return null;
      offset = scan;
      continue;
    } else if (marker === 0x00 || marker === 0xd8) {
      return null;
    }
    offset += length;
  }
  if (!sawEnd || !sawScan || frame === null) return null;
  if (offset !== bytes.byteLength) return null;
  return frame;
}

function isFrameMarker(marker: number): boolean {
  return (
    (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) ||
    marker === 0xf7
  );
}

/**
 * The EXIF orientation a JPEG declares (1–8), or 1 when it carries none. Like
 * the old app's own reader, a malformed Exif block falls back to 1 rather than
 * rejecting the file; the structural walk above has already checked the stream.
 */
function jpegOrientation(bytes: Uint8Array): number {
  let orientation = 1;
  let offset = 2;
  while (offset + 1 < bytes.byteLength) {
    if (bytes[offset] !== 0xff) return orientation;
    while (offset + 1 < bytes.byteLength && bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset];
    offset += 1;
    if (marker === 0xd9 || marker === 0xda) return orientation;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.byteLength) return orientation;
    const length = (bytes[offset] << 8) | bytes[offset + 1];
    if (length < 2 || offset + length > bytes.byteLength) return orientation;
    if (marker === 0xe1) {
      const found = exifOrientation(bytes, offset + 2, offset + length);
      if (found !== 1) orientation = found;
    }
    offset += length;
  }
  return orientation;
}

/** The Orientation tag (0x0112) of one APP1 Exif segment, 1 when absent or malformed. */
function exifOrientation(bytes: Uint8Array, start: number, end: number): number {
  if (end - start < 14) return 1;
  if (bytes[start] !== 0x45 || bytes[start + 1] !== 0x78 || bytes[start + 2] !== 0x69 || bytes[start + 3] !== 0x66) return 1;
  // The old app's verifier skips the two bytes after "Exif" without reading them.
  const tiff = start + 6;
  const little = bytes[tiff] === 0x49 && bytes[tiff + 1] === 0x49;
  const big = bytes[tiff] === 0x4d && bytes[tiff + 1] === 0x4d;
  if (!little && !big) return 1;
  const u16 = (at: number) =>
    at + 2 <= end ? (little ? bytes[at] | (bytes[at + 1] << 8) : (bytes[at] << 8) | bytes[at + 1]) : 0;
  const u32 = (at: number) =>
    at + 4 <= end
      ? (little
          ? bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16) | (bytes[at + 3] << 24)
          : (bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0
      : 0;
  if (u16(tiff + 2) !== 0x2a) return 1;
  const ifd0 = tiff + u32(tiff + 4);
  if (ifd0 + 2 > end) return 1;
  const count = u16(ifd0);
  for (let index = 0; index < count; index += 1) {
    const entry = ifd0 + 2 + index * 12;
    if (entry + 12 > end) return 1;
    if (u16(entry) !== 0x0112) continue;
    // The old verifier read the value field without checking the tag's type or
    // count; mirror that so files it accepted stay importable.
    const value = u16(entry + 8);
    return value >= 1 && value <= 8 ? value : 1;
  }
  return 1;
}

function validQuantisationTables(bytes: Uint8Array, start: number, end: number): boolean {
  let offset = start;
  while (offset < end) {
    const info = bytes[offset];
    const precision = info >> 4;
    const identifier = info & 0x0f;
    if (precision > 1 || identifier > 3) return false;
    offset += 1 + (precision === 0 ? 64 : 128);
    if (offset > end) return false;
  }
  return offset === end;
}

function validHuffmanTables(bytes: Uint8Array, start: number, end: number): boolean {
  let offset = start;
  while (offset < end) {
    const info = bytes[offset];
    const tableClass = info >> 4;
    const identifier = info & 0x0f;
    if (tableClass > 1 || identifier > 3 || offset + 17 > end) return false;
    let symbols = 0;
    for (let index = 0; index < 16; index += 1) symbols += bytes[offset + 1 + index];
    offset += 17 + symbols;
    if (offset > end) return false;
  }
  return offset === end;
}

/** Offset just past the entropy-coded scan that starts at `offset`. */
function scanEnd(bytes: Uint8Array, offset: number): number | null {
  let index = offset;
  while (index < bytes.byteLength) {
    if (bytes[index] !== 0xff) {
      index += 1;
      continue;
    }
    if (index + 1 >= bytes.byteLength) return null;
    const next = bytes[index + 1];
    if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) {
      index += 2;
      continue;
    }
    return index;
  }
  return null;
}
