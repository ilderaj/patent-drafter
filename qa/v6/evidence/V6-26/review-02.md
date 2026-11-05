VERDICT: ACCEPT

# V6-26 independent acceptance review 02

Worktree: `/private/tmp/patent-v6-26-worktree`  
Branch: `codex/v6-26-recovery`  
Base: `beea688ee14ebf2dbcbb584c1d9baf9e66ce3641`  
Candidate: `qa/v6/evidence/V6-26/receipt.json` (36 changed files at evidence time)  
Review date: 2026-11-05

Round 1's four blockers are reproduced as fixed, the TTL and commit-marker cleanup work on the exercised paths, the tamper test now changes real ciphertext, and the no-half-write paths remain atomic in the memory backend. I found no new acceptance blocker. The residual notes below should be carried as limitations and are not reasons to reject this ticket.

## Round-2 reproductions

### B1/B4: stable figureId across revisions, and count stability

Using the accepted V6-24 fixture and the accepted `bindFigures` API, I appended a second non-empty revision with the same stable figure ID and changed title, then exported the matter.

Observed:
- package `figureRefs`: 2 entries with the same `figureId` and 2 distinct `figureRevisionId`s
- validation accepted the package, `canCommit: true`
- commit imported 3 figure-set rows (empty parent plus two bound revisions) and one new stable figure ID in the new matter
- validation mapping counts: `{targets:1, assets:2, drawings:1, figures:2, revisions:2, parties:0, facts:1, sourceRecords:1, legacyReviews:2}`
- commit mapping counts: identical
- the imported figure ID differs from the old ID

This resolves B1 and B4. The suite's new B1 test and A01's `assert.deepEqual(committed.data.report.mappingCounts, checked.report.mappingCounts)` also pass.

### B2: invalid sourceSnapshot blocks, including a locally tampered validation row

I changed `sourceSnapshot.answers.problem` to a number and re-encrypted the package. Validation returned `ok:false`, `IMPORT_INVALID`, `canCommit:false`, and an `INVALID_SNAPSHOT` unconvertible entry, with zero rows written. I then took a valid persisted validation row, changed the same field, recomputed its `payloadHash`, and committed it: commit returned a sanitized `IMPORT_INVALID` (`源快照结构无效；未写入任何案件。`), created no matter, and left no intake snapshot row. No case was written on either path.

### B3: unknown AST blocks, including a locally tampered validation row

I changed the first revision's AST version to `draft.v99` and re-encrypted it. Validation returned `ok:false`, `IMPORT_INVALID`, `canCommit:false`, with `draft.v99` in `unknownVersions` and zero rows. A tampered validation row with the same AST change and a recomputed payload hash was rejected by commit with the sanitized `草稿结构或版本无效；未写入任何案件。`; no raw Zod text appeared, no matter was created, and no event/blob was written. This resolves B3.

### TTL, cleanup, and package-free marker

- A validated row created at `2026-11-05T12:00:00Z` has `expiresAt` exactly 15 minutes later (`12:15:00Z`) and contains the decrypted claim/chunk text. It contains no passphrase.
- `readRecoveryValidation` at `12:16:00Z` returned `RESOURCE_NOT_FOUND` and removed the row.
- A fresh validation committed at `12:16:00Z` was refused with `RESOURCE_NOT_FOUND` and left zero matters.
- Validating a second package at `12:16:00Z` swept the first package's expired validation row while preserving the new row.
- After a successful commit, the `recovery.validation` row is gone and one `recovery.commit` marker remains. The marker has only `kind, tenantId, actorId, validationId, matterId, report, committedAt`; it contains no `package`, `packageHash`, `payloadHash`, passphrase, claim text, chunk text, or drawing bytes.
- Reading the marker after the TTL returned `committed`; revalidating the same package after the marker was created wrote no package row, and commit replayed the same matter ID with `replayed:true`.

### Ciphertext tamper

The test now decodes `envelope.ciphertext`, flips one byte, re-encodes it, and validates. My independent probe did the same. The result was `RECOVERY_DECRYPT_FAILED` and zero stored rows. The previous test that flipped the envelope JSON closing quote is gone; this resolves the round-1 evidence issue.

### No-half-write and retry

- Injecting a failure on a `drawings/` blob after matter and event writes left zero matters and zero events; the validated row remained available for retry.
- Clearing the fault and retrying the same validation ID created exactly one matter and one marker, with no duplicate.
- Injecting a failure specifically while writing the `recovery.commit` marker also rolled back the entire transaction: no matter, no events, no marker, and the validation row remained. Retrying succeeded.

## Suites and evidence

- `npm run test:v6 -- V6-26`: exit 0; 14 tests, 14 pass, 0 fail, 0 skipped.
- `./node_modules/.bin/tsc -p apps/web/tsconfig.json --noEmit`: exit 0.
- `npm run typecheck` workspace: exit 0.
- Sequential reruns of V6-25, V6-24, V6-23, V6-20, V6-19, V6-18, V6-17, V6-16, V6-15, V6-14, V6-12, V6-10, V6-08, V6-07, V6-05: each exit 0; 354/354 tests pass, 0 skipped. The updated `regression.txt` now correctly reports the V6-26 target as 14/14.
- Build was not rerun, as requested. `build.txt` still records exit 0 with only chunk-size warnings; `Recovery` is not registered in `V6App`, which remains a documented integration limitation.
- Browser evidence was inspected, not rerun. `browser-log.json` records 6/6 steps, zero external requests, zero console errors, one new matter, zero `recovery.validation` rows after commit, one commit marker, and identical mapping counts before and after commit. The updated screenshots show the 15-minute retention disclosure and consistent 图稿 counts. The harness remains a standalone in-memory QA mount.
- `mount-hashes.txt` implementation hashes match the current files: recovery.ts `0618673d...`, Recovery.tsx `f5ef9279...`, index.ts `62ef3f19...`. Shared route/App/manifest/lockfile files have no diff from the base; the baseline manifest hash remains `d7a3fc33...`.
- Scope at evidence time: 36 files, all inside `apps/web/src/v6/features/recovery/`, `qa/v6/scenarios/V6-26/`, or `qa/v6/evidence/V6-26/`; `node_modules` is excluded; no tracked file changed. This review adds only `qa/v6/evidence/V6-26/review-02.md`.
- N/A reasons for S08-A01..A05 and A08 still match V6-25/V6-24 ownership. S08-A06, A07, and A09 remain covered; the A09 preview test still passes and my preview probe confirmed all four omitted sections and the omitted revision are listed, while the original drawing bytes remain byte-identical.

## A01 fixture honesty

The source asset still has no stored bytes and is now positively asserted to appear in `missingBytes`; it remains `missing_bytes` after import. The drawing has real bytes (37,028 bytes in the probe), the restored drawing bytes are deep-equal to the source, and the restored AST contains the claim text. The "restores text and original figure hashes" claim is honest for restored draft/chunk text and the drawing hash; it does not restore the byte-less source asset, and the report says so.

## Non-blocking residual notes

1. **TTL is logical/lazy, not automatic physical deletion.** A raw IndexedDB read performed after `expiresAt` without calling a recovery API still returned the decrypted validation row. Cleanup runs when a validation is read, committed, or followed by another validation, and cleanup errors are swallowed. In addition, `isStoredValidation` rejects a row whose `expiresAt` is missing or malformed before the read/commit cleanup path, so a pre-upgrade row without the new field is not swept by those paths; only a later successful validation's sweep removes it. For R1's local, no-background-worker model this is acceptable and the 15-minute restriction is enforced on every recognized recovery access path, but the receipt should not be read as a hard at-rest deletion at the 15-minute mark. A startup/timer sweep would be needed for that stronger guarantee.
2. **Export/import budget units differ at the boundary.** `createRecoveryPackage` caps the plaintext JSON body at 256 MiB and stores asset bytes twice (`assets` and `assetManifest`), while `validateRecoveryPackage` caps the encrypted envelope at 256 MiB. A large package can therefore be generated and then refused by validation. The fixture stays far below this boundary; use one envelope/plaintext limit consistently before claiming the budget.
3. **Export-side skipped records are not copied into the validation report.** `createRecoveryPackage` can skip an invalid source snapshot, invalid AST, or unconvertible asset and record it only in the package's embedded `migrationReport`; `validatePackageObject` reconstructs its report from package content and copies only `omittedGeneratedContent`. A valid package produced from such a repository can validate and commit without surfacing that the record was left behind. This is an edge case outside the tested fixture, but it is data-loss reporting worth a follow-up.
4. `access: "full"` remains caller-supplied without an R2 entitlement/C05-C10 gate; the receipt documents this as an R1-local limitation. It must not be reused as the R2 recovery-export path without the gate.
5. The V6-07 old-store legacy plan remains unconsumed; only repository-resident confirmation/review rows become `legacy_unverified`. The receipt documents this as a separate orchestrator decision.
6. The browser harness uses an in-memory repository; native IndexedDB persistence, cross-tab behavior, and actual page reload remain unverified. The Recovery route is not registered in `V6App`.
7. `Recovery.tsx` hardcodes the 15-minute message rather than deriving it from `RECOVERY_VALIDATION_TTL_MS`; a future TTL change would desynchronize the UI copy.
8. ID-remap fallbacks such as `maps.fact.get(id) ?? id` and `maps.party.get(id) ?? id` can preserve an old ID for an unresolved AST/config reference. Normal fixture scans found no old IDs after import, but a validated package with an unresolved reference should be rejected or explicitly skipped rather than silently carrying the old id.

## What I ran

- Full V6-26 suite, direct web typecheck, workspace typecheck, and all 15 requested predecessor suites.
- Independent probes outside the worktree for B1/B4, B2, B3, TTL expiry/sweep, commit cleanup/marker replay, actual ciphertext-byte tamper, drawing-row failure, and commit-marker failure. Probe files were removed; the worktree was not modified except for this review file.
- Inspected the updated receipt, scope, mount hashes, runner TAP, regression TAP/summary, build/typecheck evidence, browser log/run output, and screenshots. Did not run the build or the browser flow; did not read `.dev.vars`; made no network or real-provider calls.

## Conclusion

Accept. The round-2 candidate meets the V6-26 acceptance paths and the S08-A06/A07/A09 mapping. The remaining items are documented R1 limitations or follow-up hardening, not blockers.
</content>
