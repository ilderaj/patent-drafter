import type { PipelineStage } from "@patent/domain";
import {
  MockProvider,
  ProviderError,
  type LLMProvider,
  type Schema,
  type StructuredRequest,
} from "@patent/providers";
import {
  MOCK_STAGE_OUTPUTS,
  PipelineRunner,
  STAGE_BY_ID,
  STAGES,
  type PipelineContext,
  type PipelineOptions,
  type StageResult,
} from "@patent/pipeline";

export type PipelinePurpose = "extract" | "draft" | "check" | "ocr";
export type PipelineExecutionMode = "provider" | "stub";

export interface PipelineAuthorizationRequest {
  stage: PipelineStage;
  scopeHash: string;
  providerId: string;
  modelId: string;
  purpose: PipelinePurpose;
}

export type PipelineAuthorizationDecision =
  | { allowed: true }
  | { allowed: false; code?: string; message?: string };

export type PipelineAuthorizer = (
  request: PipelineAuthorizationRequest,
) => PipelineAuthorizationDecision | Promise<PipelineAuthorizationDecision>;

/** Cache seam accepts sync or async storage and must be scoped to one data owner. */
export interface PipelineStageCache {
  get(key: string): unknown | undefined | Promise<unknown | undefined>;
  /** Atomically retain the first value written for this key and return the retained value. */
  putIfAbsent(key: string, value: unknown): unknown | Promise<unknown>;
  /** Remove an invalid or superseded checkpoint. */
  delete(key: string): void | Promise<void>;
}

/** Default cache lifetime is the lifetime of this object; it does not persist across page reloads. */
export class MemoryPipelineStageCache implements PipelineStageCache {
  private readonly values = new Map<string, unknown>();

  get(key: string): unknown | undefined {
    const value = this.values.get(key);
    return value === undefined ? undefined : cloneJson(value);
  }

  putIfAbsent(key: string, value: unknown): unknown {
    if (!this.values.has(key)) this.values.set(key, cloneJson(value));
    return cloneJson(this.values.get(key));
  }

  delete(key: string): void {
    this.values.delete(key);
  }
}

export interface PipelineAdapterOptions {
  /** The provider is used only in `provider` mode. Stub mode never calls it. */
  provider: LLMProvider;
  providerId: string;
  modelId: string;
  purpose: PipelinePurpose;
  stageVersion: string;
  pipeline: PipelineOptions;
  execution?: PipelineExecutionMode;
  authorize?: PipelineAuthorizer;
  /** Tenant/matter namespace for shared caches; defaults to PipelineContext.projectId. */
  cacheScopeId?: string;
  cache?: PipelineStageCache;
  /** Overrides canned outputs for synthetic scenarios; defaults cover every LLM stage. */
  mockOutputs?: Partial<Record<PipelineStage, unknown>>;
  /** The runner uses this clock for stage metadata. */
  now?: () => Date;
}

export interface PipelineAdapterResult {
  context: PipelineContext;
  /** True for the entire run in stub mode; callers must not present it as a real AI result. */
  testOutput: boolean;
}

export class PipelineAdapterError extends Error {
  readonly code: string;
  readonly stage: PipelineStage;
  readonly providerCode?: string;

  constructor(
    stage: PipelineStage,
    code: string,
    message: string,
    options: { cause?: unknown; providerCode?: string } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "PipelineAdapterError";
    this.code = code;
    this.stage = stage;
    this.providerCode = options.providerCode;
  }
}

interface StoredStageResult {
  cacheKey: string;
  stage: PipelineStage;
  outputHash: string;
  result: StageResult;
  upstreamResults: Partial<Record<PipelineStage, { result: StageResult; outputHash: string }>>;
}

interface StageFingerprint {
  cacheKey: string;
  scopeHash: string;
}

const SHA256_PATTERN = /^[0-9a-f]{64}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function canonical(value: unknown): unknown {
  if (typeof value === "string") return value.normalize("NFC");
  if (Array.isArray(value)) return value.map((item) => (item === undefined ? null : canonical(item)));
  if (isRecord(value)) {
    const entries = Object.keys(value)
      .map((key) => [key.normalize("NFC"), key] as const)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const result: Record<string, unknown> = {};
    for (const [normalizedKey, sourceKey] of entries) {
      if (value[sourceKey] !== undefined) result[normalizedKey] = canonical(value[sourceKey]);
    }
    return result;
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new TypeError("Pipeline cache inputs must contain finite numbers.");
  }
  if (typeof value === "bigint" || typeof value === "function" || typeof value === "symbol") {
    throw new TypeError("Pipeline cache inputs must be JSON values.");
  }
  return value;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonical(value));
}

async function sha256(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(value));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function cloneJson<T>(value: T): T {
  return structuredClone(value);
}

function cloneContext(context: PipelineContext): PipelineContext {
  const cloned = cloneJson(context);
  cloned.results = {};
  return cloned;
}

function upstreamStages(stage: PipelineStage): PipelineStage[] {
  const ancestors = new Set<PipelineStage>();
  const visit = (current: PipelineStage): void => {
    const definition = STAGE_BY_ID.get(current);
    if (!definition) return;
    for (const dependency of definition.deps) {
      if (ancestors.has(dependency)) continue;
      ancestors.add(dependency);
      visit(dependency);
    }
  };
  visit(stage);
  return STAGES.filter((definition) => ancestors.has(definition.id)).map((definition) => definition.id);
}

/** Stage handlers have a few reads that `StageDef.inputOf` does not declare. */
function implicitStageInput(stage: PipelineStage, context: PipelineContext): unknown {
  switch (stage) {
    case "ingest_sources":
      return { assets: context.assets, chunks: context.chunks };
    case "merge_user_confirmations":
      return { userAnswers: context.userAnswers };
    case "build_invention_model":
      return { title: context.title };
    default:
      return {};
  }
}

function providerErrorCode(error: ProviderError): string {
  switch (error.code) {
    case "NOT_CONFIGURED":
      return "PROVIDER_UNAVAILABLE";
    case "AUTH_FAILED":
      return "PROVIDER_AUTH";
    case "RATE_LIMITED":
      return "RATE_LIMITED";
    case "TIMEOUT":
      return "PROVIDER_TIMEOUT";
    case "CANCELLED":
      return "INVALID_TRANSITION";
    case "INVALID_SCHEMA":
      return "PROVIDER_SCHEMA_INVALID";
    case "UPSTREAM_ERROR":
      return "PROVIDER_REJECTED";
  }
}

function errorWithCode(value: unknown): { code: string; message?: string } | null {
  if (!isRecord(value) || typeof value.code !== "string") return null;
  return {
    code: value.code,
    message: typeof value.message === "string" ? value.message : undefined,
  };
}

function toAdapterError(value: unknown, stage: PipelineStage): PipelineAdapterError {
  const seen = new Set<unknown>();
  let current: unknown = value;
  while (current !== undefined && current !== null && !seen.has(current)) {
    seen.add(current);
    if (current instanceof PipelineAdapterError) return current;
    if (current instanceof ProviderError) {
      return new PipelineAdapterError(
        stage,
        providerErrorCode(current),
        `Provider failed during stage ${stage} (${providerErrorCode(current)}).`,
        { cause: value, providerCode: current.code },
      );
    }
    const coded = errorWithCode(current);
    if (coded) {
      return new PipelineAdapterError(
        stage,
        coded.code,
        coded.message ?? `Stage ${stage} was refused (${coded.code}).`,
        { cause: value },
      );
    }
    if (current instanceof Error && "cause" in current) {
      current = current.cause;
      continue;
    }
    break;
  }

  const definition = STAGE_BY_ID.get(stage);
  const code = definition?.kind === "llm" ? "PROVIDER_REJECTED" : "INTERNAL_ERROR";
  return new PipelineAdapterError(stage, code, `Stage ${stage} failed (${code}).`, { cause: value });
}

function expectedStageMetadata(
  stage: PipelineStage,
  execution: PipelineExecutionMode,
  options: PipelineAdapterOptions,
): Pick<StageResult["meta"], "provider" | "model" | "promptVersion" | "rulePackVersion"> {
  const llmStage = STAGE_BY_ID.get(stage)?.kind === "llm";
  return {
    provider: !llmStage ? "deterministic" : execution === "stub" ? "mock" : options.providerId,
    model: llmStage && execution === "provider" ? options.modelId : null,
    promptVersion: options.pipeline.promptVersion,
    rulePackVersion: options.pipeline.rulePackVersion,
  };
}

function validRunMeta(
  value: unknown,
  stage: PipelineStage,
  expected: Pick<StageResult["meta"], "provider" | "model" | "promptVersion" | "rulePackVersion">,
): StageResult["meta"] | null {
  if (!isRecord(value) || value.stage !== stage) return null;
  if (
    typeof value.provider !== "string" ||
    !(typeof value.model === "string" || value.model === null) ||
    typeof value.promptVersion !== "string" ||
    typeof value.rulePackVersion !== "string" ||
    typeof value.startedAt !== "string" ||
    typeof value.finishedAt !== "string" ||
    typeof value.ms !== "number" ||
    typeof value.cached !== "boolean"
  ) {
    return null;
  }
  if (
    value.provider !== expected.provider ||
    value.model !== expected.model ||
    value.promptVersion !== expected.promptVersion ||
    value.rulePackVersion !== expected.rulePackVersion
  ) {
    return null;
  }
  return {
    ...(value as unknown as StageResult["meta"]),
    provider: expected.provider,
    model: expected.model,
    promptVersion: expected.promptVersion,
    rulePackVersion: expected.rulePackVersion,
    cached: false,
  };
}

async function readStoredStage(
  value: unknown,
  cacheKey: string,
  stage: PipelineStage,
  options: PipelineAdapterOptions,
  execution: PipelineExecutionMode,
): Promise<StoredStageResult | null> {
  if (!isRecord(value) || value.cacheKey !== cacheKey || value.stage !== stage) return null;
  if (typeof value.outputHash !== "string" || !SHA256_PATTERN.test(value.outputHash) || !isRecord(value.result)) return null;
  if (value.result.stage !== stage) return null;
  const definition = STAGE_BY_ID.get(stage);
  if (!definition) return null;
  const parsed = definition.schema.safeParse(value.result.output);
  const meta = validRunMeta(value.result.meta, stage, expectedStageMetadata(stage, execution, options));
  if (!parsed.success || !meta) return null;
  const outputHash = await sha256(parsed.data);
  if (outputHash !== value.outputHash || !isRecord(value.upstreamResults)) return null;
  const ancestors = new Set(upstreamStages(stage));
  const upstreamResults: Partial<Record<PipelineStage, { result: StageResult; outputHash: string }>> = {};
  for (const [upstreamName, upstreamValue] of Object.entries(value.upstreamResults)) {
    const upstream = upstreamName as PipelineStage;
    if (!ancestors.has(upstream) || !isRecord(upstreamValue) || !isRecord(upstreamValue.result) || upstreamValue.result.stage !== upstream) return null;
    const upstreamDefinition = STAGE_BY_ID.get(upstream);
    if (!upstreamDefinition || !isRecord(upstreamValue.result.meta)) return null;
    const upstreamParsed = upstreamDefinition.schema.safeParse(upstreamValue.result.output);
    const upstreamMeta = validRunMeta(
      upstreamValue.result.meta,
      upstream,
      expectedStageMetadata(upstream, execution, options),
    );
    if (!upstreamParsed.success || !upstreamMeta || typeof upstreamValue.outputHash !== "string" || !SHA256_PATTERN.test(upstreamValue.outputHash)) return null;
    if ((await sha256(upstreamParsed.data)) !== upstreamValue.outputHash) return null;
    upstreamResults[upstream] = {
      outputHash: upstreamValue.outputHash,
      result: {
        stage: upstream,
        output: upstreamParsed.data,
        meta: cloneJson(upstreamMeta),
      },
    };
  }
  return {
    cacheKey,
    stage,
    outputHash,
    result: { stage, output: parsed.data, meta: cloneJson(meta) },
    upstreamResults,
  };
}

function markStageCached(value: StoredStageResult): StoredStageResult {
  const cached = cloneJson(value);
  cached.result.meta.cached = true;
  for (const checkpoint of Object.values(cached.upstreamResults)) {
    if (checkpoint) checkpoint.result.meta.cached = true;
  }
  return cached;
}

function guardedProvider(
  provider: LLMProvider,
  authorize: PipelineAuthorizer | undefined,
  options: PipelineAdapterOptions,
  scopeHash: string,
): LLMProvider {
  return {
    getCapabilities: () => provider.getCapabilities(),
    listModels: () => provider.listModels(),
    async generateStructured<T>(request: StructuredRequest<T>, schema: Schema<T>): Promise<T> {
      const stage = request.stage as PipelineStage;
      // PipelineRunner issues exactly one repair request after schema rejection.
      // The contract requires immediate failure, so stop #1 before authorization
      // or any call into the injected provider.
      if (request.requestId.endsWith(`:${stage}#1`)) {
        throw new ProviderError("schema repair retry is not allowed", "INVALID_SCHEMA");
      }
      if (!authorize) {
        throw new PipelineAdapterError(stage, "RELEASE_GATE_CLOSED", "No provider authorization check is configured.");
      }
      let decision: PipelineAuthorizationDecision;
      try {
        decision = await authorize({
          stage,
          scopeHash,
          providerId: options.providerId,
          modelId: options.modelId,
          purpose: options.purpose,
        });
      } catch (error) {
        const coded = errorWithCode(error);
        throw new PipelineAdapterError(
          stage,
          coded?.code ?? "RELEASE_GATE_CLOSED",
          coded?.message ?? "Provider authorization could not be verified.",
          { cause: error },
        );
      }
      if (!decision.allowed) {
        throw new PipelineAdapterError(
          stage,
          decision.code ?? "RELEASE_GATE_CLOSED",
          decision.message ?? `Provider authorization was refused (${decision.code ?? "RELEASE_GATE_CLOSED"}).`,
        );
      }
      return provider.generateStructured<T>(request, schema);
    },
    streamText: (request) => provider.streamText(request),
    cancel: (requestId) => provider.cancel(requestId),
  };
}

function assertNoAutoConfirm(provider: LLMProvider): void {
  // DeepSeekLocalBridgeProvider keeps this option in its runtime `options` field.
  // Reject the known bypass instead of allowing the bridge to confirm a preview itself.
  const runtimeOptions = Reflect.get(provider as object, "options");
  if (isRecord(runtimeOptions) && runtimeOptions.autoConfirm === true) {
    throw new PipelineAdapterError(
      "ingest_sources",
      "RELEASE_GATE_CLOSED",
      "Provider autoConfirm is not allowed; authorization must be checked by the adapter.",
    );
  }
}

export class PipelineAdapter {
  private readonly options: PipelineAdapterOptions;
  private readonly cache: PipelineStageCache;
  private readonly inFlight = new Map<string, Promise<StoredStageResult>>();
  private readonly execution: PipelineExecutionMode;
  private readonly mockOutputs: Partial<Record<PipelineStage, unknown>>;
  private readonly defaultCacheScopeId?: string;

  constructor(options: PipelineAdapterOptions) {
    this.options = options;
    this.cache = options.cache ?? new MemoryPipelineStageCache();
    this.execution = options.execution ?? "provider";
    this.mockOutputs = { ...MOCK_STAGE_OUTPUTS, ...options.mockOutputs };
    this.defaultCacheScopeId = options.cacheScopeId;
    if (this.execution === "provider") assertNoAutoConfirm(options.provider);
  }

  async run(context: PipelineContext, target: PipelineStage): Promise<PipelineAdapterResult> {
    if (!STAGE_BY_ID.has(target)) {
      throw new PipelineAdapterError(target, "INVALID_INPUT", `Unknown pipeline stage: ${target}.`);
    }
    const working = cloneContext(context);
    const cacheScopeId = this.defaultCacheScopeId ?? context.projectId;
    const prefix = STAGES.slice(0, STAGES.findIndex((definition) => definition.id === target) + 1);
    const outputHashes = new Map<PipelineStage, string>();

    for (const definition of prefix) {
      const fingerprint = await this.fingerprint(definition.id, working, outputHashes, cacheScopeId);
      const cached = await this.readStageCache(definition.id, fingerprint.cacheKey);
      const stageResult = cached ?? (await this.runOrResumeStage(definition.id, fingerprint, working));
      for (const [upstream, checkpoint] of Object.entries(stageResult.upstreamResults)) {
        const upstreamStage = upstream as PipelineStage;
        working.results[upstreamStage] = cloneJson(checkpoint!.result);
        outputHashes.set(upstreamStage, checkpoint!.outputHash);
      }
      working.results[definition.id] = cloneJson(stageResult.result);
      outputHashes.set(definition.id, stageResult.outputHash);
    }

    return { context: working, testOutput: this.execution === "stub" };
  }

  private async readStageCache(stage: PipelineStage, cacheKey: string): Promise<StoredStageResult | null> {
    const raw = await this.cache.get(cacheKey);
    if (raw === undefined) return null;
    const validated = await readStoredStage(raw, cacheKey, stage, this.options, this.execution);
    if (validated) return markStageCached(validated);
    await this.cache.delete(cacheKey);
    return null;
  }

  private async writeStageCache(candidate: StoredStageResult): Promise<StoredStageResult> {
    const first = await this.cache.putIfAbsent(candidate.cacheKey, candidate);
    const validatedFirst = await readStoredStage(
      first,
      candidate.cacheKey,
      candidate.stage,
      this.options,
      this.execution,
    );
    if (validatedFirst) return validatedFirst;

    await this.cache.delete(candidate.cacheKey);
    const second = await this.cache.putIfAbsent(candidate.cacheKey, candidate);
    const validatedSecond = await readStoredStage(
      second,
      candidate.cacheKey,
      candidate.stage,
      this.options,
      this.execution,
    );
    if (validatedSecond) return validatedSecond;

    await this.cache.delete(candidate.cacheKey);
    throw new PipelineAdapterError(
      candidate.stage,
      "INTERNAL_ERROR",
      `Unable to save a valid checkpoint for ${candidate.stage}.`,
    );
  }

  private async fingerprint(
    stage: PipelineStage,
    context: PipelineContext,
    outputHashes: ReadonlyMap<PipelineStage, string>,
    cacheScopeId: string,
  ): Promise<StageFingerprint> {
    const definition = STAGE_BY_ID.get(stage)!;
    const isolatedContext = cloneJson(context);
    const effectiveInput = {
      declared: definition.inputOf(isolatedContext),
      implicit: implicitStageInput(stage, isolatedContext),
    };
    const ancestors = upstreamStages(stage).map((upstream) => {
      const outputHash = outputHashes.get(upstream);
      if (!outputHash) {
        throw new PipelineAdapterError(stage, "INTERNAL_ERROR", `Missing upstream checkpoint for ${upstream}.`);
      }
      return { stage: upstream, outputHash };
    });
    const scopeHash = await sha256({ stage, effectiveInput, upstreamOutputs: ancestors });
    const cacheKey = await sha256({
      cacheScopeId: this.options.cacheScopeId ?? context.projectId,
      stage,
      stageVersion: this.options.stageVersion,
      providerId: this.execution === "stub" ? "stub" : this.options.providerId,
      modelId: this.execution === "stub" ? "stub" : this.options.modelId,
      promptVersion: this.options.pipeline.promptVersion,
      rulePackVersion: this.options.pipeline.rulePackVersion,
      effectiveInput,
      upstreamOutputs: ancestors,
    });
    return { cacheKey, scopeHash };
  }

  private async runOrResumeStage(
    stage: PipelineStage,
    fingerprint: StageFingerprint,
    context: PipelineContext,
  ): Promise<StoredStageResult> {
    const inFlight = this.inFlight.get(fingerprint.cacheKey);
    if (inFlight) return markStageCached(await inFlight);

    const task = this.executeStage(stage, fingerprint, context);
    this.inFlight.set(fingerprint.cacheKey, task);
    try {
      return cloneJson(await task);
    } finally {
      if (this.inFlight.get(fingerprint.cacheKey) === task) this.inFlight.delete(fingerprint.cacheKey);
    }
  }

  private async executeStage(
    stage: PipelineStage,
    fingerprint: StageFingerprint,
    context: PipelineContext,
  ): Promise<StoredStageResult> {
    const pipelineProvider =
      this.execution === "stub"
        ? new MockProvider()
        : guardedProvider(this.options.provider, this.options.authorize, this.options, fingerprint.scopeHash);
    const runner = new PipelineRunner(
      pipelineProvider,
      this.options.pipeline,
      {
        now: this.options.now,
        mockOutputs: this.execution === "stub" ? this.mockOutputs : undefined,
      },
    );

    const runnerContext = cloneJson(context);
    const beforeResults = cloneJson(runnerContext.results);
    try {
      await runner.runUntil(runnerContext, stage);
    } catch (error) {
      throw toAdapterError(error, stage);
    }

    const rawResult = runnerContext.results[stage];
    if (!rawResult) {
      throw new PipelineAdapterError(stage, "INTERNAL_ERROR", `Runner completed without a ${stage} result.`);
    }
    const definition = STAGE_BY_ID.get(stage)!;
    const checked = definition.schema.safeParse(rawResult.output);
    if (!checked.success) {
      throw new PipelineAdapterError(stage, "PROVIDER_SCHEMA_INVALID", `Stage ${stage} output failed schema validation.`);
    }
    const stageIsLlm = definition.kind === "llm";
    const expectedMeta = expectedStageMetadata(stage, this.execution, this.options);
    const normalizedResult: StageResult = {
      stage,
      output: checked.data,
      meta: {
        ...rawResult.meta,
        provider: expectedMeta.provider,
        model: expectedMeta.model,
        promptVersion: expectedMeta.promptVersion,
        rulePackVersion: expectedMeta.rulePackVersion,
        cached: false,
      },
    };
    if (stageIsLlm && this.execution === "stub") normalizedResult.meta.model = null;
    const outputHash = await sha256(normalizedResult.output);
    const upstreamResults: Partial<Record<PipelineStage, { result: StageResult; outputHash: string }>> = {};
    for (const upstream of upstreamStages(stage)) {
      const before = beforeResults[upstream];
      const after = runnerContext.results[upstream];
      if (before && after && canonicalJson(before) !== canonicalJson(after)) {
        const upstreamExpected = expectedStageMetadata(upstream, this.execution, this.options);
        const normalizedUpstream: StageResult = {
          ...cloneJson(after),
          meta: {
            ...after.meta,
            ...upstreamExpected,
            cached: false,
          },
        };
        upstreamResults[upstream] = {
          result: normalizedUpstream,
          outputHash: await sha256(normalizedUpstream.output),
        };
      }
    }
    const candidate: StoredStageResult = {
      cacheKey: fingerprint.cacheKey,
      stage,
      outputHash,
      result: normalizedResult,
      upstreamResults,
    };
    const retained = await this.writeStageCache(candidate);
    return retained;
  }
}

export function createPipelineAdapter(options: PipelineAdapterOptions): PipelineAdapter {
  return new PipelineAdapter(options);
}
