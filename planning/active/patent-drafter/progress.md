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
