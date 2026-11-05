VERDICT: CHANGES_REQUIRED

## Blocker

**A rejected initial matter-version read is misreported as `RESOURCE_NOT_FOUND`, not `STORAGE_UNAVAILABLE`.** `revokeParagraphConfirmation` wraps the flow in `try/catch`, but first calls `currentMatterVersion`. That helper converts every failed `repository.loadMatter` result to `null` (`Review.tsx`, around lines 214–218 and 799–802). The caller interprets `null` as “案件不可用” and returns `RESOURCE_NOT_FOUND`, so this storage failure never reaches the catch that returns `STORAGE_UNAVAILABLE`.

Reproduction with the V6-19 fixture:

1. Load a review session and confirm an AI paragraph.
2. Arm the backend to reject its first subsequent read-only transaction with `synthetic matter-version read failure`.
3. Call `revokeParagraphConfirmation` for the confirmation id.

Observed: the method returns `{ok:false, error:{code:"RESOURCE_NOT_FOUND", message:"案件不可用。"}}`; matter version and revocation count remain unchanged. The same fault makes `repository.loadMatter` return `STORAGE_UNAVAILABLE`, confirming the error code is lost by `currentMatterVersion`. The view does render an error alert for this returned failure, so there is no unhandled rejection, but it presents storage failure as a missing matter. Propagate the repository error from the version read (or distinguish unavailable from not found) so the revoke handler returns `STORAGE_UNAVAILABLE` and the UI displays the accurate retry guidance.

## Verified in round four

- The rejected ledger-read path now returns `STORAGE_UNAVAILABLE`, with no unhandled rejection and no changes to matter version, events or revocations. The V6-19 scenario test also asserts those conditions.
- A rejected `onRevoke` callback is caught by the view helper and rendered as a `role="alert"` with `data-code="STORAGE_UNAVAILABLE"`. The supplied browser evidence exercised this path, alongside the returned `ACTION_FORBIDDEN` error, source/claim/risk focus, and zero console errors or external requests. I independently reran the local browser harness using `/private/tmp/v6-19-vite-cache`, writing its output outside the evidence directory. It reported all 7 steps successful, no console errors/external requests, and the shared optimizer cache mtime unchanged.
- Historical confirmation revocation after a new revision, unknown/mismatched ID refusal, current revocation, locator integrity, C03 event/version writes, idempotency, and revision invalidation remain covered by the previously reviewed scenario suite. Round-four suite count is 15/15 with zero skips.
- The 24 receipt files matched the 24 scope entries before this review artifact was written; `node_modules` is explicitly excluded. The authorized shared changes remain `repository.ts` and `vite.config.ts`; shared mount hashes match the receipt, and cache isolation evidence still matches current cache state. The added `review-04.md` is this independent review artifact and is not in the candidate's 24-file receipt. Node 22 remains unverified; recorded build used Node 25.8.1 and the existing >500 kB chunk warning.
- S05-A03 remains covered; other S05 items are marked not applicable with scope-consistent reasons. The unresolved decision about attempting confirmation again on the same snapshot after revocation remains explicitly documented; UI does not silently re-confirm.

## What I ran

- `npm run test:v6 -- V6-19`: 15 passed, 0 failed, 0 skipped, exit 0.
- Re-ran V6-18 (7), V6-17 (37), V6-16 (14), V6-15 (41), V6-14 (41), V6-10 (36), V6-08 (12), and V6-05 (26): all passed with no skips and exit 0.
- `./node_modules/.bin/tsc -p apps/web/tsconfig.json --noEmit`: exit 0.
- `npm test --workspaces --if-present`: 15 worker tests and 44 export checks passed; 0 failures.
- Independently injected failures at the initial matter read and ledger read, confirmed current/past revocation behavior in the prior probe round, and exercised the local synthetic browser flow for returned and rejected callback errors. Inspected receipt, scope, browser log, screenshots, typecheck and recorded build evidence. Did not run the build; used no external provider calls; `.dev.vars` was not read.
