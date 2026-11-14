/**
 * V6-15 — AI capability and outbound authorization (S04, 05-contracts §1/§5).
 *
 * One deep module owns every rule between a matter's persisted state and an
 * outbound authorization. The React panel and the engine suite use the same
 * public interface; nothing here calls a model, opens a socket, reads a key or
 * imports a provider adapter.
 *
 * - `loadAiView` answers the S04 AI/data page: honest per-mode capabilities,
 *   synthetic provider profiles (unknown fields rendered as 「未知」), the exact
 *   material manifest for the selected matter or target, the actor's consents
 *   and a content-free invocation table.
 * - `grantConsent` builds the manifest again from the matter's current state and
 *   refuses a scope or hash that no longer matches (`STALE_BINDING`). A Consent
 *   is saved only for a known, approved platform profile; local and stub need no
 *   consent, and BYOK is unavailable in the browser build.
 * - `validateConsentForUse` is the check a future job runner must run before a
 *   call. A revoked, expired, purpose-mismatched, provider-changed or
 *   material-changed consent is `CONSENT_REQUIRED`/`CONSENT_REVOKED` — an old
 *   consent never covers a new file (S04-A02).
 * - `revokeConsent` is append-only: one `consent.revoked` event with a
 *   deterministic id, so a second revocation never duplicates it. The Consent
 *   row stays for history.
 * - `requestRealInvocation` always answers `RELEASE_GATE_CLOSED` before touching
 *   storage or the network. This build cannot make a real outbound call.
 *
 * Idempotency follows 05-contracts §2: keys are scoped by
 * (tenant, actor, operation, key), never by matter; the matter is part of the
 * request hash. An identical replay returns the original response with
 * `replayed: true` (even after the matter is archived); a different payload
 * under the same key is `IDEMPOTENCY_CONFLICT`; a new request on an archived
 * matter is `INVALID_TRANSITION`.
 *
 * A keyed grant or revoke first claims its key in one read-write transaction.
 * The claim (a pending record with a unique claim id and a lease) is the only
 * authority to run the business read-check-write; a concurrent different
 * payload conflicts before writing, an identical request waits briefly and
 * then reports a retryable busy, and an expired lease is taken over. After the
 * business commit the owner finalizes the same record with the original
 * response. A response is prepared before the commit, so if finalizing fails
 * after a landed commit the deterministic consent id or event id proves the
 * commit and a same-key retry replays that exact response.
 *
 * Persistence uses the existing `blobs` store with namespaced keys. A Consent
 * is authoritative only when its `consent.granted` event exists, so a row left
 * orphaned by a failed commit can never authorize anything. Orphan cleanup
 * checks the row and the granted event in one transaction and never deletes a
 * row whose event survived.
 */
import {
  consentSchema,
  consentScopeSchema,
  modelInvocationSchema,
  providerProfileSchema,
  type Consent,
  type ConsentScope,
  type ModelInvocation,
  type ProviderProfile,
} from "../../../../../../packages/contracts/src/jobs.ts";
import {
  CONTRACT_VERSION,
  STORES,
  sha256Hex,
  type ActivityRecord,
  type Actor,
  type LocalRepository,
  type MatterAggregate,
  type MatterRecord,
  type RepositoryError,
  type TargetRecord,
} from "../../lib/repository.ts";

import {
  answerManifestSummary,
  buildAnswerSources,
  readSnapshotAnswerInput,
  type AnswerManifestSummary,
  type AnswerSourceInput,
} from "../intake/answer-sources.ts";

// ---------------------------------------------------------------------------
// Public vocabulary
// ---------------------------------------------------------------------------

export type ProviderMode = "local" | "platform" | "byok" | "stub";
export type ProviderPurpose = "extract" | "draft" | "check" | "ocr";
export type TrainingPolicy = "no_training" | "allowed" | "unknown";

export type AiErrorCode =
  | "INVALID_INPUT"
  | "RESOURCE_NOT_FOUND"
  | "VERSION_CONFLICT"
  | "IDEMPOTENCY_CONFLICT"
  | "INVALID_TRANSITION"
  | "STALE_BINDING"
  | "CONSENT_REQUIRED"
  | "CONSENT_REVOKED"
  | "CAPABILITY_UNAVAILABLE"
  | "RELEASE_GATE_CLOSED"
  | "QUOTA_EXCEEDED"
  | "STORAGE_UNAVAILABLE";

export interface AiError {
  code: AiErrorCode;
  message: string;
  /** Contract field names an operator can act on (unknown profile fields). */
  fields?: readonly string[];
  /** Ids an operator can act on; never document content. */
  resourceIds?: readonly string[];
}

export type AiResult<T> = { ok: true; data: T; replayed: boolean } | { ok: false; error: AiError };

export interface ProviderProfileConfig {
  configVersion: string;
  profiles: readonly ProviderProfile[];
  /** Set only by the status-backed runtime; synthetic/default configurations remain closed. */
  releaseGate?: "open" | "closed";
}

export const AI_RUNTIME = "local_web" as const;
export type AiReleaseGate = "open" | "closed";
/** Resolve from the same-origin status-backed configuration; omitted/synthetic configuration stays closed. */
export function AI_RELEASE_GATE(config?: ProviderProfileConfig): AiReleaseGate {
  return config?.releaseGate === "open" ? "open" : "closed";
}

/** Synthetic processors only. No vendor name, endpoint or credential appears here. */
export const DEFAULT_AI_CONFIG: ProviderProfileConfig = Object.freeze({
  configVersion: "v6-15-synthetic-2026.11",
  profiles: Object.freeze([
    {
      id: "a1000000-0000-4000-8000-000000000001",
      version: 1,
      mode: "platform",
      adapterId: "fixture-platform-adapter",
      modelId: "fixture-model-a",
      processorName: "Synthetic Processor A",
      processingRegion: "cn-synthetic-1",
      retentionPolicyVersion: "retention-2026.1",
      trainingPolicy: "no_training",
      termsVersion: "terms-2026.1",
      allowedPurposes: ["extract", "draft", "check"],
      capabilities: {
        structuredOutput: true,
        visionInput: true,
        imageGeneration: false,
        contextWindowTokens: 128000,
        maxOutputTokens: 16384,
      },
      status: "approved",
      credentialRef: null,
    },
    {
      id: "a1000000-0000-4000-8000-000000000002",
      version: 2,
      mode: "platform",
      adapterId: "fixture-platform-adapter",
      modelId: "fixture-model-b",
      processorName: "Synthetic Processor B",
      processingRegion: null,
      retentionPolicyVersion: null,
      trainingPolicy: "unknown",
      termsVersion: null,
      allowedPurposes: ["extract"],
      capabilities: {
        structuredOutput: true,
        visionInput: false,
        imageGeneration: false,
        contextWindowTokens: null,
        maxOutputTokens: null,
      },
      status: "test_only",
      credentialRef: null,
    },
    {
      id: "a1000000-0000-4000-8000-000000000003",
      version: 1,
      mode: "byok",
      adapterId: "fixture-byok-adapter",
      modelId: "fixture-model-c",
      processorName: "Synthetic Processor C",
      processingRegion: "eu-synthetic-1",
      retentionPolicyVersion: "retention-2026.1",
      trainingPolicy: "no_training",
      termsVersion: "terms-2026.1",
      allowedPurposes: ["extract", "draft"],
      capabilities: {
        structuredOutput: true,
        visionInput: false,
        imageGeneration: false,
        contextWindowTokens: 64000,
        maxOutputTokens: 8192,
      },
      status: "disabled",
      credentialRef: null,
    },
    {
      id: "a1000000-0000-4000-8000-000000000004",
      version: 1,
      mode: "local",
      adapterId: "fixture-local-adapter",
      modelId: "fixture-local-model",
      processorName: "Synthetic Local Description",
      processingRegion: "device",
      retentionPolicyVersion: "retention-device",
      trainingPolicy: "no_training",
      termsVersion: "terms-device",
      allowedPurposes: ["extract"],
      capabilities: {
        structuredOutput: false,
        visionInput: false,
        imageGeneration: false,
        contextWindowTokens: null,
        maxOutputTokens: null,
      },
      status: "disabled",
      credentialRef: null,
    },
    {
      id: "a1000000-0000-4000-8000-000000000005",
      version: 1,
      mode: "stub",
      adapterId: "fixture-stub",
      modelId: "fixture-stub-output",
      processorName: "Synthetic Stub Output",
      processingRegion: "device",
      retentionPolicyVersion: "not-stored",
      trainingPolicy: "no_training",
      termsVersion: "fixture-only",
      allowedPurposes: ["extract", "draft", "check", "ocr"],
      capabilities: {
        structuredOutput: true,
        visionInput: false,
        imageGeneration: false,
        contextWindowTokens: 8000,
        maxOutputTokens: 2000,
      },
      status: "test_only",
      credentialRef: null,
    },
  ] satisfies ProviderProfile[]),
});

const MODE_LABELS: Readonly<Record<ProviderMode, string>> = Object.freeze({
  local: "本机模型",
  platform: "平台处理方",
  byok: "自带密钥",
  stub: "测试处理方",
});

const PURPOSE_LABELS: Readonly<Record<ProviderPurpose, string>> = Object.freeze({
  extract: "提取",
  draft: "起草",
  check: "检查",
  ocr: "OCR",
});

/** Render order used by the panel's purpose picker. */
export const AI_PURPOSES: readonly { value: ProviderPurpose; label: string }[] = Object.freeze([
  { value: "extract", label: PURPOSE_LABELS.extract },
  { value: "draft", label: PURPOSE_LABELS.draft },
  { value: "check", label: PURPOSE_LABELS.check },
  { value: "ocr", label: PURPOSE_LABELS.ocr },
]);

export function purposeLabel(purpose: ProviderPurpose): string {
  return PURPOSE_LABELS[purpose];
}

const STATUS_LABELS: Readonly<Record<ProviderProfile["status"], string>> = Object.freeze({
  disabled: "已停用",
  test_only: "仅测试",
  approved: "已批准",
});

const TRAINING_LABELS: Readonly<Record<TrainingPolicy, string>> = Object.freeze({
  no_training: "不用于训练",
  allowed: "允许用于训练",
  unknown: "未知",
});

const UNKNOWN = "未知";

// ---------------------------------------------------------------------------
// Capability and profile view models
// ---------------------------------------------------------------------------

export interface AiCapability {
  key: string;
  mode: ProviderMode;
  label: string;
  state: "available" | "unavailable";
  reason: string | null;
  evidenceVersion: string | null;
}

export interface ProfileFieldView {
  value: string | null;
  display: string;
  known: boolean;
}

export type ProfileFieldKey =
  | "processingRegion"
  | "retentionPolicyVersion"
  | "trainingPolicy"
  | "termsVersion";

export interface ProviderProfileView {
  id: string;
  version: number;
  mode: ProviderMode;
  modeLabel: string;
  adapterId: string;
  modelId: string;
  status: ProviderProfile["status"];
  statusLabel: string;
  fields: {
    processorName: ProfileFieldView;
    processingRegion: ProfileFieldView;
    retentionPolicyVersion: ProfileFieldView;
    trainingPolicy: ProfileFieldView;
    termsVersion: ProfileFieldView;
  };
  allowedPurposes: readonly ProviderPurpose[];
  purposeLabels: Readonly<Record<ProviderPurpose, string>>;
  capabilities: ProviderProfile["capabilities"];
  consent: {
    required: boolean;
    canGrant: boolean;
    reason: string | null;
    unknownFields: readonly ProfileFieldKey[];
  };
}

function fieldView(value: string | null): ProfileFieldView {
  return value !== null && value.length > 0
    ? { value, display: value, known: true }
    : { value: null, display: UNKNOWN, known: false };
}

/** The C12 fields that must be known before a real outbound approval. */
export function unknownProfileFields(profile: ProviderProfile): ProfileFieldKey[] {
  const fields: ProfileFieldKey[] = [];
  if (profile.processingRegion === null || profile.processingRegion.trim() === "") fields.push("processingRegion");
  if (profile.retentionPolicyVersion === null || profile.retentionPolicyVersion.trim() === "") {
    fields.push("retentionPolicyVersion");
  }
  if (profile.trainingPolicy === "unknown") fields.push("trainingPolicy");
  if (profile.termsVersion === null || profile.termsVersion.trim() === "") fields.push("termsVersion");
  return fields;
}

export function canGrantConsent(profile: ProviderProfile): boolean {
  // BYOK needs R2/R4 credential storage; local needs R4. In R1 only a known,
  // approved platform profile can be authorized, and even then the release
  // gate stays closed at call time.
  return (
    profile.mode === "platform" &&
    profile.status === "approved" &&
    unknownProfileFields(profile).length === 0 &&
    profile.allowedPurposes.length > 0
  );
}

function blockedReason(profile: ProviderProfile): string | null {
  if (profile.mode === "stub") return "测试处理方只返回固定测试输出，不出本机，不需要外发授权。";
  if (profile.mode === "local") return "本机模型只在桌面版（R4）提供；浏览器版不可用，也不建立外发授权。";
  if (profile.mode === "byok") return "BYOK 只在云端（R2）或桌面版（R4）使用；浏览器版不保存模型密钥。";
  const unknown = unknownProfileFields(profile);
  if (unknown.length > 0) {
    return `处理方信息不完整：${unknown.map(profileFieldLabel).join("、")}为「未知」，不能确认真实外发。`;
  }
  if (profile.status !== "approved") return "处理方尚未批准，不能保存真实外发授权。";
  if (profile.allowedPurposes.length === 0) return "处理方没有声明可用用途。";
  return null;
}

function profileFieldLabel(field: ProfileFieldKey): string {
  switch (field) {
    case "processingRegion":
      return "处理地区";
    case "retentionPolicyVersion":
      return "保留策略版本";
    case "trainingPolicy":
      return "训练策略";
    case "termsVersion":
      return "条款版本";
  }
}

export function providerProfileView(profile: ProviderProfile): ProviderProfileView {
  const unknown = unknownProfileFields(profile);
  const required = profile.mode === "platform" || profile.mode === "byok";
  return {
    id: profile.id,
    version: profile.version,
    mode: profile.mode,
    modeLabel: MODE_LABELS[profile.mode],
    adapterId: profile.adapterId,
    modelId: profile.modelId,
    status: profile.status,
    statusLabel: STATUS_LABELS[profile.status],
    fields: {
      processorName: fieldView(profile.processorName),
      processingRegion: fieldView(profile.processingRegion),
      retentionPolicyVersion: fieldView(profile.retentionPolicyVersion),
      trainingPolicy: {
        value: profile.trainingPolicy,
        display: TRAINING_LABELS[profile.trainingPolicy],
        known: profile.trainingPolicy !== "unknown",
      },
      termsVersion: fieldView(profile.termsVersion),
    },
    allowedPurposes: [...profile.allowedPurposes],
    purposeLabels: PURPOSE_LABELS,
    capabilities: { ...profile.capabilities },
    consent: {
      required,
      canGrant: canGrantConsent(profile),
      reason: blockedReason(profile),
      unknownFields: unknown,
    },
  };
}

export function buildCapabilities(config: ProviderProfileConfig = DEFAULT_AI_CONFIG): readonly AiCapability[] {
  const stubConfigured = config.profiles.some((profile) => profile.mode === "stub" && profile.status !== "disabled");
  return [
    {
      key: "ai.mode.local",
      mode: "local",
      label: MODE_LABELS.local,
      state: "unavailable",
      reason: "本机模型只在桌面版（R4）提供；此浏览器版没有安装，也不声称已有本机模型。",
      evidenceVersion: config.configVersion,
    },
    {
      key: "ai.mode.platform",
      mode: "platform",
      label: MODE_LABELS.platform,
      state: "unavailable",
      reason: "平台处理方配置可以查看，但本构建的真实外发门已关闭（RELEASE_GATE_CLOSED）；授权不会触发调用。",
      evidenceVersion: config.configVersion,
    },
    {
      key: "ai.mode.byok",
      mode: "byok",
      label: MODE_LABELS.byok,
      state: "unavailable",
      reason: "自带密钥只在云端（R2）或桌面版（R4）使用；浏览器版不保存模型密钥，也不接受任意代理地址。",
      evidenceVersion: config.configVersion,
    },
    {
      key: "ai.mode.stub",
      mode: "stub",
      label: MODE_LABELS.stub,
      state: stubConfigured ? "available" : "unavailable",
      reason: stubConfigured
        ? "只返回固定测试输出（标记「测试输出」），不连接模型、不发出网络请求。"
        : "没有配置可用的测试处理方。",
      evidenceVersion: stubConfigured ? config.configVersion : null,
    },
  ];
}

// ---------------------------------------------------------------------------
// Payload manifest
// ---------------------------------------------------------------------------

export interface ManifestFile {
  assetId: string;
  name: string;
  pageCount: number | null;
  byteLength: number;
}

export interface PayloadManifest {
  matterId: string;
  targetId: string | null;
  sourceVersion: number;
  /** The exact title available to the pipeline's subject fallback; null when empty. */
  title: string | null;
  /** Potentially sent as subject context when extracted facts have no subject. */
  titleSent: boolean;
  files: readonly ManifestFile[];
  factCount: number;
  factIds: readonly string[];
  chunkIds: readonly string[];
  draftRevisionIds: readonly string[];
  figureRevisionIds: readonly string[];
  scope: ConsentScope;
  payloadManifestHash: string;
  /**
   * The user's saved intake answers: counts and labels only (no text). `sentCount`
   * answers are part of the outbound payload and are included in chunkIds/factIds,
   * so changing an answer changes the manifest hash and invalidates older consent.
   */
  answers: AnswerManifestSummary;
}

export interface AiTargetOption {
  id: string;
  label: string;
}

export interface AiMatterSummary {
  id: string;
  title: string;
  status: MatterRecord["status"];
}

export interface ConsentView {
  id: string;
  providerProfileId: string;
  providerProfileVersion: number;
  purpose: ProviderPurpose;
  processorName: string;
  processingRegion: string;
  retentionPolicyVersion: string;
  trainingPolicy: "no_training" | "allowed";
  termsVersion: string;
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  status: "active" | "revoked" | "expired";
  stale: boolean;
  scope: {
    targetId: string | null;
    sourceVersion: number;
    assetCount: number;
    factCount: number;
    chunkCount: number;
    draftRevisionCount: number;
    figureRevisionCount: number;
    payloadManifestHash: string;
  };
}

export interface SafeInvocationRow {
  id: string;
  jobId: string;
  stage: string;
  attempt: number;
  providerProfileId: string;
  modelId: string;
  consentId: string | null;
  requestHash: string;
  inputTokens: number | null;
  outputTokens: number | null;
  costMinor: number | null;
  currency: string | null;
  usageUnknown: boolean;
  status: ModelInvocation["status"];
  /** When the call was recorded (ISO); null for rows written by older builds. */
  at: string | null;
  /** "stub" = on-device test output, "provider" = a real outbound call; null when not recorded. */
  execution: "stub" | "provider" | null;
  /** Where the call ran: the processor's region, or "device:stub". */
  executionLocation: string | null;
  /** Failure code of a failed call; null otherwise. Never a message or any text of the exchange. */
  errorCode: string | null;
}

interface AiShellView {
  configVersion: string;
  runtime: typeof AI_RUNTIME;
  releaseGate: AiReleaseGate;
  capabilities: readonly AiCapability[];
  profiles: readonly ProviderProfileView[];
}

export type AiView =
  | (AiShellView & {
      kind: "empty";
      emptyReason: "no_matters" | "no_profiles";
      message: string;
    })
  | (AiShellView & {
      kind: "ready";
      matter: AiMatterSummary;
      targets: readonly AiTargetOption[];
      selectedTargetId: string | null;
      manifest: PayloadManifest;
      consents: readonly ConsentView[];
      staleConsentIds: readonly string[];
      invocations: readonly SafeInvocationRow[];
    });

// ---------------------------------------------------------------------------
// Stored rows and small guards
// ---------------------------------------------------------------------------

interface StoredConsent {
  kind: "ai.consent";
  tenantId: string;
  matterId: string;
  requestKey: string | null;
  consent: Consent;
}

/**
 * One model call, derived from the generation job record that owns it. The
 * generation engine is the only writer; there is no second invocation row.
 */
interface StoredInvocation {
  tenantId: string;
  matterId: string;
  invocation: unknown;
}

interface ParseSourceRow {
  kind: "parse.source";
  source: {
    id: string;
    matterId: string;
    assetId: string;
    retiredAt: string | null;
    parseStatus: string;
    parserVersion: string | null;
    pageCount: number | null;
    ocrNeeded: boolean;
  };
}

interface ChunkSetRow {
  kind: "parse.chunks";
  sourceId: string;
  chunks: readonly { id: string }[];
}

type IdempotencyState = "pending" | "completed";

interface IdempotencyRecord {
  kind: "ai.idempotency";
  tenantId: string;
  actorId: string;
  operation: "consent.grant" | "consent.revoke";
  matterId: string;
  requestKey: string;
  requestHash: string;
  at: string;
  /**
   * Absent means "completed": records written before the claim protocol stored
   * only a final response.
   */
  state?: IdempotencyState;
  claimId?: string;
  leaseExpiresAt?: string;
  /**
   * Response prepared before a business commit. If the commit lands but the
   * finalize write does not, the owner (or a later retry) can still recover the
   * exact response through the deterministic consent row or event id.
   */
  preparedResponse?: unknown;
  response: unknown;
}

interface AiRows {
  sources: ParseSourceRow[];
  chunkSets: ChunkSetRow[];
  /** null when no current intake snapshot exists; then the matter has no saved facts. */
  snapshotFactIds: readonly string[] | null;
  /** The current snapshot's saved answers; null when there is no current snapshot. */
  answerInput: AnswerSourceInput | null;
  consents: StoredConsent[];
  invocations: StoredInvocation[];
}

const GRANT_OPERATION = "consent.grant" as const;
const REVOKE_OPERATION = "consent.revoke" as const;
const MAX_COMMIT_ATTEMPTS = 3;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CLAIM_LEASE_MS = 30_000;
const CLAIM_WAIT_MS = 500;
const CLAIM_POLL_MS = 25;
const REQUEST_IN_FLIGHT_MESSAGE = "同一请求正在处理中，请稍候再试。";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isText(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

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

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonical(value));
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function normalizeScope(scope: ConsentScope): ConsentScope {
  return {
    matterId: scope.matterId,
    targetId: scope.targetId,
    sourceVersion: scope.sourceVersion,
    assetIds: sortedUnique(scope.assetIds),
    chunkIds: sortedUnique(scope.chunkIds),
    factIds: sortedUnique(scope.factIds),
    draftRevisionIds: sortedUnique(scope.draftRevisionIds),
    figureRevisionIds: sortedUnique(scope.figureRevisionIds),
    payloadManifestHash: scope.payloadManifestHash,
  };
}

function sameScope(a: ConsentScope, b: ConsentScope): boolean {
  return canonicalJson(normalizeScope(a)) === canonicalJson(normalizeScope(b));
}

function failure(code: AiErrorCode, message: string, extra: Partial<AiError> = {}): AiResult<never> {
  return { ok: false, error: { code, message, ...extra } };
}

function success<T>(data: T, replayed = false): AiResult<T> {
  return { ok: true, data, replayed };
}

function mapRepositoryError(error: RepositoryError): AiError {
  switch (error.code) {
    case "RESOURCE_NOT_FOUND":
      return { code: "RESOURCE_NOT_FOUND", message: "案件、目标或授权不可用。" };
    case "VERSION_CONFLICT":
      return { code: "VERSION_CONFLICT", message: "案件已更新，请刷新后重试。" };
    case "INVALID_TRANSITION":
      return { code: "INVALID_TRANSITION", message: "案件或目标当前状态不允许这次操作。" };
    case "QUOTA_EXCEEDED":
      return { code: "QUOTA_EXCEEDED", message: "本地存储空间已满，尚未保存。请释放空间后重试。" };
    case "HASH_MISMATCH":
      return { code: "STORAGE_UNAVAILABLE", message: "保存的记录不一致，尚未保存。" };
    case "STORAGE_UNAVAILABLE":
      return { code: "STORAGE_UNAVAILABLE", message: "本地存储暂时不可用，尚未保存。请稍后重试。" };
    case "INVALID_INPUT":
      return { code: "INVALID_INPUT", message: "请求内容不完整，尚未保存。" };
  }
}

function asParseSourceRow(value: unknown): ParseSourceRow | null {
  if (!isRecord(value) || value.kind !== "parse.source" || !isRecord(value.source)) return null;
  const source = value.source;
  if (
    !isText(source.id) ||
    !isText(source.matterId) ||
    !isText(source.assetId) ||
    !("retiredAt" in source) ||
    !(source.retiredAt === null || typeof source.retiredAt === "string")
  ) {
    return null;
  }
  return value as unknown as ParseSourceRow;
}

function asChunkSetRow(value: unknown): ChunkSetRow | null {
  if (!isRecord(value) || value.kind !== "parse.chunks" || !isText(value.sourceId) || !Array.isArray(value.chunks)) {
    return null;
  }
  const chunks = value.chunks.filter(
    (chunk): chunk is { id: string } => isRecord(chunk) && isUuid(chunk.id),
  );
  return { kind: "parse.chunks", sourceId: value.sourceId, chunks };
}

function asStoredConsent(value: unknown): StoredConsent | null {
  if (
    !isRecord(value) ||
    value.kind !== "ai.consent" ||
    !isText(value.tenantId) ||
    !isText(value.matterId) ||
    !(value.requestKey === null || isText(value.requestKey)) ||
    !isRecord(value.consent)
  ) {
    return null;
  }
  const parsed = consentSchema.safeParse(value.consent);
  if (!parsed.success) return null;
  return {
    kind: "ai.consent",
    tenantId: value.tenantId,
    matterId: value.matterId,
    requestKey: value.requestKey,
    consent: parsed.data,
  };
}

/** The calls recorded by one generation job of this actor, or null when the row is not a job. */
function asJobInvocations(value: unknown, actor: Actor): StoredInvocation[] | null {
  if (!isRecord(value) || value.kind !== "generation.job") return null;
  if (!isText(value.tenantId) || !isText(value.matterId) || !isText(value.actorId)) return null;
  if (value.tenantId !== actor.tenantId || value.actorId !== actor.userId) return [];
  if (!Array.isArray(value.invocations)) return [];
  const { tenantId, matterId } = value;
  return value.invocations.map((invocation) => ({ tenantId, matterId, invocation }));
}

function asIdempotencyRecord(value: unknown): IdempotencyRecord | null {
  if (
    !isRecord(value) ||
    value.kind !== "ai.idempotency" ||
    !isText(value.tenantId) ||
    !isText(value.actorId) ||
    !isText(value.matterId) ||
    !isText(value.requestKey) ||
    !isText(value.requestHash) ||
    !isText(value.at) ||
    !(value.operation === GRANT_OPERATION || value.operation === REVOKE_OPERATION)
  ) {
    return null;
  }
  if (value.state !== undefined && value.state !== "pending" && value.state !== "completed") {
    return null;
  }
  if (value.state === "pending" && (!isText(value.claimId) || !isText(value.leaseExpiresAt))) {
    return null;
  }
  if (value.claimId !== undefined && !isText(value.claimId)) return null;
  if (value.leaseExpiresAt !== undefined && !isText(value.leaseExpiresAt)) return null;
  return value as unknown as IdempotencyRecord;
}

function idempotencyState(record: IdempotencyRecord): IdempotencyState {
  return record.state ?? "completed";
}

function readSnapshotFacts(value: unknown, matterId: string, sourceVersion: number): readonly string[] | null {
  if (!isRecord(value) || value.kind !== "intake.snapshot" || !isRecord(value.snapshot)) return null;
  const snapshot = value.snapshot;
  if (snapshot.matterId !== matterId || snapshot.version !== sourceVersion) return null;
  if (!Array.isArray(snapshot.facts)) return null;
  const ids = snapshot.facts
    .map((fact) => (isRecord(fact) && isUuid(fact.id) ? fact.id : null))
    .filter((id): id is string => id !== null);
  return sortedUnique(ids);
}

// ---------------------------------------------------------------------------
// Keys and storage helpers
// ---------------------------------------------------------------------------

function consentKey(tenantId: string, matterId: string, consentId: string): string {
  return ["ai/consent", encodeURIComponent(tenantId), encodeURIComponent(matterId), consentId].join("/");
}

function idempotencyKey(actor: Actor, operation: IdempotencyRecord["operation"], requestKey: string): string {
  return [
    "ai/idempotency",
    encodeURIComponent(actor.tenantId),
    encodeURIComponent(actor.userId),
    operation,
    encodeURIComponent(requestKey),
  ].join("/");
}

async function derivedId(seed: string): Promise<string> {
  const digest = await sha256Hex(new TextEncoder().encode(seed));
  const hex = digest.slice(0, 32).split("");
  hex[12] = "5";
  hex[16] = "8";
  const raw = hex.join("");
  return `${raw.slice(0, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}-${raw.slice(16, 20)}-${raw.slice(20, 32)}`;
}

function newId(options: AiWriteOptions): string {
  return options.newId ? options.newId() : crypto.randomUUID();
}

function clock(options: AiWriteOptions): string {
  return options.now ? options.now() : new Date().toISOString();
}

async function readAiRows(
  repository: LocalRepository,
  actor: Actor,
  matterId: string,
  sourceVersion: number,
): Promise<AiResult<AiRows>> {
  let rows: readonly unknown[];
  try {
    rows = await repository.backend.transaction("readonly", async (tx) => tx.getAll(STORES.blobs));
  } catch {
    return failure("STORAGE_UNAVAILABLE", "无法读取本机的 AI 记录。请稍后重试。");
  }
  const sources: ParseSourceRow[] = [];
  const chunkSets: ChunkSetRow[] = [];
  const consents: StoredConsent[] = [];
  const invocations: StoredInvocation[] = [];
  let snapshotFactIds: readonly string[] | null = null;
  let answerInput: AnswerSourceInput | null = null;
  for (const value of rows) {
    const source = asParseSourceRow(value);
    if (source) {
      if (source.source.matterId === matterId) sources.push(source);
      continue;
    }
    const chunkSet = asChunkSetRow(value);
    if (chunkSet) {
      chunkSets.push(chunkSet);
      continue;
    }
    const consent = asStoredConsent(value);
    if (consent) {
      if (
        consent.tenantId === actor.tenantId &&
        consent.matterId === matterId &&
        consent.consent.actorId === actor.userId
      ) {
        consents.push(consent);
      }
      continue;
    }
    const jobInvocations = asJobInvocations(value, actor);
    if (jobInvocations) {
      for (const item of jobInvocations) if (item.matterId === matterId) invocations.push(item);
      continue;
    }
    const facts = readSnapshotFacts(value, matterId, sourceVersion);
    if (facts !== null) {
      snapshotFactIds = facts;
      answerInput = readSnapshotAnswerInput(value, matterId, sourceVersion);
    }
  }
  return success({ sources, chunkSets, snapshotFactIds, answerInput, consents, invocations });
}

async function readConsentEvents(
  repository: LocalRepository,
  actor: Actor,
  matterId: string,
): Promise<AiResult<readonly ActivityRecord[]>> {
  const listed = await repository.listEvents(actor, matterId);
  if (!listed.ok) return { ok: false, error: mapRepositoryError(listed.error) };
  return success(
    listed.data.items.filter(
      (event) => event.action === "consent.granted" || event.action === "consent.revoked",
    ),
  );
}

function grantedEvent(events: readonly ActivityRecord[], consentId: string): ActivityRecord | null {
  return events.find((event) => event.action === "consent.granted" && event.resourceId === consentId) ?? null;
}

function revokedEvent(events: readonly ActivityRecord[], consentId: string): ActivityRecord | null {
  return events
    .filter((event) => event.action === "consent.revoked" && event.resourceId === consentId)
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || a.id.localeCompare(b.id))[0] ?? null;
}

// ---------------------------------------------------------------------------
// Manifest construction
// ---------------------------------------------------------------------------

function targetsFor(aggregate: MatterAggregate, targetId: string | null): AiResult<readonly TargetRecord[]> {
  if (targetId !== null) {
    if (!isUuid(targetId)) return failure("RESOURCE_NOT_FOUND", "目标不可用。");
    const target = aggregate.targets.find((candidate) => candidate.id === targetId);
    if (!target) return failure("RESOURCE_NOT_FOUND", "目标不可用。");
    if (target.status !== "active") return failure("INVALID_TRANSITION", "目标已归档，不能再授权外发。");
    return success([target]);
  }
  return success(aggregate.targets.filter((target) => target.status === "active"));
}

async function buildManifest(
  aggregate: MatterAggregate,
  rows: AiRows,
  targetId: string | null,
): Promise<AiResult<PayloadManifest>> {
  const matter = aggregate.matter;
  const selected = targetsFor(aggregate, targetId);
  if (!selected.ok) return selected;

  const sourceRowsByAsset = new Map<string, ParseSourceRow[]>();
  for (const row of rows.sources) {
    const list = sourceRowsByAsset.get(row.source.assetId) ?? [];
    list.push(row);
    sourceRowsByAsset.set(row.source.assetId, list);
  }

  const files: ManifestFile[] = [];
  const sourceIds = new Set<string>();
  for (const asset of aggregate.assets) {
    if (asset.matterId !== matter.id || asset.purpose !== "source" || asset.state !== "available") continue;
    const sourceRows = (sourceRowsByAsset.get(asset.id) ?? [])
      .slice()
      .sort((a, b) => a.source.id.localeCompare(b.source.id));
    if (sourceRows.length > 0 && sourceRows.every((row) => row.source.retiredAt !== null)) continue;
    const liveRows = sourceRows.filter((row) => row.source.retiredAt === null);
    for (const row of liveRows) sourceIds.add(row.source.id);
    const pageCount = liveRows.find((row) => Number.isSafeInteger(row.source.pageCount))?.source.pageCount ?? null;
    files.push({
      assetId: asset.id,
      name: asset.originalName,
      pageCount,
      byteLength: asset.byteLength,
    });
  }
  files.sort((a, b) => a.assetId.localeCompare(b.assetId));

  // The user's own saved answers are outbound material too (labelled as such, never as files).
  const answerSources = await buildAnswerSources(rows.answerInput);
  const chunkIds = sortedUnique([
    ...rows.chunkSets
      .filter((set) => sourceIds.has(set.sourceId))
      .flatMap((set) => set.chunks.map((chunk) => chunk.id)),
    ...answerSources.chunks.map((chunk) => chunk.id),
  ]);
  const factIds = sortedUnique([
    ...(rows.snapshotFactIds === null ? [] : rows.snapshotFactIds),
    ...answerSources.facts.map((fact) => fact.id),
  ]);
  const draftRevisionIds = sortedUnique(
    selected.data.map((target) => target.draftRevisionId).filter((id): id is string => id !== null),
  );
  const figureRevisionIds = sortedUnique(
    selected.data.map((target) => target.figureRevisionId).filter((id): id is string => isText(id)),
  );

  const title = matter.title.length > 0 ? matter.title : null;
  const titleSent = title !== null;
  const hashInput = {
    version: 2,
    matterId: matter.id,
    targetId,
    sourceVersion: matter.sourceVersion,
    title,
    titleSent,
    files: files.map((file) => ({
      assetId: file.assetId,
      name: file.name,
      pageCount: file.pageCount,
      byteLength: file.byteLength,
    })),
    chunkIds,
    factIds,
    draftRevisionIds,
    figureRevisionIds,
  };
  const payloadManifestHash = await sha256Hex(new TextEncoder().encode(canonicalJson(hashInput)));
  const scope: ConsentScope = {
    matterId: matter.id,
    targetId,
    sourceVersion: matter.sourceVersion,
    assetIds: files.map((file) => file.assetId),
    chunkIds,
    factIds,
    draftRevisionIds,
    figureRevisionIds,
    payloadManifestHash,
  };
  const parsedScope = consentScopeSchema.safeParse(scope);
  if (!parsedScope.success) {
    return failure("INVALID_INPUT", "无法建立材料清单：案件记录不完整。", {
      fields: parsedScope.error.issues.map((issue) => issue.path.join(".")),
    });
  }
  return success({
    matterId: matter.id,
    targetId,
    sourceVersion: matter.sourceVersion,
    files,
    factCount: factIds.length,
    factIds,
    chunkIds,
    draftRevisionIds,
    figureRevisionIds,
    scope: parsedScope.data,
    payloadManifestHash,
    title,
    titleSent,
    answers: answerManifestSummary(answerSources),
  });
}

// ---------------------------------------------------------------------------
// View load
// ---------------------------------------------------------------------------

export interface LoadAiOptions {
  targetId?: string | null;
  config?: ProviderProfileConfig;
  now?: () => string;
}

function shell(config: ProviderProfileConfig): AiShellView {
  return {
    configVersion: config.configVersion,
    runtime: AI_RUNTIME,
    releaseGate: AI_RELEASE_GATE(config),
    capabilities: buildCapabilities(config),
    profiles: config.profiles.map(providerProfileView),
  };
}

function emptyView(
  config: ProviderProfileConfig,
  emptyReason: "no_matters" | "no_profiles",
  message: string,
): AiView {
  return { ...shell(config), kind: "empty", emptyReason, message };
}

function consentStatus(consent: Consent, revokedAt: string | null, now: string): ConsentView["status"] {
  if (revokedAt !== null) return "revoked";
  if (consent.expiresAt !== null && consent.expiresAt <= now) return "expired";
  return "active";
}

function consentView(
  consent: Consent,
  revokedAt: string | null,
  now: string,
  stale: boolean,
): ConsentView {
  return {
    id: consent.id,
    providerProfileId: consent.providerProfileId,
    providerProfileVersion: consent.providerProfileVersion,
    purpose: consent.purpose,
    processorName: consent.processorName,
    processingRegion: consent.processingRegion,
    retentionPolicyVersion: consent.retentionPolicyVersion,
    trainingPolicy: consent.trainingPolicy,
    termsVersion: consent.termsVersion,
    createdAt: consent.createdAt,
    expiresAt: consent.expiresAt,
    revokedAt,
    status: consentStatus(consent, revokedAt, now),
    stale,
    scope: {
      targetId: consent.scope.targetId,
      sourceVersion: consent.scope.sourceVersion,
      assetCount: consent.scope.assetIds.length,
      factCount: consent.scope.factIds.length,
      chunkCount: consent.scope.chunkIds.length,
      draftRevisionCount: consent.scope.draftRevisionIds.length,
      figureRevisionCount: consent.scope.figureRevisionIds.length,
      payloadManifestHash: consent.scope.payloadManifestHash,
    },
  };
}

/** A content-free projection: extra fields such as prompt or body are dropped. */
export function toSafeInvocationRow(value: unknown): SafeInvocationRow | null {
  if (!isRecord(value)) return null;
  const projected = {
    id: value.id,
    jobId: value.jobId,
    stage: value.stage,
    attempt: value.attempt,
    providerProfileId: value.providerProfileId,
    modelId: value.modelId,
    consentId: value.consentId ?? null,
    requestHash: value.requestHash,
    inputTokens: value.inputTokens ?? null,
    outputTokens: value.outputTokens ?? null,
    costMinor: value.costMinor ?? null,
    currency: value.currency ?? null,
    usageUnknown: value.usageUnknown,
    status: value.status,
  };
  const parsed = modelInvocationSchema.safeParse(projected);
  if (!parsed.success) return null;
  return {
    id: parsed.data.id,
    jobId: parsed.data.jobId,
    stage: parsed.data.stage,
    attempt: parsed.data.attempt,
    providerProfileId: parsed.data.providerProfileId,
    modelId: parsed.data.modelId,
    consentId: parsed.data.consentId,
    requestHash: parsed.data.requestHash,
    inputTokens: parsed.data.inputTokens,
    outputTokens: parsed.data.outputTokens,
    costMinor: parsed.data.costMinor,
    currency: parsed.data.currency,
    usageUnknown: parsed.data.usageUnknown,
    status: parsed.data.status,
    at: typeof value.at === "string" && value.at.length > 0 ? value.at : null,
    execution: value.execution === "stub" || value.execution === "provider" ? value.execution : null,
    executionLocation: typeof value.executionLocation === "string" ? value.executionLocation : null,
    errorCode: typeof value.errorCode === "string" && /^[A-Z][A-Z0-9_]{1,63}$/.test(value.errorCode) ? value.errorCode : null,
  };
}

/**
 * Load the AI/data page for one matter (or the no-matter empty state when
 * `matterId` is null). Reads only; it never repairs, writes or seeds anything.
 */
export async function loadAiView(
  repository: LocalRepository,
  actor: Actor,
  matterId: string | null,
  options: LoadAiOptions = {},
): Promise<AiResult<AiView>> {
  const config = options.config ?? DEFAULT_AI_CONFIG;

  if (matterId === null) {
    return success(
      emptyView(
        config,
        "no_matters",
        "还没有案件。建立案件后，才能查看可能外发的材料并保存授权。",
      ),
    );
  }

  const loaded = await repository.loadMatter(actor, matterId);
  if (!loaded.ok) return { ok: false, error: mapRepositoryError(loaded.error) };
  const aggregate = loaded.data.data;
  if (aggregate.matter.status === "deletion_pending") {
    return failure("RESOURCE_NOT_FOUND", "案件不可用。");
  }

  const rows = await readAiRows(repository, actor, matterId, aggregate.matter.sourceVersion);
  if (!rows.ok) return rows;
  const events = await readConsentEvents(repository, actor, matterId);
  if (!events.ok) return events;

  if (config.profiles.length === 0) {
    return success(emptyView(config, "no_profiles", "暂无可用 AI 处理方。"));
  }

  const targetId = options.targetId ?? null;
  const manifest = await buildManifest(aggregate, rows.data, targetId);
  if (!manifest.ok) return manifest;

  const now = options.now ? options.now() : new Date().toISOString();
  const grantedIds = new Set(
    events.data.filter((event) => event.action === "consent.granted").map((event) => event.resourceId),
  );

  // The current manifest is per consent target: a target-scoped consent must not
  // be called stale just because a different target's material changed.
  const rowData = rows.data;
  const manifestCache = new Map<string, PayloadManifest | null>([[targetKey(targetId), manifest.data]]);
  async function currentManifestFor(consentTargetId: string | null): Promise<PayloadManifest | null> {
    const key = targetKey(consentTargetId);
    if (manifestCache.has(key)) return manifestCache.get(key) ?? null;
    const fresh = await buildManifest(aggregate, rowData, consentTargetId);
    const value = fresh.ok ? fresh.data : null;
    manifestCache.set(key, value);
    return value;
  }

  const consents: ConsentView[] = [];
  const staleConsentIds: string[] = [];
  for (const stored of rows.data.consents) {
    const consent = stored.consent;
    if (!grantedIds.has(consent.id)) continue;
    const revoked = revokedEvent(events.data, consent.id);
    const status = consentStatus(consent, revoked?.occurredAt ?? null, now);
    let stale = false;
    if (status === "active") {
      const current = await currentManifestFor(consent.scope.targetId);
      const currentProfile = config.profiles.find(
        (profile) => profile.id === consent.providerProfileId && profile.version === consent.providerProfileVersion,
      );
      const providerChanged =
        currentProfile === undefined ||
        !consentMatchesProfile(consent, currentProfile) ||
        profileProblem(currentProfile) !== null ||
        !currentProfile.allowedPurposes.includes(consent.purpose);
      stale = providerChanged || current === null || !sameScope(consent.scope, current.scope);
      if (stale) staleConsentIds.push(consent.id);
    }
    consents.push(consentView(consent, revoked?.occurredAt ?? null, now, stale));
  }
  consents.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));

  const invocations = rows.data.invocations
    .map((stored) => toSafeInvocationRow(stored.invocation))
    .filter((row): row is SafeInvocationRow => row !== null)
    .sort((a, b) => (a.at ?? "").localeCompare(b.at ?? "") || a.id.localeCompare(b.id));

  const targets = aggregate.targets
    .filter((target) => target.status === "active")
    .map((target, index) => ({ id: target.id, label: `目标 ${index + 1}` }));

  return success({
    ...shell(config),
    kind: "ready",
    matter: { id: aggregate.matter.id, title: aggregate.matter.title, status: aggregate.matter.status },
    targets,
    selectedTargetId: targetId,
    manifest: manifest.data,
    consents,
    staleConsentIds,
    invocations,
  });
}

function targetKey(targetId: string | null): string {
  return targetId === null ? "*" : targetId;
}

// ---------------------------------------------------------------------------
// Idempotency: atomic claim → business write → owner-checked finalize
// ---------------------------------------------------------------------------

type ClaimOnceOutcome =
  | { kind: "claimed"; claimId: string; previous: IdempotencyRecord | null }
  | { kind: "pending"; record: IdempotencyRecord }
  | { kind: "replay"; response: unknown }
  | { kind: "conflict" }
  | { kind: "unreadable" };

type ClaimDecision =
  | { kind: "claimed"; claimId: string }
  | { kind: "replay"; response: unknown };

function pendingIdempotency(
  actor: Actor,
  operation: IdempotencyRecord["operation"],
  matterId: string,
  requestKey: string,
  requestHash: string,
  claimId: string,
  at: string,
): IdempotencyRecord {
  return {
    kind: "ai.idempotency",
    tenantId: actor.tenantId,
    actorId: actor.userId,
    operation,
    matterId,
    requestKey,
    requestHash,
    at,
    state: "pending",
    claimId,
    leaseExpiresAt: new Date(Date.now() + CLAIM_LEASE_MS).toISOString(),
    response: null,
  };
}

/**
 * Claim the idempotency key in one read-write transaction. Only the holder of
 * the returned claim id may write business state or finalize the record.
 */
async function claimOnce(
  repository: LocalRepository,
  actor: Actor,
  operation: IdempotencyRecord["operation"],
  matterId: string,
  requestKey: string,
  requestHash: string,
  claimId: string,
): Promise<AiResult<ClaimOnceOutcome>> {
  const key = idempotencyKey(actor, operation, requestKey);
  try {
    const outcome = await repository.backend.transaction(
      "readwrite",
      async (tx): Promise<ClaimOnceOutcome> => {
        const raw = await tx.get(STORES.blobs, key);
        if (raw === undefined) {
          await tx.put(
            STORES.blobs,
            key,
            pendingIdempotency(
              actor,
              operation,
              matterId,
              requestKey,
              requestHash,
              claimId,
              new Date().toISOString(),
            ),
          );
          return { kind: "claimed", claimId, previous: null };
        }
        const existing = asIdempotencyRecord(raw);
        if (
          !existing ||
          existing.tenantId !== actor.tenantId ||
          existing.actorId !== actor.userId ||
          existing.operation !== operation ||
          existing.requestKey !== requestKey
        ) {
          return { kind: "unreadable" };
        }
        if (existing.requestHash !== requestHash) return { kind: "conflict" };
        if (idempotencyState(existing) === "completed") {
          return { kind: "replay", response: existing.response };
        }
        const leaseExpiresAt = Date.parse(existing.leaseExpiresAt ?? "");
        if (Number.isFinite(leaseExpiresAt) && leaseExpiresAt > Date.now()) {
          return { kind: "pending", record: existing };
        }
        // The previous owner's lease expired. Take over with a fresh claim id;
        // its prepared response is kept on the returned record so a committed
        // attempt can still be recovered before any new business write.
        await tx.put(
          STORES.blobs,
          key,
          pendingIdempotency(
            actor,
            operation,
            matterId,
            requestKey,
            requestHash,
            claimId,
            new Date().toISOString(),
          ),
        );
        return { kind: "claimed", claimId, previous: existing };
      },
    );
    return success(outcome);
  } catch {
    return failure("STORAGE_UNAVAILABLE", "无法读取本机的请求记录。请稍后重试。");
  }
}

/** Owner-checked finalize: pending claim → completed response, one transaction. */
async function settleClaim(
  repository: LocalRepository,
  actor: Actor,
  operation: IdempotencyRecord["operation"],
  requestKey: string,
  requestHash: string,
  claimId: string,
  response: unknown,
): Promise<boolean> {
  const key = idempotencyKey(actor, operation, requestKey);
  try {
    return await repository.backend.transaction("readwrite", async (tx) => {
      const raw = await tx.get(STORES.blobs, key);
      const existing = raw === undefined ? null : asIdempotencyRecord(raw);
      if (!existing) return false;
      if (
        existing.tenantId !== actor.tenantId ||
        existing.actorId !== actor.userId ||
        existing.operation !== operation ||
        existing.requestKey !== requestKey ||
        existing.requestHash !== requestHash
      ) {
        return false;
      }
      if (idempotencyState(existing) === "completed") {
        return canonicalJson(existing.response) === canonicalJson(response);
      }
      if (existing.claimId !== claimId) return false;
      await tx.put(STORES.blobs, key, {
        kind: "ai.idempotency",
        tenantId: existing.tenantId,
        actorId: existing.actorId,
        operation: existing.operation,
        matterId: existing.matterId,
        requestKey: existing.requestKey,
        requestHash: existing.requestHash,
        at: existing.at,
        state: "completed",
        response,
      } satisfies IdempotencyRecord);
      return true;
    });
  } catch {
    return false;
  }
}

/**
 * Record the response a commit is about to persist. This survives a finalize
 * failure, so a retry can prove through the deterministic row/event id that
 * the commit happened and replay the exact answer.
 */
async function prepareClaim(
  repository: LocalRepository,
  actor: Actor,
  operation: IdempotencyRecord["operation"],
  requestKey: string,
  requestHash: string,
  claimId: string,
  preparedResponse: unknown,
): Promise<boolean> {
  const key = idempotencyKey(actor, operation, requestKey);
  try {
    return await repository.backend.transaction("readwrite", async (tx) => {
      const raw = await tx.get(STORES.blobs, key);
      const existing = raw === undefined ? null : asIdempotencyRecord(raw);
      if (!existing) return false;
      if (
        existing.tenantId !== actor.tenantId ||
        existing.actorId !== actor.userId ||
        existing.operation !== operation ||
        existing.requestKey !== requestKey ||
        existing.requestHash !== requestHash
      ) {
        return false;
      }
      if (idempotencyState(existing) !== "pending" || existing.claimId !== claimId) return false;
      await tx.put(STORES.blobs, key, {
        ...existing,
        preparedResponse,
        leaseExpiresAt: new Date(Date.now() + CLAIM_LEASE_MS).toISOString(),
      } satisfies IdempotencyRecord);
      return true;
    });
  } catch {
    return false;
  }
}

/** Release only the caller's own pending claim; never a completed record. */
async function releaseClaim(
  repository: LocalRepository,
  actor: Actor,
  operation: IdempotencyRecord["operation"],
  requestKey: string,
  requestHash: string,
  claimId: string,
): Promise<void> {
  const key = idempotencyKey(actor, operation, requestKey);
  try {
    await repository.backend.transaction("readwrite", async (tx) => {
      const raw = await tx.get(STORES.blobs, key);
      const existing = raw === undefined ? null : asIdempotencyRecord(raw);
      if (!existing) return;
      if (
        idempotencyState(existing) !== "pending" ||
        existing.claimId !== claimId ||
        existing.requestHash !== requestHash
      ) {
        return;
      }
      await tx.delete(STORES.blobs, key);
    });
  } catch {
    // A lingering pending claim expires after its lease; it cannot authorize.
  }
}

/** True only while the caller still owns the pending claim. */
async function claimOwned(
  repository: LocalRepository,
  actor: Actor,
  operation: IdempotencyRecord["operation"],
  requestKey: string,
  requestHash: string,
  claimId: string,
): Promise<AiResult<boolean>> {
  const key = idempotencyKey(actor, operation, requestKey);
  try {
    const owned = await repository.backend.transaction("readwrite", async (tx) => {
      const raw = await tx.get(STORES.blobs, key);
      const existing = raw === undefined ? null : asIdempotencyRecord(raw);
      return (
        existing !== null &&
        idempotencyState(existing) === "pending" &&
        existing.claimId === claimId &&
        existing.requestHash === requestHash
      );
    });
    return success(owned);
  } catch {
    return failure("STORAGE_UNAVAILABLE", "无法读取本机的请求记录。请稍后重试。");
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(1, ms)));
}

/**
 * Claim before any business read-check-write. A completed record replays; a
 * different hash conflicts; a live pending lease is waited on for a bounded
 * time; an expired lease is taken over. `recover` turns a prepared claim into
 * the response a landed commit produced, which closes the post-commit
 * finalize-failure hole.
 */
async function claimIdempotency(
  repository: LocalRepository,
  actor: Actor,
  operation: IdempotencyRecord["operation"],
  matterId: string,
  requestKey: string,
  requestHash: string,
  recover: (previous: IdempotencyRecord) => Promise<AiResult<{ response: unknown } | null>>,
): Promise<AiResult<ClaimDecision>> {
  const startedAt = Date.now();
  let rounds = 0;
  while (true) {
    rounds += 1;
    if (rounds > 100) {
      return failure("STORAGE_UNAVAILABLE", REQUEST_IN_FLIGHT_MESSAGE);
    }
    const claimId = crypto.randomUUID();
    const outcome = await claimOnce(repository, actor, operation, matterId, requestKey, requestHash, claimId);
    if (!outcome.ok) return outcome;
    const decision = outcome.data;
    switch (decision.kind) {
      case "unreadable":
        return failure("STORAGE_UNAVAILABLE", "本机保存的请求记录不可读。");
      case "conflict":
        return failure("IDEMPOTENCY_CONFLICT", "同一请求键对应了不同的请求内容。");
      case "replay":
        return success({ kind: "replay", response: decision.response });
      case "claimed": {
        if (decision.previous !== null && decision.previous.preparedResponse !== undefined) {
          const recovered = await recover(decision.previous);
          if (!recovered.ok) return recovered;
          if (recovered.data !== null) {
            const settled = await settleClaim(
              repository,
              actor,
              operation,
              requestKey,
              requestHash,
              claimId,
              recovered.data.response,
            );
            if (settled) return success({ kind: "replay", response: recovered.data.response });
            return failure("STORAGE_UNAVAILABLE", "无法写入本机的请求记录。请稍后重试。");
          }
        }
        return success({ kind: "claimed", claimId });
      }
      case "pending": {
        const record = decision.record;
        if (record.preparedResponse !== undefined) {
          const recovered = await recover(record);
          if (!recovered.ok) return recovered;
          if (recovered.data !== null && record.claimId) {
            const settled = await settleClaim(
              repository,
              actor,
              operation,
              requestKey,
              requestHash,
              record.claimId,
              recovered.data.response,
            );
            if (settled) return success({ kind: "replay", response: recovered.data.response });
            continue;
          }
        }
        const elapsed = Date.now() - startedAt;
        if (elapsed >= CLAIM_WAIT_MS) {
          return failure("STORAGE_UNAVAILABLE", REQUEST_IN_FLIGHT_MESSAGE);
        }
        await sleep(Math.min(CLAIM_POLL_MS, CLAIM_WAIT_MS - elapsed));
      }
    }
  }
}

function parseGrantResponse(response: unknown): ConsentGrant | null {
  if (!isRecord(response)) return null;
  const parsed = consentSchema.safeParse(response.consent);
  if (!parsed.success || typeof response.created !== "boolean") return null;
  return { consent: parsed.data, created: response.created };
}

function parseRevokeResponse(response: unknown, consentId: string): ConsentRevocation | null {
  if (!isRecord(response) || response.consentId !== consentId || typeof response.revokedAt !== "string") {
    return null;
  }
  return { consentId, revokedAt: response.revokedAt, alreadyRevoked: response.alreadyRevoked === true };
}

// ---------------------------------------------------------------------------
// Consents: grant
// ---------------------------------------------------------------------------

export interface GrantConsentInput {
  providerProfileId: string;
  providerProfileVersion: number;
  purpose: ProviderPurpose;
  targetId: string | null;
  manifestHash: string;
  scope: ConsentScope;
  expiresAt?: string | null;
}

export interface ConsentGrant {
  consent: Consent;
  created: boolean;
}

export interface AiWriteOptions {
  /** Optional request key; reused keys replay or conflict per 05-contracts §2. */
  requestKey?: string | null;
  now?: () => string;
  config?: ProviderProfileConfig;
  newId?: () => string;
}

interface NormalizedGrant {
  providerProfileId: string;
  providerProfileVersion: number;
  purpose: ProviderPurpose;
  targetId: string | null;
  manifestHash: string;
  scope: ConsentScope;
  expiresAt: string | null;
}

function normalizeRequestKey(requestKey: string | null | undefined): AiResult<string | null> {
  if (requestKey === undefined || requestKey === null) return success(null);
  if (typeof requestKey !== "string" || requestKey.length === 0 || requestKey.length > 128) {
    return failure("INVALID_INPUT", "请求键必须是 1 到 128 个字符。");
  }
  return success(requestKey);
}

function isProviderPurpose(value: unknown): value is ProviderPurpose {
  return value === "extract" || value === "draft" || value === "check" || value === "ocr";
}

function normalizeGrantInput(input: GrantConsentInput): AiResult<NormalizedGrant> {
  if (!input || typeof input !== "object") return failure("INVALID_INPUT", "请求内容不完整。");
  if (!isText(input.providerProfileId)) return failure("INVALID_INPUT", "处理方不可用。");
  if (!Number.isSafeInteger(input.providerProfileVersion) || input.providerProfileVersion < 1) {
    return failure("INVALID_INPUT", "处理方版本无效。");
  }
  if (!isProviderPurpose(input.purpose)) return failure("INVALID_INPUT", "用途无效。");
  if (!(input.targetId === null || isUuid(input.targetId))) {
    return failure(input.targetId === null ? "INVALID_INPUT" : "RESOURCE_NOT_FOUND", "目标不可用。");
  }
  if (typeof input.manifestHash !== "string" || !/^[0-9a-f]{64}$/.test(input.manifestHash)) {
    return failure("INVALID_INPUT", "材料清单摘要无效。");
  }
  const parsed = consentScopeSchema.safeParse(input.scope);
  if (!parsed.success) {
    return failure("INVALID_INPUT", "授权范围无效。", {
      fields: parsed.error.issues.map((issue) => issue.path.join(".")),
    });
  }
  const expiresAt = input.expiresAt ?? null;
  if (expiresAt !== null && typeof expiresAt !== "string") {
    return failure("INVALID_INPUT", "授权到期时间无效。");
  }
  return success({
    providerProfileId: input.providerProfileId,
    providerProfileVersion: input.providerProfileVersion,
    purpose: input.purpose,
    targetId: input.targetId,
    manifestHash: input.manifestHash,
    scope: normalizeScope(parsed.data),
    expiresAt,
  });
}

async function grantRequestHash(matterId: string, input: NormalizedGrant): Promise<string> {
  return sha256Hex(
    new TextEncoder().encode(
      canonicalJson({ operation: GRANT_OPERATION, matterId, payload: input }),
    ),
  );
}

function profileProblem(profile: ProviderProfile): AiError | null {
  const parsed = providerProfileSchema.safeParse(profile);
  if (!parsed.success) {
    const fields = [
      ...new Set([
        ...parsed.error.issues.map((issue) => issue.path.join(".")),
        ...unknownProfileFields(profile),
      ]),
    ];
    return {
      code: "CAPABILITY_UNAVAILABLE",
      message: "处理方配置不完整，不能确认真实外发。",
      fields,
    };
  }
  if (profile.mode === "local" || profile.mode === "stub") {
    return {
      code: "CAPABILITY_UNAVAILABLE",
      message: "此处理方不需要外发授权。",
      resourceIds: [profile.id],
    };
  }
  if (profile.mode === "byok") {
    return {
      code: "CAPABILITY_UNAVAILABLE",
      message: "浏览器版不保存自带密钥，不能授权 BYOK 外发。",
      resourceIds: [profile.id],
    };
  }
  const unknown = unknownProfileFields(profile);
  if (unknown.length > 0) {
    return {
      code: "CAPABILITY_UNAVAILABLE",
      message: `处理方信息不完整：${unknown.map(profileFieldLabel).join("、")}为「未知」，不能确认。`,
      fields: unknown,
      resourceIds: [profile.id],
    };
  }
  if (profile.status !== "approved") {
    return {
      code: "CAPABILITY_UNAVAILABLE",
      message: "处理方尚未批准，不能保存真实外发授权。",
      resourceIds: [profile.id],
    };
  }
  return null;
}

function consentMatchesProfile(consent: Consent, profile: ProviderProfile): boolean {
  return (
    consent.providerProfileId === profile.id &&
    consent.providerProfileVersion === profile.version &&
    consent.processorName === profile.processorName &&
    consent.processingRegion === profile.processingRegion &&
    consent.retentionPolicyVersion === profile.retentionPolicyVersion &&
    consent.trainingPolicy === profile.trainingPolicy &&
    consent.termsVersion === profile.termsVersion
  );
}

function findReusableConsent(
  rows: readonly StoredConsent[],
  events: readonly ActivityRecord[],
  profile: ProviderProfile,
  input: NormalizedGrant,
  now: string,
): Consent | null {
  const candidates = rows
    .map((row) => row.consent)
    .filter(
      (consent) =>
        consent.providerProfileId === profile.id &&
        consent.providerProfileVersion === profile.version &&
        consent.purpose === input.purpose &&
        sameScope(consent.scope, input.scope) &&
        consent.expiresAt === input.expiresAt &&
        consentMatchesProfile(consent, profile) &&
        revokedEvent(events, consent.id) === null &&
        (consent.expiresAt === null || consent.expiresAt > now) &&
        grantedEvent(events, consent.id) !== null,
    )
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  return candidates[0] ?? null;
}

async function writeConsentRow(
  repository: LocalRepository,
  actor: Actor,
  matterId: string,
  requestKey: string | null,
  consent: Consent,
): Promise<AiResult<{ createdRow: boolean }>> {
  const key = consentKey(actor.tenantId, matterId, consent.id);
  try {
    return await repository.backend.transaction("readwrite", async (tx) => {
      const raw = await tx.get(STORES.blobs, key);
      if (raw !== undefined) {
        const existing = asStoredConsent(raw);
        if (!existing) return failure("STORAGE_UNAVAILABLE", "本机保存的授权记录不可读。");
        if (existing.tenantId !== actor.tenantId || existing.matterId !== matterId) {
          return failure("RESOURCE_NOT_FOUND", "授权不可用。");
        }
        const same =
          existing.requestKey === requestKey &&
          canonicalJson(existing.consent) === canonicalJson(consent);
        if (same) return success({ createdRow: false });
        return failure(
          "IDEMPOTENCY_CONFLICT",
          requestKey === null ? "授权编号冲突，尚未保存。" : "同一请求键对应了不同的授权内容。",
        );
      }
      const row: StoredConsent = {
        kind: "ai.consent",
        tenantId: actor.tenantId,
        matterId,
        requestKey,
        consent,
      };
      await tx.put(STORES.blobs, key, row);
      return success({ createdRow: true });
    });
  } catch {
    return failure("STORAGE_UNAVAILABLE", "无法写入外发授权。请稍后重试。");
  }
}

/**
 * Remove a Consent row only when no consent.granted event exists for it. The
 * row, the event and the idempotency record are checked in the same read-write
 * transaction, so a losing attempt can never delete a row whose granted event
 * survived, nor the row of a claim owner that is between its row write and its
 * commit.
 */
async function deleteOrphanConsentRow(
  repository: LocalRepository,
  actor: Actor,
  matterId: string,
  consentId: string,
  requestKey: string | null,
  operation: IdempotencyRecord["operation"],
  ownClaimId: string | null,
): Promise<void> {
  const key = consentKey(actor.tenantId, matterId, consentId);
  try {
    await repository.backend.transaction("readwrite", async (tx) => {
      const raw = await tx.get(STORES.blobs, key);
      if (raw === undefined) return;
      const row = asStoredConsent(raw);
      if (!row || row.tenantId !== actor.tenantId || row.matterId !== matterId) return;
      if (requestKey !== null && row.requestKey !== requestKey) return;
      const events = await tx.getAll(STORES.events);
      const granted = events.some(
        (event) =>
          isRecord(event) &&
          event.action === "consent.granted" &&
          event.resourceId === consentId &&
          event.tenantId === actor.tenantId &&
          event.matterId === matterId,
      );
      if (granted) return;
      // A keyed row must not be deleted while another owner is between its row
      // write and its consent.granted commit, nor while a completed response
      // still replays it. Only the caller's own pending claim (or no record at
      // all) proves that no other writer is live and the orphan row is safe to
      // remove.
      if (requestKey !== null) {
        const rawRecord = await tx.get(STORES.blobs, idempotencyKey(actor, operation, requestKey));
        if (rawRecord !== undefined) {
          const record = asIdempotencyRecord(rawRecord);
          if (!record) return;
          if (idempotencyState(record) === "completed") return;
          if (record.claimId !== ownClaimId) return;
        }
      }
      await tx.delete(STORES.blobs, key);
    });
  } catch {
    // A row without a consent.granted event is invisible and cannot authorize.
  }
}

/**
 * Prove through the deterministic consent id and its granted event that an
 * earlier attempt of this keyed request landed. Used only while a prepared
 * claim exists; no business write happens here.
 */
async function recoverGrantedAttempt(
  repository: LocalRepository,
  actor: Actor,
  matterId: string,
  requestKey: string,
  normalized: NormalizedGrant,
): Promise<AiResult<{ response: unknown } | null>> {
  const consentId = await derivedId(
    `v6/ai/consent/${actor.tenantId}/${actor.userId}/${matterId}/${requestKey}`,
  );
  let stored: StoredConsent | null;
  try {
    stored = await repository.backend.transaction("readonly", async (tx) =>
      asStoredConsent(await tx.get(STORES.blobs, consentKey(actor.tenantId, matterId, consentId))),
    );
  } catch {
    return failure("STORAGE_UNAVAILABLE", "无法读取本机的授权记录。请稍后重试。");
  }
  if (!stored) return success(null);
  const sameRequest =
    stored.requestKey === requestKey &&
    stored.consent.providerProfileId === normalized.providerProfileId &&
    stored.consent.providerProfileVersion === normalized.providerProfileVersion &&
    stored.consent.purpose === normalized.purpose &&
    stored.consent.expiresAt === normalized.expiresAt &&
    sameScope(stored.consent.scope, normalized.scope);
  if (!sameRequest) return success(null);
  const events = await readConsentEvents(repository, actor, matterId);
  if (!events.ok) return events;
  if (grantedEvent(events.data, consentId) === null) return success(null);
  const data: ConsentGrant = { consent: stored.consent, created: true };
  return success({ response: data });
}

/**
 * Save one Consent for a known, approved platform profile. The manifest hash
 * and scope are checked again against the matter's current state; a stale view
 * can never be confirmed.
 *
 * A keyed request first claims its idempotency key. The claim is the only
 * authority to run the business read-check-write; a concurrent request with
 * the same key either conflicts before writing or waits for this claim.
 */
export async function grantConsent(
  repository: LocalRepository,
  actor: Actor,
  matterId: string,
  input: GrantConsentInput,
  options: AiWriteOptions = {},
): Promise<AiResult<ConsentGrant>> {
  if (!isText(matterId)) return failure("INVALID_INPUT", "案件不可用。");
  const key = normalizeRequestKey(options.requestKey);
  if (!key.ok) return key;
  const normalized = normalizeGrantInput(input);
  if (!normalized.ok) return normalized;
  const requestHash = await grantRequestHash(matterId, normalized.data);
  const requestKey = key.data;

  let claimId: string | null = null;
  let settled = false;
  let committedToStorage = false;

  const settle = async (data: ConsentGrant): Promise<boolean> => {
    if (claimId === null) return true;
    const stored = await settleClaim(
      repository,
      actor,
      GRANT_OPERATION,
      requestKey!,
      requestHash,
      claimId,
      data,
    );
    if (stored) settled = true;
    return stored;
  };

  try {
    if (requestKey !== null) {
      const claim = await claimIdempotency(
        repository,
        actor,
        GRANT_OPERATION,
        matterId,
        requestKey,
        requestHash,
        (previous) => recoverGrantedAttempt(repository, actor, matterId, requestKey, normalized.data),
      );
      if (!claim.ok) return claim;
      if (claim.data.kind === "replay") {
        const data = parseGrantResponse(claim.data.response);
        if (!data) return failure("STORAGE_UNAVAILABLE", "本机保存的请求结果不可读。");
        return success(data, true);
      }
      claimId = claim.data.claimId;
    }

    const loaded = await repository.loadMatter(actor, matterId);
    if (!loaded.ok) return { ok: false, error: mapRepositoryError(loaded.error) };
    const aggregate = loaded.data.data;

    // A keyed retry must replay even after the matter is archived. The consent
    // row plus its consent.granted event is the durable record of that request.
    const rows = await readAiRows(repository, actor, matterId, aggregate.matter.sourceVersion);
    if (!rows.ok) return rows;
    const events = await readConsentEvents(repository, actor, matterId);
    if (!events.ok) return events;

    if (requestKey !== null) {
      const consentId = await derivedId(
        `v6/ai/consent/${actor.tenantId}/${actor.userId}/${matterId}/${requestKey}`,
      );
      const stored = rows.data.consents.find((row) => row.consent.id === consentId);
      if (stored) {
        const sameRequest =
          stored.requestKey === requestKey &&
          stored.consent.providerProfileId === normalized.data.providerProfileId &&
          stored.consent.providerProfileVersion === normalized.data.providerProfileVersion &&
          stored.consent.purpose === normalized.data.purpose &&
          stored.consent.expiresAt === normalized.data.expiresAt &&
          sameScope(stored.consent.scope, normalized.data.scope);
        if (!sameRequest) {
          return failure("IDEMPOTENCY_CONFLICT", "同一请求键对应了不同的授权内容。");
        }
        if (grantedEvent(events.data, consentId) !== null) {
          const data: ConsentGrant = { consent: stored.consent, created: true };
          committedToStorage = true;
          if (!(await settle(data))) {
            await prepareClaim(repository, actor, GRANT_OPERATION, requestKey, requestHash, claimId!, data);
            return failure(
              "STORAGE_UNAVAILABLE",
              "授权已写入本机，但请求记录未能保存；请使用同一请求键重试以确认。",
            );
          }
          return success(data, true);
        }
        // The row is an orphan from a commit that failed before appending
        // consent.granted. It is not authoritative; remove it only if no
        // granted event exists, checked in the same transaction.
        await deleteOrphanConsentRow(repository, actor, matterId, consentId, requestKey, GRANT_OPERATION, claimId);
      }
    }

    if (aggregate.matter.status !== "active") {
      return failure("INVALID_TRANSITION", "案件已归档，不能新增授权。");
    }

    const config = options.config ?? DEFAULT_AI_CONFIG;
    const profile = config.profiles.find(
      (candidate) =>
        candidate.id === normalized.data.providerProfileId &&
        candidate.version === normalized.data.providerProfileVersion,
    );
    if (!profile) {
      return failure("CAPABILITY_UNAVAILABLE", "处理方或版本不可用。", {
        resourceIds: [normalized.data.providerProfileId],
      });
    }
    const problem = profileProblem(profile);
    if (problem) return { ok: false, error: problem };
    if (!profile.allowedPurposes.includes(normalized.data.purpose)) {
      return failure("CAPABILITY_UNAVAILABLE", "该处理方没有声明这个用途。", {
        resourceIds: [profile.id],
      });
    }

    const now = clock(options);
    if (normalized.data.expiresAt !== null && normalized.data.expiresAt <= now) {
      return failure("INVALID_INPUT", "授权到期时间必须晚于当前时间。");
    }

    // Even a reusable consent is only returned for a request that still matches
    // today's material. A stale view must be refused, not satisfied from history.
    const initialManifest = await buildManifest(aggregate, rows.data, normalized.data.targetId);
    if (!initialManifest.ok) return initialManifest;
    if (
      initialManifest.data.payloadManifestHash !== normalized.data.manifestHash ||
      !sameScope(initialManifest.data.scope, normalized.data.scope)
    ) {
      return failure("STALE_BINDING", "材料清单已变化，请重新查看外发内容后再授权。");
    }

    const reusable = findReusableConsent(rows.data.consents, events.data, profile, normalized.data, now);
    if (reusable !== null) {
      const data: ConsentGrant = { consent: reusable, created: false };
      if (!(await settle(data))) {
        return failure("STORAGE_UNAVAILABLE", "无法写入本机的请求记录。请稍后重试。");
      }
      return success(data);
    }

    const consentId =
      requestKey !== null
        ? await derivedId(`v6/ai/consent/${actor.tenantId}/${actor.userId}/${matterId}/${requestKey}`)
        : newId(options);
    const consent: Consent = {
      id: consentId,
      actorId: actor.userId,
      providerProfileId: profile.id,
      providerProfileVersion: profile.version,
      purpose: normalized.data.purpose,
      scope: normalized.data.scope,
      processorName: profile.processorName,
      processingRegion: profile.processingRegion as string,
      retentionPolicyVersion: profile.retentionPolicyVersion as string,
      trainingPolicy: profile.trainingPolicy as "no_training" | "allowed",
      termsVersion: profile.termsVersion as string,
      createdAt: now,
      expiresAt: normalized.data.expiresAt,
    };
    const parsedConsent = consentSchema.safeParse(consent);
    if (!parsedConsent.success) {
      return failure("INVALID_INPUT", "授权内容不完整。", {
        fields: parsedConsent.error.issues.map((issue) => issue.path.join(".")),
      });
    }

    const eventId = await derivedId(`v6/ai/event/consent-granted/${matterId}/${consent.id}`);
    const freshData: ConsentGrant = { consent: parsedConsent.data, created: true };
    if (claimId !== null) {
      const prepared = await prepareClaim(
        repository,
        actor,
        GRANT_OPERATION,
        requestKey!,
        requestHash,
        claimId,
        freshData,
      );
      if (!prepared) {
        return failure("STORAGE_UNAVAILABLE", "无法写入本机的请求记录。请稍后重试。");
      }
    }
    let wroteRow = false;

    for (let attempt = 0; attempt < MAX_COMMIT_ATTEMPTS; attempt += 1) {
      const current = await repository.loadMatter(actor, matterId);
      if (!current.ok) return { ok: false, error: mapRepositoryError(current.error) };
      if (current.data.data.matter.status !== "active") {
        if (wroteRow) await deleteOrphanConsentRow(repository, actor, matterId, consent.id, requestKey, GRANT_OPERATION, claimId);
        return failure("INVALID_TRANSITION", "案件已归档，不能新增授权。");
      }
      const currentRows: AiResult<AiRows> =
        attempt === 0
          ? rows
          : await readAiRows(repository, actor, matterId, current.data.data.matter.sourceVersion);
      if (!currentRows.ok) {
        if (wroteRow) await deleteOrphanConsentRow(repository, actor, matterId, consent.id, requestKey, GRANT_OPERATION, claimId);
        return currentRows;
      }
      const manifest = await buildManifest(current.data.data, currentRows.data, normalized.data.targetId);
      if (!manifest.ok) {
        if (wroteRow) await deleteOrphanConsentRow(repository, actor, matterId, consent.id, requestKey, GRANT_OPERATION, claimId);
        return manifest;
      }
      if (
        manifest.data.payloadManifestHash !== normalized.data.manifestHash ||
        !sameScope(manifest.data.scope, normalized.data.scope)
      ) {
        if (wroteRow) await deleteOrphanConsentRow(repository, actor, matterId, consent.id, requestKey, GRANT_OPERATION, claimId);
        return failure("STALE_BINDING", "材料清单已变化，请重新查看外发内容后再授权。");
      }

      // Only the claim owner may write business state or commit.
      if (claimId !== null) {
        const owned = await claimOwned(
          repository,
          actor,
          GRANT_OPERATION,
          requestKey!,
          requestHash,
          claimId,
        );
        if (!owned.ok) {
          if (wroteRow) await deleteOrphanConsentRow(repository, actor, matterId, consent.id, requestKey, GRANT_OPERATION, claimId);
          return owned;
        }
        if (!owned.data) {
          if (wroteRow) await deleteOrphanConsentRow(repository, actor, matterId, consent.id, requestKey, GRANT_OPERATION, claimId);
          return failure("STORAGE_UNAVAILABLE", REQUEST_IN_FLIGHT_MESSAGE);
        }
      }

      const row = await writeConsentRow(repository, actor, matterId, requestKey, parsedConsent.data);
      if (!row.ok) return row;
      if (row.data.createdRow) wroteRow = true;

      const event: ActivityRecord = {
        id: eventId,
        tenantId: actor.tenantId,
        matterId,
        targetId: consent.scope.targetId,
        actorId: actor.userId,
        actorKind: "user",
        action: "consent.granted",
        snapshot: null,
        jobId: null,
        resourceId: consent.id,
        occurredAt: now,
        metadata: { provider: profile.id },
      };
      const committed = await repository.commit(
        actor,
        {
          contractVersion: CONTRACT_VERSION,
          expectedVersion: current.data.data.matter.version,
          payload: {
            matter: {
              ...current.data.data.matter,
              version: current.data.data.matter.version + 1,
              updatedAt: now,
            },
            targets: current.data.data.targets,
            assets: current.data.data.assets,
            events: [event],
            blobs: [],
          },
        },
        { requestId: requestKey ?? eventId },
      );

      if (committed.ok) {
        committedToStorage = true;
        if (!(await settle(freshData))) {
          return failure(
            "STORAGE_UNAVAILABLE",
            "授权已写入本机，但请求记录未能保存；请使用同一请求键重试以确认。",
          );
        }
        return success(freshData);
      }

      if (committed.error.code === "VERSION_CONFLICT") continue;
      if (committed.error.code === "INVALID_INPUT") {
        // A duplicate event id means another attempt of this same keyed request
        // committed first. Return the stored consent rather than a second write.
        const latestEvents = await readConsentEvents(repository, actor, matterId);
        if (latestEvents.ok && grantedEvent(latestEvents.data, consent.id) !== null) {
          const stored = await repository.backend
            .transaction("readonly", async (tx) =>
              asStoredConsent(await tx.get(STORES.blobs, consentKey(actor.tenantId, matterId, consent.id))),
            )
            .catch(() => null);
          if (stored) {
            const data: ConsentGrant = { consent: stored.consent, created: true };
            committedToStorage = true;
            if (!(await settle(data))) {
              return failure(
                "STORAGE_UNAVAILABLE",
                "授权已写入本机，但请求记录未能保存；请使用同一请求键重试以确认。",
              );
            }
            return success(data, true);
          }
        }
        if (wroteRow) await deleteOrphanConsentRow(repository, actor, matterId, consent.id, requestKey, GRANT_OPERATION, claimId);
        return failure("INVALID_INPUT", "授权记录被本地存储拒绝，尚未保存。");
      }
      if (wroteRow) await deleteOrphanConsentRow(repository, actor, matterId, consent.id, requestKey, GRANT_OPERATION, claimId);
      if (committed.error.code === "INVALID_TRANSITION") {
        return failure("INVALID_TRANSITION", "案件已归档，不能新增授权。");
      }
      return { ok: false, error: mapRepositoryError(committed.error) };
    }

    if (wroteRow) await deleteOrphanConsentRow(repository, actor, matterId, consent.id, requestKey, GRANT_OPERATION, claimId);
    return failure("VERSION_CONFLICT", "案件持续更新，授权尚未保存。请刷新后重试。");
  } finally {
    if (claimId !== null && !settled && !committedToStorage) {
      await releaseClaim(repository, actor, GRANT_OPERATION, requestKey!, requestHash, claimId);
    }
  }
}

// ---------------------------------------------------------------------------
// Consents: validate and revoke
// ---------------------------------------------------------------------------

export interface ValidateConsentInput {
  consentId: string;
  purpose: ProviderPurpose;
  targetId?: string | null;
}

export interface ConsentAuthorization {
  consent: ConsentView;
  manifest: PayloadManifest;
}

/**
 * The pre-call authorization check a runner must use. A real call is still
 * blocked by `requestRealInvocation`; this function decides whether the
 * consent on file covers the material and purpose at this moment.
 */
export async function validateConsentForUse(
  repository: LocalRepository,
  actor: Actor,
  matterId: string,
  input: ValidateConsentInput,
  options: { config?: ProviderProfileConfig; now?: () => string } = {},
): Promise<AiResult<ConsentAuthorization>> {
  if (!isText(matterId) || !isUuid(input?.consentId) || !isProviderPurpose(input?.purpose)) {
    return failure("INVALID_INPUT", "授权检查参数不完整。");
  }
  const loaded = await repository.loadMatter(actor, matterId);
  if (!loaded.ok) return { ok: false, error: mapRepositoryError(loaded.error) };
  if (loaded.data.data.matter.status !== "active") {
    return failure("INVALID_TRANSITION", "案件已归档，不能发起新的外发。");
  }
  const rows = await readAiRows(repository, actor, matterId, loaded.data.data.matter.sourceVersion);
  if (!rows.ok) return rows;
  const events = await readConsentEvents(repository, actor, matterId);
  if (!events.ok) return events;

  const stored = rows.data.consents.find((row) => row.consent.id === input.consentId);
  if (!stored) return failure("RESOURCE_NOT_FOUND", "授权不可用。");
  if (grantedEvent(events.data, stored.consent.id) === null) {
    return failure("RESOURCE_NOT_FOUND", "授权不可用。");
  }
  const revoked = revokedEvent(events.data, stored.consent.id);
  if (revoked !== null) {
    return failure("CONSENT_REVOKED", "外发授权已撤回，需要重新授权。", {
      resourceIds: [stored.consent.id],
    });
  }
  const now = options.now ? options.now() : new Date().toISOString();
  if (stored.consent.expiresAt !== null && stored.consent.expiresAt <= now) {
    return failure("CONSENT_REQUIRED", "外发授权已过期，需要重新授权。", {
      resourceIds: [stored.consent.id],
    });
  }
  if (stored.consent.purpose !== input.purpose) {
    return failure("CONSENT_REQUIRED", "用途已变化，需要新的外发授权。", {
      resourceIds: [stored.consent.id],
    });
  }
  if (input.targetId !== undefined && stored.consent.scope.targetId !== input.targetId) {
    return failure("CONSENT_REQUIRED", "授权范围已变化，需要新的外发授权。", {
      resourceIds: [stored.consent.id],
    });
  }

  const config = options.config ?? DEFAULT_AI_CONFIG;
  const profile = config.profiles.find(
    (candidate) =>
      candidate.id === stored.consent.providerProfileId &&
      candidate.version === stored.consent.providerProfileVersion,
  );
  if (!profile) {
    return failure("CONSENT_REQUIRED", "处理方或版本已变化，需要新的外发授权。", {
      resourceIds: [stored.consent.id],
    });
  }
  const problem = profileProblem(profile);
  if (problem) return { ok: false, error: problem };
  if (!consentMatchesProfile(stored.consent, profile)) {
    return failure("CONSENT_REQUIRED", "处理地区、保留、训练或条款已变化，需要新的外发授权。", {
      resourceIds: [stored.consent.id],
    });
  }

  const manifest = await buildManifest(
    loaded.data.data,
    rows.data,
    stored.consent.scope.targetId,
  );
  if (!manifest.ok) {
    return failure("CONSENT_REQUIRED", "授权范围或材料已变化，需要新的外发授权。", {
      resourceIds: [stored.consent.id],
    });
  }
  if (
    manifest.data.payloadManifestHash !== stored.consent.scope.payloadManifestHash ||
    !sameScope(manifest.data.scope, stored.consent.scope)
  ) {
    return failure("CONSENT_REQUIRED", "材料已变化，旧授权不包含当前文件，需要新的外发授权。", {
      resourceIds: [stored.consent.id],
    });
  }

  return success({
    consent: consentView(stored.consent, null, now, false),
    manifest: manifest.data,
  });
}

export interface RevokeConsentInput {
  consentId: string;
}

export interface ConsentRevocation {
  consentId: string;
  revokedAt: string;
  alreadyRevoked: boolean;
}

async function revokeRequestHash(matterId: string, consentId: string): Promise<string> {
  return sha256Hex(
    new TextEncoder().encode(
      canonicalJson({ operation: REVOKE_OPERATION, matterId, payload: { consentId } }),
    ),
  );
}

/**
 * Prove through the deterministic revocation event id that an earlier attempt
 * of this keyed request landed. The prepared response keeps the original
 * `alreadyRevoked` value when the timestamps agree.
 */
async function recoverRevokedAttempt(
  repository: LocalRepository,
  actor: Actor,
  matterId: string,
  consentId: string,
  preparedResponse: unknown,
): Promise<AiResult<{ response: unknown } | null>> {
  const eventId = await derivedId(`v6/ai/event/consent-revoked/${matterId}/${consentId}`);
  const listed = await readConsentEvents(repository, actor, matterId);
  if (!listed.ok) return listed;
  const event = listed.data.find(
    (candidate) =>
      candidate.id === eventId &&
      candidate.action === "consent.revoked" &&
      candidate.resourceId === consentId,
  );
  if (!event) return success(null);
  const prepared = isRecord(preparedResponse) ? preparedResponse : null;
  const matchesPrepared =
    prepared !== null && prepared.consentId === consentId && prepared.revokedAt === event.occurredAt;
  const data: ConsentRevocation = {
    consentId,
    revokedAt: event.occurredAt,
    alreadyRevoked: matchesPrepared ? prepared.alreadyRevoked === true : true,
  };
  return success({ response: data });
}

/**
 * Append a revocation. The event id is derived from the consent id, so the same
 * consent can never acquire two revocation events; the Consent row stays.
 *
 * Like a grant, a keyed revoke claims its idempotency key before any business
 * read; only the claim owner may append the event or finalize the response.
 */
export async function revokeConsent(
  repository: LocalRepository,
  actor: Actor,
  matterId: string,
  input: RevokeConsentInput,
  options: AiWriteOptions = {},
): Promise<AiResult<ConsentRevocation>> {
  if (!isText(matterId) || !isUuid(input?.consentId)) {
    return failure("INVALID_INPUT", "授权不可用。");
  }
  const key = normalizeRequestKey(options.requestKey);
  if (!key.ok) return key;
  const requestKey = key.data;
  const requestHash = await revokeRequestHash(matterId, input.consentId);

  let claimId: string | null = null;
  let settled = false;
  let committedToStorage = false;

  const settle = async (data: ConsentRevocation): Promise<boolean> => {
    if (claimId === null) return true;
    const stored = await settleClaim(
      repository,
      actor,
      REVOKE_OPERATION,
      requestKey!,
      requestHash,
      claimId,
      data,
    );
    if (stored) settled = true;
    return stored;
  };

  try {
    if (requestKey !== null) {
      const claim = await claimIdempotency(
        repository,
        actor,
        REVOKE_OPERATION,
        matterId,
        requestKey,
        requestHash,
        (previous) =>
          recoverRevokedAttempt(repository, actor, matterId, input.consentId, previous.preparedResponse),
      );
      if (!claim.ok) return claim;
      if (claim.data.kind === "replay") {
        const data = parseRevokeResponse(claim.data.response, input.consentId);
        if (!data) return failure("STORAGE_UNAVAILABLE", "本机保存的请求结果不可读。");
        return success(data, true);
      }
      claimId = claim.data.claimId;
    }

    const loaded = await repository.loadMatter(actor, matterId);
    if (!loaded.ok) return { ok: false, error: mapRepositoryError(loaded.error) };
    const rows = await readAiRows(repository, actor, matterId, loaded.data.data.matter.sourceVersion);
    if (!rows.ok) return rows;
    const events = await readConsentEvents(repository, actor, matterId);
    if (!events.ok) return events;

    const stored = rows.data.consents.find((row) => row.consent.id === input.consentId);
    if (!stored) return failure("RESOURCE_NOT_FOUND", "授权不可用。");
    if (grantedEvent(events.data, stored.consent.id) === null) {
      return failure("RESOURCE_NOT_FOUND", "授权不可用。");
    }
    const already = revokedEvent(events.data, stored.consent.id);
    if (already !== null) {
      const data: ConsentRevocation = {
        consentId: stored.consent.id,
        revokedAt: already.occurredAt,
        alreadyRevoked: true,
      };
      if (!(await settle(data))) {
        return failure("STORAGE_UNAVAILABLE", "无法写入本机的请求记录。请稍后重试。");
      }
      return success(data, requestKey !== null);
    }
    if (loaded.data.data.matter.status !== "active") {
      return failure("INVALID_TRANSITION", "案件已归档，不能新增撤回记录。");
    }

    const now = clock(options);
    const data: ConsentRevocation = {
      consentId: stored.consent.id,
      revokedAt: now,
      alreadyRevoked: false,
    };
    if (claimId !== null) {
      const prepared = await prepareClaim(
        repository,
        actor,
        REVOKE_OPERATION,
        requestKey!,
        requestHash,
        claimId,
        data,
      );
      if (!prepared) {
        return failure("STORAGE_UNAVAILABLE", "无法写入本机的请求记录。请稍后重试。");
      }
    }

    const eventId = await derivedId(`v6/ai/event/consent-revoked/${matterId}/${stored.consent.id}`);
    for (let attempt = 0; attempt < MAX_COMMIT_ATTEMPTS; attempt += 1) {
      const current = await repository.loadMatter(actor, matterId);
      if (!current.ok) return { ok: false, error: mapRepositoryError(current.error) };
      if (current.data.data.matter.status !== "active") {
        return failure("INVALID_TRANSITION", "案件已归档，不能新增撤回记录。");
      }
      if (claimId !== null) {
        const owned = await claimOwned(
          repository,
          actor,
          REVOKE_OPERATION,
          requestKey!,
          requestHash,
          claimId,
        );
        if (!owned.ok) return owned;
        if (!owned.data) return failure("STORAGE_UNAVAILABLE", REQUEST_IN_FLIGHT_MESSAGE);
      }
      const event: ActivityRecord = {
        id: eventId,
        tenantId: actor.tenantId,
        matterId,
        targetId: stored.consent.scope.targetId,
        actorId: actor.userId,
        actorKind: "user",
        action: "consent.revoked",
        snapshot: null,
        jobId: null,
        resourceId: stored.consent.id,
        occurredAt: now,
        metadata: { provider: stored.consent.providerProfileId },
      };
      const committed = await repository.commit(
        actor,
        {
          contractVersion: CONTRACT_VERSION,
          expectedVersion: current.data.data.matter.version,
          payload: {
            matter: {
              ...current.data.data.matter,
              version: current.data.data.matter.version + 1,
              updatedAt: now,
            },
            targets: current.data.data.targets,
            assets: current.data.data.assets,
            events: [event],
            blobs: [],
          },
        },
        { requestId: requestKey ?? eventId },
      );
      if (committed.ok) {
        committedToStorage = true;
        if (!(await settle(data))) {
          return failure(
            "STORAGE_UNAVAILABLE",
            "撤回已写入本机，但请求记录未能保存；请使用同一请求键重试以确认。",
          );
        }
        return success(data);
      }
      if (committed.error.code === "VERSION_CONFLICT") continue;
      if (committed.error.code === "INVALID_INPUT") {
        const latest = await readConsentEvents(repository, actor, matterId);
        const winner = latest.ok ? revokedEvent(latest.data, stored.consent.id) : null;
        if (winner !== null) {
          const winnerData: ConsentRevocation = {
            consentId: stored.consent.id,
            revokedAt: winner.occurredAt,
            alreadyRevoked: true,
          };
          committedToStorage = true;
          if (!(await settle(winnerData))) {
            await prepareClaim(
              repository,
              actor,
              REVOKE_OPERATION,
              requestKey!,
              requestHash,
              claimId!,
              winnerData,
            );
            return failure(
              "STORAGE_UNAVAILABLE",
              "撤回已写入本机，但请求记录未能保存；请使用同一请求键重试以确认。",
            );
          }
          return success(winnerData, requestKey !== null);
        }
        return failure("INVALID_INPUT", "撤回记录被本地存储拒绝，尚未保存。");
      }
      if (committed.error.code === "INVALID_TRANSITION") {
        return failure("INVALID_TRANSITION", "案件已归档，不能新增撤回记录。");
      }
      return { ok: false, error: mapRepositoryError(committed.error) };
    }
    return failure("VERSION_CONFLICT", "案件持续更新，撤回尚未保存。请刷新后重试。");
  } finally {
    if (claimId !== null && !settled && !committedToStorage) {
      await releaseClaim(repository, actor, REVOKE_OPERATION, requestKey!, requestHash, claimId);
    }
  }
}

// ---------------------------------------------------------------------------
// Real invocation gate
// ---------------------------------------------------------------------------

export interface RealInvocationRequest {
  consentId: string | null;
  providerProfileId: string;
  providerProfileVersion: number;
  purpose: ProviderPurpose;
  targetId: string | null;
}

/** Validate the status-backed release gate and current stored consent; this function never invokes a model. */
export async function requestRealInvocation(
  repository: LocalRepository,
  actor: Actor,
  matterId: string,
  input: RealInvocationRequest,
  options: { config?: ProviderProfileConfig; now?: () => string } = {},
): Promise<AiResult<ConsentAuthorization>> {
  if (AI_RELEASE_GATE(options.config) !== "open") return failure(
    "RELEASE_GATE_CLOSED",
    "真实模型服务尚未启用；没有发出任何模型请求。",
  );
  if (!input.consentId) return failure("CONSENT_REQUIRED", "请先查看并确认当前外发清单。");
  const checked = await validateConsentForUse(repository, actor, matterId, {
    consentId: input.consentId, purpose: input.purpose, targetId: input.targetId,
  }, options);
  if (!checked.ok) return checked;
  if (checked.data.consent.providerProfileId !== input.providerProfileId
    || checked.data.consent.providerProfileVersion !== input.providerProfileVersion) {
    return failure("CONSENT_REQUIRED", "处理方或版本已变化，需要重新授权。");
  }
  return checked;
}
