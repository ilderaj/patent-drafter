VERDICT: ACCEPT

# V6-14 Review 01 (independent, read-only)

Reviewer: independent acceptance reviewer. Worktree `/private/tmp/patent-v6-14-worktree`, branch `codex/v6-14-targets`, base `5225360`. No source, test, evidence or receipt file was modified; this file is the only write.

## 1. What I ran and observed

| Check | Command / method | Result |
|---|---|---|
| V6-14 suite | `node qa/v6/runner.mjs V6-14` | exit 0, TAP plan `1..41`, 41 ok, 0 not ok (recomputed from TAP lines, not the summary) |
| Saved TAP | diff fresh TAP vs `runner.tap` after normalizing `duration_ms` | identical; test order and names match the receipt's test indexes |
| Regressions | `node qa/v6/runner.mjs V6-13 / V6-15 / V6-12 / V6-11 / V6-10` | 45/45, 41/41, 42/42, 53/53, 36/36, all exit 0 (match `regression.txt`) |
| Typecheck | `npm run typecheck` | exit 0 |
| Receipt hashes | sha256 of all 26 files in `receipt.hashes.files` | 26/26 match |
| Scope | `/usr/bin/git status --porcelain --untracked-files=all` minus `node_modules` (`.claude/launch.json` absent) | 27 entries, exactly equal to `changedFiles` and `scope.txt` (receipt.json and scope.txt included) |
| Mount revert | sha256 `apps/web/src/v6/routes/V6App.tsx` | `91a04dbe…2431b`, not in git status; no TargetsPanel import in V6App |
| Red-before-fix | re-derived all 5 fixtures in memory from the anchors in `red-before-fix.mjs` | each anchor occurs exactly once; all 5 fixture sha256 match the receipt; `targets.ts` currently `e5449887…cb8` (restored byte-for-byte); named guards red, final suite 41/41 in `red-before-fix.txt` |
| Browser | `browser-log.json` + 8 PNGs | 8/8 steps ok, 0 console errors, 10 requests all local (`localhost:4176`), screenshots exist and show the claimed states |

## 2. Orchestrator fixes

1. Cap removal: no `MAX_TARGETS_PER_MATTER` or other count limit anywhere under `apps/web/src/v6/features/targets/` or the scenarios (grep exit 1). Test 3 creates and lists a third target. Empty-state copy (「本案还没有目标」/「…同一案件可以为不同路线分别创建目标。」) and the disabled reasons (archived, unsupported route, unavailable language) imply no limit. Correct and complete.
2. Asset gate: `usableEvidence` (`targets.ts:925`) is `asset.state === "available"`; it filters `view.evidenceAssets` and is enforced in `validateAgainstMatter` (`targets.ts:929`) with field path `priorityClaims.{i}.evidenceAssetId`. Test 4 loops staging / quarantined / missing_bytes / purged: INVALID_INPUT with field error and an unchanged storage fingerprint (zero writes). Correct.
3. Tests and browser drive updated accordingly (test 3, test 4, step 03 assertion, step 04 contrast assertion).

## 3. Spec-to-implementation mapping

| Requirement | Implementation | Evidence |
|---|---|---|
| V6-14-A01 four routes, EP not a target | `ROUTES`, `routeProblem` refuses EP/unknown with INVALID_INPUT before any write | tests 1-3; browser 02, 03, 06 (forged EP option) |
| V6-14-A02 per-target config, read-only switching, stale/tenant/archived | update bumps only that target's `configVersion`, one `target.config_updated` event with `version` metadata only; switcher writes URL hash only | tests 4-10 (6 uses a storage fingerprint); browser 04, 05 |
| V6-14-A03 idempotency | claim / business write / owner-checked finalize; 30 s lease, 500 ms wait; prepared-response recovery; expired-lease takeover | tests 15-21; 30-day IDEMPOTENCY_EXPIRED honestly listed as not implemented |
| S03-A07 route cards, numbers only when verified | `R1_RULE_PACK` all unverified → 「未核实」; synthetic verified pack shows numbers on that card only | tests 28, 29, 35, 36; browser 07 |
| S03-A08 US/PCT Chinese draft, en-US gated | exact handoff sentence; en-US disabled with reason in UI and refused at write time (capability hardcoded unavailable in R1) | tests 13, 30, 31, 37; browser 03, 07, 08 |
| S03-A09 deterministic recommendation with trace | three rules, no model call; rule id + triggering fact on trace and on the cn_um card | tests 22-25, 38, 39 (not in browser; disclosed) |
| UI states | loading / error+retry / empty / stale (VERSION_CONFLICT re-read), field errors | tests 32-41 |
| Privacy / contracts / ownership | zod contract schemas for stored config and reads; repository ownership and tenant checks; no party ids in events | engine tests, repository review |
| Write set | only `features/targets/`, `qa/v6/scenarios/V6-14/`, `qa/v6/evidence/V6-14/` | scope check; no change to V6App.tsx, navigation.ts, v6.css, .planning |

Receipt acceptance test indexes match the actual ordered TAP for every section.

## 4. Defects and residual risks (none blocking)

1. Low: UI request keys are not reused on retry. `Targets.tsx:271` and `Targets.tsx:310` build a fresh `crypto.randomUUID()` key per click. If a create's business write lands but finalize fails (STORAGE_UNAVAILABLE), or a live claim answers busy, a user retry runs as a new request and can create a second target. An update retry fails safely with VERSION_CONFLICT. The engine protocol is correct; only the caller does not use it. The accepted V6-13 `Intake.tsx` keeps the key across a storage retry, but the accepted V6-15 `Ai.tsx` also uses per-call keys, so I treat this as a convention gap, not an A03 failure. Recommend keeping the create key until success or a non-storage error.
2. Low: asset state / snapshot are validated once (`targets.ts:1643`, `targets.ts:1900`) and are not checked again inside the commit retry loops (`targets.ts:1683`, `targets.ts:1936`). An asset that leaves `available` between validation and commit can still be saved as priority evidence. The window is narrow (single-user, local).
3. Info: after create, selection is set directly (`Targets.tsx:275`) without writing `#target=` to the URL (only `select` at `Targets.tsx:216-224` writes it). A reload after create selects the first target, not the new one.
4. Info: the receipt `acceptance` block does not list S03-A01..A06 as not_applicable with reasons. The V6-13 receipt did this for the criteria out of its scope. Bookkeeping only.
5. Documented limitations checked and honestly stated, none hides an acceptance failure: no 30-day IDEMPOTENCY_EXPIRED; R1 pack unverified (no real numbers); no EP option in the UI (refusal shown with a forged value); no snapshot facts in the browser run (A09 covered by tests 23/38); shell staleness until reload while mounted (shell code); `v6.css` `.v6-targets .chip { color: inherit }` bug is orchestrator-owned (Targets.tsx avoids the class, `Targets.tsx:667`).
6. Integration: TargetsPanel is not reachable until the orchestrator mounts it (`mount-patch.md`). The mount must also handle the shell staleness in item 5.

## 5. Conclusion

All acceptance criteria are met by code and reproducible tests. The evidence is internally consistent: TAP, hashes, scope, red-before-fix fixtures, mount revert and browser log all check out. The orchestrator fixes are correct and complete. ACCEPT, with items 1 and 2 recommended as follow-ups.
