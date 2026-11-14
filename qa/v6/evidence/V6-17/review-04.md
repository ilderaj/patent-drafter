VERDICT: CHANGES_REQUIRED

# V6-17 Independent Acceptance Review — Round 4

## Blockers

1. **The V6-17 test count does not match the stated gate or receipt.** I ran `npm run test:v6 -- V6-17` in the requested worktree. It exited 0 with 37 passed, 0 failed, and 0 skipped. The saved `runner.tap` also records 37 tests, while `receipt.json` records 36 tests and 36 passes. The acceptance instruction requires 36/36. The extra passing test is `V6-17 A03: exported revision seam loads head and CAS-saves an edited DraftRevision`. Reconcile the expected suite count and receipt before acceptance; the run is successful, but its recorded count does not satisfy the stated 36/36 gate.

## Non-blocking notes

- The round-3 numeric false positive is fixed. `normalizedText` uses NFKC, lowercase, and whitespace removal while preserving punctuation. My independent `/tmp` engine probe changed a persisted fact and its live chunk together, recalculating the chunk hash and locator, then supplied provider facts and claim features. `阈值为1.5mm` versus `阈值为15mm` remained unresolved; the feature had no fact IDs, support paragraph IDs, or source link. Exact text mapped and produced a supported feature. Full-width `１．５` and whitespace variants mapped. `1,5mm` versus `15mm`, `+1.5` versus `1.5`, and `1.5mg` versus `1.5g` were rejected without links.
- Support traceability and false-link tests pass: a short substring, absent chunk, persisted `unsupported` fact, missing feature `factId`, and altered source ID/hash/quote/offsets do not create supported links or dangling references. The normal fixture carries fact IDs, validated source references, and support paragraph IDs.
- Cost and duration checks pass, including a per-call cap inside a multi-call stage, unknown-cost fail-closed behavior, final-response overrun, and cumulative duration across interruption and resume. The canonical AST hash, revision-state recovery, retry checkpoint reuse, S04-A07 schema failure behavior, stale-result handling, late and queued cancellation, consent-checked resume, explicit adoption, repeated-adoption idempotence, and stub non-adoptability also pass.
- Other requested runs passed: direct web TypeScript check; V6-16 14/14; V6-15 41/41; V6-14 41/41; V6-10 36/36. Each suite had 0 skipped tests and exited 0.
- Receipt/scope audit passed for the candidate snapshot: 26 receipt paths equal 26 scope paths after excluding `node_modules`; every listed file exists, and review-01 through review-03 are included. The worktree has no tracked modifications and its untracked candidate content is confined to the V6-17 feature, scenario, and evidence directories, plus excluded `node_modules`. This review-04 report is the reviewer output and is not part of that candidate snapshot count.
- Both current route mount hashes match the receipt's original and reverted SHA-256 values: `V6App.tsx` `8b7292a799c951cbd25f9311e523557cbe56209e2d47732f74a71750d2e20be5`; `navigation.ts` `ccbc78d67d51e8980bf1f513edb0e1a5ce0f75f890cb99980669380f8177d7e3`.
- The S04 mapping and `NEEDS_DECISION` items match the cited specs. S04-A01–A05 are disclosed as not applicable to the R1 slice; A06–A10 are marked covered with observations. The C11 IndexedDB schema/retention decision and mid-run consent-scope drift policy remain disclosed.
- Recorded build evidence says exit 0 with Vite's chunk-size warning; I did not run a build. Browser screenshots and log show synthetic stub output on a temporary demo mount, 4/4 recorded steps, no console errors, and no external requests. The receipt discloses that the browser capture predates later engine changes. No real provider or network call was made. Node 22 remains unverified; the receipt says recorded runs used Node 25.8.1.

## What I ran

- `npm run test:v6 -- V6-17` — exit 0; 37 passed, 0 failed, 0 skipped. The count mismatch above is the blocker.
- `./node_modules/.bin/tsc -p apps/web/tsconfig.json --noEmit` — exit 0.
- `npm run test:v6 -- V6-16` — exit 0; 14 passed, 0 skipped.
- `npm run test:v6 -- V6-15` — exit 0; 41 passed, 0 skipped.
- `npm run test:v6 -- V6-14` — exit 0; 41 passed, 0 skipped.
- `npm run test:v6 -- V6-10` — exit 0; 36 passed, 0 skipped.
- Independent synthetic `/tmp` probes through the generation engine for exact, numeric-difference, NFKC, whitespace, comma, sign, and unit variants. All assertions passed.
- Inspected the receipt, scope, review-03 findings, scenarios, generation implementation, recorded build/browser evidence and screenshots, S04 mapping, decisions, and route mount hashes. I did not read `.dev.vars`, run a build, use real provider credentials, or make network requests.
