VERDICT: CHANGES_REQUIRED

# V6-20 independent acceptance review — round 2

## Blockers

1. **The declared V6-18 dependency is still unaccepted.** V6-20 lists V6-18 as a dependency in `tickets/V6-20.md` and in its receipt. The V6-20 receipt records V6-18 as `candidate`; `qa/v6/evidence/V6-18/receipt.json` also remains `candidate` with `review.verdict: pending_re_review`, and there is no V6-18 independent review artifact in its evidence directory. `06-execution-protocol.md` §1 requires dependencies to pass independent acceptance before a dependent ticket is dispatched. V6-20 uses the revision reader for its preview path, so the outstanding dependency gate prevents this ticket from being marked accepted under the stated protocol.

   **Reproduction:** read `qa/v6/evidence/V6-20/receipt.json` at `dependencies[1]`, then `qa/v6/evidence/V6-18/receipt.json` at its `status` and `review` fields. Both show that V6-18 has not passed independent review. **Required:** independently accept V6-18 and update its receipt/dependency status, or record an explicit coordinator disposition for this prerequisite, then repeat the V6-20 acceptance decision.

## Round 1 findings rechecked

- **B1, locked excerpt redaction:** An independent projection probe used a locked embodiments body with separate 8+ character fragments in the risk title and explanation, plus a locked `SourceRef.quote`. The DTO omitted the body and both fragments, generalized both locked risk fields, and preserved the unlocked risk title and explanation. The browser driver checks both quote fragments in the rendered preview; the inspected risk screenshot shows generalized copy.
- **B2, revoked full-read replay:** An independent domain probe confirmed that a live repeat returns `created: false` and the same id. After revocation, `currentConfirmations` is empty and the export gate returns `CONFIRMATION_REQUIRED` for `full_read`. Retrying creates a different id, makes that row the sole live confirmation, and allows the export gate. The V6-20 scenario also verifies that a freshly loaded preview has no confirmation after revocation and shows the replacement row after retry; the UI's confirmed label is conditional on that loaded live row.
- **B3, complete input staleness:** An independent in-memory LocalRepository probe confirmed an unchanged full input is current with `inputStale: false`. With `sourceVersion` held at 1, changing `targetConfigVersion` and then `figureRevisionId` each set `inputStale: true` and make the snapshot non-current. Both conditions enter the same UI branch that renders regenerate and adopt-input actions; the inspected browser evidence shows those actions for the source-stale case.
- **B4, S05 mapping:** `S05-A01` is `not_applicable` with an R2/cloud scope explanation; `S05-A02` and `S05-A09` are `covered`; `S05-A03` through `S05-A08` are `not_applicable` with reasons matching the preview-only scope.

No additional V6-20 implementation blocker was reproduced.

## Non-blocking notes

- Scope reconciles: the receipt and `scope.txt` each list the same 20 candidate files. The actual worktree list matches after excluding the root `node_modules` dependency symlink and the round 1 reviewer artifact. `confirmation.ts` is the sole changed file outside the feature and V6-20 scenario/evidence paths, and the receipt identifies it as the coordinator-authorized narrow V6-05 fix. No other out-of-scope file is changed.
- Recomputed hashes for `V6App.tsx`, `navigation.ts`, and `v6.css` match `mount-hashes.txt`.
- The evidence discloses that the preview is not registered in the shared app route, the browser harness uses an in-memory backend rather than native IndexedDB, and R2 content-projection endpoints are not implemented or verified here. It also records Node 25.8.1/npm 11.11.0 rather than the architecture's Node 22.
- I inspected the existing in-memory Vite build output and browser log/screenshots. I did not run a build or rerun the browser harness. The recorded browser evidence reports zero external requests and zero console errors. No `.dev.vars` file was read; no real provider or external network call was made.

## What I ran

- `npm run test:v6 -- V6-20` — exit 0; 9 passed, 0 failed, 0 skipped.
- `npm run typecheck` from `apps/web` — exit 0 (`tsc --noEmit`).
- Regressions, each exit 0 with no skipped tests: V6-05 26/26, V6-08 12/12, V6-10 36/36, V6-14 41/41, V6-15 41/41, V6-16 14/14, V6-17 37/37, V6-18 7/7.
- Ran inline read-only probes for B1 DTO redaction, B2 live/revoked confirmation behavior and export gating, and B3 complete `DraftInputRef` staleness. The probes used synthetic data and an in-memory backend.
- Inspected the V6-20 receipt, scope, regression and typecheck evidence, build output, browser driver/log/screenshots, V6-05 confirmation ledger, and V6-18 revision adapter. Recomputed the three mount hashes and checked the final worktree scope.
