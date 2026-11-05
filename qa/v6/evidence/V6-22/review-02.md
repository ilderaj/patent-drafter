VERDICT: ACCEPT

## Round-1 blockers

- **B1 target language (S06 section 3 overview table): fixed.** `workbench.ts` now projects `language` per target (`TargetLanguage`, lines 14, 26, 149, 432-445). The projection is scoped to tenant, matter, target, and `configVersion`, and accepts only `zh-CN` or `en-US`. `Workbench.tsx` exports `TargetOverviewTable` with a 语言 column and `data-language` on each row. The new test `S06 overview: target language is projected and rendered for each target` passes: it checks zh-CN and en-US in the data and in the rendered markup.
- **B2 failed-action claim: narrowed to the real public path.** The test `V6-22-A02: activity derives outcomes; a failed job stays failed and a retry has its own job id` passes. It records `job.failed` for one job and `job.succeeded` for a distinct retry job id, and asserts that each row keeps its own outcome. The workbench creates no events. The receipt states that no same-job terminal-transition guard is claimed. See note 1 for what this leaves open.
- **B3 browser evidence: fixed.** `browser-mount.tsx` creates one root (line 92) and reuses it with `root.render` for the missing-matter case. The saved `browser-run.txt` reads `passed: 9 steps, 0 console errors, 0 external requests`, and `browser-log.json` has `consoleErrors: []` and `result: passed`. I also reran `browser-drive.mjs` with its output directory set to `/tmp/r2-browser-out`, so the evidence directory was not touched. The rerun returned exit 0 with the same 9/9, 0 console errors, 0 external requests.
- **B4 regressions, hashes, and S06-A07 reason: fixed.** The receipt's V6-19 entry is 16/16. `browser-mount.html` hashes to `6c302ca2…706c77ef` and `browser-mount.tsx` hashes to `269371cb…c08550`, both matching `mountHashes`. `baselineManifestSha256` is `d7a3fc33…ccccf4`. The S06-A07 reason now points to the inbox/V6-21 boundary.

## Refreshed evidence and scope

- `receipt.json` `changedFiles` is 38 entries, and it equals `scope.txt` exactly (sorted comparison, no differences).
- Tracked files are unchanged (`git diff --stat HEAD` is empty). Untracked paths are limited to `apps/web/src/v6/features/workbench/`, `qa/v6/evidence/V6-22/`, `qa/v6/scenarios/V6-22/`, and the `node_modules` symlink, which is excluded.
- The receipt's `runs` list records the build as exit 0 with the existing chunk-size warning. I did not run the build, per instructions.

## Checks run in this round

- `npm run test:v6 -- V6-22`: exit 0, 15 passed, 0 failed, 0 skipped.
- Web typecheck (`npm --prefix … exec --workspace=@patent/web -- tsc --noEmit`): exit 0.
- Regression reruns, all exit 0 with zero skips: V6-21 29/29, V6-20 9/9, V6-19 16/16, V6-18 10/10, V6-17 37/37, V6-12 42/42, V6-10 36/36, V6-08 12/12.
- Saved aggregate `regression.txt` matches the recorded counts for V6-06 through V6-23 and the worker and export workspaces.
- Browser driver rerun into a scratch directory: 9/9, 0 console errors, 0 external requests.
- No `.dev.vars` was read, and there were no network or provider calls.

## Non-blocking notes

1. **A02 wording is narrower than the ticket.** The ticket says "活动失败不生成虚构成功记录". The repository still accepts a same-job `job.succeeded` after `job.failed` at the current matter version (`LocalRepository.commit` does not enforce terminal job transitions). The workbench does not create that record, and the receipt discloses the gap. Whoever owns the spec should explicitly accept the narrowed claim, or track a terminal-transition guard to V6-17 or the repository.
2. `targetConfigLanguage` returns the first `target.config` blob whose `configVersion` matches. It does not check uniqueness, so duplicate rows at one version would make the result depend on storage order. Repository writes do not normally produce such rows.
3. The overview shows the current revision ID, not a revision number. S06 section 3 says "当前修订号". Accepting the ID as the revision identifier is reasonable, but it should be stated as an interpretation.
4. `ActivityFeedView` initializes its filter state once. Read from the code, not reproduced: if the parent changes `currentMatterId` without remounting, the matter filter keeps the old value. The current Workbench route does not appear to hit this path.
5. The receipt's own `review.verdict` still reads `pending_re_review`. This is cosmetic and should be updated after this review.
6. Node 22 remains unverified, as the receipt states. App shell registration of the workbench remains orchestrator-owned, as the receipt states.
