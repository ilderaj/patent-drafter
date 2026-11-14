import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'tsx/esm/api';
register();
const [recovery, patentpack, repoModule, answers, v624] = await Promise.all([
  import('../../../../apps/web/src/v6/features/recovery/recovery.ts'),
  import('../../../../packages/export/src/patentpack.ts'),
  import('../../../../apps/web/src/v6/lib/repository.ts'),
  import('../../../../apps/web/src/v6/features/intake/answer-sources.ts'),
  import('../V6-24/harness.mjs'),
]);
const { sourceRefSchema } = await import('../../../../packages/contracts/src/matter.ts');
const PASS = 'synthetic-answers-recovery-passphrase';
const ANSWERS = { problem: '现有水表读数需人工上门抄表，成本高。', difference: '增加三模通讯模块，使表体可自动上报读数。',
  inventorIds: [], disclosure: 'none', maturity: 'idea', disclosureDetail: null };

class MemoryBackend {
  constructor() { this.data = new Map(Object.values(repoModule.STORES).map(n => [n, new Map()])); this.queue = Promise.resolve(); }
  transaction(mode, run) {
    if (mode === 'readwrite') { const next = this.queue.then(() => this.run(run)); this.queue = next.then(() => undefined, () => undefined); return next; }
    return this.run(run);
  }
  async run(run) {
    const snapshot = new Map([...this.data].map(([n, s]) => [n, new Map(s)]));
    const st = n => this.data.get(n);
    const tx = { get: async (n, k) => { const v = st(n).get(k); return v === undefined ? undefined : structuredClone(v); },
      put: async (n, k, v) => { st(n).set(k, structuredClone(v)); }, delete: async (n, k) => { st(n).delete(k); },
      getAll: async n => [...st(n).values()].map(v => structuredClone(v)),
      getAllByIndex: async (n, i, v) => [...st(n).values()].filter(r => r?.[i] === v).map(r => structuredClone(r)) };
    try { return await run(tx); } catch (e) { this.data = snapshot; throw e; }
  }
  close() {}
}

test('a revision citing 用户直接回答 survives encrypted export/import with the same ids', async () => {
  const source = await v624.makeApprovalFixture();
  const head = await source.revisions.loadHeadRevision(v624.MATTER_ID, v624.TARGET_ID);
  assert.equal(head.ok, true);
  const aggregate = (await source.repository.loadMatter(v624.ACTOR, v624.MATTER_ID)).data.data;
  const version = aggregate.matter.sourceVersion;
  const snapshotKey = `intake/snapshot/${v624.MATTER_ID}/${version}`;
  let created;
  await source.repository.backend.transaction('readwrite', async tx => {
    const row = await tx.get(repoModule.STORES.blobs, snapshotKey);
    assert.ok(row?.snapshot, 'fixture has a current intake snapshot');
    row.snapshot.answers = ANSWERS;
    await tx.put(repoModule.STORES.blobs, snapshotKey, row);
    created = await answers.buildAnswerSources({ answers: ANSWERS, confirmedBy: row.snapshot.createdBy, confirmedAt: row.snapshot.createdAt });
  });
  const ref = created.facts[0].refs[0];
  const revisionKey = ['generation', encodeURIComponent(v624.ACTOR.tenantId), encodeURIComponent(v624.ACTOR.userId), 'revision',
    encodeURIComponent(v624.MATTER_ID), encodeURIComponent(v624.TARGET_ID), encodeURIComponent(head.data.revision.id)].join('/');
  await source.repository.backend.transaction('readwrite', async tx => {
    const row = await tx.get(repoModule.STORES.blobs, revisionKey);
    row.revision.ast.claims[0].paragraphs[0].sourceRefs.push(ref);
    await tx.put(repoModule.STORES.blobs, revisionKey, row);
  });

  const packed = await recovery.createRecoveryPackage(source.repository, v624.ACTOR, v624.MATTER_ID, { passphrase: PASS, access: 'local_unmetered' });
  const opened = await patentpack.openPatentPack(packed, PASS);
  const packedRef = opened.records.find(r => r.kind === 'generation.revision' && r.value.revision.id === head.data.revision.id)
    .value.revision.ast.claims[0].paragraphs[0].sourceRefs.find(r => r.origin === 'user_answer');
  assert.deepEqual(packedRef, ref, 'the export keeps the new optional fields');

  const destination = repoModule.openLocalRepository(new MemoryBackend());
  const checked = await recovery.validateRecoveryPackage(destination, v624.ACTOR, packed, PASS);
  assert.equal(checked.ok, true, checked.ok ? '' : `${checked.error.code}: ${checked.error.message}`);
  const committed = await recovery.commitRecoveryImport(destination, v624.ACTOR, checked.data.validationId);
  assert.equal(committed.ok, true, committed.ok ? '' : `${committed.error.code}: ${committed.error.message}`);
  const matter = (await destination.loadMatter(v624.ACTOR, committed.data.matterId)).data.data;
  const target = matter.targets.find(item => item.draftRevisionId !== null);
  const restored = await recovery.readRecoveredDraft(destination, v624.ACTOR, committed.data.matterId, target.id);
  assert.equal(restored.ok, true);
  const restoredRefs = restored.data.revision.ast.claims[0].paragraphs[0].sourceRefs.filter(r => r.origin === 'user_answer');
  assert.deepEqual(restoredRefs, [ref]);
  assert.equal(sourceRefSchema.safeParse(restoredRefs[0]).success, true);

  // The imported snapshot carries the answers, so the same text yields the same chunk id and hash.
  const imported = await destination.backend.transaction('readonly', tx => tx.getAll(repoModule.STORES.blobs));
  const snapshotRow = imported.find(r => r?.kind === 'intake.snapshot' && r.snapshot.matterId === committed.data.matterId);
  const rebuilt = await answers.buildAnswerSources({ answers: snapshotRow.snapshot.answers, confirmedBy: snapshotRow.snapshot.createdBy, confirmedAt: snapshotRow.snapshot.createdAt });
  assert.equal(rebuilt.chunks[0].id, ref.chunkId); assert.equal(rebuilt.chunks[0].hash, ref.chunkHash);
});
