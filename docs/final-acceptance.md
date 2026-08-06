# 最终验收报告（第一阶段 + 设计批准后实现）

生成时间：2026-08-07 · 主 session（ChiefOps）· 权威规划：planning/active/patent-drafter/

## 1. 结论

本地可验证的交付全部完成并通过验收；**需要外部环境或授权的事项（Worker 部署抓包、Safari 真机、大陆网络抽样）已在第 10 节明确列出交接条件**。

| 验收域 | 结果 | 证据 |
|---|---|---|
| 需求修正与产品边界 | 通过 | docs/product-spec.md |
| Baseline 分析（交底 vs 定稿） | 通过 | docs/baseline-analysis.md + baseline-acceptance.md |
| Phase 0 Spikes（4 项） | 全部 PASS | 见第 4 节（SPIKE_A~D） |
| 架构决策 | 9 项 ADR | docs/architecture.md |
| 威胁模型 | 13 项 T1-T13 | docs/threat-model.md |
| 规则包结构 | 2023-baseline + 2026-01-01 | packages/rules-cn/ + docs/rules-mapping.md |
| .pen 设计 | 22 节点 / 16 屏 + 2 移动端 / 17 预览 | design/patent-drafter.pen + design/previews/ |
| 交互走查 | 8 处修复、键盘全链路 | qa/walk.mjs + qa/screens/ |
| 功能验收（Mock 管线） | 通过 | 浏览器实测（见第 8 节） |
| Baseline 验收对账 | 39/39 PASS | qa/baseline-check.mjs + qa/baseline-report.json |
| 安全验收 | 10/12 已有本地证据（含预览门/恶意附件/注入防线），2/3/4 项待部署 | docs/security-acceptance-evidence.md |

## 2. 交付物清单（git 提交）

```text
55fee39 第一阶段设计交付 - 文档集、Phase 0 spikes、.pen 设计
233a09a 批准前骨架 - fixtures 脱敏样本、domain/rules/prompts/providers/audit/shared 包
57c8322 docs: goal 延续轮 live 证据核验
897e0f4 feat: CNIPA 2026 规则包 - 局令第84号元数据核对
24045db feat: spike parser - macOS Vision 中文 OCR 实测
7f812be feat: parsers/export 契约骨架 - 8 包全部落位
70ea91d chore: npm workspaces 根配置与 QA 走查截图
ab9c114 feat(web): 交互走查修复（8 处）
24e3f26 feat: baseline 验收对账 - 单一事实源 + 39/39 PASS
ce8a190 feat(bridge): Rust+Axum loopback 骨架 - 13 项安全测试
7452b0b docs: 安全验收 12 项证据映射
02f1a53 feat: 安全验收补证 - parsers 恶意附件防护 14/14、Bridge 预览强制门、注入防线
9480eb1 docs: 最终验收报告；清理 spike 调试文件
```

## 3. 需求修正清单（摘要）

1. 产品目标改为"以降低形式缺陷、公开不充分、权利要求缺乏支持等风险为目标生成草案包"，不承诺授权、不显示授权概率。
2. API Key 不存浏览器：WebApp + 本机 Patent Bridge（Key 存 macOS Keychain）；"清除浏览器记录即不可用"不作为安全设计目标，改为"删除本机凭据"显式功能 + 临时会话模式。
3. 规则包版本化：2023 版指南不是唯一规则源，CNIPA 2025 修改（局令第八十四号）2026-01-01 施行，已建 2026-01-01 AI 专章规则增量。
4. MVP 范围：机械/电子/通信/IoT/控制系统/简单软硬结合；实用新型正式、发明 Beta；排除外观/化学/医疗/PCT/OA 答复/自动申报。
5. 互联网研究默认关闭、逐次批准、结果仅作 external_context。
6. 附图：框图/流程图自动生成；机械图/电路图走 Drawing Brief 上传，不自由生成。

## 4. Phase 0 Spikes 结果

| Spike | 验证内容 | 结果 |
|---|---|---|
| A bridge-loopback | HTTPS Web → loopback Bridge（Chrome 150） | PASS；evil origin 403 / 白名单 PNA 预检 204 / POST 200 带 token |
| B parser | DOC/DOCX/PDF/OCR 解析链路 | PASS；textutil 转 .doc 实测 16,289 字节；macOS Vision 中文 OCR（zh-Hans）实测通过，NB-IoT→NB-loT 大小写混淆沉淀为术语归一化表 |
| C deepseek | LLMProvider 契约 + 结构化输出校验 | PASS（SPIKE_C_PASS，含 schema 拒收坏输出） |
| D rules | 确定性规则检查原型 | PASS（32 passed / 0 failed） |

## 5. 架构决策（ADR-001~009，docs/architecture.md）

双端架构：公网 Web（Cloudflare Worker Static Assets，vibing.paymond.me/patent）+ 本机 Bridge（Rust+Axum+SQLite+Keychain，loopback-only）；18 阶段起草管线；Provider 抽象（MVP DeepSeek，预留 CodexLocal/OpenAI/Local）；Fact 状态机（source_backed/user_confirmed/external_context/unsupported，unsupported 禁止导出）；分阶段生成、独立 Prompt、Zod 校验、版本化元数据、缓存与失效传播。

## 6. 威胁模型（T1-T13，docs/threat-model.md）

覆盖 Key 窃取（浏览器/日志/Worker）、配对劫持、CORS 滥用、Loopback 端口扫描、Prompt Injection、恶意附件（ZIP bomb/宏/路径穿越）、会话重放、供应链等；每项含缓解措施与验收对应项。

## 7. 规则包结构

```text
packages/rules-cn/
  2023-baseline/  common / invention / claims / utility-model（4 类规则 JSON）
  2026-01-01/     ai-related（AI-INV-001/002、AI-DISC-001、AI-ETH-001、AI-EXAM-001）
```

每条规则含 ruleId/patentType/severity/deterministicCheck/sourceDocument/sourceSection/effectiveFrom/effectiveTo/userMessage/remediation。规则包与 Prompt 版本号写入每次生成元数据。

## 8. 功能验收（apps/web，浏览器实测）

- 16 屏 + 2 移动端全部渲染正确；控制台 0 错误 0 404。
- 关键路径：新建 → 上传（示例交底）→ 解析 → 充分性报告 → Intake×4 → 策略确认 → 三栏工作台 → 审校矩阵 → 导出门禁（error>0 阻止并"去处理"）→ 历史版本。
- 交互修复 8 处：审校页导航出口、首页死按钮、门禁/审校数据源统一、Intake 末题文案、a11y 标签×2、focus-visible 焦点环、favicon 404、设置页路由跳转。
- 键盘全链路（Tab/Space/Enter）实测通过；工作台段落列表由 claims 派生并标记无来源项。
- 构建：vite build 287KB（gzip 90KB）。

## 9. Baseline 验收（39/39 PASS）

qa/baseline-check.mjs 对定稿夹具自检（10 条权利要求/引用合法/五段式/6 图）与生成输出对账：独立项覆盖定稿 11 项核心特征、噪声（NB/CAT.1/485/电表网关/宣传语/页脚）零残留、无来源特征精确检出 1 处并被导出门禁拦截、P1-P8 交底问题全部有对应处理证据。报告：docs/baseline-acceptance.md。

## 10. 安全验收（12 项，10/12 已有本地证据）

详见 docs/security-acceptance-evidence.md。已有证据：Key 不进浏览器存储（代码审计）、Bridge loopback-only（代码+进程实测）、CORS 无通配（403 测试）、session 过期（测试）、日志无正文（测试+采样）、每次模型发送的预览强制门（Bridge chat 路由 428 + 载荷哈希绑定，2 项测试）、恶意附件防护（parsers guard 14/14）、CI Mock Provider（14 项集成测试零真实 Key）。

**交接条件（需外部授权/环境）：**

1. Worker 部署 + 抓包复证第 2/3/4 项（Key/专利文件不经过 vibing.paymond.me）——需用户在 Cloudflare 授权部署。
2. Safari 真机 loopback 验证（Phase 0 遗留；Chrome 150 已过，Tauri 为 Plan B）。
3. 大陆网络可用性抽样 + 境内托管/ICP 迁移文档（docs/deployment.md 已含）。
4. 18 阶段管线注入/恶意附件测试集与真实 DeepSeek 联调（第 8/10/11 项）：Bridge 侧预览强制门与 parsers 防护模块已实现并通过本地测试，剩余为真实模型驱动的端到端联调。

## 11. 复现命令

```bash
npm run build -w @patent/web          # Web typecheck + build
cd apps/bridge && cargo test          # Bridge 14 项安全测试
node qa/baseline-check.mjs            # Baseline 验收 39/39
node qa/walk.mjs flow                 # 关键路径交互走查
```
