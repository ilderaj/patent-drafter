VERDICT: NOT_ACCEPT

# V6-12 independent acceptance review 02

Independent read-only acceptance reviewer. Worktree `/private/tmp/patent-v6-worktree`, branch `codex/patent-saas-v6-foundation-origin`, HEAD `953e05d`. Round 2: both round-1 blockers were verified fixed with new tests, then the ticket was reviewed again from scratch. One new blocker of the same class as round-1 B1 was found: an interlaced PNG with an undecodable filter byte is accepted, stored and allowed to export.

Sources read: `tickets/V6-12.md`, `06-execution-protocol.md`, `specs/S02.md`, the Drawing / FigureSetRevision / gate / activity / error-code parts of `05-contracts.md`; every file in the receipt's `changedFiles`; `apps/web/src/v6/lib/{repository,legacy-import}.ts`; `features/sources/{ingest,parse}.ts`; `packages/domain/src/v6/{revision,confirmation,gate}.ts`; `packages/contracts/src/{matter,records}.ts`.

Probes are in `/tmp/v612-review2/` (outside the repo). They import the real modules and the V6-12 harness. No network. `.dev.vars` was not read.

## Commands and exit codes

| Command | Exit | Result |
|---|---|---|
| `npm run test:v6 -- V6-12` | 0 | 37/37 pass, 0 fail, 0 skip |
| `npm run test:v6 -- V6-10` | 0 | 36/36 pass |
| `npm run test:v6 -- V6-11` | 0 | 53/53 pass |
| `./node_modules/.bin/tsc -p apps/web/tsconfig.json --noEmit` | 0 | no diagnostics |
| `/usr/bin/git status --porcelain --untracked-files=all` minus `node_modules`, `.claude/launch.json`, `apps/web/src/v6/routes/V6App.tsx` | 0 | 42 paths; equals receipt `changedFiles` (42) and `scope.txt` (42 lines) exactly; HEAD is the receipt's `baseCommit` `953e05d` |
| `node /tmp/v612-review/image-probe.mjs` (round-1 probe, re-run) | 0 | B1 inputs now refused; two-bind race now clean (see below) |
| `node /tmp/v612-review/concurrency-probe.mjs` (round-1 probe, re-run) | 0 | same-bytes import: one `created`, one `INVALID_INPUT`, 1 asset / 1 row / 1 event; identical binds agree; orphan bytes on delete still present (known) |
| `node /tmp/v612-review2/image-probe2.mjs` | 0 | 50 malformed/valid image cases; 18 unexpected (blocker B1 below, other rows non-blocking) |
| `node /tmp/v612-review2/history-probe.mjs` | 0 | concurrency, crash origin, branching/broken history, restore interop |
| `node /tmp/v612-review2/size-probe.mjs` | 0 | 16 MP edge timing |

Write set: every changed path is `drawings.ts`, `Figures.tsx`, `qa/v6/{scenarios,evidence}/V6-12/**`, or `V6App.tsx` (orchestrator mount, allowed by the brief). No other source file is touched.

## Round-2 probes

### 1. Round-1 probes re-run (blocker status)

- `non-interleaved-dimension-lie` (4000x3000, one non-interleaved luma scan with 47,000 of 187,500 blocks): `BAD_DRAWING` ("扫描数据提前结束"). **B1 fixed.**
- `missing-chroma-scans` (3 components declared, only component 1 scanned): `BAD_DRAWING` ("扫描没有覆盖帧头声明的全部颜色分量"). **B1 fixed.**
- Concurrent same-bytes import: `created` + `INVALID_INPUT`, library row exists, `drawingRows: 1`, `drawingAssets: 1`, `sourceCommittedEvents: 1`. **B2 fixed.**
- Concurrent identical bind: both answers name the same persisted revision, pointer row exists, one `figures.bound`. **B2 latent bind hazard fixed.**

### 2. Image validation (`/tmp/v612-review2/image-probe2.mjs`, 50 cases)

Accepted correctly: non-interleaved 4:2:0 valid (correct grids; any scan order); interleaved 4:2:0 valid; mixed interleaved Y+Cb then Cr-only scan; DRI=1/2/3 with RST0.. sequences; 16 MP 4:2:0; 16-bit RGBA and gray PNG; 1-bit gray PNG; Adam7 interlaced PNG; SOF1 8-bit.

Refused correctly: non-interleaved luma +8 blocks (too much data) and -4 blocks (too little); interleaved 1 MCU short; chroma-only (no luma scan); same component scanned twice; scan names a component not in the frame; wrong RST order; DRI declared 4 but RST written every 5; truncated mid-scan; junk after EOI; duplicate SOF0; SOF0 precision 12; non-interlaced PNG filter byte 7; one row short/extra; IHDR width/height lies; >16 MP; >8 MiB.

**Accepted but undecodable (blocker B1 below):**

- PNG, Adam7 interlaced, every filter byte 5 or 7. Filter bytes 0-4 are the only legal values; libpng rejects anything else with "bad adaptive filter value". The non-interlaced path checks this (`drawings.ts:295-299`); the interlaced path returns `ok` at `drawings.ts:294` before any row check. All of 0,1,2,3,4,5,7 return `ok:true` on an otherwise valid 33x7 interlaced PNG.
- JPEG frame markers other than SOF0/SOF1: SOF3, SOF5, SOF6, SOF7, SOF9, SOF10, SOF11, SOF13, SOF14, SOF15 are all accepted when the entropy data is baseline-Huffman shaped. Only SOF2 is refused (`drawings.ts:382`). Non-blocking: a genuine arithmetic-coded file cannot carry the DHT the decoder needs, so only crafted/mutated files reach this.
- JPEG frame with duplicate component ids (1,1): accepted. libjpeg refuses ("Duplicate component ID").
- JPEG interleaved scan with 18 blocks per MCU (4x4 + 1x1 + 1x1): accepted. T.81 B.2.3 caps this at 10; libjpeg refuses.
- PNG zlib FCHECK wrong, or FDICT set without a dictionary: accepted (the code checks only the CM nibble, `drawings.ts:279`). zlib would reject these, but no common PNG encoder emits them.
- Interlaced PNG with a correct-length stream whose only defect is the filter byte is the only one of these reachable from a genuinely corrupted file (one flipped byte in the inflated row data).

### 3. Concurrency and idempotency (`/tmp/v612-review2/history-probe.mjs`)

- Two concurrent different binds on one base: one `ok`, one `INPUT_STALE`; pointer names an existing row; one `figures.bound`.
- Three concurrent identical imports: `created`, `INVALID_INPUT`, `INVALID_INPUT`; 1 asset, 1 row, 1 event; every returned `created` id resolves in the library.
- Three concurrent identical binds: all three answers name the live revision; 2 revision rows (seed + one bind); one event.
- Bind with the event-store put faulted: `STORAGE_UNAVAILABLE`, the attempt's nonce row stays (no pointer names it), retry lands once; the retry and a further retry are no-ops.
- Bind racing a delete of the bound drawing: both land; the gate then reports `MISSING_BYTES` and blocks export. No dangling success.
- Cross-tenant delete/gate/panel: `RESOURCE_NOT_FOUND` / `failed`; row untouched. `fromAssetId` naming a deleted asset: `RESOURCE_NOT_FOUND`.

### 4. Nonce ids, depth-ordered history, crash orphans

- History after a crash orphan (row written, pointer never committed): empty set, v1, orphan (parent v1), v2 (parent v1). Order is parent-first even when the orphan's `createdAt` is years earlier. Orphan is listed in `revisions`; gate on it is `STALE_BINDING`; a bind from it is `INPUT_STALE`.
- `restore_bound` over a draft whose recorded set is the orphan: `revision.ts` finds the orphan in `figureSets`, creates a revision with `parentId` = the live set and the orphan's entries. This is consistent with the append-only model, but an orphan becomes restorable history.
- Broken parent link (delete v1 row after the fact): history still lists descendants with a dangling `parentId`; current revision is still resolved; the export gate still passes; the panel still renders `library`. No crash.
- Branching chain (two revisions with the same parent — the orphan and v2): `historyOrder` is stable and parent-first; `readFigureLibrary.revisions` is global, not per-target, so another target's chain is interleaved into one array (the receipt's S02-A08 test filters by target itself).

### 5. 16 MP edge (`/tmp/v612-review2/size-probe.mjs`)

- 4000x4000 RGBA16 PNG: accepted, 286 ms, +385 MB RSS (the 128 MB inflate plus doubling). No crash, but the synchronous main-thread cost is real on mobile.
- 4000x4000 gray and 4:2:0 JPEG: accepted in under 10 ms.
- Exactly 16,000,000 px is accepted; one pixel over is `IMAGE_TOO_LARGE`. Correct boundary.

## Round-1 items: status

| Item | Status |
|---|---|
| **B1** non-interleaved grids + unscanned components | **Fixed.** `decodeBaselineScan` uses the component's own grid (`drawings.ts:693-697`); `verifyJpegScan` requires every frame component (and refuses a component scanned twice) (`drawings.ts:397-402`, `:679-681`). Tests: `drawings.test.mjs:122-149`, with fixtures `drawing-noninterleaved-lie.jpg`, `drawing-valid-noninterleaved.jpg`, `drawing-missing-component-scan.jpg`; `red-before-fix.txt` shows both tests red against the reverted logic. |
| **B2** same-bytes concurrent import / bind cleanup | **Fixed.** Nonce ids (`drawings.ts:971-973`, `:1430-1432`), delete-own-row (`:1048-1049`, `:1450-1452`), duplicate re-check and lost-race loop. Tests `drawings.test.mjs:564-687` cover both `Promise.all` paths, including an instrumented interleaving that forces the bind loser to see "no row". My round-1 probes now pass. |
| 1. `filesAvailable = reasons.length === 0` | **Fixed** (`drawings.ts:1865`). Test `drawings.test.mjs:294-331` asserts true with a stale binding plus an unaddressed figure present. Test would fail against the old line. |
| 2. `deleteDrawing` leaves blob bytes | **Not fixed, documented** (receipt limitations; probe: `blobStillInStore: true`). Needs purge before R2 per contract §11. |
| 3. `appendEntry`/`removeEntry` reset numerals | **Fixed** (`Figures.tsx:71,84`, `copyNumerals`). Tests `figures-ui.test.mjs:191-271` persist, append, remove and reload numerals. |
| 4. `fromAssetId` unchecked | **Fixed** (`drawings.ts:946-966`; requires an available asset of the same tenant/matter). Tests `drawings.test.mjs:462-491`; my probe adds the deleted-asset case. |
| 5. receipt said `source.committed` carries `{version}` | **Receipt text corrected, behaviour unchanged**: code still writes `{}` (`drawings.ts:1015`, `:1208`) although the allowlist permits `version` for both `source.committed` and `source.retired`. See non-blocking 4. |
| 6. gate surfaces only `DUPLICATE_FIGURE_NUMBER` | **Not changed, documented.** Defence in depth only; `bindFigures` refuses gaps and over-limit sets. |
| 7. `referencedFigureIds` from the caller | **Not changed, documented.** Export ticket must pass `DraftAST` `figureIds`. |
| 8. valid non-interleaved subsampled JPEGs mis-counted | **Fixed** with B1; `drawing-valid-noninterleaved.jpg` is accepted. |
| 9. 128 MB inflate for 16 MP RGBA16 | **Not changed, documented.** Measured: 286 ms and +385 MB RSS. |
| 10. Adler-32 / JPEG coefficient categories unchecked | **Not changed, documented.** My probe confirms a wrong Adler is accepted; low risk. |
| 11. target-bound panel states unreachable in R1 | **Unchanged and documented.** All other S02 states are rendered from persisted state and tested. |

## Blockers

### B1 (new). An interlaced PNG with an undecodable filter byte is accepted, stored and allowed to export

- Where: `apps/web/src/v6/features/sources/drawings.ts:294` — `if (interlaced) return { ok: true };` before the only filter-byte loop (`:295-299`).
- Note: line numbers in this file were taken from the reviewed HEAD; a one-line shift does not change the finding.
- What fails: PNG filter types are 0-4 (None, Sub, Up, Average, Paeth). libpng returns "bad adaptive filter value" for any other byte in any pass row, so the image does not decode. The non-interlaced path validates exactly this; the interlaced path validates only the total inflated length.
- Concrete scenario (probe `image-probe2.mjs`, rows "png interlaced, every filter byte 7" and filter values 5/7): build a valid 33x7 8-bit RGBA Adam7 PNG whose pass rows carry filter byte 5 or 7 and whose zlib stream otherwise decodes. `inspectDrawing` returns `ok:true`. `importDrawing` then stores the bytes as a drawing, `bindFigures` accepts the drawing id, and `checkFigureExportGate` returns `allowed:true, filesAvailable:true` because the bytes are present and digest-match. Export produces a drawing that no conforming decoder can render. A single flipped byte in the inflated pass data of a genuine interlaced PNG produces this case.
- Why it is a blocker: S02 ("解码失败为 `BAD_DRAWING`") and V6-12-A02 ("corrupt bytes ... block figure-dependent export"). This is the same class as round-1 B1 (a file the real decoder rejects is vouched for by the module), and it is inside a path this ticket added, with no stated limitation (the receipt's JPEG note does not cover PNG interlace).
- Suggested fix: in `verifyPngData`, replace the early `return { ok: true }` for interlaced data with a row walk over the seven Adam7 passes (same pass arithmetic already used for `expected`), checking each pass row's filter byte with the existing `MAX_PNG_FILTER` check; share one helper with the non-interlaced loop. Add fixtures `drawing-interlaced-bad-filter.png` (filter 7, one pass row; `BAD_DRAWING` expected) and `drawing-interlaced-valid.png` (accepted expected) and a test asserting import refuses with `dump(backend)` unchanged. `red-before-fix.txt` should show the new test red against the current line.

## Non-blocking findings

1. **JPEG coding-process markers are not refused** (`drawings.ts:371-375`, `:437-453`): only SOF2 is rejected (`:382`). SOF3/5/6/7/9/10/11/13/14/15 files whose entropy data is baseline-Huffman shaped are accepted, contradicting the receipt limitation "only SOF0/SOF1; other layouts fail closed". A genuine arithmetic file lacks the DHT the decoder needs, so only crafted files reach this; fail closed on any marker other than 0xC0/0xC1 anyway (one line).
2. **Duplicate frame component ids accepted** (`parseFrame`, `drawings.ts:445-450`): a frame listing component id 1 twice passes; libjpeg refuses. Same one-line class of fix (unique ids).
3. **Interleaved MCU with more than 10 blocks accepted** (`drawings.ts:698-701`): 4x4+1x1+1x1 yields 18 blocks/MCU; T.81 B.2.3 caps at 10 and libjpeg refuses. Reject `sum(h*v) > 10` for an interleaved scan.
4. **Activity metadata** (`drawings.ts:1032`, `:1191`): `source.committed` and `source.retired` write `{}` although the contract allowlist names `version` for both (`repository.ts:190-191`, §7). Round-1 finding 5 was closed by editing the receipt, not the behaviour; the version is at hand at both call sites. `figures.bound {version, count}` is correct.
5. **Interlaced-PNG Adam7 size formula assumes the unfiltered layout**: fine for the size check, but the filter validation in B1's fix must walk pass rows, not the flat stride.
6. **PNG zlib header checks are partial** (`drawings.ts:279`): only the CM nibble is checked; FCHECK and FDICT are not, so a stream zlib would reject is accepted. Low risk; no common encoder produces it.
7. **Extra-row PNG is reported as corrupt, not as a size mismatch**: `inflateRaw(body, expected + 1)` hits the cap and maps to "无法解压，文件已损坏". The refusal is correct; only the message is less precise. Optional.
8. **Orphan rows are restorable history**: a crash between row write and pointer commit leaves a revision that `readFigureLibrary` lists and `revision.ts restore_bound` can find and copy (`history-probe` 4a/4d). Harmless while `historyOrder` keeps parent order, but if a crash-sweep is added (receipt limitation) it must consider drafts that recorded an orphan. A revision row whose parent row was deleted keeps a dangling `parentId`; the panel and gate cope (probe 4e).
9. **`historyOrder` can put a row before its parent after a crash**: an attempt whose row was written but whose parent row was never written (the parent commit never happened) orders at depth 0, so the history is not strictly append-ordered. Not reachable through the public API in one session; noted for the R2 sweep.
10. **`readDrawingLibrary` sorts by drawing id** (`drawings.ts:1138`) although the function documents "oldest first" (`:1107`); ids are random UUID-shaped, so the order is stable but not chronological. Display-only.
11. **`removeEntry` keeps the old default title**: after renumbering, a figure titled `图2` can become figure 1 still titled `图2` (the UI hides a title equal to `图{number}`, so it shows once). Cosmetic; S02 does not require title renumbering.
12. **Synchronous 16 MP inflate on the main thread**: 286 ms and about +385 MB RSS for a 4000x4000 RGBA16 PNG (measured). Inside the limits and documented; a streaming row check is the R2 follow-up.

## Receipt rows checked

- V6-12-A01: covered and true (delete + re-import = new drawing, new revision with `parentId`, old row deep-equal).
- V6-12-A02: covered and true for the fixtures and the new B1 JPEG cases; **fails for the new interlaced-PNG B1 case** (accepted, so the gate does not block).
- V6-12-A03: covered and true (sequential and concurrent retries, different and identical bytes, bind races; re-run probes agree).
- S02-A02: covered by a real 4352x4000 PNG and the browser run; my probe confirms the 16 MP boundary.
- S02-A08: covered through the real `confirmation.ts` / `gate.ts` / `revision.ts` functions, including `restore_bound` and `adoptInputs` on persisted ids; no invented state.
- S02-A09: partial with a sound reason (drawing `MISSING_BYTES`; asset-status display belongs to the source surface).
- S02-A01, A03, A04, A05, A06, A07, A10: not_applicable; the reasons match which ticket owns each row.
