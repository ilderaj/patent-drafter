/**
 * V6-15 UI — flash-free states, unknown handling, disabled confirmation,
 * consent controls and a content-free invocation table.
 *
 * `Ai.tsx` is bundled with esbuild and rendered with `react-dom/server`, the
 * same technique as the V6-10..V6-12 suites. The view models come from real
 * persisted state in the in-memory repository. Browser interaction is captured
 * separately in the V6-15 browser evidence; nothing here claims a model call.
 */
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

import { grantConsent, loadAiView, revokeConsent } from "../../../../apps/web/src/v6/features/ai/ai.ts";
import {
  ACTOR_A,
  ASSET_1,
  ASSET_3,
  CHUNK_MARKER,
  FACT_MARKER,
  GOOD_PROFILE_ID,
  INVOCATION_ID,
  MATTER_A,
  PROMPT_MARKER,
  CASE_MARKER,
  KEY_MARKER,
  T1,
  addSourceAsset,
  archiveMatter,
  grantInput,
  readyView,
  seed,
  seedInvocation,
} from "./harness.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../../../..");
const SOURCE = join(ROOT, "apps/web/src/v6/features/ai/Ai.tsx");
const UNKNOWN_PROFILE_ID = "a1000000-0000-4000-8000-000000000002";

let outdir;
let ui;

before(async () => {
  outdir = mkdtempSync(join(tmpdir(), "v6-15-bundle-"));
  const outfile = join(outdir, "ai.cjs");
  const harness = `
    import { renderToStaticMarkup } from "react-dom/server";
    import { AiPage, AiPanel } from ${JSON.stringify(SOURCE)};
    export function renderPanel(props) { return renderToStaticMarkup(<AiPanel {...props} />); }
    export function renderPage(props) { return renderToStaticMarkup(<AiPage {...props} />); }
  `;
  await esbuild.build({
    stdin: { contents: harness, resolveDir: ROOT, sourcefile: "v6-15-ai-harness.tsx", loader: "tsx" },
    bundle: true,
    outfile,
    format: "cjs",
    platform: "node",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
    logLevel: "silent",
    // AiPage imports the session client from the generation runtime, which pulls
    // the prompt files as Vite `?raw` text. Bundle them the same way Vite does.
    plugins: [{
      name: "vite-raw",
      setup(build) {
        build.onResolve({ filter: /\?raw$/ }, (args) => ({
          path: resolve(args.resolveDir, args.path.replace(/\?raw$/, "")),
          namespace: "vite-raw",
        }));
        build.onLoad({ filter: /.*/, namespace: "vite-raw" }, (args) => ({
          contents: `export default ${JSON.stringify(readFileSync(args.path, "utf8"))}`,
          loader: "js",
        }));
      },
    }],
  });
  ui = createRequire(outfile)(outfile);
});

after(() => {
  if (outdir) rmSync(outdir, { recursive: true, force: true });
});

function render(view, extra = {}) {
  return ui.renderPanel({
    view,
    loading: false,
    loadError: null,
    purpose: "extract",
    busy: false,
    ...extra,
  });
}

function buttonTag(html, testId) {
  const match = new RegExp(`<button[^>]*data-testid="${testId}"[^>]*>`).exec(html);
  assert.ok(match, `button ${testId} not found`);
  return match[0];
}

test("V6-15 UI loading: the first render is busy and shows no invented rows", () => {
  const html = render(null, { loading: true });
  assert.match(html, /data-testid="ai-panel"/);
  assert.match(html, /data-ai-state="loading"/);
  assert.match(html, /data-testid="ai-loading"/);
  assert.match(html, /aria-busy="true"/);
  assert.doesNotMatch(html, /ai-manifest|ai-consent-|ai-invocation-/);
});

test("V6-15 UI mounting: the container renders its page shell and the loading panel", async () => {
  const { repository } = await seed();
  const html = ui.renderPage({ repository, actor: ACTOR_A });
  assert.match(html, /data-testid="ai-page"/);
  assert.match(html, /AI 与数据/);
  assert.match(html, /data-testid="ai-loading"/);
  assert.doesNotMatch(html, /data-testid="ai-matter-select"/);
});

test("V6-15 UI error: a failed load shows its code and a retry, never an empty page", async () => {
  const html = render(null, {
    loadError: { code: "STORAGE_UNAVAILABLE", message: "本地存储暂时不可用。" },
  });
  assert.match(html, /data-ai-state="error"/);
  assert.match(html, /data-testid="ai-load-error"/);
  assert.match(html, /data-code="STORAGE_UNAVAILABLE"/);
  assert.match(html, /重试/);
  assert.doesNotMatch(html, /ai-empty|ai-manifest/);
});

test("V6-15 UI empty: no matter shows the empty reason, honest capabilities and disabled grants", async () => {
  const { repository } = await seed();
  const result = await loadAiView(repository, ACTOR_A, null);
  assert.equal(result.ok, true);
  const html = render(result.data);
  assert.match(html, /data-ai-state="empty"/);
  assert.match(html, /data-testid="ai-empty"/);
  assert.match(html, /data-reason="no_matters"/);
  assert.match(html, /data-testid="ai-capability-local" data-state="unavailable"/);
  assert.match(html, /本机模型/);
  assert.match(html, /桌面版（R4）/);
  assert.match(html, /data-testid="ai-current-mode"/);
  assert.match(html, /R1 本地浏览器版/);
  assert.match(html, /data-testid="ai-manual-writing"/);
  assert.match(html, /草稿编辑器/);
  assert.match(html, /data-testid="ai-service-status" data-state="unknown"/);
  assert.match(buttonTag(html, `ai-grant-${GOOD_PROFILE_ID}`), /disabled/);
  assert.match(buttonTag(html, `ai-grant-${GOOD_PROFILE_ID}`), /data-grantable="false"/);
  assert.doesNotMatch(html, /ai-manifest|ai-consent-list|ai-invocations/);
});

test("V6-15 UI ready: the manifest, profile facts, unknown fields and service state are explicit", async () => {
  const { repository } = await seed();
  const view = await readyView(repository);
  const html = render(view, { onGrant: () => {}, onRevoke: () => {}, onReload: () => {} });

  assert.match(html, /data-ai-state="ready"/);
  assert.match(html, /data-testid="ai-service-status" data-state="unknown"/);
  assert.match(html, /平台起草服务：正在读取状态/);
  assert.doesNotMatch(html, /RELEASE_GATE_CLOSED/);
  assert.match(html, /data-testid="ai-matter" data-status="active"/);
  assert.match(html, /V6-15 合成案卷 A/);
  assert.match(html, /data-testid="ai-matter-link"/);
  assert.match(html, /data-testid="ai-manifest"/);
  assert.match(html, new RegExp(`data-testid="ai-manifest-file-${ASSET_1}"`));
  assert.match(html, /fixture-a\.txt/);
  assert.match(html, /fixture-b\.txt/);
  assert.match(html, new RegExp(`ai-manifest-pages-${ASSET_1}`));
  assert.match(html, /data-testid="ai-manifest-hash"/);
  assert.match(html, new RegExp(view.manifest.payloadManifestHash));
  assert.match(html, /data-testid="ai-manifest-facts"/);
  assert.match(html, /data-testid="ai-manifest-chunks"/);

  const goodButton = buttonTag(html, `ai-grant-${GOOD_PROFILE_ID}`);
  assert.match(goodButton, /data-grantable="true"/);
  assert.doesNotMatch(goodButton, /disabled/);
  assert.match(html, /data-testid="ai-profile-region-a1000000-0000-4000-8000-000000000002"[^>]*data-known="false"/);
  assert.match(html, /「未知」/);
  assert.match(html, new RegExp(`ai-profile-capabilities-${GOOD_PROFILE_ID}`));
  assert.match(html, /结构化输出 是/);
  assert.match(html, /视觉输入 是/);
  const unknownCapabilities = new RegExp(
    `data-testid="ai-profile-capabilities-${UNKNOWN_PROFILE_ID}"[^>]*>[\\s\\S]*?「未知」`,
  );
  assert.match(html, unknownCapabilities);
  const unknownButton = buttonTag(html, `ai-grant-${UNKNOWN_PROFILE_ID}`);
  assert.match(unknownButton, /data-grantable="false"/);
  assert.match(unknownButton, /disabled/);
  assert.match(html, new RegExp(`ai-grant-reason-${UNKNOWN_PROFILE_ID}`));
  assert.match(html, /处理方信息不完整/);

  assert.match(html, /data-testid="ai-consents-empty"/);
  assert.match(html, /data-testid="ai-invocations-empty"/);
  assert.match(html, /data-testid="ai-purpose-select"/);
  assert.doesNotMatch(html, /data-testid="ai-stale"/);
  for (const marker of [CHUNK_MARKER, FACT_MARKER, PROMPT_MARKER, KEY_MARKER, CASE_MARKER]) {
    assert.equal(html.includes(marker), false, `${marker} leaked into the panel`);
  }
});

test("V6-15 UI service: the platform state, processor and unknowns come from the status endpoint", async () => {
  const { repository } = await seed();
  const view = await readyView(repository);
  const base = {
    available: true,
    configured: true,
    authenticated: true,
    model: "synthetic-model-1",
    processor: { name: "Synthetic Processor A", region: "cn-synthetic-1", retention: "retention-2026.1", trainingPolicy: "no_training", termsVersion: "terms-2026.1" },
    profileVersion: 3,
    unavailableReason: null,
  };

  const ready = render(view, { status: base });
  assert.match(ready, /data-testid="ai-service-status" data-state="ready"/);
  assert.match(ready, /平台起草服务：可用/);
  assert.match(ready, /data-testid="ai-service-processor"[^>]*data-known="true"/);
  assert.match(ready, /Synthetic Processor A/);
  assert.match(ready, /data-testid="ai-service-retention"[^>]*data-known="true"/);
  assert.match(ready, /retention-2026\.1/);
  assert.match(ready, /data-testid="ai-service-training"[^>]*>[\s\S]*?不用于训练/);
  assert.match(ready, /data-testid="ai-capability-platform" data-state="available"/);
  assert.doesNotMatch(ready, /RELEASE_GATE_CLOSED/);

  const authRequired = render(view, { status: { ...base, authenticated: false } });
  assert.match(authRequired, /data-testid="ai-service-status" data-state="auth_required"/);
  assert.match(authRequired, /需要访问码/);
  assert.match(authRequired, /data-testid="ai-capability-platform" data-state="available"/);

  const unavailable = render(view, {
    status: { ...base, available: false, authenticated: false, model: null,
      processor: { name: "未知", region: "未知", retention: "未知", trainingPolicy: "unknown", termsVersion: null },
      unavailableReason: "处理方披露信息尚未完整，暂不能外发材料。" },
  });
  assert.match(unavailable, /data-testid="ai-service-status" data-state="unavailable"/);
  assert.match(unavailable, /处理方披露信息尚未完整/);
  assert.match(unavailable, /data-testid="ai-service-processor"[^>]*data-known="false"/);
  assert.match(unavailable, /「未知」/);
  assert.match(unavailable, /data-testid="ai-capability-platform" data-state="unavailable"/);

  const unconfigured = render(view, { status: { ...base, configured: false, available: false, authenticated: false, unavailableReason: null } });
  assert.match(unconfigured, /data-testid="ai-service-status" data-state="unconfigured"/);

  const unreachable = render(view, { status: null });
  assert.match(unreachable, /data-testid="ai-service-status" data-state="unreachable"/);
  assert.match(unreachable, /无法读取平台服务状态/);
});

test("V6-15 UI purpose: a purpose the profile does not allow disables confirmation", async () => {
  const { repository } = await seed();
  const view = await readyView(repository);
  const html = render(view, { purpose: "ocr" });
  const button = buttonTag(html, `ai-grant-${GOOD_PROFILE_ID}`);
  assert.match(button, /data-grantable="false"/);
  assert.match(button, /disabled/);
  assert.match(html, /没有声明「OCR」用途/);
});

test("V6-15 UI granted: the consent row shows its scope and offers revocation", async () => {
  const { repository } = await seed();
  const view = await readyView(repository);
  const granted = await grantConsent(repository, ACTOR_A, MATTER_A, grantInput(view), {
    requestKey: "ui-grant",
    now: () => T1,
  });
  assert.equal(granted.ok, true, granted.ok ? "" : JSON.stringify(granted.error));
  const after = await readyView(repository);
  const html = render(after, { onRevoke: () => {} });
  assert.match(html, new RegExp(`data-testid="ai-consent-${granted.data.consent.id}"`));
  assert.match(html, /生效中/);
  assert.match(html, /Synthetic Processor A/);
  assert.match(html, /不用于训练/);
  assert.match(html, new RegExp(`ai-consent-scope-${granted.data.consent.id}`));
  assert.match(html, /文件 2/);
  assert.match(html, /事实 2/);
  assert.match(html, /data-testid="ai-revocation-note"/);
  assert.match(html, /已经发出的调用无法撤回/);
  const revoke = buttonTag(html, `ai-revoke-${granted.data.consent.id}`);
  assert.doesNotMatch(revoke, /disabled/);
});

test("V6-15 UI stale: a new file marks the active consent and warns before re-confirmation", async () => {
  const { backend, repository } = await seed();
  const view = await readyView(repository);
  const granted = await grantConsent(repository, ACTOR_A, MATTER_A, grantInput(view), {
    requestKey: "ui-stale",
    now: () => T1,
  });
  assert.equal(granted.ok, true);
  await addSourceAsset(repository, backend);
  const after = await readyView(repository);
  const html = render(after);
  assert.match(html, /data-testid="ai-stale"/);
  assert.match(html, /旧授权不会自动扩大范围/);
  assert.match(html, /材料已变化/);
  assert.match(html, new RegExp(`data-testid="ai-manifest-file-${ASSET_3}"`));
  assert.match(html, new RegExp(`data-testid="ai-consent-${granted.data.consent.id}"`));
});

test("V6-15 UI revoked and archived: history remains, but new authorization is disabled", async () => {
  const { repository } = await seed();
  const view = await readyView(repository);
  const granted = await grantConsent(repository, ACTOR_A, MATTER_A, grantInput(view), {
    requestKey: "ui-revoked",
    now: () => T1,
  });
  assert.equal(granted.ok, true);
  const revoked = await revokeConsent(repository, ACTOR_A, MATTER_A, { consentId: granted.data.consent.id }, {
    requestKey: "ui-revoke",
    now: () => T1,
  });
  assert.equal(revoked.ok, true);
  const revokedView = await readyView(repository);
  const revokedHtml = render(revokedView);
  assert.match(revokedHtml, /已撤回/);
  assert.match(buttonTag(revokedHtml, `ai-revoke-${granted.data.consent.id}`), /disabled/);

  await archiveMatter(repository);
  const archivedView = await readyView(repository);
  const archivedHtml = render(archivedView);
  assert.match(archivedHtml, /data-testid="ai-matter-archived"/);
  assert.match(buttonTag(archivedHtml, `ai-grant-${GOOD_PROFILE_ID}`), /disabled/);
  assert.match(buttonTag(archivedHtml, `ai-grant-${GOOD_PROFILE_ID}`), /data-grantable="false"/);
});

test("V6-15 UI invocation table: metadata only, with no prompt, content or key", async () => {
  const { backend, repository } = await seed();
  await seedInvocation(backend);
  const view = await readyView(repository);
  const html = render(view);
  assert.match(html, new RegExp(`data-testid="ai-invocation-${INVOCATION_ID}"`));
  assert.match(html, /成功/);
  assert.match(html, /输入 12 · 输出 34/);
  assert.match(html, /作业 \/ 尝试/);
  assert.match(html, /dddddddd… \/ 0/);
  assert.match(html, /授权/);
  assert.match(html, /无/);
  assert.doesNotMatch(html, /没有调用时间字段/);
  assert.doesNotMatch(html, /本构建没有真实调用/);
  assert.match(html, /data-testid="ai-invocation-time-/);
  assert.match(html, /data-testid="ai-invocation-execution-/);
  // Rows written by older builds have no time or execution type: show 「—」, never invent one.
  assert.match(/<td[^>]*data-testid="ai-invocation-time-[^"]*"[^>]*>—<\/td>/.exec(html)[0], /—/);
  assert.match(/<td[^>]*data-testid="ai-invocation-execution-[^"]*"[^>]*>—<\/td>/.exec(html)[0], /—/);
  assert.doesNotMatch(html, /data-testid="ai-invocations-empty"/);
  for (const marker of [PROMPT_MARKER, CASE_MARKER, KEY_MARKER, CHUNK_MARKER, FACT_MARKER]) {
    assert.equal(html.includes(marker), false, `${marker} leaked into the invocation table`);
  }
  assert.equal(html.includes("apiKey"), false);
  assert.equal(html.includes("prompt"), false);
});

test("V6-15 UI invocation table shows the recorded time and a test/real marker without leaking content", async () => {
  const { backend, repository } = await seed();
  await seedInvocation(backend, {
    id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2",
    at: "2026-11-12T03:04:05.000Z",
    execution: "provider",
    executionLocation: "cn-test-1",
    status: "failed",
    errorCode: "PROVIDER_TIMEOUT",
  });
  const html = render(await readyView(repository));
  const time = /<td[^>]*data-testid="ai-invocation-time-eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2"[^>]*>([^<]+)<\/td>/.exec(html)[1];
  assert.notEqual(time, "—");
  assert.match(time, /2026/);
  assert.match(html, /data-testid="ai-invocation-execution-eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2"[^>]*>真实<div[^>]*>cn-test-1<\/div>/);
  const status = /<td[^>]*data-testid="ai-invocation-status-eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2"[^>]*>([\s\S]*?)<\/td>/.exec(html)[1];
  assert.match(status, /失败<span> · 真实起草服务响应超时<\/span>/);
  assert.match(status, /<summary>技术详情<\/summary>/);
  assert.match(status, /PROVIDER_TIMEOUT/);
  assert.doesNotMatch(html, new RegExp(PROMPT_MARKER));
  assert.doesNotMatch(html, new RegExp(CASE_MARKER));
});

test("V6-15 UI invocation table marks on-device test output separately from real calls", async () => {
  const { backend, repository } = await seed();
  await seedInvocation(backend, { execution: "stub", executionLocation: "device:stub" });
  const html = render(await readyView(repository));
  assert.match(html, /data-testid="ai-invocation-execution-[^"]*"[^>]*>测试<div[^>]*>device:stub<\/div>/);
});

test("V6-15 UI session: 「退出起草会话」keeps its scope honest and only appears for an authenticated browser session", async () => {
  const { repository } = await seed();
  const view = await readyView(repository);
  const status = (authenticated) => ({
    available: true, configured: true, authenticated, model: "synthetic-model-1",
    processor: { name: "Synthetic Processor A", region: "cn-synthetic-1", retention: "retention-2026.1", trainingPolicy: "no_training", termsVersion: "terms-2026.1" },
    profileVersion: 3, unavailableReason: null,
  });
  const onEndSession = () => undefined;

  const signedIn = render(view, { status: status(true), onEndSession });
  assert.match(/<button[^>]*data-testid="ai-service-end-session"[^>]*>退出起草会话<\/button>/.exec(signedIn)[0], /退出起草会话/);
  assert.match(signedIn, /data-testid="ai-session-scope"[^>]*>[\s\S]*?只清除当前浏览器中的起草会话，不删除案件、草稿或授权记录/);
  assert.match(signedIn, /已复制到其他位置的访问凭证无法在这里吊销/);
  assert.doesNotMatch(signedIn, /已吊销|已注销凭证/);

  const signedOut = render(view, { status: status(false), onEndSession });
  assert.equal(signedOut.includes('data-testid="ai-service-end-session"'), false);
  assert.equal(signedOut.includes('data-testid="ai-session-scope"'), false);

  const busy = render(view, { status: status(true), onEndSession, endingSession: true });
  assert.match(/<button[^>]*data-testid="ai-service-end-session"[^>]*>/.exec(busy)[0], /disabled/);
  assert.match(busy, /正在退出…/);

  const failed = render(view, { status: status(true), onEndSession, sessionError: "退出未完成，请重试。该操作仅清除当前浏览器会话。" });
  assert.match(failed, /data-testid="ai-session-error"[^>]*role="alert"|role="alert"[^>]*data-testid="ai-session-error"/);
  assert.match(failed, /仅清除当前浏览器会话/);
});

test("V6-15 UI actions: errors and confirmations are shown without losing the manifest", async () => {
  const { repository } = await seed();
  const view = await readyView(repository);
  const html = render(view, {
    actionError: { code: "STALE_BINDING", message: "材料清单已变化，请重新查看外发内容后再授权。" },
    notice: "已保存外发授权。本构建不会发起真实调用。",
  });
  assert.match(html, /data-testid="ai-action-error"/);
  assert.match(html, /data-code="STALE_BINDING"/);
  assert.match(html, /data-testid="ai-notice"/);
  assert.match(html, /data-testid="ai-manifest"/);
});
