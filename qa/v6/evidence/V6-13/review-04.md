VERDICT: NOT_ACCEPT

# V6-13 acceptance review, round 4

Reviewer: independent, read-only. Candidate: `/private/tmp/patent-v6-13-worktree`, branch `codex/v6-13-intake`, base `953e05d`; candidate files are untracked. Probes live in `/tmp/v613-review4/` and import the candidate's real `intake.ts` and the V6-13 harness. Nothing in either worktree was edited.

## Summary

Round 3's B4 is closed for every case it named. A no-op save with a request key now records its response, an identical replay returns the original result, a different payload under that key is refused, and the no-op still writes no version and no event. Replay works after the matter moves and after it is archived.

B1, B2 and B3 still hold. I reproduced each on this candidate with fresh probes, not only by running the suite.

One new blocker remains, B5. Two concurrent calls with the same key where one is a no-op and the other writes a version are not serialized through the idempotency record. Both return success, the write overwrites the no-op's record, and an identical replay of the no-op afterwards returns `IDEMPOTENCY_CONFLICT`. This is a 05-contracts §2 violation at the `saveIntake` boundary. The business data is not duplicated (one event, one snapshot), but one successful response is lost and the different-request rule is not enforced.

Everything else in the round-4 brief checks out: 39/39, 36/36, 53/53, typecheck 0, scope exact, mount-patched copy compiles, and the red-first evidence is sound.

## Commands run and observed

| Command | Exit | Result |
|---|---|---|
| `npm --prefix /private/tmp/patent-v6-13-worktree run test:v6 -- V6-13` | 0 | 39 tests, 39 pass |
| `npm --prefix /private/tmp/patent-v6-13-worktree run test:v6 -- V6-10` | 0 | 36 tests, 36 pass |
| `npm --prefix /private/tmp/patent-v6-13-worktree run test:v6 -- V6-11` | 0 | 53 tests, 53 pass |
| `/private/tmp/patent-v6-13-worktree/node_modules/.bin/tsc -p /private/tmp/patent-v6-13-worktree/apps/web/tsconfig.json --noEmit` | 0 | no output |
| `/tmp/v613-review4/g.sh -C /private/tmp/patent-v6-13-worktree status --porcelain --untracked-files=all` | 0 | 35 candidate paths plus `node_modules` |
| `node /tmp/v613-review4/probe-b123.mjs` | 0 | B1/B2/B3 reproduced (below) |
| `node /tmp/v613-review4/probe-idem-variants.mjs` | 0 | sequential B4 cases pass; both concurrent no-op/no-op and write/write pairs yield one success and one `IDEMPOTENCY_CONFLICT` |
| `node /tmp/v613-review4/probe-race.mjs` | 0 | no-op vs write race: both success 60/60 rounds in the latest run (59/60 in an earlier run) |
| `node /tmp/v613-review4/probe-race-replay.mjs` | 0 | both success 40/40; replay of the no-op then `IDEMPOTENCY_CONFLICT` 40/40 |
| `tsc -p /tmp/v613-review4/mount-copy/apps/web/tsconfig.json --noEmit` | 0 | mount-patched throwaway copy compiles |

## B4 sub-cases

| Sub-case | Result |
|---|---|
| Same key + different payload after a no-op | Pass: `IDEMPOTENCY_CONFLICT`, sourceVersion stays 1, 0 events, 0 snapshots (test 25; `probe-idem-variants.sequential`). |
| Identical replay of a no-op | Pass: `{ok:true, version:1, unchanged:true, replayed:true}` (test 25; probes). |
| Identical replay after the matter moved | Pass: replay succeeds with the original no-op result after `addTargets` (test 26; `noopMove`). |
| Identical replay after archive | Pass: replay succeeds; a new request is still `INVALID_TRANSITION` (test 27; `noopArchive`). |
| No-op writes no version and no event (S03-A03) | Pass: 0 `snapshot.created` events, 0 snapshot blobs, matter sourceVersion unchanged (test 25; probes). |
| No-op check-and-write atomic in one readwrite transaction | Pass for no-op vs no-op: `recordNoopIdempotent` gets and puts in one transaction (`intake.ts:689-710`); two concurrent no-ops gave exactly one success and one conflict, 20/20 (test 25; `twoNoops`). |
| Concurrent same-key no-op vs version-writing save | **Fail: both succeed (B5).** Identical replay of the no-op afterwards is refused. |

## Earlier blockers

### B1: post-commit snapshot failure: STILL FIXED

`probe-b123.out`, `b1`:

- Two saves land at v2. A fault on `intake/snapshot/*` writes then makes the v3 save return `STORAGE_UNAVAILABLE` with `committedVersion: 3` and the honest message 「第 3 版事实已记录，但这一版的答案快照没有写入本机……」.
- A fresh repository over the same bytes reads sourceVersion 3 with `recovery {missingVersion: 3, recoveredFromVersion: 2}`, `hasSnapshot: false`, and the v2 answer. It does not invent the missing version.
- Saving that recovered form at base 3 lands v4 with `unchanged: false`; the next read has `recovery: null`, `hasSnapshot: true`, and the same answer.
- 3 `snapshot.created` events (one per committed version, including the version whose snapshot was lost) and 2 snapshot blobs, as designed.

Tests 15 and 16 and UI test 32 pass. No regression.

### B2: disclosure evidence refs: STILL FIXED

`probe-b123.out`, `b2`:

- A forged evidence quote is refused as `SOURCE_LOCATOR_INVALID` with field path `answers.disclosureDetail.evidenceRefs[0]` and reason 「引用文字与来源段落不一致」; nothing is written.
- A valid ref saves.
- After the cited chunk set is removed, a fresh read marks the disclosure answer `sourceChanged: true`, `evidenceChanged: [true]`, and `state: "stale"`.

Tests 18 and 19 and UI test 33 pass. No regression.

### B3: concurrent conflict reporting and bounded rebuild: STILL FIXED

`probe-b123.out`, `b3Race`, `b3Target`, `b3Bounded`:

- Two saves race at base 1: one lands v2; the loser gets `VERSION_CONFLICT` with `latestVersion: 2` and the winner's readable snapshot (`latestProblem` matches). 1 event, 1 snapshot blob.
- A save racing a target add is rebuilt once: 2 commit attempts, lands v2, 1 event, and the concurrent target is kept.
- Sustained unrelated writes stop after exactly 3 attempts with `STORAGE_UNAVAILABLE` and 「案件同时有其他写入，这次没有保存。请再保存一次。」, 0 events; a retry lands v2 and all racing targets survive.

Tests 20-22 and UI tests 37-38 pass. No regression.

### B4: no-op idempotency: CLOSED for its listed cases

The round-3 fix works for the sequential cases and for no-op vs no-op concurrency, as the table above shows. The new B5 is a residual concurrency case in the same area; it is not a reopening of the sequential B4 findings.

## Blocker

### B5: a concurrent no-op and version-writing save under one key both succeed (§2)

**Location.** `/private/tmp/patent-v6-13-worktree/apps/web/src/v6/features/intake/intake.ts`:

- The idempotency lookup runs once, in a read-only transaction, before any gate: `intake.ts:1537-1544` with `readIdempotency` at `:630-645`. Both concurrent requests can see no record.
- The no-op branch records its response through `recordNoopIdempotent` at `:1729-1741`; that function's get-and-put is one transaction (`:689-710`), but it only coordinates with other no-op writers.
- The version-writing branch commits the matter and event at `:1777-1809`, then unconditionally includes `intake/idempotency/{tenant}/{user}/intake.save/{key}` in `writes` at `:1817-1834` and calls `writeBlobs` at `:1849`. It never rechecks the key after its first read and never reserves it before commit.
- Each IndexedDB call opens a new transaction across all three stores (`/private/tmp/patent-v6-13-worktree/apps/web/src/v6/lib/indexeddb-repository.ts:107-150`, transaction at line 112), so no transaction spans the lookup, the commit and the record. This is not a harness artifact. The in-memory backend even serializes readwrite transactions and the race still occurs.

**Reproduction.** `/tmp/v613-review4/probe-race.mjs` sends two concurrent `saveIntake` calls with the same request key, same base, and different payloads: one request is an unchanged save (empty form), the other changes the problem answer. In the latest run both calls returned success in 60 of 60 rounds (59 of 60 in an earlier run). A representative round:

```
noop:  {ok:true, version:1, unchanged:true,  replayed:false}
write: {ok:true, version:2, unchanged:false, replayed:false}
events: 1, snapshots: 1
idempotency record: the write's request hash, version 2
```

`/tmp/v613-review4/probe-race-replay.mjs` repeats this 40 times and then replays both payloads on a fresh repository over the same bytes: both succeeded 40/40; the write replays `{ok:true, version:2, replayed:true}` 40/40; the no-op request, whose first response was a success, now returns `IDEMPOTENCY_CONFLICT` 40/40. Its successful response was overwritten and is no longer replayable.

Ordering in the failing round: both lookups see no record; the no-op's record transaction runs; the write's commit runs; the write's post-commit blob transaction overwrites the no-op record. The write did not observe the no-op's record because it had already passed its only check. The inverse interleaving (write records first) yields the intended one-success/one-conflict outcome; the failure is timing-dependent and frequent.

**Why it blocks.** 05-contracts §2 (`05-contracts.md:59`): 「幂等按 `(tenantId,actorId,operation,key)`，请求摘要含方法、路径、规范 JSON；同请求重放返回原响应，不同请求为 `IDEMPOTENCY_CONFLICT`。成功响应保存 30 天……」. Here two different requests under one key both return success, and an identical replay of one of those successes does not return the original response. Both clauses fail in the same round. V6-13-A03 (`tickets/V6-13.md:22`) requires refresh/retry to match persisted state with no duplicate side effects, and the receipt's A03 evidence and decisions[4] and decisions[9] claim unconditionally that the same key replays and a different payload under it is `IDEMPOTENCY_CONFLICT`. That claim is false under this race.

**Severity note.** No business write is duplicated: one event, one snapshot, one new sourceVersion. The defect is the idempotency state. The shipped Intake panel makes the race hard to reach today: each save gets a fresh key, any edit clears it, `busy` guards a second save from the panel, and another tab has its own key. But `saveIntake` is the engine seam the contract governs and later callers will use, which is the same standard under which B4 was required to be fixed. If the coordinator rules engine-level concurrency out of V6-13, downgrade this to a non-blocking observation; under §2 as written, it blocks.

**Suggested fix.** Give both branches one atomic claim protocol before any business write. In a single readwrite transaction, put a pending idempotency record if the key is absent; if a record exists with the same request hash, replay or take over a pending claim; if it exists with a different hash, return `IDEMPOTENCY_CONFLICT`. Only the claim owner may commit. Finalize the record with `unchanged` and the stored baseline or the written version after success, and clear or finalize the claim on a failed attempt without creating a new replay hole. Add two concurrency tests: no-op vs write under one key must not both succeed, and after the race each original request must either replay its original response or have received `IDEMPOTENCY_CONFLICT`, with no lost successful response.

## Non-blocking observations

- **N1, unchanged.** A same-key retry after a post-commit snapshot failure still has no idempotency record, because the snapshot and record are written in the same blob transaction (`intake.ts:1817-1849`). The retry gets a version conflict or duplicate-event failure, not the original response. The shipped panel moves to a new request when `committedVersion` is reported (`Intake.tsx:498-503`), so the product path is safe. This was non-blocking in earlier rounds and remains so.
- **Keep-mine works.** After a conflict, 「保留我的修改」 clears the key and refreshes only the view (`Intake.tsx:524-532`, refresh at `:401-412`); the next save uses the refreshed sourceVersion (`:473-483`). UI test 39 renders both choices with the edits intact, and browser step 12 records base 6, latest 7, saved version 8. A writer landing between keep-mine and save produces another conflict, not a silent overwrite.
- **Edits during an in-flight save can be dropped.** The answer textareas are not disabled while `busy`; a successful save then calls `refresh()` with the default form reset (`Intake.tsx:473-495` and `:401-412`), discarding text typed while the save was in flight. Local IndexedDB saves are fast and the save button is disabled, so this is a minor UX edge, not a contract issue.
- **No-op replay copy.** `Intake.tsx:487-494` checks `unchanged` before `replayed`, so a replayed no-op shows 「没有变化，未写入新版本。」 rather than the 「已重放」 message. The message is accurate and no false success is claimed.
- **Overbroad comment.** The `recordNoopIdempotent` doc comment says two different requests under one key cannot both record (`intake.ts:685-687`). That holds only among no-op records; the write path bypasses it. Covered by B5.

## Other checks

- **Tenancy.** Idempotency keys include the encoded tenant and user (`intake.ts:313-321`) and the matter is bound in the request hash; every intake entry point starts from `repository.loadMatter`, which refuses another user or tenant with `RESOURCE_NOT_FOUND`. The round-3 changes did not touch that path. I found no cross-tenant leak.
- **Activity.** The write path emits only `snapshot.created` with metadata `{version, count}` (`intake.ts:1763-1776`); no answer text is journaled. No-op and replay emit no event.
- **Copy.** The post-commit failure says the version is recorded but its snapshot is missing. The no-op and replay messages do not claim a new version. Apart from B5's lost replay, I found no false-success copy.
- **Invalid states.** A no-op leaves both counter values untouched. A retired source stays indexed for an honest stale error but is hidden from pickers. A new save on an archived matter is refused while an identical replay is allowed.

## Scope, hashes and evidence

- Receipt `changedFiles` (35 paths), `scope.txt` (35 paths), and `git status` minus `node_modules` (35 paths) are the same set. Every path is under `apps/web/src/v6/features/intake/`, `qa/v6/scenarios/V6-13/` or `qa/v6/evidence/V6-13/`. `node_modules` is the expected symlink to `/private/tmp/patent-v6-worktree/node_modules`.
- Candidate hashes match receipt `fixRound3.finalSha256`: `intake.ts` `d6d780a01999f55bb32a728ca358745e6e8dd6e5d5e26bd8028b85b7a28573ba`; `Intake.tsx` `9f00036ee546d7f702b17ecc5e295d62c6c394fa0858d2c80ee363f97e8491ac`.
- `apps/web/src/v6/routes/V6App.tsx` is not in git status and its hash is `15b6f3c87175fa240cb8cf6c0e86956bbee947c2e66367d3d1a23d78953543ac`, the receipt's restored hash. The mount was reverted.
- `mount-patch.md` was applied to a throwaway copy at `/tmp/v613-review4/mount-copy` (candidate files copied, both edits present). `tsc -p .../apps/web/tsconfig.json --noEmit` exited 0. The reviewed worktree was not modified.
- Red-before-fix: G15, G16 and G17 anchor real code (the no-op record call, the idempotency lookup placement, and the retired-source picker filter). `red-before-fix.txt` records exit 1 and the expected failing test for each. `fix-round-3-red.txt` shows exactly tests 25, 26, 27, 28 and 39 failing against the pre-fix files, and the restore proof shows `intake.ts` SHA-256 `d6d780…73ba` before and after. I reviewed the script and outputs; I did not rerun it because it rewrites `intake.ts` in the reviewed worktree.
- Browser evidence: 12/12 steps reported ok, 0 console errors, 12 screenshots present. Step 11 shows both sides at latest version 7 from base 6; step 12 saves version 8. All material is synthetic; the log uses the V6-13 fixture only.
- I did not rerun `npm run build` because it writes build output into the reviewed worktree. The receipt's `build.txt` records exit 0, and the independent typecheck of both the plain and mount-patched trees is 0.

## Acceptance note

V6-13-A01 and A02, and S03-A01 through S03-A06, remain covered. S03-A03 still holds: a no-op writes no version. V6-13-A03 holds for sequential refresh/retry and fails in the concurrent same-key case described in B5. S03-A07-A09 remain `not_applicable` for this ticket, as recorded in the receipt. The only item between this candidate and ACCEPT is B5.
