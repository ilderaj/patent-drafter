# run-3-security 检查点（2026-11-13）

## 已停止
- 上一轮 run-2 浏览器验收（旧 chat 协议）已优雅停止：`run_real_ai.py`、`accept-env.mjs`、`fake-upstream.mjs`、wrangler 进程均已退出；
  run-2 没有最终结果文件，保留 `run-2/gates/`、`run-2/test-mode-regression/`、`run-2/acceptance-evidence/` 为止损现场。
- 旧 chat 协议（不带 `manifestHash`/`consentCredential`）不再执行。

## 预检（pass）
| 项目 | 结果 | 日志 |
|---|---|---|
| worker-v6 单测 | 18/18 通过 | `precheck/worker-v6-tests.log` |
| security-proof（qa/v6/scenarios/real-ai） | 9/9 通过 | `precheck/security-proof.log` |

## 本轮范围（进行中）
- 环境：`accept-env.mjs`（假上游 + 3 个 `wrangler dev --local`，无 workaround），构建快照 `run-3-security` 启动时记录。
- 新协议：session → status(sessionId) → 用户显式同意 POST /api/v6/consent → chat(stage/profileVersion/manifestHash/consentCredential)。
- 断言：确认前/验证访问码后 0 consent、0 chat；resolver 只读；未知/本地 stage、缺凭证、错摘要被拒且上游不增；跨会话凭证被拒；
  改标题/材料/答案旧同意失效且 chat=0；标题以文本披露且不执行注入；退出会话清 cookie、保留案件、旧页面不再发；
  原缺陷（AI 记录数=chat、时间/类型/失败中文、工作台折叠区 15 秒/focus 不收）；400/401/429/503/超时/非法 JSON/3xx 中文分类；
  上传与仅问答两入口 13 阶段、采纳、确认批准、7 下载、无测试标记。
- 浏览器结果文件：`run-3-security/real-ai-results.json`（完成后写入）；每条截图在 `run-3-security/acceptance-evidence/`。
- test 模式回归：本轮用 `REAL_AI_SKIP_TESTMODE=1` 拆分执行，单独运行 `run_online.py`（`unconfigured` 实例），日志将写入 `run-3-security/test-mode-regression.log`。

## 结束约定
- 完成后停止所有由本轮启动的服务（accept-env / fake-upstream / wrangler），不留常驻进程。
- 若模型网关或工具再次无响应，保留本检查点并停止，不做连续盲试。
