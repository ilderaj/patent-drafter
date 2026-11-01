VERDICT: NOT_ACCEPT

# V6-13 independent acceptance review 02

- Candidate: `/private/tmp/patent-v6-13-worktree` (branch `codex/v6-13-intake`, HEAD `953e05d`, candidate files untracked)
- Reviewed: `apps/web/src/v6/features/intake/{intake.ts,Intake.tsx}`, `qa/v6/scenarios/V6-13/*`, `qa/v6/evidence/V6-13/*` (receipt, mount-patch.md, review-01.md)
- Specs: `tickets/V6-13.md`, `specs/S03.md`, `05-contracts.md`, `01-architecture.md`, `06-execution-protocol.md`
- Probes: `/tmp/v613-review2/probe-01..05*.mjs`, `mutate.mjs` (run on a copy at `/tmp/v613-review2/mirror`), and the mount check on a copy at `/tmp/v613-review2/prmirror`. Every probe imports the real candidate modules and the V6-13 harness. Outputs are in `probe-0N.out` and `mutate.out`. Nothing in either worktree was edited.

## 1. Commands and exit codes

| Command | Result | Exit |
|---|---|---|
| `npm --prefix /private/tmp/patent-v6-13-worktree run test:v6 -- V6-13` | 27/27 pass | 0 |
| `npm --prefix /private/tmp/patent-v6-13-worktree run test:v6 -- V6-10` | 36/36 pass | 0 |
| `npm --prefix /private/tmp/patent-v6-13-worktree run test:v6 -- V6-11` | 53/53 pass | 0 |
| `./node_modules/.bin/tsc -p apps/web/tsconfig.json --noEmit` (from the candidate worktree) | no output | 0 |
| `/usr/bin/git -C /private/tmp/patent-v6-13-worktree status --porcelain --untracked-files=all` | 30 paths plus `node_modules` | 0 |
| `shasum -a 256 intake.ts qa/v6/evidence/V6-13/intake.ts.original V6App.tsx` | `029f9115...` for both intake files; `15b6f3c8...` for V6App.tsx | 0 |
| `tsc --noEmit` on the PR-branch copy (`prmirror`), before the mount edits | no output | 0 |
| `tsc --noEmit` on the PR-branch copy, after applying `mount-patch.md` | no output | 0 |
| `node mutate.mjs` (mirror copy) | M1 caught (exit 1); M2 and M3 not caught (exit 0); unmutated mirror exit 0 | 0 |

## 2. Probes and results

### P1: concurrent saves and unrelated commits (`probe-01`, `probe-03`)
After ingest and parse, the seeded matter has `version` 8 and `sourceVersion` 1. These two counters differ for every real matter.
- **P1a, sequential stale base.** v2 is saved. A second save at base 1 returns `VERSION_CONFLICT` with `latestVersion: 2` and `latest` = v2 ("我的版本A"). Correct. This path is caught by the pre-check (`intake.ts:1401`).
- **P1b, true race.** Two saves at base 2 run through `Promise.all`. The winner commits v3. The loser returns `VERSION_CONFLICT` with **`latestVersion: 10`** (the aggregate `matter.version`) and **`latest: null`**. The facts are actually at version 3, and that snapshot is readable. There is one event per committed version, with no duplicate. The read afterwards shows v3 with the winner's text.
- **P1c, unrelated commit.** An intake save at base 1 races `addTargets`, which bumps `version` only. The save returns `VERSION_CONFLICT` with `latestVersion: 9` and `latest: null`, although no fact was saved by anyone (`sourceVersion` is still 1). A retry at the reported `latestVersion` 9 fails again. A retry at base 1 succeeds.
- **UI render of the race loser (`probe-03`).** The real `IntakePanel` shows 「最新是第 9 版」 (the latest is version 9), a version that does not exist, and in the latest column 「最新版本的答案无法读取；请重新加载。」 (the latest version's answers cannot be read; please reload). No side-by-side view is shown. (The 「基于第 N 版」 base number in that render is an artifact of my props.)
- **Coverage.** No V6-13 test runs a concurrent race (`grep Promise.all` finds no match). The existing conflict tests only reach the pre-check branch.

### P2: B1 fault matrix (`probe-02`, `probe-03`)
The probes fault puts to `blobs` keys `intake/snapshot/*`. Each re-read uses a fresh repository on the same backend.
- **A, fault on the first save.** The save returns `STORAGE_UNAVAILABLE` with `committedVersion: 2`, and the message says v2 is recorded (no "没有保存", "not saved"). The fresh read is `ok`, at `sourceVersion` 2, `recovery {missingVersion:2, recoveredFromVersion:null}`, with an empty form. The UI shows the form and the save button, and the copy says no earlier snapshot exists. A save at base 2 writes v3 with its snapshot. The next read is normal (`recovery: null`, `hasSnapshot: true`). Pass.
- **B, fault on a later save (v3).** The fresh read shows v2's answers at version 3 with `recoveredFromVersion: 2`. Saving the shown content unchanged still writes v4 (the gap is filled). The read afterwards is normal. Pass.
- **C, two faulted saves in a row (v3, v4).** The fresh read is at version 4, recovered from 2. The UI copy reads 「第 4 版事实已记录…下面显示的是第 2 版保存的内容，可能比第 4 版旧。」 (version 4 of the facts is recorded… what is shown below is the content saved in version 2, which may be older than version 4). The save writes v5, and later reads are normal. Pass. Note that the content of v3 and v4 is lost. The notice says so honestly.
- **D, isolation.**
  - A second matter at `sourceVersion` 3 with no snapshots recovers to an empty form. It never shows the first matter's data.
  - A well-formed envelope copied from matter 1 into matter 2's key space is rejected by the matterId check. Matter 2 still shows an empty recovery.
  - Other tenant: `RESOURCE_NOT_FOUND`. Same tenant, other user: `RESOURCE_NOT_FOUND`. Pass.
- **Same-key retry after a post-commit fault (engine level).** It returns `VERSION_CONFLICT` with `latest: null` (the idempotency record was in the failed blob transaction). The event count stays at 1, so there is no double side effect. The UI clears the key and switches its base on `committedVersion`, so it does not send this request. Non-blocking (N1).

### P3: B2 evidence refs (`probe-04`)
Each case saves with `disclosureDetail.evidenceRefs` set:
- forged quote: `SOURCE_LOCATOR_INVALID` at `answers.disclosureDetail.evidenceRefs[0]`;
- wrong hash: rejected the same way;
- wrong chunk (another chunk's id and hash): rejected;
- a valid ref followed by a bad second ref: rejected at `[1]`;
- a ref to a chunk of another matter's parsed source in the same backend: rejected with 「来源段落不存在或已被替换」 (the source paragraph does not exist or was replaced). The same ref is also rejected as a question source.
- No events are written by any rejected save.

After a valid save (v2), I changed the stored chunk's hash. The fresh read returns `state: "stale"`, `evidenceChanged: [true]` and `sourceChanged: true`. Re-saving with the stale ref is refused. Pass.

### P4: idempotency, retry, metadata, transitions (`probe-05`)
- Same key and same payload through a fresh repository: replayed v2, with one event.
- Same key, different payload: `IDEMPOTENCY_CONFLICT`.
- Same key, same actor, other matter: `IDEMPOTENCY_CONFLICT`.
- Other tenant: `RESOURCE_NOT_FOUND`.
- The only record key is `intake/idempotency/{tenant}/{user}/intake.save/k1`.
- A malformed key returns `INVALID_INPUT`.
- A pre-commit fault (on the `matters` put) returns `STORAGE_UNAVAILABLE` with no `committedVersion`. `sourceVersion` and the event count are unchanged. A retry with the same key commits once, and a further retry replays it. Pass.
- `snapshot.created` metadata is `{version, count}` only. The event's `snapshot` field is null, and no answer text appears anywhere in the event. Pass.
- Saving on an archived matter returns `INVALID_TRANSITION`. Pass.

### P5: test strength (`mutate.mjs`, mirror copy only)
- M1: the pre-check reports `matter.version` as `latestVersion`. Caught (exit 1).
- M2: the `chunk.sourceId !== ref.sourceId` check is removed. Not caught. Cross-matter refs are still refused by the matter-scoped chunk index, so this is defence in depth only.
- M3: recovery no longer checks the envelope's `matterId`. Not caught. Snapshot keys are matter-scoped, so only a tampered store reaches this check.

### P6: mount instructions (`prmirror`)
I applied the two edits in `mount-patch.md` literally to a copy of `/private/tmp/patent-v6-worktree/apps/web` (branch HEAD `593ba33`, which has the `Figures` import at line 15 and `{tab === "sources" ? (` at line 399):
- Each anchor matches exactly once.
- `tsc --noEmit` exits 0 after the edits.
- The `facts` tab navigation already exists (lines 322 and 408).

The instructions are clear and apply. Round-1 non-blocking item 1 is resolved.

### P7: scope
- Git status minus `node_modules` has 30 paths. Receipt `changedFiles` has 30 paths. The two lists are identical. There is no `.claude/launch.json` in this worktree.
- Every path is under `apps/web/src/v6/features/intake/`, `qa/v6/scenarios/V6-13/` or `qa/v6/evidence/V6-13/`.
- `V6App.tsx` has sha256 `15b6f3c8…`, which matches the receipt, and it is not in git status. Pass.

## 3. Round-1 blocker status

| Blocker | Status | Basis |
|---|---|---|
| B1: post-commit snapshot failure locks the user out after a reload | **Fixed** | P2 cases A to D. The recovery read works at the first save, at a later save and after two faults in a row. The copy is accurate. The save fills the gap. There is no cross-matter or cross-tenant leak. The notice is always shown when older data is shown. |
| B2: `disclosureDetail.evidenceRefs` not validated | **Fixed** | P3. All five cases are rejected at save with a per-index field path. A source change after save reads as stale and blocks a re-save. |

## 4. Blockers

### B3. A concurrent `VERSION_CONFLICT` reports the aggregate version and no latest snapshot, so no side-by-side merge is possible
- **Location:** `apps/web/src/v6/features/intake/intake.ts:1619-1621`.
  ```ts
  if (committed.error.code === "VERSION_CONFLICT") {
    const latestVersion = committed.error.latestVersion ?? matter.sourceVersion;
    const latest = await readStoredState(repository, matterId, latestVersion);
  ```
  `committed.error.latestVersion` is the repository's aggregate `matter.version`, not the fact `sourceVersion`. `Intake.tsx` `VersionConflictPanel` (lines 1264 and 1285-1287) displays this value.
- **Reproduced scenarios:**
  - (a) `probe-01` P1b. Two tabs save at the same base. Both pass the pre-check, and the loser fails at commit CAS. It receives `latestVersion: 10` and `latest: null`, while the real latest facts are v3 and readable. The panel says 「最新是第 9/10 版」 (the latest is version 9/10) and 「最新版本的答案无法读取」 (the latest version's answers cannot be read).
  - (b) P1c. An intake save that races any non-intake commit, such as a target add, a parse transition or an ingest, gets a `VERSION_CONFLICT` that says 「其他窗口已保存了更新的版本」 (another window has saved a newer version). In fact no fact version changed. It reports a non-existent `latestVersion: 9`, and a retry at that version fails again.
- **Why it blocks:**
  - S03 line 25 says: 「提交带 `baseSourceVersion`；不一致返回 `VERSION_CONFLICT`，UI 并排展示双方差异让用户合并」 (a submit carries `baseSourceVersion`; on a mismatch, return `VERSION_CONFLICT`, and the UI shows both sides' differences side by side for the user to merge).
  - `01-architecture.md` line 60 and `05-contracts.md` line 43 say a conflict returns the latest version.
  - In the race that the conflict rule exists for, the user gets neither the right version nor the other side's content.
  - The brief names "concurrent saves at the same base" as a must-probe path, and the suite has no test for it.
  - Pressing save again happens to produce a correct conflict through the pre-check, but the first response is wrong and invites "以最新版本重新加载" (reload with the latest version), which discards edits.
- **Suggested fix:**
  1. When `commit` returns `VERSION_CONFLICT`, reload the matter.
  2. If `sourceVersion` is still equal to `baseSourceVersion` (only the aggregate moved), rebuild the commit at the new `matter.version` and retry once or a bounded number of times. No fact conflict exists.
  3. Otherwise, return `latestVersion = reloaded.sourceVersion` and `latest = readStoredState(..., reloaded.sourceVersion)`. Use the recovery fallback when that snapshot is missing.
  4. Add tests:
     - a `Promise.all` race at the same base, asserting `latestVersion` equals the winner's `sourceVersion` and that `latest` contains the winner's text;
     - an intake save racing `addTargets`, asserting that it succeeds, or at least that it does not report a fact conflict.

## 5. Non-blocking findings

1. **N1.** An engine-level retry with the same key after a post-commit snapshot fault returns `VERSION_CONFLICT` with `latest: null`, because the idempotency record was lost with the failed blob transaction. There are no duplicate events. The UI avoids this path. Consider answering a same-key, same-hash retry whose matter already advanced (with this request's event id present) as a replay into recovery.
2. **N2.** `Intake.tsx` `onReloadLatest` clears the request key but not `recoveryBase`. If a reload follows a post-commit failure, a later save could use a stale base and get a (correct) conflict. This is found by code reading only and was not reproduced.
3. **N3.** The doc comment above `saveIntake` (`intake.ts:1331`) still says "a reload then answers `storage_unavailable`". That is no longer true after the B1 fix.
4. **N4.** The defensive checks M2 and M3 are untested (see P5). Neither is reachable without a tampered store.
5. **N5.** `qa/v6/evidence/V6-13/intake.ts.original` is byte-identical to `intake.ts` (both sha256 `029f9115…`). It is inside the evidence write set and listed in `changedFiles`, so it breaks no scope rule. Its `.original` extension keeps it out of tsc, the build and the runner, so it has no functional effect. It is still a second copy of production source, and it will drift as soon as `intake.ts` changes. That would make the red-before-fix evidence misleading. Delete it or replace it with its hash before merge. It does not affect the verdict.
6. **N6.** The not_applicable reasons for S03-A07 to A09 name "route/mount", "rule-pack" and "target-config" surfaces. The rows are the route-recommendation and target-preview behaviours: unverified CN grant period, the `us_nonprovisional` preview, and not recommending `cn_um` for method facts. No V6-13 code implements or claims them, so not_applicable is honest. The reasons should name the downstream targets/route ticket instead of the mount.
7. **N7.** Round-1 note 3 still applies: browser step 08 injects the draft binding into IndexedDB. The receipt discloses this.

## 6. Per-row receipt check

| Row | Receipt | Reviewer finding |
|---|---|---|
| V6-13-A01: leave and re-enter keeps answers and sources | covered | Confirmed. The fresh-repository reads in P2 and P3 keep the answers, the provenance and the evidence refs. Red-before-fix G1 and G2b fail the named tests. |
| V6-13-A02: no example disclosure auto-used; a fact change stales the draft | covered | Confirmed. Disclosure and maturity stay null unless chosen, and the UI select starts on 「请选择（不会自动填写）」 ("please choose (not filled in automatically)"). `isInputStale` drives staleness (G3, G5). |
| V6-13-A03: refresh or retry matches persisted state, with no duplicate side effects | covered | Confirmed for B1 recovery, pre-commit retry and idempotent replay (P2, P4). No duplicate events in any probe. |
| S03-A01: sample mention shown, disclosure stays null | covered | Confirmed. |
| S03-A02: organization as inventor gives the field error and keeps the answers | covered | Confirmed by the test and by code reading. |
| S03-A03: back and forward creates no extra sourceVersion | covered | Confirmed. An unchanged save writes no version. |
| S03-A04: a shared fact change bumps sourceVersion; A and B become `inputStale` | covered | Confirmed (G5, and the bindings keep the old version). |
| S03-A05: only adopted candidates enter the snapshot | covered | Confirmed by the test and by code reading. |
| S03-A06: a retained conflict without a reason is refused; with a reason it is `retained` | covered | Confirmed (G4). |
| S03 line 25: `VERSION_CONFLICT` with a side-by-side merge (cited by the ticket through S03) | not listed as a row | **Not met for the concurrent case** (B3). Met only for the sequential stale-base case. |
| S03-A07 / A08 / A09 | not_applicable | Legitimate. The reasons are mislabeled (N6). |
| Scope rule | pass | 30 = 30. All paths are inside the write set. |
| Activity metadata allowlist | pass | `{version, count}` only. No answer text. |
| Mount instructions | non-blocking item resolved | They apply to the PR-branch `V6App.tsx`, and tsc exits 0 (P6). |
