VERDICT: CHANGES_REQUIRED

# V6-23 review 3: dependency revalidation

## Blocker

1. **The dependency is genuinely accepted, but the V6-23 receipt still records it as unaccepted and retains stale V6-18 regression evidence.** Reproduction from the current tree:

   ```sh
   node -e 'const r=require("./qa/v6/evidence/V6-23/receipt.json"); console.log(r.dependencies.find(d=>d.ticket==="V6-18")); console.log(r.dependencyStatus); console.log(r.limitationReview); console.log(r.reviewFixes.find(x=>x.id==="B2")); console.log(r.runs.find(x=>x.name==="V6-18 regression"))'
   ```

   This reports `dependencies[3].status = "candidate"`, `reviewStatus = "pending_re_review"`, `baseCommit = "73a70df..."`, while the added `dependencyStatus` says V6-18 is accepted at `e9c14f9`. `limitationReview` still says "V6-18 remains candidate ... V6-23 is not acceptance-ready," and review fix B2 still describes the dependency as candidate. The stored V6-18 regression evidence also remains the pre-merge 7-test run: `regression-v6-18.tap` ends `# tests 7`; the merged V6-18 suite now has 10 tests and exits 10/10.

   The underlying prerequisite is now satisfied: `qa/v6/evidence/V6-18/receipt.json` is `status: accepted` with `review.verdict: accept` and evidence `review-04.md`, and the branch merge `76dc574` has `e9c14f9` as a parent. However, the canonical `dependencies` record and the receipt's own readiness statements still contradict that fact. Update the V6-18 dependency record to accepted with the accepted merge/review evidence, refresh `limitationReview`, `reviewFixes.B2`, and the V6-18 regression artifact/run count from the merged tree. No V6-23 source change is required.

## Non-blocking notes

- V6-18 is now accepted: its receipt records `status: accepted`, `review.verdict: accept`, and `review-04.md` evidence; review-04 itself starts `VERDICT: ACCEPT`.
- The merge introduced only V6-18 source/evidence and planning files relative to V6-23 candidate `a843de4`. SHA-256 hashes of `packages/domain/src/v6/checks.ts`, `apps/web/src/v6/features/checks/Checks.tsx`, and `qa/v6/scenarios/V6-23/checks.test.mjs` are unchanged from `a843de4`, so the round-2 policy fix remains exactly as reviewed.
- No regressions were observed on the merged tree. The dependency resolution does not affect the previously verified S07 behavior, rule-pack closure, determinism/staleness handling, scope boundary, or browser evidence.
- The previously verified 26 candidate files plus reviewer-authored `review-02.md` reconcile with the current `scope.txt`; `node_modules` remains excluded. `review-03.md` is reviewer-authored and is not a candidate implementation change.

## What I ran

- `npm run test:v6 -- V6-23` — exit 0; 12 passed, 0 failed, 0 skipped.
- `npm run test:v6 -- V6-18` — exit 0; 10 passed, 0 failed, 0 skipped.
- `npm run test:v6 -- V6-17` — exit 0; 37 passed, 0 failed, 0 skipped.
- `./node_modules/.bin/tsc -p apps/web/tsconfig.json --noEmit` — exit 0.
- Inspected the V6-18 accepted receipt and `review-04.md`, the merge parents/diff, V6-23 source hashes against `a843de4`, and the receipt's dependency and regression fields.
- Did not run a build, make network/provider calls, or modify V6-23 source.
