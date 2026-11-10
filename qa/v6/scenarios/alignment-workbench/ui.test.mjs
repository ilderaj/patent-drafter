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
const WORKBENCH = join(ROOT, "apps/web/src/v6/features/workbench/Workbench.tsx");
const ACTIVITY = join(ROOT, "apps/web/src/v6/features/workbench/ActivityFeed.tsx");
const MATTERS = join(ROOT, "apps/web/src/v6/features/matters/Matters.tsx");
const INBOX = join(ROOT, "apps/web/src/v6/features/inbox/Inbox.tsx");
const TARGETS = join(ROOT, "apps/web/src/v6/features/targets/Targets.tsx");
let outdir;
let ui;

before(async () => {
  outdir = mkdtempSync(join(tmpdir(), "v6-alignment-workbench-"));
  const outfile = join(outdir, "ui.cjs");
  const harness = `
    import { renderToStaticMarkup } from "react-dom/server";
    import { MemoryRouter } from "react-router-dom";
    import { TargetOverviewTable } from ${JSON.stringify(WORKBENCH)};
    import { ActivityFeedView } from ${JSON.stringify(ACTIVITY)};
    import { MattersPage } from ${JSON.stringify(MATTERS)};
    import { InboxPage } from ${JSON.stringify(INBOX)};
    import { TargetsViewPanel } from ${JSON.stringify(TARGETS)};
    export const renderOverview = (props) => renderToStaticMarkup(<MemoryRouter><TargetOverviewTable {...props} /></MemoryRouter>);
    export const renderActivity = (props) => renderToStaticMarkup(<ActivityFeedView {...props} />);
    export const renderMatters = (props) => renderToStaticMarkup(<MemoryRouter><MattersPage {...props} /></MemoryRouter>);
    export const renderInbox = (props) => renderToStaticMarkup(<MemoryRouter><InboxPage {...props} /></MemoryRouter>);
    export const renderTargets = (props) => renderToStaticMarkup(<TargetsViewPanel {...props} />);
  `;
  await esbuild.build({
    stdin: { contents: harness, resolveDir: ROOT, sourcefile: "alignment-workbench-harness.tsx", loader: "tsx" },
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

after(() => { if (outdir) rmSync(outdir, { recursive: true, force: true }); });

const MATTER_ID = "11111111-1111-4111-8111-111111111111";
const TARGET_ID = "22222222-2222-4222-8222-222222222222";
const PARTY_ID = "33333333-3333-4333-8333-333333333333";
const ASSET_ID = "44444444-4444-4444-8444-444444444444";
const ACTOR = { tenantId: "tenant", userId: "user" };

function targetSummary(nextAction = "generate_draft") {
  return {
    id: TARGET_ID,
    status: "active",
    route: "cn_um",
    language: "zh-CN",
    configVersion: 2,
    revisionId: "55555555-5555-4555-8555-555555555555",
    testOutput: true,
    inputStale: false,
    check: { state: "current", runId: null, rulePackVersion: "rules-v1" },
    confirmations: { confirmed: 1, required: 2 },
    approval: { state: "none", reason: null, approvalId: null },
    nextAction,
  };
}

test("overview gives the next step a translated label and opens the matching workbench tab", () => {
  const html = ui.renderOverview({ targets: [targetSummary()], matterId: MATTER_ID });
  assert.match(html, /生成或撰写草稿/);
  assert.match(html, new RegExp(`/v6/matters/${MATTER_ID}/targets/${TARGET_ID}/draft`));
  assert.match(html, /修订 ID/);
  assert.match(html, new RegExp(`<details[^>]*>[\\s\\S]*?${TARGET_ID}`));
});

test("global activity starts with all matters and keeps internal identifiers in technical details", () => {
  const html = ui.renderActivity({
    data: {
      matters: [{ id: MATTER_ID, title: "节能装置" }],
      events: [{
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        tenantId: ACTOR.tenantId,
        matterId: MATTER_ID,
        targetId: TARGET_ID,
        actorId: ACTOR.userId,
        actorKind: "user",
        action: "job.failed",
        snapshot: null,
        jobId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        resourceId: null,
        occurredAt: "2026-11-10T12:30:00.000Z",
        metadata: { stage: "checks", errorCode: "PROVIDER_TIMEOUT" },
      }],
      loadedAt: 0,
    },
    error: null,
    refreshing: false,
    currentMatterId: "",
    onRetry() {},
  });
  assert.match(html, /全部可访问案件/);
  assert.match(html, /操作者：本机用户（自报）/);
  assert.match(html, /案件：节能装置/);
  assert.match(html, /目标：目标记录/);
  assert.match(html, /技术详情/);
  assert.match(html, /错误码：/);
  assert.match(html, /bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/);
});

test("matter list translates route and next action while placing IDs under disclosure", () => {
  const matter = {
    id: MATTER_ID,
    tenantId: ACTOR.tenantId,
    version: 1,
    title: "节能装置",
    status: "active",
    sourceVersion: 1,
    createdBy: ACTOR.userId,
    createdAt: "2026-11-10T10:00:00.000Z",
    updatedAt: "2026-11-10T12:30:00.000Z",
  };
  const html = ui.renderMatters({
    repository: {},
    actor: ACTOR,
    initialRows: [{
      matter,
      targets: [{ id: TARGET_ID, status: "active", route: "cn_um", configVersion: 1, nextAction: "generate_draft" }],
      nextAction: "generate_draft",
    }],
  });
  assert.match(html, /中国实用新型/);
  assert.match(html, /生成或撰写草稿/);
  assert.match(html, /更新 2026/);
  assert.match(html, /本机用户/);
  assert.match(html, /案件 ID/);
  assert.match(html, new RegExp(`<details[^>]*>[\\s\\S]*?${MATTER_ID}`));
  assert.doesNotMatch(html, />generate_draft</);
});

test("inbox separates selection, reading and resolution states", () => {
  const open = {
    id: "open-item",
    matterId: MATTER_ID,
    targetId: TARGET_ID,
    kind: "check",
    group: "检查",
    title: "运行或复核检查",
    resourceId: TARGET_ID,
    state: "open",
    readAt: null,
    dueAt: null,
    createdAt: "2026-11-10T10:00:00.000Z",
    actionPath: `/v6/matters/${MATTER_ID}/check?target=${TARGET_ID}`,
    actionKind: "run_check",
  };
  const resolved = { ...open, id: "resolved-item", title: "检查已完成", state: "resolved", readAt: "2026-11-10T11:00:00.000Z" };
  const html = ui.renderInbox({ repository: {}, actor: ACTOR, initialItems: [open, resolved] });
  assert.match(html, /class="work page-work"/);
  assert.match(html, /class="listpane"/);
  assert.match(html, /class="detailpane"/);
  assert.match(html, /data-testid="inbox-detail"/);
  assert.match(html, /待处理 · 未读/);
  assert.match(html, /已解决 · 已读/);
  assert.match(html, /data-state="open"/);
  assert.match(html, /data-state="resolved"/);
  assert.match(html, /标记已读/);
  assert.match(html, /标记已读不会改变处理状态/);
  assert.match(html, /技术标识/);
});

test("target setup offers names and evidence labels without asking users to enter IDs", () => {
  const routeCard = {
    route: "cn_um",
    label: "中国实用新型",
    protection: "产品的形状和构造",
    examination: "初步审查",
    limits: [{ reason: "R1 只生成中文准备稿", state: "available" }],
    verification: "verified",
    verificationLabel: "已核实",
    ruleId: "rules.cn_um",
    recommended: true,
    excludedBy: null,
    foreign: false,
    foreignWarning: null,
    defaultLanguage: "zh-CN",
    languageOptions: [
      { value: "zh-CN", label: "中文（zh-CN）", disabled: false, reason: null },
      { value: "en-US", label: "英文（en-US）", disabled: true, reason: "暂不可用" },
    ],
    cycle: { value: null, note: null, verified: false, label: "周期" },
    fee: { value: null, note: null, verified: false, label: "费用" },
    term: { value: null, note: null, verified: false, label: "保护期" },
  };
  const view = {
    matterId: MATTER_ID,
    matterVersion: 1,
    matterStatus: "active",
    sourceVersion: 1,
    targets: [],
    routeCards: [routeCard],
    recommendation: { recommended: ["cn_um"], rules: [], excluded: [], fallback: false },
    recommended: true,
    parties: [{ id: PARTY_ID, name: "发明人甲", kind: "person" }, { id: "org-1", name: "示例研究所", kind: "organization" }],
    evidenceAssets: [{ id: ASSET_ID, name: "基础申请证明.pdf" }],
    capabilities: [],
    snapshotEmpty: false,
  };
  const html = ui.renderTargets({
    view,
    loading: false,
    loadError: null,
    stale: null,
    busy: false,
    notice: null,
    actionError: null,
    localProblem: null,
    selectedTargetId: null,
    actions: { refresh() {}, select() {}, async create() {}, async update() {} },
  });
  assert.match(html, /发明人甲/);
  assert.match(html, /示例研究所/);
  assert.match(html, /基础申请证明\.pdf/);
  assert.match(html, /申请人/);
  assert.match(html, /证据材料/);
  assert.doesNotMatch(html, /人员 id|证据材料 id/);
  assert.doesNotMatch(html, new RegExp(PARTY_ID));
});
