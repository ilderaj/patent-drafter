VERDICT: ACCEPT

# V6-20 independent acceptance review — round 3

## Dependency revalidation

The round 2 blocker is resolved at the integration merge. `qa/v6/evidence/V6-18/receipt.json` now reports `status: "accepted"` and lists `review-04.md`; that review has first line `VERDICT: ACCEPT`. Commit `e9c14f9` is an ancestor of the current V6-20 worktree HEAD (`2e20573`), which merges the accepted V6-18 integration into `codex/v6-20-preview`. The V6-20 receipt records this as `dependencyStatus` but its structured `dependencies` entry for V6-18 still says `candidate`; that stale field is non-blocking, because the acceptance evidence and merged commit are present and independently verified.

## No V6-20 code changed in the merge

`git log` over the V6-20 projection, component, scenario, and confirmation paths shows their last change remains `e6acd66` (the reviewed candidate). The merge `e9c14f9` changes only V6-18 editor/adapter/generation files, V6-18 evidence, and planning records. The only current worktree modification is the V6-20 receipt's dependency/review note; the root `node_modules` mount remains excluded. Changes since the candidate commit are therefore outside the V6-20 implementation and do not alter the reviewed behavior.

## Rechecked results on the merged tree

- `npm run test:v6 -- V6-20` — exit 0; 9 passed, 0 failed, 0 skipped.
- `npm run typecheck` in `apps/web` — exit 0 (`tsc --noEmit`).
- `npm run test:v6 -- V6-18` — exit 0; 10 passed, 0 failed, 0 skipped, matching the accepted V6-18 receipt and `review-04.md`.
- Regressions on the merged tree, each exit 0 with no skipped tests: V6-05 26/26, V6-08 12/12, V6-10 36/36, V6-14 41/41, V6-15 41/41, V6-16 14/14, V6-17 37/37.
- V6-20 scenario assertions still cover locked-body redaction from preview DTO/UI, no full-read from preview access, live full-read replay without a duplicate, revoked-row exclusion from the confirmed state with a new live row on retry, and `inputStale` for source, target-config, and figure-input changes. No new failure was reproduced.

## Previously accepted findings and limitations

The round 2 acceptance findings (B1–B4 fixes, scope reconciliation, mount hashes, and the disclosed limitations) remain valid because the reviewed V6-20 files are unchanged. The browser evidence remains a direct component mount over an in-memory backend; the preview is not registered in the shared application route, and native IndexedDB/R2 cloud paths remain unverified. The receipt discloses these limitations. No `.dev.vars` file was read; no real provider, external network call, deployment, payment, or customer material was used.

## Non-blocking note

Update the structured `dependencies[V6-18].status` from `candidate` to `accepted` when the receipt is next edited, so the field agrees with the dependency status prose. This does not change the acceptance decision.
