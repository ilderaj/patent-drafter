VERDICT: CHANGES_REQUIRED

# V6-25 independent acceptance review

Worktree: `/private/tmp/patent-v6-25-worktree`, branch `codex/v6-25-export`. `HEAD` is exactly `83c0485d5e49446d758fbded29278429875954e4`; the candidate is present as untracked worktree files, so `git diff 83c0485...HEAD` is empty. This review covers the candidate files in the worktree, not a committed diff.

## Blockers

### B1. Export cache has no seven-day expiry

S08 requires files to be cached for seven days and then be eligible for regeneration from the same snapshot (`specs/S08.md:39`). The candidate receipt also lists this as unimplemented (`receipt.json:290`). `readExportRows` returns matching rows without checking age (`export-adapter.ts:349-355`), and `refresh` selects the current row without applying an expiry rule (`export-adapter.ts:839-845`).

**Reproduction:** I built a valid export from the V6-24 synthetic fixture at `T0`, advanced the injected clock by eight days, and called `session.refresh()`. The export still appeared in `state.files`; the stored row and its bytes remained available. There is no cache-expiry or regeneration behavior.

This misses an explicit S08 export requirement and leaves local export data retained indefinitely.

### B2. A failure after preparing files can refresh as `ready`

The candidate stores a `prepared` row and its full manifest before writing `export.created` (`export-adapter.ts:931-949`). If that event write fails, `createExport` returns the failure directly (`export-adapter.ts:953-954`). On refresh, any current row whose state is not `failed` is treated as current files; the phase becomes `ready` even when that row is still `prepared` (`export-adapter.ts:839-848`).

**Reproduction:** With a valid synthetic fixture, I wrapped `repository.commit` to fail only when its payload contains `export.created`, then called `createExport()`. It returned `STORAGE_UNAVAILABLE`. After `session.refresh()`, the state was `phase: "ready"` with seven unavailable files and no unavailable reasons. The blobs store contained a `prepared` row with six manifest entries, while the matter had zero `export.created` events.

This contradicts V6-25-A03's refresh/retry consistency requirement (`tickets/V6-25.md:22`) and the requested failed-export probe: the failed action leaves a staged manifest and the page presents a ready phase. A failure-state row with a reason, or removal of the prepared row until the event succeeds, would avoid this result.

## Standards

No repository `AGENTS.md`, `CONTRIBUTING.md`, or `CODING_STANDARDS.md` was found. No documented-standard breach was identified. One judgment-call smell: possible duplicated manifest-field construction in the embedded manifest (`export-adapter.ts:730-746`), successful manifest (`914-927`), and failed manifest (`985-1000`). These variants serve different states, so this is non-blocking.

## Non-blocking notes

- **Manifest self-hash handling is coherent.** The standalone manifest hashes the six generated files, including the patentpack. Its own SHA-256 is held separately as `manifestSha256` and exposed on the sidecar file view. The patentpack's embedded manifest has five entries because it cannot hash its own container. The PDF checklist includes hashes for artifacts that exist before PDF generation; it cannot include its own or the later patentpack hash. These boundaries are disclosed in the receipt and did not cause a mismatch in my byte/hash probes.
- **Patentpack and passphrase behavior matches the existing export package.** The pack is encrypted and requires a non-empty caller passphrase. A blank passphrase leaves the gate allowed but `createExport()` returns `FORMAT_UNAVAILABLE`; the UI disables the action until a passphrase is entered. The cache key incorporates a hash of the passphrase, while the raw passphrase is not in the export row. Repeated creation against an existing cache entry reuses the same encrypted bytes. This requirement is enforced by `packages/export` and is stated in the UI.
- **`packageKind` and `searchState` are accurate.** Preparation exports use `packageKind: "preparation"`; professional exports require a current internal approval and record `internally_approved`. `searchState: "not_searched"` is truthful for this slice. The synthetic suite covers both package kinds and the unsearched state.
- **Gate coverage is substantial.** The suite covers missing figure bytes, stale snapshot binding, missing/stale check, risk acknowledgement, missing content confirmation, approval requirement, viewer refusal, and build failure. My additional fixtures confirmed revoked full-read returns `CONFIRMATION_REQUIRED`, an engineering blocker returns `MISSING_BYTES` with its resource ID, and preview access returns `ENTITLEMENT_REQUIRED`. The UI falls back to generic guidance and the overview link for reason codes without an explicit mapping, including entitlement; this is a guidance limitation, not a loss of the reason code.
- **S08 mapping and scope are honest.** A01/A02/A03/A04/A08 are covered by code and scenarios. A05 is owned by the accepted V6-24 approval slice; A06/A07/A09 are recovery requirements assigned to V6-26. Their N/A reasons are consistent with those boundaries. The 31 receipt paths exactly match `scope.txt`; the extra untracked `node_modules` directory is excluded. No candidate source or test files are outside `export-adapter.ts`, `Done.tsx`, and `qa/v6/{scenarios,evidence}/V6-25`.
- **Mount and browser evidence are consistent.** I recomputed the baseline manifest and the `V6App.tsx`, `navigation.ts`, and `v6.css` hashes; they match the receipt and base commit. The existing browser log reports 5/5 steps, zero console errors, and no external requests. The empty, exported, and stale screenshots show the expected copy and file states. Done remains unregistered in app navigation and uses an in-memory standalone harness; the receipt records both limitations. Existing `build.txt` reports success with a large-chunk warning; I inspected it and did not run a build.
- The candidate remains uncommitted at the integration commit. This review does not change that state.

## What I ran

- `npm run test:v6 -- V6-25` — exit 0; 16 passed, 0 failed, 0 skipped.
- `./node_modules/.bin/tsc -p apps/web/tsconfig.json --noEmit` — exit 0.
- Re-ran V6-24/23/20/19/18/17/16/15/14/12/10/08/05 — exit 0 for each; 302 passed total, 0 failed, 0 skipped.
- Independent synthetic export probes verified all six standalone-manifest file lengths and SHA-256 values against downloaded bytes; claims, specification, and abstract DOCX content against the AST; valid PDF output and checklist input; patentpack decryption, manifest fields, and original figure bytes; byte-identical original figure output both standalone and inside the pack; the sidecar digest; absence of `.xml`; and byte-identical cached retry with one event and no matter-version increment.
- Additional injected-failure, eight-day retention, stale-confirmation, blocker, entitlement, and blank-passphrase probes are described above.
- Inspected existing build and browser evidence and screenshots; did not run the build or browser harness. No `.dev.vars`, network service, real provider, or customer material was used.

Summary: Standards: 0 documented breaches, 1 non-blocking judgment-call smell. Spec: 2 blockers; the missing seven-day cache expiry is the broadest requirement gap.
