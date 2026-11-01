/**
 * V6-13 — five-question intake and fact conflicts (S03, 05-contracts §3
 * `IntakeAnswers` / `Fact` / `FactConflict` / `Party` / `SourceSnapshot` and the
 * `POST /matters/:m/source-snapshots` operation).
 *
 * The module owns one durable rule: a `SourceSnapshot` is written only when the
 * user changes an answer, a fact, a conflict or a party. Every write carries the
 * `sourceVersion` it was based on and bumps the matter's `sourceVersion` by
 * one. A retried or repeated command either replays the recorded result or is
 * refused with `VERSION_CONFLICT`; it never writes twice.
 *
 * Three things the contract has no entity for are stored beside the snapshot in
 * the repository's blobs store, under an `intake/` key namespace:
 *
 * - per-question provenance (which of the three allowed sources the answer came
 *   from, and the fact version it was based on), because `IntakeAnswers` only
 *   carries the values;
 * - extract candidates, because §10 has no candidate entity and a candidate
 *   must not reach any target until it is explicitly adopted;
 * - draft input bindings, because `TargetRecord` carries no `DraftInputRef`.
 *   `bindDraftInput` is the seam a drafting ticket calls after generating a
 *   draft; this module only reads those bindings to mark a draft stale when a
 *   fact change moves `sourceVersion`.
 *
 * Everything else is reused: `readMatterSources`, `readChunkSets` keys,
 * `locateQuote` and `sourceIdFor` come from the V6-11 parse module, and
 * `isInputStale` comes from the V6-04 revision module. No rule is copied.
 *
 * The UI never infers `disclosure` or `maturity` and never invents a source for
 * an unanswered question. This module enforces the same rule: an answer without
 * a source is refused, and an unanswered question carries no provenance.
 */
import {
  factKindSchema,
  factStatusSchema,
  intakeAnswersSchema,
  partySchema,
  sourceSnapshotSchema,
  type Fact,
  type FactConflict,
  type IntakeAnswers,
  type Party,
  type SourceRef,
  type SourceSnapshot,
} from "../../../../../../packages/contracts/src/matter.ts";
import { isLocalDate } from "../../../../../../packages/contracts/src/primitives.ts";
import { isInputStale, type DraftInputRef } from "../../../../../../packages/domain/src/v6/revision.ts";
import {
  CONTRACT_VERSION,
  STORES,
  sha256Hex,
  type ActivityRecord,
  type Actor,
  type LocalRepository,
  type MatterRead,
  type MatterRecord,
  type TargetRecord,
} from "../../lib/repository.ts";
import {
  chunkSetKey,
  derivedId,
  locateQuote,
  readMatterSources,
  sourceIdFor,
  type ParseChunk,
} from "../sources/parse.ts";

// ---------------------------------------------------------------------------
// Questions, options and labels
// ---------------------------------------------------------------------------

export const INTAKE_QUESTION_KEYS = ["problem", "difference", "inventorIds", "disclosure", "maturity"] as const;
export type IntakeQuestionKey = (typeof INTAKE_QUESTION_KEYS)[number];

export interface IntakeQuestionDefinition {
  key: IntakeQuestionKey;
  label: string;
  prompt: string;
  /** S03 length limit in Unicode code points; null when the answer is a choice. */
  maxLength: number | null;
  required: boolean;
}

export const INTAKE_QUESTIONS: readonly IntakeQuestionDefinition[] = Object.freeze([
  Object.freeze({
    key: "problem",
    label: "问题",
    prompt: "这项发明解决了什么问题？",
    maxLength: 2_000,
    required: true,
  }),
  Object.freeze({
    key: "difference",
    label: "区别",
    prompt: "与现有做法相比，改了什么？",
    maxLength: 4_000,
    required: true,
  }),
  Object.freeze({
    key: "inventorIds",
    label: "发明人",
    prompt: "谁发明了它？",
    maxLength: null,
    required: true,
  }),
  Object.freeze({
    key: "disclosure",
    label: "公开历史",
    prompt: "今天之前，这项发明是否对外公开过？",
    maxLength: null,
    required: true,
  }),
  Object.freeze({
    key: "maturity",
    label: "成熟度",
    prompt: "现在做到什么程度？",
    maxLength: null,
    required: true,
  }),
]);

export type DisclosureValue = NonNullable<IntakeAnswers["disclosure"]>;
export type MaturityValue = NonNullable<IntakeAnswers["maturity"]>;

export const DISCLOSURE_OPTIONS: readonly { value: DisclosureValue; label: string }[] = Object.freeze([
  Object.freeze({ value: "none", label: "没有对外公开" }),
  Object.freeze({ value: "private_showing", label: "私下展示（有保密约定）" }),
  Object.freeze({ value: "public_event", label: "公开活动或展会" }),
  Object.freeze({ value: "publication", label: "论文、出版物或其他发表" }),
  Object.freeze({ value: "sale", label: "销售或许诺销售" }),
  Object.freeze({ value: "unsure", label: "不确定" }),
]);

export const MATURITY_OPTIONS: readonly { value: MaturityValue; label: string }[] = Object.freeze([
  Object.freeze({ value: "tested_sample", label: "已有测试样品" }),
  Object.freeze({ value: "drawing", label: "有图纸或完整方案" }),
  Object.freeze({ value: "idea", label: "只有想法" }),
]);

export const FACT_KIND_OPTIONS: readonly { value: Fact["kind"]; label: string }[] = Object.freeze([
  Object.freeze({ value: "problem", label: "问题" }),
  Object.freeze({ value: "structure", label: "结构" }),
  Object.freeze({ value: "method", label: "方法" }),
  Object.freeze({ value: "effect", label: "效果" }),
  Object.freeze({ value: "parameter", label: "参数" }),
  Object.freeze({ value: "material", label: "材料" }),
]);

export const FACT_STATUS_OPTIONS: readonly { value: Fact["status"]; label: string }[] = Object.freeze([
  Object.freeze({ value: "source_backed", label: "材料支撑" }),
  Object.freeze({ value: "user_confirmed", label: "用户确认" }),
  Object.freeze({ value: "external_context", label: "外部背景" }),
  Object.freeze({ value: "unsupported", label: "暂无依据" }),
]);

export const CONFLICT_STATE_OPTIONS: readonly {
  value: FactConflict["state"];
  label: string;
}[] = Object.freeze([
  Object.freeze({ value: "open", label: "暂不处理" }),
  Object.freeze({ value: "resolved", label: "选择一方或多方" }),
  Object.freeze({ value: "retained", label: "保留冲突" }),
]);

/** The three §3 sources a question may show; nothing else is ever displayed. */
export type QuestionSource =
  | { kind: "source"; ref: SourceRef }
  | { kind: "not_found" }
  | { kind: "direct" };

export interface QuestionProvenance {
  key: IntakeQuestionKey;
  source: QuestionSource;
  /** The matter sourceVersion the answer was written against. */
  basedOnVersion: number;
  savedAt: string;
  savedBy: string;
}

/** Stored beside the contract snapshot; see the module comment. */
export interface IntakeEnvelope {
  kind: "intake.snapshot";
  snapshot: SourceSnapshot;
  provenance: Partial<Record<IntakeQuestionKey, QuestionProvenance>>;
  requestKey: string | null;
}

export interface CandidateInput {
  id: string;
  statement: string;
  kind: Fact["kind"];
  status: Fact["status"];
  refs: SourceRef[];
}

export interface StagedCandidate extends CandidateInput {
  stagedAt: string;
  adoptedFactId: string | null;
}

export interface CandidateSetRecord {
  kind: "intake.candidates";
  matterId: string;
  jobId: string | null;
  stagedAt: string;
  stagedBy: string;
  candidates: StagedCandidate[];
}

export interface DraftBinding {
  targetId: string;
  input: DraftInputRef;
  boundAt: string;
}

export interface DraftsRecord {
  kind: "intake.drafts";
  matterId: string;
  bindings: DraftBinding[];
}

type IdempotencyState = "pending" | "committed" | "completed";

interface IdempotencyRecord {
  kind: "intake.idempotency";
  operation: typeof SAVE_OPERATION;
  matterId: string;
  requestKey: string;
  requestHash: string;
  version: number;
  at: string;
  /** Absent on a record written before the claim protocol; such a record was final. */
  state?: IdempotencyState;
  /** The owner token of a pending claim; only this owner may settle it. */
  claimId?: string;
  /** A pending claim may only be taken over after this time. */
  leaseExpiresAt?: string;
  /**
   * True for a no-op save: no version was written, so the response is the
   * baseline snapshot kept here rather than a stored `intake/snapshot/` row.
   */
  unchanged?: boolean;
  snapshot?: SourceSnapshot;
}

function idempotencyState(record: IdempotencyRecord): IdempotencyState {
  return record.state ?? "completed";
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type IntakeErrorCode =
  | "INVALID_INPUT"
  | "RESOURCE_NOT_FOUND"
  | "VERSION_CONFLICT"
  | "IDEMPOTENCY_CONFLICT"
  | "INVALID_TRANSITION"
  | "SOURCE_LOCATOR_INVALID"
  | "STORAGE_UNAVAILABLE";

export interface IntakeFieldError {
  path: string;
  reason: string;
}

export const INTAKE_ERROR_MESSAGES: Readonly<Record<IntakeErrorCode, string>> = Object.freeze({
  INVALID_INPUT: "提交的内容有需要修改的地方。",
  RESOURCE_NOT_FOUND: "案件不可用或无权查看。",
  VERSION_CONFLICT: "其他窗口已保存了更新的版本。请对照两版内容合并后重试。",
  IDEMPOTENCY_CONFLICT: "这次提交与之前的同号请求内容不同，请刷新后重试。",
  INVALID_TRANSITION: "案件当前不可编辑。",
  SOURCE_LOCATOR_INVALID: "来源引用与材料段落不一致，请重新选择来源。",
  STORAGE_UNAVAILABLE: "本机存储暂时不可用，内容没有保存。",
});

/**
 * The copy for a save whose version committed but whose snapshot did not. The
 * version exists, so this must never read as "not saved".
 */
export function committedWithoutSnapshotMessage(version: number): string {
  return `第 ${version} 版事实已记录，但这一版的答案快照没有写入本机。再次保存会以第 ${version} 版为基础补全快照。`;
}

export function describeIntakeError(code: IntakeErrorCode | null): string | null {
  return code === null ? null : INTAKE_ERROR_MESSAGES[code];
}

export interface IntakeFailure {
  ok: false;
  errorCode: IntakeErrorCode;
  message: string;
  fields?: IntakeFieldError[];
  /** The stored sourceVersion on a `VERSION_CONFLICT`. */
  latestVersion?: number;
  /** The snapshot at `latestVersion`, when it can be read, for a side-by-side merge. */
  latest?: SourceSnapshot | null;
  /** Set when the matter commit succeeded but the snapshot record did not. */
  committedVersion?: number;
}

// ---------------------------------------------------------------------------
// Storage keys
// ---------------------------------------------------------------------------

function snapshotKey(matterId: string, version: number): string {
  return `intake/snapshot/${matterId}/${version}`;
}

function candidatesKey(matterId: string): string {
  return `intake/candidates/${matterId}`;
}

function draftsKey(matterId: string): string {
  return `intake/drafts/${matterId}`;
}

const SAVE_OPERATION = "intake.save";

/**
 * 05-contracts scopes an idempotency key by (tenant, actor, operation, key).
 * The matter is not part of the scope; it is part of the request hash, so the
 * same key reused on another matter is an IDEMPOTENCY_CONFLICT, not a new write.
 */
function idempotencyKey(actor: Actor, requestKey: string): string {
  return [
    "intake/idempotency",
    encodeURIComponent(actor.tenantId),
    encodeURIComponent(actor.userId),
    SAVE_OPERATION,
    requestKey,
  ].join("/");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asEnvelope(value: unknown): IntakeEnvelope | null {
  return isRecord(value) && value.kind === "intake.snapshot" && isRecord(value.snapshot)
    ? (value as unknown as IntakeEnvelope)
    : null;
}

function asCandidateSet(value: unknown): CandidateSetRecord | null {
  return isRecord(value) && value.kind === "intake.candidates" && Array.isArray(value.candidates)
    ? (value as unknown as CandidateSetRecord)
    : null;
}

function asDraftsRecord(value: unknown): DraftsRecord | null {
  return isRecord(value) && value.kind === "intake.drafts" && Array.isArray(value.bindings)
    ? (value as unknown as DraftsRecord)
    : null;
}

function asIdempotency(value: unknown): IdempotencyRecord | null {
  return isRecord(value) && value.kind === "intake.idempotency" && typeof value.requestHash === "string"
    ? (value as unknown as IdempotencyRecord)
    : null;
}

function asChunkSet(value: unknown): { chunks: ParseChunk[]; createdAt?: string } | null {
  if (!isRecord(value) || value.kind !== "parse.chunks" || !Array.isArray(value.chunks)) return null;
  return value as unknown as { chunks: ParseChunk[]; createdAt?: string };
}

// ---------------------------------------------------------------------------
// Canonical comparison
// ---------------------------------------------------------------------------

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (isRecord(value)) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] !== undefined) out[key] = canonical(value[key]);
    }
    return out;
  }
  return value;
}

/** Stable JSON for equality and for the idempotency request hash. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonical(value));
}

function sameJson(a: unknown, b: unknown): boolean {
  return canonicalJson(a) === canonicalJson(b);
}

// ---------------------------------------------------------------------------
// Answers
// ---------------------------------------------------------------------------

export function defaultIntakeAnswers(): IntakeAnswers {
  return {
    problem: "",
    difference: "",
    inventorIds: [],
    disclosure: null,
    maturity: null,
    disclosureDetail: null,
  };
}

export function isAnswered(key: IntakeQuestionKey, answers: IntakeAnswers): boolean {
  switch (key) {
    case "problem":
      return answers.problem.trim().length > 0;
    case "difference":
      return answers.difference.trim().length > 0;
    case "inventorIds":
      return answers.inventorIds.length > 0;
    case "disclosure":
      return answers.disclosure !== null;
    case "maturity":
      return answers.maturity !== null;
  }
}

export function missingAnswers(answers: IntakeAnswers): IntakeQuestionKey[] {
  return INTAKE_QUESTION_KEYS.filter((key) => !isAnswered(key, answers));
}

/** The answer values a question contributes; used to decide "unchanged". */
function answerValue(key: IntakeQuestionKey, answers: IntakeAnswers): unknown {
  switch (key) {
    case "problem":
      return answers.problem;
    case "difference":
      return answers.difference;
    case "inventorIds":
      return answers.inventorIds;
    case "disclosure":
      return { disclosure: answers.disclosure, detail: answers.disclosureDetail };
    case "maturity":
      return answers.maturity;
  }
}

// ---------------------------------------------------------------------------
// Source references and chunk index
// ---------------------------------------------------------------------------

export interface ChunkIndexEntry {
  chunk: ParseChunk;
  assetId: string;
  sourceName: string;
}

export interface MatterChunkIndex {
  chunkById: Map<string, ParseChunk>;
  entries: ChunkIndexEntry[];
  /**
   * Chunks of the newest parse of each source, for the citation picker. A
   * retired source is never listed here: saving one of its refs is already
   * refused, so offering it would only lead to an error.
   */
  latest: ChunkIndexEntry[];
  sourceIds: string[];
  retiredSources: Set<string>;
}

export interface SourceSuggestion {
  chunkId: string;
  sourceId: string;
  sourceName: string;
  page: number | null;
  quote: string;
  ref: SourceRef;
}

/** Build the one SourceRef a chunk can carry for `quote`; null when it is not there. */
export function sourceRefForChunk(chunk: ParseChunk, quote: string = chunk.text): SourceRef | null {
  const normalized = quote.normalize("NFC");
  const located = locateQuote(chunk.text, normalized);
  if (!located) return null;
  return {
    sourceId: chunk.sourceId,
    chunkId: chunk.id,
    chunkHash: chunk.hash,
    page: chunk.page,
    start: located.start,
    end: located.end,
    quote: normalized,
  };
}

/** Why a stored SourceRef no longer locates its text, or null when it does. */
export function sourceRefProblem(ref: SourceRef, index: MatterChunkIndex): string | null {
  if (!isRecord(ref) || typeof ref.chunkId !== "string" || typeof ref.quote !== "string") {
    return "来源引用格式不正确";
  }
  if (index.retiredSources.has(ref.sourceId)) return "来源材料已退役";
  const chunk = index.chunkById.get(ref.chunkId);
  if (!chunk) return "来源段落不存在或已被替换";
  if (chunk.sourceId !== ref.sourceId) return "来源段落不属于这份材料";
  if (chunk.hash !== ref.chunkHash) return "来源段落内容已变化";
  if (chunk.page !== ref.page) return "来源页码与段落不一致";
  const located = locateQuote(chunk.text, ref.quote);
  if (!located || located.start !== ref.start || located.end !== ref.end) {
    return "引用文字与来源段落不一致";
  }
  return null;
}

async function loadChunkIndex(
  repository: LocalRepository,
  actor: Actor,
  matterId: string,
): Promise<{ ok: true; index: MatterChunkIndex } | { ok: false; errorCode: IntakeErrorCode }> {
  const sources = await readMatterSources(repository, actor, matterId);
  if (!sources.ok) {
    return {
      ok: false,
      errorCode: sources.errorCode === "INVALID_INPUT" ? "RESOURCE_NOT_FOUND" : "STORAGE_UNAVAILABLE",
    };
  }
  const assets = sources.data.assets.filter((asset) => asset.purpose === "source");
  const sourceIds = await Promise.all(assets.map((asset) => sourceIdFor(asset.id)));
  const chunkById = new Map<string, ParseChunk>();
  const entries: ChunkIndexEntry[] = [];
  const latest: ChunkIndexEntry[] = [];
  const retiredSources = new Set<string>();
  try {
    await repository.backend.transaction("readonly", async (tx) => {
      for (const asset of assets) {
        const record = sources.data.sources.get(asset.id);
        if (!record) continue;
        if (record.source.retiredAt !== null) retiredSources.add(record.source.id);
        let lastSet: ChunkIndexEntry[] = [];
        for (const meta of record.chunkSets) {
          const set = asChunkSet(await tx.get(STORES.blobs, chunkSetKey(record.source.id, meta.parserVersion)));
          if (!set) continue;
          const forSet: ChunkIndexEntry[] = [];
          for (const chunk of set.chunks) {
            const entry = { chunk, assetId: asset.id, sourceName: asset.originalName };
            forSet.push(entry);
            if (!chunkById.has(chunk.id)) {
              chunkById.set(chunk.id, chunk);
              entries.push(entry);
            }
          }
          if (forSet.length > 0) lastSet = forSet;
        }
        // Its chunks stay in `chunkById`/`entries` so a stored ref still gets an
        // honest "来源材料已退役"; only the pickers stop offering them.
        if (record.source.retiredAt === null) latest.push(...lastSet);
      }
    });
  } catch {
    return { ok: false, errorCode: "STORAGE_UNAVAILABLE" };
  }
  return { ok: true, index: { chunkById, entries, latest, sourceIds, retiredSources } };
}

const QUESTION_KEYWORDS: Readonly<Record<IntakeQuestionKey, readonly string[]>> = Object.freeze({
  problem: ["问题", "缺陷", "不足", "成本", "效率", "解决", "困难", "痛点"],
  difference: ["区别", "不同", "改进", "相比", "现有", "创新", "优于", "传统"],
  inventorIds: ["发明人", "设计人", "研发", "开发", "署名", "团队"],
  disclosure: ["公开", "披露", "展示", "展览", "参展", "销售", "发表", "客户", "样品", "看过", "发布会"],
  maturity: ["样品", "样机", "测试", "试验", "图纸", "方案", "构想", "模型", "验证"],
});

/** A short exact substring around the matched keyword, for display and citation. */
function quoteWindow(text: string, keyword: string): string {
  const codePoints = Array.from(text);
  const at = text.toLowerCase().indexOf(keyword.toLowerCase());
  if (at < 0) return codePoints.slice(0, 200).join("");
  const before = Array.from(text.slice(0, at)).length;
  const length = Array.from(keyword).length;
  const start = Math.max(0, before - 40);
  const end = Math.min(codePoints.length, before + length + 40);
  return codePoints.slice(start, end).join("");
}

/**
 * Deterministic source suggestions. This locates real paragraphs in the parsed
 * material; it never sets an answer and never asserts what the material means.
 */
export function suggestSources(key: IntakeQuestionKey, index: MatterChunkIndex): SourceSuggestion[] {
  const out: SourceSuggestion[] = [];
  const seen = new Set<string>();
  for (const entry of index.latest) {
    const text = entry.chunk.text.toLowerCase();
    const keyword = QUESTION_KEYWORDS[key].find((word) => text.includes(word.toLowerCase()));
    if (!keyword || seen.has(entry.chunk.id)) continue;
    const quote = quoteWindow(entry.chunk.text, keyword);
    const ref = sourceRefForChunk(entry.chunk, quote);
    if (!ref) continue;
    seen.add(entry.chunk.id);
    out.push({
      chunkId: entry.chunk.id,
      sourceId: entry.chunk.sourceId,
      sourceName: entry.sourceName,
      page: entry.chunk.page,
      quote,
      ref,
    });
    if (out.length >= 2) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Reading persisted state
// ---------------------------------------------------------------------------

interface StoredIntakeState {
  envelope: IntakeEnvelope | null;
  candidates: CandidateSetRecord | null;
  drafts: DraftsRecord | null;
}

async function readStoredState(
  repository: LocalRepository,
  matterId: string,
  version: number,
): Promise<{ ok: true; state: StoredIntakeState } | { ok: false }> {
  try {
    const state = await repository.backend.transaction("readonly", async (tx) => {
      const raw = await tx.get(STORES.blobs, snapshotKey(matterId, version));
      return {
        envelope: raw === undefined ? null : asEnvelope(raw),
        candidates: asCandidateSet(await tx.get(STORES.blobs, candidatesKey(matterId))),
        drafts: asDraftsRecord(await tx.get(STORES.blobs, draftsKey(matterId))),
        rawEnvelopePresent: raw !== undefined,
      };
    });
    if (state.rawEnvelopePresent && state.envelope === null) return { ok: false };
    return {
      ok: true,
      state: { envelope: state.envelope, candidates: state.candidates, drafts: state.drafts },
    };
  } catch {
    return { ok: false };
  }
}

/**
 * How long a pending claim stays valid. A tab that claimed the key and then
 * stopped (a crash, a closed window) cannot block the request forever: after
 * this long another attempt of the same request may take the claim over.
 */
const CLAIM_LEASE_MS = 30_000;
/** How long an identical request waits for the current claim owner to finish. */
const CLAIM_WAIT_MS = 500;
/** How often a waiter re-reads the record. */
const CLAIM_POLL_MS = 25;
/**
 * The copy for an identical request that found another owner's live claim. It
 * is retryable: this attempt ran no business write.
 */
const REQUEST_IN_FLIGHT_MESSAGE = "同一请求正在处理中，请稍候再试。";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * A claimed idempotency key. `pending` is internal to `claimIdempotency`: it
 * means another owner holds a live claim and the caller must wait.
 */
type ClaimResult =
  | { kind: "claimed"; claimId: string }
  | { kind: "replay"; record: IdempotencyRecord }
  | { kind: "committed"; record: IdempotencyRecord }
  | { kind: "conflict" }
  | { kind: "busy" }
  | { kind: "failed" };

type ClaimStep = ClaimResult | { kind: "wait" };

interface ClaimRequest {
  matterId: string;
  requestHash: string;
  /** This attempt's logical time, also used to judge a lease. */
  at: string;
}

function pendingIdempotency(request: ClaimRequest & { requestKey: string }, claimId: string): IdempotencyRecord {
  return {
    kind: "intake.idempotency",
    operation: SAVE_OPERATION,
    matterId: request.matterId,
    requestKey: request.requestKey,
    requestHash: request.requestHash,
    version: 0,
    at: request.at,
    state: "pending",
    claimId,
    leaseExpiresAt: new Date(Date.parse(request.at) + CLAIM_LEASE_MS).toISOString(),
  };
}

/**
 * Claim the key in one read-write transaction. §2 needs the check and the
 * write to be one unit: two concurrent requests must not both see an absent
 * key and both proceed. The first owner writes a pending record; an identical
 * request either replays a completed record, reports a committed one, or waits
 * for the live owner; a different payload is refused, whatever the state.
 */
async function claimOnce(
  repository: LocalRepository,
  actor: Actor,
  requestKey: string,
  request: ClaimRequest,
  claimId: string,
): Promise<ClaimStep> {
  const key = idempotencyKey(actor, requestKey);
  try {
    return await repository.backend.transaction("readwrite", async (tx) => {
      const raw = await tx.get(STORES.blobs, key);
      if (raw === undefined) {
        await tx.put(STORES.blobs, key, pendingIdempotency({ ...request, requestKey }, claimId));
        return { kind: "claimed", claimId };
      }
      const existing = asIdempotency(raw);
      if (existing === null) return { kind: "failed" };
      if (existing.requestHash !== request.requestHash) return { kind: "conflict" };
      const state = idempotencyState(existing);
      if (state === "completed") return { kind: "replay", record: existing };
      if (state === "committed") return { kind: "committed", record: existing };
      const lease = existing.leaseExpiresAt === undefined ? Number.NaN : Date.parse(existing.leaseExpiresAt);
      if (Number.isFinite(lease) && lease > Date.parse(request.at)) return { kind: "wait" };
      // The owner is gone or stalled past its lease. Take the claim over with a
      // new token; the deterministic event id still guards the commit.
      await tx.put(STORES.blobs, key, pendingIdempotency({ ...request, requestKey }, claimId));
      return { kind: "claimed", claimId };
    });
  } catch {
    return { kind: "failed" };
  }
}

/** Wait briefly for a live claim; past the lease, take it over on the next try. */
async function claimIdempotency(
  repository: LocalRepository,
  actor: Actor,
  requestKey: string,
  request: ClaimRequest,
  claimId: string,
): Promise<ClaimResult> {
  const deadline = Date.now() + CLAIM_WAIT_MS;
  for (;;) {
    const step = await claimOnce(repository, actor, requestKey, request, claimId);
    if (step.kind !== "wait") return step;
    if (Date.now() >= deadline) return { kind: "busy" };
    await sleep(CLAIM_POLL_MS);
  }
}

/**
 * Settle the claim this attempt owns with a final record. Only a `pending`
 * record carrying this attempt's claim id may be written; a completed record
 * belongs to someone else. `lost` means the lease was taken over while this
 * attempt was working.
 */
async function settleClaim(
  repository: LocalRepository,
  actor: Actor,
  requestKey: string,
  claimId: string,
  requestHash: string,
  record: IdempotencyRecord,
): Promise<"settled" | "lost" | "failed"> {
  const key = idempotencyKey(actor, requestKey);
  try {
    return await repository.backend.transaction("readwrite", async (tx) => {
      const raw = await tx.get(STORES.blobs, key);
      const existing = raw === undefined ? null : asIdempotency(raw);
      if (existing === null || existing.requestHash !== requestHash) return "lost";
      if (idempotencyState(existing) !== "pending" || existing.claimId !== claimId) return "lost";
      await tx.put(STORES.blobs, key, record);
      return "settled";
    });
  } catch {
    return "failed";
  }
}

/**
 * Record a no-op save's response against the claim. The response is the
 * baseline snapshot kept on the record; a no-op writes no version (S03-A03).
 * An identical owner that already completed the key is replayed instead.
 */
async function completeNoopClaim(
  repository: LocalRepository,
  actor: Actor,
  requestKey: string,
  claimId: string,
  requestHash: string,
  record: IdempotencyRecord,
): Promise<{ kind: "completed" } | { kind: "replay"; record: IdempotencyRecord } | { kind: "lost" } | { kind: "failed" }> {
  const key = idempotencyKey(actor, requestKey);
  try {
    return await repository.backend.transaction("readwrite", async (tx) => {
      const raw = await tx.get(STORES.blobs, key);
      if (raw === undefined) return { kind: "lost" };
      const existing = asIdempotency(raw);
      if (existing === null) return { kind: "failed" };
      if (existing.requestHash !== requestHash) return { kind: "lost" };
      const state = idempotencyState(existing);
      if (state === "completed") return { kind: "replay", record: existing };
      if (state !== "pending" || existing.claimId !== claimId) return { kind: "lost" };
      await tx.put(STORES.blobs, key, record);
      return { kind: "completed" };
    });
  } catch {
    return { kind: "failed" };
  }
}

/**
 * Write the version's snapshot, candidates and completed record in one blob
 * transaction, but only while this attempt still owns a committed claim. If the
 * claim was taken over, the snapshot is not written here: the new owner
 * recovers the committed version from its deterministic event.
 */
async function writeCommittedBlobs(
  repository: LocalRepository,
  actor: Actor,
  requestKey: string,
  claimId: string,
  requestHash: string,
  completed: IdempotencyRecord,
  writes: readonly { key: string; value: unknown }[],
): Promise<"completed" | "lost" | "failed"> {
  const key = idempotencyKey(actor, requestKey);
  try {
    return await repository.backend.transaction("readwrite", async (tx) => {
      const raw = await tx.get(STORES.blobs, key);
      const existing = raw === undefined ? null : asIdempotency(raw);
      if (existing === null || existing.requestHash !== requestHash) return "lost";
      if (idempotencyState(existing) !== "committed" || existing.claimId !== claimId) return "lost";
      for (const write of writes) await tx.put(STORES.blobs, write.key, write.value);
      await tx.put(STORES.blobs, key, completed);
      return "completed";
    });
  } catch {
    return "failed";
  }
}

/**
 * Give a claimed key back after a failure that wrote nothing, so the same
 * request can claim it again. Never deletes a completed or committed record,
 * and never someone else's claim.
 */
async function releaseClaim(
  repository: LocalRepository,
  actor: Actor,
  requestKey: string,
  claimId: string,
): Promise<void> {
  const key = idempotencyKey(actor, requestKey);
  try {
    await repository.backend.transaction("readwrite", async (tx) => {
      const raw = await tx.get(STORES.blobs, key);
      const existing = raw === undefined ? null : asIdempotency(raw);
      if (existing === null) return;
      if (idempotencyState(existing) !== "pending" || existing.claimId !== claimId) return;
      await tx.delete(STORES.blobs, key);
    });
  } catch {
    // The attempt already failed; a claim that cannot be released expires.
  }
}

/**
 * The version a previous attempt of this request committed, found through its
 * deterministic event id. `null` means this request has not committed.
 */
async function committedEventVersion(
  repository: LocalRepository,
  actor: Actor,
  matterId: string,
  requestKey: string,
): Promise<{ ok: true; version: number | null } | { ok: false }> {
  const eventId = await derivedId(`v6/intake/event/${matterId}/${requestKey}`);
  const events = await repository.listEvents(actor, matterId);
  if (!events.ok) return { ok: false };
  const event = events.data.items.find(
    (item) => item.id === eventId && item.action === "snapshot.created",
  );
  if (event === undefined) return { ok: true, version: null };
  const version = isRecord(event.metadata) ? event.metadata.version : undefined;
  return {
    ok: true,
    version: Number.isSafeInteger(version) && (version as number) > 0 ? (version as number) : null,
  };
}

/**
 * The response stored under an idempotency record, for 05-contracts §2. A save
 * that wrote a version replays that version's snapshot; a no-op save wrote no
 * version (S03-A03), so it replays the baseline snapshot kept on the record.
 */
async function replayIdempotent(
  repository: LocalRepository,
  matterId: string,
  record: IdempotencyRecord,
): Promise<SaveIntakeOutcome> {
  if (record.unchanged === true) {
    const parsed = record.snapshot === undefined ? null : sourceSnapshotSchema.safeParse(record.snapshot);
    if (parsed === null || !parsed.success) return failure("STORAGE_UNAVAILABLE");
    return {
      ok: true,
      version: record.version,
      snapshot: parsed.data,
      unchanged: true,
      replayed: true,
    };
  }
  const replay = await readStoredState(repository, matterId, record.version);
  if (!replay.ok || replay.state.envelope === null) {
    return failure("STORAGE_UNAVAILABLE", undefined, {
      committedVersion: record.version,
      message: committedWithoutSnapshotMessage(record.version),
    });
  }
  return {
    ok: true,
    version: record.version,
    snapshot: replay.state.envelope.snapshot,
    unchanged: false,
    replayed: true,
  };
}

/**
 * The response of a version write whose blob batch did not finish. The commit
 * is real, so this must not read as "not saved", and it must be replayable
 * under the same key rather than turning into a conflict.
 */
async function replayCommitted(
  repository: LocalRepository,
  matterId: string,
  record: IdempotencyRecord,
): Promise<SaveIntakeOutcome> {
  const replay = await readStoredState(repository, matterId, record.version);
  if (replay.ok && replay.state.envelope !== null) {
    return {
      ok: true,
      version: record.version,
      snapshot: replay.state.envelope.snapshot,
      unchanged: false,
      replayed: true,
    };
  }
  return failure("STORAGE_UNAVAILABLE", undefined, {
    committedVersion: record.version,
    message: committedWithoutSnapshotMessage(record.version),
  });
}

/**
 * The newest well-formed snapshot below `missingVersion`. Used only when the
 * matter names a version whose snapshot was never written (a post-commit blob
 * failure): the repository commit cannot carry intake blobs, so the matter row
 * and its snapshot are two writes and the second can fail. Older versions that
 * are missing or malformed are skipped; `null` means none survives.
 */
async function readRecoveryEnvelope(
  repository: LocalRepository,
  matterId: string,
  missingVersion: number,
): Promise<{ ok: true; envelope: IntakeEnvelope | null } | { ok: false }> {
  try {
    const envelope = await repository.backend.transaction("readonly", async (tx) => {
      for (let version = missingVersion - 1; version >= 2; version -= 1) {
        const candidate = asEnvelope(await tx.get(STORES.blobs, snapshotKey(matterId, version)));
        if (!candidate) continue;
        const parsed = sourceSnapshotSchema.safeParse(candidate.snapshot);
        if (parsed.success && parsed.data.matterId === matterId && parsed.data.version === version) {
          return { ...candidate, snapshot: parsed.data };
        }
      }
      return null;
    });
    return { ok: true, envelope };
  } catch {
    return { ok: false };
  }
}

/** Where a read stands when the current version's snapshot is missing. */
export interface IntakeRecovery {
  /** The committed version whose snapshot is missing; saves build on it. */
  missingVersion: number;
  /** The older snapshot shown instead, or null when the form starts empty. */
  recoveredFromVersion: number | null;
}

async function writeBlobs(
  repository: LocalRepository,
  writes: readonly { key: string; value: unknown }[],
): Promise<boolean> {
  try {
    await repository.backend.transaction("readwrite", async (tx) => {
      for (const write of writes) await tx.put(STORES.blobs, write.key, write.value);
    });
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// The view model
// ---------------------------------------------------------------------------

export interface QuestionView {
  key: IntakeQuestionKey;
  label: string;
  prompt: string;
  answered: boolean;
  valueText: string | null;
  valueChoice: string | null;
  inventorIds: string[];
  source: QuestionSource | null;
  /**
   * True when a stored source ref no longer locates its chunk, or is missing.
   * For the disclosure question it is also true when any evidence ref changed.
   */
  sourceChanged: boolean;
  /** Per `disclosureDetail.evidenceRefs` entry: true when it no longer locates. Empty elsewhere. */
  evidenceChanged: boolean[];
  basedOnVersion: number | null;
  savedAt: string | null;
  suggestions: SourceSuggestion[];
}

export interface FactView extends Fact {
  sourceChanged: boolean;
  conflictIds: string[];
}

export interface ConflictView extends FactConflict {
  facts: { id: string; statement: string }[];
}

export interface CandidateView {
  id: string;
  statement: string;
  kind: Fact["kind"];
  status: Fact["status"];
  adopted: boolean;
  adoptedFactId: string | null;
}

export interface DraftView {
  targetId: string;
  label: string;
  stale: boolean;
  targetMissing: boolean;
  inputSourceVersion: number;
  currentSourceVersion: number;
}

export interface ChunkChoice {
  chunkId: string;
  sourceId: string;
  sourceName: string;
  page: number | null;
  text: string;
  ref: SourceRef;
}

export interface IntakeView {
  matterId: string;
  sourceVersion: number;
  /** S03 four states; `loading` and `error` belong to the caller's read. */
  state: "empty" | "ready" | "stale";
  hasSnapshot: boolean;
  /** Set when `sourceVersion` committed without its snapshot; null otherwise. */
  recovery: IntakeRecovery | null;
  answers: IntakeAnswers;
  questions: QuestionView[];
  parties: Party[];
  facts: FactView[];
  conflicts: ConflictView[];
  candidates: CandidateView[];
  drafts: DraftView[];
  chunks: ChunkChoice[];
  completeness: "empty" | "partial" | "complete";
  missing: IntakeQuestionKey[];
}

export type IntakeReadOutcome =
  | { ok: true; view: IntakeView }
  | { ok: false; errorCode: IntakeErrorCode; message: string };

function emptySnapshot(
  matter: MatterRecord,
  sourceIds: string[],
): SourceSnapshot {
  return {
    matterId: matter.id,
    version: matter.sourceVersion,
    sourceIds,
    facts: [],
    conflicts: [],
    answers: defaultIntakeAnswers(),
    parties: [],
    createdBy: matter.createdBy,
    createdAt: matter.createdAt,
  };
}

/**
 * Read the whole intake state for one matter. A stored snapshot is only accepted
 * when it is the version the matter currently names and still matches the
 * contract; a malformed one is `storage_unavailable`. A missing one (the version
 * committed, its snapshot write failed) reads as `recovery`: the newest older
 * snapshot or an empty form, flagged, never passed off as the current version.
 */
export async function readIntake(
  repository: LocalRepository,
  actor: Actor,
  matterId: string,
): Promise<IntakeReadOutcome> {
  const loaded = await repository.loadMatter(actor, matterId);
  if (!loaded.ok) {
    return {
      ok: false,
      errorCode: loaded.error.code === "RESOURCE_NOT_FOUND" ? "RESOURCE_NOT_FOUND" : "STORAGE_UNAVAILABLE",
      message: INTAKE_ERROR_MESSAGES[
        loaded.error.code === "RESOURCE_NOT_FOUND" ? "RESOURCE_NOT_FOUND" : "STORAGE_UNAVAILABLE"
      ],
    };
  }
  const matter = loaded.data.data.matter;
  const chunkIndex = await loadChunkIndex(repository, actor, matterId);
  if (!chunkIndex.ok) {
    return { ok: false, errorCode: chunkIndex.errorCode, message: INTAKE_ERROR_MESSAGES[chunkIndex.errorCode] };
  }
  const stored = await readStoredState(repository, matterId, matter.sourceVersion);
  if (!stored.ok) {
    return { ok: false, errorCode: "STORAGE_UNAVAILABLE", message: INTAKE_ERROR_MESSAGES.STORAGE_UNAVAILABLE };
  }
  const envelope = stored.state.envelope;
  let snapshot = envelope?.snapshot ?? emptySnapshot(matter, chunkIndex.index.sourceIds);
  if (envelope) {
    const parsed = sourceSnapshotSchema.safeParse(envelope.snapshot);
    if (!parsed.success || parsed.data.matterId !== matterId || parsed.data.version !== matter.sourceVersion) {
      return { ok: false, errorCode: "STORAGE_UNAVAILABLE", message: INTAKE_ERROR_MESSAGES.STORAGE_UNAVAILABLE };
    }
    snapshot = parsed.data;
  }
  // The version committed but its snapshot did not (a post-commit blob
  // failure). Locking the form would strand the matter, so the read shows the
  // newest older snapshot, or an empty form, labelled as such, at the committed
  // version; the next save builds on that version and fills the gap.
  let recovery: IntakeRecovery | null = null;
  let shownEnvelope = envelope;
  if (envelope === null && matter.sourceVersion !== 1) {
    const older = await readRecoveryEnvelope(repository, matterId, matter.sourceVersion);
    if (!older.ok) {
      return { ok: false, errorCode: "STORAGE_UNAVAILABLE", message: INTAKE_ERROR_MESSAGES.STORAGE_UNAVAILABLE };
    }
    shownEnvelope = older.envelope;
    if (older.envelope) snapshot = older.envelope.snapshot;
    recovery = {
      missingVersion: matter.sourceVersion,
      recoveredFromVersion: older.envelope?.snapshot.version ?? null,
    };
  }
  const provenance = shownEnvelope?.provenance ?? {};
  const conflictIdsByFact = new Map<string, string[]>();
  for (const conflict of snapshot.conflicts) {
    for (const factId of conflict.factIds) {
      conflictIdsByFact.set(factId, [...(conflictIdsByFact.get(factId) ?? []), conflict.id]);
    }
  }
  const facts: FactView[] = snapshot.facts.map((fact) => ({
    ...fact,
    sourceChanged: fact.refs.some((ref) => sourceRefProblem(ref, chunkIndex.index) !== null),
    conflictIds: conflictIdsByFact.get(fact.id) ?? [],
  }));
  const factById = new Map(snapshot.facts.map((fact) => [fact.id, fact]));
  const conflicts: ConflictView[] = snapshot.conflicts.map((conflict) => ({
    ...conflict,
    facts: conflict.factIds.map((id) => ({ id, statement: factById.get(id)?.statement ?? "" })),
  }));
  const factIds = new Set(snapshot.facts.map((fact) => fact.id));
  const candidates: CandidateView[] = (stored.state.candidates?.candidates ?? []).map((candidate) => ({
    id: candidate.id,
    statement: candidate.statement,
    kind: candidate.kind,
    status: candidate.status,
    adopted: candidate.adoptedFactId !== null || factIds.has(candidate.id),
    adoptedFactId: candidate.adoptedFactId ?? (factIds.has(candidate.id) ? candidate.id : null),
  }));
  const targets = loaded.data.data.targets;
  const drafts: DraftView[] = (stored.state.drafts?.bindings ?? []).map((binding) => {
    const target = targets.find((item) => item.id === binding.targetId);
    const current: DraftInputRef | null = target
      ? {
          matterId,
          targetId: target.id,
          sourceVersion: matter.sourceVersion,
          targetConfigVersion: target.configVersion,
          figureRevisionId: target.figureRevisionId,
        }
      : null;
    return {
      targetId: binding.targetId,
      label: target ? targetLabel(targets, target.id) : "已删除的目标",
      stale: current === null || isInputStale(binding.input, current),
      targetMissing: current === null,
      inputSourceVersion: binding.input.sourceVersion,
      currentSourceVersion: matter.sourceVersion,
    };
  });
  const chunks: ChunkChoice[] = chunkIndex.index.latest.slice(0, 200).flatMap((entry) => {
    const ref = sourceRefForChunk(entry.chunk);
    return ref
      ? [
          {
            chunkId: entry.chunk.id,
            sourceId: entry.chunk.sourceId,
            sourceName: entry.sourceName,
            page: entry.chunk.page,
            text: entry.chunk.text,
            ref,
          },
        ]
      : [];
  });
  const questions: QuestionView[] = INTAKE_QUESTIONS.map((definition) => {
    const key = definition.key;
    const answered = isAnswered(key, snapshot.answers);
    const record = provenance[key] ?? null;
    const storedSource = record?.source ?? null;
    // §3: evidence refs locate like every other source ref.
    const evidenceChanged =
      key === "disclosure"
        ? (snapshot.answers.disclosureDetail?.evidenceRefs ?? []).map(
            (ref) => sourceRefProblem(ref, chunkIndex.index) !== null,
          )
        : [];
    const sourceChanged =
      (answered
        ? storedSource === null || (storedSource.kind === "source" && sourceRefProblem(storedSource.ref, chunkIndex.index) !== null)
        : false) || evidenceChanged.includes(true);
    return {
      key,
      label: definition.label,
      prompt: definition.prompt,
      answered,
      valueText:
        key === "problem" ? snapshot.answers.problem : key === "difference" ? snapshot.answers.difference : null,
      valueChoice:
        key === "disclosure" ? snapshot.answers.disclosure : key === "maturity" ? snapshot.answers.maturity : null,
      inventorIds: key === "inventorIds" ? [...snapshot.answers.inventorIds] : [],
      source: storedSource,
      sourceChanged,
      evidenceChanged,
      basedOnVersion: record?.basedOnVersion ?? null,
      savedAt: record?.savedAt ?? null,
      suggestions: suggestSources(key, chunkIndex.index),
    };
  });
  const missing = missingAnswers(snapshot.answers);
  const staleFact = facts.some((fact) => fact.sourceChanged);
  const staleEvidence = questions.some((question) => question.evidenceChanged.includes(true));
  const staleDraft = drafts.some((draft) => draft.stale);
  return {
    ok: true,
    view: {
      matterId,
      sourceVersion: matter.sourceVersion,
      state:
        shownEnvelope === null && recovery === null && candidates.length === 0
          ? "empty"
          : staleFact || staleEvidence || staleDraft
            ? "stale"
            : "ready",
      hasSnapshot: envelope !== null,
      recovery,
      answers: snapshot.answers,
      questions,
      parties: snapshot.parties,
      facts,
      conflicts,
      candidates,
      drafts,
      chunks,
      completeness: missing.length === 0 ? "complete" : missing.length === 5 ? "empty" : "partial",
      missing,
    },
  };
}

function targetLabel(targets: readonly TargetRecord[], targetId: string): string {
  const index = targets.findIndex((target) => target.id === targetId);
  return index < 0 ? "目标" : `目标 ${index + 1}`;
}

// ---------------------------------------------------------------------------
// Saving
// ---------------------------------------------------------------------------

export interface SaveIntakeInput {
  /** The matter sourceVersion the user read; must match or the save conflicts. */
  baseSourceVersion: number;
  answers: IntakeAnswers;
  questionSources: Partial<Record<IntakeQuestionKey, QuestionSource>>;
  facts: Fact[];
  conflicts: FactConflict[];
  parties: Party[];
  /** Candidate ids the user explicitly adopted in this save. */
  adoptCandidateIds?: string[];
}

export interface SaveIntakeOptions {
  /** Idempotency key; the same key with the same payload replays, never rewrites. */
  requestKey?: string;
  now?: () => string;
  newId?: () => string;
}

export type SaveIntakeOutcome =
  | {
      ok: true;
      version: number;
      snapshot: SourceSnapshot;
      unchanged: boolean;
      replayed: boolean;
    }
  | IntakeFailure;

const REQUEST_KEY_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

function failure(
  errorCode: IntakeErrorCode,
  fields?: IntakeFieldError[],
  extra: Partial<IntakeFailure> = {},
): IntakeFailure {
  const result: IntakeFailure = {
    ok: false,
    errorCode,
    message: INTAKE_ERROR_MESSAGES[errorCode],
  };
  if (fields && fields.length > 0) result.fields = fields;
  return { ...result, ...extra };
}

function answerFailure(fields: IntakeFieldError[]): IntakeFailure {
  return failure("INVALID_INPUT", fields);
}

function validateAnswersShape(raw: unknown): { ok: true; answers: IntakeAnswers } | { ok: false; fields: IntakeFieldError[] } {
  const fields: IntakeFieldError[] = [];
  if (!isRecord(raw)) {
    return { ok: false, fields: [{ path: "answers", reason: "缺少五题答案" }] };
  }
  const problem = raw.problem === undefined ? "" : raw.problem;
  const difference = raw.difference === undefined ? "" : raw.difference;
  if (typeof problem !== "string") fields.push({ path: "answers.problem", reason: "问题答案必须是文字" });
  if (typeof difference !== "string") fields.push({ path: "answers.difference", reason: "区别答案必须是文字" });
  if (typeof problem === "string" && Array.from(problem.trim()).length > 2_000) {
    fields.push({ path: "answers.problem", reason: "问题答案不能超过 2,000 字" });
  }
  if (typeof difference === "string" && Array.from(difference.trim()).length > 4_000) {
    fields.push({ path: "answers.difference", reason: "区别答案不能超过 4,000 字" });
  }
  const inventorIds = raw.inventorIds === undefined ? [] : raw.inventorIds;
  if (!Array.isArray(inventorIds) || inventorIds.some((id) => typeof id !== "string")) {
    fields.push({ path: "answers.inventorIds", reason: "发明人列表格式不正确" });
  }
  const disclosure = raw.disclosure === undefined ? null : raw.disclosure;
  if (disclosure !== null && !DISCLOSURE_OPTIONS.some((option) => option.value === disclosure)) {
    fields.push({ path: "answers.disclosure", reason: "公开历史必须从给定选项中选择" });
  }
  const maturity = raw.maturity === undefined ? null : raw.maturity;
  if (maturity !== null && !MATURITY_OPTIONS.some((option) => option.value === maturity)) {
    fields.push({ path: "answers.maturity", reason: "成熟度必须从给定选项中选择" });
  }
  const detail = raw.disclosureDetail === undefined ? null : raw.disclosureDetail;
  if (detail !== null) {
    if (!isRecord(detail)) {
      fields.push({ path: "answers.disclosureDetail", reason: "公开细节格式不正确" });
    } else {
      if (detail.occurredOn !== null && detail.occurredOn !== undefined && (typeof detail.occurredOn !== "string" || !isLocalDate(detail.occurredOn))) {
        fields.push({ path: "answers.disclosureDetail.occurredOn", reason: "日期必须是真实的 YYYY-MM-DD" });
      }
      if (typeof detail.audience !== "string") {
        fields.push({ path: "answers.disclosureDetail.audience", reason: "公开对象必须是文字" });
      }
      if (!["yes", "no", "unknown"].includes(detail.confidentiality as string)) {
        fields.push({ path: "answers.disclosureDetail.confidentiality", reason: "是否保密必须从给定选项中选择" });
      }
      if (!Array.isArray(detail.evidenceRefs)) {
        fields.push({ path: "answers.disclosureDetail.evidenceRefs", reason: "证据引用格式不正确" });
      }
    }
  }
  if (fields.length > 0) return { ok: false, fields };
  const parsed = intakeAnswersSchema.safeParse({
    problem,
    difference,
    inventorIds: [...new Set(inventorIds as string[])],
    disclosure,
    maturity,
    disclosureDetail: detail,
  });
  if (!parsed.success) {
    return {
      ok: false,
      fields: parsed.error.issues.map((issue) => ({
        path: issue.path.length > 0 ? `answers.${issue.path.join(".")}` : "answers",
        reason: issue.message,
      })),
    };
  }
  return { ok: true, answers: parsed.data };
}

function validateParties(raw: unknown): { ok: true; parties: Party[] } | { ok: false; fields: IntakeFieldError[] } {
  if (raw === undefined) raw = [];
  if (!Array.isArray(raw)) return { ok: false, fields: [{ path: "parties", reason: "人员列表格式不正确" }] };
  const fields: IntakeFieldError[] = [];
  const seen = new Set<string>();
  const parties: Party[] = [];
  for (const item of raw) {
    const parsed = partySchema.safeParse(item);
    if (!parsed.success) {
      fields.push({ path: "parties", reason: "人员信息不完整或格式不正确" });
      continue;
    }
    if (seen.has(parsed.data.id)) {
      fields.push({ path: `parties.${parsed.data.id}`, reason: "同一人员不能重复" });
      continue;
    }
    seen.add(parsed.data.id);
    parties.push(parsed.data);
  }
  return fields.length > 0 ? { ok: false, fields } : { ok: true, parties };
}

function validateRefList(
  refs: unknown,
  index: MatterChunkIndex,
  path: string,
): { ok: true; refs: SourceRef[] } | { ok: false; fields: IntakeFieldError[] } {
  if (refs === undefined) return { ok: true, refs: [] };
  if (!Array.isArray(refs)) return { ok: false, fields: [{ path, reason: "来源引用格式不正确" }] };
  const fields: IntakeFieldError[] = [];
  for (const ref of refs) {
    const problem = sourceRefProblem(ref as SourceRef, index);
    if (problem) fields.push({ path, reason: problem });
  }
  return fields.length > 0 ? { ok: false, fields } : { ok: true, refs: refs as SourceRef[] };
}

function validateFacts(
  raw: unknown,
  index: MatterChunkIndex,
  actor: Actor,
  now: () => string,
  previousFacts: readonly Fact[],
): { ok: true; facts: Fact[] } | { ok: false; fields: IntakeFieldError[]; errorCode: IntakeErrorCode } {
  if (raw === undefined) raw = [];
  if (!Array.isArray(raw)) {
    return { ok: false, fields: [{ path: "facts", reason: "事实列表格式不正确" }], errorCode: "INVALID_INPUT" };
  }
  const previousById = new Map(previousFacts.map((fact) => [fact.id, fact]));
  const fields: IntakeFieldError[] = [];
  const seen = new Set<string>();
  const facts: Fact[] = [];
  let locatorProblem = false;
  for (const item of raw) {
    if (!isRecord(item) || typeof item.id !== "string") {
      fields.push({ path: "facts", reason: "事实缺少 id" });
      continue;
    }
    const path = `facts.${item.id}`;
    if (seen.has(item.id)) {
      fields.push({ path, reason: "同一事实不能重复" });
      continue;
    }
    seen.add(item.id);
    if (!factKindSchema.safeParse(item.kind).success) {
      fields.push({ path: `${path}.kind`, reason: "事实类型不在给定范围内" });
    }
    if (!factStatusSchema.safeParse(item.status).success) {
      fields.push({ path: `${path}.status`, reason: "事实状态不在给定范围内" });
      continue;
    }
    if (typeof item.statement !== "string" || item.statement.trim().length === 0) {
      fields.push({ path: `${path}.statement`, reason: "事实内容不能为空" });
    }
    const refs = validateRefList(item.refs, index, `${path}.refs`);
    if (!refs.ok) {
      locatorProblem = true;
      fields.push(...refs.fields);
    }
    if (item.status === "source_backed" && refs.ok && refs.refs.length === 0) {
      fields.push({ path: `${path}.refs`, reason: "材料支撑的事实必须引用至少一段材料" });
    }
    const userConfirmed = item.status === "user_confirmed";
    let confirmedBy: string | null = null;
    let confirmedAt: string | null = null;
    if (userConfirmed) {
      // A confirmation belongs to the content it confirmed. Carrying the same
      // fact through an unrelated save must not reset its time, or every save
      // would differ from the stored snapshot and bump a version.
      const previous = previousById.get(item.id);
      const sameContent =
        previous !== undefined &&
        previous.status === "user_confirmed" &&
        previous.statement === item.statement &&
        previous.kind === item.kind &&
        sameJson(previous.refs, refs.ok ? refs.refs : []);
      confirmedBy = sameContent ? previous.confirmedBy : actor.userId;
      confirmedAt = sameContent ? previous.confirmedAt : now();
    } else if (item.confirmedBy !== null && item.confirmedBy !== undefined) {
      fields.push({ path: `${path}.confirmedBy`, reason: "只有用户确认的事实记录确认人" });
    }
    const parsed = {
      id: item.id,
      statement: typeof item.statement === "string" ? item.statement : "",
      kind: item.kind,
      status: item.status,
      refs: refs.ok ? refs.refs : [],
      confirmedBy: userConfirmed ? confirmedBy : null,
      confirmedAt: userConfirmed ? confirmedAt : null,
    } as Fact;
    facts.push(parsed);
  }
  if (fields.length > 0) {
    return {
      ok: false,
      fields,
      errorCode: locatorProblem ? "SOURCE_LOCATOR_INVALID" : "INVALID_INPUT",
    };
  }
  return { ok: true, facts };
}

function validateConflicts(
  raw: unknown,
  factIds: ReadonlySet<string>,
): { ok: true; conflicts: FactConflict[] } | { ok: false; fields: IntakeFieldError[] } {
  if (raw === undefined) raw = [];
  if (!Array.isArray(raw)) return { ok: false, fields: [{ path: "conflicts", reason: "冲突列表格式不正确" }] };
  const fields: IntakeFieldError[] = [];
  const seen = new Set<string>();
  const conflicts: FactConflict[] = [];
  for (const item of raw) {
    if (!isRecord(item) || typeof item.id !== "string") {
      fields.push({ path: "conflicts", reason: "冲突缺少 id" });
      continue;
    }
    const path = `conflicts.${item.id}`;
    if (seen.has(item.id)) {
      fields.push({ path, reason: "同一冲突不能重复" });
      continue;
    }
    seen.add(item.id);
    const ids = Array.isArray(item.factIds) ? item.factIds : [];
    if (ids.length === 0 || ids.some((id) => typeof id !== "string" || !factIds.has(id))) {
      fields.push({ path: `${path}.factIds`, reason: "冲突必须引用本快照中的事实" });
      continue;
    }
    const chosen = Array.isArray(item.chosenFactIds) ? item.chosenFactIds : [];
    if (chosen.some((id) => typeof id !== "string" || !ids.includes(id))) {
      fields.push({ path: `${path}.chosenFactIds`, reason: "选择的事实必须属于这个冲突" });
      continue;
    }
    const reason = typeof item.reason === "string" ? item.reason : null;
    switch (item.state) {
      case "open":
        if (chosen.length > 0) fields.push({ path: `${path}.chosenFactIds`, reason: "暂不处理时不能选择事实" });
        if (reason !== null && reason.trim().length > 0) {
          fields.push({ path: `${path}.reason`, reason: "暂不处理时不填写理由" });
        }
        conflicts.push({ id: item.id, factIds: ids, state: "open", chosenFactIds: [], reason: null });
        break;
      case "resolved":
        if (chosen.length === 0) {
          fields.push({ path: `${path}.chosenFactIds`, reason: "选择处理时必须至少选择一方事实" });
        }
        if (reason !== null && reason.trim().length > 0) {
          fields.push({ path: `${path}.reason`, reason: "选择处理时不填写保留理由" });
        }
        conflicts.push({ id: item.id, factIds: ids, state: "resolved", chosenFactIds: chosen, reason: null });
        break;
      case "retained":
        if (chosen.length > 0) fields.push({ path: `${path}.chosenFactIds`, reason: "保留冲突时不能只选择一方" });
        if (reason === null || reason.trim().length === 0) {
          fields.push({ path: `${path}.reason`, reason: "保留冲突必须填写理由" });
        }
        conflicts.push({
          id: item.id,
          factIds: ids,
          state: "retained",
          chosenFactIds: [],
          reason: reason === null ? null : reason.trim(),
        });
        break;
      default:
        fields.push({ path: `${path}.state`, reason: "冲突处理方式不在给定范围内" });
    }
  }
  return fields.length > 0 ? { ok: false, fields } : { ok: true, conflicts };
}

function validateQuestionSource(
  raw: QuestionSource | undefined,
  index: MatterChunkIndex,
  path: string,
): { ok: true; source: QuestionSource } | { ok: false; fields: IntakeFieldError[]; errorCode: IntakeErrorCode } {
  if (raw === undefined || raw === null) {
    return {
      ok: false,
      fields: [{ path, reason: "每题的答案都要标明来源：材料段落、材料中未找到或用户直接回答" }],
      errorCode: "INVALID_INPUT",
    };
  }
  if (raw.kind === "direct" || raw.kind === "not_found") return { ok: true, source: raw };
  if (raw.kind !== "source") {
    return { ok: false, fields: [{ path, reason: "来源只能是材料段落、材料中未找到或用户直接回答" }], errorCode: "INVALID_INPUT" };
  }
  const problem = sourceRefProblem(raw.ref, index);
  if (problem) {
    return { ok: false, fields: [{ path, reason: problem }], errorCode: "SOURCE_LOCATOR_INVALID" };
  }
  return { ok: true, source: { kind: "source", ref: raw.ref } };
}

function candidateRefFields(
  candidate: StagedCandidate,
  index: MatterChunkIndex,
): IntakeFieldError[] {
  const fields: IntakeFieldError[] = [];
  for (const ref of candidate.refs) {
    const problem = sourceRefProblem(ref, index);
    if (problem) fields.push({ path: `adoptCandidateIds.${candidate.id}.refs`, reason: problem });
  }
  if (candidate.status === "source_backed" && candidate.refs.length === 0) {
    fields.push({ path: `adoptCandidateIds.${candidate.id}.refs`, reason: "材料支撑的候选事实缺少来源" });
  }
  return fields;
}

/**
 * How many times one save is attempted. The matter's `version` moves on every
 * write (a target add, a parse step, an ingest), while only intake moves
 * `sourceVersion`. A commit that loses its version check is therefore rebuilt
 * on the fresh matter when `sourceVersion` still equals the save's base, and
 * reported as a fact conflict only when it does not.
 */
const MAX_SAVE_ATTEMPTS = 3;

/** An attempt whose commit lost the matter version check; the next attempt reloads. */
const MATTER_MOVED = Symbol("intake.matter-moved");

/** Nothing was committed because other writes kept moving the matter. */
export const MATTER_BUSY_MESSAGE = "案件同时有其他写入，这次没有保存。请再保存一次。";

interface SaveAttemptContext {
  now: () => string;
  newId: () => string;
  requestKey: string | null;
}

/**
 * Save one source snapshot. The sequence is the same one V6-11 uses for a
 * parse transition: the matter version bump and its §10 event commit first,
 * then the `intake/` rows. A blob failure after the commit is reported with
 * `committedVersion`; a later read recovers at that version (see `readIntake`)
 * and the next save at that version writes the complete snapshot.
 *
 * A fact conflict (`sourceVersion` is not the save's base) returns
 * `VERSION_CONFLICT` with the stored `sourceVersion` and its readable snapshot,
 * for a side-by-side merge. A commit that lost only to an unrelated matter
 * write is rebuilt on the fresh matter, at most `MAX_SAVE_ATTEMPTS` times.
 * With a request key every attempt derives the same event id. Either way a
 * failed version check writes nothing, so a rebuild never records a second
 * event.
 *
 * With a request key, the key is claimed in one read-write transaction before
 * any state gate or business write, and only the claim owner may commit. An
 * identical request either replays a completed record (including an unchanged
 * save that wrote no version), finishes a committed one, waits briefly for a
 * live owner, or takes over a claim whose lease expired; a different payload is
 * refused whatever the record's state. A pre-commit failure releases the claim,
 * so the same request can claim it again. After a commit, the record is marked
 * committed before the blob batch, so a failed batch is replayed as the
 * original committed error rather than becoming a conflict.
 */
export async function saveIntake(
  repository: LocalRepository,
  actor: Actor,
  matterId: string,
  command: SaveIntakeInput,
  options: SaveIntakeOptions = {},
): Promise<SaveIntakeOutcome> {
  const context: SaveAttemptContext = {
    now: options.now ?? (() => new Date().toISOString()),
    newId: options.newId ?? (() => globalThis.crypto.randomUUID()),
    requestKey: options.requestKey ?? null,
  };
  if (context.requestKey !== null && !REQUEST_KEY_PATTERN.test(context.requestKey)) {
    return failure("INVALID_INPUT", [{ path: "requestKey", reason: "幂等键格式不正确" }]);
  }
  if (!Number.isSafeInteger(command?.baseSourceVersion) || command.baseSourceVersion < 1) {
    return failure("INVALID_INPUT", [
      { path: "baseSourceVersion", reason: "保存必须说明基于哪一版事实" },
    ]);
  }

  for (let attempt = 1; attempt <= MAX_SAVE_ATTEMPTS; attempt += 1) {
    const outcome = await attemptSave(repository, actor, matterId, command, context);
    if (outcome !== MATTER_MOVED) return outcome;
  }
  // Every attempt lost to another write. Report the facts as they stand now.
  const reloaded = await repository.loadMatter(actor, matterId);
  if (!reloaded.ok) {
    return failure(reloaded.error.code === "RESOURCE_NOT_FOUND" ? "RESOURCE_NOT_FOUND" : "STORAGE_UNAVAILABLE");
  }
  const sourceVersion = reloaded.data.data.matter.sourceVersion;
  if (sourceVersion !== command.baseSourceVersion) {
    return versionConflict(repository, matterId, sourceVersion);
  }
  // No fact moved and nothing was committed: the same request may be retried.
  return failure("STORAGE_UNAVAILABLE", undefined, { message: MATTER_BUSY_MESSAGE });
}

/**
 * `VERSION_CONFLICT` at the stored `sourceVersion`, with that version's
 * snapshot for the merge view. When that snapshot was never written (a
 * post-commit failure), the newest older one is given instead; its own
 * `version` field says which version it is.
 */
async function versionConflict(
  repository: LocalRepository,
  matterId: string,
  sourceVersion: number,
): Promise<IntakeFailure> {
  const stored = await readStoredState(repository, matterId, sourceVersion);
  let latest: SourceSnapshot | null = stored.ok ? (stored.state.envelope?.snapshot ?? null) : null;
  if (stored.ok && latest === null && sourceVersion !== 1) {
    const older = await readRecoveryEnvelope(repository, matterId, sourceVersion);
    latest = older.ok ? (older.envelope?.snapshot ?? null) : null;
  }
  return failure("VERSION_CONFLICT", undefined, { latestVersion: sourceVersion, latest });
}

/** One save attempt against a freshly loaded matter. */
async function attemptSave(
  repository: LocalRepository,
  actor: Actor,
  matterId: string,
  command: SaveIntakeInput,
  { now, newId, requestKey }: SaveAttemptContext,
): Promise<SaveIntakeOutcome | typeof MATTER_MOVED> {
  const loaded = await repository.loadMatter(actor, matterId);
  if (!loaded.ok) {
    const code = loaded.error.code === "RESOURCE_NOT_FOUND" ? "RESOURCE_NOT_FOUND" : "STORAGE_UNAVAILABLE";
    return failure(code);
  }
  const matter = loaded.data.data.matter;

  const requestHash = await sha256Hex(
    new TextEncoder().encode(
      canonicalJson({
        matterId,
        baseSourceVersion: command.baseSourceVersion,
        answers: command.answers,
        questionSources: command.questionSources,
        facts: command.facts,
        conflicts: command.conflicts,
        parties: command.parties,
        adoptCandidateIds: command.adoptCandidateIds ?? [],
      }),
    ),
  );

  // §2: claim the key in one transaction before any state gate or business
  // write, so two concurrent requests cannot both pass the check. A completed
  // request is answered from its record before the gate, so replaying a landed
  // save still succeeds after the matter is archived.
  let claim: { claimId: string } | null = null;
  if (requestKey !== null) {
    const claimId = newId();
    const claimed = await claimIdempotency(
      repository,
      actor,
      requestKey,
      { matterId, requestHash, at: now() },
      claimId,
    );
    if (claimed.kind === "replay") return replayIdempotent(repository, matterId, claimed.record);
    if (claimed.kind === "committed") return replayCommitted(repository, matterId, claimed.record);
    if (claimed.kind === "conflict") return failure("IDEMPOTENCY_CONFLICT");
    if (claimed.kind === "busy") {
      return failure("STORAGE_UNAVAILABLE", undefined, { message: REQUEST_IN_FLIGHT_MESSAGE });
    }
    if (claimed.kind === "failed") return failure("STORAGE_UNAVAILABLE");
    claim = { claimId: claimed.claimId };
  }

  let holdClaim = claim !== null;
  try {
    return await attemptClaimedSave(
      repository,
      actor,
      matterId,
      command,
      { now, newId, requestKey },
      loaded.data,
      requestHash,
      claim,
      () => {
        holdClaim = false;
      },
    );
  } finally {
    if (holdClaim && claim !== null && requestKey !== null) {
      await releaseClaim(repository, actor, requestKey, claim.claimId);
    }
  }
}

/**
 * The body of one save attempt, after the key (if any) has been claimed. Every
 * failure before a business write leaves the claim to `attemptSave`, which
 * releases it; once the commit lands or a no-op is settled, `onClaimSettled`
 * says the record must be kept.
 */
async function attemptClaimedSave(
  repository: LocalRepository,
  actor: Actor,
  matterId: string,
  command: SaveIntakeInput,
  { now, newId, requestKey }: SaveAttemptContext,
  read: MatterRead,
  requestHash: string,
  claim: { claimId: string } | null,
  onClaimSettled: () => void,
): Promise<SaveIntakeOutcome | typeof MATTER_MOVED> {
  const matter = read.data.matter;

  if (matter.status !== "active") return failure("INVALID_TRANSITION");

  if (command.baseSourceVersion !== matter.sourceVersion) {
    return versionConflict(repository, matterId, matter.sourceVersion);
  }

  const stored = await readStoredState(repository, matterId, matter.sourceVersion);
  if (!stored.ok) return failure("STORAGE_UNAVAILABLE");
  const chunkIndex = await loadChunkIndex(repository, actor, matterId);
  if (!chunkIndex.ok) return failure(chunkIndex.errorCode);
  const index = chunkIndex.index;
  // A committed version without its snapshot builds on the newest older one,
  // for provenance and confirmation carry-over, and always writes: an
  // "unchanged" save there would leave the gap open.
  const recovering = stored.state.envelope === null && matter.sourceVersion !== 1;
  let current = stored.state.envelope;
  if (recovering) {
    const older = await readRecoveryEnvelope(repository, matterId, matter.sourceVersion);
    if (!older.ok) return failure("STORAGE_UNAVAILABLE");
    current = older.envelope;
  }

  // Answers and their provenance.
  const answerShape = validateAnswersShape(command.answers);
  if (!answerShape.ok) return answerFailure(answerShape.fields);
  const answers = answerShape.answers;
  // §3: disclosure evidence refs locate like every other source ref.
  const evidenceFields: IntakeFieldError[] = [];
  (answers.disclosureDetail?.evidenceRefs ?? []).forEach((ref, position) => {
    const checked = validateRefList([ref], index, `answers.disclosureDetail.evidenceRefs[${position}]`);
    if (!checked.ok) evidenceFields.push(...checked.fields);
  });
  if (evidenceFields.length > 0) return failure("SOURCE_LOCATOR_INVALID", evidenceFields);

  const partyResult = validateParties(command.parties);
  if (!partyResult.ok) return failure("INVALID_INPUT", partyResult.fields);
  const partyById = new Map(partyResult.parties.map((party) => [party.id, party]));
  const inventorFields: IntakeFieldError[] = [];
  for (const inventorId of answers.inventorIds) {
    const party = partyById.get(inventorId);
    if (!party) {
      inventorFields.push({ path: "answers.inventorIds", reason: "发明人必须是案件中已添加的人员" });
    } else if (party.kind !== "person") {
      // S03: an organization can never be an inventor.
      inventorFields.push({ path: "answers.inventorIds", reason: "发明人必须是自然人" });
    }
  }
  if (inventorFields.length > 0) return failure("INVALID_INPUT", inventorFields);

  const factResult = validateFacts(command.facts, index, actor, now, current?.snapshot.facts ?? []);
  if (!factResult.ok) return failure(factResult.errorCode, factResult.fields);
  let facts = factResult.facts;

  // Candidates are written only by explicit adoption, and only now.
  const adoptIds = [...new Set(command.adoptCandidateIds ?? [])];
  const adoptedUpdates: { id: string; factId: string }[] = [];
  if (adoptIds.length > 0) {
    const candidateSet = stored.state.candidates;
    const fields: IntakeFieldError[] = [];
    if (!candidateSet) {
      return failure("INVALID_INPUT", [{ path: "adoptCandidateIds", reason: "没有可采纳的候选事实" }]);
    }
    const factIds = new Set(facts.map((fact) => fact.id));
    for (const id of adoptIds) {
      const candidate = candidateSet.candidates.find((item) => item.id === id);
      if (!candidate) {
        fields.push({ path: `adoptCandidateIds.${id}`, reason: "候选事实不存在" });
        continue;
      }
      if (candidate.adoptedFactId !== null || factIds.has(candidate.id)) {
        fields.push({ path: `adoptCandidateIds.${id}`, reason: "候选事实已经采纳" });
        continue;
      }
      const refFields = candidateRefFields(candidate, index);
      if (refFields.length > 0) {
        fields.push(...refFields);
        continue;
      }
      factIds.add(candidate.id);
      facts = [
        ...facts,
        {
          id: candidate.id,
          statement: candidate.statement,
          kind: candidate.kind,
          status: candidate.status,
          refs: candidate.refs,
          confirmedBy: candidate.status === "user_confirmed" ? actor.userId : null,
          confirmedAt: candidate.status === "user_confirmed" ? now() : null,
        },
      ];
      adoptedUpdates.push({ id: candidate.id, factId: candidate.id });
    }
    if (fields.length > 0) return failure("INVALID_INPUT", fields);
  }

  const factIds = new Set(facts.map((fact) => fact.id));
  const conflictResult = validateConflicts(command.conflicts, factIds);
  if (!conflictResult.ok) return failure("INVALID_INPUT", conflictResult.fields);

  // One of the three sources per answered question; nothing for an unanswered one.
  const questionSources = command.questionSources ?? {};
  const nextProvenance: Partial<Record<IntakeQuestionKey, QuestionProvenance>> = {};
  const sourceFields: IntakeFieldError[] = [];
  let sourceLocatorProblem = false;
  for (const key of INTAKE_QUESTION_KEYS) {
    if (!isAnswered(key, answers)) continue;
    const checked = validateQuestionSource(questionSources[key], index, `sources.${key}`);
    if (!checked.ok) {
      sourceLocatorProblem ||= checked.errorCode === "SOURCE_LOCATOR_INVALID";
      sourceFields.push(...checked.fields);
      continue;
    }
    const previous = current?.provenance[key] ?? null;
    const previousValue = current ? answerValue(key, current.snapshot.answers) : undefined;
    const unchangedAnswer =
      previous !== null && sameJson(previousValue, answerValue(key, answers)) && sameJson(previous.source, checked.source);
    nextProvenance[key] = unchangedAnswer
      ? previous
      : {
          key,
          source: checked.source,
          basedOnVersion: matter.sourceVersion,
          savedAt: now(),
          savedBy: actor.userId,
        };
  }
  if (sourceFields.length > 0) {
    return failure(sourceLocatorProblem ? "SOURCE_LOCATOR_INVALID" : "INVALID_INPUT", sourceFields);
  }

  const nextVersion = matter.sourceVersion + 1;
  const snapshot: SourceSnapshot = {
    matterId,
    version: nextVersion,
    sourceIds: index.sourceIds,
    facts,
    conflicts: conflictResult.conflicts,
    answers,
    parties: partyResult.parties,
    createdBy: actor.userId,
    createdAt: now(),
  };
  const parsed = sourceSnapshotSchema.safeParse(snapshot);
  if (!parsed.success) {
    return failure(
      "INVALID_INPUT",
      parsed.error.issues.map((issue) => ({
        path: issue.path.length > 0 ? issue.path.join(".") : "snapshot",
        reason: issue.message,
      })),
    );
  }
  const finalSnapshot = parsed.data;

  // §3: unchanged answers (or a pure back-and-forward) do not write a version.
  // A fresh matter has no stored snapshot; its empty form is the baseline.
  const baseline = current?.snapshot ?? emptySnapshot(matter, index.sourceIds);
  const baselineProvenance = current?.provenance ?? {};
  const unchanged =
    !recovering &&
    sameJson(
      {
        sourceIds: baseline.sourceIds,
        facts: baseline.facts,
        conflicts: baseline.conflicts,
        answers: baseline.answers,
        parties: baseline.parties,
      },
      {
        sourceIds: finalSnapshot.sourceIds,
        facts: finalSnapshot.facts,
        conflicts: finalSnapshot.conflicts,
        answers: finalSnapshot.answers,
        parties: finalSnapshot.parties,
      },
    ) &&
    sameJson(baselineProvenance, nextProvenance);
  if (unchanged) {
    // §2: a no-op is still a completed request. Settle the claim with the
    // baseline snapshot under the same request hash; nothing else is written,
    // so S03-A03 still writes no version.
    if (requestKey !== null && claim !== null) {
      const finalized = await completeNoopClaim(repository, actor, requestKey, claim.claimId, requestHash, {
        kind: "intake.idempotency",
        operation: SAVE_OPERATION,
        matterId,
        requestKey,
        requestHash,
        version: matter.sourceVersion,
        at: now(),
        state: "completed",
        claimId: claim.claimId,
        unchanged: true,
        snapshot: baseline,
      });
      if (finalized.kind === "replay") return replayIdempotent(repository, matterId, finalized.record);
      if (finalized.kind === "lost") {
        return failure("STORAGE_UNAVAILABLE", undefined, { message: REQUEST_IN_FLIGHT_MESSAGE });
      }
      if (finalized.kind === "failed") return failure("STORAGE_UNAVAILABLE");
      onClaimSettled();
    }
    return {
      ok: true,
      version: matter.sourceVersion,
      snapshot: baseline,
      unchanged: true,
      replayed: false,
    };
  }

  const at = now();
  const event: ActivityRecord = {
    id: requestKey !== null ? await derivedId(`v6/intake/event/${matterId}/${requestKey}`) : newId(),
    tenantId: matter.tenantId,
    matterId,
    targetId: null,
    actorId: actor.userId,
    actorKind: "user",
    action: "snapshot.created",
    snapshot: null,
    jobId: null,
    resourceId: matterId,
    occurredAt: at,
    metadata: { version: nextVersion, count: finalSnapshot.facts.length },
  };

  const completedRecord = (version: number): IdempotencyRecord => ({
    kind: "intake.idempotency",
    operation: SAVE_OPERATION,
    matterId,
    requestKey: requestKey as string,
    requestHash,
    version,
    at,
    state: "completed",
    claimId: claim?.claimId,
    unchanged: false,
  });
  const committedRecord = (version: number): IdempotencyRecord => ({
    ...completedRecord(version),
    state: "committed",
  });

  /**
   * Finish a committed version: its snapshot (and any adopted-candidate links)
   * plus, when this attempt owns the key, the completed idempotency record in
   * the same blob transaction. A failed batch leaves the committed record in
   * place, so a same-key replay answers with the original committed error.
   */
  const completeVersionWrite = async (
    version: number,
    snapshot: SourceSnapshot,
    replayed: boolean,
  ): Promise<SaveIntakeOutcome> => {
    const envelope: IntakeEnvelope = {
      kind: "intake.snapshot",
      snapshot,
      provenance: nextProvenance,
      requestKey,
    };
    const writes: { key: string; value: unknown }[] = [
      { key: snapshotKey(matterId, version), value: envelope },
    ];
    if (adoptedUpdates.length > 0 && stored.state.candidates) {
      const byId = new Map(adoptedUpdates.map((update) => [update.id, update.factId]));
      writes.push({
        key: candidatesKey(matterId),
        value: {
          ...stored.state.candidates,
          candidates: stored.state.candidates.candidates.map((candidate) =>
            byId.has(candidate.id)
              ? { ...candidate, adoptedFactId: byId.get(candidate.id) ?? null }
              : candidate,
          ),
        } satisfies CandidateSetRecord,
      });
    }
    const done =
      requestKey === null || claim === null
        ? (await writeBlobs(repository, writes))
          ? "completed"
          : "failed"
        : await writeCommittedBlobs(
            repository,
            actor,
            requestKey,
            claim.claimId,
            requestHash,
            completedRecord(version),
            writes,
          );
    if (done !== "completed") {
      return failure("STORAGE_UNAVAILABLE", undefined, {
        committedVersion: version,
        message: committedWithoutSnapshotMessage(version),
      });
    }
    return { ok: true, version, snapshot, unchanged: false, replayed };
  };

  /**
   * A commit that failed may still have been made by an earlier attempt of this
   * same request (its deterministic event id is the backstop). Find it: replay
   * its response when the snapshot exists, otherwise finish that version here.
   */
  const recoverCommittedAttempt = async (): Promise<SaveIntakeOutcome | null> => {
    if (requestKey === null || claim === null) return null;
    const found = await committedEventVersion(repository, actor, matterId, requestKey);
    if (!found.ok || found.version === null) return null;
    // The commit is real: keep a record for it, never release the key.
    onClaimSettled();
    const version = found.version;
    const storedAt = await readStoredState(repository, matterId, version);
    if (storedAt.ok && storedAt.state.envelope !== null) {
      await settleClaim(repository, actor, requestKey, claim.claimId, requestHash, completedRecord(version));
      return {
        ok: true,
        version,
        snapshot: storedAt.state.envelope.snapshot,
        unchanged: false,
        replayed: true,
      };
    }
    const marked = await settleClaim(repository, actor, requestKey, claim.claimId, requestHash, committedRecord(version));
    if (marked === "settled" && storedAt.ok && version === nextVersion) {
      return completeVersionWrite(version, finalSnapshot, true);
    }
    return failure("STORAGE_UNAVAILABLE", undefined, {
      committedVersion: version,
      message: committedWithoutSnapshotMessage(version),
    });
  };

  const committed = await repository.commit(
    actor,
    {
      contractVersion: CONTRACT_VERSION,
      expectedVersion: matter.version,
      payload: {
        matter: { ...matter, version: matter.version + 1, sourceVersion: nextVersion, updatedAt: at },
        targets: read.data.targets,
        assets: read.data.assets,
        events: [event],
        blobs: [],
      },
    },
    { requestId: requestKey ?? newId() },
  );
  if (!committed.ok) {
    // The repository's latestVersion is the matter's aggregate `version`, not
    // `sourceVersion`. The next attempt reloads and tells the two cases apart;
    // the claim is released there, so a retry can claim the key again.
    if (committed.error.code === "VERSION_CONFLICT") return MATTER_MOVED;
    if (committed.error.code === "INVALID_INPUT" && requestKey !== null) {
      // A duplicate deterministic event id can mean an earlier attempt of this
      // same request committed first; finish or replay that commit.
      const recovered = await recoverCommittedAttempt();
      if (recovered !== null) return recovered;
    }
    if (committed.error.code === "INVALID_TRANSITION") return failure("INVALID_TRANSITION");
    if (committed.error.code === "INVALID_INPUT") {
      return failure("INVALID_INPUT", [{ path: "snapshot", reason: committed.error.message }]);
    }
    return failure("STORAGE_UNAVAILABLE");
  }

  // The business write landed: the key must never be released now.
  onClaimSettled();
  if (requestKey !== null && claim !== null) {
    // Mark the committed version before the blob batch, so a failed batch still
    // leaves a replayable record rather than a bare version bump.
    const marked = await settleClaim(
      repository,
      actor,
      requestKey,
      claim.claimId,
      requestHash,
      committedRecord(nextVersion),
    );
    if (marked !== "settled") {
      return failure("STORAGE_UNAVAILABLE", undefined, {
        committedVersion: nextVersion,
        message: committedWithoutSnapshotMessage(nextVersion),
      });
    }
  }
  return completeVersionWrite(nextVersion, finalSnapshot, false);
}

// ---------------------------------------------------------------------------
// Extract candidates (no extract provider ships in R1; this is its seam)
// ---------------------------------------------------------------------------

export interface StageCandidatesOptions {
  jobId?: string | null;
  now?: () => string;
}

export type StageCandidatesOutcome =
  | { ok: true; candidates: StagedCandidate[] }
  | IntakeFailure;

/**
 * Record the candidates an extract job produced. Candidates never enter a
 * snapshot here: `saveIntake` is the only adoption path, and only for ids the
 * caller names explicitly.
 */
export async function stageCandidates(
  repository: LocalRepository,
  actor: Actor,
  matterId: string,
  candidates: readonly CandidateInput[],
  options: StageCandidatesOptions = {},
): Promise<StageCandidatesOutcome> {
  const now = options.now ?? (() => new Date().toISOString());
  const loaded = await repository.loadMatter(actor, matterId);
  if (!loaded.ok) {
    return failure(loaded.error.code === "RESOURCE_NOT_FOUND" ? "RESOURCE_NOT_FOUND" : "STORAGE_UNAVAILABLE");
  }
  if (loaded.data.data.matter.status !== "active") return failure("INVALID_TRANSITION");
  const indexResult = await loadChunkIndex(repository, actor, matterId);
  if (!indexResult.ok) return failure(indexResult.errorCode);
  const fields: IntakeFieldError[] = [];
  const seen = new Set<string>();
  const staged: StagedCandidate[] = [];
  for (const candidate of candidates) {
    const path = `candidates.${candidate.id}`;
    if (typeof candidate.id !== "string" || candidate.id.length === 0) {
      fields.push({ path: "candidates", reason: "候选事实缺少 id" });
      continue;
    }
    if (seen.has(candidate.id)) {
      fields.push({ path, reason: "候选事实不能重复" });
      continue;
    }
    seen.add(candidate.id);
    if (typeof candidate.statement !== "string" || candidate.statement.trim().length === 0) {
      fields.push({ path: `${path}.statement`, reason: "候选事实内容不能为空" });
    }
    if (!factKindSchema.safeParse(candidate.kind).success) {
      fields.push({ path: `${path}.kind`, reason: "候选事实类型不在给定范围内" });
    }
    if (!factStatusSchema.safeParse(candidate.status).success) {
      fields.push({ path: `${path}.status`, reason: "候选事实状态不在给定范围内" });
      continue;
    }
    const refs = validateRefList(candidate.refs, indexResult.index, `${path}.refs`);
    if (!refs.ok) {
      fields.push(...refs.fields);
      continue;
    }
    if (candidate.status === "source_backed" && refs.refs.length === 0) {
      fields.push({ path: `${path}.refs`, reason: "材料支撑的候选事实缺少来源" });
    }
    staged.push({
      id: candidate.id,
      statement: candidate.statement,
      kind: candidate.kind,
      status: candidate.status,
      refs: refs.refs,
      stagedAt: now(),
      adoptedFactId: null,
    });
  }
  if (fields.length > 0) return failure("INVALID_INPUT", fields);

  const existing = await readStoredState(repository, matterId, loaded.data.data.matter.sourceVersion);
  if (!existing.ok) return failure("STORAGE_UNAVAILABLE");
  const previous = existing.state.candidates;
  const merged = new Map<string, StagedCandidate>();
  for (const candidate of previous?.candidates ?? []) merged.set(candidate.id, candidate);
  for (const candidate of staged) {
    const old = merged.get(candidate.id);
    // A candidate that was already adopted keeps its adoption link.
    merged.set(candidate.id, old?.adoptedFactId ? { ...candidate, adoptedFactId: old.adoptedFactId } : candidate);
  }
  const record: CandidateSetRecord = {
    kind: "intake.candidates",
    matterId,
    jobId: options.jobId ?? previous?.jobId ?? null,
    stagedAt: now(),
    stagedBy: actor.userId,
    candidates: [...merged.values()],
  };
  const wrote = await writeBlobs(repository, [{ key: candidatesKey(matterId), value: record }]);
  return wrote ? { ok: true, candidates: staged } : failure("STORAGE_UNAVAILABLE");
}

// ---------------------------------------------------------------------------
// Draft input bindings (the seam a drafting ticket calls)
// ---------------------------------------------------------------------------

export type BindDraftOutcome =
  | { ok: true; binding: DraftBinding }
  | IntakeFailure;

/**
 * Remember the `DraftInputRef` a draft was generated from. A later fact change
 * moves `sourceVersion`, and `readIntake` then reports that draft as stale. The
 * binding never changes the draft itself and never bumps a version.
 */
export async function bindDraftInput(
  repository: LocalRepository,
  actor: Actor,
  matterId: string,
  input: DraftInputRef,
  options: { now?: () => string } = {},
): Promise<BindDraftOutcome> {
  const now = options.now ?? (() => new Date().toISOString());
  const loaded = await repository.loadMatter(actor, matterId);
  if (!loaded.ok) {
    return failure(loaded.error.code === "RESOURCE_NOT_FOUND" ? "RESOURCE_NOT_FOUND" : "STORAGE_UNAVAILABLE");
  }
  const matter = loaded.data.data.matter;
  const target = loaded.data.data.targets.find((item) => item.id === input?.targetId);
  if (!target) return failure("RESOURCE_NOT_FOUND");
  if (
    input.matterId !== matterId ||
    !Number.isSafeInteger(input.sourceVersion) ||
    input.sourceVersion < 1 ||
    input.sourceVersion > matter.sourceVersion ||
    !Number.isSafeInteger(input.targetConfigVersion) ||
    input.targetConfigVersion < 1 ||
    typeof input.figureRevisionId !== "string" ||
    input.figureRevisionId.length === 0
  ) {
    return failure("INVALID_INPUT", [{ path: "input", reason: "草稿输入引用不属于当前案件或版本" }]);
  }
  const binding: DraftBinding = {
    targetId: input.targetId,
    input: {
      matterId,
      targetId: input.targetId,
      sourceVersion: input.sourceVersion,
      targetConfigVersion: input.targetConfigVersion,
      figureRevisionId: input.figureRevisionId,
    },
    boundAt: now(),
  };
  try {
    await repository.backend.transaction("readwrite", async (tx) => {
      const record = asDraftsRecord(await tx.get(STORES.blobs, draftsKey(matterId)));
      const bindings = (record?.bindings ?? []).filter((item) => item.targetId !== binding.targetId);
      await tx.put(STORES.blobs, draftsKey(matterId), {
        kind: "intake.drafts",
        matterId,
        bindings: [...bindings, binding],
      } satisfies DraftsRecord);
    });
  } catch {
    return failure("STORAGE_UNAVAILABLE");
  }
  return { ok: true, binding };
}

/** Read the draft bindings without the rest of the view (for a drafting caller). */
export async function readDraftBindings(
  repository: LocalRepository,
  actor: Actor,
  matterId: string,
): Promise<{ ok: true; bindings: DraftBinding[] } | { ok: false; errorCode: IntakeErrorCode }> {
  const loaded = await repository.loadMatter(actor, matterId);
  if (!loaded.ok) {
    return {
      ok: false,
      errorCode: loaded.error.code === "RESOURCE_NOT_FOUND" ? "RESOURCE_NOT_FOUND" : "STORAGE_UNAVAILABLE",
    };
  }
  try {
    const record = await repository.backend.transaction("readonly", async (tx) =>
      asDraftsRecord(await tx.get(STORES.blobs, draftsKey(matterId))),
    );
    return { ok: true, bindings: record?.bindings ?? [] };
  } catch {
    return { ok: false, errorCode: "STORAGE_UNAVAILABLE" };
  }
}
