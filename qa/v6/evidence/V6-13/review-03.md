VERDICT: NOT_ACCEPT

# V6-13 acceptance review, round 3

Reviewer: independent, read-only. Candidate: `/private/tmp/patent-v6-13-worktree`, branch `codex/v6-13-intake`, HEAD `953e05d`, candidate files untracked.
Probes live in `/tmp/v613-review3/` and import the real `intake.ts` and the V6-13 harness. Nothing inside either worktree was edited.

## Summary

The round-2 blocker B3 is fixed. I reproduced every B3 sub-case the brief listed, and all of them pass. B1 and B2 are still fixed. Tenancy, the activity metadata allowlist, conflict preservation, explicit-only adoption, fact versioning and `isInputStale` staleness all behave correctly. Scope matches exactly. The mount instructions apply cleanly to the target branch, and the patched copy compiles.

There is one new blocker (B4). `saveIntake` returns early on an unchanged (no-op) save and does not write the idempotency record. This breaks the 05-contracts §2 idempotency rule in two ways that I reproduced. The fix is small.

## Commands and exit codes

| Command | Exit | Result |
|---|---|---|
| `npm --prefix /private/tmp/patent-v6-13-worktree run test:v6 -- V6-13` | 0 | 34/34 pass |
| `npm --prefix /private/tmp/patent-v6-13-worktree run test:v6 -- V6-10` | 0 | 36/36 pass |
| `npm --prefix /private/tmp/patent-v6-13-worktree run test:v6 -- V6-11` | 0 | 53/53 pass |
| `./node_modules/.bin/tsc -p apps/web/tsconfig.json --noEmit` (in candidate worktree) | 0 | no output |
| `/usr/bin/git -C /private/tmp/patent-v6-13-worktree status --porcelain --untracked-files=all` | 0 | 33 entries (32 files plus `node_modules`) |
| `node /tmp/v613-review3/probe-b3.mjs` | 0 | output in `probe-b3.out` |
| `node /tmp/v613-review3/probe-idem.mjs` | 0 | output in `probe-idem.out` |
| `node /tmp/v613-review3/probe-idem2.mjs` | 0 | output in `probe-idem2.out` |
| `node /tmp/v613-review3/probe-misc.mjs` | 0 | output in `probe-misc.out` |
| tsc on the mount-patched copy `/tmp/v613-review3/tsc-copy` (target worktree `apps`, `packages`, `fixtures` + the two intake files + the two mount edits) | 0 | no output |

## Earlier blockers

### B3 (version conflict under concurrent saves): FIXED

From `probe-b3.out`:

- P1, two concurrent saves at base 1: the winner gets v2. The loser gets `VERSION_CONFLICT` with `latestVersion: 2` and a non-null `latest`, which is the winner's v2 snapshot. 1 event, 1 snapshot blob.
- P2, three concurrent saves: one winner at v2. Both losers get `latestVersion: 2` with the winner's snapshot. 1 event, 1 blob.
- P3, a save racing a target add: the save is rebuilt and lands at v2 with 1 event, and the racing target is kept. The matter version is 10 while sourceVersion is 2, so the aggregate version and the fact version are correctly separate.
- P4, sustained unrelated writes: exactly 3 commit attempts. Result is `STORAGE_UNAVAILABLE` with 「案件同时有其他写入，这次没有保存。请再保存一次。」. 0 events, 0 blobs, sourceVersion stays 1, no idempotency record. A retry with the same key lands v2 with one event, and all 3 racing targets survive.
- P5, retry at the reported `latestVersion` after a conflict: lands v3. 2 events, 2 blobs.
- P6, replay of a save that landed on attempt 2, and on attempt 3: returns the same v2 with `replayed: true`. 1 event, 1 blob, 1 idempotency record each time.
- P7, conflict while the latest snapshot (v3) is missing: `latestVersion: 3`, and `latest` is the v2 snapshot with v2 text. The UI labels this case (`intake-merge-latest-older`). The read shows `recovery {missingVersion: 3, recoveredFromVersion: 2}`.
- P8a–d, a rebuilt attempt checks source refs again against the fresh matter. A racing retire or chunk change is refused with `SOURCE_LOCATOR_INVALID` and the correct path, with 0 events and 0 blobs. The four ref types are question source, chunk text, disclosure evidence ref, and fact ref (`facts.<id>.refs`).

### B1 (post-commit snapshot failure): STILL FIXED

M4: a first save whose snapshot put fails returns `STORAGE_UNAVAILABLE` with `committedVersion: 2` and an honest message. A fresh read reports `recovery {missingVersion: 2, recoveredFromVersion: null}` and `hasSnapshot: false`. The next save at base 2 lands v3, and the read afterwards is normal. P7 covers the later-version case.

### B2 (disclosure evidence refs not validated): STILL FIXED

M5: a forged evidence quote is refused with `answers.disclosureDetail.evidenceRefs[0]`: 「引用文字与来源段落不一致」. A valid ref saves. After the cited chunk changes, the read shows `state: stale` and `evidenceChanged: [true]`. Saving the stale ref again is refused with 「来源段落内容已变化」.

## Blockers

### B4: an unchanged save skips the idempotency record (05-contracts §2)

**Location.** `apps/web/src/v6/features/intake/intake.ts`, `attemptSave`. The `if (unchanged) return { ok: true, ... }` early return (about lines 1650–1658) comes before the idempotency record write (about lines 1727–1740). So a successful no-op leaves no record under its key.

**Reproduced.**

- I1 (`probe-idem.out`): key `i1-key` with an empty form on a fresh matter returns `{ok: true, version: 1, unchanged: true}`, and no record is written (`recordsAfterNoop: []`). A different payload under the same `i1-key` is then executed. It returns `{ok: true, version: 2}` and writes one `snapshot.created` event.
- I5 (`probe-idem2.out`): key `i5-key` no-op returns `{ok: true, version: 1, unchanged: true}`. Another window then saves v2. Replaying the identical `i5-key` request returns `VERSION_CONFLICT latestVersion 2` instead of the original success.

**Why it blocks.** 05-contracts §2 says: 「同请求重放返回原响应，不同请求为 `IDEMPOTENCY_CONFLICT`。成功响应保存 30 天」. An unchanged save is a successful response. I1 runs a different request under a used key instead of refusing it. I5 gives a different answer to an identical replay. V6-13-A03 ("refresh/retry consistent") and the receipt's A03 evidence ("the same request key replays … a different payload under it is refused") both claim this behaviour without the no-op exception.

**Severity note.** No double write happens. The shipped `Intake.tsx` makes a new key after every success, so the in-product UI cannot trigger this today. The defect is at the `saveIntake` boundary that the contract governs and that later callers will use. If the coordinator rules engine-level contract holes out of scope for this ticket, this is the only item standing between this candidate and ACCEPT.

**Suggested fix.** When `requestKey` is set and the save is unchanged, write the idempotency record (`requestHash`, `version: matter.sourceVersion`, the current snapshot or a reference to it, `unchanged: true`) in its own blob transaction before returning. Make the replay path return `unchanged: true` for such a record. Add two tests: I1 (no-op, then a different payload under the same key, expect `IDEMPOTENCY_CONFLICT` and 0 events), and I5 (no-op, then the matter advances, then an identical replay, expect the original `unchanged` success).

## Non-blocking findings

- **N-a, I3: replay after archive.** A save lands with key K. The matter is then archived. Replaying K returns `INVALID_TRANSITION`, not the original success, because the status gate (`intake.ts:1435`) runs before the idempotency lookup (`:1452`). This is a narrow edge. Move the lookup before the status gate when fixing B4.
- **N-b: the merge panel leads only to "reload".** After a `VERSION_CONFLICT`, the panel shows both sides. But "Save" sends the same stale base again and gets the same conflict. The only action, 「以最新版本重新加载」, resets the form from the view and drops the user's edits. The mine column also truncates answers at 120 characters. The user must copy their text out before reloading. The unsaved input is preserved while the panel is open, so this meets the letter of S03 and 05 §2 ("re-read and merge by hand"), but it is a poor merge flow. Suggest a "save my version on top of v{latestVersion}" action, or a reload that keeps the user's edited fields.
- **N-c (M9): retired sources are still offered in the pickers.** After a source is retired, `readIntake` still lists its chunks (`view.chunks`) and suggestions (`questions[].suggestions`). Saving such a ref is refused correctly with 「来源材料已退役」, so nothing wrong is stored. The user is still offered a choice that will fail. `loadChunkIndex` should skip retired sources when it builds the pickers.
- **N-d: empty-state notice.** The empty notice does not show the S03 pair of choices: 「从材料提取」 / 「直接回答五题」. The five questions are directly answerable, so the behaviour is present.
- Round-2 N1–N7 were not re-litigated. N1 (same-key retry after a post-commit fault gives `latest: null`) is unchanged and is still covered by the UI clearing its key on `committedVersion`.

## Other probes that passed (`probe-misc.out`)

- M1 (A01): answers, per-question source kind (`source` / `direct`), `basedOnVersion` and `savedAt` survive a fresh read. A question that is unanswered but was sent a source (disclosure, maturity) stores no source or provenance.
- M2 (S03-A02, A02, S03-A04): an organization as an inventor is refused with 「发明人必须是自然人」, and the saved answers survive. Disclosure and maturity stay null. After two drafts are bound at v2, a fact change makes v3 and both drafts become `stale: true` with `inputSourceVersion: 2`.
- M3 (S03-A06): a retained conflict with a blank reason is refused. With a reason, it saves, and both statements stay in the read.
- M6: another user in the same tenant, and a user in another tenant, get `RESOURCE_NOT_FOUND` from read, save, bindDraftInput, readDraftBindings and stageCandidates.
- M7: `snapshot.created` metadata keys are exactly `version, count`, matching `ACTIVITY_METADATA_KEYS_BY_ACTION`. No answer text appears in the event.
- M8: bindDraftInput refuses a future sourceVersion (`INVALID_INPUT`) and an unknown target (`RESOURCE_NOT_FOUND`). A `targetConfigVersion` bump alone makes the draft stale.
- M10 (S03-A05): of 6 staged candidates, only the 4 adopted ones enter the snapshot. The other 2 stay unadopted.

## Scope

Receipt `changedFiles` (32 paths) equals git status minus `node_modules`. There is no `.claude/launch.json` in the candidate. Every path is under `apps/web/src/v6/features/intake/`, `qa/v6/scenarios/V6-13/` or `qa/v6/evidence/V6-13/`. Pass.

## Mount patch

`mount-patch.md` is clear and applies cleanly to `/private/tmp/patent-v6-worktree/apps/web/src/v6/routes/V6App.tsx`. The `Parse` import line occurs once (line 14, with `Figures` on line 15). `      {tab === "sources" ? (` occurs once (line 399). I applied both edits to a copy at `/tmp/v613-review3/tsc-copy` and ran `tsc -p apps/web/tsconfig.json --noEmit`: exit 0. `npm run build` and the browser check were not run on the copy.

## Per-row receipt check

| Row | Receipt | Reviewer |
|---|---|---|
| V6-13-A01 | covered | Agree (M1, engine tests). |
| V6-13-A02 | covered | Agree (M2, M5). |
| V6-13-A03 | covered | **Disagree in part.** Replay and conflict paths hold for saves that write (P5, P6, I4), but the evidence claim "a different payload under it is refused" fails for no-op saves (B4). |
| S03-A01 | covered | Agree. Disclosure stays null until the user chooses (M1, M2). |
| S03-A02 | covered | Agree (M2). |
| S03-A03 | covered | Agree. An unchanged save writes no version. Note B4 about its idempotency record. |
| S03-A04 | covered | Agree (M2, M8). |
| S03-A05 | covered | Agree (M10). |
| S03-A06 | covered | Agree (M3). |
| S03-A07 | not_applicable | Agree. This is route recommendation, and V6-13 has no route code. |
| S03-A08 | not_applicable | Agree. This is target preview, and it is not implemented here. |
| S03-A09 | not_applicable | Agree. This is route recommendation, and it is not implemented here. |
