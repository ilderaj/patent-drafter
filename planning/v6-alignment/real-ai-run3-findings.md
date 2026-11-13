# run-3 安全验收两项疑点：只读核对（2026-11-14）

范围：仅读源码 + 本地内存/假上游复现；未改代码、未跑全量、未接触 tester 环境或真实供应商。所有脚本在 `/tmp/v6-repro/`，不入库。

## 结论摘要

| 疑点 | 结论 |
|---|---|
| 同秒/同毫秒会话是否相同、sessionId 是否唯一 | **不是缺陷**。每次 session 用 `crypto.randomUUID()` 作 nonce，token/哈希必然不同 |
| B 持 A 凭证能否通过 | **不能**。凭证绑定 `digest(A token)`，B 的 cookie 不匹配 → 409，上游 +0 |
| generation-retry 首个 429 后未发新作业，是否因取消凭证 | **429 路径不取消 provider、不清凭证**；本地端到端复现中重试成功并发出 13 次 chat |
| 那 run-3 的现象是什么 | 与“重试/启动时内存凭证缺失”一致：会先记 1 条 invocation、0 次 chat；且产品没有从面板错误回到重新同意的路径（见 G1/G2） |

## 1. 会话签发与唯一性

- `apps/worker-v6/src/index.ts:196-210`：`expiresAt = deps.now() + SESSION_MS`（同一毫秒会相同），但 payload 是
  `v1.${expiresAt}.${crypto.randomUUID()}`（第 206 行）。nonce 每次都随机，所以同毫秒的两个会话 token 不同。
- `index.ts:89-101`：HMAC 覆盖 `v1.exp.nonce`，会话大小写/格式/过期都校验；签名不覆盖随机字段是不可能的。
- `index.ts:271-275`：`sessionId = SHA-256(完整 token)`，不是 cookie 本身，也不是自增/时间值；token 唯一即 hash 唯一。

本地复现（`/tmp/v6-repro/session.mjs`，固定 `now`，同一毫秒内连续建 A/B）：

```json
{ "sameMillisecondSessionsDiffer": true,
  "nonceA": "0ed0edbe-c2e4-4a51-8cfb-f95edb2dad94",
  "nonceB": "65f2aab5-77b0-4183-9b69-bb30fbb773d0",
  "sessionIdA": "05c3a3043808", "sessionIdB": "e109b4d6f07e", "sessionIdsDiffer": true }
```

结论：不需要“随机 session nonce 绑定 HMAC”的新修复，现有实现已如此；也没有旧 session 兼容问题（格式未变）。
唯一固有情形是**原样复制 cookie**：B 用 A 的完整 cookie 就等于 A。这属于无状态会话的已知边界，已在 real-ai.md 写明；不能因此宣称服务器可撤销。

## 2. B 持 A 凭证

- 签发：`index.ts:127-135`，`sessionHash = digest(当前请求的 token)`。
- 校验：`index.ts:137-155`，第 149 行要求 `proof.sessionHash === digest(B 自己的 token)`，再比对 profileVersion、manifestHash、stages、过期。
- 复现结果：A chat=200；**B cookie + A 凭证 = 409**，上游调用数保持 1（未增加）；A 重新登录后的新会话 + 旧凭证 = 409。

tester 自己的干净复跑（`run-3-security/RESULTS.md`「最小跨会话复核」）也是两组环境各 17/17，B+A 凭证 409。
run-3 浏览器里的 200 已由测试环境 cookie 行为解释，**不是产品缺陷**。

## 3. 429 之后的重试

代码事实：
- 429 走 `remote-provider.ts` 的错误映射到 `RATE_LIMITED`，随后 `generation.ts` 的 `markFailed` 只更新作业记录；
  `closeStartedInvocations` 不发 `provider.cancel`。**只有用户点“取消”、退出、重新登录才清凭证**（`runtime.ts:12-24`、`remote-provider.ts:140-144`）。
- `retry()`（`generation.ts:1703-1711`）要求失败作业的 consentId 与当前引擎一致；同一材料范围再次同意会命中
  `findReusableConsent`（`ai.ts:2139-2146`），返回**同一个 consent id**，所以不会误挡。

本地端到端复现（`/tmp/v6-repro/retry-e2e.mjs`：真实 worker + 假上游，首个 chat 返回 429）：
先 429 失败 → 重新建会话（清内存）→ 重新同意 → `retry`：

```json
{ "after429": { "jobState": "failed", "code": "RATE_LIMITED", "chat": 1 },
  "sameConsentId": true, "retryOk": true, "retryState": "succeeded",
  "chatAfterRetry": 13 }
```

结论：**“429 取消凭证导致旧 provider 不能 retry”不成立**。retry 会新建作业并正常发出后续 chat。

## 4. 与 run-3 现象一致的产品缺口（需要处理，不是脚本假象）

run-3 的关键指纹是 `invocations-count-matches-chat: rows=1 chat=0`：作业已创建、invocation 已记录，但上游一次都没被调用。
`generation.ts` 的 `authorize` 在本地同意校验通过后先建 invocation，然后才进入 provider 的 `beforeCall`
（`remote-provider.ts:102`）。`beforeCall` 在任何网络请求前检查本标签页凭证；凭证缺失/过期/会话变化时抛 `CONSENT_REQUIRED`，
于是正好产生 1 条 invocation、0 次 chat、作业失败。

**G1（产品，建议修）**：这个失败只把错误留在生成面板里。父组件 `WorkbenchGeneration`/`SelfGeneration`
只在用户点“查看外发确认/重新读取状态”时才 `resolve` 或打开同意弹层；面板没有把 `CONSENT_REQUIRED` 冒泡给父层
（`Generation.tsx:443-481` 仅 `setActionError`）。结果：重试按钮仍在，但用户无法从当前界面回到“重新同意”，
看起来就像“重试不工作”。凭证会在 30 分钟过期、重新登录、退出、取消后失效，面板可能仍挂着旧的 runtime。

最小修复（UI 层，交接给对应 worker）：`GenerationPanel` 增加可选 `onConsentRequired?: () => void`；在
`act()` 收到 `CONSENT_REQUIRED`/`CONSENT_REVOKED` 时调用；父层收到后 `setRuntime(null); await refresh(true)` 重新打开同意弹层。
逻辑层已具备所需错误码，无需新接口。测试：构造凭证过期 → 点重试 → 断言父层重新 resolve 且弹层出现、0 chat。

**G2（逻辑/文案，建议修）**：`retry()` 在失败作业的 consentId 与当前不同时报 `CONSENT_REQUIRED`
（`generation.ts:1707`）。材料范围改变后（例如已采纳新修订）用户即使刚重新同意，旧失败作业也不能重试——
这是合理的，但返回码与文案会把人引向“再同意一次”，而正确动作是新建任务。建议改为
`INPUT_STALE`（“材料已变化，请开始新任务”），与 `prepareNewJob:1510` 的语义一致。测试：失败作业 → 采纳新修订 → 重新同意 → retry → 期望 `INPUT_STALE`。

**边界说明**：若 tester 的脚本在重新同意前就点击重试，或同意动作被 15 秒等待窗口跳过，也会落到 G1 的状态；
但 G1 让这个状态在界面上不可恢复、也不可辨识，属于产品问题，不能用“脚本问题”带过。

## 5. 建议 tester 下一轮补的最小证据

每个 fault 用例记录：`POST /api/v6/consent` 次数、点击控件是 start 还是 retry、`data-job-state` 的前后值、
`generation-action-error` 的 `data-code`（`CONSENT_REQUIRED` 会直接区分 G1 与其他失败），以及 `NET.count('/api/v6/chat')` 的前后差。
这些都只含状态与计数，不含正文或凭证。

## 未做

未改任何源码或测试；未运行全量；未启动 accept-env/wrangler；未读取任何密文值。

## 修复状态（2026-11-14，G1/G2 + 服务端安全单测）

- **G1 已实现**：`GenerationPanelProps.onConsentRequired?: () => void`，只在 start/retry 返回 `CONSENT_REQUIRED`/`CONSENT_REVOKED` 时调用；`requiresConsentRecovery(code)` 可单测。父层 `WorkbenchGeneration`/`SelfGeneration` 收到后 `setRuntime(null); refresh(true)`，重读并打开外发确认；不自动 grant、不静默重发；grant 后以新 runtime 重试，材料变化则按 G2 提示新建任务。
- **G2 已实现**：`retry` 处理方变化 → `CONSENT_REQUIRED`；consentId 不同且 `sourceVersion`/`targetConfigVersion`/`figureRevisionId`/`baseDraftRevisionId` 变化 → `INPUT_STALE`「材料已变化，请开始新任务。」；仅授权变化 → `CONSENT_REQUIRED`。
- 测试：`qa/v6/scenarios/real-ai/retry-recovery.test.mjs` 5 条；`apps/worker-v6/test/security.test.mjs` 5 条。

### 服务端安全单测覆盖（`apps/worker-v6/test/security.test.mjs`）

| 威胁 | 用例 | 结果 |
|---|---|---|
| 改签名/改 payload 的 manifestHash、sessionHash、expiresAt、stages、v | 全部 409，上游 +0 | pass |
| credential 过期边界 | `now=exp-1` 200；`now=exp` 与 `exp+1` 409，上游不再增加 | pass |
| session cookie 篡改签名/改 exp/乱码/过期 | status `authenticated:false`，chat 401；响应不含 expired/invalid/signature/token/访问码/secret | pass |
| 请求体超 512 KiB | 413，上游 0；响应超 2 MiB | 502，不返回上游内容 | pass |
| RATE_LIMIT KV 抛错 | session 与 chat 均 503，上游 0，错误不回显 KV 细节 | pass |

### 事实回报（不改码）

1. **TTL 以服务端时间为准**：token `exp = deps.now() + 2h`（`index.ts:205-207`）且每次请求与服务器 `now` 比较（`:99`）；credential `expiresAt = min(now+30min, session exp)`（`:128`）并在 chat 校验（`:151`）。Cookie `Max-Age` 只影响浏览器何时丢弃；浏览器 `credentialAvailable()` 还按本机时间判断 UI 新鲜度，时钟偏差只会让界面提前/延后要求确认，服务器仍按自己的时间拒绝。
2. **workerd 重启后会话仍有效**：会话是无状态 HMAC，不落库；只要 `SESSION_SECRET` 与 `ACCESS_CODE` 不变、`exp` 未过即可继续使用。HMAC 密钥来自部署 secret `SESSION_SECRET`，消息为 `patent-v6:session:${payload}:${digest(ACCESS_CODE)}`；轮换任一值会使全部会话失效（已有测试 `secret/access rotation invalidates sessions`）。
3. **KV 不可用时 fail-closed**：`bump()` 抛错 → 外层 catch → 503 `STORAGE_UNAVAILABLE`，不发上游；旧测试 `daily limit and KV failure fail closed` 覆盖 chat，新测试覆盖 session + chat，且不泄露 KV 错误内容。

## G2 内容身份修复（2026-11-14，run-4-final 复验缺口）

**根因（数据层核对）**
- 确认事实/答案的 `saveIntake` 会递增 `sourceVersion`：`intake.ts:1982`（nextVersion = sourceVersion+1）、`:2192`（commit 写回）。符合契约「修改事实、答案、人员或采纳解析结果均新增 sourceVersion」。
- 新增并解析材料走 `ingest.ts:1444-1450`：只递增 matter `version`，**不**改 `sourceVersion`。契约列出的递增条件不含“上传/解析文件”，`sourceVersion` 是事实快照版本，因此不判定为漏写，也不在数据层强行每次读取递增。
- 缺口在 retry：旧实现只比较 `sourceVersion/targetConfigVersion/figureRevisionId/baseDraftRevisionId`，而新增解析文件恰好不改这些值，于是被误判为“仅授权变化”并返回 CONSENT_REQUIRED。

**最小改动（只动 generation.ts）**
- `StoredGenerationJob.inputContentFingerprint?: string`：作业创建时持久化内容指纹，覆盖真实发送的标题、来源资产（id/名称/sha256/长度）、parse 来源与 chunks（id/hash/page）、事实（id/状态/陈述）、完整答案、target 配置、figureRevisionId、baseDraftRevisionId；**不含** session/profile/consent/pipeline 设置。
- `retry` 顺序改为内容优先：指纹不同 → `INPUT_STALE`「材料已变化，请开始新任务。」；处理方变化 → `CONSENT_REQUIRED`；仅 consentId 不同且内容相同 → `CONSENT_REQUIRED`「外发授权已变化…」；旧作业无指纹且 consentId 不同 → `INPUT_STALE`「无法确认材料未变化，请核对当前材料或开始新任务。」，不猜测可安全重试。旧作业 consentId 相同时仍走原有 `prepareNewJob`（payloadHash/基础修订校验）。
- UI 无需改动：`INPUT_STALE` 不触发 `onConsentRequired`，新任务入口（failed 状态下的 start）保持可用。

**测试**：`qa/v6/scenarios/real-ai/g2-content-identity.test.mjs` 4 条，用真实 `ingestFiles` + `parseSource` 与真实 `saveIntake`（不手改 version）：
1. 429 失败 → 上传并解析新材料（`sourceVersion` 不变）→ 重新授权 → retry `INPUT_STALE` 且 provider 0 次 → `start` 成功；
2. 同内容仅换授权（expiresAt 不同产生新 consent id）→ `CONSENT_REQUIRED`；
3. 旧作业无指纹 + 授权变化 → `INPUT_STALE`「无法确认…」；
4. `saveIntake` 确认事实（`sourceVersion` +1）→ `INPUT_STALE`。

验证：定向 real-ai+V6-17+V6-15+V6-16 = 156/156；typecheck/build/diff-check 通过。未跑全量、未部署、未调真实模型。
