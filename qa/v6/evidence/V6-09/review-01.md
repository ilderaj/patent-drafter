# V6-09 independent review — 2026-10-31

VERDICT: CHANGES_REQUIRED

Independent reviewer reproduced four blockers:

1. `useAppearanceBootstrap` captures the initial stored preference. Save Graphite/dark, leave settings, then change OS dark to light: the shell reapplies Native/light while storage remains Graphite/dark.
2. Fail a save from dark to light, leave settings and return: the unsaved choice and retry disappear without the warning required by S01.
3. Leave V6 for legacy: root theme/mode attributes remain and global theme CSS overrides legacy appearance until reload.
4. Browser driver catches assertions but unconditionally exits zero; console errors do not fail the command.

The reviewer reported actual React-hook reproductions with in-memory DOM/media/storage stubs. Independent V6-09 scenarios passed 17/17, V6-08 passed 12/12, web TypeScript and diff whitespace checks passed. These checks do not establish acceptance because navigation lifecycle paths were absent from the existing scenarios and browser run.

The receipt remains candidate. Fixes, new regression evidence and independent re-review are required before acceptance.
