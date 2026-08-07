// Canned outputs for every LLM stage — drives deterministic tests and the
// no-LLM demo path. Kept minimal but schema-valid.
import type { PipelineStage } from "@patent/domain";

export const MOCK_STAGE_OUTPUTS: Partial<Record<PipelineStage, unknown>> = {
  extract_invention_facts: {
    facts: [
      {
        id: "f1",
        category: "subject",
        statement: "一种基于三模通讯的共享热水表，包括计量部件与通讯模块",
        status: "source_backed",
        refs: [{ chunkId: "c1", page: 1, quote: "共享热水表" }],
        patentTypeHint: "utility_model",
      },
      {
        id: "f2",
        category: "structure",
        statement: "表体、计量部件、控制单元、三模通讯模块",
        status: "source_backed",
        refs: [{ chunkId: "c1", page: 1 }],
      },
      {
        id: "f3",
        category: "comm_scheme",
        statement: "蓝牙mesh、470MHz 无线、NB-IoT 三种通讯方式",
        status: "source_backed",
        refs: [{ chunkId: "c2", page: 2 }],
      },
      {
        id: "f4",
        category: "effect",
        statement: "集中抄表效率提升、通讯可靠",
        status: "source_backed",
        refs: [{ chunkId: "c3", page: 3 }],
      },
    ],
  },
  detect_conflicts: {
    conflicts: [
      { id: "k1", factAId: "f2", factBId: "f3", kind: "term_mismatch", detail: "NB 与 NB-IoT 表述混杂", resolved: false },
    ],
  },
  assess_readiness: {
    readiness: "partial",
    coverage: 0.8,
    dimensions: [
      { name: "subject", status: "ok", reason: "保护主题明确" },
      { name: "scheme", status: "ok", reason: "三模通讯方案完整" },
      { name: "parameter", status: "gap", reason: "部分参数缺少来源" },
    ],
    gaps: [{ id: "g1", kind: "missing", description: "通讯模块供电与安装结构未描述" }],
  },
  generate_intake_questions: {
    questions: [
      { id: "q1", kind: "missing", factId: "f2", question: "请补充通讯模块与表体的连接安装结构", required: true },
      { id: "q2", kind: "contradiction", factId: "f3", question: "NB 与 NB-IoT 是否为同一通讯方式？", options: ["是，统一为 NB-IoT", "否，是两种方式"], required: true },
    ],
  },
  propose_claim_strategy: {
    protectionCore: ["三模通讯模块及其切换机制"],
    dependentExtensions: ["供电方式", "远程升级"],
    exclusions: ["电表网关规格"],
    riskNotes: ["术语需统一"],
  },
  draft_claim_skeleton: {
    claims: [
      {
        number: 1,
        independent: true,
        parentRefs: [],
        features: [
          { text: "包括表体与计量部件", factId: "f2", status: "source_backed" },
          { text: "包括三模通讯模块", factId: "f3", status: "source_backed" },
        ],
      },
      {
        number: 2,
        independent: false,
        parentRefs: [1],
        features: [{ text: "供电单元", factId: "f2", status: "source_backed" }],
      },
    ],
  },
  draft_claims: {
    claims: [
      {
        number: 1,
        independent: true,
        parentRefs: [],
        text: "1、一种基于三模通讯的共享热水表，包括表体、计量部件与三模通讯模块，其特征在于，所述三模通讯模块支持蓝牙mesh、470MHz 无线与 NB-IoT 三种通讯方式。",
        features: [
          { text: "包括表体、计量部件", factId: "f2", status: "source_backed" },
          { text: "三模通讯模块", factId: "f3", status: "source_backed" },
        ],
      },
      {
        number: 2,
        independent: false,
        parentRefs: [1],
        text: "2、根据权利要求1所述的共享热水表，其特征在于，还包括为通讯模块供电的供电单元。",
        features: [{ text: "供电单元", factId: "f2", status: "source_backed" }],
      },
    ],
  },
  draft_specification: {
    sections: [
      { section: "technical_field", content: "本实用新型涉及热水计量技术领域，具体涉及一种共享热水表。", refs: [{ chunkId: "c1" }] },
      { section: "background", content: "现有共享热水表多依赖单一通讯方式，存在抄表困难的问题。", refs: [] },
      { section: "summary", content: "本实用新型提供三模通讯共享热水表，提高通讯可靠性。", refs: [{ chunkId: "c3" }] },
      { section: "figures_desc", content: "图1 为本实用新型整体结构示意图。", refs: [] },
      { section: "embodiments", content: "实施例中，三模通讯模块支持蓝牙mesh、470MHz 与 NB-IoT。", refs: [{ chunkId: "c2" }] },
    ],
  },
  generate_figure_specs: {
    figures: [{ kind: "block_diagram", title: "三模通讯模块连接框图", notes: "框图", refs: [{ chunkId: "c2" }] }],
    numerals: [{ numeral: "1", label: "表体", usedIn: ["claims", "spec", "figure"] }],
  },
  draft_abstract: { abstract: "本实用新型公开一种基于三模通讯的共享热水表…", abstractFigureNumeral: "1" },
  audit_support: { findings: [{ ruleId: "CLAIM-SUP-001", severity: "info", message: "全部特征有来源", remediation: "无需处理" }] },
  audit_consistency: { findings: [{ ruleId: "CONS-TERM-001", severity: "warning", message: "术语需统一为 NB-IoT", remediation: "统一术语" }] },
  audit_formal_rules: { findings: [{ ruleId: "FORM-NAME-001", severity: "info", message: "名称长度合规", remediation: "无需处理" }] },
};

export function mockPipelineContext(projectId = "demo", title = "一种基于三模通讯的共享热水表") {
  return {
    projectId,
    title,
    assets: [],
    chunks: [
      { id: "c1", assetId: "a1", chunkIndex: 0, kind: "paragraph" as const, text: "共享热水表，包括表体、计量部件与三模通讯模块。", page: 1, contentHash: "h1" },
      { id: "c2", assetId: "a1", chunkIndex: 1, kind: "paragraph" as const, text: "支持蓝牙mesh、470MHz 无线与 NB-IoT 三种通讯方式。", page: 2, contentHash: "h2" },
      { id: "c3", assetId: "a1", chunkIndex: 2, kind: "paragraph" as const, text: "集中抄表效率提升。", page: 3, contentHash: "h3" },
    ],
    userAnswers: {},
    results: {},
    rulePackVersion: "cnipa-2026-01-01",
    promptVersion: "0.1.0",
  };
}
