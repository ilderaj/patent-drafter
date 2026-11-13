import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import * as esbuild from "esbuild";
import { createTarget } from "../../../../apps/web/src/v6/features/targets/targets.ts";
import { ACTOR_A, MATTER_A, PARTIES, config, readyView, seed } from "../V6-14/harness.mjs";

let outdir;
let ui;
before(async () => {
  outdir = mkdtempSync(join(tmpdir(), "v6-self-routes-"));
  const outfile = join(outdir, "routes.cjs");
  const root = resolve(import.meta.dirname, "../../../..");
  await esbuild.build({
    stdin: {
      contents: `import { renderToStaticMarkup } from "react-dom/server";
        import { MemoryRouter } from "react-router-dom";
        import { RouteStep } from "./apps/web/src/v6/features/self-service/RouteStep.tsx";
        export function render(props) { return renderToStaticMarkup(<MemoryRouter><RouteStep {...props} /></MemoryRouter>); }`,
      resolveDir: root, sourcefile: "self-routes-harness.tsx", loader: "tsx",
    },
    bundle: true, outfile, format: "cjs", platform: "node", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' }, logLevel: "silent",
  });
  ui = createRequire(outfile)(outfile);
});
after(() => { if (outdir) rmSync(outdir, { recursive: true, force: true }); });

function props(repository, targets, target = null) {
  return {
    repository, actor: ACTOR_A, matterId: MATTER_A, targets, target,
    intake: { parties: PARTIES, answers: { inventorIds: [], disclosure: "none" } },
    onSaved() {}, onBack() {},
  };
}
function routeButton(html, route) {
  return html.match(new RegExp(`<button[^>]*data-testid="self-route-${route}"[^>]*>[\\s\\S]*?<\\/button>`))?.[0];
}

test("new self-service matters default to utility models even when the workbench recommends invention", async () => {
  const { repository } = await seed({ facts: ["structure", "method"], maturity: "tested_sample" });
  const view = await readyView(repository);
  assert.equal(view.routeCards.find((card) => card.recommended)?.route, "cn_invention");
  const html = ui.render(props(repository, view));
  assert.match(routeButton(html, "cn_um"), /aria-checked="true"/);
  assert.doesNotMatch(routeButton(html, "cn_um"), /disabled/);
  assert.match(routeButton(html, "cn_invention"), /aria-checked="false"/);
  assert.match(routeButton(html, "cn_invention"), /仅中文准备稿/);
  assert.match(routeButton(html, "cn_invention"), /规则依据尚待核实/);
});

test("overseas cards remain visible but cannot be selected and explain the missing capabilities", async () => {
  const { repository } = await seed();
  const html = ui.render(props(repository, await readyView(repository)));
  for (const route of ["us_nonprovisional", "pct"]) {
    const button = routeButton(html, route);
    assert.ok(button);
    assert.match(button, /disabled=""/);
    assert.match(button, /即将支持/);
    assert.match(button, /尚未提供英文翻译、该路线申请文件核验或代理递交/);
  }
});

for (const route of ["us_nonprovisional", "pct", "cn_invention"]) {
  test(`opening an existing ${route} target preserves its route and persisted data`, async () => {
    const { backend, repository } = await seed();
    const created = await createTarget(repository, ACTOR_A, MATTER_A, { config: config(route) });
    assert.equal(created.ok, true);
    const view = await readyView(repository);
    const before = structuredClone(backend.data);
    const html = ui.render(props(repository, view, view.targets[0]));
    assert.match(routeButton(html, route), /aria-checked="true"/);
    assert.deepEqual(backend.data, before, "rendering must not migrate or rewrite existing target data");
    if (route !== "cn_invention") {
      assert.match(html, /已有海外目标和材料会保留/);
      assert.match(html, new RegExp(`href="/v6/matters/${MATTER_A}/targets/${created.data.target.id}/overview"`));
      assert.match(html, /<button[^>]*disabled=""[^>]*>生成材料/);
    }
  });
}
