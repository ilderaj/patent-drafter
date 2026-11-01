VERDICT: ACCEPT

# V6-15 independent acceptance review 01

Reviewer: fresh independent reviewer (did not write the code). The worktree was not modified. Nothing was committed. `npm install` was not run. No network, model calls or keys. All probe artifacts are under `/private/tmp/v615-review1/`.

## 1. What was reviewed

- Worktree: `/private/tmp/patent-v6-15-worktree`
- Branch: `codex/v6-15-ai`
- HEAD = base: `593ba33e19728275d2d0cb8692665f0c9bbe5925` (all V6-15 work is untracked, as recorded in the receipt)
- `node_modules` is a symlink (verified)

Verified sha256 hashes (computed by the reviewer):

| File | sha256 |
|---|---|
| `apps/web/src/v6/features/ai/ai.ts` (2681 lines) | `b30d6d20ed8ce1346d8760cfd85cb375ae81358fbbde124638ef65e0385911e5` (matches expected) |
| `apps/web/src/v6/features/ai/Ai.tsx` (997 lines) | `a063a12152061d3b08ac4b71bbc583c4ea2a5a37b7b397a54f8e492b927d2afb` |
| `qa/v6/scenarios/V6-15/harness.mjs` | `48ad6c42cb471774e557bb72af4638a33af98d30b200b6dbe883aa62510127ef` |
| `qa/v6/scenarios/V6-15/ai-engine.test.mjs` | `f6d1b12fcb439e07f6ab4ce45e50d8d306f13768a6d3ca74a6296d9301c1f345` |
| `qa/v6/scenarios/V6-15/ai-consent-concurrency.test.mjs` | `5fbf7f13db10fe0ef6cacf97be09fd36bfb34dd7d712cdc6daf6a9313e15486b` |

The receipt hashes for the source, tests, round-3 fixture and red scripts all match the files on disk.

## 2. Commands run and actual results

| Check | How | Result |
|---|---|---|
| V6-15 suite rerun | `node qa/v6/runner.mjs` on the V6-15 scenarios (cwd = worktree) | 41/41 pass, exit 0 (`/private/tmp/v615-review1/v615-suite-rerun.txt`) |
| Independent adversarial probe | `node /private/tmp/v615-review1/probe/run.mjs` | 20 sections PASS, 3 OBSERVE, exit 0 (`probe-output.txt`) |
| Fix-round 1/2/3 red scripts | Rerun against a mirror copy under `/private/tmp/v615-review1/mirror` | Each exit 0. The expected guards go red on the pre-fix fixture. Afterwards the mirror source is restored to `b30d6d20`, and this was confirmed (`rerun-round{1,2,3}-red.txt`) |
| `red-before-fix.mjs` | Rerun in the mirror | Exit 1 at the first mutation anchor ("found 0"), before any write. The source stays at `b30d6d20`. The script is historical: it was written against source `141bd7d0`, and the receipt records that honestly (see F5) |
| Fix-round diffs | `diff` of the fixture prefixes against the final source | Read in full (`diff-round1.txt`, `diff-round2.txt`, `diff-round3.txt`) |
| receipt.changedFiles vs scope.txt | node set comparison | Identical, 34 paths |
| git status | One plain `git status` (pre-compaction) | 35 entries = the 34 changedFiles + `node_modules`. A later rerun of `git -C ... status` was refused by the session shell hook, so the second check is `not_run` and the earlier result is the one I rely on |
| Shared registration/mount files | Hash compared with base | Unchanged. mount-patch.md documents only a temporary mount that was reverted (original/patched/reverted hashes are consistent) |
| Regression V6-12 / V6-11 / V6-10 | Evidence `regression.txt` | 42/42, 53/53, 36/36, 0 fail. I read the evidence but did not rerun it |
| Typecheck | Evidence `typecheck.txt` | exit=0. Read from evidence, not rerun |
| Build / build-mounted | Evidence `build.txt`, `build-mounted.txt` | Built. Read from evidence, not rerun |
| Browser evidence | `browser-log.json`, screenshots 01-07 | ok:true, 8 steps, consoleErrors [], 20 requests all to localhost, step 8 external []. The screenshots match the claimed states. Read from evidence; the browser run was not repeated |
| runner.tap | Evidence | 41/41 |

## 3. Acceptance mapping

| Item | Status | Evidence |
|---|---|---|
| V6-15-A01: show the outbound manifest and save an authorization | covered | engine tests; probe section 2 (a forged hash or an altered scope gives STALE_BINDING with no write; same-scope reuse works); browser steps |
| V6-15-A02: illegal, stale or failed states, or an unknown region/contract, disable real outbound; the browser does not claim a local model | covered | probe sections 1, 3, 17, 23. `Ai.tsx:271` copy says "本机模型与 BYOK 不可用". Unknown fields render 「未知」 and the grant is disabled. `requestRealInvocation` (`ai.ts:2671-2681`) returns RELEASE_GATE_CLOSED before any repository, storage or network access |
| V6-15-A03: refresh and retry stay consistent with no duplicate side effects | covered | probe sections 5-14 (items 3a-3h); concurrency suite 11 tests |
| S04-A01 | covered | capability/provider truth table: local R4-only, BYOK R2/R4, platform real outbound closed, stub synthetic only (probe 1) |
| S04-A02 | covered | consent requires a known processor, region, retention, training and terms plus a matching manifest hash and scope (probe 2/3). See F3 for the whitespace processorName edge case |
| S04-A03..A07, A09 | not_applicable | They need the job runner or a real adapter, and neither exists in R1. The gate is closed (RELEASE_GATE_CLOSED). The reason is honest and matches the ticket's scope |
| S04-A08 | covered (consent layer) / not_applicable (in-flight job failure) | Revocation is append-only, deterministic and idempotent. Revocation takes precedence over every other validation check (probe 3/4). There is no job runner, so there are no in-flight jobs to fail |
| S04-A10 | covered | The invocation table and view never expose the prompt, content or keys (probe 18) |

## 4. Verification summary by area

1. **R1 truth**: verified (probe 1, 23). The UI never claims a local model is available.
2. **Engine correctness**:
   - Manifest/scope binding: STALE_BINDING.
   - Consent is refused when it is revoked, expired, or has the wrong purpose, provider, profile version or training policy, or when a new file changes the manifest (probe 3).
   - Reuse happens only for the same profile version, purpose and scope.
   - Revocation is append-only and idempotent (probe 4).
   - No fetch/XHR/WebSocket appears in ai.ts or Ai.tsx. The probe confirmed that the gate does not touch storage or the network (probe 17).
3. **Idempotency/concurrency 3a-3h**: all pass with my own probes (sections 5-14):
   - Different-payload grant and revoke races: one winner, one IDEMPOTENCY_CONFLICT, no loser write, one row and one event, stable replays.
   - Identical concurrent requests: both succeed, exactly one has `replayed:true`, one row and one event.
   - Finalize failure after commit: retryable STORAGE_UNAVAILABLE, the prepared claim survives, and the retry replays the original with no second row, event or version bump.
   - Live claim waiter: about 500 ms of polling, then the exact message `同一请求正在处理中，请稍候再试。`, with no writes.
   - Expired-lease takeover while the old owner is held at commit: the new owner wins. The old owner cannot commit, and its cleanup cannot delete the new owner's row.
   - Failed commit: the caller cleans up its own orphan, releases the claim, and a same-key retry at a later clock re-executes.
   - Cleanup deferral rules: verified in code (`ai.ts:1849-1895`) and by probe.
   - Archive: replays still work, new requests and the no-key path give INVALID_TRANSITION.
4. **Tenant/actor isolation**: same-tenant actor B and cross-tenant actor C cannot read, grant, revoke or validate (RESOURCE_NOT_FOUND). No claim, row, event or version bump leaks (probe 15/16). Rows and events bind actor, tenant and matter.
5. **UI**:
   - Loading, failure and stale states render.
   - Unknown or ungrantable grants are disabled.
   - The revocation caveat is shown, the copy is honest, and nothing leaks.
   - Two inconsistencies are minor: F1 and F2.
6. **Evidence integrity**: verified as listed in section 2.
7. **Fix-round diffs**:
   - Round 1 rewrites the idempotency/claim protocol and the grant/revoke paths. It changes no unrelated behavior.
   - Round 2 makes `deleteOrphanConsentRow` defer whenever any idempotency record exists for the operation.
   - Round 3 (`ai.ts:1849-1895`) refines this. Deletion is allowed only when no record exists, or the record is the caller's own pending claim (`record.claimId === ownClaimId`). Cleanup defers on an unreadable record, a completed record, or another owner's claim. A row with a granted event is never deleted. Every call site passes `claimId`, including the keyed orphan path at about line 2041.
   - I found no unintended behavior change.
8. **`writeConsentRow` identity comparison** (`ai.ts:1801-1840`):
   - The comparison fails closed. A row from another tenant or matter gives RESOURCE_NOT_FOUND.
   - The row is reused (`createdRow:false`) only when the `requestKey` is the same and `canonicalJson` of the whole consent is byte-equal. Any other difference gives IDEMPOTENCY_CONFLICT.
   - A stale row is not authoritative without a `consent.granted` event, because `validateConsentForUse` requires both the row and the event.
   - So a stale row can only cause a conflict or reuse identical content, which is a legitimate retry. It cannot create a consent, hide one, or bypass authorization.

## 5. Blockers

None.

## 6. Non-blocking findings and residual risks

- **F1. Archived matter: revoke button still enabled.** `ConsentSection` (`Ai.tsx:446-515`) does not receive `matterArchived`. The revoke button is disabled only when `consent.status !== "active" || busy` (`Ai.tsx:497`). The archived banner (`Ai.tsx:710-714`) says "不能新增或撤回授权", but the button stays clickable. The engine refuses the click safely with INVALID_TRANSITION and writes nothing. The affordance is inconsistent but it is not an authorization issue. Recommendation: pass `matterArchived` down and disable the button.
- **F2. No-available-provider state.** When profiles are configured but none is available or grantable, `loadAiView` returns `kind: "ready"` instead of the empty kind. The empty state with the manual-writing link (`Ai.tsx:686-697`, link at 690) is therefore not shown. Every grant control is still disabled and the copy stays honest, so this is a UX gap, not a false claim.
- **F3. Whitespace-only processorName is grantable.**
  - Cause: the contract schema enforces only `processorName: z.string().min(1)` (`packages/contracts/src/jobs.ts:24`). `unknownProfileFields` (`ai.ts:331-340`) does not check processorName at all, and `fieldView` (`ai.ts:324-328`) does not trim.
  - Effect: an approved platform profile with processorName `"   "` is grantable and saves a consent (probe observation).
  - Why not a blocker: this needs trusted malformed configuration, and the release gate is closed, so no data leaves the device.
  - Recommendation: trim processorName and include it in the unknown-field checks before real outbound opens.
- **F4. No 30-day idempotency retention or IDEMPOTENCY_EXPIRED tombstone.**
  - The contract (`05-contracts.md` section 2, line 59) asks for 30-day success retention and an `IDEMPOTENCY_EXPIRED` tombstone. ai.ts implements neither. Records and replays are kept indefinitely.
  - This does not produce a wrong success, a duplicate side effect or a bypass: it fails toward replay, and only metadata is stored locally.
  - It is a contract gap that the receipt does not list as a limitation. It should be recorded and tracked before the server-side or real-adapter tickets.
- **F5. `red-before-fix.mjs` cannot be rerun against the final source.** Its mutation anchors no longer exist, so it exits 1 before writing. The receipt honestly records that it was run against source sha `141bd7d0`. The fix-round 1/2/3 red scripts can be rerun and behave correctly. I judged the script as historical evidence.
- **F6. Latent test bug.** `ai-engine.test.mjs:650` uses `now: () => T4`, but `T4` is undefined. The thunk is never invoked on the replay path, so the test passes. It would throw if the code path changed.
- **F7. Omitted targetId.** `validateConsentForUse` checks the target only when `input.targetId !== undefined` (`ai.ts:2338`). An omitted targetId validates against the stored target's manifest. An explicit `null` or another target is refused. The current manifest is still checked, so this is safe, but the semantics should be documented for future callers.
- **F8. Double click.** The UI busy guard depends on render state only, and `handleGrant` creates a new request key for each call (`Ai.tsx:848-886`). A very fast double click could therefore send two keyed requests. Each one is idempotent, consent reuse folds them into the same consent for the same scope, and there is no duplicate under one key. Low risk.
- **F9. Claim protocol limits, recorded in the receipt.** The claim protocol works only for the local repository, the lease is a 30 s wall-clock lease, and there is no job runner or real adapter. These limits are honestly recorded and bounded. They are acceptable for R1 because the probes showed no wrong success, no duplicate side effect per key, and no authorization bypass, including the expired-lease takeover. They must be revisited when a multi-process or server backend is added.

## 7. Authorization

This ACCEPT verdict authorizes the orchestrator to mark the V6-15 receipt as accepted and to mount the feature. The non-blocking findings F1-F4 should be tracked as follow-ups. F4 should be added to the receipt's recorded limitations.
