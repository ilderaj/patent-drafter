VERDICT: CHANGES_REQUIRED

# V6-25 independent acceptance review, round 3

Worktree: `/private/tmp/patent-v6-25-worktree`, branch `codex/v6-25-export`. `HEAD` remains `83c0485d5e49446d758fbded29278429875954e4`; the candidate is untracked. This round covers the updated candidate in the worktree.

## Round-2 blocker

**B3, per-generation expiry, is fixed for generations bound to the current snapshot.** I independently ran the full generation ladder: create generation 0 at T0; refresh at day 8 and verify its bytes were cleared; regenerate generation 1; refresh at day 16 and verify its file and manifest bytes were cleared; regenerate generation 2; replay generation 2. It produced three `export.created` events total, and the replay added none. The existing V6-25 suite also includes the day-8/day-16 expiry case.

## Blocker

### B4. Expired exports for an older snapshot are never purged

`refresh()` builds its expiry candidates only from rows whose manifest snapshot matches the current snapshot (`export-adapter.ts:867-874`). Rows for an older snapshot are instead selected through the `stale` path (`export-adapter.ts:883-885`) and never passed to `markExpired`. The seven-day cache rule applies to export files generally (`specs/S08.md:39`); S08's requirement to preserve an old export record after a snapshot change (`specs/S08.md:38`) can be met by retaining its manifest metadata while clearing its cached bytes.

**Reproduction:** I created an export at T0, incremented the matter `sourceVersion` so the export became stale, advanced the injected clock to T0 + 8 days, and called `session.refresh()`. The row remained `state: "ready"` with 112,630 cached file bytes. `session.download()` correctly refused the old file with `CACHE_EXPIRED`, but it did not purge the row. The page showed the stale snapshot while the expired file bytes remained in storage.

Expiry cleanup must include stale-snapshot rows too. Preserve their manifest metadata for the stale record, while clearing expired file and manifest bytes and showing the expired reason.

## Non-blocking notes

- **Injected event failure now has the expected visible and retry behavior.** The refreshed V6-25 scenario injects a failed `export.created` commit; the row becomes `failed`, refresh reports `error` without files, retry succeeds, and one event is written. The rerun passed this scenario.
- **Failed rows retain prepared bytes.** The receipt explicitly documents that failed rows keep prepared bytes until replaced or deleted and excludes them from the successful-cache TTL (`receipt.json:304`). This is a separate retention choice from the stale ready-row expiry blocker above. Failed artifact bytes are not shown or downloadable, but a cleanup policy remains advisable because the retry path rebuilds artifacts rather than reading these bytes.
- The receipt and `scope.txt` match at 33 paths; `node_modules` is excluded. All paths remain within the two delivery modules and V6-25 scenario/evidence directories. The baseline manifest and shared route/mount file hashes still match base. Candidate status remains uncommitted at the integration commit.
- Existing browser evidence remains a standalone in-memory harness, with no app-route registration or native IndexedDB coverage. The receipt states these limitations. I inspected prior browser evidence; I did not rerun it.

## What I ran

- `npm run test:v6 -- V6-25` — exit 0; 19 tests, 19 passed, 0 failed, 0 skipped.
- `./node_modules/.bin/tsc -p apps/web/tsconfig.json --noEmit` — exit 0.
- Re-ran V6-24/23/20/19/18/17/16/15/14/12/10/08/05 — exit 0 for each; 302 passed, 0 failed, 0 skipped.
- Independent generation-ladder probe through day 16, including byte-clearing assertions for generations 0 and 1, generation 2 creation, and replay/event idempotency.
- Independent stale-snapshot expiry probe described above.
- Inspected receipt/scope and mount hashes. Did not run the build or browser harness. No `.dev.vars`, network, real provider, or customer material was used.

Summary: Standards: no new documented-standard issue. Spec: 1 blocker remains—seven-day cache expiry does not purge exports whose snapshot is stale.
