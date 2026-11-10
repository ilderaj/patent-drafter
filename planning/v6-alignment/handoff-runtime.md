# Runtime worker handoff

## Delivered

- Added `features/generation/local-runtime.ts` with `LOCAL_TEST_GENERATION_OPTIONS`: bounded on-device stub execution, inline prompts, no external consent and explicit `allowTestAdoption: true`. `allowTestAdoption` defaults to false, and engine construction rejects it with `execution: "provider"`.
- Added optional `DraftRevision.testOutput`. Old revision rows remain valid when the field is absent. Revision domain save, restore and input adoption inherit true provenance; the generation revision store carries it through edits. Stub adoption persists `testOutput: true` only when the engine was explicitly configured to allow it.
- Export sessions expose the marker. Test-output exports record it in the manifest, label the checklist and generated filenames, and show a warning in Done and Delivery. Ordinary exports omit the marker.
- Encrypted recovery packages preserve the revision marker when importing into a new matter. A malformed marker blocks import rather than silently becoming an ordinary draft.
- Kept the prior runtime wiring: persistent check-run IDs scoped by actor/matter/target/snapshot/rule-pack; risk acknowledgement ledger persistence and restore; same-matter/target check actions; empty-draft guidance and validation details; `confirmationMode` defaults to `professional_paragraphs`; Delivery no longer duplicates Preview.
- `GenerationPanelProps.onAdopted?: () => void` (optional): called after `act("adopt")` returns `status === "adopted"`; not called for errors or `obsolete_result`. Workbench/self-service can pass a reload callback for the editor and review panels. No DOM test harness exists, so compatibility is verified by the unchanged V6-17 UI suite plus typecheck.
- Added the lead's A08 provenance decision to `planning/v6-alignment/test-provenance.md` and retained test summaries in `planning/v6-alignment/evidence/runtime-test-provenance.md`.
- Browser-blocker repair: when the panel was configured with `allowTestAdoption`, `generationView` now sets `canAdopt` for test results, and `CandidatePreview` offers "采纳为测试修订（带测试标记，不能作为正式申请材料）". Without the option, the old refusal text and hidden button remain. Adoption notice names the test revision.
- Browser run-8 repair: preview full-read confirmations now write the shared `draft-review/confirmations/...` ledger (`draft-review.confirmations`) through the preview transaction with the same activity event. `loadLocalPreview` migrates existing `preview/confirmations/...` rows into the shared ledger, keeps the legacy row, and merges both on read; Approval/export also merge the legacy row so an already-confirmed run is not lost. Figure checks now receive `CheckAsset.drawingId` from the persisted drawing library, so a bound drawing no longer yields a false `asset.missing_bytes` while real missing bytes still block.
- Run-12 strengthening: `packages/export` gained an optional assembly `notice` (prepended to every DOCX) and optional review-PDF metadata; `export-adapter` passes "测试输出，仅用于验证流程，不能作为正式申请材料" only for `testOutput` revisions, also placing it in the checklist title/first page. Ordinary exports are unchanged. Scope was limited to those optional parameters.

## Verification

- `node --test --test-reporter=tap qa/v6/scenarios/alignment-runtime/runtime.test.mjs` — pass 5 / fail 0. Log: `/tmp/v6-alignment-runtime-provenance-final.log`.
- `npm run test:v6 -- V6-03` — pass 14 / fail 0. Log: `/tmp/v6-alignment-runtime-v603-provenance.log`.
- `npm run test:v6 -- V6-04` — pass 16 / fail 0. Log: `/tmp/v6-alignment-runtime-v604-provenance.log`.
- `npm run test:v6 -- V6-17` — pass 37 / fail 0. Log: `/tmp/v6-alignment-runtime-v617-provenance.log`.
- `npm run test:v6 -- V6-23` — pass 12 / fail 0. Log: `/tmp/v6-alignment-runtime-v623-provenance.log`.
- `npm run test:v6 -- V6-24` — pass 6 / fail 0. Log: `/tmp/v6-alignment-runtime-v624-provenance.log`.
- `npm run test:v6 -- V6-25` — pass 22 / fail 0. Log: `/tmp/v6-alignment-runtime-v625-final2.log`.
- `npm run test:v6 -- V6-26` — pass 15 / fail 0. Log: `/tmp/v6-alignment-runtime-v626-provenance.log`.
- `npm run typecheck` — pass, exit 0. Log: `/tmp/v6-alignment-runtime-typecheck-provenance.log`.
- After the browser-blocker repair: `npm run test:v6 -- V6-17` — pass 38 / fail 0 (`/tmp/v6-alignment-runtime-v617-adopt-fix2.log`); `npm run typecheck` — pass (`/tmp/v6-alignment-runtime-typecheck-adopt-fix2.log`).
- After the browser run-8 repair: `node --test qa/v6/scenarios/alignment-runtime/runtime.test.mjs` — pass 8 / fail 0 (`/tmp/v6-alignment-runtime-run8.log`); `npm run test:v6 -- V6-20` — pass 9 / fail 0 (`/tmp/v6-alignment-runtime-v620-run8.log`); `V6-12` — pass 42 / fail 0 (`/tmp/v6-alignment-runtime-v612-run8.log`); `V6-24` — pass 6 / fail 0 (`/tmp/v6-alignment-runtime-v624-run8.log`); `V6-25` — pass 22 / fail 0 (`/tmp/v6-alignment-runtime-v625-run8.log`); `npm run typecheck` — pass (`/tmp/v6-alignment-runtime-typecheck-run8.log`).
- After the run-12 file-marker strengthening: `V6-25` — pass 22 / fail 0 (`/tmp/v6-alignment-runtime-v625-run12b.log`); `npm run test -w packages/export` — 44 pass / 0 fail (`/tmp/v6-alignment-runtime-export-pkg-run12.log`); `npm run typecheck` — pass (`/tmp/v6-alignment-runtime-typecheck-run12b.log`).

### V6-17 S04-A09 recovery failure

The earlier failure was `JOB_LIMIT_EXCEEDED`: the test rebuilt the generation engine with the real current clock while its fixture deadline was fixed at `2026-11-05T12:05:00.000Z`. A temporary probe reproduced the same failure at clean baseline `e9723cc`. The test now injects the fixture time (`now: () => new Date(T0)`); the production elapsed-time guard is unchanged. The full V6-17 suite now passes.

No commit or deployment was made. `Preview.tsx` and `Editor.tsx` were not changed by this worker.
