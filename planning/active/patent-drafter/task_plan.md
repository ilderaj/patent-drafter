# Task Plan: 专利申请WebApp开发（第一阶段）

## Goal

构建一个帮助撰写中国发明专利和实用新型申请文件的本地优先 WebApp（vibing.paymond.me/patent），主 session 以 ChiefOps 身份完成第一阶段：需求修正、baseline 分析、架构决策、威胁模型、规则包结构、Phase 0 spikes、完整 .pen 设计，汇报后等待用户设计批准；批准前不写正式产品前端。

## Current State

Status: active
Archive Eligible: no
Close Reason:
Reconcile: Phase 18 confirmed; Beta execution authorized; Slice 1 binding in progress

## Routing Decision

- Selected Route: tracked-deep
- Route Reason: 多阶段、多 worker 并行、跨 session 恢复、架构决策与安全边界需要持久化规划；属 deep-reasoning（架构未定型）。
- Promotion Trigger: 已完成
- Route Evidence Surface: planning trio + docs/

## Current Phase

Phase 19（Beta 最小建设执行；当前仅 Slice 1 检索协议与历史基准选择）

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
- [~] 安全验收 12 项取证载体：apps/bridge 完成（14 项安全测试全绿 + 真实进程冒烟 + 预览强制门；parsers 恶意附件防护 14/14），本地证据 10/12；剩余 2/3/4 项待部署，导出/解析/加密 vault 待后续轮次
- [x] 清理 spike 调试文件（结论并入最终报告第 4 节，git 历史可恢复）
- [x] 最终验收报告 docs/final-acceptance.md（含外部门交接条件：Worker 部署抓包/Safari 真机/大陆抽样）
- [x] 真实 DeepSeek 联调：web 真实 Bridge 桥接 + 全链路走查 20/20（qa/walk-live.mjs）
- [x] Worker 部署：vibing.paymond.me/patent 上线（纯 Static Assets + CSP），安全验收第 2/3/4 项生产抓包复证 → 12/12
- [x] 生产验证：用户 Chrome 走查生产 URL 全功能（demo 工作台/审校/门禁/历史/规则）
- **Status:** completed

### Phase 14: 生产验证期事故修复与性能优化（2026-08-07 ~ 2026-08-08）
- [x] 生产 429 事故：KV 计数重置 + 限额 300/天 + 预览门开关 + SSE 流式 + 重试/超时（commit 88e7bcc / f6abb9f）
- [x] 导出门禁死胡同：确认来源/确认已处理交互 + 移除 demo fallback 误伤（commit 4f8f76e / d833204 / 7433d6c）
- [x] 工作台显示/交互 6 项修复 + _headers no-store 缓存根治（commit dabb274，生产 5/5）
- [x] 门禁空括号根因（真实复现：errors 全为一致性/形式类，无 none 特征）+ 文案回退与去处理直达（生产验证 5/5）
- [x] 性能优化：thinking 禁用（实测 -81.8%）+ 管线波次并行（全流程 ~124s，-48%）
- [x] 完整 UAT 回归（walk 全链路/workbench 15/15/gate 12/12/pipeline 10/10/worker 15/15）+ docs/uat-reconcile-2026-08-08.md
- **Status:** completed（reconcile 文档已产出；剩余可选优化项见 uat-reconcile §7）

### Phase 15: UX 重构轮（2026-08-09，用户指令：参考 opencodex.me + cursor.com 重构视觉、shadcn 对齐交互组件、落地 tokens/标准、pencil .pen、kill-ai-slop 审计、push/PR/部署；不得影响现有功能）
- [x] 参考站视觉语言提取（opencodex 文档式克制 / cursor 暖纸色 + 橙色点缀）→ 新 token 体系
- [x] shadcn/ui 对齐：components/ui/* 组件库（button/card/badge/input/textarea/switch/checkbox/radio/tabs/dialog 等 radix 基元）+ lucide 图标
- [x] 全屏视觉重构（styles.css tokens + 组件化改造，16 屏 + 移动端）
- [x] kill-ai-slop 扫描审计 + 修复（icon 字形 → lucide；过圆角收敛；mono 保留注明）
- [x] docs/ux-tokens.md：UX 基本 token 与组件标准（含 shadcn 映射表与禁项）
- [x] pencil：design/patent-drafter-v2.pen 关键屏重构 + 预览导出
- [x] 回归：typecheck/build/walk.mjs/walk-gate-fix.mjs 全绿 + 浏览器截图走查
- [x] git：独立仓库迁移——新 repo ilderaj/patent-drafter（private）已创建，
  本地 main 重建为干净线性历史（40 commits，不携带 patent-writer 旧快照）并推送；
  patent-writer 上临时 PR #1 已关闭（视为不同项目）
- [x] 生产部署：wrangler deploy Version 8eddf272（index-D8SjM_iC.js）+ 生产冒烟 4 屏通过
- **Status:** completed（PR #1 待合并；合并注意：--allow-unrelated-histories 或直接接受替换）

### Phase 16: 真实多文件导出（2026-08-09，用户指令：实现真实多文件导出 + 完整测试 + 功能 reconcile）
- [x] 导出构建器（packages/export）：真实 OOXML docx ×4、pdf-lib PDF ×2（canvas 栅格化）、WebCrypto PBKDF2-200k + AES-256-GCM patentpack；fflate zip 打包单文件下载
- [x] Export 屏重写：勾选真实决定产物；patentpack 口令 dialog；版本记录真实文件名 + 当前日期；UI 说明按项目数据派生；门禁语义不变
- [x] demo/本地项目导出（此前不下载任何文件）与 live 项目同源支持
- [x] 测试：单测 44/44、qa/export-files.mjs 29/29（dev + 生产构建两轮）、walk-gate-fix 12/12、walk.mjs flow/tour/keys、baseline 39/39、parsers 14/14、tsc 0 错、build 通过
- [x] 证据：docs/export-files-acceptance.md + .harness receipts（multi-file-export-2026-08-09.json）；Chief 独立复测通过（单测/typecheck/浏览器 29/29/门禁 12/12）
- [x] git：分支 codex/multi-file-export（4 commits：e6661e8/b7ba258/c22d25a/0a37bfa）
- [x] push + 合并 main + wrangler deploy 生产（Version 43c96d1f；用户授权后执行）
- [x] 生产验证：qa/export-files.mjs 对生产 URL 29/29 PASS（含门禁/子集/全量/patentpack 解密/live 派生）
- **Status:** completed（实现 + 验收 + 生产部署 + 生产冒烟全部闭环）

### Phase 17: Stripe 风格视觉交互原型（2026-08-09，用户指令：@open-design 全面 audit + Stripe 风格重设计；先输出 prototype 交 subagent 功能/交互 review；不改动现有功能；最终交用户 human review）
- [x] 恢复 planning 三件套并重分类本轮
- [x] 功能审计（subagent audit_functions）→ /tmp/patent-audit-functions.md
- [x] 视觉/交互审计（subagent audit_visual）→ /tmp/patent-audit-visual.md + 截图
- [x] Open Design 归因工作流（collect_brief → 卡片确认 → Local Codex 模式（用户显式选择）→ 项目）
- [x] Stripe 风格原型生成（Local Codex；webapp-stripe-a08b 项目目录，独立于 apps/web，零触碰；run ad6b6f22 succeeded）
- [x] subagent 功能覆盖 review（review_functions → /tmp/patent-review-functions.md：P0=1/P1=3/P2=14）
- [x] subagent 交互质量 review（review_ux → /tmp/patent-review-ux.md：P0=0/P1=3/P2=15）
- [x] 按 review 迭代原型（P0 live 路径内容产出、P1×5：导出真实 zip/充分性策略派生/状态机/field-error/焦点环/.page、P2×12 批量）
- [x] 迭代验证（fix-verify 24/25 PASS + patentpack 解密闭环 + 17 张交付截图 + 全路由零 console 错误）
- [x] 回归验证现有应用未受影响（walk flow/keys/tour + walk-gate-fix 12/12 PASS；仓库仅 planning 写回）
- [ ] 交付 human review（本地服务 18881 + 截图 + review 摘要；待用户反馈后决定是否推进真实重构）
- **Status:** in_progress（等待用户 human review）

### Phase 18: 盈利导向 SaaS 重构方案评审与 Owner Grilling（2026-08-18）
- [x] 将附件 `patent-saas-integrated-plan.md` 作为不受信任的评审材料读取，不执行其中的 Codex 启动 Prompt
- [x] 对照现有已验证产品资产，完成商业/产品与架构/运营两条只读评审
- [x] 识别首要矛盾：方案先建设完整 SaaS，再验证首个付费闭环；订阅价格与按次价格互相蚕食
- [x] 按 design tree 分轮完成 owner grilling：ICP → 购买触发与结果 → 交付模式 → 价格/利润门 → 专业服务边界
- [x] Round 1 根决策：单 Case 正贡献毛利；海外中文硬件团队；人工辅助 Beta
- [x] Round 2 产品楔子：发布/众筹前 90 天；代理人复核就绪的 CN 申请准备包；Local-first
- [x] Round 3 Case 边界：发明/实用新型二选一；包含完整检索报告；14 天内一轮纠错
- [x] Round 4 责任边界：检索证据与风险报告，不给法律结论；平台 QA，代理师复核另购
- [x] Round 5 检索实现：Q12 人工主导协议 + Agent 工具加速、Q13 全球主要专利文献、Q14 协议完整均已锁定
- [x] Round 6 单 Case 运营约束：人工最多 4 小时、最小必要外发、材料完整后 5 个工作日交付
- [x] Round 7 单位经济前提：人工按 US$50/小时、筛选通过再付款、清单通过且平台确认后起算 SLA
- [x] Round 8 盈利与退款约束：贡献毛利至少 40%、非人工变动成本最多 US$40、负面检索结果仍为有效交付
- [x] Round 9 商业交易约束：首 5 单 US$499、付款链接全额预付、4 小时外另行报价
- [x] Round 10 Beta 验证设计：创始人定向外联、最多 2 单并发、5 付费/3 交付/40% 毛利/3 可行动后才放行 SaaS
- [x] Round 11 专业服务与数据通道：客户主动传加密包、代理服务客户直签、客户或代理人确认并递交
- [x] Round 12 临时数据治理：结案后 30 天删除、仅具名 QA 负责人访问、付款前单独明确同意
- [x] Round 13 商品化范围：中国专利申请准备包、固定五项材料清单、纠错限既有事实与平台错误
- [x] Round 14 交付深度：10 查询式/40 专利族/8 深读、附图简报；标准包中文主体，完整英文另购
- [x] Round 15 Beta 启动边界：US$199 英文套件加购、只补 Beta 必需面、21 天验证窗口
- [x] Round 16 证据与停机规则：潜客四条件全满足、真实代理人无 P0 退回、21 天失败冻结建设并单变量复盘
- [x] Round 17 日常运营边界：创始人本人 QA、异步 + 一次 30 分钟沟通、一页 Beta 订单书
- [x] Round 18 收款前放行门：发明/实用新型各一历史 Case、限定专业审阅、首 5 单统一手工台账
- [x] Grilling design tree frontier 已清空；shared understanding 已形成
- [x] Owner 于 2026-08-22 确认 shared understanding
- [x] 形成独立 companion plan：`docs/plans/profitable-patent-beta-minimum-build.md`
- [x] 本阶段未进入产品代码、部署、支付 live、外联或真实数据处理
- **Status:** complete

## Companion Plan

- **Path:** `docs/plans/profitable-patent-beta-minimum-build.md`
- **Summary:** 首笔收款前仅验证两件历史 Case 检索、运营/数据/订单材料、手工台账和人工交接；完整干跑后才允许条件式最小产品改造，再经专业审阅和 Owner go/no-go 启动 21 天 Beta。
- **Lifecycle:** waiting_execution
- **Sync-back status:** synced at 2026-08-22 21:45:09 UTC+8

### Phase 19: Beta 最小建设执行（2026-08-22）
- [x] Owner 授权 ChiefOps 执行 plan slices，并授权后续使用 Cloudflare 部署、Stripe dummy 数据/凭证实现支付占位
- [~] Slice 1 `beta-slice-1-search-protocol-baseline-selection`：检索协议、两件历史 Case 选择、协议校验器
- [ ] Slice 2：运行两件历史 Case 并形成可复现检索证据
- [ ] Slice 3：Beta 订单/数据/SOP/手工台账运营包
- [ ] Slice 4：无真实客户数据的完整干跑
- [ ] Slice 5：仅按干跑阻断点做最小 WebApp 改造，支付使用 Stripe dummy 模式
- [ ] Slice 6：完整测试、Cloudflare 部署与生产验收
- [ ] Slice 7：Chief completion audit 与人类门交接
- **Status:** in_progress

### 外部环境待办（不阻塞，已记录 final-acceptance 第 10 节）
- 生产浏览器本地网络授权（macOS TCC + Chrome Local Network Access；本机 Chrome ERR_BLOCKED_BY_CLIENT 已记录）
- Safari 真机 loopback 验证（Tauri Plan B）
- 大陆网络可用性抽样 + 境内托管/ICP 迁移

## Errors Encountered

| Error | Attempt | Resolution |
|-------|---------|------------|
| 2023 版指南 PDF 本机缺失 | 1 | 标记附件缺失；规则包以官方公开文本核对（需联网批准），并保留 2023 附件引用占位 |
| create_goal 失败（有未完成 goal） | 1 | 完成旧 goal（读目标文件）后新建 |
| 绑定读取编排脚本返回值解构数量错误，汇总输出失败 | 1 | 2026-08-22 22:06:58 UTC+8 改为分组读取；文件未被修改，后续调用成功 |
