# V6 Staging Isolated Deployment & Online Real-AI E2E Acceptance (2026-11-22)

## 1. Cloudflare Workers Dual-Domain Isolation

| Worker | Custom Domain | Environment | Current Version ID | AI Status (`GET /api/v6/status`) |
| --- | --- | --- | --- | --- |
| `patent-v6` | `https://patent.paymond.me` | Production (top-level) | `06011260-2966-45aa-a47a-2eaf4a54ccd8` | `configured: false`, `available: false`, `devUndisclosed: false` (fail-closed) |
| `patent-v6-staging` | `https://patent-v6.paymond.me` | `--env staging` | `0c427dba-614f-47e4-9e45-03786e301a1f` | `configured: true`, `available: true`, `devUndisclosed: true`, `authenticated: false`, `model: "hy4-flash-free"` |

- Production worker `patent-drafter` was not touched.
- Staging secrets (`MODEL_API_KEY`, `ACCESS_CODE`, `SESSION_SECRET`) were injected via in-memory stdin pipes to `wrangler secret put --env staging`; zero secret material was printed, logged, or committed.
- Main worktree (`/Users/jared/Personal Projects/Patent`) was not modified.

## 2. Modified & Added Files (`codex/v6-staging-deploy`)

- `apps/worker-v6/src/index.ts` — Added `MODEL_USER_AGENT` and `MODEL_SEND_OPENCODE_SESSION` env bindings; always sends `user-agent` (default `patent-v6-worker/1.0`); automatically computes deterministic RFC 4122 UUID v4 `x-opencode-session` from hashed session token for `https://opencode.ai/{inference|zen}/go/v1` (or when `MODEL_SEND_OPENCODE_SESSION="true"`).
- `apps/worker-v6/test/opencode-go.test.mjs` — Unit tests covering default/custom `user-agent`, `inference/go/v1` and `zen/go/v1` UUID v4 `x-opencode-session` stability across same session and rotation across sessions, no raw token leakage, and opt-in flag for non-OpenCode endpoints.
- `qa/v6/local/live-opencode-go.mjs` — Local `wrangler dev --local` smoke harness for OpenCode Go (`hy4-flash-free`, reads `opencode-go` key in memory only; supports single `/api/v6/chat` and `--full` 13-stage runs).
- `wrangler.patent-v6.jsonc` & `wrangler.patent-v6.alt.jsonc` — Split top-level `patent-v6` (`patent.paymond.me`, fail-closed `RATE_LIMIT_PER_DAY: "60"`, no `MODEL_*`) from `env.staging` (`patent-v6-staging`, `patent-v6.paymond.me`, OpenCode Go `hy4-flash-free`, `MODEL_ALLOW_UNDISCLOSED_DEV: "true"`, no `PROCESSOR_TERMS_VERSION`).
- `packages/domain/src/v6/checks.ts` & `qa/v6/scenarios/V6-23/checks.test.mjs` — Fixed a P0 loop-order bug discovered during the first live real-AI staging E2E run (details below) and added a regression test.
- `qa/v6/evidence/release/deploy/2026-11-22/` — Online E2E acceptance script (`run_staging_e2e.py`), structured evidence (`staging-e2e.json`), screenshots, and exported artifacts.

## 3. Local Gate Verification

- `NODE_DEBUG='' npm run typecheck` — PASS (all workspaces)
- `NODE_DEBUG='' node --test apps/worker-v6/test/*.test.mjs qa/v6/scenarios/real-ai/*.test.mjs qa/v6/scenarios/V6-25/dev-undisclosed.test.mjs qa/v6/scenarios/V6-23/checks.test.mjs` — **127 / 127 PASS** (`fail: 0`)
- `NODE_DEBUG='' npm run build:v6-root -w @patent/web` — PASS (`apps/web/dist/v6`, 29 assets)
- Local `live-opencode-go.mjs` smoke — PASS (`https://opencode.ai/inference/go/v1`, `hy4-flash-free`, HTTP 200 valid JSON)

## 4. Online Dual-Domain Isolation & 13-Stage Real-AI E2E Evidence

### 4.1 Dual-Domain Checks
- `GET https://patent.paymond.me/` -> `302 /v6`; `GET https://patent.paymond.me/v6` -> `200`
- `GET https://patent.paymond.me/api/v6/status` -> `configured: false`, `available: false`, `devUndisclosed: false`, `unavailableReason: "真实起草服务尚未配置完整。"`
- `GET https://patent-v6.paymond.me/` -> `302 /v6`; `GET https://patent-v6.paymond.me/api/v6/status` -> `configured: true`, `available: true`, `devUndisclosed: true`, `authenticated: false`, `model: "hy4-flash-free"`, `endpoint: "https://opencode.ai/inference/go/v1/chat/completions"`

### 4.2 Real-AI 13-Stage Browser E2E (`https://patent-v6.paymond.me/v6`)
- Synthetic matter: smart tri-mode water meter (`synthetic-water-meter.txt`, `cn_um`), matter `1117b034-9089-42f6-bf6f-db5378d88ffb`, target `828a57c6-2480-5994-8b1c-62778f03b633`.
- Consent sheet (`consent-sheet.png`): authenticated via UI access code, confirmed display of `hy4-flash-free` and `开发验证：处理方信息未核实，仅限合成材料，不得用于真实客户材料。`.
- Explicit consent granted -> all 5 UI stage groups (`facts`, `support`, `claims`, `specification`, `checks`) and **13 / 13** `/api/v6/chat` requests returned **HTTP 200** on attempt 1 (0 retries), total elapsed **125,110 ms** (~125.1 s):

| Chat # | HTTP Status | Elapsed (ms) |
| ---: | ---: | ---: |
| 1 | 200 | 12,114 |
| 2 | 200 | 3,827 |
| 3 | 200 | 5,798 |
| 4 | 200 | 14,245 |
| 5 | 200 | 7,753 |
| 6 | 200 | 6,064 |
| 7 | 200 | 9,407 |
| 8 | 200 | 11,086 |
| 9 | 200 | 8,406 |
| 10 | 200 | 3,488 |
| 11 | 200 | 11,843 |
| 12 | 200 | 11,721 |
| 13 | 200 | 16,058 |

- Adoption & non-test verification: `data-test-output="false"`, no `generation-test-output` notice, `adoptedTestOutput: false`, no `preview-test-output` or `done-test-output-label` watermark.
- Checks & confirmations: `blockerCount = 0`, 31 / 31 risk findings acknowledged, 23 / 23 AI paragraphs confirmed in draft editor and verified intact after page reload, self-read confirmed, approval recorded on Done page.
- Export verification (`done-after-export.png`, `acceptance-evidence/导出清单.json`):
  - `导出清单.json` contains `"devVerification": { "devUndisclosed": true, "note": "开发验证：处理方信息未核实，仅限合成材料，不得用于真实客户材料。" }` and `"testOutput": null`.
  - All 6 downloaded export artifacts are non-empty and match exact byte counts and SHA-256 digests in `导出清单.json`:
    - `权利要求书.docx` — 2,095 bytes (13 paragraphs, 12 claims, no test watermark)
    - `说明书.docx` — 2,494 bytes (11 paragraphs)
    - `说明书摘要.docx` — 1,636 bytes (2 paragraphs)
    - `提交检查清单.pdf` — 1,054,865 bytes (5 canvas-rendered pages, inspected visually via `checklist-pdf-page1.png`)
    - `项目备份.patentpack` — 19,873 bytes
    - `导出清单.json` — 6,293 bytes
- Runtime health: `pageerror === 0`, `console.error === 0`, `externalRequests === []` (only same-origin requests + Cloudflare Insights beacon).

## 5. Issues Discovered During Live Acceptance

1. **[Fixed in this run — P0 Blocker]** `packages/domain/src/v6/checks.ts` (`basicAstIssues`) validated `claim.features[].supportParagraphIds` against `paragraphs` *before* scanning `ast.sections` to add specification paragraph IDs into `paragraphs`. Every real-AI draft with valid specification support links triggered false `ast.invalid` blockers (`支持段落引用不存在。` — 42 blockers on the first live run), permanently blocking approval and export. Fixed loop order to match `packages/contracts/src/draft.ts` and added a unit regression test in `qa/v6/scenarios/V6-23/checks.test.mjs`; rebuilt and redeployed both Workers, after which the live run reported `blockerCount = 0`.
2. **[Logged for v6.1 — UX Friction]** `apps/web/src/v6/features/workbench/GenerationRuntime.tsx` (`refresh`, line 121) automatically opens `WorkbenchConsentSheet` whenever navigating to `/draft` and `next.mode === "real" && next.consent.required`. Because adopting a newly generated draft changes the outbound manifest hash (it now includes the adopted claims/sections), opening `/draft` to review or confirm paragraphs immediately pops up the outbound consent modal and blocks editing/confirmation until the user clicks "取消". Recommended v6.1 fix: only open the consent modal when the user initiates generation or clicks the consent control, rather than on passive `/draft` mount.
3. **[Script Assertion Note]** In the executed `staging-e2e.json` run, two local post-download script checks (`downloads-valid-nonempty` reading `d.get("size")` instead of `d.get("bytes")`, and `checklist-pdf-valid-and-dev-warning` expecting extractable PDF text on a canvas-rasterized Chinese PDF where `devVerification` is recorded in `导出清单.json` and the UI) reported `ok: false` despite all 6 files being valid and SHA-256 verified. Both assertions have been corrected in `run_staging_e2e.py`.
