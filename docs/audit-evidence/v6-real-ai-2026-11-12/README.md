# 真实 AI 链路验收 · 2026-11-12

状态：**已准备，未运行正式轮次**（等 Lead 信号）。本目录的产品代码无改动；只新增验收脚本与假上游。

## 这次验收是什么 / 不是什么

- 是：在本地 workerd（`wrangler dev --local`）里跑**产品自己的** `apps/worker-v6` 与构建产物，验证
  `status → 访问码 → 同意 → /api/v6/chat → 采纳 → 导出` 的完整链路，以及拒绝、撤回、上游故障、
  未配置回落的界面与数据行为。
- 是：浏览器层证据（网络面板、IndexedDB 只读检查、下载文件内容）。
- 不是：真实模型质量验收。上游是本地假的 OpenAI 兼容服务，返回合成结构化输出，每段都带
  「合成验收输出」；处理方名称/区域/保留也是合成值（会在界面与报告里注明）。
- 不是：线上部署验收；不触碰 `patent.paymond.me`。

## 组成

| 文件 | 作用 |
|---|---|
| `fake-upstream.mjs` | 本地假上游：`POST /v1/chat/completions`，按提示词里的阶段标题返回符合该阶段 schema 的合成 JSON；可注入 429/503/超时/非法 JSON/空内容/结构不符。`/__control`、`/__stats`、`/__reset` 只暴露计数与元数据，**从不记录正文**；对每个请求只记「材料哨兵是否到达」「密钥/访问码是否泄漏」的布尔值。 |
| `worker-wrapper.ts` | 仅验收用的入口：调用**未修改的** `apps/worker-v6` `createWorker`，只把上游 fetch 指向本地假上游（部署版的 `MODEL_BASE_URL` 必须是 https，本地假上游是 http 回环），其他主机一律拒绝。 |
| `accept-env.mjs` | 一键起：假上游 + 3 个 `wrangler dev --local` 实例（`full` 已配置并披露 / `unconfigured` 未配置 / `undisclosed` 已配置但处理方信息缺失）。临时配置、`.dev.vars`、KV 持久化都在 `mktemp` 目录，退出即删（`--keep` 保留）。secret 是每次启动现生成的一次性合成值，不写入仓库。默认从源码现场构建，避免用到过期的 `apps/web/dist/v6`。 |
| `run_real_ai.py` | 浏览器验收：真实模式链路 + 拒绝/取消/撤回/材料变更/上游故障 + AI 页状态 + 未配置回落 + 路线收窄 + 卫生检查；并在 `unconfigured` 实例上**原样**跑一遍 `run_online.py`（测试模式全流程回归）。 |
| `collect_round5.py` | 视觉 round-5：沿用 round-4 方法（getComputedStyle 采样、1440×900 明暗、1800px 成对合成图），22 页 + 外发确认 Sheet、路线页禁用卡、AI 页状态块；另出 `small-*.jpg` ≤45KB。 |

## 运行方式

```bash
cd docs/audit-evidence/v6-real-ai-2026-11-12
node accept-env.mjs --state /tmp/v6-real-ai-state.json          # 打印 READY 与三个实例地址
REAL_AI_STATE=/tmp/v6-real-ai-state.json REAL_AI_OUT=run-1 python3 -I run_real_ai.py
REAL_AI_STATE=/tmp/v6-real-ai-state.json python3 -I collect_round5.py
```

可选：`REAL_AI_ONLY=env,seed,...` 只跑部分场景；`REAL_AI_SKIP_TIMEOUT=1` 跳过约 95 秒的超时用例；
`REAL_AI_SKIP_TESTMODE=1` 跳过测试模式全流程回归。

环境注意：worker 每小时每 IP 只允许 10 次访问码尝试（KV）。反复试跑后如遇 429，重启 `accept-env.mjs`
（会重建临时 KV）即可；正式轮次从干净环境开始。

## 会话内已发现并已修复的产品缺陷

首次在 workerd 内跑真实模式时 `/api/v6/chat` 每次都 502：`apps/worker-v6/src/index.ts` 的上游请求用了
`redirect: "error"`，workerd 不支持该值（`Invalid redirect value ... "error" won't be implemented`），
fetch 直接抛错被 catch 成 502。已由 runtime worker 改为 `redirect: "manual"` 并显式处理 3xx。
本目录的 `worker-wrapper.ts` 保留一个 `--redirect-workaround` 开关仅用于对照试跑；**正式轮次不使用它**。

## 试跑中观察到的产品缺口（正式轮次会复验）

- **AI 页「模型调用记录」始终为空**：`generation.ts` 把每次模型调用写在生成作业记录里
  （`record.invocations`），而 AI 页只识别顶层 `kind: "ai.invocation"` 行
  （`ai.ts` `asStoredInvocation`）；仓库里没有把作业内调用镜像成该行的代码。试跑中完成 18 次真实
  `/api/v6/chat` 后，AI 页仍显示「没有调用记录」。对应 Lead 要求里的「调用记录（无正文）」。
- 其余检查项在试跑中均为通过；发现即修复的链路缺陷（`redirect: "error"`）见下节。

## 门禁（2026-11-12 正式轮次）

| 项目 | 命令 | 结果 | 证据 |
|---|---|---|---|
| typecheck | `npm run typecheck` | exit 0 | `gates/typecheck.log` |
| 构建 | `npm run build -w @patent/web` | exit 0（仅既存 >500 kB chunk 提示） | `gates/build-web.log` |
| 全量场景 | `node qa/v6/runner.mjs --all` | exit 0；30 个场景目录，tests=679，pass=679，fail=0，cancel=0，skip=0 | `gates/runner-all.log` |
| worker-v6 | `npm run test -w @patent/worker-v6` | 10/10 通过 | `gates/worker-v6-tests.log` |
| V6-25 稳定性 | `node qa/v6/runner.mjs V6-25` ×5 | 5×22/22 通过，未复现 ZIP 时间戳 2 秒边界失败 | `gates/v6-25-run-{1..5}.log` |

## 正式轮次结果（run-1）

`run-1/real-ai-results.json`：**145 项检查，143 通过，2 失败，0 blocked**；pageerror 0；非预期 console error 0；
`/api/v6/chat` 状态分布 `[200, 429, 502, 504]`，`/api/v6/session` `[200, 401]`。

### B 真实模式（上传材料路径）

| 项 | 结果 | 证据 |
|---|---|---|
| 无 workaround 运行（`redirect: manual` 产品修复） | pass | `env-full-status`、`chat 200` |
| 确认前 0 次 chat（页面加载、状态读取、验证访问码、同意本身均不发） | pass | `gate-no-chat-on-load`、`verify-code-is-not-consent`、`agree-itself-sends-nothing` |
| 错误访问码：401、中文提示、输入框清空、无 cookie、无 chat | pass | `wrong-code-*` |
| 取消：Sheet 关闭、案件 IndexedDB 键集合不变、无 chat | pass | `cancel-*` |
| 会话 cookie：HttpOnly/Secure/SameSite=Strict，脚本不可读 | pass | `session-cookie-*` |
| 同意后生成、采纳；13 个阶段调用；浏览器与上游计数一致 | pass | `generate-succeeds-through-real-chain`、`browser-and-upstream-counts-agree` |
| 修订/预览/完成/交付/检查页无测试提示，`data-test-output` 无 true | pass | `no-test-notice-*` |
| 7 个下载文件结构有效且无测试标记（docx 首段、PDF metadata、清单） | pass | `download-*-valid-no-test-marker` |
| 采纳后旧同意失效（前置确认可重新确认） | pass | `adoption-invalidates-old-consent`、`reconfirmed-real-runtime` |
| 修改材料后旧同意失效、AI 页「材料已变化」、无 chat | pass | `new-material-*`、`ai-after-material-change` |
| 重新确认（改材料后再次同意） | **fail** | `material-change-reconsent`：45 秒内「查看外发确认」入口持续禁用（busy 未复位），弹层打不开 |
| 撤回授权：AI 页可撤回、撤回后不再发送 | pass | `revoke-listed-on-ai-page`、`revoked-no-chat-after-revoke` |
| 429 / 503 / 非法 JSON / 3xx：任务失败、中文提示、无假稿、草稿不变 | pass | `fault-*` |
| 上游请求只含授权范围（材料到达；凭据不外发） | pass | `material-reached-upstream-credentials-did-not` |

### B 仅问答路径

| 项 | 结果 | 证据 |
|---|---|---|
| 无文档新案件直接进真实模式，Sheet 自动打开 | pass | `answer-only-sheet-opened` |
| Sheet 说明「没有上传文档；内容来自回答与事实」 | pass | `answer-only-no-files-explained` |
| 已回答 5/5，将外发 2 条技术回答（第 1、2 题） | pass | `answer-only-answers-summary` |
| 本地专属提示「发明人、公开历史、成熟度只在本机」 | pass | `answer-only-local-only-note` |
| 确认前 0 chat；同意后生成成功并采纳；无测试标记 | pass | `answer-only-*` |
| 假上游侧：第 1、2 题到达（13 次请求中各 10 次），发明人/公开历史/成熟度**从未到达** | pass | `answer-only-upstream-never-saw-personal-answers`（只记布尔与字节数：5494–8362 B） |
| 修改回答后旧同意失效、无 chat | pass | `answer-change-*` |

### B 缺题门禁

| 项 | 结果 | 证据 |
|---|---|---|
| 缺题时提示缺哪几题并可「去回答」 | pass | `missing-answers-notice` |
| 确认弹层显示「五题答完后才能真实起草」+ 去回答，同意被禁用 | pass | `missing-answers-sheet-gate`、`missing-answers-agree-blocked` |
| 不挂载真实引擎（本机测试引擎仍可用，本地固定输出） | pass | `missing-answers-no-real-engine` |

### B 未配置回落 / C 路线收窄、AI 页

| 项 | 结果 | 证据 |
|---|---|---|
| 未配置实例回落测试模式并说明原因，无 chat | pass | `fallback-unconfigured-*` |
| 自助路线页 US/PCT 禁用 +「即将支持」+ 原因；中国发明「仅中文准备稿」 | pass | `self-route-*` |
| 工作台目标设置同样收窄；案件列表路线筛选保留四项 | pass | `settings-*`、`matters-filter-keeps-all-routes` |
| AI 页状态：auth_required / ready / unreachable / unknown / unconfigured / unavailable | pass | `ai-state-*` |
| AI 页无硬编码「外发门关闭」 | pass | `ai-no-hardcoded-gate-text*` |
| 调用记录（无正文） | **fail** | `ai-invocation-rows-present`：13 次真实调用后仍为 0 条（见下节） |

### C test 模式全流程回归

`run-1/test-mode-regression.log`：在 `unconfigured` 实例原样运行 `run_online.py`——108 条记录，0 失败，0 blocked，0 pageerror，0 console error，7 个下载。

## 产品缺陷 / 缺口（先报）

1. **AI 页「模型调用记录」永远为空**（新发现，两轮复现）。`generation.ts` 把调用写在生成作业记录里；
   AI 页只识别顶层 `kind: "ai.invocation"` 行（`ai.ts` 的 `asStoredInvocation`），仓库里没有写入方。
   13 次真实 `/api/v6/chat` 后页面仍显示「没有调用记录」。影响 Lead 要求的「调用记录（无正文）」。
2. **改材料后重新确认打不开弹层**：旧同意失效、AI 页「材料已变化」、无 chat 都正确；但在工作台草稿页，
   「查看外发确认」入口在 45 秒内持续 `disabled`（组件 `busy` 未复位），因此无法重新确认。
   同一路径在自助生成页（材料路径/问答路径）可正常确认。疑似工作台 `WorkbenchGeneration` 在材料变化后
   resolve 未完成或 busy 未复位，建议开发侧复现（脚本只点击、不改产品代码）。

## 观察（非失败）

- 503 与 3xx 都映射为 `PROVIDER_REJECTED`，界面提示是通用中文「发生错误；请按错误码检查配置后重试。」并显示
  英文错误码；可考虑给 503/3xx 更具体的中文原因（不影响本次判 pass）。


# run-2 复验（2026-11-13）

针对 run-1 报出的两个缺陷（AI 页调用记录、工作台折叠区自行关闭）与错误映射做了复验。

## 门禁（当前源码，构建快照 indexSha256=5191117b2447…，2026-11-13 21:33 CST）

| 项目 | 结果 | 证据 |
|---|---|---|
| typecheck | exit 0 | `run-2/gates/typecheck.log` |
| 构建 | exit 0 | `run-2/gates/build-web.log` |
| worker-v6 | 18/18 | `run-2/gates/worker-v6-tests.log` |
| 全量场景（第 1 次） | 719/720，**V6-25-A03 失败** | `run-2/gates/runner-all.log` |
| 全量场景（第 2 次） | 720/720 | `run-2/gates/runner-all-2.log` |
| V6-25 单跑 ×6 | 6×22/22 | `run-2/gates/v6-25-rerun-{1..6}.log` |

**V6-25-A03 复现**：第 1 次全量跑出现「same snapshot yields deterministic DOCX bytes」失败，差异落在 ZIP 本地头的时间字段
（字节 170 vs 169，DOS 时间低位），即 Lead 提到的 2 秒边界；单跑 6 次与第 2 次全量均通过，属间歇性、与运行时序相关。

## D round-5 视觉（2026-11-12）

`round-5/visual-parity.json`：26 个页面键（22 页 + 外发确认 Sheet ×2、路线页禁用卡、AI 页状态块），
明暗各一轮，共 52 次采集、44 组 1800px 成对图（`pair-*.jpg`），**0 个采集失败**。

- 新增状态均确认出现：`consent-sheet`（自助）、`workbench-consent`（工作台，含「你的回答 5/5、外发 2 条」）、
  `route-cards`（US/PCT「即将支持」+ 原因）、`ai-status`（服务状态块）。
- 小图（1200×750，JPEG）：`small-consent-sheet.jpg` 32,833 B、`small-workbench-consent.jpg` 43,477 B、
  `small-route-cards.jpg` 44,358 B、`small-ai-status.jpg` 42,857 B、`small-route.jpg` 44,358 B、
  `small-ai.jpg` 42,857 B、`small-matter-draft.jpg` 40,026 B、`small-preview.jpg` 45,589 B（均 ≤45 KB）。
- 方法是 round-4 的同一套：getComputedStyle 采样 + 1440×900 截图 + 1800px 成对合成；原型取自
  `docs/design/patent-saas-v6/prototype/index.html`。
- 注意：工作台成对图的实现侧需要先把「生成任务」折叠区强制展开才能截到 Sheet（见缺陷 3）。

## 产品缺陷 / 缺口（汇总）

1. **AI 页「模型调用记录」永远为空**：13 次真实 `/api/v6/chat` 后仍显示「没有调用记录」。
   `generation.ts` 把调用写在生成作业记录里，AI 页只读顶层 `kind: "ai.invocation"` 行（`ai.ts`），仓库无写入方。
2. **工作台「生成任务」折叠区会自己关上**：`apps/web/src/v6/features/workbench/Workbench.tsx:439`
   使用 `<details ... open={false}>`，React 每次渲染都会把 `open` 重置为 false；用户展开后，
   任何重渲染（15 秒自动刷新、窗口 focus、运行时 resolve 完成）都会把它重新收起。
   直接后果：从工作台重新打开「外发确认」不稳定，run-1 的 `material-change-reconsent` 因此在 45 秒内
   等不到可点击的入口；强制 `details.open = true` 后 round-5 能正常截到该 Sheet。
   建议改为非受控（去掉 `open` 属性，或仅在首次挂载时设置）。
3. 503 与 3xx 都映射为 `PROVIDER_REJECTED`，提示为通用中文并带英文错误码；可考虑更具体的中文原因（非失败项）。

## 结果（待运行后填写）

- `run-1/real-ai-results.json`：逐项检查、失败项、上游计数、chat/session 状态码分布、日志卫生检查。
- `run-1/acceptance-evidence/`：每条记录的截图与 DOM 文本。
- `run-1/test-mode-regression.log`：测试模式全流程回归（`unconfigured` 实例）。
- `round-5/visual-parity.json`、`pair-*.jpg`、`small-*.jpg`。
