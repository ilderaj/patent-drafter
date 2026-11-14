VERDICT: CHANGES_REQUIRED

## Blocker

**An older confirmation cannot be revoked after a new revision is saved, despite the UI offering the action.** The confirmation is transitioned to a revocation, but `DraftReviewSession` builds the `confirmation.revoked` event with the old confirmation's SnapshotRef (`Review.tsx`, around lines 241–252). `LocalRepository.writeConfirmationLedger` rejects any event whose SnapshotRef is no longer current (`repository.ts`, around lines 755–761). The user sees no action error because the view discards the `onRevoke` result; the old row remains unrevoked and the control remains available.

Reproduction with the V6-19 fixture:

1. Load a review session and confirm an AI paragraph on revision r1.
2. Edit and save a new revision r2 while preserving the paragraph id; refresh the review session.
3. Call `revokeParagraphConfirmation` with the r1 confirmation id and a non-empty reason.

Observed: `ok: false`, error `INVALID_TRANSITION` (“confirmation event snapshot is not current”), and the ledger still has zero revocations. The `ConfirmationHistory` view offers revoke for every non-revoked record, including historical confirmations. The §4 revoke contract says revocation appends a Revocation and does not restrict it to current snapshots. Add a historical-revocation path or hide/disable the unavailable action with a clear explanation.

## Non-blocking findings

- The round-one locator failures are fixed. Independent fixture probes now return `unlocatable` with `chunkText: null` for a foreign source row, chunk text changed while retaining its old hash, and a revision whose sourceVersion is stale. Existing checks also cover missing chunks, changed ref hash/quote/offset/source, and retirement. The original quote remains in the unlocatable UI.
- C03 confirmation persistence is fixed. The independent probe observed matter version 2 → 3 on confirmation and 3 → 4 on revocation, with one event for each. Repeating a completed confirmation returns `created: false` and does not bump the version. A human paragraph is rejected; same-revision retry after revocation does not create a second confirmation, and the UI explains that a new revision is required.
- A concurrent duplicate confirmation probe produced one successful creation and one `VERSION_CONFLICT`; the ledger and event store each contained one record and the matter version advanced once. This leaves no duplicate side effect, though the racing caller does not receive the sequential retry's `created: false` result.
- The recorded browser flow asserts `document.activeElement` for the source chunk, claim article and risk anchor. Its log reports 5/5 steps, zero console errors, zero external requests, and the isolated Vite cache. I inspected the log, driver, mount and screenshots but did not rerun the browser; the supplied browser harness is a synthetic standalone mount, without V6App/navigation or native IndexedDB integration.
- S05-A03 is covered through the V6-17 revision seam. The remaining S05 items are marked not applicable with reasons consistent with the professional review panel scope. The earlier C03 persistence question is resolved by the new repository method; the remaining decision about confirming again on the same snapshot after revocation is a real V6-05 contract question and is disclosed in the UI/receipt.
- The 20 receipt files match the 20 included scope entries; `node_modules` is the excluded symlink. The only tracked modifications are the two coordinator-authorized files, `repository.ts` and `vite.config.ts`. The V6App/navigation/style mount hashes match the receipt, and the base/final hashes for the authorized files match the recorded values. The shared optimizer cache's current mtime matches the recorded before/after value, and `/private/tmp/v6-19-vite-cache` exists. Node 22 remains unverified; the recorded build uses Node 25.8.1 and reports the existing large-chunk warning.

## What I ran

- `npm run test:v6 -- V6-19`: 11 passed, 0 failed, 0 skipped, exit 0.
- Re-ran V6-18 (7), V6-17 (37), V6-16 (14), V6-15 (41), V6-14 (41), V6-10 (36), V6-08 (12), and V6-05 (26): all passed with no skips and exit 0.
- `./node_modules/.bin/tsc -p apps/web/tsconfig.json --noEmit`: exit 0.
- `npm test --workspaces --if-present`: 15 worker tests and 44 export checks passed; 0 failures.
- Independently repeated source ownership, mutated chunk hash/text, stale sourceVersion, C03 version/event, human-paragraph, sequential retry, and post-revocation retry probes. I also probed a concurrent duplicate and revocation of a historical confirmation as described above.
- Checked receipt/scope membership, Git status and mount/shared-cache hashes. Inspected recorded browser/build evidence; did not run the build or browser and made no external network/provider calls. `.dev.vars` was not read.
