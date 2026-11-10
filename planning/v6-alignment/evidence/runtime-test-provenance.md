# Runtime / test provenance evidence

Captured 2026-11-10 from the shared worktree `.claude/worktrees/v6-prototype-alignment`. Commands were run in that directory.

## Automated tests

| Command | Result |
|---|---|
| `node --test --test-reporter=tap qa/v6/scenarios/alignment-runtime/runtime.test.mjs` | pass 5 / fail 0 |
| `npm run test:v6 -- V6-04` | pass 16 / fail 0 |
| `npm run test:v6 -- V6-17` | pass 37 / fail 0 |
| `npm run test:v6 -- V6-23` | pass 12 / fail 0 |
| `npm run test:v6 -- V6-24` | pass 6 / fail 0 |
| `npm run test:v6 -- V6-25` | pass 22 / fail 0 |
| `npm run test:v6 -- V6-26` | pass 15 / fail 0 |
| `npm run test:v6 -- V6-03` | pass 14 / fail 0 |
| `npm run typecheck` | exit 0, no errors |

Full command logs are in `/tmp`; filenames are listed in `planning/v6-alignment/handoff-runtime.md`.

After the final ordinary-manifest assertion was added, `npm run test:v6 -- V6-25` was rerun: 22 pass / 0 fail (`/tmp/v6-alignment-runtime-v625-final2.log`), and `npm run typecheck` again exited 0 (`/tmp/v6-alignment-runtime-typecheck-final2.log`).

## Browser blocker 1 repair (test adoption)

Evidence: `planning/v6-alignment/evidence/browser-run-3/blocked-generation_adopt.png`.

- `generationView` accepts `allowTestAdoption` (default false); test results become adoptable only when true.
- `CandidatePreview` shows the adopt button for test output only when the panel's `engineOptions.allowTestAdoption` is true, labelled as a test revision that cannot be a formal application draft.
- Default configuration keeps the old refusal text and no button.
- `npm run test:v6 -- V6-17` — pass 38 / fail 0 (`/tmp/v6-alignment-runtime-v617-adopt-fix2.log`).
- `npm run typecheck` — pass (`/tmp/v6-alignment-runtime-typecheck-adopt-fix2.log`).

## V6-17 S04-A09 failure investigation

The earlier V6-17 run had one failure: `V6-17 S04-A09: refresh recovery resumes from saved stages after consent validation` expected `succeeded` but observed `failed`. A temporary probe (deleted afterwards) showed:

- interrupted job state: `interrupted` / `INVALID_TRANSITION` (expected)
- after `resume`: `failed` / `JOB_LIMIT_EXCEEDED` — "任务超过配置的最长运行时间。"
- stages: `facts: failed (JOB_LIMIT_EXCEEDED)`, `support: completed`, the rest pending

The same probe was run in a clean detached worktree at `e9723cc` and produced the identical result, so the failure is a baseline defect, not a regression from this worker.

Cause: the test rebuilds the engine for resume without injecting `now`, so the real clock is compared with the fixture deadline (`2026-11-05T12:05:00.000Z`) and the job is judged to have expired. The test now injects `now: () => new Date(T0)`, matching the original fixture engine. The production elapsed-time guard is unchanged.

## Test provenance decisions

- `DraftRevision.testOutput?: boolean` is optional, so older rows without the field still validate.
- `saveRevision`, `restoreRevision` and `adoptInputs` inherit the marker from the base or restored source, so editing, restoring or adopting inputs cannot shed it.
- `createGenerationRevisionStore.saveEditedRevision` and the stub adoption path also carry the marker forward.
- `allowTestAdoption` defaults to `false`; the engine throws when it is combined with `execution: "provider"`.
- `LOCAL_TEST_GENERATION_OPTIONS` sets it only for on-device stub runs.
- Exported packages keep `testOutput` in the manifest, prefix generated artifact names with `测试输出-` and label the checklist.
- Encrypted `.patentpack` recovery preserves the marker; a malformed marker blocks the import instead of silently importing as an ordinary draft.

## Browser run-8 repair

Evidence input: `planning/v6-alignment/evidence/browser-run-8/browser-acceptance.json` and `acceptance-summary.md`.

### A) Self-service full-read was invisible to the export gate

- `confirmLocalFullRead` wrote `preview/confirmations/...` with kind `preview.confirmation-ledger`, while Approval, Review and export read `draft-review/confirmations/...` with kind `draft-review.confirmations`.
- The preview writer now writes the shared key and kind in the same matter-version transaction and activity event.
- `loadLocalPreview` migrates an existing legacy row into the shared ledger, keeps the legacy row, and both ledgers are merged on read (canonical wins duplicate ids).
- Approval migrates before reading; export merges canonical and legacy records so an existing confirmed run is not lost and no confirmation is invented.
- Tests: preview full-read unlocks the export gate and creates a real export; legacy-only ledger migrates with the same confirmation id.

### B) Bound figure reported MISSING_BYTES with a different id

- The browser finding id was a check-run finding id (`4c7ed183…`), produced by rule `asset.missing_bytes`. Its locator uses the figure entry's `drawingId`.
- `Workspace` passed aggregate assets without `drawingId`, so the rule could not match the drawing asset even though the library and figure set contained it (`e49e7e14…`).
- `mapCheckAssets` now maps drawing rows to assets and sets `CheckAsset.drawingId`; the rule matches and reports no missing bytes.
- Test asserts no `asset.missing_bytes` after import + binding, and that setting the asset to `missing_bytes` still reports it.

### Verification

- `node --test qa/v6/scenarios/alignment-runtime/runtime.test.mjs` — 8 pass / 0 fail (`/tmp/v6-alignment-runtime-run8.log`).
- `npm run test:v6 -- V6-20` — 9 pass / 0 fail (`/tmp/v6-alignment-runtime-v620-run8.log`).
- `npm run test:v6 -- V6-12` — 42 pass / 0 fail (`/tmp/v6-alignment-runtime-v612-run8.log`).
- `npm run test:v6 -- V6-24` — 6 pass / 0 fail (`/tmp/v6-alignment-runtime-v624-run8.log`).
- `npm run test:v6 -- V6-25` — 22 pass / 0 fail (`/tmp/v6-alignment-runtime-v625-run8.log`).
- `npm run typecheck` — pass (`/tmp/v6-alignment-runtime-typecheck-run8.log`).

## Run-12 strengthening: test marker inside generated files

- `packages/export/src/assembly.ts`: optional `AssembleOptions.notice`; when set, every generated DOCX gets it as its first heading paragraph (`withNotice`). Scope limited to this option and the four DOCX builders' optional parameter; existing callers are unchanged.
- `packages/export/src/pdf.ts`: `buildReviewPdf` accepts optional metadata and sets PDF title/subject/keywords. Scope limited to this optional argument.
- `export-adapter.ts` passes `TEST_OUTPUT_NOTICE` ("测试输出，仅用于验证流程，不能作为正式申请材料") only when the revision is `testOutput`, adds it to the checklist title's first page, checklist items, PDF metadata, and keeps `测试输出-` file prefixes. Ordinary exports pass no notice and no metadata.
- V6-25 tests: test-output DOCX `word/document.xml` contains the marker before "权利要求书"; test-output checklist PDF metadata contains it; ordinary export DOCX and PDF do not.
- Verification: `npm run test:v6 -- V6-25` — 22 pass / 0 fail (`/tmp/v6-alignment-runtime-v625-run12b.log`); `npm run test -w packages/export` — 44 pass / 0 fail (`/tmp/v6-alignment-runtime-export-pkg-run12.log`); `npm run typecheck` — pass (`/tmp/v6-alignment-runtime-typecheck-run12b.log`).
