# run-4-final 最终汇总（2026-11-14）

固定合成密钥（`ACCEPT_ACCESS_CODE`/`ACCEPT_SESSION_SECRET`，仅环境变量）、单次服务未重启、同源 127.0.0.1、
未改产品代码、未调真实供应商。**仅验证假上游链路，真实供应商尚未选定。**

| 段 | 结果 | 证据 |
|---|---|---|
| 1 预检 typecheck/build/worker-v6/runner --all | **pass**（0/0/23–23/728–728） | `gates/*.log` |
| 2 G1 凭证失效→onConsentRequired 重开 Sheet，确认前 0 consent/0 chat，grant 后 13 阶段成功 | **pass** | `final-results.json`、`RESULTS.md` |
| 2 G2 材料变化旧 job retry → INPUT_STALE | **pass（修复后复验）** | `g2g3-v2-results.json`：`inputContentFingerprint` 已持久化；新增并解析文件→重授权→retry 返回 `INPUT_STALE`「材料已变化，请开始新任务。」、chat 0、不重开 Sheet；新建任务成功 |
| 2 G3 仅授权变化→重新确认 | **pass（修复后复验）** | `g3-results.json`：撤回授权后 retry 重开 Sheet、确认前 consent/chat 0、非 INPUT_STALE；明确 grant 后执行成功（chat→14） |
| 3 故障分类（每种独立 job） | **pass** | `faults-results.json`：5 类×3 项 + 400 探针 = 16 项 pass；该文件另有 1 项 `step-aborted`（超时用例在批量循环里点不到入口，脚本问题），超时已单独跑通 `timeout-results.json` 5/5 |
| 3 上传路径 13 阶段 → 采纳 → 8 段确认 → 自读 → 批准 → 7 个有效下载，无测试标记 | **pass** | `chain-results.json`（23 项） |
| 3 仅问答 13 阶段 → 采纳，个人回答不外发 | **pass** | `answer-only-results.json`（10 项） |
| 3 AI 记录：rows=13 与引擎 chat 13 相等；时间/类型列；无正文 | **pass** | `chain-results.json` |
| 3 test 模式全流程回归 | **pass** | `test-mode-regression.log`（108 条记录，0 失败，7 下载） |
| 4 会话签名/跨会话/并发签发 | 引用 | `../run-3-security/cross-session/`（17/17、4/4） |
| 4 标题改名/并发冲突 | 引用 | `../run-3-security/fixes-recheck/`（17/17、6/6） |
| 4 退出失败边界 | 引用 | `../run-3-security/logout-failure-results.json`（7/8，1 项脚本限制） |
| 401 定位 | 未复现 | `ISOLATE-401.md` |

## 故障分类明细（每类独立 job，无 429 级联）

| 注入 | 结果 | 中文文案（首行） |
|---|---|---|
| 503 unavailable | pass | 真实起草服务暂时不可用（服务中断或网络不通） |
| 401 unauthorized | pass | 会话或模型服务凭据未被接受 |
| 非法 JSON | pass | 模型返回的内容无法按约定结构解析 |
| 3xx redirect | pass | 模型服务拒绝了这次请求，或服务地址、模型配置有误 |
| 429 rate limit | pass | 请求过多，已被限流 |
| 超时（单独跑） | pass | 真实起草服务响应超时 |
| 400 未知 stage（直接探针，单列） | pass | worker 400，不计入引擎调用记录 |

## 下载（7 个均有效、均无测试标记）

权利要求书.docx、说明书.docx、说明书摘要.docx、synthetic-acceptance-figure.png、提交检查清单.pdf、
项目备份.patentpack、导出清单.json。

## 索引 vs 作业 id

`generation.index` 键 `index/<matterId>/<targetId>`，只有追加的 `jobIds`，索引 id 固定；作业在 `job/<jobId>`，失败作业与
其 invocations 保留。本轮实测 `jobIds` 随任务追加。

## 现场

本轮启动的 accept-env / fake-upstream / wrangler 已全部停止，无残留进程。

## G2/G3 复验（2026-11-14，最新构建 indexSha256=2307a645a934…）

- 构建：accept-env 现场重新构建，最新 `generation.ts` 已含 `inputContentFingerprint`；只读 IndexedDB 确认最新
  `generation.job` 记录带该字段（摘要 c961cef373e5…），排除旧 dist。
- G2（`g2g3-v2-results.json`）：429 失败 → 正常 UI 新增并解析来源文件 → 明确重授权 → 旧 job retry 返回
  `INPUT_STALE`「材料已变化，请开始新任务。」、chat 增量 0、**不重开 Sheet**；新建任务 `succeeded`。
- G3（`g3-results.json`，12/12）：同内容仅授权失效 → retry 重开 Sheet、确认前 consent/chat 均为 0、非 INPUT_STALE；
  明确 grant 后「新建任务」执行成功（chat→14）。说明：旧 job 的 retry 在授权更换后仍会再次要求确认（作业绑定其原授权），
  因此 grant 后的可执行入口是新建任务。
- 与此前 `G2G3.md` 记录的「blocked」区分：那是修复前构建（`currentInput.sourceVersion` 未推进）的观测，保留为历史证据。
