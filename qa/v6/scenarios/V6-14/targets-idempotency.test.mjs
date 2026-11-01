/**
 * V6-14-A03 — keyed create/update follow the V6-13/V6-15 claim → business
 * write → owner-checked finalize protocol.
 *
 * Concurrency is driven deterministically: a read gate pauses one owner on its
 * first readonly matter read after the claim (readonly transactions are not
 * serialized, so the paused owner blocks nobody), and `Date.now` is replaced
 * by an injected clock for lease expiry and the bounded wait. No real sleep is
 * longer than the engine's 25 ms poll.
 *
 * Not covered by design: the 30-day `IDEMPOTENCY_EXPIRED` window is not
 * implemented in V6-14 (recorded as a limitation in the receipt).
 */
import test from "node:test";
import assert from "node:assert/strict";

import { STORES } from "../../../../apps/web/src/v6/lib/repository.ts";
import {
  TARGET_BUSY_MESSAGE,
  createTarget,
  updateTargetConfig,
} from "../../../../apps/web/src/v6/features/targets/targets.ts";
import {
  ACTOR_A,
  MATTER_A,
  PERSON_2,
  T1,
  T2,
  T3,
  aggregate,
  config,
  eventsOf,
  fakeClock,
  gate,
  readyView,
  rowsOfKind,
  seed,
  storageFingerprint,
  targetEvents,
} from "./harness.mjs";

const at = (iso, requestKey) => ({ now: () => iso, requestKey });

function idempotencyRecords(backend) {
  return rowsOfKind(backend, "targets.idempotency");
}

/** Pause the next readonly read of the matter row; later reads pass. */
function pauseNextMatterRead(backend) {
  const latch = gate();
  let armed = true;
  let reached;
  const reachedPromise = new Promise((resolve) => {
    reached = resolve;
  });
  backend.setReadGate(({ store }) => {
    if (!armed || store !== STORES.matters) return null;
    armed = false;
    reached();
    return latch.wait;
  });
  return { reached: reachedPromise, open: latch.open };
}

test("A03 same key, identical payload replays the first result with deterministic ids", async () => {
  const { backend, repository } = await seed();
  const first = await createTarget(repository, ACTOR_A, MATTER_A, { config: config("cn_um") }, at(T1, "create-1"));
  assert.equal(first.ok, true);
  assert.equal(first.replayed, false);
  const fingerprint = storageFingerprint(backend);
  const again = await createTarget(repository, ACTOR_A, MATTER_A, { config: config("cn_um") }, at(T2, "create-1"));
  assert.equal(again.ok, true);
  assert.equal(again.replayed, true);
  assert.deepEqual(again.data, first.data);
  assert.equal(storageFingerprint(backend), fingerprint, "a replay writes nothing");
  assert.equal((await aggregate(repository)).targets.length, 1);
  assert.equal(targetEvents(await eventsOf(repository)).length, 1);

  // The same key in a fresh store derives the same target id.
  const other = await seed();
  const replica = await createTarget(other.repository, ACTOR_A, MATTER_A, { config: config("cn_um") }, at(T1, "create-1"));
  assert.equal(replica.data.target.id, first.data.target.id);

  const update = await updateTargetConfig(
    repository,
    ACTOR_A,
    MATTER_A,
    first.data.target.id,
    { baseVersion: 1, config: config("cn_invention") },
    at(T2, "update-1"),
  );
  assert.equal(update.ok, true);
  const updateAgain = await updateTargetConfig(
    repository,
    ACTOR_A,
    MATTER_A,
    first.data.target.id,
    { baseVersion: 1, config: config("cn_invention") },
    at(T3, "update-1"),
  );
  assert.equal(updateAgain.ok, true, updateAgain.ok ? "" : JSON.stringify(updateAgain.error));
  assert.equal(updateAgain.replayed, true);
  assert.deepEqual(updateAgain.data, update.data);
  const agg = await aggregate(repository);
  assert.equal(agg.targets[0].configVersion, 2, "the replay did not bump configVersion again");
  assert.equal(agg.matter.version, 3);
  assert.equal(targetEvents(await eventsOf(repository)).length, 2);
});

test("A03 same key, different payload is IDEMPOTENCY_CONFLICT and writes nothing", async () => {
  const { backend, repository } = await seed();
  const first = await createTarget(repository, ACTOR_A, MATTER_A, { config: config("cn_um") }, at(T1, "create-1"));
  assert.equal(first.ok, true);
  const fingerprint = storageFingerprint(backend);
  const different = await createTarget(repository, ACTOR_A, MATTER_A, { config: config("pct") }, at(T2, "create-1"));
  assert.equal(different.ok, false);
  assert.equal(different.error.code, "IDEMPOTENCY_CONFLICT");
  assert.equal(storageFingerprint(backend), fingerprint);

  const update = await updateTargetConfig(
    repository,
    ACTOR_A,
    MATTER_A,
    first.data.target.id,
    { baseVersion: 1, config: config("cn_invention") },
    at(T2, "update-1"),
  );
  assert.equal(update.ok, true);
  const after = storageFingerprint(backend);
  const conflicting = await updateTargetConfig(
    repository,
    ACTOR_A,
    MATTER_A,
    first.data.target.id,
    { baseVersion: 1, config: config("cn_invention", { applicantIds: [PERSON_2] }) },
    at(T3, "update-1"),
  );
  assert.equal(conflicting.ok, false);
  assert.equal(conflicting.error.code, "IDEMPOTENCY_CONFLICT");
  assert.equal(storageFingerprint(backend), after);
});

test("A03 a failed commit releases the claim; the same-key retry commits exactly once", async () => {
  const { backend, repository } = await seed();
  let failures = 1;
  backend.setPutFault(({ store }) => {
    if (store === STORES.matters && failures > 0) {
      failures -= 1;
      return new Error("synthetic commit failure");
    }
    return null;
  });
  const failed = await createTarget(repository, ACTOR_A, MATTER_A, { config: config("cn_um") }, at(T1, "create-1"));
  assert.equal(failed.ok, false);
  assert.equal(failed.error.code, "STORAGE_UNAVAILABLE");
  assert.equal((await aggregate(repository)).targets.length, 0);
  assert.equal(idempotencyRecords(backend).length, 0, "the pending claim was released");
  assert.equal(targetEvents(await eventsOf(repository)).length, 0);

  const retry = await createTarget(repository, ACTOR_A, MATTER_A, { config: config("cn_um") }, at(T1, "create-1"));
  assert.equal(retry.ok, true, retry.ok ? "" : JSON.stringify(retry.error));
  assert.equal(retry.replayed, false);
  const agg = await aggregate(repository);
  assert.equal(agg.targets.length, 1);
  assert.equal(agg.matter.version, 2);
  assert.equal(targetEvents(await eventsOf(repository)).length, 1);
  const [record] = idempotencyRecords(backend);
  assert.equal(record.state, "completed");
});

test("A03 a failed finalize after a landed commit is recovered by a same-key retry without a second commit", async () => {
  const { backend, repository } = await seed();
  let failures = 1;
  backend.setPutFault(({ value }) => {
    if (value?.kind === "targets.idempotency" && value.state === "completed" && failures > 0) {
      failures -= 1;
      return new Error("synthetic finalize failure");
    }
    return null;
  });
  const first = await createTarget(repository, ACTOR_A, MATTER_A, { config: config("cn_um") }, at(T1, "create-1"));
  assert.equal(first.ok, false);
  assert.equal(first.error.code, "STORAGE_UNAVAILABLE");
  assert.match(first.error.message, /同一请求键重试/);
  assert.equal((await aggregate(repository)).targets.length, 1, "the business write landed");
  assert.equal(idempotencyRecords(backend)[0].state, "pending", "the claim was kept, not released");

  const retry = await createTarget(repository, ACTOR_A, MATTER_A, { config: config("cn_um") }, at(T2, "create-1"));
  assert.equal(retry.ok, true, retry.ok ? "" : JSON.stringify(retry.error));
  assert.equal(retry.replayed, true);
  const agg = await aggregate(repository);
  assert.equal(agg.targets.length, 1, "no duplicate target");
  assert.equal(agg.matter.version, 2, "no second commit");
  assert.equal(targetEvents(await eventsOf(repository)).length, 1);
  assert.equal(idempotencyRecords(backend)[0].state, "completed");
});

test("A03 a live claim makes an identical request wait, then answer busy with no writes", async (t) => {
  const { backend, repository } = await seed();
  const pause = pauseNextMatterRead(backend);
  const owner = createTarget(repository, ACTOR_A, MATTER_A, { config: config("cn_um") }, at(T1, "create-1"));
  await pause.reached;
  assert.equal(idempotencyRecords(backend)[0].state, "pending", "the owner holds the claim");

  const clock = fakeClock(T1);
  t.after(() => clock.restore());
  // Each Date.now read moves 60 ms, so the 500 ms bounded wait ends after a
  // handful of 25 ms polls instead of real time.
  clock.autoAdvance(60);
  const before = storageFingerprint(backend);
  const waiter = await createTarget(repository, ACTOR_A, MATTER_A, { config: config("cn_um") }, at(T1, "create-1"));
  assert.equal(waiter.ok, false);
  assert.equal(waiter.error.code, "STORAGE_UNAVAILABLE");
  assert.equal(waiter.error.message, "同一请求正在处理中，请稍候再试。");
  assert.equal(waiter.error.message, TARGET_BUSY_MESSAGE);
  assert.equal(storageFingerprint(backend), before, "the waiter wrote nothing");
  clock.restore();

  pause.open();
  const done = await owner;
  assert.equal(done.ok, true, done.ok ? "" : JSON.stringify(done.error));
  const replay = await createTarget(repository, ACTOR_A, MATTER_A, { config: config("cn_um") }, at(T2, "create-1"));
  assert.equal(replay.ok, true);
  assert.equal(replay.replayed, true);
  assert.equal(replay.data.target.id, done.data.target.id);
  assert.equal((await aggregate(repository)).targets.length, 1);
  assert.equal(targetEvents(await eventsOf(repository)).length, 1);
});

test("A03 an expired lease is taken over; the stalled owner cannot commit a duplicate", async (t) => {
  const { backend, repository } = await seed();
  const clock = fakeClock(T1);
  t.after(() => clock.restore());
  const pause = pauseNextMatterRead(backend);
  const stalled = createTarget(repository, ACTOR_A, MATTER_A, { config: config("cn_um") }, at(T1, "create-1"));
  await pause.reached;
  const stalledClaim = idempotencyRecords(backend)[0];
  assert.equal(stalledClaim.state, "pending");

  clock.advance(31_000);
  const takeover = await createTarget(repository, ACTOR_A, MATTER_A, { config: config("cn_um") }, at(T1, "create-1"));
  assert.equal(takeover.ok, true, takeover.ok ? "" : JSON.stringify(takeover.error));
  assert.equal(takeover.replayed, false);
  const record = idempotencyRecords(backend)[0];
  assert.equal(record.state, "completed");

  pause.open();
  const late = await stalled;
  assert.equal(late.ok, false, "the stalled owner lost its claim");
  assert.equal(late.error.code, "STORAGE_UNAVAILABLE");
  const agg = await aggregate(repository);
  assert.equal(agg.targets.length, 1, "exactly one target");
  assert.equal(agg.matter.version, 2, "exactly one commit");
  assert.equal(targetEvents(await eventsOf(repository)).length, 1);
  assert.equal(idempotencyRecords(backend)[0].state, "completed", "the completed record survives the loser");
  const view = await readyView(repository);
  assert.equal(view.targets[0].configAvailable, true);
});

test("A03 an expired lease with a prepared, landed update is recovered instead of re-committed", async (t) => {
  const { backend, repository } = await seed();
  const created = await createTarget(repository, ACTOR_A, MATTER_A, { config: config("cn_um") }, at(T1, "create-1"));
  assert.equal(created.ok, true);
  const clock = fakeClock(T2);
  t.after(() => clock.restore());
  let failures = 1;
  backend.setPutFault(({ value }) => {
    if (value?.kind === "targets.idempotency" && value.operation === "target.config.update" && value.state === "completed" && failures > 0) {
      failures -= 1;
      return new Error("synthetic finalize failure");
    }
    return null;
  });
  const input = { baseVersion: 1, config: config("cn_invention") };
  const first = await updateTargetConfig(repository, ACTOR_A, MATTER_A, created.data.target.id, input, at(T2, "update-1"));
  assert.equal(first.ok, false);
  assert.equal(first.error.code, "STORAGE_UNAVAILABLE");
  clock.advance(31_000);
  const retry = await updateTargetConfig(repository, ACTOR_A, MATTER_A, created.data.target.id, input, at(T3, "update-1"));
  assert.equal(retry.ok, true, retry.ok ? "" : JSON.stringify(retry.error));
  assert.equal(retry.replayed, true);
  assert.equal(retry.data.target.configVersion, 2);
  const agg = await aggregate(repository);
  assert.equal(agg.targets[0].configVersion, 2, "configVersion moved once");
  assert.equal(agg.matter.version, 3);
  assert.equal(targetEvents(await eventsOf(repository)).filter((e) => e.action === "target.config_updated").length, 1);
});
