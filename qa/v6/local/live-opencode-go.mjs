#!/usr/bin/env node
/**
 * Local live-verification against OpenCode Go through apps/worker-v6/src/index.ts.
 *
 * - Reads ~/.config/magpie/providers.json (id === "opencode-go") or OPENCODE_GO_API_KEY in memory only.
 *   The key is never printed, logged, or written inside the repository.
 * - Starts `wrangler dev --local` with a temp config outside the repo; cleans up on exit.
 * - Runs with MODEL_ALLOW_UNDISCLOSED_DEV=true so status marks devUndisclosed=true. Synthetic data only.
 *
 * Usage:
 *   node qa/v6/local/live-opencode-go.mjs [--base-url https://opencode.ai/inference/go/v1]
 *        [--model hy4-flash-free] [--protocol openai-chat] [--full]
 *        [--port 8797] [--timeout-ms 120000] [--job-timeout-ms 900000] [--keep]
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../../..");
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const option = (name, fallback) => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 ? argv[index + 1] : fallback;
};

const KEEP = flag("keep");
const FULL = flag("full");
const PORT = Number(option("port", "8797"));
const TIMEOUT_MS = Number(option("timeout-ms", "120000"));
const JOB_TIMEOUT_MS = Number(option("job-timeout-ms", "900000"));
const BASE_URL = option("base-url", "https://opencode.ai/inference/go/v1");
const MODEL = option("model", "hy4-flash-free");
const PROTOCOL = option("protocol", "openai-chat");
const WRANGLER = [
  process.env.WRANGLER_BIN,
  join(ROOT, "node_modules/wrangler/bin/wrangler.js"),
  "/Users/jared/SuperpoweringWithFiles/homepage/node_modules/wrangler/bin/wrangler.js",
].filter(Boolean).find((file) => existsSync(file)) ?? null;

let child = null;
let tempDir = null;
let cookie = "";

function cleanup() {
  if (child) { try { child.kill("SIGTERM"); } catch { /* gone */ } child = null; }
  if (tempDir && !KEEP) { try { rmSync(tempDir, { recursive: true, force: true }); } catch { /* best effort */ } }
}
process.on("SIGINT", () => { cleanup(); process.exit(130); });
process.on("SIGTERM", () => { cleanup(); process.exit(143); });

function readOpenCodeGoKey() {
  if (process.env.OPENCODE_GO_API_KEY && process.env.OPENCODE_GO_API_KEY.trim()) {
    return process.env.OPENCODE_GO_API_KEY.trim();
  }
  const file = process.env.MAGPIE_PROVIDERS ?? join(homedir(), ".config/magpie/providers.json");
  if (!existsSync(file)) throw new Error("找不到 Magpie providers.json（可用 OPENCODE_GO_API_KEY 或 MAGPIE_PROVIDERS 指定）。");
  const raw = JSON.parse(readFileSync(file, "utf8"));
  const list = Array.isArray(raw) ? raw : Array.isArray(raw?.providers) ? raw.providers : [];
  const provider = list.find((item) => (item?.id ?? item?.name) === "opencode-go");
  if (!provider?.key) throw new Error("provider opencode-go 不存在或没有 key。");
  return provider.key;
}

async function call(base, path, { method = "GET", body } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { origin: base, ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const setCookie = response.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];
  return { status: response.status, json: await response.json().catch(() => null) };
}

async function waitFor(base, ms) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${base}/api/v6/status`, { cache: "no-store", signal: AbortSignal.timeout(5000) });
      if (response.ok) return await response.json();
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error("wrangler dev 未在限定时间内就绪");
}

async function startWorker({ key, base, model, protocol, accessCode, sessionSecret }) {
  tempDir = mkdtempSync(join(tmpdir(), "v6-live-opencode-go-"));
  const entryPath = join(tempDir, "entry.ts");
  writeFileSync(entryPath, `import worker from ${JSON.stringify(join(ROOT, "apps/worker-v6/src/index.ts"))};\nexport default worker;\n`);
  const configPath = join(tempDir, "wrangler.jsonc");
  writeFileSync(configPath, JSON.stringify({
    name: "patent-v6-opencode-go-local",
    main: entryPath,
    compatibility_date: process.env.ACCEPT_COMPAT_DATE ?? "2026-05-01",
    kv_namespaces: [{ binding: "RATE_LIMIT", id: "v6-opencode-go-local-kv" }],
    vars: { RATE_LIMIT_PER_DAY: "300" },
  }, null, 2));
  const devVars = [
    `MODEL_API_KEY=${key}`,
    `MODEL_BASE_URL=${base}`,
    `MODEL_NAME=${model}`,
    `MODEL_PROTOCOL=${protocol}`,
    "MODEL_DISABLE_REASONING=true",
    "MODEL_ALLOW_UNDISCLOSED_DEV=true",
    `ACCESS_CODE=${accessCode}`,
    `SESSION_SECRET=${sessionSecret}`,
  ].join("\n") + "\n";
  const devVarsPath = join(tempDir, ".dev.vars");
  writeFileSync(devVarsPath, devVars, { mode: 0o600 });
  chmodSync(devVarsPath, 0o600);
  const log = join(tempDir, "wrangler.log");
  const out = openSync(log, "w");
  child = spawn(process.execPath, [WRANGLER, "dev", "--config", configPath, "--local", "--port", String(PORT), "--ip", "127.0.0.1",
    "--inspector-port", "9343", "--persist-to", join(tempDir, "state")], {
    cwd: tempDir,
    env: { ...process.env, WRANGLER_SEND_METRICS: "false", CI: "1", NO_COLOR: "1", XDG_CONFIG_HOME: join(tempDir, "xdg") },
    stdio: ["ignore", out, out],
  });
  return `http://127.0.0.1:${PORT}`;
}

async function simpleChat(workerBase, accessCode, model) {
  const status = await waitFor(workerBase, TIMEOUT_MS);
  const session = await call(workerBase, "/api/v6/session", { method: "POST", body: { accessCode } });
  if (session.status !== 200) throw new Error(`访问码会话失败：HTTP ${session.status}`);
  const manifestHash = "a".repeat(64);
  const consent = await call(workerBase, "/api/v6/consent", { method: "POST", body: { profileVersion: status.profileVersion, manifestHash } });
  if (consent.status !== 200) throw new Error(`同意凭证失败：HTTP ${consent.status}`);
  const started = Date.now();
  const chat = await call(workerBase, "/api/v6/chat", { method: "POST", body: {
    requestId: `smoke-${started}`, stage: "draft_claims", profileVersion: status.profileVersion, manifestHash,
    consentCredential: consent.json.credential, maxTokens: 800, temperature: 0.2,
    prompt: "仅根据合成材料输出 JSON：{\"claims\":[{\"number\":1,\"independent\":true,\"parentRefs\":[],\"text\":\"一种水表，包括表体、计量部件和三模通讯模块。\",\"features\":[{\"text\":\"三模通讯模块\",\"status\":\"source_backed\"}]}]}。合成材料：一种水表，包括表体、计量部件与三模通讯模块。",
  } });
  const parsed = chat.json?.content ? (() => { try { JSON.parse(chat.json.content); return true; } catch { return false; } })() : false;
  return {
    protocol: status.protocol,
    model,
    endpoint: status.endpoint,
    devUndisclosed: status.devUndisclosed,
    httpStatus: chat.status,
    elapsedMs: Date.now() - started,
    jsonParsed: parsed,
    errorCode: chat.json?.error?.code ?? null,
    reason: chat.json?.error?.reason ?? null,
    upstreamStatus: chat.json?.error?.upstreamStatus ?? null,
  };
}

async function fullGeneration(workerBase, accessCode) {
  const { register } = await import("tsx/esm/api");
  register();
  const importFrom = (relative) => import(`${ROOT}/${relative}`);
  const { createFixture, ACTOR, MATTER_ID, TARGET_ID, T0 } = await importFrom("qa/v6/scenarios/V6-17/harness.mjs");
  const { ingestFiles } = await importFrom("apps/web/src/v6/features/sources/ingest.ts");
  const { parseSource } = await importFrom("apps/web/src/v6/features/sources/parse.ts");
  const { targetConfigKey } = await importFrom("apps/web/src/v6/features/targets/targets.ts");
  const { resolveGenerationRuntime } = await importFrom("apps/web/src/v6/features/generation/runtime.ts");
  const { createGenerationEngine } = await importFrom("apps/web/src/v6/features/generation/generation.ts");

  const fixture = await createFixture({ withFacts: true });
  const writeId = crypto.randomUUID();
  await fixture.backend.transaction("readwrite", async (tx) => {
    const aggregate = await tx.get("matters", MATTER_ID);
    aggregate.matter.title = "合成验收：水表远程抄表";
    await tx.put("matters", MATTER_ID, aggregate);
    await tx.put("events", writeId, { id: writeId, tenantId: ACTOR.tenantId, matterId: MATTER_ID, targetId: TARGET_ID, action: "target.created", metadata: { version: 1 }, occurredAt: T0 });
    await tx.put("blobs", targetConfigKey(ACTOR.tenantId, MATTER_ID, TARGET_ID, 1, writeId), {
      kind: "target.config", tenantId: ACTOR.tenantId, matterId: MATTER_ID, targetId: TARGET_ID, at: T0,
      config: { targetId: TARGET_ID, version: 1, route: "cn_um", language: "zh-CN", purpose: "preparation", applicantIds: [], inventorIds: [], priorityClaims: [] },
    });
  });
  const text = "合成交底材料：一种用于远程抄表的水表，包括表体、计量部件、控制单元与三模通讯模块（蓝牙 mesh、470MHz 无线、NB-IoT）。控制单元按设定周期读取计量部件读数并通过任一可用通讯方式上报；网络不可用时本地缓存并在恢复后补传。";
  const file = new Blob([new TextEncoder().encode(text)], { type: "text/plain" });
  Object.defineProperty(file, "name", { value: "synthetic-disclosure.txt" });
  const [saved] = await ingestFiles(fixture.repository, ACTOR, MATTER_ID, [file], { now: () => new Date(T0) });
  if (saved?.status !== "saved") throw new Error(`合成材料保存失败：${saved?.status ?? "unknown"}`);
  const parsed = await parseSource(fixture.repository, ACTOR, MATTER_ID, saved.assetId, { now: () => new Date(T0).toISOString() });
  if (!parsed.ok) throw new Error(`合成材料解析失败：${parsed.errorCode ?? "unknown"}`);

  const chatStatuses = [];
  const chatErrors = [];
  const fetchImpl = async (url, init = {}) => {
    const target = String(url).startsWith("http") ? String(url) : `${workerBase}${url}`;
    const response = await fetch(target, { ...init, headers: { ...(init.headers ?? {}), origin: workerBase, ...(cookie ? { cookie } : {}) } });
    if (String(url).includes("/api/v6/chat")) {
      chatStatuses.push(response.status);
      if (!response.ok) {
        response.clone().json().then((body) => chatErrors.push({
          status: response.status,
          code: body?.error?.code ?? null,
          upstreamStatus: body?.error?.upstreamStatus ?? null,
          reason: body?.error?.reason ?? null,
        })).catch(() => {});
      }
    }
    const setCookie = response.headers.get("set-cookie");
    if (setCookie) cookie = setCookie.split(";")[0];
    return response;
  };
  const login = await call(workerBase, "/api/v6/session", { method: "POST", body: { accessCode } });
  if (login.status !== 200) throw new Error(`访问码会话失败：HTTP ${login.status}`);
  const promptDir = join(ROOT, "packages/prompts");
  const promptNames = ["system-core.md", "extract-facts.md", "detect-conflicts.md", "readiness.md", "intake.md",
    "patent-strategy.md", "claim-skeleton.md", "draft-claims.md", "draft-specification.md", "figure-spec.md",
    "draft-abstract.md", "audit-support.md", "audit-consistency.md", "audit-formal-rules.md"];
  const prompts = Object.fromEntries(promptNames.map((name) => [name, readFileSync(join(promptDir, name), "utf8")]));
  const runtime = await resolveGenerationRuntime(fixture.repository, ACTOR, MATTER_ID, TARGET_ID, {
    fetchImpl, loadPrompts: async () => prompts,
  });
  if (runtime.mode !== "real") throw new Error(`真实模式不可用：${runtime.unavailableReason ?? "unknown"}`);
  if (runtime.devUndisclosed !== true) throw new Error("status 未标记 devUndisclosed，拒绝在未披露处理方上继续。");
  const granted = await runtime.consent.grant();
  const engine = createGenerationEngine({ ...granted.engineOptions, repository: fixture.repository, actor: ACTOR, storage: fixture.storage, now: () => new Date() });
  const startedAt = Date.now();
  let jobId = null;
  let done = null;
  let attempts = 0;
  const retryable = new Set(["PROVIDER_UNAVAILABLE", "PROVIDER_TIMEOUT", "RATE_LIMITED"]);
  while (attempts <= 2) {
    const begun = jobId === null ? await engine.start(MATTER_ID, TARGET_ID) : await engine.retry(jobId);
    if (!begun.ok) throw new Error(`任务${jobId === null ? "启动" : "重试"}失败：${begun.error.code}`);
    jobId = begun.data.job.id;
    const attemptStart = Date.now();
    while (Date.now() - attemptStart < JOB_TIMEOUT_MS) {
      const view = await engine.get(jobId);
      if (view.ok && ["succeeded", "failed", "cancelled", "interrupted"].includes(view.data.job.state)) { done = view.data; break; }
      await new Promise((r) => setTimeout(r, 1000));
    }
    if (!done) throw new Error("任务超时未结束");
    if (done.job.state === "succeeded" || !retryable.has(done.job.errorCode ?? "")) break;
    attempts += 1;
    if (attempts > 2) break;
  }
  const invocations = await engine.listInvocations(jobId);
  let adopted = null;
  if (done.job.state === "succeeded") {
    const result = await engine.adopt(jobId);
    adopted = result.ok ? result.data.revision.testOutput ?? false : `adopt-failed:${result.error.code}`;
  }
  return {
    jobState: done.job.state,
    errorCode: done.job.errorCode,
    retries: attempts,
    stages: done.stages.map((s) => s.state),
    chatStatuses,
    chatErrors,
    chatRequests: chatStatuses.length,
    chatSucceeded: chatStatuses.filter((status) => status === 200).length,
    invocationsLastJob: invocations.ok ? invocations.data.length : null,
    costMinor: invocations.ok ? invocations.data.map((i) => i.costMinor) : null,
    usageUnknown: invocations.ok ? invocations.data.every((i) => i.usageUnknown) : null,
    elapsedMs: Date.now() - startedAt,
    adoptedTestOutput: adopted,
  };
}

async function main() {
  if (!WRANGLER) throw new Error("找不到 wrangler（可用 WRANGLER_BIN 指定）。不自动安装。");
  const key = readOpenCodeGoKey();
  const accessCode = `live-${createHash("sha256").update(`access:${Date.now()}`).digest("hex").slice(0, 24)}`;
  const sessionSecret = createHash("sha256").update(`session:${Date.now()}:${key.length}`).digest("hex");
  const workerBase = await startWorker({ key, base: BASE_URL, model: MODEL, protocol: PROTOCOL, accessCode, sessionSecret });
  const status = await waitFor(workerBase, TIMEOUT_MS);
  if (!status.available) throw new Error(`真实服务不可用：${status.unavailableReason ?? "unknown"}`);
  if (status.devUndisclosed !== true) throw new Error("status 未标记 devUndisclosed");

  const summary = {
    provider: "opencode-go",
    protocol: status.protocol,
    model: MODEL,
    baseUrl: BASE_URL,
    endpoint: status.endpoint,
    endpointKind: "remote-https",
    devUndisclosed: status.devUndisclosed,
  };
  const result = FULL ? await fullGeneration(workerBase, accessCode) : await simpleChat(workerBase, accessCode, MODEL);
  const output = { ok: FULL ? result.jobState === "succeeded" : (result.httpStatus === 200 && result.jsonParsed), ...summary, ...result };
  console.log(JSON.stringify(output, null, 2));
  if (!output.ok) throw new Error(FULL ? `生成任务未成功：${result.jobState}/${result.errorCode ?? ""}` : `冒烟未成功：HTTP ${result.httpStatus} (jsonParsed=${result.jsonParsed})`);
}

let exitCode = 0;
try {
  await main();
} catch (error) {
  console.error(`live-opencode-go: ${error instanceof Error ? error.message : String(error)}`);
  exitCode = 1;
} finally {
  cleanup();
  process.exit(exitCode);
}
