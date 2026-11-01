# V6-13 mount instructions (for the coordinator)

V6-13 ships `apps/web/src/v6/features/intake/Intake.tsx`. The ticket's write set
excludes `apps/web/src/v6/routes/V6App.tsx`, so this branch does not mount it.
The coordinator applies the two edits below by hand. They are instructions, not
a diff: the PR branch's `V6App.tsx` differs from base `953e05d` (it imports
`Figures` from `../features/sources/Figures.tsx` and renders `<Figures .../>`
inside the sources branch), so line numbers and context lines from this
worktree do not apply there.

## Edit 1: import

Add this exact line directly after the line that imports `Parse`
(`import { Parse } from "../features/sources/Parse.tsx";`):

```tsx
import { Intake } from "../features/intake/Intake.tsx";
```

If the `Figures` import sits next to the `Parse` import, the position relative to
it does not matter; keep the new line after `Parse`.

## Edit 2: the `facts` tab in `MatterPage`

Find the existing expression in `MatterPage` that starts with
`{tab === "sources" ? (`. Do not change anything inside the sources branch
(`Upload`, `Parse`, `Figures` and whatever else the PR branch renders there).

Replace only its opening token:

```tsx
      {tab === "sources" ? (
```

with:

```tsx
      {tab === "facts" ? (
        <Intake repository={repository} actor={LOCAL_ACTOR} matterId={matterId} />
      ) : tab === "sources" ? (
```

The rest of the chain stays as it is: the sources branch, then the
`capability.state === "unavailable"` notice, then the overview list. The result
is that `tab === "facts"` renders the intake panel, and every other tab renders
exactly what it renders today.

## Checks after applying

1. `node_modules/.bin/tsc -p apps/web/tsconfig.json --noEmit` exits 0.
2. `npm run build --workspace @patent/web` exits 0.
3. Open `/patent/v6/matters/{id}/facts`: the page shows `data-testid="intake"`,
   not `tab-unavailable`.

## Why this is the seam

- `MATTER_TABS` already has a `facts` tab, and `TAB_CAPABILITIES` reports it as
  unavailable. The new branch comes before the unavailable fallback, so the tab
  renders the intake panel instead of the notice.
- `Upload`'s `onAnswerWithoutDocuments` already navigates to the `facts` tab, so
  "answer without documents" leads straight to this panel.
- `Intake` owns its own load, save, retry, recovery and version-conflict
  handling. `MatterPage` only supplies the repository, `LOCAL_ACTOR` and the
  matter id. `Intake.tsx` never imports from `V6App.tsx`.

## Evidence run

The browser evidence in this folder was produced with these two edits applied
temporarily to this worktree's `V6App.tsx` (base `953e05d`, without `Figures`).
Afterwards the file was restored from a byte copy. Its sha256 is
`15b6f3c87175fa240cb8cf6c0e86956bbee947c2e66367d3d1a23d78953543ac`, the same
as before the run, and `git status --porcelain` does not list it.
