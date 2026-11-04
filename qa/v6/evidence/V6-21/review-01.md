VERDICT: CHANGES_REQUIRED

## Blockers

1. **The inbox does not use the shared `nextAction` result.** The list calls `nextAction` in `matters.ts` when constructing target rows and choosing the matter action. `inbox.ts` never imports it or reads `targetRows[].nextAction`; `deriveMatterInbox` builds its `actionKind` values independently from raw conditions. `readMatterContext` computes `nextAction` as a side effect of building `targetRows`, but the inbox consumes `targetActions` instead, so that result is discarded. This also makes receipt limitation 287 (“shared by list and inbox”) inaccurate.

   **Reproduction:** Trace `listMatterRows` → `readMatterContext` → `targetRows[].nextAction`, then trace `loadInbox` → `deriveMatterInbox`. The latter uses `context.targetActions` and hand-sets actions at `inbox.ts:107-149, 247-285`; it never reads the result computed at `matters.ts:244-253`. The list and inbox therefore do not share the specified projection. Change the wiring or correct the implementation and receipt so the required shared function is actually used.

2. **A deletion-pending matter makes both full views fail.** `LocalRepository.listMatters` includes owned matters regardless of status. `readMatterContext` then returns `RESOURCE_NOT_FOUND` for `deletion_pending`, and both `listMatterRows` and `loadInbox` abort the whole read on that error. One pending deletion therefore hides every otherwise readable matter and inbox item. The list filters only define active and archived states, so the hidden status should not turn the whole list into a failed read.

   **Reproduction:** In the V6-21 memory repository, create a matter, set its stored `matter.status` to `deletion_pending`, then call `listMatterRows(repository, ACTOR)` and `loadInbox(repository, ACTOR)`. Both return `{ ok: false, error: { code: "RESOURCE_NOT_FOUND" } }`. The setup and results were reproduced during this review. Skip or otherwise safely handle deletion-pending rows when deriving the list and inbox.

3. **A successful local parse job remains open with no path to resolution.** The existing parser writes successful parse jobs with `state: "succeeded"` and `disposition: "ready"` (`features/sources/parse.ts:1824-1829`), and the parser has no adoption transition for parse results. Inbox resolution currently accepts only cancelled jobs or succeeded jobs whose disposition is adopted/discarded (`inbox.ts:205-210`). A completed parse therefore remains an open inbox item indefinitely.

   **Reproduction:** Store a `kind: "parse.job"` envelope with a job matching the parser's successful terminal state (`kind: "parse"`, `state: "succeeded"`, `disposition: "ready"`, accessible matter and tenant), then call `loadInbox`. It returns a `job` item with `state: "open"` and `actionKind: "open_job"`. This review reproduced that result with a synthetic repository record. Resolve parse jobs according to their own terminal lifecycle, or provide and test a real action that can resolve them.

4. **The S06 acceptance mapping overstates what was verified.**

   - `S06-A04` is marked covered, but its GWT requires a review item to stay open after read until review feedback is processed. V6-21 test 4 uses a fact-conflict item; no scenario writes a review or review-feedback record. The review derivation branch is consequently unverified even though the receipt claims the full acceptance is covered.
   - `S06-A05` is marked covered, but the listed tests exercise inbox access only. S06-A05 also requires the inaccessible matter's activity to be absent and direct activity access to return 404. The candidate does not implement or exercise an activity view/query in this ticket. Record the inbox portion as verified and the activity portion as outside this candidate's coverage instead of marking the full GWT covered.

   **Reproduction:** Run `npm run test:v6 -- V6-21` and inspect test 4 and test 5 in `runner.tap`, or inspect `scenarios/V6-21/inbox.test.mjs:89-124`: test 4 resolves a conflict and test 5 checks inbox lookup; neither creates review feedback nor requests activity. Update the receipt mapping or add the missing synthetic review and activity-access evidence where within the authorized scope.

## Non-blocking notes

- The `nextAction` pure function itself matches all 11 S06 rungs. The table order and professional/self-service conditions match the spec, and the additional priority probes in this review passed, including conflict over stale input, missing draft over stale input, and each earlier rung over the next. The list sort, page size 25, title-only search, status/route/action filters, focus/60-second refresh logic, no-demo empty states, and create/rename/archive version paths are consistent with the inspected code and passing scenarios.
- Inbox derivation includes all seven specified kinds and the six specified groups. Confirmed deadlines enter with a derived due time; suggested deadlines are omitted. Read state is keyed per actor and does not change the matter version or underlying conflict. Action paths carry matter/target and resource context. No-access inbox reads are hidden by the repository access rule.
- S06-A03 and S06-A06 are marked `not_applicable` with explicit reasons; the receipt does not claim approval-revocation behavior or generated-job adoption/model activity. The review/service/check producer limitations are disclosed. The activity-whitelist gap for unarchive is also disclosed (twice, redundantly): no `matter.unarchived` action exists, so the explicit transition writes no event/blob.
- The authorized `repository.ts` diff adds only `unarchiveMatter`. It checks actor ownership, expected version and archived status; increments the matter version once; preserves targets/assets; writes no event/blob; and leaves the ordinary archived `commit` refusal unchanged. The V6-21 scenarios cover these properties and a subsequent commit after unarchive.
- Receipt `changedFiles` matches `scope.txt` after excluding `node_modules`: 40 paths. The worktree contains only the authorized feature directories, repository change, QA scenarios/evidence, and the excluded `node_modules` entry. The two restored mount files recompute to the recorded original/reverted hashes. The transient mounted hashes are recorded but cannot be independently recomputed from retained mounted-source snapshots.
- Inspected browser log and screenshots report 6/6 steps, no console errors, and no non-local requests. The browser evidence is a temporary route mount, with restoration documented. Inspected regression evidence reports V6-08 12/12, V6-10 36/36, V6-14 41/41, V6-15 41/41, worker 15/15, and export 44/44.

## What I ran

- `npm --prefix /private/tmp/patent-v6-21-worktree run test:v6 -- V6-21` — exit 0; 25 passed, 0 failed, 0 skipped.
- `npm --prefix /private/tmp/patent-v6-21-worktree run test:v6 -- V6-06` — exit 0; 25 passed, 0 failed, 0 skipped.
- `npm --prefix /private/tmp/patent-v6-21-worktree/apps/web run typecheck` — exit 0 (`tsc --noEmit`).
- Read-only Node probes for `nextAction` priority interactions, deletion-pending list/inbox behavior, and successful parse-job resolution behavior.
- Inspected the recorded browser run/log/screenshots, regression outputs, scope, receipt, and mount-restore hashes. I did not run a build.
