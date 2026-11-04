import assert from "node:assert/strict";
import test from "node:test";
import { register } from "tsx/esm/api";

register();

const [{ createElement }, { renderToStaticMarkup }, contracts, repositoryModule, generationModule, adapter, editor] = await Promise.all([
  import("react"),
  import("react-dom/server"),
  import("../../../../packages/contracts/src/index.ts"),
  import("../../../../apps/web/src/v6/lib/repository.ts"),
  import("../../../../apps/web/src/v6/features/generation/generation.ts"),
  import("../../../../apps/web/src/v6/features/draft/ast-adapter.ts"),
  import("../../../../apps/web/src/v6/features/draft/Editor.tsx"),
]);

const ACTOR = Object.freeze({
  tenantId: "11111111-1111-4111-8111-111111111111",
  userId: "22222222-2222-4222-8222-222222222222",
});
const MATTER_ID = "33333333-3333-4333-8333-333333333333";
const TARGET_ID = "44444444-4444-4444-8444-444444444444";
const FIGURE_ID = "55555555-5555-4555-8555-555555555555";
const CLAIM_1 = "66666666-6666-4666-8666-666666666661";
const CLAIM_2 = "66666666-6666-4666-8666-666666666662";
const CLAIM_3 = "66666666-6666-4666-8666-666666666663";
const PARAGRAPH_IDS = [
  "77777777-7777-4777-8777-777777777771",
  "77777777-7777-4777-8777-777777777772",
  "77777777-7777-4777-8777-777777777773",
  "77777777-7777-4777-8777-777777777774",
  "77777777-7777-4777-8777-777777777775",
];
const FEATURE_ID = "88888888-8888-4888-8888-888888888881";
const FACT_ID = "99999999-9999-4999-8999-999999999991";
const SOURCE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const CHUNK_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const JOB_ID = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
const T0 = "2026-11-05T12:00:00.000Z";

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

function makeParagraph(id, text) {
  return {
    id,
    text,
    origin: "ai",
    sourceRefs: [],
    factIds: [],
    figureIds: [],
    generationJobId: JOB_ID,
  };
}

function makeAst() {
  const paragraphs = PARAGRAPH_IDS.map((id, index) => makeParagraph(id, `AI 合成段落 ${index + 1}`));
  paragraphs[0].factIds = [FACT_ID];
  return {
    schemaVersion: "draft.v1",
    language: "zh-CN",
    title: "合成草稿",
    claims: [
      {
        id: CLAIM_1,
        number: 1,
        dependsOn: [],
        paragraphs: [paragraphs[0]],
        features: [{
          id: FEATURE_ID,
          text: "温控组件",
          factIds: [FACT_ID],
          supportParagraphIds: [PARAGRAPH_IDS[0], PARAGRAPH_IDS[3]],
          status: "supported",
        }],
      },
      { id: CLAIM_2, number: 2, dependsOn: [CLAIM_1], paragraphs: [paragraphs[1]], features: [] },
      { id: CLAIM_3, number: 3, dependsOn: [CLAIM_2], paragraphs: [paragraphs[2]], features: [] },
    ],
    sections: [
      { kind: "technical_field", paragraphs: [paragraphs[3]] },
      { kind: "background", paragraphs: [paragraphs[4]] },
      { kind: "summary", paragraphs: [] },
      { kind: "figures_description", paragraphs: [] },
      { kind: "embodiments", paragraphs: [] },
      { kind: "abstract", paragraphs: [] },
    ],
  };
}

function makeFact() {
  return {
    id: FACT_ID,
    statement: "热敏元件接收温度信号",
    kind: "structure",
    status: "user_confirmed",
    refs: [{
      sourceId: SOURCE_ID,
      chunkId: CHUNK_ID,
      chunkHash: "a".repeat(64),
      page: 1,
      start: 0,
      end: 4,
      quote: "热敏元件",
    }],
    confirmedBy: ACTOR.userId,
    confirmedAt: T0,
  };
}

function makeSnapshot(fact) {
  return {
    matterId: MATTER_ID,
    version: 1,
    sourceIds: [SOURCE_ID],
    facts: [fact],
    conflicts: [],
    answers: {
      problem: "",
      difference: "",
      inventorIds: [],
      disclosure: null,
      maturity: null,
      disclosureDetail: null,
    },
    parties: [],
    createdBy: ACTOR.userId,
    createdAt: T0,
  };
}

function idFactory() {
  let count = 0;
  return () => `dddddddd-dddd-4ddd-8ddd-${String(++count).padStart(12, "0")}`;
}

async function fixture({ withDraft = true } = {}) {
  const backend = new MemoryBackend();
  const repository = repositoryModule.openLocalRepository(backend);
  const matter = {
    id: MATTER_ID,
    tenantId: ACTOR.tenantId,
    version: 1,
    title: "合成测试案件",
    status: "active",
    sourceVersion: 1,
    createdBy: ACTOR.userId,
    createdAt: T0,
    updatedAt: T0,
  };
  const target = {
    id: TARGET_ID,
    matterId: MATTER_ID,
    status: "active",
    configVersion: 1,
    draftRevisionId: null,
    figureRevisionId: FIGURE_ID,
  };
  const committed = await repository.commit(ACTOR, {
    contractVersion: repositoryModule.CONTRACT_VERSION,
    expectedVersion: 0,
    payload: { matter, targets: [target], assets: [], events: [], blobs: [] },
  }, { requestId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1" });
  assert.equal(committed.ok, true, committed.ok ? "" : JSON.stringify(committed.error));
  const fact = makeFact();
  await backend.transaction("readwrite", (tx) => tx.put(repositoryModule.STORES.blobs,
    `intake/snapshot/${MATTER_ID}/1`, { kind: "intake.snapshot", snapshot: makeSnapshot(fact) }));
  let id = 0;
  const revisions = generationModule.createGenerationRevisionStore({
    repository,
    actor: ACTOR,
    now: () => new Date(T0),
    newId: () => `ffffffff-ffff-4fff-8fff-${String(++id).padStart(12, "0")}`,
  });
  const ast = makeAst();
  assert.equal(contracts.draftAstSchema.safeParse(ast).success, true);
  let initialRevision = null;
  if (withDraft) {
    const saved = await revisions.saveEditedRevision(MATTER_ID, TARGET_ID, null, ast);
    assert.equal(saved.ok, true, saved.ok ? "" : JSON.stringify(saved.error));
    initialRevision = saved.data;
  }
  const buffers = new editor.IndexedDbDraftBufferStore(backend, ACTOR);
  const makeSession = (newId = idFactory()) => new editor.DraftEditorSession({
    repository,
    actor: ACTOR,
    matterId: MATTER_ID,
    targetId: TARGET_ID,
    revisions,
    bufferStore: buffers,
    newId,
    now: () => T0,
  });
  return { backend, repository, revisions, buffers, ast, initialRevision, fact, makeSession };
}

async function eventsFor(fixtureValue) {
  const result = await fixtureValue.repository.listEvents(ACTOR, MATTER_ID);
  assert.equal(result.ok, true);
  return result.data.items.filter((event) => event.action === "revision.created");
}

test("V6-18 A01: edited DraftRevision is the preview and export projection source", async () => {
  const current = await fixture();
  const original = structuredClone(current.ast);
  const session = current.makeSession();
  await session.load();
  assert.equal(session.getSnapshot().supportRows[0].facts[0].statement, current.fact.statement);
  assert.equal(session.getSnapshot().supportRows[0].sourceRefs[0].quote, "热敏元件");
  const traced = adapter.buildSupportTable(current.ast, [current.fact], [{
    country: "CN",
    applicationNumber: "SYNTHETIC-1",
    filedOn: "2025-01-02",
    evidenceAssetId: null,
    verification: "human_confirmed",
  }]);
  assert.deepEqual(traced[0].factIds, [FACT_ID]);
  assert.deepEqual(traced[0].supportParagraphIds, [PARAGRAPH_IDS[0], PARAGRAPH_IDS[3]]);
  assert.equal(traced[0].sourceRefs[0].quote, "热敏元件");
  assert.equal(traced[0].priorityClaims[0].verification, "human_confirmed");

  const firstRevision = current.initialRevision;
  await session.updateParagraph({ claimId: CLAIM_1 }, 0, "人工编辑后的权利要求段落");
  await session.refresh();
  assert.equal(session.getSnapshot().model.claims[0].paragraphs[0].text, "人工编辑后的权利要求段落");
  const saved = await session.save();
  assert.ok(saved);
  assert.notEqual(saved.id, firstRevision.id);
  assert.equal(saved.reason, "edited");
  assert.equal(saved.parentId, firstRevision.id);
  assert.equal(saved.ast.claims[0].paragraphs[0].text, "人工编辑后的权利要求段落");
  assert.equal(saved.ast.claims[0].paragraphs[0].origin, "mixed");

  const [preview, exported] = [adapter.projectDraftPreview(saved), adapter.projectDraftExport(saved)];
  for (const projection of [preview, exported]) {
    assert.equal(projection.revisionId, saved.id);
    assert.equal(projection.snapshot.draftRevisionId, saved.id);
    assert.equal(projection.snapshot.matterId, MATTER_ID);
    assert.equal(projection.snapshot.targetId, TARGET_ID);
    assert.equal(projection.ast.claims[0].paragraphs[0].text, "人工编辑后的权利要求段落");
  }
  assert.deepEqual(current.ast, original, "editing and saving must not mutate the caller's AST");

  const beforeRepeat = await eventsFor(current);
  const repeated = await session.save();
  const afterRepeat = await eventsFor(current);
  assert.equal(repeated.id, saved.id);
  assert.equal(afterRepeat.length, beforeRepeat.length);
  assert.equal(afterRepeat.filter((event) => event.resourceId === saved.id).length, 1);
});

test("deleting AI content creates one auditable edited revision", async () => {
  const current = await fixture();
  const session = current.makeSession();
  await session.load();
  const before = await eventsFor(current);
  await session.removeParagraph({ sectionKind: "background" }, 0);
  const saved = await session.save();
  assert.ok(saved);
  assert.equal(saved.reason, "edited");
  assert.equal(saved.parentId, current.initialRevision.id);
  assert.equal(saved.ast.sections.find((section) => section.kind === "background").paragraphs.length, 0);
  const after = await eventsFor(current);
  assert.equal(after.length, before.length + 1);
  assert.equal(after.filter((event) => event.resourceId === saved.id).length, 1);
});

test("V6-18 A02 and S05-A04: stale save preserves local buffer and exposes both revisions", async () => {
  const current = await fixture();
  const baseId = current.initialRevision.id;
  const session = current.makeSession();
  await session.load();
  await session.updateParagraph({ claimId: CLAIM_1 }, 0, "本机缓冲版本");
  await session.refresh();

  const competingAst = structuredClone(current.ast);
  competingAst.claims[0].paragraphs[0].text = "另一标签页已经保存";
  competingAst.claims[0].paragraphs[0].origin = "mixed";
  const competitor = await current.revisions.saveEditedRevision(MATTER_ID, TARGET_ID, baseId, competingAst);
  assert.equal(competitor.ok, true, competitor.ok ? "" : JSON.stringify(competitor.error));
  const revisionEventsBeforeStaleSave = await eventsFor(current);

  assert.equal(await session.save(), null);
  const state = session.getSnapshot();
  assert.equal(state.error.code, "VERSION_CONFLICT");
  assert.equal(state.conflict, true);
  assert.equal(state.model.claims[0].paragraphs[0].text, "本机缓冲版本");
  assert.equal(state.latestRevision.revision.id, competitor.data.id);
  const buffer = await current.buffers.loadActive(MATTER_ID, TARGET_ID);
  assert.equal(buffer.baseRevisionId, baseId);
  assert.equal(buffer.model.claims[0].paragraphs[0].text, "本机缓冲版本");
  const head = await current.revisions.loadHeadRevision(MATTER_ID, TARGET_ID);
  assert.equal(head.data.revision.id, competitor.data.id);
  assert.equal((await eventsFor(current)).length, revisionEventsBeforeStaleSave.length);

  const markup = renderToStaticMarkup(createElement(editor.DraftMergeView, {
    local: state.model,
    latest: state.latestRevision.ast,
    latestRevisionId: state.latestRevision.revision.id,
  }));
  assert.match(markup, /draft-merge-view/);
  assert.match(markup, /本机缓冲版本/);
  assert.match(markup, /另一标签页已经保存/);

  await session.startMerge();
  const merging = session.getSnapshot();
  assert.equal(merging.baseRevisionId, competitor.data.id);
  assert.equal(merging.model.claims[0].paragraphs[0].text, "另一标签页已经保存");
  assert.equal(merging.preservedLocalModel.claims[0].paragraphs[0].text, "本机缓冲版本");
  const unchangedHead = await current.revisions.loadHeadRevision(MATTER_ID, TARGET_ID);
  assert.equal(unchangedHead.data.revision.id, competitor.data.id);
});

test("V6-18 A03 and S05-A08: reload restores invalid local input and reports its claim node", async () => {
  const current = await fixture();
  const session = current.makeSession();
  await session.load();
  const original = structuredClone(current.ast);

  const mapped = adapter.draftAstToEditorModel(current.ast);
  const edited = adapter.editParagraph(mapped, { claimId: CLAIM_1 }, 0, "纯函数编辑");
  const insertedId = idFactory()();
  const inserted = adapter.insertParagraph(edited, { sectionKind: "abstract" }, -1, () => insertedId);
  const deleted = adapter.deleteParagraph(inserted, { sectionKind: "abstract" }, 0);
  assert.deepEqual(current.ast, original);
  assert.notEqual(edited, mapped);
  assert.notEqual(inserted, edited);
  assert.notEqual(deleted, inserted);
  assert.equal(edited.claims[0].paragraphs[0].origin, "mixed");
  const legacyAst = structuredClone(original);
  legacyAst.claims[0].paragraphs[0].origin = "legacy";
  const legacyModel = adapter.draftAstToEditorModel(legacyAst);
  assert.equal(adapter.editParagraph(legacyModel, { claimId: CLAIM_1 }, 0, "legacy 手工改写").claims[0].paragraphs[0].origin, "human");
  assert.equal(inserted.sections.find((section) => section.kind === "abstract").paragraphs[0].id, insertedId);
  assert.equal(inserted.sections.find((section) => section.kind === "abstract").paragraphs.length, 1);
  assert.equal(deleted.sections.find((section) => section.kind === "abstract").paragraphs.length, 0);

  await session.updateClaimField(CLAIM_2, { dependsOn: [CLAIM_3] });
  assert.equal(await session.save(), null);
  let state = session.getSnapshot();
  assert.equal(state.error.code, "INVALID_AST");
  assert.ok(state.error.issues.some((issue) => issue.nodeId === CLAIM_2 && issue.claimNumber === 2));
  assert.equal((await current.revisions.loadHeadRevision(MATTER_ID, TARGET_ID)).data.revision.id, current.initialRevision.id);

  const restored = current.makeSession();
  await restored.load();
  state = restored.getSnapshot();
  assert.equal(state.baseRevisionId, current.initialRevision.id);
  assert.equal(state.model.claims[1].dependsOn[0], CLAIM_3);
  assert.equal(state.dirty, true);

  const confirmedIds = PARAGRAPH_IDS;
  const originalParagraphs = original.claims.flatMap((claim) => claim.paragraphs).concat(original.sections.flatMap((section) => section.paragraphs));
  assert.deepEqual(editor.pendingAiParagraphIds(
    originalParagraphs,
    current.initialRevision.id,
    current.initialRevision.id,
    confirmedIds,
  ), []);
  await restored.updateClaimField(CLAIM_2, { dependsOn: [CLAIM_1] });
  await restored.updateParagraph({ claimId: CLAIM_2 }, 0, "修改第 2 段后等待重新确认");
  const editedRevision = await restored.save();
  assert.ok(editedRevision);
  assert.equal(editedRevision.ast.claims[1].paragraphs[0].origin, "mixed");
  const editedParagraphs = editedRevision.ast.claims.flatMap((claim) => claim.paragraphs)
    .concat(editedRevision.ast.sections.flatMap((section) => section.paragraphs));
  const pendingAfterNewRevision = editor.pendingAiParagraphIds(
    editedParagraphs,
    editedRevision.id,
    current.initialRevision.id,
    confirmedIds,
  );
  assert.equal(pendingAfterNewRevision.length, 5);
});

test("S05 empty state offers generation and manual writing; manual draft persists and saves", async () => {
  const markup = renderToStaticMarkup(createElement(editor.DraftEditorEmptyState, {
    matterId: MATTER_ID,
    targetId: TARGET_ID,
    onManualWrite() {},
  }));
  assert.match(markup, /生成草稿/);
  assert.match(markup, /手工撰写/);

  const current = await fixture({ withDraft: false });
  const session = current.makeSession();
  await session.load();
  assert.equal(session.getSnapshot().model, null);
  session.beginManualDraft();
  await session.refresh();
  assert.equal(session.getSnapshot().model.sections.length, 6);
  await session.addParagraph({ sectionKind: "abstract" }, -1);
  await session.updateParagraph({ sectionKind: "abstract" }, 0, "手工撰写的合成摘要");
  const saved = await session.save();
  assert.ok(saved);
  assert.equal(saved.reason, "edited");
  assert.equal(saved.ast.sections.find((section) => section.kind === "abstract").paragraphs[0].text, "手工撰写的合成摘要");
});

test("S05 figure references must resolve in the current target figure set", async () => {
  const current = await fixture();
  const session = current.makeSession();
  await session.load();
  const model = session.getSnapshot().model;
  model.claims[0].paragraphs[0].figureIds = [FIGURE_ID];
  await session.updateModel(model);
  assert.equal(await session.save(), null);
  const state = session.getSnapshot();
  assert.equal(state.error.code, "INVALID_AST");
  assert.ok(state.error.issues.some((issue) => issue.nodeId === PARAGRAPH_IDS[0] && issue.path.endsWith("figureIds")));
  assert.equal((await current.revisions.loadHeadRevision(MATTER_ID, TARGET_ID)).data.revision.id, current.initialRevision.id);
});

test("stale input refuses the edit seam so saving cannot silently adopt new inputs", async () => {
  const current = await fixture();
  const session = current.makeSession();
  await session.load();
  await session.updateParagraph({ claimId: CLAIM_1 }, 0, "保留的旧输入编辑");
  const loaded = await current.repository.loadMatter(ACTOR, MATTER_ID);
  const aggregate = loaded.data.data;
  const moved = await current.repository.commit(ACTOR, {
    contractVersion: repositoryModule.CONTRACT_VERSION,
    expectedVersion: aggregate.matter.version,
    payload: {
      matter: { ...aggregate.matter, sourceVersion: 2, version: aggregate.matter.version + 1, updatedAt: T0 },
      targets: aggregate.targets,
      assets: aggregate.assets,
      events: [],
      blobs: [],
    },
  }, { requestId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2" });
  assert.equal(moved.ok, true);
  await session.refresh();
  assert.equal(session.getSnapshot().inputStale, true);
  assert.equal(await session.save(), null);
  assert.equal(session.getSnapshot().error.code, "INPUT_STALE");
  assert.equal((await current.revisions.loadHeadRevision(MATTER_ID, TARGET_ID)).data.revision.id, current.initialRevision.id);
  assert.equal((await current.buffers.loadActive(MATTER_ID, TARGET_ID)).model.claims[0].paragraphs[0].text, "保留的旧输入编辑");
});
