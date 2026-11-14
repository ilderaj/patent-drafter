import { z } from "zod";
import { outputJsonSchema } from "./output-schema.ts";
import { ProviderError, type LLMProvider, type ProviderCapabilities, type Schema, type StructuredRequest, type TextRequest, type StreamChunk } from "@patent/providers";

const processorSchema = z.object({ name: z.string(), region: z.string(), retention: z.string(),
  trainingPolicy: z.enum(["no_training", "allowed", "unknown"]), termsVersion: z.string().nullable() });
export const generationStatusSchema = z.object({ available: z.boolean(), configured: z.boolean(), authenticated: z.boolean(),
  model: z.string().nullable(), processor: processorSchema, profileVersion: z.number().int().positive().safe(), unavailableReason: z.string().nullable(),
  sessionId: z.string().regex(/^[0-9a-f]{64}$/).nullable().optional() });
export type GenerationStatus = z.infer<typeof generationStatusSchema>;
export interface RemoteConsentBinding { credential: string; manifestHash: string }
const consentCredentialSchema = z.object({ credential: z.string().min(1), expiresAt: z.string().datetime(), allowedStages: z.array(z.string().min(1)).min(1) });
export type RemoteConsentCredential = z.infer<typeof consentCredentialSchema>;
/** Only call from an explicit user grant action; never from status resolution or beforeCall. */
export async function issueConsentCredential(
  profileVersion: number, manifestHash: string, fetchImpl: typeof fetch = fetch,
): Promise<RemoteConsentCredential> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetchImpl("/api/v6/consent", { method: "POST", credentials: "same-origin", cache: "no-store",
      signal: controller.signal, headers: { "content-type": "application/json" }, body: JSON.stringify({ profileVersion, manifestHash }) });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw httpFailure(response.status, body?.error?.code);
    }
    const parsed = consentCredentialSchema.safeParse(await response.json());
    if (!parsed.success) throw Object.assign(new Error("服务端同意凭证不可读，请重新确认。"), { code: "CONSENT_REQUIRED" });
    return parsed.data;
  } finally { clearTimeout(timer); }
}
export interface RemoteProviderOptions {
  model: string;
  profileVersion: number;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** Must revalidate the current stored consent and live server configuration before each outbound call. */
  beforeCall: () => Promise<RemoteConsentBinding>;
  /** Cancelling a job drops this tab's consent credential; continuing requires another explicit grant. */
  onCancel?: () => void;
}
const capabilities: ProviderCapabilities = Object.freeze({ structuredOutput: true, tools: false, visionInput: false,
  imageGeneration: false, longContext: true, localAuth: false });
/**
 * Map a relay response to a distinct failure kind. `upstreamStatus` is present when the relay
 * reached the model service and that service answered with an error; its number (never its body)
 * is what separates "temporarily down" from "rejected the request / bad configuration".
 */
function httpFailure(status: number, code?: string, upstreamStatus?: number): Error {
  if (code === "PROVIDER_SCHEMA_INVALID") return new ProviderError("模型返回的结构不符合要求。", "INVALID_SCHEMA");
  if (code === "CONSENT_REQUIRED" && status === 409) {
    return Object.assign(new Error("处理方配置已变化，请重新确认外发清单。"), { code: "CONSENT_REQUIRED" });
  }
  if (upstreamStatus !== undefined) {
    if (upstreamStatus === 401 || upstreamStatus === 403) return new ProviderError("模型服务凭据未被接受。", "AUTH_FAILED");
    if (upstreamStatus === 429) return new ProviderError("模型服务请求过多。", "RATE_LIMITED", false);
    if (upstreamStatus === 400) return Object.assign(new Error("请求内容或参数不符合模型要求，请减少材料或检查服务配置。"), { code: "PROVIDER_REQUEST_INVALID" });
    if (upstreamStatus === 408 || upstreamStatus === 504) return new ProviderError("模型服务响应超时。", "TIMEOUT", true);
    if (upstreamStatus >= 500) return new ProviderError("模型服务暂时不可用。", "UPSTREAM_ERROR", true);
    // 3xx (never followed) and other 4xx: the service refused or the endpoint/model configuration is wrong.
    return new ProviderError("模型服务拒绝了请求，或服务配置有误。", "UPSTREAM_ERROR", false);
  }
  if (status === 401 || status === 403) return new ProviderError("访问会话已失效，请重新输入访问码。", "AUTH_FAILED");
  if (status === 429) return new ProviderError("调用次数已达上限，请稍后重试。", "RATE_LIMITED", false);
  if (status === 503) return new ProviderError("真实起草服务当前不可用。", "NOT_CONFIGURED");
  if (status === 504) return new ProviderError("模型响应超时。", "TIMEOUT", true);
  // 502 without an upstream status: the relay could not reach the model service at all.
  return new ProviderError("模型服务暂时无法连接。", "UPSTREAM_ERROR", status >= 500);
}
export async function readGenerationStatus(fetchImpl: typeof fetch = fetch, signal?: AbortSignal): Promise<GenerationStatus> {
  const response = await fetchImpl("/api/v6/status", { credentials: "same-origin", cache: "no-store", signal });
  if (!response.ok) throw httpFailure(response.status);
  try { return generationStatusSchema.parse(await response.json()); }
  catch { throw new ProviderError("无法读取真实起草服务状态。", "NOT_CONFIGURED"); }
}
export async function createGenerationSession(accessCode: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetchImpl("/api/v6/session", { method: "POST", credentials: "same-origin", cache: "no-store",
      signal: controller.signal, headers: { "content-type": "application/json" }, body: JSON.stringify({ accessCode }) });
    if (!response.ok) throw httpFailure(response.status);
    const value = z.object({ authenticated: z.literal(true), expiresAt: z.string().datetime() }).safeParse(await response.json());
    if (!value.success) throw new ProviderError("访问会话未能建立。", "AUTH_FAILED");
  } finally { clearTimeout(timer); }
}
export class RemoteGenerationProvider implements LLMProvider {
  private readonly options: RemoteProviderOptions;
  private readonly active = new Map<string, AbortController>();
  private cancelled = false;
  constructor(options: RemoteProviderOptions) { this.options = options; }
  async getCapabilities() { return capabilities; }
  async listModels() { return [{ id: this.options.model, displayName: this.options.model, capabilities, defaultFor: "structured" as const }]; }
  async generateStructured<T>(request: StructuredRequest<T>, schema: Schema<T>): Promise<T> {
    if (this.cancelled) throw Object.assign(new Error("本次起草已取消，请重新确认外发清单后开始新任务。"), { code: "CONSENT_REQUIRED" });
    if (this.active.has(request.requestId)) throw new ProviderError("同一阶段正在请求中。", "UPSTREAM_ERROR");
    const controller = new AbortController();
    this.active.set(request.requestId, controller);
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, this.options.timeoutMs ?? 95_000);
    try {
      const consent = await this.options.beforeCall();
      if (controller.signal.aborted) throw new ProviderError("请求已取消。", "CANCELLED");
      if (!consent?.credential || !/^[0-9a-f]{64}$/.test(consent.manifestHash)) {
        throw Object.assign(new Error("请先明确确认外发清单。"), { code: "CONSENT_REQUIRED" });
      }
      const response = await (this.options.fetchImpl ?? fetch)("/api/v6/chat", { method: "POST", credentials: "same-origin", cache: "no-store",
        signal: controller.signal, headers: { "content-type": "application/json" }, body: JSON.stringify({
          requestId: request.requestId,
          prompt: `${request.prompt}\n\n最终输出结构以此处实际阶段 JSON Schema 为准（不输出额外字段）：\n${JSON.stringify(outputJsonSchema(schema as unknown as z.ZodTypeAny))}`,
          context: request.context,
          stage: request.stage, maxTokens: request.maxTokens, temperature: request.temperature, profileVersion: this.options.profileVersion,
          manifestHash: consent.manifestHash, consentCredential: consent.credential,
        }) });
      if (!response.ok) {
        // Read only a recognized code; never include arbitrary response text in errors/logs.
        const body = await response.json().catch(() => null);
        throw httpFailure(response.status, body?.error?.code, body?.error?.upstreamStatus);
      }
      const body = z.object({ content: z.string() }).safeParse(await response.json());
      if (!body.success) throw new ProviderError("模型返回的结构不符合要求。", "INVALID_SCHEMA");
      let value: unknown;
      try { value = JSON.parse(body.data.content); }
      catch { throw new ProviderError("模型没有返回有效的 JSON。", "INVALID_SCHEMA"); }
      const checked = schema.safeParse(value);
      if (!checked.success) throw new ProviderError("模型输出未通过阶段结构校验。", "INVALID_SCHEMA");
      return checked.data as T;
    } catch (error) {
      if (controller.signal.aborted) throw new ProviderError(timedOut ? "模型响应超时。" : "请求已取消。", timedOut ? "TIMEOUT" : "CANCELLED", timedOut);
      if (error instanceof ProviderError || (error instanceof Error && "code" in error)) throw error;
      throw new ProviderError("无法连接真实起草服务。", "UPSTREAM_ERROR", true);
    } finally {
      clearTimeout(timer);
      this.active.delete(request.requestId);
    }
  }
  async *streamText(_request: TextRequest): AsyncIterable<StreamChunk> {
    throw new ProviderError("此起草服务仅支持结构化阶段输出。", "NOT_CONFIGURED");
  }
  async cancel(requestId: string): Promise<void> {
    this.cancelled = true;
    this.active.get(requestId)?.abort();
    this.options.onCancel?.();
  }
}
