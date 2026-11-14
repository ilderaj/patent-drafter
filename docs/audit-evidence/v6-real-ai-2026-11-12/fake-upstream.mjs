#!/usr/bin/env node
/**
 * Local fake upstream for the V6 real-AI link acceptance.
 *
 * OpenAI-compatible `POST /v1/chat/completions` returning *synthetic* structured
 * outputs per pipeline stage. Every drafted sentence carries 「合成验收输出」.
 * This validates the status -> session -> consent -> chat chain; it says nothing
 * about real model quality or a real provider.
 *
 * Fault injection: POST /__control {"mode": "...", "times": n}
 *   ok | rate_limit(429) | unavailable(503) | timeout(hang) | invalid_json | empty | schema_violation
 * GET /__stats   -> counters and per-request metadata (never bodies)
 * POST /__reset  -> clear counters and faults
 *
 * Bodies are never logged or stored. Only metadata (stage, byte counts, flags) is.
 * Usage: node fake-upstream.mjs --port 9911 --key <synthetic key> [--log file]
 *        [--sentinel NAME=value]... [--forbid NAME=value]... [--latency-ms 150]
 */
import http from "node:http";
import { appendFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback; };
const all = (name) => args.flatMap((value, i) => value === `--${name}` ? [args[i + 1]] : []);
const PORT = Number(opt("port", "9911"));
const KEY = opt("key", "");
const LOG = opt("log", "");
const LATENCY = Number(opt("latency-ms", "150"));
const MARK = "【合成验收输出】";
// Strings that SHOULD reach upstream (user material) / MUST NOT (credentials). Only booleans are recorded.
const sentinels = Object.fromEntries(all("sentinel").map((v) => { const i = v.indexOf("="); return [v.slice(0, i), v.slice(i + 1)]; }));
const forbidden = Object.fromEntries(all("forbid").map((v) => { const i = v.indexOf("="); return [v.slice(0, i), v.slice(i + 1)]; }));
if (!KEY) { console.error("--key is required"); process.exit(2); }
if (LOG) writeFileSync(LOG, "");
const log = (line) => { const text = `${new Date().toISOString()} ${line}`; if (LOG) appendFileSync(LOG, `${text}\n`); };

const state = { total: 0, byStage: {}, byMode: {}, authFailures: 0, fault: { mode: "ok", times: Infinity }, requests: [] };

function stageOf(prompt) {
  const match = /#\s*阶段：([a-z_]+)/.exec(prompt);
  return match ? match[1] : "unknown";
}
function inputOf(prompt) {
  const start = prompt.indexOf("## 输入上下文");
  if (start < 0) return {};
  const from = prompt.indexOf("\n", start) + 1;
  const end = prompt.indexOf("\n\n直接输出符合本阶段 schema", from);
  try { return JSON.parse(prompt.slice(from, end < 0 ? undefined : end)); } catch { return {}; }
}
const clip = (text, n) => Array.from(String(text ?? "").replace(/\s+/g, " ").trim()).slice(0, n).join("");

/** Schema-valid synthetic outputs; chunk/fact ids come from the stage input so references stay real. */
function synthesize(stage, input) {
  const chunks = Array.isArray(input.chunks) ? input.chunks : [];
  const facts = Array.isArray(input.facts) ? input.facts : [];
  const factIds = facts.map((f) => f.id).filter(Boolean);
  const firstFact = factIds[0] ?? "f1";
  const secondFact = factIds[1] ?? firstFact;
  const chunkRefs = facts.flatMap((f) => Array.isArray(f.refs) ? f.refs : []).map((r) => r.chunkId).filter(Boolean);
  const chunkId = chunkRefs[0] ?? chunks[0]?.id;
  const subject = clip(facts[0]?.statement ?? chunks[0]?.text ?? "本申请的换热装置", 30);
  switch (stage) {
    case "extract_invention_facts": {
      const usable = chunks.filter((c) => c && c.id && String(c.text ?? "").trim());
      const categories = ["subject", "structure", "effect", "parameter"];
      return { facts: usable.slice(0, 4).map((c, i) => ({
        category: categories[i % categories.length],
        statement: clip(c.text, 36),
        status: "source_backed",
        refs: [{ chunkId: c.id, ...(Number.isInteger(c.page) && c.page > 0 ? { page: c.page } : {}), quote: clip(c.text, 12) }],
        ...(i === 0 ? { patentTypeHint: "utility_model" } : {}),
      })) };
    }
    case "detect_conflicts": return { conflicts: [] };
    case "assess_readiness": return { readiness: "partial", coverage: 0.7,
      dimensions: [{ name: "subject", status: "ok", reason: `${MARK}保护主题已在材料中出现` }, { name: "parameter", status: "gap", reason: `${MARK}缺少具体参数来源` }],
      gaps: [{ id: "g1", kind: "parameter_source", description: `${MARK}参数需人工补充来源` }] };
    case "generate_intake_questions": return { questions: [] };
    case "propose_claim_strategy": return { protectionCore: [`${MARK}${subject}`], dependentExtensions: [`${MARK}流道结构的进一步限定`], exclusions: [], riskNotes: [`${MARK}仅为链路验收的合成内容`] };
    case "draft_claim_skeleton": return { claims: [
      { number: 1, independent: true, parentRefs: [], features: [{ text: `${MARK}${subject}`, factId: firstFact, status: "source_backed" }] },
      { number: 2, independent: false, parentRefs: [1], features: [{ text: `${MARK}流道结构`, factId: secondFact, status: "source_backed" }] }] };
    case "draft_claims": return { claims: [
      { number: 1, independent: true, parentRefs: [], text: `1、${MARK}一种换热装置，包括流道结构，其特征在于，所述流道结构用于降低流动阻力。`,
        features: [{ text: `${MARK}流道结构`, factId: firstFact, status: "source_backed" }] },
      { number: 2, independent: false, parentRefs: [1], text: `2、根据权利要求1所述的换热装置，其特征在于，${MARK}仅保留一套管路。`,
        features: [{ text: `${MARK}一套管路`, factId: secondFact, status: "source_backed" }] }] };
    case "draft_specification": {
      const ref = chunkId ? [{ chunkId }] : [];
      return { sections: [
        { section: "technical_field", content: `${MARK}本实用新型涉及换热技术领域。`, refs: ref },
        { section: "background", content: `${MARK}现有换热装置在低温环境下效率较低。`, refs: ref },
        { section: "summary", content: `${MARK}本实用新型通过改进流道结构降低流动阻力。`, refs: ref },
        { section: "figures_desc", content: `${MARK}图1为整体结构示意图。`, refs: [] },
        { section: "embodiments", content: `${MARK}实施例中，换热装置包括流道结构并仅保留一套管路。`, refs: ref }] };
    }
    case "generate_figure_specs": return { figures: [{ kind: "structure", title: `${MARK}整体结构图`, notes: "合成", refs: chunkId ? [{ chunkId }] : [] }],
      numerals: [{ numeral: "1", label: "流道结构", usedIn: ["claims", "spec", "figure"] }] };
    case "draft_abstract": return { abstract: `${MARK}本实用新型公开一种换热装置，通过流道结构降低流动阻力。`, abstractFigureNumeral: "1" };
    case "audit_support": return { findings: [{ ruleId: "SYN-SUP-001", severity: "info", message: `${MARK}特征均有合成来源`, remediation: "无需处理" }] };
    case "audit_consistency": return { findings: [{ ruleId: "SYN-CON-001", severity: "info", message: `${MARK}术语一致`, remediation: "无需处理" }] };
    case "audit_formal_rules": return { findings: [{ ruleId: "SYN-FRM-001", severity: "info", message: `${MARK}形式项合成通过`, remediation: "无需处理" }] };
    default: return { note: `${MARK}未识别的阶段` };
  }
}

function readBody(request, max = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    request.on("data", (c) => { size += c.length; if (size > max) { reject(new Error("too large")); request.destroy(); } else chunks.push(c); });
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}
const send = (res, status, body, headers = {}) => {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", ...headers });
  res.end(text);
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  try {
    if (req.method === "GET" && url.pathname === "/__stats") return send(res, 200, { ...state, fault: { mode: state.fault.mode, times: state.fault.times === Infinity ? "unbounded" : state.fault.times } });
    if (req.method === "POST" && url.pathname === "/__reset") {
      Object.assign(state, { total: 0, byStage: {}, byMode: {}, authFailures: 0, fault: { mode: "ok", times: Infinity }, requests: [] });
      return send(res, 200, { ok: true });
    }
    if (req.method === "POST" && url.pathname === "/__control") {
      const body = JSON.parse(await readBody(req));
      const allowed = ["ok", "rate_limit", "unavailable", "timeout", "invalid_json", "empty", "schema_violation", "redirect", "unauthorized"];
      if (!allowed.includes(body.mode)) return send(res, 400, { error: "unknown mode" });
      state.fault = { mode: body.mode, times: Number.isInteger(body.times) && body.times > 0 ? body.times : Infinity };
      log(`control mode=${body.mode} times=${state.fault.times}`);
      return send(res, 200, { ok: true });
    }
    if (req.method === "GET" && url.pathname === "/__health") return send(res, 200, { ok: true });
    if (req.method !== "POST" || url.pathname !== "/v1/chat/completions") return send(res, 404, { error: { message: "not found" } });

    const raw = await readBody(req);
    const authOk = req.headers.authorization === `Bearer ${KEY}`;
    const seq = ++state.total;
    if (!authOk) { state.authFailures += 1; log(`#${seq} auth=bad`); return send(res, 401, { error: { message: "unauthorized" } }); }
    let prompt = "";
    let parsed = null;
    try { parsed = JSON.parse(raw); prompt = String(parsed?.messages?.[0]?.content ?? ""); } catch { /* handled below */ }
    const stage = stageOf(prompt);
    const mode = state.fault.mode;
    if (state.fault.times !== Infinity && mode !== "ok") { state.fault.times -= 1; if (state.fault.times <= 0) state.fault = { mode: "ok", times: Infinity }; }
    const meta = {
      seq, at: new Date().toISOString(), stage, mode, authOk, requestBytes: Buffer.byteLength(raw),
      model: typeof parsed?.model === "string" ? parsed.model : null, stream: parsed?.stream ?? null,
      responseFormat: parsed?.response_format?.type ?? null,
      carried: Object.fromEntries(Object.entries(sentinels).map(([k, v]) => [k, raw.includes(v)])),
      leaked: Object.fromEntries(Object.entries(forbidden).map(([k, v]) => [k, raw.includes(v)])),
    };
    state.byStage[stage] = (state.byStage[stage] ?? 0) + 1;
    state.byMode[mode] = (state.byMode[mode] ?? 0) + 1;
    state.requests.push(meta);
    if (state.requests.length > 400) state.requests.shift();
    log(`#${seq} stage=${stage} mode=${mode} bytes=${meta.requestBytes}`);

    if (mode === "rate_limit") return send(res, 429, { error: { message: "rate limited" } }, { "retry-after": "1" });
    if (mode === "redirect") return send(res, 302, "", { location: "http://127.0.0.1:9/redirected" });
    if (mode === "unauthorized") return send(res, 401, { error: { message: "unauthorized" } });
    if (mode === "unavailable") return send(res, 503, { error: { message: "unavailable" } });
    if (mode === "timeout") { await new Promise((resolve) => { const t = setTimeout(resolve, 125_000); req.on("close", () => { clearTimeout(t); resolve(); }); }); return res.destroyed ? undefined : res.end(); }
    await new Promise((resolve) => setTimeout(resolve, LATENCY));
    const wrap = (content) => send(res, 200, { id: `syn-${seq}`, object: "chat.completion", choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content } }], usage: null });
    if (mode === "invalid_json") return wrap("这不是 JSON（合成验收的非法输出）");
    if (mode === "empty") return wrap("");
    if (mode === "schema_violation") return wrap(JSON.stringify({ unexpected: true }));
    return wrap(JSON.stringify(synthesize(stage, inputOf(prompt))));
  } catch (error) {
    log(`error ${error?.message ?? "unknown"}`);
    if (!res.headersSent) send(res, 500, { error: { message: "fake upstream error" } });
  }
});
server.listen(PORT, "127.0.0.1", () => { console.log(`fake-upstream listening on http://127.0.0.1:${PORT}`); log("listening"); });
process.on("SIGTERM", () => server.close(() => process.exit(0)));
process.on("SIGINT", () => server.close(() => process.exit(0)));
