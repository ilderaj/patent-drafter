# worker-v6 安全边界单测覆盖核对（只读，2026-11-14）

代码冻结，本轮未改任何文件。当前套件：`apps/worker-v6/test/worker.test.mjs` 18 项 + `apps/worker-v6/test/security.test.mjs` 5 项 = **23 项**（security 文件是上一轮按同一要求新增的，已在盘上）。

## 覆盖表

| 要求 | 用例 | 结果 |
|---|---|---|
| 改签名任一位 | `security.test.mjs:53`（签名末位翻转） | 409，上游 +0 |
| 改 payload：manifestHash / sessionHash / expiresAt / stages / v | `security.test.mjs:53`（同一用例六个分支） | 409，上游 +0 |
| 伪造凭证 / 错摘要（基线） | `worker.test.mjs:88` | 409，上游 +0 |
| credential 过期边界：`now=exp-1` 有效、`now=exp` 拒绝 | `security.test.mjs:75`（含 `exp+1`） | 200 / 409 / 409，被拒不发上游 |
| credential 过期（粗粒度） | `worker.test.mjs:105` | 409，上游 +0 |
| 换会话 / 换 profile 的凭证 | `worker.test.mjs:105` | 409，上游 +0 |
| session cookie 篡改签名 / 改 exp / 乱码 | `security.test.mjs:91` | status `authenticated:false`；chat 401 |
| 上述响应不泄露原因或密文 | `security.test.mjs:91`（断言不含 expired/invalid/signature/token/访问码/secret） | pass |
| session 过期 | `security.test.mjs:91` 与 `worker.test.mjs:68` | status 未认证；chat 401 |
| 请求体超 512 KiB | `worker.test.mjs:139`、`security.test.mjs:113` | 413，上游 0 |
| 响应超 2 MiB | `security.test.mjs:113` | 502，不回传上游内容 |
| RATE_LIMIT KV 抛错（chat） | `worker.test.mjs:144` | 503，上游 0，不回显 KV 细节 |
| RATE_LIMIT KV 抛错（session + chat） | `security.test.mjs:131` | 均 503，上游 0 |
| 未知/本地 stage、非法字段 | `worker.test.mjs:95` | 400，上游 0 |
| 上游 3xx 不跟随、不转发密钥 | `worker.test.mjs:164` | 502，仅 1 次上游请求 |

结论：Lead 指定的四组（篡改、expiry 精确边界、请求/响应大小、KV 失败关闭）**全部有对应用例**，无“未覆盖”项。

## 缺项（均非漏洞级，冻结期不补）

1. **session 过期的精确边界**：只测了 `exp+1s` 拒绝，没有 `SESSION_MS-1` 通过 / `SESSION_MS` 拒绝的成对用例。凭据边界已测；session 与凭据共用 `exp <= now` 比较（`index.ts:99`），泄漏风险低。
2. **伪造 content-length**：`bodyJson` 先按 header 拒绝，`boundedText` 再按实际字节截断；测试发送的 body 与 header 一致，没有模拟“header 小、实际大”。流式计数本身已实现，属测试盲区而非实现缺口。
3. **KV 并发竞态**：读改写天然不可原子，无法用确定性单测覆盖；已在 `real-ai.md` 记为 best effort，不作为硬上限。
4. **密钥轮换后旧凭证**：`worker.test.mjs:114` 覆盖轮换使旧会话失效；旧凭证会因同一 HMAC 密钥变化一并失效，但未单独断言凭证。属低价值重复。

## 事实回报

1. **TTL 以服务端时间为准**：token `exp = deps.now() + 2h`（`index.ts:205-207`），每次请求与服务器 `now` 比较（`:99`）；credential `expiresAt = min(now+30min, session exp)`（`:128`），chat 每次校验（`:151`）。Cookie `Max-Age` 只决定浏览器何时丢弃；浏览器本机时钟只影响 UI 何时提示重新确认，服务器仍按自己的时间拒绝。
2. **重启 workerd 后会话仍有效**：会话是无状态 HMAC，不落任何存储。只要 `SESSION_SECRET` 与 `ACCESS_CODE` 不变且未过期即可继续使用。密钥来源：部署 secret `SESSION_SECRET`；签名消息为 `patent-v6:session:${payload}:${digest(ACCESS_CODE)}`。轮换任一值会使全部会话与凭证失效（`worker.test.mjs:114`）。
3. **KV 不可用时 fail-closed**：`bump()` 抛错 → 外层 catch → 503 `STORAGE_UNAVAILABLE`，不发上游；`worker.test.mjs:144`（chat）与 `security.test.mjs:131`（session+chat）已覆盖，且不回显 KV 错误内容。

未运行任何测试、未改代码、未接触 tester 环境。
