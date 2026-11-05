VERDICT: CHANGES_REQUIRED

## Blocker

**A rejected storage read during revocation bypasses the UI error notice.** `revokeParagraphConfirmation` performs a direct read-only backend transaction to load the ledger without a `try/catch` (`Review.tsx`, around lines 214–253). The `revoke` helper catches returned `{ ok: false }` values only; it awaits `props.onRevoke` without catching a rejected promise (`Review.tsx`, around lines 464–468). Its caller discards that promise (`Review.tsx`, around line 615). The IndexedDB adapter rejects its transaction promise on abort/error (`indexeddb-repository.ts`, around lines 112–149).

Reproduction with the V6-19 fixture:

1. Load a session and confirm an AI paragraph.
2. Make the backend reject the second read-only transaction in `revokeParagraphConfirmation` with `synthetic readonly transaction failure`.
3. Call `revokeParagraphConfirmation` with the confirmation id and a reason.

Observed: the method rejects with the raw exception instead of returning a `DraftReviewAction` failure. The matter version, event count and revocation ledger remain unchanged. Since the panel's helper has no `catch`, this rejection does not render `draft-review-revoke-error` and becomes an unhandled event-handler rejection. The recorded browser evidence verifies the returned `ACTION_FORBIDDEN` path, which works; it does not cover a rejected transaction. Catch storage exceptions in the session and return an action error, and/or guard the UI helper against rejected callbacks.

## Verified in round three

- Historical revocation succeeds. I independently confirmed an r1 AI paragraph, saved r2, then revoked the r1 confirmation. The matter version advanced from 2 → 3 on confirmation, 3 → 4 on saving r2, and 4 → 5 on revoking r1. The r1 Confirmation remains, one Revocation is appended, and one `confirmation.revoked` event is recorded with the historical SnapshotRef.
- Unknown confirmation id returns `RESOURCE_NOT_FOUND`; matter version and ledger remain unchanged. A mismatched event resource id against an appended revocation returns `INVALID_INPUT`; version, events and stored ledger remain unchanged.
- Current-snapshot revocation succeeds, appends one event, and bumps the matter version once.
- Source ownership, altered chunk text/hash, and stale sourceVersion probes remain rejected with `chunkText: null`. Confirmation eligibility, sequential idempotency, append-only history, and C03 rollback checks pass.
- The recorded browser log reports 6/6 steps, including active DOM focus for source, claim and risk; visible `ACTION_FORBIDDEN` revoke error; zero console errors; and zero external requests. I inspected the browser log, driver and screenshots but did not run the browser or build, in keeping with the no-network/build constraint.
- S05-A03 is covered through the V6-17 revision seam; the other S05 entries have scope-consistent not-applicable reasons. The remaining reconfirm-after-revocation `NEEDS_DECISION` is documented and reflected in the UI. Node 22 remains unavailable; Node 25.8.1 was used in recorded checks.
- All 22 receipt paths match the 22 included scope paths; `node_modules` is excluded. The only shared changes are the coordinator-authorized `repository.ts` and `vite.config.ts`. Mount/shared-file hashes match the receipt, and the shared Vite cache's current mtime equals the recorded before/after mtime. The receipt remains accurate for its candidate set; this review artifact is the additional file written for round three.

## What I ran

- `npm run test:v6 -- V6-19`: 14 passed, 0 failed, 0 skipped, exit 0.
- Re-ran V6-18 (7), V6-17 (37), V6-16 (14), V6-15 (41), V6-14 (41), V6-10 (36), V6-08 (12), and V6-05 (26): all passed with no skips and exit 0.
- `./node_modules/.bin/tsc -p apps/web/tsconfig.json --noEmit`: exit 0.
- `npm test --workspaces --if-present`: 15 worker tests and 44 export checks passed; 0 failures.
- Independently reproduced historical revocation, unknown/mismatched id refusal, current revocation, and the rejected-read failure above. Inspected the recorded build/browser evidence and verified receipt/scope and cache hashes; did not run the build or browser. No external provider/network calls were made, and `.dev.vars` was not read.
