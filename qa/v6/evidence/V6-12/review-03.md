VERDICT: ACCEPT

# V6-12 review-03 — independent acceptance review (round 3)

Reviewer: independent agent. Worktree `/private/tmp/patent-v6-worktree`, branch
`codex/patent-saas-v6-foundation-origin`, HEAD `953e05dc6f8026bfa85f1f2d7a2cb6d6ba9aaf47`
(= receipt `baseCommit`). Read-only: this file is the only repo write. Probes live in
`/tmp/v612-review3/`. No source, test, fixture, receipt or earlier review was modified.
Verdict decided from fresh runs against `qa/v6/scenarios/V6-12/drawings.test.mjs`,
`apps/web/src/v6/features/sources/drawings.ts`, `tickets/V6-12.md` and `specs/S02.md`.

## 1. Required commands (exit codes)

| # | Command | Exit | Result |
|---|---|---|---|
| 1 | `npm run test:v6 -- V6-12` | 0 | tests 42, pass 42, fail 0, **skipped 0**, todo 0 |
| 2 | `npm run test:v6 -- V6-10` | 0 | tests 36, pass 36, fail 0, skipped 0 |
| 3 | `npm run test:v6 -- V6-11` | 0 | tests 53, pass 53, fail 0, skipped 0 |
| 4 | `./node_modules/.bin/tsc -p apps/web/tsconfig.json --noEmit` | 0 | no output (0 bytes) |
| 5 | `/usr/bin/git status --porcelain --untracked-files=all` filtered of `node_modules` and `.claude/launch.json` | 0 | 48 paths |

Change-set check (script `/tmp/v612-review3/compare-status.py`): filtered status = 48 paths,
receipt `changedFiles` = 48 paths, `onlyInStatus` = `[]`, `onlyInReceipt` = `[]` (exact set
equality). No `.claude/*` path survives the filter. `git hash-object
apps/web/src/v6/routes/V6App.tsx` = `c997eeae5517e9bd6731b76776f605f666e6520e`, matching the
receipt's blob claim. `review-01.md` (79 lines) and `review-02.md` (126 lines) are both present.

## 2. Blocker-round verification

### 2.1 Interlaced PNG filter bytes (review-02 B1) — FIXED

Code: `apps/web/src/v6/features/sources/drawings.ts` `verifyPngData` (229-300) builds
`passRows` from `ADAM7` (`ceil((dim - start)/step)` per pass, stride
`1 + ceil(passWidth*channels*depth/8)`, empty passes skipped), then unconditionally calls
`verifyPngRowFilters` (315-328), which walks every row of every pass in stream order,
refuses `rows[offset] > 4` (`MAX_PNG_FILTER = 4`) and asserts
`offset === rows.byteLength` at the end. The review-02 early return is gone.

Probe `/tmp/v612-review3/png-probe.mjs` drives the real `inspectDrawing`/`importDrawing`
over independently built files (`png-build.mjs`: own CRC32/Adler32/stored-deflate, Adam7
geometry written from RFC 2083). Exit 0. Summary:

```
{"valid":21,"corrupt":69,"validMismatches":[],"corruptAccepted":[],
 "corruptWrongCode":[],"refusedAcceptedAtImport":[],"storageUnchanged":true,
 "validRejectedAtImport":[]}
```

| Case group | Count | Expected | Actual |
|---|---|---|---|
| Valid interlaced: 1x1, 1x7, 7x1, 2x2, 3x3, 4x4, 5x5, 8x8, 9x2, 2x9, 33x7, 17x13 (RGB8); 1-bit gray; palette d1/d8; RGB16, gray16, RGBA16 | 20 | import, dimensions from data | all accepted, all imported |
| Same bytes with **every row of every pass in turn** (33x7 = 14 rows across passes 0-6) set to filter 5, 6 and 7 | 42 | `BAD_DRAWING`, import refuses, storage unchanged | 42/42 refused, all `BAD_DRAWING`, import wrote nothing |
| First row of each of the 7 passes x filter 5/6/7 | 21 | refused | 21/21 refused |
| Corrupt filter in 1-bit gray, palette d8, RGBA16 interlaced | 3 | refused | 3/3 refused |
| Non-interlaced row filter 5/6/7 | 3 | refused | 3/3 refused |
| Valid non-interlaced 16x8 | 1 | import | imported |

Independent decoders, same files:
- Pillow 12.1.0 (libpng) `/tmp/v612-review3/pillow-check.py`: exit 0,
  `{"checked":90,"valid_decode_failures":[],"corrupt_files_pillow_accepted":[]}` — libpng
  rejects exactly the files the module rejects.
- Causality control: a no-op re-encode decodes in Pillow and is accepted by the module; a
  single filter-7 mutation fails Pillow (`OSError: unrecognized data stream contents`) and
  is `BAD_DRAWING` here. So both decoders fail on the same byte.
- Independent libpng-encoded interlaced files from ImageMagick (`/tmp/v612-review3/im-png/`),
  including `rgba16-5x5-i.png` (depth 16, colour 6, interlace 1), `gray1-5x5-i.png`
  (depth 1, colour 0) and `palette8-9x3-i.png` (depth 2, colour 3): all accepted and
  imported by the module, all decoded by Pillow. `sips` was not used as evidence.

Pass strides equal libpng's expectations: for every accepted file the inflated length
equals `sum(passHeight * (1 + ceil(passWidth*channels*depth/8)))`, and libpng decodes those
same files without complaint, including sub-8-pixel widths and heights below 5.

### 2.2 JPEG frame markers (review-02 non-blocking 1) — FIXED

Code: `verifyJpegScan` (368-443) treats only `0xC0-0xCF` minus `0xC4` (DHT), `0xC8` (JPG),
`0xCC` (DAC) as frame markers; of those only `0xC0`/`0xC1` are parsed, everything else is
`BAD_DRAWING` (`0xC2` keeps the progressive message). Probe `/tmp/v612-review3/jpeg-probe.mjs`,
exit 0: `expectedAcceptButRefused: []`, `expectedRejectButAccepted: []`, `acceptedWrongCode: []`.

| Case | Expected | Actual |
|---|---|---|
| SOF0 baseline, SOF1 extended-sequential, 3-component interleaved | accept | accept |
| `ff c4` no-op segment inserted before SOS | accept | accept |
| `ff c8` no-op segment inserted before SOS | accept (must not be read as a frame) | accept (no frame parse) |
| `ff cc` no-op segment inserted before SOS | accept | accept |
| SOF2, SOF3, SOF5, SOF6, SOF7, SOF9, SOF10, SOF11, SOF13, SOF14, SOF15 | `BAD_DRAWING` | 11/11 `BAD_DRAWING` |

Import path on a fresh store (`/tmp/v612-review3/jpeg-import-refused.mjs`, exit 0): the 16
refused files all return `BAD_DRAWING`, `storageUnchangedAfterRefused: true`; all 10
accepted files import. Note the earlier in-probe `skip-empty-dht` `INVALID_INPUT` and
`storageUnchanged: false` were probe artefacts, not module behaviour: an empty C4 insert is
byte-identical to `skip-c4` (`cmp` = IDENTICAL), so the second import correctly hit the
sha256 duplicate guard at `drawings.ts:976-989`; accepted imports in the same store also
change the dump by design.

Pillow/libjpeg cross-check (`/tmp/v612-review3/pillow-jpeg.py`, exit 0) agrees on every
accepted file and on all `BAD_DRAWING` frames except two leniencies of libjpeg (it decodes
SOF9 and the duplicate-id file, which this module refuses — the module being stricter is fine
and matches the receipt limitation). One inverse case is a finding, see 4.3.

### 2.3 Duplicate component ids — FIXED

`parseFrame` (473-493): `if (components.some(c => c.id === id)) return null;`.
Probe: `duplicate-1-1` (component 1 twice), `duplicate-1-2-1` (three declared, first and
third id 1) and `duplicate-mutated` (a valid 3-component file with the second id byte
rewritten to 1) all `BAD_DRAWING` ("JPEG 的帧头无效。"), and import on a fresh store writes
nothing.

### 2.4 Interleaved MCU block cap — FIXED

`decodeBaselineScan` (692-788) refuses an interleaved scan when the frame components sum
`h*v > 10`; non-interleaved scans use the component's own block grid and skip the check.

| Case | Expected | Actual |
|---|---|---|
| 4x1 + 4x1 + 2x1 = exactly 10 data units, 32x8 interleaved | accept | accept |
| 4x1 + 4x1 + 3x1 = 11 data units | `BAD_DRAWING` | `BAD_DRAWING` |
| 4x4 + 1x1 + 1x1 = 18 data units | `BAD_DRAWING` | `BAD_DRAWING` |
| Same 4x4 frame scanned non-interleaved, one scan per component | accept | accept |
| Non-interleaved with DRI=2 and 2x2 luma | accept | accept |

### 2.5 Activity metadata versions — FIXED

`storeDrawing` now emits `source.committed` with `{ version: aggregate.matter.version + 1 }`
(drawings.ts:1079), `deleteDrawing` emits `source.retired` the same way (1238), and
`writeTargetPointer` emits `figures.bound { version, count }` (1562). Probe
`/tmp/v612-review3/activity-probe.mjs` wraps `repository.commit`, runs concurrent imports,
concurrent deletes (then retries the conflicted ones), and concurrent binds on both targets.
Exit 0:

```
landedVersions:  [2,3,4,5,6,7,8,9,10,11,12]
evVersions:      [2,3,4,5,6,7,8,9,10,11,12]
finalVersion: 12, duplicates: [], gaps: [],
eventVersionNotMatchingLandedCommitWithSameAction: []
figuresBound: [{version: 11, count: 2}, {version: 12, count: 1}]
metadataKeys: ["source.committed:version","source.retired:version","figures.bound:count,version"]
```

Every event version matches a commit that actually landed, with the same action; no duplicate
and no gap. Retried binds append no second `figures.bound`. `figures.bound` still carries
`{version, count}` and no extra key. Conflict retries were exercised for real: the wrapper
observed VERSION_CONFLICT on losing attempts (1-3 per run) and the winners' event versions
were the winning versions, including a commit that retried from version 5 to 6 and one from
7 to 8.

## 3. Acceptance rows (tickets/V6-12.md), verified directly

| Row | How verified | Result |
|---|---|---|
| V6-12-A01 delete + re-import ⇒ new drawing and new figure-set version | `/tmp/v612-review3/acceptance-probe.mjs` (exit 0): import same bytes → delete → re-import; both `created`, different drawing and asset ids, matter 3→5, new figure-set revision after rebinding; plus suite test at drawings.test.mjs:279 | pass |
| V6-12-A02 corrupt/missing bytes block figure-dependent export | Same probe: gate after delete = `allowed:false, MISSING_BYTES`; a referenced figure the set does not address = `RESOURCE_NOT_FOUND`; after rebinding to the new drawing = `allowed:true`; plus suite tests at :355, :366, :381, :398, :437 | pass |
| V6-12-A03 refresh/retry consistent with persisted state, no duplicate side effects | Suite tests at :615, :632, :649, :668, :682, :719, :793 pass; activity probe: retried binds return the same revision and append nothing; failed imports leave `drawingRows == drawingAssets` (no orphan) | pass |
| S02 size limits, bad decode | Suite tests S02-A02 (17 MP refused, no downsampled copy, :255) and 8 MiB (:269); probes confirm 16 MiB-adjacent pixel counts are refused as `IMAGE_TOO_LARGE` | pass |

## 4. Non-blocking findings

Severity is my judgement; none of these is a failure of a V6-12 acceptance row or of S02,
and none blocks acceptance.

1. **Low — zlib FCHECK/FDICT still unchecked.** `/tmp/v612-review3/r2-image-probe2.txt` still
   shows `png zlib header FCHECK wrong` and `png zlib FDICT preset dictionary set` accepted.
   This is a byte-level nit inside the container that the IDAT walk does not inspect; Node's
   inflate ignores the header. The receipt now lists it as a limitation (fixRound2 finding 5,
   "No change, documented"). **Does not block.**
2. **Low — a `ff c8` (JPG) segment is skipped, and libjpeg then refuses the file.** Probe
   `skip-c8` is accepted by `verifyJpegScan` (correct: C8 is not a frame marker) but Pillow
   fails with `OSError: broken data stream`. So the module can accept a file the browser
   will not render. It is a crafted-byte case only, and the ticket only requires that C8 not
   be mistaken for a frame. **Does not block.**
3. **Low — the MCU cap counts frame components, not the scan's component list.** The code
   applies `sum(frame.components.h*v) > 10` to every interleaved scan; T.81 B.2.3 counts
   only the units in that scan. For a 3-component frame with a 2-component interleaved scan
   this is stricter than the standard. My builder always writes one scan per file, so I could
   not construct that case; it is a code-reading observation only. Fail-closed and outside the
   ticket's scenarios. **Does not block.**
4. **Low — 6-way concurrent imports on one matter can exhaust the retry budget.** With
   `FIGURE_COMMIT_ATTEMPTS = 4` (drawings.ts:71), two of six truly concurrent distinct
   imports returned `VERSION_CONFLICT` in my probe (first run); the second run had one
   failure out of four. This is a fail-closed refusal with no partial state (orphan check
   `drawingRows == drawingAssets == 1`) and retry succeeds, matching A03's "retry lands
   exactly once". It is pre-existing behaviour, not a round-2 regression. **Does not block.**
5. **Low (receipt accuracy) — "matching libjpeg's Duplicate component ID" is not what tests
   show.** The code's refusal is correct, but Pillow/libjpeg in this environment *decodes*
   `duplicate-1-2-1`, so the comment overstates agreement with libjpeg. The behaviour is still
   the stricter, correct choice. **Does not block.**
6. **Informational (receipt wording) — `changedFiles` "is exactly that list".** The set is
   exactly equal (48 = 48, both directions empty), but `scope.txt` lines carry porcelain
   prefixes (` M `, `?? `) while `changedFiles` holds bare paths, so the literal strings are
   not "exactly" the same. The three `V6App.tsx` / `review-02.md` statements in the note all
   check out. **Does not block.**

No receipt statement was found to claim behaviour the code does not have, apart from finding 5
and the wording in finding 6.

## 5. Round-1 / round-2 regression probes (re-run unmodified)

- `/tmp/v612-review/image-probe.mjs` (exit 0): dimension-lie JPEG, missing chroma scans,
  truncated JPEG and restart-order JPEG all `BAD_DRAWING`; 3-component control accepted.
- `/tmp/v612-review/concurrency-probe.mjs` (exit 0): same-bytes concurrent import now yields
  one asset, one row, one `source.committed` (a: created, b: `INVALID_INPUT` duplicate),
  no longer the round-1 two-asset defect; concurrent identical bind leaves one revision row
  and one `figures.bound`; deleted drawing bytes remain in the store and `readBlob` returns
  `RESOURCE_NOT_FOUND` (documented).
- `/tmp/v612-review/bind-race-probe.mjs`, `bind-race-instrumented.mjs` (exit 0): forced
  identical-bind race resolves both callers to the same persisted revision; pointer row
  exists; the instrumented log shows the losing attempt deletes only its own row.
- `/tmp/v612-review2/image-probe2.mjs` (exit 0): UNEXPECTED dropped from 18/50 before the fix
  round to 5/50 now. All 13 improved rows are the round-2 blockers (SOF3/5/6/7/9/10/11/13/14/15,
  duplicate ids, MCU 18, interlaced filter 7). The remaining 5 are: three `4096x4096` cases
  that are 16,777,216 px > the 16,000,000 limit (the probe expected OK; refusing is correct
  per S02, 16 MP cap, and matches round 2), and the two zlib header cases in finding 4.1.
- `/tmp/v612-review2/history-probe.mjs` (exit 0): only random revision ids and their ordering
  differ from the stored output; the meaningful change is `5c event actions/metadata`
  `[["source.committed",[]],["source.retired",[]]]` → `[["source.committed",["version"]],…]`,
  i.e. the round-2 finding is fixed.
- `/tmp/v612-review2/size-probe.mjs` (exit 0): same results, timings only.

## 6. What could not be verified

- The receipt's "each new test fails before its fix" (red-before-green) claim was not re-run;
  it needs the pre-fix source reverted. The executor's `red-before-fix.txt` does exist and
  shows the named tests failing with exit 1 under an in-place revert, but it is the
  executor's own artefact, not independent evidence. I verified instead that the post-fix
  suite passes and that the probes in section 2 pin the exact fixed behaviours.
- The browser re-run (11/11, 0 console errors) was not re-executed; I did not start a server
  or Chrome. The suite's UI tests (`figures-ui.test.mjs`, 9 tests) pass, and no round-3
  finding depends on browser state.
- The MCU-cap/scan-subset case in finding 4.3 could not be constructed with my encoder.
- Only the in-memory `MemoryBackend` harness was exercised, as in the ticket's tests; no real
  IndexedDB backend.

## 7. Verdict

All five round-2 blockers are fixed and re-proven independently: interlaced PNG filter bytes
are checked on every row of all seven passes (42 per-row corruptions + Pillow cross-check),
JPEG frame markers are limited to SOF0/SOF1 with C4/C8/CC not mistaken for frames, duplicate
component ids and an 11-unit interleaved MCU are refused while exactly 10 and non-interleaved
scans are accepted, and `source.committed`/`source.retired`/`figures.bound` carry the version
that actually lands with no gaps or duplicates. The required commands pass, the change set
matches the receipt, no round-1 or round-2 regression remains, and no finding is a failure of
V6-12-A01/A02/A03 or of S02. **VERDICT: ACCEPT.**
