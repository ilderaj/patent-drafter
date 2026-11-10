/**
 * V6-17 UI — five-stage states, true progress, stale/error recovery, stub and
 * empty states render from the same view model the engine produces.
 */
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../../../..");
const SOURCE = join(ROOT, "apps/web/src/v6/features/generation/Generation.tsx");
let outdir;
let ui;

before(async () => {
  outdir = mkdtempSync(join(tmpdir(), "v6-17-bundle-"));
  const outfile = join(outdir, "generation.cjs");
  const harness = `
    import { renderToStaticMarkup } from "react-dom/server";
    import { GenerationPanel, GenerationViewPanel, generationView } from ${JSON.stringify(SOURCE)};
    export function renderPanel(props) { return renderToStaticMarkup(<GenerationPanel {...props} />); }
    export function renderView(props) { return renderToStaticMarkup(<GenerationViewPanel {...props} />); }
    export function makeView(...args) { return generationView(...args); }
  `;
  await esbuild.build({
    stdin: { contents: harness, resolveDir: ROOT, sourcefile: "v6-17-generation-harness.tsx", loader: "tsx" },
    bundle: true,
    outfile,
    format: "cjs",
    platform: "node",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
    logLevel: "silent",
  });
  ui = createRequire(outfile)(outfile);
});

after(() => {
  if (outdir) rmSync(outdir, { recursive: true, force: true });
});

const noop = () => undefined;
const ACTIONS = { start: noop, refresh: noop, cancel: noop, retry: noop, resume: noop, discard: noop, adopt: noop, compare: noop };

function textOf(html, testid) {
  const start = html.indexOf(`data-testid="${testid}"`);
  assert.ok(start >= 0, `missing ${testid}`);
  const open = html.lastIndexOf("<", start);
  const tag = /^<([a-z0-9]+)/.exec(html.slice(open))[1];
  let depth = 0;
  const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, "g");
  re.lastIndex = open;
  let match;
  while ((match = re.exec(html))) {
    depth += match[1] === "/" ? -1 : 1;
    if (depth === 0) return html.slice(open, re.lastIndex).replace(/<[^>]+>/g, "").replace(/&amp;/g, "&");
  }
  throw new Error(`unterminated ${testid}`);
}

function attr(html, testid, name) {
  const tag = new RegExp(`<[^>]*data-testid="${testid}"[^>]*>`).exec(html)?.[0];
  assert.ok(tag, `missing ${testid}`);
  return new RegExp(`${name}="([^"]*)"`).exec(tag)?.[1] ?? null;
}

function jobView(overrides = {}) {
  const stages = ["facts", "support", "claims", "specification", "checks"].map((stage, index) => ({
    stage,
    state: overrides.stageStates?.[index] ?? "pending",
    errorCode: overrides.stageErrors?.[index] ?? null,
    output: null,
    outputMeta: overrides.stageStates?.[index] === "completed"
      ? { jobId: "job", stage, attempt: 0, inputHash: "a".repeat(64), outputHash: "b".repeat(64), schemaVersion: "v1", artifactId: "artifact", completedAt: "2026-11-05T12:00:00.000Z" }
      : null,
  }));
  return {
    job: {
      id: "job-1",
      tenantId: "tenant",
      matterId: "matter",
      targetId: "target",
      version: 3,
      kind: "generate",
      state: overrides.state ?? "running",
      createdBy: "user",
      input: null,
      baseDraftRevisionId: null,
      payloadHash: "c".repeat(64),
      consentId: "consent",
      providerProfileId: "profile",
      providerProfileVersion: 1,
      promptVersion: "p1",
      stageVersion: "s1",
      rulePackVersion: "r1",
      stage: "claims",
      attempt: 0,
      leaseOwner: null,
      leaseExpiresAt: null,
      progress: { completed: overrides.completed ?? 2, total: 5, unit: "stage" },
      cancelRequestedAt: null,
      resultId: "job-1",
      disposition: overrides.disposition ?? "pending",
      errorCode: overrides.errorCode ?? null,
      usageUnknown: true,
      createdAt: "2026-11-05T12:00:00.000Z",
    },
    stages,
    progress: { completed: overrides.completed ?? 2, total: 5, unit: "stage" },
    result: overrides.result ?? null,
    errorMessage: overrides.errorMessage ?? null,
    retryOfJobId: null,
  };
}

function viewProps(job, overrides = {}) {
  return {
    view: ui.makeView(job, "matter", "target"),
    loading: false,
    loadError: null,
    busy: false,
    notice: null,
    actionError: null,
    actions: ACTIONS,
    ...overrides,
  };
}

const AST = {
  schemaVersion: "draft.v1",
  language: "zh-CN",
  title: "合成标题",
  claims: [{ id: "c1", number: 1, dependsOn: [], paragraphs: [{ id: "p1", text: "一种合成装置。", origin: "ai", sourceRefs: [], factIds: [], figureIds: [], generationJobId: "job" }], features: [] }],
  sections: [{ kind: "technical_field", paragraphs: [] }],
};

test("empty, loading and error states are distinct", () => {
  const empty = ui.renderPanel({ initialView: null, loading: false, loadError: null, matterId: "matter", targetId: "target" });
  assert.equal(attr(empty, "generation", "data-state"), "empty");
  assert.match(textOf(empty, "generation-empty"), /还没有生成任务/);

  const loading = ui.renderPanel({ initialView: null, loading: true, loadError: null, matterId: "matter", targetId: "target" });
  assert.equal(attr(loading, "generation", "data-state"), "loading");

  const error = ui.renderPanel({ initialView: null, loading: false, loadError: { code: "STORAGE_UNAVAILABLE", message: "读取失败" }, matterId: "matter", targetId: "target" });
  assert.equal(attr(error, "generation", "data-state"), "error");
  assert.equal(attr(error, "generation-load-error", "data-code"), "STORAGE_UNAVAILABLE");
  assert.match(error, /data-testid="generation-refresh"/);
});

test("all five real states and completed/total progress render", () => {
  const html = ui.renderView(viewProps(jobView({ stageStates: ["completed", "completed", "running", "pending", "failed"], stageErrors: [null, null, null, null, "PROVIDER_SCHEMA_INVALID"], completed: 2 })));
  for (const [index, stage] of ["facts", "support", "claims", "specification", "checks"].entries()) {
    assert.equal(attr(html, `generation-stage-${stage}`, "data-state"), ["completed", "completed", "running", "pending", "failed"][index]);
  }
  assert.equal(attr(html, "generation-progress", "data-completed"), "2");
  assert.equal(attr(html, "generation-progress", "data-total"), "5");
  assert.match(textOf(html, "generation-stage-state-claims"), /进行中/);
  assert.match(textOf(html, "generation-stage-state-facts"), /完成/);
  assert.match(textOf(html, "generation-stage-state-checks"), /失败/);
});

test("a failed stage shows its code, recovery action and retry control", () => {
  const html = ui.renderView(viewProps(jobView({
    state: "failed",
    stageStates: ["completed", "failed", "pending", "pending", "pending"],
    stageErrors: [null, "CONSENT_REVOKED", null, null, null],
    errorCode: "CONSENT_REVOKED",
    completed: 1,
  })));
  assert.equal(attr(html, "generation-error", "data-code"), "CONSENT_REVOKED");
  assert.match(textOf(html, "generation-recovery"), /已发出的调用无法撤回/);
  assert.match(html, /data-testid="generation-retry"/);
});

test("interrupted offers resume and discard; stale offers a compare entry", () => {
  const interrupted = ui.renderView(viewProps(jobView({ state: "interrupted", stageStates: ["completed", "completed", "pending", "pending", "pending"], completed: 2 })));
  assert.match(interrupted, /data-testid="generation-interrupted"/);
  assert.match(interrupted, /data-testid="generation-resume"/);
  assert.match(interrupted, /data-testid="generation-discard"/);
  assert.match(interrupted, /从已保存阶段继续/);

  const stale = ui.renderView(viewProps(jobView({
    state: "succeeded",
    disposition: "obsolete_result",
    stageStates: ["completed", "completed", "completed", "completed", "completed"],
    completed: 5,
    result: { ast: AST, testOutput: false },
  })));
  assert.match(stale, /data-testid="generation-input-stale"/);
  assert.match(textOf(stale, "generation-input-stale"), /输入已变化，结果未采纳/);
  assert.match(stale, /data-testid="generation-compare"/);
  assert.equal(attr(stale, "generation-adopt", "disabled"), "");
});

test("a ready candidate has an explicit adopt action; stub output is labelled and not adoptable", () => {
  const ready = ui.renderView(viewProps(jobView({
    state: "succeeded",
    disposition: "ready",
    stageStates: ["completed", "completed", "completed", "completed", "completed"],
    completed: 5,
    result: { ast: AST, testOutput: false },
  })));
  assert.match(ready, /data-testid="generation-adopt"/);
  assert.doesNotMatch(attr(ready, "generation-adopt", "disabled") ?? "", /disabled/);
  assert.match(ready, /一种合成装置/);

  const stub = ui.renderView(viewProps(jobView({
    state: "succeeded",
    disposition: "ready",
    stageStates: ["completed", "completed", "completed", "completed", "completed"],
    completed: 5,
    result: { ast: AST, testOutput: true },
  })));
  assert.match(stub, /data-testid="generation-test-output"/);
  assert.match(stub, /不能采纳为正式生成修订/);
  assert.doesNotMatch(stub, /data-testid="generation-adopt"/);
});

test("stub output is adoptable only when test adoption is explicitly allowed", () => {
  const job = jobView({
    state: "succeeded",
    disposition: "ready",
    stageStates: ["completed", "completed", "completed", "completed", "completed"],
    completed: 5,
    result: { ast: AST, testOutput: true },
  });
  const allowedView = ui.makeView(job, "matter", "target", true, true);
  assert.equal(allowedView.testAdoptionAllowed, true);
  assert.equal(allowedView.canAdopt, true);
  const allowed = ui.renderView(viewProps(job, { view: allowedView }));
  assert.match(allowed, /data-testid="generation-adopt"/);
  assert.equal(attr(allowed, "generation-adopt", "disabled"), null);
  assert.match(allowed, /采纳为测试修订（带测试标记，不能作为正式申请材料）/);
  assert.match(allowed, /不能作为正式申请材料/);

  const deniedView = ui.makeView(job, "matter", "target");
  assert.equal(deniedView.testAdoptionAllowed, false);
  assert.equal(deniedView.canAdopt, false);
  const denied = ui.renderView(viewProps(job, { view: deniedView }));
  assert.doesNotMatch(denied, /data-testid="generation-adopt"/);
  assert.match(denied, /不能采纳为正式生成修订/);
});
