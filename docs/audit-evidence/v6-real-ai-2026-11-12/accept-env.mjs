#!/usr/bin/env node
/**
 * Local real-mode acceptance environment (not product code, never deployed).
 *
 * Starts, all on loopback:
 *   - fake-upstream.mjs            synthetic OpenAI-compatible upstream
 *   - wrangler dev --local x N     apps/worker-v6 (via worker-wrapper.ts) + the built web assets
 *       full          configured + disclosed -> status available, needs access code
 *       unconfigured  no model/secret config  -> status configured=false (test-mode fallback)
 *       undisclosed   configured, no processor disclosure -> status available=false
 *
 * Secrets are one-time synthetic values generated at start; config/.dev.vars/KV state live in a
 * temp directory outside the repo and are removed on exit (use --keep to retain).
 *
 *   node accept-env.mjs [--build] [--assets DIR] [--state FILE] [--base-port 8791] [--keep]
 *                       [--redirect-workaround]   dry-run only; formal acceptance must NOT use it
 *
 * Prints READY and writes the state JSON once every instance answers GET /api/v6/status.
 */
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { closeSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../../..");
const WRANGLER = process.env.WRANGLER_BIN ?? "/Users/jared/SuperpoweringWithFiles/homepage/node_modules/wrangler/bin/wrangler.js";
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name, fallback) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : fallback; };

const BASE_PORT = Number(opt("base-port", "8791"));
const UPSTREAM_PORT = Number(opt("upstream-port", "9911"));
const keep = flag("keep");
const tmp = mkdtempSync(join(tmpdir(), "v6-real-ai-"));
const stateFile = resolve(opt("state", join(tmp, "state.json")));
const children = [];
const rand = (n) => randomBytes(n).toString("hex");

const secrets = {
  modelKey: `syn-key-${rand(12)}`,
  accessCode: process.env.ACCEPT_ACCESS_CODE || `syn-acc-${rand(6)}`,
  sessionSecret: process.env.ACCEPT_SESSION_SECRET || rand(32),
  // Present only in the uploaded fixture; used to prove material reaches upstream and nothing else leaks.
  materialSentinel: "SENTINEL-MATERIAL-7c3f91aa",
};

function cleanup(code = 0) {
  for (const child of children) { try { child.kill("SIGTERM"); } catch { /* already gone */ } }
  setTimeout(() => {
    if (!keep) { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ } }
    process.exit(code);
  }, 1200);
}
process.on("SIGINT", () => cleanup(0));
process.on("SIGTERM", () => cleanup(0));

// ---- assets ---------------------------------------------------------------------------------
let assets = opt("assets", "");
let buildInfo = { source: "existing" };
// Build by default: the repo's apps/web/dist/v6 is a release artifact and goes stale quickly.
if (!assets || flag("build")) {
  assets = join(tmp, "dist-v6");
  const result = spawnSync("npx", ["vite", "build"], {
    cwd: join(REPO, "apps/web"), encoding: "utf8",
    env: { ...process.env, V6_WEB_BASE: "/", V6_WEB_OUTDIR: assets, VITE_CACHE_DIR: join(tmp, "vite-cache") },
  });
  writeFileSync(join(tmp, "build.log"), `${result.stdout}\n${result.stderr}`);
  if (result.status !== 0) { console.error("web build failed; see", join(tmp, "build.log")); cleanup(1); }
  for (const name of ["_headers", "_redirects"]) {
    const from = join(REPO, "apps/web/v6-deploy", name);
    if (existsSync(from)) copyFileSync(from, join(assets, name));
  }
  buildInfo = { source: "fresh-build", log: join(tmp, "build.log") };
}
assets = resolve(assets);
if (!existsSync(join(assets, "index.html"))) { console.error(`no index.html under ${assets}; run with --build`); cleanup(1); }
const indexHash = createHash("sha256").update(readFileSync(join(assets, "index.html"))).digest("hex");
const git = (...a) => spawnSync("git", a, { cwd: REPO, encoding: "utf8" }).stdout.trim();
const newestSource = spawnSync("find", [join(REPO, "apps/web/src"), join(REPO, "packages"), "-type", "f", "-newer", join(assets, "index.html")], { encoding: "utf8" }).stdout.trim();
if (newestSource) console.warn("WARNING: web sources are newer than the served assets; the bundle may be stale.");
buildInfo = { ...buildInfo, staleSourceFiles: newestSource ? newestSource.split("\n").length : 0, assets, indexSha256: indexHash, assetFiles: readdirSync(join(assets, "assets")).length,
  indexMtime: statSync(join(assets, "index.html")).mtime.toISOString(), gitHead: git("rev-parse", "--short", "HEAD"),
  dirtyPaths: git("status", "--short").split("\n").filter(Boolean).length };

// ---- fake upstream --------------------------------------------------------------------------
const upstreamLog = join(tmp, "fake-upstream.log");
const upstreamOut = openSync(join(tmp, "fake-upstream.stdout.log"), "w");
// Answer-only path: the two technical answers must reach upstream; the three personal answers must not.
secrets.answer1 = "现有换热装置在低温环境下效率低，运行成本高。";
secrets.answer2 = "本方案改进流道结构以降低流动阻力，并保留一套管路。";
secrets.localInventor = "V6 验收用发明人（合成）";
secrets.localDisclosure = "公开活动或展会";
secrets.localMaturity = "已有测试样品";
children.push(spawn(process.execPath, [
  join(HERE, "fake-upstream.mjs"), "--port", String(UPSTREAM_PORT), "--key", secrets.modelKey, "--log", upstreamLog,
  "--sentinel", `material=${secrets.materialSentinel}`,
  "--sentinel", `answer1=${secrets.answer1}`, "--sentinel", `answer2=${secrets.answer2}`,
  "--forbid", `inventor=${secrets.localInventor}`, "--forbid", `disclosure=${secrets.localDisclosure}`,
  "--forbid", `maturity=${secrets.localMaturity}`,
  "--forbid", `accessCode=${secrets.accessCode}`, "--forbid", `sessionSecret=${secrets.sessionSecret}`,
], { stdio: ["ignore", upstreamOut, upstreamOut] }));

// ---- wrangler instances ---------------------------------------------------------------------
const profiles = [
  { name: "full", configured: true, disclosed: true },
  { name: "unconfigured", configured: false, disclosed: false },
  { name: "undisclosed", configured: true, disclosed: false },
];
const state = { startedAt: new Date().toISOString(), tmp, secrets, redirectWorkaround: flag("redirect-workaround"), build: buildInfo, wrangler: WRANGLER,
  upstream: { url: `http://127.0.0.1:${UPSTREAM_PORT}`, log: upstreamLog }, instances: {} };

profiles.forEach((profile, index) => {
  const dir = join(tmp, profile.name);
  mkdirSync(dir, { recursive: true });
  const port = BASE_PORT + index;
  const vars = {
    RATE_LIMIT_PER_DAY: "500",
    ...(flag("redirect-workaround") ? { ACCEPT_REDIRECT_WORKAROUND: "1" } : {}),
    ACCEPT_UPSTREAM_ORIGIN: `http://127.0.0.1:${UPSTREAM_PORT}`,
    ...(profile.configured ? { MODEL_BASE_URL: "https://fake-upstream.acceptance.invalid/v1", MODEL_NAME: "synthetic-accept-model-1" } : {}),
    ...(profile.disclosed ? {
      PROCESSOR_NAME: "合成验收处理方（本地假上游）", PROCESSOR_REGION: "本机回环（合成验收）", PROCESSOR_RETENTION: "不保留（合成验收值，非真实承诺）",
      PROCESSOR_TRAINING_POLICY: "no_training", PROCESSOR_TERMS_VERSION: "synthetic-accept-v1",
    } : {}),
  };
  writeFileSync(join(dir, "wrangler.jsonc"), JSON.stringify({
    name: `patent-v6-accept-${profile.name}`,
    main: join(HERE, "worker-wrapper.ts"),
    // The deployed config uses 2026-08-01; the local workerd binary only supports up to 2026-05-14.
    compatibility_date: process.env.ACCEPT_COMPAT_DATE ?? "2026-05-01",
    assets: { directory: assets, binding: "ASSETS", run_worker_first: ["/api/v6/*", "/"], not_found_handling: "single-page-application" },
    kv_namespaces: [{ binding: "RATE_LIMIT", id: `accept-local-${profile.name}` }],
    vars,
  }, null, 2));
  const devVars = profile.configured
    ? `MODEL_API_KEY=${secrets.modelKey}\nACCESS_CODE=${secrets.accessCode}\nSESSION_SECRET=${secrets.sessionSecret}\n` : "";
  writeFileSync(join(dir, ".dev.vars"), devVars, { mode: 0o600 });
  const log = join(dir, "wrangler.log");
  const out = openSync(log, "w");
  children.push(spawn(process.execPath, [
    WRANGLER, "dev", "--config", join(dir, "wrangler.jsonc"), "--local", "--port", String(port), "--ip", "127.0.0.1",
    "--inspector-port", String(9331 + index), "--persist-to", join(dir, "state"),
  ], {
    cwd: dir,
    env: { ...process.env, WRANGLER_SEND_METRICS: "false", CI: "1", NO_COLOR: "1", WRANGLER_LOG_PATH: join(dir, "logs"), XDG_CONFIG_HOME: join(dir, "xdg") },
    stdio: ["ignore", out, out],
  }));
  state.instances[profile.name] = { url: `http://127.0.0.1:${port}`, port, dir, wranglerLog: log, vars: Object.keys(vars), hasSecrets: profile.configured };
});

// ---- wait for readiness ---------------------------------------------------------------------
async function ready(url, timeoutMs = 150000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${url}/api/v6/status`, { cache: "no-store" });
      if (response.ok) return await response.json();
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 700));
  }
  throw new Error(`timeout waiting for ${url}`);
}
try {
  const up = await fetch(`${state.upstream.url}/__health`).catch(() => null);
  if (!up) await new Promise((r) => setTimeout(r, 800));
  for (const [name, instance] of Object.entries(state.instances)) {
    const status = await ready(instance.url);
    instance.initialStatus = { available: status.available, configured: status.configured, authenticated: status.authenticated, model: status.model, hasUnavailableReason: !!status.unavailableReason };
    console.log(`${name.padEnd(13)} ${instance.url}  configured=${status.configured} available=${status.available}`);
  }
  writeFileSync(stateFile, JSON.stringify(state, null, 2), { mode: 0o600 });
  console.log(`READY state=${stateFile}`);
} catch (error) {
  console.error("startup failed:", error.message);
  cleanup(1);
}
// Keep the process alive until signalled.
setInterval(() => {}, 1 << 30);
