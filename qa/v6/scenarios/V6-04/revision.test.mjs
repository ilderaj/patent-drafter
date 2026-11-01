import test from 'node:test';
import assert from 'node:assert/strict';

// Both packages ship TypeScript sources; Node runs them with type stripping, so
// the specifiers carry the `.ts` extension.
import {
  isCurrent,
  isInputStale,
  snapshotOf,
  currentSnapshot,
  currentInput,
  saveRevision,
  restoreRevision,
  adoptInputs,
  switchTargetView,
} from '../../../../packages/domain/src/v6/revision.ts';
import {
  FIXTURES,
  draftRevisionSchema,
  snapshotRefSchema,
  draftInputRefSchema,
  draftAstSchema,
  figureSetRevisionSchema,
  confirmationSchema,
} from '../../../../packages/contracts/src/index.ts';
import { createDeterministicClock, createDeterministicIds } from '../../fixtures/deterministic.mjs';

const AST_HASH = 'a'.repeat(64);
const EDITED_HASH = 'b'.repeat(64);

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const entry of Object.values(value)) deepFreeze(entry);
  }
  return value;
}

/**
 * A matter with two targets and no revisions yet, plus a separate ID generator
 * for the module so a test can rebuild an identical one for the purity check.
 */
function createFixture({ status = 'active' } = {}) {
  const fixtureIds = createDeterministicIds('v6-04-fixture');
  const matterId = fixtureIds('matter');
  const targetA = fixtureIds('target-a');
  const targetB = fixtureIds('target-b');
  const actorId = fixtureIds('actor');
  const figureA = fixtureIds('figure-set-a');
  const figureB = fixtureIds('figure-set-b');

  const figureEntry = (figureId) => ({ figureId, number: 1, title: 'Synthetic figure', drawingId: null, numerals: [] });

  const targetState = (targetId, figureRevisionId) => ({
    targetId,
    status,
    configVersion: 1,
    figureRevisionId,
    figureSets: [
      {
        id: figureRevisionId,
        matterId,
        targetId,
        parentId: null,
        entries: [figureEntry(fixtureIds('figure'))],
        hash: 'c'.repeat(64),
        createdAt: '2026-10-30T12:00:00.000Z',
      },
    ],
    headRevisionId: null,
    revisions: [],
  });

  const state = {
    matterId,
    sourceVersion: 3,
    targets: {
      [targetA]: targetState(targetA, figureA),
      [targetB]: targetState(targetB, figureB),
    },
  };

  return { state, matterId, targetA, targetB, actorId, figureA, figureB, ids: fixtureIds };
}

function makeContext(actorId, namespace = 'v6-04-module') {
  const newId = createDeterministicIds(namespace);
  const clock = createDeterministicClock();
  return { newId, now: clock.now, actorId };
}

function seed(fixture, context, targetId, astHash = AST_HASH) {
  const result = saveRevision(
    fixture.state,
    { targetId, baseRevisionId: null, ast: structuredClone(FIXTURES.draftAst), astHash, reason: 'generated' },
    context,
  );
  assert.equal(result.ok, true, `seeding ${targetId} must succeed`);
  fixture.state = result.state;
  return result.revision;
}

function seedBoth(fixture, context) {
  const revisionA = seed(fixture, context, fixture.targetA);
  const revisionB = seed(fixture, context, fixture.targetB);
  return { revisionA, revisionB };
}

test('V6-04-A01: a new revision belongs to its own target and leaves the other target alone', () => {
  const fixture = createFixture();
  const context = makeContext(fixture.actorId);
  const { revisionA, revisionB } = seedBoth(fixture, context);

  const targetBBefore = structuredClone(fixture.state.targets[fixture.targetB]);
  const sourceVersionBefore = fixture.state.sourceVersion;

  const saved = saveRevision(
    fixture.state,
    {
      targetId: fixture.targetA,
      baseRevisionId: revisionA.id,
      ast: structuredClone(FIXTURES.draftAst),
      astHash: EDITED_HASH,
      reason: 'edited',
    },
    context,
  );

  assert.equal(saved.ok, true);
  assert.equal(saved.revision.targetId, fixture.targetA);
  assert.equal(saved.revision.parentId, revisionA.id);
  assert.equal(saved.revision.reason, 'edited');
  assert.deepEqual(saved.state.targets[fixture.targetB], targetBBefore, 'target B revisions must not change');
  assert.equal(saved.state.sourceVersion, sourceVersionBefore, 'editing a draft does not bump the matter input');
  assert.equal(saved.state.targets[fixture.targetA].revisions.length, 2);
  assert.equal(saved.state.targets[fixture.targetA].headRevisionId, saved.revision.id);
  assert.equal(saved.state.targets[fixture.targetB].headRevisionId, revisionB.id);
});

test('V6-04-A01: every produced revision and snapshot satisfies the frozen contract', () => {
  const fixture = createFixture();
  const context = makeContext(fixture.actorId);
  const seeded = seedBoth(fixture, context);

  const saved = saveRevision(
    fixture.state,
    { targetId: fixture.targetA, baseRevisionId: null, ast: structuredClone(FIXTURES.draftAst), astHash: AST_HASH, reason: 'generated' },
    context,
  );
  // `baseRevisionId: null` is only legal for a target with no head, so the
  // command above is a refusal — check that before validating a real revision.
  assert.equal(saved.ok, false);

  const accepted = saveRevision(
    fixture.state,
    {
      targetId: fixture.targetA,
      baseRevisionId: fixture.state.targets[fixture.targetA].headRevisionId,
      ast: structuredClone(FIXTURES.draftAst),
      astHash: AST_HASH,
      reason: 'review_accepted',
    },
    context,
  );
  assert.equal(accepted.ok, true);
  assert.equal(draftRevisionSchema.safeParse(accepted.revision).success, true);
  assert.equal(snapshotRefSchema.safeParse(accepted.snapshot).success, true);
  assert.equal(draftInputRefSchema.safeParse(accepted.revision.input).success, true);
  assert.deepEqual(accepted.snapshot, snapshotOf(accepted.revision));
  assert.equal(accepted.snapshot.draftRevisionId, accepted.revision.id);
  assert.equal(accepted.snapshot.sourceVersion, fixture.state.sourceVersion);

  // The other two commands that produce a revision must satisfy the same
  // frozen contract: restore copies a revision, adopt re-binds it to new inputs.
  const restored = restoreRevision(
    accepted.state,
    { targetId: fixture.targetA, revisionId: seeded.revisionA.id, figureStrategy: 'restore_bound' },
    context,
  );
  assert.equal(restored.ok, true);
  assert.equal(draftRevisionSchema.safeParse(restored.revision).success, true);
  assert.equal(snapshotRefSchema.safeParse(restored.snapshot).success, true);
  assert.equal(draftInputRefSchema.safeParse(restored.revision.input).success, true);
  assert.equal(figureSetRevisionSchema.safeParse(restored.figure.figureRevision).success, true);
  assert.deepEqual(restored.snapshot, snapshotOf(restored.revision));

  const adopted = adoptInputs(
    restored.state,
    { targetId: fixture.targetA, baseRevisionId: restored.revision.id, acknowledgedInputReview: true },
    context,
  );
  assert.equal(adopted.ok, true);
  assert.equal(draftRevisionSchema.safeParse(adopted.revision).success, true);
  assert.equal(snapshotRefSchema.safeParse(adopted.snapshot).success, true);
  assert.equal(draftInputRefSchema.safeParse(adopted.revision.input).success, true);
  assert.deepEqual(adopted.snapshot, snapshotOf(adopted.revision));
});

test('V6-04-A01: each target keeps its own parent chain', () => {
  const fixture = createFixture();
  const context = makeContext(fixture.actorId);
  const { revisionA } = seedBoth(fixture, context);

  const second = saveRevision(
    fixture.state,
    { targetId: fixture.targetA, baseRevisionId: revisionA.id, ast: structuredClone(FIXTURES.draftAst), astHash: EDITED_HASH, reason: 'edited' },
    context,
  );
  assert.equal(second.ok, true);

  const third = saveRevision(
    second.state,
    { targetId: fixture.targetA, baseRevisionId: second.revision.id, ast: structuredClone(FIXTURES.draftAst), astHash: AST_HASH, reason: 'edited' },
    context,
  );
  assert.equal(third.ok, true);

  const chain = third.state.targets[fixture.targetA].revisions;
  assert.equal(chain.length, 3);
  assert.deepEqual(
    chain.map((item) => item.parentId),
    [null, revisionA.id, second.revision.id],
  );
  assert.equal(third.state.targets[fixture.targetB].revisions.length, 1);
});

test('V6-04-A02: a stale base is refused with VERSION_CONFLICT and changes nothing', () => {
  const fixture = createFixture();
  const context = makeContext(fixture.actorId);
  const { revisionA } = seedBoth(fixture, context);

  const second = saveRevision(
    fixture.state,
    { targetId: fixture.targetA, baseRevisionId: revisionA.id, ast: structuredClone(FIXTURES.draftAst), astHash: EDITED_HASH, reason: 'edited' },
    context,
  );
  assert.equal(second.ok, true);
  const before = structuredClone(second.state);

  // An editor still holding the first revision tries to save over the head.
  const stale = saveRevision(
    second.state,
    { targetId: fixture.targetA, baseRevisionId: revisionA.id, ast: structuredClone(FIXTURES.draftAst), astHash: AST_HASH, reason: 'edited' },
    context,
  );

  assert.equal(stale.ok, false);
  assert.equal(stale.error.code, 'VERSION_CONFLICT');
  assert.equal(stale.error.latestRevisionId, second.revision.id);
  assert.equal(stale.state, second.state, 'a refusal returns the input state by reference');
  assert.deepEqual(second.state, before, 'a refusal must not append, reorder or rewrite a revision');

  // Adopting new inputs from the same stale base is refused the same way.
  const staleAdopt = adoptInputs(
    second.state,
    { targetId: fixture.targetA, baseRevisionId: revisionA.id, acknowledgedInputReview: true },
    context,
  );
  assert.equal(staleAdopt.ok, false);
  assert.equal(staleAdopt.error.code, 'VERSION_CONFLICT');
  assert.equal(staleAdopt.state, second.state);
});

test('V6-04-A02: unknown, archived and unreachable targets are refused without a write', () => {
  const fixture = createFixture();
  const context = makeContext(fixture.actorId);
  const { revisionA } = seedBoth(fixture, context);

  const unknown = saveRevision(
    fixture.state,
    { targetId: 'target-outside-this-matter', baseRevisionId: null, ast: structuredClone(FIXTURES.draftAst), astHash: AST_HASH, reason: 'generated' },
    context,
  );
  assert.equal(unknown.ok, false);
  assert.equal(unknown.error.code, 'RESOURCE_NOT_FOUND');
  assert.equal(unknown.state, fixture.state);

  const archived = createFixture({ status: 'archived' });
  const archivedContext = makeContext(archived.actorId);
  const refused = saveRevision(
    archived.state,
    { targetId: archived.targetA, baseRevisionId: null, ast: structuredClone(FIXTURES.draftAst), astHash: AST_HASH, reason: 'generated' },
    archivedContext,
  );
  assert.equal(refused.ok, false);
  assert.equal(refused.error.code, 'INVALID_TRANSITION');
  assert.equal(refused.state, archived.state);

  // A revision of target B is not addressable through target A.
  const crossTarget = restoreRevision(
    fixture.state,
    { targetId: fixture.targetA, revisionId: fixture.state.targets[fixture.targetB].headRevisionId, figureStrategy: 'keep_current' },
    context,
  );
  assert.equal(crossTarget.ok, false);
  assert.equal(crossTarget.error.code, 'RESOURCE_NOT_FOUND');
  assert.equal(crossTarget.state, fixture.state);
  assert.equal(revisionA.parentId, null);
});

test('V6-04-A02: switching the visible target changes no revision', () => {
  const fixture = createFixture();
  const context = makeContext(fixture.actorId);
  seedBoth(fixture, context);

  const before = structuredClone(fixture.state);
  const switched = switchTargetView(fixture.state, fixture.targetB);

  assert.equal(switched.ok, true);
  assert.equal(switched.state, fixture.state, 'a view switch returns the same state, not a copy');
  assert.equal(switched.target.targetId, fixture.targetB);
  assert.deepEqual(fixture.state, before);
  const outside = switchTargetView(fixture.state, fixture.matterId);
  assert.equal(outside.ok, false);
  assert.equal(outside.error.code, 'RESOURCE_NOT_FOUND');
});

test('V6-04-A02: restoring copies the draft and never revives the old approvals', () => {
  const fixture = createFixture();
  const context = makeContext(fixture.actorId);
  const { revisionA } = seedBoth(fixture, context);

  // A real, contract-valid full_read confirmation was made against the first revision.
  const confirmedSnapshot = currentSnapshot(fixture.state, fixture.targetA);
  assert.equal(confirmedSnapshot.draftRevisionId, revisionA.id);
  const confirmation = confirmationSchema.parse({
    id: fixture.ids('confirmation'),
    snapshot: confirmedSnapshot,
    actorId: fixture.actorId,
    identity: 'authenticated',
    kind: 'full_read',
    paragraphId: null,
    riskId: null,
    checkRunId: null,
    createdAt: '2026-10-30T12:00:00.000Z',
  });
  assert.equal(
    isCurrent(confirmation.snapshot, currentSnapshot(fixture.state, fixture.targetA)),
    true,
    'the approval is current against the state it was made on',
  );

  const second = saveRevision(
    fixture.state,
    { targetId: fixture.targetA, baseRevisionId: revisionA.id, ast: structuredClone(FIXTURES.draftAst), astHash: EDITED_HASH, reason: 'edited' },
    context,
  );
  assert.equal(second.ok, true);
  assert.equal(
    isCurrent(confirmation.snapshot, currentSnapshot(second.state, fixture.targetA)),
    false,
    'the earlier confirmation is not current once a new revision exists',
  );

  const restored = restoreRevision(
    second.state,
    { targetId: fixture.targetA, revisionId: revisionA.id, figureStrategy: 'keep_current' },
    context,
  );
  assert.equal(restored.ok, true);
  assert.equal(restored.revision.reason, 'restored');
  assert.equal(restored.revision.restoredFrom, revisionA.id);
  assert.notEqual(restored.revision.id, revisionA.id, 'restore creates a new revision, it does not move the head back');
  assert.deepEqual(restored.revision.ast, revisionA.ast);
  assert.notEqual(restored.revision.ast, revisionA.ast, 'the restored AST is a copy, not an alias');
  assert.equal(
    isCurrent(confirmation.snapshot, currentSnapshot(restored.state, fixture.targetA)),
    false,
    'the approval from the first revision must not become current again',
  );
  // Nothing on the revision carries a confirmation or an approval forward.
  assert.deepEqual(Object.keys(restored.revision).sort(), [
    'ast',
    'astHash',
    'createdAt',
    'createdBy',
    'id',
    'input',
    'matterId',
    'parentId',
    'reason',
    'restoredFrom',
    'targetId',
  ]);
});

test('V6-04-A02: a new revision sends every AI paragraph back to unconfirmed', () => {
  const fixture = createFixture();
  const context = makeContext(fixture.actorId);

  // S05-A03: a draft whose summary is five AI paragraphs, all confirmed.
  const ast = structuredClone(FIXTURES.draftAst);
  const summary = ast.sections.find((section) => section.kind === 'summary');
  summary.paragraphs = [1, 2, 3, 4, 5].map((number) => ({
    id: fixture.ids(`ai-paragraph-${number}`),
    text: `AI 段落 ${number}`,
    origin: 'ai',
    sourceRefs: [],
    factIds: [],
    figureIds: [],
    generationJobId: null,
  }));
  assert.equal(draftAstSchema.safeParse(ast).success, true);

  const generated = saveRevision(
    fixture.state,
    { targetId: fixture.targetA, baseRevisionId: null, ast, astHash: AST_HASH, reason: 'generated' },
    context,
  );
  assert.equal(generated.ok, true);

  const confirmations = summary.paragraphs.map((paragraph, index) =>
    confirmationSchema.parse({
      id: fixture.ids(`ai-confirmation-${index}`),
      snapshot: generated.snapshot,
      actorId: fixture.actorId,
      identity: 'authenticated',
      kind: 'ai_paragraph',
      paragraphId: paragraph.id,
      riskId: null,
      checkRunId: null,
      createdAt: '2026-10-30T12:00:00.000Z',
    }),
  );
  assert.equal(
    confirmations.every((item) => isCurrent(item.snapshot, currentSnapshot(generated.state, fixture.targetA))),
    true,
    'all five AI paragraphs are confirmed on the generated revision',
  );

  const edited = saveRevision(
    generated.state,
    { targetId: fixture.targetA, baseRevisionId: generated.revision.id, ast, astHash: EDITED_HASH, reason: 'edited' },
    context,
  );
  assert.equal(edited.ok, true);
  const afterEdit = currentSnapshot(edited.state, fixture.targetA);
  assert.equal(
    confirmations.every((item) => isCurrent(item.snapshot, afterEdit)),
    false,
    'one edit returns all five AI paragraphs to pending',
  );
  assert.equal(edited.state.targets[fixture.targetA].revisions.length, 2);
});

test('V6-04-A02: restore reports figure strategy and input staleness without rewriting history', () => {
  const fixture = createFixture();
  const context = makeContext(fixture.actorId);
  const { revisionA } = seedBoth(fixture, context);

  const bound = restoreRevision(
    fixture.state,
    { targetId: fixture.targetA, revisionId: revisionA.id, figureStrategy: 'restore_bound' },
    context,
  );
  assert.equal(bound.ok, true);
  assert.equal(bound.figure.strategy, 'restore_bound');
  assert.equal(bound.figure.created, true);
  assert.equal(bound.figure.figureRevisionId, bound.revision.input.figureRevisionId);
  assert.notEqual(bound.figure.figureRevisionId, fixture.figureA, 'restore_bound creates a new figure set revision');

  // The new set is a real record over the restored draft's own entries.
  const created = bound.figure.figureRevision;
  assert.notEqual(created, null, 'restore_bound must return the figure set revision it created');
  assert.equal(figureSetRevisionSchema.safeParse(created).success, true);
  assert.equal(created.parentId, fixture.figureA);
  assert.equal(created.matterId, fixture.matterId);
  assert.equal(created.targetId, fixture.targetA);
  assert.deepEqual(created.entries, fixture.state.targets[fixture.targetA].figureSets[0].entries);
  assert.notEqual(created.entries, fixture.state.targets[fixture.targetA].figureSets[0].entries, 'entries are copied');
  assert.equal(created.hash, fixture.state.targets[fixture.targetA].figureSets[0].hash);
  assert.equal(bound.state.targets[fixture.targetA].figureSets.length, 2, 'the earlier figure set is kept');
  assert.equal(bound.state.targets[fixture.targetA].figureRevisionId, created.id);

  const kept = restoreRevision(
    fixture.state,
    { targetId: fixture.targetA, revisionId: revisionA.id, figureStrategy: 'keep_current' },
    context,
  );
  assert.equal(kept.ok, true);
  assert.equal(kept.figure.created, false);
  assert.equal(kept.figure.figureRevision, null, 'keep_current creates no figure set revision');
  assert.equal(kept.figure.figureRevisionId, fixture.figureA);
  assert.equal(kept.state.targets[fixture.targetA].figureSets.length, 1);
  assert.equal(kept.figure.figureMismatch, false, 'the restored draft and the current figures share one set');

  // A figure set that is no longer retained cannot be re-bound.
  const dropped = {
    ...fixture.state,
    targets: {
      ...fixture.state.targets,
      [fixture.targetA]: { ...fixture.state.targets[fixture.targetA], figureSets: [] },
    },
  };
  const unbound = restoreRevision(
    dropped,
    { targetId: fixture.targetA, revisionId: revisionA.id, figureStrategy: 'restore_bound' },
    context,
  );
  assert.equal(unbound.ok, false);
  assert.equal(unbound.error.code, 'RESOURCE_NOT_FOUND');
  assert.equal(unbound.state, dropped);

  // The matter input moved on after the revision was written.
  const advanced = { ...fixture.state, sourceVersion: fixture.state.sourceVersion + 1 };
  const restored = restoreRevision(
    advanced,
    { targetId: fixture.targetA, revisionId: revisionA.id, figureStrategy: 'keep_current' },
    context,
  );
  assert.equal(restored.ok, true);
  assert.equal(restored.revision.input.sourceVersion, revisionA.input.sourceVersion);
  assert.equal(isInputStale(restored.revision.input, currentInput(restored.state, fixture.targetA)), true);
  assert.equal(restored.state.targets[fixture.targetA].revisions.length, 2, 'the earlier revision is kept, not consumed');
});

test('V6-04-A02: only keep_current leaves the restored draft on different figures', () => {
  const fixture = createFixture();
  const context = makeContext(fixture.actorId);
  const { revisionA } = seedBoth(fixture, context);

  // The target moves on to a second figure set after the draft was written.
  const target = fixture.state.targets[fixture.targetA];
  const laterSet = {
    id: fixture.ids('figure-later'),
    matterId: fixture.matterId,
    targetId: fixture.targetA,
    parentId: fixture.figureA,
    entries: [{ figureId: fixture.ids('figure'), number: 2, title: 'Later figure', drawingId: null, numerals: [] }],
    hash: 'd'.repeat(64),
    createdAt: '2026-10-30T13:00:00.000Z',
  };
  const movedOn = {
    ...fixture.state,
    targets: {
      ...fixture.state.targets,
      [fixture.targetA]: {
        ...target,
        figureRevisionId: laterSet.id,
        figureSets: [...target.figureSets, laterSet],
      },
    },
  };

  const bound = restoreRevision(
    movedOn,
    { targetId: fixture.targetA, revisionId: revisionA.id, figureStrategy: 'restore_bound' },
    context,
  );
  assert.equal(bound.ok, true);
  assert.equal(bound.figure.figureMismatch, false, 'restore_bound rebinds the draft to its own figures');
  assert.equal(bound.figure.figureRevision.parentId, laterSet.id, 'the new set follows the previously current one');
  assert.deepEqual(
    bound.figure.figureRevision.entries,
    target.figureSets[0].entries,
    'the new set carries the entries the restored draft was written against',
  );

  const kept = restoreRevision(
    movedOn,
    { targetId: fixture.targetA, revisionId: revisionA.id, figureStrategy: 'keep_current' },
    context,
  );
  assert.equal(kept.ok, true);
  assert.equal(kept.figure.figureRevisionId, laterSet.id);
  assert.equal(kept.figure.figureMismatch, true, 'keep_current must report that the draft and the figures differ');
  assert.deepEqual(kept.state.targets[fixture.targetA].figureSets, movedOn.targets[fixture.targetA].figureSets);
});

test('V6-04-A02: adopting new inputs needs the acknowledgement and creates a new revision', () => {
  const fixture = createFixture();
  const context = makeContext(fixture.actorId);
  const { revisionA } = seedBoth(fixture, context);

  const refused = adoptInputs(
    fixture.state,
    { targetId: fixture.targetA, baseRevisionId: revisionA.id, acknowledgedInputReview: false },
    context,
  );
  assert.equal(refused.ok, false);
  assert.equal(refused.error.code, 'INVALID_INPUT');
  assert.equal(refused.state, fixture.state);

  const advanced = { ...fixture.state, sourceVersion: fixture.state.sourceVersion + 1 };
  const adopted = adoptInputs(
    advanced,
    { targetId: fixture.targetA, baseRevisionId: revisionA.id, acknowledgedInputReview: true },
    context,
  );
  assert.equal(adopted.ok, true);
  assert.equal(adopted.revision.reason, 'adopted_inputs');
  assert.equal(adopted.revision.parentId, revisionA.id);
  assert.equal(adopted.revision.input.sourceVersion, advanced.sourceVersion);
  assert.deepEqual(adopted.revision.ast, revisionA.ast);
  assert.notEqual(adopted.revision.id, revisionA.id);
  assert.deepEqual(adopted.state.targets[fixture.targetB], fixture.state.targets[fixture.targetB]);
});

test('V6-04-A02: an input pointing past the matter sourceVersion is refused', () => {
  const fixture = createFixture();
  const context = makeContext(fixture.actorId);
  const { revisionA } = seedBoth(fixture, context);

  const ahead = saveRevision(
    fixture.state,
    {
      targetId: fixture.targetA,
      baseRevisionId: revisionA.id,
      ast: structuredClone(FIXTURES.draftAst),
      astHash: EDITED_HASH,
      reason: 'edited',
      input: { ...revisionA.input, sourceVersion: fixture.state.sourceVersion + 1 },
    },
    context,
  );
  assert.equal(ahead.ok, false);
  assert.equal(ahead.error.code, 'INPUT_STALE');
  assert.equal(ahead.state, fixture.state);

  const wrongTarget = saveRevision(
    fixture.state,
    {
      targetId: fixture.targetA,
      baseRevisionId: revisionA.id,
      ast: structuredClone(FIXTURES.draftAst),
      astHash: EDITED_HASH,
      reason: 'edited',
      input: { ...revisionA.input, targetId: fixture.targetB },
    },
    context,
  );
  assert.equal(wrongTarget.ok, false);
  assert.equal(wrongTarget.error.code, 'INVALID_INPUT');
  assert.equal(wrongTarget.state, fixture.state);
});

test('V6-04-A03: the same command produces the same result and never mutates the input', () => {
  const fixture = createFixture();
  const context = makeContext(fixture.actorId);
  const { revisionA } = seedBoth(fixture, context);

  const frozen = deepFreeze(structuredClone(fixture.state));
  const before = structuredClone(frozen);
  const command = {
    targetId: fixture.targetA,
    baseRevisionId: revisionA.id,
    ast: deepFreeze(structuredClone(FIXTURES.draftAst)),
    astHash: EDITED_HASH,
    reason: 'edited',
  };

  const first = saveRevision(frozen, command, makeContext(fixture.actorId));
  const second = saveRevision(frozen, command, makeContext(fixture.actorId));

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.deepEqual(first.revision, second.revision, 'identical inputs give an identical revision');
  assert.deepEqual(first.state, second.state, 'identical inputs give an identical next state');
  assert.deepEqual(frozen, before, 'the input state is unchanged after the call');
  assert.equal(frozen.targets[fixture.targetA].revisions.length, 1);
});

test('V6-04-A03: a saved revision does not alias the AST the caller submitted', () => {
  const fixture = createFixture();
  const context = makeContext(fixture.actorId);
  const submitted = structuredClone(FIXTURES.draftAst);

  const saved = saveRevision(
    fixture.state,
    { targetId: fixture.targetA, baseRevisionId: null, ast: submitted, astHash: AST_HASH, reason: 'generated' },
    context,
  );
  assert.equal(saved.ok, true);
  assert.notEqual(saved.revision.ast, submitted, 'the revision stores its own copy of the AST');

  // The editor keeps its working object; changing it must not rewrite history.
  submitted.title = 'mutated after the save';
  submitted.claims.length = 0;
  assert.equal(saved.revision.ast.title, FIXTURES.draftAst.title);
  assert.equal(saved.revision.ast.claims.length, FIXTURES.draftAst.claims.length);
  assert.equal(saved.state.targets[fixture.targetA].revisions[0].ast.title, FIXTURES.draftAst.title);
});

test('V6-04-A03: a refusal is deterministic and leaves the state untouched', () => {
  const fixture = createFixture();
  const context = makeContext(fixture.actorId);
  const { revisionA } = seedBoth(fixture, context);
  const frozen = deepFreeze(structuredClone(fixture.state));
  const before = structuredClone(frozen);

  const command = { targetId: fixture.targetA, revisionId: revisionA.id, figureStrategy: 'not_a_strategy' };
  const first = restoreRevision(frozen, command, makeContext(fixture.actorId));
  const second = restoreRevision(frozen, command, makeContext(fixture.actorId));

  assert.equal(first.ok, false);
  assert.deepEqual(first.error, second.error);
  assert.equal(first.state, frozen);
  assert.deepEqual(frozen, before);
});
