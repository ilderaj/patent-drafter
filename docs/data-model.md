# 数据模型

## 1. 核心实体

```ts
PatentProject {
  id: string; title: string; patentType: "utility_model" | "invention";
  status: PipelineStage; createdAt/updatedAt: ISO;
  rulePackVersion: string; promptVersion: string;
}

SourceAsset {           // 原始上传材料
  id; projectId; fileName; fileType; sizeBytes; sha256;
  storageRef;           // Bridge Vault 内加密路径
  parseStatus: "pending" | "ok" | "partial" | "failed";
  pageCount?; ocrNeeded: boolean;
}

SourceChunk {           // 解析后的最小引用单元
  id; assetId; chunkIndex; kind: "paragraph" | "table" | "image" | "ocr_page";
  text?; page?; tableRect?; imageRect?; ocrConfidence?; contentHash;
}

SourceRef {             // 事实/文本 → 来源
  id; chunkId; assetId; start?; end?; page?; quote?;
}

Fact {
  id; projectId; category: "subject" | "structure" | "comm_scheme" | "effect" | "parameter" | "material";
  statement; status: FactStatus;   // source_backed | user_confirmed | external_context | unsupported
  refs: SourceRef[]; conflicts: FactConflict[];
  patentTypeHint?; claims: ClaimFeature[];
}

FactConflict { id; factAId; factBId; kind: "subject_swing" | "scheme_contradiction" | "numeral_mismatch" | "term_mismatch" | "noise_suspect"; detail; resolved: boolean }

IntakeQuestion { id; projectId; kind: "missing" | "contradiction" | "parameter_source" | "scope" | "figure";
  factId?; question; options?; required: boolean; status: "pending" | "answered" | "skipped" }
UserAnswer { id; questionId; answer; refs?; answeredAt; evidenceNote? }

PatentStrategy {
  id; projectId; patentType; protectionCore: string[]; claimStrategy: ClaimStrategyPlan;
  exclusions: string[]; riskNotes: string[];
}

Claim {
  id; projectId; number: number; independent: boolean; parentId?; claimText; status;
  features: ClaimFeature[]; refs: SourceRef[]; // 每条特征可溯源
}
ClaimFeature { id; claimId; featureText; factId?; status: FactStatus }

DraftSection {
  id; projectId; section: "title" | "technical_field" | "background" | "summary" | "figures_desc" | "embodiments" | "abstract";
  content; status; refs: SourceRef[]; generatedBy: GenerationRun;
}

FigureSpec {
  id; projectId; figureNo: number; kind: "block_diagram" | "flowchart" | "topology" | "state_diagram"
    | "mechanical" | "circuit" | "structure";
  title; contentNodes: string[]; numerals: ReferenceNumeral[];
  generationMode: "auto" | "drawing_brief"; status: "spec" | "confirmed" | "generated" | "user_uploaded";
}
ReferenceNumeral { id; numeral: string; label: string; usedIn: ("claims"|"spec"|"figure")[]; status: "consistent" | "mismatch" }

AuditFinding {
  id; projectId; ruleId; severity: "error" | "warning" | "info";
  message; remediation; scope: "claims"|"spec"|"abstract"|"figures"|"cross"|"formal";
  status: "open" | "accepted" | "fixed"; refs: SourceRef[];
}

Snapshot {
  id; projectId; version; createdAt; kind: "auto" | "manual" | "export";
  claims: Claim[]; sections: DraftSection[]; figures: FigureSpec[]; findings: AuditFinding[];
  meta: { provider; model; promptVersion; rulePackVersion };
}

GenerationRun {
  id; projectId; stage: PipelineStage; provider; model; promptVersion; rulePackVersion;
  inputHash; outputHash; status: "running" | "ok" | "cancelled" | "failed"; errorKind?; cost?;
}
```

## 2. 事实状态机

```text
                ┌─────────────┐
                │  unsupported │◄──── 任何无来源断言
                └──────┬──────┘
                       │ intake 确认/补充
                       ▼
  材料解析 ──► source_backed ──► user_confirmed ──► 可进入生成
                       │
                       └──► external_context（仅参考，禁止写入权利要求/发明事实）
```

- 硬规则：`unsupported` 禁止进入最终导出；`external_context` 不自动成为发明特征。
- 用户可显式将 unsupported 标记为 user_confirmed（记录 evidenceNote）。

## 3. 起草管线阶段与依赖

| 阶段 | 输入 | 输出 | 缓存键 |
|------|------|------|--------|
| ingest_sources | 文件 | SourceChunk[] | assetHash |
| extract_invention_facts | chunks | Fact[] | chunkHash |
| detect_conflicts | facts | FactConflict[] | factHash |
| assess_readiness | facts+conflicts | readiness 报告 | — |
| generate_intake_questions | gaps/conflicts | IntakeQuestion[] | factHash |
| merge_user_confirmations | facts+answers | 更新后的 Fact[] | answerHash |
| build_invention_model | facts | 发明模型（主题/结构/通讯方案/参数） | factHash |
| recommend_patent_type | model | 类型建议 | modelHash |
| propose_claim_strategy | model | PatentStrategy | modelHash |
| draft_claim_skeleton | strategy | 权利要求骨架 | strategyHash |
| draft_claims | skeleton+facts | Claim[] | skeletonHash |
| draft_specification | claims+facts | DraftSection[] | claimsHash |
| generate_figure_specs | claims+spec | FigureSpec[] | claimsHash+specHash |
| draft_abstract | spec+claims | 摘要 | specHash |
| audit_support | all | AuditFinding[] (support) | contentHash |
| audit_consistency | all | AuditFinding[] (consistency) | contentHash |
| audit_formal_rules | all | AuditFinding[] (formal) | contentHash |
| export | all | 文件包 | snapshotHash |

## 4. 数据隔离

- Web 浏览器：仅非敏感 UI 状态（Dexie）+ 短期配对 token（内存/sessionStorage）。
- Bridge Vault：加密存储材料/项目/快照；SQLite 存索引（正文加密）。
- Keychain：API Key（不落盘明文）。
- .patentpack：加密项目包（导出/导入，含元数据与快照）。
