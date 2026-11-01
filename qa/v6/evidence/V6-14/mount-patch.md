# V6-14 mount patch (orchestrator-owned file)

The feature is self-contained in `apps/web/src/v6/features/targets/`. The shell
does not render it until the orchestrator registers it. For the browser
evidence only, the edit below was applied to `apps/web/src/v6/routes/V6App.tsx`,
built, driven in headless Chrome, and then reverted byte for byte. No other
orchestrator file (`navigation.ts`, `v6.css`, `packages/*`, `.planning/`) was
touched.

## Edit 1: import (after the `AiPage` import, line 17)

```tsx
import { TargetsPanel } from "../features/targets/Targets.tsx";
```

## Edit 2: render on the 概览 tab (end of `MatterPage`, before its closing `</div>`)

```tsx
      {tab === "overview" ? <TargetsPanel repository={repository} actor={LOCAL_ACTOR} matterId={matterId} /> : null}
```

`LOCAL_ACTOR`, `repository` and `matterId` are already in scope there.

## Procedure and hashes

1. Copied the original bytes to `/private/tmp/v6-14-scratch/V6App.tsx.orig`
   (outside the repo).
2. Applied the two edits above.
3. Ran `npm run build` (`build-mounted.txt`, exit 0), served `apps/web/dist`
   with `vite preview --port 4176 --strictPort --host localhost`, and ran
   `node qa/v6/evidence/V6-14/browser-drive.mjs qa/v6/evidence/V6-14 http://localhost:4176/patent`.
4. Stopped the preview server and restored the file with
   `cp /private/tmp/v6-14-scratch/V6App.tsx.orig apps/web/src/v6/routes/V6App.tsx`.
5. Ran `npm run typecheck` and `npm run build` on the restored tree
   (`typecheck.txt`, `build.txt`, both exit 0).

| file | original (before patch and after revert) | with patch |
| --- | --- | --- |
| `apps/web/src/v6/routes/V6App.tsx` | `91a04dbe435e74256f13bb49a0231cafdc1dd440e4d1ebafbcb917a568c2431b` | `65d722007b9a079c3d32ee72115d91105fc6516d50600d7c4c647b06ad36e496` |

After the revert, `shasum -a 256` printed the original value, and
`git status --porcelain --untracked-files=all` no longer lists `V6App.tsx`.

The patch was applied once. The mounted build and the drive ran twice, both
with the same patched hash. The first drive passed 8/8, but its screenshot
showed the active switcher chip with an invisible label (see below). After
fixing `Targets.tsx`, the build and the drive were run again. The evidence
files hold the second run.

## Notes for the orchestrator

- **`v6.css` bug (orchestrator-owned, not changed here).**
  - Cause: `.v6-targets .chip { color: inherit; }` has the same specificity
    as `.chip.active` in `styles.css` and loads later. So an active chip gets
    `background: var(--foreground)` with foreground-coloured text, and its
    label cannot be read.
  - Impact: the existing target nav in `MatterPage` (`<nav className="v6-targets">`)
    has the same problem as soon as a matter has targets.
  - Workaround here: the V6-14 switcher no longer uses `.v6-targets`.
  - Check: the drive's step 04 asserts that the active chip's text colour
    differs from its background.
- **Stale shell data.**
  - What: `MatterPage` loads its `MatterView` once. After the panel creates
    targets, the overview row 目标 still shows 尚未创建 and the shell's
    target chips do not appear until the page reloads. The screenshots show this.
  - Fix: the permanent registration should refresh the matter view after a
    target write, or drop the duplicate 目标 row.
  - Scope: this is shell code, so V6-14 does not change it.
