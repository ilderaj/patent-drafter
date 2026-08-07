import type { LLMProvider } from "./llm-provider.js";
import type { ProviderModel, Schema, StreamChunk, StructuredRequest } from "./types.js";

/** Deterministic provider for tests and demo (never contacts a network). */
export class MockProvider implements LLMProvider {
  private readonly canned: unknown;

  constructor(canned: unknown = { ok: true }) {
    this.canned = canned;
  }

  async getCapabilities() {
    return {
      structuredOutput: true,
      tools: false,
      visionInput: false,
      imageGeneration: false,
      longContext: true,
      localAuth: true,
    };
  }

  async listModels(): Promise<ProviderModel[]> {
    return [{ id: "mock", displayName: "Mock", capabilities: await this.getCapabilities() }];
  }

  async generateStructured<T>(_request: StructuredRequest<T>, schema: Schema<T>): Promise<T> {
    const parsed = schema.safeParse(this.canned);
    if (!parsed.success) throw new Error(`MockProvider output rejected by schema: ${String(parsed.error)}`);
    return parsed.data as T;
  }

  async *streamText(): AsyncGenerator<StreamChunk> {
    yield { requestId: "mock", text: JSON.stringify(this.canned), done: true };
  }

  async cancel(_requestId: string): Promise<void> {}
}
