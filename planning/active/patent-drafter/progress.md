# Progress: 专利申请WebApp开发

## Session: 2026-08-06 22:34:29 UTC+8

### 已完成
- 环境盘点：工作区非 git、附件 2/3 在 docs/examples、PDF 缺失、pencil MCP 可用。
- 读取 chiefops + planning-with-files skill。
- 通读两份 DOC 附件并提取结构观察（见 findings.md）。
- 建立本 planning trio；创建 /tmp 转换文本（textutil）。

### 进行中
- Phase 6 完成：design/patent-drafter.pen 已建（22 顶层节点、16 屏 + 2 移动端、5 组件），17 张预览导出至 design/previews/，snapshot_layout 无问题。
- Phase 7: 汇报并等待设计批准。

### 待办
- 用户设计批准后进入实现阶段（apps/web + apps/bridge 等）。
- git init 待批准（沙箱 .git 权限受限）。
- CNIPA 官方文本核对需联网（规则包 2026-01-01 版本）。
- Safari loopback 真机验证。

## Session: 2026-08-06 23:xx UTC+8（批准前补充轮）

### 已完成
- fixtures/sanitized/：README + 3 个脱敏 JSON（claims-graph / problems / spec-structure），python3 json 校验通过。
- packages/domain/：核心领域模型 TypeScript 类型，tsc 5.9.3 --noEmit 通过。
- packages/rules-cn/：README + 2023-baseline 4 个 JSON（common/invention/claims/utility-model）+ 2026-01-01 placeholder。
- packages/prompts/：README + version.json + system-core + 11 个阶段 prompt 草稿。
- packages/providers/：LLMProvider 契约骨架（getCapabilities/listModels/generateStructured/streamText/cancel + capability flags + DeepSeekLocalBridgeProvider/CodexLocalProvider 占位），tsc 通过。
- packages/audit/：确定性审校引擎骨架（RulePack/CheckRegistry/支持矩阵/审计报告），tsc 通过（paths 指向 @patent/domain）。
- packages/shared/：Result/newId/sha256Hex/versioning/invariant 无依赖工具，tsc 通过。
- 全部包 typecheck：npx 会误装 tsc 包，改用本机缓存的 typescript@5.9.3 二进制验证，4 包 0 错误。

### 决策
- 骨架期无根 package.json/workspaces；跨包导入用 tsconfig paths 保离线 typecheck，正式构建时改 workspace 依赖。
- .harness/ 为 runtime 钩子状态，不纳入版本库（.gitignore + rm --cached）。

### 待办
- git add + commit 本轮新文件（需升级权限）。
- 最终汇报：展示 .pen 与 2-3 张预览，等待设计批准。

## Session: 2026-08-06 23:xx UTC+8（goal 延续·证据核验轮）

### 已完成（本轮全部为 live 证据，非 README 转述）
- 交付物清单核验：docs/ 9 篇齐全（product-spec 含需求修正表、architecture ADR-001~009、threat-model T1-T13、baseline-analysis 五段结构）。
- .pen 完整性：JSON 可解析，22 顶层节点，16 屏 + 2 移动端 + 5 组件 ID 全部存在，17 张预览 PNG 齐全。
- 无泄漏核验：git ls-files 无 fixtures/private、无 .doc、无 sk- 密钥模式；git grep 无密钥串。
- Spike 实跑：
  - bridge-loopback-spike：`node bridge_server.mjs` 自检实跑——evil origin 403 / 白名单 PNA preflight 204 / 白名单 POST 200 带 token，全通过。
  - deepseek-spike：`node provider_contract.mjs` → SPIKE_C_PASS（含 schema 拒收坏输出）。
  - rules-spike：`node rules_check.mjs` → 32 passed / 0 failed，ALL PASS。
  - parser-spike：textutil 实转 private/.doc → 16,289 字节文本，抽检到"（蓝牙/射频卡/470无线）"标题括注、系统/产品摇摆、NB 混杂等 baseline 观察点。

### 状态
- 第一阶段全部交付 + 汇报已发出（上轮），本轮补强证据后仍处于**等待用户设计批准**（强制门，不代用户关闭）。
- 批准后待办不变：apps/web + apps/bridge 实现、Safari 真机 loopback、CNIPA 2026 联网核对、境内可达性实测。

## Session: 2026-08-06 23:xx UTC+8（goal 延续·CNIPA 2026 联网核对轮）

### 已完成
- 网络连通性确认：CNIPA（200）、npm registry（200）可达，之前的"网络受限"假设已失效。
- CNIPA 2025 修改《专利审查指南》核对完成（多源官方证据）：
  - 决定名称：《国家知识产权局关于修改〈专利审查指南〉的决定》，局令第八十四号；
  - 2025-09-18 第 5 次局务会议审议通过，2025-11-10 公布（申长雨签署），2026-01-01 施行；
  - 三大修改方向：首设"人工智能、大数据"专章（伦理审查 / AI 申请文件披露撰写要求 / 创造性案例化）、比特流专章、植物品种客体；
  - 来源：国家知识产权战略网 nipso.cn、广德市人民政府转载官方说明、中国新闻网 2025-11-28 CNIPA 发布会报道、央视新闻（钛媒体转引）。
- packages/rules-cn/2026-01-01/：placeholder.json → ai-related.json（AI-INV-001/002、AI-DISC-001、AI-ETH-001、AI-EXAM-001，含 meta 来源与核对范围），README 更新核对记录；JSON 校验通过。
- docs/rules-mapping.md 与 packages/rules-cn/README.md 待办更新：元数据核对完成，逐条全文（精确节号）仍待决定全文。
- packages/prompts/system-core.md 追加 2026 AI 专章约束锚点。

### 决策
- 比特流、植物品种修改超出 MVP 支持领域，仅在 meta.outOfMvpScope 记录排除，不建规则。
- 逐条修改文本来源（微信/CNIPA PDF）需验证码，标记为后续轮次待办，不在本轮硬啃。

### 待办
- git add + commit 本轮变更。
- 等待设计批准（不变）。

## Session: 2026-08-06 23:xx UTC+8（goal 延续·中文 OCR 验证轮）

### 已完成
- 之前"沙箱受限需真机验证"的 macOS Vision 中文 OCR 现已实测通过（当前环境 danger-full-access）：
  - 生成含中文的测试图（AppKit 渲染"共享热水表 三模通讯 蓝牙mesh 470无线 NB-IoT"）；
  - `vision_ocr.swift`（zh-Hans）识别全部命中，conf≈0.50；NB-IoT 误识为 NB-loT（大小写易混淆，已知怪癖）；
  - 语言参数化已验证：默认 `zh-Hans,en-US` 生效；仅 `en-US` 时中文返回空（符合预期）。
- spikes/parser-spike/vision_ocr.swift 增加可选语言参数；README 更新结论（中文 OCR 已验证，去掉"需真机验证"）。

### 待办
- git add + commit。
- 等待设计批准（不变）。

## Session: 2026-08-06 23:xx UTC+8（实现阶段启动轮——用户已批准设计）

### 用户批准
- 2026-08-06："认可视觉设计。主要要确保交互流程顺畅、人类友好。" → 强制设计门通过，进入 Phase 8+ 实现。

### 已完成（Phase 8 全部 + Phase 9 大部分 + Phase 10 大部分）
- apps/web 脚手架：Vite 6 + React 19 + TS + react-router（base /patent/），npm workspaces + vite alias 接入 @patent/domain/shared。
- 设计令牌落 CSS 变量（.pen variables 全量：primary #FF8400、背景 #F2F3F0、圆角 16、间距体系、light/dark）。
- AppShell（232px 侧边栏：项目/规则与规范/模型与隐私 + Bridge 状态）+ 全部路由（16 屏 + 2 移动端）。
- 本地仓储：localStorage（非敏感 UI 状态），demo 项目并入 projects 列表（可持久化、可删除）。
- 屏实现（文案与 .pen 逐字对齐）：首页/新建/上传/充分性/Intake(4题步进)/策略确认/三栏工作台/附图中心/审校矩阵/导出(含 unsupported 门禁)/历史/设置/规则/无Bridge/配对/移动首页/移动工作台。
- Mock 管线驱动：新建→上传→解析→充分性→Intake→策略→工作台全流程走通。
- 浏览器实测（in-app Browser + Playwright DOM 断言）：全部核心屏渲染正确；导出在存在无来源特征时正确拦截并给出"去处理"路径；刷新后项目持久化保留。
- 生产构建通过：vite build 285KB JS（gzip 89KB），67 模块。

### 修复记录
- 嵌套 <Routes> 在父路由下空渲染 → 路由扁平化 + ProjectDetail 按 pathname 段分发。
- demo 项目从独立 state 改为并入 projects（否则刷新丢失/直接 URL 访问 404）。
- 子屏直接 URL 访问（/figures 等）找不到项目 → 全部改用 projects.find(id)。
- npx tsc 误装 tsc@2.0.4 → 固定使用 ~/.npm/_npx/952f9bf55a4c6785/.../typescript/bin/tsc。

### 证据
- qa/screens/*.png（11 张浏览器截图：工作台/附图/审校/导出/设置/无Bridge/配对/历史/规则/移动端）。
- dev server: http://localhost:5173/patent/（会话内保持运行）。

### 待办（下一轮）
- 键盘导航/可访问性基础检查；导出按钮"生成导出包"的完成态体验；设置页删除数据确认流。
- Phase 12 逐屏视觉比对（截图与 .pen 预览同屏对比受 vision 限制，采用 DOM+令牌比对）；Phase 13 验收报告。

## Session: 2026-08-06 23:xx UTC+8（goal 延续·parsers/export 骨架轮）

### 已完成
- packages/parsers/：解析契约骨架（ParseLimits/DEFAULT_LIMITS、Parser、ParseRejection 含 ZIP bomb/宏/路径穿越拒绝原因、OcrEngine、OCR 术语归一化 normalizeOcrText——由 spike B 实测驱动）。
- packages/export/：导出契约骨架（ExportManifest、evaluateExportGate 硬门禁：unsupported/blocking 拒绝导出、PatentPackVault .patentpack 接口）。
- 推荐仓库结构中 packages/* 现已全部落位：domain / rules-cn / prompts / providers / audit / shared / parsers / export。
- 6 包 tsc 5.9.3 --noEmit 全部 0 错误（parsers 走 paths → domain/shared；export 走 paths → domain/audit）。

### 待办
- git add + commit。
- 等待设计批准（不变）。

### 决策日志
- 任务 ID：patent-drafter；单 authority root = `/Users/jared/Personal Projects/Patent`。
- 附件策略：原始 DOC 移入 fixtures/private/（gitignore），docs/examples 保留引用或移除；生成脱敏结构化 fixture 于 fixtures/sanitized/。
- Spike A 结论：Chrome 150 HTTPS→loopback fetch 可用；保留 PNA 头防御；Safari 待真机验证；Tauri 为 Plan B。
- Spike B 结论：soffice/textutil 转 .doc；macOS OCR 优先 Vision（沙箱内受限需真机验证）；tesseract 需 chi_sim。
- Spike C 结论：LLMProvider 契约 + Mock 验证通过（SPIKE_C_PASS）。
- Spike D 结论：32 项确定性规则检查全 PASS；规则需精确表达（多项引用规则修正案例）。

## Session: 2026-08-06 23:xx UTC+8（交互走查与打磨轮——用户强调"交互流畅、人类友好"）

### 本轮定位
- 用户批准设计并强调交互重点后，以浏览器实测驱动交互打磨：修复真实断点，验证键盘全链路。
- 走查工具：qa/walk.mjs（playwright-core 1.60 + ms-playwright chromium-1234 本机缓存，headless），REPL 内 tab.playwright 桥本会话不可用，改独立进程。

### 实测发现并修复（7 项）
1. **审校页死胡同**：Audit 默认"支持矩阵"标签下无任何导航操作（回到工作台/去导出仅在其余标签内渲染）→ 操作行移出标签条件，任何标签下均可前进/返回。
2. **首页死按钮**："浏览示例项目"导航到不存在的 /demo 路由（被 `*` 兜底到 Home，点击无效）→ 移除，保留空态"载入示例项目（热水表）"。
3. **门禁与审校数据源不一致**：导出门禁只查 project.audit（仅 demo 项目有），用户新建项目审校屏显示 1 错误但导出不拦截 → 抽出 DEMO_AUDIT 单一数据源，Audit 屏与 Export 门禁共用；实测用户新建项目导出被正确拦截（blocked-by-audit: true）。
4. **Intake 末题按钮语义**：最后一题仍显示"下一个问题"→ 改为"完成补充，查看策略"（新增 isLast prop）。
5. **无障碍标签**：上传 file input、工作台权利要求 textarea 无标签 → 补 aria-label（a11y 巡检全绿）。
6. **键盘可达性**：无按钮/链接 focus-visible 样式 → 补全局 `:focus-visible` 焦点环（--primary）；RadioCard 本身是 button 原生可聚焦。
7. **favicon 404**：浏览器自动请求 /favicon.ico 404 → index.html 内联 SVG data URI favicon；控制台实测 0 错误 0 404。
8. **设置页无效跳转**：删除数据后 `location.hash="#/projects"` 对 BrowserRouter 无效 → 改 pathname 跳转。

### 键盘全链路实测（qa/walk.mjs keys，全部通过）
- /new：标题自动聚焦；Tab 顺序 标题→专利类型卡片→…→下一步；Enter 提交进入上传页。
- Intake：Tab→Space 选择选项→Tab 到操作钮→Enter，4 题全通（含末题"完成补充，查看策略"）。
- Strategy：Tab 到确认勾选（label 文本不可聚焦，需按 checkbox 定位）→Space 勾选→Enter 确认，进入工作台。
- focus-visible 焦点环补上后键盘用户可定位焦点。

### 回归验证
- flow 全路径（含新用户创建项目→导出门禁→去处理→历史）控制台 clean；typecheck + vite build 通过（284.59 kB / gzip 89.50 kB）。
- tour 巡检：demo 工作台/附图/审校/导出/历史/规则/无Bridge/移动端（390px）全部渲染正常，新截图 qa/screens/walk-*.png 与 walk-demo-*.png。

### 待办（Phase 13）
- 安全验收 12 项需 Bridge 实现后逐项取证（当前为 mock 前端里程碑，Key 路径/配对/CORS 等证据依赖 apps/bridge）。
- baseline 验收对账（交底样例 → 生成结果 vs 定稿结构）。
- 清理 spike 与调试文件；最终报告。
