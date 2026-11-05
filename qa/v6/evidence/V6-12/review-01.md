VERDICT: NOT_ACCEPT

# V6-12 independent acceptance review 01

Reviewer: independent read-only acceptance reviewer. Worktree `/private/tmp/patent-v6-worktree`, branch `codex/patent-saas-v6-foundation-origin`, HEAD `953e05d`.
Sources read: `tickets/V6-12.md`, `06-execution-protocol.md`, `specs/S02.md`, the Drawing / FigureSetRevision / gate / activity / error-code parts of `05-contracts.md`, every file in the receipt's `changedFiles`, plus `lib/repository.ts`, `lib/legacy-import.ts`, `features/sources/ingest.ts`, `packages/contracts/src/{matter,records}.ts` and `packages/domain/src/v6/gate.ts`.
Probes live under `/tmp/v612-review/`, outside the repo. They import the real modules and the V6-12 harness. No network. No model calls. `.dev.vars` was not read.

## Commands and exit codes

| Command | Exit | Result |
|---|---|---|
| `npm run test:v6 -- V6-12` | 0 | 30/30 pass, 0 skip |
| `npm run test:v6 -- V6-10` | 0 | 36/36 pass |
| `npm run test:v6 -- V6-11` | 0 | 53/53 pass |
| `./node_modules/.bin/tsc -p apps/web/tsconfig.json --noEmit` | 0 | no diagnostics |
| `/usr/bin/git status --porcelain --untracked-files=all` minus `node_modules`, `.claude/launch.json`, `apps/web/src/v6/routes/V6App.tsx` | 0 | 37 paths; equals receipt `changedFiles` (37) and `scope.txt` (37 lines) exactly |

Write-set: all changed paths are `drawings.ts`, `Figures.tsx` or `qa/v6/{scenarios,evidence}/V6-12/**`, apart from `V6App.tsx` (orchestrator mount, allowed by the brief) and `.claude/`. No other source file is touched.

Browser evidence (`browser-log.json`, `browser-drive.mjs`) is real CDP output: 11 steps ok, 0 console errors.

## Probes and results

1. `image-probe.mjs` + `jpeg-builder.mjs` (JPEG decode coverage)
   - `control-valid-3comp` (40x16, 3 components, interleaved): `ok:true`. Correct.
   - `non-interleaved-dimension-lie`: SOF0 declares 4000x3000 (12 MP, inside the budget), sampling Y 2x2 / Cb 1x1 / Cr 1x1, one non-interleaved Y scan with 47,000 coded blocks. The Y component needs ceil(4000/8)*ceil(3000/8) = 187,500 blocks. Result: `{"ok":true,...,"width":4000,"height":3000}`. **Accepted.**
   - `missing-chroma-scans`: SOF0 declares 3 components, the only scan codes component 1. Result: `ok:true`. **Accepted.**
   - Fixtures `drawing-dimension-lie.jpg`, `drawing-truncated.jpg`, `drawing-restart-order.jpg`: all `BAD_DRAWING`. Correct.
2. `concurrency-probe.mjs` `sameBytesConcurrent` (same bytes, `Promise.all`, run 3 times, same result each time):
   - Both calls return `ok:true, status:"created"`, with different drawing ids and asset ids.
   - `readDrawingLibrary` lists only the second drawing id. `drawingRows: 1`, `drawingAssets: 2`, `sourceCommittedEvents: 2`.
   - The first caller's returned drawing id no longer exists. Its asset is in the aggregate with no drawing row.
3. `concurrency-probe.mjs` `sameBindConcurrent`: one call wins, the other returns `VERSION_CONFLICT`. The pointer row exists. One `figures.bound` event. Correct.
4. `bind-race-probe.mjs` / `bind-race-instrumented.mjs` (delays the first pointer commit by 40 ms to force the loser to write too): the loser read the winner's row before writing, skipped its own write, and got `VERSION_CONFLICT`. No `delete` was logged. `pointerRowExists: true`. **The bind cleanup hazard (see blocker 2, note) did not reproduce.** It is supported by code inspection only.
5. `concurrency-probe.mjs` `deleteLeavesBytes`: after `deleteDrawing`, the 37,028-byte blob is still in the `blobs` store. `readBlob` returns 404 because the asset is gone. The receipt already lists this as `orphanBytesKept`.

## Blockers

### B1. Corrupt JPEGs pass `inspectDrawing` / `importDrawing`, and the export gate then allows them

- Where: `apps/web/src/v6/features/sources/drawings.ts:658-659` (`mcuCols`/`mcuRows` from `hMax`/`vMax` for every scan), `:675-698` (`repeats = interleaved ? h*v : 1`), `:396` (`if (frame === null || seenScans.size === 0)` is the only completeness check).
- What fails: for a non-interleaved scan, ITU T.81 sets the block grid per component: ceil(Xi/8) x ceil(Yi/8), with Xi = ceil(X*Hi/Hmax) and Yi = ceil(Y*Vi/Vmax). The code uses ceil(X/(8*Hmax)) x ceil(Y/(8*Vmax)) with 1 block per MCU. For a 2x2-sampled luma this counts a quarter of the blocks. Also, frame components that no scan codes are never detected.
- Concrete scenario: probe 1. A 4000x3000 JPEG with a quarter of its luma data and no chroma data is imported as a valid 4000x3000 drawing. A real decoder hits EOI early and cannot produce the declared image. `checkFigureExportGate` checks only that the bytes are present and match the digest (`drawingBytesUsable`, `:1768-1792`), so a figure set that binds this drawing exports.
- Why it is a blocker: S02 says a decode failure is `BAD_DRAWING`. V6-12-A02 says corrupt bytes must block figure-dependent export. The module's own doc comment says it refuses declared dimensions that the data cannot support. The receipt marks A02 and the image checks covered. The tests use interleaved fixtures only, so they do not show this.
- Suggested fix: in `decodeBaselineScan`, for a scan with one component compute that component's own grid (ceil(ceil(X*Hi/Hmax)/8) x ceil(ceil(Y*Vi/Vmax)/8), 1 block per MCU). Keep the current MCU grid for interleaved scans. In `verifyJpegScan`, require that every frame component id is in `seenScans` before EOI. Add the two probe files as fixtures (`BAD_DRAWING` expected) and a valid non-interleaved baseline fixture (accepted expected).

### B2. Concurrent import of the same bytes reports two successes but keeps one drawing row

- Where: `drawings.ts` around `:916` (`drawingId = figureId(\`drawing/${matterId}/${sha256}/${matter.version}\`)`) and `:988` (on any failed commit, `await deleteRow(repository, drawingKey(drawingId))`, then retry).
- What fails: two writers that read the same matter version mint the same deterministic drawing id. Both write the same row key. The loser's commit fails with `VERSION_CONFLICT`. The loser then deletes the shared row (which the winner already committed against), retries at the new version, mints a new id and commits a second asset. The sha256 duplicate check runs before the race, so neither call sees the other.
- Concrete scenario: probe 2. Two tabs, or a client retry while the first request is still in flight, import the same PNG. Both get `status:"created"`. Result: 2 assets, 2 `source.committed` events, 1 drawing row. The first caller's drawing id is dangling, and its asset has no row. A UI that binds the id from the first response gets `RESOURCE_NOT_FOUND`/`MISSING_BYTES`.
- Why it is a blocker: V6-12-A03 requires that a retried or completed action matches the persisted state with no duplicate side effects. Here the returned result does not match the persisted state, and the duplicate asset and event are side effects. The A03 concurrency test uses different bytes, so it does not cover this path. The receipt claims "concurrent imports each land once".
- Suggested fix: never delete a row that another writer may share. Either include a per-attempt nonce in the row key (and delete only your own key), or write the drawing row inside the same repository transaction as the asset commit. After a `VERSION_CONFLICT`, re-run the sha256 duplicate check against the new aggregate before retrying, and return `duplicate`/existing when it hits. Add a `Promise.all` same-bytes test that asserts one asset, one row, one event, and that both responses name a drawing that exists.
- Related latent hazard (not reproduced, code inspection only): `bindFigures` at `drawings.ts:~1370` uses the same pattern: `if (!existing.data) await deleteRow(repository, figureSetKey(target.id, revisionId))` with a deterministic revision id. If two identical binds both read "no row" before either writes, both write the same key; the loser's pointer commit fails and it deletes the row the winner's target now points at. Result: the target pointer names a missing row (gate `STALE_BINDING`, history lost). Probe 4 could not force this order in the MemoryBackend, because the follower read the leader's row first. Fix it with the same change as B2.

## Non-blocking findings

1. `filesAvailable` is set to `reasons.length === 0` (`drawings.ts:1756`). `gate.ts:155,178` pushes `MISSING_BYTES` whenever `filesAvailable` is false. A stale binding, a duplicate number or an unaddressed figure, with all bytes present, will therefore also report `MISSING_BYTES` once the export ticket passes this into `evaluateGate`. Set it only from the byte checks.
2. `deleteDrawing` (`drawings.ts:1094-1143`) leaves the blob in the `blobs` store (probe 5). This is documented in the receipt. It needs a purge path per contract §11 before R2.
3. `Figures.tsx:70,80`: `appendEntry` and `removeEntry` reset every existing entry's `numerals` to `[]`. Any numerals bound earlier are silently lost on the next rebind from the panel. This is not reachable in R1 (no target selection), but it will be once targets exist.
4. `ImportDrawingInput.fromAssetId` is copied to `derivedFromAssetId` with no check that the asset exists or belongs to the matter/tenant. The UI never sets it.
5. The receipt says `source.committed` carries `{version}`. The code writes `{}` (`drawings.ts:~976`, `~1131`). Empty metadata is legal under the allowlist. Correct the receipt text, or add `version`.
6. `checkFigureExportGate` surfaces only `DUPLICATE_FIGURE_NUMBER` from `checkFigureNumbers`. A set with more than the maximum figures or a gap in 1..n that reached storage would not block. `bindFigures` refuses those at write time, so it is defence in depth only.
7. The gate takes `referencedFigureIds` from the caller. Nothing in this build derives them from the draft yet. The export ticket must pass `DraftAST` `paragraph.figureIds`.
8. Valid non-interleaved baseline JPEGs with subsampling are mis-counted by the same code as B1. Depending on the order, some valid files may be refused. The B1 fix covers this.
9. A 16 MP 16-bit RGBA PNG inflates to about 128 MB in `verifyPngData`. It is inside the limits, but it is heavy on mobile. Consider a streaming row check.
10. Zlib Adler-32 is not checked, and JPEG coefficient categories are not range-checked. Corruption that keeps the structure valid is accepted. This is low risk, because the file still decodes.
11. Target-bound panel states (bind, stale, gate) cannot be reached in R1 (`targetId={null}` on the upload page, no target creation). This is documented in the receipt limitations. The states that can be reached (loading, empty, library, failed, storage_unavailable) show no fake success and no invented data.

## Receipt rows checked

- V6-12-A01: covered. Delete and re-import give a new drawing id, and a rebind gives a new FigureSetRevision with `parentId`. Correct.
- V6-12-A02: claimed covered. Holds for PNG and the fixture JPEGs. **Fails for B1 inputs.**
- V6-12-A03: claimed covered. Holds for sequential retries and for concurrent imports of different bytes. **Fails for B2.**
- S02-A02 (17 MP to `IMAGE_TOO_LARGE`, no reduced copy): covered by a real 4352x4000 PNG and by the browser run. Correct.
- S02-A08 (bind A invalidates A, B unchanged): covered through the domain functions, with in-memory confirmation records (no record store exists yet). Acceptable.
- S02-A09: partial (drawing `MISSING_BYTES` only). The reason is sound.
- S02-A01, A03, A04, A05, A06, A07, A10: not_applicable. These are document/source behaviours outside drawings. The reasons are sound. Drawings derive MIME from magic bytes, so `MIME_MISMATCH` cannot occur for them. This is consistent with "magic decides".
