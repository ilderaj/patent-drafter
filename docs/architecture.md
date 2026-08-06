# 架构设计：专利申请文件起草助手

## 1. 总体架构

```text
┌─────────────────────────── 公网 ───────────────────────────┐
│  Cloudflare Worker Static Assets                            │
│  vibing.paymond.me/patent/*                                  │
│  仅分发 React SPA（无状态、无专利内容、无 Key）              │
└─────────────────────────── ▲ ──────────────────────────────┘
                               │ HTTPS
┌─────────────────────────── 用户本机 ────────────────────────┐
│  Web 浏览器（Chrome/Safari，PWA）                            │
│   ├─ SPA 状态：Dexie（仅非敏感 UI 状态）                     │
│   └─ HTTPS → https://127.0.0.1:PORT（一次性配对 + 短期 token）│
│                        │                                    │
│  Patent Bridge（本机进程，仅绑定 127.0.0.1）                 │
│   ├─ OS Keychain：DeepSeek API Key                          │
│   ├─ 加密本地 Vault：项目、材料、快照、历史                 │
│   ├─ 解析：DOC/DOCX/PDF/OCR/图片 → 分块 + 来源索引          │
│   ├─ Provider 抽象：DeepSeekLocalBridgeProvider（MVP）       │
│   ├─ 确定性规则引擎（rule pack 校验）                       │
│   └─ 导出：DOCX/PDF/SVG/.patentpack                          │
│                        │                                    │
│                        ▼                                    │
│              DeepSeek API（用户自己的 Key/额度）             │
└──────────────────────────────────────────────────────────────┘
```

## 2. 关键决策（ADR）

### ADR-001：浏览器不直接调用 LLM；本机 Bridge 是唯一 LLM 出口

- **状态**：已采纳（MVP 硬约束）。
- **理由**：DeepSeek 条款禁止浏览器暴露 API Key；浏览器存储易受 XSS/扩展攻击；本地解析/OCR/导出可避免材料上传。
- **推论**：Web 与 Bridge 之间必须实现配对 + 短期 session token + Origin 白名单 + CORS 收紧。

### ADR-002：Bridge 采用 Rust + Axum + SQLite + Keychain

- **状态**：已采纳（优先方案）；Phase 0 Spike A 验证 HTTPS Web → Loopback Bridge 在 Chrome/Safari 的可用性。
- **理由**：单二进制分发、内存安全、系统凭据库集成成熟（keyring crate）。
- **备选**：若 Loopback HTTPS 在主流浏览器不可靠，fallback 为 Tauri 包装（同一 React UI 作为功能客户端）；公网 Web 保留入口/介绍/安装引导。

### ADR-003：起草管线分 18 阶段，禁止一次性全文生成

- 每阶段独立 Prompt + 结构化 JSON + Zod 校验；记录 provider/model/promptVersion/rulePackVersion；结果缓存；下游失效才重生成；支持取消与流式状态；不静默覆盖用户编辑。
- 管线：ingest_sources → extract_invention_facts → detect_conflicts → assess_readiness → generate_intake_questions → merge_user_confirmations → build_invention_model → recommend_patent_type → propose_claim_strategy → draft_claim_skeleton → draft_claims → draft_specification → generate_figure_specs → draft_abstract → audit_support → audit_consistency → audit_formal_rules → export。

### ADR-004：事实状态机是证据链核心

```text
source_backed（有材料来源）
  → user_confirmed（用户确认/补充）
  → external_context（互联网补充，仅参考）
unsupported（无来源）
```

- 硬规则：unsupported 内容禁止进入最终导出文件；矛盾未解决时停止相应生成。
- 每段生成文本可溯源到 SourceChunk / UserAnswer / ExternalContext。

### ADR-005：规则采用版本化确定性规则包，不硬编码进 Prompt

- `packages/rules-cn/2023-baseline/` 与 `packages/rules-cn/2026-01-01/`。
- 每条规则含 ruleId/patentType/severity/deterministicCheck/sourceDocument/sourceSection/effectiveFrom/effectiveTo/userMessage/remediation。
- 规则校验走确定性代码 + LLM 复核双轨（LLM 不做唯一裁判）。

### ADR-006：Web 端仅存非敏感 UI 状态

- Dexie 仅存项目列表 UI 缓存、当前视图状态、非敏感设置；项目正文与材料由 Bridge Vault 管理。
- 清除浏览器数据 = 清除配对与 UI 状态，不删除 Keychain/Vault（提供独立"删除本机数据"功能）。

### ADR-007：互联网研究默认关闭、白名单化

- 流程：由已确认事实生成最少检索词 → 用户批准 → 仅查询允许列表 → 限制结果数 → 记录来源与日期 → 结果入 external_context → 不自动修改权利要求/事实。
- MVP 支持：用户输入专利号、粘贴对比文件、手工选择是否采用。不做泛搜索伪装的新颖性检索。

### ADR-008：附图自动生成仅限确定性格

- block diagram / flowchart / topology / simple state diagram 由 SVG/Mermaid/Graphviz 确定性生成。
- 先 FigureSpec（用户确认）再绘图；机械图/电路图/精确结构图输出 Drawing Brief 请用户上传；建立 reference numeral map 并三端一致性审核。

### ADR-009：Provider 抽象与模型发现

```ts
interface LLMProvider {
  getCapabilities(): Promise<ProviderCapabilities>;
  generateStructured<T>(req: StructuredRequest<T>, schema: ZodSchema<T>): Promise<T>;
  streamText(req: TextRequest): AsyncIterable<string>;
  cancel(requestId: string): Promise<void>;
}
```

- capability flags：structuredOutput / tools / visionInput / imageGeneration / longContext / localAuth。
- MVP：DeepSeekLocalBridgeProvider；预留 CodexLocalProvider / OpenAIApiProvider / LocalModelProvider（不实现）。
- 模型名称不硬编码：provider model discovery 或配置。

## 3. 仓库结构

```text
apps/
  web/        # React SPA（Vite + TanStack Router + shadcn + Zod + Dexie + PDF.js + PWA）
  bridge/     # Rust + Axum + SQLite + Keychain
packages/
  domain/     # 核心领域模型（TS 或 Rust 共享 schema）
  rules-cn/   # 版本化规则包
  prompts/    # system-core.md 等 13 个 Prompt
  providers/  # LLMProvider 抽象与 DeepSeek 实现
  parsers/    # DOC/DOCX/PDF/OCR 解析与来源定位
  audit/      # 支持矩阵/一致性/形式规则审校
  export/     # DOCX/PDF/SVG 导出与 .patentpack
  shared/     # 类型、常量、工具
design/
  patent-drafter.pen
docs/         # 本文档集
fixtures/
  private/    # 原始附件（gitignore）
  sanitized/  # 脱敏结构化 fixture
spikes/       # Phase 0 技术验证
```

## 4. Web 端技术要点

- React + TypeScript + Vite；Base Path `/patent/` 正确处理 `/patent`、`/patent/`、`/patent/projects/:id`、刷新、SW scope、静态资源路径。
- 不用 Google Fonts / 公共 CDN / 第三方行为分析；错误上报不含专利文本。
- CSP 收紧；PWA 离线壳。

## 5. Bridge 端职责

- Pairing（一次性配对码）→ session token（短期、有过期时间）→ Keychain 存取 Key → 加密 Vault → 文件解析/OCR/分块/来源索引 → DeepSeek 调用 → 导出 → 快照与项目包。
- 仅绑定 127.0.0.1；Origin 白名单（生产域名 + 本地开发域名）；CORS 不用 `*`。
- 提供：删除项目、删除 Key、导入/导出 .patentpack、自动锁定、临时会话模式（不保存 Key）。

## 6. 部署

- 生产：Cloudflare Worker Static Assets，route `vibing.paymond.me/patent*`；Worker 不存 Key/专利内容。
- Sites 仅用于原型/设计预览。
- 大陆可达性：不承诺免费 Cloudflare；提供境内托管 + ICP 迁移文档；真实大陆网络抽样验收。
