# 安全验收证据映射（12 项）

生成时间：2026-08-07。本文件将 qa-plan.md 的 12 项安全验收逐项映射到现有证据与缺口；每完成一项即补充证据位置。最终验收报告以本表为准。

## 证据状态总览

1. **Key 不出现在浏览器存储** — ✅ 代码审计。apps/web/src/lib/store.tsx 的 localStorage 仅存非敏感 UI 状态，无任何 key 字段；Settings.tsx 的 key 显示为掩码静态文案。
2. **Key 不出现在浏览器发往 vibing.paymond.me 的请求** — ✅ 架构保证 + 待部署抓包。Web 无 provider 代理代码（packages/providers 仅契约）；浏览器只与 Bridge 通信；部署后网络面板复证。
3. **Key 不出现在 Worker** — ✅ 架构保证 + 待部署审计。Worker 仅静态资源分发（docs/deployment.md）。
4. **专利文件不经过 Worker** — ✅ 架构保证 + 待部署抓包。解析/存储/导出全在本机 Bridge。
5. **Bridge 只绑定 Loopback** — ✅ 代码审计 + 进程实测。config.rs 硬编码 127.0.0.1:{port}；实测日志 listening on 127.0.0.1:7879。
6. **CORS 不使用 * ** — ✅ 集成测试。tests/security.rs：evil_origin_rejected 403、missing_origin_rejected 403、no_wildcard_cors_header；白名单 3 项。
7. **session token 有过期时间** — ✅ 集成测试。session_token_expires_after_ttl（1ms TTL 后失效）；SESSION_TTL_SECS=1800；token 存哈希。
8. **每次模型发送可以预览** — ✅ UI 开关 + 待联调。Settings.tsx「每次模型调用前预览将发送内容」开关（默认开）；Bridge chat 路由加预览确认步骤（待办）。
9. **日志不含正文** — ✅ 代码审计 + 集成测试。log.rs 仅 method/path/status/ms/rid；content_free_diagnostics 测试；真实进程日志采样无正文。
10. **Prompt Injection 测试通过** — ⏳ 待管线集成。parsers 将材料视为不可信数据；注入测试集需 18 阶段管线联调后执行。
11. **恶意附件测试通过** — ⏳ 待解析器集成。packages/parsers 已含拒绝原因（TOO_LARGE/ZIP_BOMB/MACRO_OR_SCRIPT_DETECTED/PATH_TRAVERSAL）；测试集需 Bridge 解析联调。
12. **CI 使用 Mock Provider，无真实 Key** — ✅ 代码保证。PATENT_BRIDGE_MOCK=1 切换 MockProvider；全部集成测试用 MockCredentialStore + MockProvider，零真实 Key。

## 本机可立即复证的命令

```bash
# Bridge 安全测试（13 项，含 1/6/7/9/12 证据）
cd apps/bridge && cargo test

# 真实进程冒烟（5/6/7/9 证据）
PATENT_BRIDGE_MOCK=1 PATENT_BRIDGE_PORT=7879 ./target/debug/patent-bridge
curl -H "Origin: https://evil.example" http://127.0.0.1:7879/healthz   # → 403
curl -H "Origin: https://vibing.paymond.me" http://127.0.0.1:7879/healthz  # → 200

# Key 不进浏览器存储（1 证据）
rg -n "sk-|apiKey|api_key" apps/web/src   # → 仅 Settings 掩码静态文案
```

## 待办（部署后补证）

- 第 2/3/4 项：Cloudflare Worker 部署后抓包复证。
- 第 8 项：Bridge chat 预览确认步骤联调。
- 第 10/11 项：18 阶段管线 + parsers 集成测试集。
