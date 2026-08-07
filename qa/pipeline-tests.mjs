// Pipeline orchestration tests (no network): full 18-stage mock run, caching,
// schema rejection, and intake-pause resume semantics.
import { MockProvider } from "../packages/providers/src/mock-provider.ts";
import { PipelineRunner, PipelineError } from "../packages/pipeline/src/runner.ts";
import { MOCK_STAGE_OUTPUTS, mockPipelineContext } from "../packages/pipeline/src/mock.ts";
import { fileURLToPath } from "node:url";

const PROMPTS_DIR = fileURLToPath(new URL("../packages/prompts", import.meta.url));
const checks = [];
const check = (name, ok, detail = "") => checks.push({ name, ok, detail });

// 1. Full mock run to export.
const ctx = mockPipelineContext();
const runner = new PipelineRunner(new MockProvider({}), {
  promptsDir: PROMPTS_DIR,
  rulePackVersion: "cnipa-2026-01-01",
  promptVersion: "0.1.0",
}, { mockOutputs: MOCK_STAGE_OUTPUTS });

await runner.runUntil(ctx, "export");
const stages = Object.keys(ctx.results).sort();
check("all 18 stages produced results", stages.length === 18, `got ${stages.length}`);

const facts = ctx.results.extract_invention_facts.output;
check("facts carry source refs", facts.facts.every((f) => f.refs.length >= 1));
const claims = ctx.results.draft_claims.output;
check("claims have text and features", claims.claims.every((c) => c.text.length > 0 && c.features.length >= 1));
const spec = ctx.results.draft_specification.output;
const sections = new Set(spec.sections.map((s) => s.section));
check("spec has five-part structure", ["technical_field", "background", "summary", "figures_desc", "embodiments"].every((s) => sections.has(s)));
check("export gate allowed (no unsupported)", ctx.results.export.output.allowed === true);

// 2. Caching: second run does not overwrite results.
const ctx2 = mockPipelineContext("cache-test");
await runner.runUntil(ctx2, "draft_claims");
const before = ctx2.results.draft_claims.meta.finishedAt;
await new Promise((r) => setTimeout(r, 5));
await runner.runUntil(ctx2, "draft_claims");
check("cached stage not re-run", ctx2.results.draft_claims.meta.finishedAt === before);
check("partial run stops at target", Object.keys(ctx2.results).length === 11);

// 3. Intake pause semantics: run to questions, answer, resume to merge.
const ctx3 = mockPipelineContext("intake-test");
await runner.runUntil(ctx3, "generate_intake_questions");
check("runner pauses at intake (no merge yet)", ctx3.results.merge_user_confirmations === undefined);
ctx3.userAnswers = { q1: "通讯模块安装于表体上部，供电来自内置锂电池" };
await runner.runUntil(ctx3, "merge_user_confirmations");
const merge = ctx3.results.merge_user_confirmations.output;
check("answers merged into confirmed facts", merge.updates.some((u) => u.status === "user_confirmed"));

// 4. Schema rejection surfaces as PipelineError.
const ctx4 = mockPipelineContext("schema-test");
const bad = { ...MOCK_STAGE_OUTPUTS, extract_invention_facts: { facts: [{ id: "x", category: "nope" }] } };
const runner4 = new PipelineRunner(new MockProvider({}), {
  promptsDir: PROMPTS_DIR,
  rulePackVersion: "cnipa-2026-01-01",
  promptVersion: "0.1.0",
}, { mockOutputs: bad });
let rejected = false;
try {
  await runner4.runUntil(ctx4, "extract_invention_facts");
} catch (e) {
  rejected = e instanceof PipelineError && e.stage === "extract_invention_facts";
}
check("invalid stage output rejected with stage context", rejected);

let failed = 0;
for (const c of checks) {
  console.log(`${c.ok ? "[PASS]" : "[FAIL]"} ${c.name}${c.ok ? "" : ` — ${c.detail}`}`);
  if (!c.ok) failed++;
}
console.log(`结果: ${checks.length - failed} 通过 / ${failed} 失败`);
process.exit(failed === 0 ? 0 : 1);
