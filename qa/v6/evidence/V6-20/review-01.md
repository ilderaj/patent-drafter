VERDICT: CHANGES_REQUIRED

# Independent acceptance review — V6-20

## Blockers

1. **Locked source text can leak through a risk title or explanation.** In `apps/web/src/v6/features/preview/preview.ts:149-167`, redaction removes only an exact match of a whole locked paragraph body. A valid `DraftAST` fixture with an embodiments paragraph `LOCKED BODY: rotor stack alloy code ZXQ-917; end.` and a locked risk whose title/explanation quote only `alloy code ZXQ-917` produced a preview DTO with the whole body and a distinct `SourceRef.quote` omitted, but retained `alloy code ZXQ-917` in both risk fields. `Preview.tsx:179-180` renders those fields directly. This violates S05-A02 and C10's prohibition on locked excerpts. The committed test uses the entire locked paragraph as risk text, so exact-match removal passes while partial excerpts are untested. **Required:** prevent locked-node text fragments from entering risk DTOs and test partial quotes in both title and explanation.

2. **A retried full-read can report a revoked confirmation as current.** With a valid `full_read` row and a `Revocation` for that row in the ledger, repeating V6-05 `confirm` with the same actor/snapshot and `contentAccess: "local_unmetered"` returned `ok: true`, `created: false`, and the revoked row, while `currentConfirmations(...)` returned an empty list. `packages/domain/src/v6/confirmation.ts:217-220` finds duplicates without checking revocation. V6-20 passes the ledger to this function in `preview.ts:285-300`; `Preview.tsx:112` then stores the returned row as confirmed and `:189-192` displays “已通读确认”. The export gate correctly excludes revoked rows, but the preview UI falsely reports success and cannot create a new live row. **Required:** make replay of a revoked row fail or create a distinct valid confirmation, and cover the V6-20 persistence/UI path.

3. **`inputStale` ignores two fields in the current `DraftInputRef`.** `preview.ts:214` compares only `sourceVersion`. The contract's `DraftInputRef` also contains `targetConfigVersion` and `figureRevisionId` (05-contracts §2, §4). If either changes while `sourceVersion` stays the same, `isCurrent` becomes false at `:213`, but `inputStale` stays false. The component then shows the “有更新修订” reload banner instead of the stale-input banner and its regenerate/adopt actions (`Preview.tsx:126-140`). **Required:** compare the revision input against the complete current input reference and add config-version and figure-revision stale cases.

4. **The receipt overstates S05-A01 coverage.** S05-A01's GWT is an R2 cloud case covering preview, revisions, diff, job result, and search. V6-20 is R1; this change exposes a `LocalRepository` component and projection, and the browser harness mounts that component directly. It does not implement or exercise cloud endpoints for those routes. The receipt labels S05-A01 `covered` while its reason concedes the other C10 routes are outside this module. **Required:** mark the R2 acceptance not applicable to this R1 ticket, or provide evidence for every claimed route; keep the local preview projection claim scoped to what was actually exercised.

## Non-blocking notes

- S05-A03 through A08 are reasonably marked not applicable to this read-only preview, with A06's adopted-input command/dialog outside the write set. S05-A09 is supported by the browser evidence.
- The recorded browser evidence reports six successful steps, four screenshots, no console errors, and no external requests. It demonstrates risk and paragraph highlighting, AI markers, local-unmetered full content and label, same-matter links, and stale-source callbacks. The harness is a direct component mount over an in-memory backend; it does not exercise V6App/navigation or native IndexedDB across a page reload. The receipt discloses both limitations.
- The recorded build evidence is an in-memory Vite build (2199 modules, four chunks, four assets). I inspected the evidence and did not run a build. The candidate also records Node 25.8.1 because Node 22 was unavailable.
- Scope audit: `git status --short --untracked-files=all` lists the 19 receipt paths, all within `features/preview/` or `qa/v6/scenarios/V6-20/` and `qa/v6/evidence/V6-20/`, plus the root `node_modules` symlink, which the receipt excludes. `scope.txt` contains a bare `node_modules` entry, but excluding that mount leaves the same 19 changed files. Recomputed V6App, navigation, and v6.css hashes match `mount-hashes.txt`. No other worktree changes were present.
- The native IndexedDB backend and app route remain unverified; no .dev.vars file was read, and no external provider or network call was made.

## What I ran

- `npm --prefix /private/tmp/patent-v6-20-worktree run test:v6 -- V6-20` — exit 0; 6 passed, 0 failed, 0 skipped.
- `npm --prefix /private/tmp/patent-v6-20-worktree/apps/web run typecheck` — exit 0 (`tsc --noEmit`).
- Reran `V6-05` (26 passed), `V6-08` (12), `V6-10` (36), `V6-14` (41), `V6-15` (41), `V6-16` (14), `V6-17` (37), and `V6-18` (7); each command exited 0.
- Ran read-only projection probes with a schema-valid DraftRevision/SnapshotRef and locked SourceRefs. They confirmed locked bodies and source-reference quotes were absent, and reproduced the partial-risk-text leak. A V6-05 ledger probe reproduced successful replay of a revoked row.
- Inspected the recorded build output, browser driver/log/screenshots, receipt, scope list, and mount hashes. I did not rerun the browser harness because it writes evidence files.
