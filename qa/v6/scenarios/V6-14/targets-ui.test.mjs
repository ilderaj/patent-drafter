/**
 * V6-14 UI — empty, loading, error and stale states; the read-only switcher;
 * route cards; the recommendation trace; disabled controls with reasons.
 *
 * `Targets.tsx` is bundled with esbuild and rendered with `react-dom/server`
 * (the V6-10..V6-15 technique). View models come from real persisted state in
 * the in-memory repository. Interaction is covered by the V6-14 browser drive.
 */
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

import {
  createTarget,
  updateTargetConfig,
  R1_RULE_PACK,
  loadTargetsView,
} from "../../../../apps/web/src/v6/features/targets/targets.ts";
import {
  ACTOR_A,
  MATTER_A,
  T1,
  T2,
  T3,
  archiveMatter,
  config,
  readyView,
  seed,
} from "./harness.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../../../..");
const SOURCE = join(ROOT, "apps/web/src/v6/features/targets/Targets.tsx");
const WARNING = "中文准备稿，需翻译并由适格人员核对，不能直接作为该法域申请文件";

let outdir;
let ui;

before(async () => {
  outdir = mkdtempSync(join(tmpdir(), "v6-14-bundle-"));
  const outfile = join(outdir, "targets.cjs");
  const harness = `
    import { renderToStaticMarkup } from "react-dom/server";
    import { TargetsPanel, TargetsViewPanel } from ${JSON.stringify(SOURCE)};
    export function renderPanel(props) { return renderToStaticMarkup(<TargetsPanel {...props} />); }
    export function renderView(props) { return renderToStaticMarkup(<TargetsViewPanel {...props} />); }
  `;
  await esbuild.build({
    stdin: { contents: harness, resolveDir: ROOT, sourcefile: "v6-14-targets-harness.tsx", loader: "tsx" },
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
const ACTIONS = { refresh: noop, select: noop, create: noop, update: noop };

function viewProps(view, overrides = {}) {
  return {
    view,
    loading: false,
    loadError: null,
    stale: null,
    busy: false,
    notice: null,
    actionError: null,
    localProblem: null,
    selectedTargetId: null,
    actions: ACTIONS,
    ...overrides,
  };
}

/** The inner text of the element carrying `data-testid`, tags stripped. */
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
    if (depth === 0) {
      return html
        .slice(open, re.lastIndex)
        .replace(/<[^>]+>/g, "")
        .replace(/&amp;/g, "&");
    }
  }
  throw new Error(`unterminated ${testid}`);
}

function attr(html, testid, name) {
  const re = new RegExp(`<[^>]*data-testid="${testid}"[^>]*>`);
  const tag = re.exec(html)?.[0];
  assert.ok(tag, `missing ${testid}`);
  return new RegExp(`${name}="([^"]*)"`).exec(tag)?.[1] ?? null;
}

async function twoTargets() {
  const { repository } = await seed({ facts: ["structure", "method"], maturity: "tested_sample" });
  const a = await createTarget(repository, ACTOR_A, MATTER_A, { config: config("cn_invention") }, { now: () => T1 });
  const b = await createTarget(repository, ACTOR_A, MATTER_A, { config: config("pct") }, { now: () => T2 });
  assert.equal(a.ok && b.ok, true);
  return { repository, a: a.data, b: b.data };
}

test("loading, error and empty states render distinctly", async () => {
  const loading = ui.renderPanel({ loading: true, initialView: null });
  assert.equal(attr(loading, "targets", "data-state"), "loading");
  assert.match(loading, /data-testid="targets-loading"/);

  const error = ui.renderPanel({
    initialView: null,
    loading: false,
    loadError: { code: "RESOURCE_NOT_FOUND", message: "目标或案件不可用。" },
  });
  assert.equal(attr(error, "targets", "data-state"), "error");
  assert.equal(attr(error, "targets-load-error", "data-code"), "RESOURCE_NOT_FOUND");
  assert.match(textOf(error, "targets-load-error"), /目标或案件不可用。/);

  const { repository } = await seed();
  const view = await readyView(repository);
  const empty = ui.renderPanel({ initialView: view, loading: false, loadError: null });
  assert.equal(attr(empty, "targets", "data-state"), "ready");
  assert.match(textOf(empty, "targets-empty"), /本案还没有目标/);
  assert.doesNotMatch(empty, /data-testid="targets-switcher"/);
});

test("the stale notice keeps the view and offers a re-read", async () => {
  const { repository } = await seed();
  const view = await readyView(repository);
  const html = ui.renderView(
    viewProps(view, { stale: { code: "VERSION_CONFLICT", message: "目标已被其他操作更新，尚未保存。请刷新后重试。" } }),
  );
  assert.equal(attr(html, "targets-stale", "data-code"), "VERSION_CONFLICT");
  assert.match(html, /data-testid="targets-stale-retry"/);
  assert.match(html, /data-testid="targets-cards"/);
});

test("the switcher lists both targets with their own versions; the selection shows only its config", async () => {
  const { repository, a, b } = await twoTargets();
  const updated = await updateTargetConfig(
    repository,
    ACTOR_A,
    MATTER_A,
    a.target.id,
    { baseVersion: 1, config: config("cn_um") },
    { now: () => T3 },
  );
  assert.equal(updated.ok, true);
  const view = await readyView(repository);
  const html = ui.renderView(viewProps(view, { selectedTargetId: b.target.id }));
  assert.equal(attr(html, `targets-switch-${a.target.id}`, "data-target-version"), "2");
  assert.equal(attr(html, `targets-switch-${b.target.id}`, "data-target-version"), "1");
  assert.equal(attr(html, "targets-selected", "data-target-id"), b.target.id);
  assert.match(textOf(html, "targets-selected-config"), /PCT 国际申请/);
  assert.match(html, /data-testid="targets-update-save"/);
});

test("S03-A07 cards show protection, examination, limits and 未核实 instead of numbers", async () => {
  const { repository } = await seed();
  const view = await readyView(repository);
  const html = ui.renderView(viewProps(view));
  for (const route of ["cn_um", "cn_invention", "us_nonprovisional", "pct"]) {
    const card = textOf(html, `targets-card-${route}`);
    assert.match(card, /保护对象/);
    assert.match(card, /审查方式/);
    assert.match(card, /能力限制/);
    assert.equal(attr(html, `targets-card-${route}`, "data-verification"), "unverified");
    assert.match(textOf(html, `targets-verification-${route}`), /未核实/);
    for (const slot of ["cycle", "fee", "term"]) {
      assert.equal(textOf(html, `targets-${slot}-${route}`), "未核实");
    }
  }
});

test("S03-A07 a verified rule entry shows its numbers on that card only", async () => {
  const { repository } = await seed();
  const pack = {
    version: "test-verified",
    rules: R1_RULE_PACK.rules.map((rule) =>
      rule.route === "cn_invention"
        ? { ...rule, verification: "verified", cycle: { value: "合成周期 24 个月", note: null }, fee: null, term: null }
        : { ...rule, cycle: { value: "不应显示", note: null } },
    ),
  };
  const loaded = await loadTargetsView(repository, ACTOR_A, MATTER_A, pack);
  assert.equal(loaded.ok, true);
  const html = ui.renderView(viewProps(loaded.view));
  assert.equal(textOf(html, "targets-cycle-cn_invention"), "合成周期 24 个月");
  assert.equal(textOf(html, "targets-fee-cn_invention"), "未核实");
  assert.equal(textOf(html, "targets-cycle-cn_um"), "未核实");
  assert.doesNotMatch(html, /不应显示/);
});

test("S03-A08 US and PCT cards show the exact handoff sentence; en-US is disabled with its reason", async () => {
  const { repository } = await seed();
  const view = await readyView(repository);
  const html = ui.renderView(viewProps(view));
  assert.equal(textOf(html, "targets-foreign-warning-us_nonprovisional"), WARNING);
  assert.equal(textOf(html, "targets-foreign-warning-pct"), WARNING);
  assert.doesNotMatch(html, /data-testid="targets-foreign-warning-cn_um"/);
  const enOption = /<label[^>]*data-testid="targets-create-language-en-US"[^>]*>[\s\S]*?<\/label>/.exec(html)[0];
  assert.match(enOption, /disabled=""/);
  assert.match(textOf(html, "targets-create-language-reason-en-US"), /英文/);
});

test("S03-A09 the method rule and its triggering fact are shown on the trace and the cn_um card", async () => {
  const { repository } = await seed({ facts: ["structure", "method"], maturity: "tested_sample" });
  const view = await readyView(repository);
  const html = ui.renderView(viewProps(view));
  assert.equal(attr(html, "targets-recommendation", "data-fallback"), "false");
  assert.match(textOf(html, "targets-rule-method_blocks_utility_model"), /存在方法类事实/);
  assert.match(textOf(html, "targets-rule-triggers-method_blocks_utility_model"), /方法/);
  assert.match(textOf(html, "targets-excluded-cn_um"), /method_blocks_utility_model/);
  assert.equal(attr(html, "targets-card-cn_um", "data-recommended"), "false");
  assert.equal(attr(html, "targets-card-cn_invention", "data-recommended"), "true");
  assert.match(textOf(html, "targets-recommendation-summary"), /推荐：cn_invention/);
});

test("with no facts the trace says no rule fired instead of inventing one", async () => {
  const { repository } = await seed({ facts: [], maturity: null });
  const view = await readyView(repository);
  const html = ui.renderView(viewProps(view));
  assert.equal(attr(html, "targets-recommendation", "data-fallback"), "true");
  assert.match(html, /data-testid="targets-recommendation-none"/);
  assert.match(textOf(html, "targets-recommendation-summary"), /没有推荐路线/);
});

test("create stays enabled with two targets and is disabled with a visible reason on an archived matter", async () => {
  const { repository } = await twoTargets();
  const full = ui.renderView(viewProps(await readyView(repository)));
  assert.doesNotMatch(/<button[^>]*data-testid="targets-create-save"[^>]*>/.exec(full)[0], /disabled=""/);
  assert.doesNotMatch(full, /data-testid="targets-create-disabled-reason"/);

  await archiveMatter(repository);
  const view = await readyView(repository);
  const archived = ui.renderView(viewProps(view, { selectedTargetId: view.targets[0].id }));
  assert.match(textOf(archived, "targets-create-disabled-reason"), /案件已归档/);
  assert.match(/<button[^>]*data-testid="targets-update-save"[^>]*>/.exec(archived)[0], /disabled=""/);
  assert.match(textOf(archived, "targets-update-disabled-reason"), /案件已归档/);
  assert.match(textOf(archived, "targets-notice"), /只能查看/);
});

test("an action error shows its code, message and field reasons", async () => {
  const { repository } = await seed();
  const view = await readyView(repository);
  const html = ui.renderView(
    viewProps(view, {
      actionError: {
        code: "INVALID_INPUT",
        message: "输入有误，尚未保存。",
        fields: [{ path: "route", reason: "EP 不是可生成的目标路线，请改为人工服务需求；系统不会把它映射到其他路线。" }],
      },
    }),
  );
  assert.equal(attr(html, "targets-action-error", "data-code"), "INVALID_INPUT");
  assert.match(textOf(html, "targets-action-error-fields"), /EP 不是可生成的目标路线/);
});
