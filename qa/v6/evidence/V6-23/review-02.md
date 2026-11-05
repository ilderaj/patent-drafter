VERDICT: CHANGES_REQUIRED

# V6-23 round 2 independent acceptance review

## Blockers

1. **V6-18 is still an unaccepted prerequisite.** The V6-23 receipt now describes it accurately as a candidate at `73a70df` (`qa/v6/evidence/V6-23/receipt.json`, dependencies, lines 23–34). The referenced V6-18 receipt still has `status: candidate`, `review.verdict: pending_re_review`, and `review.evidence: null` (`qa/v6/evidence/V6-18/receipt.json`, lines 326–330). Its expected `review-01.md` is absent. This reproduces the unresolved prerequisite by comparing those receipt fields; the code and tests do not establish an accepted review state. Execution protocol §1 requires dependencies to pass independent review before dispatch. The V6-23 wording is now honest, but V6-23 cannot be accepted until V6-18 has accepted review evidence and this dependency is revalidated.

## Non-blocking notes

- The round-1 stale-policy behavior is fixed. An independent synthetic pack with `policy.duplicate.synthetic` at `old-v1` declaring `export` and the same ID at `active-v2` declaring `prepare` produced one finding from the active rule. Its displayed title and basis came from `active-v2`; `blockingPolicyRuleIds` had no export ID and included the ID for prepare. `evaluateGate(export)` allowed and `evaluateGate(prepare)` blocked. Reversing old/active row order gave the same result. A duplicate ID within the active version also used one effective row consistently for its finding and blocking IDs.
- S07 legal handling matches the closed G-RULES boundary: non-engineering rules become `unverified`, and the gate skips unverified findings. Engineering blocker findings remain blockers. Engineering policy findings are labelled `产品规则` and gate only the declared action. No-current-check is represented by gate reason `CHECK_REQUIRED`; it is not emitted as a finding. A failed check shows an error and retry and is not rendered as an empty clean result.
- Determinism and staleness checks passed. Repeating a run with the same input, pack, and time produces equal output without input mutation. Snapshot or active-pack version changes stale a prior run. Risk acknowledgements are bound to the check run; rerun findings reopen. Failed reruns retain the previous result while showing the failure.
- Rule-pack handling is consistent with the receipt: the five checked-in sources contain 28 rows; the two repeated IDs overlay to 26 unique rules, bound to the active version. The active-rule map filters by pack version before both finding evaluation and policy-ID collection. G-RULES remains closed, including the mixed AI-INV-002 entry; this does not claim line-by-line official legal verification.
- S07-A06 is honestly `not_applicable` for the export-manifest observable, and S07-A08 is honestly `not_applicable` for preview-page integration. The check panel's `未检索` label and failure/retry behavior are covered, but those wider observables are outside this ticket's write set. The standalone harness does not establish app-route integration.
- Scope reconciles: the 26 listed candidate files match `scope.txt`; the only additional porcelain entry is the excluded `node_modules` symlink. Candidate files are confined to the checks feature, `packages/domain/src/v6/checks.ts`, and V6-23 scenario/evidence paths. The three mount-file SHA-256 values match base `73a70df`. This review adds only `qa/v6/evidence/V6-23/review-02.md` within the authorized evidence directory.
- Inspected `build.txt`, browser driver/log/mount, and all four screenshots. The captured browser run reports 7/7 steps, zero console errors, and zero external requests. The existing build evidence reports success with the repository's chunk-size warning; I did not run the build. The evidence accurately records that the component was tested in a standalone synthetic harness, without real provider calls or prior-art search. Node 22 remains unverified; the recorded runtime is Node 25.8.1.

## What I ran

- `npm run test:v6 -- V6-23` — exit 0; 12 passed, 0 failed, 0 skipped.
- `./node_modules/.bin/tsc -p apps/web/tsconfig.json --noEmit` — exit 0.
- Regression suites — each exit 0, 0 failed, 0 skipped: V6-18 (7), V6-17 (37), V6-16 (14), V6-15 (41), V6-14 (41), V6-12 (42), V6-10 (36), V6-08 (12), and V6-05 (26).
- Ran independent inline Node probes for stale and active policy rows, gate decisions, row ordering, and duplicate active IDs.
- Inspected the existing build and browser evidence; did not run a build or make network/provider calls. Did not read `.dev.vars` or modify files outside the authorized V6-23 evidence path.
