import type { LLMProvider } from "./llm-provider.js";
import { ProviderError } from "./types.js";

/**
 * MVP provider: talks to the local Patent Bridge (127.0.0.1) only.
 * The bridge owns the DeepSeek API key (OS Keychain) and performs all
 * upstream calls. This class must never receive an API key.
 *
 * NOTE: skeleton only — transport (pairing token, CORS/PNA) lands with
 * apps/bridge in the approved implementation phase.
 */
export class DeepSeekLocalBridgeProvider implements LLMProvider {
  constructor(private readonly bridgeBaseUrl = "http://127.0.0.1:17341") {}

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

  async listModels() {
    // Placeholder: real discovery happens through the bridge /api/capabilities.
    return [];
  }

  async generateStructured<T>(_request: never, _schema: never): Promise<T> {
    throw new ProviderError("DeepSeekLocalBridgeProvider not implemented until bridge phase", "UPSTREAM_ERROR");
  }

  async *streamText(): AsyncIterable<never> {
    throw new ProviderError("DeepSeekLocalBridgeProvider not implemented until bridge phase", "UPSTREAM_ERROR");
  }

  async cancel(_requestId: string): Promise<void> {
    // no-op until implemented
  }
}
