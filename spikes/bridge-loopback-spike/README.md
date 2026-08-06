# Spike A: Loopback Bridge 可行性（Chrome 150 实测）

## 验证目标

HTTPS Web 页面能否调用本机 loopback Patent Bridge（CORS + PNA + mixed content）。

## 方法

1. 本机 HTTPS 页面服务器（自签证书，模拟生产 Origin）。
2. 本机 http://127.0.0.1:PORT Bridge（带 CORS 白名单 + `Access-Control-Allow-Private-Network: true`）。
3. Playwright 真实 Chromium 与系统 Chrome 150 发起 `fetch("http://127.0.0.1:PORT/api/ping", { headers: { "X-Session-Token": ... } })`。

## 结果

| 场景 | 结果 |
|------|------|
| HTTPS(127.0.0.1) → HTTP(127.0.0.1) 简单 fetch | 成功 200（local→local，无 PNA preflight） |
| HTTPS(192.168.50.158 私网) → HTTP(127.0.0.1) fetch 带自定义头 | 成功 200；OPTIONS preflight 到达 Bridge（pna=None） |
| 同上 + Chrome flag 强制 PNA | 成功；OPTIONS 仍无 `Access-Control-Request-Private-Network` 头 |
| 恶意 Origin 请求 | 403（Origin 白名单生效，见 bridge_server.mjs 自检） |

## 结论

1. **Chrome 150 当前不阻塞 HTTPS → 127.0.0.1**：loopback 目标对 mixed content 有豁免；PNA 在当前版本未强制 block（即便开启 feature flag，preflight 也未带 PNA 头）。
2. **仍必须保留 PNA 响应头**：`Access-Control-Allow-Private-Network: true` 是防御未来 Chrome 强制 PNA 的标准做法；Bridge 必须始终返回。
3. **CORS 白名单是唯一硬门禁**：Origin 不在白名单直接 403，不能依赖浏览器 PNA。
4. **自定义头触发 preflight**：`X-Session-Token` 等自定义头必然触发 OPTIONS，Bridge 必须正确应答预检（Access-Control-Allow-Headers 含所需头）。

## 遗留风险与待验证

- Safari：本机无 headless Safari；Safari 的 Local Network Privacy 弹窗主要针对局域网广播，127.0.0.1 回环通常不触发，但**需真机验证**（Safari 17/18 + 生产域名）。
- 生产公网域名（vibing.paymond.me）→ loopback 属于 public→local 最严路径；实测为 private→local。差异在于地址空间判断，Chrome 当前实现下预期一致，仍需部署后回归。
- HTTPS loopback：Bridge 应优先提供自签 HTTPS（或 Chrome 的 http://127.0.0.1 特例已足够）；Phase 0 结论：HTTP loopback 在 Chrome 150 可用，Bridge 默认 HTTP loopback + 完整 CORS/PNA 头；Tauri fallback 保留为 Plan B。

## 产物

- `bridge_server.mjs`：Node 版 Bridge 自检（Origin 白名单 403 / PNA preflight 204 / 正常 200）。
- `pna_test.py`：Playwright 真实浏览器 PNA/CORS 测试。
- `certs/`：自签证书（仅 spike）。
