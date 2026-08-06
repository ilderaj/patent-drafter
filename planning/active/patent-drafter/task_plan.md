# Task Plan: 专利申请WebApp开发（第一阶段）

## Goal

构建一个帮助撰写中国发明专利和实用新型申请文件的本地优先 WebApp（vibing.paymond.me/patent），主 session 以 ChiefOps 身份完成第一阶段：需求修正、baseline 分析、架构决策、威胁模型、规则包结构、Phase 0 spikes、完整 .pen 设计，汇报后等待用户设计批准；批准前不写正式产品前端。

## Current State

Status: active
Archive Eligible: no
Close Reason:
Reconcile: open

## Routing Decision

- Selected Route: tracked-deep
- Route Reason: 多阶段、多 worker 并行、跨 session 恢复、架构决策与安全边界需要持久化规划；属 deep-reasoning（架构未定型）。
- Promotion Trigger: 已完成
- Route Evidence Surface: planning trio + docs/

## Current Phase

Phase 1（第一阶段：设计前交付物）

## Phases

### Phase 1: 环境盘点与附件阅读
- [x] 检查仓库与工具（非 git 仓库、.harness 仅有 hooks、pencil MCP 可用）
- [x] 读取 chiefops skill 与 planning-with-files skill
- [x] 读取两份 DOC 附件（交底 2022.12.14 + 定稿 2023.10.27）
- [x] 确认 2023 版《专利审查指南》PDF 本机缺失
- **Status:** complete

### Phase 2: 规划三件套与仓库骨架
- [x] 创建 planning/active/patent-drafter/ 三件套
- [ ] git init + .gitignore（private fixtures）
- [ ] 创建 docs/、fixtures/private/、fixtures/sanitized/、spikes/ 目录
- **Status:** in_progress

### Phase 3: baseline 分析（docs/baseline-analysis.md）
- [ ] 交底 vs 定稿结构对比：主题摇摆、NB/470/蓝牙混杂、摘要噪声、电表网关噪声、问题-特征-效果重映射
- [ ] 定稿结构拆解：10 条权利要求树、说明书五段式、6 张附图、附图标记
- [ ] 输出"系统应识别问题"验收清单对账
- **Status:** pending

### Phase 4: 架构决策与文档（docs/*.md）
- [ ] product-spec.md（需求修正清单 + 产品边界）
- [ ] architecture.md（Web + Bridge 双端、provider 抽象、起草管线 18 阶段）
- [ ] data-model.md（核心领域模型 + 事实状态机）
- [ ] threat-model.md（Keychain/配对/CORS/注入）
- [ ] privacy-boundaries.md
- [ ] rules-mapping.md（规则包结构 + 2026 核对计划）
- [ ] deployment.md（Cloudflare Worker Static Assets + 大陆可达性）
- [ ] qa-plan.md（安全验收 12 项 + baseline 验收）
- **Status:** pending

### Phase 5: Phase 0 Spikes（spikes/）
- [x] Spike A: Loopback Bridge 可行性（Chrome 150 实测通过；Safari 待真机验证）
- [x] Spike B: DOC/DOCX/PDF/OCR 解析可行性（soffice+textutil+Vision/tesseract 链路）
- [x] Spike C: DeepSeek 调用契约（Mock 验证，SPIKE_C_PASS）
- [x] Spike D: 规则确定性检查原型（32 项全 PASS）
- **Status:** complete

### Phase 6: 完整 .pen 设计（design/patent-drafter.pen）
- [x] 设计 14 类核心界面 + 异常状态 + 移动端（16 屏 + 5 组件，22 顶层节点）
- [x] 导出 17 张预览至 design/previews/；snapshot_layout 无布局问题
- **Status:** complete

### Phase 7: 第一阶段汇报
- [x] 汇总需求修正清单、baseline、spike 结果、ADR、威胁模型、规则包结构、.pen 路径、实现计划
- [ ] 等待用户设计批准（强制门）
- **Status:** in_progress

## Errors Encountered

| Error | Attempt | Resolution |
|-------|---------|------------|
| 2023 版指南 PDF 本机缺失 | 1 | 标记附件缺失；规则包以官方公开文本核对（需联网批准），并保留 2023 附件引用占位 |
| create_goal 失败（有未完成 goal） | 1 | 完成旧 goal（读目标文件）后新建 |
