VERDICT: NOT_ACCEPT

# V6-13 independent acceptance review 01

- Candidate: `/private/tmp/patent-v6-13-worktree` (branch `codex/v6-13-intake`, base `953e05d`, candidate files untracked)
- Reviewed: `apps/web/src/v6/features/intake/intake.ts`, `Intake.tsx`, `qa/v6/scenarios/V6-13/*`, `qa/v6/evidence/V6-13/*`
- Specs: `tickets/V6-13.md`, `06-execution-protocol.md`, `specs/S03.md`, `05-contracts.md` sections 2, 3, 6/7 and 10
- Probes: `/tmp/v613-review/probe-01..05*.mjs`. Each probe imports the real candidate modules and the V6-13 harness. Nothing in either worktree was edited.

## 1. Commands and exit codes

| Command | Result | Exit |
|---|---|---|
| `npm --prefix /private/tmp/patent-v6-13-worktree run test:v6 -- V6-13` | 20/20 pass | 0 |
| `npm --prefix /private/tmp/patent-v6-13-worktree run test:v6 -- V6-10` | 36/36 pass | 0 |
| `npm --prefix /private/tmp/patent-v6-13-worktree run test:v6 -- V6-11` | 53/53 pass | 0 |
| `./node_modules/.bin/tsc -p apps/web/tsconfig.json --noEmit` (from the candidate worktree) | no errors | 0 |
| `/usr/bin/git -C ... status --porcelain --untracked-files=all` (scope probe 05) | 25 paths | 0 |
| `grep -rn -e "features/intake" apps/web/src` outside the feature dir | no matches (Intake is not mounted) | 1 (no match) |

These results match `typecheck.txt` and `regression.txt` in the evidence folder.

## 2. Probes and results

### P1/P2: post-commit snapshot failure, then reload (`probe-01`, `probe-02`)
1. Save v2 succeeds.
2. A put fault on `blobs` keys `intake/snapshot/*` is injected. The save at base 2 returns `{"ok":false,"errorCode":"STORAGE_UNAVAILABLE","committedVersion":3}`. So the matter row and the `snapshot.created` event commit, but the snapshot blob does not.
3. A fresh repository on the same backend (a reload) runs `readIntake`, which returns `{"ok":false,"errorCode":"STORAGE_UNAVAILABLE"}`.
4. The real `IntakePanel` (esbuild bundle, same as the UI suite) renders with the props that the `Intake` hook produces after that read: `load.phase="failed"`, `view=null`. Result: `data-state="error"`, no save button (`intake-save` absent), no question form, only `intake-retry-load`. The message is "本机存储暂时不可用，内容没有保存。"
5. An engine-level save at base 3 succeeds (version 4). So the data can be recovered, but only through the engine. The UI cannot reach that path after a reload.

### P3: isolation, concurrency (`probe-03`)
- Other tenant: read/save/stage all `RESOURCE_NOT_FOUND`. Same tenant, other user: all `RESOURCE_NOT_FOUND`. Pass.
- Two concurrent saves at base 1: exactly one success (v2) and one `VERSION_CONFLICT` with `latest` filled in. The read afterwards shows v2 with the winner's text. There is exactly one `snapshot.created` event. Pass.

### P4: disclosure evidence refs and conflict preservation (`probe-04`)
- (a) A `disclosureDetail.evidenceRefs` entry has the real chunkId/chunkHash but a quote that is not in the chunk ("不存在的证据文字"). The save returns `ok:true`, and the forged ref is persisted verbatim. On read, the disclosure question shows `sourceChanged: false`. FAIL (see B2).
- (c1) The same ref used as a question source returns `SOURCE_LOCATOR_INVALID`. (c2) The same ref used as a fact ref returns `SOURCE_LOCATOR_INVALID`. So the validator exists but is not applied to evidenceRefs.
- (b) A resolved conflict saves as v2. Both facts are preserved, `chosenFactIds` is recorded, and `conflictIds` appears on both facts. Pass: the conflict is preserved, not overwritten.

### P5: scope (`probe-05`)
- Git status (minus `node_modules` and `.claude/`) has 25 paths. Receipt `changedFiles` has 25. There are no differences in either direction, and no path is outside `apps/web/src/v6/features/intake/`, `qa/v6/scenarios/V6-13/`, `qa/v6/evidence/V6-13/`. Pass.
- Note: one early read of the receipt during this review showed 24 entries without `red-before-fix.mjs`. Every later read showed 25. The receipt may have been edited during the review. The current state passes.

### P6: mount patch (`mount-patch.md`)
- The literal diff block in `mount-patch.md` cannot be parsed as a patch: context lines have no leading space and the hunk counts are wrong. `patch`/`git apply` reports "corrupt patch".
- I built a valid equivalent of the described change with `diff -u` from copies in `/tmp/v613-review/base/`. It applies cleanly to base `953e05d` (exit 0). It fails on the PR branch `/private/tmp/patent-v6-worktree/apps/web/src/v6/routes/V6App.tsx` (exit 1). The reason: on that branch, V6-12 added `import { Figures } from "../features/sources/Figures.tsx";` between the Parse import and `openIndexedDbBackend`. The sources-tab branch also moved from line 386 to line 399.

### Other code checks
- Disclosure and maturity are never prefilled. The selects default to `""` with the label "请选择（不会自动填写）". The engine does not derive them from material. Pass.
- Required provenance: each answered question needs `direct`, `not_found` or a `source` ref that locates (chunk, hash, page, quote). `source_backed` facts need refs. Pass, except for evidenceRefs (B2).
- Fact versioning: every changed save increments `sourceVersion`. An unchanged payload, including provenance, does not. `isInputStale` compares matter, target, sourceVersion, targetConfigVersion and figureRevisionId. A draft bound at an older version reads as stale. Pass.
- Idempotency: same key and same payload replays with no second event or snapshot. Same key with a different payload returns `IDEMPOTENCY_CONFLICT`. A failed commit (fault before commit) rolls back, and a retry under the same key succeeds once. Pass.
- Activity metadata: `snapshot.created` carries only `{version, count}`. The repository allowlist (`snapshot.created: ["version","count"]`) enforces this. No text is included. Pass.
- Note: the idempotency lookup is keyed by `(matterId, requestKey)`. The contract scopes keys by `(tenantId, actorId, operation, key)`. This is safe in practice, because R1 restricts each matter to its owner, but it is narrower than the contract. Non-blocking.

## 3. Blockers

### B1. After a post-commit snapshot failure and a reload, the UI cannot recover
- Location: `intake.ts` `readIntake` (refuses with `STORAGE_UNAVAILABLE` when `envelope === null && matter.sourceVersion !== 1`). `Intake.tsx` `onSave` (gated on `view !== null`) and `IntakePanel` (the failed state renders only "重试", with no form and no save button). `recoveryBase` is an in-memory ref only.
- Failing scenario: save, then the snapshot blob write fails after commit (`committedVersion: 3`), then the user refreshes the page. From that point, every load returns `STORAGE_UNAVAILABLE`. The panel shows "内容没有保存" with only a retry button. Retry keeps failing, because the snapshot for v3 will never be written. The matter's intake is permanently unusable from the UI. The message is also wrong: v3 *was* committed (matter row and `snapshot.created` event exist).
- Spec basis: V6-13 A03, "completed/failed action: refresh or retry matches persisted state, no duplicate side effects". S03 UI error state. 06-execution-protocol requires reviewers to re-run offline and partial-write paths. The receipt documents this as a limitation ("a reload before retrying still shows the storage error"). But the ticket explicitly names refresh, so documenting it does not satisfy the row.
- Suggested fix (any of these):
  - (a) Write the snapshot, idempotency and candidate blobs in the same `repository.commit` transaction (the commit already accepts `blobs`), so a partial write cannot happen.
  - (b) On read, when the current version's envelope is missing, fall back to the newest available envelope. Return a view flagged `recoveryNeeded` with `sourceVersion` set to the committed version, so the form renders and a save at that base fills the gap.
  - (c) Persist the recovery base, not only in memory.
  - Add a test: post-commit failure, then `freshRepository`, then the panel renders a form, then a save succeeds.

### B2. `disclosureDetail.evidenceRefs` are not validated as SourceRefs
- Location: `intake.ts` `validateAnswersShape`. The only check is `if (!Array.isArray(detail.evidenceRefs))`. Neither `sourceRefProblem` nor `validateRefList` is applied. `readIntake` also does not compute staleness for them.
- Failing scenario: probe-04 (a). A ref whose quote does not exist in the chunk is saved, persisted, and read back as valid (`sourceChanged: false`). The identical ref is rejected as a question source or a fact ref.
- Spec basis: `05-contracts.md` section 3, "locating must verify chunkHash and quote; failure shows 来源已变化". S03 defines evidenceRefs as `SourceRef[]`. The ticket requires sources and provenance. Unverifiable evidence for a disclosure event is a provenance hole in exactly the field that matters for novelty risk.
- Suggested fix: run `validateRefList` on `evidenceRefs` in save. Return `SOURCE_LOCATOR_INVALID` with the field `answers.disclosureDetail.evidenceRefs[i]`. In read, flag stale evidence refs with `sourceChanged`. Add a red-before-fix test.

## 4. Non-blocking findings
1. `mount-patch.md` cannot be used as delivered. Its diff block is malformed (missing context-line spaces, wrong hunk counts), and the change it describes does not apply to the PR branch `V6App.tsx`, where the V6-12 `Figures` import and sources-tab layout differ. Mounting is outside the write set, but the integrator needs a correct patch. Regenerate it against the PR branch head (Figures import present, sources tab at line 399) and verify with `git apply --check`.
2. The idempotency scope is `(matterId, key)`, while the contract specifies `(tenantId, actorId, operation, key)`. This is currently harmless under R1. Align it when multi-user arrives.
3. Browser step 08 injected the target and draft binding directly into IndexedDB. The receipt discloses this, so it is acceptable for evidence, but the stale-draft path has no real-UI producer yet.
4. During the review, the receipt `changedFiles` changed from 24 to 25 entries (`red-before-fix.mjs` added). The final state is consistent. Freeze the receipt before requesting review.

## 5. Per-row receipt check

| Row | Receipt | Reviewer finding |
|---|---|---|
| V6-13-A01 leave/re-enter preserves answers and sources | covered | Confirmed. Engine and UI tests use a fresh repository. Browser reload preserved state. Tests would fail on lost provenance (red-before-fix G-series). |
| V6-13-A02 unanswered never auto-uses example disclosure; fact change stales draft | covered | Confirmed. No prefill in engine or UI. `isInputStale` is exercised. Stale UI state renders. |
| V6-13-A03 refresh/retry matches persisted state, no duplicate side effects | covered | **Not met.** Retry and idempotency are correct in-session. Refresh after a post-commit failure leaves the UI unable to proceed (B1). |
| S03-A01 five questions, sources shown | covered | Confirmed, except evidenceRefs provenance (B2). |
| S03-A02 inventor must be person; organization gives INVALID_INPUT | covered | Confirmed. |
| S03-A03 explicit not_found / direct, no fake attachments | covered | Confirmed. |
| S03-A04 candidates only on explicit adoption | covered | Confirmed. `stageCandidates` does not mutate the snapshot. |
| S03-A05 conflicts open/resolved/retained, preserved | covered | Confirmed (probe-04 b). The validator enforces state invariants. |
| S03-A06 sourceVersion CAS, VERSION_CONFLICT side-by-side | covered | Confirmed (probe-03 race, UI merge view with mine/latest columns). |
| S03-A07 / A08 / A09 | not_applicable | The reasons are honest. They depend on downstream tickets or server features outside V6-13's write set. I found no code that claims them. |
| Scope rule | pass | 25 = 25, all inside the write set. |
| Activity metadata allowlist | pass | Only `version` and `count`. Enforced by the repository. |
| Mount (temporary + restored) | claimed restored | Confirmed restored (no Intake import in `apps/web/src`). The patch is unusable on the PR branch (non-blocking 1). |
