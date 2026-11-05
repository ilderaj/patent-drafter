VERDICT: CHANGES_REQUIRED

# V6-24 independent acceptance review 01

Reviewer: independent adversarial reviewer (read-only; did not author the candidate).
Worktree: `/private/tmp/patent-v6-24-worktree` (branch `codex/v6-24-approval`, HEAD `4ad5008`).
Base/integration: `5b02ebf`; integration `de8247c` is an ancestor of HEAD.
Date: 2026-11-05.

## Verdict

The V6-24 implementation and the requested V6-19/20/23/18/17/12/10/08/V6-05 reruns pass. The
candidate is not ready for acceptance because its checked-in regression evidence contradicts a
fresh rerun and records a failing dependency. This is an evidence/scope repair, not an approval
logic defect.

## Blockers

### B1. Regression evidence records V6-19 failing while the branch passes 16/16

The candidate's own evidence says V6-19 is a failing regression:

- `qa/v6/evidence/V6-24/regression.txt` line 3: `V6-19 exit=1`.
- `qa/v6/evidence/V6-24/regression-V6-19.tap`: `# tests 16`, `# pass 15`, `# fail 1`, then
  `V6 runner error: 1 test(s) failed`. The failing assertion is the V6-19 C03 revocation-retry
  expectation at `qa/v6/scenarios/V6-19/review.test.mjs:307`.

A fresh run on this exact worktree/branch:

```
$ npm run test:v6 -- V6-19
...
# tests 16
# pass 16
# fail 0
# skipped 0
EXIT=0
```

Reproduction: read `qa/v6/evidence/V6-24/regression.txt` and `regression-V6-19.tap`, then rerun
`npm run test:v6 -- V6-19` from `/private/tmp/patent-v6-24-worktree`. The stored result is stale
and was not captured after the accepted V6-19 semantic alignment (`de8247c`, which is in branch
history and changes this same test). Acceptance must not ship evidence that records a known
failing dependency while the fresh result passes.

Required repair: rerun V6-19 (and the other regression tickets) on the final candidate tree,
replace the stale TAP/exit-code records, and update `regression.txt` so every listed exit code is
0 with 0 failures and 0 skips.

### B2. The receipt does not map the checked-in regression evidence to the claimed fresh result

The receipt claims V6-24 acceptance from `runner.tap` only and leaves regressions out of
`acceptance[].command`/`exitCode`. Combined with B1, there is no honest receipt-level statement
that the dependency suites were rerun successfully. If the executor intends the stale V6-19 TAP
to remain as historical evidence, the receipt must say so explicitly and must not present the
regression set as a clean pass. Otherwise, regenerate the evidence as in B1 and add the actual
commands/exit codes for the dependency reruns.

## Non-blocking observations

1. `receipt.json` is still `status: "candidate"` with `review.verdict: "pending_re_review"`,
   which is expected before this review. After repair the orchestrator should update the review
   fields and only then mark the ticket accepted.
2. The receipt lists 28 `changedFiles`; `scope.txt` lists the same 28 files and the receipt has no
   `node_modules` entries. The worktree's only untracked non-candidate path is `node_modules`.
   `Approval.tsx`, the six-file `qa/v6/scenarios/V6-24/` slice, and the evidence directory are the
   only candidate paths. Nothing outside the ticket write set was changed by the V6-24 slice.
   The tracked `.planning/.../progress.md` change is orchestrator integration history, not an
   approval implementation change.
3. The receipt does not contain mount/content hashes for the browser evidence. The mount and
   driver are synthetic and self-contained, but a future re-review cannot confirm the screenshots
   correspond to the checked-in mount without hashes. Non-blocking because the browser log and
   screenshots agree on the six steps.
4. S08 mapping is honest for this ticket: A03/A04/A05 are covered with test evidence; A01/A02,
   A06, A07, A08, A09 are marked `not_applicable` for V6-25/V6-26 boundaries with specific
   reasons. V6-24-A01/A02/A03 are separately covered.
5. The panel is exported but not registered in `V6App`/navigation. The receipt states this
   limitation; shared registration is orchestrator-owned. The direct synthetic mount therefore
   does not prove native IndexedDB routing, but it does prove the panel and session seams.
6. The UI copy is accurate: it labels the output "申请准备材料，非已提交文件", says it does not
   generate a signature or filing receipt, and contains no `法定签署` or `已递交` wording. The
   `Approval` contract fields remain an internal record with `purpose: "internal_release"`.
7. Role handling is limited to the facts supplied by the host (`role`), which matches the R1
   self-reported identity limitation. `owner/admin/reviewer` can approve and revoke; `editor` and
   `viewer` receive `ACTION_FORBIDDEN` before any write. The editor probe confirmed zero approval
   rows and zero approval events.
8. The browser evidence is dated/synthetic and the network log lists only localhost requests; the
   log's external request list is empty. The build evidence is present but the mandated acceptance
   run should not rely on it as a substitute for `test:v6` and the direct typecheck.
9. Node 25.8.1 was used; the architecture target Node 22 is stated as unverified. This is an
   environment limitation, not a V6-24 implementation blocker.
10. My independent probes added coverage beyond the candidate suite: a concurrent duplicate
    create still leaves one approval and one `approval.created` event; a second revoke is rejected
    and appends no second revocation; `self_read` mode without `full_read` is blocked with
    `CONFIRMATION_REQUIRED` for `full_read`; and a foreign actor cannot read the matter
    (`RESOURCE_NOT_FOUND`). All passed.

## What was run

From `/private/tmp/patent-v6-24-worktree`:

- `npm run test:v6 -- V6-24` -> 6 tests, 6 pass, 0 fail, 0 skipped, exit 0.
- `npm run typecheck --workspace @patent/web` -> `tsc --noEmit`, exit 0.
- `npm run test:v6 -- V6-19` -> 16/16, 0 skipped, exit 0 (fresh run; checked-in evidence says
  15/16 exit 1).
- Serial rerun of V6-19, V6-20, V6-23, V6-18, V6-17, V6-12, V6-10, V6-08, V6-05 ->
  all exit 0; 200 tests total, 200 pass, 0 fail, 0 skipped.
- Inspected `qa/v6/evidence/V6-24/receipt.json`, `scope.txt`, `runner.tap`, `typecheck.txt`,
  `build.txt`, `browser-run.txt`, `browser-log.json`, `browser-mount.html`,
  `browser-drive.mjs`, `regression*.txt`, `regression-*.tap`, and the four screenshots.
  Did not run the build; inspected the existing `build.txt` only.
- Independent fixture probes through `qa/v6/scenarios/V6-24/harness.mjs` and the public
  `ApprovalSession`/`ApprovalPanelView` seams covered: valid approval, repeat create, editor
  forbidden, missing check, revoked cited confirmation, unacknowledged risk, figure rebind,
  check replacement, cited-confirmation revocation, rule-pack change, self-read mode, concurrent
  duplicate create, double revoke, UI gate rendering, and foreign-actor ownership. All checks
  passed. Probes were transient commands through `node --import tsx`, not files added to the
  repository.
- Inspected `packages/domain/src/v6/gate.ts`, `confirmation.ts`, `checks.ts` and
  `apps/web/src/v6/features/delivery/Approval.tsx` for live gate reasons, append-only behavior,
  role checks, and storage ownership.

No real provider, network call, customer material, `.dev.vars`, or main-checkout modification was
used. The only repository file written by this review is this review.

## Acceptance matrix checked

| Item | Independent result |
|---|---|
| Valid professional state creates an internal approval | Pass |
| Editor is `ACTION_FORBIDDEN` with no record/event | Pass |
| Missing check blocks with `CHECK_REQUIRED` | Pass |
| Missing/revoked content confirmation blocks with `CONFIRMATION_REQUIRED` | Pass |
| Unacknowledged risk blocks by risk id; current-run `risk_ack` clears it | Pass |
| Figure rebind invalidates old approval with `STALE_BINDING` | Pass |
| Check replacement invalidates with `APPROVAL_REQUIRED` naming the approval | Pass |
| Cited confirmation revocation invalidates with `APPROVAL_REQUIRED` | Pass |
| Rule-pack change invalidates with `CHECK_REQUIRED` | Pass |
| Repeated create reuses one approval and one event | Pass |
| Revocation is append-only, visible, and second revoke is rejected | Pass |
| No legal signature/submission wording | Pass |
| 6/6 V6-24, direct web typecheck, requested regression suites | Passes on fresh run |
| Checked-in regression evidence is current and consistent | **Fail (B1)** |

## Scope and evidence audit

- `changedFiles` count: 28; `scope.txt` count: 28; receipt-only and scope-only sets are empty.
- `node_modules` is not in the receipt or scope list.
- Candidate paths: `apps/web/src/v6/features/delivery/Approval.tsx`,
  `qa/v6/scenarios/V6-24/approval.test.mjs`, `qa/v6/scenarios/V6-24/harness.mjs`, and the
  `qa/v6/evidence/V6-24/` artifacts.
- The browser log shows six successful steps with no console errors and no external requests.
  The four screenshots visually show ready, created, stale (with reason), and revoked states.
- Mount hash: not recorded in the receipt (non-blocking observation 3). The only hash evidence
  needed for B1 is regenerated TAP/exit-code output.
