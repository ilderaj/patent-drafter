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

### 决策日志
- 任务 ID：patent-drafter；单 authority root = `/Users/jared/Personal Projects/Patent`。
- 附件策略：原始 DOC 移入 fixtures/private/（gitignore），docs/examples 保留引用或移除；生成脱敏结构化 fixture 于 fixtures/sanitized/。
- Spike A 结论：Chrome 150 HTTPS→loopback fetch 可用；保留 PNA 头防御；Safari 待真机验证；Tauri 为 Plan B。
- Spike B 结论：soffice/textutil 转 .doc；macOS OCR 优先 Vision（沙箱内受限需真机验证）；tesseract 需 chi_sim。
- Spike C 结论：LLMProvider 契约 + Mock 验证通过（SPIKE_C_PASS）。
- Spike D 结论：32 项确定性规则检查全 PASS；规则需精确表达（多项引用规则修正案例）。
