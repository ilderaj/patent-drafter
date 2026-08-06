import type { LLMProvider } from "./llm-provider.js";
import { ProviderError } from "./types.js";

/**
 * Reserved for future ChatGPT-subscription flow: the local bridge calls the
 * user's already-signed-in Codex CLI/App Server. NOT implemented in MVP;
 * do not promise or schedule this feature.
 */
export class CodexLocalProvider implements LLMProvider {
  async getCapabilities() {
    return {
      structuredOutput: true,
      tools: true,
      visionInput: true,
      imageGeneration: false,
      longContext: true,
      localAuth: true,
    };
  }

  async listModels() {
    return [];
  }

  async generateStructured<T>(_request: never, _schema: never): Promise<T> {
    throw new ProviderError("CodexLocalProvider reserved, not implemented", "UPSTREAM_ERROR");
  }

  async *streamText(): AsyncIterable<never> {
    throw new ProviderError("CodexLocalProvider reserved, not implemented", "UPSTREAM_ERROR");
  }

  async cancel(_requestId: string): Promise<void> {}
}
