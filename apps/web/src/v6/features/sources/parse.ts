/**
 * V6-11 — parse progress and failure recovery (S02, 05-contracts §3 Source /
 * Chunk / SourceRef and §5 Job, C11 R1).
 *
 * This module turns the bytes V6-10 stored into locatable chunks and is the only
 * place that knows how a parse job moves through the five real stages:
 * upload → verify → extract_text → ocr_check → chunk.
 *
 * R1 has no background worker. A job runs inside this page for as long as the
 * page lives, and after every stage its output is saved as a checkpoint. A tab
 * that is closed, refreshed or put to sleep cannot continue the work: the job
 * becomes `interrupted` and can only be continued from the last saved stage, or
 * abandoned. A timer renews the lease only; progress moves
 * only when a real page or a real stage has finished, and a scanned PDF never
 * gains chunks it did not have.
 *
 * Persistence reuses V6-06 without changing it. Job transitions are written as
 * §10 activity rows through `LocalRepository.commit`, so they are version
 * checked and durable. The three things an activity row cannot carry — the full
 * `Job`, the per-stage checkpoint and the chunk set — are values in the
 * repository's own blobs store under a `parse/` key namespace. Those keys never
 * collide with an asset id, and no asset ever points at them. The receipt names
 * this decision: the V6-06 write set has no source/job store.
 *
 * Extractors are reused rather than reimplemented: TXT and DOCX go through
 * `apps/web/src/lib/extract.ts`; PDF page text uses the same pdf.js build and
 * options as that module, because page boundaries are needed here and
 * `extractFileText` returns one flat string. The hostile-input gate comes from
 * `packages/parsers/src/guard.ts`.
 */
import { extractFileText } from "../../../lib/extract.ts";
import { guardInput } from "../../../../../../packages/parsers/src/guard.ts";
import {
  CONTRACT_VERSION,
  STORES,
  sha256Hex,
  type ActivityRecord,
  type Actor,
  type AssetRecord,
  type LocalRepository,
  type MatterRecord,
  type StorageTransaction,
} from "../../lib/repository.ts";
import { classifyFile, isDocumentKind } from "./ingest.ts";

export type ParseStage = "upload" | "verify" | "extract_text" | "ocr_check" | "chunk";

/** The stages in the order the job runs them; upload is the asset V6-10 saved. */
export const PARSE_STAGES: readonly ParseStage[] = Object.freeze([
  "upload",
  "verify",
  "extract_text",
  "ocr_check",
  "chunk",
]);

/** Safe label for each stage; the UI only ever shows a real stage. */
export const STAGE_LABELS: Readonly<Record<ParseStage, string>> = Object.freeze({
  upload: "上传",
  verify: "校验文件",
  extract_text: "提取文字",
  ocr_check: "检查文字层",
  chunk: "切分段落",
});

export const STAGE_NOTES: Readonly<Record<ParseStage, string>> = Object.freeze({
  upload: "文件字节已保存在本机。",
  verify: "重新核对字节与记录是否一致，并检查文件类型。",
  extract_text: "在浏览器内提取文字，不发送到任何服务器。",
  ocr_check: "检查每一页是否有文字层。",
  chunk: "把文字切成可引用的段落，并记录页码。",
});

/**
 * Version of the parser pipeline. Chunks are written per (source, version): a
 * new version produces a new chunk set and leaves the old set readable for old
 * SourceRefs. It also names the "model" on a parse job, because no model runs.
 */
export const PARSER_VERSION = "v6-local-parser-1";
export const STAGE_VERSION = "v6-parse-stages-1";
/** Processing location recorded on the job; no processor receives the file. */
export const LOCAL_PROVIDER = "local-browser";

/** S02: a single document may not exceed 200 pages. */
export const DOCUMENT_MAX_PAGES = 200;

/**
 * No OCR provider is configured in this build; a scan therefore ends `partial`
 * with OCR_UNAVAILABLE and a manual supplement hint rather than a failed job.
 */
export const OCR_PROVIDER_AVAILABLE = false;

/** How long one page owns a running job before another page may treat it as lost. */
export const LEASE_MS = 60_000;

/**
 * What a page instance leaves behind when it unloads (a synchronous
 * sessionStorage write in `Parse.tsx`). It is the only accepted evidence that a
 * job whose lease is still live has lost its page: the session id alone is
 * shared by a duplicated tab, so it cannot tell "this page died" from
 * "another page with the same session is still running".
 */
export interface PageExitEvidence {
  /** Persistent tab session id; survives a reload and is copied by a duplicated tab. */
  sessionId: string;
  /** Memory-only id of the unloading page instance; never shared with a duplicate. */
  pageId: string;
  /** ISO time the page instance said goodbye. */
  at: string;
}

export type ParseErrorCode =
  | "UNSUPPORTED_MEDIA"
  | "MIME_MISMATCH"
  | "HASH_MISMATCH"
  | "PARSE_FAILED"
  | "PARSE_BUDGET_EXCEEDED"
  | "OCR_UNAVAILABLE"
  | "MISSING_BYTES"
  | "STORAGE_UNAVAILABLE"
  | "INVALID_INPUT";

/** §10-aligned copy. One sentence per code, so the UI cannot invent a story. */
export const PARSE_ERROR_MESSAGES: Readonly<Record<ParseErrorCode, string>> = Object.freeze({
  UNSUPPORTED_MEDIA: "这个文件类型不能在这里解析。请改用 PDF、DOCX、TXT 或 MD。",
  MIME_MISMATCH: "文件内容与声明的格式不一致，换个文件，或先另存为正确格式。",
  HASH_MISMATCH: "文件字节与保存时的记录不一致，无法确认解析的是同一份材料。",
  PARSE_FAILED: "解析没有完成：文件可能已损坏。另存后重试，或把文字粘贴进来。",
  PARSE_BUDGET_EXCEEDED: `单个文件超过 ${DOCUMENT_MAX_PAGES} 页上限，无法在本地解析。请拆分后重新上传。`,
  OCR_UNAVAILABLE: "部分页面没有文字层，本机没有配置 OCR。可以手动补充这些页面的文字。",
  MISSING_BYTES: "保存的文件字节找不到了，请重新上传这份材料。",
  STORAGE_UNAVAILABLE: "本机存储暂时不可用，解析结果没有保存。",
  INVALID_INPUT: "这份材料当前不能解析。",
});

export type JobState =
  | "queued"
  | "running"
  | "cancel_requested"
  | "cancelled"
  | "succeeded"
  | "failed"
  | "interrupted";

export type JobDisposition = "pending" | "ready" | "obsolete_result" | "adopted" | "discarded";

/**
 * The §5 `Job` as stored. Field order and nullability follow
 * `packages/contracts/src/jobs.ts`; the suite parses every stored row against
 * `jobSchema`, so this type cannot drift silently.
 */
export interface ParseJob {
  id: string;
  tenantId: string;
  matterId: string | null;
  targetId: string | null;
  version: number;
  kind: "parse";
  state: JobState;
  createdBy: string;
  input: null;
  baseDraftRevisionId: null;
  payloadHash: string;
  consentId: string | null;
  providerProfileId: string | null;
  providerProfileVersion: number | null;
  promptVersion: string;
  stageVersion: string;
  rulePackVersion: string | null;
  stage: string | null;
  attempt: number;
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
  progress: { completed: number; total: number | null; unit: "stage" | "page" | "file" };
  cancelRequestedAt: string | null;
  resultId: string | null;
  disposition: JobDisposition;
  errorCode: string | null;
  usageUnknown: boolean;
  createdAt: string;
}

/** What `verify` leaves behind. */
export interface VerifiedPayload {
  assetId: string;
  sha256: string;
  byteLength: number;
  kind: "pdf" | "docx" | "txt" | "md";
  mime: string;
  pageCount: number;
}

export interface ExtractedPage {
  page: number;
  text: string;
  hash: string;
}

export interface ExtractedPayload {
  pages: ExtractedPage[];
  pageCount: number;
}

export interface OcrPayload {
  ocrNeeded: boolean;
  pageCount: number;
  total: number;
}

export interface ChunkedPayload {
  chunkIds: string[];
  parserVersion: string;
  pageCount: number;
  hashes: string[];
}

export type CheckpointPayload = VerifiedPayload | ExtractedPayload | OcrPayload | ChunkedPayload;

/** One saved stage output; the unit of resume (C11). */
export interface ParseCheckpoint {
  kind: "parse.checkpoint";
  jobId: string;
  stage: ParseStage;
  completedAt: string;
  payload: CheckpointPayload;
}

/** The stored job row: the §5 job plus the parse links the contract has no field for. */
export interface ParseJobEnvelope {
  kind: "parse.job";
  job: ParseJob;
  sourceId: string;
  assetId: string;
  parserVersion: string;
  previousJobId: string | null;
  /** The first stage this job still had to run; null for a fresh parse. */
  resumedFromStage: ParseStage | null;
  abandonedAt: string | null;
  /**
   * Memory-only id of the page instance that started this job. A page-exit
   * marker from that same instance is the only positive proof that a still-live
   * lease has no owner left. Absent on jobs created by callers that pass no
   * page id; such a job can only be interrupted after its lease expires.
   */
  ownerPageId: string | null;
}

/** One chunk exactly as `chunkSchema` describes it. */
export interface ParseChunk {
  id: string;
  sourceId: string;
  parserVersion: string;
  index: number;
  kind: "paragraph" | "table" | "image" | "ocr_page";
  text: string;
  hash: string;
  page: number | null;
  rect: { x: number; y: number; w: number; h: number } | null;
  ocrConfidence: number | null;
}

/** One chunk set for one (source, parserVersion). A new version adds, never replaces. */
export interface ChunkSet {
  kind: "parse.chunks";
  sourceId: string;
  parserVersion: string;
  jobId: string;
  pageCount: number;
  createdAt: string;
  chunks: ParseChunk[];
}

/** §3 `Source` plus the parse bookkeeping this ticket needs. */
export interface ParseSourceRecord {
  kind: "parse.source";
  source: {
    id: string;
    matterId: string;
    assetId: string;
    retiredAt: string | null;
    parseStatus: "pending" | "parsing" | "parsed" | "partial" | "failed" | "cancelled";
    parserVersion: string | null;
    pageCount: number | null;
    ocrNeeded: boolean;
  };
  currentJobId: string | null;
  jobIds: string[];
  chunkSets: { parserVersion: string; jobId: string; chunkCount: number }[];
}

/** What a reload can see for one source, without running anything. */
export type SourceParseState =
  | {
      status: "pending";
      source: ParseSourceRecord["source"];
      job: null;
      jobs: ParseJobEnvelope[];
      checkpoints: [];
    }
  | {
      status: "running" | "parsed" | "partial" | "failed" | "cancelled" | "interrupted";
      source: ParseSourceRecord["source"];
      job: ParseJobEnvelope;
      jobs: ParseJobEnvelope[];
      checkpoints: ParseCheckpoint[];
    };

/** The row the UI renders; derived entirely from persisted state. */
export interface ParseRow {
  sourceId: string;
  assetId: string;
  name: string;
  /** R1/S02 display state; `interrupted` is the stale state. */
  state: SourceParseState["status"];
  jobId: string | null;
  jobState: JobState | null;
  stage: ParseStage | null;
  stageLabel: string | null;
  progress: ParseJob["progress"] | null;
  /** Position of the stage in the five real stages, 0 when nothing ran. */
  stageIndex: number;
  chunkCount: number;
  pageCount: number | null;
  ocrNeeded: boolean;
  errorCode: ParseErrorCode | null;
  errorMessage: string | null;
  /** The stage resume would continue from; null when resume is not offered. */
  resumeFrom: ParseStage | null;
  canStart: boolean;
  canCancel: boolean;
  canResume: boolean;
  canAbandon: boolean;
  canRetry: boolean;
  /** The real saved stages this job has, in stage order. */
  savedStages: ParseStage[];
}

export interface ParseView {
  rows: ParseRow[];
  pendingAssets: number;
  busy: boolean;
  running: boolean;
  /** S02 four states, plus `partial` and the R1 `stale` state. */
  state: "empty" | "ready" | "loading" | "error" | "stale" | "parsed";
}

export interface ParseProgressEvent {
  sourceId: string;
  jobId: string;
  stage: ParseStage;
  completed: number;
  total: number | null;
  unit: "stage" | "page" | "file";
}

export interface PdfPageText {
  page: number;
  text: string;
}

export interface ParseDeps {
  /** pdf.js, same build/options as `extract.ts`; injectable for a page-count stub. */
  loadPdfPages?: (bytes: Uint8Array) => Promise<PdfPageText[]>;
  /** DOCX/TXT text; defaults to the shared `extractFileText`. */
  extractText?: (bytes: Uint8Array, name: string, mime: string) => Promise<{ text: string | null; note: string }>;
  /** Hard cap on chunks per document. */
  maxChunks?: number;
  /** Longest paragraph chunk, in Unicode code points. */
  maxChunkChars?: number;
  leaseMs?: number;
  /** Schedule lease renewals; tests drive this with an injectable clock. Returns cleanup. */
  scheduleLeaseRenewal?: (renew: () => Promise<void>, intervalMs: number) => () => void;
  /**
   * Parser version to run under. New and retried jobs default to
   * PARSER_VERSION; a resume defaults to the interrupted job’s. A different
   * version writes a new chunk set and keeps the old one.
   */
  parserVersion?: string;
  now?: () => string;
  newId?: () => string;
  /** Owner token retained for the life of a tab, including reloads. */
  sessionId?: string;
  /**
   * Memory-only id of this page instance. Stored on a new job so a later page
   * can prove the owning instance exited; a reload always creates a new one.
   */
  pageId?: string;
  signal?: AbortSignal;
  onProgress?: (event: ParseProgressEvent) => void;
}

export type ParseOutcome =
  | {
      ok: true;
      sourceId: string;
      jobId: string;
      state: "parsed" | "partial";
      /** False when a resume found every remaining stage already saved. */
      run: boolean;
      chunkCount: number;
      pageCount: number;
      ocrNeeded: boolean;
      savedStages: ParseStage[];
    }
  | {
      ok: false;
      sourceId: string;
      jobId: string | null;
      state: "failed" | "cancelled" | "interrupted" | "storage_unavailable";
      errorCode: ParseErrorCode;
      savedStages: ParseStage[];
    };

export type ParseActionOutcome =
  | { ok: true; jobId: string; fromStage: ParseStage }
  | { ok: false; errorCode: ParseErrorCode };

// ---------------------------------------------------------------------------
// Deterministic ids
// ---------------------------------------------------------------------------

/**
 * A UUID-shaped id derived from a seed. Chunk and source ids must be the same
 * after a refresh for the same input, so they are hashes rather than random.
 * The version/variant nibbles are set the way `crypto.randomUUID()` sets them.
 */
export async function derivedId(seed: string): Promise<string> {
  const digest = await sha256Hex(new TextEncoder().encode(seed));
  const hex = digest.slice(0, 32).split("");
  hex[12] = "5";
  hex[16] = "8";
  const raw = hex.join("");
  return `${raw.slice(0, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}-${raw.slice(16, 20)}-${raw.slice(20, 32)}`;
}

/** The single Source for an asset; stable across every attempt. */
export function sourceIdFor(assetId: string): Promise<string> {
  return derivedId(`v6/source/${assetId}`);
}

export function chunkIdFor(sourceId: string, parserVersion: string, index: number): Promise<string> {
  return derivedId(`v6/chunk/${sourceId}/${parserVersion}/${index}`);
}

export function chunkSetKey(sourceId: string, parserVersion: string): string {
  return `parse/chunks/${sourceId}/${parserVersion}`;
}

// ---------------------------------------------------------------------------
// Storage keys
// ---------------------------------------------------------------------------

const SOURCE_KEY_PREFIX = "parse/source/";
const JOB_KEY_PREFIX = "parse/job/";
const CHECKPOINT_KEY_PREFIX = "parse/checkpoint/";

function sourceKey(sourceId: string): string {
  return `${SOURCE_KEY_PREFIX}${sourceId}`;
}

function jobKey(jobId: string): string {
  return `${JOB_KEY_PREFIX}${jobId}`;
}

function checkpointKey(jobId: string, stage: ParseStage): string {
  return `${CHECKPOINT_KEY_PREFIX}${jobId}/${stage}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asSourceRecord(value: unknown): ParseSourceRecord | null {
  return isRecord(value) && value.kind === "parse.source" && isRecord(value.source)
    ? (value as unknown as ParseSourceRecord)
    : null;
}

function asJobEnvelope(value: unknown): ParseJobEnvelope | null {
  return isRecord(value) && value.kind === "parse.job" && isRecord(value.job)
    ? (value as unknown as ParseJobEnvelope)
    : null;
}

function asCheckpoint(value: unknown): ParseCheckpoint | null {
  return isRecord(value) && value.kind === "parse.checkpoint" && typeof value.stage === "string"
    ? (value as unknown as ParseCheckpoint)
    : null;
}

function asChunkSet(value: unknown): ChunkSet | null {
  return isRecord(value) && value.kind === "parse.chunks" && Array.isArray(value.chunks)
    ? (value as unknown as ChunkSet)
    : null;
}

// ---------------------------------------------------------------------------
// Reading persisted state
// ---------------------------------------------------------------------------

interface StoredAggregateLike {
  matter: MatterRecord;
  targets: readonly unknown[];
  assets: readonly AssetRecord[];
}

function asStoredAggregate(value: unknown): StoredAggregateLike | null {
  if (!isRecord(value) || !isRecord(value.matter)) return null;
  if (!Array.isArray(value.targets) || !Array.isArray(value.assets)) return null;
  return value as unknown as StoredAggregateLike;
}

export interface MatterSourceSnapshot {
  matter: MatterRecord;
  assets: AssetRecord[];
  /** ParseSourceRecord keyed by assetId; an asset with no row is absent. */
  sources: Map<string, ParseSourceRecord>;
}

/** The status a reload shows when the job row itself does not decide it. */
function statusFromStored(
  stored: ParseSourceRecord["source"]["parseStatus"],
): Exclude<SourceParseState["status"], "pending"> {
  return stored === "pending" || stored === "parsing" ? "interrupted" : stored;
}

/** Every source asset of a matter with its persisted parse row, read-only. */
export async function readMatterSources(
  repository: LocalRepository,
  actor: Actor,
  matterId: string,
): Promise<{ ok: true; data: MatterSourceSnapshot } | { ok: false; errorCode: ParseErrorCode }> {
  try {
    return await repository.backend.transaction("readonly", async (tx) => {
      const stored = asStoredAggregate(await tx.get(STORES.matters, matterId));
      if (!stored || stored.matter.tenantId !== actor.tenantId || stored.matter.createdBy !== actor.userId) {
        return { ok: false as const, errorCode: "INVALID_INPUT" as const };
      }
      const sources = new Map<string, ParseSourceRecord>();
      for (const asset of stored.assets) {
        if (asset.purpose !== "source") continue;
        const row = asSourceRecord(await tx.get(STORES.blobs, sourceKey(await sourceIdFor(asset.id))));
        if (row) sources.set(asset.id, row);
      }
      return { ok: true as const, data: { matter: stored.matter, assets: [...stored.assets], sources } };
    });
  } catch {
    return { ok: false, errorCode: "STORAGE_UNAVAILABLE" };
  }
}

/**
 * What a reload can show for one source: the persisted `Source`, the latest job
 * and every saved checkpoint. A running job with an expired lease is interrupted.
 * The UI also recovers this tab's orphaned jobs immediately on load.
 */
export async function readParseState(
  repository: LocalRepository,
  actor: Actor,
  matterId: string,
  assetId: string,
  options: { sessionId?: string; now?: () => string } = {},
): Promise<SourceParseState | { status: "missing" } | { status: "storage_unavailable" }> {
  const now = options.now ?? (() => new Date().toISOString());
  const snapshot = await readMatterSources(repository, actor, matterId);
  if (!snapshot.ok) return { status: "storage_unavailable" };
  const asset = snapshot.data.assets.find((item) => item.id === assetId && item.purpose === "source");
  if (!asset) return { status: "missing" };
  const sourceId = await sourceIdFor(assetId);
  const row = snapshot.data.sources.get(assetId) ?? null;
  if (!row) {
    return {
      status: "pending",
      source: {
        id: sourceId,
        matterId,
        assetId,
        retiredAt: null,
        parseStatus: "pending",
        parserVersion: null,
        pageCount: null,
        ocrNeeded: false,
      },
      job: null,
      jobs: [],
      checkpoints: [],
    };
  }
  const history = await readJobHistory(repository, row);
  const latest = row.currentJobId === null ? null : await readJobEnvelope(repository, row.currentJobId);
  if (!latest) {
    // The row points at a job whose record is gone. Report a failed parse
    // rather than pretending the work never happened.
    return {
      status: "failed",
      source: { ...row.source, parseStatus: "failed" },
      job: missingJobEnvelope(row, row.currentJobId ?? sourceId, now()),
      jobs: history,
      checkpoints: [],
    };
  }
  const checkpoints = await readCheckpoints(repository, latest.job.id);
  const status = effectiveStatus(latest, options.sessionId, now(), row.source.parseStatus);
  return {
    status: status === "pending" ? statusFromStored(row.source.parseStatus) : status,
    source: row.source,
    job: latest,
    jobs: history,
    checkpoints: sortCheckpoints(checkpoints),
  };
}

/** A live lease is running for every reader; an expired lease is interrupted. */
export function effectiveStatus(
  job: ParseJobEnvelope,
  _sessionId: string | undefined,
  now: string,
  stored: ParseSourceRecord["source"]["parseStatus"],
): SourceParseState["status"] {
  const state = job.job.state;
  if (state === "running" || state === "queued" || state === "cancel_requested") {
    const live = job.job.leaseExpiresAt !== null && job.job.leaseExpiresAt > now;
    return live ? "running" : "interrupted";
  }
  if (state === "interrupted") return "interrupted";
  if (state === "succeeded") return stored === "partial" ? "partial" : "parsed";
  return state;
}

/**
 * Whether a job whose lease is still live may be durably marked `interrupted`.
 * A session id is copied into a duplicated or restored tab, so it proves
 * nothing by itself: the caller must present a page-exit marker written by the
 * very page instance that started this job, and the job must not have renewed
 * its lease after that exit. A later renewal means another page instance with
 * the same session still owns the job, so the marker is stale.
 */
export function orphanInterruptAllowed(
  state: SourceParseState,
  options: {
    sessionId?: string;
    orphanedJobId?: string;
    pageExit?: PageExitEvidence | null;
    leaseMs?: number;
  },
): boolean {
  if (state.status !== "running") return false;
  if (!("job" in state) || state.job === null) return false;
  const job = state.job.job;
  if (job.state !== "running") return false;
  if (job.id !== options.orphanedJobId) return false;
  if (options.sessionId === undefined || job.leaseOwner !== options.sessionId) return false;
  const exit = options.pageExit ?? null;
  if (exit === null || exit.sessionId !== options.sessionId) return false;
  const owner = state.job.ownerPageId;
  if (typeof owner !== "string" || owner.length === 0 || owner !== exit.pageId) return false;
  if (job.leaseExpiresAt === null) return false;
  const expiresAt = Date.parse(job.leaseExpiresAt);
  const exitedAt = Date.parse(exit.at);
  const leaseMs = options.leaseMs ?? LEASE_MS;
  if (!Number.isFinite(expiresAt) || !Number.isFinite(exitedAt) || !Number.isFinite(leaseMs)) return false;
  const renewedAt = expiresAt - leaseMs;
  return renewedAt <= exitedAt;
}

/** The job rows this source has had, oldest first. */
async function readJobHistory(repository: LocalRepository, row: ParseSourceRecord): Promise<ParseJobEnvelope[]> {
  const out: ParseJobEnvelope[] = [];
  for (const id of row.jobIds) {
    const envelope = await readJobEnvelope(repository, id);
    if (envelope) out.push(envelope);
  }
  return out.sort((a, b) => a.job.createdAt.localeCompare(b.job.createdAt) || a.job.id.localeCompare(b.job.id));
}

async function readCheckpoints(repository: LocalRepository, jobId: string): Promise<ParseCheckpoint[]> {
  try {
    return await repository.backend.transaction("readonly", async (tx) => {
      const saved: ParseCheckpoint[] = [];
      for (const stage of PARSE_STAGES) {
        const checkpoint = asCheckpoint(await tx.get(STORES.blobs, checkpointKey(jobId, stage)));
        if (checkpoint) saved.push(checkpoint);
      }
      return saved;
    });
  } catch {
    return [];
  }
}

async function readJobEnvelope(repository: LocalRepository, jobId: string): Promise<ParseJobEnvelope | null> {
  try {
    return await repository.backend.transaction("readonly", async (tx) => asJobEnvelope(await tx.get(STORES.blobs, jobKey(jobId))));
  } catch {
    return null;
  }
}

function missingJobEnvelope(row: ParseSourceRecord, jobId: string, now: string): ParseJobEnvelope {
  return {
    kind: "parse.job",
    job: {
      id: jobId,
      tenantId: "",
      matterId: row.source.matterId,
      targetId: null,
      version: 1,
      kind: "parse",
      state: "failed",
      createdBy: "",
      input: null,
      baseDraftRevisionId: null,
      payloadHash: "0".repeat(64),
      consentId: null,
      providerProfileId: null,
      providerProfileVersion: null,
      promptVersion: STAGE_VERSION,
      stageVersion: STAGE_VERSION,
      rulePackVersion: null,
      stage: null,
      attempt: 0,
      leaseOwner: null,
      leaseExpiresAt: null,
      progress: { completed: 0, total: null, unit: "stage" },
      cancelRequestedAt: null,
      resultId: null,
      disposition: "pending",
      errorCode: "PARSE_FAILED",
      usageUnknown: false,
      createdAt: now,
    },
    sourceId: row.source.id,
    assetId: row.source.assetId,
    parserVersion: PARSER_VERSION,
    previousJobId: null,
    resumedFromStage: null,
    abandonedAt: null,
    ownerPageId: null,
  };
}

function sortCheckpoints(checkpoints: readonly ParseCheckpoint[]): ParseCheckpoint[] {
  return [...checkpoints].sort((a, b) => PARSE_STAGES.indexOf(a.stage) - PARSE_STAGES.indexOf(b.stage));
}

export function savedStagesOf(checkpoints: readonly ParseCheckpoint[]): ParseStage[] {
  return sortCheckpoints(checkpoints).map((item) => item.stage);
}

export function nextStageAfter(checkpoints: readonly ParseCheckpoint[]): ParseStage | null {
  const saved = new Set(checkpoints.map((item) => item.stage));
  for (const stage of PARSE_STAGES) {
    if (stage === "upload") continue;
    if (!saved.has(stage)) return stage;
  }
  return null;
}

function lastStage(): ParseStage {
  return "chunk";
}

function countChunks(checkpoints: readonly ParseCheckpoint[]): number {
  for (const item of checkpoints) {
    if (item.stage === "chunk") return (item.payload as ChunkedPayload).chunkIds.length;
  }
  return 0;
}

function pageCountOf(checkpoints: readonly ParseCheckpoint[]): number {
  for (const item of checkpoints) {
    const payload = item.payload as { pageCount?: unknown };
    if (typeof payload.pageCount === "number") return payload.pageCount;
  }
  return 0;
}

function ocrOf(checkpoints: readonly ParseCheckpoint[]): boolean {
  for (const item of checkpoints) {
    if (item.stage === "ocr_check") return (item.payload as OcrPayload).ocrNeeded === true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Public actions
// ---------------------------------------------------------------------------

/**
 * Sources this module is starting or running a job for right now. Two
 * `parseSource` calls in the same page could otherwise both pass the persisted
 * live-lease check before either writes its job row. This set closes that
 * same-realm window; the persisted check below closes the opposite order and
 * the cross-tab case once the first job row exists.
 */
const startingSources = new Set<string>();

function sourceLockKey(actor: Actor, matterId: string, assetId: string): string {
  return `${actor.tenantId}\u0000${matterId}\u0000${assetId}`;
}

/**
 * Parse one of the matter's stored documents with a new job. An `interrupted`
 * job is continued through `resumeParse`, a failed or cancelled one through
 * `retryParse`; this function never resumes silently (C11).
 */
export async function parseSource(
  repository: LocalRepository,
  actor: Actor,
  matterId: string,
  assetId: string,
  deps: ParseDeps = {},
): Promise<ParseOutcome> {
  const now = deps.now ?? (() => new Date().toISOString());
  const newId = deps.newId ?? (() => globalThis.crypto.randomUUID());
  const sessionId = deps.sessionId ?? newId();
  const sourceId = await sourceIdFor(assetId);
  const lockKey = sourceLockKey(actor, matterId, assetId);
  if (startingSources.has(lockKey)) return failure(sourceId, null, "failed", "INVALID_INPUT", []);
  startingSources.add(lockKey);
  try {
    const loaded = await repository.loadMatter(actor, matterId);
    if (!loaded.ok) return failure(sourceId, null, "storage_unavailable", "STORAGE_UNAVAILABLE", []);
    const asset = loaded.data.data.assets.find((item) => item.id === assetId && item.purpose === "source");
    if (!asset) return failure(sourceId, null, "failed", "INVALID_INPUT", []);
    if (asset.state === "missing_bytes") return failure(sourceId, null, "failed", "MISSING_BYTES", []);
    if (asset.state !== "available") return failure(sourceId, null, "failed", "INVALID_INPUT", []);
    const ensured = await ensureSourceRecord(repository, loaded.data.data.matter, asset);
    if (!ensured.ok) return failure(sourceId, null, "storage_unavailable", ensured.errorCode, []);
    if (ensured.data.source.retiredAt !== null) return failure(sourceId, null, "failed", "INVALID_INPUT", []);
    // A job with a live lease owns this source (another tab, or a resume already
    // running). A second runner would race it, so refuse before writing a job.
    const current = await readParseState(repository, actor, matterId, assetId, { sessionId, now });
    if (current.status === "storage_unavailable") {
      return failure(sourceId, null, "storage_unavailable", "STORAGE_UNAVAILABLE", []);
    }
    if (current.status === "running") {
      return failure(sourceId, current.job.job.id, "interrupted", "INVALID_INPUT", savedStagesOf(current.checkpoints));
    }
    // Await the run so the same-realm lock covers the whole job, not just the
    // synchronous start. `return runJob(...)` would release it at once.
    return await runJob(repository, actor, loaded.data.data.matter, asset, sourceId, {
      deps,
      now,
      newId,
      sessionId,
      pageId: deps.pageId ?? null,
      previousJobId: null,
      checkpoints: [],
      fromStage: "verify",
      resumed: false,
      parserVersion: deps.parserVersion ?? PARSER_VERSION,
    });
  } finally {
    startingSources.delete(lockKey);
  }
}

/** Continue an interrupted job from its last saved stage (C11, S02-A05). */
export async function resumeParse(
  repository: LocalRepository,
  actor: Actor,
  matterId: string,
  assetId: string,
  deps: ParseDeps = {},
): Promise<ParseOutcome> {
  const now = deps.now ?? (() => new Date().toISOString());
  const newId = deps.newId ?? (() => globalThis.crypto.randomUUID());
  const sessionId = deps.sessionId ?? newId();
  const sourceId = await sourceIdFor(assetId);
  const state = await readParseState(repository, actor, matterId, assetId, { sessionId, now });
  if (state.status === "storage_unavailable") return failure(sourceId, null, "storage_unavailable", "STORAGE_UNAVAILABLE", []);
  if (state.status === "missing" || state.status === "pending") {
    return failure(sourceId, null, "failed", "INVALID_INPUT", []);
  }
  if (state.status === "failed" || state.status === "cancelled") {
    // A failed or abandoned job is finished; only retry (a new job) applies.
    return failure(sourceId, state.job.job.id, state.status, "INVALID_INPUT", savedStagesOf(state.checkpoints));
  }
  if (state.status === "running") {
    // A job that still owns a live lease is not interrupted; refuse rather than
    // run two pages over the same source.
    return failure(sourceId, state.job.job.id, "interrupted", "INVALID_INPUT", state.checkpoints.map((item) => item.stage));
  }
  const fromStage = state.status === "parsed" || state.status === "partial" ? null : nextStageAfter(state.checkpoints);
  if (fromStage === null) {
    return {
      ok: true,
      sourceId,
      jobId: state.job.job.id,
      state: state.source.parseStatus === "partial" ? "partial" : "parsed",
      run: false,
      chunkCount: countChunks(state.checkpoints),
      pageCount: pageCountOf(state.checkpoints),
      ocrNeeded: ocrOf(state.checkpoints),
      savedStages: savedStagesOf(state.checkpoints),
    };
  }
  const loaded = await repository.loadMatter(actor, matterId);
  if (!loaded.ok) return failure(sourceId, state.job.job.id, "storage_unavailable", "STORAGE_UNAVAILABLE", []);
  const asset = loaded.data.data.assets.find((item) => item.id === assetId);
  if (!asset) return failure(sourceId, state.job.job.id, "failed", "MISSING_BYTES", []);
  return runJob(repository, actor, loaded.data.data.matter, asset, sourceId, {
    deps,
    now,
    newId,
    sessionId,
    pageId: deps.pageId ?? null,
    previousJobId: state.job.job.id,
    checkpoints: state.checkpoints,
    fromStage,
    resumed: true,
    // A resume normally keeps the parser that produced the saved stages. When a
    // caller names a newer parser, the saved text stages are still valid and the
    // chunk stage writes a new set under the new version, keeping the old set.
    parserVersion: deps.parserVersion ?? state.job.parserVersion,
  });
}

/** Retry after a failed or cancelled job: always a new job (§5), never a rewind. */
export async function retryParse(
  repository: LocalRepository,
  actor: Actor,
  matterId: string,
  assetId: string,
  deps: ParseDeps = {},
): Promise<ParseOutcome> {
  const now = deps.now ?? (() => new Date().toISOString());
  const newId = deps.newId ?? (() => globalThis.crypto.randomUUID());
  const sessionId = deps.sessionId ?? newId();
  const sourceId = await sourceIdFor(assetId);
  const state = await readParseState(repository, actor, matterId, assetId, { sessionId, now });
  if (state.status === "storage_unavailable") return failure(sourceId, null, "storage_unavailable", "STORAGE_UNAVAILABLE", []);
  if (state.status === "missing" || state.status === "pending") return failure(sourceId, null, "failed", "INVALID_INPUT", []);
  if (state.status === "running") return failure(sourceId, state.job.job.id, "interrupted", "INVALID_INPUT", []);
  const loaded = await repository.loadMatter(actor, matterId);
  if (!loaded.ok) return failure(sourceId, state.job.job.id, "storage_unavailable", "STORAGE_UNAVAILABLE", []);
  const asset = loaded.data.data.assets.find((item) => item.id === assetId);
  if (!asset) return failure(sourceId, state.job.job.id, "failed", "MISSING_BYTES", []);
  return runJob(repository, actor, loaded.data.data.matter, asset, sourceId, {
    deps,
    now,
    newId,
    sessionId,
    pageId: deps.pageId ?? null,
    previousJobId: state.job.job.id,
    checkpoints: [],
    fromStage: "verify",
    resumed: false,
    parserVersion: deps.parserVersion ?? PARSER_VERSION,
  });
}

/**
 * Durably mark a running job whose owning page instance went away as
 * `interrupted`. There is no `job.interrupted` activity action in §10, so this
 * transitions the job row and the matter version without inventing an event;
 * the last real event stays the truthful one.
 *
 * A job whose lease has already expired is interrupted for every reader (C11),
 * so any page may persist that state. A job whose lease is still live is only
 * interrupted when the caller proves the owning page instance exited: a
 * `pageExit` marker that names the same session and the very page instance that
 * started the job, with no lease renewal after that exit.
 */
export async function markInterrupted(
  repository: LocalRepository,
  actor: Actor,
  matterId: string,
  assetId: string,
  options: {
    sessionId?: string;
    now?: () => string;
    newId?: () => string;
    orphanedJobId?: string;
    /** Positive evidence that the owning page instance unloaded. */
    pageExit?: PageExitEvidence | null;
    /** Lease length of the running job, for the "renewed after exit" check. */
    leaseMs?: number;
  } = {},
): Promise<{ ok: true; jobId: string; fromStage: ParseStage } | { ok: false; errorCode: ParseErrorCode }> {
  const now = options.now ?? (() => new Date().toISOString());
  const state = await readParseState(repository, actor, matterId, assetId, options);
  if (!("job" in state) || state.job === null) return { ok: false, errorCode: "INVALID_INPUT" };
  const job = state.job.job;
  const fromStage = () => nextStageAfter(state.checkpoints) ?? lastStage();
  if (state.status === "interrupted") {
    // Already durable: do not bump the version again on every mount.
    if (job.state === "interrupted") return { ok: true, jobId: job.id, fromStage: fromStage() };
  } else if (!orphanInterruptAllowed(state, options)) {
    return { ok: false, errorCode: "INVALID_INPUT" };
  }
  const next = await transitionStateOnly(repository, actor, matterId, assetId, {
    now,
    newId: options.newId,
    jobId: job.id,
    knownJob: job,
    patch: { state: "interrupted", leaseOwner: null, leaseExpiresAt: null, errorCode: null },
    sourceStatus: "failed",
  });
  if (!next.ok) return next;
  return { ok: true, jobId: job.id, fromStage: fromStage() };
}

/** Give up on an interrupted job. Nothing continues afterwards. */
export async function abandonParse(
  repository: LocalRepository,
  actor: Actor,
  matterId: string,
  assetId: string,
  options: { sessionId?: string; now?: () => string; newId?: () => string } = {},
): Promise<ParseActionOutcome> {
  const now = options.now ?? (() => new Date().toISOString());
  const state = await readParseState(repository, actor, matterId, assetId, options);
  if (state.status !== "interrupted") return { ok: false, errorCode: "INVALID_INPUT" };
  const next = await transitionStateOnly(repository, actor, matterId, assetId, {
    now,
    newId: options.newId,
    jobId: state.job.job.id,
    knownJob: state.job.job,
    patch: {
      state: "cancelled",
      leaseOwner: null,
      leaseExpiresAt: null,
      cancelRequestedAt: state.job.job.cancelRequestedAt ?? now(),
      disposition: "discarded",
    },
    sourceStatus: "cancelled",
    abandonedAt: now(),
  });
  return next.ok
    ? { ok: true, jobId: state.job.job.id, fromStage: nextStageAfter(state.checkpoints) ?? lastStage() }
    : next;
}

/** Stop a running job from this page. Stages that saved a checkpoint stay saved. */
export async function cancelParse(
  repository: LocalRepository,
  actor: Actor,
  matterId: string,
  assetId: string,
  options: { sessionId?: string; now?: () => string; newId?: () => string } = {},
): Promise<ParseActionOutcome> {
  const state = await readParseState(repository, actor, matterId, assetId, options);
  if (state.status !== "running") return { ok: false, errorCode: "INVALID_INPUT" };
  const next = await transitionStateOnly(repository, actor, matterId, assetId, {
    now: options.now ?? (() => new Date().toISOString()),
    newId: options.newId,
    jobId: state.job.job.id,
    knownJob: state.job.job,
    patch: {
      state: "cancelled",
      leaseOwner: null,
      leaseExpiresAt: null,
      cancelRequestedAt: (options.now ?? (() => new Date().toISOString()))(),
      disposition: "discarded",
      stage: state.job.job.stage,
    },
    sourceStatus: "cancelled",
  });
  return next.ok
    ? { ok: true, jobId: state.job.job.id, fromStage: nextStageAfter(state.checkpoints) ?? lastStage() }
    : next;
}

// ---------------------------------------------------------------------------
// The job runner
// ---------------------------------------------------------------------------

interface RunContext {
  deps: ParseDeps;
  now: () => string;
  newId: () => string;
  sessionId: string;
  /** Memory-only page instance that owns the new job; null when the caller has none. */
  pageId: string | null;
  previousJobId: string | null;
  checkpoints: ParseCheckpoint[];
  fromStage: ParseStage;
  /** True only for resumeParse: the job continues saved stages of `previousJobId`. */
  resumed: boolean;
  parserVersion: string;
}

async function runJob(
  repository: LocalRepository,
  actor: Actor,
  matter: MatterRecord,
  asset: AssetRecord,
  sourceId: string,
  context: RunContext,
): Promise<ParseOutcome> {
  const { deps, now, newId, sessionId } = context;
  const leaseMs = deps.leaseMs ?? LEASE_MS;
  const createdAt = now();
  const jobId = await derivedId(`v6/job/${sourceId}/${context.parserVersion}/${createdAt}/${newId()}`);
  const payloadHash = await sha256Hex(
    new TextEncoder().encode(`${context.parserVersion}\u0000${asset.sha256}\u0000${asset.byteLength}`),
  );
  const envelope: ParseJobEnvelope = {
    kind: "parse.job",
    job: {
      id: jobId,
      tenantId: matter.tenantId,
      matterId: matter.id,
      targetId: null,
      version: 1,
      kind: "parse",
      state: "queued",
      createdBy: actor.userId,
      input: null,
      baseDraftRevisionId: null,
      payloadHash,
      consentId: null,
      providerProfileId: null,
      providerProfileVersion: null,
      promptVersion: STAGE_VERSION,
      stageVersion: STAGE_VERSION,
      rulePackVersion: null,
      stage: "upload",
      attempt: context.previousJobId === null && context.checkpoints.length === 0 ? 0 : 1,
      leaseOwner: null,
      leaseExpiresAt: null,
      progress: { completed: 0, total: PARSE_STAGES.length, unit: "stage" },
      cancelRequestedAt: null,
      resultId: null,
      disposition: "pending",
      errorCode: null,
      usageUnknown: false,
      createdAt,
    },
    sourceId,
    assetId: asset.id,
    parserVersion: context.parserVersion,
    previousJobId: context.previousJobId,
    resumedFromStage: context.resumed ? context.fromStage : null,
    abandonedAt: null,
    ownerPageId: context.pageId,
  };

  const started = await commitTransition(repository, actor, matter.id, envelope, {
    now,
    newId,
    action: "job.started",
    state: "running",
    stage: context.fromStage,
    leaseOwner: sessionId,
    leaseExpiresAt: new Date(Date.parse(createdAt) + leaseMs).toISOString(),
    sourceStatus: "parsing",
  });
  if (!started.ok) return failure(sourceId, jobId, "storage_unavailable", started.errorCode, savedStagesOf(context.checkpoints));
  let current = started.data;
  let stopped = false;
  let leaseError: ParseErrorCode | null = null;
  let writes = Promise.resolve();
  const serialize = <T,>(action: () => Promise<T>): Promise<T> => {
    const next = writes.then(action);
    writes = next.then(() => undefined, () => undefined);
    return next;
  };
  let clearTimer = () => {};
  const stopLease = () => { stopped = true; clearTimer(); };
  const renew = () => serialize(async () => {
    if (stopped || deps.signal?.aborted) return;
    try {
      const renewed = await renewLease(repository, actor, matter.id, asset.id, current, context);
      if (renewed.ok) current = renewed.data;
      else leaseError = renewed.errorCode;
    } catch {
      leaseError = "STORAGE_UNAVAILABLE";
    }
    if (leaseError) stopLease();
  });
  clearTimer = (deps.scheduleLeaseRenewal ?? scheduleLeaseRenewal)(renew, Math.max(1, Math.floor(leaseMs / 3)));
  deps.signal?.addEventListener("abort", stopLease, { once: true });
  if (deps.signal?.aborted) stopLease();

  const carried = [...context.checkpoints];
  const byStage = new Map(carried.map((item) => [item.stage, item]));
  let verified = payloadOf<VerifiedPayload>(byStage.get("verify"));
  let extracted = payloadOf<ExtractedPayload>(byStage.get("extract_text"));
  let ocr = payloadOf<OcrPayload>(byStage.get("ocr_check"));
  let chunked = payloadOf<ChunkedPayload>(byStage.get("chunk"));

  // Progress is reported only once a stage is durably saved, so what the page
  // shows never runs ahead of what a refresh would find.
  let reported: ParseProgressEvent | null = null;
  const emit = (stage: ParseStage, completed: number, total: number | null, unit: "stage" | "page" | "file") => {
    reported = { sourceId, jobId, stage, completed, total, unit };
  };

  const leaseFailure = () => failure(sourceId, jobId,
    leaseError === "INVALID_INPUT" ? "interrupted" : "storage_unavailable",
    leaseError ?? "STORAGE_UNAVAILABLE", savedStagesOf(carried));
  const stopAndDrain = async () => { stopLease(); await writes; };
  const fail = async (stage: ParseStage, code: ParseErrorCode) => {
    await stopAndDrain();
    return leaseError ? leaseFailure() : failNow(repository, actor, matter.id, envelope, carried, now, current, stage, code);
  };
  const cancel = async () => {
    await stopAndDrain();
    return leaseError ? leaseFailure() : cancelNow(repository, actor, matter.id, envelope, carried, now, current);
  };

  const fromIndex = PARSE_STAGES.indexOf(context.fromStage);
  try {
  try {
    for (const stage of PARSE_STAGES) {
      if (stage === "upload") continue;
      if (PARSE_STAGES.indexOf(stage) < fromIndex) continue;
      if (byStage.has(stage)) continue;
      if (deps.signal?.aborted) return await cancel();
      if (leaseError) return leaseFailure();

      let payload: CheckpointPayload;
      switch (stage) {
        case "verify": {
          const outcome = await verifyAsset(repository, actor, asset, deps);
          if (!outcome.ok) return await fail(stage, outcome.errorCode);
          verified = outcome.data;
          payload = outcome.data;
          emit(stage, 1, 1, "stage");
          break;
        }
        case "extract_text": {
          if (!verified) return await fail(stage, "PARSE_FAILED");
          const outcome = await extractPages(repository, actor, verified, deps);
          if (!outcome.ok) return await fail(stage, outcome.errorCode);
          extracted = outcome.data;
          payload = outcome.data;
          emit(stage, outcome.data.pageCount, outcome.data.pageCount, "page");
          break;
        }
        case "ocr_check": {
          if (!extracted) return await fail(stage, "PARSE_FAILED");
          ocr = checkTextLayer(extracted);
          payload = ocr;
          emit(stage, extracted.pageCount, extracted.pageCount, "page");
          break;
        }
        case "chunk": {
          if (!extracted || !ocr) return await fail(stage, "PARSE_FAILED");
          const built = await buildChunkSet(sourceId, context.parserVersion, jobId, extracted, deps, now());
          if (!built.ok) return await fail(stage, built.errorCode);
          chunked = built.data.payload;
          payload = built.data.payload;
          const written = await writeChunkSet(repository, built.data.set);
          if (!written.ok) return failure(sourceId, jobId, "storage_unavailable", written.errorCode, savedStagesOf(carried));
          emit(stage, 1, 1, "stage");
          break;
        }
        default:
          return await fail(stage, "PARSE_FAILED");
      }

      if (deps.signal?.aborted) return await cancel();
      if (leaseError) return leaseFailure();
      const checkpoint: ParseCheckpoint = { kind: "parse.checkpoint", jobId, stage, completedAt: now(), payload };
      const wrote = await serialize(async () => {
        if (leaseError) return { ok: false as const, errorCode: leaseError };
        const saved = await renewLease(repository, actor, matter.id, asset.id, current, context, checkpoint);
        if (saved.ok) current = saved.data;
        return saved;
      });
      if (!wrote.ok) {
        if (wrote.errorCode === "INVALID_INPUT") {
          // Another page cancelled or superseded this job: stop without inventing
          // a result for a job that is no longer ours.
          return failure(sourceId, jobId, "interrupted", "INVALID_INPUT", savedStagesOf(carried));
        }
        return failure(sourceId, jobId, "storage_unavailable", wrote.errorCode, savedStagesOf(carried));
      }
      carried.push(checkpoint);
      byStage.set(stage, checkpoint);
      if (reported) deps.onProgress?.(reported);
      reported = null;
    }
  } catch {
    return await fail(nextStageAfter(carried) ?? lastStage(), "PARSE_FAILED");
  }

  await stopAndDrain();
  if (leaseError) return leaseFailure();
  if (deps.signal?.aborted) return await cancel();
  const needsOcr = ocr?.ocrNeeded ?? false;
  const pageCount = extracted?.pageCount ?? verified?.pageCount ?? 0;
  const chunkCount = chunked?.chunkIds.length ?? 0;
  const partial = needsOcr && !OCR_PROVIDER_AVAILABLE;

  const finished = await commitTransition(repository, actor, matter.id, envelope, {
    now,
    newId,
    action: "job.succeeded",
    state: "succeeded",
    stage: partial ? "ocr_check" : "chunk",
    // S02-A04: a scan has no text chunks to show. The success event names
    // OCR_UNAVAILABLE, and the source stays `partial` with no invented text.
    errorCode: partial ? "OCR_UNAVAILABLE" : null,
    progress: { completed: PARSE_STAGES.length, total: PARSE_STAGES.length, unit: "stage" },
    sourceStatus: partial ? "partial" : "parsed",
    parserVersion: context.parserVersion,
    pageCount,
    ocrNeeded: needsOcr,
    chunkSet: chunked ? { parserVersion: context.parserVersion, jobId, chunkCount } : null,
    resultId: chunked ? await derivedId(`v6/chunkset/${chunkSetKey(sourceId, context.parserVersion)}`) : null,
    knownJob: current,
  });
  if (!finished.ok) return failure(sourceId, jobId, "storage_unavailable", finished.errorCode, savedStagesOf(carried));
  return {
    ok: true,
    sourceId,
    jobId,
    state: partial ? "partial" : "parsed",
    run: true,
    chunkCount,
    pageCount,
    ocrNeeded: needsOcr,
    savedStages: savedStagesOf(carried),
  };
  } finally {
    stopLease();
    deps.signal?.removeEventListener("abort", stopLease);
    await writes;
  }
}

function payloadOf<T>(checkpoint: ParseCheckpoint | undefined): T | null {
  return checkpoint ? (checkpoint.payload as unknown as T) : null;
}

async function failNow(
  repository: LocalRepository,
  actor: Actor,
  matterId: string,
  envelope: ParseJobEnvelope,
  saved: readonly ParseCheckpoint[],
  now: () => string,
  current: ParseJob,
  stage: ParseStage,
  errorCode: ParseErrorCode,
): Promise<ParseOutcome> {
  const failed = await commitTransition(repository, actor, matterId, envelope, {
    now,
    newId: () => globalThis.crypto.randomUUID(),
    action: "job.failed",
    state: "failed",
    stage,
    errorCode,
    progress: { completed: PARSE_STAGES.indexOf(stage), total: PARSE_STAGES.length, unit: "stage" },
    sourceStatus: "failed",
    knownJob: current,
  });
  if (!failed.ok) return failure(envelope.sourceId, envelope.job.id, "storage_unavailable", failed.errorCode, savedStagesOf(saved));
  return failure(envelope.sourceId, envelope.job.id, "failed", errorCode, savedStagesOf(saved));
}

async function cancelNow(
  repository: LocalRepository,
  actor: Actor,
  matterId: string,
  envelope: ParseJobEnvelope,
  saved: readonly ParseCheckpoint[],
  now: () => string,
  current: ParseJob,
): Promise<ParseOutcome> {
  const cancelled = await commitTransition(repository, actor, matterId, envelope, {
    now,
    newId: () => globalThis.crypto.randomUUID(),
    action: "job.cancelled",
    state: "cancelled",
    stage: nextStageAfter(saved) ?? lastStage(),
    progress: current.progress,
    sourceStatus: "cancelled",
    knownJob: current,
  });
  if (!cancelled.ok) {
    return failure(envelope.sourceId, envelope.job.id, "storage_unavailable", cancelled.errorCode, savedStagesOf(saved));
  }
  return failure(envelope.sourceId, envelope.job.id, "cancelled", "INVALID_INPUT", savedStagesOf(saved));
}

function failure(
  sourceId: string,
  jobId: string | null,
  state: Extract<ParseOutcome, { ok: false }>["state"],
  errorCode: ParseErrorCode,
  savedStages: ParseStage[],
): ParseOutcome {
  return { ok: false, sourceId, jobId, state, errorCode, savedStages };
}

// ---------------------------------------------------------------------------
// Stage 2 — verify
// ---------------------------------------------------------------------------

async function verifyAsset(
  repository: LocalRepository,
  actor: Actor,
  asset: AssetRecord,
  deps: ParseDeps,
): Promise<{ ok: true; data: VerifiedPayload } | { ok: false; errorCode: ParseErrorCode }> {
  const read = await repository.readBlob(actor, asset.id);
  if (!read.ok) {
    return { ok: false, errorCode: read.error.code === "HASH_MISMATCH" ? "HASH_MISMATCH" : "MISSING_BYTES" };
  }
  const bytes = read.data.data.bytes;
  if (bytes.byteLength !== asset.byteLength || (await sha256Hex(bytes)) !== asset.sha256) {
    return { ok: false, errorCode: "HASH_MISMATCH" };
  }
  const classification = classifyFile({ bytes, name: asset.originalName, declaredType: asset.mime });
  if (!classification.ok) return { ok: false, errorCode: normalizeClassifyCode(classification.code) };
  if (!isDocumentKind(classification.kind)) {
    // An image is a drawing, not something this pipeline turns into text.
    return { ok: false, errorCode: "UNSUPPORTED_MEDIA" };
  }
  const limits: GuardLimits = {
    maxBytes: Math.max(asset.byteLength, 1),
    maxPages: DOCUMENT_MAX_PAGES,
    maxChunks: 20_000,
    maxZipRatio: 200,
  };
  try {
    const rejection = await runGuard(bytes, asset.originalName, limits);
    if (rejection) return { ok: false, errorCode: normalizeGuardReason(rejection.reason) };
  } catch {
    return { ok: false, errorCode: "PARSE_FAILED" };
  }

  let pageCount = 1;
  if (classification.kind === "pdf") {
    const pdf = await loadPdfPages(bytes, deps);
    if (!pdf.ok) return pdf;
    pageCount = pdf.pageCount;
  }
  if (pageCount > DOCUMENT_MAX_PAGES) return { ok: false, errorCode: "PARSE_BUDGET_EXCEEDED" };
  return {
    ok: true,
    data: {
      assetId: asset.id,
      sha256: asset.sha256,
      byteLength: asset.byteLength,
      kind: classification.kind,
      mime: classification.mime,
      pageCount,
    },
  };
}

interface GuardLimits {
  maxBytes: number;
  maxPages: number;
  maxChunks: number;
  maxZipRatio: number;
}

interface GuardRejection {
  reason: "TOO_LARGE" | "ZIP_BOMB" | "UNSUPPORTED_TYPE" | "MACRO_OR_SCRIPT_DETECTED" | "PATH_TRAVERSAL" | "PARSE_FAILED";
  message: string;
}

/**
 * The shared hostile-input gate from `packages/parsers/src/guard.ts`, imported
 * by file because the package index re-exports with `.js` specifiers that
 * Node's type stripping cannot follow.
 */
async function runGuard(bytes: Uint8Array, fileName: string, limits: GuardLimits): Promise<GuardRejection | null> {
  const copy = bytes.slice().buffer as ArrayBuffer;
  return guardInput(copy, { fileName, limits }) as GuardRejection | null;
}

function normalizeClassifyCode(code: string): ParseErrorCode {
  switch (code) {
    case "MIME_MISMATCH":
      return "MIME_MISMATCH";
    case "UNSUPPORTED_MEDIA":
      return "UNSUPPORTED_MEDIA";
    case "FILE_TOO_LARGE":
    case "IMAGE_TOO_LARGE":
      return "PARSE_BUDGET_EXCEEDED";
    default:
      return "INVALID_INPUT";
  }
}

function normalizeGuardReason(reason: string): ParseErrorCode {
  switch (reason) {
    case "TOO_LARGE":
      return "PARSE_BUDGET_EXCEEDED";
    case "UNSUPPORTED_TYPE":
    case "MACRO_OR_SCRIPT_DETECTED":
      return "UNSUPPORTED_MEDIA";
    default:
      return "PARSE_FAILED";
  }
}

// ---------------------------------------------------------------------------
// Stage 3 — extract_text
// ---------------------------------------------------------------------------

async function extractPages(
  repository: LocalRepository,
  actor: Actor,
  verified: VerifiedPayload,
  deps: ParseDeps,
): Promise<{ ok: true; data: ExtractedPayload } | { ok: false; errorCode: ParseErrorCode }> {
  const read = await repository.readBlob(actor, verified.assetId);
  if (!read.ok) {
    return { ok: false, errorCode: read.error.code === "HASH_MISMATCH" ? "HASH_MISMATCH" : "MISSING_BYTES" };
  }
  const bytes = read.data.data.bytes;
  if (verified.kind === "pdf") {
    const pdf = await loadPdfPages(bytes, deps);
    if (!pdf.ok) return pdf;
    if (pdf.pages.length !== verified.pageCount) return { ok: false, errorCode: "PARSE_FAILED" };
    const pages: ExtractedPage[] = [];
    for (const page of pdf.pages) {
      const text = normalizeText(page.text);
      pages.push({ page: page.page, text, hash: await sha256Hex(new TextEncoder().encode(text)) });
    }
    return { ok: true, data: { pages, pageCount: pdf.pages.length } };
  }
  const extract = deps.extractText ?? defaultExtractText;
  let result: { text: string | null; note: string };
  try {
    result = await extract(bytes, fileNameFor(verified.kind), verified.mime);
  } catch {
    return { ok: false, errorCode: "PARSE_FAILED" };
  }
  if (result.text === null) {
    // DOCX/TXT/MD without text is a hard failure; only a PDF can be a scan, and
    // that path uses pdf.js above.
    return { ok: false, errorCode: "PARSE_FAILED" };
  }
  const text = normalizeText(result.text);
  return {
    ok: true,
    data: {
      pages: [{ page: 1, text, hash: await sha256Hex(new TextEncoder().encode(text)) }],
      pageCount: 1,
    },
  };
}

async function defaultExtractText(
  bytes: Uint8Array,
  name: string,
  mime: string,
): Promise<{ text: string | null; note: string }> {
  const file = new File([bytes as unknown as BlobPart], name, { type: mime });
  return extractFileText(file);
}

function fileNameFor(kind: VerifiedPayload["kind"]): string {
  return kind === "pdf" ? "source.pdf" : kind === "docx" ? "source.docx" : kind === "md" ? "source.md" : "source.txt";
}

// ---------------------------------------------------------------------------
// PDF page text — same pdf.js build and options as `extract.ts`
// ---------------------------------------------------------------------------

export async function loadPdfPagesDefault(bytes: Uint8Array): Promise<PdfPageText[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.min.mjs");
  // The worker is an asset beside the app bundle. In Node (the scenario suite)
  // there is no asset URL to point at and pdf.js runs its in-process worker, so
  // the assignment is skipped there rather than resolving a file that cannot exist.
  if (typeof document !== "undefined") {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/legacy/build/pdf.worker.min.mjs",
      import.meta.url,
    ).toString();
  }
  const doc = await pdfjs.getDocument({
    data: bytes,
    useSystemFonts: true,
    isEvalSupported: false,
  }).promise;
  const pages: PdfPageText[] = [];
  for (let page = 1; page <= doc.numPages; page += 1) {
    const view = await doc.getPage(page);
    const content = await view.getTextContent();
    const text = content.items
      .map((item: { str?: string; hasEOL?: boolean }) =>
        "str" in item ? `${item.str ?? ""}${item.hasEOL ? "\n" : ""}` : "",
      )
      .join("");
    pages.push({ page, text });
  }
  if (typeof (doc as { destroy?: () => void }).destroy === "function") void doc.destroy();
  else void doc.cleanup();
  return pages;
}

async function loadPdfPages(
  bytes: Uint8Array,
  deps: ParseDeps,
): Promise<{ ok: true; pages: PdfPageText[]; pageCount: number } | { ok: false; errorCode: ParseErrorCode }> {
  try {
    const pages = await (deps.loadPdfPages ?? loadPdfPagesDefault)(bytes);
    if (!Array.isArray(pages) || pages.length === 0) return { ok: false, errorCode: "PARSE_FAILED" };
    return { ok: true, pages, pageCount: pages.length };
  } catch {
    return { ok: false, errorCode: "PARSE_FAILED" };
  }
}

// ---------------------------------------------------------------------------
// Stage 4 — ocr_check
// ---------------------------------------------------------------------------

function checkTextLayer(extracted: ExtractedPayload): OcrPayload {
  const total = extracted.pages.reduce((count, page) => (page.text.length > 0 ? count + 1 : count), 0);
  return { ocrNeeded: total < extracted.pageCount, pageCount: extracted.pageCount, total };
}

// ---------------------------------------------------------------------------
// Stage 5 — chunk
// ---------------------------------------------------------------------------

const DEFAULT_MAX_CHUNK_CHARS = 2_000;
const DEFAULT_MAX_CHUNKS = 20_000;

async function buildChunkSet(
  sourceId: string,
  parserVersion: string,
  jobId: string,
  extracted: ExtractedPayload,
  deps: ParseDeps,
  createdAt: string,
): Promise<{ ok: true; data: { payload: ChunkedPayload; set: ChunkSet } } | { ok: false; errorCode: ParseErrorCode }> {
  const maxChars = deps.maxChunkChars ?? DEFAULT_MAX_CHUNK_CHARS;
  const maxChunks = deps.maxChunks ?? DEFAULT_MAX_CHUNKS;
  const chunks: ParseChunk[] = [];
  for (const page of extracted.pages) {
    if (page.text.length === 0) continue;
    for (const part of splitParagraphs(page.text, maxChars)) {
      if (chunks.length >= maxChunks) return { ok: false, errorCode: "PARSE_BUDGET_EXCEEDED" };
      const index = chunks.length;
      chunks.push({
        id: await chunkIdFor(sourceId, parserVersion, index),
        sourceId,
        parserVersion,
        index,
        kind: "paragraph",
        text: part,
        hash: await sha256Hex(new TextEncoder().encode(part)),
        page: page.page,
        rect: null,
        ocrConfidence: null,
      });
    }
  }
  return {
    ok: true,
    data: {
      payload: {
        chunkIds: chunks.map((chunk) => chunk.id),
        parserVersion,
        pageCount: extracted.pageCount,
        hashes: chunks.map((chunk) => chunk.hash),
      },
      set: { kind: "parse.chunks", sourceId, parserVersion, jobId, pageCount: extracted.pageCount, createdAt, chunks },
    },
  };
}

/** NFC first, unified newlines, then per-line whitespace; offsets follow this text. */
export function normalizeText(raw: string): string {
  const unified = raw.replace(/\r\n?/g, "\n").normalize("NFC");
  const lines = unified.split("\n").map((line) => line.replace(/[ \t ]+/g, " ").trim());
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * One paragraph per non-empty line or blank-line block, capped at `maxChars`
 * with a sentence boundary when there is one. A chunk is never empty.
 */
export function splitParagraphs(text: string, maxChars: number): string[] {
  if (text.length === 0) return [];
  const blocks = text
    .split(/\n{2,}/)
    .flatMap((block) => block.split("\n"))
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  const out: string[] = [];
  for (const block of blocks) {
    if (block.length <= maxChars) {
      out.push(block);
      continue;
    }
    let rest = block;
    while (rest.length > maxChars) {
      const window = rest.slice(0, maxChars);
      const cut = Math.max(
        window.lastIndexOf("。"),
        window.lastIndexOf("！"),
        window.lastIndexOf("？"),
        window.lastIndexOf(". "),
        window.lastIndexOf("; "),
      );
      const at = cut > maxChars / 2 ? cut + 1 : maxChars;
      const head = rest.slice(0, at).trim();
      if (head.length > 0) out.push(head);
      rest = rest.slice(at).trim();
    }
    if (rest.length > 0) out.push(rest);
  }
  return out.filter((part) => part.length > 0);
}

/**
 * The half-open code-point range of `quote` inside `text`, or null when the
 * quote is not there. This is the only way this module builds a SourceRef, so
 * the range and the quote can never disagree.
 */
export function locateQuote(text: string, quote: string): { start: number; end: number } | null {
  const codePoints = Array.from(text);
  const target = Array.from(quote.normalize("NFC"));
  if (target.length === 0) return null;
  outer: for (let start = 0; start + target.length <= codePoints.length; start += 1) {
    for (let offset = 0; offset < target.length; offset += 1) {
      if (codePoints[start + offset] !== target[offset]) continue outer;
    }
    return { start, end: start + target.length };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Persistence: one matter commit per transition, then the parse blobs
// ---------------------------------------------------------------------------

type BlobPut = (store: string, key: string, value: unknown) => Promise<void>;

function putter(tx: StorageTransaction): BlobPut {
  return tx.put as unknown as BlobPut;
}

async function writeBlobs(repository: LocalRepository, writes: readonly { key: string; value: unknown }[]): Promise<boolean> {
  try {
    await repository.backend.transaction("readwrite", async (tx) => {
      const put = putter(tx);
      for (const write of writes) await put(STORES.blobs, write.key, write.value);
    });
    return true;
  } catch {
    return false;
  }
}

/** Check the job version again inside the write transaction; never revive a cancelled job. */
async function writeJobBlobs(
  repository: LocalRepository,
  jobId: string,
  expectedVersion: number | null,
  writes: readonly { key: string; value: unknown }[],
): Promise<{ ok: true } | { ok: false; errorCode: ParseErrorCode }> {
  try {
    return await repository.backend.transaction("readwrite", async (tx) => {
      const stored = asJobEnvelope(await tx.get(STORES.blobs, jobKey(jobId)));
      if ((stored?.job.version ?? null) !== expectedVersion) return { ok: false as const, errorCode: "INVALID_INPUT" as const };
      const put = putter(tx);
      for (const write of writes) await put(STORES.blobs, write.key, write.value);
      return { ok: true as const };
    });
  } catch {
    return { ok: false, errorCode: "STORAGE_UNAVAILABLE" };
  }
}

interface TransitionOptions {
  now: () => string;
  newId: () => string;
  action: "job.started" | "job.succeeded" | "job.failed" | "job.cancelled";
  state: JobState;
  stage: ParseStage;
  errorCode?: ParseErrorCode | null;
  progress?: ParseJob["progress"];
  sourceStatus?: ParseSourceRecord["source"]["parseStatus"];
  parserVersion?: string;
  pageCount?: number;
  ocrNeeded?: boolean;
  chunkSet?: { parserVersion: string; jobId: string; chunkCount: number } | null;
  leaseOwner?: string | null;
  leaseExpiresAt?: string | null;
  resultId?: string | null;
  knownJob?: ParseJob;
}

function metadataFor(options: TransitionOptions): ActivityRecord["metadata"] {
  switch (options.action) {
    case "job.started":
      return { stage: options.stage, provider: LOCAL_PROVIDER, model: PARSER_VERSION };
    case "job.succeeded":
      return {
        stage: options.stage,
        count: options.chunkSet?.chunkCount ?? 0,
        provider: LOCAL_PROVIDER,
        model: options.parserVersion ?? PARSER_VERSION,
      };
    case "job.failed":
      return {
        stage: options.stage,
        errorCode: options.errorCode ?? "PARSE_FAILED",
        provider: LOCAL_PROVIDER,
        model: PARSER_VERSION,
      };
    case "job.cancelled":
      return { stage: options.stage };
  }
}

function nextJobRow(previous: ParseJob, options: TransitionOptions): ParseJob {
  return {
    ...previous,
    version: previous.version + 1,
    state: options.state,
    stage: options.stage,
    progress: options.progress ?? previous.progress,
    errorCode: options.errorCode ?? null,
    leaseOwner: options.leaseOwner ?? null,
    leaseExpiresAt: options.leaseExpiresAt ?? null,
    resultId: options.resultId ?? null,
    disposition:
      options.state === "succeeded"
        ? "ready"
        : options.state === "failed" || options.state === "cancelled"
          ? "discarded"
          : "pending",
    cancelRequestedAt: options.state === "cancelled" ? options.now() : previous.cancelRequestedAt,
  };
}

/**
 * One durable transition: the matter version bump and its §10 event commit
 * atomically first, then the job and source rows. If the commit loses a version
 * race the transition is retried from the freshly loaded state; if it wins, the
 * row content is already derived, so the blobs are written once.
 */
async function commitTransition(
  repository: LocalRepository,
  actor: Actor,
  matterId: string,
  envelope: ParseJobEnvelope,
  options: TransitionOptions,
): Promise<{ ok: true; data: ParseJob } | { ok: false; errorCode: ParseErrorCode }> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const loaded = await repository.loadMatter(actor, matterId);
    if (!loaded.ok) return { ok: false, errorCode: "STORAGE_UNAVAILABLE" };
    const stored = await readJobEnvelope(repository, envelope.job.id);
    const previous = stored?.job ?? options.knownJob ?? envelope.job;
    if (options.knownJob !== undefined && stored !== null && stored.job.version !== options.knownJob.version) {
      return { ok: false, errorCode: "INVALID_INPUT" };
    }
    const at = options.now();
    const next = nextJobRow(previous, options);
    const nextEnvelope: ParseJobEnvelope = { ...(stored ?? envelope), job: next };
    const event: ActivityRecord = {
      id: options.newId(),
      tenantId: loaded.data.data.matter.tenantId,
      matterId: loaded.data.data.matter.id,
      targetId: null,
      actorId: actor.userId,
      actorKind: "user",
      action: options.action,
      snapshot: null,
      jobId: next.id,
      resourceId: next.id,
      occurredAt: at,
      metadata: metadataFor(options),
    };
    const committed = await repository.commit(
      actor,
      {
        contractVersion: CONTRACT_VERSION,
        expectedVersion: loaded.data.data.matter.version,
        payload: {
          matter: { ...loaded.data.data.matter, version: loaded.data.data.matter.version + 1, updatedAt: at },
          targets: loaded.data.data.targets,
          assets: loaded.data.data.assets,
          events: [event],
          blobs: [],
        },
      },
      { requestId: options.newId() },
    );
    if (!committed.ok) {
      if (committed.error.code === "VERSION_CONFLICT") continue;
      return { ok: false, errorCode: "STORAGE_UNAVAILABLE" };
    }
    const row = await readSourceRecord(repository, envelope.sourceId);
    if (!row.ok) return { ok: false, errorCode: row.errorCode };
    const nextSource = mergeSourceRecord(row.data, {
      sourceId: envelope.sourceId,
      matterId,
      assetId: envelope.assetId,
      status: options.sourceStatus ?? null,
      parserVersion: options.parserVersion ?? null,
      pageCount: options.pageCount ?? null,
      ocrNeeded: options.ocrNeeded ?? null,
      jobId: next.id,
      chunkSet: options.chunkSet ?? null,
    });
    const wrote = await writeJobBlobs(repository, next.id, stored?.job.version ?? null, [
      { key: jobKey(next.id), value: nextEnvelope },
      { key: sourceKey(envelope.sourceId), value: nextSource },
    ]);
    if (!wrote.ok) return wrote;
    return { ok: true, data: next };
  }
  return { ok: false, errorCode: "STORAGE_UNAVAILABLE" };
}

/**
 * A transition with no §10 event: `interrupted` has no activity action, and an
 * abandoned job must not pretend to have been cancelled by the user. Still one
 * atomic matter version bump, so two pages cannot both own the transition.
 */
async function transitionStateOnly(
  repository: LocalRepository,
  actor: Actor,
  matterId: string,
  assetId: string,
  options: {
    now: () => string;
    newId?: () => string;
    jobId: string;
    knownJob: ParseJob;
    patch: Partial<ParseJob>;
    sourceStatus: ParseSourceRecord["source"]["parseStatus"];
    abandonedAt?: string;
    checkpoint?: ParseCheckpoint;
  },
): Promise<{ ok: true; data: ParseJob } | { ok: false; errorCode: ParseErrorCode }> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const loaded = await repository.loadMatter(actor, matterId);
    if (!loaded.ok) return { ok: false, errorCode: "STORAGE_UNAVAILABLE" };
    const envelope = await readJobEnvelope(repository, options.jobId);
    if (!envelope) return { ok: false, errorCode: "STORAGE_UNAVAILABLE" };
    if (envelope.job.version !== options.knownJob.version) return { ok: false, errorCode: "INVALID_INPUT" };
    const at = options.now();
    const nextEnvelope: ParseJobEnvelope = {
      ...envelope,
      job: { ...envelope.job, ...options.patch, version: envelope.job.version + 1 },
      abandonedAt: options.abandonedAt ?? envelope.abandonedAt,
    };
    const committed = await repository.commit(
      actor,
      {
        contractVersion: CONTRACT_VERSION,
        expectedVersion: loaded.data.data.matter.version,
        payload: {
          matter: { ...loaded.data.data.matter, version: loaded.data.data.matter.version + 1, updatedAt: at },
          targets: loaded.data.data.targets,
          assets: loaded.data.data.assets,
          events: [],
          blobs: [],
        },
      },
      { requestId: (options.newId ?? (() => globalThis.crypto.randomUUID()))() },
    );
    if (!committed.ok) {
      if (committed.error.code === "VERSION_CONFLICT") continue;
      return { ok: false, errorCode: "STORAGE_UNAVAILABLE" };
    }
    const sourceId = await sourceIdFor(assetId);
    const row = await readSourceRecord(repository, sourceId);
    if (!row.ok) return { ok: false, errorCode: row.errorCode };
    const nextSource = mergeSourceRecord(row.data, {
      sourceId,
      matterId,
      assetId,
      status: options.sourceStatus,
      parserVersion: null,
      pageCount: null,
      ocrNeeded: null,
      jobId: options.jobId,
      chunkSet: null,
    });
    const wrote = await writeJobBlobs(repository, options.jobId, envelope.job.version, [
      { key: jobKey(options.jobId), value: nextEnvelope },
      { key: sourceKey(sourceId), value: nextSource },
      ...(options.checkpoint ? [{ key: checkpointKey(options.jobId, options.checkpoint.stage), value: options.checkpoint }] : []),
    ]);
    if (!wrote.ok) return wrote;
    return { ok: true, data: nextEnvelope.job };
  }
  return { ok: false, errorCode: "STORAGE_UNAVAILABLE" };
}

async function readSourceRecord(
  repository: LocalRepository,
  sourceId: string,
): Promise<{ ok: true; data: ParseSourceRecord | null } | { ok: false; errorCode: ParseErrorCode }> {
  try {
    const value = await repository.backend.transaction("readonly", async (tx) =>
      tx.get(STORES.blobs, sourceKey(sourceId)),
    );
    return { ok: true, data: asSourceRecord(value) };
  } catch {
    return { ok: false, errorCode: "STORAGE_UNAVAILABLE" };
  }
}

async function ensureSourceRecord(
  repository: LocalRepository,
  matter: MatterRecord,
  asset: AssetRecord,
): Promise<{ ok: true; data: ParseSourceRecord } | { ok: false; errorCode: ParseErrorCode }> {
  const sourceId = await sourceIdFor(asset.id);
  const existing = await readSourceRecord(repository, sourceId);
  if (!existing.ok) return existing;
  if (existing.data) return { ok: true, data: existing.data };
  const record: ParseSourceRecord = {
    kind: "parse.source",
    source: {
      id: sourceId,
      matterId: matter.id,
      assetId: asset.id,
      retiredAt: null,
      parseStatus: "pending",
      parserVersion: null,
      pageCount: null,
      ocrNeeded: false,
    },
    currentJobId: null,
    jobIds: [],
    chunkSets: [],
  };
  const wrote = await writeBlobs(repository, [{ key: sourceKey(sourceId), value: record }]);
  return wrote ? { ok: true, data: record } : { ok: false, errorCode: "STORAGE_UNAVAILABLE" };
}

function mergeSourceRecord(
  existing: ParseSourceRecord | null,
  update: {
    sourceId: string;
    matterId: string;
    assetId: string;
    status: ParseSourceRecord["source"]["parseStatus"] | null;
    parserVersion: string | null;
    pageCount: number | null;
    ocrNeeded: boolean | null;
    jobId: string;
    chunkSet: { parserVersion: string; jobId: string; chunkCount: number } | null;
  },
): ParseSourceRecord {
  const base: ParseSourceRecord = existing ?? {
    kind: "parse.source",
    source: {
      id: update.sourceId,
      matterId: update.matterId,
      assetId: update.assetId,
      retiredAt: null,
      parseStatus: "pending",
      parserVersion: null,
      pageCount: null,
      ocrNeeded: false,
    },
    currentJobId: null,
    jobIds: [],
    chunkSets: [],
  };
  const jobIds = base.jobIds.includes(update.jobId) ? base.jobIds : [...base.jobIds, update.jobId];
  const chunkSets = update.chunkSet
    ? base.chunkSets.some((item) => item.parserVersion === update.chunkSet?.parserVersion)
      ? base.chunkSets
      : [...base.chunkSets, update.chunkSet]
    : base.chunkSets;
  return {
    ...base,
    source: {
      ...base.source,
      parseStatus: update.status ?? base.source.parseStatus,
      parserVersion: update.parserVersion ?? base.source.parserVersion,
      pageCount: update.pageCount ?? base.source.pageCount,
      ocrNeeded: update.ocrNeeded ?? base.source.ocrNeeded,
    },
    currentJobId: update.jobId,
    jobIds,
    chunkSets,
  };
}

/** Renew ownership, optionally saving a real stage, through the version-checked commit. */
async function renewLease(
  repository: LocalRepository,
  actor: Actor,
  matterId: string,
  assetId: string,
  current: ParseJob,
  context: RunContext,
  checkpoint?: ParseCheckpoint,
): Promise<{ ok: true; data: ParseJob } | { ok: false; errorCode: ParseErrorCode }> {
  if (current.state !== "running" || current.leaseOwner !== context.sessionId) {
    return { ok: false, errorCode: "INVALID_INPUT" };
  }
  return transitionStateOnly(repository, actor, matterId, assetId, {
    now: context.now,
    newId: context.newId,
    jobId: current.id,
    knownJob: current,
    sourceStatus: "parsing",
    patch: {
      leaseExpiresAt: new Date(Date.parse(context.now()) + (context.deps.leaseMs ?? LEASE_MS)).toISOString(),
      ...(checkpoint ? {
        stage: checkpoint.stage,
        progress: { completed: PARSE_STAGES.indexOf(checkpoint.stage), total: PARSE_STAGES.length, unit: "stage" as const },
      } : {}),
    },
    checkpoint,
  });
}

function scheduleLeaseRenewal(renew: () => Promise<void>, intervalMs: number): () => void {
  const timer = globalThis.setInterval(() => { void renew(); }, intervalMs);
  return () => globalThis.clearInterval(timer);
}

async function writeChunkSet(
  repository: LocalRepository,
  set: ChunkSet,
): Promise<{ ok: true } | { ok: false; errorCode: ParseErrorCode }> {
  const wrote = await writeBlobs(repository, [{ key: chunkSetKey(set.sourceId, set.parserVersion), value: set }]);
  return wrote ? { ok: true } : { ok: false, errorCode: "STORAGE_UNAVAILABLE" };
}

/** The chunk set saved for one (source, parserVersion), or null. */
export async function readChunkSet(
  repository: LocalRepository,
  sourceId: string,
  parserVersion: string,
): Promise<ChunkSet | null> {
  try {
    return await repository.backend.transaction("readonly", async (tx) =>
      asChunkSet(await tx.get(STORES.blobs, chunkSetKey(sourceId, parserVersion))),
    );
  } catch {
    return null;
  }
}

/** Every chunk set of a source, oldest first — old sets survive a version bump. */
export async function readChunkSets(repository: LocalRepository, sourceId: string): Promise<ChunkSet[]> {
  const record = await readSourceRecord(repository, sourceId);
  if (!record.ok || !record.data) return [];
  const out: ChunkSet[] = [];
  for (const item of record.data.chunkSets) {
    const set = await readChunkSet(repository, sourceId, item.parserVersion);
    if (set) out.push(set);
  }
  return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.parserVersion.localeCompare(b.parserVersion));
}

// ---------------------------------------------------------------------------
// The view model
// ---------------------------------------------------------------------------

export interface ParseListInput {
  assets: readonly AssetRecord[];
  /** Parse state keyed by assetId; an asset with no entry has no job. */
  states: ReadonlyMap<string, SourceParseState>;
  /** A local action is writing; shown as busy, never as fake progress. */
  busy?: boolean;
}

export function buildParseRows(input: ParseListInput): ParseRow[] {
  return input.assets
    .filter((asset) => asset.purpose === "source")
    .map((asset) => buildRow(asset, input.states.get(asset.id)));
}

function buildRow(asset: AssetRecord, state: SourceParseState | undefined): ParseRow {
  const source = state?.source ?? null;
  const jobEnvelope = state && state.status !== "pending" ? state.job : null;
  const job = jobEnvelope?.job ?? null;
  const checkpoints = state && state.status !== "pending" ? state.checkpoints : [];
  const status = state?.status ?? "pending";
  const stage = job?.stage && isParseStage(job.stage) ? job.stage : null;
  const errorCode = toParseErrorCode(job?.errorCode ?? null);
  const resumeFrom = status === "interrupted" ? (nextStageAfter(checkpoints) ?? lastStage()) : null;
  return {
    sourceId: source?.id ?? "",
    assetId: asset.id,
    name: asset.originalName,
    state: status,
    jobId: job?.id ?? null,
    jobState: job?.state ?? null,
    stage,
    stageLabel: stage ? STAGE_LABELS[stage] : null,
    progress: job?.progress ?? null,
    stageIndex: stage ? PARSE_STAGES.indexOf(stage) : 0,
    chunkCount: countChunks(checkpoints),
    pageCount: source?.pageCount ?? null,
    ocrNeeded: source?.ocrNeeded ?? false,
    errorCode,
    errorMessage: errorCode ? PARSE_ERROR_MESSAGES[errorCode] : null,
    resumeFrom,
    canStart: status === "pending",
    canCancel: status === "running",
    canResume: status === "interrupted",
    canAbandon: status === "interrupted",
    canRetry: status === "failed" || status === "cancelled" || status === "partial",
    savedStages: savedStagesOf(checkpoints),
  };
}

function isParseStage(value: string): value is ParseStage {
  return (PARSE_STAGES as readonly string[]).includes(value);
}

function toParseErrorCode(value: string | null): ParseErrorCode | null {
  if (value === null) return null;
  return Object.prototype.hasOwnProperty.call(PARSE_ERROR_MESSAGES, value) ? (value as ParseErrorCode) : "PARSE_FAILED";
}

/** The sentence for a code, so no screen invents its own wording. */
export function describeParseError(code: ParseErrorCode | null): string | null {
  return code === null ? null : PARSE_ERROR_MESSAGES[code];
}

/**
 * The four S02 states plus `partial`, computed from rows alone. Empty means no
 * material; loading means a real stage is running; error means something failed
 * or needs a manual supplement; stale is the interrupted R1 state.
 */
export function describeParseRows(rows: readonly ParseRow[], busy = false): ParseView {
  const running = rows.some((row) => row.state === "running");
  const states = rows.map((row) => row.state);
  const state: ParseView["state"] =
    rows.length === 0
      ? "empty"
      : running
        ? "loading"
        : states.includes("interrupted")
          ? "stale"
          : states.includes("failed") || states.includes("partial")
            ? "error"
            : states.includes("pending")
              ? "ready"
              : "parsed";
  return {
    rows: [...rows],
    pendingAssets: rows.filter((row) => row.state === "pending").length,
    busy,
    running,
    state,
  };
}
