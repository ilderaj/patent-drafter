VERDICT: CHANGES_REQUIRED

# V6-23 review 5: final evidence count check

## Blocker

1. **The refreshed per-suite counts are consistent, but the aggregate regression total is still the pre-refresh 230.** Reproduction:

   ```sh
   node -e 'console.log([10,37,14,41,41,42,36,12].reduce((a,b)=>a+b,0))'
   grep -n 'Regression volume' qa/v6/evidence/V6-23/regression.txt
   ```

   The V6-18 regression count is now 10 in the receipt, `regression-v6-18.tap`, and `regression.txt`. Summing the regression suites in `regression.txt` (V6-18 10, V6-17 37, V6-16 14, V6-15 41, V6-14 41, V6-12 42, V6-10 36, V6-08 12) gives **233**, not 230. Line 37 still says `Regression volume: 230 V6 tests plus 59 configured workspace checks`. The old 230 was the same sum with V6-18 counted as 7, so this is a stale aggregate left behind by the refresh. Update the aggregate to 233 regression tests (or 245 if the V6-23 acceptance suite is included and the wording says so). No source change is required.

## Non-blocking notes

- The previously blocking V6-18 evidence fields now agree: the dependency is accepted with review-04/merge `e9c14f9`; the receipt run entry, tap, and summary all record 10/10; `limitationReview` and `reviewFixes.B2` state the dependency is accepted and revalidated.
- V6-23 source hashes remain identical to candidate `a843de4`, and the acceptance suite still passes 12/12 with 0 failed and 0 skipped. The round-2 stale-policy fix and the merged V6-18 code remain intact.
- No code regression or new functional issue was found; the remaining defect is the stale aggregate count in the verification summary.

## What I ran

- `npm run test:v6 -- V6-23` — exit 0; 12 passed, 0 failed, 0 skipped.
- `./node_modules/.bin/tsc -p apps/web/tsconfig.json --noEmit` — exit 0.
- Re-read the current receipt, `regression-v6-18.tap`, and `regression.txt`; recomputed the regression-suite total from the recorded per-suite counts.
- Did not run a build, make network/provider calls, or modify V6-23 source.
