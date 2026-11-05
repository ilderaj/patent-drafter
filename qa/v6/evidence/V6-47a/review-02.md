VERDICT: CHANGES_REQUIRED

# V6-47a round-2 independent acceptance review

Worktree: /private/tmp/patent-v6-integration (HEAD 5a2c657; candidate is an uncommitted working-tree change on top of 15f3a20)
Reviewed: receipt.json, profile.json, R1.md, release.test.mjs, runner.tap, regression.txt, typecheck.txt, build.txt, scope.txt, runbook, all 26 dependency receipts, and the integrated /tmp logs.
No network, deployment, charge, submission, or .dev.vars access. Only this review file was written.

## Round-1 fixes that hold

- G-RELEASE now states V6-01 is accepted via `qa/v6/baseline/receipt.json` with no separate review artifact; V6-02–26 have receipt review evidence. The earlier false "all 26 separate reviews" claim is gone. V6-01's planning record asserts an independent acceptance, and the record now discloses the missing artifact rather than hiding it.
- A02 rejects a closed or missing G-RELEASE, not only a non-accepted ticket: `release.test.mjs:12-16` requires `G-RELEASE.status === "satisfied_for_r1_candidate"`; the closed/missing cases assert `not_ready`.
- A03 now reads all 26 receipts twice (`readClosure`, lines 18-27, 61-68) and checks equality and 26 unique ticket ids. It no longer reads the static profile twice.
- Profile/R1.md contain the R1 exit-condition mapping (`r1ExitConditions`; R1.md "R1 出口条件映射"), the gate statuses, recovery/export evidence, and the disclosed V6-09 and Node 22 limitations.
- Runbook precondition 1 now points to `qa/v6/baseline/receipt.json`; typecheck.txt is no longer empty (`exitCode=0`); the current candidate has no product-code diff in `apps/` or `packages/`.

## Blockers

### B1. Undeclared root-level staging config outside the ticket scope
`git status --porcelain` has 12 entries. The last is:

```
?? wrangler.patent-v6.staging.jsonc
```

The receipt's `changedFiles` and `scope.txt` each have 11 entries. They contain `build.txt` (committed in 15f3a20), `regression.txt`, `review-01.md`, and the eight modified release files; they do not contain `wrangler.patent-v6.staging.jsonc`. The receipt's scope object says `porcelainEntries: 11`, `excluded: ["node_modules"]`, `includedFiles: 11`, `scopeMatchesChangedFiles: true`. Excluding `node_modules` from the 12 status entries leaves 11 entries, but they are a different set: the status set contains the staging config and not `build.txt`; `scope.txt`/`changedFiles` contain `build.txt` and not the staging config. The `scopeMatchesChangedFiles` check only compares scope.txt to changedFiles, not either set to `git status`.

The staging config is at the repository root, is a deployment/staging target (`workers_dev: true`, no custom domain), is not mentioned in the runbook, and is outside the ticket's allowed writes. It appeared after round 1 (mtime 16:52:38). This violates the scope requirement and makes the candidate's 11-file scope statement inaccurate. Remove it, exclude/declare it explicitly, or add it to changedFiles and scope with an owner/authorization note; then recompute the scope claim.

### B2. Regression summary claims all V6-02–26 suites ran, but there is no V6-09 log
`regression.txt:3` says "V6-02..V6-26: each suite exit 0", and `profile.json:244` repeats "V6-02–26 suites exit 0", with a parenthetical that V6-09's browser subtests need a live server. The available logs are:

```
/tmp/v6-final-02.log ... /tmp/v6-final-08.log
/tmp/v6-final-10.log ... /tmp/v6-final-26.log
/tmp/v6-final-build.log
```

There is no `/tmp/v6-final-09.log`. The only V6-09 evidence is the accepted prior `review-02.md` (21/21); the final integrated rerun did not leave a V6-09 result. The summary should not say every suite exited 0. Reproduction:

```bash
ls /tmp/v6-final-09.log
# No such file or directory
grep -n 'each suite exit 0' qa/v6/evidence/V6-47a/regression.txt
# V6-02..V6-26: each suite exit 0 ...
```

Add the actual V6-09 log with its pass/cancel/exit result, or mark V6-09 `not_run` and qualify the "each suite" claim. The disclosed V6-09 caveat is acceptable; the unqualified suite-exit claim is not supported by the final-run evidence.

### B3. A02 still does not report the missing gate, only a boolean not_ready
`release.test.mjs:53-58` sets `G-RELEASE` to closed and deletes it, then asserts only `not_ready`. `evaluateRelease` returns a string and has no missing-gate output; `profile.json` has `missingTickets` but no `missingGates`. The ticket V6-47a-A02 requires the conclusion to be not_ready and to list each missing ticket/gate. The missing-ticket branch computes a local `missing` array, but the closed/missing-gate branch produces no analogous list. Reproduction:

```bash
node --input-type=module -e 'import {readFileSync} from "node:fs"; const p=JSON.parse(readFileSync("qa/v6/evidence/release/r1/profile.json","utf8")); console.log("missingGates" in p, "missingTickets" in p)'
# false true
```

Add a missing-gate list (or an explicit gate-row status list) to the evaluator/record and assert it in the closed and deleted-G-RELEASE cases. The current actual profile has G-RELEASE satisfied, so the positive path is fine, but the negative acceptance is still incomplete.

## Non-blocking notes

- A03's closure recomputation and 26-unique-row check are good, but the test still does not exercise a write path or assert that no duplicate record file is produced. This is an acceptable proxy for the ticket's structural target only if the limitation is stated; it is not a generator test.
- The gate table is incomplete against ticket operation 3: G-RELEASE has owners/evidence but no validity/expiry; G-MODEL/G-XML/G-RULES have only `status` and `note`, with no owner, evidence path, or validity. A03's "证据逐项核对有效期/来源/owner" is therefore not implemented. Add the fields or explicitly mark them not applicable for closed gates.
- Profile `review` is still null for V6-05..08 even though their receipts contain accepted review objects, and R1.md shows "—" for those rows. The receipts are the missing evidence, not the profile; this is an under-reporting/index gap.
- `typecheck.txt` contains only `exitCode=0`; the actual `tsc --noEmit` is embedded in `build.txt`. A standalone command/output would be clearer, but this is not release-blocking.
- The candidate `baseCommit` remains 64f0907 even though the working tree is on 5a2c657, whose parent chain includes f5082b6/15f3a20. This is metadata traceability, not a product-code change by V6-47a.
- The receipt's `changedFiles` includes `review-01.md` but not the newly requested `review-02.md`; update the receipt/scope after this review.
- The V6-09 browser caveat and Node 22 gap are now honestly disclosed; they should remain limitations, not be converted into an unqualified "all suites/Node 22 verified" claim. The record does not imply deployment to patent.paymond.me; the hostname decision and separate authorization remain required, and the runbook correctly says prepared, not executed.

## What I ran

- `npm run test:v6 -- V6-47a` -> 4/4 pass, 0 fail, 0 skipped, exit 0 (Node 25.8.1).
- Independent closure script over all 26 receipts: all status/baseCommit/receipt paths match profile; V6-01 has no receipt review, V6-02–26 have `review.verdict = accept`.
- Gate check: actual profile G-RELEASE `satisfied_for_r1_candidate`; closed/missing gate returns `not_ready`; `missingGates` absent.
- `git status --porcelain` (12 entries, including staging config and node_modules), `git diff --check` clean, no `apps/`/`packages/` diff; scope.txt/changedFiles 11-set comparison.
- Listed `/tmp/v6-final-*.log`: 02–08 and 10–26 plus build; `v6-final-09.log` missing.
- Read the ticket, 02-plan, 03-decisions, 06-execution-protocol, S13, runbook, profile, R1.md, receipt, test, regression/typecheck/build/scope, and the V6-01/V6-09/V6-25/V6-26 supporting evidence.
