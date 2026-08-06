# 部署方案

## 1. 目标拓扑

```text
用户浏览器 ──HTTPS──► vibing.paymond.me/patent*（Cloudflare Worker Static Assets）
                         │
                         └─ 仅静态资源（React SPA，无状态）

用户浏览器 ──HTTPS──► https://127.0.0.1:PORT（本机 Patent Bridge）
```

## 2. 生产部署（Cloudflare Worker Static Assets）

- Route：`vibing.paymond.me/patent*`，所有路径回退到 SPA（`/patent`、`/patent/`、`/patent/projects/:id`）。
- 静态资源全部打包进 Worker 资产；无第三方 CDN；无外部字体；CSP 收紧。
- Worker 不存储、不代理任何 LLM Key 或专利内容；无服务端会话。
- PWA：Service Worker scope 限定 `/patent/`，缓存壳资源。
- 部署通过 wrangler（CI 中可用 mock provider 构建测试）。

## 3. 大陆可达性

**明确不承诺**：免费 Cloudflare 大陆访问不稳定（DNS/SNI 干扰、回源慢）。

策略：

1. 使用真实大陆网络抽样（用户指定节点或众测）验证可用性，记录失败模式。
2. 备用/迁移方案文档：境内对象存储 + 备案域名 + CDN（如阿里云 OSS + CDN + ICP 备案）；或境内边缘函数托管。
3. 域名规划：vibing.paymond.me 保持主入口；迁移时 DNS 切换，路径不变。
4. 大陆用户第一次使用必须安装 Bridge 才能完整使用——即使静态资源可达，功能闭环在本机。

## 4. 环境矩阵

| 环境 | URL | Bridge 配对 |
|------|-----|-------------|
| 本地开发 | http://localhost:5173/patent/ | 允许 localhost + 127.0.0.1 |
| 预览 | Sites 或 preview.paymond.me | 允许对应 Origin |
| 生产 | vibing.paymond.me/patent/ | 仅允许生产 Origin |

## 5. 发布流程（设计批准后）

1. CI：build + unit + integration（mock provider）→ 安全扫描 → 测试通过
2. 人工 QA：浏览器 + Bridge 实测（Chrome/Safari）
3. 大陆可达性抽样
4. wrangler deploy（worker assets）
5. 版本回滚预案（保留上一版本资产）
