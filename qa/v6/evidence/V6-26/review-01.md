VERDICT: CHANGES_REQUIRED

# V6-26 independent acceptance review 01

Worktree: `/private/tmp/patent-v6-26-worktree`  
Branch: `codex/v6-26-recovery`  
Base: `beea688ee14ebf2dbcbb584c1d9baf9e66ce3641`  
Candidate: `qa/v6/evidence/V6-26/receipt.json` (35 changed files)  
Review date: 2026-11-05

The requested acceptance matrix passes, and the normal-path encryption, validation, atomic import, idempotency, missing-bytes, C10 preview, and legacy-review-metadata behavior are substantially implemented. The candidate is not acceptable as-is because valid figure revision history cannot be imported, and a schema-invalid source snapshot is both reported as unconvertible and then committed. Several smaller contract and evidence inconsistencies are listed below.

## Blockers

### B1. A legitimate matter with figure revision history cannot be restored (V6-26-A01, S08-A09 general case)

A normal `FigureSetRevision` chain may contain the same stable `figureId` in more than one revision. The accepted `bindFigures` API does exactly that when the user changes a figure title/numerals. `createRecoveryPackage` includes every figure set, so `buildFigureRefs` emits multiple `figureRefs` with the same `figureId` but different `figureRevisionId` (`apps/web/src/v6/features/recovery/recovery.ts:787-810`). `validatePackageObject` treats any repeated `figureId` as a duplicate and rejects the package (`recovery.ts:1004-1018`).

Reproduction, using the accepted V6-24 fixture and the accepted drawings API:

1. `makeApprovalFixture()`.
2. Read the current target. It already has an empty parent set and one non-empty set.
3. Call `bindFigures(repository, ACTOR, MATTER_ID, { targetId, baseFigureRevisionId: currentFigureRevisionId, entries: [{ figureId: "99999999-9999-4999-8999-999999999991", number: 1, title: "合成附图（修订）", drawingId: imported.data.drawing.id, numerals: [] }] }, ...)`. The bind succeeds and appends one revision with the same `figureId`.
4. `createRecoveryPackage(...)` succeeds; the package contains two `figureRefs` with the same `figureId` and distinct `figureRevisionId`.
5. `validateRecoveryPackage(...)` returns `ok: false`, error `IMPORT_INVALID`, with `unconvertible: [{ code: "INVALID_REFERENCE", ref: "figure", reason: "figure reference is malformed" }]`.

Observed probe output: two figure refs, both `99999999-9999-4999-8999-999999999991`, revisions `d4c03624-...` and `3f4ee99e-...`; validation returned `ok:false` and `canCommit:false`. This is not a malformed package. It is a valid pre-state produced by the accepted figure API. The candidate's A01 fixture only has one non-empty revision, so the suite does not expose the failure. The duplicate check should be scoped to a figure revision (or should not deduplicate the same logical `figureId` across revisions) while preserving `maps.figure` deduplication at import.

### B2. A schema-invalid source snapshot is committed, not rejected or skipped (S08/S08-A06 dry-run schema)

`validatePackageObject` detects an invalid `sourceSnapshot` and adds `INVALID_SNAPSHOT` to `unconvertible`, but never sets `blocking` (`recovery.ts:1079-1084`). `report.canCommit` therefore stays true. `buildImportPlan` then stores `pkg.sourceSnapshot` essentially as-is through `remapSnapshot` (`recovery.ts:1786-1795` and `1907-1956`). The UI tells the user that incomplete/unconvertible content will not be faked, but this invalid snapshot is imported.

Reproduction:

1. Open a valid encrypted package with the correct passphrase.
2. Set `sourceSnapshot.answers.problem = 12345` (the contract requires a string).
3. Re-encrypt with `buildPatentPack`.
4. `validateRecoveryPackage` returns `ok: true`, `canCommit: true`, `incomplete: true`, `unconvertible: [{ code: "INVALID_SNAPSHOT", ref: "intake.snapshot" }]`.
5. `commitRecoveryImport` returns `ok: true` and creates the matter.
6. The stored `intake.snapshot` row has `answers.problem` of type `number`, value `12345`.

This contradicts the explicit S08/contract rule that import first dry-runs `schema`. The source snapshot must either block commit or be skipped and not stored; validation and commit must agree.

### B3. Validation returns `canCommit: true` for an unknown AST version, then commit aborts on that revision

For a `generation.revision` whose `ast.schemaVersion` is unknown, validation reports `unknownVersions` and `unconvertible` but does not block (`recovery.ts:1056-1069`). It returns `ok: true` and `canCommit: true`. Commit calls `draftAstSchema.parse` in `remapAst` and throws; `buildImportPlan` is caught and the whole import fails with `IMPORT_INVALID` (raw Zod error text), writing no case.

Reproduction: set the first revision's `ast.schemaVersion` to `draft.v99`, re-encrypt, validate, then commit. Observed:

- validation: `ok: true`, `canCommit: true`, `unknownVersions: [{ ref: "revision:...", version: "draft.v99" }]`
- commit: `ok: false`, `IMPORT_INVALID`, no matter and no events.

The receipt limitation says unknown/malformed optional records are "reported and skipped"; they are not skipped. A dry-run that says commit is possible must not produce a guaranteed commit failure. Fix by blocking validation or by skipping the bad revision consistently at both validate and commit, and return a sanitized error rather than the raw Zod message.

### B4. MigrationReport mapping counts change between validate and commit for the same package

`countMappings` at validation counts `pkg.figureRefs.length` (figure entries), while `buildImportPlan` overwrites the report with `figureRows.length` (figure set revisions) at commit (`recovery.ts:1204-1216` and `1861-1875`). For a normal V6-24 fixture package with one figure entry and two figure set revisions (empty parent plus bound child), observed:

- validation report: `figures: 1`
- committed report: `figures: 2`
- `readRecoveryValidation` after commit returns `figures: 2`

The report is user-facing and is part of the S08 MigrationReport. The same package should not change its mapping counts between the dry run and the persisted result. The same count unit must be used for both phases. A03's "results consistent with persisted state" is not met for this field.

## Non-blocking findings

### Security: decrypted payload retention

`validateRecoveryPackage` stores the complete decrypted package in a local `recovery.validation` row (`recovery.ts:1123-1138`). The row contains the AST/claim text, parse chunk text, and base64 drawing bytes; it has no expiry/TTL/deletion field, and there is no cleanup or delete operation in this ticket. Our probe confirmed `containsClaimText`, `containsChunkText`, and drawing base64 all present, with top-level keys including `package`, `payloadHash`, but no expiry field. The passphrase and derived keys are not stored, logged returned, or present in the browser evidence; the browser driver reads the synthetic passphrase from `V6_26_BROWSER_PASSPHRASE`, and the only literal in the repository is the synthetic test constant in `qa/v6/scenarios/V6-26/recovery.test.mjs`.

For R1 this is not an explicit breach of the architecture's local-plaintext model (01-architecture: R1 keeps the complete case and files in IndexedDB; no at-rest encryption is claimed), and the receipt discloses the retention. It is still a data-minimization/confidentiality weakness: validating an encrypted package on another device writes a full plaintext copy even if the user never commits, and repeated validation of different packages accumulates rows indefinitely. If the encrypted-backup requirement is meant to include at-rest confidentiality before commit, this must be elevated to a blocker. At minimum, add delete-on-abandon/commit or a bounded TTL and state the retention period explicitly.

### Evidence: the tamper test does not tamper ciphertext

`qa/v6/scenarios/V6-26/recovery.test.mjs:167-168` flips `packed[packed.length - 2]`. `buildPatentPack` returns `JSON.stringify(envelope)`, so this byte is the closing quote of the envelope JSON, not a ciphertext byte. Observed error is `not a valid patentpack envelope`, not an authenticated-decryption failure. The receipt's A02 sentence "a one-byte ciphertext tamper" therefore overstates the test. I independently decoded the envelope, flipped one real ciphertext byte, re-encoded it, and validated it: `openPatentPack` failed with WebCrypto `OperationError`, and `validateRecoveryPackage` returned `RECOVERY_DECRYPT_FAILED` with zero stored rows. The behavior is correct; the test name/evidence description should be corrected to mutate `envelope.ciphertext`.

### Evidence inconsistencies

- `qa/v6/evidence/V6-26/regression.txt:25` says the V6-26 target had 9 tests and 9 passes. The final `runner.tap`, the receipt, and the current run have 10 tests and 10 passes. The regression summary is stale.
- `03-recovery-stale-report.png` shows 图稿 2 and `04-recovery-committed.png` shows 图稿 1 for the same validation flow. The browser driver only asserts that a report exists, not its counts (`browser-drive.mjs:173-194`). The current probe for the fixture yields validate figures=1 and commit figures=2 because of B4. The screenshots do not demonstrate current count behavior and should be regenerated after B4 is fixed.
- The browser "refresh" step clicks an in-page refresh button (`browser-drive.mjs:196-203`); it does not reload the page or re-enter the route. No validationId is persisted in a URL or other discoverable location, so after a real page reload the component returns to `empty` and cannot show the committed validation without reselecting the package. The scenario-level read-state test passes, but the A03 refresh claim is narrower than the browser step wording.

### A01 fixture honesty

The fixture's source asset is genuinely byte-less: `makeApprovalFixture()` creates `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1` with `state: "available"` and no blob. The drawing asset has real bytes (37,028 bytes in my run); after import, the restored drawing bytes equal the source drawing bytes and hash to the source SHA-256. The restored draft AST contains the claim text. The package lists the source asset under `missingBytes` and stores it as `missing_bytes`. The receipt's wording is therefore honest if "restores text" means the restored draft/chunk text, not the source document's original bytes; it explicitly discloses the missing source asset.

The A01 test itself is weak: it asserts that no missing asset other than the known source ID exists, but never asserts that the known source ID is actually listed. It would pass if `missingBytes` were empty. The browser screenshot and the separate missing-bytes scenario demonstrate the listing, but A01's own evidence does not prove the "report listed" sentence. Add a positive assertion for that asset ID.

### Data completeness and access limitations

- `intake.candidates` is included in the package for non-preview access (`recovery.ts:770-772`) but `buildImportPlan` never writes `intake.candidates`; non-preview recovery silently drops extract candidates. Preview mode intentionally omits them and lists a single `extract_candidates` entry. If candidates are user-visible/generated work that should survive a full backup, this is a data-loss gap; at minimum it should be a stated limitation.
- `access: "full"` is caller-supplied and accepted without any entitlement or C05/C10 runtime gate. For R1 local this is redundant with `local_unmetered` and not a present acceptance failure, but this function must not be exposed as the R2 recovery-export path without the entitlement gate. The receipt's limitation is accurate.
- `createRecoveryPackage` does not enforce the 2,000-asset or 256 MiB package budgets; validation does. It also serializes the same asset bytes twice (`assets` and `assetManifest`), so the encrypted package can exceed 256 MiB for a matter whose asset bytes alone fit the advertised budget. Large-matter behavior is unverified.
- `remapAst`, `remapSnapshot`, and target-config mapping use fallbacks such as `maps.fact.get(id) ?? id` and `maps.party.get(id) ?? id`. Normal generated packages include all references and my normal-fixture scan found zero old IDs in imported rows, but a package with an unresolved AST fact/figure or target-config party can carry an old ID into the new case instead of being rejected or skipped. The "remaps all IDs" guarantee should be made total for validated packages.
- Preview trimming is correct for the exercised fixture: claims, technical_field and background remain; all four generated sections are emptied and each paragraph is listed; revision history is listed as one omitted revision; AI/mixed sourceRefs and generationJobId are cleared; original drawing bytes are byte-identical. The abstract text "一种合成温控装置。" appears in the preview only because the same text is present in an allowed claim, not because the abstract paragraph was retained.

### Cross-ticket legacy-review gap / orchestrator decision

The tested "legacy reviews" are existing `draft-review.confirmations` rows from the V6-24 fixture. V6-26 does not consume the rejected/accepted V6-07 legacy workspace plan: `planLegacyImport` reports `legacyUnverified`, `commitLegacyImport` writes only matters/assets, and `collectLegacyReviews` reads only repository rows. The V6-07 receipt says persistent legacy_unverified records are owned by V6-26 (M01-M03), while the V6-26 ticket does not list those IDs and its write set excludes `legacy-import.ts`. If that V6-07 handoff is binding, old-store reviews are still lost and this ticket has an unfulfilled S08/architecture §8 migration requirement; the orchestrator should either accept this as a separate follow-up or return NEEDS_DECISION/OUT_OF_SCOPE rather than claiming the full migration.

### Native browser persistence and route integration

The browser evidence uses a standalone HTML page and an in-memory backend, not the app route or native IndexedDB. The receipt discloses this. The build evidence was not rerun, as instructed; it shows exit 0 with only chunk-size warnings, but `Recovery` is not imported by `V6App`, so the production build does not exercise the recovery feature. Real route navigation, IndexedDB transaction rollback, cross-tab commit behavior, and passphrase-free commit after a real reload remain unverified.

## Scope and receipt audit

- `git status --porcelain -uall` showed 36 entries: the 35 candidate files (3 recovery implementation files, the V6-26 scenario, and 31 evidence files) plus the excluded `node_modules` symlink. No tracked file was modified; `git diff HEAD` for the shared route/App/manifest/lockfile files exited 0.
- The 35 `changedFiles` entries are unique and match the 35 file entries in `qa/v6/evidence/V6-26/scope.txt`; all are under `apps/web/src/v6/features/recovery/`, `qa/v6/scenarios/V6-26/`, or `qa/v6/evidence/V6-26/`. Nothing outside those directories changed.
- `qa/v6/baseline/manifest.json` hashes to `d7a3fc33...` as stated in the receipt.
- `mount-hashes.txt` implementation hashes match the current files: recovery.ts `d69f2862...`, Recovery.tsx `cff100d8...`, index.ts `62ef3f19...`. Shared files match the base (no diff). The mount is a QA-only standalone page, not an app route, as the receipt states.
- N/A reasons for S08-A01..A05 and S08-A08 are consistent with V6-25/V6-24 ownership. S08-A06, A07, and A09 are mapped to tests; A06/A07 behavior passes in the narrow tested cases. A09 passes for preview trimming as described above. V6-26-A01/A02/A03 pass their specific scenarios, but B1 means A01 is not covered for the general valid figure-history pre-state, and B2/B3 mean the A02/validation contract is not met for schema-invalid content.

## What I ran

- `npm --prefix /private/tmp/patent-v6-26-worktree run test:v6 -- V6-26`: exit 0, 10 tests, 10 pass, 0 fail, 0 skipped.
- `/private/tmp/patent-v6-26-worktree/node_modules/.bin/tsc -p /private/tmp/patent-v6-26-worktree/apps/web/tsconfig.json --noEmit`: exit 0.
- Sequential reruns of V6-25, V6-24, V6-23, V6-20, V6-19, V6-18, V6-17, V6-16, V6-15, V6-14, V6-12, V6-10, V6-08, V6-07, V6-05: each exit 0, all tests pass, 0 skipped; total 354/354 (V6-25 20/20, V6-24 6/6, V6-23 12/12, V6-20 9/9, V6-19 16/16, V6-18 10/10, V6-17 37/37, V6-16 14/14, V6-15 41/41, V6-14 41/41, V6-12 42/42, V6-10 36/36, V6-08 12/12, V6-07 32/32, V6-05 26/26).
- Independent probes outside the worktree: valid package round trip; figure-history rejection; schema-invalid snapshot commit; unknown AST version validate/commit; preview completeness and original asset byte equality; validationId determinism; real ciphertext-byte tamper; old-ID scan; mapping count comparison; validation-row plaintext retention. The probes used the accepted V6-24/V6-19 harnesses and the local repository/memory backend. No probe files were left in the worktree.
- Inspected `build.txt`, `browser-log.json`, `browser-run.txt`, all five screenshots, `runner.tap`, `regression.txt`, the regression TAP files, `typecheck.txt`, `mount-hashes.txt`, `scope.txt`, and the receipt. Did not run the build or rerun the browser flow. Did not read `.dev.vars`; made no network or real-provider calls.
- This review wrote only `/private/tmp/patent-v6-26-worktree/qa/v6/evidence/V6-26/review-01.md`.

## Required changes before acceptance

1. Allow the same stable `figureId` across valid figure set revisions (B1) and add a regression test using the accepted `bindFigures` API.
2. Make invalid source snapshots block commit or skip them consistently; never persist an object that validation marked `INVALID_SNAPSHOT` (B2).
3. Make unknown/optional AST versions either block validation or be skipped identically at commit; do not return `canCommit: true` followed by a guaranteed Zod failure, and sanitize the failure message (B3).
4. Use one figure-count unit in validate and commit reports; regenerate browser screenshots after fixing it (B4).
5. Correct the tamper test to mutate actual ciphertext and refresh the stale regression/screenshot evidence.
6. Decide whether the plaintext validation-row retention, the V6-07 legacy-store gap, and the `full` access seam are accepted R1 limitations or require code changes before acceptance.
</content>
