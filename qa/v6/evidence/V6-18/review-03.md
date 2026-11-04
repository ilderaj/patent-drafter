VERDICT: CHANGES_REQUIRED

## Blockers

1. **The recorded V6-18 test evidence is stale.** From `/private/tmp/patent-v6-18-worktree`, `npm run test:v6 -- V6-18` exits 0 with 11 passed, 0 failed, and 0 skipped. The checked-in `runner.tap` and `receipt.json` report 10 passed. This does not meet the requested 10/10 evidence as recorded and makes the receipt disagree with the current suite.

   **Reproduction:** Run `npm run test:v6 -- V6-18`. TAP ends with `# tests 11`, `# pass 11`, `# skipped 0`; `qa/v6/evidence/V6-18/runner.tap` ends with `# tests 10`, `# pass 10`. Reconcile the suite count and refresh `runner.tap` and the V6-18 run entry in `receipt.json` so they match the accepted 10-test requirement and the actual candidate.

## Non-blocking notes

- **Independent save-race probes passed** using a separate in-memory repository and my own paused revision store. I edited to A, paused the save, edited to B, then released it. The first saved head contained A; the session model and active buffer contained B, `dirty` stayed true, and the buffer base moved to the saved revision. A subsequent save persisted B. Editing from A to B and back to A during the pause left the session clean and cleared its active buffer. Returning a synthetic save failure preserved B in the model and buffer, kept `dirty=true`, reset `saving=false`, and left the head unchanged.
- The component disables title, claim, dependency, paragraph, insert, delete, save, and refresh controls while `state.saving` is true. The session still preserves a concurrent model update if one reaches it.
- Round-one fixes remain present. The editor passes its base input and figure revision to the V6-17 seam; the seam compares matter/target/source/config/figure references before saving and rechecks changed input after a repository version conflict. The V6-18 suite's source/config/figure interleavings pass without moving the head or adding a revision/event. Claim-number-gap mapping identifies claim 2, and the recorded browser log's active element matches its expected claim 2 node.
- Core editor scenarios passed: paragraph IDs are retained across edits; `ai` edits become `mixed`; insert/delete operate on copied models; `VERSION_CONFLICT` retains the local buffer and presents both revisions for manual merge; reload restores buffered edits; and repeated save adds no duplicate revision event.
- The receipt and scope inventory match at 16 included paths: 14 candidate code/evidence paths plus the reviewer-authored `review-01.md` and `review-02.md`. `node_modules` is listed in `scope.txt` and excluded by the receipt. `typecheck.txt` is tracked and unchanged, so it is correctly referenced as run evidence without appearing in the changed-file inventory. The report written in this round is reviewer-authored and is not a candidate change.
- The V6-18 changes are confined to `features/draft`, the authorized revision seam in `features/generation/generation.ts`, and V6-18 scenarios/evidence. The recorded S05 mapping marks A03, A04, and A08 covered and explains why the remaining S05 behaviors are outside this editor ticket. The receipt accurately calls out the standalone component mount, missing route registration, Node 25 instead of specified Node 22, and omitted restore/adoption/preview flows.
- I inspected the recorded build output and did not run the build. It records exit 0 and Vite's chunk-size warning. The browser log records five passing steps, no console errors, and no external requests; the loaded and saved screenshots match the browser step order and revision IDs. The V6App and navigation hashes match the recorded base commit.

## What I ran

- `npm run test:v6 -- V6-18`: exit 0; 11 passed, 0 failed, 0 skipped. This conflicts with the required and recorded 10/10 count.
- `./node_modules/.bin/tsc -p apps/web/tsconfig.json --noEmit`: exit 0.
- Re-ran V6-17, V6-16, V6-15, V6-14, V6-10, and V6-08: exit 0 with 37, 14, 41, 41, 36, and 12 passed, respectively; all had 0 skipped.
- Ran the independent paused-store probes for A/B save, revert-to-A, and save failure described above.
- Ran `git diff --check`: exit 0. Inspected the receipt, scope, S05 mapping, source changes, runner/regression/build/browser evidence, screenshots, and mount hashes. I did not run the build or browser driver, read `.dev.vars`, or make provider/network calls.
