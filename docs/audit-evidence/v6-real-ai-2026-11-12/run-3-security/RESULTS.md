# run-3-security 结果（2026-11-14）

证据目录：`docs/audit-evidence/v6-real-ai-2026-11-12/run-3-security/`。未改产品代码、未部署、未调用真实供应商。
构建快照：`indexSha256=85f1d738100c…`（2026-11-13 15:52 UTC 现场构建，`workaround=false`）。

## 预检（pass）

| 项目 | 结果 | 日志 |
|---|---|---|
| worker-v6 单测 | 18/18 | `precheck/worker-v6-tests.log` |
| security-proof | 9/9 | `precheck/security-proof.log` |

security-proof 已在服务端契约层覆盖：新会话需重新授权、退出失败时本机凭证仍清除且旧 runtime 永久失效、
取消后排队凭证失效、凭证过期/撤回不发、上游 400 中文提示。

## 浏览器轮次（`real-ai-results.json`：162 项，146 pass / 16 fail / 0 blocked）

**pass（协议与界面主链路）**
- 确认前 0 consent、0 chat；验证访问码后仍 0 consent、0 chat（resolver 只读）。
- 用户显式同意后 `POST /api/v6/consent` 恰好 1 次，且同意本身 0 chat。
- 会话 cookie HttpOnly/Secure/SameSite=Strict、脚本不可读；错误访问码 401 中文提示且不建立会话。
- 取消不改案件（IndexedDB 键集合不变）、不发送。
- 仅问答路径：清单显示「已回答 5/5，外发 2 条」，本地专属说明；改回答后旧同意失效、0 chat。
- 材料变更后旧同意失效、AI 页「材料已变化」、0 chat。
- 工作台「生成任务」折叠区经 17 秒 + focus 仍展开（缺陷 2 已修）。
- 撤回授权后不再发送；AI 页调用记录表结构（时间/测试·真实/失败中文）在有记录时渲染。

**fail（按原因分组）**
1. **故障分类用例未逐条执行**（5 条 fault 文案 + `faults-mapped-by-worker` = 6 项）：第一个用例（429）之后，
   `generation-retry` 点击没有产生新作业（chat 状态只出现 `[429]`），后续用例读到的是第一个作业的中文文案。
   属**本轮脚本/引擎交互问题**，不是错误映射回归：同一构建下 2026-11-13 早间 run-2 六类故障文案曾全部通过，
   且 `security-proof` 覆盖 400 中文提示。
2. **生成与后续用例级联**（`generate-succeeds`、`step-generate-aborted`、`invocations-count-matches-chat`、
   `draft-contains-synthetic-marker`、`step-finish-aborted`）：同源的「重试未起新作业」导致没有新修订，
   采纳/确认/下载/调用记录计数无法在本轮复验。
3. **API 凭证矩阵环境问题**（`api-request-has-session-cookie`、`missing-credential-rejected`）：Playwright 的
   `APIRequestContext` 在 `http://127.0.0.1` 下不带浏览器里的 `Secure` 会话 cookie（浏览器自身仍会发送，
   `status.authenticated=true` 可证），导致 `/api/v6/consent` 401、矩阵用例跑在无会话状态。
4. **跨会话凭证疑似被接受**（`cross-session-credential-rejected` 返回 200、`cross-session-sends-nothing`）：
   在无会话混淆的上下文里复现一次。**未确认为产品缺陷**——同一轮里 API 上下文 cookie 行为异常，需在干净环境单独复核；
   若复核仍为 200，则是服务端凭证未真正绑定 sessionHash 的确定缺陷。
5. **标题改名未落库**（`title-disclosed-as-text`）：案件列表重命名后弹层仍显示「未命名案件」，改名步骤未生效，
   标题披露文案本身正确（`titleSent` 分支显示「（可能作为主题背景随本次请求外发）」）。

## 退出失败边界（`logout-failure-results.json`：8 项，7 pass / 1 fail）

| 项 | 结果 | 事实 |
|---|---|---|
| 退出前工作台已挂载真实 runtime | pass | — |
| DELETE 失败（网络中断）中文提示 | pass | 「服务器会话尚未退出，请重试。本机凭证已清除；当前浏览器暂不能继续真实起草。」 |
| 失败后状态仍为已登录 | pass | `status.authenticated=true`（服务器会话确实未退出） |
| 不出现假的「已退出」成功提示 | pass | — |
| 失败后同标签页需重新确认 | pass | 弹层/缺确认提示出现 |
| 失败后旧页面 0 chat | pass | before=0 after=0 |
| 网络恢复后重试退出成功 | pass | cookie 清除 + 「已退出…案件、草稿和授权记录都保留」 |
| 「保留服务器会话」cookie 断言 | fail（脚本） | Playwright 的 `context.cookies()` 不列出 http 下的 Secure cookie（浏览器仍发送）；以 `status.authenticated` 为准 |

## 未运行 / 需下一轮

- 上传路径 13 阶段 → 采纳 → 确认批准 → 7 下载（本轮因 2 中断，run-2 早间曾通过）。
- 六类上游故障的逐条中文分类（本轮受 1 影响）。
- 跨会话/错摘要凭证的服务端复核（本轮受 3 影响）。
- test 模式全流程回归（本轮用 `REAL_AI_SKIP_TESTMODE=1` 拆分，尚未单独执行）。


## 最小跨会话复核（2026-11-14，pass，两组独立环境各 17/17）

方法：真实 workerd + 干净 KV（每次重启 accept-env 重置）+ 假上游；**纯 HTTP 手工 cookie jar**，不使用浏览器
`APIRequestContext`（避免 http 下 Secure cookie 不一致）；只记录状态码、布尔、id 摘要与上游计数，不记录 token/访问码/正文。

| 检查 | 组 1 | 组 2 | 事实 |
|---|---|---|---|
| A 会话建立 → status.sessionId | pass | pass | sessionId 摘要 `6567c1fda11d`（组 1） |
| B 会话建立（相隔 1.2 秒）→ status.sessionId | pass | pass | 摘要 `d64f42801b9e`；**A≠B** |
| A 显式 POST /consent | pass | pass | 200，allowedStages=13 |
| A chat（带 A 凭证） | pass | pass | 200，上游 +1 |
| **B cookie + A 凭证** | pass | pass | **409，上游 +0** |
| 错 manifestHash | pass | pass | 409，上游 +0 |
| 错 profileVersion | pass | pass | 409，上游 +0 |
| 无凭证 | pass | pass | 409，上游 +0 |
| 未知 stage | pass | pass | 400，上游 +0 |

结论：**跨会话凭证被正确拒绝**；run-3 浏览器轮次里「跨会话 200」是 `APIRequestContext` cookie 行为造成的用例假象，
不是产品缺陷。服务端凭证确实绑定会话、profile 与摘要。证据：`cross-session/cross-session-check.py`、
`cross-session/group-2-results.json`（组 1 输出见本轮对话记录，17/17 相同状态）。

两个会话的 sessionId 不同（相隔 1.2 秒），无需再定位「同秒同 token / 缺随机 nonce」。

## 现场

- 所有本轮启动的服务（accept-env / fake-upstream / wrangler）已停止，无残留进程。
