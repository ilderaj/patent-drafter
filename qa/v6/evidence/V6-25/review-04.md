VERDICT: ACCEPT

# V6-25 independent acceptance review, round 4

Worktree: `/private/tmp/patent-v6-25-worktree`, branch `codex/v6-25-export`. `HEAD` is `83c0485d5e49446d758fbded29278429875954e4`; the candidate is untracked in the worktree. Reviewed the current candidate and its 34-file evidence set.

## Prior blockers

- **B1/B3, TTL and per-generation expiry:** resolved. I independently reproduced generation 0 expiring and clearing its bytes at day 8, generation 1 expiring and clearing its file and manifest bytes at day 16, and generation 2 being created with a third `export.created` event.
- **B4, stale-snapshot expiry:** resolved. `refresh` now sweeps every stored row for this actor, matter, and target (`export-adapter.ts:867-873`) before snapshot selection. An export created at T0, followed by a snapshot change and an eight-day clock advance, became an `expired` row with zero file bytes and zero manifest bytes. The page showed `stale`, every file view was unavailable, and the views named both `CACHE_EXPIRED` and `STALE_BINDING`. Download refused the old file.
- **B2, post-prepare event failure:** resolved. The existing injected failure is persisted as a `failed` row with the event error, refresh reports `error` with no files, and retry produces exactly one event. The global sweep also ages an untreated failed row into `expired` at day 8 and clears its cached bytes, so the round-2 retention note no longer leaves artifact bytes past the TTL.

## Verification

I independently checked the following against the updated candidate:

- A stale-snapshot export at day 8: seven unavailable file views, both CACHE_EXPIRED and STALE_BINDING present, download refused, persisted row `expired`, file bytes 0, manifest bytes 0, manifest metadata length retained.
- The current-snapshot generation ladder: generation 0 and generation 1 expired and cleared, generation 2 ready, exactly three events and no replay duplicate.
- An expired stale row and an expired failed row both age out under the seven-day sweep.
- The prior artifact claims remain intact: all standalone manifest file entries match downloaded byte lengths and SHA-256 values; claims, specification, and abstract DOCX contain AST content; the PDF is valid output; the patentpack decrypts and retains original figure bytes; the sidecar hash matches; and no `.xml` is present.
- Gate behavior remains intact for missing bytes, stale snapshots, revoked full-read confirmation, blockers, risk acknowledgement, approval-required package kinds, viewer refusal, and preview access.

## Evidence and scope

- `npm run test:v6 -- V6-25` — exit 0; 20 tests, 20 passed, 0 failed, 0 skipped.
- `./node_modules/.bin/tsc -p apps/web/tsconfig.json --noEmit` — exit 0.
- Re-ran V6-24/23/20/19/18/17/16/15/14/12/10/08/05 — exit 0 for each; 302 passed, 0 failed, 0 skipped.
- Receipt and `scope.txt` both list 34 paths and match exactly, all inside the two delivery implementation files and `qa/v6/{scenarios,evidence}/V6-25`; `node_modules` is excluded.
- `V6App.tsx`, `navigation.ts`, `v6.css`, and the V6-01 baseline manifest hashes match base. `mount-hashes.txt` agrees with the current files. No implementation outside the V6-25 write set changed.
- S08 mapping remains honest: A01/A02/A03/A04/A08 covered; A05 owned by accepted V6-24; A06/A07/A09 assigned to V6-26.
- Existing browser evidence remains 5/5 steps with no console errors or external requests. I inspected it and did not rerun the browser harness. The build was inspected, not rerun. No `.dev.vars`, network, provider, or customer material was used.

## Non-blocking observations

- Expired rows retain manifest metadata as an audit record, but their file and manifest bytes are discarded. This matches the receipt's stated retention limitation and S08's requirement to retain the old export record.
- FAILED rows retain prepared bytes only until they are retried or aged out by the sweep. This is now an acceptable retention window.
- `CACHE_EXPIRED` is a local cache/UI reason, not a new §10 GateDecision code. The receipt documents this boundary.
- Done remains unregistered in app navigation and is exercised through a standalone in-memory harness. The receipt discloses the unverified app-route, IndexedDB, and Node 22 coverage.

Round 1 through round 3 blockers are resolved; no new blocking findings were found.
