/**
 * V6-12 — S02-A08 end to end: a figure-set bind on target A retires A's
 * confirmations, check run and approval, and leaves target B untouched.
 *
 * Nothing here re-implements staleness. The figure sets are minted and
 * persisted by `drawings.ts` over the real V6-06 repository; the draft
 * revisions, confirmations and gate decisions come from the V6-04/V6-05 domain
 * modules (`revision.ts`, `confirmation.ts`, `gate.ts`), imported the way the
 * V6-05 suite imports them. The test only carries persisted ids from one to the
 * other, so it also proves the ids `drawings.ts` mints interoperate with
 * `revision.ts` (restore_bound finds the persisted set by id).
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  confirm,
  currentConfirmations,
  isConfirmationCurrent,
} from "../../../../packages/domain/src/v6/confirmation.ts";
import { evaluateGate } from "../../../../packages/domain/src/v6/gate.ts";
import {
  adoptInputs,
  currentInput,
  isCurrent,
  isInputStale,
  restoreRevision,
  saveRevision,
  snapshotOf,
} from "../../../../packages/domain/src/v6/revision.ts";
import { approvalSchema, checkRunSchema, confirmationSchema } from "../../../../packages/contracts/src/index.ts";
import { figureSetRevisionSchema } from "../../../../packages/contracts/src/matter.ts";
import { createDeterministicIds } from "../../fixtures/deterministic.mjs";
import {
  bindFigures,
  checkFigureExportGate,
  importDrawing,
  readFigureLibrary,
} from "../../../../apps/web/src/v6/features/sources/drawings.ts";
import { ACTOR_A, EMPTY_SET_A, EMPTY_SET_B, MATTER_ID, T0, TARGET_A, TARGET_B, USER_A, clock, entry, fixture, seed } from "./harness.mjs";

const FIG_1 = "88888888-8888-4888-8888-888888888881";
const FIG_2 = "88888888-8888-4888-8888-888888888882";
const RULE_PACK = "2026.10.1";
const AST_HASH = "a".repeat(64);

async function importOk(repository, name) {
  const result = await importDrawing(repository, ACTOR_A, MATTER_ID, { bytes: fixture(name), fileName: name }, { now: clock });
  assert.equal(result.ok, true, result.ok ? "" : JSON.stringify(result.error));
  return result.data;
}

async function bindOk(repository, targetId, base, entries) {
  const result = await bindFigures(repository, ACTOR_A, MATTER_ID, { targetId, baseFigureRevisionId: base, entries }, { now: clock });
  assert.equal(result.ok, true, result.ok ? "" : JSON.stringify(result.error));
  return result.data.current;
}

/**
 * The V6-04 aggregate for this matter, with the target pointers and figure
 * sets read from what `drawings.ts` persisted. Draft revisions live in the
 * domain state (no draft store exists yet), so they are carried over from
 * `drafts` unchanged.
 */
async function revisionState(repository, drafts = null) {
  const read = await readFigureLibrary(repository, ACTOR_A, MATTER_ID);
  assert.equal(read.ok, true);
  const loaded = await repository.loadMatter(ACTOR_A, MATTER_ID);
  assert.equal(loaded.ok, true);
  const targets = {};
  for (const target of read.data.targets) {
    const previous = drafts?.targets[target.id];
    targets[target.id] = {
      targetId: target.id,
      status: target.status,
      configVersion: target.configVersion,
      figureRevisionId: target.figureRevisionId,
      figureSets: read.data.revisions.filter((revision) => revision.targetId === target.id),
      headRevisionId: previous?.headRevisionId ?? null,
      revisions: previous?.revisions ?? [],
    };
  }
  return { matterId: MATTER_ID, sourceVersion: loaded.data.data.matter.sourceVersion, targets };
}

/** The six-field snapshot an export of this target would name right now. */
function liveSnapshot(state, targetId) {
  return { ...currentInput(state, targetId), draftRevisionId: state.targets[targetId].headRevisionId };
}

const revisionContext = () => ({ newId: createDeterministicIds("v6-12-a08-revision"), now: () => T0, actorId: USER_A });
const confirmationContext = () => ({ newId: createDeterministicIds("v6-12-a08-confirmation"), now: () => T0 });

function checkRunOn(snapshot, id) {
  return { id, snapshot, rulePackVersion: RULE_PACK, state: "succeeded", findings: [], createdAt: T0 };
}

function approvalOn(snapshot, id, checkRunId, confirmationIds) {
  return {
    id,
    snapshot,
    checkRunId,
    confirmationIds,
    actorId: USER_A,
    purpose: "internal_release",
    note: "V6-12 合成内部放行",
    createdAt: T0,
  };
}

/** §6 export gate for one target, built only from domain functions over the given state. */
function exportGate(state, ledger, targetId, bound, filesAvailable) {
  const live = liveSnapshot(state, targetId);
  const head = state.targets[targetId].revisions.find((item) => item.id === state.targets[targetId].headRevisionId);
  return evaluateGate(
    {
      action: "export",
      snapshot: bound.snapshot,
      snapshotCurrent: isCurrent(bound.snapshot, live),
      filesAvailable,
      rulePackVersion: RULE_PACK,
      activeRulePackVersion: RULE_PACK,
      checkRun: bound.checkRun,
      approval: bound.approval,
      confirmations: currentConfirmations(ledger, bound.snapshot),
      risks: [],
      now: T0,
    },
    {
      packageKind: "internally_approved",
      confirmationMode: "self_read",
      inputStale: isInputStale(head.input, currentInput(state, targetId)),
      aiParagraphIds: [],
      blockingPolicyRuleIds: [],
    },
  );
}

test("S02-A08 a figure bind on A retires A's confirmation, check and approval; B's figure set, confirmation and input are unchanged", async () => {
  const { repository } = await seed();
  const png = await importOk(repository, "drawing-valid.png");
  const jpg = await importOk(repository, "drawing-valid.jpg");
  // A and B share one drawing library: both bind the same drawing.
  const a1 = await bindOk(repository, TARGET_A, EMPTY_SET_A, [entry(FIG_1, 1, png.drawing.id)]);
  const b1 = await bindOk(repository, TARGET_B, EMPTY_SET_B, [entry(FIG_1, 1, png.drawing.id)]);

  // A draft on each target, generated against the persisted figure sets.
  let state = await revisionState(repository);
  const ids = revisionContext();
  const savedA = saveRevision(state, { targetId: TARGET_A, baseRevisionId: null, ast: {}, astHash: AST_HASH, reason: "generated" }, ids);
  assert.equal(savedA.ok, true);
  const savedB = saveRevision(savedA.state, { targetId: TARGET_B, baseRevisionId: null, ast: {}, astHash: AST_HASH, reason: "generated" }, ids);
  assert.equal(savedB.ok, true);
  state = savedB.state;
  assert.equal(savedA.revision.input.figureRevisionId, a1.id, "the draft binds the figure-set id drawings.ts minted");
  assert.equal(savedB.revision.input.figureRevisionId, b1.id);
  const snapA = snapshotOf(savedA.revision);
  const snapB = snapshotOf(savedB.revision);
  assert.deepEqual(liveSnapshot(state, TARGET_A), snapA);
  assert.deepEqual(liveSnapshot(state, TARGET_B), snapB);

  // Confirm, check and approve both snapshots.
  const cids = confirmationContext();
  let ledger = { matterId: MATTER_ID, confirmations: [], revocations: [] };
  const confirmed = {};
  for (const [targetId, snapshot] of [
    [TARGET_A, snapA],
    [TARGET_B, snapB],
  ]) {
    const result = confirm(ledger, { kind: "full_read", snapshot, actorId: USER_A, identity: "local_self_reported", contentAccess: "local_unmetered" }, cids);
    assert.equal(result.ok, true);
    assert.equal(confirmationSchema.safeParse(result.confirmation).success, true, "persisted ids are contract-valid in a confirmation snapshot");
    ledger = result.state;
    confirmed[targetId] = result.confirmation;
  }
  const bound = {};
  for (const [targetId, snapshot, checkId, approvalId] of [
    [TARGET_A, snapA, "c0c0c0c0-0000-4000-8000-00000000000a", "a0a0a0a0-0000-4000-8000-00000000000a"],
    [TARGET_B, snapB, "c0c0c0c0-0000-4000-8000-00000000000b", "a0a0a0a0-0000-4000-8000-00000000000b"],
  ]) {
    const checkRun = checkRunOn(snapshot, checkId);
    const approval = approvalOn(snapshot, approvalId, checkId, [confirmed[targetId].id]);
    assert.equal(checkRunSchema.safeParse(checkRun).success, true);
    assert.equal(approvalSchema.safeParse(approval).success, true);
    bound[targetId] = { snapshot, checkRun, approval };
  }

  const filesA = (await checkFigureExportGate(repository, ACTOR_A, MATTER_ID, { targetId: TARGET_A }, { now: clock })).data;
  const filesB = (await checkFigureExportGate(repository, ACTOR_A, MATTER_ID, { targetId: TARGET_B }, { now: clock })).data;
  assert.deepEqual(exportGate(state, ledger, TARGET_A, bound[TARGET_A], filesA.filesAvailable).reasons, [], "A exports before the bind");
  assert.deepEqual(exportGate(state, ledger, TARGET_B, bound[TARGET_B], filesB.filesAvailable).reasons, [], "B exports before the bind");

  // W: change the figures of A only.
  const a2 = await bindOk(repository, TARGET_A, a1.id, [entry(FIG_1, 1, png.drawing.id), entry(FIG_2, 2, jpg.drawing.id)]);
  assert.notEqual(a2.id, a1.id);
  assert.equal(a2.parentId, a1.id);
  state = await revisionState(repository, state);

  // T: A has a new FigureSetRevision, and everything bound to the old snapshot is retired.
  assert.equal(state.targets[TARGET_A].figureRevisionId, a2.id);
  const liveA = liveSnapshot(state, TARGET_A);
  assert.equal(isCurrent(snapA, liveA), false, "A's old snapshot is not current");
  assert.equal(isInputStale(savedA.revision.input, currentInput(state, TARGET_A)), true, "A's draft input is stale");
  assert.equal(isConfirmationCurrent(ledger, confirmed[TARGET_A], liveA), false, "A's confirmation is no longer current");
  assert.deepEqual(currentConfirmations(ledger, liveA), []);
  const filesA2 = (await checkFigureExportGate(repository, ACTOR_A, MATTER_ID, { targetId: TARGET_A }, { now: clock })).data;
  assert.equal(filesA2.allowed, true, "the files themselves are fine; only currency changed");

  // A gate on the old snapshot does not pass.
  const oldGate = exportGate(state, ledger, TARGET_A, bound[TARGET_A], filesA2.filesAvailable);
  assert.equal(oldGate.allowed, false);
  assert.deepEqual(oldGate.reasons, [{ code: "STALE_BINDING" }]);
  // Exporting A's live snapshot with the old check, confirmation and approval does not pass either.
  const carried = exportGate(state, ledger, TARGET_A, { ...bound[TARGET_A], snapshot: liveA }, filesA2.filesAvailable);
  assert.equal(carried.allowed, false);
  assert.deepEqual(carried.reasons, [{ code: "CHECK_REQUIRED", resourceId: bound[TARGET_A].checkRun.id }]);
  const rechecked = exportGate(
    state,
    ledger,
    TARGET_A,
    { snapshot: liveA, checkRun: checkRunOn(liveA, "c0c0c0c0-0000-4000-8000-0000000000aa"), approval: bound[TARGET_A].approval },
    filesA2.filesAvailable,
  );
  assert.equal(rechecked.allowed, false);
  assert.deepEqual(
    rechecked.reasons.map((reason) => reason.code),
    ["INPUT_STALE", "CONFIRMATION_REQUIRED", "APPROVAL_REQUIRED"],
    "a fresh check still needs the draft to adopt the new figures, a new confirmation and a new approval",
  );

  // B: same figure-set id, same snapshot, confirmation still current, input not stale, export still allowed.
  assert.equal(state.targets[TARGET_B].figureRevisionId, b1.id);
  const liveB = liveSnapshot(state, TARGET_B);
  assert.deepEqual(liveB, snapB);
  assert.equal(isCurrent(snapB, liveB), true);
  assert.equal(isInputStale(savedB.revision.input, currentInput(state, TARGET_B)), false);
  assert.equal(isConfirmationCurrent(ledger, confirmed[TARGET_B], liveB), true);
  assert.deepEqual(currentConfirmations(ledger, liveB), [confirmed[TARGET_B]]);
  const filesB2 = (await checkFigureExportGate(repository, ACTOR_A, MATTER_ID, { targetId: TARGET_B }, { now: clock })).data;
  assert.deepEqual(exportGate(state, ledger, TARGET_B, bound[TARGET_B], filesB2.filesAvailable).reasons, []);
});

test("S02-A08 figure-set ids minted by drawings.ts interoperate with revision.ts restore and adopt", async () => {
  const { repository } = await seed();
  const png = await importOk(repository, "drawing-valid.png");
  const jpg = await importOk(repository, "drawing-valid.jpg");
  const a1 = await bindOk(repository, TARGET_A, EMPTY_SET_A, [entry(FIG_1, 1, png.drawing.id)]);

  let state = await revisionState(repository);
  for (const set of state.targets[TARGET_A].figureSets) {
    assert.equal(figureSetRevisionSchema.safeParse(set).success, true, `persisted set ${set.id} is schema-valid`);
  }
  assert.deepEqual(
    state.targets[TARGET_A].figureSets.map((set) => set.id),
    [EMPTY_SET_A, a1.id],
    "the persisted history is append-only, oldest first",
  );
  const ids = revisionContext();
  const saved = saveRevision(state, { targetId: TARGET_A, baseRevisionId: null, ast: {}, astHash: AST_HASH, reason: "generated" }, ids);
  assert.equal(saved.ok, true);
  state = saved.state;

  const a2 = await bindOk(repository, TARGET_A, a1.id, [entry(FIG_1, 1, jpg.drawing.id)]);
  state = await revisionState(repository, state);

  // adoptInputs moves the draft onto the persisted new set by id.
  const adopted = adoptInputs(state, { targetId: TARGET_A, baseRevisionId: saved.revision.id, acknowledgedInputReview: true }, ids);
  assert.equal(adopted.ok, true);
  assert.equal(adopted.revision.input.figureRevisionId, a2.id);
  assert.equal(isInputStale(adopted.revision.input, currentInput(state, TARGET_A)), false);

  // restore_bound finds the persisted old set by the id the draft recorded and copies its entries.
  const restored = restoreRevision(adopted.state, { targetId: TARGET_A, revisionId: saved.revision.id, figureStrategy: "restore_bound" }, ids);
  assert.equal(restored.ok, true, restored.ok ? "" : JSON.stringify(restored.error));
  assert.equal(restored.figure.created, true);
  assert.equal(restored.figure.figureRevision.parentId, a2.id);
  assert.deepEqual(restored.figure.figureRevision.entries, a1.entries);
  assert.equal(restored.figure.figureRevision.hash, a1.hash);
  assert.equal(figureSetRevisionSchema.safeParse(restored.figure.figureRevision).success, true);
});
