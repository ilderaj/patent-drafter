VERDICT: CHANGES_REQUIRED

# V6-25 independent acceptance review, round 2

Worktree: `/private/tmp/patent-v6-25-worktree`, branch `codex/v6-25-export`. `HEAD` is exactly `83c0485d5e49446d758fbded29278429875954e4`; the candidate remains untracked. This round reviews the updated candidate files and 32-file evidence set.

## Prior blockers

- **B1, seven-day expiry:** partially fixed. A single aged export is now marked `expired`, its file and manifest bytes are cleared, refresh shows a stale/CACHE_EXPIRED state, and old downloads return `CACHE_EXPIRED`. Regeneration advances a generation key and writes a new manifest and event. However, the TTL stops working after the first renewal (B3 below).
- **B2, event-write failure after prepare:** fixed for the reviewed path. The prepared row is marked `failed` with the event error, refresh reports `error` with no files, and retry completes with exactly one `export.created` event. The failed row's retained bytes are noted below.

## Blocker

### B3. A second cache generation never expires

`refresh` chooses only the first expired row as its expiry candidate (`export-adapter.ts:869`). Once generation 0 is already `expired`, `expired` is non-null forever; the `!expired && aged` guard at `export-adapter.ts:871` therefore prevents generation 1, generation 2, and later rows from ever being marked expired or having their bytes cleared. Their page status is also not changed: `current` is computed from rows whose `createdAt` is not expired (`export-adapter.ts:875`), but an aged row is not excluded from `currentFiles`, so refresh reports it `ready` after its seven-day TTL.

**Reproduction** (synthetic V6-24 fixture, injected clock):

1. Create an export at `T0`; refresh at `T0 + 8 days`: generation 0 is `expired`, its file bytes are zero, and download returns `CACHE_EXPIRED`.
2. Call `createExport()`: generation 1 is generated with a new manifest and event.
3. Advance the clock to `T0 + 16 days` and call `refresh()`.
4. Generation 1 remains `state: "ready"` with 112,631 bytes of cached artifact data. `download()` refuses it with `CACHE_EXPIRED`, so the page and persistence disagree: refresh offers `ready` files that cannot be downloaded, and the seven-day byte-retention rule is not enforced.

S08 requires the cache to expire after seven days and to be regenerable from the same snapshot (`specs/S08.md:39`). The first renewal works; every later renewal leaks cached bytes and reports a ready state. Expiry candidates should be derived per row, not gated on whether any earlier expired row exists, and `currentFiles` should exclude rows that are past TTL even if persistence cleanup failed.

## Non-blocking notes

- **Failed rows retain artifact bytes indefinitely.** After an injected `export.created` failure, the `failed` row keeps all prepared file bytes and a six-entry manifest. At `T0 + 8 days`, refresh still reports `error` and the row still holds 112,631 bytes; the failed path is outside the TTL cleanup. This is consistent with the stated retry design and is not the B1 renewal bug, but a failed export that is never retried leaves cached content beyond the seven-day policy. A follow-up should either clear failed-row bytes at TTL or document retention as an audit policy.
- **Expiry and regeneration behavior otherwise match the claim.** The regenerated DOCX is byte-identical for the same snapshot, the patentpack changes because it is re-encrypted with a new timestamp, the manifest ID changes, and exactly one new event is added. Replaying the regenerated generation does not add another event.
- **The other round-1 evidence remains valid.** V6-25 passes 18/18 with 0 skips. All six standalone manifest entries re-hash to their downloaded bytes; original figure bytes match both as a standalone file and inside the decrypted patentpack; XML remains `FORMAT_UNAVAILABLE` with no `.xml`; and stale snapshot, missing bytes, blocker, approval, confirmation, and viewer gates behave as before.
- **Scope is honest.** The receipt and `scope.txt` both list 32 paths: the two implementation files, two V6-25 scenario files, 27 evidence artifacts, plus this review's predecessor `review-01.md`. `node_modules` is excluded. Shared route files and the baseline manifest hash match base. The candidate is still uncommitted at the integration commit.
- **Existing browser evidence is unchanged and consistent.** It reports 5/5 steps, no console errors, and no external requests. The screenshots show the empty, exported, and stale states. I did not rerun the browser harness or the build.

## What I ran

- `npm run test:v6 -- V6-25` — exit 0; 18 tests, 18 passed, 0 failed, 0 skipped.
- `./node_modules/.bin/tsc -p apps/web/tsconfig.json --noEmit` — exit 0.
- Re-ran V6-24/23/20/19/18/17/16/15/14/12/10/08/05 — exit 0 for each; 302 passed, 0 failed, 0 skipped.
- Independent 8-day and 16-day expiry/regeneration probe, plus injected `export.created` failure and retry probe, using the existing synthetic harness.
- Verified receipt/scope equality and the shared mount hashes. Did not run the build or browser harness; no `.dev.vars`, network, provider, or customer material was used.

Summary: Standards: no new documented-standard breach; the duplicated-manifest construction observation from round 1 remains a non-blocking judgment call. Spec: B1's single-export path is fixed, but B3 leaves the seven-day TTL incomplete for subsequent generations.
