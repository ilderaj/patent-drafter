VERDICT: CHANGES_REQUIRED

## Blockers

1. **Locator validation can show a false highlight for changed or foreign source data.** In `Review.tsx`, source membership is inferred from rows returned by `readMatterSources`, but the panel does not verify the row's `source.matterId`/`assetId`; it compares `SourceRef.chunkHash` only to the stored `chunk.hash` and never hashes the chunk text itself (around lines 277–319).

   Reproductions using the V6-19 fixture and a loaded `DraftReviewSession`:
   - Change `parse/source/<sourceId>.source.matterId` to another matter; reload. Result: `locator.status === "located"`.
   - Change the stored chunk text from `温控装置接收热量信号` to `温控装置吸收热量信号` while keeping its old `hash`; reload. Result: `locator.status === "located"`, with the altered text available to render and highlight.
   - Change the current matter `sourceVersion` from 1 to 2 while retaining the revision at source version 1; refresh. Result: `phase === "stale"`, `isCurrent === false`, but the locator remains `located` and `chunkText` remains highlightable.

   The existing scenarios do reject a missing chunk, a `SourceRef` hash mismatch, quote/offset mismatch, retirement, and a changed chunk `sourceId`; those cases do not cover the above integrity failures. The requested stale-revision and source-integrity probes therefore fail.

2. **Confirmation writes bypass the matter-versioned write path.** `confirmParagraph` and `revokeParagraphConfirmation` write only the ledger blob in a backend transaction (`Review.tsx`, around lines 145–164 and 175–191). The contract's C03 says confirmation writes are matter-versioned. Reproduction: load the fixture, read `matter.version` (2), confirm one paragraph, read it again (2), revoke that confirmation, read it again (2). The receipt's first `NEEDS_DECISION` asks whether to bump the version; C03 already requires the matter-versioned write path. The persistence adapter/event question may still need an orchestrator decision, but this implementation currently misses the specified version behavior.

3. **The requested risk/claim/source focus probe is not satisfied.** `DraftReviewPanel` has no risk data or risk locator control, so a risk cannot be clicked from this panel. The recorded browser driver clicks the source locator and opens a paragraph confirmation; it does not click a risk or claim. Also, the default `locateNode` path calls `.focus()` on editor `article`/`li`/`div` nodes without `tabIndex`; the source chunk `article` is likewise not focusable and its handler only scrolls it into view. These paths add a visible outline/mark, but do not transfer DOM keyboard focus to the requested node. This conflicts with the explicit focus probe in this review request, even though the receipt reasonably marks S05 risk-preview behavior out of this ticket's normal mapping.

4. **The candidate evidence records a write outside the allowed checkout.** The receipt's limitation states that the browser run used the `node_modules` symlink into the main checkout and changed its ignored `node_modules/.vite` optimizer cache; the previous cache state was not recorded. Thus the 15-file scope list is accurate for the candidate artifacts, and the tracked shared source files are unchanged, but it is not accurate as a complete account of filesystem changes. I did not run the browser or build and did not modify the main checkout. The prior cache write cannot be independently cleared or compared from the supplied evidence.

## Non-blocking notes

- Confirmation behavior otherwise matches the accepted V6-05 transition API: only `ai`/`mixed` paragraphs are accepted (a human paragraph probe returned `INVALID_INPUT`), records include actor and SnapshotRef, revocation appends and remains visible, reload restores the ledger, and repeating confirmation after revocation returns `created: false` without adding a record. The panel explains that a new revision is needed before reconfirming.
- The second `NEEDS_DECISION` is a real product-contract question: V6-05's current idempotency rule reuses the same confirmation after revocation, so a second live confirmation on the same snapshot cannot be created through that API. The candidate documents this and prevents a silent retry.
- S05-A03 is exercised through the V6-17 revision persistence seam: after confirming five paragraphs, the scenario edits paragraph 2, saves a new revision, and sees all five pending. The other S05 items are marked not applicable with reasons that match this panel's stated scope (preview/paywall/risk acknowledgement, editor conflict/restore/adopt-input, and self-service preview).
- The recorded browser evidence is a standalone synthetic `LocalRepository` + `DraftEditor` + `DraftReviewPanel` mount, not V6App/navigation or IndexedDB integration. Its log reports 4/4 steps, zero console errors, and no external requests. The recorded build completed with the existing large-chunk warning; I inspected this evidence but did not run the build. The receipt also says Node 22 was unavailable; recorded checks used Node 25.8.1.
- `receipt.json` lists 15 changed files; `scope.txt` lists those same 15 plus the excluded `node_modules` symlink. The worktree contains only those 15 candidate files plus that symlink as untracked paths; there are no tracked source changes outside the candidate. The four shared-file hashes and the browser-mount hash match the receipt. `HEAD` equals base `73a70df`; the candidate files are untracked, so the review was performed against the receipt/scope file set rather than a committed Git diff.

## What I ran

- `npm run test:v6 -- V6-19`: 5 passed, 0 failed, 0 skipped, exit 0. An initial invocation from the harness's default directory failed to find `package.json`; rerunning from `/private/tmp/patent-v6-19-worktree` passed.
- Re-ran `V6-18` (7/7), `V6-17` (37/37), `V6-16` (14/14), `V6-15` (41/41), `V6-14` (41/41), `V6-10` (36/36), `V6-08` (12/12), and `V6-05` (26/26); all exited 0 with no skips.
- `./node_modules/.bin/tsc -p apps/web/tsconfig.json --noEmit`: exit 0.
- Inspected recorded `runner.tap`, `regression.txt`, `typecheck.txt`, `build.txt`, `browser-log.json`, screenshots, `scope.txt`, and mount hashes. I did not run the build, browser server, or real provider/network calls, and did not read `.dev.vars`.
