VERDICT: CHANGES_REQUIRED

# V6-23 independent acceptance review

## Blockers

1. **Stale rule-pack policy metadata can block an action that the active rule does not declare.** In [checks.ts](/private/tmp/patent-v6-23-worktree/packages/domain/src/v6/checks.ts:616), finding evaluation skips rules whose `packVersion` differs from `pack.version`. The policy-action collection at lines 646–649 does not apply that version filter. Reproduction: pass two `policy`/`engineering` rows with the same id, `policy.versioned`: an `old-v1` row declaring `export`, and the active `active-v2` row declaring only `prepare`. The result contains only the active finding, but `blockingPolicyRuleIds.export` is `['policy.versioned']`; passing that list to `evaluateGate(export)` returns `allowed: false` with `GATE_BLOCKED`. With only the active row, export is allowed. This violates S07's rule that a product policy blocks only an action declared by the applicable rule. Filter policy-action collection to the active pack version (and cover the duplicate-id/version case).

2. **The prerequisite receipt does not show V6-18 accepted.** V6-23's receipt lists V6-18 as `candidate` ([receipt.json](/private/tmp/patent-v6-23-worktree/qa/v6/evidence/V6-23/receipt.json:15)); the V6-18 receipt also says `candidate` and `pending_re_review` ([receipt.json](/private/tmp/patent-v6-23-worktree/qa/v6/evidence/V6-18/receipt.json:4), [receipt.json](/private/tmp/patent-v6-23-worktree/qa/v6/evidence/V6-18/receipt.json:326)). This conflicts with the review brief's statement that V6-18 is accepted. The execution protocol requires dependencies to pass independent review before dispatch (06-execution-protocol.md §1). Reconcile the receipt with the claimed accepted state and its review evidence before treating V6-23's dependency as satisfied.

## Non-blocking notes

- Independent synthetic fixtures exercised all ten S07 engineering blocker rules and all six listed risk rules. They produced the expected blocker/risk categories. A separate legal fixture with `authority=official`, `verification=unverified` remained `unverified`, displayed `未核实`, and did not block export. A missing current check produced gate reason `CHECK_REQUIRED` and no `no_current_check` finding. Repeated input produced equal results; changing the active pack version made the run non-current.
- Rule-pack review: the five dated source files contain 28 rows; the adapter merges the two repeated IDs to 26 rows, binds rows to the active version, and later rows replace earlier rows. Matched non-engineering rules are forced to `unverified`; the adapter does not invent official verification. The page says `未检索`. The source README and receipt correctly retain the limitation that line-by-line official legal text has not been verified.
- S07-A06 and S07-A08 are honestly marked `not_applicable`: the panel covers the `未检索` label and coded check failure/retry, while the export manifest and preview page are outside this ticket's write set.
- The component is tested in the standalone synthetic browser harness and is not registered in V6App/navigation. This matches the stated write-set boundary and is recorded as a limitation; app-level integration remains unverified.
- Scope reconciliation passed: the receipt lists 25 changed files and exactly matches `scope.txt` after excluding `node_modules`. Git status shows candidate files only under `apps/web/src/v6/features/checks/`, `packages/domain/src/v6/checks.ts`, and V6-23 scenario/evidence paths, plus the excluded `node_modules` symlink. SHA-256 values for V6App.tsx, navigation.ts, and v6.css match base commit `73a70df`.
- Inspected `build.txt`, browser log, driver, mount, and four screenshots. The browser evidence records 7/7 steps, zero console errors, and no external requests. The build evidence reports success and the existing large-chunk warning. I did not run the build, as instructed. Node 25.8.1 was used; Node 22 remains unverified.

## What I ran

- `npm --prefix /private/tmp/patent-v6-23-worktree run test:v6 -- V6-23` — exit 0; 11 passed, 0 failed, 0 skipped.
- Re-ran V6-18, V6-17, V6-16, V6-15, V6-14, V6-12, V6-10, and V6-08 suites — all exited 0.
- `/private/tmp/patent-v6-23-worktree/node_modules/.bin/tsc -p /private/tmp/patent-v6-23-worktree/apps/web/tsconfig.json --noEmit` — exit 0.
- Ran independent inline Node/tsx probes for S07 blocker and risk fixtures, legal nonblocking behavior, determinism, stale pack handling, no-current-check gate behavior, and the stale policy-version reproduction above.
- Did not run a build or make provider/network calls.
