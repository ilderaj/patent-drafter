// V6-26 regression: the settings page picks a local matter and hands exactly
// that matter to the recovery export panel. Without local matters it explains
// the import-only path instead of disabling export silently.
import assert from "node:assert/strict";
import test from "node:test";
import { register } from "tsx/esm/api";

register();

const [{ createElement }, { renderToStaticMarkup }, settingsModule, repoModule, v624, recoveryModule] = await Promise.all([
  import("react"),
  import("react-dom/server"),
  import("../../../../apps/web/src/v6/routes/SettingsPage.tsx"),
  import("../../../../apps/web/src/v6/lib/repository.ts"),
  import("../V6-24/harness.mjs"),
  import("../../../../apps/web/src/v6/features/recovery/recovery.ts"),
]);

const SECOND_MATTER_ID = "33333333-3333-4333-8333-333333333355";

async function fixtureWithTwoMatters() {
  const fixture = await v624.makeApprovalFixture();
  const created = await fixture.repository.commit(v624.ACTOR, {
    contractVersion: repoModule.CONTRACT_VERSION,
    expectedVersion: 0,
    payload: {
      matter: {
        id: SECOND_MATTER_ID,
        tenantId: v624.ACTOR.tenantId,
        version: 1,
        title: "另一种合成案件",
        status: "active",
        sourceVersion: 1,
        createdBy: v624.ACTOR.userId,
        createdAt: "2026-11-06T12:00:00.000Z",
        updatedAt: "2026-11-06T12:00:00.000Z",
      },
      targets: [],
      assets: [],
      events: [],
      blobs: [],
    },
  }, { requestId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb6" });
  assert.equal(created.ok, true, created.ok ? "" : JSON.stringify(created.error));
  const listed = await fixture.repository.listMatters(v624.ACTOR);
  assert.equal(listed.ok, true);
  return { fixture, listed: listed.data.items };
}

const renderSettings = (props) => renderToStaticMarkup(createElement(settingsModule.SettingsRecovery, props));

test("V6-26-S01: the settings selector lists local matters newest first and selects the newest", async () => {
  const { fixture, listed } = await fixtureWithTwoMatters();
  const choices = settingsModule.recoveryMatterChoices(listed);
  assert.deepEqual(choices.map((choice) => choice.id), [SECOND_MATTER_ID, v624.MATTER_ID]);
  assert.equal(settingsModule.defaultRecoveryMatterId(choices), SECOND_MATTER_ID);

  const markup = renderSettings({
    repository: fixture.repository,
    actor: v624.ACTOR,
    initialMatters: choices,
  });
  assert.match(markup, /data-testid="settings-recovery-matter-select"/);
  assert.match(markup, new RegExp(`value="${SECOND_MATTER_ID}"`));
  assert.match(markup, new RegExp(`value="${v624.MATTER_ID}"`));
  assert.match(markup, /另一种合成案件 · 更新于 2026-11-06 12:00 · 33333333/);
  assert.match(markup, /合成测试案件 · 更新于 2026-11-05 12:00 · 33333333/);
  // The default choice is what the export panel receives.
  assert.match(markup, new RegExp(`data-testid="recovery-export"[^>]*data-source-matter-id="${SECOND_MATTER_ID}"`));
  fixture.repository.close();
});

test("V6-26-S02: switching the selected matter switches the export source", async () => {
  const { fixture, listed } = await fixtureWithTwoMatters();
  const choices = settingsModule.recoveryMatterChoices(listed);
  const markup = renderSettings({
    repository: fixture.repository,
    actor: v624.ACTOR,
    initialMatters: choices,
    initialSelectedMatterId: v624.MATTER_ID,
  });
  assert.match(markup, new RegExp(`data-testid="recovery-export"[^>]*data-source-matter-id="${v624.MATTER_ID}"`));
  assert.doesNotMatch(markup, new RegExp(`data-source-matter-id="${SECOND_MATTER_ID}"`));
  // The chosen row is the selected option in the rendered selector.
  const select = markup.match(/<select[^>]*data-testid="settings-recovery-matter-select"[\s\S]*?<\/select>/)?.[0] ?? "";
  assert.ok(select, "selector rendered");
  assert.match(select, new RegExp(`<option[^>]*value="${v624.MATTER_ID}"[^>]*selected`));
  fixture.repository.close();
});

test("V6-26-S03: with no local matter the page explains import-only recovery and disables export", async () => {
  const { fixture } = await fixtureWithTwoMatters();
  const empty = settingsModule.recoveryMatterChoices([]);
  assert.equal(settingsModule.defaultRecoveryMatterId(empty), null);
  const markup = renderSettings({
    repository: fixture.repository,
    actor: v624.ACTOR,
    initialMatters: empty,
  });
  assert.doesNotMatch(markup, /data-testid="settings-recovery-matter-select"/);
  assert.match(markup, /data-testid="settings-recovery-no-matters"/);
  assert.match(markup, /当前本机暂无可导出的案件；你仍可在下方选择已有的 \.patentpack 恢复包导入恢复/);
  assert.match(markup, /data-testid="recovery-export"[^>]*data-source-matter-id=""/);
  assert.match(markup, /data-testid="recovery-generate"[^>]*disabled/);
  fixture.repository.close();
});

test("V6-26-S04: a selected local matter is a valid .patentpack export source", async () => {
  const { fixture } = await fixtureWithTwoMatters();
  const passphrase = "synthetic-v6-26-settings-export";
  const packed = await recoveryModule.createRecoveryPackage(fixture.repository, v624.ACTOR, v624.MATTER_ID, {
    passphrase,
    access: "local_unmetered",
  });
  assert.ok(packed.byteLength > 0);
  assert.match(recoveryModule.recoveryPackageFileName(v624.T0), /\.patentpack$/);
  const opened = await (await import("../../../../packages/export/src/patentpack.ts")).openPatentPack(packed, passphrase);
  assert.equal(opened.sourceMatterId, v624.MATTER_ID);
  fixture.repository.close();
});
