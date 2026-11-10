# 2026-11-10 部署记录

## 备用域名

| 项目 | 值 |
|---|---|
| 提交 | `48ea91c` |
| Worker | `patent-v6` |
| 版本 | `04cfb43a-c237-450f-a946-2f125cf03cd0` |
| 地址 | https://patent-v6.paymond.me |

线上复验三轮（`online-run/`、`online-run-2/`、`online-run-3/`）：每轮 124 条记录，0 fail、0 blocked、0 skipped、0 pageerror、应用 console.error 0，7 个下载结构有效。`/` 返回 302 到 `/v6`；非本域外部请求 0；Cloudflare 自动注入的 insights beacon 被 CSP 拦截，其控制台报错单独归类。

首轮之前有两次尝试出现失败（合成事实确认 reload 未保留、全局动态 0 行、首页按钮未就绪）。脚本加入就绪等待后三轮均未复现；首页按钮就绪约 1.7–2.3 秒，原脚本只等 250 ms。当时的确切根因未能确证。

## 主域名切换前的 DNS 原值（回滚用）

记录时间：2026-11-10，切换前。

| 主机名 | 类型 | 值 |
|---|---|---|
| `patent.paymond.me` | CNAME | `custom-domains.chatgpt.site.` |

权威 NS：`gabe.ns.cloudflare.com`、`candy.ns.cloudflare.com`。

回滚：移除 Worker `patent-v6` 上的 `patent.paymond.me` 自定义域名，再恢复上面的 CNAME 记录。不修改 `patent-drafter`。

## 范围限制

R1 使用本地测试引擎，所有输出带「测试输出」标记，不能作为正式申请材料；真实模型外发门关闭。未在 Safari、Firefox 或真实移动网络上验证。
