VERDICT: CHANGES_REQUIRED

## Blockers

1. **Support matching still creates false or empty provenance links.** In [generation.ts](../../../../apps/web/src/v6/features/generation/generation.ts), `bestFactMatch` accepts substring matches at 0.9 and a bigram score of 0.6, `buildSupportIndex` treats a matching chunk ID as sufficient to resolve a ref, and `supportFactForPipelineId` does not reject unresolved matches. The AST builder derives feature status from the provider's status even when no persisted fact resolves, and it does not check the persisted fact's status before marking a feature supported. This does not validate the source ID, chunk hash, quote, or offsets against the live chunk.

   Independent synthetic probes reproduced each case:

   - Changed a persisted fact and its live chunk to the short text `表体`; the provider fact `f2` describing multiple components mapped to that fact by substring match. The generated feature `包括表体、计量部件` was linked to a source quote containing only `表体`.
   - Replaced a fact's ref chunk ID with an absent UUID. The support index listed the fact as unresolved, but the AST still included that fact ID and dangling ref on a feature whose status was `supported`.
   - Marked a persisted fact `unsupported`; the generated feature still linked to it and was marked `supported` because the provider output said `source_backed`.
   - Removed `factId` from a provider-declared `source_backed` feature. The generated AST still marked it `supported` with empty `factIds`, `supportParagraphIds`, and paragraph `sourceRefs`.
   - Kept a live chunk ID but changed the persisted ref's source ID, hash, quote, and offsets. The index marked it resolved and the AST retained the invalid locator.

   The normal persisted-fact fixture also passed: it produced non-empty support and AST links, and changing the fact changed the support output and job input hash. The failing cases show that the mapping can present unsupported, unresolved, mismatched, or untraceable content as supported. The receipt's description of a confirmed-fact index is broader than the implementation's checks.

2. **The cost ceiling is checked between logical pipeline stages, not between provider calls.** `costLimitExceeded` sums completed invocations, while cost metadata is applied after the whole `PipelineAdapter.run` returns. A single logical stage can therefore authorize multiple calls while earlier calls are still `started` and their costs are not included.

   In an independent probe, each provider response reported `costMinor=1` and the job cap was `maxCostMinor=2`. Seven provider calls completed inside the claims pipeline target, for a recorded total of 7, before the next logical stage failed with `JOB_LIMIT_EXCEEDED`. The existing one-call cap case passed, so the defect is specifically within a target that executes multiple pipeline dependencies. A separate unknown-cost probe passed the fail-closed case: the invocation retained `costMinor=null`, `usageUnknown=true`, and the next call was refused. The unknown-cost behavior is sound at a logical-stage boundary; it has the same unaccounted-call window inside a multi-call stage.

3. **The duration ceiling can be exceeded while a job still succeeds, and resume resets the clock.** An independent probe used `maxDurationSeconds=1` and advanced the injected clock by two seconds during the final provider response. The response returned and the job finished `succeeded`; there is no elapsed-time check after that last response before success. A second probe paused after facts/support at 0.7 seconds, recovered the job with a fresh engine, then advanced another 0.7 seconds after resume. The job succeeded at 1.4 seconds total against the one-second cap because `resume` resets `startedAt`.

   The candidate's multi-stage timeout scenario does pass: it stops a job with `JOB_LIMIT_EXCEEDED` when a later stage crosses the limit. It does not cover the final-call overrun or cumulative elapsed time across interruption/resume.

## Non-blocking notes

- The other four round-1 blockers are closed. An independent canonical JSON/SHA-256 calculation matched the generated revision's `astHash` and differed from `payloadHash`. A one-time injected failure on the final revision-state write returned a recoverable save; `loadHeadRevision` returned the committed revision and the next save succeeded from that head.
- The corrected S04-A07 observation matches the exercised test. The test injects invalid `draft_claims` output; facts and support complete, the logical claims stage fails once with `PROVIDER_SCHEMA_INVALID`, and checks/audit_support are not reached.
- Core regression cases passed: queued cancel made zero provider calls; cancellation fenced a late response; completed cancellation was refused; retry reused facts/support checkpoints; interrupted resume revalidated consent; obsolete results were not adopted; repeated adoption produced one revision event; invocation rows contained metadata only; stub mode made no injected-provider calls and could not be adopted.
- The receipt's 24 `changedFiles` paths equal the 24 paths in `scope.txt` after removing its `?? ` prefixes and excluding `node_modules`. `review-01.md` is reviewer-authored evidence and is explicitly excluded from the 23 candidate-authored count in the receipt summary. All candidate paths are inside `features/generation` or the V6-17 scenario/evidence directories; the worktree status contains no other changed paths. The restored route mount hashes match both recorded hashes.
- The five-stage mapping is disclosed accurately at a high level: support is a deterministic index, while pipeline `audit_support` runs under checks. The two `NEEDS_DECISION` items remain disclosed: C11 IndexedDB schema/retention, and mid-run consent-scope drift policy.
- Recorded browser evidence is synthetic stub output. The inspected screenshots show the empty state, queued state, and completed stub state in their named files; the log reports 4/4 steps, no console errors, and no external requests. The receipt correctly says the final code bytes were not re-captured after later engine changes. The recorded build output reports exit 0 with Vite's chunk-size warning; I did not run the build. Node 22 remains unverified; the checks here used Node 25.8.1.
- No real provider or network call was made, and `.dev.vars` was not read. The main checkout was read-only.

## What I ran

- `npm run test:v6 -- V6-17` — exit 0; 28 passed, 0 failed, 0 skipped.
- Direct web TypeScript check: `./node_modules/.bin/tsc -p apps/web/tsconfig.json --noEmit` — exit 0.
- `npm run test:v6 -- V6-16` — exit 0; 14 passed, 0 failed, 0 skipped.
- `npm run test:v6 -- V6-15` — exit 0; 41 passed, 0 failed, 0 skipped.
- `npm run test:v6 -- V6-14` — exit 0; 41 passed, 0 failed, 0 skipped.
- `npm run test:v6 -- V6-10` — exit 0; 36 passed, 0 failed, 0 skipped.
- One-off `/tmp` probes with the fixture repository and counting mock provider for persisted facts, support matching, unknown and reported costs, deadline overrun, resume timing, canonical AST hashing, revision-state fault recovery, and S04-A07 stage mapping. The temporary probe script was removed.
- Inspected the recorded build output, browser log and screenshots, receipt, scope list, prior review, and restored route hashes. I did not run the build.
