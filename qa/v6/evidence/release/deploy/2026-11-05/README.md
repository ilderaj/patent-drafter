# 2026-11-05 部署记录

状态：备用域名已上线；`patent.paymond.me` 未切换。

## 结果

| 项目 | 值 |
|---|---|
| 提交 | `71630cea0affe72be012ee02811e8cc2e285abfd` |
| Worker | `patent-v6`（独立于 `patent-drafter`） |
| 最终版本 | `fdbf2d2c-7c9e-4899-a456-50b1a8ea3ef7` |
| 访问地址 | https://patent-v6.paymond.me |
| 构建入口 SHA-256 | `ad7121bec091606fc6a31f06864b1818c93158c47673b9081595117ffcf8ae23` |
| 资源 | 12 个文件，9 个静态资源上传；免费 Workers 计划 |

第一次部署使用临时 workers.dev 配置，版本 `068a811d-1996-4e6a-a2fc-d9bfbef05e4c`，地址 `https://patent-v6.typemint.workers.dev`。随后部署备用自定义域名时，Wrangler 未显式启用 `workers_dev`，该地址已停用；当前可用地址是 `https://patent-v6.paymond.me`。

## 主机名冲突

`patent.paymond.me` 仍是 CNAME 到 `custom-domains.chatgpt.site` 的现有 ChatGPT 自定义域名。切换该主机名会替换现有 DNS 记录并使当前站点离线，因此未执行。此次只创建了新主机名 `patent-v6.paymond.me`，未修改 `patent.paymond.me`，也未触碰 `patent-drafter`。

要把 `patent.paymond.me` 指向本 Worker，需要明确确认替换现有记录；该操作可回滚，但会先中断现有站点。回滚时需恢复操作前记录的 DNS 原值。

## 冒烟结果

- 入口页：标题「专利起草助手」，显示「创建案件」；0 控制台错误。
- 备用域名 `https://patent-v6.paymond.me` 的入口冒烟脚本退出码为 1，唯一原因是页面出现 Cloudflare 自动注入的 `static.cloudflareinsights.com` 请求；应用本身没有外部请求。响应头已包含 `script-src 'self'` 的 CSP。
- 工作台流程：脚本创建本地案件并打开工作台；草稿、检查、审阅、交付、申请和设置页均渲染，0 控制台错误。最终备用域名自动化运行中「材料」「事实」两页正文为空，属于该次导航时序；同一构建在 workers.dev 运行的同一流程两页均有内容。
- 文件与数据仍保存在浏览器 IndexedDB；未上传文档正文，未调用真实模型，未收费，未办理官方提交。

## 证据

- `workers-dev-deploy.txt`、`alt-domain-deploy.txt`
- `workers-dev-smoke.json`、`alt-domain-smoke.json`
- `workers-dev-workspace.json`、`alt-domain-workspace.json`
- `workers-dev-entry.png`、`alt-domain-entry.png`

## 未验证

- Node 22 未验证；构建与检查使用 Node 25.8.1。
- 未在真实移动网络、Safari 或 Firefox 上验证。
- 未执行正式恢复演练、真实模型、真实导出后的官方客户端校验。
- `patent.paymond.me` 切换与现有 ChatGPT 站点迁移未执行。
