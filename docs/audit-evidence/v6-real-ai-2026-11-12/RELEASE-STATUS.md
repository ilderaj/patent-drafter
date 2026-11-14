# RELEASE-STATUS · V6 真实 AI 链路验收收口（2026-11-14）

## 1 范围声明（先读）

- 上游是**本地假的 OpenAI 兼容服务**（`fake-upstream.mjs`），只用于验证 **status → 访问码 → 同意凭证 → chat → 采纳 → 交付**
  链路和拒绝/失败路径，**不验证真实模型质量、法律质量或供应商行为**。
- **真实供应商未选定、未配置、未做 live smoke**；本证据目录**不构成真实外发上线条件**。
- 未改产品源码、未提交、未部署、未调用任何真实供应商；所有服务在每次验收后停止（当前无残留进程）。

## 2 版本

| 项 | 值 |
|---|---|
| 工作树 | `.claude/worktrees/v6-prototype-alignment`，分支 `codex/v6-prototype-alignment` |
| 提交 | `e5ce6a5`（+ 334 个未提交路径，含本轮全部开发交付） |
| 最后一次 A/B/C 复验构建 | `indexSha256=6b7c27bd16e1…`，`indexMtime=2026-11-13T19:29:24Z`，现场重建（未沿用旧 dist） |
| 验收环境 | `accept-env.mjs`：假上游 + 3 个 `wrangler dev --local`（full / unconfigured / undisclosed），固定合成密钥（仅环境变量） |

## 3 最终门禁（各跑一次，日志 `final-gates/`）

| 命令 | 退出码 | 计数 |
|---|---|---|
| `npm run typecheck` | **0** | —（`final-gates/typecheck.log`） |
| `npm run build -w @patent/web` | **0** | 构建成功（仅既存 >500 kB chunk 提示，`final-gates/build-web.log`） |
| `node qa/v6/runner.mjs --all` | **0** | 30 个场景目录，tests=737，pass=737，fail=0，cancelled=0，skipped=0（`final-gates/runner-all.log`） |
| `npm run test -w @patent/worker-v6` | **0** | tests=23，pass=23，fail=0（`final-gates/worker-v6-tests.log`） |

## 4 最终通过项（本轮，最终构建）

| 项 | 结果 | 证据 |
|---|---|---|
| 真实模式 13 阶段 → 采纳 → 8 段确认 → 自读 → 批准 → 7 个有效下载，无测试标记 | pass | `run-4-final/chain-results.json`（23 项） |
| 仅问答路径 13 阶段 → 采纳；第 3/4/5 题不外发 | pass | `run-4-final/answer-only-results.json`（10 项） |
| 故障分类：503/401/非法JSON/3xx/429（各独立 job）+ 400 探针 | pass | `run-4-final/faults-results.json`（16 项） |
| 超时单独复验 | pass | `run-4-final/timeout-results.json`（5 项） |
| AI 调用记录：rows=13 与引擎 chat 13 相等，含时间/测试·真实列，失败中文、无正文 | pass | `run-4-final/chain-results.json` |
| G1 凭证失效 → onConsentRequired 重开 Sheet，确认前 0 consent/0 chat，grant 后成功 | pass | `run-4-final/RESULTS.md`、`final-results.json`（G1 段） |
| **A** 同授权 429 → retry 正常，无 consent-updated | pass | `run-4-final/g3-ux-final/A-results.json`（5/5） |
| **B** 换授权 → 「授权已更新，请以新授权开始新任务」+「以新授权开始任务」，无 retry/start、无循环 Sheet、点击前 0 chat、点击后成功 | pass | `run-4-final/g3-ux-final/B-results.json`（13/13） |
| **C** 同授权材料变化 → retry `INPUT_STALE`「材料已变化，请开始新任务」，0 chat，新建任务成功 | pass | `run-4-final/g3-ux-final/C-results.json`（9/9） |
| G2 内容指纹（材料变化 → INPUT_STALE，新建成功；`inputContentFingerprint` 已持久化） | pass | `run-4-final/g2g3-v2-results.json` |
| test 模式全流程回归（unconfigured 实例） | pass | `run-4-final/test-mode-regression.log`（108 记录，0 失败，7 下载） |

## 5 引用历史段（未重跑，证据保留）

| 段 | 结果 | 证据 |
|---|---|---|
| 会话签名、跨会话凭证拒绝、并发会话签发 | pass（17/17、4/4） | `run-3-security/cross-session/` |
| 标题改名失效（不刷新）、并发改名冲突中文提示 | pass（17/17、6/6） | `run-3-security/fixes-recheck/` |
| 退出起草会话失败边界 | pass 7/8（1 项为 Playwright 看不到 http 下 Secure cookie 的脚本限制） | `run-3-security/logout-failure-results.json`、`run-3-security/RESULTS.md` |
| 401 定位 | 未复现（单 profile、固定密钥、无重启） | `run-4-final/ISOLATE-401.md` |
| 视觉 round-5 | 26 个页面键、52 次采集、0 失败、8 张小图 ≤45KB | `round-5/visual-parity.json` |

## 6 原失败与修复（保留历史证据）

| 原问题 | 现状 | 历史证据 |
|---|---|---|
| worker 上游 `redirect:"error"` 在 workerd 不可用，chat 恒 502 | 已修复（`manual` + 3xx 显式处理），本轮 chat 全绿 | `README.md` §「已发现并已修复」 |
| AI 页调用记录为空 | 已修复（单一来源 `generation.job`），本轮 rows=13=chat | `run-4-final/chain-results.json` |
| 工作台折叠区自行关闭 | 已修复，折叠区经 17 秒 + focus 不收 | `run-3-security/RESULTS.md` |
| **G2 材料变化 retry 走重新确认** | 已修复（`inputContentFingerprint`），复验 pass | 历史观测 `run-4-final/G2G3.md`；复验 `g2g3-v2-results.json` |
| **G3 换授权后旧 retry 反复要确认** | 已修复（`generation-consent-updated` + 新授权按钮），A/B/C pass | `g3-ux-final/RESULTS.md` |

## 7 文档链接

- 协议与接口：`planning/v6-alignment/real-ai.md`
- 安全审查：`planning/v6-alignment/real-ai-security-review.md`
- 验收说明与脚本：`README.md`、`run_real_ai.py`、`accept-env.mjs`、`fake-upstream.mjs`、`worker-wrapper.ts`
- 分段汇总：`run-4-final/RESULTS-FINAL.md`、`run-3-security/RESULTS.md`、`run-4-final/g3-ux-final/RESULTS.md`

## 8 推荐入 git 的精简证据（只 .md、汇总 json、小图）

> 证据根目前 184 MB（含 PNG 截图、下载文件、历史轮次），**不要整目录提交**。

推荐（合计约 120 KB）：

- `RELEASE-STATUS.md`、`README.md`
- `run-4-final/RESULTS-FINAL.md`、`run-4-final/ISOLATE-401.md`、`run-4-final/G2G3.md`
- `run-4-final/g3-ux-final/RESULTS.md` + `A-results.json`、`B-results.json`、`C-results.json`
- `run-4-final/chain-results.json`、`answer-only-results.json`、`faults-results.json`、`timeout-results.json`、`g2g3-v2-results.json`、`g3-results.json`
- `run-3-security/RESULTS.md`、`run-3-security/CHECKPOINT.md`、`run-3-security/fixes-recheck/RESULTS.md`
- `run-3-security/cross-session/group-2-results.json`、`cross-session-concurrent-results.json`
- `run-3-security/fixes-recheck/fixes-recheck-results.json`、`concurrent-rename-results.json`
- `final-gates/*.log`（4 个文本日志，约 175 KB；若嫌大，可只留 `typecheck.log` 与 `worker-v6-tests.log`）
- `round-5/small-*.jpg`（8 张，均 ≤45 KB）

**不要提交**：`run-1/`、`run-2/`、`run-3-security/acceptance-evidence/`、`run-4-final/acceptance-evidence/`（截图与下载）、
`test-mode-regression/`（下载与截图）、`round-5/pair-*.jpg` 与 `implementation-*.png`、`__pycache__/`、任何 `.dev.vars`、
cookie jar、`node_modules`、以及历史 134 MB 的 run-1/run-2 全量输出。`run-4-final/final-results.json` 是含 401 级联的历史部分轮次，
建议不提交或加注说明。

## 9 汇总 JSON 的字段风险扫描（只报字段名，未打印值）

扫描证据根内全部 `.json` 的键名（大小写不敏感，关键词：credential/accessCode/token/prompt/authorization/cookie/secret/apiKey）：

| 键名 | 出现文件数 | 值类型 | 风险 |
|---|---|---|---|
| `accessCode` / `sessionSecret` / `promptFragment` | 5 | **bool**（卫生检查结果，全部为 false/true） | 无值泄漏 |
| `documentCookieHasSession` | 1 | **bool** | 无值泄漏 |
| `jarSessionCookies` | 1 | **int**（计数） | 无值泄漏 |

- 未发现存放凭据、访问码、令牌或提示词正文的字段；上述键都是**布尔/计数**型卫生指标。
- 证据中不含 `.dev.vars`、cookie jar、secret 文件；下载文件只存在于 `acceptance-evidence/` 与 `test-mode-regression/`，
  按第 8 节不入库。
