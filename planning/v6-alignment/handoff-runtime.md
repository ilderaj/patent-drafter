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

## Architecture-audit fixes (2026-11-10)

- `packages/domain/src/v6/checks.ts`: `CheckRunResult.ruleCoverage` reports active-pack rows, executed rows, rows that can report, and unexecuted rule ids. `docs/audit-evidence/v6-architecture-2026-11-10/rule-coverage.md` lists all 28 source rows; 9 can report, 2 are deliberate no-ops, 17 are unimplemented; AI-INV-001/002 duplicate ids collapse the active pack to 26.
- `delivery/workspace-data.ts` now owns `loadWorkspace`, `persistCheckRun`, confirmation-ledger read/write, risk acknowledgement and `mapCheckAssets`. `Workspace.tsx` only renders and calls them. Stored check-run rows are parsed with a zod schema (no `as` assertion). One matter load is reused for `loadTargetsView` (new optional preloaded aggregate parameter in `targets.ts`).
- `TestOutputNotice` moved to `v6/components/`; Editor/Preview/Workbench/self-service imports updated. The two feature cycles listed by the audit are gone.
- `v6/lib/user-messages.ts` maps internal codes/enums to Chinese copy and labels the raw value for 技术详情. Done/Approval/Checks show mapped copy; SnapshotRef, rule-pack versions and patentpack wording moved into `<details>`.

## Visual-layer rebuild (2026-11-10, kit)

- `Generation.tsx`: `.gen-wrap`, `.wiz-h1/.wiz-sub`, `.progress/.bar`, `.gen-list/.gen-item` stage rows, `.gen-live` candidate. Stage checkpoints/timestamps live inside `details.tech`; progress counts retained on `generation-progress`.
- `Preview.tsx`: `.preview-head`, `.doc-wrap/.doc/.doc-inner/.para/.pno/.inline-note`, `.doc-aside` risk notes; full-read confirmation below the paper. New optional `showTestOutputNotice` (default true); the self-service wizard should pass `false` because its outer step already renders the callout.
- `Checks.tsx`: `.statrow` four counts, grading callout, `.checkrowline` items, rule id/node id/basis in `details.tech`; added `checks-coverage` showing `ruleCoverage.executedRules/totalRules` (“本版执行 N/28 条规则”).
- `Approval/Done/Workspace`: `.done-hero`, `.dl-row` files, `.steps3`, `.upsell`; professional delivery adds `.tbl` format table, `.exportcard/.gates`, export record line. SnapshotRef and gate codes are inside `details.tech`.
- All existing `data-testid`s kept. Removed only the obsolete `preview-risks-title` heading id; `preview-annotation-<riskId>` remains on the inline note. No testid renames.
- Verification: typecheck PASS; build PASS; V6-17 38/38, V6-20 9/9, V6-23 12/12, V6-24 6/6, V6-25 22/22, alignment-runtime 13/13.

## Test-output notice de-duplication

- Removed `data-testid="delivery-test-output-label"` from `DeliveryWorkspace`; the completion page's `done-test-output-label` is now the single visible notice on professional and self-service delivery routes. Any tester lookup for the removed id should use `done-test-output-label`.

## Round-3 done/preview repair

- Done (self mode): main view order is hero → files → XML callout → passphrase/generate → steps3 → upsell; blockers are listed in the hero with links, approval details are a collapsed section rendered by DeliveryWorkspace (`delivery-approval-details`). Zero blockers and no read error shows “可以下载了”; a read error counts as one blocker, so “还差 0 步” cannot appear. Passphrase label and input stack vertically for the 720 pane.
- Preview: `.doc-aside` annotations are relative, vertical, left-aligned, and capped at 5 with a “查看全部 N 条” hint; unimplemented-rule notices are excluded. Claim features are unnumbered sub-lines and claim text drops its duplicate leading number. `hideActions` was added and `PreviewActions` exported for the outer toolbar. “未命名案件” falls back to the AST title, then “（未填写发明名称）”.
- Screenshots: `planning/v6-alignment/evidence/round-3/preview-light.png`, `done-light.png` (1440, light, real self-service flow). The preview shot still shows the self-service Toolbar floating over the doc top in a full-page capture; that Toolbar belongs to SelfService/kit, outside this worker's write set.
- New testids: `done-blockers`, `done-blocker-<CODE>`, `done-record-approval`, `delivery-approval-details`, `preview-risks-more`. No existing testid was renamed; `done-files` is only rendered when export prerequisites are met.

## Round-3 follow-up (internal copy + done layout)

- Preview confirmation reads “已通读确认 · 本机用户 · 时间”; actor UUID is inside 技术详情. Finding copy uses Chinese support labels (已支持/部分支持/缺少支持), “未经支持的事实”, and no raw figure UUIDs in figure-matching explanations; rule-pack wording no longer exposes “G-RULES closed”. Tests added for support labels and UUID-free explanations.
- Done: hero is a single title + one-line description; test-output callout follows the hero, then the file list. Self mode removed the isolated “完成页/刷新状态” row; refresh lives inside the collapsed gate details. File rows show human descriptions (DOCX claim/paragraph/figures, PDF checklist, encrypted backup, JSON manifest), KB sizes and per-row SHA-256 in 技术详情. Order: files → XML callout → passphrase/generate → steps3 → upsell → folded gate/format details.
- Evidence screenshots refreshed: `planning/v6-alignment/evidence/round-3/preview-light.png`, `done-light.png` (real self-service entry, 1440 light, figure bound and risks acknowledged through the UI).
- Verification: typecheck PASS, build PASS, V6-20 9/9, V6-23 12/12, V6-25 22/22, alignment-runtime 15/15.

## Round-4 single fix

- Checks footer main copy is now “检查结果对应当前修订；修订或规则变化后需重新检查。” with `data-testid="checks-footer"`; revision id and rule-pack version moved into 技术详情. Added a V6-23 assertion that visible copy contains no revision UUID or pack version.
