import type { ProviderCapabilities, ProviderModel, Schema, StreamChunk, StructuredRequest, TextRequest } from "./types.js";

/**
 * Provider contract shared by the drafting pipeline (see docs/architecture.md ADR-003).
 */
export interface LLMProvider {
  getCapabilities(): Promise<ProviderCapabilities>;

  /** Discover available models (never hardcode model names in the pipeline). */
  listModels(): Promise<ProviderModel[]>;

  generateStructured<T>(request: StructuredRequest<T>, schema: Schema<T>): Promise<T>;

  streamText(request: TextRequest): AsyncIterable<StreamChunk>;

  cancel(requestId: string): Promise<void>;
}
