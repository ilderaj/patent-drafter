import type {
  AuditSummary,
  ClaimDraft,
  FigureItem,
  IntakeQuestion,
  Project,
  ReadinessDimension,
  SpecSection,
  Strategy,
} from "./types";

// 演示项目输出与 baseline 验收共用单一事实源（fixtures/sanitized/demo-generated.json）
import demoGenerated from "../../../../fixtures/sanitized/demo-generated.json";

export const TYPE_LABEL: Record<string, string> = {
  utility_model: "实用新型",
  invention: "发明专利",
  other: "其他",
};

export const TYPE_HINT: Record<string, string> = {
  utility_model: "面向产品结构、形状、构造。正式支持。",
  invention: "方法或产品均可。Beta 支持。",
  other: "化学、生物、医疗、PCT 暂不支持",
};

export function statusLabelOf(status: Project["status"]): string {
  switch (status) {
    case "new": return "新建";
    case "uploading": return "解析中";
    case "readiness": return "需补充材料";
    case "intake": return "补充信息中";
    case "strategy": return "待确认策略";
    case "drafting": return "起草中";
    case "auditing": return "审校中";
    case "ready": return "审校完成";
    case "needs_material": return "需补充材料";
  }
}

export const READINESS_DIMENSIONS: ReadinessDimension[] = [
  {
    name: "保护主题",
    status: "confirm",
    label: "需确认",
    note: "材料在「系统」与「热水表产品」之间摇摆，需确认保护对象",
  },
  {
    name: "通讯方案",
    status: "conflict",
    label: "发现矛盾",
    note: "NB-IoT 双模与蓝牙/470 三模描述冲突；混入电表网关内容（CAT.1/485）",
  },
  {
    name: "结构特征",
    status: "partial",
    label: "基本充分",
    note: "壳体、主板、插卡槽、阀门等结构有描述；尺寸参数 3 项需确认来源",
  },
  {
    name: "有益效果",
    status: "noise",
    label: "含宣传语",
    note: "“彻底摆脱网络依附”“尽显流行时尚”等断言将降级或剔除",
  },
];

export const INTAKE_QUESTIONS = demoGenerated.intakeQuestions as IntakeQuestion[];

export const DEMO_STRATEGY = demoGenerated.strategy as Strategy;
export const DEMO_CLAIMS = demoGenerated.claims as ClaimDraft[];
export const DEMO_SPEC = demoGenerated.specSections as SpecSection[];
export const DEMO_ABSTRACT = demoGenerated.abstractText;
/** 审校结果的默认/演示数据：Audit 屏与导出门禁共用同一来源，避免二者不一致。 */
export const DEMO_AUDIT = demoGenerated.audit as AuditSummary;
export const DEMO_FIGURES = demoGenerated.figures as FigureItem[];
export const DEMO_FIGURE_BRIEF = demoGenerated.figureBrief;

export function demoProject(): Project {
  return {
    id: "demo-hot-water-meter",
    name: "一种基于三模通讯的共享热水表",
    patentType: "utility_model",
    updatedAt: "2026-08-05 16:20",
    status: "ready",
    statusLabel: "审校完成",
    claimsCount: 10,
    files: [
      {
        id: "f1",
        name: "技术交底：一种基于三模通讯的共享热水表（冯立平） 2022.12.14.doc",
        kind: "DOC",
        sizeLabel: "450 KB",
        parseStatus: "done",
        detail: "已解析 12 页 · 提取文本 5,306 字",
      },
      {
        id: "f2",
        name: "结构示意图.png",
        kind: "PNG",
        sizeLabel: "1.2 MB",
        parseStatus: "ocr",
        detail: "OCR 识别中…",
      },
    ],
    coverage: 62,
    coverageNote: "已识别 14 项事实，其中 8 项有材料来源；需要补充 6 项才能进入起草。存在 3 处需要确认的矛盾。",
    dimensions: READINESS_DIMENSIONS,
    intakeNote: "当前材料不足以直接起草。系统将先通过 4 个问题补充信息并确认 3 处矛盾。",
    intakeQuestions: INTAKE_QUESTIONS,
    intakeAnswers: [
      { id: 1, choice: "保护热水表产品本体（实用新型更稳妥）", note: "主要保护热水表本体的三模通讯结构" },
      { id: 2, choice: "来自交底材料，可以写入" },
      { id: 3, choice: "以蓝牙mesh + 470 + 射频卡三模为准，剔除 NB 与电表网关内容" },
      { id: 4, choice: "属于本发明内容，可以写入" },
    ],
    strategy: DEMO_STRATEGY,
    strategyConfirmed: true,
    claims: DEMO_CLAIMS,
    specSections: DEMO_SPEC,
    abstractText: DEMO_ABSTRACT,
    figures: DEMO_FIGURES,
    figureBrief: DEMO_FIGURE_BRIEF,
    audit: DEMO_AUDIT,
    versions: [
      { version: "v5", note: "审校修正：术语统一、插卡槽水通路确认来源", meta: "2026-08-05 16:20 · deepseek-v4-flash · prompt v1.3 · 规则包 cnipa-2026-01-01" },
      { version: "v4", note: "摘要重写：去除宣传语，294 字", meta: "2026-08-05 15:02 · deepseek-v4-flash · prompt v1.2 · 规则包 cnipa-2026-01-01" },
      { version: "v3", note: "权利要求 4-10 从属树重排", meta: "2026-08-05 11:40 · deepseek-v4-flash · prompt v1.1 · 规则包 cnipa-2026-01-01" },
      { version: "v2", note: "初稿：权利要求骨架 + 说明书", meta: "2026-08-04 17:25 · deepseek-v4-flash · prompt v1.0 · 规则包 2023-baseline" },
      { version: "v1", note: "材料解析完成，事实提取", meta: "2026-08-04 10:05 · 本地解析 · 无模型调用" },
    ],
    demo: true,
  };
}

export function emptyProject(): Project {
  return {
    id: "",
    name: "",
    patentType: "utility_model",
    updatedAt: "",
    status: "new",
    statusLabel: "新建",
    files: [],
    coverage: 0,
    coverageNote: "",
    dimensions: [],
    intakeNote: "",
    intakeQuestions: [],
    intakeAnswers: [],
    strategyConfirmed: false,
    claims: [],
    specSections: [],
    abstractText: "",
    figures: [],
    figureBrief: "",
    versions: [],
  };
}
