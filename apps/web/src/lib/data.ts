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

export const INTAKE_QUESTIONS: IntakeQuestion[] = [
  {
    id: 1,
    question: "保护主题确认：材料中既描述了「共享热水表系统」，也描述了「热水表本体」的结构。这次申请希望保护什么？",
    source: "依据材料：权利要求 1（系统）与具体实施方式（热水表本体）存在摇摆",
    options: [
      "保护热水表产品本体（实用新型更稳妥）",
      "保护包括网关与云端在内的完整系统",
      "不确定，请帮我分析两种方式的利弊",
    ],
    notePlaceholder: "例如：主要想保护热水表本体的三模通讯结构…",
  },
  {
    id: 2,
    question: "尺寸参数来源确认：热水表本体长度 87.9mm、宽度 75.23mm、固定位宽度 35.6mm 来自哪份材料？",
    source: "依据材料：具体实施方式中的数值未标注出处",
    options: [
      "来自交底材料，可以写入",
      "来自实物测量，需要补充记录",
      "暂不确定，先不在权利要求中限定",
    ],
    notePlaceholder: "例如：由实物样机实测，日期与记录人…",
  },
  {
    id: 3,
    question: "通讯制式确认：材料中「NB-IoT 双模」与「蓝牙mesh + 470 + 射频卡」并存，且混入电表网关（CAT.1/485）内容。以哪套为准？",
    source: "依据材料：摘要/权利要求为三模，实施方式出现 NB 双模与电表网关内容",
    options: [
      "以蓝牙mesh + 470 + 射频卡三模为准，剔除 NB 与电表网关内容",
      "以 NB-IoT 双模为准",
      "两种都需要保留（将按两个发明点拆分）",
    ],
    notePlaceholder: "例如：电表网关内容属于其他产品，应删除…",
  },
  {
    id: 4,
    question: "470 组网细节来源：材料中「470 无线组网」的描述是否属于本发明技术内容？",
    source: "依据材料：相关描述与 JMesh 协议资料接近，来源待确认",
    options: [
      "属于本发明内容，可以写入",
      "属于参考协议，不作为本发明的特征",
      "不确定，需要再确认",
    ],
    notePlaceholder: "例如：470 组网为本项目自研，协议细节…",
  },
];

export const DEMO_STRATEGY: Strategy = {
  type: "实用新型（产品型）",
  reason: "核心创新是三模通讯结构，属于产品形状/构造改进；材料充分性优先支撑实用新型",
  core: "热水表本体 + 控制主板 + 控制器 + 射频/蓝牙mesh/470 三模通讯模块及其连接关系",
  dependentChain: "网关连接方式 → 网关结构 → 主板插接 → 尺寸/固定位 → 插卡槽 → 手动阀门",
  risks: "尺寸参数（87.9mm 等）来源待确认；470 组网细节来自 JMesh 协议资料，需确认属于本发明内容",
  confirmText: "我确认以上保护策略，按此生成权利要求骨架",
};

export const DEMO_CLAIMS: ClaimDraft[] = [
  {
    id: "c1",
    label: "权利要求 1（独立）",
    text: "1、一种基于三模通讯的共享热水表，包括热水表本体，其特征在于，所述热水表本体内设有控制主板，所述控制主板上集成有用于控制热水用水的控制器以及与所述控制器连接的射频通信模块、热水表蓝牙通信模块以及热水表470通信模块，所述控制器通过所述射频通信模块与射频卡片通信连接；所述热水表蓝牙通信模块用于与相邻热水表及网关组建蓝牙mesh网络；所述热水表470通信模块用于与所述网关进行微功率无线470通讯连接；所述网关接入云端，所述云端与远程控制器通信连接。",
    sources: [
      { label: "材料原文 p.3", kind: "source" },
      { label: "用户确认", kind: "user" },
      { label: "无来源", kind: "none" },
    ],
  },
  {
    id: "c2",
    label: "权利要求 2（从属）",
    text: "2、根据权利要求1所述的共享热水表，其特征在于，所述网关通过 WiFi 或 4G 网络与所述云端通信连接。",
    sources: [{ label: "材料原文 p.4", kind: "source" }],
  },
  {
    id: "c3",
    label: "权利要求 3（从属）",
    text: "3、根据权利要求1所述的共享热水表，其特征在于，所述网关包括网关本体，所述网关本体内设有网关控制器及与所述网关控制器连接的网关470通讯模块和网关蓝牙mesh通讯模块。",
    sources: [{ label: "材料原文 p.4", kind: "source" }],
  },
];

export const DEMO_SPEC: SpecSection[] = [
  {
    id: "s1",
    title: "技术领域",
    body: "本实用新型涉及智慧水表技术领域，具体涉及一种基于三模通讯的共享热水表。",
  },
  {
    id: "s2",
    title: "背景技术",
    body: "现有共享热水表多依赖单一通讯制式，存在网络覆盖依赖、实时性差与刷卡安全等问题。",
  },
  {
    id: "s3",
    title: "实用新型内容",
    body: "本实用新型的目的在于提供一种基于三模通讯的共享热水表，通过射频/蓝牙mesh/470三模通讯结构解决单模依赖网络、实时性差的问题。",
  },
  {
    id: "s4",
    title: "附图说明",
    body: "图1为系统结构图；图2为外部结构图；图3为主控板电路连接框图；图4为蓝牙模块电路原理图；图5为470模块电路原理图；图6为射频模块电路原理图。",
  },
  {
    id: "s5",
    title: "具体实施方式",
    body: "如图1所示，一种基于三模通讯的共享热水表，包括热水表本体1，热水表本体内设有控制主板，控制主板上集成有控制器、射频通信模块、蓝牙通信模块及470通信模块……",
  },
];

export const DEMO_ABSTRACT =
  "本实用新型公开了一种基于三模通讯的共享热水表，涉及智慧水表技术领域。该热水表包括热水表本体，本体内设有控制主板，主板上集成控制器及射频、蓝牙mesh、470三模通信模块；本地可通过射频卡或蓝牙用水，470微功率无线用于连接网关，网关经WiFi/4G接入云端，实现远程控制。本实用新型通过三模通讯结构，兼顾本地刷卡可靠性与远程实时控制，通讯稳定，使用可靠。（294字）";

/** 审校结果的默认/演示数据：Audit 屏与导出门禁共用同一来源，避免二者不一致。 */
export const DEMO_AUDIT: AuditSummary = {
  passed: 38,
  warnings: 3,
  errors: 1,
  rows: [
    { feature: "控制主板集成控制器与三通信模块", status: "source", source: "交底 · 定稿 p.1", position: "权1 / 实施方式" },
    { feature: "蓝牙mesh 自组网（控制器/远程控制器/网关）", status: "source", source: "交底 · 摘要", position: "权1 / 摘要" },
    { feature: "长度 87.9mm、宽度 75.23mm", status: "user", source: "Intake 回答 #2", position: "权5 / 实施例" },
    { feature: "插卡槽下端水通路", status: "none", source: "—", position: "权9" },
  ],
  checks: [
    { icon: "ok", text: "特征与来源匹配" },
    { icon: "ok", text: "引用关系合法" },
    { icon: "warn", text: "术语「智慧网关/智能网关」不一致" },
    { icon: "ok", text: "摘要 294 字（≤300）" },
  ],
};

export const DEMO_FIGURES: FigureItem[] = [
  { id: "f1", title: "图1 系统结构图", mode: "auto", badge: "自动生成 · 已确认", previewLabel: "系统结构框图" },
  { id: "f2", title: "图2 外部结构图", mode: "brief", badge: "需上传 · Drawing Brief 已就绪", previewLabel: "外部结构示意图" },
  { id: "f3", title: "图3 主控板电路连接框图", mode: "auto", badge: "自动生成 · 已确认", previewLabel: "电路连接框图" },
  { id: "f4", title: "图4 蓝牙模块电路原理图", mode: "brief", badge: "需上传 · Drawing Brief 已就绪", previewLabel: "蓝牙模块电路原理图" },
];

export const DEMO_FIGURE_BRIEF =
  "主视图展示热水表本体：长度 87.9mm、宽度 75.23mm；侧面竖向插卡槽（上端开口、下端水通路）；底部内凹固定位（宽 35.6mm）；水路进水端手动阀门。附图标记：1 热水表本体、2 插卡槽、3 手动阀门。";

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
      { version: "v5", note: "审校修正：术语统一、插卡槽水通路确认来源", meta: "2026-08-05 16:20 · deepseek-chat · prompt v1.3 · 规则包 cnipa-2026-01-01" },
      { version: "v4", note: "摘要重写：去除宣传语，294 字", meta: "2026-08-05 15:02 · deepseek-chat · prompt v1.2 · 规则包 cnipa-2026-01-01" },
      { version: "v3", note: "权利要求 4-10 从属树重排", meta: "2026-08-05 11:40 · deepseek-chat · prompt v1.1 · 规则包 cnipa-2026-01-01" },
      { version: "v2", note: "初稿：权利要求骨架 + 说明书", meta: "2026-08-04 17:25 · deepseek-chat · prompt v1.0 · 规则包 2023-baseline" },
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
