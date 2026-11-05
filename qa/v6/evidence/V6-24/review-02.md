VERDICT: ACCEPT

# V6-24 independent acceptance review 02

Reviewer: independent adversarial reviewer (read-only; did not author the candidate).
Worktree: `/private/tmp/patent-v6-24-worktree` (branch `codex/v6-24-approval`, HEAD `4ad5008`).
Base/integration: `5b02ebf`; integration `de8247c` is an ancestor of HEAD.
Round: re-review of the regenerated evidence after `review-01.md`.
Date: 2026-11-05.

## Verdict

ACCEPT. The stale V6-19 evidence was regenerated and now matches a fresh run. The implementation
and contract checks remain correct, the requested regressions pass, and the candidate scope is
unchanged. The remaining observations are non-blocking provenance notes.

## Resolution of prior blockers

### B1 (stale V6-19 regression evidence) — resolved

- `qa/v6/evidence/V6-24/regression.txt` now records `V6-19 exit=0`.
- `qa/v6/evidence/V6-24/regression-V6-19.tap` now records 16 tests, 16 pass, 0 fail, 0 skipped,
  and contains no runner error.
- A fresh `npm run test:v6 -- V6-19` on the current tree also returns 16/16, 0 failures,
  0 skips, exit 0.

### B2 (receipt did not map dependency evidence) — resolved

The receipt now has a `runs` array covering the V6-24 suite, V6-19, the dependency regressions,
web typecheck, and web build, with evidence paths. The per-ticket evidence is present and
consistent:

| Evidence | Tests | Pass | Fail | Skipped |
|---|---:|---:|---:|---:|
| V6-05 | 26 | 26 | 0 | 0 |
| V6-08 | 12 | 12 | 0 | 0 |
| V6-10 | 36 | 36 | 0 | 0 |
| V6-12 | 42 | 42 | 0 | 0 |
| V6-14 | 41 | 41 | 0 | 0 |
| V6-15 | 41 | 41 | 0 | 0 |
| V6-16 | 14 | 14 | 0 | 0 |
| V6-17 | 37 | 37 | 0 | 0 |
| V6-18 | 10 | 10 | 0 | 0 |
| V6-19 | 16 | 16 | 0 | 0 |
| V6-20 | 9 | 9 | 0 | 0 |
| V6-23 | 12 | 12 | 0 | 0 |
| V6-24 | 6 | 6 | 0 | 0 |

## Acceptance confirmation

The substantive V6-24 behavior was verified in review 01 and remains unchanged at HEAD:

- Valid professional state creates one internal approval and one `approval.created` event.
- Editor approval is `ACTION_FORBIDDEN` with no record and no event.
- Missing check blocks with `CHECK_REQUIRED`; missing or revoked content confirmation blocks
  with `CONFIRMATION_REQUIRED`; unacknowledged risk blocks by risk ID and current-run `risk_ack`
  clears it.
- Figure rebind invalidates with `STALE_BINDING`; check replacement and cited-confirmation
  revocation invalidate with `APPROVAL_REQUIRED`; rule-pack change invalidates with
  `CHECK_REQUIRED`.
- Repeated create is idempotent; revocation is append-only and visible; double revocation is
  rejected without a second record.
- No legal signature or submission wording appears in the panel.
- S08 mapping is honest: A03/A04/A05 covered, other items not applicable with specific reasons.
- Receipt and `scope.txt` both list 28 files; `node_modules` is excluded; no candidate change
  outside the V6-24 write set.

## Non-blocking observations

1. `receipt.json` labels the `web typecheck` run as
   `./node_modules/.bin/tsc -p apps/web/tsconfig.json --noEmit`, while the linked
   `typecheck.txt` records output from the root `npm run typecheck --workspaces --if-present`
   command. Both commands pass on this tree, and I independently ran the exact direct command
   with exit 0. This is a provenance/label mismatch to align in a future evidence refresh, not a
   functional blocker.
2. The receipt's "dependency regressions" entry uses the shorthand
   `V6-05/08/10/12/16/17/18/20/23` instead of a single executable command. The per-ticket
   commands and exit codes are represented by `regression.txt` and the TAP files, and all pass.
3. The receipt still does not contain explicit mount/content hashes for the browser evidence.
   The browser log and screenshots agree on all six steps; this remains a re-review convenience,
   not an acceptance blocker.
4. The panel remains exported but unregistered in `V6App`/navigation, as stated in the receipt
   limitations. Shared registration is orchestrator-owned.
5. Node 25.8.1 was used; the architecture target Node 22 remains unverified, as stated.

## What was run in this round

From `/private/tmp/patent-v6-24-worktree`:

- Re-read `receipt.json`, `regression.txt`, `regression-V6-19.tap`, `runner.tap`,
  `typecheck.txt`, `build.txt`, and all `regression-*.tap` summaries.
- Verified the new receipt `runs` array and per-ticket TAP counts.
- `./node_modules/.bin/tsc -p apps/web/tsconfig.json --noEmit` -> exit 0.
- Confirmed HEAD is still `4ad5008`; only reviewer output and the coordinator's evidence refresh
  differ from the previous review.
- Did not run the build; inspected the existing build evidence only. No network, real provider,
  customer material, `.dev.vars`, main-checkout modification, reset, clean, stash, commit, or
  push was used.

The only repository file written by this review is this review.
