VERDICT: ACCEPT

## Blockers

None. Both blockers from `review-01.md` now fail closed under independent reproductions:

1. I ran a stub adapter with `modelId: "configured-model"`; the LLM stage reported `provider: "mock"`, `model: null`, and made zero injected-provider calls. I then seeded a valid cache record, changed only its provider, model, prompt-version, and rule-pack-version metadata while keeping its output hash valid, and ran the same input through a new adapter. The forged record was deleted, the provider ran once for that stage, and the returned metadata matched the active configuration. A following normal cache hit made zero provider calls and reported `cached: true` for the stage and its restored upstream checkpoint.

2. I seeded a shared cache, corrupted the target stage’s `outputHash`, and ran the same input through two new adapters. The first recomputed that stage once and repaired the record; the second made zero provider calls and reported a cache hit. I recomputed the canonical output digest and confirmed the repaired record was valid. With a cache whose `putIfAbsent` returned a poisoned entry on both attempts, the adapter deleted each bad value and failed with `INTERNAL_ERROR` rather than returning the poisoned output.

## Non-blocking notes

- The metadata checks match each stage kind. In a full synthetic pipeline run, the local `ingest_sources` stage and the deterministic stages reported `provider: "deterministic"` and `model: null`; LLM stages reported the configured provider and model. Prompt and rule-pack metadata matched the active pipeline options.
- An independent concurrent-run probe made seven provider and authorization calls for two identical simultaneous `draft_claims` runs, equal to one call per LLM stage. Explicitly different `cacheScopeId` values over the same project/input produced separate cache misses. The V6-16 suite also covers input immutability and schema-invalid output failing after one provider call while retaining earlier checkpoints.
- The authorizer ran once per real structured provider call in the full-pipeline probe (13 authorizations for 13 calls). Cache hits skip the authorizer because they make no provider call; callers still need to enforce access to cached results and choose a cache scope that isolates the data owner.
- Receipt scope accounting is accurate: `changedFiles` equals `scope.txt` with `node_modules` excluded (12 paths). `review-01.md` is reviewer-authored evidence and appears in both lists. All listed paths are within the V6-16 write set; `node_modules` is the only extra untracked path and is excluded from the receipt comparison.
- The S04 applicability mapping is reasonable for this library-only ticket: A07 is covered; A01–A06 and A08–A10 require profile/UI, manifest/consent repository, quota, job, lease, adoption, lifecycle, or invocation-view integration outside this adapter.
- C11 requires IndexedDB checkpoints in R1. The open decision is the checkpoint schema, ownership key, and retention/cleanup policy; persistence itself is not optional. The second `NEEDS_DECISION` is also correctly framed: §5 defines consent scope fields and requires exact scope plus derived-output lineage, but does not define the canonical per-stage manifest/hash that this adapter’s `scopeHash` should be checked against.
- The adapter is ready for V6-17 to consume without further adapter changes: its cache interface accepts async caller-owned storage, supports deletion of rejected checkpoints, and binds cached metadata to the active stage/execution/provider/model/prompt/rule-pack configuration. V6-17 still needs the two contract decisions to implement IndexedDB ownership/retention and exact consent-scope validation. No real provider or network call was made.
- The receipt discloses the runtime limitation: checks ran on Node 25.8.1/npm 11.11.0, while the architecture note specifies Node 22. Node 22 remains unverified. Recorded build evidence reports exit 0 with the existing >500 kB chunk warning; I inspected it and did not run the build.

## What I ran

- `npm run test:v6 -- V6-16` — exit 0; 14 passed, 0 failed, 0 skipped.
- `./node_modules/.bin/tsc -p apps/web/tsconfig.json --noEmit` — exit 0.
- `/tmp/v6-16-review-02-probe.mjs` via `node --import tsx` — exit 0; stub metadata, forged provider/model/prompt/rule-pack metadata, normal cache-hit metadata, corrupted-hash repair across adapters, repeated poisoned writes, all stage-kind metadata, authorization counts, explicit cache-scope isolation, and concurrent in-flight deduplication.
- `npm run test:v6 -- V6-10` — exit 0; 36 passed, 0 skipped.
- `npm run test:v6 -- V6-14` — exit 0; 41 passed, 0 skipped.
- `npm run test:v6 -- V6-15` — exit 0; 41 passed, 0 skipped.
- Inspected the recorded regression, V6-10/V6-14/V6-15, typecheck, and build evidence. The recorded workspace regression reports 44 passed; recorded typecheck and build exit codes are 0. I did not read `.dev.vars`, run a build, or call a real provider.
