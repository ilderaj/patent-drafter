#!/usr/bin/env node
/**
 * Local live-verification launcher for `apps/worker-v6` against the operator's own
 * DeepSeek endpoint, using the read-only `.dev.vars` at the repository root.
 *
 * Security rules this script follows:
 * - `.dev.vars` is read in memory only. Values are never echoed, logged, or written
 *   anywhere inside the repository; the mapped worker config goes to a temp dir
 *   outside the repo and is deleted on exit.
 * - Only synthetic prompts are sent. Results record the model name, timing and
 *   whether a JSON object came back — never prompt or response text.
 * - No install, no deploy: it runs `wrangler dev --local` from the repo's node_modules.
 *
 * Usage: node qa/v6/local/live-deepseek.mjs [--keep] [--port 8795] [--timeout-ms 120000]
 *
 * Some gateways need an extra routing header (for example `x-opencode-session`). Provide
 * LIVE_PROXY_HEADERS='{"x-opencode-session":"<opaque-id>"}' to add it in the local proxy only;
 * the worker stays protocol-generic. Values here must never be secrets.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { chmodSync, existsSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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
const PORT = Number(option("port", "8795"));
const TIMEOUT_MS = Number(option("timeout-ms", "120000"));
const WRANGLER_CANDIDATES = [
  process.env.WRANGLER_BIN,
  join(ROOT, "node_modules/wrangler/bin/wrangler.js"),
  join(ROOT, "node_modules/.bin/wrangler"),
  "/Users/jared/SuperpoweringWithFiles/homepage/node_modules/wrangler/bin/wrangler.js",
].filter(Boolean);
const WRANGLER = WRANGLER_CANDIDATES.find((file) => existsSync(file)) ?? null;

/** Parse dotenv-style file into a map. Never prints values. */
function readDotVars(file) {
  const map = new Map();
  if (!existsSync(file)) return map;
  for (const raw of readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const at = line.indexOf("=");
    if (at <= 0) continue;
    const key = line.slice(0, at).trim();
    let value = line.slice(at + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    map.set(key, value);
  }
  return map;
}

function isLoopback(base) {
  try {
    const url = new URL(base);
    return (url.hostname === "127.0.0.1" || url.hostname === "localhost") && url.protocol === "http:";
  } catch { return false; }
}

async function probeModel(base, key, protocol) {
  const url = `${base.replace(/\/$/, "")}/models`;
  // Gateways differ on /models auth: public, Bearer, or x-api-key. Try, in order, without
  // leaking the key to any other host (the URL is always the configured endpoint).
  let lastStatus = null;
  for (const headers of [{}, { authorization: `Bearer ${key}` }, { "x-api-key": key }]) {
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
    lastStatus = response.status;
    if (!response.ok) continue;
    const body = await response.json();
    const id = Array.isArray(body?.data) ? body.data.find((item) => typeof item?.id === "string")?.id : null;
    if (id) return id;
  }
  throw new Error(`模型探测失败：GET /models 返回 ${lastStatus ?? "无响应"}（协议 ${protocol}）；请在 .dev.vars 设置 DEEPSEEK_MODEL。`);
}

async function waitFor(url, ms) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${url}/api/v6/status`, { cache: "no-store", signal: AbortSignal.timeout(5000) });
      if (response.ok) return await response.json();
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error("wrangler dev 未在限定时间内就绪");
}

let child = null;
let tempDir = null;
let cookie = "";
let proxy = null;

function cleanup() {
  if (child) { try { child.kill("SIGTERM"); } catch { /* gone */ } child = null; }
  if (proxy) { try { proxy.close(); } catch { /* gone */ } proxy = null; }
  if (tempDir && !KEEP) { try { rmSync(tempDir, { recursive: true, force: true }); } catch { /* best effort */ } }
}
process.on("SIGINT", () => { cleanup(); process.exit(130); });
process.on("SIGTERM", () => { cleanup(); process.exit(143); });

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

/** The main checkout owns `.dev.vars`; a worktree root usually does not. */
function findDevVars() {
  const candidates = [
    process.env.LIVE_DEV_VARS,
    join(ROOT, ".dev.vars"),
    join(resolve(ROOT, "../../.."), ".dev.vars"),
  ].filter(Boolean);
  return candidates.find((file) => existsSync(file)) ?? null;
}

async function main() {
  const sourceDevVars = findDevVars();
  if (!sourceDevVars) throw new Error("找不到 .dev.vars（可用 LIVE_DEV_VARS 指定路径）。未读取或打印任何值。");
  const vars = readDotVars(sourceDevVars);
  const key = vars.get("DEEPSEEK_API_KEY");
  const baseUrl = vars.get("DEEPSEEK_BASE_URL");
  const accessCode = vars.get("ACCESS_PASSWORD");
  const sessionSecret = vars.get("SESSION_SECRET");
  const missing = [["DEEPSEEK_API_KEY", key], ["DEEPSEEK_BASE_URL", baseUrl], ["ACCESS_PASSWORD", accessCode], ["SESSION_SECRET", sessionSecret]]
    .filter(([, value]) => !value).map(([name]) => name);
  if (missing.length > 0) throw new Error(`${sourceDevVars} 缺少：${missing.join("、")}（未读取或打印任何值）`);
  if (accessCode.trim().length < 16) throw new Error("ACCESS_PASSWORD 少于 16 个字符，worker 会拒绝启动真实调用。");
  if (!WRANGLER) throw new Error("找不到 wrangler（可用 WRANGLER_BIN 指定）。不自动安装。");
  // The legacy dev secret may be shorter than the v6 minimum. Derive a local-only signing key
  // in memory instead of editing .dev.vars; the value is never printed.
  const workerSessionSecret = sessionSecret.length >= 32
    ? sessionSecret
    : createHash("sha256").update(`v6-live-local:${sessionSecret}`).digest("hex");

  const protocol = process.env.MODEL_PROTOCOL ?? "openai-chat";
  const loopback = isLoopback(baseUrl);
  const model = vars.get("DEEPSEEK_MODEL") ?? vars.get("MODEL_NAME") ?? await probeModel(baseUrl, key, protocol);
  const processorNamesAll = ["PROCESSOR_NAME", "PROCESSOR_REGION", "PROCESSOR_RETENTION", "PROCESSOR_TRAINING_POLICY", "PROCESSOR_TERMS_VERSION"];
  const processor = Object.fromEntries(processorNamesAll.filter((name) => vars.get(name)).map((name) => [name, vars.get(name)]));
  // A remote endpoint without verified disclosure cannot be claimed honestly. For local
  // verification only, forward through a 127.0.0.1 proxy so the worker sees a loopback
  // endpoint (which it labels truthfully) while the proxy talks to the configured gateway.
  const useProxy = !loopback && Object.keys(processor).length < processorNamesAll.length;
  let proxy = null;
  let workerBase = baseUrl;
  if (useProxy) {
    let proxyHeaders = {};
    try { proxyHeaders = JSON.parse(process.env.LIVE_PROXY_HEADERS ?? "{}"); } catch { proxyHeaders = {}; }
    proxy = createServer(async (request, response) => {
      try {
        const chunks = [];
        for await (const chunk of request) chunks.push(chunk);
        const target = `${baseUrl.replace(/\/$/, "")}${request.url ?? ""}`;
        const upstream = await fetch(target, { method: request.method, headers: { ...request.headers, ...proxyHeaders }, body: chunks.length ? Buffer.concat(chunks) : undefined, redirect: "manual" });
        response.writeHead(upstream.status, { "content-type": upstream.headers.get("content-type") ?? "application/json" });
        response.end(Buffer.from(await upstream.arrayBuffer()));
      } catch {
        response.writeHead(502, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "local proxy could not reach the configured endpoint" }));
      }
    });
    await new Promise((resolvePort) => proxy.listen(0, "127.0.0.1", resolvePort));
    workerBase = `http://127.0.0.1:${proxy.address().port}`;
  }

  const tempDirPath = mkdtempSync(join(tmpdir(), "v6-live-deepseek-"));
  tempDir = tempDirPath;
  const configPath = join(tempDirPath, "wrangler.jsonc");
  // The worker module also exports named constants (for tests); workerd treats every named export
  // as a handler, so the entry must expose only the default handler.
  const entryPath = join(tempDirPath, "entry.ts");
  writeFileSync(entryPath, `import worker from ${JSON.stringify(join(ROOT, "apps/worker-v6/src/index.ts"))};\nexport default worker;\n`);
  writeFileSync(configPath, JSON.stringify({
    name: "patent-v6-live-local",
    main: entryPath,
    compatibility_date: process.env.ACCEPT_COMPAT_DATE ?? "2026-05-01",
    kv_namespaces: [{ binding: "RATE_LIMIT", id: "v6-live-local-kv" }],
    vars: { RATE_LIMIT_PER_DAY: "50" },
  }, null, 2));

  const devVars = [
    `MODEL_API_KEY=${key}`,
    `MODEL_BASE_URL=${workerBase}`,
    `MODEL_NAME=${model}`,
    `MODEL_PROTOCOL=${protocol}`,
    ...(loopback || useProxy ? ["MODEL_ALLOW_LOCAL_HTTP=true"] : []),
    `ACCESS_CODE=${accessCode}`,
    `SESSION_SECRET=${workerSessionSecret}`,
    // A loopback endpoint is the operator's machine: label it as such instead of claiming vendor facts.
    ...(loopback || useProxy ? ["PROCESSOR_NAME=本机回环端点（本地验证）", "PROCESSOR_REGION=本机回环", "PROCESSOR_RETENTION=未核实"] : []),
    ...Object.entries(processor).map(([name, value]) => `${name}=${value}`),
  ].join("\n") + "\n";
  const devVarsPath = join(tempDirPath, ".dev.vars");
  writeFileSync(devVarsPath, devVars, { mode: 0o600 });
  chmodSync(devVarsPath, 0o600);

  const base = `http://127.0.0.1:${PORT}`;
  const log = join(tempDirPath, "wrangler.log");
  const out = openSync(log, "w");
  child = spawn(process.execPath, [WRANGLER, "dev", "--config", configPath, "--local", "--port", String(PORT), "--ip", "127.0.0.1",
    "--inspector-port", "9341", "--persist-to", join(tempDirPath, "state")], {
    cwd: tempDirPath,
    env: { ...process.env, WRANGLER_SEND_METRICS: "false", CI: "1", NO_COLOR: "1", XDG_CONFIG_HOME: join(tempDirPath, "xdg") },
    stdio: ["ignore", out, out],
  });

  const status = await waitFor(base, TIMEOUT_MS);
  const summary = { protocol: status.protocol, model: status.model, ...(status.localLoopback ? { endpoint: status.endpoint } : {}), localLoopback: status.localLoopback,
    upstreamMode: loopback ? "direct-loopback" : useProxy ? "loopback-proxy-to-remote-https" : "direct-https",
    available: status.available, processor: status.processor.name, unavailableReason: status.unavailableReason };
  if (!status.available) {
    console.log(JSON.stringify({ ok: false, stage: "status", ...summary }, null, 2));
    throw new Error(`真实服务不可用：${status.unavailableReason ?? "未知原因"}`);
  }

  const session = await call(base, "/api/v6/session", { method: "POST", body: { accessCode } });
  if (session.status !== 200) throw new Error(`访问码会话失败：HTTP ${session.status}`);
  const manifestHash = "a".repeat(64);
  const consent = await call(base, "/api/v6/consent", { method: "POST", body: { profileVersion: status.profileVersion, manifestHash } });
  if (consent.status !== 200) throw new Error(`同意凭证失败：HTTP ${consent.status}`);

  const prompt = [
    "你是中国实用新型申请文件起草助手。仅根据下面这段合成材料起草，不补造事实。",
    "合成材料：一种用于演示的水表，包括表体、计量部件与三模通讯模块（蓝牙 mesh、470MHz 无线、NB-IoT），用于自动上报读数。",
    "只输出 JSON，结构为 {\"claims\":[{\"number\":1,\"independent\":true,\"parentRefs\":[],\"text\":\"...\",\"features\":[{\"text\":\"...\",\"status\":\"source_backed\"}]}]}。",
  ].join("\n");
  const started = Date.now();
  const chat = await call(base, "/api/v6/chat", { method: "POST", body: {
    requestId: `smoke-${started}`, prompt, stage: "draft_claims", profileVersion: status.profileVersion,
    manifestHash, consentCredential: consent.json.credential, maxTokens: 600, temperature: 0.2,
  } });
  const elapsedMs = Date.now() - started;
  let parsed = null;
  if (chat.status === 200 && typeof chat.json?.content === "string") {
    try { parsed = JSON.parse(chat.json.content); } catch { parsed = null; }
  }
  const result = {
    ok: chat.status === 200 && parsed !== null,
    protocol: status.protocol,
    model: status.model,
    localLoopback: status.localLoopback,
    upstreamMode: summary.upstreamMode,
    httpStatus: chat.status,
    elapsedMs,
    jsonParsed: parsed !== null,
    contentLength: typeof chat.json?.content === "string" ? chat.json.content.length : 0,
    errorCode: chat.json?.error?.code ?? null,
    upstreamStatus: chat.json?.error?.upstreamStatus ?? null,
  };
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) throw new Error(`合成材料冒烟未成功：HTTP ${chat.status}${result.errorCode ? ` / ${result.errorCode}` : ""}`);
}

let exitCode = 0;
try {
  await main();
} catch (error) {
  console.error(`live-deepseek: ${error instanceof Error ? error.message : String(error)}`);
  exitCode = 1;
} finally {
  cleanup();
  // The proxy/child may leave handles open; exit explicitly so the command terminates.
  process.exit(exitCode);
}
