import assert from "node:assert/strict";
import test from "node:test";
import { register } from "tsx/esm/api";

register();

const [React, ReactDomServer, contracts, repositoryModule, generationModule, previewModule, previewUi] = await Promise.all([
  import("react"),
  import("react-dom/server"),
  import("../../../../packages/contracts/src/index.ts"),
  import("../../../../apps/web/src/v6/lib/repository.ts"),
  import("../../../../apps/web/src/v6/features/generation/generation.ts"),
  import("../../../../apps/web/src/v6/features/preview/preview.ts"),
  import("../../../../apps/web/src/v6/features/preview/Preview.tsx"),
]);
const confirmationModule = await import("../../../../packages/domain/src/v6/confirmation.ts");

const ACTOR = Object.freeze({
  tenantId: "11111111-1111-4111-8111-111111111111",
  userId: "22222222-2222-4222-8222-222222222222",
});
const MATTER_ID = "33333333-3333-4333-8333-333333333333";
const TARGET_ID = "44444444-4444-4444-8444-444444444444";
const FIGURE_ID = "55555555-5555-4555-8555-555555555555";
const CLAIM_ID = "66666666-6666-4666-8666-666666666661";
const CLAIM_PARAGRAPH_ID = "77777777-7777-4777-8777-777777777771";
const TECHNICAL_PARAGRAPH_ID = "77777777-7777-4777-8777-777777777772";
const BACKGROUND_PARAGRAPH_ID = "77777777-7777-4777-8777-777777777773";
const SUMMARY_PARAGRAPH_ID = "77777777-7777-4777-8777-777777777774";
const FIGURES_PARAGRAPH_ID = "77777777-7777-4777-8777-777777777775";
const LOCKED_PARAGRAPH_ID = "77777777-7777-4777-8777-777777777776";
const ABSTRACT_PARAGRAPH_ID = "77777777-7777-4777-8777-777777777777";
const RISK_ID = "88888888-8888-4888-8888-888888888881";
const JOB_ID = "99999999-9999-4999-8999-999999999999";
const LOCKED_TEXT = "V6-20 合成锁定正文 只用于隐私边界测试。";
const T0 = "2026-11-05T12:00:00.000Z";
const T1 = "2026-11-05T12:05:00.000Z";

class MemoryBackend {
  constructor() {
    this.data = new Map(Object.values(repositoryModule.STORES).map((name) => [name, new Map()]));
    this.queue = Promise.resolve();
  }

  transaction(mode, run) {
    if (mode !== "readwrite") return this.runTransaction(run);
    const next = this.queue.then(() => this.runTransaction(run));
    this.queue = next.then(() => undefined, () => undefined);
    return next;
  }

  async runTransaction(run) {
    const before = new Map([...this.data].map(([name, store]) => [name, new Map(store)]));
    const tx = {
      get: async (store, key) => {
        const value = this.data.get(store).get(key);
        return value === undefined ? undefined : structuredClone(value);
      },
      put: async (store, key, value) => this.data.get(store).set(key, structuredClone(value)),
      delete: async (store, key) => this.data.get(store).delete(key),
      getAll: async (store) => [...this.data.get(store).values()].map((value) => structuredClone(value)),
      getAllByIndex: async (store, index, value) => [...this.data.get(store).values()]
        .filter((row) => row && typeof row === "object" && row[index] === value)
        .map((row) => structuredClone(row)),
    };
    try {
      return await run(tx);
    } catch (error) {
      this.data = before;
      throw error;
    }
  }

  close() {}
}

function paragraph(id, text, origin = "ai") {
  return {
    id,
    text,
    origin,
    sourceRefs: [],
    factIds: [],
    figureIds: [],
    generationJobId: origin === "human" ? null : JOB_ID,
  };
}

function makeAst() {
  return {
    schemaVersion: "draft.v1",
    language: "zh-CN",
    title: "V6-20 合成草稿",
    claims: [{
      id: CLAIM_ID,
      number: 1,
      dependsOn: [],
      paragraphs: [paragraph(CLAIM_PARAGRAPH_ID, "权利要求书合成内容。")],
      features: [],
    }],
    sections: [
      { kind: "technical_field", paragraphs: [paragraph(TECHNICAL_PARAGRAPH_ID, "合成技术领域。", "human")] },
      { kind: "background", paragraphs: [paragraph(BACKGROUND_PARAGRAPH_ID, "合成背景技术。", "human")] },
      { kind: "summary", paragraphs: [paragraph(SUMMARY_PARAGRAPH_ID, "合成发明内容。")] },
      { kind: "figures_description", paragraphs: [paragraph(FIGURES_PARAGRAPH_ID, "合成附图说明。", "human")] },
      { kind: "embodiments", paragraphs: [paragraph(LOCKED_PARAGRAPH_ID, LOCKED_TEXT)] },
      { kind: "abstract", paragraphs: [paragraph(ABSTRACT_PARAGRAPH_ID, "合成摘要。", "human")] },
    ],
  };
}

function makeRisk() {
  return {
    id: RISK_ID,
    category: "risk",
    title: `检查提示：${LOCKED_TEXT}`,
    explanation: `需核对 ${LOCKED_TEXT} 中的结构依据。`,
    ruleId: "synthetic.embodiment.support",
    requiresAcknowledgement: true,
    anchor: { nodeId: LOCKED_PARAGRAPH_ID, section: "embodiments", locked: true },
  };
}

function idFactory(prefix) {
  let sequence = 0;
  return () => `${prefix.slice(0, 24)}-${String(++sequence).padStart(12, "0")}`;
}

async function fixture() {
  const backend = new MemoryBackend();
  const repository = repositoryModule.openLocalRepository(backend);
  const created = await repository.commit(ACTOR, {
    contractVersion: repositoryModule.CONTRACT_VERSION,
    expectedVersion: 0,
    payload: {
      matter: {
        id: MATTER_ID,
        tenantId: ACTOR.tenantId,
        version: 1,
        title: "V6-20 合成案件",
        status: "active",
        sourceVersion: 1,
        createdBy: ACTOR.userId,
        createdAt: T0,
        updatedAt: T0,
      },
      targets: [{
        id: TARGET_ID,
        matterId: MATTER_ID,
        status: "active",
        configVersion: 1,
        draftRevisionId: null,
        figureRevisionId: FIGURE_ID,
      }],
      assets: [],
      events: [],
      blobs: [],
    },
  }, { requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1" });
  assert.equal(created.ok, true, created.ok ? "" : JSON.stringify(created.error));

  const ast = makeAst();
  assert.equal(contracts.draftAstSchema.safeParse(ast).success, true);
  let revisionSequence = 0;
  const revisions = generationModule.createGenerationRevisionStore({
    repository,
    actor: ACTOR,
    now: () => new Date(T0),
    newId: () => `bbbbbbbb-bbbb-4bbb-8bbb-${String(++revisionSequence).padStart(12, "0")}`,
  });
  const saved = await revisions.saveEditedRevision(MATTER_ID, TARGET_ID, null, ast);
  assert.equal(saved.ok, true, saved.ok ? "" : JSON.stringify(saved.error));
  return { backend, repository, revision: saved.data, ast, risk: makeRisk() };
}

function renderContents(ready, highlightedAnchor = null) {
  return ReactDomServer.renderToStaticMarkup(React.createElement(previewUi.PreviewContents, {
    ready,
    highlightedAnchor,
    onLocate() {},
  }));
}

function ledgerRows(backend) {
  return [...backend.data.get(repositoryModule.STORES.blobs).values()]
    .filter((row) => row?.kind === "draft-review.confirmations");
}

test("V6-20-A01: a current full local draft records one contract-shaped full_read", async () => {
  const current = await fixture();
  const preview = await previewModule.loadLocalPreview(
    current.repository, ACTOR, MATTER_ID, TARGET_ID, "local_unmetered", [current.risk],
  );
  assert.equal(preview.kind, "ready");
  assert.equal(preview.isCurrent, true);
  assert.ok(preview.projection.fullDraft, "the local_unmetered projection contains the complete draft");
  assert.ok(preview.projection.fullDraft.ast.sections.find((section) => section.kind === "embodiments")
    .paragraphs[0].text.includes(LOCKED_TEXT));

  const confirmed = await previewModule.confirmLocalFullRead({
    repository: current.repository,
    actor: ACTOR,
    snapshot: preview.projection.preview.snapshot,
    access: "local_unmetered",
    newId: idFactory("cccccccc-cccc-4ccc-8ccc"),
    now: () => T1,
  });
  assert.equal(confirmed.ok, true, confirmed.ok ? "" : JSON.stringify(confirmed.error));
  assert.equal(confirmed.created, true);
  assert.equal(confirmed.confirmation.kind, "full_read");
  assert.equal(confirmed.confirmation.identity, "local_self_reported");
  assert.equal(confirmed.confirmation.actorId, ACTOR.userId);
  assert.equal(confirmed.confirmation.createdAt, T1);
  assert.equal(contracts.confirmationSchema.safeParse(confirmed.confirmation).success, true);
  assert.equal(ledgerRows(current.backend).length, 1);
  const activity = await current.repository.listEvents(ACTOR, MATTER_ID);
  assert.equal(activity.ok, true);
  const confirmationEvents = activity.data.items.filter((event) => event.action === "confirmation.created");
  assert.equal(confirmationEvents.length, 1);
  assert.equal(confirmationEvents[0].resourceId, confirmed.confirmation.id);
  assert.equal(contracts.activitySchema.safeParse(confirmationEvents[0]).success, true);
  const committedMatter = await current.repository.loadMatter(ACTOR, MATTER_ID);
  assert.equal(committedMatter.data.data.matter.version, 3, "confirmation increments the matter version once");
  assert.match(renderContents(preview), /V6-20 合成锁定正文/);
  assert.match(renderContents(preview), /◇/);
});

test("V6-20-A02: preview-only projection and stale snapshots cannot create full_read", async () => {
  const current = await fixture();
  const preview = await previewModule.loadLocalPreview(
    current.repository, ACTOR, MATTER_ID, TARGET_ID, "preview", [current.risk],
  );
  assert.equal(preview.kind, "ready");
  assert.equal(preview.projection.fullDraft, null);
  assert.deepEqual(preview.projection.preview.lockedSections, ["summary", "figures_description", "embodiments", "abstract"]);
  assert.equal(contracts.previewSchema.safeParse(preview.projection.preview).success, true);
  assert.equal(JSON.stringify(preview.projection.preview).includes(LOCKED_TEXT), false);
  assert.equal(preview.projection.preview.risks[0].anchor.section, "embodiments");
  assert.equal(preview.projection.preview.risks[0].anchor.locked, true);
  assert.match(preview.projection.preview.risks[0].explanation, /具体实施方式/);
  assert.equal(preview.projection.preview.risks[0].explanation.includes(LOCKED_TEXT), false);
  const markup = renderContents(preview);
  assert.doesNotMatch(markup, /V6-20 合成锁定正文/);
  assert.match(markup, /data-locked="true"/);

  const refused = await previewModule.confirmLocalFullRead({
    repository: current.repository,
    actor: ACTOR,
    snapshot: preview.projection.preview.snapshot,
    access: "preview",
    newId: idFactory("dddddddd-dddd-4ddd-8ddd"),
    now: () => T1,
  });
  assert.equal(refused.ok, false);
  assert.equal(refused.error.code, "ACTION_FORBIDDEN");
  assert.equal(ledgerRows(current.backend).length, 0);

  const changed = await current.repository.loadMatter(ACTOR, MATTER_ID);
  assert.equal(changed.ok, true);
  const aggregate = changed.data.data;
  const updated = await current.repository.commit(ACTOR, {
    contractVersion: repositoryModule.CONTRACT_VERSION,
    expectedVersion: aggregate.matter.version,
    payload: {
      matter: { ...aggregate.matter, sourceVersion: 2, version: aggregate.matter.version + 1, updatedAt: T1 },
      targets: aggregate.targets,
      assets: aggregate.assets,
      events: [],
      blobs: [],
    },
  }, { requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2" });
  assert.equal(updated.ok, true, updated.ok ? "" : JSON.stringify(updated.error));
  const stale = await previewModule.confirmLocalFullRead({
    repository: current.repository,
    actor: ACTOR,
    snapshot: preview.projection.preview.snapshot,
    access: "local_unmetered",
    newId: idFactory("eeeeeeee-eeee-4eee-8eee"),
    now: () => T1,
  });
  assert.equal(stale.ok, false);
  assert.equal(stale.error.code, "STALE_BINDING");
  assert.equal(ledgerRows(current.backend).length, 0);
});

test("V6-20-A03: reload and repeated confirmation return the same stored row", async () => {
  const current = await fixture();
  const firstRead = await previewModule.loadLocalPreview(
    current.repository, ACTOR, MATTER_ID, TARGET_ID, "local_unmetered", [current.risk],
  );
  assert.equal(firstRead.kind, "ready");
  const first = await previewModule.confirmLocalFullRead({
    repository: current.repository,
    actor: ACTOR,
    snapshot: firstRead.projection.preview.snapshot,
    access: "local_unmetered",
    newId: idFactory("ffffffff-ffff-4fff-8fff"),
    now: () => T1,
  });
  assert.equal(first.ok, true);
  assert.equal(first.created, true);

  const refreshed = await previewModule.loadLocalPreview(
    current.repository, ACTOR, MATTER_ID, TARGET_ID, "local_unmetered", [current.risk],
  );
  assert.equal(refreshed.kind, "ready");
  assert.equal(refreshed.confirmation.id, first.confirmation.id);
  assert.equal(refreshed.confirmation.createdAt, T1);

  const repeated = await previewModule.confirmLocalFullRead({
    repository: current.repository,
    actor: ACTOR,
    snapshot: refreshed.projection.preview.snapshot,
    access: "local_unmetered",
    newId: idFactory("00000000-0000-4000-8000"),
    now: () => "2026-11-05T12:06:00.000Z",
  });
  assert.equal(repeated.ok, true);
  assert.equal(repeated.created, false);
  assert.equal(repeated.confirmation.id, first.confirmation.id);
  assert.equal(ledgerRows(current.backend).length, 1);
  const ledger = ledgerRows(current.backend)[0].ledger;
  assert.equal(ledger.confirmations.filter((item) => item.kind === "full_read").length, 1);
  const events = await current.repository.listEvents(ACTOR, MATTER_ID);
  assert.equal(events.ok, true);
  assert.equal(events.data.items.filter((event) => event.action === "confirmation.created").length, 1);
  const matter = await current.repository.loadMatter(ACTOR, MATTER_ID);
  assert.equal(matter.data.data.matter.version, 3, "replay does not advance the matter version");
});

test("V6-20-A03: a revoked full_read is hidden and retry creates a new live row", async () => {
  const current = await fixture();
  const firstRead = await previewModule.loadLocalPreview(
    current.repository, ACTOR, MATTER_ID, TARGET_ID, "local_unmetered", [current.risk],
  );
  assert.equal(firstRead.kind, "ready");
  const first = await previewModule.confirmLocalFullRead({
    repository: current.repository,
    actor: ACTOR,
    snapshot: firstRead.projection.preview.snapshot,
    access: "local_unmetered",
    newId: idFactory("abababab-abab-4bab-8bab"),
    now: () => T1,
  });
  assert.equal(first.ok, true);
  assert.equal(first.created, true);

  const [ledgerKey, storedRow] = [...current.backend.data.get(repositoryModule.STORES.blobs).entries()]
    .find(([, row]) => row?.kind === "draft-review.confirmations");
  const revoked = confirmationModule.revokeConfirmation(
    storedRow.ledger,
    { confirmationId: first.confirmation.id, actorId: ACTOR.userId, reason: "需要重新核对" },
    { newId: idFactory("acacacac-acac-4cac-8cac"), now: () => "2026-11-05T12:06:00.000Z" },
  );
  assert.equal(revoked.ok, true);
  await current.backend.transaction("readwrite", (tx) => tx.put(repositoryModule.STORES.blobs, ledgerKey, {
    ...storedRow,
    ledger: revoked.state,
  }));

  const afterRevocation = await previewModule.loadLocalPreview(
    current.repository, ACTOR, MATTER_ID, TARGET_ID, "local_unmetered", [current.risk],
  );
  assert.equal(afterRevocation.kind, "ready");
  assert.equal(afterRevocation.confirmation, null, "a revoked row is never presented as confirmed");
  assert.equal(confirmationModule.currentConfirmations(revoked.state, firstRead.projection.preview.snapshot).length, 0);

  const retried = await previewModule.confirmLocalFullRead({
    repository: current.repository,
    actor: ACTOR,
    snapshot: firstRead.projection.preview.snapshot,
    access: "local_unmetered",
    newId: idFactory("adadadad-adad-4dad-8dad"),
    now: () => "2026-11-05T12:07:00.000Z",
  });
  assert.equal(retried.ok, true);
  assert.equal(retried.created, true);
  assert.notEqual(retried.confirmation.id, first.confirmation.id);
  const finalLedger = ledgerRows(current.backend)[0].ledger;
  const live = confirmationModule.currentConfirmations(finalLedger, firstRead.projection.preview.snapshot);
  assert.equal(live.length, 1);
  assert.equal(live[0].id, retried.confirmation.id);
  const afterRetry = await previewModule.loadLocalPreview(
    current.repository, ACTOR, MATTER_ID, TARGET_ID, "local_unmetered", [current.risk],
  );
  assert.equal(afterRetry.kind, "ready");
  assert.equal(afterRetry.confirmation.id, retried.confirmation.id);
});

test("inputStale compares source, target config and figure input versions", async () => {
  const changes = [
    { key: "sourceVersion", requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3" },
    { key: "targetConfigVersion", requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4" },
    { key: "figureRevisionId", requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5" },
  ];
  for (const change of changes) {
    const current = await fixture();
    const before = await previewModule.loadLocalPreview(
      current.repository, ACTOR, MATTER_ID, TARGET_ID, "local_unmetered", [current.risk],
    );
    assert.equal(before.kind, "ready");
    const loaded = await current.repository.loadMatter(ACTOR, MATTER_ID);
    assert.equal(loaded.ok, true);
    const aggregate = loaded.data.data;
    const targets = aggregate.targets.map((target) => target.id !== TARGET_ID ? target : {
      ...target,
      ...(change.key === "targetConfigVersion" ? { configVersion: target.configVersion + 1 } : {}),
      ...(change.key === "figureRevisionId" ? { figureRevisionId: "14141414-1414-4141-8141-141414141414" } : {}),
    });
    const updated = await current.repository.commit(ACTOR, {
      contractVersion: repositoryModule.CONTRACT_VERSION,
      expectedVersion: aggregate.matter.version,
      payload: {
        matter: {
          ...aggregate.matter,
          version: aggregate.matter.version + 1,
          sourceVersion: change.key === "sourceVersion" ? aggregate.matter.sourceVersion + 1 : aggregate.matter.sourceVersion,
          updatedAt: T1,
        },
        targets,
        assets: aggregate.assets,
        events: [],
        blobs: [],
      },
    }, { requestId: change.requestId });
    assert.equal(updated.ok, true, updated.ok ? "" : JSON.stringify(updated.error));

    const preview = await previewModule.loadLocalPreview(
      current.repository, ACTOR, MATTER_ID, TARGET_ID, "local_unmetered", [current.risk],
    );
    assert.equal(preview.kind, "ready");
    assert.equal(preview.isCurrent, false, `${change.key} changes the snapshot binding`);
    assert.equal(preview.projection.preview.inputStale, true, `${change.key} changes the adopted DraftInputRef`);
    const staleConfirm = await previewModule.confirmLocalFullRead({
      repository: current.repository,
      actor: ACTOR,
      snapshot: before.projection.preview.snapshot,
      access: "local_unmetered",
      newId: idFactory("aeaeaeae-aeae-4eae-8eae"),
      now: () => T1,
    });
    assert.equal(staleConfirm.ok, false, `${change.key} must not produce a full_read`);
    assert.equal(staleConfirm.error.code, "STALE_BINDING");
    assert.equal(ledgerRows(current.backend).length, 0);
  }
});

test("S05-A01/A02: preview DTO and risk cards preserve the anchor without locked text", async () => {
  const current = await fixture();
  const preview = await previewModule.loadLocalPreview(
    current.repository, ACTOR, MATTER_ID, TARGET_ID, "preview", [current.risk],
  );
  assert.equal(preview.kind, "ready");
  assert.equal(preview.projection.preview.claims[0].paragraphs[0].text, "权利要求书合成内容。");
  assert.equal(preview.projection.preview.technicalField[0].text, "合成技术领域。");
  assert.equal(preview.projection.preview.background[0].text, "合成背景技术。");
  assert.equal(JSON.stringify(preview.projection.preview).includes(LOCKED_TEXT), false);
  const riskMarkup = ReactDomServer.renderToStaticMarkup(React.createElement(previewUi.PreviewContents, {
    ready: preview,
    highlightedAnchor: null,
    onLocate() {},
  }));
  assert.doesNotMatch(riskMarkup, /V6-20 合成锁定正文/);
  assert.match(riskMarkup, /data-testid="preview-section-embodiments"/);
  assert.match(riskMarkup, /data-locked="true"/);
});

test("locked risk excerpts are replaced while unlocked risk text stays intact", async () => {
  const current = await fixture();
  const revision = current.revision;
  const ast = structuredClone(revision.ast);
  const lockedParagraph = ast.sections.find((section) => section.kind === "embodiments").paragraphs[0];
  const sourceRef = {
    sourceId: "12121212-1212-4121-8121-121212121212",
    chunkId: "13131313-1313-4131-8131-131313131313",
    chunkHash: "a".repeat(64),
    page: 1,
    start: 0,
    end: LOCKED_TEXT.length,
    quote: LOCKED_TEXT,
  };
  lockedParagraph.sourceRefs = [sourceRef];
  const revisionWithSourceRef = { ...revision, ast };
  const titleQuote = LOCKED_TEXT.slice(0, 14);
  const explanationQuote = LOCKED_TEXT.slice(12, 28);
  const lockedRisk = {
    ...current.risk,
    title: `检查提示：${titleQuote}`,
    explanation: `需要核对“${explanationQuote}”的支持依据。`,
  };
  const unlockedRisk = {
    ...current.risk,
    id: "88888888-8888-4888-8888-888888888882",
    title: "技术领域范围待核对",
    explanation: "请核验公开技术范围与引用日期。",
    anchor: { nodeId: TECHNICAL_PARAGRAPH_ID, section: "technical_field", locked: false },
  };
  const projection = previewModule.buildPreviewProjection({
    revision: revisionWithSourceRef,
    access: "preview",
    risks: [lockedRisk, unlockedRisk],
    inputStale: false,
  });
  const dto = JSON.stringify(projection.preview);
  const redactedRisk = projection.preview.risks[0];
  assert.equal(dto.includes(LOCKED_TEXT), false, "locked paragraph body and sourceRef quote are omitted");
  assert.equal(dto.includes(titleQuote), false, "a title excerpt is removed");
  assert.equal(dto.includes(explanationQuote), false, "an explanation excerpt is removed");
  assert.match(redactedRisk.title, /具体实施方式风险/);
  assert.match(redactedRisk.explanation, /具体实施方式/);
  assert.equal(redactedRisk.category, lockedRisk.category);
  assert.equal(redactedRisk.ruleId, lockedRisk.ruleId);
  assert.equal(redactedRisk.anchor.nodeId, LOCKED_PARAGRAPH_ID);
  assert.equal(redactedRisk.anchor.section, "embodiments");
  assert.equal(redactedRisk.anchor.locked, true);
  assert.equal(projection.preview.risks[1].title, unlockedRisk.title);
  assert.equal(projection.preview.risks[1].explanation, unlockedRisk.explanation);
});

test("S05-A09: local_unmetered shows every section and the no-fee label without pay controls", async () => {
  const current = await fixture();
  const local = await previewModule.loadLocalPreview(
    current.repository, ACTOR, MATTER_ID, TARGET_ID, "local_unmetered", [current.risk],
  );
  assert.equal(local.kind, "ready");
  assert.deepEqual(local.projection.preview.lockedSections, []);
  assert.ok(local.projection.fullDraft);
  const markup = renderContents(local);
  for (const label of ["技术领域", "背景技术", "发明内容", "附图说明", "具体实施方式", "摘要"]) assert.match(markup, new RegExp(label));
  assert.match(markup, /V6-20 合成锁定正文/);
  assert.doesNotMatch(markup, /支付|解锁/);
  assert.equal(previewModule.riskPresentation("blocker").label, "阻断");
  assert.equal(previewModule.riskPresentation("risk").label, "风险");
  assert.equal(previewModule.riskPresentation("unverified").label, "待核实");
  assert.equal(previewModule.riskPresentation("policy").label, "产品政策");
});

test("S05 UI empty/loading/error states offer the specified recovery actions", async () => {
  const current = await fixture();
  const common = {
    repository: current.repository,
    actor: ACTOR,
    matterId: MATTER_ID,
    targetId: TARGET_ID,
    access: "local_unmetered",
  };
  const loading = ReactDomServer.renderToStaticMarkup(React.createElement(previewUi.PreviewLoading));
  assert.match(loading, /aria-busy="true"/);
  const error = ReactDomServer.renderToStaticMarkup(React.createElement(previewUi.PreviewError, {
    code: "STORAGE_UNAVAILABLE",
    message: "无法读取本机草稿，请重试。",
    onRetry() {},
  }));
  assert.match(error, /重试/);
  const empty = ReactDomServer.renderToStaticMarkup(React.createElement(previewUi.PreviewEmpty, common));
  assert.match(empty, /生成草稿/);
  assert.match(empty, /手工撰写/);
  assert.match(empty, new RegExp(`/v6/matters/${MATTER_ID}/targets/${TARGET_ID}/draft`));
  assert.equal((await previewModule.loadLocalPreview(current.repository, ACTOR, MATTER_ID, "missing-target", "local_unmetered")).kind, "failed");
});
