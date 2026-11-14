# V6-09 independent re-review — 2026-10-31

VERDICT: ACCEPT

Independent read-only reviewer (worktree untouched; probes and mutation copies under /tmp only):

- `npm run test:v6 -- V6-09` 21/21, 0 skipped; `npm run test:v6 -- V6-08` 12/12; web `tsc --noEmit` exit 0.
- `browser-drive.mjs` re-run live against the worktree dev server: 16/16 steps, 0 console errors, exit 0.
- Receipt `changedFiles` matches `git status --porcelain --untracked-files=all` (node_modules and `.claude/launch.json` excluded); `git diff --check` clean.
- Contrast for all 8 theme × mode blocks meets AA (body ≥13.6:1, muted-on-card ≥5.38:1, primary foreground ≥6.6:1).

Round-1 blockers all fixed and regression-guarded: single `AppearanceProvider`; failed-save departure guard (link and Back, stay/discard); root attribute restore on unmount; driver exit code. Mutation check: removing the guard, the restore effect or the exit-code logic each fails the intended test.

Non-blocking notes (recorded as receipt limitations):

1. A tab whose first history entry is the app: Back with a failed save leaves the document with no dialog; only `beforeunload` covers cross-document exits, and Chrome may drop it without user activation.
2. A StrictMode effect re-run while a save is failed would wrap the patched navigator; latent only (production does not double-run).
3. The driver's `evaluate` ignores `exceptionDetails`, and unhandled promise rejections bypass the console-error gate.
4. Clicking the current section's own nav link with a failed save asks to leave; discard loses the unsaved choice.
5. No test would catch a re-introduced per-route stale read (the fix is structural).
6. One progress.md entry called the implementer's check an orchestrator review; wording corrected.
