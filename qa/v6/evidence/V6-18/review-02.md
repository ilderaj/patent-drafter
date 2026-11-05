VERDICT: CHANGES_REQUIRED

## Blockers

1. **An edit made while save is pending is silently discarded.** The editor leaves paragraph fields enabled while `state.saving` is true. `DraftEditorSession.save()` captures the validated model, awaits the revision write, then replaces the current model with the saved snapshot, sets `dirty` false, and deletes the buffer for the old base revision. An edit made during that await is therefore lost.

   **Independent reproduction:** Load a revision, edit a paragraph to `edit before save`, and start `save()` with a revision-store wrapper that pauses before calling the real `saveEditedRevision`. While paused, edit the same paragraph to `edit while save is pending` and wait for the buffer write. Release the save. The new head contains `edit before save`; the session model is reset to that text with `dirty=false`; and the active buffer is deleted. I ran this deterministic interleaving against `DraftEditorSession` and observed exactly that result. Disable editing while saving, or preserve and rebase edits made after the save snapshot; add a test that checks the model and persisted buffer after this interleaving.

2. **The receipt and scope inventory disagree.** `receipt.json` lists 15 `changedFiles`, including `qa/v6/evidence/V6-18/typecheck.txt`, and asserts `scopeMatchesChangedFiles: true`. `scope.txt` lists only 14 candidate paths and omits `typecheck.txt`; its `includedFiles` count is consequently 14. The base-commit diff has 15 paths, so the scope assertion is not accurate as written. Add the missing path and reconcile the count/assertion, or correct the receipt if that artifact is not part of the candidate scope. `node_modules` is excluded from the receipt; `review-01.md` is reviewer-written and not a candidate change.

## Non-blocking notes

- The three round-one blockers are fixed on independent inspection. The revision seam accepts the expected input and figure revision, and the editor passes its base input. The seam refuses changed `sourceVersion`, `targetConfigVersion`, or `figureRevisionId` with `INPUT_STALE` before creating a revision row or event. If a matter-version race occurs during commit, it rechecks the input and removes the uncommitted feature revision row before returning stale.
- **Independent B1 probes:** I interleaved source, config, and figure-set changes after editor validation without changing the draft head. Each save returned `INPUT_STALE`; the head, revision-row count, and `revision.created` events were unchanged; and both the in-session edit and local buffer remained. With input unchanged, a save succeeded and retained a figure ID in the current set. An unknown figure ID returned `INVALID_AST` on its paragraph and wrote no revision row.
- **Independent B2 probe:** Changing claim 2’s number to 4 yielded `INVALID_AST` with missing number 2, `nodeId` equal to claim 2, and `claimNumber: 2`. The UI’s invalid-issue effect focuses `draft-node-{nodeId}`; the recorded browser step independently asserts that the active element is claim 2, not the generic claims container.
- **B3 screenshots:** `01-editor-loaded.png` shows initial revision `77777777-7777-4777-8777-000000000001`; `02-editor-saved.png` shows new revision `34b4afb4-9ee1-4df8-9232-86d4c8473028` and edited text. This matches the capture order in `browser-drive.mjs`, `browser-log.json`, and the receipt.
- The V6-18 scenarios and source cover stable IDs and pure model edits, `ai` to `mixed`, paragraph delete/insert, `VERSION_CONFLICT` merge with buffer retention, reload/persistence, current figure validation, and repeated save without duplicate revision events. The additional in-flight-edit race above is not covered and causes data loss.
- The S05 mapping is honest for this ticket’s scope: A03, A04, and A08 have matching covered behavior; A01, A02, A05, A06, A07, and A09 are marked not applicable with reasons that exclude the full preview/projection, restore/adoption, and risk/service flows. The receipt accurately notes that the browser harness directly mounts the component rather than exercising app navigation, and that Node 22 and full route registration remain unverified.
- The candidate diff is confined to the draft editor/adapter, the authorized narrow `generation.ts` revision seam, and V6-18 scenarios/evidence. The recorded build evidence reports exit 0 with the existing chunk-size warning; I inspected it but did not run the build. The recorded browser evidence reports no external requests or console errors; I inspected its log and screenshots but did not rerun the evidence-writing browser driver.

## What I ran

- `npm run test:v6 -- V6-18`: 9 passed, 0 failed, 0 skipped; exit 0.
- `./node_modules/.bin/tsc -p apps/web/tsconfig.json --noEmit`: exit 0.
- Re-ran `npm run test:v6 -- V6-17`, `V6-16`, `V6-15`, `V6-14`, `V6-10`, and `V6-08`: all exit 0; respectively 37, 14, 41, 41, 36, and 12 passed, with no failures or skips.
- Ran isolated interleaving probes for the three stale-input cases, unchanged-input success, figure reference validation, and an edit during a pending save. Ran a direct claim-number-gap mapping probe. These used synthetic in-memory data only.
- Inspected the base diff, candidate source/tests, receipt and scope, recorded build/browser evidence, and both PNGs. No build, provider call, or external request was made.
