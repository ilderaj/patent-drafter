# 威胁模型

## 1. 资产与信任边界

| 资产 | 位置 | 保密性 | 完整性 |
|------|------|--------|--------|
| LLM API Key（OpenCode Go） | Worker secrets（云端模式，默认）/ 本机 Keychain（本地 Bridge 模式） | 高 | 高 |
| 专利交底材料/项目正文 | Bridge 加密 Vault + 浏览器内存 | 高 | 高 |
| 用户历史项目/快照 | Bridge Vault | 高 | 高 |
| 生成结果 | Bridge Vault | 高 | 高 |
| session token | 浏览器 localStorage（HMAC 无状态，12h 过期） | 中 | 高 |
| WebApp 静态资源 | Cloudflare | 低 | 高 |

信任边界：

1. **浏览器 ↔ Bridge**（loopback，短 token，Origin 白名单）
2. **Bridge ↔ DeepSeek**（用户 Key，HTTPS，材料片段）
3. **浏览器 ↔ Cloudflare Worker**（云端模式：共享密码门 + HMAC 会话 + 预览确认门；材料经 HTTPS 转发，服务端不落盘）
4. **Worker ↔ OpenCode Go**（服务端 Key，仅透传模型请求；上游错误只报状态码）

云端模式信任根降级点：Key 信任根从 macOS Keychain 变为 Cloudflare 账号（需 2FA 保护）；材料在传输路径上经过 Worker 转发（不保存）。

## 2. 威胁清单与缓解

| # | 威胁 | 影响 | 缓解 |
|---|------|------|------|
| T1 | XSS 窃取 Key | 高 | Key 永不在浏览器；浏览器只持短 token；CSP 收紧；React 默认转义；无第三方脚本 |
| T2 | 恶意网站 CSRF 调用 Bridge | 高 | Origin 白名单校验；配对 token 仅一次性；CORS 明确 allowlist；Bridge 校验 Sec-Fetch-Site |
| T3 | 恶意附件（ZIP bomb/超大/路径穿越/宏/恶意 HTML） | 高 | 解析器防 ZIP bomb/大小上限/禁宏/不解析 HTML 执行/路径白名单；附件内容视为不可信数据 |
| T4 | Prompt Injection（材料内指令） | 高 | 材料内容与系统 Prompt 隔离；所有 Prompt 声明材料为数据；输出按 schema 校验；不执行材料内指令 |
| T5 | Key 泄露到日志/错误报告/URL | 高 | 日志不含 Key/正文；错误上报去敏；密钥审计（spike C 覆盖） |
| T6 | session token 重放/长期有效 | 中 | 短过期时间；一次性配对码；自动锁定 |
| T7 | 浏览器扩展读取本地存储中的 Key | 高 | Key 不入浏览器存储 |
| T8 | 本机恶意进程读 Vault | 中 | Vault 加密（Key 派生自 Keychain/用户口令）；文件权限收紧 |
| T9 | 中间人截获浏览器→Bridge 通信 | 中 | HTTPS 自签证书 + 浏览器信任锚（首次配对校验指纹） |
| T10 | 模型幻觉产生无来源内容 | 高 | 事实门禁：unsupported 禁入导出；支持矩阵审计；每段生成可溯源 |
| T11 | 互联网补充污染发明事实 | 中 | external_context 单独隔离；不自动改权利要求；需用户批准 |
| T12 | Cloudflare Worker 被篡改分发恶意 JS | 中 | 静态资产不可信输入最小化；SRI/版本固定；定期审计 |
| T13 | 附件内容被发送到非预期服务 | 高 | 模型调用仅 Bridge→DeepSeek；每次发送前预览（用户确认） |
| T14 | 共享密码泄露导致余额被刷 | 中 | 登录限速（每 IP 每小时 10 次）+ 聊天限速（每日 60 次）+ Go 订阅月度硬额度 + 日志无正文 |
| T15 | 云端 Worker 出站被中间人/篡改上游 | 中 | HTTPS 直连 opencode.ai；Key 仅用于 Bearer 头；不解析上游正文到日志 |

## 3. 安全验收映射（详见 qa-plan.md）

安全验收 12 项对应：T1/T5（1-2）、T12（3）、T13（4）、T8（5）、T2（6）、T6（7）、T13（8）、T5（9）、T4（10）、T3（11）、测试（12）。
