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

Phase 8（实现阶段：apps/web）

## Phases

### Phase 1: 环境盘点与附件阅读
- [x] 检查仓库与工具（非 git 仓库、.harness 仅有 hooks、pencil MCP 可用）
- [x] 读取 chiefops skill 与 planning-with-files skill
- [x] 读取两份 DOC 附件（交底 2022.12.14 + 定稿 2023.10.27）
- [x] 确认 2023 版《专利审查指南》PDF 本机缺失
- **Status:** complete

### Phase 2: 规划三件套与仓库骨架
- [x] 创建 planning/active/patent-drafter/ 三件套
- [x] git init + .gitignore（private fixtures）；首次提交 55fee39
- [x] 创建 docs/、fixtures/private/、fixtures/sanitized/、spikes/ 目录
- [x] 批准前骨架：fixtures/sanitized/、packages/domain|rules-cn|prompts|providers|audit|shared（tsc 5.9.3 全绿）
- **Status:** complete

### Phase 3: baseline 分析（docs/baseline-analysis.md）
- [x] 交底 vs 定稿结构对比：主题摇摆、NB/470/蓝牙混杂、摘要噪声、电表网关噪声、问题-特征-效果重映射
- [x] 定稿结构拆解：10 条权利要求树、说明书五段式、6 张附图、附图标记
- [x] 输出"系统应识别问题"验收清单对账
- **Status:** complete

### Phase 4: 架构决策与文档（docs/*.md）
- [x] product-spec.md（需求修正清单 + 产品边界）
- [x] architecture.md（Web + Bridge 双端、provider 抽象、起草管线 18 阶段）
- [x] data-model.md（核心领域模型 + 事实状态机）
- [x] threat-model.md（Keychain/配对/CORS/注入）
- [x] privacy-boundaries.md
- [x] rules-mapping.md（规则包结构 + 2026 核对计划）
- [x] deployment.md（Cloudflare Worker Static Assets + 大陆可达性）
- [x] qa-plan.md（安全验收 12 项 + baseline 验收）
- **Status:** complete

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
- [x] 批准前补充：fixtures/sanitized + packages 骨架（domain/rules-cn/prompts/providers/audit/shared）全部落盘并 typecheck
- [x] 等待用户设计批准（强制门）——2026-08-06 已获批准："认可视觉设计。主要要确保交互流程顺畅、人类友好。"
- **Status:** complete

### Phase 8: apps/web 脚手架与设计系统
- [ ] Vite + React + TS + React Router，base /patent/，npm workspaces 接入 packages/*
- [ ] .pen 设计令牌 → CSS 变量（light/dark；primary #FF8400、背景 #F2F3F0、圆角 16、间距 4/8/12/16/24/32/48）
- [ ] AppShell（侧边栏）+ 全部路由（16 屏 + 2 移动端）
- [ ] localStorage 仓储（非敏感 UI 状态；Dexie 迁移留待 snapshot 阶段）
- **Status:** in_progress

### Phase 9: 核心流程屏（首页/新建/上传/充分性/Intake/策略）
- [ ] 项目首页（列表 + 新建入口，对齐 G28UKe）
- [ ] 新建项目（LUXMs）与多附件上传解析（MOtBX）
- [ ] 充分性报告（faOhX）与 Intake 问询（c2PnM）
- [ ] 保护策略确认（E8kpg7）
- **Status:** pending

### Phase 10: 工作台与其余屏
- [ ] 三栏编辑工作台（ForY7）、附图中心（b4S6i）、审校矩阵（g1VL6Z）
- [ ] 导出（e6uhX）、历史（p4Dc8c）、设置（BV5rd）
- [ ] 状态屏：无 Bridge（G7dbx）、模型失败（ylT5f）、配对（oNkxz）
- [ ] 移动端（JSJev / YB7SJ）
- **Status:** pending

### Phase 11: Mock Provider 驱动 18 阶段管线
- [x] Mock 管线（ingest→intake→strategy→claims→spec→abstract→audit）全流程浏览器实测通过（2026-08-06 走查轮）
- [x] 事实状态机与支持矩阵（Audit 屏三标签：支持矩阵/一致性/形式规则）
- [x] 导出门禁（errors>0 阻止正式文件导出，与 Audit 屏共用 DEMO_AUDIT 单一数据源）
- **Status:** complete

### Phase 12: 浏览器逐屏比对与交互验证
- [x] 关键路径走查（新建→上传→解析→充分性→Intake×4→策略→工作台→审校→导出门禁→历史）全通，控制台 0 错误 0 404
- [x] 交互断点修复：审校页默认标签无导航出口、首页死按钮 /demo、Intake 末题按钮语义
- [x] 键盘全链路（Tab/Space/Enter）走查通过；focus-visible 焦点环；表单/文本域无障碍标签
- [x] 截图与 .pen 预览比对受 vision 限制，采用 DOM + 设计令牌比对（此前轮次已比对 17 屏）
- **Status:** complete

### Phase 13: 最终验收与汇报
- [x] baseline 验收对账：qa/baseline-check.mjs 可执行脚本 39/39 PASS，docs/baseline-acceptance.md（2026-08-07）
- [~] 安全验收 12 项取证载体：apps/bridge 骨架完成（13 项安全测试全绿 + 真实进程冒烟）；完整取证待 Bridge 后续轮次（导出/解析/加密 vault）
- [ ] 清理 spike 与调试文件；输出最终报告
- **Status:** in_progress

## Errors Encountered

| Error | Attempt | Resolution |
|-------|---------|------------|
| 2023 版指南 PDF 本机缺失 | 1 | 标记附件缺失；规则包以官方公开文本核对（需联网批准），并保留 2023 附件引用占位 |
| create_goal 失败（有未完成 goal） | 1 | 完成旧 goal（读目标文件）后新建 |
