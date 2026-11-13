# run-4-final 首次 401：代码分支与可区分证据（只读，2026-11-14）

未改代码、未跑测试、未接触 tester 服务。行号均指当前冻结源码。

## 服务端只有一种 401 响应

- `/api/v6/chat`：`index.ts:214`；`/api/v6/consent`：`index.ts:121`。两处都只回
  `{error:{code:"AUTH_REQUIRED"}}`（`failure()`，`:44-47`），**不区分原因**。
- `/api/v6/status` 永远 200，只给 `authenticated: boolean` 与 `sessionId`（`:271-275`）——它是唯一能无副作用判断会话状态的端点。
- `/api/v6/session` 的 401 是“访问码不对”（`:204`），与本题的 chat/consent 401 不是同一条。

## 五个可能分支（按定位优先级）

| # | 分支 | 代码 | 可区分证据 |
|---|---|---|---|
| 1 | 请求没有携带会话 cookie，或 cookie 已被清除 | `authenticated()` 在 `:94-95` 取不到 token 即失败；cookie 由 `:208-209` 写入（`Path=/; HttpOnly; Secure; SameSite=Strict`）；`DELETE /api/v6/session` 在 `:278-283` 用 `Max-Age=0` 清除 | 请求头**没有** `Cookie: __Rmyb…`；`/status` 为 `authenticated:false`；`document.cookie` 不含会话；NET 中若在首次 401 前出现 `DELETE /api/v6/session` 200 + `Set-Cookie … Max-Age=0`，就是主动退出；用 state 里的访问码重新登录后立刻恢复。另查页面 origin 与 cookie 域是否一致（`127.0.0.1` vs `localhost`、端口变化会另起 jar） |
| 2 | 会话过期，或服务器时钟跳变 | `:99`：`exp <= now` 拒绝；`exp > now + 2h` 也拒绝（时钟回拨） | 取 cookie 第 2 段 `exp`，与 `/status` 响应头 `date`（或 `/api/v6/consent` 的 `expiresAt` 同源时间）比较：`exp` 已过 → 过期；`exp` 比服务器时间超前 > 2h → 时钟回拨。重新登录立刻成功。同时记录 accept-env 的 `startedAt` 与首次 401 的墙钟差是否 > 2h |
| 3 | SESSION_SECRET 或 ACCESS_CODE 变了（accept-env 换了进程） | HMAC 消息含 `digest(ACCESS_CODE)`，密钥为 `SESSION_SECRET`：`:89-90`，比较在 `:100` | **所有**旧 token 同时 401，但 `/status` 的 `available` 仍为 true；用 state 文件里的旧访问码 `POST /session` 若 401、而新 state 的访问码 200，则确认换过环境。关键事实：`accept-env.mjs:40-46` 每个进程启动生成一次 secrets，`:139-140` 只写一次 `.dev.vars`，运行中没有重启路径（`:51` 仅在退出时 kill）；故障模式是向假上游 `/__control` 发请求（`run_real_ai.py:91-92`），**不会**重启 worker 或换密钥 |
| 4 | cookie 存在但 token 结构/签名不可解析（截断、URL 编码、重复同名 cookie） | 解析与格式校验 `:96-100`；`sessionToken()` 只取**第一个**同名 cookie（`:102-105`） | 请求头有 `Cookie` 但 token 不是 4 段 / 第二段非纯数字 / 第三段不是 UUID / 第四段不是 64 位 hex，即为结构问题；若同名 cookie 出现两条（不同 Path），服务端只用第一条。此类 401 与“过期”“换密钥”在客户端无法区分，需要抓请求头原文（只核对结构，不记录值） |
| 5 | 前端用了没有 cookie 的请求上下文 | 浏览器同源 `fetch` 默认带 cookie；Playwright `APIRequestContext` 在 http 下不发送 `Secure` cookie（run-3 已记录） | `run_final.py:157-164` 的探针是 `page.evaluate(fetch(...))`，属页面上下文；若换成 `ctx.request`/`api_request` 才会命中此分支。该探针没带 `consentCredential`，会话有效时应返回 400（未知 stage），返回 401 只说明“未认证” |

## 与“撤回授权”无关

`revokeActiveConsent` 只写本机同意账本与事件，不碰会话（`run_final.py:73-85`；`ai.ts` 的 revoke 流程）。tester 的同环境探针也已显示撤回后 `authenticated=true`、chat 409，与代码一致。

## 假时钟与密钥来源（事实）

- 验收入口 `worker-wrapper.ts:35` 显式传 `now: Date.now`，**没有假时钟**；`accept-env` 也不注入时间。
- 之前的 `apps/worker-v6/test/*` 安全单测里的 `now` 注入只发生在 Node 测试进程，与 workerd 实例无关，不会推进 tester 的服务器时间。
- 会话是无状态 HMAC，不落存储：重启 workerd 后只要 `SESSION_SECRET`/`ACCESS_CODE` 不变、`exp` 未过就仍有效；**换一个 accept-env 进程就换密钥**，旧 cookie 全部 401。

## 建议 tester 在首次 401 处只记录这些字段

`/status` 的 `authenticated` 与 `sessionId` 摘要、页面 origin、请求是否带会话 cookie（布尔）、cookie 的 `exp` 与响应 `date` 的差值、NET 里 `POST /session`/`DELETE /session` 的时间与状态、以及用当前 state 访问码重新登录是否 200。以上均为布尔/时间/计数，不含 token 或访问码值。
