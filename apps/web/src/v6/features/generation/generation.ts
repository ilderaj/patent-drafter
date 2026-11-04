/** V6-17 — R1 generation jobs, saved stage checkpoints and explicit adoption. */
import {
  draftAstSchema,
  draftRevisionSchema,
  factSchema,
  jobSchema,
  modelInvocationSchema,
  stageOutputSchema,
  type DraftAST,
  type Fact,
  type Job,
  type ModelInvocation,
  type SourceRef,
  type StageOutput,
} from "../../../../../../packages/contracts/src/index.ts";
import {
  saveRevision,
  type DraftInputRef,
  type MatterRevisions,
  type RevisionContext,
  type RevisionRecord,
  type TargetRevisions,
} from "../../../../../../packages/domain/src/v6/revision.ts";
import {
  type PipelineContext,
  type PipelineOptions,
  type StageResult,
} from "@patent/pipeline";
import type { PipelineStage } from "@patent/domain";
import { MockProvider, type LLMProvider } from "@patent/providers";
import { PipelineAdapter, PipelineAdapterError, type PipelineStageCache } from "../../lib/pipeline-adapter.ts";
import {
  DEFAULT_AI_CONFIG,
  validateConsentForUse,
  type ProviderProfileConfig,
} from "../ai/ai.ts";
import {
  CONTRACT_VERSION,
  STORES,
  sha256Hex,
  type Actor,
  type ActivityRecord,
  type LocalRepository,
  type MatterAggregate,
  type StorageBackend,
} from "../../lib/repository.ts";
import { loadTargetsView } from "../targets/targets.ts";

export const GENERATE_STAGES = ["facts", "support", "claims", "specification", "checks"] as const;
export type GenerateStage = (typeof GENERATE_STAGES)[number];
export type StageState = "pending" | "running" | "completed" | "failed" | "cancelled";
export type GenerationErrorCode = string;

const PIPELINE_TARGET: Readonly<Record<Exclude<GenerateStage, "support">, PipelineStage>> = {
  facts: "extract_invention_facts",
  claims: "draft_claims",
  specification: "draft_abstract",
  checks: "export",
};

/** One confirmed source fact with the contract refs it can be traced to. */
export interface SupportFact {
  factId: string;
  statement: string;
  kind: Fact["kind"];
  status: Fact["status"];
  refs: SourceRef[];
  chunkIds: string[];
  resolved: boolean;
}

/** The facts pipeline's ids (f1, f2…) mapped back to a persisted SourceSnapshot fact. */
export interface SupportPipelineFact {
  pipelineFactId: string;
  statement: string;
  snapshotFactId: string | null;
  chunkIds: string[];
  resolved: boolean;
}

/**
 * Deterministic stage output for `support`: a fact → source-ref index built from
 * the persisted SourceSnapshot and the parsed chunks. `byChunkId` includes live
 * chunk ids and pipeline chunk aliases (the ids the provider used in its refs).
 */
export interface SupportIndex {
  schemaVersion: "support.v1";
  facts: SupportFact[];
  pipelineFacts: SupportPipelineFact[];
  unresolvedFactIds: string[];
  unmappedPipelineFactIds: string[];
  byChunkId: Record<string, { factId: string; refs: SourceRef[] }[]>;
}

/** A live parsed chunk used to validate persisted SourceRef locators. */
export interface LiveChunk {
  id: string;
  sourceId: string;
  text: string;
  hash: string;
  page: number | null;
}

export interface GenerationStageView {
  stage: GenerateStage;
  state: StageState;
  errorCode: GenerationErrorCode | null;
  output: unknown | null;
  outputMeta: StageOutput | null;
}

export interface GenerationResultPreview {
  ast: DraftAST;
  testOutput: boolean;
}

export interface GenerationInvocation extends ModelInvocation {
  matterId: string;
  generationStage: GenerateStage;
  executionLocation: string;
  at: string;
  /** Per-call cost settlement; pending calls are not yet counted against the cap. */
  costState?: "pending" | "known" | "unknown";
}

export interface GenerationJobView {
  job: Job;
  stages: readonly GenerationStageView[];
  progress: Job["progress"];
  result: GenerationResultPreview | null;
  /** Deterministic support index from the persisted facts/chunks; null before support runs. */
  support: SupportIndex | null;
  errorMessage: string | null;
  retryOfJobId: string | null;
}

export interface GenerationRevisionView {
  revision: RevisionRecord<DraftAST>;
  ast: DraftAST;
}

export type GenerationOutcome<T> =
  | { ok: true; data: T; replayed: boolean }
  | { ok: false; error: { code: GenerationErrorCode; message: string } };

export interface GenerationLimits {
  maxInputTokens: number;
  maxOutputTokens: number;
  /** Whole-job cost cap; unknown-cost calls consume the remaining budget. */
  maxCostMinor: number;
  /** Whole-job elapsed cap, measured from the running segment start. */
  maxDurationSeconds: number;
}

/** A transaction spans the current IndexedDB backend or its deterministic memory adapter. */
export interface GenerationStoreTransaction {
  get(key: string): Promise<unknown>;
  put(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface GenerationStore {
  transaction<T>(run: (tx: GenerationStoreTransaction) => Promise<T>): Promise<T>;
}

export interface GenerationEngineOptions {
  repository: LocalRepository;
  actor: Actor;
  pipeline: PipelineOptions;
  limits: GenerationLimits;
  /** R1 test/stub output bypasses consent and never calls the injected provider. */
  execution?: "provider" | "stub";
  provider?: LLMProvider;
  profileId?: string;
  profileVersion?: number;
  consentId?: string | null;
  config?: ProviderProfileConfig;
  storage?: GenerationStore;
  now?: () => Date;
  newId?: (label: string) => string;
  stageVersion?: string;
}

export type AdoptionOutcome =
  | { status: "adopted"; job: GenerationJobView; revision: RevisionRecord<DraftAST> }
  | { status: "obsolete_result"; job: GenerationJobView; revision: null };

export interface GenerationEngine {
  list(matterId: string, targetId: string): Promise<GenerationOutcome<readonly GenerationJobView[]>>;
  get(jobId: string): Promise<GenerationOutcome<GenerationJobView>>;
  getRevision(revisionId: string): Promise<GenerationOutcome<GenerationRevisionView>>;
  listInvocations(jobId: string): Promise<GenerationOutcome<readonly GenerationInvocation[]>>;
  start(matterId: string, targetId: string): Promise<GenerationOutcome<GenerationJobView>>;
  cancel(jobId: string): Promise<GenerationOutcome<GenerationJobView>>;
  retry(jobId: string): Promise<GenerationOutcome<GenerationJobView>>;
  resume(jobId: string): Promise<GenerationOutcome<GenerationJobView>>;
  discard(jobId: string): Promise<GenerationOutcome<GenerationJobView>>;
  adopt(jobId: string): Promise<GenerationOutcome<AdoptionOutcome>>;
}

interface StoredInput {
  aggregate: MatterAggregate;
  target: MatterAggregate["targets"][number];
  input: DraftInputRef;
  baseDraftRevisionId: string | null;
  inputHash: string;
  language: "zh-CN" | "en-US";
  context: PipelineContext;
  facts: readonly Fact[];
  liveChunks: readonly LiveChunk[];
  supportIndex: SupportIndex;
  supportHash: string;
  promptVersion: string;
}

interface StoredStage {
  stage: GenerateStage;
  state: StageState;
  errorCode: GenerationErrorCode | null;
  metadata: StageOutput | null;
  output: unknown | null;
}

interface AdoptionCandidate {
  revision: RevisionRecord<DraftAST>;
  revisionState: MatterRevisions<DraftAST>;
  expectedVersion: number;
  eventId: string;
}

interface StoredGenerationJob {
  kind: "generation.job";
  tenantId: string;
  actorId: string;
  matterId: string;
  targetId: string;
  language: "zh-CN" | "en-US";
  ownerPageId: string;
  fence: number;
  retryOfJobId: string | null;
  job: Job;
  stages: StoredStage[];
  context: PipelineContext;
  facts: readonly Fact[];
  liveChunks: readonly LiveChunk[];
  supportIndex: SupportIndex;
  startedAt: string;
  deadlineAt: string;
  resultAst: DraftAST | null;
  testOutput: boolean;
  errorMessage: string | null;
  invocations: GenerationInvocation[];
  adoptionCandidate: AdoptionCandidate | null;
  revisionState: MatterRevisions<DraftAST> | null;
}

interface StoredRevision {
  kind: "generation.revision";
  tenantId: string;
  actorId: string;
  matterId: string;
  targetId: string;
  revision: RevisionRecord<DraftAST>;
}

interface StoredRevisionState {
  kind: "generation.revisions";
  tenantId: string;
  actorId: string;
  matterId: string;
  targetId: string;
  state: MatterRevisions<DraftAST>;
}

interface IndexRow {
  kind: "generation.index";
  tenantId: string;
  actorId: string;
  matterId: string;
  targetId: string;
  jobIds: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function ok<T>(data: T, replayed = false): GenerationOutcome<T> {
  return { ok: true, data, replayed };
}

function fail<T = never>(code: GenerationErrorCode, message: string): GenerationOutcome<T> {
  return { ok: false, error: { code, message } };
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function randomId(_label: string): string {
  return crypto.randomUUID();
}

function normalizeError(error: unknown): { code: string; message: string } {
  if (error instanceof PipelineAdapterError) return { code: error.code, message: error.message };
  if (isRecord(error) && typeof error.code === "string") {
    return { code: error.code, message: typeof error.message === "string" ? error.message : error.code };
  }
  return { code: "INTERNAL_ERROR", message: error instanceof Error ? error.message : "Generation failed." };
}

function countCompleted(stages: readonly StoredStage[]): number {
  return stages.filter((stage) => stage.state === "completed").length;
}

function viewOf(record: StoredGenerationJob): GenerationJobView {
  return {
    job: clone(record.job),
    stages: record.stages.map((stage) => ({
      stage: stage.stage,
      state: stage.state,
      errorCode: stage.errorCode,
      output: stage.output === null ? null : clone(stage.output),
      outputMeta: stage.metadata === null ? null : clone(stage.metadata),
    })),
    progress: clone(record.job.progress),
    result: record.resultAst === null ? null : { ast: clone(record.resultAst), testOutput: record.testOutput },
    support: record.supportIndex.facts.length === 0 && record.supportIndex.pipelineFacts.length === 0 ? null : clone(record.supportIndex),
    errorMessage: record.errorMessage,
    retryOfJobId: record.retryOfJobId,
  };
}

function baseStages(): StoredStage[] {
  return GENERATE_STAGES.map((stage) => ({ stage, state: "pending", errorCode: null, metadata: null, output: null }));
}

function ownerPrefix(actor: Actor): string {
  return `generation/${encodeURIComponent(actor.tenantId)}/${encodeURIComponent(actor.userId)}/`;
}

function validateLimits(limits: GenerationLimits): boolean {
  return [limits.maxInputTokens, limits.maxOutputTokens, limits.maxCostMinor, limits.maxDurationSeconds]
    .every((value) => Number.isSafeInteger(value) && value > 0);
}

function makeJobId(options: GenerationEngineOptions): string {
  return (options.newId ?? randomId)("generation-job");
}

function key(prefix: string, ...parts: string[]): string {
  return `${prefix}${parts.map(encodeURIComponent).join("/")}`;
}

/** IndexedDB-backed feature rows share LocalRepository's already-open backend and blobs store. */
export class IndexedDbGenerationStore implements GenerationStore {
  private readonly backend: StorageBackend;
  private readonly prefix: string;

  constructor(backend: StorageBackend, actor: Actor) {
    this.backend = backend;
    this.prefix = ownerPrefix(actor);
  }

  transaction<T>(run: (tx: GenerationStoreTransaction) => Promise<T>): Promise<T> {
    return this.backend.transaction("readwrite", async (backendTx) => run({
      get: (rowKey) => backendTx.get(STORES.blobs, this.scoped(rowKey)),
      put: (rowKey, value) => backendTx.put(STORES.blobs, this.scoped(rowKey), value),
      delete: (rowKey) => backendTx.delete(STORES.blobs, this.scoped(rowKey)),
    }));
  }

  private scoped(rowKey: string): string {
    if (rowKey.startsWith("/") || rowKey.includes("..")) throw new TypeError("generation row key escaped its owner namespace");
    return `${this.prefix}${rowKey}`;
  }
}

/** Deterministic storage adapter for Node tests; reads and writes are cloned and transactions roll back on error. */
export class MemoryGenerationStore implements GenerationStore {
  private rows = new Map<string, unknown>();
  private queue: Promise<void> = Promise.resolve();
  private readonly prefix: string;

  constructor(actor: Actor) {
    this.prefix = ownerPrefix(actor);
  }

  transaction<T>(run: (tx: GenerationStoreTransaction) => Promise<T>): Promise<T> {
    const next = this.queue.then(async () => {
      const before = new Map(this.rows);
      const tx: GenerationStoreTransaction = {
        get: async (rowKey) => {
          const value = this.rows.get(this.scoped(rowKey));
          return value === undefined ? undefined : clone(value);
        },
        put: async (rowKey, value) => { this.rows.set(this.scoped(rowKey), clone(value)); },
        delete: async (rowKey) => { this.rows.delete(this.scoped(rowKey)); },
      };
      try {
        return await run(tx);
      } catch (error) {
        this.rows = before;
        throw error;
      }
    });
    this.queue = next.then(() => undefined, () => undefined);
    return next;
  }

  private scoped(rowKey: string): string {
    if (rowKey.startsWith("/") || rowKey.includes("..")) throw new TypeError("generation row key escaped its owner namespace");
    return `${this.prefix}${rowKey}`;
  }
}

/**
 * V6-18 reuse seam for reading the head DraftRevision and appending an edited one.
 * It keeps contract validation, input refs, parent ids and CAS writes behind one small interface.
 */
export interface GenerationRevisionStore {
  loadHeadRevision(matterId: string, targetId: string): Promise<GenerationOutcome<GenerationRevisionView | null>>;
  loadRevision(matterId: string, targetId: string, revisionId: string): Promise<GenerationOutcome<GenerationRevisionView>>;
  saveEditedRevision(
    matterId: string,
    targetId: string,
    baseRevisionId: string | null,
    ast: DraftAST,
  ): Promise<GenerationOutcome<RevisionRecord<DraftAST>>>;
}

export interface GenerationRevisionStoreOptions {
  repository: LocalRepository;
  actor: Actor;
  storage?: GenerationStore;
  now?: () => Date;
  newId?: (label: string) => string;
}

/** Durable PipelineStageCache over the feature store; keys carry the input/provider fingerprint. */
export class GenerationPipelineCache implements PipelineStageCache {
  private readonly storage: GenerationStore;

  constructor(storage: GenerationStore) {
    this.storage = storage;
  }

  async get(cacheKey: string): Promise<unknown | undefined> {
    return this.storage.transaction((tx) => tx.get(pipelineCacheKey(cacheKey)));
  }

  async putIfAbsent(cacheKey: string, value: unknown): Promise<unknown> {
    return this.storage.transaction(async (tx) => {
      const rowKey = pipelineCacheKey(cacheKey);
      const existing = await tx.get(rowKey);
      if (existing !== undefined) return existing;
      await tx.put(rowKey, clone(value));
      return clone(value);
    });
  }

  async delete(cacheKey: string): Promise<void> {
    await this.storage.transaction((tx) => tx.delete(pipelineCacheKey(cacheKey)));
  }
}

function pipelineCacheKey(cacheKey: string): string {
  return `pipeline-cache/${encodeURIComponent(cacheKey)}`;
}

/** Construct the shared revision seam without creating a generation/provider engine. */
export function createGenerationRevisionStore(options: GenerationRevisionStoreOptions): GenerationRevisionStore {
  const storage = options.storage ?? new IndexedDbGenerationStore(options.repository.backend, options.actor);
  const now = options.now ?? (() => new Date());
  const newId = options.newId ?? randomId;
  const revisionRowKey = (matterId: string, targetId: string, revisionId: string) =>
    key("revision/", matterId, targetId, revisionId);
  const stateRowKey = (matterId: string, targetId: string) => key("revisions/", matterId, targetId);

  async function current(matterId: string, targetId: string): Promise<GenerationOutcome<{ aggregate: MatterAggregate; target: MatterAggregate["targets"][number]; input: DraftInputRef }>> {
    const loaded = await options.repository.loadMatter(options.actor, matterId);
    if (!loaded.ok) return fail(loaded.error.code, loaded.error.message);
    const aggregate = loaded.data.data;
    const target = aggregate.targets.find((item) => item.id === targetId);
    if (!target) return fail("RESOURCE_NOT_FOUND", "目标不可用。");
    const input: DraftInputRef = {
      matterId,
      targetId,
      sourceVersion: aggregate.matter.sourceVersion,
      targetConfigVersion: target.configVersion,
      figureRevisionId: target.figureRevisionId,
    };
    return ok({ aggregate, target, input });
  }

  async function readStoredRevision(matterId: string, targetId: string, revisionId: string) {
    const raw = await storage.transaction((tx) => tx.get(revisionRowKey(matterId, targetId, revisionId)));
    if (!isRecord(raw) || raw.kind !== "generation.revision" || raw.tenantId !== options.actor.tenantId
      || raw.actorId !== options.actor.userId || raw.matterId !== matterId || raw.targetId !== targetId) {
      return fail<GenerationRevisionView>("RESOURCE_NOT_FOUND", "草稿修订不可用。");
    }
    const parsed = draftRevisionSchema.safeParse(raw.revision);
    if (!parsed.success) return fail<GenerationRevisionView>("STORAGE_UNAVAILABLE", "草稿修订记录无法读取。");
    return ok({ revision: parsed.data as RevisionRecord<DraftAST>, ast: clone(parsed.data.ast) });
  }

  async function loadHeadRevision(matterId: string, targetId: string): Promise<GenerationOutcome<GenerationRevisionView | null>> {
    try {
      const loaded = await current(matterId, targetId);
      if (!loaded.ok) return loaded;
      if (loaded.data.target.draftRevisionId === null) return ok(null);
      const head = await readStoredRevision(matterId, targetId, loaded.data.target.draftRevisionId);
      return head.ok ? ok(head.data) : head;
    } catch (error) {
      const failure = normalizeError(error);
      return fail(failure.code, failure.message);
    }
  }

  async function loadRevision(matterId: string, targetId: string, revisionId: string): Promise<GenerationOutcome<GenerationRevisionView>> {
    try {
      const loaded = await current(matterId, targetId);
      return loaded.ok ? readStoredRevision(matterId, targetId, revisionId) : loaded;
    } catch (error) {
      const failure = normalizeError(error);
      return fail(failure.code, failure.message);
    }
  }

  async function revisionState(
    matterId: string,
    targetId: string,
    headRevisionId: string | null,
    aggregate: MatterAggregate,
    input: DraftInputRef,
  ): Promise<MatterRevisions<DraftAST> | null> {
    const raw = await storage.transaction((tx) => tx.get(stateRowKey(matterId, targetId)));
    if (isRecord(raw) && raw.kind === "generation.revisions" && raw.tenantId === options.actor.tenantId
      && raw.actorId === options.actor.userId && isRecord(raw.state)) {
      const state = clone(raw.state as unknown as MatterRevisions<DraftAST>);
      const currentTarget = state.targets[targetId];
      if (currentTarget && currentTarget.headRevisionId === headRevisionId) {
        return {
          ...state,
          sourceVersion: input.sourceVersion,
          targets: {
            ...state.targets,
            [targetId]: {
              ...currentTarget,
              status: aggregate.targets.find((target) => target.id === targetId)!.status,
              configVersion: input.targetConfigVersion,
              figureRevisionId: input.figureRevisionId,
            },
          },
        };
      }
      // A missing/failed final state write can leave the target pointer ahead
      // of the state row. Reconstruct from the target head so the next save is
      // an idempotent retry instead of a VERSION_CONFLICT.
    }
    const target = aggregate.targets.find((item) => item.id === targetId)!;
    const revisions: RevisionRecord<DraftAST>[] = [];
    if (headRevisionId !== null) {
      const head = await readStoredRevision(matterId, targetId, headRevisionId);
      if (!head.ok) return null;
      revisions.push(head.data.revision);
    }
    const targetState: TargetRevisions<DraftAST> = {
      targetId,
      status: target.status,
      configVersion: target.configVersion,
      figureRevisionId: target.figureRevisionId,
      figureSets: [],
      headRevisionId,
      revisions,
    };
    return { matterId, sourceVersion: input.sourceVersion, targets: { [targetId]: targetState } };
  }

  async function saveEditedRevision(
    matterId: string,
    targetId: string,
    baseRevisionId: string | null,
    ast: DraftAST,
  ): Promise<GenerationOutcome<RevisionRecord<DraftAST>>> {
    try {
      const parsed = draftAstSchema.safeParse(ast);
      if (!parsed.success) return fail("INVALID_AST", "编辑内容不符合 DraftAST 结构。");
      const loaded = await current(matterId, targetId);
      if (!loaded.ok) return loaded;
      if (loaded.data.aggregate.matter.status !== "active" || loaded.data.target.status !== "active") {
        return fail("INVALID_TRANSITION", "已归档的案件或目标不能保存修订。");
      }
      if (loaded.data.target.draftRevisionId !== baseRevisionId) {
        return fail("VERSION_CONFLICT", "基础修订已变化，请重新读取并合并编辑内容。");
      }
      const state = await revisionState(matterId, targetId, baseRevisionId, loaded.data.aggregate, loaded.data.input);
      if (!state) return fail("VERSION_CONFLICT", "当前基础修订不在本机修订记录中。");
      const astHash = await canonicalAstHash(parsed.data);
      const saved = saveRevision(state, {
        targetId,
        baseRevisionId,
        ast: parsed.data,
        astHash,
        reason: "edited",
        input: loaded.data.input,
      }, { newId: (label) => newId(label), now: () => now().toISOString(), actorId: options.actor.userId });
      if (!saved.ok) return fail(saved.error.code, saved.error.message);
      const eventId = newId("revision-created-event");
      const event: ActivityRecord = {
        id: eventId,
        tenantId: options.actor.tenantId,
        matterId,
        targetId,
        actorId: options.actor.userId,
        actorKind: "user",
        action: "revision.created",
        snapshot: null,
        jobId: null,
        resourceId: saved.revision.id,
        occurredAt: now().toISOString(),
        metadata: { version: loaded.data.aggregate.matter.version + 1 },
      };
      await storage.transaction((tx) => tx.put(revisionRowKey(matterId, targetId, saved.revision.id), {
        kind: "generation.revision",
        tenantId: options.actor.tenantId,
        actorId: options.actor.userId,
        matterId,
        targetId,
        revision: saved.revision,
      } satisfies StoredRevision));
      const committed = await options.repository.commit(options.actor, {
        contractVersion: CONTRACT_VERSION,
        expectedVersion: loaded.data.aggregate.matter.version,
        payload: {
          matter: {
            ...loaded.data.aggregate.matter,
            version: loaded.data.aggregate.matter.version + 1,
            updatedAt: event.occurredAt,
          },
          targets: loaded.data.aggregate.targets.map((target) => target.id === targetId
            ? { ...target, draftRevisionId: saved.revision.id }
            : target),
          assets: loaded.data.aggregate.assets,
          events: [event],
          blobs: [],
        },
      }, { requestId: eventId });
      if (!committed.ok) return fail(committed.error.code, committed.error.message);
      try {
        await storage.transaction((tx) => tx.put(stateRowKey(matterId, targetId), {
          kind: "generation.revisions",
          tenantId: options.actor.tenantId,
          actorId: options.actor.userId,
          matterId,
          targetId,
          state: saved.state,
        } satisfies StoredRevisionState));
      } catch {
        // The target pointer and revision.created event already landed. If the
        // final state row write failed, the next load/save reconstructs state
        // from the target head, so the save itself is still a success.
        const confirmed = await options.repository.loadMatter(options.actor, matterId);
        const targetNow = confirmed.ok
          ? confirmed.data.data.targets.find((target) => target.id === targetId)
          : undefined;
        if (targetNow?.draftRevisionId !== saved.revision.id) {
          return fail("STORAGE_UNAVAILABLE", "修订已写入，但本机修订状态未能保存；请重试。");
        }
      }
      return ok(saved.revision);
    } catch (error) {
      const failure = normalizeError(error);
      return fail(failure.code, failure.message);
    }
  }

  return { loadHeadRevision, loadRevision, saveEditedRevision };
}

export function createGenerationEngine(options: GenerationEngineOptions): GenerationEngine {
  if (!validateLimits(options.limits)) throw new TypeError("Generation limits must be positive safe integers.");
  const execution = options.execution ?? "provider";
  const revisions = createGenerationRevisionStore(options);
  const config = options.config ?? DEFAULT_AI_CONFIG;
  const profile = config.profiles.find((candidate) =>
    candidate.id === options.profileId && candidate.version === options.profileVersion,
  ) ?? (execution === "stub" ? config.profiles.find((candidate) => candidate.mode === "stub") : undefined);
  if (!profile) throw new TypeError("A configured ProviderProfile and version are required.");
  const selectedProfile = profile;
  if (execution === "stub" && (selectedProfile.mode !== "stub" || selectedProfile.status === "disabled")) {
    throw new TypeError("Stub execution requires an enabled stub selectedProfile.");
  }
  if (execution === "provider" && (selectedProfile.mode !== "platform" || selectedProfile.status !== "approved")) {
    throw new TypeError("Provider execution requires an approved platform selectedProfile.");
  }
  const provider = options.provider ?? (execution === "stub" ? new MockProvider() : null);
  if (!provider) throw new TypeError("Provider execution requires an injected provider adapter.");
  const activeProvider: LLMProvider = provider;
  const storage = options.storage ?? new IndexedDbGenerationStore(options.repository.backend, options.actor);
  const now = options.now ?? (() => new Date());
  const newId = options.newId ?? randomId;
  const pageId = newId("generation-page");
  const pipeline = {
    prompts: options.pipeline.prompts,
    promptVersion: options.pipeline.promptVersion,
    rulePackVersion: options.pipeline.rulePackVersion,
  };
  const stageVersion = options.stageVersion ?? "v6-17.1";
  const adapterOptions = {
    provider: activeProvider,
    providerId: selectedProfile.adapterId,
    modelId: selectedProfile.modelId,
    purpose: "draft" as const,
    stageVersion,
    pipeline,
    execution,
    cacheScopeId: `${options.actor.tenantId}/${options.actor.userId}`,
    cache: new GenerationPipelineCache(storage),
    now,
  };

  function jobKey(jobId: string): string {
    return key("job/", jobId);
  }

  function indexKey(matterId: string, targetId: string): string {
    return key("index/", matterId, targetId);
  }

  function revisionKey(matterId: string, targetId: string, revisionId: string): string {
    return key("revision/", matterId, targetId, revisionId);
  }

  function revisionsKey(matterId: string, targetId: string): string {
    return key("revisions/", matterId, targetId);
  }

  async function readRecord(jobId: string): Promise<StoredGenerationJob | null> {
    const raw = await storage.transaction((tx) => tx.get(jobKey(jobId)));
    if (!isRecord(raw) || raw.kind !== "generation.job" || raw.tenantId !== options.actor.tenantId || raw.actorId !== options.actor.userId) return null;
    const parsed = jobSchema.safeParse(raw.job);
    if (!parsed.success) return null;
    return raw as unknown as StoredGenerationJob;
  }

  async function writeRecord(record: StoredGenerationJob): Promise<void> {
    const parsed = jobSchema.safeParse(record.job);
    if (!parsed.success) throw new Error(`stored generation job failed schema validation: ${parsed.error.issues[0]?.path.join(".") ?? "job"}`);
    await storage.transaction((tx) => tx.put(jobKey(record.job.id), clone(record)));
  }

  async function updateRecord<T>(jobId: string, update: (record: StoredGenerationJob) => T): Promise<T | null> {
    return storage.transaction(async (tx) => {
      const raw = await tx.get(jobKey(jobId));
      if (!isRecord(raw) || raw.kind !== "generation.job" || raw.tenantId !== options.actor.tenantId || raw.actorId !== options.actor.userId) return null;
      const record = clone(raw as unknown as StoredGenerationJob);
      const result = update(record);
      const parsed = jobSchema.safeParse(record.job);
      if (!parsed.success) throw new Error(`stored generation job failed schema validation: ${parsed.error.issues[0]?.path.join(".") ?? "job"}`);
      await tx.put(jobKey(jobId), record);
      return result;
    });
  }

  function nowIso(): string {
    return now().toISOString();
  }

  async function currentInput(matterId: string, targetId: string): Promise<StoredInput | null> {
    const loaded = await options.repository.loadMatter(options.actor, matterId);
    if (!loaded.ok) throw Object.assign(new Error(loaded.error.message), { code: loaded.error.code });
    const aggregate = loaded.data.data;
    if (aggregate.matter.status !== "active") throw Object.assign(new Error("案件当前不能生成。"), { code: "INVALID_TRANSITION" });
    const target = aggregate.targets.find((item) => item.id === targetId && item.status === "active");
    if (!target) throw Object.assign(new Error("目标不可用。"), { code: "RESOURCE_NOT_FOUND" });

    const [rows, targetsView] = await Promise.all([
      options.repository.backend.transaction("readonly", (tx) => tx.getAll(STORES.blobs)),
      loadTargetsView(options.repository, options.actor, matterId),
    ]);
    if (!targetsView.ok) throw Object.assign(new Error(targetsView.error.message), { code: targetsView.error.code });
    const targetView = targetsView.view.targets.find((item) => item.id === targetId);
    const sourceRows = new Map<string, Record<string, unknown>>();
    for (const row of rows) {
      if (isRecord(row) && row.kind === "parse.source" && isRecord(row.source) && row.source.matterId === matterId) {
        sourceRows.set(String(row.source.id), row.source);
      }
    }
    const liveSourceIds = new Set([...sourceRows.values()]
      .filter((source) => source.retiredAt === null)
      .map((source) => String(source.id)));
    const chunks: PipelineContext["chunks"] = [];
    const liveChunks: LiveChunk[] = [];
    for (const row of rows) {
      if (!isRecord(row) || row.kind !== "parse.chunks" || !liveSourceIds.has(String(row.sourceId)) || !Array.isArray(row.chunks)) continue;
      const source = sourceRows.get(String(row.sourceId));
      if (!source || (typeof source.parserVersion === "string" && row.parserVersion !== source.parserVersion)) continue;
      for (const chunk of row.chunks) {
        if (!isRecord(chunk) || typeof chunk.id !== "string") continue;
        const text = typeof chunk.text === "string" ? chunk.text : "";
        const hash = typeof chunk.hash === "string" ? chunk.hash : "";
        const page = typeof chunk.page === "number" ? chunk.page : null;
        chunks.push({
          id: chunk.id,
          assetId: String(source.assetId),
          chunkIndex: Number.isSafeInteger(chunk.index) ? chunk.index as number : chunks.length,
          kind: chunk.kind === "table" || chunk.kind === "image" || chunk.kind === "ocr_page" ? chunk.kind : "paragraph",
          text,
          page: page ?? undefined,
          contentHash: hash,
        });
        liveChunks.push({ id: chunk.id, sourceId: String(row.sourceId), text, hash, page });
      }
    }
    chunks.sort((a, b) => a.assetId.localeCompare(b.assetId) || a.chunkIndex - b.chunkIndex || a.id.localeCompare(b.id));
    liveChunks.sort((a, b) => a.id.localeCompare(b.id));

    const snapshotRow = rows.find((row) => isRecord(row) && row.kind === "intake.snapshot" && isRecord(row.snapshot)
      && row.snapshot.matterId === matterId && row.snapshot.version === aggregate.matter.sourceVersion);
    const snapshot = isRecord(snapshotRow) && isRecord(snapshotRow.snapshot) ? snapshotRow.snapshot : null;
    const facts: Fact[] = [];
    if (snapshot && Array.isArray(snapshot.facts)) {
      for (const candidate of snapshot.facts) {
        const parsed = factSchema.safeParse(candidate);
        if (parsed.success) facts.push(parsed.data);
      }
    }
    const supportIndex = buildSupportIndex(facts, liveChunks);
    const supportHash = await sha256Hex(new TextEncoder().encode(canonicalJson({ facts, liveChunks })));
    const promptVersion = `${pipeline.promptVersion}+support.${supportHash.slice(0, 12)}`;
    const userAnswers: Record<string, string> = {};
    if (snapshot && isRecord(snapshot.answers)) {
      for (const [answerKey, answerValue] of Object.entries(snapshot.answers)) {
        if (typeof answerValue === "string") userAnswers[answerKey] = answerValue;
      }
    }
    const context: PipelineContext = {
      projectId: `${matterId}/${targetId}`,
      title: aggregate.matter.title,
      assets: aggregate.assets.filter((asset) => asset.purpose === "source" && asset.state === "available").map((asset) => ({
        id: asset.id,
        projectId: matterId,
        fileName: asset.originalName,
        fileType: asset.mime,
        sizeBytes: asset.byteLength,
        sha256: asset.sha256,
        storageRef: asset.objectKey,
        parseStatus: "ok",
        ocrNeeded: false,
      })),
      chunks,
      userAnswers,
      results: {},
      rulePackVersion: pipeline.rulePackVersion,
      promptVersion,
    };
    const input: DraftInputRef = {
      matterId,
      targetId,
      sourceVersion: aggregate.matter.sourceVersion,
      targetConfigVersion: target.configVersion,
      figureRevisionId: target.figureRevisionId,
    };
    const inputHash = await sha256Hex(new TextEncoder().encode(canonicalJson({
      input,
      baseDraftRevisionId: target.draftRevisionId,
      title: aggregate.matter.title,
      assets: context.assets,
      chunks,
      facts,
      answers: snapshot?.answers ?? {},
      providerProfileId: selectedProfile.id,
      providerProfileVersion: selectedProfile.version,
      modelId: selectedProfile.modelId,
      promptVersion,
      supportHash,
      stageVersion,
      rulePackVersion: pipeline.rulePackVersion,
    })));
    return {
      aggregate,
      target,
      input,
      baseDraftRevisionId: target.draftRevisionId,
      inputHash,
      language: targetView?.config?.language === "en-US" ? "en-US" : "zh-CN",
      context,
      facts,
      liveChunks,
      supportIndex,
      supportHash,
      promptVersion,
    };
  }

  async function authorize(
    stage: string,
    scopeHash: string,
    generationStage: GenerateStage,
    jobId: string,
    fence: number,
  ) {
    const record = await readRecord(jobId);
    if (!record || record.fence !== fence || record.job.state !== "running" || record.ownerPageId !== pageId) {
      return { allowed: false as const, code: "INVALID_TRANSITION", message: "任务已取消或由其他页面接管。" };
    }
    if (execution === "stub") return { allowed: true as const };
    if (elapsedLimitExceeded(record)) {
      return { allowed: false as const, code: "JOB_LIMIT_EXCEEDED", message: "任务超过配置的最长运行时间。" };
    }
    if (costLimitExceeded(record)) {
      return { allowed: false as const, code: "JOB_LIMIT_EXCEEDED", message: "任务超过配置的费用上限。" };
    }
    if (!options.consentId) return { allowed: false as const, code: "CONSENT_REQUIRED", message: "生成前需要有效的外发授权。" };
    const consent = await validateConsentForUse(options.repository, options.actor, record.matterId, {
      consentId: options.consentId,
      purpose: "draft",
      targetId: record.targetId,
    }, { config, now: nowIso });
    if (!consent.ok) {
      // Material/scope drift mid-run is recorded as a stale result rather than
      // silently switching to a new scope or dropping the job. Revocation and
      // profile/purpose changes remain terminal (S04-A02/A08).
      if (consent.error.code === "CONSENT_REQUIRED") {
        const recorded = await createInvocation(jobId, stage, scopeHash, generationStage, fence);
        if (!recorded) return { allowed: false as const, code: "INVALID_TRANSITION", message: "任务已取消，未开始新的调用。" };
        await updateRecord(jobId, (current) => {
          if (current.job.disposition !== "obsolete_result") {
            current.job.disposition = "obsolete_result";
            current.job.version += 1;
          }
        });
        return { allowed: true as const };
      }
      return { allowed: false as const, code: consent.error.code, message: consent.error.message };
    }
    if (
      consent.data.consent.providerProfileId !== selectedProfile.id ||
      consent.data.consent.providerProfileVersion !== selectedProfile.version ||
      stage.length === 0 ||
      !/^[0-9a-f]{64}$/.test(scopeHash)
    ) {
      return { allowed: false as const, code: "CONSENT_REQUIRED", message: "授权或处理方配置已变化。" };
    }
    const stillCurrent = await readRecord(jobId);
    if (!stillCurrent || stillCurrent.fence !== fence || stillCurrent.job.state !== "running" || stillCurrent.ownerPageId !== pageId) {
      return { allowed: false as const, code: "INVALID_TRANSITION", message: "任务已取消，未开始新的调用。" };
    }
    const recorded = await createInvocation(jobId, stage, scopeHash, generationStage, fence);
    if (!recorded) return { allowed: false as const, code: "INVALID_TRANSITION", message: "任务已取消，未开始新的调用。" };
    return { allowed: true as const };
  }

  async function createInvocation(
    jobId: string,
    stage: string,
    scopeHash: string,
    generationStage: GenerateStage,
    fence: number,
  ): Promise<boolean> {
    const invocationId = newId("model-invocation");
    const invocation: GenerationInvocation = {
      id: invocationId,
      jobId,
      stage,
      attempt: 0,
      providerProfileId: selectedProfile.id,
      modelId: selectedProfile.modelId,
      consentId: options.consentId ?? null,
      requestHash: scopeHash,
      inputTokens: null,
      outputTokens: null,
      costMinor: null,
      currency: null,
      usageUnknown: true,
      status: "started",
      matterId: "",
      generationStage,
      executionLocation: selectedProfile.processingRegion ?? "unknown",
      at: nowIso(),
      costState: "pending",
    };
    const contract = {
      id: invocation.id,
      jobId: invocation.jobId,
      stage: invocation.stage,
      attempt: invocation.attempt,
      providerProfileId: invocation.providerProfileId,
      modelId: invocation.modelId,
      consentId: invocation.consentId,
      requestHash: invocation.requestHash,
      inputTokens: invocation.inputTokens,
      outputTokens: invocation.outputTokens,
      costMinor: invocation.costMinor,
      currency: invocation.currency,
      usageUnknown: invocation.usageUnknown,
      status: invocation.status,
    };
    if (!modelInvocationSchema.safeParse(contract).success) return false;
    const appended = await updateRecord(jobId, (current) => {
      if (current.fence !== fence || current.job.state !== "running" || current.ownerPageId !== pageId) return false;
      invocation.matterId = current.matterId;
      current.invocations.push(invocation);
      return true;
    });
    return appended === true;
  }

  async function recordStubInvocation(jobId: string, stage: GenerateStage, fence: number): Promise<void> {
    if (execution !== "stub") return;
    const invocation: GenerationInvocation = {
      id: newId("model-invocation"),
      jobId,
      stage,
      attempt: 0,
      providerProfileId: selectedProfile.id,
      modelId: selectedProfile.modelId,
      consentId: null,
      requestHash: "0".repeat(64),
      inputTokens: null,
      outputTokens: null,
      costMinor: null,
      currency: null,
      usageUnknown: false,
      status: "succeeded",
      matterId: "",
      generationStage: stage,
      executionLocation: "device:stub",
      at: nowIso(),
      costState: "known",
    };
    await updateRecord(jobId, (current) => {
      if (current.fence !== fence || current.job.state !== "running" || current.ownerPageId !== pageId) return;
      invocation.matterId = current.matterId;
      current.invocations.push(invocation);
    });
  }

  async function closeStartedInvocations(jobId: string, fence: number, status: "succeeded" | "failed" | "cancelled"): Promise<void> {
    await updateRecord(jobId, (record) => {
      if (record.fence !== fence) return;
      for (const invocation of record.invocations) {
        if (invocation.status !== "started") continue;
        invocation.status = status;
        if (invocation.costState === undefined || invocation.costState === "pending") invocation.costState = "unknown";
        invocation.usageUnknown = invocation.costState !== "known";
      }
    });
  }

  async function setStageRunning(jobId: string, stage: GenerateStage, fence: number): Promise<boolean> {
    const changed = await updateRecord(jobId, (record) => {
      if (record.fence !== fence || record.job.state !== "running" || record.ownerPageId !== pageId) return false;
      const item = record.stages.find((candidate) => candidate.stage === stage)!;
      item.state = "running";
      item.errorCode = null;
      record.job.stage = stage;
      record.job.version += 1;
      record.job.progress = { completed: countCompleted(record.stages), total: GENERATE_STAGES.length, unit: "stage" };
      return true;
    });
    return changed === true;
  }

  function elapsedLimitExceeded(record: StoredGenerationJob): boolean {
    const deadline = Date.parse(record.deadlineAt || "");
    if (Number.isFinite(deadline)) return now().getTime() > deadline;
    const started = Date.parse(record.startedAt || record.job.createdAt);
    return Number.isFinite(started) && now().getTime() - started > options.limits.maxDurationSeconds * 1000;
  }

  function costLimitExceeded(record: StoredGenerationJob): boolean {
    const settled = record.invocations.filter((invocation) => (invocation.costState ?? "unknown") !== "pending");
    const spent = settled.reduce((total, invocation) => total + (invocation.costMinor ?? 0), 0);
    // An unknown-cost call consumes the remaining budget: only one unknown
    // call may run under a cap, and the next call is refused.
    const unknown = settled.some((invocation) => (invocation.costState ?? "unknown") === "unknown");
    return spent >= options.limits.maxCostMinor || unknown;
  }

  async function markFailed(
    jobId: string,
    fence: number,
    stage: GenerateStage,
    code: GenerationErrorCode,
    message: string,
  ): Promise<void> {
    await closeStartedInvocations(jobId, fence, "failed");
    await updateRecord(jobId, (current) => {
      if (current.fence !== fence || current.job.state !== "running" || current.ownerPageId !== pageId) return;
      const item = current.stages.find((candidate) => candidate.stage === stage)!;
      item.state = "failed";
      item.errorCode = code;
      current.job.state = "failed";
      current.job.errorCode = code as Job["errorCode"];
      current.job.version += 1;
      current.job.stage = stage;
      current.job.progress = { completed: countCompleted(current.stages), total: GENERATE_STAGES.length, unit: "stage" };
      current.job.usageUnknown = current.invocations.some((invocation) => invocation.usageUnknown);
      current.errorMessage = message;
    });
  }

  async function applyInvocationCosts(
    jobId: string,
    fence: number,
    costs: readonly { stage: string; costMinor: number | null }[],
  ): Promise<void> {
    await updateRecord(jobId, (record) => {
      if (record.fence !== fence) return;
      for (const cost of costs) {
        const invocation = record.invocations.find(
          (candidate) => candidate.status === "started" && candidate.stage === cost.stage && candidate.costMinor === null,
        );
        if (!invocation) continue;
        invocation.costMinor = cost.costMinor;
        invocation.currency = cost.costMinor === null ? null : "USD";
        invocation.costState = cost.costMinor === null ? "unknown" : "known";
        invocation.usageUnknown = cost.costMinor === null;
      }
    });
  }

  function costCapturingProvider(target: LLMProvider, jobId: string, fence: number): LLMProvider {
    return {
      getCapabilities: () => target.getCapabilities(),
      listModels: () => target.listModels(),
      generateStructured: async (request, schema) => {
        const response = await target.generateStructured(request, schema);
        const metadata = isRecord(response) && isRecord(response.metadata) ? response.metadata : null;
        const cost = metadata && Number.isSafeInteger(metadata.costMinor) && (metadata.costMinor as number) >= 0
          ? metadata.costMinor as number
          : null;
        // Apply each call's cost before the next authorization, so a single
        // logical stage cannot run past the job budget between boundaries.
        await applyInvocationCosts(jobId, fence, [{ stage: request.stage ?? "unknown", costMinor: cost }]);
        const latest = await readRecord(jobId);
        if (!latest || latest.fence !== fence || latest.job.state !== "running" || latest.ownerPageId !== pageId) {
          throw Object.assign(new Error("任务已取消或由其他页面接管。"), { code: "INVALID_TRANSITION" });
        }
        if (elapsedLimitExceeded(latest)) {
          throw Object.assign(new Error("任务超过配置的最长运行时间。"), { code: "JOB_LIMIT_EXCEEDED" });
        }
        return response;
      },
      streamText: (request) => target.streamText(request),
      cancel: (requestId) => target.cancel(requestId),
    };
  }

  function supportPromptsFor(record: StoredGenerationJob): { prompts: Record<string, string> | undefined; injected: boolean } {
    const base = options.pipeline.prompts;
    if (!base || record.supportIndex.facts.length === 0) return { prompts: base, injected: false };
    const suffix = supportPromptSuffix(record.supportIndex);
    const prompts: Record<string, string> = { ...base };
    let injected = false;
    for (const name of ["draft-claims.md", "draft-specification.md"]) {
      if (typeof prompts[name] === "string" && prompts[name].length > 0) {
        prompts[name] = `${prompts[name]}${suffix}`;
        injected = true;
      }
    }
    return { prompts, injected };
  }

  async function runJob(jobId: string, fence: number): Promise<void> {
    const begun = await updateRecord(jobId, (record) => {
      if (record.fence !== fence || record.ownerPageId !== pageId) return false;
      if (record.job.state === "queued") {
        record.job.state = "running";
        record.job.version += 1;
      }
      return record.job.state === "running";
    });
    if (begun !== true) return;
    for (const stage of GENERATE_STAGES) {
      let record = await readRecord(jobId);
      if (!record || record.fence !== fence || record.job.state !== "running" || record.ownerPageId !== pageId) return;
      if (elapsedLimitExceeded(record)) {
        await markFailed(jobId, fence, stage, "JOB_LIMIT_EXCEEDED", "任务超过配置的最长运行时间。");
        return;
      }
      const stageRecord = record.stages.find((candidate) => candidate.stage === stage)!;
      if (stageRecord.state === "completed") continue;
      if (!(await setStageRunning(jobId, stage, fence))) return;
      record = await readRecord(jobId);
      if (!record || record.fence !== fence || record.job.state !== "running") return;
      try {
        if (stage === "support") {
          const factsOutput = record.stages.find((candidate) => candidate.stage === "facts")?.output;
          const pipelineFacts = isRecord(factsOutput) && Array.isArray(factsOutput.facts)
            ? factsOutput.facts.filter(isRecord)
            : [];
          const support = buildSupportIndex(record.facts, record.liveChunks, pipelineFacts);
          const completedAt = nowIso();
          const stageResult: StageResult = {
            stage: "assess_readiness",
            output: support,
            meta: {
              stage: "assess_readiness",
              provider: "deterministic",
              model: null,
              promptVersion: record.job.promptVersion,
              rulePackVersion: record.job.rulePackVersion ?? "",
              startedAt: completedAt,
              finishedAt: completedAt,
              ms: 0,
              cached: false,
            },
          };
          const metadata = await stageMetadata(jobId, stage, stageResult, record.job.payloadHash, record.job.attempt, newId);
          await updateRecord(jobId, (current) => {
            if (current.fence !== fence || current.job.state !== "running" || current.ownerPageId !== pageId) return;
            const item = current.stages.find((candidate) => candidate.stage === stage)!;
            item.state = "completed";
            item.output = clone(support);
            item.metadata = metadata;
            item.errorCode = null;
            current.supportIndex = clone(support);
            current.job.version += 1;
            current.job.progress = { completed: countCompleted(current.stages), total: GENERATE_STAGES.length, unit: "stage" };
            current.job.stage = stage;
          });
          continue;
        }

        const target = PIPELINE_TARGET[stage];
        const supportPrompts = supportPromptsFor(record);
        let activeStage: GenerateStage | null = stage;
        const adapter = new PipelineAdapter({
          ...adapterOptions,
          provider: costCapturingProvider(activeProvider, jobId, fence),
          pipeline: {
            ...pipeline,
            prompts: supportPrompts.prompts,
            promptVersion: record.job.promptVersion,
          },
          cache: new GenerationPipelineCache(storage),
          authorize: async (request) => activeStage === null
            ? { allowed: false, code: "INVALID_TRANSITION", message: "生成阶段没有有效的任务上下文。" }
            : authorize(request.stage, request.scopeHash, activeStage, jobId, fence),
        });
        const result = await adapter.run(clone(record.context), target);
        activeStage = null;
        const stageResult = result.context.results[target];
        if (!stageResult) throw Object.assign(new Error(`missing ${target} output`), { code: "INTERNAL_ERROR" });
        const ast = stage === "checks" ? buildDraftAst(result.context, jobId, record.language, record.supportIndex) : null;
        if (ast && !draftAstSchema.safeParse(ast).success) {
          throw Object.assign(new Error("生成结果未通过 DraftAST 校验。"), { code: "PROVIDER_SCHEMA_INVALID" });
        }
        if (stageResultSize(stageResult) > options.limits.maxOutputTokens * 4) {
          throw Object.assign(new Error("阶段输出超过配置的输出上限。"), { code: "JOB_LIMIT_EXCEEDED" });
        }
        const afterRun = await readRecord(jobId);
        if (afterRun && elapsedLimitExceeded(afterRun)) {
          throw Object.assign(new Error("任务超过配置的最长运行时间。"), { code: "JOB_LIMIT_EXCEEDED" });
        }
        await recordStubInvocation(jobId, stage, fence);
        await closeStartedInvocations(jobId, fence, "succeeded");
        const metadata = await stageMetadata(jobId, stage, stageResult, record.job.payloadHash, record.job.attempt, newId);
        const saved = await updateRecord(jobId, (current) => {
          if (current.fence !== fence || current.job.state !== "running" || current.ownerPageId !== pageId) return false;
          current.context = clone(result.context);
          const item = current.stages.find((candidate) => candidate.stage === stage)!;
          item.state = "completed";
          item.output = clone(stageResult.output);
          item.metadata = metadata;
          item.errorCode = null;
          current.job.version += 1;
          current.job.progress = { completed: countCompleted(current.stages), total: GENERATE_STAGES.length, unit: "stage" };
          current.job.stage = stage;
          current.job.usageUnknown = current.invocations.some((invocation) => invocation.usageUnknown);
          if (stage === "checks") {
            current.resultAst = ast;
            current.testOutput = result.testOutput;
          }
          return true;
        });
        if (saved !== true) return;
        const latestInput = await currentInput(record.matterId, record.targetId);
        await updateRecord(jobId, (current) => {
          if (current.fence !== fence || current.job.state !== "running") return;
          current.job.version += 1;
          current.job.state = "running";
          if (!latestInput || latestInput.inputHash !== current.job.payloadHash || latestInput.baseDraftRevisionId !== current.job.baseDraftRevisionId) {
            current.job.disposition = "obsolete_result";
          }
        });
      } catch (error) {
        const failure = normalizeError(error);
        await markFailed(jobId, fence, stage, failure.code, failure.message);
        return;
      }
    }
    const finalInput = await readRecord(jobId);
    if (!finalInput || finalInput.fence !== fence || finalInput.job.state !== "running") return;
    if (elapsedLimitExceeded(finalInput)) {
      await markFailed(jobId, fence, "checks", "JOB_LIMIT_EXCEEDED", "任务超过配置的最长运行时间。");
      return;
    }
    const latest = await currentInput(finalInput.matterId, finalInput.targetId).catch(() => null);
    await updateRecord(jobId, (record) => {
      if (record.fence !== fence || record.job.state !== "running" || record.ownerPageId !== pageId) return;
      record.job.state = "succeeded";
      record.job.stage = null;
      record.job.errorCode = null;
      record.job.disposition = record.job.disposition === "obsolete_result"
        || !latest || latest.inputHash !== record.job.payloadHash || latest.baseDraftRevisionId !== record.job.baseDraftRevisionId
        ? "obsolete_result"
        : "ready";
      record.job.version += 1;
      record.job.progress = { completed: countCompleted(record.stages), total: GENERATE_STAGES.length, unit: "stage" };
    });
  }

  async function assertConsent(matterId: string, targetId: string): Promise<GenerationOutcome<true>> {
    if (execution === "stub") return ok(true);
    if (!options.consentId) return fail("CONSENT_REQUIRED", "生成前需要有效的外发授权。");
    const checked = await validateConsentForUse(options.repository, options.actor, matterId, {
      consentId: options.consentId,
      purpose: "draft",
      targetId,
    }, { config, now: nowIso });
    return checked.ok ? ok(true) : fail(checked.error.code, checked.error.message);
  }

  async function recoverInterrupted(): Promise<void> {
    const ids = await storage.transaction(async (tx) => {
      const known: string[] = [];
      // Job ids are indexed by matter/target; the storage adapter intentionally has no cross-owner scan.
      return known;
    });
    void ids;
  }

  async function getFromStorage(jobId: string): Promise<StoredGenerationJob | null> {
    return readRecord(jobId);
  }

  async function readIndexed(matterId: string, targetId: string): Promise<IndexRow | null> {
    const raw = await storage.transaction((tx) => tx.get(indexKey(matterId, targetId)));
    if (!isRecord(raw) || raw.kind !== "generation.index" || raw.tenantId !== options.actor.tenantId || raw.actorId !== options.actor.userId) return null;
    return raw as unknown as IndexRow;
  }

  async function recoverJobIfInterrupted(record: StoredGenerationJob): Promise<StoredGenerationJob> {
    if ((record.job.state !== "running" && record.job.state !== "cancel_requested") || record.ownerPageId === pageId) return record;
    await updateRecord(record.job.id, (current) => {
      if (current.ownerPageId === pageId || (current.job.state !== "running" && current.job.state !== "cancel_requested")) return;
      current.fence += 1;
      current.ownerPageId = pageId;
      current.job.state = "interrupted";
      current.job.stage = null;
      current.job.errorCode = "INVALID_TRANSITION";
      current.job.version += 1;
      current.job.progress = { completed: countCompleted(current.stages), total: GENERATE_STAGES.length, unit: "stage" };
      const active = current.stages.find((item) => item.state === "running");
      if (active) active.state = "pending";
      for (const invocation of current.invocations) {
        if (invocation.status === "started") {
          invocation.status = "failed";
          invocation.usageUnknown = true;
        }
      }
      current.errorMessage = "页面在阶段结果保存前中断；可从最后一个已保存阶段继续，或放弃。";
    });
    return (await readRecord(record.job.id)) ?? record;
  }

  async function prepareNewJob(
    matterId: string,
    targetId: string,
    retryOf: StoredGenerationJob | null,
  ): Promise<GenerationOutcome<GenerationJobView>> {
    if (!validateLimits(options.limits)) return fail("JOB_LIMIT_EXCEEDED", "任务限制配置缺失或无效。");
    const consentCheck = await assertConsent(matterId, targetId);
    if (!consentCheck.ok) return consentCheck;
    const input = await currentInput(matterId, targetId);
    if (!input) return fail("RESOURCE_NOT_FOUND", "目标不可用。");
    const inputBytes = new TextEncoder().encode(canonicalJson({ assets: input.context.assets, chunks: input.context.chunks })).length;
    if (Math.ceil(inputBytes / 4) > options.limits.maxInputTokens) return fail("JOB_LIMIT_EXCEEDED", "生成输入超过配置的输入上限。");
    const id = makeJobId(options);
    const createdAt = nowIso();
    if (retryOf && (retryOf.job.payloadHash !== input.inputHash || retryOf.job.baseDraftRevisionId !== input.baseDraftRevisionId)) {
      return fail("INPUT_STALE", "输入或基础修订已变化；失败任务不能以新输入静默重试。");
    }
    let context = clone(input.context);
    let stages = baseStages();
    if (retryOf) {
      context = clone(retryOf.context);
      const nextAttempt = retryOf.job.attempt + 1;
      stages = retryOf.stages.map((item) => {
        const copied = clone(item);
        if (copied.state === "failed") {
          copied.state = "pending";
          copied.errorCode = null;
        }
        if (copied.state === "completed" && copied.metadata) {
          copied.metadata = { ...copied.metadata, jobId: id, attempt: nextAttempt, artifactId: newId("stage-output-artifact") };
        }
        return copied;
      });
    }
    const job: Job = {
      id,
      tenantId: options.actor.tenantId,
      matterId,
      targetId,
      version: 1,
      kind: "generate",
      state: "queued",
      createdBy: options.actor.userId,
      input: input.input,
      baseDraftRevisionId: input.baseDraftRevisionId,
      payloadHash: input.inputHash,
      consentId: execution === "stub" ? null : options.consentId ?? null,
      providerProfileId: selectedProfile.id,
      providerProfileVersion: selectedProfile.version,
      promptVersion: input.promptVersion,
      stageVersion,
      rulePackVersion: pipeline.rulePackVersion,
      stage: null,
      attempt: retryOf ? retryOf.job.attempt + 1 : 0,
      leaseOwner: null,
      leaseExpiresAt: null,
      progress: { completed: countCompleted(stages), total: GENERATE_STAGES.length, unit: "stage" },
      cancelRequestedAt: null,
      resultId: id,
      disposition: "pending",
      errorCode: null,
      usageUnknown: false,
      createdAt,
    };
    const parsedJob = jobSchema.safeParse(job);
    if (!parsedJob.success) return fail("INVALID_INPUT", `任务内容无效：${parsedJob.error.issues[0]?.path.join(".") ?? "job"}`);
    const record: StoredGenerationJob = {
      kind: "generation.job",
      tenantId: options.actor.tenantId,
      actorId: options.actor.userId,
      matterId,
      targetId,
      language: input.language,
      ownerPageId: pageId,
      fence: 1,
      retryOfJobId: retryOf?.job.id ?? null,
      job,
      stages,
      context,
      facts: retryOf ? clone(retryOf.facts) : clone(input.facts),
      liveChunks: retryOf ? clone(retryOf.liveChunks) : clone(input.liveChunks),
      supportIndex: retryOf ? clone(retryOf.supportIndex) : clone(input.supportIndex),
      startedAt: createdAt,
      deadlineAt: new Date(Date.parse(createdAt) + options.limits.maxDurationSeconds * 1000).toISOString(),
      resultAst: null,
      testOutput: execution === "stub",
      errorMessage: null,
      invocations: [],
      adoptionCandidate: null,
      revisionState: null,
    };
    await storage.transaction(async (tx) => {
      const rawIndex = await tx.get(indexKey(matterId, targetId));
      const index = isRecord(rawIndex) && rawIndex.kind === "generation.index"
        && rawIndex.tenantId === options.actor.tenantId && rawIndex.actorId === options.actor.userId
        ? rawIndex as unknown as IndexRow
        : null;
      await tx.put(jobKey(id), record);
      await tx.put(indexKey(matterId, targetId), {
        kind: "generation.index",
        tenantId: options.actor.tenantId,
        actorId: options.actor.userId,
        matterId,
        targetId,
        jobIds: [...(index?.jobIds ?? []), id],
      } satisfies IndexRow);
    });
    setTimeout(() => { void runJob(id, record.fence); }, 0);
    return ok(viewOf(record));
  }

  async function get(jobId: string): Promise<GenerationOutcome<GenerationJobView>> {
    try {
      const record = await getFromStorage(jobId);
      if (!record) return fail("RESOURCE_NOT_FOUND", "任务不可用。");
      const recovered = await recoverJobIfInterrupted(record);
      return ok(viewOf(recovered));
    } catch (error) {
      const failure = normalizeError(error);
      return fail(failure.code, failure.message);
    }
  }

  async function listInvocations(jobId: string): Promise<GenerationOutcome<readonly GenerationInvocation[]>> {
    const record = await readRecord(jobId);
    if (!record) return fail("RESOURCE_NOT_FOUND", "任务不可用。");
    return ok(record.invocations.map((invocation) => ({
      id: invocation.id,
      jobId: invocation.jobId,
      stage: invocation.stage,
      attempt: invocation.attempt,
      providerProfileId: invocation.providerProfileId,
      modelId: invocation.modelId,
      consentId: invocation.consentId,
      requestHash: invocation.requestHash,
      inputTokens: invocation.inputTokens,
      outputTokens: invocation.outputTokens,
      costMinor: invocation.costMinor,
      currency: invocation.currency,
      usageUnknown: invocation.usageUnknown,
      status: invocation.status,
      matterId: invocation.matterId,
      generationStage: invocation.generationStage,
      executionLocation: invocation.executionLocation,
      at: invocation.at,
    })));
  }

  async function list(matterId: string, targetId: string): Promise<GenerationOutcome<readonly GenerationJobView[]>> {
    try {
      const index = await readIndexed(matterId, targetId);
      const jobs: GenerationJobView[] = [];
      for (const jobId of index?.jobIds ?? []) {
        const record = await getFromStorage(jobId);
        if (!record || record.matterId !== matterId || record.targetId !== targetId) continue;
        jobs.push(viewOf(await recoverJobIfInterrupted(record)));
      }
      return ok(jobs.sort((a, b) => b.job.createdAt.localeCompare(a.job.createdAt) || a.job.id.localeCompare(b.job.id)));
    } catch (error) {
      const failure = normalizeError(error);
      return fail(failure.code, failure.message);
    }
  }

  async function cancel(jobId: string): Promise<GenerationOutcome<GenerationJobView>> {
    try {
      const changed = await updateRecord(jobId, (record) => {
        if (record.job.state === "queued") {
          record.job.state = "cancelled";
          record.job.version += 1;
          record.job.errorCode = null;
          record.job.cancelRequestedAt = nowIso();
          const next = record.stages.find((stage) => stage.state === "pending");
          if (next) next.state = "cancelled";
          record.fence += 1;
          for (const invocation of record.invocations) if (invocation.status === "started") { invocation.status = "cancelled"; invocation.usageUnknown = true; }
          return true;
        }
        if (record.job.state !== "running") return false;
        record.job.state = "cancel_requested";
        record.job.version += 1;
        record.job.cancelRequestedAt = nowIso();
        record.fence += 1;
        const active = record.stages.find((stage) => stage.state === "running");
        if (active) active.state = "cancelled";
        for (const invocation of record.invocations) if (invocation.status === "started") { invocation.status = "cancelled"; invocation.usageUnknown = true; }
        record.job.state = "cancelled";
        record.job.version += 1;
        record.job.stage = active?.stage ?? record.job.stage;
        record.job.progress = { completed: countCompleted(record.stages), total: GENERATE_STAGES.length, unit: "stage" };
        return true;
      });
      if (changed !== true) return fail("INVALID_TRANSITION", "任务已结束，不能取消。");
      const record = await readRecord(jobId);
      return record ? ok(viewOf(record)) : fail("RESOURCE_NOT_FOUND", "任务不可用。");
    } catch (error) {
      const failure = normalizeError(error);
      return fail(failure.code, failure.message);
    }
  }

  async function retry(jobId: string): Promise<GenerationOutcome<GenerationJobView>> {
    const previous = await readRecord(jobId);
    if (!previous) return fail("RESOURCE_NOT_FOUND", "任务不可用。");
    if (previous.job.state !== "failed") return fail("INVALID_TRANSITION", "只有失败任务可以重试。");
    if (previous.job.providerProfileId !== selectedProfile.id || previous.job.providerProfileVersion !== selectedProfile.version || previous.job.consentId !== (execution === "stub" ? null : options.consentId ?? null)) {
      return fail("CONSENT_REQUIRED", "重试必须继续使用原处理方和授权配置。");
    }
    return prepareNewJob(previous.matterId, previous.targetId, previous);
  }

  async function resume(jobId: string): Promise<GenerationOutcome<GenerationJobView>> {
    try {
      const previous = await readRecord(jobId);
      if (!previous || previous.job.state !== "interrupted") return fail("INVALID_TRANSITION", "只有中断任务可以继续。");
      const consentCheck = await assertConsent(previous.matterId, previous.targetId);
      if (!consentCheck.ok) {
        await updateRecord(jobId, (record) => {
          record.job.state = "failed";
          record.job.errorCode = consentCheck.error.code as Job["errorCode"];
          record.job.version += 1;
          record.errorMessage = consentCheck.error.message;
        });
        const refused = await readRecord(jobId);
        return refused ? ok(viewOf(refused)) : consentCheck;
      }
      const next = await updateRecord(jobId, (record) => {
        if (record.job.state !== "interrupted") return null;
        record.fence += 1;
        record.ownerPageId = pageId;
        record.job.state = "running";
        // Keep the original start/deadline: resuming must not reset the job's
        // elapsed-time budget.
        record.job.errorCode = null;
        record.job.stage = null;
        record.job.version += 1;
        record.errorMessage = null;
        for (const stage of record.stages) if (stage.state === "failed" || stage.state === "cancelled") stage.state = "pending";
        record.job.progress = { completed: countCompleted(record.stages), total: GENERATE_STAGES.length, unit: "stage" };
        return record.fence;
      });
      if (typeof next !== "number") return fail("INVALID_TRANSITION", "任务已由另一操作更新。");
      const running = await readRecord(jobId);
      if (running) void runJob(jobId, next);
      return running ? ok(viewOf(running)) : fail("RESOURCE_NOT_FOUND", "任务不可用。");
    } catch (error) {
      const failure = normalizeError(error);
      return fail(failure.code, failure.message);
    }
  }

  async function discard(jobId: string): Promise<GenerationOutcome<GenerationJobView>> {
    const changed = await updateRecord(jobId, (record) => {
      if (record.job.disposition === "adopted") return false;
      if (record.job.state !== "interrupted" && record.job.state !== "succeeded" && record.job.state !== "failed" && record.job.state !== "cancelled") return false;
      record.job.disposition = "discarded";
      record.job.version += 1;
      return true;
    });
    if (changed !== true) return fail("INVALID_TRANSITION", "当前任务状态不能放弃。");
    const record = await readRecord(jobId);
    return record ? ok(viewOf(record)) : fail("RESOURCE_NOT_FOUND", "任务不可用。");
  }

  async function getRevision(revisionId: string): Promise<GenerationOutcome<GenerationRevisionView>> {
    try {
      const index = await storage.transaction(async (tx) => {
        const allKeys: string[] = [];
        void allKeys;
        return undefined;
      });
      void index;
      // Revision lookup is bound to a job index to avoid any cross-owner scan.
      const rows = await listJobsForActor();
      for (const job of rows) {
        const stored = await storage.transaction((tx) => tx.get(revisionKey(job.matterId, job.targetId, revisionId)));
        if (!isRecord(stored) || stored.kind !== "generation.revision" || stored.tenantId !== options.actor.tenantId || stored.actorId !== options.actor.userId) continue;
        const parsed = draftRevisionSchema.safeParse(stored.revision);
        if (!parsed.success) return fail("STORAGE_UNAVAILABLE", "草稿修订记录无法读取。");
        return ok({ revision: parsed.data as RevisionRecord<DraftAST>, ast: clone(parsed.data.ast) });
      }
      return fail("RESOURCE_NOT_FOUND", "草稿修订不可用。");
    } catch (error) {
      const failure = normalizeError(error);
      return fail(failure.code, failure.message);
    }
  }

  async function listJobsForActor(): Promise<StoredGenerationJob[]> {
    // Existing index rows are found through the repository's current matters/targets, never by unscoped row enumeration.
    const matters = await options.repository.listMatters(options.actor);
    if (!matters.ok) return [];
    const jobs: StoredGenerationJob[] = [];
    for (const aggregate of matters.data.items) {
      for (const target of aggregate.targets) {
        const index = await readIndexed(aggregate.matter.id, target.id);
        for (const id of index?.jobIds ?? []) {
          const record = await readRecord(id);
          if (record) jobs.push(record);
        }
      }
    }
    return jobs;
  }

  async function buildRevisionState(input: StoredInput): Promise<MatterRevisions<DraftAST> | null> {
    const raw = await storage.transaction((tx) => tx.get(revisionsKey(input.aggregate.matter.id, input.target.id)));
    let state: MatterRevisions<DraftAST>;
    if (isRecord(raw) && raw.kind === "generation.revisions" && isRecord(raw.state)) {
      if (raw.tenantId !== options.actor.tenantId || raw.actorId !== options.actor.userId) return null;
      state = clone(raw.state as unknown as MatterRevisions<DraftAST>);
      const savedTarget = state.targets[input.target.id];
      if (!savedTarget || savedTarget.headRevisionId !== input.target.draftRevisionId) return null;
      return {
        ...state,
        sourceVersion: input.aggregate.matter.sourceVersion,
        targets: {
          ...state.targets,
          [input.target.id]: {
            ...savedTarget,
            status: input.target.status,
            configVersion: input.target.configVersion,
            figureRevisionId: input.target.figureRevisionId,
          },
        },
      };
    }
    if (input.target.draftRevisionId !== null) return null;
    const targetState: TargetRevisions<DraftAST> = {
      targetId: input.target.id,
      status: input.target.status,
      configVersion: input.target.configVersion,
      figureRevisionId: input.target.figureRevisionId,
      figureSets: [],
      headRevisionId: null,
      revisions: [],
    };
    state = { matterId: input.aggregate.matter.id, sourceVersion: input.aggregate.matter.sourceVersion, targets: { [input.target.id]: targetState } };
    return state;
  }

  async function recoverAdoption(record: StoredGenerationJob, input: StoredInput): Promise<GenerationOutcome<AdoptionOutcome> | null> {
    const candidate = record.adoptionCandidate;
    if (!candidate || input.target.draftRevisionId !== candidate.revision.id) return null;
    const events = await options.repository.listEvents(options.actor, record.matterId);
    if (!events.ok) return null;
    if (!events.data.items.some((event) => event.id === candidate.eventId && event.action === "revision.created" && event.resourceId === candidate.revision.id)) return null;
    await storage.transaction(async (tx) => {
      await tx.put(revisionKey(record.matterId, record.targetId, candidate.revision.id), {
        kind: "generation.revision",
        tenantId: options.actor.tenantId,
        actorId: options.actor.userId,
        matterId: record.matterId,
        targetId: record.targetId,
        revision: candidate.revision,
      } satisfies StoredRevision);
      await tx.put(revisionsKey(record.matterId, record.targetId), {
        kind: "generation.revisions",
        tenantId: options.actor.tenantId,
        actorId: options.actor.userId,
        matterId: record.matterId,
        targetId: record.targetId,
        state: candidate.revisionState,
      } satisfies StoredRevisionState);
    });
    await updateRecord(record.job.id, (current) => {
      current.job.disposition = "adopted";
      current.job.version += 1;
      current.adoptionCandidate = candidate;
      current.revisionState = candidate.revisionState;
    });
    const updated = await readRecord(record.job.id);
    return updated ? ok({ status: "adopted", job: viewOf(updated), revision: candidate.revision }, true) : null;
  }

  async function adopt(jobId: string): Promise<GenerationOutcome<AdoptionOutcome>> {
    try {
      let record = await readRecord(jobId);
      if (!record) return fail("RESOURCE_NOT_FOUND", "任务不可用。");
      if (record.job.disposition === "adopted" && record.adoptionCandidate) {
        return ok({ status: "adopted", job: viewOf(record), revision: clone(record.adoptionCandidate.revision) }, true);
      }
      if (record.job.state !== "succeeded" || !record.resultAst || (record.job.disposition !== "ready" && record.job.disposition !== "obsolete_result")) {
        return fail("INVALID_TRANSITION", "任务没有可采纳的完整结果。");
      }
      if (record.testOutput) return fail("CAPABILITY_UNAVAILABLE", "测试输出可预览，但不能作为正式生成修订采纳。");
      const input = await currentInput(record.matterId, record.targetId);
      if (!input) return fail("RESOURCE_NOT_FOUND", "案件或目标不可用。");
      const loadedHead = await revisions.loadHeadRevision(record.matterId, record.targetId);
      if (!loadedHead.ok) return loadedHead;
      const expectedBase = loadedHead.data?.revision.id ?? null;
      const recovered = await recoverAdoption(record, input);
      if (recovered) return recovered;
      if (input.inputHash !== record.job.payloadHash || input.baseDraftRevisionId !== record.job.baseDraftRevisionId
        || expectedBase !== record.job.baseDraftRevisionId) {
        await updateRecord(jobId, (current) => {
          current.job.disposition = "obsolete_result";
          current.job.version += 1;
        });
        record = (await readRecord(jobId))!;
        return ok({ status: "obsolete_result", job: viewOf(record), revision: null });
      }
      const state = await buildRevisionState(input);
      if (!state) {
        await updateRecord(jobId, (current) => { current.job.disposition = "obsolete_result"; current.job.version += 1; });
        record = (await readRecord(jobId))!;
        return ok({ status: "obsolete_result", job: viewOf(record), revision: null });
      }
      const revisionContext: RevisionContext = { newId: (label) => newId(label), now: nowIso, actorId: options.actor.userId };
      const astHash = await canonicalAstHash(record.resultAst);
      const saved = saveRevision(state, {
        targetId: record.targetId,
        baseRevisionId: record.job.baseDraftRevisionId,
        ast: record.resultAst,
        astHash,
        reason: "generated",
        input: input.input,
      }, revisionContext);
      if (!saved.ok) {
        if (saved.error.code === "VERSION_CONFLICT" || saved.error.code === "INPUT_STALE") {
          await updateRecord(jobId, (current) => { current.job.disposition = "obsolete_result"; current.job.version += 1; });
          record = (await readRecord(jobId))!;
          return ok({ status: "obsolete_result", job: viewOf(record), revision: null });
        }
        return fail(saved.error.code, saved.error.message);
      }
      const eventId = newId("revision-created-event");
      const candidate: AdoptionCandidate = {
        revision: saved.revision,
        revisionState: saved.state,
        expectedVersion: input.aggregate.matter.version,
        eventId,
      };
      await updateRecord(jobId, (current) => {
        if (current.job.disposition !== "ready" && current.job.disposition !== "obsolete_result") return;
        current.adoptionCandidate = candidate;
        current.job.version += 1;
      });
      await storage.transaction((tx) => tx.put(revisionKey(record!.matterId, record!.targetId, saved.revision.id), {
        kind: "generation.revision",
        tenantId: options.actor.tenantId,
        actorId: options.actor.userId,
        matterId: record!.matterId,
        targetId: record!.targetId,
        revision: saved.revision,
      } satisfies StoredRevision));
      const event: ActivityRecord = {
        id: eventId,
        tenantId: options.actor.tenantId,
        matterId: record.matterId,
        targetId: record.targetId,
        actorId: options.actor.userId,
        actorKind: "user",
        action: "revision.created",
        snapshot: null,
        jobId,
        resourceId: saved.revision.id,
        occurredAt: nowIso(),
        metadata: { version: input.aggregate.matter.version + 1 },
      };
      const committed = await options.repository.commit(options.actor, {
        contractVersion: CONTRACT_VERSION,
        expectedVersion: input.aggregate.matter.version,
        payload: {
          matter: { ...input.aggregate.matter, version: input.aggregate.matter.version + 1, updatedAt: event.occurredAt },
          targets: input.aggregate.targets.map((target) => target.id === record!.targetId ? { ...target, draftRevisionId: saved.revision.id } : target),
          assets: input.aggregate.assets,
          events: [event],
          blobs: [],
        },
      }, { requestId: eventId });
      if (!committed.ok) {
        if (committed.error.code === "VERSION_CONFLICT") {
          const latest = await currentInput(record.matterId, record.targetId).catch(() => null);
          await updateRecord(jobId, (current) => {
            current.job.disposition = "obsolete_result";
            current.job.version += 1;
            if (latest && latest.target.draftRevisionId === saved.revision.id) current.adoptionCandidate = candidate;
          });
          record = (await readRecord(jobId))!;
          const healed = latest ? await recoverAdoption(record, latest) : null;
          if (healed) return healed;
          return ok({ status: "obsolete_result", job: viewOf(record), revision: null });
        }
        return fail(committed.error.code, committed.error.message);
      }
      await storage.transaction(async (tx) => {
        await tx.put(revisionsKey(record!.matterId, record!.targetId), {
          kind: "generation.revisions",
          tenantId: options.actor.tenantId,
          actorId: options.actor.userId,
          matterId: record!.matterId,
          targetId: record!.targetId,
          state: saved.state,
        } satisfies StoredRevisionState);
        const current = await tx.get(jobKey(jobId));
        if (isRecord(current) && current.kind === "generation.job") {
          const row = current as unknown as StoredGenerationJob;
          row.job.disposition = "adopted";
          row.job.version += 1;
          row.revisionState = saved.state;
          row.adoptionCandidate = candidate;
          await tx.put(jobKey(jobId), row);
        }
      });
      const adopted = await readRecord(jobId);
      return adopted ? ok({ status: "adopted", job: viewOf(adopted), revision: saved.revision }) : fail("RESOURCE_NOT_FOUND", "任务不可用。");
    } catch (error) {
      const failure = normalizeError(error);
      return fail(failure.code, failure.message);
    }
  }

  async function start(matterId: string, targetId: string): Promise<GenerationOutcome<GenerationJobView>> {
    try {
      return await prepareNewJob(matterId, targetId, null);
    } catch (error) {
      const failure = normalizeError(error);
      return fail(failure.code, failure.message);
    }
  }

  const noOperation: GenerationEngine = {
    list,
    get,
    getRevision,
    listInvocations,
    start,
    cancel,
    retry,
    resume,
    discard,
    adopt,
  };
  return noOperation;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isRecord(value)) {
    const result: Record<string, unknown> = {};
    for (const item of Object.keys(value).sort()) if (value[item] !== undefined) result[item] = canonicalize(value[item]);
    return result;
  }
  return value;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

/** The contract's DraftRevision.astHash: SHA-256 of the canonical AST. */
export function canonicalAstHash(ast: DraftAST): Promise<string> {
  return sha256Hex(new TextEncoder().encode(canonicalJson(ast)));
}

function normalizedText(value: string): string {
  // Keep punctuation and operators: "1.5mm" and "15mm" are different values,
  // so they must never normalize to the same statement. Only layout whitespace
  // is removed, and NFKC unifies full-width digits/punctuation.
  return value.normalize("NFKC").toLowerCase().replace(/\s+/gu, "");
}

function textSimilarity(a: string, b: string): number {
  const left = normalizedText(a);
  const right = normalizedText(b);
  if (left.length === 0 || right.length === 0) return 0;
  if (left === right) return 1;
  const bigrams = (value: string) => {
    const result = new Set<string>();
    for (let index = 0; index < value.length - 1; index += 1) result.add(value.slice(index, index + 2));
    return result;
  };
  const aSet = bigrams(left);
  const bSet = bigrams(right);
  let overlap = 0;
  for (const token of aSet) if (bSet.has(token)) overlap += 1;
  return overlap / Math.max(aSet.size, bSet.size);
}

function linkableStatus(status: Fact["status"]): boolean {
  return status === "source_backed" || status === "user_confirmed";
}

/**
 * Very strict provider-fact → snapshot-fact mapping. Exact normalized equality
 * wins; otherwise both a length ratio >= 0.8, whole-statement containment and a
 * bigram score >= 0.92 are required. A weak/partial match returns null.
 */
function bestFactMatch(statement: string, facts: readonly SupportFact[]): SupportFact | null {
  const left = normalizedText(statement);
  if (left.length === 0) return null;
  const candidates = facts.filter((fact) => linkableStatus(fact.status));
  for (const fact of candidates) {
    if (normalizedText(fact.statement) === left) return fact;
  }
  let best: SupportFact | null = null;
  let bestScore = 0;
  for (const fact of candidates) {
    const right = normalizedText(fact.statement);
    if (right.length === 0) continue;
    const ratio = Math.min(left.length, right.length) / Math.max(left.length, right.length);
    if (ratio < 0.8) continue;
    if (!left.includes(right) && !right.includes(left)) continue;
    const score = textSimilarity(statement, fact.statement);
    if (score >= 0.92 && score > bestScore) {
      bestScore = score;
      best = fact;
    }
  }
  return best;
}

/** Validate one persisted SourceRef against the live chunk bytes/locator. */
function validSourceRef(ref: SourceRef, status: Fact["status"], chunks: ReadonlyMap<string, LiveChunk>): boolean {
  if (!linkableStatus(status)) return false;
  const chunk = chunks.get(ref.chunkId);
  if (!chunk) return false;
  if (chunk.sourceId !== ref.sourceId || chunk.hash !== ref.chunkHash) return false;
  if (ref.page !== null && chunk.page !== null && ref.page !== chunk.page) return false;
  if (!Number.isSafeInteger(ref.start) || !Number.isSafeInteger(ref.end)) return false;
  if (ref.start < 0 || ref.end <= ref.start) return false;
  const text = Array.from(chunk.text.normalize("NFC"));
  if (ref.end > text.length) return false;
  const quote = ref.quote.normalize("NFC");
  if (quote.length === 0 || quote !== text.slice(ref.start, ref.end).join("")) return false;
  return true;
}

/**
 * Build the deterministic support index from persisted facts, validated live
 * chunks and (once the facts stage has run) the provider's fact ids. A fact is
 * resolved only when every persisted ref validates: the source/chunk exists,
 * the hash, quote and code-point offsets agree, the page agrees and the fact's
 * persisted status is source_backed/user_confirmed.
 */
function buildSupportIndex(
  facts: readonly Fact[],
  liveChunks: readonly LiveChunk[],
  pipelineFacts: readonly Record<string, unknown>[] = [],
): SupportIndex {
  const chunkById = new Map(liveChunks.map((chunk) => [chunk.id, chunk]));
  const supportFacts: SupportFact[] = facts.map((fact) => {
    const refs = fact.refs.map((ref) => ({ ...ref }));
    const chunkIds = [...new Set(refs.map((ref) => ref.chunkId))].sort();
    const resolved = refs.length > 0 && refs.every((ref) => validSourceRef(ref, fact.status, chunkById));
    return {
      factId: fact.id,
      statement: fact.statement,
      kind: fact.kind,
      status: fact.status,
      refs,
      chunkIds,
      resolved,
    };
  });
  const byChunkId: Record<string, { factId: string; refs: SourceRef[] }[]> = {};
  const addChunk = (chunkId: string, factId: string, refs: readonly SourceRef[]) => {
    if (chunkId.length === 0) return;
    const entries = byChunkId[chunkId] ?? [];
    if (!entries.some((entry) => entry.factId === factId)) entries.push({ factId, refs: refs.map((ref) => ({ ...ref })) });
    byChunkId[chunkId] = entries;
  };
  for (const fact of supportFacts) {
    if (!fact.resolved) continue;
    for (const ref of fact.refs) addChunk(ref.chunkId, fact.factId, fact.refs);
  }
  const pipelineMap: SupportPipelineFact[] = [];
  for (const [index, raw] of pipelineFacts.entries()) {
    const pipelineFactId = typeof raw.id === "string" && raw.id.length > 0 ? raw.id : `pipeline-fact-${index + 1}`;
    const statement = typeof raw.statement === "string" ? raw.statement : "";
    const providerChunkIds = Array.isArray(raw.refs)
      ? raw.refs
        .filter(isRecord)
        .map((ref) => (typeof ref.chunkId === "string" ? ref.chunkId : ""))
        .filter((chunkId) => chunkId.length > 0)
      : [];
    const match = bestFactMatch(statement, supportFacts);
    pipelineMap.push({
      pipelineFactId,
      statement,
      snapshotFactId: match?.factId ?? null,
      chunkIds: [...new Set(providerChunkIds)].sort(),
      resolved: match !== null && match.resolved,
    });
    if (match && match.resolved) {
      for (const chunkId of providerChunkIds) addChunk(chunkId, match.factId, match.refs);
    }
  }
  return {
    schemaVersion: "support.v1",
    facts: supportFacts,
    pipelineFacts: pipelineMap,
    unresolvedFactIds: supportFacts.filter((fact) => !fact.resolved).map((fact) => fact.factId),
    unmappedPipelineFactIds: pipelineMap.filter((fact) => !fact.resolved).map((fact) => fact.pipelineFactId),
    byChunkId,
  };
}

function supportPromptSuffix(support: SupportIndex): string {
  const facts = support.facts.map((fact) => ({
    factId: fact.factId,
    statement: fact.statement,
    kind: fact.kind,
    status: fact.status,
    refs: fact.refs.map((ref) => ({ chunkId: ref.chunkId, page: ref.page, start: ref.start, end: ref.end, quote: ref.quote })),
  }));
  return [
    "",
    "## 确认事实与依据索引（只读；引用事实时必须使用这里的 factId）",
    JSON.stringify({ facts, unresolvedFactIds: support.unresolvedFactIds }, null, 2),
    "生成的权利要求 feature 请给出对应 factId；无法对应时不要编造。",
  ].join("\n");
}

function stageResultSize(value: StageResult): number {
  return new TextEncoder().encode(JSON.stringify(value.output)).length / 4;
}

async function stageMetadata(
  jobId: string,
  stage: GenerateStage,
  result: StageResult,
  inputHash: string,
  attempt: number,
  newId: (label: string) => string,
): Promise<StageOutput> {
  const outputHash = await sha256Hex(new TextEncoder().encode(canonicalJson(result.output)));
  const metadata = {
    jobId,
    stage,
    attempt,
    inputHash,
    outputHash,
    schemaVersion: `v6-17.${stage}.v1`,
    artifactId: newId("stage-output-artifact"),
    completedAt: result.meta.finishedAt,
  } satisfies StageOutput;
  const checked = stageOutputSchema.safeParse(metadata);
  if (!checked.success) throw Object.assign(new Error("阶段检查点元数据无效。"), { code: "INTERNAL_ERROR" });
  return checked.data;
}

function outputFor(results: PipelineContext["results"], stage: string): Record<string, unknown> {
  const output = results[stage as keyof PipelineContext["results"]]?.output;
  return isRecord(output) ? output : {};
}

function supportFactForPipelineId(support: SupportIndex | null, pipelineFactId: unknown): SupportFact | null {
  if (!support || typeof pipelineFactId !== "string") return null;
  const mapped = support.pipelineFacts.find((fact) => fact.pipelineFactId === pipelineFactId);
  if (!mapped || !mapped.resolved || mapped.snapshotFactId === null) return null;
  const fact = support.facts.find((candidate) => candidate.factId === mapped.snapshotFactId) ?? null;
  if (!fact || !fact.resolved || !linkableStatus(fact.status)) return null;
  return fact;
}

function uniqueRefs(refs: readonly SourceRef[]): SourceRef[] {
  const seen = new Set<string>();
  const result: SourceRef[] = [];
  for (const ref of refs) {
    const key = `${ref.sourceId}/${ref.chunkId}/${ref.start}/${ref.end}/${ref.quote}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ ...ref });
  }
  return result;
}

function uniqueIds(ids: readonly string[]): string[] {
  return [...new Set(ids)];
}

function buildDraftAst(
  context: PipelineContext,
  jobId: string,
  language: "zh-CN" | "en-US",
  support: SupportIndex | null,
): DraftAST {
  const claimsOutput = outputFor(context.results, "draft_claims");
  const specOutput = outputFor(context.results, "draft_specification");
  const abstractOutput = outputFor(context.results, "draft_abstract");
  const rawClaims = Array.isArray(claimsOutput.claims) ? claimsOutput.claims.filter(isRecord) : [];
  const claimIds = new Map<number, string>();
  for (const item of rawClaims) if (typeof item.number === "number") claimIds.set(item.number, crypto.randomUUID());
  const claims = rawClaims.map((item) => {
    const claimId = claimIds.get(Number(item.number)) ?? crypto.randomUUID();
    const rawFeatures = Array.isArray(item.features) ? item.features.filter(isRecord) : [];
    const features = rawFeatures.map((feature) => {
      const resolved = supportFactForPipelineId(support, feature.factId);
      const providerStatus = feature.status;
      const providerClaimsSource = providerStatus === "source_backed" || providerStatus === "user_confirmed";
      const status = providerStatus === "unsupported"
        ? "unsupported" as const
        : providerClaimsSource
          ? (resolved ? "supported" as const : "partial" as const)
          : (resolved ? "partial" as const : "partial" as const);
      return {
        id: crypto.randomUUID(),
        text: typeof feature.text === "string" ? feature.text : "未命名特征",
        factIds: resolved ? [resolved.factId] : [],
        supportParagraphIds: [] as string[],
        status,
        sourceRefs: resolved ? resolved.refs : [] as SourceRef[],
      };
    });
    const paragraph = makeParagraph(
      typeof item.text === "string" ? item.text : "",
      jobId,
      uniqueRefs(features.flatMap((feature) => feature.sourceRefs)),
      uniqueIds(features.flatMap((feature) => feature.factIds)),
    );
    return {
      id: claimId,
      number: Number(item.number),
      dependsOn: (Array.isArray(item.parentRefs) ? item.parentRefs : [])
        .map((parent) => claimIds.get(Number(parent)))
        .filter((parent): parent is string => parent !== undefined),
      paragraphs: paragraph ? [paragraph] : [],
      features,
    };
  });
  const sectionByKind = new Map<string, { content: string; chunkIds: string[] }[]>();
  const rawSections = Array.isArray(specOutput.sections) ? specOutput.sections.filter(isRecord) : [];
  for (const section of rawSections) {
    const name = section.section === "figures_desc" ? "figures_description" : section.section;
    if (typeof name !== "string" || typeof section.content !== "string") continue;
    const chunkIds = Array.isArray(section.refs)
      ? section.refs.filter(isRecord).map((ref) => (typeof ref.chunkId === "string" ? ref.chunkId : "")).filter((id) => id.length > 0)
      : [];
    const values = sectionByKind.get(name) ?? [];
    values.push({ content: section.content, chunkIds });
    sectionByKind.set(name, values);
  }
  if (typeof abstractOutput.abstract === "string") {
    sectionByKind.set("abstract", [{ content: abstractOutput.abstract, chunkIds: [] }]);
  }
  const sections = ["technical_field", "background", "summary", "figures_description", "embodiments", "abstract"]
    .filter((kind) => sectionByKind.has(kind))
    .map((kind) => ({
      kind: kind as DraftAST["sections"][number]["kind"],
      paragraphs: (sectionByKind.get(kind) ?? [])
        .map((entry) => {
          const mappings = uniqueIds(entry.chunkIds).flatMap((chunkId) => support?.byChunkId[chunkId] ?? []);
          return makeParagraph(
            entry.content,
            jobId,
            uniqueRefs(mappings.flatMap((mapping) => mapping.refs)),
            uniqueIds(mappings.map((mapping) => mapping.factId)),
          );
        })
        .filter((value): value is NonNullable<typeof value> => value !== null),
    }));

  const allParagraphs = [
    ...claims.flatMap((claim) => claim.paragraphs),
    ...sections.flatMap((section) => section.paragraphs),
  ];
  for (const feature of claims.flatMap((claim) => claim.features)) {
    const supported = allParagraphs.filter((paragraph) =>
      paragraph.factIds.some((factId) => feature.factIds.includes(factId))
      || paragraph.sourceRefs.some((ref) => feature.sourceRefs.some((own) => own.chunkId === ref.chunkId)),
    );
    feature.supportParagraphIds = uniqueIds(supported.map((paragraph) => paragraph.id));
    delete (feature as { sourceRefs?: SourceRef[] }).sourceRefs;
  }
  const candidate = {
    schemaVersion: "draft.v1" as const,
    language: language === "en-US" ? "en-US" as const : "zh-CN" as const,
    title: context.title,
    claims,
    sections,
  };
  const parsed = draftAstSchema.safeParse(candidate);
  if (!parsed.success) throw Object.assign(new Error("生成结果未通过 DraftAST 校验。"), { code: "PROVIDER_SCHEMA_INVALID" });
  return parsed.data;
}

function makeParagraph(text: string, jobId: string, refs: readonly SourceRef[] = [], factIds: readonly string[] = []) {
  if (!text) return null;
  return {
    id: crypto.randomUUID(),
    text,
    origin: "ai" as const,
    sourceRefs: uniqueRefs(refs),
    factIds: uniqueIds(factIds),
    figureIds: [],
    generationJobId: jobId,
  };
}
