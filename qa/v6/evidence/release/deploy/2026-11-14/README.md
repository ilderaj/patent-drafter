# 2026-11-14 主域名切换与部署

状态：`patent.paymond.me` 已切到 `patent-v6` Worker；备用域名 `patent-v6.paymond.me` 保留。

## 结果

| 项目 | 值 |
|---|---|
| 合并提交 | `ad71b3b`（PR #3 合并到 `main`） |
| 分支提交 | `d245d6d` |
| Worker | `patent-v6` |
| 版本 | `2c665b98-9f37-4552-a1f2-9a4bc33c8772` |
| 主域名 | https://patent.paymond.me |
| 备用域名 | https://patent-v6.paymond.me |
| 入口构建 | `/assets/index-DSkAfQjU.js`（两域名一致） |

## DNS 变更

切换前（2026-11-10 记录）：`patent.paymond.me` CNAME → `custom-domains.chatgpt.site.`。

2026-11-14 由用户在 Cloudflare 删除该 CNAME。删除后原 ChatGPT 站点离线；随后 Worker 接管该主机名的自定义域名。

回滚：从 Worker `patent-v6` 移除 `patent.paymond.me` 自定义域名，并按上面的原值恢复 CNAME。不要修改 `patent-drafter`。

## 线上核对

- `/` → 302 到 `/v6`；`/v6` 返回 200，加载的入口脚本与本次构建一致。
- `GET /api/v6/status` 返回 `configured:false`、`available:false`、`unavailableReason:"真实起草服务尚未配置完整。"`，`authenticated:false`。真实外发按设计保持关闭。
- 未配置任何供应商密文；没有调用真实模型。

## 范围限制

R1 使用本地测试引擎，输出带测试标记，不是正式申请材料。真实模型链路已实现并有假上游验收，但尚未选定供应商、未做真实调用与质量验证。R2/R3 未交付。
