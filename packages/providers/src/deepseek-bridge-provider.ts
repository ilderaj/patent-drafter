import type { LLMProvider } from "./llm-provider.js";
import type { ProviderCapabilities, ProviderModel, Schema, StreamChunk, StructuredRequest, TextRequest } from "./types.js";
import { ProviderError } from "./types.js";

export interface BridgeChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface BridgeChatRequest {
  model?: string;
  messages: BridgeChatMessage[];
  response_format?: { type: "json_object" } | null;
  temperature?: number;
}

export interface BridgeChatResponse {
  model: string;
  content: string;
  provider: string;
  usage?: unknown;
}

export interface PreviewInfo {
  requiredConfirm: string;
  preview: unknown;
}

export interface DeepSeekBridgeProviderOptions {
  baseUrl?: string;
  model?: string;
  /** Returns the current short-lived bridge session token (never the API key). */
  getSessionToken: () => string | null;
  /**
   * Auto-confirm previewed sends. MUST be false in user-facing flows:
   * the UI shows the preview and calls sendConfirmed() after the user agrees.
   * True is allowed only for headless pipeline integration/tests.
   */
  autoConfirm?: boolean;
}

/**
 * MVP provider: talks to the local Patent Bridge (127.0.0.1) only.
 * The bridge owns the DeepSeek API key (OS Keychain) and performs all upstream
 * calls. This class never receives an API key.
 */
export class DeepSeekLocalBridgeProvider implements LLMProvider {
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly options: DeepSeekBridgeProviderOptions;

  constructor(options: DeepSeekBridgeProviderOptions) {
    this.options = options;
    this.baseUrl = options.baseUrl ?? "http://127.0.0.1:7878";
    this.model = options.model ?? "deepseek-chat";
  }

  async getCapabilities(): Promise<ProviderCapabilities> {
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
    const caps = await this.getCapabilities();
    return [{ id: this.model, displayName: "DeepSeek (via local Bridge)", capabilities: caps, defaultFor: "structured" }];
  }

  async generateStructured<T>(request: StructuredRequest<T>, _schema: Schema<T>): Promise<T> {
    const chatReq: BridgeChatRequest = {
      model: this.model,
      messages: [{ role: "user", content: request.prompt }],
      response_format: { type: "json_object" },
      temperature: request.temperature,
    };
    let resp: BridgeChatResponse;
    if (this.options.autoConfirm) {
      const { requiredConfirm } = await this.prepareSend(chatReq);
      resp = await this.sendConfirmed(chatReq, requiredConfirm);
    } else {
      throw new ProviderError(
        "preview confirmation required: call prepareSend() and sendConfirmed() (or enable autoConfirm for headless runs)",
        "NOT_CONFIGURED",
      );
    }
    // Validation is the runner's job (it normalizes ids and retries with the
    // validation error fed back to the model). Return the raw parsed JSON.
    return this.parseJsonContent(resp.content) as T;
  }

  /** Step 1 of the preview gate: bridge returns 428 + requiredConfirm bound to the exact payload. */
  async prepareSend(req: BridgeChatRequest): Promise<PreviewInfo> {
    const r = await this.post("/api/providers/deepseek/chat", req);
    if (r.status === 428) {
      const body = await r.json();
      return { requiredConfirm: body.requiredConfirm, preview: body.preview };
    }
    throw new ProviderError(`unexpected bridge status ${r.status}`, "UPSTREAM_ERROR");
  }

  /** Step 2 of the preview gate: send only with the hash the bridge issued for this payload. */
  async sendConfirmed(req: BridgeChatRequest, requiredConfirm: string): Promise<BridgeChatResponse> {
    const r = await this.post("/api/providers/deepseek/chat", req, { "x-preview-confirm": requiredConfirm });
    if (!r.ok) {
      const text = await r.text();
      if (r.status === 401) throw new ProviderError("bridge session invalid or expired", "AUTH_FAILED", true);
      throw new ProviderError(`bridge chat failed (${r.status}): ${text}`, "UPSTREAM_ERROR", r.status >= 500);
    }
    return (await r.json()) as BridgeChatResponse;
  }

  async *streamText(_request: TextRequest): AsyncGenerator<StreamChunk> {
    throw new ProviderError("streaming not implemented in MVP (structured stages only)", "UPSTREAM_ERROR");
  }

  async cancel(_requestId: string): Promise<void> {}

  private async post(path: string, body: unknown, extraHeaders: Record<string, string> = {}): Promise<Response> {
    const token = this.options.getSessionToken();
    if (!token) throw new ProviderError("bridge session token missing: pair with the local bridge first", "AUTH_FAILED");
    return fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: {
        // Browsers send Origin automatically; non-browser callers must declare
        // an allowed origin for the bridge's origin guard.
        Origin: "https://vibing.paymond.me",
        "Content-Type": "application/json",
        "x-session-token": token,
        ...extraHeaders,
      },
      body: JSON.stringify(body),
    });
  }

  /** DeepSeek may wrap JSON in ```json fences; strip them before schema.parse. */
  private parseJsonContent(content: string): unknown {
    const trimmed = content.trim();
    const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
    const candidate = sanitizeJsonString(fenced ? fenced[1] : trimmed);
    try {
      return JSON.parse(candidate);
    } catch {
      const start = candidate.indexOf("{");
      const end = candidate.lastIndexOf("}");
      if (start >= 0 && end > start) {
        return JSON.parse(candidate.slice(start, end + 1));
      }
      throw new ProviderError(`bridge returned non-JSON content: ${content.slice(0, 200)}`, "INVALID_SCHEMA");
    }
  }
}

/** Models sometimes emit raw control chars inside JSON string literals; escape them. */
function sanitizeJsonString(raw: string): string {
  let out = "";
  let inStr = false;
  let esc = false;
  for (const ch of raw) {
    if (inStr) {
      if (esc) {
        out += ch;
        esc = false;
        continue;
      }
      if (ch === "\\") {
        out += ch;
        esc = true;
        continue;
      }
      if (ch === '"') {
        inStr = false;
        out += ch;
        continue;
      }
      if (ch === "\n" || ch === "\r" || ch === "\t") {
        out += ch === "\n" ? "\\n" : ch === "\r" ? "\\r" : "\\t";
        continue;
      }
      out += ch;
      continue;
    }
    if (ch === '"') inStr = true;
    out += ch;
  }
  return out;
}
