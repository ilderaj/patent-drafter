/**
 * V6-15 fix rounds 1 and 2 — one claim per idempotency key, and orphan cleanup
 * that defers while a claim record exists.
 *
 * Every test drives the public module with deterministic commit gates and
 * put-fault hooks, so the interleaving is scheduled, not timing-luck. Only
 * synthetic fixtures from the harness are used; nothing touches the network.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  grantConsent,
  loadAiView,
  revokeConsent,
  validateConsentForUse,
} from "../../../../apps/web/src/v6/features/ai/ai.ts";
import { STORES } from "../../../../apps/web/src/v6/lib/repository.ts";
import {
  ACTOR_A,
  MATTER_A,
  T1,
  T2,
  T3,
  eventsOf,
  grantInput,
  matterRecord,
  readyView,
  seed,
  storedRows,
} from "./harness.mjs";

const KEY_IN_FLIGHT_MESSAGE = "同一请求正在处理中，请稍候再试。";

function expectOk(result, label = "result") {
  assert.equal(result.ok, true, `${label}: ${JSON.stringify(result.error)}`);
  return result.data;
}

function expectError(result, code, label = "result") {
  assert.equal(result.ok, false, `${label}: expected ${code}, got success`);
  assert.equal(result.error.code, code, `${label}: ${JSON.stringify(result.error)}`);
  return result.error;
}

/** The repository with `wrap` around every `commit`; `args` are its arguments. */
function withCommit(repository, wrap) {
  return new Proxy(repository, {
    get(target, prop) {
      if (prop === "commit") return (...args) => wrap(() => target.commit(...args), args);
      const value = target[prop];
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

/** Hold the first commit after its key claim and before the business commit. */
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

/** Replace the first commit with an injected outcome after the gate. */
function replaceFirstCommit(repository, replacement) {
  let release;
  let reached;
  const atGate = new Promise((resolve) => {
    reached = resolve;
  });
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let used = false;
  const gated = withCommit(repository, async (commit, args) => {
    if (!used) {
      used = true;
      reached();
      await gate;
      return replacement(commit, args);
    }
    return commit();
  });
  return { repository: gated, atGate, release: () => release() };
}

function idempotencyRecords(backend) {
  return [...backend.store(STORES.blobs).values()].filter(
    (value) => value !== null && typeof value === "object" && value.kind === "ai.idempotency",
  );
}

function consentRows(backend) {
  return storedRows(backend, "ai.consent");
}

function grantedEventsOf(events) {
  return events.filter((event) => event.action === "consent.granted");
}

function revokedEventsOf(events) {
  return events.filter((event) => event.action === "consent.revoked");
}

async function twoConsentFixture() {
  const seeded = await seed();
  const view = await readyView(seeded.repository);
  const extract = expectOk(
    await grantConsent(seeded.repository, ACTOR_A, MATTER_A, grantInput(view), {
      requestKey: "concurrency-grant-extract",
      now: () => T1,
    }),
  );
  const draft = expectOk(
    await grantConsent(
      seeded.repository,
      ACTOR_A,
      MATTER_A,
      grantInput(view, { purpose: "draft" }),
      { requestKey: "concurrency-grant-draft", now: () => T1 },
    ),
  );
  return { ...seeded, view, extract, draft };
}

// ---------------------------------------------------------------------------
// 1. Grant: same key, two payloads → one success, one conflict
// ---------------------------------------------------------------------------

test("V6-15 concurrency: grant same key with different payloads gets one winner and one conflict", async () => {
  const { backend, repository } = await seed();
  const view = await readyView(repository);
  const extractInput = grantInput(view);
  const draftInput = grantInput(view, { purpose: "draft" });
  const key = "race-grant-different";
  const gated = gateFirstCommit(repository);

  const winnerPromise = grantConsent(gated.repository, ACTOR_A, MATTER_A, extractInput, {
    requestKey: key,
    now: () => T1,
  });
  await gated.atGate;
  const loser = await grantConsent(repository, ACTOR_A, MATTER_A, draftInput, {
    requestKey: key,
    now: () => T2,
  });
  expectError(loser, "IDEMPOTENCY_CONFLICT", "differing payload under the held key");
  gated.release();
  const winner = expectOk(await winnerPromise, "winning grant");

  assert.equal(winner.created, true);
  assert.equal(winner.consent.purpose, "extract");
  assert.equal(consentRows(backend).length, 1, "only the winner's row exists");
  let events = consentEventsOf(await eventsOf(repository));
  assert.equal(grantedEventsOf(events).length, 1, "only the winner's granted event exists");
  assert.equal(grantedEventsOf(events)[0].resourceId, winner.consent.id);
  assert.equal(consentRows(backend)[0].consent.purpose, "extract");
  assert.equal((await matterRecord(repository)).version, 2, "one version bump");

  const winnerReplay = await grantConsent(repository, ACTOR_A, MATTER_A, extractInput, {
    requestKey: key,
    now: () => T3,
  });
  const replayed = expectOk(winnerReplay, "winner replay");
  assert.equal(winnerReplay.replayed, true);
  assert.equal(replayed.consent.id, winner.consent.id);
  assert.equal(replayed.created, true);

  const loserReplay = await grantConsent(repository, ACTOR_A, MATTER_A, draftInput, {
    requestKey: key,
    now: () => T3,
  });
  expectError(loserReplay, "IDEMPOTENCY_CONFLICT", "the refused payload stays refused");
  assert.equal(consentRows(backend).length, 1);
});

function consentEventsOf(events) {
  return events.filter(
    (event) => event.action === "consent.granted" || event.action === "consent.revoked",
  );
}

// ---------------------------------------------------------------------------
// 2. Grant: same key, identical payloads → both succeed, one creation
// ---------------------------------------------------------------------------

test("V6-15 concurrency: identical concurrent grants both succeed with one creation and equal results", async () => {
  const { backend, repository } = await seed();
  const view = await readyView(repository);
  const input = grantInput(view);
  const key = "race-grant-identical";
  const gated = gateFirstCommit(repository);

  const firstPromise = grantConsent(gated.repository, ACTOR_A, MATTER_A, input, {
    requestKey: key,
    now: () => T1,
  });
  await gated.atGate;
  const secondPromise = grantConsent(repository, ACTOR_A, MATTER_A, input, {
    requestKey: key,
    now: () => T1,
  });
  gated.release();
  const [first, second] = await Promise.all([firstPromise, secondPromise]);
  const firstData = expectOk(first, "first grant");
  const secondData = expectOk(second, "second grant");

  assert.equal(firstData.created, true);
  assert.equal(secondData.created, true);
  assert.deepEqual(firstData, secondData, "both callers see the same original response");
  assert.equal([first.replayed, second.replayed].filter((value) => value === true).length, 1);
  assert.equal(consentRows(backend).length, 1);
  assert.equal(grantedEventsOf(await eventsOf(repository)).length, 1);
  assert.equal((await matterRecord(repository)).version, 2);
  assert.equal(idempotencyRecords(backend).length, 1);
  assert.equal(idempotencyRecords(backend)[0].state, "completed");
});

// ---------------------------------------------------------------------------
// 3. Revoke: same key, two consentIds → one success, one conflict
// ---------------------------------------------------------------------------

test("V6-15 concurrency: revoke same key with different consentIds gets one winner and one conflict", async () => {
  const { backend, repository, extract, draft } = await twoConsentFixture();
  const key = "race-revoke-different";
  const versionBefore = (await matterRecord(repository)).version;
  const gated = gateFirstCommit(repository);

  const winnerPromise = revokeConsent(
    gated.repository,
    ACTOR_A,
    MATTER_A,
    { consentId: extract.consent.id },
    { requestKey: key, now: () => T2 },
  );
  await gated.atGate;
  const loser = await revokeConsent(
    repository,
    ACTOR_A,
    MATTER_A,
    { consentId: draft.consent.id },
    { requestKey: key, now: () => T3 },
  );
  expectError(loser, "IDEMPOTENCY_CONFLICT", "a different consentId under the held key");
  gated.release();
  const winner = expectOk(await winnerPromise, "winning revoke");

  assert.equal(winner.consentId, extract.consent.id);
  assert.equal(winner.alreadyRevoked, false);
  const revoked = revokedEventsOf(await eventsOf(repository));
  assert.equal(revoked.length, 1, "only the winner's revocation event exists");
  assert.equal(revoked[0].resourceId, extract.consent.id);
  assert.equal((await matterRecord(repository)).version, versionBefore + 1);

  const winnerReplay = expectOk(
    await revokeConsent(
      repository,
      ACTOR_A,
      MATTER_A,
      { consentId: extract.consent.id },
      { requestKey: key, now: () => T3 },
    ),
    "winner revoke replay",
  );
  assert.equal(winnerReplay.revokedAt, T2);
  assert.equal(winnerReplay.alreadyRevoked, false);
  const loserReplay = await revokeConsent(
    repository,
    ACTOR_A,
    MATTER_A,
    { consentId: draft.consent.id },
    { requestKey: key, now: () => T3 },
  );
  expectError(loserReplay, "IDEMPOTENCY_CONFLICT", "the refused consentId stays refused");
  assert.equal(revokedEventsOf(await eventsOf(repository)).length, 1);
  assert.equal(consentRows(backend).length, 2, "the losing consent row remains untouched");
});

// ---------------------------------------------------------------------------
// 4. Revoke: same key, identical → both succeed, one event, consistent answer
// ---------------------------------------------------------------------------

test("V6-15 concurrency: identical concurrent revokes both succeed with one event and consistent answers", async () => {
  const { backend, repository, view } = await twoConsentFixture();
  const consentId = expectOk(
    await grantConsent(repository, ACTOR_A, MATTER_A, grantInput(view, { purpose: "check" }), {
      requestKey: "race-revoke-target",
      now: () => T1,
    }),
  ).consent.id;
  const key = "race-revoke-identical";
  const versionBefore = (await matterRecord(repository)).version;
  const gated = gateFirstCommit(repository);

  const firstPromise = revokeConsent(gated.repository, ACTOR_A, MATTER_A, { consentId }, {
    requestKey: key,
    now: () => T2,
  });
  await gated.atGate;
  const secondPromise = revokeConsent(repository, ACTOR_A, MATTER_A, { consentId }, {
    requestKey: key,
    now: () => T2,
  });
  gated.release();
  const [first, second] = await Promise.all([firstPromise, secondPromise]);
  const firstData = expectOk(first, "first revoke");
  const secondData = expectOk(second, "second revoke");

  assert.equal(firstData.alreadyRevoked, false);
  assert.equal(secondData.alreadyRevoked, false, "the waiter replays the original answer");
  assert.deepEqual(firstData, secondData);
  assert.equal([first.replayed, second.replayed].filter((value) => value === true).length, 1);
  assert.equal(revokedEventsOf(await eventsOf(repository)).length, 1);
  assert.equal((await matterRecord(repository)).version, versionBefore + 1);
  assert.equal(idempotencyRecords(backend).filter((row) => row.operation === "consent.revoke").length, 1);
});

// ---------------------------------------------------------------------------
// 5. Post-commit finalize failure → retry returns the original response
// ---------------------------------------------------------------------------

test("V6-15 concurrency: a grant whose finalize fails after commit replays the original response", async () => {
  const { backend, repository } = await seed();
  const view = await readyView(repository);
  const input = grantInput(view);
  const key = "finalize-fault-grant";
  backend.setPutFault(({ value }) =>
    value?.kind === "ai.idempotency" && value.state === "completed"
      ? new Error("synthetic idempotency finalize failure")
      : null,
  );

  const first = await grantConsent(repository, ACTOR_A, MATTER_A, input, {
    requestKey: key,
    now: () => T1,
  });
  expectError(first, "STORAGE_UNAVAILABLE", "the failed finalize is not reported as durable success");
  backend.setPutFault(null);

  const rows = consentRows(backend);
  assert.equal(rows.length, 1);
  const events = grantedEventsOf(await eventsOf(repository));
  assert.equal(events.length, 1);
  assert.equal(events[0].resourceId, rows[0].consent.id);
  assert.equal((await matterRecord(repository)).version, 2);
  const pending = idempotencyRecords(backend).find((row) => row.requestKey === key);
  assert.equal(pending.state, "pending");
  assert.ok(pending.preparedResponse, "the prepared response survived the failed finalize");

  const retry = await grantConsent(repository, ACTOR_A, MATTER_A, input, {
    requestKey: key,
    now: () => T3,
  });
  const replayed = expectOk(retry, "same-key retry after the finalize fault");
  assert.equal(retry.replayed, true);
  assert.equal(replayed.created, true);
  assert.equal(replayed.consent.id, rows[0].consent.id);
  assert.equal(replayed.consent.createdAt, T1, "the original response, not a new attempt");
  assert.equal(grantedEventsOf(await eventsOf(repository)).length, 1, "no second granted event");
  assert.equal(consentRows(backend).length, 1);
  assert.equal((await matterRecord(repository)).version, 2, "no second version bump");
  assert.equal(idempotencyRecords(backend).find((row) => row.requestKey === key).state, "completed");
});

test("V6-15 concurrency: a revoke whose finalize fails after commit replays the original response", async () => {
  const { backend, repository } = await seed();
  const view = await readyView(repository);
  const granted = expectOk(
    await grantConsent(repository, ACTOR_A, MATTER_A, grantInput(view), {
      requestKey: "finalize-fault-revoke-grant",
      now: () => T1,
    }),
  );
  const key = "finalize-fault-revoke";
  backend.setPutFault(({ value }) =>
    value?.kind === "ai.idempotency" && value.state === "completed"
      ? new Error("synthetic idempotency finalize failure")
      : null,
  );

  const first = await revokeConsent(
    repository,
    ACTOR_A,
    MATTER_A,
    { consentId: granted.consent.id },
    { requestKey: key, now: () => T2 },
  );
  expectError(first, "STORAGE_UNAVAILABLE", "the failed revoke finalize is not reported as success");
  backend.setPutFault(null);

  assert.equal(revokedEventsOf(await eventsOf(repository)).length, 1);
  const pending = idempotencyRecords(backend).find((row) => row.requestKey === key);
  assert.equal(pending.state, "pending");
  assert.ok(pending.preparedResponse);

  const retry = await revokeConsent(
    repository,
    ACTOR_A,
    MATTER_A,
    { consentId: granted.consent.id },
    { requestKey: key, now: () => T3 },
  );
  const replayed = expectOk(retry, "same-key revoke retry after the finalize fault");
  assert.equal(retry.replayed, true);
  assert.equal(replayed.consentId, granted.consent.id);
  assert.equal(replayed.revokedAt, T2, "the original revocation time");
  assert.equal(replayed.alreadyRevoked, false, "the original answer, not a later observation");
  assert.equal(revokedEventsOf(await eventsOf(repository)).length, 1, "no second revocation event");
  assert.equal(idempotencyRecords(backend).find((row) => row.requestKey === key).state, "completed");
});

// ---------------------------------------------------------------------------
// 6. Cleanup never deletes a row whose consent.granted event exists
// ---------------------------------------------------------------------------

test("V6-15 concurrency: cleanup cannot delete a consent row whose granted event survived", async () => {
  const { backend, repository } = await seed();
  const view = await readyView(repository);
  const key = "cleanup-safety-grant";
  const gated = replaceFirstCommit(repository, async (commit) => {
    const winner = await commit();
    assert.equal(winner.ok, true, winner.ok ? "" : JSON.stringify(winner.error));
    return {
      ok: false,
      error: { code: "INVALID_TRANSITION", message: "synthetic concurrent archive after the event" },
    };
  });

  const attemptPromise = grantConsent(gated.repository, ACTOR_A, MATTER_A, grantInput(view), {
    requestKey: key,
    now: () => T2,
  });
  await gated.atGate;
  gated.release();
  expectError(await attemptPromise, "INVALID_TRANSITION", "the failing attempt after the winner");

  const rows = consentRows(backend);
  assert.equal(rows.length, 1, "the failing attempt's cleanup kept the winner's row");
  const events = grantedEventsOf(await eventsOf(repository));
  assert.equal(events.length, 1);
  assert.equal(events[0].resourceId, rows[0].consent.id);

  const authorization = await validateConsentForUse(repository, ACTOR_A, MATTER_A, {
    consentId: rows[0].consent.id,
    purpose: "extract",
    targetId: null,
  });
  expectOk(authorization, "the surviving row still authorizes its scope");

  const retry = await grantConsent(repository, ACTOR_A, MATTER_A, grantInput(view), {
    requestKey: key,
    now: () => T3,
  });
  const replayed = expectOk(retry, "same-key retry after the failed cleanup");
  assert.equal(retry.replayed, true);
  assert.equal(replayed.consent.id, rows[0].consent.id);
  assert.equal(grantedEventsOf(await eventsOf(repository)).length, 1);
});

// ---------------------------------------------------------------------------
// 7. The losing claim performs zero business writes
// ---------------------------------------------------------------------------

test("V6-15 concurrency: the losing claim performs no business write at all", async () => {
  const { backend, repository } = await seed();
  const view = await readyView(repository);
  const key = "race-zero-writes";
  const gated = gateFirstCommit(repository);

  const winnerPromise = grantConsent(gated.repository, ACTOR_A, MATTER_A, grantInput(view), {
    requestKey: key,
    now: () => T1,
  });
  await gated.atGate;

  const versionBefore = (await matterRecord(repository)).version;
  const eventsBefore = (await eventsOf(repository)).length;
  const rowsBefore = consentRows(backend).length;
  const recordsBefore = structuredClone(idempotencyRecords(backend));

  const loser = await grantConsent(
    repository,
    ACTOR_A,
    MATTER_A,
    grantInput(view, { purpose: "draft" }),
    { requestKey: key, now: () => T2 },
  );
  expectError(loser, "IDEMPOTENCY_CONFLICT", "the losing claim");

  assert.equal((await matterRecord(repository)).version, versionBefore, "no version write");
  assert.equal((await eventsOf(repository)).length, eventsBefore, "no event write");
  assert.equal(consentRows(backend).length, rowsBefore, "no consent row write");
  assert.deepEqual(idempotencyRecords(backend), recordsBefore, "the winner's claim is untouched");

  gated.release();
  expectOk(await winnerPromise, "the winner still succeeds");
  assert.equal((await matterRecord(repository)).version, 2);
  assert.equal(grantedEventsOf(await eventsOf(repository)).length, 1);
});

// ---------------------------------------------------------------------------
// 8. A live claim makes an identical request wait, then report retryable busy
// ---------------------------------------------------------------------------

test("V6-15 concurrency: a live claim makes an identical request wait, then report busy, then replay", async () => {
  const { backend, repository } = await seed();
  const view = await readyView(repository);
  const input = grantInput(view);
  const key = "race-in-flight";
  const gated = gateFirstCommit(repository);

  const ownerPromise = grantConsent(gated.repository, ACTOR_A, MATTER_A, input, {
    requestKey: key,
    now: () => T1,
  });
  await gated.atGate;
  const waiting = await grantConsent(repository, ACTOR_A, MATTER_A, input, {
    requestKey: key,
    now: () => T1,
  });
  const error = expectError(waiting, "STORAGE_UNAVAILABLE", "the waiter");
  assert.equal(error.message, KEY_IN_FLIGHT_MESSAGE);
  assert.equal(consentRows(backend).length, 1, "the waiter wrote no row");
  assert.equal(grantedEventsOf(await eventsOf(repository)).length, 0);

  gated.release();
  const owner = expectOk(await ownerPromise, "the claim owner");
  assert.equal(owner.created, true);

  const replay = await grantConsent(repository, ACTOR_A, MATTER_A, input, {
    requestKey: key,
    now: () => T2,
  });
  const replayed = expectOk(replay, "the waiter's later retry");
  assert.equal(replay.replayed, true);
  assert.equal(replayed.consent.id, owner.consent.id);
  assert.equal(grantedEventsOf(await eventsOf(repository)).length, 1);
  assert.equal((await matterRecord(repository)).version, 2);
});

// ---------------------------------------------------------------------------
// 9. Expired lease takeover: the losing owner's cleanup must not delete the
//    new owner's consent row while the new owner's claim record exists.
// ---------------------------------------------------------------------------

/**
 * Gate the first two business commits. The first is replaced with a synthetic
 * VERSION_CONFLICT; the second is held until released. No other commit happens
 * between them, so call order identifies A and B deterministically.
 */
function gateExpiredOwnerCommits(repository) {
  let releaseFirst;
  let releaseSecond;
  let firstEntered;
  let secondEntered;
  const firstAtGate = new Promise((resolve) => {
    firstEntered = resolve;
  });
  const firstGate = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  const secondAtGate = new Promise((resolve) => {
    secondEntered = resolve;
  });
  const secondGate = new Promise((resolve) => {
    releaseSecond = resolve;
  });
  let calls = 0;
  const proxy = new Proxy(repository, {
    get(target, prop) {
      if (prop !== "commit") {
        const value = target[prop];
        return typeof value === "function" ? value.bind(target) : value;
      }
      return async (...args) => {
        calls += 1;
        if (calls === 1) {
          firstEntered();
          await firstGate;
          return {
            ok: false,
            error: { code: "VERSION_CONFLICT", message: "synthetic version conflict for the old owner" },
          };
        }
        if (calls === 2) {
          secondEntered();
          await secondGate;
        }
        return target.commit(...args);
      };
    },
  });
  return {
    repository: proxy,
    firstAtGate,
    secondAtGate,
    releaseFirst: () => releaseFirst(),
    releaseSecond: () => releaseSecond(),
  };
}

test("V6-15 concurrency: an expired owner's cleanup cannot delete the new claim owner's consent row", async () => {
  const { backend, repository } = await seed();
  const view = await readyView(repository);
  const input = grantInput(view);
  const key = "race-expired-lease-cleanup";
  const gated = gateExpiredOwnerCommits(repository);
  const realNow = Date.now;
  const base = Date.parse("2026-11-02T00:00:00.000Z");
  let fakeNow = base;
  try {
    // A claims the key, writes its row and prepares, then waits at its commit.
    Date.now = () => fakeNow;
    const firstPromise = grantConsent(gated.repository, ACTOR_A, MATTER_A, input, {
      requestKey: key,
      now: () => T1,
    });
    await gated.firstAtGate;
    assert.equal(consentRows(backend).length, 1, "A wrote its row before its gated commit");
    assert.equal(grantedEventsOf(await eventsOf(repository)).length, 0);

    // A's 30 s lease expires; B takes over the same key and payload and tries
    // to clean A's orphan row at the top of the function. Cleanup must defer
    // while B's claim record exists; B then reuses the deterministic row (both
    // attempts share the business clock; only Date.now, the lease clock,
    // advances), prepares and waits at its commit.
    fakeNow = base + 31_000;
    const secondPromise = grantConsent(gated.repository, ACTOR_A, MATTER_A, input, {
      requestKey: key,
      now: () => T1,
    });
    await gated.secondAtGate;
    assert.equal(consentRows(backend).length, 1, "the deterministic row is present at B's gated commit");
    assert.equal(grantedEventsOf(await eventsOf(repository)).length, 0);

    // A's replaced commit fails; A retries, no longer owns the claim, and its
    // cleanup must not delete B's row.
    gated.releaseFirst();
    const first = await firstPromise;
    const firstError = expectError(first, "STORAGE_UNAVAILABLE", "the expired owner");
    assert.equal(firstError.message, KEY_IN_FLIGHT_MESSAGE);

    // B's commit lands after A's cleanup had its chance.
    gated.releaseSecond();
    const second = expectOk(await secondPromise, "the new claim owner");

    const rows = consentRows(backend);
    assert.equal(rows.length, 1, "a successful grant leaves exactly one consent row");
    const events = grantedEventsOf(await eventsOf(repository));
    assert.equal(events.length, 1, "exactly one consent.granted event");
    assert.equal(rows[0].consent.id, second.consent.id, "the surviving row is B's consent");
    assert.equal(events[0].resourceId, second.consent.id, "the event belongs to B's consent");

    const authorization = await validateConsentForUse(repository, ACTOR_A, MATTER_A, {
      consentId: second.consent.id,
      purpose: "extract",
      targetId: second.consent.scope.targetId,
    });
    expectOk(authorization, "the successful grant authorizes its scope");

    const listed = expectOk(
      await loadAiView(repository, ACTOR_A, MATTER_A, { now: () => T3 }),
      "the AI view after B's success",
    );
    assert.equal(listed.kind, "ready");
    assert.deepEqual(
      listed.consents.map((consent) => consent.id),
      [second.consent.id],
      "the AI view lists B's consent",
    );

    const replay = await grantConsent(repository, ACTOR_A, MATTER_A, input, {
      requestKey: key,
      now: () => T3,
    });
    const replayed = expectOk(replay, "the same-key replay");
    assert.equal(replay.replayed, true);
    assert.equal(replayed.consent.id, second.consent.id);
    assert.equal(consentRows(backend).length, 1);
    assert.equal(grantedEventsOf(await eventsOf(repository)).length, 1);
  } finally {
    Date.now = realNow;
    gated.releaseFirst();
    gated.releaseSecond();
  }
});

// ---------------------------------------------------------------------------
// 10. A same-key retry after a failed commit re-executes instead of
//     conflicting on the invisible orphan row.
// ---------------------------------------------------------------------------

test("V6-15 concurrency: a same-key retry after a failed commit re-executes instead of conflicting on the invisible orphan row", async () => {
  const { backend, repository } = await seed();
  const view = await readyView(repository);
  const input = grantInput(view);
  const key = "retry-after-failed-commit";
  const gated = replaceFirstCommit(repository, async () => ({
    ok: false,
    error: { code: "STORAGE_UNAVAILABLE", message: "synthetic first commit failure" },
  }));

  const firstPromise = grantConsent(gated.repository, ACTOR_A, MATTER_A, input, {
    requestKey: key,
    now: () => T1,
  });
  await gated.atGate;
  assert.equal(consentRows(backend).length, 1, "the attempt wrote its row before the failed commit");
  assert.equal(grantedEventsOf(await eventsOf(repository)).length, 0);
  gated.release();

  const first = await firstPromise;
  expectError(first, "STORAGE_UNAVAILABLE", "the failed first attempt");
  assert.equal(consentRows(backend).length, 0, "the failed attempt deleted its own orphan row");
  assert.equal(grantedEventsOf(await eventsOf(repository)).length, 0);
  assert.equal(idempotencyRecords(backend).length, 0, "the failed attempt released its claim");

  // The retry uses a later business clock, so its consent content differs from
  // the failed attempt's invisible row. It must re-execute, not conflict.
  const retry = await grantConsent(repository, ACTOR_A, MATTER_A, input, {
    requestKey: key,
    now: () => T2,
  });
  const granted = expectOk(retry, "the same-key retry after the failed commit");
  assert.equal(retry.replayed, false);
  assert.equal(granted.created, true);
  assert.equal(granted.consent.createdAt, T2, "the retry re-executed with its own clock");

  const rows = consentRows(backend);
  assert.equal(rows.length, 1, "the retry wrote exactly one consent row");
  assert.equal(rows[0].consent.id, granted.consent.id);
  assert.equal(rows[0].consent.createdAt, T2, "the surviving row carries the retry clock");
  const events = grantedEventsOf(await eventsOf(repository));
  assert.equal(events.length, 1, "exactly one consent.granted event");
  assert.equal(events[0].resourceId, granted.consent.id);

  const authorization = await validateConsentForUse(repository, ACTOR_A, MATTER_A, {
    consentId: granted.consent.id,
    purpose: "extract",
    targetId: granted.consent.scope.targetId,
  });
  expectOk(authorization, "the retried grant authorizes its scope");

  const replay = await grantConsent(repository, ACTOR_A, MATTER_A, input, {
    requestKey: key,
    now: () => T3,
  });
  const replayed = expectOk(replay, "the same-key replay after the retry");
  assert.equal(replay.replayed, true);
  assert.equal(replayed.consent.id, granted.consent.id);
  assert.equal(replayed.consent.createdAt, T2);
  assert.equal(consentRows(backend).length, 1);
  assert.equal(grantedEventsOf(await eventsOf(repository)).length, 1);
});
