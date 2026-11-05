/**
 * V6-13 — five-question intake and fact conflicts (S03, 05-contracts §3).
 *
 * Every case goes through the module's public interface against the real
 * `LocalRepository` over an in-memory backend. A "refresh" is a new repository
 * over the same stored bytes. The fixture is the ticket's own synthetic text;
 * no network, no model and no real material are involved.
 *
 * Acceptance mapping:
 * - V6-13-A01 reload keeps answers and sources
 * - V6-13-A02 no example disclosure is ever filled in; a fact change stales drafts
 * - V6-13-A03 refresh/retry matches persisted state and never duplicates a write
 * - S03-A01..A06 are named on their tests; A07..A09 are route-recommendation and
 *   target-preview behaviours for the downstream targets ticket (see receipt).
 * - S03 VERSION_CONFLICT side-by-side merge, including a true two-save race: B3.
 * - 05-contracts §2 idempotency covers no-op saves too: B4 (I1, I3, I5).
 * - pickers never offer a source whose chunks a save would refuse: N-c.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  bindDraftInput,
  readDraftBindings,
  readIntake,
  saveIntake,
  sourceRefForChunk,
  stageCandidates,
} from "../../../../apps/web/src/v6/features/intake/intake.ts";
import { chunkSetKey, PARSER_VERSION } from "../../../../apps/web/src/v6/features/sources/parse.ts";
import {
  ACTOR_A,
  CONTRACT_VERSION,
  MATTER_ID,
  STORES,
  T0,
  addTargets,
  chunkFor,
  directSources,
  fiveAnswers,
  freshRepository,
  organizationParty,
  personParty,
  refFor,
  retireSource,
  seedParsedMatter,
  targetRecord,
  uuidSource,
} from "./harness.mjs";

const T1 = "2026-11-01T01:00:00.000Z";
const T2 = "2026-11-01T02:00:00.000Z";
const T3 = "2026-11-01T03:00:00.000Z";

function noAnswers() {
  return fiveAnswers({ problem: "", difference: "" });
}

function command(overrides = {}) {
  return {
    baseSourceVersion: 1,
    answers: fiveAnswers(),
    questionSources: {},
    facts: [],
    conflicts: [],
    parties: [],
    ...overrides,
  };
}

async function viewOf(repositoryOrPromise) {
  const repository = await repositoryOrPromise;
  const outcome = await readIntake(repository, ACTOR_A, MATTER_ID);
  assert.equal(outcome.ok, true, outcome.ok ? "" : `${outcome.errorCode} ${outcome.message}`);
  return outcome.view;
}

function snapshotBlobs(backend) {
  return [...backend.store(STORES.blobs).values()].filter((value) => value?.kind === "intake.snapshot");
}

function snapshotEvents(backend) {
  return [...backend.store(STORES.events).values()].filter((value) => value?.action === "snapshot.created");
}

// ---------------------------------------------------------------------------
// V6-13-A01 / S03-A01
// ---------------------------------------------------------------------------

test("V6-13-A01 each answer is saved with its source and the fact version it was based on; a reload shows the same refs", async () => {
  const { backend, repository, chunks } = await seedParsedMatter();
  const person = personParty(uuidSource(5001)());
  const problemRef = refFor(chunks, "问题：现有换热");
  const outcome = await saveIntake(
    repository,
    ACTOR_A,
    MATTER_ID,
    command({
      answers: fiveAnswers({ inventorIds: [person.id] }),
      parties: [person],
      questionSources: {
        problem: { kind: "source", ref: problemRef },
        difference: { kind: "direct" },
        inventorIds: { kind: "direct" },
      },
    }),
    { now: () => T1, requestKey: "req-a01" },
  );
  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  assert.equal(outcome.version, 2);
  assert.equal(outcome.unchanged, false);
  assert.equal(outcome.replayed, false);

  const reloaded = await freshRepository(backend);
  const view = await viewOf(reloaded);
  assert.equal(view.sourceVersion, 2);
  assert.equal(view.hasSnapshot, true);
  assert.equal(view.state, "ready");
  assert.equal(view.answers.problem, "低温环境效率低，运行成本高。");
  assert.equal(view.answers.difference, "改进了流道结构，降低了流动阻力。");
  assert.deepEqual(view.answers.inventorIds, [person.id]);
  assert.equal(view.answers.disclosure, null);
  assert.equal(view.answers.maturity, null);

  const problem = view.questions.find((question) => question.key === "problem");
  assert.equal(problem.answered, true);
  assert.equal(problem.source.kind, "source");
  assert.deepEqual(problem.source.ref, problemRef);
  assert.equal(problem.basedOnVersion, 1);
  assert.equal(problem.savedAt, T1);
  assert.equal(problem.sourceChanged, false);

  const difference = view.questions.find((question) => question.key === "difference");
  assert.deepEqual(difference.source, { kind: "direct" });
  assert.equal(difference.basedOnVersion, 1);

  // Unanswered questions carry no source at all.
  for (const key of ["disclosure", "maturity"]) {
    const question = view.questions.find((item) => item.key === key);
    assert.equal(question.answered, false);
    assert.equal(question.source, null);
    assert.equal(question.basedOnVersion, null);
  }
});

test("S03-A01 material mentioning 「给客户看过样品」 is suggested beside question 4; disclosure stays null until the user chooses", async () => {
  const { backend, repository, chunks, newIds } = await seedParsedMatter();
  const fresh = await viewOf(repository);
  assert.equal(fresh.state, "empty");
  assert.equal(fresh.hasSnapshot, false);
  assert.equal(fresh.answers.disclosure, null);
  assert.equal(fresh.answers.maturity, null);

  const disclosure = fresh.questions.find((question) => question.key === "disclosure");
  assert.equal(disclosure.answered, false);
  assert.equal(disclosure.valueChoice, null);
  assert.equal(disclosure.source, null);
  assert.ok(disclosure.suggestions.length >= 1, "the material paragraph is offered as a source");
  const mention = disclosure.suggestions.find((suggestion) => suggestion.quote.includes("客户"));
  assert.ok(mention, "the 「给客户看过样品」 paragraph is among the suggestions");
  assert.deepEqual(mention.ref, sourceRefForChunk(chunkFor(chunks, "客户"), mention.quote));
  assert.equal(disclosure.answered, false, "a suggestion is not an answer");

  const person = personParty(newIds());
  const first = await saveIntake(
    repository,
    ACTOR_A,
    MATTER_ID,
    command({
      answers: fiveAnswers({ inventorIds: [person.id] }),
      parties: [person],
      questionSources: {
        problem: { kind: "direct" },
        difference: { kind: "direct" },
        inventorIds: { kind: "direct" },
      },
    }),
    { now: () => T1 },
  );
  assert.equal(first.ok, true, JSON.stringify(first));

  let view = await viewOf(freshRepository(backend));
  assert.equal(view.answers.disclosure, null, "the material's mention never becomes the disclosure answer");
  assert.equal(view.answers.maturity, null);
  assert.equal(view.questions.find((question) => question.key === "disclosure").source, null);

  // The user now makes the choice explicitly and cites the paragraph.
  const second = await saveIntake(
    repository,
    ACTOR_A,
    MATTER_ID,
    command({
      baseSourceVersion: 2,
      answers: fiveAnswers({ inventorIds: [person.id], disclosure: "private_showing" }),
      parties: [person],
      questionSources: {
        problem: { kind: "direct" },
        difference: { kind: "direct" },
        inventorIds: { kind: "direct" },
        disclosure: { kind: "source", ref: mention.ref },
      },
    }),
    { now: () => T2 },
  );
  assert.equal(second.ok, true, JSON.stringify(second));
  assert.equal(second.version, 3);

  view = await viewOf(freshRepository(backend));
  assert.equal(view.answers.disclosure, "private_showing");
  assert.equal(view.answers.maturity, null, "choosing disclosure does not choose maturity");
  const chosen = view.questions.find((question) => question.key === "disclosure");
  assert.equal(chosen.source.kind, "source");
  assert.deepEqual(chosen.source.ref, mention.ref);
  assert.equal(chosen.basedOnVersion, 2);
  assert.equal(chosen.savedAt, T2);
});

// ---------------------------------------------------------------------------
// S03-A02
// ---------------------------------------------------------------------------

test("S03-A02 an organization can never be an inventor; the field error is explicit and previously saved answers survive", async () => {
  const { backend, repository, newIds } = await seedParsedMatter();
  const person = personParty(newIds());
  const organization = organizationParty(newIds());
  const first = await saveIntake(
    repository,
    ACTOR_A,
    MATTER_ID,
    command({
      answers: fiveAnswers({ inventorIds: [person.id] }),
      parties: [person],
      questionSources: { problem: { kind: "direct" }, difference: { kind: "direct" }, inventorIds: { kind: "direct" } },
    }),
    { now: () => T1 },
  );
  assert.equal(first.ok, true, JSON.stringify(first));

  const rejected = await saveIntake(
    repository,
    ACTOR_A,
    MATTER_ID,
    command({
      baseSourceVersion: 2,
      answers: fiveAnswers({ problem: "第二个版本的问题", inventorIds: [organization.id] }),
      parties: [person, organization],
      questionSources: { problem: { kind: "direct" }, difference: { kind: "direct" }, inventorIds: { kind: "direct" } },
    }),
    { now: () => T2 },
  );
  assert.equal(rejected.ok, false);
  assert.equal(rejected.errorCode, "INVALID_INPUT");
  const field = rejected.fields.find((item) => item.path === "answers.inventorIds");
  assert.ok(field, JSON.stringify(rejected.fields));
  assert.equal(field.reason, "发明人必须是自然人");

  const loaded = await repository.loadMatter(ACTOR_A, MATTER_ID);
  assert.equal(loaded.data.data.matter.sourceVersion, 2, "a rejected save writes no version");
  const view = await viewOf(freshRepository(backend));
  assert.equal(view.answers.problem, "低温环境效率低，运行成本高。", "the saved answer is not lost");
  assert.deepEqual(view.answers.inventorIds, [person.id]);
});

// ---------------------------------------------------------------------------
// S03-A03
// ---------------------------------------------------------------------------

test("S03-A03 saving all five answers again unchanged writes no version, including a back-and-forward reconstructed from the view", async () => {
  const { backend, repository, newIds } = await seedParsedMatter();
  const person = personParty(newIds());
  const answers = fiveAnswers({
    inventorIds: [person.id],
    disclosure: "none",
    maturity: "tested_sample",
  });
  const sources = directSources();
  const first = await saveIntake(
    repository,
    ACTOR_A,
    MATTER_ID,
    command({ answers, parties: [person], questionSources: sources }),
    { now: () => T1 },
  );
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.equal(first.version, 2);
  assert.equal(snapshotEvents(backend).length, 1);
  assert.equal(snapshotBlobs(backend).length, 1);

  // The view is what a reloaded page edits: same answers, same recorded sources.
  const view = await viewOf(freshRepository(backend));
  const recordedSources = Object.fromEntries(
    view.questions.filter((question) => question.source !== null).map((question) => [question.key, question.source]),
  );
  const again = await saveIntake(
    repository,
    ACTOR_A,
    MATTER_ID,
    command({ baseSourceVersion: view.sourceVersion, answers: view.answers, parties: view.parties, questionSources: recordedSources }),
    { now: () => T2 },
  );
  assert.equal(again.ok, true, JSON.stringify(again));
  assert.equal(again.unchanged, true);
  assert.equal(again.version, 2);
  assert.equal(snapshotEvents(backend).length, 1, "no extra sourceVersion and no event");
  assert.equal(snapshotBlobs(backend).length, 1);

  const loaded = await repository.loadMatter(ACTOR_A, MATTER_ID);
  assert.equal(loaded.data.data.matter.sourceVersion, 2);
  const provenance = (await viewOf(freshRepository(backend))).questions.find((question) => question.key === "problem");
  assert.equal(provenance.savedAt, T1, "an unchanged answer keeps its original provenance");
});

// ---------------------------------------------------------------------------
// S03-A04
// ---------------------------------------------------------------------------

test("S03-A04 changing a shared fact makes both derived drafts stale and keeps the version each draft was built from", async () => {
  const ids = uuidSource(6001);
  const targetA = targetRecord(ids());
  const targetB = targetRecord(ids());
  const { backend, repository } = await seedParsedMatter({ targets: [targetA, targetB] });
  const bindA = await bindDraftInput(repository, ACTOR_A, MATTER_ID, {
    matterId: MATTER_ID,
    targetId: targetA.id,
    sourceVersion: 1,
    targetConfigVersion: 1,
    figureRevisionId: targetA.figureRevisionId,
  });
  const bindB = await bindDraftInput(repository, ACTOR_A, MATTER_ID, {
    matterId: MATTER_ID,
    targetId: targetB.id,
    sourceVersion: 1,
    targetConfigVersion: 1,
    figureRevisionId: targetB.figureRevisionId,
  });
  assert.equal(bindA.ok, true, JSON.stringify(bindA));
  assert.equal(bindB.ok, true, JSON.stringify(bindB));

  let view = await viewOf(repository);
  assert.equal(view.drafts.length, 2);
  assert.deepEqual(view.drafts.map((draft) => draft.stale), [false, false]);
  assert.equal(view.state, "empty", "bindings alone do not invent a snapshot");

  const factId = ids();
  const saved = await saveIntake(
    repository,
    ACTOR_A,
    MATTER_ID,
    command({
      answers: noAnswers(),
      facts: [
        {
          id: factId,
          statement: "共享事实：工作温度为 80°C。",
          kind: "parameter",
          status: "user_confirmed",
          refs: [],
          confirmedBy: null,
          confirmedAt: null,
        },
      ],
    }),
    { now: () => T1 },
  );
  assert.equal(saved.ok, true, JSON.stringify(saved));
  assert.equal(saved.version, 2);

  view = await viewOf(freshRepository(backend));
  assert.equal(view.state, "stale");
  assert.equal(view.sourceVersion, 2);
  assert.deepEqual(
    view.drafts.map((draft) => ({ stale: draft.stale, input: draft.inputSourceVersion, current: draft.currentSourceVersion })),
    [
      { stale: true, input: 1, current: 2 },
      { stale: true, input: 1, current: 2 },
    ],
    "both targets report inputStale against the old version, never the new one",
  );
  const bindings = await readDraftBindings(repository, ACTOR_A, MATTER_ID);
  assert.equal(bindings.ok, true);
  assert.deepEqual(bindings.bindings.map((binding) => binding.input.sourceVersion).sort(), [1, 1]);
});

// ---------------------------------------------------------------------------
// S03-A05
// ---------------------------------------------------------------------------

test("S03-A05 only explicitly adopted candidates enter the snapshot; the rest stay outside every target", async () => {
  const { backend, repository, newIds } = await seedParsedMatter();
  const candidateIds = Array.from({ length: 6 }, () => newIds());
  const staged = await stageCandidates(
    repository,
    ACTOR_A,
    MATTER_ID,
    candidateIds.map((id, index) => ({
      id,
      statement: `候选事实 ${index + 1}：工作温度为 ${80 + index * 10}°C。`,
      kind: "parameter",
      status: "user_confirmed",
      refs: [],
    })),
    { now: () => T1, jobId: null },
  );
  assert.equal(staged.ok, true, JSON.stringify(staged));
  const afterStaging = await repository.loadMatter(ACTOR_A, MATTER_ID);
  assert.equal(afterStaging.data.data.matter.sourceVersion, 1, "staging candidates writes no snapshot");

  const adopted = candidateIds.slice(0, 4);
  const saved = await saveIntake(
    repository,
    ACTOR_A,
    MATTER_ID,
    command({ answers: noAnswers(), adoptCandidateIds: adopted }),
    { now: () => T2 },
  );
  assert.equal(saved.ok, true, JSON.stringify(saved));
  assert.equal(saved.version, 2);
  assert.deepEqual(saved.snapshot.facts.map((fact) => fact.id).sort(), [...adopted].sort());

  const view = await viewOf(freshRepository(backend));
  assert.deepEqual(view.facts.map((fact) => fact.id).sort(), [...adopted].sort());
  assert.equal(view.candidates.length, 6);
  assert.deepEqual(view.candidates.filter((candidate) => candidate.adopted).map((candidate) => candidate.id).sort(), [...adopted].sort());
  for (const id of candidateIds.slice(4)) {
    assert.equal(view.facts.some((fact) => fact.id === id), false, "an unadopted candidate never enters the snapshot");
    assert.equal(view.candidates.find((candidate) => candidate.id === id).adopted, false);
  }
});

// ---------------------------------------------------------------------------
// S03-A06
// ---------------------------------------------------------------------------

test("S03-A06 a retained conflict needs a reason; once given, both facts stay preserved and locatable", async () => {
  const { backend, repository, newIds } = await seedParsedMatter();
  const firstId = newIds();
  const secondId = newIds();
  const conflictId = newIds();
  const facts = [
    {
      id: firstId,
      statement: "工作温度为 80°C。",
      kind: "parameter",
      status: "user_confirmed",
      refs: [],
      confirmedBy: null,
      confirmedAt: null,
    },
    {
      id: secondId,
      statement: "工作温度为 120°C。",
      kind: "parameter",
      status: "user_confirmed",
      refs: [],
      confirmedBy: null,
      confirmedAt: null,
    },
  ];
  const withoutReason = await saveIntake(
    repository,
    ACTOR_A,
    MATTER_ID,
    command({
      answers: noAnswers(),
      facts,
      conflicts: [{ id: conflictId, factIds: [firstId, secondId], state: "retained", chosenFactIds: [], reason: null }],
    }),
    { now: () => T1 },
  );
  assert.equal(withoutReason.ok, false);
  assert.equal(withoutReason.errorCode, "INVALID_INPUT");
  assert.ok(
    withoutReason.fields.some((field) => field.path === `conflicts.${conflictId}.reason` && field.reason === "保留冲突必须填写理由"),
    JSON.stringify(withoutReason.fields),
  );
  let loaded = await repository.loadMatter(ACTOR_A, MATTER_ID);
  assert.equal(loaded.data.data.matter.sourceVersion, 1, "a rejected conflict writes no version");

  const withReason = await saveIntake(
    repository,
    ACTOR_A,
    MATTER_ID,
    command({
      answers: noAnswers(),
      facts,
      conflicts: [
        {
          id: conflictId,
          factIds: [firstId, secondId],
          state: "retained",
          chosenFactIds: [],
          reason: "两份测试报告的数值不同，客户确认以 120°C 为准。",
        },
      ],
    }),
    { now: () => T2 },
  );
  assert.equal(withReason.ok, true, JSON.stringify(withReason));
  assert.equal(withReason.version, 2);

  const view = await viewOf(freshRepository(backend));
  assert.equal(view.facts.length, 2, "neither side of the conflict is deleted");
  assert.equal(view.conflicts.length, 1);
  const conflict = view.conflicts[0];
  assert.equal(conflict.state, "retained");
  assert.deepEqual(conflict.factIds, [firstId, secondId]);
  assert.deepEqual(conflict.chosenFactIds, []);
  assert.equal(conflict.reason, "两份测试报告的数值不同，客户确认以 120°C 为准。");
  assert.deepEqual(conflict.facts.map((fact) => fact.statement), ["工作温度为 80°C。", "工作温度为 120°C。"]);
  for (const factId of [firstId, secondId]) {
    assert.deepEqual(view.facts.find((fact) => fact.id === factId).conflictIds, [conflictId], "the conflict is locatable from either fact");
  }

  const openWithReason = await saveIntake(
    repository,
    ACTOR_A,
    MATTER_ID,
    command({
      baseSourceVersion: 2,
      answers: noAnswers(),
      facts,
      conflicts: [{ id: conflictId, factIds: [firstId, secondId], state: "open", chosenFactIds: [], reason: "理由" }],
    }),
    { now: () => T3 },
  );
  assert.equal(openWithReason.ok, false);
  const resolvedWithoutChoice = await saveIntake(
    repository,
    ACTOR_A,
    MATTER_ID,
    command({
      baseSourceVersion: 2,
      answers: noAnswers(),
      facts,
      conflicts: [{ id: conflictId, factIds: [firstId, secondId], state: "resolved", chosenFactIds: [], reason: null }],
    }),
    { now: () => T3 },
  );
  assert.equal(resolvedWithoutChoice.ok, false);
  loaded = await repository.loadMatter(ACTOR_A, MATTER_ID);
  assert.equal(loaded.data.data.matter.sourceVersion, 2);
});

// ---------------------------------------------------------------------------
// V6-13-A02
// ---------------------------------------------------------------------------

test("V6-13-A02 invalid input is reported per field, and an unanswered disclosure is never filled from the material or from an example", async () => {
  const { backend, repository, chunks, newIds } = await seedParsedMatter();
  const person = personParty(newIds());

  const missingSource = await saveIntake(
    repository,
    ACTOR_A,
    MATTER_ID,
    command({
      answers: fiveAnswers({ inventorIds: [person.id] }),
      parties: [person],
      questionSources: { difference: { kind: "direct" }, inventorIds: { kind: "direct" } },
    }),
    { now: () => T1 },
  );
  assert.equal(missingSource.ok, false);
  assert.equal(missingSource.errorCode, "INVALID_INPUT");
  assert.ok(
    missingSource.fields.some((field) => field.path === "sources.problem" && field.reason.includes("来源")),
    JSON.stringify(missingSource.fields),
  );

  const badRef = refFor(chunks, "问题：现有换热");
  const wrongLocator = await saveIntake(
    repository,
    ACTOR_A,
    MATTER_ID,
    command({
      answers: fiveAnswers({ inventorIds: [person.id] }),
      parties: [person],
      questionSources: {
        problem: { kind: "source", ref: { ...badRef, quote: "供应商" } },
        difference: { kind: "direct" },
        inventorIds: { kind: "direct" },
      },
    }),
    { now: () => T1 },
  );
  assert.equal(wrongLocator.ok, false);
  assert.equal(wrongLocator.errorCode, "SOURCE_LOCATOR_INVALID");

  const invalidChoices = await saveIntake(
    repository,
    ACTOR_A,
    MATTER_ID,
    command({
      answers: fiveAnswers({ disclosure: "maybe", maturity: "prototype" }),
      questionSources: { problem: { kind: "direct" }, difference: { kind: "direct" } },
    }),
    { now: () => T1 },
  );
  assert.equal(invalidChoices.ok, false);
  assert.equal(invalidChoices.errorCode, "INVALID_INPUT");
  assert.ok(invalidChoices.fields.some((field) => field.path === "answers.disclosure"));
  assert.ok(invalidChoices.fields.some((field) => field.path === "answers.maturity"));

  // A save that does not say which fact version it builds on is refused.
  for (const baseSourceVersion of [undefined, null, 0, 1.5]) {
    const noBase = await saveIntake(
      repository,
      ACTOR_A,
      MATTER_ID,
      command({ baseSourceVersion, questionSources: directSources() }),
      { now: () => T1 },
    );
    assert.equal(noBase.ok, false, `base ${baseSourceVersion} is refused`);
    assert.equal(noBase.errorCode, "INVALID_INPUT");
    assert.ok(noBase.fields.some((field) => field.path === "baseSourceVersion"), JSON.stringify(noBase.fields));
  }

  const loaded = await repository.loadMatter(ACTOR_A, MATTER_ID);
  assert.equal(loaded.data.data.matter.sourceVersion, 1, "none of the rejected attempts advanced the version");
  const view = await viewOf(freshRepository(backend));
  assert.equal(view.hasSnapshot, false);
  assert.equal(view.answers.disclosure, null);
  assert.equal(view.answers.maturity, null);
});

test("V6-13-A02 changing a fact marks a derived draft stale, while the unanswered disclosure stays null", async () => {
  const ids = uuidSource(7001);
  const target = targetRecord(ids());
  const { backend, repository } = await seedParsedMatter({ targets: [target] });
  const saved = await saveIntake(
    repository,
    ACTOR_A,
    MATTER_ID,
    command({
      answers: fiveAnswers({ problem: "只有问题被回答。", difference: "区别由用户直接回答。" }),
      questionSources: { problem: { kind: "direct" }, difference: { kind: "direct" } },
    }),
    { now: () => T1 },
  );
  assert.equal(saved.ok, true, JSON.stringify(saved));

  // The drafting seam binds the draft at the current fact version.
  const bound = await bindDraftInput(repository, ACTOR_A, MATTER_ID, {
    matterId: MATTER_ID,
    targetId: target.id,
    sourceVersion: 2,
    targetConfigVersion: 1,
    figureRevisionId: target.figureRevisionId,
  });
  assert.equal(bound.ok, true, JSON.stringify(bound));
  let view = await viewOf(freshRepository(backend));
  assert.equal(view.answers.disclosure, null);
  assert.equal(view.answers.maturity, null);
  assert.equal(view.drafts[0].stale, false, "the draft is current before the fact changes");

  const changedFact = await saveIntake(
    repository,
    ACTOR_A,
    MATTER_ID,
    command({
      baseSourceVersion: 2,
      answers: view.answers,
      questionSources: {
        problem: { kind: "direct" },
        difference: { kind: "direct" },
      },
      facts: [
        {
          id: ids(),
          statement: "修改后的事实：工作温度为 100°C。",
          kind: "parameter",
          status: "user_confirmed",
          refs: [],
          confirmedBy: null,
          confirmedAt: null,
        },
      ],
      parties: [],
    }),
    { now: () => T2 },
  );
  assert.equal(changedFact.ok, true, JSON.stringify(changedFact));
  view = await viewOf(freshRepository(backend));
  assert.equal(view.answers.disclosure, null, "no example disclosure appears after many saves");
  assert.equal(view.answers.maturity, null);
  assert.equal(view.drafts[0].stale, true, "the fact change moved sourceVersion after the draft was bound");
  assert.equal(view.drafts[0].inputSourceVersion, 2);
  assert.equal(view.drafts[0].currentSourceVersion, 3);
  assert.equal(view.state, "stale");
});

// ---------------------------------------------------------------------------
// V6-13-A03
// ---------------------------------------------------------------------------

test("V6-13-A03 the same request key replays instead of writing twice; a different payload under it is refused; a stale base returns both sides", async () => {
  const { backend, repository } = await seedParsedMatter();
  const firstCommand = command({
    answers: fiveAnswers({ problem: "第一次保存的问题。" }),
    questionSources: { problem: { kind: "direct" }, difference: { kind: "direct" } },
  });
  const first = await saveIntake(repository, ACTOR_A, MATTER_ID, firstCommand, { now: () => T1, requestKey: "req-a03" });
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.equal(first.version, 2);
  assert.equal(snapshotEvents(backend).length, 1);
  assert.equal(snapshotBlobs(backend).length, 1);

  const replay = await saveIntake(repository, ACTOR_A, MATTER_ID, firstCommand, { now: () => T2, requestKey: "req-a03" });
  assert.equal(replay.ok, true, JSON.stringify(replay));
  assert.equal(replay.replayed, true);
  assert.equal(replay.version, 2);
  assert.equal(snapshotEvents(backend).length, 1, "a replay writes no second event");
  assert.equal(snapshotBlobs(backend).length, 1, "a replay writes no second snapshot");

  const differentPayload = await saveIntake(
    repository,
    ACTOR_A,
    MATTER_ID,
    command({
      answers: fiveAnswers({ problem: "同号但内容不同。" }),
      questionSources: { problem: { kind: "direct" }, difference: { kind: "direct" } },
    }),
    { now: () => T2, requestKey: "req-a03" },
  );
  assert.equal(differentPayload.ok, false);
  assert.equal(differentPayload.errorCode, "IDEMPOTENCY_CONFLICT");

  const staleBase = await saveIntake(
    repository,
    ACTOR_A,
    MATTER_ID,
    command({
      answers: fiveAnswers({ problem: "基于旧版本。" }),
      questionSources: { problem: { kind: "direct" }, difference: { kind: "direct" } },
    }),
    { now: () => T2, requestKey: "req-a03-stale" },
  );
  assert.equal(staleBase.ok, false);
  assert.equal(staleBase.errorCode, "VERSION_CONFLICT");
  assert.equal(staleBase.latestVersion, 2);
  assert.notEqual(staleBase.latest, null);
  assert.equal(staleBase.latest.answers.problem, "第一次保存的问题。");
  assert.equal(staleBase.message, "其他窗口已保存了更新的版本。请对照两版内容合并后重试。");
});

test("V6-13-A03 a failed commit leaves the version untouched and retry succeeds; a post-commit snapshot failure reports committedVersion and never duplicates", async () => {
  const { backend, repository } = await seedParsedMatter();
  const firstCommand = command({
    answers: fiveAnswers({ problem: "提交会失败。" }),
    questionSources: { problem: { kind: "direct" }, difference: { kind: "direct" } },
  });

  backend.setPutFault(({ store }) => (store === STORES.events ? new Error("synthetic event failure") : null));
  const failed = await saveIntake(repository, ACTOR_A, MATTER_ID, firstCommand, { now: () => T1, requestKey: "req-fail" });
  assert.equal(failed.ok, false);
  assert.equal(failed.errorCode, "STORAGE_UNAVAILABLE");
  backend.setPutFault(null);
  let loaded = await repository.loadMatter(ACTOR_A, MATTER_ID);
  assert.equal(loaded.data.data.matter.sourceVersion, 1, "the rolled-back commit did not move sourceVersion");

  const retried = await saveIntake(
    repository,
    ACTOR_A,
    MATTER_ID,
    { ...firstCommand, answers: fiveAnswers({ problem: "重试后的问题。" }) },
    { now: () => T2, requestKey: "req-fail" },
  );
  assert.equal(retried.ok, true, JSON.stringify(retried));
  assert.equal(retried.version, 2);
  assert.equal(snapshotEvents(backend).length, 1);

  // Commit succeeds, then the snapshot blob write fails.
  backend.setPutFault(({ store, key }) =>
    store === STORES.blobs && typeof key === "string" && key.startsWith("intake/snapshot/") ? new Error("disk full") : null,
  );
  const halfSaved = await saveIntake(
    repository,
    ACTOR_A,
    MATTER_ID,
    command({
      baseSourceVersion: 2,
      answers: fiveAnswers({ problem: "快照写失败。" }),
      questionSources: { problem: { kind: "direct" }, difference: { kind: "direct" } },
    }),
    { now: () => T3, requestKey: "req-post-commit" },
  );
  assert.equal(halfSaved.ok, false);
  assert.equal(halfSaved.errorCode, "STORAGE_UNAVAILABLE");
  assert.equal(halfSaved.committedVersion, 3);
  assert.doesNotMatch(halfSaved.message, /没有保存/, "a committed version is never reported as not saved");
  loaded = await repository.loadMatter(ACTOR_A, MATTER_ID);
  assert.equal(loaded.data.data.matter.sourceVersion, 3, "the commit is durable");
  assert.equal(snapshotEvents(backend).length, 2, "exactly one event per committed save");

  const recovering = await readIntake(await freshRepository(backend), ACTOR_A, MATTER_ID);
  assert.equal(recovering.ok, true, JSON.stringify(recovering));
  assert.equal(recovering.view.sourceVersion, 3, "the read names the committed version");
  assert.deepEqual(recovering.view.recovery, { missingVersion: 3, recoveredFromVersion: 2 });
  assert.equal(recovering.view.hasSnapshot, false, "the older answers are never passed off as version 3");

  const duplicate = await saveIntake(
    repository,
    ACTOR_A,
    MATTER_ID,
    command({
      baseSourceVersion: 2,
      answers: fiveAnswers({ problem: "快照写失败。" }),
      questionSources: { problem: { kind: "direct" }, difference: { kind: "direct" } },
    }),
    { now: () => T3, requestKey: "req-post-commit" },
  );
  assert.equal(duplicate.ok, false);
  assert.equal(
    duplicate.errorCode,
    "STORAGE_UNAVAILABLE",
    "a same-key retry replays the original committed error instead of a conflict",
  );
  assert.equal(duplicate.committedVersion, 3);
  assert.doesNotMatch(duplicate.message, /没有保存/);
  assert.equal(snapshotEvents(backend).length, 2, "the retry writes no second event");

  backend.setPutFault(null);
  const recovered = await saveIntake(
    repository,
    ACTOR_A,
    MATTER_ID,
    command({
      baseSourceVersion: 3,
      answers: fiveAnswers({ problem: "补齐快照。" }),
      questionSources: { problem: { kind: "direct" }, difference: { kind: "direct" } },
    }),
    { now: () => T3, requestKey: "req-recovered" },
  );
  assert.equal(recovered.ok, true, JSON.stringify(recovered));
  assert.equal(recovered.version, 4);
  const view = await viewOf(freshRepository(backend));
  assert.equal(view.sourceVersion, 4);
  assert.equal(view.answers.problem, "补齐快照。");
});

// ---------------------------------------------------------------------------
// S03 four states, source change and snapshot refusals
// ---------------------------------------------------------------------------

test("V6-13 the empty, stale and error read states are explicit; a changed chunk marks facts and sources as stale", async () => {
  const { backend, repository, sourceId, chunks, newIds } = await seedParsedMatter();
  let view = await viewOf(repository);
  assert.equal(view.state, "empty");
  assert.equal(view.completeness, "empty");
  assert.equal(view.missing.length, 5);

  const problemRef = refFor(chunks, "问题：现有换热");
  const factRef = refFor(chunks, "区别：与现有");
  const factId = newIds();
  const saved = await saveIntake(
    repository,
    ACTOR_A,
    MATTER_ID,
    command({
      answers: fiveAnswers({ problem: "引用材料的问题。", difference: "" }),
      questionSources: { problem: { kind: "source", ref: problemRef } },
      facts: [
        {
          id: factId,
          statement: "流道结构得到改进。",
          kind: "structure",
          status: "source_backed",
          refs: [factRef],
          confirmedBy: null,
          confirmedAt: null,
        },
      ],
    }),
    { now: () => T1 },
  );
  assert.equal(saved.ok, true, JSON.stringify(saved));

  view = await viewOf(repository);
  assert.equal(view.state, "ready");
  assert.equal(view.completeness, "partial");
  assert.equal(view.facts[0].sourceChanged, false);

  // Replace the parsed chunks: the stored refs no longer locate their text.
  backend.store(STORES.blobs).delete(chunkSetKey(sourceId, PARSER_VERSION));
  const reloaded = await freshRepository(backend);
  view = await viewOf(reloaded);
  assert.equal(view.state, "stale");
  assert.equal(view.facts[0].sourceChanged, true);
  assert.equal(view.questions.find((question) => question.key === "problem").sourceChanged, true);
  assert.deepEqual(view.questions.find((question) => question.key === "problem").source.kind, "source");

  // A version that names a snapshot the store does not have is not "empty".
  const loaded = await repository.loadMatter(ACTOR_A, MATTER_ID);
  const bumped = await repository.commit(
    ACTOR_A,
    {
      contractVersion: CONTRACT_VERSION,
      expectedVersion: loaded.data.data.matter.version,
      payload: {
        matter: { ...loaded.data.data.matter, version: loaded.data.data.matter.version + 1, sourceVersion: 9 },
        targets: loaded.data.data.targets,
        assets: loaded.data.data.assets,
        events: [],
        blobs: [],
      },
    },
    { requestId: "99999999-9999-4999-8999-999999999999" },
  );
  assert.equal(bumped.ok, true, JSON.stringify(bumped));
  const gap = await readIntake(await freshRepository(backend), ACTOR_A, MATTER_ID);
  assert.equal(gap.ok, true, JSON.stringify(gap));
  assert.notEqual(gap.view.state, "empty");
  assert.deepEqual(gap.view.recovery, { missingVersion: 9, recoveredFromVersion: 2 });
  assert.equal(gap.view.answers.problem, "引用材料的问题。", "the last good snapshot is shown, labelled as older");
});

test("V6-13 user_confirmed facts keep their original confirmation when an unrelated save carries them forward", async () => {
  const { backend, repository, newIds } = await seedParsedMatter();
  const factId = newIds();
  const fact = {
    id: factId,
    statement: "用户确认：样品在低温下通过测试。",
    kind: "effect",
    status: "user_confirmed",
    refs: [],
    confirmedBy: null,
    confirmedAt: null,
  };
  const first = await saveIntake(
    repository,
    ACTOR_A,
    MATTER_ID,
    command({ answers: noAnswers(), facts: [fact] }),
    { now: () => T1, requestKey: "req-confirm-1" },
  );
  assert.equal(first.ok, true, JSON.stringify(first));
  let view = await viewOf(repository);
  assert.equal(view.facts[0].confirmedBy, "33333333-3333-4333-8333-333333333333");
  assert.equal(view.facts[0].confirmedAt, T1);

  const second = await saveIntake(
    repository,
    ACTOR_A,
    MATTER_ID,
    command({
      baseSourceVersion: 2,
      facts: [{ ...view.facts[0] }],
      answers: fiveAnswers({ problem: "与事实无关的新答案。", difference: "" }),
      questionSources: { problem: { kind: "direct" } },
    }),
    { now: () => T2, requestKey: "req-confirm-2" },
  );
  assert.equal(second.ok, true, JSON.stringify(second));
  assert.equal(second.version, 3);
  view = await viewOf(freshRepository(backend));
  assert.equal(view.facts[0].confirmedAt, T1, "an unchanged fact keeps the moment it was confirmed");
  assert.equal(view.facts[0].confirmedBy, "33333333-3333-4333-8333-333333333333");
});

test("V6-13 the contract snapshot is validated and includes only the active source ids", async () => {
  const { repository, chunks } = await seedParsedMatter();
  const saved = await saveIntake(
    repository,
    ACTOR_A,
    MATTER_ID,
    command({ answers: noAnswers(), questionSources: {} }),
    { now: () => T0 },
  );
  // An empty form with no snapshot is unchanged: no example rows are written.
  assert.equal(saved.ok, true, JSON.stringify(saved));
  assert.equal(saved.unchanged, true);
  assert.equal(saved.version, 1);

  const withAnswer = await saveIntake(
    repository,
    ACTOR_A,
    MATTER_ID,
    command({
      answers: fiveAnswers({ problem: "合同校验的问题。", difference: "" }),
      questionSources: { problem: { kind: "direct" } },
    }),
    { now: () => T1 },
  );
  assert.equal(withAnswer.ok, true, JSON.stringify(withAnswer));
  assert.equal(withAnswer.snapshot.matterId, MATTER_ID);
  assert.equal(withAnswer.snapshot.version, 2);
  assert.deepEqual(withAnswer.snapshot.sourceIds, [...new Set(chunks.map((chunk) => chunk.sourceId))]);
  assert.equal(withAnswer.snapshot.createdBy, "33333333-3333-4333-8333-333333333333");
  assert.equal(withAnswer.snapshot.createdAt, T1);
});

// ---------------------------------------------------------------------------
// Fix round 1 (review-01 B1, B2)
// ---------------------------------------------------------------------------

function faultSnapshotWrites(backend) {
  backend.setPutFault(({ store, key }) =>
    store === STORES.blobs && typeof key === "string" && key.startsWith("intake/snapshot/") ? new Error("disk full") : null,
  );
}

test("V6-13-A03 B1 after a post-commit snapshot failure a fresh read recovers at the committed version and a save there fills the gap", async () => {
  const { backend, repository } = await seedParsedMatter();
  const directBoth = { problem: { kind: "direct" }, difference: { kind: "direct" } };
  const v2 = await saveIntake(
    repository,
    ACTOR_A,
    MATTER_ID,
    command({ answers: fiveAnswers({ problem: "第二版的问题。" }), questionSources: directBoth }),
    { now: () => T1, requestKey: "req-b1-v2" },
  );
  assert.equal(v2.ok, true, JSON.stringify(v2));

  faultSnapshotWrites(backend);
  const halfSaved = await saveIntake(
    repository,
    ACTOR_A,
    MATTER_ID,
    command({ baseSourceVersion: 2, answers: fiveAnswers({ problem: "快照没写成。" }), questionSources: directBoth }),
    { now: () => T2, requestKey: "req-b1-v3" },
  );
  assert.equal(halfSaved.committedVersion, 3);
  backend.setPutFault(null);

  // A reload: a new repository over the same bytes, as a fresh mount reads it.
  const reloaded = await freshRepository(backend);
  const read = await readIntake(reloaded, ACTOR_A, MATTER_ID);
  assert.equal(read.ok, true, JSON.stringify(read));
  const view = read.view;
  assert.equal(view.sourceVersion, 3);
  assert.deepEqual(view.recovery, { missingVersion: 3, recoveredFromVersion: 2 });
  assert.equal(view.answers.problem, "第二版的问题。");
  // The v2 answer was saved against version 1; its provenance says so.
  assert.equal(view.questions.find((question) => question.key === "problem").basedOnVersion, 1);

  // Saving the recovered answers unchanged still writes: the gap must be filled.
  const filled = await saveIntake(
    reloaded,
    ACTOR_A,
    MATTER_ID,
    command({ baseSourceVersion: view.sourceVersion, answers: view.answers, questionSources: directBoth }),
    { now: () => T3, requestKey: "req-b1-fill" },
  );
  assert.equal(filled.ok, true, JSON.stringify(filled));
  assert.equal(filled.unchanged, false);
  assert.equal(filled.version, 4);
  assert.equal(snapshotEvents(backend).length, 3, "one event per committed version, none duplicated");
  const after = await viewOf(freshRepository(backend));
  assert.equal(after.sourceVersion, 4);
  assert.equal(after.recovery, null);
  assert.equal(after.hasSnapshot, true);
  assert.equal(after.answers.problem, "第二版的问题。");
  assert.equal(
    after.questions.find((question) => question.key === "problem").basedOnVersion,
    1,
    "an answer carried through recovery keeps its original provenance",
  );
});

test("V6-13-A03 B1 when the very first snapshot write fails, a fresh read shows an empty form at the committed version, not an error", async () => {
  const { backend, repository } = await seedParsedMatter();
  faultSnapshotWrites(backend);
  const halfSaved = await saveIntake(
    repository,
    ACTOR_A,
    MATTER_ID,
    command({ questionSources: directSources() }),
    { now: () => T1, requestKey: "req-b1-first" },
  );
  assert.equal(halfSaved.committedVersion, 2);
  backend.setPutFault(null);
  const view = await viewOf(freshRepository(backend));
  assert.equal(view.sourceVersion, 2);
  assert.deepEqual(view.recovery, { missingVersion: 2, recoveredFromVersion: null });
  assert.equal(view.answers.problem, "");
  assert.equal(view.answers.disclosure, null, "recovery never invents an answer");
  const saved = await saveIntake(
    await freshRepository(backend),
    ACTOR_A,
    MATTER_ID,
    command({ baseSourceVersion: 2, questionSources: directSources() }),
    { now: () => T2, requestKey: "req-b1-first-fill" },
  );
  assert.equal(saved.ok, true, JSON.stringify(saved));
  assert.equal(saved.version, 3);
});

test("V6-13 idempotency records are scoped by (tenant, actor, operation, key) and bind the matter in the request hash", async () => {
  const { backend, repository } = await seedParsedMatter();
  const saved = await saveIntake(
    repository,
    ACTOR_A,
    MATTER_ID,
    command({ questionSources: { problem: { kind: "direct" }, difference: { kind: "direct" } } }),
    { now: () => T1, requestKey: "req-scope" },
  );
  assert.equal(saved.ok, true, JSON.stringify(saved));
  const keys = [...backend.store(STORES.blobs).keys()].filter(
    (key) => typeof key === "string" && key.startsWith("intake/idempotency/"),
  );
  assert.deepEqual(keys, [
    `intake/idempotency/${encodeURIComponent(ACTOR_A.tenantId)}/${encodeURIComponent(ACTOR_A.userId)}/intake.save/req-scope`,
  ]);
  const record = backend.store(STORES.blobs).get(keys[0]);
  assert.equal(record.operation, "intake.save");
  assert.equal(record.matterId, MATTER_ID);
});

function disclosureAnswers(evidenceRefs) {
  return fiveAnswers({
    disclosure: "private_showing",
    disclosureDetail: { occurredOn: "2026-05-01", audience: "一位客户", confidentiality: "yes", evidenceRefs },
  });
}

test("V6-13 B2 a disclosure evidence ref with a forged quote or hash is refused as SOURCE_LOCATOR_INVALID", async () => {
  const { backend, repository, chunks } = await seedParsedMatter();
  const real = refFor(chunks, "客户签署了保密约定");
  const sources = { ...directSources(), disclosure: { kind: "direct" } };
  const forgedQuote = { ...real, quote: "不存在的证据文字" };
  const forgedHash = { ...real, chunkHash: "0".repeat(64) };
  for (const [index, refs] of [[0, [forgedQuote]], [1, [real, forgedHash]]]) {
    const outcome = await saveIntake(
      repository,
      ACTOR_A,
      MATTER_ID,
      command({ answers: disclosureAnswers(refs), questionSources: sources }),
      { now: () => T1 },
    );
    assert.equal(outcome.ok, false, JSON.stringify(outcome));
    assert.equal(outcome.errorCode, "SOURCE_LOCATOR_INVALID");
    assert.ok(
      outcome.fields.some((field) => field.path === `answers.disclosureDetail.evidenceRefs[${index}]`),
      JSON.stringify(outcome.fields),
    );
  }
  assert.equal(snapshotBlobs(backend).length, 0, "nothing was written");
  assert.equal(snapshotEvents(backend).length, 0);

  const ok = await saveIntake(
    repository,
    ACTOR_A,
    MATTER_ID,
    command({ answers: disclosureAnswers([real]), questionSources: sources }),
    { now: () => T1 },
  );
  assert.equal(ok.ok, true, JSON.stringify(ok));
  assert.deepEqual(ok.snapshot.answers.disclosureDetail.evidenceRefs, [real]);
});

test("V6-13 B2 after the source changes, a stored disclosure evidence ref reads as changed", async () => {
  const { backend, repository, sourceId, chunks } = await seedParsedMatter();
  const real = refFor(chunks, "客户签署了保密约定");
  const saved = await saveIntake(
    repository,
    ACTOR_A,
    MATTER_ID,
    command({ answers: disclosureAnswers([real]), questionSources: { ...directSources(), disclosure: { kind: "direct" } } }),
    { now: () => T1 },
  );
  assert.equal(saved.ok, true, JSON.stringify(saved));
  let disclosure = (await viewOf(freshRepository(backend))).questions.find((question) => question.key === "disclosure");
  assert.equal(disclosure.sourceChanged, false);
  assert.deepEqual(disclosure.evidenceChanged, [false]);

  backend.store(STORES.blobs).delete(chunkSetKey(sourceId, PARSER_VERSION));
  const view = await viewOf(freshRepository(backend));
  disclosure = view.questions.find((question) => question.key === "disclosure");
  assert.deepEqual(disclosure.evidenceChanged, [true]);
  assert.equal(disclosure.sourceChanged, true, "the disclosure answer is marked like any other changed source");
  assert.equal(view.state, "stale");
});

// ---------------------------------------------------------------------------
// B3 — a commit that loses its version check reports the fact version
// ---------------------------------------------------------------------------

/** The repository with `commit` wrapped; every other member is the real one. */
function withCommit(repository, wrap) {
  return new Proxy(repository, {
    get(target, prop) {
      if (prop === "commit") return (...args) => wrap(() => target.commit(...args));
      const value = target[prop];
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

/** Holds the first `parties` commits until all of them arrive, so each has passed its pre-check. */
function raceCommits(repository, parties) {
  let arrived = 0;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  return withCommit(repository, async (commit) => {
    if (arrived < parties) {
      arrived += 1;
      if (arrived === parties) release();
      await gate;
    }
    return commit();
  });
}

function raceTarget(n) {
  return targetRecord(`00000000-0000-4000-8000-${String(700000 + n).padStart(12, "0")}`, 70 + n);
}

const directBothSources = { problem: { kind: "direct" }, difference: { kind: "direct" } };

test("V6-13 B3 two saves race at the same base: one commits, the other gets VERSION_CONFLICT at the real sourceVersion with the winner's snapshot", async () => {
  const { backend, repository } = await seedParsedMatter();
  const racing = raceCommits(repository, 2);
  const texts = ["窗口甲的问题。", "窗口乙的问题。"];
  const outcomes = await Promise.all(
    texts.map((problem, index) =>
      saveIntake(
        racing,
        ACTOR_A,
        MATTER_ID,
        command({ answers: fiveAnswers({ problem }), questionSources: directBothSources }),
        { now: () => T1, requestKey: `race-${index}` },
      ),
    ),
  );
  const winners = outcomes.filter((outcome) => outcome.ok);
  const losers = outcomes.filter((outcome) => !outcome.ok);
  assert.equal(winners.length, 1, JSON.stringify(outcomes));
  assert.equal(losers.length, 1, JSON.stringify(outcomes));
  const [winner] = winners;
  const [loser] = losers;
  assert.equal(winner.version, 2);
  assert.equal(loser.errorCode, "VERSION_CONFLICT");
  assert.equal(loser.latestVersion, 2, "the conflict names the fact version, not the matter's aggregate version");
  assert.notEqual(loser.latest, null, "the winner's snapshot is readable for the side-by-side view");
  assert.equal(loser.latest.version, 2);
  assert.equal(loser.latest.answers.problem, winner.snapshot.answers.problem);
  assert.equal(snapshotEvents(backend).length, 1, "the loser wrote nothing");
  assert.equal(snapshotBlobs(backend).length, 1);

  // The user merges and saves again on the version the conflict named.
  const loserText = texts.find((text) => text !== winner.snapshot.answers.problem);
  const retried = await saveIntake(
    repository,
    ACTOR_A,
    MATTER_ID,
    command({
      baseSourceVersion: loser.latestVersion,
      answers: fiveAnswers({ problem: `${winner.snapshot.answers.problem}${loserText}` }),
      questionSources: directBothSources,
    }),
    { now: () => T2, requestKey: "race-merge" },
  );
  assert.equal(retried.ok, true, JSON.stringify(retried));
  assert.equal(retried.version, 3, "a retry after the conflict lands");
  assert.equal(snapshotEvents(backend).length, 2);
  const view = await viewOf(freshRepository(backend));
  assert.equal(view.sourceVersion, 3);
  assert.equal(view.answers.problem, `${winner.snapshot.answers.problem}${loserText}`);
});

test("V6-13 B3 a save that races an unrelated matter commit (a target add) is rebuilt and commits once, keeping the target", async () => {
  const { backend, repository } = await seedParsedMatter();
  let injected = 0;
  let commits = 0;
  const racing = withCommit(repository, async (commit) => {
    commits += 1;
    if (injected === 0) {
      injected += 1;
      await addTargets(repository, [raceTarget(1)]);
    }
    return commit();
  });
  const outcome = await saveIntake(
    racing,
    ACTOR_A,
    MATTER_ID,
    command({ answers: fiveAnswers({ problem: "与添加目标同时保存。" }), questionSources: directBothSources }),
    { now: () => T1, requestKey: "race-target" },
  );
  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  assert.equal(outcome.version, 2, "no false fact conflict");
  assert.equal(outcome.replayed, false);
  assert.equal(commits, 2, "the first commit lost to the target add; the rebuilt one landed");
  assert.equal(snapshotEvents(backend).length, 1, "one event for one save");
  assert.equal(snapshotBlobs(backend).length, 1);
  const loaded = await repository.loadMatter(ACTOR_A, MATTER_ID);
  assert.equal(loaded.data.data.matter.sourceVersion, 2);
  assert.ok(
    loaded.data.data.targets.some((target) => target.id === raceTarget(1).id),
    "the rebuilt commit kept the concurrent target add",
  );

  const replay = await saveIntake(
    repository,
    ACTOR_A,
    MATTER_ID,
    command({ answers: fiveAnswers({ problem: "与添加目标同时保存。" }), questionSources: directBothSources }),
    { now: () => T2, requestKey: "race-target" },
  );
  assert.equal(replay.ok, true, JSON.stringify(replay));
  assert.equal(replay.replayed, true);
  assert.equal(snapshotEvents(backend).length, 1);
});

test("V6-13 B3 the rebuild is bounded: a save that keeps losing to unrelated commits writes nothing and can be retried", async () => {
  const { backend, repository } = await seedParsedMatter();
  let commits = 0;
  const busy = withCommit(repository, async (commit) => {
    commits += 1;
    await addTargets(repository, [raceTarget(10 + commits)]);
    return commit();
  });
  const saveCommand = command({ answers: fiveAnswers({ problem: "一直被抢先。" }), questionSources: directBothSources });
  const outcome = await saveIntake(busy, ACTOR_A, MATTER_ID, saveCommand, { now: () => T1, requestKey: "race-busy" });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.errorCode, "STORAGE_UNAVAILABLE", "no fact moved, so this is not a fact conflict");
  assert.match(outcome.message, /其他写入/);
  assert.equal(outcome.committedVersion, undefined);
  assert.equal(commits, 3, "at most three attempts");
  assert.equal(snapshotEvents(backend).length, 0);
  let loaded = await repository.loadMatter(ACTOR_A, MATTER_ID);
  assert.equal(loaded.data.data.matter.sourceVersion, 1);

  const retried = await saveIntake(repository, ACTOR_A, MATTER_ID, saveCommand, { now: () => T2, requestKey: "race-busy" });
  assert.equal(retried.ok, true, JSON.stringify(retried));
  assert.equal(retried.version, 2);
  assert.equal(snapshotEvents(backend).length, 1);
  loaded = await repository.loadMatter(ACTOR_A, MATTER_ID);
  assert.equal(loaded.data.data.targets.length, 3, "every concurrent target add survived");
});

// ---------------------------------------------------------------------------
// Defence in depth (review-02 N4)
// ---------------------------------------------------------------------------

test("V6-13 a source ref naming a real chunk under another source id is refused", async () => {
  const { backend, repository, chunks } = await seedParsedMatter();
  const real = refFor(chunks, "客户签署了保密约定");
  const misattributed = { ...real, sourceId: "00000000-0000-4000-8000-000000777777" };
  const outcome = await saveIntake(
    repository,
    ACTOR_A,
    MATTER_ID,
    command({ questionSources: { ...directBothSources, problem: { kind: "source", ref: misattributed } } }),
    { now: () => T1 },
  );
  assert.equal(outcome.ok, false, JSON.stringify(outcome));
  assert.equal(outcome.errorCode, "SOURCE_LOCATOR_INVALID");
  assert.ok(
    outcome.fields.some((field) => field.reason === "来源段落不属于这份材料"),
    JSON.stringify(outcome.fields),
  );
  assert.equal(snapshotEvents(backend).length, 0);
});

test("V6-13 recovery never shows an older snapshot whose matterId is not this matter's", async () => {
  const { backend, repository } = await seedParsedMatter();
  const v2 = await saveIntake(
    repository,
    ACTOR_A,
    MATTER_ID,
    command({ answers: fiveAnswers({ problem: "第二版的问题。" }), questionSources: directBothSources }),
    { now: () => T1 },
  );
  assert.equal(v2.ok, true, JSON.stringify(v2));
  faultSnapshotWrites(backend);
  const v3 = await saveIntake(
    repository,
    ACTOR_A,
    MATTER_ID,
    command({ baseSourceVersion: 2, answers: fiveAnswers({ problem: "第三版的问题。" }), questionSources: directBothSources }),
    { now: () => T2 },
  );
  assert.equal(v3.committedVersion, 3, JSON.stringify(v3));
  backend.setPutFault(null);

  const key = `intake/snapshot/${MATTER_ID}/2`;
  const stored = backend.store(STORES.blobs).get(key);
  const tampered = structuredClone(stored);
  tampered.snapshot.matterId = "00000000-0000-4000-8000-000000888888";
  backend.store(STORES.blobs).set(key, tampered);

  const view = await viewOf(freshRepository(backend));
  assert.deepEqual(view.recovery, { missingVersion: 3, recoveredFromVersion: null });
  assert.notEqual(view.answers.problem, "第二版的问题。", "another matter's answers are never shown");
});

// ---------------------------------------------------------------------------
// B4 — every successful outcome, including a no-op, is an idempotent response
// ---------------------------------------------------------------------------

/** Flip the matter to archived through the repository, as a later ticket will. */
async function archiveMatter(repository) {
  const loaded = await repository.loadMatter(ACTOR_A, MATTER_ID);
  assert.equal(loaded.ok, true, loaded.ok ? "" : JSON.stringify(loaded.error));
  const matter = loaded.data.data.matter;
  const committed = await repository.commit(
    ACTOR_A,
    {
      contractVersion: CONTRACT_VERSION,
      expectedVersion: matter.version,
      payload: {
        matter: { ...matter, version: matter.version + 1, status: "archived", updatedAt: T2 },
        targets: loaded.data.data.targets,
        assets: loaded.data.data.assets,
        events: [],
        blobs: [],
      },
    },
    { requestId: "ffffffff-ffff-4fff-8fff-ffffffffffff" },
  );
  assert.equal(committed.ok, true, committed.ok ? "" : JSON.stringify(committed.error));
}

test("V6-13 B4 I1 a no-op save with a request key is replayable and refuses a different payload under the same key", async () => {
  const { backend, repository } = await seedParsedMatter();
  // A fresh matter has no stored snapshot; the empty form is the baseline, so
  // sending that baseline back is a completed request that writes no version.
  const saveCommand = command({
    answers: fiveAnswers({ problem: "", difference: "" }),
    questionSources: directBothSources,
  });
  const noop = await saveIntake(repository, ACTOR_A, MATTER_ID, saveCommand, { now: () => T1, requestKey: "b4-i1" });
  assert.equal(noop.ok, true, JSON.stringify(noop));
  assert.equal(noop.version, 1);
  assert.equal(noop.unchanged, true);
  assert.equal(noop.replayed, false);
  assert.equal(snapshotEvents(backend).length, 0, "S03-A03: a no-op writes no version");
  assert.equal(snapshotBlobs(backend).length, 0, "and no snapshot");

  const different = await saveIntake(
    repository,
    ACTOR_A,
    MATTER_ID,
    command({ answers: fiveAnswers({ problem: "同号但内容不同。" }), questionSources: directBothSources }),
    { now: () => T2, requestKey: "b4-i1" },
  );
  assert.equal(different.ok, false, JSON.stringify(different));
  assert.equal(different.errorCode, "IDEMPOTENCY_CONFLICT", "a used key is refused, not executed");
  assert.equal(snapshotEvents(backend).length, 0, "the refused request wrote nothing");
  assert.equal(snapshotBlobs(backend).length, 0);
  const loaded = await repository.loadMatter(ACTOR_A, MATTER_ID);
  assert.equal(loaded.data.data.matter.sourceVersion, 1);

  const replay = await saveIntake(repository, ACTOR_A, MATTER_ID, saveCommand, { now: () => T3, requestKey: "b4-i1" });
  assert.equal(replay.ok, true, JSON.stringify(replay));
  assert.equal(replay.version, 1);
  assert.equal(replay.unchanged, true);
  assert.equal(replay.replayed, true, "the identical no-op request replays its original response");
  assert.equal(snapshotEvents(backend).length, 0);
});

test("V6-13 B4 I5 after a no-op save, a later unrelated write and then an identical replay return the original result", async () => {
  const { backend, repository } = await seedParsedMatter();
  const saveCommand = command({
    answers: fiveAnswers({ problem: "", difference: "" }),
    questionSources: directBothSources,
  });
  const noop = await saveIntake(repository, ACTOR_A, MATTER_ID, saveCommand, { now: () => T1, requestKey: "b4-i5" });
  assert.equal(noop.ok, true, JSON.stringify(noop));
  assert.equal(noop.unchanged, true);
  assert.equal(noop.version, 1);

  // Another window writes to the same matter (the aggregate version moves).
  await addTargets(repository, [raceTarget(20)]);

  const replay = await saveIntake(repository, ACTOR_A, MATTER_ID, saveCommand, { now: () => T2, requestKey: "b4-i5" });
  assert.equal(replay.ok, true, JSON.stringify(replay));
  assert.equal(replay.errorCode, undefined, "an identical replay is never a VERSION_CONFLICT");
  assert.equal(replay.version, 1);
  assert.equal(replay.unchanged, true);
  assert.equal(replay.replayed, true);
  assert.equal(replay.snapshot.answers.problem, "");
  assert.equal(snapshotEvents(backend).length, 0);
});

test("V6-13 B4 I3 replay of a landed request after the matter is archived returns the original success", async () => {
  const { backend, repository } = await seedParsedMatter();
  const saveCommand = command({
    answers: fiveAnswers({ problem: "归档前保存的问题。" }),
    questionSources: directBothSources,
  });
  const landed = await saveIntake(repository, ACTOR_A, MATTER_ID, saveCommand, { now: () => T1, requestKey: "b4-i3" });
  assert.equal(landed.ok, true, JSON.stringify(landed));
  assert.equal(landed.version, 2);
  await archiveMatter(repository);

  const replay = await saveIntake(repository, ACTOR_A, MATTER_ID, saveCommand, { now: () => T2, requestKey: "b4-i3" });
  assert.equal(replay.ok, true, JSON.stringify(replay));
  assert.equal(replay.errorCode, undefined, "the stored response wins over the status gate");
  assert.equal(replay.version, 2);
  assert.equal(replay.replayed, true);
  assert.equal(replay.snapshot.answers.problem, "归档前保存的问题。");
  assert.equal(snapshotEvents(backend).length, 1);

  // A new request is still refused: the gate only moves behind the lookup.
  const fresh = await saveIntake(
    repository,
    ACTOR_A,
    MATTER_ID,
    command({
      baseSourceVersion: 2,
      answers: fiveAnswers({ problem: "归档后新发起的保存。" }),
      questionSources: directBothSources,
    }),
    { now: () => T2, requestKey: "b4-i3-new" },
  );
  assert.equal(fresh.ok, false, JSON.stringify(fresh));
  assert.equal(fresh.errorCode, "INVALID_TRANSITION");
});

test("V6-13 a retired source is not offered in the chunk or suggestion pickers", async () => {
  const { backend, repository, sourceId } = await seedParsedMatter();
  const before = await viewOf(repository);
  assert.ok(before.chunks.length > 0, "the parsed source has chunks to offer");
  assert.ok(
    before.questions.some((question) => question.suggestions.length > 0),
    "the parsed source has suggestions to offer",
  );

  retireSource(backend, sourceId);
  const after = await viewOf(freshRepository(backend));
  assert.deepEqual(
    after.chunks.filter((choice) => choice.sourceId === sourceId),
    [],
    "no chunk of a retired source is offered",
  );
  for (const question of after.questions) {
    assert.deepEqual(
      question.suggestions.filter((suggestion) => suggestion.sourceId === sourceId),
      [],
      `question ${question.key} offers no suggestion from the retired source`,
    );
  }
  assert.equal(after.state, "empty", "retiring a source does not itself change the answers");
});

// ---------------------------------------------------------------------------
// B5 — one key has one claim: a no-op and a version write are serialized
// ---------------------------------------------------------------------------

/**
 * The repository with a one-shot gate before its first `commit`. The caller can
 * hold that attempt after its key claim and before its business write.
 */
function gateFirstCommit(repository) {
  let release;
  let reached;
  const atGate = new Promise((resolve) => {
    reached = resolve;
  });
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let used = false;
  const gated = withCommit(repository, async (commit) => {
    if (!used) {
      used = true;
      reached();
      await gate;
    }
    return commit();
  });
  return { repository: gated, atGate, release: () => release() };
}

/**
 * The repository with a one-shot gate on the first read of a snapshot blob.
 * That is the first read after a save has claimed its key and before it writes.
 */
function gateFirstSnapshotRead(repository) {
  const original = repository.backend;
  let release;
  let reached;
  const atGate = new Promise((resolve) => {
    reached = resolve;
  });
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let used = false;
  const backend = {
    transaction: (mode, run) =>
      original.transaction(mode, async (tx) => {
        const proxy = Object.create(tx);
        proxy.get = async (store, key) => {
          const value = await tx.get(store, key);
          if (
            !used &&
            store === STORES.blobs &&
            typeof key === "string" &&
            key.startsWith("intake/snapshot/")
          ) {
            used = true;
            reached();
            await gate;
          }
          return value;
        };
        return run(proxy);
      }),
  };
  const gated = Object.create(repository);
  gated.backend = backend;
  return { repository: gated, atGate, release: () => release() };
}

function idempotencyRecords(backend) {
  return [...backend.store(STORES.blobs).values()].filter(
    (value) => value?.kind === "intake.idempotency",
  );
}

const KEY_IN_FLIGHT_MESSAGE = "同一请求正在处理中，请稍候再试。";
const noopCommand = () =>
  command({ answers: fiveAnswers({ problem: "", difference: "" }), questionSources: directBothSources });
const writeCommand = (problem) =>
  command({ answers: fiveAnswers({ problem }), questionSources: directBothSources });

test("V6-13 B5 write first: a no-op under the same key is refused, and the write's success survives replay", async () => {
  const { backend, repository } = await seedParsedMatter();
  const key = "b5-write-first";
  const gated = gateFirstCommit(repository);
  const writePromise = saveIntake(gated.repository, ACTOR_A, MATTER_ID, writeCommand("同一键下的写入。"), {
    now: () => T1,
    requestKey: key,
  });
  await gated.atGate;
  // The write owns the key but has not committed. A no-op with a different
  // payload must be refused here, not after both have "succeeded".
  const noop = await saveIntake(repository, ACTOR_A, MATTER_ID, noopCommand(), {
    now: () => T2,
    requestKey: key,
  });
  assert.equal(noop.ok, false, JSON.stringify(noop));
  assert.equal(noop.errorCode, "IDEMPOTENCY_CONFLICT");
  gated.release();
  const write = await writePromise;
  assert.equal(write.ok, true, JSON.stringify(write));
  assert.equal(write.version, 2);
  assert.equal(snapshotEvents(backend).length, 1, "exactly one version was written");
  assert.equal(snapshotBlobs(backend).length, 1);
  assert.equal(idempotencyRecords(backend).length, 1, "one record, owned by the winner");
  assert.equal(idempotencyRecords(backend)[0].requestHash !== undefined, true);

  // No successful response was lost: the write replays, the refused no-op stays refused.
  const writeReplay = await saveIntake(repository, ACTOR_A, MATTER_ID, writeCommand("同一键下的写入。"), {
    now: () => T3,
    requestKey: key,
  });
  assert.equal(writeReplay.ok, true, JSON.stringify(writeReplay));
  assert.equal(writeReplay.version, 2);
  assert.equal(writeReplay.replayed, true);
  const noopReplay = await saveIntake(repository, ACTOR_A, MATTER_ID, noopCommand(), {
    now: () => T3,
    requestKey: key,
  });
  assert.equal(noopReplay.ok, false, JSON.stringify(noopReplay));
  assert.equal(noopReplay.errorCode, "IDEMPOTENCY_CONFLICT");
  assert.equal(snapshotEvents(backend).length, 1);
});

test("V6-13 B5 no-op first: the version write under the same key is refused and writes nothing", async () => {
  const { backend, repository } = await seedParsedMatter();
  const key = "b5-noop-first";
  const gated = gateFirstSnapshotRead(repository);
  const noopPromise = saveIntake(gated.repository, ACTOR_A, MATTER_ID, noopCommand(), {
    now: () => T1,
    requestKey: key,
  });
  await gated.atGate;
  const write = await saveIntake(repository, ACTOR_A, MATTER_ID, writeCommand("不该发生的写入。"), {
    now: () => T2,
    requestKey: key,
  });
  assert.equal(write.ok, false, JSON.stringify(write));
  assert.equal(write.errorCode, "IDEMPOTENCY_CONFLICT");
  gated.release();
  const noop = await noopPromise;
  assert.equal(noop.ok, true, JSON.stringify(noop));
  assert.equal(noop.unchanged, true);
  assert.equal(noop.version, 1);
  assert.equal(snapshotEvents(backend).length, 0, "the no-op writes no version (S03-A03)");
  assert.equal(snapshotBlobs(backend).length, 0);

  const noopReplay = await saveIntake(repository, ACTOR_A, MATTER_ID, noopCommand(), {
    now: () => T3,
    requestKey: key,
  });
  assert.equal(noopReplay.ok, true, JSON.stringify(noopReplay));
  assert.equal(noopReplay.unchanged, true);
  assert.equal(noopReplay.replayed, true);
  const writeReplay = await saveIntake(repository, ACTOR_A, MATTER_ID, writeCommand("不该发生的写入。"), {
    now: () => T3,
    requestKey: key,
  });
  assert.equal(writeReplay.ok, false, JSON.stringify(writeReplay));
  assert.equal(writeReplay.errorCode, "IDEMPOTENCY_CONFLICT");
});

test("V6-13 B5 write/write: two payloads under one key get one version and one conflict", async () => {
  const { backend, repository } = await seedParsedMatter();
  const key = "b5-write-write";
  const gated = gateFirstCommit(repository);
  const firstPromise = saveIntake(gated.repository, ACTOR_A, MATTER_ID, writeCommand("先声明的写入。"), {
    now: () => T1,
    requestKey: key,
  });
  await gated.atGate;
  const second = await saveIntake(repository, ACTOR_A, MATTER_ID, writeCommand("后来者的写入。"), {
    now: () => T2,
    requestKey: key,
  });
  assert.equal(second.ok, false, JSON.stringify(second));
  assert.equal(second.errorCode, "IDEMPOTENCY_CONFLICT");
  gated.release();
  const first = await firstPromise;
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.equal(first.version, 2);
  assert.equal(snapshotEvents(backend).length, 1);
  assert.equal(snapshotBlobs(backend).length, 1);

  const firstReplay = await saveIntake(repository, ACTOR_A, MATTER_ID, writeCommand("先声明的写入。"), {
    now: () => T3,
    requestKey: key,
  });
  assert.equal(firstReplay.ok, true, JSON.stringify(firstReplay));
  assert.equal(firstReplay.version, 2);
  assert.equal(firstReplay.replayed, true);
  assert.equal(snapshotEvents(backend).length, 1);
});

test("V6-13 B5 no-op/no-op: the waiter replays the completed no-op instead of claiming a second success", async () => {
  const { backend, repository } = await seedParsedMatter();
  const key = "b5-noop-noop";
  const gated = gateFirstSnapshotRead(repository);
  const firstPromise = saveIntake(gated.repository, ACTOR_A, MATTER_ID, noopCommand(), {
    now: () => T1,
    requestKey: key,
  });
  await gated.atGate;
  const secondPromise = saveIntake(repository, ACTOR_A, MATTER_ID, noopCommand(), {
    now: () => T1,
    requestKey: key,
  });
  gated.release();
  const [first, second] = await Promise.all([firstPromise, secondPromise]);
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.equal(first.replayed, false, "exactly one attempt owns the no-op");
  assert.equal(second.ok, true, JSON.stringify(second));
  assert.equal(second.replayed, true, "the other waits for and replays the completed response");
  assert.equal(first.version, 1);
  assert.equal(second.version, 1);
  assert.equal(snapshotEvents(backend).length, 0);
  assert.equal(snapshotBlobs(backend).length, 0);
});

test("V6-13 B5 a live claim makes an identical request wait, then fail as retryable busy, then replay once it completes", async () => {
  const { backend, repository } = await seedParsedMatter();
  const key = "b5-in-flight";
  const gated = gateFirstCommit(repository);
  const ownerPromise = saveIntake(gated.repository, ACTOR_A, MATTER_ID, writeCommand("正在处理的写入。"), {
    now: () => T1,
    requestKey: key,
  });
  await gated.atGate;
  const waiting = await saveIntake(repository, ACTOR_A, MATTER_ID, writeCommand("正在处理的写入。"), {
    now: () => T1,
    requestKey: key,
  });
  assert.equal(waiting.ok, false, JSON.stringify(waiting));
  assert.equal(waiting.errorCode, "STORAGE_UNAVAILABLE");
  assert.equal(waiting.message, KEY_IN_FLIGHT_MESSAGE, "the copy says the request is being processed");
  gated.release();
  const owner = await ownerPromise;
  assert.equal(owner.ok, true, JSON.stringify(owner));
  assert.equal(owner.version, 2);

  const replay = await saveIntake(repository, ACTOR_A, MATTER_ID, writeCommand("正在处理的写入。"), {
    now: () => T2,
    requestKey: key,
  });
  assert.equal(replay.ok, true, JSON.stringify(replay));
  assert.equal(replay.replayed, true);
  assert.equal(snapshotEvents(backend).length, 1);
});

test("V6-13 B5 an expired pending claim is taken over once, and the stalled owner then replays the winner", async () => {
  const { backend, repository } = await seedParsedMatter();
  const key = "b5-lease";
  const later = "2026-11-01T01:00:31.000Z"; // past the 30s lease from T1
  const gated = gateFirstCommit(repository);
  const stalledPromise = saveIntake(gated.repository, ACTOR_A, MATTER_ID, writeCommand("租约过期后的写入。"), {
    now: () => T1,
    requestKey: key,
  });
  await gated.atGate;
  const takeover = await saveIntake(repository, ACTOR_A, MATTER_ID, writeCommand("租约过期后的写入。"), {
    now: () => later,
    requestKey: key,
  });
  assert.equal(takeover.ok, true, JSON.stringify(takeover));
  assert.equal(takeover.version, 2);
  assert.equal(takeover.replayed, false, "the takeover wrote the version");
  gated.release();
  const stalled = await stalledPromise;
  assert.equal(stalled.ok, true, JSON.stringify(stalled));
  assert.equal(stalled.version, 2);
  assert.equal(stalled.replayed, true, "the stalled owner replays the committed response");
  assert.equal(snapshotEvents(backend).length, 1, "the deterministic event id guarded a second commit");
  assert.equal(snapshotBlobs(backend).length, 1);
  assert.equal(idempotencyRecords(backend).length, 1);
});
