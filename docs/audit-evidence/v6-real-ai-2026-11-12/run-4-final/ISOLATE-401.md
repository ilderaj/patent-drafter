# 401 定位（2026-11-14，最小重放，未复现）

环境：新起 accept-env（单 profile、单 context、无整页跳转、无 cookie 清理、无 host 切换、无 clock 注入）；
合成密钥**固定**：`ACCEPT_ACCESS_CODE` / `ACCEPT_SESSION_SECRET`（本次为 21/48 字符的合成值，未记录内容），
因此即使环境重启也不会因密钥轮换而使会话失效（accept-env 现支持这两个环境变量）。

## 时间线（每个边界读 status.authenticated / sessionId 摘要 / profileVersion / 服务器 Date）

| 边界 | authenticated | sessionId 摘要 | 页面文档 cookie 可见 | 时间 |
|---|---|---|---|---|
| 登录后 | true | 57b4f9f4e6a7 | false | 02:09:54 |
| 草稿页加载 | true | 57b4f9f4e6a7 | false | 02:09:56 |
| 首次同意后 | true | 57b4f9f4e6a7 | false | 02:09:56 |
| 另一标签页撤回后 | true | 57b4f9f4e6a7 | false | 02:10:00 |
| Sheet 重开（G1） | true | 57b4f9f4e6a7 | false | 02:10:00 |
| 撤回后再授权 | true | 57b4f9f4e6a7 | false | 02:10:00 |
| 13 阶段成功 + 采纳 | true | 57b4f9f4e6a7 | false | 02:10:05 |
| 采纳后再确认 | true | 57b4f9f4e6a7 | false | 02:10:52 |
| 故障入口（点 start） | true | 57b4f9f4e6a7 | false | 02:11:04 |

**没有出现 authenticated true→false**；同一 sessionId 摘要贯穿全程，没有新会话签发。

网络侧（本页监听同一 origin）：`/api/v6/status` 200×25、`/api/v6/chat` 200×13、`/api/v6/consent` 200×2，**无 401**。

## 结论与边界

- 在固定密钥、单 profile、同一 127.0.0.1 origin、无重启的路径上，run-4 的 401 **未复现**。
- 已排除的脚本因素：无 `clearCookies`/`storageState`；无 host 从 localhost 切 127.0.0.1；无 clock 推进；无脚本内登出。
- 可观察性限制：会话 cookie 是 HttpOnly + Secure，且浏览器跑在 http://127.0.0.1 ——
  `document.cookie` 与 Playwright `context.cookies()` 都**看不到**它（两者恒为 false），但服务器仍能认证。
  因此「cookie 是否存在」不能用这两个接口判断，只能以 `status.authenticated` 为准（本轮已如此记录）。
- 可能诱因（未证实）：若环境在运行中途重启且合成密钥随机轮换，旧会话会立即失效，症状与此前 401 一致；
  现已支持固定密钥，后续最终 E2E 建议保持固定，若再出现 401 即可排除密钥轮换。
- 单列：被直接探针拒绝的请求不要求出现在 AI invocation 记录里（run-4 中 rows=13 vs chat=14 即属此类）。

证据：`isolate-401.py`、`isolate-401.json`。
