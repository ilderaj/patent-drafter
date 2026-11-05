/**
 * V6-23 — deterministic checks for one immutable draft snapshot.
 *
 * This module owns check rules and finding construction only. It reads no clock,
 * storage, network, model, or global ID source. The caller supplies the bound
 * SnapshotRef, active rule pack, and run time. Legal rules are closed as
 * unverified here; no rule-pack entry can become a legal blocker in R1.
 */
import type {
  CheckRun,
  Finding,
  GateAction,
  Risk,
  RiskCategory,
} from "./gate.js";
import type { SnapshotRef } from "./revision.js";

export type VerificationLabel = "已核实" | "二手来源" | "未核实" | "已过期" | "产品规则";
export type CheckActionKind = "go_to_edit" | "acknowledge_risk" | "ask_expert" | "view_policy";
export type CheckRuleAction = Extract<GateAction, "prepare" | "approve" | "export">;
export type RuleAuthority = "engineering" | "official" | "secondary" | "unknown";
export type RuleVerification = "verified" | "unverified" | "expired";
export type CheckSection =
  | "technical_field"
  | "background"
  | "summary"
  | "figures_description"
  | "embodiments"
  | "abstract"
  | "claims";

export interface CheckLocator {
  nodeId: string | null;
  section: CheckSection | null;
  label: string;
}

export interface CheckBasis {
  quote: string | null;
  url: string | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  verifier: string | null;
  verifiedAt: string | null;
}

export interface CheckFindingDetails {
  findingId: string;
  basis: CheckBasis;
  verificationLabel: VerificationLabel;
  locator: CheckLocator;
  suggestedAction: string;
  actions: readonly CheckActionKind[];
}

/** Display DTO joins contract RiskDTO fields with rule provenance and actions. */
export interface CheckFinding extends Finding {
  basis: CheckBasis;
  verificationLabel: VerificationLabel;
  locator: CheckLocator;
  suggestedAction: string;
  actions: readonly CheckActionKind[];
}

export interface CheckRunResult {
  checkRun: CheckRun;
  findings: readonly CheckFinding[];
  /** Rule ids with an explicit product-policy declaration for each gate action. */
  blockingPolicyRuleIds: Readonly<Record<CheckRuleAction, readonly string[]>>;
}

/** A rule record plus the user-facing text the existing Rule contract omits. */
export interface CheckRule {
  id: string;
  packVersion: string;
  category: RiskCategory;
  authority: RuleAuthority;
  verification: RuleVerification;
  jurisdiction: string;
  documentKind: string;
  action: CheckRuleAction;
  basisUrl: string | null;
  citation: string | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  verifiedBy: string | null;
  verifiedAt: string | null;
  title: string;
  explanation: string;
  suggestedAction: string;
  deterministicCheck: string;
  requiresAcknowledgement?: boolean;
}

export interface CheckRulePack {
  version: string;
  rules: readonly CheckRule[];
}

export interface CheckFact {
  id: string;
  statement: string;
  status: "source_backed" | "user_confirmed" | "external_context" | "unsupported";
}

export interface CheckFactConflict {
  id: string;
  factIds: readonly string[];
  state: "open" | "resolved" | "retained";
}

export interface CheckPriorityClaim {
  id?: string;
  country: string;
  applicationNumber: string;
  verification: "unverified" | "human_confirmed";
}

export interface CheckFigureEntry {
  figureId: string;
  number: number;
  title?: string;
  drawingId: string | null;
}

export interface CheckFigureSet {
  id: string;
  entries: readonly CheckFigureEntry[];
}

export interface CheckAsset {
  id: string;
  /** Drawing row id when this asset belongs to a figure drawing. */
  drawingId?: string;
  state: "staging" | "available" | "quarantined" | "missing_bytes" | "purged";
  purpose?: "source" | "drawing" | "receipt" | "review_attachment" | "service_attachment" | "export";
}

export interface CheckAstIssue {
  path: string;
  reason: string;
  nodeId?: string | null;
  section?: CheckSection | null;
}

export interface CheckInput {
  snapshot: SnapshotRef;
  ast: unknown;
  /** A contract-schema check from the AST adapter, when the caller has one. */
  astValidation?: { valid: boolean; issues?: readonly CheckAstIssue[] };
  facts?: readonly CheckFact[];
  conflicts?: readonly CheckFactConflict[];
  disclosure?: "none" | "private_showing" | "public_event" | "publication" | "sale" | "unsure" | null;
  priorityClaims?: readonly CheckPriorityClaim[];
  route?: "cn_um" | "cn_invention" | "us_nonprovisional" | "pct";
  figureSet?: CheckFigureSet | null;
  assets?: readonly CheckAsset[];
  /** Drawing ids whose persisted bytes failed V6-12 inspectDrawing. */
  badDrawingIds?: readonly string[];
  /** Current figure revision attached to the AST's DraftRevision. */
  draftFigureRevisionId?: string | null;
  /** The revision storage layer can report an explicit draft/figure mismatch. */
  draftFigureSetMismatch?: boolean;
  inputStale?: boolean;
  inventionUsesAi?: boolean;
  requiredSections?: readonly Exclude<CheckSection, "claims">[];
}

interface RuleMatch {
  key: string;
  title?: string;
  explanation?: string;
  locator: CheckLocator;
  evidenceNodeIds?: readonly string[];
  suggestedAction?: string;
  actions?: readonly CheckActionKind[];
}

interface RegisteredCheck {
  rule: Omit<CheckRule, "packVersion">;
  evaluate: (input: CheckInput) => readonly RuleMatch[];
}

const SECTION_LABELS: Readonly<Record<Exclude<CheckSection, "claims">, string>> = Object.freeze({
  technical_field: "技术领域",
  background: "背景技术",
  summary: "发明内容",
  figures_description: "附图说明",
  embodiments: "具体实施方式",
  abstract: "摘要",
});

const ALL_REQUIRED_SECTIONS: readonly Exclude<CheckSection, "claims">[] = Object.freeze([
  "technical_field",
  "background",
  "summary",
  "figures_description",
  "embodiments",
  "abstract",
]);

const ENGINEERING_BASIS = "S07 §规则集：产品可确定的工程缺陷。";
const RISK_BASIS = "S07 §规则集：需要人工判断的实质风险。";

function engineeringRule(
  id: string,
  title: string,
  explanation: string,
  suggestedAction: string,
  evaluate: RegisteredCheck["evaluate"],
): RegisteredCheck {
  return {
    rule: {
      id,
      category: "blocker",
      authority: "engineering",
      verification: "verified",
      jurisdiction: "all",
      documentKind: "DraftAST / FigureSetRevision",
      action: "export",
      basisUrl: null,
      citation: ENGINEERING_BASIS,
      effectiveFrom: null,
      effectiveTo: null,
      verifiedBy: null,
      verifiedAt: null,
      title,
      explanation,
      suggestedAction,
      deterministicCheck: id,
    },
    evaluate,
  };
}

function riskRule(
  id: string,
  title: string,
  explanation: string,
  suggestedAction: string,
  evaluate: RegisteredCheck["evaluate"],
): RegisteredCheck {
  return {
    rule: {
      id,
      category: "risk",
      authority: "engineering",
      verification: "verified",
      jurisdiction: "all",
      documentKind: "案件输入 / DraftAST",
      action: "export",
      basisUrl: null,
      citation: RISK_BASIS,
      effectiveFrom: null,
      effectiveTo: null,
      verifiedBy: null,
      verifiedAt: null,
      title,
      explanation,
      suggestedAction,
      deterministicCheck: id,
      requiresAcknowledgement: true,
    },
    evaluate,
  };
}

function matches(
  key: string,
  locator: CheckLocator,
  evidenceNodeIds: readonly string[] = [],
  overrides: Partial<Pick<RuleMatch, "title" | "explanation" | "suggestedAction" | "actions">> = {},
): RuleMatch {
  return { key, locator, evidenceNodeIds, ...overrides };
}

const BUILTIN_CHECKS: readonly RegisteredCheck[] = Object.freeze([
  engineeringRule(
    "ast.invalid",
    "草稿结构无效",
    "DraftAST 不符合结构约束，不能作为当前草稿交付。",
    "修复标出的草稿结构后重新检查。",
    (input) => {
      const validation = input.astValidation;
      const issues = validation?.valid === false
        ? (validation.issues?.length ? validation.issues : [{ path: "ast", reason: "DraftAST 校验失败。" }])
        : basicAstIssues(input.ast);
      return issues.map((issue, index) => {
        const nodeId = isUuid(issue.nodeId) ? issue.nodeId : null;
        const section = isCheckSection(issue.section) ? issue.section : sectionFromPath(issue.path);
        const label = section ? SECTION_LABELS[section as Exclude<CheckSection, "claims">] ?? "权利要求" : "草稿结构";
        return matches(`${issue.path}/${index}`, {
          nodeId,
          section,
          label: `${label} · ${issue.path || "AST"}`,
        }, nodeId ? [nodeId] : [], { explanation: issue.reason });
      });
    },
  ),
  engineeringRule(
    "claim.dependency_cycle",
    "权利要求依赖成环",
    "权利要求之间存在循环依赖，无法确定引用顺序。",
    "调整引用关系并重新检查。",
    (input) => {
      const ast = asRecord(input.ast);
      const claims = Array.isArray(ast?.claims) ? ast.claims.filter(isRecord) : [];
      const cycles = dependencyCycles(claims);
      return cycles.map((cycle) => {
        const nodeId = cycle.find(isUuid) ?? null;
        return matches(cycle.join("/"), {
          nodeId,
          section: "claims",
          label: `权利要求 ${cycle.map((id) => claimNumber(claims, id) ?? id).join("、")}`,
        }, cycle.filter(isUuid));
      });
    },
  ),
  engineeringRule(
    "claim.unsupported_fact",
    "权利要求引用了未经支持的事实",
    "权利要求特征引用了状态为 unsupported 的事实。",
    "核对事实来源，删除或补充可验证的依据后重新检查。",
    (input) => {
      const facts = new Map((input.facts ?? []).map((fact) => [fact.id, fact]));
      const ast = asRecord(input.ast);
      const claims = Array.isArray(ast?.claims) ? ast.claims.filter(isRecord) : [];
      const findings: RuleMatch[] = [];
      for (const claim of claims) {
        const features = Array.isArray(claim.features) ? claim.features.filter(isRecord) : [];
        for (const feature of features) {
          const factIds = strings(feature.factIds);
          const unsupported = factIds.map((id) => facts.get(id)).filter((fact) => fact?.status === "unsupported");
          if (unsupported.length === 0) continue;
          const nodeId = isUuid(feature.id) ? feature.id : isUuid(claim.id) ? claim.id : null;
          findings.push(matches(`${String(claim.id)}/${String(feature.id)}/${unsupported.map((fact) => fact!.id).join("/")}`, {
            nodeId,
            section: "claims",
            label: `权利要求 ${String(claim.number)} · ${String(feature.text ?? "特征")}`,
          }, [nodeId, ...unsupported.map((fact) => fact!.id)].filter(isUuid), {
            explanation: `权利要求特征「${String(feature.text ?? "未命名特征")}」引用了 unsupported 事实：${unsupported.map((fact) => fact!.statement).join("；")}`,
          }));
        }
      }
      return findings;
    },
  ),
  engineeringRule(
    "claim.external_context",
    "外部背景信息进入了发明点",
    "权利要求特征引用了 external_context 事实；外部背景不能被当作本案发明事实。",
    "将外部背景移出权利要求特征，并由发明人确认本案事实。",
    (input) => {
      const facts = new Map((input.facts ?? []).map((fact) => [fact.id, fact]));
      const ast = asRecord(input.ast);
      const claims = Array.isArray(ast?.claims) ? ast.claims.filter(isRecord) : [];
      const findings: RuleMatch[] = [];
      for (const claim of claims) {
        const features = Array.isArray(claim.features) ? claim.features.filter(isRecord) : [];
        for (const feature of features) {
          const external = strings(feature.factIds).map((id) => facts.get(id)).filter((fact) => fact?.status === "external_context");
          if (external.length === 0) continue;
          const nodeId = isUuid(feature.id) ? feature.id : isUuid(claim.id) ? claim.id : null;
          findings.push(matches(`${String(claim.id)}/${String(feature.id)}/${external.map((fact) => fact!.id).join("/")}`, {
            nodeId,
            section: "claims",
            label: `权利要求 ${String(claim.number)} · ${String(feature.text ?? "特征")}`,
          }, [nodeId, ...external.map((fact) => fact!.id)].filter(isUuid), {
            explanation: `权利要求特征「${String(feature.text ?? "未命名特征")}」引用了外部背景：${external.map((fact) => fact!.statement).join("；")}`,
          }));
        }
      }
      return findings;
    },
  ),
  engineeringRule(
    "figure.missing_or_placeholder",
    "附图缺失或仍是占位项",
    "当前图集为空，或图集条目没有绑定实际图稿。",
    "添加并绑定有效附图，再重新检查。",
    (input) => {
      const set = input.figureSet;
      if (set === undefined) return [];
      if (set === null || set.entries.length === 0) {
        return [matches("empty", { nodeId: null, section: "figures_description", label: "附图图集" })];
      }
      return set.entries
        .filter((entry) => entry.drawingId === null)
        .map((entry) => matches(`${entry.figureId}/${entry.number}`, {
          nodeId: isUuid(entry.figureId) ? entry.figureId : null,
          section: "figures_description",
          label: `图 ${entry.number} · ${entry.title ?? entry.figureId}`,
        }, isUuid(entry.figureId) ? [entry.figureId] : []));
    },
  ),
  engineeringRule(
    "figure.duplicate_number",
    "附图编号重复或不连续",
    "图集中存在重复编号或编号不从 1 开始连续排列。",
    "修正图号并重新检查。",
    (input) => {
      const entries = input.figureSet?.entries ?? [];
      const seen = new Set<number>();
      const duplicated = entries.filter((entry) => {
        if (seen.has(entry.number)) return true;
        seen.add(entry.number);
        return false;
      });
      const numbers = entries.map((entry) => entry.number);
      const invalid = duplicated.length > 0 || numbers.some((number) => !Number.isSafeInteger(number) || number < 1)
        || Array.from({ length: entries.length }, (_, index) => index + 1).some((number) => !seen.has(number));
      if (!invalid) return [];
      const nodeId = duplicated.find((entry) => isUuid(entry.figureId))?.figureId
        ?? entries.find((entry) => isUuid(entry.figureId))?.figureId
        ?? null;
      return [matches(numbers.join("/"), {
        nodeId,
        section: "figures_description",
        label: "附图图集编号",
      }, entries.map((entry) => entry.figureId).filter(isUuid))];
    },
  ),
  engineeringRule(
    "asset.missing_bytes",
    "附图文件缺少字节",
    "图集引用的图稿资产不可用或已丢失文件内容。",
    "恢复或重新上传图稿，然后重新检查。",
    (input) => {
      if (input.assets === undefined) return [];
      const assets = new Map(input.assets.map((asset) => [asset.id, asset]));
      const findings: RuleMatch[] = [];
      for (const entry of input.figureSet?.entries ?? []) {
        if (entry.drawingId === null) continue;
        const asset = input.assets.find((candidate) => candidate.drawingId === entry.drawingId)
          ?? assets.get(entry.drawingId);
        if (asset?.state === "available") continue;
        findings.push(matches(`${entry.figureId}/${entry.drawingId}`, {
          nodeId: isUuid(entry.figureId) ? entry.figureId : null,
          section: "figures_description",
          label: `图 ${entry.number} · 文件 ${entry.drawingId}`,
        }, [entry.figureId, entry.drawingId].filter(isUuid)));
      }
      return findings;
    },
  ),
  engineeringRule(
    "asset.bad_drawing",
    "附图文件损坏",
    "图稿字节未通过 V6-12 的图像校验。",
    "替换为可解码的 PNG 或 JPEG 后重新检查。",
    (input) => (input.badDrawingIds ?? []).map((drawingId) => {
      const entry = input.figureSet?.entries.find((item) => item.drawingId === drawingId);
      return matches(drawingId, {
        nodeId: entry && isUuid(entry.figureId) ? entry.figureId : isUuid(drawingId) ? drawingId : null,
        section: "figures_description",
        label: entry ? `图 ${entry.number} · ${drawingId}` : `图稿 ${drawingId}`,
      }, [entry?.figureId, drawingId].filter(isUuid));
    }),
  ),
  engineeringRule(
    "figure.draft_set_mismatch",
    "草稿与当前图集不一致",
    "草稿引用了当前图集不存在的图，或草稿绑定的图集修订已变化。",
    "核对草稿图号与当前图集，再重新检查。",
    (input) => {
      const figures = input.figureSet?.entries ?? [];
      const known = new Set(figures.map((entry) => entry.figureId));
      const referenced = collectAstFigureIds(input.ast);
      const missing = referenced.filter((figureId) => !known.has(figureId));
      const revisionMismatch = input.draftFigureSetMismatch === true
        || (input.draftFigureRevisionId !== undefined && input.draftFigureRevisionId !== input.snapshot.figureRevisionId)
        || (input.figureSet !== undefined && input.figureSet !== null && input.figureSet.id !== input.snapshot.figureRevisionId);
      if (missing.length === 0 && !revisionMismatch) return [];
      return [matches(`${missing.join("/")}/${revisionMismatch}`, {
        nodeId: missing.find(isUuid) ?? null,
        section: "figures_description",
        label: missing.length > 0 ? `草稿引用图 ${missing.join("、")}` : "草稿绑定的图集修订",
      }, missing.filter(isUuid))];
    },
  ),
  engineeringRule(
    "section.required_empty",
    "必填章节为空",
    "草稿包含一个或多个空的必填章节。",
    "补全标出的章节后重新检查。",
    (input) => {
      const ast = asRecord(input.ast);
      const sections = Array.isArray(ast?.sections) ? ast.sections.filter(isRecord) : [];
      const required = input.requiredSections ?? ALL_REQUIRED_SECTIONS;
      const findings: RuleMatch[] = [];
      for (const kind of required) {
        const section = sections.find((candidate) => candidate.kind === kind);
        const paragraphs = section && Array.isArray(section.paragraphs) ? section.paragraphs : [];
        const hasText = paragraphs.some((paragraph) => isRecord(paragraph) && typeof paragraph.text === "string" && paragraph.text.trim().length > 0);
        if (hasText) continue;
        findings.push(matches(kind, {
          nodeId: null,
          section: kind,
          label: SECTION_LABELS[kind],
        }));
      }
      return findings;
    },
  ),
  riskRule(
    "fact.open_conflict",
    "存在尚未处理的事实冲突",
    "案件中仍有 open 状态的事实冲突，需要人工选择或说明处理方式。",
    "核对冲突事实并记录处理理由。",
    (input) => (input.conflicts ?? [])
      .filter((conflict) => conflict.state === "open")
      .map((conflict) => matches(conflict.id, {
        nodeId: isUuid(conflict.id) ? conflict.id : null,
        section: null,
        label: `事实冲突 ${conflict.id}`,
      }, isUuid(conflict.id) ? [conflict.id] : [])),
  ),
  riskRule(
    "disclosure.not_none",
    "披露情况需要人工判断",
    "披露情况不是明确的「无」，或尚未填写；此结果不判断新颖性或宽限期。",
    "核对披露时间、对象、保密条件和材料，并咨询专业人士。",
    (input) => input.disclosure === "none" ? [] : [matches(String(input.disclosure ?? "unanswered"), {
      nodeId: null,
      section: null,
      label: "披露情况",
    })],
  ),
  riskRule(
    "claim.support_partial_or_unsupported",
    "权利要求支持度需要人工判断",
    "一个或多个权利要求特征的支持度为 partial 或 unsupported。",
    "对照说明书和来源材料逐项核对支持关系。",
    (input) => {
      const ast = asRecord(input.ast);
      const claims = Array.isArray(ast?.claims) ? ast.claims.filter(isRecord) : [];
      const findings: RuleMatch[] = [];
      for (const claim of claims) {
        const features = Array.isArray(claim.features) ? claim.features.filter(isRecord) : [];
        for (const feature of features) {
          if (feature.status !== "partial" && feature.status !== "unsupported") continue;
          const nodeId = isUuid(feature.id) ? feature.id : isUuid(claim.id) ? claim.id : null;
          findings.push(matches(`${String(claim.id)}/${String(feature.id)}`, {
            nodeId,
            section: "claims",
            label: `权利要求 ${String(claim.number)} · ${String(feature.text ?? "特征")}`,
          }, nodeId ? [nodeId] : [], {
            explanation: `特征「${String(feature.text ?? "未命名特征")}」的支持状态为 ${String(feature.status)}。`,
          }));
        }
      }
      return findings;
    },
  ),
  riskRule(
    "priority.unverified",
    "优先权信息尚未核实",
    "一个或多个优先权主张仍标记为 unverified。",
    "人工核对申请号、日期和证明材料。",
    (input) => (input.priorityClaims ?? [])
      .filter((claim) => claim.verification === "unverified")
      .map((claim) => matches(`${claim.country}/${claim.applicationNumber}/${claim.id ?? ""}`, {
        nodeId: isUuid(claim.id) ? claim.id : null,
        section: null,
        label: `优先权 ${claim.country} · ${claim.applicationNumber}`,
      }, isUuid(claim.id) ? [claim.id] : [])),
  ),
  riskRule(
    "route.chinese_prep_draft",
    "准备稿语言与目标地区不一致",
    "US 或 PCT 目标当前使用中文准备稿；这不是可提交文件的语言结论。",
    "确认目标语言和专业翻译安排。",
    (input) => {
      const ast = asRecord(input.ast);
      if ((input.route !== "us_nonprovisional" && input.route !== "pct") || ast?.language !== "zh-CN") return [];
      return [matches(`${input.route}/zh-CN`, { nodeId: null, section: null, label: "目标设置与草稿语言" })];
    },
  ),
  riskRule(
    "input.stale",
    "草稿依据的输入已变化",
    "草稿修订引用的材料、目标配置或附图修订不是当前输入。",
    "核对新输入并建立新草稿修订后重新检查。",
    (input) => input.inputStale === true
      ? [matches("stale", { nodeId: null, section: null, label: "当前案件输入" })]
      : [],
  ),
]);

/** Deterministic registry; registration is immutable and rule ids cannot collide. */
export class CheckRegistry {
  private readonly checks: readonly RegisteredCheck[];

  constructor(checks: readonly RegisteredCheck[] = BUILTIN_CHECKS) {
    const seen = new Set<string>();
    for (const check of checks) {
      if (seen.has(check.rule.id)) throw new TypeError(`duplicate check rule id: ${check.rule.id}`);
      seen.add(check.rule.id);
    }
    this.checks = [...checks];
  }

  run(input: CheckInput, pack: CheckRulePack, createdAt: string): CheckRunResult {
    if (!isIsoDateTime(createdAt)) throw new TypeError("CheckRun.createdAt must be an ISO date-time.");
    if (!pack.version.trim()) throw new TypeError("rulePack.version must not be empty.");
    const activeRules = new Map<string, CheckRule>();
    for (const rule of pack.rules) {
      if (rule.packVersion === pack.version) activeRules.set(rule.id, rule);
    }
    const records: { finding: CheckFinding; key: string }[] = [];

    for (const registered of this.checks) {
      const rule = { ...registered.rule, packVersion: pack.version };
      for (const match of registered.evaluate(input)) {
        records.push({ finding: makeFinding(rule, match, createdAt), key: match.key });
      }
    }

    for (const rule of activeRules.values()) {
      const ruleMatches = evaluatePackRule(rule, input);
      const category = packRuleCategory(rule);
      const normalized = { ...rule, category, packVersion: pack.version };
      for (const match of ruleMatches) records.push({ finding: makeFinding(normalized, match, createdAt), key: match.key });
    }

    const unique = new Map<string, { finding: CheckFinding; key: string }>();
    for (const record of records) unique.set(record.finding.id, record);
    const ordered = [...unique.values()].sort((a, b) =>
      categoryOrder(a.finding.category) - categoryOrder(b.finding.category)
      || a.finding.ruleId.localeCompare(b.finding.ruleId)
      || a.finding.locator.label.localeCompare(b.finding.locator.label)
      || a.finding.id.localeCompare(b.finding.id));
    const findings = ordered.map((item) => item.finding);
    const checkRun: CheckRun = {
      id: stableUuid("check-run", `${snapshotKey(input.snapshot)}|${pack.version}|${createdAt}`),
      snapshot: { ...input.snapshot },
      rulePackVersion: pack.version,
      state: "succeeded",
      findings: findings.map(stripDisplayDetails),
      createdAt,
    };
    const blockingPolicyRuleIds: Record<CheckRuleAction, string[]> = {
      prepare: [],
      approve: [],
      export: [],
    };
    for (const rule of activeRules.values()) {
      if (rule.category === "policy" && rule.authority === "engineering") {
        blockingPolicyRuleIds[rule.action].push(rule.id);
      }
    }
    for (const action of Object.keys(blockingPolicyRuleIds) as CheckRuleAction[]) {
      blockingPolicyRuleIds[action] = [...new Set(blockingPolicyRuleIds[action])].sort();
    }
    return { checkRun, findings, blockingPolicyRuleIds };
  }
}

export const CHECK_REGISTRY = Object.freeze(new CheckRegistry());

export function runChecks(input: CheckInput, pack: CheckRulePack, createdAt: string): CheckRunResult {
  return CHECK_REGISTRY.run(input, pack, createdAt);
}

/** A check is current only after success and while both bindings still match. */
export function isCurrentCheckRun(
  checkRun: Pick<CheckRun, "snapshot" | "rulePackVersion" | "state">,
  snapshot: SnapshotRef,
  activeRulePackVersion: string,
): boolean {
  return checkRun.state === "succeeded"
    && checkRun.rulePackVersion === activeRulePackVersion
    && sameSnapshot(checkRun.snapshot, snapshot);
}

export function verificationLabel(rule: Pick<CheckRule, "authority" | "verification" | "effectiveTo">, at: string): VerificationLabel {
  if (rule.authority === "engineering") return "产品规则";
  if (rule.verification === "expired" || (rule.effectiveTo !== null && rule.effectiveTo < at.slice(0, 10))) return "已过期";
  if (rule.authority === "secondary") return "二手来源";
  if (rule.verification === "unverified") return "未核实";
  return "已核实";
}

/**
 * Adapt the checked-in rules-cn JSON format to the frozen Rule contract.
 * G-RULES closed forces all non-product entries to unverified even when package
 * metadata records that a source or publication date was checked.
 */
export function adaptCnRulePack(source: unknown): CheckRulePack {
  const pack = asRecord(source);
  const rawRules = Array.isArray(pack?.rules) ? pack.rules.filter(isRecord) : [];
  const version = typeof pack?.rulePackVersion === "string" && pack.rulePackVersion.trim()
    ? pack.rulePackVersion
    : "cn-rules-unknown";
  const meta = asRecord(pack?.meta);
  const sources = Array.isArray(meta?.sources) ? meta.sources.filter((item): item is string => typeof item === "string") : [];
  const preferredUrl = sources.find((value) => /^https:\/\//i.test(value) && value.includes(".gov.cn"))
    ?? sources.find((value) => /^https?:\/\//i.test(value))
    ?? null;
  const rules: CheckRule[] = rawRules.flatMap((raw) => {
    const id = typeof raw.ruleId === "string" ? raw.ruleId : null;
    if (!id) return [];
    const sourceDocument = typeof raw.sourceDocument === "string" ? raw.sourceDocument : "CNIPA 规则包";
    const productRule = sourceDocument === "产品内部规则";
    const check = typeof raw.deterministicCheck === "string" ? raw.deterministicCheck : "";
    const patents = Array.isArray(raw.patentType) ? raw.patentType.filter((item): item is string => typeof item === "string") : [];
    const jurisdiction = patents.length === 1 && patents[0] === "utility_model"
      ? "cn_um"
      : patents.length === 1 && patents[0] === "invention"
        ? "cn_invention"
        : "all";
    const sourceSection = typeof raw.sourceSection === "string" ? raw.sourceSection : "";
    const citation = [sourceDocument, sourceSection].filter(Boolean).join(" · ");
    const action: CheckRuleAction = productRule && /aiAssistedReviewConfirmed/i.test(check) ? "export" : "prepare";
    return [{
      id,
      packVersion: version,
      category: productRule ? "policy" : "unverified",
      authority: productRule ? "engineering" : "secondary",
      verification: productRule ? "verified" : "unverified",
      jurisdiction,
      documentKind: sourceDocument,
      action,
      basisUrl: preferredUrl,
      citation: citation || null,
      effectiveFrom: dateOrNull(raw.effectiveFrom),
      effectiveTo: dateOrNull(raw.effectiveTo),
      verifiedBy: null,
      verifiedAt: null,
      title: typeof raw.userMessage === "string" ? raw.userMessage : id,
      explanation: citation ? `规则包条目：${citation}。该法律条目仍受 G-RULES closed 限制。` : "该法律条目仍受 G-RULES closed 限制。",
      suggestedAction: typeof raw.remediation === "string" ? raw.remediation : "请人工核实依据后再处理。",
      deterministicCheck: check,
      requiresAcknowledgement: false,
    }];
  });
  return { version, rules };
}

/** Combine versioned JSON files; later pack rows replace matching rule ids. */
export function adaptCnRulePacks(sources: readonly unknown[], activeVersion?: string): CheckRulePack {
  const packs = sources.map(adaptCnRulePack);
  const version = activeVersion ?? packs.at(-1)?.version ?? "cn-rules-unknown";
  const merged = new Map<string, CheckRule>();
  for (const pack of packs) {
    for (const rule of pack.rules) merged.set(rule.id, { ...rule, packVersion: version });
  }
  return { version, rules: [...merged.values()].sort((left, right) => left.id.localeCompare(right.id)) };
}

function makeFinding(rule: CheckRule, match: RuleMatch, createdAt: string): CheckFinding {
  const category = packRuleCategory(rule);
  const label = verificationLabel(
    rule.authority === "engineering"
      ? rule
      : { ...rule, verification: rule.verification === "expired" ? "expired" : "unverified" },
    createdAt,
  );
  const actions = match.actions ?? actionsFor(category, rule.requiresAcknowledgement === true);
  const nodeId = isUuid(match.locator.nodeId) ? match.locator.nodeId : null;
  const section = isCheckSection(match.locator.section) ? match.locator.section : null;
  const evidenceNodeIds = [...new Set((match.evidenceNodeIds ?? []).filter(isUuid))];
  const risk: Risk = {
    id: stableUuid("finding", `${rule.id}|${match.key}`),
    category,
    title: match.title ?? rule.title,
    explanation: match.explanation ?? rule.explanation,
    ruleId: rule.id,
    requiresAcknowledgement: category === "risk" && (rule.requiresAcknowledgement ?? true),
    anchor: { nodeId, section, locked: false },
  };
  return {
    ...risk,
    status: "open",
    evidenceNodeIds,
    basis: {
      quote: rule.citation,
      url: rule.basisUrl,
      effectiveFrom: rule.effectiveFrom,
      effectiveTo: rule.effectiveTo,
      verifier: rule.verifiedBy,
      verifiedAt: rule.verifiedAt,
    },
    verificationLabel: label,
    locator: { ...match.locator, nodeId, section },
    suggestedAction: match.suggestedAction ?? rule.suggestedAction,
    actions,
  };
}

function stripDisplayDetails(finding: CheckFinding): Finding {
  return {
    id: finding.id,
    category: finding.category,
    title: finding.title,
    explanation: finding.explanation,
    ruleId: finding.ruleId,
    requiresAcknowledgement: finding.requiresAcknowledgement,
    anchor: finding.anchor,
    status: finding.status,
    evidenceNodeIds: [...finding.evidenceNodeIds],
  };
}

function packRuleCategory(rule: CheckRule): RiskCategory {
  // In this release all legal/unknown rule-pack entries are unverified. The
  // metadata in a pack cannot silently turn them into legal blockers.
  if (rule.authority !== "engineering") return "unverified";
  return rule.category;
}

function actionsFor(category: RiskCategory, requiresAcknowledgement: boolean): readonly CheckActionKind[] {
  switch (category) {
    case "blocker":
      return ["go_to_edit", "ask_expert"];
    case "risk":
      return requiresAcknowledgement
        ? ["acknowledge_risk", "go_to_edit", "ask_expert"]
        : ["go_to_edit", "ask_expert"];
    case "unverified":
      return ["ask_expert"];
    case "policy":
      return ["view_policy", "go_to_edit"];
  }
}

function evaluatePackRule(rule: CheckRule, input: CheckInput): readonly RuleMatch[] {
  const ast = asRecord(input.ast);
  switch (rule.deterministicCheck) {
    case "always":
      return [matches("always", { nodeId: null, section: null, label: rule.documentKind || "规则提示" })];
    case "figuresRequired":
      return input.figureSet === null || input.figureSet?.entries.length === 0
        ? [matches("figures-required", { nodeId: null, section: "figures_description", label: "附图图集" })]
        : [];
    case "figureNumbersSequential": {
      const entries = input.figureSet?.entries ?? [];
      const numbers = new Set(entries.map((entry) => entry.number));
      return entries.length > 0 && (numbers.size !== entries.length || Array.from({ length: entries.length }, (_, index) => index + 1).some((n) => !numbers.has(n)))
        ? [matches(`figure-numbers/${entries.map((entry) => entry.number).join("/")}`, { nodeId: null, section: "figures_description", label: "附图图集编号" })]
        : [];
    }
    case "specSectionsComplete": {
      const sections = Array.isArray(ast?.sections) ? ast.sections.filter(isRecord) : [];
      return ALL_REQUIRED_SECTIONS.filter((kind) => {
        const section = sections.find((candidate) => candidate.kind === kind);
        return !Array.isArray(section?.paragraphs) || !section.paragraphs.some((p) => isRecord(p) && typeof p.text === "string" && p.text.trim());
      }).map((kind) => matches(`empty/${kind}`, { nodeId: null, section: kind, label: SECTION_LABELS[kind] }));
    }
    case "titleLengthMax25":
      return typeof ast?.title === "string" && Array.from(ast.title.trim()).length > 25
        ? [matches("title-length", { nodeId: null, section: null, label: "草稿标题" })]
        : [];
    case "abstractMax300": {
      const sections = Array.isArray(ast?.sections) ? ast.sections.filter(isRecord) : [];
      const abstract = sections.find((section) => section.kind === "abstract");
      const text = Array.isArray(abstract?.paragraphs)
        ? abstract.paragraphs.filter(isRecord).map((paragraph) => String(paragraph.text ?? "")).join("")
        : "";
      return Array.from(text).length > 300 ? [matches("abstract-length", { nodeId: null, section: "abstract", label: "摘要" })] : [];
    }
    case "aiDisclosureConfirmed": {
      const aiContent = allParagraphs(input.ast).filter((paragraph) => paragraph.origin === "ai" || paragraph.origin === "mixed");
      return aiContent.length > 0
        ? [matches(`ai-disclosure/${aiContent.map((paragraph) => paragraph.id).join("/")}`, {
          nodeId: isUuid(aiContent[0]?.id) ? aiContent[0]!.id : null,
          section: null,
          label: "AI 辅助内容",
        }, aiContent.map((paragraph) => paragraph.id).filter(isUuid))]
        : [];
    }
    case "aiDisclosureComplete":
    case "aiEthicsStatement":
    case "aiInventiveContribution":
      return input.inventionUsesAi === true
        ? [matches(rule.deterministicCheck, { nodeId: null, section: null, label: "AI 相关方案" })]
        : [];
    case "inventorsNaturalPerson":
    case "inventorNaturalPerson":
      return [];
    default:
      return [];
  }
}

function basicAstIssues(astValue: unknown): CheckAstIssue[] {
  const ast = asRecord(astValue);
  if (!ast || ast.schemaVersion !== "draft.v1" || (ast.language !== "zh-CN" && ast.language !== "en-US")
    || typeof ast.title !== "string" || !Array.isArray(ast.claims) || !Array.isArray(ast.sections)) {
    return [{ path: "ast", reason: "DraftAST 缺少必需字段或结构。" }];
  }
  const issues: CheckAstIssue[] = [];
  const claims = ast.claims.filter(isRecord);
  if (claims.length !== ast.claims.length) issues.push({ path: "claims", reason: "权利要求条目结构无效。", section: "claims" });
  const numbers = new Set<number>();
  const claimIds = new Set<string>();
  const nodeIds = new Set<string>();
  const paragraphs = new Set<string>();
  const registerNode = (id: unknown, path: string, section: CheckSection | null) => {
    if (typeof id !== "string" || !isUuid(id)) {
      issues.push({ path, reason: "节点 id 无效。", nodeId: typeof id === "string" ? id : null, section });
      return;
    }
    if (nodeIds.has(id)) issues.push({ path, reason: "节点 id 重复。", nodeId: id, section });
    nodeIds.add(id);
  };
  for (const [index, claim] of claims.entries()) {
    if (!Number.isSafeInteger(claim.number) || typeof claim.id !== "string" || !Array.isArray(claim.dependsOn)
      || !Array.isArray(claim.paragraphs) || !Array.isArray(claim.features)) {
      issues.push({ path: `claims.${index}`, reason: "权利要求结构无效。", nodeId: typeof claim.id === "string" ? claim.id : null, section: "claims" });
      continue;
    }
    registerNode(claim.id, `claims.${index}.id`, "claims");
    if (numbers.has(claim.number as number)) issues.push({ path: `claims.${index}.number`, reason: "权利要求编号重复。", nodeId: claim.id, section: "claims" });
    numbers.add(claim.number as number);
    claimIds.add(claim.id);
    for (const [featureIndex, featureValue] of claim.features.entries()) {
      const feature = asRecord(featureValue);
      if (!feature) {
        issues.push({ path: `claims.${index}.features.${featureIndex}`, reason: "权利要求特征结构无效。", nodeId: claim.id, section: "claims" });
        continue;
      }
      registerNode(feature.id, `claims.${index}.features.${featureIndex}.id`, "claims");
    }
    for (const [paragraphIndex, paragraphValue] of claim.paragraphs.entries()) {
      const paragraph = asRecord(paragraphValue);
      if (!paragraph || typeof paragraph.text !== "string" || !Array.isArray(paragraph.figureIds)) {
        issues.push({ path: `claims.${index}.paragraphs.${paragraphIndex}`, reason: "权利要求段落结构无效。", nodeId: claim.id, section: "claims" });
        continue;
      }
      registerNode(paragraph.id, `claims.${index}.paragraphs.${paragraphIndex}.id`, "claims");
      if (typeof paragraph.id === "string") paragraphs.add(paragraph.id);
    }
  }
  for (let number = 1; number <= claims.length; number += 1) {
    if (!numbers.has(number)) issues.push({ path: "claims", reason: `权利要求编号缺少 ${number}。`, section: "claims" });
  }
  const numberById = new Map(claims.map((claim) => [String(claim.id), Number(claim.number)]));
  for (const [index, claim] of claims.entries()) {
    if (!Array.isArray(claim.dependsOn)) continue;
    for (const dependency of claim.dependsOn) {
      if (typeof dependency !== "string" || !claimIds.has(dependency) || (numberById.get(dependency) ?? Infinity) >= Number(claim.number)) {
        issues.push({ path: `claims.${index}.dependsOn`, reason: "权利要求依赖不存在或指向后续权利要求。", nodeId: String(claim.id), section: "claims" });
      }
    }
    for (const [featureIndex, featureValue] of (Array.isArray(claim.features) ? claim.features : []).entries()) {
      const feature = asRecord(featureValue);
      for (const supportId of strings(feature?.supportParagraphIds)) {
        if (!paragraphs.has(supportId)) issues.push({
          path: `claims.${index}.features.${featureIndex}.supportParagraphIds`,
          reason: "支持段落引用不存在。",
          nodeId: typeof feature?.id === "string" ? feature.id : String(claim.id),
          section: "claims",
        });
      }
    }
  }
  const sectionKinds = new Set<string>();
  for (const [index, sectionValue] of ast.sections.entries()) {
    const section = asRecord(sectionValue);
    const kind = section?.kind;
    if (!section || !isSectionWithoutClaims(kind) || !Array.isArray(section.paragraphs) || sectionKinds.has(kind)) {
      issues.push({ path: `sections.${index}`, reason: "章节结构无效、重复或编号不受支持。", section: isSectionWithoutClaims(kind) ? kind : null });
      continue;
    }
    sectionKinds.add(kind);
    for (const [paragraphIndex, paragraphValue] of section.paragraphs.entries()) {
      const paragraph = asRecord(paragraphValue);
      if (!paragraph || typeof paragraph.text !== "string" || !Array.isArray(paragraph.figureIds)) {
        issues.push({ path: `sections.${index}.paragraphs.${paragraphIndex}`, reason: "章节段落结构无效。", section: kind });
        continue;
      }
      registerNode(paragraph.id, `sections.${index}.paragraphs.${paragraphIndex}.id`, kind);
      if (typeof paragraph.id === "string") paragraphs.add(paragraph.id);
    }
  }
  return issues;
}

function dependencyCycles(claims: readonly Record<string, unknown>[]): string[][] {
  const byId = new Map(claims.filter((claim) => typeof claim.id === "string").map((claim) => [claim.id as string, claim]));
  const state = new Map<string, 0 | 1 | 2>();
  const stack: string[] = [];
  const cycles: string[][] = [];
  const visit = (id: string) => {
    const current = state.get(id) ?? 0;
    if (current === 2) return;
    if (current === 1) {
      const start = stack.indexOf(id);
      if (start >= 0) cycles.push([...stack.slice(start), id]);
      return;
    }
    state.set(id, 1);
    stack.push(id);
    const dependencies = strings(byId.get(id)?.dependsOn);
    for (const dependency of dependencies) if (byId.has(dependency)) visit(dependency);
    stack.pop();
    state.set(id, 2);
  };
  for (const id of byId.keys()) visit(id);
  return cycles;
}

function allParagraphs(astValue: unknown): Record<string, unknown>[] {
  const ast = asRecord(astValue);
  const paragraphs: Record<string, unknown>[] = [];
  const append = (values: unknown) => {
    if (Array.isArray(values)) paragraphs.push(...values.filter(isRecord));
  };
  if (Array.isArray(ast?.claims)) for (const claimValue of ast.claims) append(asRecord(claimValue)?.paragraphs);
  if (Array.isArray(ast?.sections)) for (const sectionValue of ast.sections) append(asRecord(sectionValue)?.paragraphs);
  return paragraphs;
}

function collectAstFigureIds(astValue: unknown): string[] {
  const ids = new Set<string>();
  for (const paragraph of allParagraphs(astValue)) {
    for (const id of strings(paragraph.figureIds)) ids.add(id);
  }
  return [...ids].sort();
}

function sectionFromPath(path: string): CheckSection | null {
  const section = /sections\.\d+\.kind/.test(path)
    ? null
    : /^sections\.\d+/.test(path)
      ? null
      : /^claims(?:\.|$)/.test(path)
        ? "claims"
        : null;
  return section;
}

function claimNumber(claims: readonly Record<string, unknown>[], id: string): string | number | null {
  const claim = claims.find((candidate) => candidate.id === id);
  return typeof claim?.number === "number" || typeof claim?.number === "string" ? claim.number : null;
}

function snapshotKey(snapshot: SnapshotRef): string {
  return [snapshot.matterId, snapshot.targetId, snapshot.sourceVersion, snapshot.targetConfigVersion, snapshot.draftRevisionId, snapshot.figureRevisionId].join("|");
}

function sameSnapshot(left: SnapshotRef, right: SnapshotRef): boolean {
  return left.matterId === right.matterId
    && left.targetId === right.targetId
    && left.sourceVersion === right.sourceVersion
    && left.targetConfigVersion === right.targetConfigVersion
    && left.draftRevisionId === right.draftRevisionId
    && left.figureRevisionId === right.figureRevisionId;
}

function stableUuid(namespace: string, input: string): string {
  const seeds = [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35];
  const words = seeds.map((seed, word) => {
    let hash = seed ^ (word * 0x27d4eb2d);
    const value = `${namespace}:${input}`;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  });
  const hex = words.join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function categoryOrder(category: RiskCategory): number {
  return category === "blocker" ? 0 : category === "risk" ? 1 : category === "unverified" ? 2 : 3;
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isCheckSection(value: unknown): value is CheckSection {
  return value === "technical_field" || value === "background" || value === "summary"
    || value === "figures_description" || value === "embodiments" || value === "abstract" || value === "claims";
}

function isSectionWithoutClaims(value: unknown): value is Exclude<CheckSection, "claims"> {
  return value === "technical_field" || value === "background" || value === "summary"
    || value === "figures_description" || value === "embodiments" || value === "abstract";
}

function dateOrNull(value: unknown): string | null {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function isIsoDateTime(value: string): boolean {
  return Number.isFinite(Date.parse(value)) && /^\d{4}-\d{2}-\d{2}T/.test(value);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return asRecord(value) !== null;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}
