VERDICT: ACCEPT

# V6-13 acceptance review, round 5

Reviewer: independent, read-only. Candidate: `/private/tmp/patent-v6-13-worktree` (branch `codex/v6-13-intake`, base `953e05d`, 37 candidate paths untracked). Probes and throwaway copies live in `/tmp/v613-review5/`; they import the candidate's real `intake.ts` and the V6-13 harness. Nothing under the candidate worktree, the round-4 worktree, or `/Users/jared/Personal Projects/Patent` was edited by this review. No network or model calls, no `npm install`, no dev server, synthetic data only. The only review output is this file.

## Summary

B5 is closed for every case the round-4 review named. Both branches now claim the key in one read-write transaction before any business write. Across 40 ungated no-op/write rounds, exactly one call succeeded each round (39 no-op first, 1 write first); a winning write produced exactly one event and one snapshot, a winning no-op produced none, the loser was `IDEMPOTENCY_CONFLICT`, and both originals replayed on a fresh repository with their original responses. Gated write-first, no-op-first, write/write, no-op/no-op, live-claim busy, the required lease-takeover ordering, pre-commit release, N1 and the null-key path all behave as specified.

B1-B4 still hold independently: the round-4 B1/B2/B3/B4 probes reproduce their expected states on this candidate, and V6-13 is 45/45 with V6-10 36/36, V6-11 53/53 and typecheck 0. The file set, hashes, mount patch, G18 red run and pre-fix run match the receipt.

One narrow residual window is real and is disclosed verbatim in `receipt.fixRound4.residualLimitation`: if the stalled owner's commit lands first while a takeover holds the claim, the takeover loses its version check and releases the pending record; a fresh same-key replay then returns `VERSION_CONFLICT` instead of the original committed error. No successful response is lost, no event/version is duplicated, no claim is left stuck, and B1 read recovery still works. This is a non-blocking note, not B6.

## Commands and results

| Command | Exit | Result |
|---|---|---|
| `npm --prefix /private/tmp/patent-v6-13-worktree run test:v6 -- V6-13` | 0 | 45 tests, 45 pass, 0 fail |
| `npm --prefix /private/tmp/patent-v6-13-worktree run test:v6 -- V6-10` | 0 | 36 tests, 36 pass |
| `npm --prefix /private/tmp/patent-v6-13-worktree run test:v6 -- V6-11` | 0 | 53 tests, 53 pass |
| `node_modules/.bin/tsc -p /private/tmp/patent-v6-13-worktree/apps/web/tsconfig.json --noEmit` | 0 | no output |
| `node /tmp/v613-review5/probe-b5.mjs` | 1 | 13/14 probes pass. The single failing probe is the extra inverted-takeover ordering described below, not a required case. |
| `node /tmp/v613-review4/probe-b123.mjs` (re-run against this candidate) | 0 | B1/B2/B3 reproduced: B1 v3 post-commit failure then v4 fill; B2 forged ref refused and changed ref stale; B3 race one v2 + one `VERSION_CONFLICT`, target rebuild, bounded 3 attempts |
| `node /tmp/v613-review4/probe-idem-variants.mjs` (re-run against this candidate) | 0 | B4 reproduced: 20/20 no-op/no-op different-payload rounds give one success and one `IDEMPOTENCY_CONFLICT`, 0 events, 0 snapshots; 20/20 write/write rounds give one v2 success and one conflict, 1 event, 1 snapshot; no-op replay after archive/move succeeds; different payload stays refused |
| `node /tmp/v613-review5/probe-residual.mjs` | 0 | prints the inverted-takeover, settle-fault and tenancy/activity outcomes |
| `node /tmp/v613-review5/probe-noop-inverted.mjs` | 0 | no-op inverted takeover: stalled no-op is busy, takeover succeeds, fresh replay succeeds, 0 events, 1 completed record |
| `python3 -I /tmp/v613-review5/index-check.py` | 0 | 0 modified and 0 missing tracked files; 37 untracked exactly equal to `receipt.changedFiles` and `scope.txt` |
| `/tmp/v613-review5/mount-copy/node_modules/.bin/tsc -p /tmp/v613-review5/mount-copy/apps/web/tsconfig.json --noEmit` | 0 | mount-patched copy compiles; both edits from `mount-patch.md` present exactly |
| G18 mutation in `/tmp/v613-review5/red-copy` | 1 | 21 failures, exactly the `red-before-fix.txt` G18 list (1,10,11,13,15,16,17,20,21,22,25,26,27,29,30,31,32,33,34,38,43) |
| Round-4 pre-fix run in `/tmp/v613-review5/red-copy` | 1 | 45 tests, 40 pass, 5 fail: exactly tests 11, 29, 30, 31, 33 |

The session guard refuses git commands targeting the V6-13 worktree. I reconstructed status from its index and blob hashes instead (`index-check.py`), which is equivalent for this check: 473 tracked entries, no modified or missing tracked file, and the 37 untracked paths exactly equal both evidence lists. The `node_modules` symlink is present and is excluded from that set, as in earlier rounds.

## Blockers from earlier rounds

### B1: post-commit snapshot failure and recovery: PASS

Test 11 and tests 15-16 pass. Independently, `probe-b123.mjs` on this candidate:

- Two saves land v2. A snapshot-blob fault then makes the v3 save return `STORAGE_UNAVAILABLE` with `committedVersion: 3` and the committed-without-snapshot message.
- A fresh repository reads sourceVersion 3 with `recovery {missingVersion: 3, recoveredFromVersion: 2}`, `hasSnapshot: false`, and the v2 answers.
- Saving that recovered form at base 3 lands v4 with `unchanged: false`; the next read has `recovery: null`, `hasSnapshot: true`.
- 3 `snapshot.created` events and 2 snapshot blobs, one blob per version whose batch completed.

The new claim protocol does not consume or release the claim after the commit lands (`intake.ts:2220` calls `onClaimSettled()` before the blob batch), so B1 recovery is preserved. The N1 replay behavior is covered under B5(h).

### B2: disclosure evidence refs: PASS

Tests 18-19 and UI test 39 pass. `probe-b123.mjs` independently shows a forged evidence quote is refused as `SOURCE_LOCATOR_INVALID` at `answers.disclosureDetail.evidenceRefs[0]` with 「引用文字与来源段落不一致」 and writes nothing; a valid ref saves; after the cited chunk set is removed, a fresh read marks the disclosure answer `sourceChanged: true`, `evidenceChanged: [true]`, `state: "stale"`. The claim protocol runs before validation but releases on the pre-commit failure; the forged attempt produces no event, and the pre-commit invalid-input probe (same `attemptClaimedSave` validation path, `intake.ts:1879-1883` for evidence refs and `:1889-1898` for the inventor check) leaves 0 idempotency records.

### B3: conflict reporting and bounded rebuild: PASS

Tests 20-22 and UI tests 43-44 pass. `probe-b123.mjs` independently shows:

- Two saves race at base 1: one lands v2; the loser gets `VERSION_CONFLICT` with `latestVersion: 2` and the winner's readable snapshot; 1 event, 1 snapshot.
- A save racing a target add is rebuilt: 2 commit attempts, lands v2, 1 event, the target is kept.
- Sustained unrelated writes stop after exactly 3 attempts with `STORAGE_UNAVAILABLE` and 「案件同时有其他写入，这次没有保存。请再保存一次。」, 0 events; a retry lands v2 and all racing targets survive.

The claim is taken before the base gate and released on the `VERSION_CONFLICT` retry (`intake.ts:1810-1828`, `:1853-1855`), so the rebuild is not serialized away. My pre-commit probe also confirms a stale-base request leaves no idempotency record and returns `VERSION_CONFLICT`, not a stuck claim.

### B4: sequential no-op idempotency: PASS

Tests 25-27 pass. `probe-idem-variants.mjs` on this candidate:

- Sequential no-op then a different payload: the no-op succeeds with `{version: 1, unchanged: true}`; the different payload is `IDEMPOTENCY_CONFLICT`; sourceVersion stays 1; 0 events, 0 snapshots.
- No-op, then a target add, then an identical replay: the replay succeeds unchanged; a different payload under the key is `IDEMPOTENCY_CONFLICT`.
- No-op, then archive, then an identical replay: the replay succeeds unchanged; a new request is `INVALID_TRANSITION`.
- Concurrent no-op/no-op with different payloads: 20/20 rounds give one success and one `IDEMPOTENCY_CONFLICT`, 0 events, 0 snapshots, 1 record. Identical no-op/no-op (same request hash) gives both calls the same successful response, one marked replayed, 30/30 rounds, 0 events.

The no-op branch settles the claim with the baseline snapshot (`intake.ts:2029-2053`) and still writes no version and no event (S03-A03).

### B5: one key, one claim, one business write: CLOSED

Tests 29-34 pass, and G18 is a live guard: its mutation replaces the `claimIdempotency` call with a fabricated `{kind:"claimed"}` (`red-before-fix.mjs:189-194`), and 21 tests fail, including tests 29-34's B5 group. My independent probes cover every required case:

| Case | Result |
|---|---|
| (a) no-op vs version write, ungated, 40 rounds | Pass. Exactly one success per round (39 no-op first, 1 write first); winner's branch only: a write win has 1 event + 1 snapshot, a no-op win has 0 and 0; loser is `IDEMPOTENCY_CONFLICT`; one record per round. Both originals replayed on a fresh repository as their original response (success -> success, conflict -> conflict). |
| (a) gated write-first and no-op-first | Pass. The first claim owner wins; the other is `IDEMPOTENCY_CONFLICT` and writes nothing. |
| (b) write/write, different payloads | Pass. One v2 success, one `IDEMPOTENCY_CONFLICT`, 1 event, 1 snapshot, 1 record; the success replays. |
| (c) no-op/no-op, identical | Pass. Both return success only as the same stored response; one is `replayed: true`; 0 events, 0 snapshots, 30/30 rounds. |
| (c) no-op/no-op with different payloads | Pass. 20/20 rounds give one success and one `IDEMPOTENCY_CONFLICT`, never two successes, 0 events. |
| (d) fresh replay of both originals for the required races | Pass for every required race: successful originals replay the same version/unchanged/snapshot; `IDEMPOTENCY_CONFLICT` originals stay conflicts; busy originals replay success after the owner completes. |
| (e) live pending claim | Pass. The identical waiter waits ~517 ms (500 ms bound), gets `STORAGE_UNAVAILABLE` with 「同一请求正在处理中，请稍候再试。」, and executes no business write (0 events, 0 snapshots, record still `pending`). The owner then commits v2; a retry replays success with 1 event. |
| (f) lease takeover, required ordering (takeover commits) | Pass. The takeover commits v2 with `replayed: false`; the stalled owner resumes, loses its version check, and replays the winner (v2, `replayed: true`); 1 event, 1 snapshot, 1 completed record; no second event or version. Both replays succeed. |
| (g) pre-commit failures release the claim | Pass. Event-put fault: 0 records left, identical retry succeeds v2, 1 event. Invalid input: `INVALID_INPUT`, 0 records, retry still `INVALID_INPUT`, 0 records. Stale base: `VERSION_CONFLICT`, no stale-base record. Archived matter: `INVALID_TRANSITION`, 0 records. No stuck pending record. |
| (h) N1: commit succeeds, snapshot batch fails | Pass. Commit v3 lands, the committed record is kept, and the first call returns `STORAGE_UNAVAILABLE` with `committedVersion: 3`. A same-key replay returns the same committed error both while the fault is on and after it clears; no second event, no version move. A new key at base 3 then saves v4 with a snapshot. |
| (i) requestKey null | Pass. No claim record and no replay; a second identical write gets `VERSION_CONFLICT`; a no-op succeeds unchanged; concurrent null-key writes give one success and one `VERSION_CONFLICT`, 1 event. |

The claim protocol itself is sound in the code I read: `claimOnce` (`intake.ts:706-737`) checks the hash before any state branch and writes the pending record in the same transaction as the check; `claimIdempotency` (`:740-754`) waits at most 500 ms; `settleClaim` (`:762-783`) only finalizes a pending record with the matching claimId and hash; `completeNoopClaim` (`:790-815`) does the same for a no-op and replays an already-completed record; `writeCommittedBlobs` (`:823-846`) requires the committed state and matching claimId and writes the snapshot, candidates and completed record atomically; `releaseClaim` (`:853-871`) deletes only its own pending claim; `committedEventVersion` (`:877-895`) is the duplicate-event backstop. The IndexedDB adapter runs each of these backend transactions across the three stores and waits for transaction completion (`indexeddb-repository.ts:112-140`).

## New blocker

None. B6 is not opened.

The one interleaving that does not fully replay is an extra ordering beyond the required lease-takeover case: the stalled owner's commit lands first. It is a failure-response replay gap, not a lost success. Its full description and the contract reasoning are in note 1 below; the receipt already discloses it. If the coordinator reads requirement (d) as applying to failed responses as strictly as to successful ones, this would be a blocker; under the brief's stated invariant (「no successful response may become unreplayable」), decisions[9], and the product path that opens a new key on `committedVersion` or a conflict, it is not.

## Non-blocking notes

1. **Inverted lease takeover (the disclosed residual window).** With a one-shot gate before `commit`: owner 1 claims at T1 and pauses; owner 2 takes over at T1+31 s and pauses; owner 1's commit is released first and lands v2; owner 2's commit then loses the version check. Owner 1's `settleClaim` returns `lost` because the record now carries owner 2's claimId, so owner 1 returns `STORAGE_UNAVAILABLE` with `committedVersion: 2` without writing the snapshot or a committed record. Owner 2 gets `VERSION_CONFLICT`, and its `finally` deletes the pending record. End state: 1 event, 0 snapshots, 0 records, sourceVersion 2. A fresh same-key replay returns `VERSION_CONFLICT`, not owner 1's committed error. This matches `receipt.fixRound4.residualLimitation` exactly. There is no lost successful response, no duplicate event/version, and no stuck claim; B1 read recovery still shows version 2 and a save with a new key fills the snapshot. Repro: `/tmp/v613-review5/probe-b5.mjs` (「lease takeover: stalled owner's commit races in first」) and `/tmp/v613-review5/probe-residual.mjs` section A. The no-op analogue is safe: the stalled no-op gets the retryable busy error, the takeover succeeds, and a fresh replay succeeds (`probe-noop-inverted.mjs`).

2. **Committed-marker put failure (adjacent to N1).** If the `settleClaim` put of the committed record itself fails after the commit lands, the pending record remains; after the lease a takeover hits the base gate (sourceVersion already advanced) and returns `VERSION_CONFLICT`, deleting the record. A same-key fresh replay then returns `VERSION_CONFLICT`, not the original committed error, and there are 0 snapshots. The specified N1 case (the snapshot blob batch fails after the committed record is written) is closed and replays the committed error, so this is a narrower, adjacent fault: the commit is durable, B1 recovery works, no success is lost, and the UI leaves the key on `committedVersion`. Repro: `/tmp/v613-review5/probe-residual.mjs` section B and the extra probe in `probe-b5.mjs`. If this fault point is considered part of N1's scope, it needs a test and a disclosure; the current receipt's `residualLimitation` describes the record-losing takeover but not this exact cause.

3. **IndexedDB was not executed as a separate backend run.** `fake-indexeddb` is not in `node_modules`, and I did not start a browser server. The adapter's transaction is one transaction over `[matters, events, blobs]` and resolves only after `oncomplete` (`indexeddb-repository.ts:112-140`), so each claim/settle/complete/release unit is atomic across the stores; the in-memory backend serializes readwrite transactions, so the protocol logic and its atomic units are exercised. The receipt's browser evidence ran the real IndexedDB app (12/12 steps, 0 console errors). An IndexedDB-specific concurrency run would need the browser harness.

4. **Receipt wording 「Only the claim owner may commit」.** In the inverted window, owner 1's commit lands after owner 2 has replaced the claim, so the sentence is not enforced at `repository.commit` time; ownership is enforced at settlement (`settleClaim`/`writeCommittedBlobs`) and the deterministic event id is the commit backstop. The observable outcomes still have one event/version and no lost successful response, and `residualLimitation` discloses the window. Consider tightening the decision/A03 phrase to 「only the claim owner may finalize/settle」 unless commit-time fencing is added. This is a wording issue, not a code defect under the required cases.

5. **Tenancy, activity and content checks.** The idempotency key encodes tenant, user, operation and key (`intake.ts:326-334`), and the matter is part of the request hash; a cross-tenant save and a same-tenant/different-user save both return `RESOURCE_NOT_FOUND` before any record is written. The only event is `snapshot.created` with metadata keys exactly `version,count` (`repository.ts:184-192`, allowlist at `:810`), and the serialized event contains no answer text. The idempotency record stores the baseline snapshot for a no-op, scoped to the tenant/user/matter/key and required for replay; I found no cross-tenant read path.

6. **Red-first evidence is narrow but honest.** The round-4 pre-fix run fails exactly 5 tests (11, 29, 30, 31, 33); tests 32 and 34 already passed on the pre-fix code, as the receipt's `redFirst.note` says. G18 is the guard that proves the claim is live (21 failures when the claim call is bypassed). The suite itself does not cover the inverted takeover; the receipt's `residualLimitation` is the disclosure for it.

## Evidence and scope

- `receipt.changedFiles` (37), `scope.txt` (37), and the reconstructed worktree status (37 untracked, excluding the `node_modules` symlink) are the same set. All paths are under `apps/web/src/v6/features/intake/`, `qa/v6/scenarios/V6-13/` or `qa/v6/evidence/V6-13/`. No tracked file is modified or missing.
- `apps/web/src/v6/routes/V6App.tsx` is tracked, unmodified, and its SHA-256 is `15b6f3c87175fa240cb8cf6c0e86956bbee947c2e66367d3d1a23d78953543ac`, the receipt's restored mount hash.
- Candidate hashes match the receipt's `fixRound4.finalSha256`: `intake.ts` `e121cd3747f9cff4c489fb62d07decc05c6d35657104f23ff0e13bc955a1f57d`; `Intake.tsx` `9f00036ee546d7f702b17ecc5e295d62c6c394fa0858d2c80ee363f97e8491ac`.
- `mount-patch.md` applied to the throwaway copy at `/tmp/v613-review5/mount-copy` gives exactly the two documented edits (`import { Intake }`, and the `facts` branch before the `sources` branch); `tsc` exits 0. The reviewed worktree was not modified.
- Red-before-fix: `fix-round-4-red.txt` records `intake.ts` before `d6d780a01999f55bb32a728ca358745e6e8dd6e5d5e26bd8028b85b7a28573ba` and after `e121cd37...a1f57d`, with a byte-identical restore proof and the backup outside the repo. I re-ran the pre-fix file (`/tmp/v613-r4-prefix-intake.ts`, SHA-256 `d6d780...73ba`) in a throwaway copy and reproduced 45 tests / 40 pass / 5 fail, exactly tests 11, 29, 30, 31, 33. I re-ran the G18 mutation in the same throwaway copy and reproduced exactly its 21-failure list.
- `receipt.fixRound4` matches observed behavior: the claim lifecycle text on claim/replay/committed/conflict/busy/takeover/release/backstop is accurate; N1 is closed for the specified snapshot-batch failure (test 11); `redFirst` matches; `newGuards` G18 is present and live. Decisions 9 and 11 and the A03 acceptance text now describe the observed successful-response replay and the B5 tests 29-34 / N1 test 11 correctly. Decision 4's 「Only the claim owner may commit」 is the only overstatement (note 4).
- I did not rerun `npm run build`, which writes build output into the reviewed worktree. The receipt records build exit 0, and both the plain and mount-patched typechecks exit 0.

## Acceptance note

V6-13-A01, A02, A03, S03-A01-A06 are covered. A03 now holds for the concurrent same-key cases the round-4 review named: one key has one claim, no-op vs write never both execute, the no-op writes no version/event, a completed response replays, and a different payload is `IDEMPOTENCY_CONFLICT`. S03-A07-A09 remain `not_applicable` as recorded. The remaining inverted-takeover and committed-marker failures concern replay of a failure response, are disclosed, and do not lose a successful response, duplicate a version or leave a stuck claim.
