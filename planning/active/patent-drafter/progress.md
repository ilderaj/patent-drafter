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

## Session: 2026-08-07（Phase 13 前半：baseline 验收 + Bridge 骨架）

### 已完成 1：baseline 验收对账（39/39 PASS）
- demo 生成输出落成单一事实源 fixtures/sanitized/demo-generated.json（10 条权利要求树、五段式说明书、6 图、摘要、审校摘要、Intake 问题），apps/web data.ts 直接导入（tsconfig resolveJsonModule），"应用看到的"与"验收验证的"同一份数据。
- 工作台段落列表从 claims 派生（此前硬编码 1/2/3），权9 带"!无来源"标记 + 红色编号。
- qa/baseline-check.mjs 可执行验收：定稿夹具自检（REF-1~8）、权利要求结构（S-1~4）、核心特征覆盖 11/11（F-1~4）、支持关系与无来源门禁（A-1~6）、五段式（D-1~3）、附图 6 张与标记（G-1~4）、术语（T-1~2）、P1-P8 问题回归（P-1~8）——39/39 通过，输出 qa/baseline-report.json + docs/baseline-acceptance.md。

### 已完成 2：apps/bridge Rust 骨架（安全验收载体）
- Cargo 单 crate（axum 0.8 + tokio + reqwest/rustls + security-framework(macOS) + async-trait）。
- 能力：127.0.0.1-only 绑定；Origin 严格白名单（vibing.paymond.me + localhost:5173）；OPTIONS 预检含 PNA（Access-Control-Allow-Private-Network）；一次性配对码（5min、存哈希）；32B 会话 token（30min、存哈希、可撤销）；Keychain 凭据（macOS GenericPassword，含 Mock 存储用于 CI）；DeepSeek provider（Key 从凭据存储取，错误只报状态不报正文）；MockProvider（PATENT_BRIDGE_MOCK=1，CI 无真实 Key）；无正文诊断日志（method/path/status/ms/rid）。
- 13 项集成测试全绿：恶意源 403、缺 Origin 403、允许源 200+CORS、PNA 预检 204、配对换会话、配对码一次性、受保护路由 401、凭据往返无明文泄漏、mock chat、会话撤销、无通配 CORS、token 过期、日志无 Key/正文。
- 真实进程冒烟（PATENT_BRIDGE_MOCK=1）：healthz 200 / evil 403 / 配对→token / status 200 / 无 token 401 / chat 200 / 日志内容干净。
- 提交：ce8a190（bridge）、24e3f26（baseline）。

### 决策
- Bridge 安全验收逐步推进：本骨架覆盖 qa-plan 第 1/3/5/6/7/9/12 项的核心证据；第 2/4 项（Key 不出现在浏览器→Worker 请求、专利文件不经过 Worker）属部署层验证，需 Worker 部署后抓包取证；第 8 项（每次模型发送可预览）为 Web 层功能，已有设置开关，待 Bridge 真导出联调；第 10/11 项（Prompt Injection/恶意附件）依赖解析器与管线，parsers 包已含拒绝原因，待管线集成测试。

### 待办
- Phase 13 剩余：清理 spike 调试文件；安全验收逐项证据汇总；最终报告（含大陆可达性与 Safari 真机待办说明）。

## Session: 2026-08-07（Phase 13 收尾：最终报告 + spike 清理）

### 已完成
- 最终验收报告 docs/final-acceptance.md：结论、12 项交付物清单（11 个提交）、需求修正清单、SPIKE_A~D 结果、ADR-001~009、T1-T13、规则包结构、功能验收（8 处修复+键盘全链路）、Baseline 39/39、安全验收 9/12 已有证据、4 项外部门交接条件、复现命令。
- 清理 spikes/ 目录（bridge-loopback/deepseek/parser/rules 四组调试文件；结论已并入报告第 4 节；git 历史可恢复）。
- 最终证据复核：bridge cargo test 13/13、web tsc OK、baseline 39/39、工作树干净。
- 提交：9480eb1。

### 交接条件（需外部授权/环境，记录于 final-acceptance.md 第 10 节）
1. Worker 部署 + 抓包复证安全验收第 2/3/4 项（需用户 Cloudflare 授权）。
2. Safari 真机 loopback 验证（Chrome 150 已过；Tauri Plan B）。
3. 大陆网络可用性抽样 + 境内托管/ICP 迁移。
4. Bridge 预览确认步骤联调 + 18 阶段管线注入/恶意附件测试集（安全验收第 8/10/11 项）。

### 本地范围结论
- 第一阶段目标（需求修正/baseline/架构/威胁模型/规则包/spikes/.pen/设计批准）已全部达成并有证据；批准后实现（web 全屏、Mock 管线、bridge 骨架、baseline 对账、交互打磨）已验收。

## Session: 2026-08-07（Phase 13 收尾补证轮：安全验收 10/12 + 最终报告定稿）

### 已完成
- 安全验收补证（提交 02f1a53）：
  - packages/parsers/src/guard.ts 恶意附件防护：TOO_LARGE / ZIP_BOMB（压缩比）/ PATH_TRAVERSAL / MACRO_OR_SCRIPT_DETECTED（OLE2 VBA、vbaProject.bin、HTML script/事件）；`node qa/parsers-guard-tests.mjs` → 14/14 PASS。
  - Bridge 发送预览强制门：chat 路由要求 `x-preview-confirm` = 载荷 SHA-256（canonical_request），未确认返回 428 + 预览与 requiredConfirm；chat_requires_preview_confirm_before_send / chat_rejects_wrong_preview_hash 两项测试。
  - 注入防线证据：system-core.md「材料内容为不可信数据」约束 + 防护层拒绝注入型 HTML 载荷（管线级完整测试集仍待联调）。
- cargo test 实际为 **14 passed**（此前记录的 13 为旧数，以实际为准）；docs/final-acceptance.md 与 docs/security-acceptance-evidence.md 数字已统一修正为 14。
- docs/final-acceptance.md 更新：安全验收 10/12 已有本地证据（2/3/4 项待部署）；提交清单补 02f1a53 / 9480eb1。
- apps/bridge/README.md 补写：安全模型、构建/运行、API 表、Mock 冒烟示例（含预览门 428 流程）、测试说明；web 侧真实 bridge 客户端标注为联调阶段（当前 Mock 管线）。

### 证据复核（本轮实际执行）
- `cd apps/bridge && cargo test` → tests/security.rs 14 passed。
- `node qa/parsers-guard-tests.mjs` → 14 通过 / 0 失败。
- 工作树清理后提交本轮变更。

### 待办（外部交接条件，记录于 final-acceptance.md 第 10 节）
1. Worker 部署 + 抓包复证安全验收第 2/3/4 项（需 Cloudflare 授权）。
2. Safari 真机 loopback 验证（Chrome 150 已过；Tauri Plan B）。
3. 大陆网络可用性抽样 + 境内托管/ICP 迁移文档。
4. 18 阶段管线注入/恶意附件测试集 + 真实 DeepSeek 端到端联调（Bridge 预览门与 parsers 防护已就绪）。

### 本地范围结论
- 本地可验证交付全部完成：需求修正、baseline、ADR、威胁模型、规则包、4 个 spike、.pen 设计（已批准）、web 全屏实现、交互走查、baseline 39/39、安全本地证据 10/12、最终验收报告。

## Session: 2026-08-07（真实联调 + Cloudflare 部署 + 生产验证轮）

### 已完成 1：web 真实 Bridge 桥接 + 全链路走查（提交 1f3b45d）
- apps/web 真实管线：bridge.ts（配对/会话/凭据状态，dev proxy 同源）、pipeline.ts（浏览器 18 阶段 runner + 内联 prompt 包）、live-view.ts（ctx→Project 派生）、store startLive/answerLiveIntake/runLiveTo。
- 屏：Upload 粘贴+开始真实起草、LiveIntake 一屏提交、Strategy live 分支、Settings 真实 Bridge 状态/配对、Export live .md 草案包下载。
- 修复：audit_formal_rules 独立 prompt（此前错误复用 audit-consistency.md）；blob 下载需 appendChild 后 click；策略确认后一次 runLiveTo("audit_formal_rules")（起草+审校一气呵成，1-4 分钟）。
- qa/walk-live.mjs 真实 DeepSeek 全链路 **20/20 PASS**：真实审校 findings support=8 / consistency=6 / formal=16、errors=21 → 导出门禁正确拦截并给"去处理"路径；截图 qa/screens/live-*.png。

### 已完成 2：Cloudflare Worker 部署（提交 5307ce5）
- wrangler.jsonc：纯 Static Assets（无 main/binding），assets=apps/web/dist，not_found_handling=single-page-application，routes vibing.paymond.me/patent + /patent/*（zone paymond.me）。
- 构建布局：vite outDir=dist/patent（base=/patent/），build 脚本复制 SPA fallback 副本 dist/index.html + dist/_headers；_headers 严格 CSP（connect-src 仅 'self'+127.0.0.1:7878）+ nosniff + DENY + no-referrer + assets 不可变缓存。
- 已部署：worker patent-drafter，version cbadb2b1；生产实测 /patent/ 200+CSP、/patent 307、SPA fallback 200、assets immutable。
- 域名根路径既有服务（matters 307）未受影响。

### 已完成 3：安全验收第 2/3/4 项生产抓包复证（12/12）
- qa/prod-network-evidence.mjs 真实浏览器访问生产 URL：请求主机仅 vibing.paymond.me（3 静态资源）、无 api.deepseek.com、无 sk- 匹配、bridge 尝试仅 127.0.0.1:7878 → 4/4 PASS。

### 已完成 4：生产前端全流程验证（提交 5eb54f4）
- 用户 Chrome 走查生产 URL：demo 工作台（10 条权利要求+无来源标记）、审校（38/3/1 + 一致性标签）、导出门禁拦截+去处理、历史、规则页全部正常；截图 qa/screens/prod-*.png。

### 结论（外部环境事项，不阻塞）
- 生产环境浏览器直连 127.0.0.1:7878 需两层授权：macOS 本地网络权限 + Chrome Local Network Access（本机 Chrome 现返回 ERR_BLOCKED_BY_CLIENT，in-app Browser 无 TCC 权限）；授权后与开发走同一代码路径。首次引导文案已在 Settings。
- Safari 真机 loopback、大陆可达性抽样仍为外部环境待办（final-acceptance 第 10 节已记录）。
- 真实 LLM 全链路（20/20）在开发环境完成（同一前端代码，差异仅 bridge 端点）。

### 提交
1f3b45d（web 桥接+全链路）→ 5307ce5（Worker 部署）→ 5eb54f4（生产验证+文档）

## Session: 2026-08-07（云端化可行性分析轮——待用户决策）

### 背景
- 用户反馈 Bridge + API Key 对朋友用户门槛过高（生产 URL 直连 loopback 被 Chrome PNA 拦截，in-app Browser 无 TCC 权限），提出改为云端持 Key + 密码门禁，仅分析不实施。

### 分析结论（已在对话中交付，未实施）
- 可行且改动面小：现有部署已是 Cloudflare Worker（纯静态），前端经 provider 抽象层；升级为带计算 Worker（wrangler secret 存 DeepSeek Key + `/api/providers/deepseek/chat` 路由 + 密码校验 + 频率限制），前端 bridge.ts 加云端同源模式。预览确认门语义可从 Rust bridge 移植到 Worker。
- 门禁两选项：共享密码（零配置，泄露=任何人可烧余额，换密码需逐个通知）vs Cloudflare Access 免费档（邮箱 OTP、按人撤销、有审计，推荐）。
- 安全模型降级点：Key 信任根从 macOS Keychain 变为 Cloudflare 账号（需 2FA）；「材料不经过任何服务器」承诺失效（privacy-boundaries.md 与设置页文案须改）；新增风险「密码泄露刷余额」以 Worker 频率限制 + DeepSeek 硬额度 + 无正文日志三道闸约束。
- 可保边界：朋友项目数据仍在各自浏览器 localStorage，云端不落专利内容；Key 不进浏览器（T1 不破）。
- 工作量预估：Phase 14 规模（Worker 计算路由 + 前端云端模式 + threat-model/privacy-boundaries/deployment 三文档改写 + 安全测试移植）。

### 状态
- 等待用户决策：方向（云端化与否）+ 门禁方式（共享密码 / Cloudflare Access）。决策后开工。

## Session: 2026-08-07（LLM provider 切换轮：OpenCode Go DeepSeek V4 Flash）
- 用户提供 OpenCode Go key，要求把云端 Worker 的 LLM provider 从 DeepSeek 官方 API 切到 OpenCode Go 的 deepseek-v4-flash。
- 完成：Worker 默认端点/模型切换（env 可覆盖）、providers 包默认模型、cloud.test.mjs 断言更新、.dev.vars 更新、前端 demo 历史文案同步；apps/worker 测试 13/13 全绿；providers typecheck 0 错；apps/web build 通过；上游真实调用验证（node/curl，json_object 可用）。
- 本地 wrangler dev 冒烟：healthz 200、错误密码 401、正确密码 200、预览门 428 正常；确认后 502 系 workerd 本地出站被拦（已知限制）。
- 待部署（需用户确认）：wrangler secret put DEEPSEEK_API_KEY（新 key）/ACCESS_PASSWORD/SESSION_SECRET → wrangler deploy → 生产验证解锁+起草真实链路。

## Session: 2026-08-07（生产部署 + 全链路验证轮）
- 部署：wrangler secret put（DEEPSEEK_API_KEY=OpenCode Go key / ACCESS_PASSWORD=ZYq1prvg5oVfuZ / SESSION_SECRET）→ wrangler deploy version 2941ed6d。
- 生产验证（真实浏览器 + curl）：
  - 密码门：healthz 200、错误密码 401、正确密码 200 + 12h sessionToken；登录限速 429 实测（每 IP 每小时 10 次）。
  - 预览确认门：428→200 交替，7 次请求 body 字节一致（hash 绑定可靠）。
  - 真实管线：extract_invention_facts → conflict → sufficiency → intake questions 四阶段全部 schema-valid，90s 到 intake 屏（deepseek-v4-flash）。
  - 附件双通道：生产实测 txt（102 字）、docx（57 字）、pdf（79 字）提取 + 与粘贴文本合并计数。
- 修复：Worker fetch bind（Illegal invocation）；pdfjs v6 destroy→cleanup + useSystemFonts + isEvalSupported=false；docs 三件套（deployment/privacy-boundaries/threat-model）同步云端模式。
- 剩余：qa/walk-cloud-prod.mjs 作为生产走查脚本保留；intake 之后的完整 18 阶段起草可在真实使用中验证（每阶段 1-4 分钟）。

## Session: 2026-08-07 20:30-21:30 UTC+8（生产事故分析轮——只读，未改生产）

### 用户报告
- 生产环境起草报错：「起草失败：[draft_claim_skeleton] stage failed: Failed to fetch」（截图，声纹认证专利，OCR 确认）。

### 已完成（全部只读 + 少量上游直连测速）
- OCR 读取截图（macOS Vision，spikes 已清理故用临时 swift stdin 脚本）。
- 生产健康检查：站点 200、healthz/login 正常；线上 bundle 与本地 HEAD 一致（API 下载激活版本 2941ed6d 比对）。
- KV 权威计数（Cloudflare API 直读）：chat:2026-08-07 = **70 > 60** → 当前所有 chat 请求 429（今日已达上限）。
  - wrangler CLI 读取返回过期缓存 "8"，已确认不可信；后续一律用 API 读。
- "Failed to fetch" 根因定位：skeleton = 管线最大提示词（完整发明模型+策略+schema）；上游推理模型实测
  50KB→13.5s、100KB（49,032 tokens）→ **TTFB 72.7s**（6,267 reasoning tokens，无 max_tokens）；长等待期间浏览器↔边缘连接被掐断。
- 排除项：CPU 超限（512KB 体 <1ms 实测）、墙钟时长（官方无限制）、CSP、413、502（均干净响应，非连接级失败）。
- 配额消耗结构：13 LLM 阶段 × 2（预览+确认）= 26 次/完整起草；部署风暴期（17:46-18:08 共 10 次部署）验证 + 用户重试耗尽 60/天。
- 用户晚间未重新 login（登录键仅有本机探测 IP），复用早上 12h 会话，与计数爬升不矛盾。

### 状态
- 生产当前"全 429 阻塞"；恢复选项：重置计数 / 提高限额 / 等 UTC 零点（08:00 CST）。
- 修复方向（未实施，待用户确认）：客户端超时+重试、max_tokens 或非推理模型、SSE 流式、精简 skeleton 输入、预览门可选。

## Session: 2026-08-07 21:30-23:00 UTC+8（生产事故修复实施轮——用户批准"全部实施+调高限额"）

### 已完成并部署（Version a49a0b02, 2026-08-07T15:1xZ）
- **立即解阻**：KV `chat:2026-08-07` 70→0（Cloudflare API PUT，权威路径）；生产 chat 即刻恢复。
- **限额调高**：RATE_LIMIT_PER_DAY 60→300（验证期；完整起草 26 次/轮，60 只够一次+重试）。wrangler.jsonc vars + 部署。
- **预览门开关**：PREVIEW_GATE_ENABLED=false（验证期）。关闭后单发直达上游（省一半配额与延迟）；恢复基线置 true。
- **SSE 流式**：Worker 透传上游 SSE（stream:true 时 content-type text/event-stream）；provider 流式消费（readSseContent 解析 delta.content，忽略 reasoning）。
- **Provider 加固**：单发自动降级（428 时回退 prepareSend+sendConfirmed）、连接级失败重试 1 次、240s 超时（AbortController）、max_tokens=16000。
- **walk-cloud-prod.mjs**：密码硬编码移除 → PATENT_CLOUD_PASSWORD 环境变量（缺省报错退出）。历史 commit 中仍存在旧密码，建议后续 rotate。
- **文档**：docs/deployment.md 增"验证期放宽配置"小节。
- **测试**：apps/worker 15/15 全绿（新增 preview-gate-off 直通 + SSE 透传两例）；providers/pipeline/web typecheck 0 错；web build 通过。

### 生产验证（部署后实测）
- healthz 200；login 200；**单发 chat（无 confirm 头）200 直达上游**（首次 428 系部署传播延迟，重试即 200）。
- 流式 chat 200，SSE 透传正常（data: [DONE] + usage 块）。
- **50KB 提示词流式：首字节 2.55s、总 114.5s、1.8MB SSE**（对比非流式 TTFB 13.5s/72.7s）——连接全程活跃，Failed to fetch 根因消除。
- 计数：重置后 4 次（428 1 + 单发 1 + 流式小 1 + 流式大 1），300/天上限下余量充足。

### 备注
- skeleton 输入复核：buildInventionModel 输出本身已精简（仅 statement，无 refs/quote），无需额外裁剪。
- git：commit 88e7bcc（worker/providers/qa/docs/wrangler）+ 本轮 planning 更新。

## Session: 2026-08-08（生产导出门禁死胡同修复轮）

### 用户报告
- 生产导出被拦：「审校门禁：存在无来源特征（插卡槽水通路）。正式申请文件导出已被阻止，请先在工作台确认来源或删除该特征。」

### 根因
- 门禁文案承诺的"工作台确认来源/删除特征"在 UI 上不存在（全应用无 none→user 交互）→ demo/任何有审校 error 的项目导出永久死锁。
- `project.audit ?? DEMO_AUDIT` 把热水表 demo 的 errors=1 与特征名套到所有无审校数据项目上（12 节修复的副作用）。

### 已完成（浏览器实测 12/12 + baseline 39/39 + parsers 14/14 + build 通过）
- store `confirmClaimSource`：本地项目联动 claims.sources + audit.rows/errors；live 项目改 ctx features 状态 + 过滤对应 error findings 后重派生（不篡改 LLM 原始输出）。
- Workbench 选中无来源 claim 显示「确认来源」按钮；Audit 支持矩阵行内同款按钮；audit 为空显示"暂无审校结果"空态。
- Export 移除 demo fallback（无审校不拦）；门禁文案动态列出实际无来源特征名。
- demo-generated.json rows 补 claimId（c1/c1/c5/c9），live-view 派生同步带 claimId。
- qa/walk-gate-fix.mjs 新增回归脚本（12/12）；console 仅剩 dev proxy 探测噪声（bridge/worker 未运行，环境性）。

### 待办
- [x] wrangler deploy 生产（version a6589276，commit 4f8f76e）；生产验证 4/4 PASS：门禁仍拦截 → 工作台「确认来源」按钮出现 → 标签变「用户确认」→ 导出放行；pageerrors none。

### 追加（存量数据兜底 + 边缘缓存刷新）
- 隐患：用户生产 localStorage 里已存的 demo 项目是旧结构（audit rows 无 claimId），确认来源联动不上 → 补充文本子串匹配兜底（fuzzyHit：特征名窗口 ≥3 字命中 claim 文本，覆盖"插卡槽的下端设有…水通路"式改写）。dev 旧数据模拟 4/4 PASS。
- 重新部署（version 809450f8，commit 见 git log）：dist hash CCz-xmZw；首次 deploy 后 /patent/ HTML 被边缘缓存为旧版（cf-cache-status HIT 旧 ETag），无可用 purge token（wrangler OAuth/Keychain token 均无 API 权限），再次 deploy 后边缘刷新（新 hash 生效）。
- 生产最终验证 7/7：新 bundle 引用 + 新数据门禁闭环 4/4 + 旧数据兜底 3/3；pageerrors none。

## Session: 2026-08-08（工作台显示与交互修复轮）

### 用户报告（截图 OCR：真实 live 项目工作台）
- 段落编号 "ive-claim-1"、标题恒"权利要求 1（独立）"、实时检查全是热水表 demo 硬编码；询问段落/说明如何修改。

### 已完成（修复 6 项 + 缓存根治，浏览器验证 15/15 + 门禁回归 12/12）
- 编号从 label 提取（demo/live 均 1..N）；标题随选中联动；实时检查 audit.checks 驱动 + 空态；大纲 done 动态化；saveClaimText 让 live 编辑写回 ctx 并修正文案；live 确认来源标签加"（用户确认）"。
- _headers：/patent/* Cache-Control no-cache → no-store，根治边缘 HTML 缓存陈旧（实测生效）。
- 部署生产 version d90d3a17（bundle BlpIBS4P）；生产验证 5/5；截图 qa/screens/wb-fixed-demo*.png、prod-wb-fixed.png。

## Session: 2026-08-08（门禁空括号根因 + 性能优化 + 完整 UAT 轮）

### 用户报告
- 生产导出再次被拦：「审校门禁：存在无来源特征（插卡槽水通路）」——
  用户生产环境用自己的交底书（声纹专利）真实复现；并要求完整 UAT 与功能 reconcile、
  性能提速 ≥50%。

### 完成（全部生产实测）
- **空括号根因**：真实交底全管线 dump（claims=10、errors=10 全为一致性/形式类、
  noneClaims=[]）→ noneFeatures 空数组 join 出空括号；demo fallback 误伤已在上轮修掉，
  本轮补文案回退 + 归类修正。
- **修复部署**：Export 文案回退「存在 N 项必须处理的审校问题（如：…）」+「去处理」直达；
  Audit 一致性/形式 err 项「确认已处理」；生产验证 5/5（含 errors→0、导出放行）。
- **性能**：thinking 禁用 + runner 波次并行；同 prompt off 3.8s vs on 20.9s（-81.8%、
  SSE -88.6%）；全流程 133.8s 到工作台（旧基线 160-240s）。
- **UAT**：walk.mjs 全链路 / workbench 15/15 / gate-fix 12/12 / pipeline 10/10 /
  worker 15/15；本地 build hash 与线上 index-BTkYmV5l.js 一致。
- **文档**：docs/uat-reconcile-2026-08-08.md（清单/回归/性能对照/已知限制 §7）。

### 备注
- 首次生产走查偶发 intake 超时（609s），诊断轮 48s 即达、重跑全 PASS——上游长尾抖动。
- 本轮未 commit：worker thinking 透传、provider thinking off、runner 并行、
  web 门禁文案/确认已处理、qa/walk-cloud-full.mjs、docs/uat-reconcile、
  planning 三件套 → 下一步 git add + commit。
- 后续可选：max_tokens 16000→8000、prompt 精简（system-core/claim-skeleton）、
  前端 intake 失败重试 UI。

## Session: 2026-08-08 晚（用户真实项目第二轮生产验收 + checks 截断修复）

### 用户报告
- 用户再次报告「审校门禁：存在无来源特征（）」空括号；在侧边栏 browser 打开
  生产实例并上传自己的声纹认证专利交底书（项目 prj_KWc0sIzc），要求完整验证。

### 复现与验收（全程使用用户真实项目与数据，未注入 demo）
- 策略页点击「确认并起草」→ 起草+审校 ~65s 完成：claims=11、errors=3/warnings=8。
- 审校 dump：noneFeatures=[]（15 个特征全 source_backed；3 个 error 均一致性/形式类）
  → 导出页实测门禁文案为「存在 3 项必须处理的审校问题（如：附图说明声明本申请
  不包含附图但附图清单有 5 幅…）」——**无空括号**（用户看到的空括号为修复前旧版）。
- 闭环：去处理 → 形式规则 tab「确认已处理」×2 → errors 3→1→0 → 导出放行
  「✓ 已在本机生成导出包」。

### 附带缺陷修复（checks 截断）
- 发现：live-view 的 audit.checks 仅 slice(0,8) 渲染，第 9 条以后的 err 项最初
  无「确认已处理」按钮（实测确认前 2 个后第 3 个浮出，不死锁，但为稳妥修复）。
- 修复：checks 改为 err 优先排序后 slice(0,12)（sort 稳定，err 内部顺序不变）；
  门禁 errorChecks[0] 从此总能取到具体问题。
- 回归：walk-gate-fix 12/12 PASS、tsc 0 错、build 通过。
- 部署：Version 0977468a-4911-48fa-89bf-9e215718b679，线上 index-Dkv1hPmW.js；
  用户 tab 刷新后数据完整保留（claims=11、errors=0、rows=15）。

## Session: 2026-08-09（Phase 15 UX 重构轮完成）

### 本轮定位
- 用户指令：参考 opencodex.me/zh-cn + cursor.com 重构 WebApp 前端视觉；所有交互
  组件按 shadcn/ui 标准化对齐重构；重构内容落地为本项目 UX token 与标准；pencil
  落地 .pen；kill-ai-slop 审计去 slop；完成 push/PR/生产部署；不改变现有功能。

### 已完成
- **参考站视觉提取**（headless Chromium 截图 + CSS 提取）：两站收敛于
  「暖纸色 + 炭墨 + 橙/金单点缀 + 小圆角 + 发丝边框 + 药丸按钮」。
- **新令牌体系**：背景 #F2F3F0（绿灰）→ #F7F6F2（暖纸色）、墨色 #1b1915、
  品牌橙 #FF8400 保留、圆角 16→12/8、发丝边框 + 微阴影、衬线 display 标题
  （Iowan/Palatino/Georgia/Songti SC）、明暗双主题全套。
- **shadcn 对齐组件库**：components/ui/*.tsx（Button variant×size×asChild、
  Card 组合、Badge variants、Input/Textarea/Label、radix Switch/Checkbox/
  RadioGroup/Tabs/Dialog/Separator/Progress/Skeleton、Field/Notice/PageHeader/
  EmptyState）+ lucide 图标全量替换字形图标。依赖新增 12 个标准包，
  bundle gzip 155KB（+46KB）。
- **Settings 删除确认**：双击确认 → radix Dialog（ADR-UX-004）。
- **kill-ai-slop**：初始 3 组 10 命中 → 图标组清零；剩余功能性圆形/mono/
  链接下划线逐项确认保留；dialog overlay blur 移除。
- **docs/ux-tokens.md**：令牌表（明/暗）、组件契约、shadcn 映射表、
  ADR-UX-001~004、禁项清单、维护检查。
- **pencil v2**：design/patent-drafter-v2.pen（4 屏：项目首页/三栏工作台/
  审校矩阵/导出）+ design/v2-previews/v2-overview.png（pencil CLI 0.3.2，
  codex agent，QA 通过）。
- **回归**：tsc 0 错；build 通过（index-D8SjM_iC.js）；walk flow/keys/tour 全通；
  walk-gate-fix 12/12 PASS；新版截图 qa/screens/ux-*.png 视觉检查通过。
- **git**：main → codex/ux-refactor（5 commits）→ 因远端 main（2026-06 旧快照）
  无共同祖先，GitHub 拒绝 PR → 改 codex/ux-replace（以 origin/main 为基底、
  完整替换树，255 增/230 删）→ PR #1 已开
  （https://github.com/ilderaj/patent-writer/pull/1）。
- **生产部署**：wrangler deploy Version 8eddf272（index-D8SjM_iC.js），
  生产冒烟 4 屏通过（首页/工作台/审校/设置/规则，控制台仅 CF beacon 噪声）。

### 决策记录
- 不引入 Tailwind（ADR-UX-001）：shadcn 对齐落在 API/令牌/无障碍契约层，
  避免 16 屏 + 键盘链路 + 门禁流程的迁移回归风险。
- 远端历史处理：远程 main 为 2026-06 旧快照（51 commits），与本地权威实现
  （33 commits）无共同祖先；PR #1 以替换树方式呈现完整实现，原历史保留。

### 待办（外部）
- 仓库迁移确认：新 repo ilderaj/patent-drafter（private）承接本项目；
  patent-writer 视为不同项目（其上临时 PR #1 已关闭）。
- 后续可选：Tailwind 化（契约已就绪）、bundle 拆包（告警 500KB 阈值）。

## Session: 2026-08-09（仓库迁移轮：独立 repo）

### 已完成
- 用户指令：新开 GitHub repo 承接本地 WebApp 项目，与 patent-writer 视为不同项目。
- 新建私有 repo **ilderaj/patent-drafter**（https://github.com/ilderaj/patent-drafter）。
- 本地 main 重建为干净线性历史（40 commits：33 原始 + 5 UX 重构 + planning 收尾 +
  prod 截图；不含 patent-writer 2026-06 旧快照与合并残留），与已部署树一致
  （clean-main vs codex/ux-replace 仅多 4 张生产截图）。
- origin 重指向 https://github.com/ilderaj/patent-drafter.git，main 已推送
  （远端 HEAD = 4a03de6）。
- patent-writer 上临时 PR #1 已关闭（附迁移说明注释）。
- 本地 main-legacy 分支保留（含旧合并历史，可随时删除）。

### 状态
- 仓库现状：ilderaj/patent-drafter（private，main = 当前生产实现全量历史）；
  生产部署不受影响（Version 8eddf272 已在线）。

## Session: 2026-08-09（用户提问轮：生产导出包形态取证）

### 问题
- 用户问：导出的"草案包"在生产环境只是一个 md 文件吗？附带生产导出页截图
  （7 个可选文件：DOCX 合集/权利要求书/说明书/说明书摘要/附图 PDF/审阅报告 PDF/
  patentpack）与本机下载的 test2-草案包.md。

### 取证结论（全部现场证据）
- **是，生产实际导出产物 = 单一 md 文件**：apps/web/src/screens/Export.tsx 仅有一个
  下载分支（live 项目），`new Blob(...)` + `text/markdown;charset=utf-8`，文件名
  `${项目名}-草案包.md`，内容 = 权利要求书 + 说明书五段 + 说明书摘要。
- 线上 bundle 复证：生产 index-D8SjM_iC.js（Version 8eddf272）全 bundle 仅
  **1 处 Blob + 1 处 createObjectURL + 1 处 草案包.md**；`.docx`/`.pdf`/
  patentpack 字符串只出现在文件列表 UI 标签，无任何生成代码。
- 勾选状态仅用于：①门禁判断（anyFormal + audit.errors>0 拦截）；②版本记录
  note「导出：N 个文件」（与真实产物不符，文案虚报数量）。
- 非 live 项目（demo/本地）：点击生成只显示完成态，**不下载任何文件**。
- packages/export 仅类型骨架（ExportManifest/PatentPackVault 接口），DOCX/PDF/
  patentpack 生成为设计目标形态（.pen/架构承诺），第一阶段未实现。

### 待办（未实施，等待用户决策）
- 若需与 UI 承诺一致：实现真实多文件导出（DOCX/PDF/patentpack）或收敛 UI 文案为
  "导出 md 草案包"；二选一后更新 ux-tokens/验收文档。

## Session: 2026-08-09（ChiefOps 轮：真实多文件导出——swf_executor 执行 + 验收）

### 用户指令
- 用户裁决第一轮结论：实现真实多文件导出，要求完整测试 + 验证 + 功能 reconcile；
  指定 $chiefops 主 session + @swf_executor 可见 worker（worker 可自用 subagent）。

### Chief 派发（Assignment Packet）
- 绑定哈希：task_plan 4c91a905 / findings 07e0d7a0 / progress b3bf49ab / HEAD 360a23c
  （worker 动工前核验一致，无 binding_mismatch）。
- 切片边界：packages/export + apps/web Export 屏 + qa + docs；禁 push/部署/planning
  写回；门禁与隐私语义不得变。

### Worker 执行结果（candidate done，receipt 落盘）
- 变更：packages/export/src 8 个新模块 + tests 293 行；apps/web Export.tsx 重写 +
  export-render.ts；qa/export-files.mjs 292 行；docs/export-files-acceptance.md；
  4 commits（e6661e8/b7ba258/c22d25a/0a37bfa，分支 codex/multi-file-export）。
- 单测 44/44；export-files 29/29 ×2（dev + 生产构建 preview）；walk-gate-fix 12/12；
  walk.mjs flow/tour/keys 0；baseline 39/39；parsers 14/14；tsc 0；build 通过。
- bundle：155.12 → 343.64 kB gzip（+189 kB，pdf-lib；动态导入未拆异步 chunk 已如实记录）。

### Chief 独立验收（全部实测）
- ★ 单测 44/44 复跑；★ typecheck 0 错；★ qa/export-files.mjs 对生产构建 preview
  (4173) 复跑 29/29；★ walk-gate-fix 12/12 复跑（console 502/500 为既知 dev-proxy
  探测噪声）；代码抽查：patentpack PBKDF2-200k+AES-GCM 信封无明文、门禁语义保留、
  版本记录真实文件名、导出路径无网络调用。
- 验收结论：**ACCEPT**。

### 规划写回（Chief）
- task_plan.md：新增 Phase 16（completed，部署待授权）；Current Phase 更新。
- findings.md：新增 2026-08-09 多文件导出记录（实现/测试/限制）。

### 待办（人工门，等待用户授权）
- push codex/multi-file-export → 合并 main → wrangler deploy 生产 → 生产冒烟验证
  （建议顺带 rotate 旧生产密码事项仍挂账）。
