VERDICT: CHANGES_REQUIRED

# V6-47a independent acceptance review

Worktree: /private/tmp/patent-v6-integration (head 5a2c657; candidate commit 15f3a20)
Reviewed: qa/v6/evidence/V6-47a/receipt.json, release/r1/profile.json, docs/implementation/patent-saas-v6/release/R1.md, scenarios/V6-47a/release.test.mjs, runner.tap, build.txt, typecheck.txt, scope.txt, all 26 dependency receipts, and the runbook.
No network, deployment, charge, submission, or .dev.vars access. Only this review file was written.

## Blockers

### B1. V6-47a-A02 does not cover a missing required gate
`qa/v6/scenarios/V6-47a/release.test.mjs:12-14` evaluates only ticket status:

```js
function evaluateRelease(tickets) {
  return tickets.every((ticket) => ticket.status === "accepted") ? "candidate_ready" : "not_ready";
}
```

The A02 test at lines 34-44 only flips V6-04 to `candidate`; it never removes or closes G-RELEASE. Reproduce:

```bash
cd /private/tmp/patent-v6-integration
node --input-type=module -e 'const evaluateRelease=(tickets)=>tickets.every((ticket)=>ticket.status==="accepted")?"candidate_ready":"not_ready"; console.log(evaluateRelease(Array.from({length:26},()=>({status:"accepted"})),{"G-RELEASE":{status:"closed"}}))'
# output: candidate_ready
```

Ticket V6-47a-A02 is explicit: "任一前置票未 accepted 或任一必需 gate 缺证据" must yield not_ready and list the missing ticket/gate. The helper cannot see gates; `missingTickets` is hardcoded to `[]` in the profile. The receipt's A02 observation also omits the gate branch. Add a gate-inclusive evaluator and a test where all 26 tickets are accepted but G-RELEASE is absent/closed, expecting `not_ready` with G-RELEASE in the missing list.

### B2. V6-01 has no review evidence in its receipt/profile, contradicting the G-RELEASE claim
The closure check returns `NO-REVIEW` only for V6-01; V6-02..26 have `review.verdict = accept`. Evidence:

- `qa/v6/evidence/release/r1/profile.json:10` has `"review": null` for V6-01.
- `qa/v6/baseline/receipt.json` has no `review` field or review path.
- `docs/implementation/patent-saas-v6/release/R1.md:9` shows "—" for V6-01.
- `qa/v6/baseline/manifest.json:40` merely asserts "Independent review caught and corrected two changing planning hashes"; `.planning/2026-10-30-patent-saas-v6/task_plan.md:19,61` also only asserts an independent review. No reviewer artifact, verdict file, or linked path exists.
- `qa/v6/evidence/release/r1/profile.json:243` nevertheless says the G-RELEASE evidence is "all 26 R1 receipts accepted with independent review evidence", and `qa/v6/evidence/V6-47a/receipt.json:48` says "all 26 receipts/reviews".

This fails the brief's requirement to require review evidence for each dependency and makes the G-RELEASE evidence untraceable for one ticket. Add a V6-01 review artifact/path with its verdict, cite it in the profile/R1.md, and update the G-RELEASE evidence sentence; or qualify the claim so it does not say all 26 have recorded review evidence.

### B3. V6-47a-A03 is vacuous: it does not rerun generation or check for duplicate records
`qa/v6/scenarios/V6-47a/release.test.mjs:46-52` parses the same static profile file twice and compares its in-memory values:

```js
const a = JSON.parse(readFileSync(PROFILE, "utf8"));
const b = JSON.parse(readFileSync(PROFILE, "utf8"));
assert.equal(evaluateRelease(a.tickets), evaluateRelease(b.tickets));
```

No generator exists: `grep` for `profile.json`/`evaluateRelease` finds only the static file and the test. There is no write path, so "no duplicate record is written" and "same input rerun" are not exercised. The receipt's A03 "covered" claim is unsupported. Fix by generating the profile into a temporary output from the receipts, running it twice, comparing the conclusion/missing list and asserting exactly one record is produced; or mark A03 `not_run`.

### B4. G-RELEASE evidence overstates the integrated verification and omits the 02-plan exit mapping
`profile.json:245` lists G-RELEASE evidence as "integrated root build and V6-02–26 suites (V6-09 browser subtests require a live dev server; its accepted evidence is review-02)". The actual V6-47a artifacts are:

- `runner.tap`: only the four V6-47a release-structure tests (4/4, 0 skipped, exit 0).
- `build.txt`: an apps/web `build:v6-root` (`tsc --noEmit && vite build`), not a consolidated root/workspace suite run.
- `typecheck.txt`: 0 bytes.
- No integrated suite log and no V6-09 browser rerun in this release run.

V6-09's caveat is disclosed in the profile/R1/receipt, and its accepted evidence remains review-02 (21/21 with browser 16/16), so it is not hidden. Node 22 is likewise honestly listed as unverified (all runs used Node 25.8.1), but D05 fixes Node 22 LTS for the stack. Both are material residuals, not facts that support an unqualified "integrated" G-RELEASE claim. Also, ticket operation 2 requires "核对 02-plan R1 出口条件逐条有证据" (02-plan.md:10: upload/Q&A -> facts -> route -> draft -> confirmation -> check -> real export; same-case workbench; refresh recovery, corrupt drawings, old approval cases), but R1.md/profile have no per-criterion evidence matrix. Add that mapping, attach the actual integrated run log, and either verify Node 22 or state explicitly that R1 is web-only and Node 22 is out of scope; otherwise change the gate/conclusion wording from satisfied to a qualified not_ready/pending status.

## Non-blocking notes

- Runbook precondition 1 is broken: `qa/v6/evidence/release/deploy/runbook.md:7` points at `qa/v6/evidence/V6-01/receipt.json`, which does not exist. V6-01's receipt is `qa/v6/baseline/receipt.json`. Fix before any deployment.
- The candidate `baseCommit` is 64f0907, but 15f3a20's parent is f5082b6. `git diff 64f0907..15f3a20 -- apps packages` shows six product paths (rule-pack, Workspace, Workbench, V6App, domain index) from f5082b6, outside the 8-file ticket commit. The ticket commit itself is clean (only the eight release paths), so no product code was modified by V6-47a, but the receipt's base/delta is not exact; use f5082b6 or document the integration commit.
- Profile `review` is null for V6-05..08 even though their receipts contain accepted review objects. R1.md's "—" therefore under-reports existing evidence. Populate those paths consistently.
- `typecheck.txt` is empty; the only typecheck evidence is embedded in `build.txt` (`tsc --noEmit && vite build`). Keep a standalone typecheck output or remove the empty artifact.
- 8 changedFiles exactly match scope.txt; all are release/evidence/test paths; no cloud tickets (V6-27+) appear in profile or R1.md; gates G-RELEASE/G-MODEL/G-XML/G-RULES are present with stated statuses; recovery/export figures (V6-26 14/14, V6-25 20/20) are stated and rollback is honestly marked prepared but not executed.
- Deployment to patent.paymond.me is not implied by this record. The profile/R1/receipt/runbook all require a hostname decision (existing ChatGPT custom domain) and separate authorization, and no deploy/charge/submit/send was performed.
- G-RELEASE owners are roles, not named sign-offs; 03-decisions treats owners as roles, but deployment should record the actual approval artifact before use.

## What I ran

- `npm run test:v6 -- V6-47a` -> 4/4 pass, 0 fail, 0 skipped, exit 0 (Node 25.8.1).
- Independent closure script over all 26 receipts (`qa/v6/baseline/receipt.json` for V6-01; `qa/v6/evidence/V6-xx/receipt.json` for V6-02..26): status, baseCommit, receipt path, and review-path existence; result: all accepted and matching except V6-01 lacks review evidence; all referenced review paths for V6-02..26 exist.
- `git status --short --branch`, `git show --stat 15f3a20`, `git show --format= --name-only 15f3a20`, `git diff --name-status 64f0907..HEAD`, `git diff --check`.
- Read the ticket, 02-plan, 03-decisions (G-RELEASE), 06-execution-protocol, S13, runbook, profile, R1.md, candidate receipt/test/scope/build/typecheck, and V6-01/V6-04/V6-05/V6-06/V6-07/V6-08/V6-09/V6-25/V6-26 supporting evidence.
