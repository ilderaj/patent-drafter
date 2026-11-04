import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

import { ACTOR, createInput, matterId, memoryRepository } from "./harness.mjs";
import { createMatter } from "../../../../apps/web/src/v6/features/matters/matters.ts";
import { loadInbox, markInboxItemRead } from "../../../../apps/web/src/v6/features/inbox/inbox.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../../../..");
const MATTERS_SOURCE = join(ROOT, "apps/web/src/v6/features/matters/Matters.tsx");
const INBOX_SOURCE = join(ROOT, "apps/web/src/v6/features/inbox/Inbox.tsx");
let outdir;
let ui;

before(async () => {
  outdir = mkdtempSync(join(tmpdir(), "v6-21-bundle-"));
  const outfile = join(outdir, "v6-21-ui.cjs");
  const harness = `
    import { renderToStaticMarkup } from "react-dom/server";
    import { MemoryRouter } from "react-router-dom";
    import { MattersPage } from ${JSON.stringify(MATTERS_SOURCE)};
    import { InboxPage } from ${JSON.stringify(INBOX_SOURCE)};
    export function renderMatters(props) { return renderToStaticMarkup(<MemoryRouter><MattersPage {...props} /></MemoryRouter>); }
    export function renderInbox(props) { return renderToStaticMarkup(<MemoryRouter><InboxPage {...props} /></MemoryRouter>); }
  `;
  await esbuild.build({
    stdin: { contents: harness, resolveDir: ROOT, sourcefile: "v6-21-ui-harness.tsx", loader: "tsx" },
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

test("empty, loading, error and retained states are distinguishable", async () => {
  const { backend, repository } = memoryRepository();
  const loading = ui.renderMatters({ repository, actor: ACTOR });
  assert.match(loading, /data-testid="matters-loading"/);
  const empty = ui.renderMatters({ repository, actor: ACTOR, initialRows: [] });
  assert.match(empty, /data-testid="matters-empty"/);
  assert.match(empty, /创建案件/);
  assert.match(empty, /从上传材料开始/);
  assert.doesNotMatch(empty, /示例案件|示例待办/);

  const errorWithRetained = ui.renderMatters({
    repository,
    actor: ACTOR,
    initialRows: [{ matter: { id: matterId(41), version: 1, title: "保留页", status: "active", createdBy: ACTOR.userId, updatedAt: "2026-11-01T00:00:00.000Z" }, targets: [], nextAction: "add_sources" }],
    initialLoadError: "本机存储暂时不可用。",
  });
  assert.match(errorWithRetained, /data-testid="matters-error"/);
  assert.match(errorWithRetained, /保留页/);
  assert.doesNotMatch(errorWithRetained, /data-testid="matters-empty"/);

  const inboxLoading = ui.renderInbox({ repository, actor: ACTOR });
  assert.match(inboxLoading, /data-testid="inbox-loading"/);
  const inboxEmpty = ui.renderInbox({ repository, actor: ACTOR, initialItems: [] });
  assert.match(inboxEmpty, /data-testid="inbox-empty"/);
  assert.match(inboxEmpty, /暂无待办/);
  assert.doesNotMatch(inboxEmpty, /示例|demo|sample/i);
  const inboxError = ui.renderInbox({ repository, actor: ACTOR, initialItems: [], initialLoadError: "存储失败" });
  assert.match(inboxError, /data-testid="inbox-error"/);
  assert.doesNotMatch(inboxError, /data-testid="inbox-empty"/);
  backend.closed = true;
});

test("read cursor is per user; it does not change conflict state or matter version", async () => {
  const { backend, repository } = memoryRepository();
  const id = matterId(88);
  await createMatter(repository, ACTOR, createInput(id, "已读光标", 88));
  const conflictId = "aaaaaaaa-aaaa-4aaa-8aaa-000000000088";
  await backend.transaction("readwrite", (tx) => tx.put("blobs", `intake/snapshot/${id}/1`, {
    kind: "intake.snapshot",
    snapshot: {
      matterId: id,
      version: 1,
      conflicts: [{ id: conflictId, factIds: [], state: "open", chosenFactIds: [], reason: null }],
      answers: { problem: "", difference: "", inventorIds: [], disclosure: null, maturity: null },
      createdAt: "2026-11-01T00:00:00.000Z",
    },
  }));
  const view = await loadInbox(repository, ACTOR);
  const item = view.data.items[0];
  const read = await markInboxItemRead(repository, ACTOR, id, item.id, "2026-11-01T01:00:00.000Z");
  assert.equal(read.ok, true);
  assert.equal(read.data.state, "open");
  const outsider = Object.freeze({ tenantId: ACTOR.tenantId, userId: "22222222-2222-4222-8222-222222222222" });
  const outsiderView = await loadInbox(repository, outsider);
  assert.equal(outsiderView.ok, true);
  assert.equal(outsiderView.data.items.length, 0);
  const ownerAgain = await loadInbox(repository, ACTOR);
  assert.equal(ownerAgain.data.items[0].readAt, "2026-11-01T01:00:00.000Z");
  assert.equal((await repository.loadMatter(ACTOR, id)).data.version, 1);
});
