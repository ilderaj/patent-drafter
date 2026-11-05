VERDICT: CHANGES_REQUIRED

# V6-23 review 4: dependency evidence recheck

## Blocker

1. **The refreshed V6-18 tap is 10/10, but the receipt and regression summary still record 7/7 and the old candidate dependency.** Reproduction on the current tree:

   ```sh
   node -e 'const r=require("./qa/v6/evidence/V6-23/receipt.json"); console.log(r.runs.find(x=>x.name==="V6-18 regression"))'
   tail -8 qa/v6/evidence/V6-23/regression-v6-18.tap
   grep -n 'V6-18' qa/v6/evidence/V6-23/regression.txt
   ```

   The tap ends with `# tests 10`, `# pass 10`, `# fail 0`, `# skipped 0`, but the receipt run entry still says `"tests": 7, "pass": 7` against that tap. `regression.txt` still says `V6-18: exit 0; 7/7 passed` and its B2 note still describes V6-18 as `candidate at 73a70df with reviewStatus pending_re_review`. The top-level dependency record is now correctly accepted at review-04/merge `e9c14f9`, so only these stale run/summary fields remain; update the V6-18 run count and `regression.txt` to the refreshed 10-test result. No V6-23 code change is required.

## Non-blocking notes

- The V6-18 prerequisite is genuinely resolved: receipt `status: accepted`, `review.verdict: accept`, `review-04.md` evidence, and merge commit `e9c14f9` present as a parent of `76dc574`. The V6-23 dependency record now says accepted with that evidence.
- V6-23 code is unchanged from candidate `a843de4`; hashes for `packages/domain/src/v6/checks.ts`, `apps/web/src/v6/features/checks/Checks.tsx`, and `qa/v6/scenarios/V6-23/checks.test.mjs` match that commit.
- No code regression was found from the merged V6-18. The round-2 stale-policy fix remains intact.

## What I ran

- `npm run test:v6 -- V6-23` — exit 0; 12 passed, 0 failed, 0 skipped.
- `./node_modules/.bin/tsc -p apps/web/tsconfig.json --noEmit` — exit 0.
- Re-read the current V6-23 receipt, `regression-v6-18.tap`, and `regression.txt`; compared the V6-18 accepted receipt/review evidence and merge parentage.
- Did not run a build, make network/provider calls, or modify V6-23 source.
