/**
 * Provider capability flags. A provider must declare what it supports;
 * the pipeline never assumes model capabilities.
 */
export interface ProviderCapabilities {
  /** Can return schema-validated structured JSON. */
  structuredOutput: boolean;
  /** Can call tools / functions. */
  tools: boolean;
  /** Can accept image input. */
  visionInput: boolean;
  /** Can generate raster images (DeepSeek: false — figures must use deterministic SVG/Mermaid or user uploads). */
  imageGeneration: boolean;
  /** Supports long context windows (multi-MB source material). */
  longContext: boolean;
  /** Auth is local (OS keychain / local bridge) rather than a server-side key. */
  localAuth: boolean;
}

/** Provider-discovered model descriptor. */
export interface ProviderModel {
  id: string;
  displayName: string;
  capabilities: ProviderCapabilities;
  contextWindowTokens?: number;
  defaultFor?: "structured" | "stream" | null;
}

export interface ProviderConfig {
  /** Provider id, e.g. "deepseek-bridge". */
  providerId: string;
  /** Selected model id; resolved through discovery when omitted. */
  modelId?: string;
  /** Short-lived bridge session token (never the API key). */
  sessionToken?: string;
}

/** Structured generation request. */
export interface StructuredRequest<T> {
  requestId: string;
  prompt: string;
  /** Pipeline stage that issued the request (for provenance). */
  stage?: string;
  promptVersion?: string;
  rulePackVersion?: string;
  /** Optional reference context (source chunks etc.). */
  context?: readonly unknown[];
  temperature?: number;
  maxTokens?: number;
}

/** Streaming text request. */
export interface TextRequest {
  requestId: string;
  prompt: string;
  stage?: string;
  promptVersion?: string;
  rulePackVersion?: string;
  context?: readonly unknown[];
  temperature?: number;
}

/**
 * Structural schema used for validation.
 * Production binds Zod (`z.ZodType<T>`); skeleton stays dependency-free.
 */
export interface Schema<T> {
  parse: (input: unknown) => T;
  safeParse: (input: unknown) => { success: boolean; data?: T; error?: unknown };
}

export interface StreamChunk {
  requestId: string;
  text: string;
  done: boolean;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly code:
      | "NOT_CONFIGURED"
      | "AUTH_FAILED"
      | "RATE_LIMITED"
      | "TIMEOUT"
      | "CANCELLED"
      | "INVALID_SCHEMA"
      | "UPSTREAM_ERROR",
    readonly retryable = false,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}
