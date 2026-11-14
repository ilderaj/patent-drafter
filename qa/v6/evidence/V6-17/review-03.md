VERDICT: CHANGES_REQUIRED

## Blockers

1. **Fact normalization can equate different numeric values and create a false supported link.** In `apps/web/src/v6/features/generation/generation.ts`, `normalizedText` removes every punctuation and symbol character before `bestFactMatch` tries exact equality or a strict match. That removes decimal points, signs, and other operators that can change a technical value.

   Independent `/tmp` reproduction: I changed a valid persisted fact and its live chunk to `阈值为1.5mm`, recalculated the chunk hash, and updated the quote and code-point offsets. The mock extraction then returned pipeline fact `f2` with statement `阈值为15mm`, and the draft feature used the same `阈值为15mm` text and `factId=f2`. The support index marked `f2` resolved to the persisted `1.5mm` fact. The resulting AST marked the `15mm` feature `supported` and linked it to that fact and its valid source reference. This is a false positive with a traceable but semantically contradictory locator. Preserve meaning-bearing numeric punctuation/operators during normalization or otherwise refuse this match before accepting V6-17.

## Non-blocking notes

- The other round-02 reproductions now reject unsafe links: a short substring does not map the multi-component provider fact; an absent chunk UUID, persisted `unsupported` fact, missing provider `factId`, and altered source ID/hash/quote/offset/page do not produce a supported link to the invalid fact or an invalid AST locator. The ordinary fixture still produces 3 supported features and 6 AST references; I checked each reference against its live chunk and exact persisted fact reference.
- The cost probe with `maxCostMinor=2` and unit cost stops after two calls within the multi-call claims stage. An unknown-cost call fails closed after one call and sets `usageUnknown=true`.
- A two-second advance during the final provider response under a one-second cap fails with `JOB_LIMIT_EXCEEDED`; interruption after 0.7 seconds plus a further 0.7 seconds before resume also fails cumulatively without another provider call.
- Core regressions passed: late-response and queued cancellation, retry checkpoint reuse, interrupted resume consent validation, `obsolete_result`, repeated adoption, invocation metadata, and stub non-adoptability. I additionally called `adopt` on a completed stub job; it returned `CAPABILITY_UNAVAILABLE`.
- Strict matching remains conservative and can leave paraphrases unmapped. That false-negative tradeoff is acceptable under the stated criteria; the normal fixture remains linked and traceable.
- Receipt and scope list contain the same 25 paths after excluding `node_modules`. The worktree has 26 porcelain entries including that excluded directory. All candidate paths are under `apps/web/src/v6/features/generation/`, `qa/v6/scenarios/V6-17/`, or `qa/v6/evidence/V6-17/`; there are no modified tracked paths outside those areas. The two recorded route mount SHA-256 values match the current files.
- The receipt’s S04 mapping matches the spec at a high level: facts → `extract_invention_facts`, support → deterministic index, claims → `draft_claims`, specification → `draft_abstract`, checks → `export` (including the audit stages). S04-A01–A05 are disclosed as not applicable for the R1 slice; A06–A10 are marked covered with observations. The C11 IndexedDB schema/retention question and mid-run consent-scope drift policy remain disclosed as `NEEDS_DECISION`.
- Recorded browser evidence is synthetic stub output. The screenshots show the empty panel, queued panel, and completed stub preview; the browser log records 4/4 steps, no console errors, and no external requests. The receipt accurately says the final engine bytes were not re-captured after later changes. The recorded build evidence says exit 0 with Vite’s chunk-size warning; I did not run the build. Node 22 remains unverified; the recorded runs used Node 25.8.1.
- The provider-status probe also showed that an extraction fact labelled `unsupported` can map by statement to a valid, linkable persisted fact. I did not count this as a separate blocker because the resulting provenance is still anchored to the persisted fact’s validated reference and persisted status.

## What I ran

- `npm run test:v6 -- V6-17` — exit 0; 36 passed, 0 failed, 0 skipped.
- `./node_modules/.bin/tsc -p apps/web/tsconfig.json --noEmit` — exit 0.
- `npm run test:v6 -- V6-16` — exit 0; 14 passed, 0 failed, 0 skipped.
- `npm run test:v6 -- V6-15` — exit 0; 41 passed, 0 failed, 0 skipped.
- `npm run test:v6 -- V6-14` — exit 0; 41 passed, 0 failed, 0 skipped.
- `npm run test:v6 -- V6-10` — exit 0; 36 passed, 0 failed, 0 skipped.
- Independent synthetic `/tmp` probes in `/tmp/v6-17-review-03-probes.mjs` for support matching, locator integrity, per-call and unknown cost, final-response overrun, cumulative resume timing, and normal-fixture traceability. The probes passed their expected assertions and exposed the numeric false positive above.
- Independent stub-adoption probe — exit 0; the engine refused adoption with `CAPABILITY_UNAVAILABLE`.
- Inspected the receipt, scope list, S04 mapping, `NEEDS_DECISION` items, recorded build/browser evidence and screenshots, and mount hashes. I did not run a build, call a real provider, make network requests, or read `.dev.vars`.
