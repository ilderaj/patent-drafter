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
  max_tokens?: number;
  /** Ask the bridge to stream the completion (keeps the connection alive on slow stages). */
  stream?: boolean;
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

// Cap the completion (reasoning + content) so a runaway reasoning pass cannot
// hang a stage; the pipeline retries once on schema rejection if a truncation
// ever produces invalid JSON.
const MAX_TOKENS = 16_000;
const POST_TIMEOUT_MS = 240_000;

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
    this.model = options.model ?? "deepseek-v4-flash";
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
    return [{ id: this.model, displayName: "DeepSeek V4 Flash", capabilities: caps, defaultFor: "structured" }];
  }

  async generateStructured<T>(request: StructuredRequest<T>, _schema: Schema<T>): Promise<T> {
    const chatReq: BridgeChatRequest = {
      model: this.model,
      messages: [{ role: "user", content: request.prompt }],
      response_format: { type: "json_object" },
      temperature: request.temperature,
      max_tokens: MAX_TOKENS,
      stream: true,
    };
    let resp: BridgeChatResponse;
    if (this.options.autoConfirm) {
      // Preferred: one round-trip (works when the cloud preview gate is
      // disabled during the validation period). Falls back to the 428 +
      // confirmed-hash flow when the gate is enabled.
      resp = await this.trySendWithGate(chatReq);
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

  private async trySendWithGate(req: BridgeChatRequest): Promise<BridgeChatResponse> {
    let r = await this.post("/api/providers/deepseek/chat", req);
    if (r.status === 428) {
      const body = (await r.json()) as { requiredConfirm?: string };
      if (!body.requiredConfirm) throw new ProviderError("bridge preview response missing requiredConfirm", "UPSTREAM_ERROR");
      r = await this.post("/api/providers/deepseek/chat", req, { "x-preview-confirm": body.requiredConfirm });
    }
    return this.consumeChatResponse(r);
  }

  private async consumeChatResponse(r: Response): Promise<BridgeChatResponse> {
    if (!r.ok) {
      const text = await r.text();
      if (r.status === 401) throw new ProviderError("bridge session invalid or expired", "AUTH_FAILED", true);
      throw new ProviderError(`bridge chat failed (${r.status}): ${text}`, "UPSTREAM_ERROR", r.status >= 500);
    }
    const ct = r.headers.get("content-type") ?? "";
    if (ct.includes("text/event-stream")) {
      const content = await readSseContent(r);
      return { model: this.model, content, provider: "deepseek" };
    }
    return (await r.json()) as BridgeChatResponse;
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
    if (!token) throw new ProviderError("会话缺失：请先解锁（云端）或与本机 Bridge 配对", "AUTH_FAILED");
    const init: RequestInit = {
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
    };
    // One connection-level retry: "Failed to fetch" aborts (edge drops, NAT
    // timeouts) are the failure mode we saw in production; HTTP errors are
    // real answers and are never retried.
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), POST_TIMEOUT_MS);
      try {
        return await fetch(`${this.baseUrl}${path}`, { ...init, signal: ctrl.signal });
      } catch (e) {
        lastError = e;
        if (attempt === 0) {
          // Transient connection failure: retry once.
          await new Promise((res) => setTimeout(res, 800));
          continue;
        }
      } finally {
        clearTimeout(timer);
      }
    }
    throw new ProviderError(
      `bridge unreachable after retry: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
      "UPSTREAM_ERROR",
      true,
    );
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

/**
 * Parse an OpenAI-compatible SSE stream: events are blank-line separated,
 * each "data:" line holds one JSON chunk; "[DONE]" ends the stream. Concatenates
 * delta.content across chunks (reasoning deltas are ignored — only the final
 * content matters for schema parsing).
 */
async function readSseContent(r: Response): Promise<string> {
  const reader = r.body?.getReader();
  if (!reader) throw new ProviderError("bridge stream has no body", "UPSTREAM_ERROR");
  const decoder = new TextDecoder();
  let buf = "";
  let content = "";
  let done = false;
  while (!done) {
    const { value, done: streamDone } = await reader.read();
    if (streamDone) break;
    buf += decoder.decode(value, { stream: true });
    let sep: number;
    while ((sep = buf.indexOf("\n\n")) >= 0) {
      const event = buf.slice(0, sep);
      buf = buf.slice(sep + 2);
      for (const line of event.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data || data === "[DONE]") {
          done = true;
          continue;
        }
        try {
          const chunk = JSON.parse(data) as {
            choices?: Array<{ delta?: { content?: string | null } }>;
          };
          const delta = chunk.choices?.[0]?.delta?.content;
          if (typeof delta === "string") content += delta;
        } catch {
          // Malformed chunk: ignore; the final schema validation still catches
          // a truncated/invalid payload.
        }
      }
      if (done) break;
    }
  }
  return content;
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
