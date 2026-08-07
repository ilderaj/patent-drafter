# 部署方案

## 1. 目标拓扑

```text
用户浏览器 ──HTTPS──► vibing.paymond.me/patent*（Cloudflare Worker：静态资产 + 云端 API）
                         │
                         ├─ 静态资源（React SPA）
                         └─ /patent/api/*（共享密码门 + DeepSeek/OpenCode Go 代理）

可选（本地模式）：用户浏览器 ──HTTPS──► https://127.0.0.1:PORT（本机 Patent Bridge）
```

## 2. 生产部署（Cloudflare Worker：静态资产 + 云端计算）

- Route：`vibing.paymond.me/patent*`，所有路径回退到 SPA（`/patent`、`/patent/`、`/patent/projects/:id`）。
- 静态资源全部打包进 Worker 资产；无第三方 CDN；无外部字体；CSP 收紧。
- 云端模式（默认）：LLM Key（DEEPSEEK_API_KEY，OpenCode Go）仅存于 Worker secrets；共享访问密码（ACCESS_PASSWORD）门禁；HMAC 无状态会话 12h；登录每 IP 每小时 10 次、聊天每日 60 次（KV 限速）；预览确认门（428 + SHA-256 绑定）后才转发模型请求。
- Worker 不落盘任何专利内容；日志仅元数据（method/path/status/ms），无 key/密码/正文。
- 本地 Bridge 模式保留为可选（配对 + macOS Keychain），首次引导可在设置页切换。
- PWA：Service Worker scope 限定 `/patent/`，缓存壳资源。
- 部署通过 wrangler（CI 中可用 mock provider 构建测试）。

## 3. 大陆可达性

**明确不承诺**：免费 Cloudflare 大陆访问不稳定（DNS/SNI 干扰、回源慢）。

策略：

1. 使用真实大陆网络抽样（用户指定节点或众测）验证可用性，记录失败模式。
2. 备用/迁移方案文档：境内对象存储 + 备案域名 + CDN（如阿里云 OSS + CDN + ICP 备案）；或境内边缘函数托管。
3. 域名规划：vibing.paymond.me 保持主入口；迁移时 DNS 切换，路径不变。
4. 云端模式下大陆用户无需 Bridge：密码解锁后即可完整使用（网络可达性仍取决于 Cloudflare 大陆链路）。

## 4. 环境矩阵

| 环境 | URL | Bridge 配对 |
|------|-----|-------------|
| 本地开发 | http://localhost:5173/patent/ | 允许 localhost + 127.0.0.1 |
| 预览 | Sites 或 preview.paymond.me | 允许对应 Origin |
| 生产 | vibing.paymond.me/patent/ | 云端模式（默认）或本地 Bridge（需授权） |

## 5. 发布流程（设计批准后）

1. CI：build + unit + integration（mock provider）→ 安全扫描 → 测试通过
2. 人工 QA：浏览器 + Bridge 实测（Chrome/Safari）
3. 大陆可达性抽样
4. wrangler deploy（worker assets）
5. 版本回滚预案（保留上一版本资产）

## 6. 当前部署状态（2026-08-07，云端化 + OpenCode Go 切换后）

- Worker：`patent-drafter`（计算 Worker + ASSETS），version `2941ed6d-62c7-4b18-a32b-b0a4510c5285`。
- 生产 secrets（wrangler secret put）：DEEPSEEK_API_KEY（OpenCode Go）、ACCESS_PASSWORD（共享密码，由服务拥有者分发）、SESSION_SECRET（HMAC 签名）。
- LLM provider：OpenCode Go `deepseek-v4-flash`（https://opencode.ai/zen/go/v1，OpenAI 兼容，`response_format: json_object` 可用；推理模型，响应含 reasoning_content，content 在推理完成后填充）。
- 路由：`vibing.paymond.me/patent` + `vibing.paymond.me/patent/*`（zone paymond.me）；域名根路径由既有服务（matters）继续托管，互不影响。
- 构建：`npm run build -w @patent/web` → `apps/web/dist/patent/`（vite base=/patent/）+ `dist/index.html`（SPA fallback 副本）+ `dist/_headers`（安全头规则，`/patent/*` 前缀）。
- 安全头（_headers）：严格 CSP（connect-src 仅 'self' + http://127.0.0.1:7878）、nosniff、DENY framing、no-referrer、permissions-policy；`/patent/assets/*` 不可变长缓存。
- 部署命令：`npx wrangler deploy`（wrangler.jsonc 为事实源）；回滚：`npx wrangler rollback`。
- 生产验证：qa/prod-network-evidence.mjs（网络隔离 4/4）、SPA fallback、CSP、qa/walk-cloud-prod.mjs（解锁/附件/真实管线到 intake）、截图 qa/screens/prod-*.png。

## 7. 生产浏览器访问本机 Bridge 的授权要求

生产页面（https）fetch `http://127.0.0.1:7878` 需要两层授权，首次使用在用户本机完成一次：

1. macOS「系统设置 → 隐私与安全性 → 本地网络」允许浏览器 App（Chrome/Safari/Codex）。
2. 浏览器 Local Network Access 授权：Chrome 在 https 页面访问本地网络时要求站点级授权（未授权返回 `ERR_BLOCKED_BY_CLIENT`；Safari 无此站点级机制但受第 1 层约束）。

授权后，生产与开发模式走完全相同的代码路径，差异仅 bridge 端点（生产直连 127.0.0.1:7878，开发经 vite proxy）。
