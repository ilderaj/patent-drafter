/**
 * V6-14 — routes and multi-target configuration (S03 路线与目标, 05-contracts §3/§9).
 *
 * One deep module owns every rule between a matter's persisted state and the
 * targets surface. The React panel and the engine suite use the same public
 * interface; nothing here calls a model or opens a socket.
 *
 * - `recommendRoutes` is a pure, deterministic rule evaluation. It never calls a
 *   model and always returns the rule id plus the fact ids (or the maturity
 *   answer) that triggered it, so the panel can show its trace.
 * - `routeCards` renders each route's protection object, examination mode,
 *   capability limits and rule verification state. Cycle, fee and term numbers
 *   exist only for a rule entry whose `verification` is `verified`; an
 *   unverified entry shows 「未核实」 and no number (S03-A07).
 * - `loadTargetsView` is read-only: it never bumps the matter version or any
 *   `configVersion`. Switching or refreshing targets only reads.
 * - `createTarget` and `updateTargetConfig` write through
 *   `LocalRepository.commit`: the create appends one Target and one
 *   `target.created` event, the update rewrites only that target's
 *   `configVersion` and appends one `target.config_updated` event. No other
 *   target's config or `configVersion` is touched.
 *
 * Validation is against the matter's current `SourceSnapshot`: applicant and
 * inventor ids must be parties, an inventor must be a person, and a priority
 * claim needs a real calendar date plus, when given, an evidence asset of this
 * matter. `verification` defaults to `unverified`; nothing is invented.
 *
 * Idempotency follows 05-contracts §2 and the V6-13/V6-15 protocol. A keyed
 * write claims its key in one read-write transaction before any business
 * read-check-write; only the claim owner may commit. A completed key replays
 * the original response, a different payload is `IDEMPOTENCY_CONFLICT`, a live
 * identical claim waits briefly and then reports the retryable busy message,
 * and an expired lease may be taken over. Target, event and finalize ids are
 * deterministic for a keyed request, so a retry after a lost finalize replays
 * the landed response with no duplicate row or event.
 *
 * Persistence uses the existing `blobs` store with namespaced keys. A config
 * revision row is authoritative only when the aggregate's
 * `Target.configVersion` points at it, so a row left by a failed commit is
 * invisible and harmless. The 30-day retention / `IDEMPOTENCY_EXPIRED`
 * behaviour (contract §2) is not implemented in this local build; records are
 * kept and replay indefinitely (see the ticket limitations).
 */
import {
  factKindSchema,
  partySchema,
  sourceSnapshotSchema,
  targetConfigSchema,
  type Party,
  type TargetConfig,
} from "../../../../../../packages/contracts/src/matter.ts";
import {
  isLocalDate,
  languageSchema,
  routeSchema,
} from "../../../../../../packages/contracts/src/primitives.ts";

type Language = (typeof languageSchema.options)[number];
type Route = (typeof routeSchema.options)[number];
import type { Rule } from "../../../../../../packages/contracts/src/delivery.ts";
import {
  CONTRACT_VERSION,
  STORES,
  sha256Hex,
  type ActivityRecord,
  type Actor,
  type AssetRecord,
  type LocalRepository,
  type RepositoryError,
  type TargetRecord,
} from "../../lib/repository.ts";

// ---------------------------------------------------------------------------
// Public vocabulary
// ---------------------------------------------------------------------------

export type { Language, Route };

export const ROUTES: readonly Route[] = Object.freeze(["cn_um", "cn_invention", "us_nonprovisional", "pct"]);
export const LANGUAGES: readonly Language[] = Object.freeze(["zh-CN", "en-US"]);

/** The contract's initial language and the exact handoff sentence (S03-A08). */
export const FOREIGN_DRAFT_LANGUAGE: Language = "zh-CN";
export const FOREIGN_DRAFT_WARNING = "中文准备稿，需翻译并由适格人员核对，不能直接作为该法域申请文件";
export const TRANSLATION_CAPABILITY = "translation_en";
export const TRANSLATION_UNAVAILABLE_REASON = "R1 本机构没有可用的英文翻译与适格人员核对能力，暂不提供英文准备稿。";

/** S03 keeps EP out of the route enum; EP is a human service need (S12). */
export const EP_ROUTE_MESSAGE = "EP 不是可生成的目标路线，请改为人工服务需求；系统不会把它映射到其他路线。";
export const UNKNOWN_ROUTE_MESSAGE = "不支持的申请路线，尚未保存。";

export const UNVERIFIED_LABEL = "未核实";
export const TARGET_BUSY_MESSAGE = "同一请求正在处理中，请稍候再试。";

export type TargetErrorCode =
  | "INVALID_INPUT"
  | "RESOURCE_NOT_FOUND"
  | "VERSION_CONFLICT"
  | "IDEMPOTENCY_CONFLICT"
  | "INVALID_TRANSITION"
  | "CAPABILITY_UNAVAILABLE"
  | "STORAGE_UNAVAILABLE";

export interface TargetFieldError {
  path: string;
  reason: string;
}

export interface TargetFailure {
  code: TargetErrorCode;
  message: string;
  fields?: readonly TargetFieldError[];
  /** The version the caller is now behind when the code is VERSION_CONFLICT. */
  latestVersion?: number;
}

export type TargetResult<T> = { ok: true; data: T; replayed: boolean } | { ok: false; error: TargetFailure };

export const TARGET_ERROR_MESSAGES: Readonly<Record<TargetErrorCode, string>> = Object.freeze({
  INVALID_INPUT: "输入有误，尚未保存。",
  RESOURCE_NOT_FOUND: "目标或案件不可用。",
  VERSION_CONFLICT: "目标已被其他操作更新，尚未保存。请刷新后重试。",
  IDEMPOTENCY_CONFLICT: "这次提交与之前的同号请求内容不同，请刷新后重试。",
  INVALID_TRANSITION: "案件已归档，不能修改目标。",
  CAPABILITY_UNAVAILABLE: "所需能力当前不可用。",
  STORAGE_UNAVAILABLE: "本机存储暂时不可用，内容没有保存。",
});

// ---------------------------------------------------------------------------
// Route catalog and rule pack
// ---------------------------------------------------------------------------

export interface RouteCapability {
  key: string;
  state: "available" | "unavailable";
  reason: string;
}

export interface RouteDescriptor {
  route: Route;
  label: string;
  protection: string;
  examination: string;
  foreign: boolean;
  limits: readonly RouteCapability[];
}

const LOCAL_LIMIT: RouteCapability = Object.freeze({
  key: "local_preparation",
  state: "available",
  reason: "R1 本地浏览器版只生成中文准备稿。",
});

const NO_FILING_LIMIT: RouteCapability = Object.freeze({
  key: "foreign_filing",
  state: "unavailable",
  reason: "R1 不办理外国申请、翻译或代理递交。",
});

export const ROUTE_CATALOG: Readonly<Record<Route, RouteDescriptor>> = Object.freeze({
  cn_um: Object.freeze({
    route: "cn_um",
    label: "中国实用新型",
    protection: "产品的形状、构造或其结合",
    examination: "初步审查（形式审查），不进行实质审查",
    foreign: false,
    limits: Object.freeze([LOCAL_LIMIT]),
  }),
  cn_invention: Object.freeze({
    route: "cn_invention",
    label: "中国发明",
    protection: "产品、方法或其改进",
    examination: "实质审查",
    foreign: false,
    limits: Object.freeze([LOCAL_LIMIT]),
  }),
  us_nonprovisional: Object.freeze({
    route: "us_nonprovisional",
    label: "美国非临时申请",
    protection: "美国法下的发明（发明人或其受让人）",
    examination: "美国专利商标局实质审查",
    foreign: true,
    limits: Object.freeze([LOCAL_LIMIT, NO_FILING_LIMIT]),
  }),
  pct: Object.freeze({
    route: "pct",
    label: "PCT 国际申请",
    protection: "PCT 受理局受理的国际申请",
    examination: "国际检索与初步审查，随后进入各国家阶段",
    foreign: true,
    limits: Object.freeze([LOCAL_LIMIT, NO_FILING_LIMIT]),
  }),
});

/** A rule-pack entry: the contract Rule plus the route it governs. */
export interface RouteRule extends Rule {
  route: Route;
  /** Only a `verified` entry may expose gated numbers (S03-A07). */
  cycle: { value: string | null; note: string | null } | null;
  fee: { value: string | null; note: string | null } | null;
  term: { value: string | null; note: string | null } | null;
}

export interface RulePack {
  version: string;
  rules: readonly RouteRule[];
}

function routeRule(
  route: Route,
  verification: Rule["verification"],
  numbers: { cycle?: string; fee?: string; term?: string } = {},
): RouteRule {
  return Object.freeze({
    id: `v6.r1.route.${route}`,
    packVersion: "v6-r1",
    category: "policy",
    authority: "engineering",
    verification,
    jurisdiction: route,
    documentKind: "route",
    action: "prepare",
    basisUrl: null,
    citation: null,
    effectiveFrom: null,
    effectiveTo: null,
    verifiedBy: null,
    verifiedAt: null,
    route,
    cycle: numbers.cycle === undefined ? null : { value: numbers.cycle, note: null },
    fee: numbers.fee === undefined ? null : { value: numbers.fee, note: null },
    term: numbers.term === undefined ? null : { value: numbers.term, note: null },
  });
}

/**
 * R1's local rule pack. Every entry is `unverified`, so no cycle, fee or term
 * number is shown anywhere: the project has no verified route rule yet, and an
 * estimate would be an invented number. A future verified pack (or a test
 * fixture) unlocks the gated slots by marking its entry `verified`.
 */
export const R1_RULE_PACK: RulePack = Object.freeze({
  version: "v6-r1",
  rules: Object.freeze([
    routeRule("cn_um", "unverified"),
    routeRule("cn_invention", "unverified"),
    routeRule("us_nonprovisional", "unverified"),
    routeRule("pct", "unverified"),
  ]),
});

export function ruleForRoute(pack: RulePack, route: Route): RouteRule | null {
  return pack.rules.find((rule) => rule.route === route) ?? null;
}

// ---------------------------------------------------------------------------
// Deterministic recommendation (S03, no model)
// ---------------------------------------------------------------------------

export type Maturity = "tested_sample" | "drawing" | "idea";

export interface RecommendationFact {
  id: string;
  kind: (typeof factKindSchema.options)[number];
  statement: string;
}

export type RecommendationTrigger =
  | { kind: "fact"; factId: string; factKind: RecommendationFact["kind"] }
  | { kind: "maturity"; value: Maturity };

export interface AppliedRule {
  ruleId: string;
  label: string;
  recommend: readonly Route[];
  exclude: readonly Route[];
  triggers: readonly RecommendationTrigger[];
}

export interface RouteRecommendation {
  /** Whether any route is recommended from the current facts and answers. */
  recommended: readonly Route[];
  rules: readonly AppliedRule[];
  /** Routes that a triggered rule explicitly excludes, with the rule that did. */
  excluded: readonly { route: Route; ruleId: string; label: string; triggers: readonly RecommendationTrigger[] }[];
  /** True when no route-specific rule fired; the cards still render. */
  fallback: boolean;
}

export const MATURITY_LABELS: Readonly<Record<Maturity, string>> = Object.freeze({
  tested_sample: "已有测试样机",
  drawing: "已有图纸",
  idea: "仅有想法",
});

export const FACT_KIND_LABELS: Readonly<Record<RecommendationFact["kind"], string>> = Object.freeze({
  problem: "问题",
  structure: "结构",
  method: "方法",
  effect: "效果",
  parameter: "参数",
  material: "材料",
});

function isStructureMaturity(value: unknown): value is "tested_sample" | "drawing" {
  return value === "tested_sample" || value === "drawing";
}

function factTriggers(facts: readonly RecommendationFact[]): RecommendationTrigger[] {
  return facts.map((fact) => ({ kind: "fact", factId: fact.id, factKind: fact.kind }));
}

/**
 * S03: a structure fact plus a tested sample or drawing recommends `cn_um` and
 * lists `cn_invention`; a method fact or `maturity=idea` excludes `cn_um`. The
 * result carries the rule ids and the triggering facts or answer, so the panel
 * can show why. This is pure: same input, same output, no model, no clock.
 */
export function recommendRoutes(
  facts: readonly RecommendationFact[],
  maturity: Maturity | null,
): RouteRecommendation {
  const structureFacts = facts.filter((fact) => fact.kind === "structure");
  const methodFacts = facts.filter((fact) => fact.kind === "method");
  const applied: AppliedRule[] = [];

  if (structureFacts.length > 0 && isStructureMaturity(maturity)) {
    applied.push({
      ruleId: "structure_evidence_utility_model",
      label: "结构类事实，且已有测试样机或图纸",
      recommend: ["cn_um", "cn_invention"],
      exclude: [],
      triggers: [...factTriggers(structureFacts), { kind: "maturity", value: maturity }],
    });
  }
  if (methodFacts.length > 0) {
    applied.push({
      ruleId: "method_blocks_utility_model",
      label: "存在方法类事实，不推荐实用新型",
      recommend: [],
      exclude: ["cn_um"],
      triggers: factTriggers(methodFacts),
    });
  }
  if (maturity === "idea") {
    applied.push({
      ruleId: "idea_blocks_utility_model",
      label: "成熟度为想法，不推荐实用新型",
      recommend: [],
      exclude: ["cn_um"],
      triggers: [{ kind: "maturity", value: "idea" }],
    });
  }

  const excluded = new Map<Route, { route: Route; ruleId: string; label: string; triggers: readonly RecommendationTrigger[] }>();
  for (const rule of applied) {
    for (const route of rule.exclude) {
      if (!excluded.has(route)) {
        excluded.set(route, { route, ruleId: rule.ruleId, label: rule.label, triggers: rule.triggers });
      }
    }
  }
  const candidates = new Set<Route>();
  for (const rule of applied) for (const route of rule.recommend) candidates.add(route);
  for (const route of excluded.keys()) candidates.delete(route);
  return {
    recommended: [...candidates],
    rules: applied,
    excluded: [...excluded.values()],
    fallback: applied.length === 0,
  };
}

// ---------------------------------------------------------------------------
// Route cards
// ---------------------------------------------------------------------------

export interface GatedNumber {
  /** Null whenever the rule entry is not `verified`: never an estimate. */
  value: string | null;
  note: string | null;
  verified: boolean;
  label: string;
}

export interface RouteCard {
  route: Route;
  label: string;
  protection: string;
  examination: string;
  limits: readonly RouteCapability[];
  /** The rule entry's verification state; `null` when the pack lacks the route. */
  verification: Rule["verification"] | null;
  verificationLabel: string;
  ruleId: string | null;
  recommended: boolean;
  excludedBy: { ruleId: string; label: string; triggers: readonly RecommendationTrigger[] } | null;
  foreign: boolean;
  /** Exact handoff sentence for US/PCT; null for domestic routes. */
  foreignWarning: string | null;
  defaultLanguage: Language;
  languageOptions: readonly { value: Language; label: string; disabled: boolean; reason: string | null }[];
  cycle: GatedNumber;
  fee: GatedNumber;
  term: GatedNumber;
}

const VERIFICATION_LABELS: Readonly<Record<Rule["verification"], string>> = Object.freeze({
  verified: "已核实",
  unverified: UNVERIFIED_LABEL,
  expired: "已过期",
});

function gatedNumber(value: string | null, note: string | null, rule: RouteRule | null, label: string): GatedNumber {
  const verified = rule?.verification === "verified";
  return { value: verified ? value : null, note: verified ? note : null, verified, label };
}

export interface Capability {
  key: string;
  state: "available" | "unavailable";
  reason: string | null;
  evidenceVersion: string | null;
}

/** Contract-shaped capabilities. R1 has no translation capability. */
export function buildCapabilities(): readonly Capability[] {
  return Object.freeze([
    {
      key: "local_preparation",
      state: "available" as const,
      reason: null,
      evidenceVersion: "v6-r1",
    },
    {
      key: TRANSLATION_CAPABILITY,
      state: "unavailable" as const,
      reason: TRANSLATION_UNAVAILABLE_REASON,
      evidenceVersion: "v6-r1",
    },
    {
      key: "foreign_filing",
      state: "unavailable" as const,
      reason: "R1 不办理外国申请、翻译或代理递交，需要人工服务。",
      evidenceVersion: "v6-r1",
    },
  ]);
}

export function capabilityOf(capabilities: readonly Capability[], key: string): Capability | null {
  return capabilities.find((capability) => capability.key === key) ?? null;
}

export function translationAvailable(capabilities: readonly Capability[]): boolean {
  return capabilityOf(capabilities, TRANSLATION_CAPABILITY)?.state === "available";
}

/** The language picker's options: `en-US` is selectable only with the capability. */
export function languageOptions(
  capabilities: readonly Capability[],
  route: Route,
): RouteCard["languageOptions"] {
  const translation = capabilityOf(capabilities, TRANSLATION_CAPABILITY);
  const translationReason =
    translation === null ? "能力清单中没有英文翻译能力，暂不提供英文准备稿。" : translation.reason;
  const options: { value: Language; label: string; disabled: boolean; reason: string | null }[] = [
    { value: "zh-CN", label: "中文（zh-CN）", disabled: false, reason: null },
    {
      value: "en-US",
      label: "英文（en-US）",
      disabled: translation?.state !== "available",
      reason: translation?.state === "available" ? null : translationReason,
    },
  ];
  return options.map((option) => ({ ...option }));
}

/** Why a route may not be created at all, if any (EP is refused, never mapped). */
export function routeProblem(route: unknown): { path: string; reason: string } | null {
  if (typeof route !== "string" || route.trim().length === 0) {
    return { path: "route", reason: "请选择申请路线。" };
  }
  if (route.trim().toUpperCase() === "EP" || route.trim().toLowerCase() === "european") {
    return { path: "route", reason: EP_ROUTE_MESSAGE };
  }
  if (!routeSchema.safeParse(route).success) {
    return { path: "route", reason: UNKNOWN_ROUTE_MESSAGE };
  }
  return null;
}

export function routeCards(
  recommendation: RouteRecommendation,
  capabilities: readonly Capability[],
  pack: RulePack = R1_RULE_PACK,
): readonly RouteCard[] {
  return ROUTES.map((route) => {
    const descriptor = ROUTE_CATALOG[route];
    const rule = ruleForRoute(pack, route);
    const excluded = recommendation.excluded.find((item) => item.route === route) ?? null;
    return {
      route,
      label: descriptor.label,
      protection: descriptor.protection,
      examination: descriptor.examination,
      limits: descriptor.limits,
      verification: rule?.verification ?? null,
      verificationLabel: rule === null ? UNVERIFIED_LABEL : VERIFICATION_LABELS[rule.verification],
      ruleId: rule?.id ?? null,
      recommended: recommendation.recommended.includes(route),
      excludedBy: excluded === null ? null : { ruleId: excluded.ruleId, label: excluded.label, triggers: excluded.triggers },
      foreign: descriptor.foreign,
      foreignWarning: descriptor.foreign ? FOREIGN_DRAFT_WARNING : null,
      defaultLanguage: descriptor.foreign ? FOREIGN_DRAFT_LANGUAGE : "zh-CN",
      languageOptions: languageOptions(capabilities, route),
      cycle: gatedNumber(rule?.cycle?.value ?? null, rule?.cycle?.note ?? null, rule, "周期"),
      fee: gatedNumber(rule?.fee?.value ?? null, rule?.fee?.note ?? null, rule, "费用"),
      term: gatedNumber(rule?.term?.value ?? null, rule?.term?.note ?? null, rule, "保护期"),
    };
  });
}

// ---------------------------------------------------------------------------
// Reads: the targets view
// ---------------------------------------------------------------------------

export interface TargetSnapshot {
  parties: readonly Party[];
  facts: readonly RecommendationFact[];
  maturity: Maturity | null;
}

export type SnapshotOutcome =
  | { ok: true; snapshot: TargetSnapshot }
  | { ok: false; error: TargetFailure };

function emptyTargetSnapshot(): TargetSnapshot {
  return { parties: [], facts: [], maturity: null };
}

/**
 * The current matter snapshot: the `intake/snapshot` row at `sourceVersion`
 * (V6-13's key). A snapshot that exists but is unreadable is an error, not an
 * empty form: targets must not be validated against invented state.
 */
export async function readTargetSnapshot(
  repository: LocalRepository,
  matterId: string,
  sourceVersion: number,
): Promise<SnapshotOutcome> {
  try {
    const raw = await repository.backend.transaction("readonly", async (tx) =>
      tx.get(STORES.blobs, snapshotKey(matterId, sourceVersion)),
    );
    if (raw === undefined) return { ok: true, snapshot: emptyTargetSnapshot() };
    if (typeof raw !== "object" || raw === null || (raw as { kind?: unknown }).kind !== "intake.snapshot") {
      return { ok: false, error: failure("STORAGE_UNAVAILABLE") };
    }
    const parsed = sourceSnapshotSchema.safeParse((raw as { snapshot?: unknown }).snapshot);
    if (
      !parsed.success ||
      parsed.data.matterId !== matterId ||
      parsed.data.version !== sourceVersion
    ) {
      return { ok: false, error: failure("STORAGE_UNAVAILABLE") };
    }
    return {
      ok: true,
      snapshot: {
        parties: parsed.data.parties,
        facts: parsed.data.facts.map((fact) => ({
          id: fact.id,
          kind: fact.kind,
          statement: fact.statement,
        })),
        maturity: parsed.data.answers.maturity,
      },
    };
  } catch {
    return { ok: false, error: failure("STORAGE_UNAVAILABLE") };
  }
}

function snapshotKey(matterId: string, version: number): string {
  return `intake/snapshot/${matterId}/${version}`;
}

/**
 * One config row per write attempt. `writeId` is the id of the event that
 * attempt commits, so two writers of the same version never share a row: the
 * committed event names the authoritative row and an orphan stays invisible.
 */
export function targetConfigKey(
  tenantId: string,
  matterId: string,
  targetId: string,
  version: number,
  writeId: string,
): string {
  return [
    "targets/config",
    encodeURIComponent(tenantId),
    encodeURIComponent(matterId),
    encodeURIComponent(targetId),
    String(version),
    encodeURIComponent(writeId),
  ].join("/");
}

export interface TargetConfigRow {
  kind: "target.config";
  tenantId: string;
  matterId: string;
  targetId: string;
  config: TargetConfig;
  at: string;
}

function asConfigRow(value: unknown): TargetConfigRow | null {
  if (typeof value !== "object" || value === null) return null;
  const row = value as Partial<TargetConfigRow>;
  if (row.kind !== "target.config") return null;
  if (typeof row.tenantId !== "string" || typeof row.matterId !== "string" || typeof row.targetId !== "string") {
    return null;
  }
  const parsed = targetConfigSchema.safeParse(row.config);
  if (!parsed.success) return null;
  return row as TargetConfigRow;
}

export async function readConfigRow(
  repository: LocalRepository,
  tenantId: string,
  matterId: string,
  targetId: string,
  version: number,
  writeId: string,
): Promise<TargetResult<TargetConfigRow | null>> {
  try {
    const raw = await repository.backend.transaction("readonly", async (tx) =>
      tx.get(STORES.blobs, targetConfigKey(tenantId, matterId, targetId, version, writeId)),
    );
    if (raw === undefined) return success(null);
    const row = asConfigRow(raw);
    if (row === null) return fail("STORAGE_UNAVAILABLE", { message: "本机保存的目标配置不可读。" });
    return success(row);
  } catch {
    return fail("STORAGE_UNAVAILABLE");
  }
}

/**
 * The committed write behind each `targetId/version`: the id of the
 * `target.created` or `target.config_updated` event that moved the target to
 * that version. Only these rows are authoritative.
 */
export async function committedWriteIds(
  repository: LocalRepository,
  actor: Actor,
  matterId: string,
): Promise<TargetResult<ReadonlyMap<string, string>>> {
  const listed = await repository.listEvents(actor, matterId);
  if (!listed.ok) return { ok: false, error: mapRepositoryError(listed.error) };
  const ids = new Map<string, string>();
  for (const event of listed.data.items) {
    if (event.action !== "target.created" && event.action !== "target.config_updated") continue;
    if (event.targetId === null || typeof event.metadata.version !== "number") continue;
    ids.set(`${event.targetId}/${event.metadata.version}`, event.id);
  }
  return success(ids);
}

export interface TargetView {
  id: string;
  /** 1-based position in the matter's target list; the label the chips use. */
  label: string;
  status: "active" | "archived";
  configVersion: number;
  /** The config revision the aggregate's `configVersion` points at, or null. */
  config: TargetConfig | null;
  /** False when the pointed-at config row is missing or names another version. */
  configAvailable: boolean;
}

export interface TargetsView {
  matterId: string;
  matterVersion: number;
  matterStatus: "active" | "archived" | "deletion_pending";
  sourceVersion: number;
  targets: readonly TargetView[];
  routeCards: readonly RouteCard[];
  recommendation: RouteRecommendation;
  /** Whether a recommendation is filled in for a new target. */
  recommended: boolean;
  parties: readonly Party[];
  /** Matter assets a priority claim may point at as evidence. */
  evidenceAssets: readonly { id: string; name: string }[];
  capabilities: readonly Capability[];
  /** True when the matter snapshot exists but no facts/parties are recorded yet. */
  snapshotEmpty: boolean;
}

export type TargetsReadOutcome = { ok: true; view: TargetsView } | { ok: false; error: TargetFailure };

/**
 * The read side. Switching or refreshing a target only reads: this function
 * never writes a matter version, a `configVersion`, an event or a row.
 */
export async function loadTargetsView(
  repository: LocalRepository,
  actor: Actor,
  matterId: string,
  pack: RulePack = R1_RULE_PACK,
): Promise<TargetsReadOutcome> {
  const loaded = await repository.loadMatter(actor, matterId);
  if (!loaded.ok) return { ok: false, error: mapRepositoryError(loaded.error) };
  const aggregate = loaded.data.data;
  const snapshot = await readTargetSnapshot(repository, matterId, aggregate.matter.sourceVersion);
  if (!snapshot.ok) return snapshot;

  const writes = await committedWriteIds(repository, actor, matterId);
  if (!writes.ok) return writes;
  const targets: TargetView[] = [];
  for (const [index, target] of aggregate.targets.entries()) {
    const writeId = writes.data.get(`${target.id}/${target.configVersion}`) ?? null;
    let config: TargetConfig | null = null;
    if (writeId !== null) {
      const row = await readConfigRow(repository, actor.tenantId, matterId, target.id, target.configVersion, writeId);
      if (!row.ok) return row;
      config = row.data?.config ?? null;
    }
    targets.push({
      id: target.id,
      label: `目标 ${index + 1}`,
      status: target.status,
      configVersion: target.configVersion,
      config,
      configAvailable: config !== null && config.targetId === target.id && config.version === target.configVersion,
    });
  }

  const capabilities = buildCapabilities();
  const recommendation = recommendRoutes(snapshot.snapshot.facts, snapshot.snapshot.maturity);
  return {
    ok: true,
    view: {
      matterId,
      matterVersion: aggregate.matter.version,
      matterStatus: aggregate.matter.status,
      sourceVersion: aggregate.matter.sourceVersion,
      targets,
      routeCards: routeCards(recommendation, capabilities, pack),
      recommendation,
      recommended: recommendation.recommended.length > 0,
      parties: snapshot.snapshot.parties,
      evidenceAssets: aggregate.assets
        .filter(usableEvidence)
        .map((asset) => ({ id: asset.id, name: asset.originalName })),
      capabilities,
      snapshotEmpty:
        snapshot.snapshot.parties.length === 0 &&
        snapshot.snapshot.facts.length === 0 &&
        snapshot.snapshot.maturity === null,
    },
  };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface PriorityClaimInput {
  country: string;
  applicationNumber: string;
  filedOn: string;
  evidenceAssetId?: string | null;
  verification?: "unverified" | "human_confirmed";
}

export interface TargetConfigInput {
  route: string;
  language?: string;
  applicantIds: readonly string[];
  inventorIds: readonly string[];
  priorityClaims: readonly PriorityClaimInput[];
}

interface NormalizedConfigFields {
  route: Route;
  language: Language;
  applicantIds: string[];
  inventorIds: string[];
  priorityClaims: TargetConfig["priorityClaims"];
}

function fieldFailure(fields: readonly TargetFieldError[]): TargetFailure {
  return { ...failure("INVALID_INPUT"), fields };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringList(value: unknown, path: string, fields: TargetFieldError[]): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    fields.push({ path, reason: "必须是人员 id 列表" });
    return [];
  }
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string" || item.trim().length === 0) {
      fields.push({ path, reason: "人员 id 不能为空" });
      continue;
    }
    if (seen.has(item)) {
      fields.push({ path, reason: `人员 ${item} 重复` });
      continue;
    }
    seen.add(item);
    ids.push(item);
  }
  return ids;
}

/**
 * Shape validation that needs no matter state: route, language, id lists and
 * priority claim syntax. Party existence, inventor kind and evidence ownership
 * are checked by `validateAgainstMatter`.
 */
export function normalizeConfigInput(
  raw: unknown,
  capabilities: readonly Capability[] = buildCapabilities(),
): { ok: true; config: NormalizedConfigFields } | { ok: false; fields: readonly TargetFieldError[] } {
  const fields: TargetFieldError[] = [];
  if (!isRecord(raw)) {
    return { ok: false, fields: [{ path: "config", reason: "目标配置格式不正确" }] };
  }
  const problem = routeProblem(raw.route);
  if (problem !== null) fields.push(problem);
  const route = problem === null ? (raw.route as Route) : null;

  let language: Language = route !== null && ROUTE_CATALOG[route].foreign ? FOREIGN_DRAFT_LANGUAGE : "zh-CN";
  if (raw.language !== undefined && raw.language !== null) {
    const parsed = languageSchema.safeParse(raw.language);
    if (!parsed.success) {
      fields.push({ path: "language", reason: "语言只能是 zh-CN 或 en-US" });
    } else {
      language = parsed.data;
    }
  }
  if (route !== null) {
    const options = languageOptions(capabilities, route);
    const option = options.find((candidate) => candidate.value === language);
    if (option?.disabled) {
      fields.push({ path: "language", reason: option.reason ?? TARGET_ERROR_MESSAGES.CAPABILITY_UNAVAILABLE });
    }
  }

  const applicantIds = stringList(raw.applicantIds, "applicantIds", fields);
  const inventorIds = stringList(raw.inventorIds, "inventorIds", fields);

  const priorityClaims: TargetConfig["priorityClaims"] = [];
  const claims = raw.priorityClaims ?? [];
  if (!Array.isArray(claims)) {
    fields.push({ path: "priorityClaims", reason: "优先权声明必须是列表" });
  } else {
    for (const [index, claim] of claims.entries()) {
      const path = `priorityClaims.${index}`;
      if (!isRecord(claim)) {
        fields.push({ path, reason: "优先权声明格式不正确" });
        continue;
      }
      const country = typeof claim.country === "string" ? claim.country.trim() : "";
      if (country.length === 0) fields.push({ path: `${path}.country`, reason: "优先权国家不能为空" });
      const applicationNumber =
        typeof claim.applicationNumber === "string" ? claim.applicationNumber.trim() : "";
      if (applicationNumber.length === 0) {
        fields.push({ path: `${path}.applicationNumber`, reason: "优先权申请号不能为空" });
      }
      const filedOn = typeof claim.filedOn === "string" ? claim.filedOn : "";
      if (!isLocalDate(filedOn)) {
        fields.push({ path: `${path}.filedOn`, reason: "优先权日必须是真实的 YYYY-MM-DD 日历日期" });
      }
      let evidenceAssetId: string | null = null;
      if (claim.evidenceAssetId !== undefined && claim.evidenceAssetId !== null) {
        if (typeof claim.evidenceAssetId !== "string" || claim.evidenceAssetId.trim().length === 0) {
          fields.push({ path: `${path}.evidenceAssetId`, reason: "证据材料 id 格式不正确" });
        } else {
          evidenceAssetId = claim.evidenceAssetId;
        }
      }
      let verification: "unverified" | "human_confirmed" = "unverified";
      if (claim.verification !== undefined && claim.verification !== null) {
        if (claim.verification !== "unverified" && claim.verification !== "human_confirmed") {
          fields.push({ path: `${path}.verification`, reason: "核实状态只能是 unverified 或 human_confirmed" });
        } else {
          verification = claim.verification;
        }
      }
      priorityClaims.push({ country, applicationNumber, filedOn, evidenceAssetId, verification });
    }
  }

  if (fields.length > 0) return { ok: false, fields };
  return {
    ok: true,
    config: {
      route: route as Route,
      language,
      applicantIds,
      inventorIds,
      priorityClaims,
    },
  };
}

/**
 * State validation against the matter's current snapshot and assets. Applicant
 * and inventor ids must be parties of this matter; an inventor must be a person;
 * a priority claim's evidence asset must be one of the matter's own assets.
 */
/** Only an asset whose bytes are present and clean can back a priority claim. */
export function usableEvidence(asset: Pick<AssetRecord, "state">): boolean {
  return asset.state === "available";
}

export function validateAgainstMatter(
  config: NormalizedConfigFields,
  snapshot: TargetSnapshot,
  assets: readonly AssetRecord[],
): TargetFailure | null {
  const fields: TargetFieldError[] = [];
  const parties = new Map<string, Party>();
  for (const party of snapshot.parties) {
    const parsed = partySchema.safeParse(party);
    if (parsed.success) parties.set(parsed.data.id, parsed.data);
  }
  for (const id of config.applicantIds) {
    if (!parties.has(id)) {
      fields.push({ path: "applicantIds", reason: `申请人 ${id} 不是本案已添加的人员` });
    }
  }
  for (const id of config.inventorIds) {
    const party = parties.get(id);
    if (party === undefined) {
      fields.push({ path: "inventorIds", reason: `发明人 ${id} 不是本案已添加的人员` });
    } else if (party.kind !== "person") {
      fields.push({ path: "inventorIds", reason: `发明人 ${id} 必须是自然人` });
    }
  }
  const byId = new Map(assets.map((asset) => [asset.id, asset]));
  for (const [index, claim] of config.priorityClaims.entries()) {
    if (claim.evidenceAssetId === null) continue;
    const asset = byId.get(claim.evidenceAssetId);
    if (asset === undefined) {
      fields.push({
        path: `priorityClaims.${index}.evidenceAssetId`,
        reason: `证据材料 ${claim.evidenceAssetId} 不属于本案`,
      });
    } else if (!usableEvidence(asset)) {
      fields.push({
        path: `priorityClaims.${index}.evidenceAssetId`,
        reason: `证据材料 ${claim.evidenceAssetId} 当前不可用（${asset.state}），不能作为优先权证据`,
      });
    }
  }
  return fields.length === 0 ? null : fieldFailure(fields);
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function success<T>(data: T, replayed = false): TargetResult<T> {
  return { ok: true, data, replayed };
}

function failure(code: TargetErrorCode, extra: Omit<Partial<TargetFailure>, "code"> = {}): TargetFailure {
  return { code, message: extra.message ?? TARGET_ERROR_MESSAGES[code], ...extra };
}

function fail(code: TargetErrorCode, extra: Omit<Partial<TargetFailure>, "code"> = {}): { ok: false; error: TargetFailure } {
  return { ok: false, error: failure(code, extra) };
}

function mapRepositoryError(error: RepositoryError): TargetFailure {
  switch (error.code) {
    case "RESOURCE_NOT_FOUND":
      return failure("RESOURCE_NOT_FOUND");
    case "INVALID_TRANSITION":
      return failure("INVALID_TRANSITION");
    case "VERSION_CONFLICT":
      return failure("VERSION_CONFLICT", { latestVersion: error.latestVersion });
    case "INVALID_INPUT":
      return failure("INVALID_INPUT", { message: error.message });
    default:
      return failure("STORAGE_UNAVAILABLE");
  }
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (isRecord(value)) {
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const item = value[key];
      if (item !== undefined) output[key] = canonical(item);
    }
    return output;
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonical(value));
}

const REQUEST_KEY_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const CREATE_OPERATION = "target.create" as const;
const UPDATE_OPERATION = "target.config.update" as const;
const CLAIM_LEASE_MS = 30_000;
const CLAIM_WAIT_MS = 500;
const CLAIM_POLL_MS = 25;
const MAX_COMMIT_ATTEMPTS = 3;

export interface TargetWriteOptions {
  /** Optional request key; reused keys replay or conflict per 05-contracts §2. */
  requestKey?: string | null;
  now?: () => string;
  /** Id source for a keyless create; keyed creates derive their id. */
  newId?: () => string;
}

function normalizeRequestKey(value: string | null | undefined): TargetResult<string | null> {
  if (value === undefined || value === null) return success(null);
  if (typeof value !== "string" || !REQUEST_KEY_PATTERN.test(value)) {
    return {
      ok: false,
      error: fieldFailure([{ path: "requestKey", reason: "请求键必须是 1 到 128 个字母、数字或 . _ : - 字符" }]),
    };
  }
  return success(value);
}

function deriveId(seed: string): Promise<string> {
  return sha256Hex(new TextEncoder().encode(seed)).then((digest) => {
    const hex = digest.slice(0, 32).split("");
    hex[12] = "5";
    hex[16] = "8";
    const raw = hex.join("");
    return `${raw.slice(0, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}-${raw.slice(16, 20)}-${raw.slice(20, 32)}`;
  });
}

// ---------------------------------------------------------------------------
// Idempotency: atomic claim → business write → owner-checked finalize
// ---------------------------------------------------------------------------

type TargetOperation = typeof CREATE_OPERATION | typeof UPDATE_OPERATION;
type IdempotencyState = "pending" | "completed";

interface IdempotencyRecord {
  kind: "targets.idempotency";
  tenantId: string;
  actorId: string;
  operation: TargetOperation;
  matterId: string;
  targetId: string | null;
  requestKey: string;
  requestHash: string;
  at: string;
  state: IdempotencyState;
  claimId?: string;
  leaseExpiresAt?: string;
  preparedResponse?: unknown;
  response?: unknown;
}

function idempotencyKey(actor: Actor, operation: TargetOperation, requestKey: string): string {
  return [
    "targets/idempotency",
    encodeURIComponent(actor.tenantId),
    encodeURIComponent(actor.userId),
    operation,
    requestKey,
  ].join("/");
}

function asIdempotencyRecord(value: unknown): IdempotencyRecord | null {
  if (!isRecord(value) || value.kind !== "targets.idempotency") return null;
  if (
    typeof value.tenantId !== "string" ||
    typeof value.actorId !== "string" ||
    (value.operation !== CREATE_OPERATION && value.operation !== UPDATE_OPERATION) ||
    typeof value.matterId !== "string" ||
    typeof value.requestKey !== "string" ||
    typeof value.requestHash !== "string" ||
    (value.state !== "pending" && value.state !== "completed")
  ) {
    return null;
  }
  return value as unknown as IdempotencyRecord;
}

function idempotencyState(record: IdempotencyRecord): IdempotencyState {
  return record.state === "completed" ? "completed" : "pending";
}

function pendingIdempotency(
  actor: Actor,
  operation: TargetOperation,
  matterId: string,
  targetId: string | null,
  requestKey: string,
  requestHash: string,
  claimId: string,
  nowMs: number,
): IdempotencyRecord {
  return {
    kind: "targets.idempotency",
    tenantId: actor.tenantId,
    actorId: actor.userId,
    operation,
    matterId,
    targetId,
    requestKey,
    requestHash,
    at: new Date(nowMs).toISOString(),
    state: "pending",
    claimId,
    leaseExpiresAt: new Date(nowMs + CLAIM_LEASE_MS).toISOString(),
  };
}

type ClaimOnceOutcome =
  | { kind: "claimed"; claimId: string; previous: IdempotencyRecord | null }
  | { kind: "pending"; record: IdempotencyRecord }
  | { kind: "replay"; response: unknown }
  | { kind: "conflict" }
  | { kind: "unreadable" };

async function claimOnce(
  repository: LocalRepository,
  actor: Actor,
  operation: TargetOperation,
  matterId: string,
  targetId: string | null,
  requestKey: string,
  requestHash: string,
  claimId: string,
  nowMs: number,
): Promise<TargetResult<ClaimOnceOutcome>> {
  const key = idempotencyKey(actor, operation, requestKey);
  try {
    const outcome = await repository.backend.transaction("readwrite", async (tx): Promise<ClaimOnceOutcome> => {
      const raw = await tx.get(STORES.blobs, key);
      if (raw === undefined) {
        await tx.put(
          STORES.blobs,
          key,
          pendingIdempotency(actor, operation, matterId, targetId, requestKey, requestHash, claimId, nowMs),
        );
        return { kind: "claimed", claimId, previous: null };
      }
      const existing = asIdempotencyRecord(raw);
      if (
        !existing ||
        existing.tenantId !== actor.tenantId ||
        existing.actorId !== actor.userId ||
        existing.operation !== operation ||
        existing.requestKey !== requestKey
      ) {
        return { kind: "unreadable" };
      }
      if (existing.requestHash !== requestHash) return { kind: "conflict" };
      if (idempotencyState(existing) === "completed") {
        return { kind: "replay", response: existing.response };
      }
      const leaseExpiresAt = Date.parse(existing.leaseExpiresAt ?? "");
      if (Number.isFinite(leaseExpiresAt) && leaseExpiresAt > nowMs) {
        return { kind: "pending", record: existing };
      }
      // The previous owner's lease expired. Take it over with a fresh claim id;
      // its prepared response is kept on the returned record so a landed commit
      // can still be recovered before any new business write.
      await tx.put(
        STORES.blobs,
        key,
        pendingIdempotency(actor, operation, matterId, targetId, requestKey, requestHash, claimId, nowMs),
      );
      return { kind: "claimed", claimId, previous: existing };
    });
    return success(outcome);
  } catch {
    return fail("STORAGE_UNAVAILABLE");
  }
}

async function settleClaim(
  repository: LocalRepository,
  actor: Actor,
  operation: TargetOperation,
  requestKey: string,
  requestHash: string,
  claimId: string,
  response: unknown,
): Promise<boolean> {
  const key = idempotencyKey(actor, operation, requestKey);
  try {
    return await repository.backend.transaction("readwrite", async (tx) => {
      const raw = await tx.get(STORES.blobs, key);
      const existing = raw === undefined ? null : asIdempotencyRecord(raw);
      if (!existing) return false;
      if (
        existing.tenantId !== actor.tenantId ||
        existing.actorId !== actor.userId ||
        existing.operation !== operation ||
        existing.requestKey !== requestKey ||
        existing.requestHash !== requestHash
      ) {
        return false;
      }
      if (idempotencyState(existing) === "completed") {
        return canonicalJson(existing.response) === canonicalJson(response);
      }
      if (existing.claimId !== claimId) return false;
      await tx.put(STORES.blobs, key, {
        ...existing,
        state: "completed",
        claimId: undefined,
        leaseExpiresAt: undefined,
        response,
      } satisfies IdempotencyRecord);
      return true;
    });
  } catch {
    return false;
  }
}

async function prepareClaim(
  repository: LocalRepository,
  actor: Actor,
  operation: TargetOperation,
  requestKey: string,
  requestHash: string,
  claimId: string,
  preparedResponse: unknown,
  nowMs: number,
): Promise<boolean> {
  const key = idempotencyKey(actor, operation, requestKey);
  try {
    return await repository.backend.transaction("readwrite", async (tx) => {
      const raw = await tx.get(STORES.blobs, key);
      const existing = raw === undefined ? null : asIdempotencyRecord(raw);
      if (!existing) return false;
      if (
        existing.tenantId !== actor.tenantId ||
        existing.actorId !== actor.userId ||
        existing.operation !== operation ||
        existing.requestKey !== requestKey ||
        existing.requestHash !== requestHash
      ) {
        return false;
      }
      if (idempotencyState(existing) !== "pending" || existing.claimId !== claimId) return false;
      await tx.put(STORES.blobs, key, {
        ...existing,
        preparedResponse,
        leaseExpiresAt: new Date(nowMs + CLAIM_LEASE_MS).toISOString(),
      } satisfies IdempotencyRecord);
      return true;
    });
  } catch {
    return false;
  }
}

/** Release only the caller's own pending claim; never a completed record. */
async function releaseClaim(
  repository: LocalRepository,
  actor: Actor,
  operation: TargetOperation,
  requestKey: string,
  requestHash: string,
  claimId: string,
): Promise<void> {
  const key = idempotencyKey(actor, operation, requestKey);
  try {
    await repository.backend.transaction("readwrite", async (tx) => {
      const raw = await tx.get(STORES.blobs, key);
      const existing = raw === undefined ? null : asIdempotencyRecord(raw);
      if (!existing) return;
      if (
        idempotencyState(existing) !== "pending" ||
        existing.claimId !== claimId ||
        existing.requestHash !== requestHash
      ) {
        return;
      }
      await tx.delete(STORES.blobs, key);
    });
  } catch {
    // A lingering pending claim expires after its lease; it cannot authorize.
  }
}

/** True only while the caller still owns the pending claim. */
async function claimOwned(
  repository: LocalRepository,
  actor: Actor,
  operation: TargetOperation,
  requestKey: string,
  requestHash: string,
  claimId: string,
): Promise<TargetResult<boolean>> {
  const key = idempotencyKey(actor, operation, requestKey);
  try {
    const owned = await repository.backend.transaction("readwrite", async (tx) => {
      const raw = await tx.get(STORES.blobs, key);
      const existing = raw === undefined ? null : asIdempotencyRecord(raw);
      return (
        existing !== null &&
        idempotencyState(existing) === "pending" &&
        existing.claimId === claimId &&
        existing.requestHash === requestHash
      );
    });
    return success(owned);
  } catch {
    return fail("STORAGE_UNAVAILABLE");
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(1, ms)));
}

type ClaimDecision = { kind: "claimed"; claimId: string } | { kind: "replay"; response: unknown };

/**
 * Claim before any business read-check-write. A completed record replays; a
 * different hash conflicts; a live pending lease is waited on for a bounded
 * time; an expired lease is taken over. `recover` turns a prepared claim into
 * the response a landed commit produced.
 */
async function claimIdempotency(
  repository: LocalRepository,
  actor: Actor,
  operation: TargetOperation,
  matterId: string,
  targetId: string | null,
  requestKey: string,
  requestHash: string,
  recover: (previous: IdempotencyRecord) => Promise<TargetResult<{ response: unknown } | null>>,
): Promise<TargetResult<ClaimDecision>> {
  const startedAt = Date.now();
  let rounds = 0;
  while (true) {
    rounds += 1;
    if (rounds > 100) return fail("STORAGE_UNAVAILABLE", { message: TARGET_BUSY_MESSAGE });
    const claimId = crypto.randomUUID();
    const outcome = await claimOnce(
      repository,
      actor,
      operation,
      matterId,
      targetId,
      requestKey,
      requestHash,
      claimId,
      Date.now(),
    );
    if (!outcome.ok) return outcome;
    const decision = outcome.data;
    switch (decision.kind) {
      case "unreadable":
        return fail("STORAGE_UNAVAILABLE", { message: "本机保存的请求记录不可读。" });
      case "conflict":
        return fail("IDEMPOTENCY_CONFLICT");
      case "replay":
        return success({ kind: "replay", response: decision.response });
      case "claimed": {
        if (decision.previous !== null && decision.previous.preparedResponse !== undefined) {
          const recovered = await recover(decision.previous);
          if (!recovered.ok) return recovered;
          if (recovered.data !== null) {
            const settled = await settleClaim(
              repository,
              actor,
              operation,
              requestKey,
              requestHash,
              claimId,
              recovered.data.response,
            );
            if (settled) return success({ kind: "replay", response: recovered.data.response });
            return fail("STORAGE_UNAVAILABLE");
          }
        }
        return success({ kind: "claimed", claimId });
      }
      case "pending": {
        const record = decision.record;
        if (record.preparedResponse !== undefined) {
          const recovered = await recover(record);
          if (!recovered.ok) return recovered;
          if (recovered.data !== null && record.claimId) {
            const settled = await settleClaim(
              repository,
              actor,
              operation,
              requestKey,
              requestHash,
              record.claimId,
              recovered.data.response,
            );
            if (settled) return success({ kind: "replay", response: recovered.data.response });
            continue;
          }
        }
        const elapsed = Date.now() - startedAt;
        if (elapsed >= CLAIM_WAIT_MS) return fail("STORAGE_UNAVAILABLE", { message: TARGET_BUSY_MESSAGE });
        await sleep(Math.min(CLAIM_POLL_MS, CLAIM_WAIT_MS - elapsed));
      }
    }
  }
}

/** Write one config revision row in its own transaction, before its commit. */
async function writeConfigRow(
  repository: LocalRepository,
  actor: Actor,
  matterId: string,
  config: TargetConfig,
  writeId: string,
  at: string,
): Promise<boolean> {
  const row: TargetConfigRow = {
    kind: "target.config",
    tenantId: actor.tenantId,
    matterId,
    targetId: config.targetId,
    config,
    at,
  };
  try {
    await repository.backend.transaction("readwrite", async (tx) => {
      await tx.put(
        STORES.blobs,
        targetConfigKey(actor.tenantId, matterId, config.targetId, config.version, writeId),
        row,
      );
    });
    return true;
  } catch {
    return false;
  }
}

function targetEvent(
  actor: Actor,
  matterId: string,
  targetId: string,
  eventId: string,
  action: "target.created" | "target.config_updated",
  occurredAt: string,
  version: number,
): ActivityRecord {
  return {
    id: eventId,
    tenantId: actor.tenantId,
    matterId,
    targetId,
    actorId: actor.userId,
    actorKind: "user",
    action,
    snapshot: null,
    jobId: null,
    resourceId: targetId,
    occurredAt,
    metadata: { version },
  };
}

export interface CreateTargetResult {
  target: TargetRecord;
  config: TargetConfig;
  created: boolean;
}

export interface UpdateTargetConfigResult {
  target: TargetRecord;
  config: TargetConfig;
}

function responseTarget(target: TargetRecord): TargetRecord {
  return { ...target };
}

// ---------------------------------------------------------------------------
// Writes: create
// ---------------------------------------------------------------------------

function createRequestHash(matterId: string, config: NormalizedConfigFields): Promise<string> {
  return sha256Hex(
    new TextEncoder().encode(
      canonicalJson({ operation: CREATE_OPERATION, matterId, payload: config }),
    ),
  );
}

function createEventId(actor: Actor, matterId: string, requestKey: string | null, targetId: string): Promise<string> {
  return deriveId(
    requestKey === null
      ? `v6/targets/event/created/${actor.tenantId}/${matterId}/${targetId}`
      : `v6/targets/event/created/${actor.tenantId}/${matterId}/${requestKey}`,
  );
}

/** The response of a create whose event `eventId` landed, or null if it did not. */
async function recoverCreatedAttempt(
  repository: LocalRepository,
  actor: Actor,
  matterId: string,
  eventId: string,
  preparedResponse: unknown,
): Promise<TargetResult<{ response: unknown } | null>> {
  const loaded = await repository.loadMatter(actor, matterId);
  if (!loaded.ok) return { ok: false, error: mapRepositoryError(loaded.error) };
  const events = await repository.listEvents(actor, matterId);
  if (!events.ok) return { ok: false, error: mapRepositoryError(events.error) };
  const event = events.data.items.find(
    (candidate) => candidate.id === eventId && candidate.action === "target.created",
  );
  if (!event || event.targetId === null) return success(null);
  const target = loaded.data.data.targets.find((item) => item.id === event.targetId);
  if (!target) return success(null);
  // The response describes the target as this create made it (version 1),
  // even when a later update has moved it on since.
  const created: TargetRecord = { ...target, configVersion: 1 };
  const row = await readConfigRow(repository, actor.tenantId, matterId, target.id, 1, eventId);
  if (!row.ok) return row;
  if (row.data !== null) {
    return success({
      response: { target: responseTarget(created), config: row.data.config, created: true } satisfies CreateTargetResult,
    });
  }
  // The event survives but its config row does not: replay the prepared answer
  // rather than inventing a config the matter never persisted.
  if (isRecord(preparedResponse)) {
    const parsed = targetConfigSchema.safeParse(preparedResponse.config);
    if (parsed.success) {
      return success({ response: { target: responseTarget(created), config: parsed.data, created: true } });
    }
  }
  return success(null);
}

export interface CreateTargetInput {
  config: TargetConfigInput;
}

/**
 * Create one target from a validated config. The new target always starts at
 * `configVersion: 1`, gets an empty (non-null) figure revision pointer, and is
 * appended to the matter's target list; no existing target changes. EP and
 * unknown routes are refused before any write and never mapped elsewhere.
 */
export async function createTarget(
  repository: LocalRepository,
  actor: Actor,
  matterId: string,
  input: CreateTargetInput,
  options: TargetWriteOptions = {},
): Promise<TargetResult<CreateTargetResult>> {
  if (typeof matterId !== "string" || matterId.trim().length === 0) {
    return fail("INVALID_INPUT", { message: "案件不可用。" });
  }
  const key = normalizeRequestKey(options.requestKey);
  if (!key.ok) return key;
  const requestKey = key.data;
  const now = () => (options.now ?? (() => new Date().toISOString()))();

  const capabilities = buildCapabilities();
  const shape = normalizeConfigInput(input?.config, capabilities);
  if (!shape.ok) return { ok: false, error: fieldFailure(shape.fields) };
  const requestHash = await createRequestHash(matterId, shape.config);

  let claimId: string | null = null;
  let settled = false;
  let committedToStorage = false;
  let occurrence: string | null = null;
  let targetIdForClaim: string | null = null;

  const settle = async (data: CreateTargetResult): Promise<boolean> => {
    if (claimId === null) return true;
    const stored = await settleClaim(repository, actor, CREATE_OPERATION, requestKey!, requestHash, claimId, data);
    if (stored) settled = true;
    return stored;
  };

  try {
    if (requestKey !== null) {
      targetIdForClaim = await deriveId(`v6/targets/target/${actor.tenantId}/${matterId}/${requestKey}`);
      const claim = await claimIdempotency(
        repository,
        actor,
        CREATE_OPERATION,
        matterId,
        targetIdForClaim,
        requestKey,
        requestHash,
        async (previous) =>
          recoverCreatedAttempt(
            repository,
            actor,
            matterId,
            await createEventId(actor, matterId, requestKey, targetIdForClaim!),
            previous.preparedResponse,
          ),
      );
      if (!claim.ok) return claim;
      if (claim.data.kind === "replay") {
        const parsed = parseCreateResponse(claim.data.response);
        if (parsed === null) return fail("STORAGE_UNAVAILABLE", { message: "本机保存的请求结果不可读。" });
        return success(parsed, true);
      }
      claimId = claim.data.claimId;
    }

    occurrence ??= now();
    const targetId = targetIdForClaim ?? (options.newId ? options.newId() : crypto.randomUUID());
    const loaded = await repository.loadMatter(actor, matterId);
    if (!loaded.ok) return { ok: false, error: mapRepositoryError(loaded.error) };
    const aggregate = loaded.data.data;
    if (aggregate.matter.status !== "active") return fail("INVALID_TRANSITION");

    const snapshot = await readTargetSnapshot(repository, matterId, aggregate.matter.sourceVersion);
    if (!snapshot.ok) return snapshot;
    const stateProblem = validateAgainstMatter(shape.config, snapshot.snapshot, aggregate.assets);
    if (stateProblem !== null) return { ok: false, error: stateProblem };

    const config: TargetConfig = {
      targetId,
      version: 1,
      route: shape.config.route,
      language: shape.config.language,
      purpose: "preparation",
      applicantIds: shape.config.applicantIds,
      inventorIds: shape.config.inventorIds,
      priorityClaims: shape.config.priorityClaims,
    };
    const target: TargetRecord = {
      id: targetId,
      matterId,
      status: "active",
      configVersion: 1,
      draftRevisionId: null,
      figureRevisionId: await deriveId(`v6/figures/set/${matterId}/${targetId}`),
    };
    const eventId = await createEventId(actor, matterId, requestKey, targetId);
    if (!(await writeConfigRow(repository, actor, matterId, config, eventId, occurrence))) {
      return fail("STORAGE_UNAVAILABLE");
    }
    const data: CreateTargetResult = { target, config, created: true };
    if (claimId !== null) {
      const prepared = await prepareClaim(
        repository,
        actor,
        CREATE_OPERATION,
        requestKey!,
        requestHash,
        claimId,
        data,
        Date.parse(occurrence),
      );
      if (!prepared) return fail("STORAGE_UNAVAILABLE");
    }

    for (let attempt = 0; attempt < MAX_COMMIT_ATTEMPTS; attempt += 1) {
      const current = await repository.loadMatter(actor, matterId);
      if (!current.ok) return { ok: false, error: mapRepositoryError(current.error) };
      const latest = current.data.data;
      if (latest.matter.status !== "active") return fail("INVALID_TRANSITION");
      if (claimId !== null) {
        const owned = await claimOwned(repository, actor, CREATE_OPERATION, requestKey!, requestHash, claimId);
        if (!owned.ok) return owned;
        if (!owned.data) return fail("STORAGE_UNAVAILABLE", { message: TARGET_BUSY_MESSAGE });
      }
      const committed = await repository.commit(
        actor,
        {
          contractVersion: CONTRACT_VERSION,
          expectedVersion: latest.matter.version,
          payload: {
            matter: { ...latest.matter, version: latest.matter.version + 1, updatedAt: occurrence },
            targets: [...latest.targets, target],
            assets: latest.assets,
            events: [targetEvent(actor, matterId, targetId, eventId, "target.created", occurrence, 1)],
            blobs: [],
          },
        },
        { requestId: requestKey ?? eventId },
      );
      if (committed.ok) {
        committedToStorage = true;
        if (!(await settle(data))) {
          return fail("STORAGE_UNAVAILABLE", {
            message: "目标已写入本机，但请求记录未能保存；请使用同一请求键重试以确认。",
          });
        }
        return success(data);
      }
      if (committed.error.code === "VERSION_CONFLICT") continue;
      if (committed.error.code === "INVALID_INPUT") {
        const winner = await recoverCreatedAttempt(repository, actor, matterId, eventId, data);
        if (winner.ok && winner.data !== null) {
          const parsed = parseCreateResponse(winner.data.response);
          if (parsed !== null) {
            committedToStorage = true;
            if (!(await settle(parsed))) {
              return fail("STORAGE_UNAVAILABLE", {
                message: "目标已写入本机，但请求记录未能保存；请使用同一请求键重试以确认。",
              });
            }
            return success(parsed, requestKey !== null);
          }
        }
        return fail("INVALID_INPUT", { message: "目标被本地存储拒绝，尚未保存。" });
      }
      if (committed.error.code === "INVALID_TRANSITION") return fail("INVALID_TRANSITION");
      return { ok: false, error: mapRepositoryError(committed.error) };
    }
    return fail("VERSION_CONFLICT");
  } finally {
    if (claimId !== null && !settled && !committedToStorage) {
      await releaseClaim(repository, actor, CREATE_OPERATION, requestKey!, requestHash, claimId);
    }
  }
}

function parseCreateResponse(response: unknown): CreateTargetResult | null {
  if (!isRecord(response)) return null;
  const config = targetConfigSchema.safeParse(response.config);
  if (!config.success) return null;
  const target = response.target;
  if (!isRecord(target) || typeof target.id !== "string" || typeof target.matterId !== "string") return null;
  if (typeof target.configVersion !== "number" || typeof target.figureRevisionId !== "string") return null;
  return {
    target: target as unknown as TargetRecord,
    config: config.data,
    created: response.created !== false,
  };
}

// ---------------------------------------------------------------------------
// Writes: update one target's config
// ---------------------------------------------------------------------------

function updateRequestHash(matterId: string, targetId: string, config: NormalizedConfigFields): Promise<string> {
  return sha256Hex(
    new TextEncoder().encode(
      canonicalJson({ operation: UPDATE_OPERATION, matterId, targetId, payload: config }),
    ),
  );
}

function updateEventId(actor: Actor, matterId: string, targetId: string, requestKey: string): Promise<string> {
  return deriveId(`v6/targets/event/config-updated/${actor.tenantId}/${matterId}/${targetId}/${requestKey}`);
}

/**
 * The response of an update whose event `eventId` landed, or null if it did
 * not. The event id is unique to one request (keyed) or one attempt (keyless),
 * so a matching event proves this request committed, even if the target has
 * moved on since; another writer's update never matches.
 */
async function recoverUpdatedAttempt(
  repository: LocalRepository,
  actor: Actor,
  matterId: string,
  targetId: string,
  eventId: string,
  preparedResponse: unknown,
): Promise<TargetResult<{ response: unknown } | null>> {
  if (!isRecord(preparedResponse) || !isRecord(preparedResponse.target)) return success(null);
  const preparedConfig = targetConfigSchema.safeParse(preparedResponse.config);
  const preparedVersion = preparedResponse.target.configVersion;
  if (!preparedConfig.success || typeof preparedVersion !== "number") return success(null);
  const events = await repository.listEvents(actor, matterId);
  if (!events.ok) return { ok: false, error: mapRepositoryError(events.error) };
  const event = events.data.items.find(
    (candidate) =>
      candidate.id === eventId && candidate.action === "target.config_updated" && candidate.targetId === targetId,
  );
  if (!event || event.metadata.version !== preparedVersion) return success(null);
  const row = await readConfigRow(repository, actor.tenantId, matterId, targetId, preparedVersion, eventId);
  if (!row.ok) return row;
  return success({
    response: { target: preparedResponse.target, config: row.data?.config ?? preparedConfig.data },
  });
}

export interface UpdateTargetConfigInput {
  /** The target's configVersion the caller read; a mismatch is VERSION_CONFLICT. */
  baseVersion: number;
  config: TargetConfigInput;
}

/**
 * Replace one target's config. Only that target's `configVersion` moves
 * (`+1`) and the matter version moves once; every other target keeps its
 * config and `configVersion`. One `target.config_updated` event records the
 * metadata only. Invalid configs are refused against the current snapshot.
 */
export async function updateTargetConfig(
  repository: LocalRepository,
  actor: Actor,
  matterId: string,
  targetId: string,
  input: UpdateTargetConfigInput,
  options: TargetWriteOptions = {},
): Promise<TargetResult<UpdateTargetConfigResult>> {
  if (typeof matterId !== "string" || matterId.trim().length === 0 || typeof targetId !== "string") {
    return fail("INVALID_INPUT", { message: "目标不可用。" });
  }
  if (!Number.isSafeInteger(input?.baseVersion) || input.baseVersion < 1) {
    return {
      ok: false,
      error: fieldFailure([{ path: "baseVersion", reason: "必须带上读取时的目标配置版本" }]),
    };
  }
  const key = normalizeRequestKey(options.requestKey);
  if (!key.ok) return key;
  const requestKey = key.data;
  const now = () => (options.now ?? (() => new Date().toISOString()))();

  const capabilities = buildCapabilities();
  const shape = normalizeConfigInput(input?.config, capabilities);
  if (!shape.ok) return { ok: false, error: fieldFailure(shape.fields) };
  const requestHash = await updateRequestHash(matterId, targetId, shape.config);

  let claimId: string | null = null;
  let settled = false;
  let committedToStorage = false;
  let prepared: UpdateTargetConfigResult | null = null;
  let occurrence: string | null = null;

  const settle = async (data: UpdateTargetConfigResult): Promise<boolean> => {
    if (claimId === null) return true;
    const stored = await settleClaim(repository, actor, UPDATE_OPERATION, requestKey!, requestHash, claimId, data);
    if (stored) settled = true;
    return stored;
  };

  try {
    if (requestKey !== null) {
      const claim = await claimIdempotency(
        repository,
        actor,
        UPDATE_OPERATION,
        matterId,
        targetId,
        requestKey,
        requestHash,
        async (previous) =>
          recoverUpdatedAttempt(
            repository,
            actor,
            matterId,
            targetId,
            await updateEventId(actor, matterId, targetId, requestKey),
            previous.preparedResponse,
          ),
      );
      if (!claim.ok) return claim;
      if (claim.data.kind === "replay") {
        const parsed = parseUpdateResponse(claim.data.response);
        if (parsed === null) return fail("STORAGE_UNAVAILABLE", { message: "本机保存的请求结果不可读。" });
        return success(parsed, true);
      }
      claimId = claim.data.claimId;
    }

    occurrence ??= now();
    const loaded = await repository.loadMatter(actor, matterId);
    if (!loaded.ok) return { ok: false, error: mapRepositoryError(loaded.error) };
    const aggregate = loaded.data.data;
    if (aggregate.matter.status !== "active") return fail("INVALID_TRANSITION");
    const target = aggregate.targets.find((item) => item.id === targetId && item.status === "active");
    if (!target) return fail("RESOURCE_NOT_FOUND");
    if (target.configVersion !== input.baseVersion) {
      return fail("VERSION_CONFLICT", { latestVersion: target.configVersion });
    }
    const snapshot = await readTargetSnapshot(repository, matterId, aggregate.matter.sourceVersion);
    if (!snapshot.ok) return snapshot;
    const stateProblem = validateAgainstMatter(shape.config, snapshot.snapshot, aggregate.assets);
    if (stateProblem !== null) return { ok: false, error: stateProblem };

    const config: TargetConfig = {
      targetId,
      version: target.configVersion + 1,
      route: shape.config.route,
      language: shape.config.language,
      purpose: "preparation",
      applicantIds: shape.config.applicantIds,
      inventorIds: shape.config.inventorIds,
      priorityClaims: shape.config.priorityClaims,
    };
    const updated: TargetRecord = { ...target, configVersion: config.version };
    prepared = { target: responseTarget(updated), config };
    const eventId =
      requestKey === null
        ? (options.newId ?? (() => crypto.randomUUID()))()
        : await updateEventId(actor, matterId, targetId, requestKey);
    if (!(await writeConfigRow(repository, actor, matterId, config, eventId, occurrence))) {
      return fail("STORAGE_UNAVAILABLE");
    }
    if (claimId !== null) {
      const marked = await prepareClaim(
        repository,
        actor,
        UPDATE_OPERATION,
        requestKey!,
        requestHash,
        claimId,
        prepared,
        Date.parse(occurrence),
      );
      if (!marked) return fail("STORAGE_UNAVAILABLE");
    }

    for (let attempt = 0; attempt < MAX_COMMIT_ATTEMPTS; attempt += 1) {
      const current = await repository.loadMatter(actor, matterId);
      if (!current.ok) return { ok: false, error: mapRepositoryError(current.error) };
      const latest = current.data.data;
      if (latest.matter.status !== "active") return fail("INVALID_TRANSITION");
      const latestTarget = latest.targets.find((item) => item.id === targetId);
      if (!latestTarget || latestTarget.status !== "active") return fail("RESOURCE_NOT_FOUND");
      // A live same-key owner may not have committed yet. `claimOwned` below is
      // the actual ownership gate; a version mismatch alone is not proof of a
      // foreign update, so it must not turn a waiting request into a conflict.
      if (claimId !== null) {
        const owned = await claimOwned(repository, actor, UPDATE_OPERATION, requestKey!, requestHash, claimId);
        if (!owned.ok) return owned;
        if (!owned.data) return fail("STORAGE_UNAVAILABLE", { message: TARGET_BUSY_MESSAGE });
      }
      if (latestTarget.configVersion !== input.baseVersion) {
        const winner = await recoverUpdatedAttempt(repository, actor, matterId, targetId, eventId, prepared);
        if (winner.ok && winner.data !== null) {
          const parsed = parseUpdateResponse(winner.data.response);
          if (parsed !== null) {
            committedToStorage = true;
            if (!(await settle(parsed))) {
              return fail("STORAGE_UNAVAILABLE", {
                message: "目标配置已写入本机，但请求记录未能保存；请使用同一请求键重试以确认。",
              });
            }
            return success(parsed, requestKey !== null);
          }
        }
        return fail("VERSION_CONFLICT", { latestVersion: latestTarget.configVersion });
      }
      const committed = await repository.commit(
        actor,
        {
          contractVersion: CONTRACT_VERSION,
          expectedVersion: latest.matter.version,
          payload: {
            matter: { ...latest.matter, version: latest.matter.version + 1, updatedAt: occurrence },
            targets: latest.targets.map((item) => (item.id === targetId ? updated : item)),
            assets: latest.assets,
            events: [
              targetEvent(actor, matterId, targetId, eventId, "target.config_updated", occurrence, config.version),
            ],
            blobs: [],
          },
        },
        { requestId: requestKey ?? eventId },
      );
      if (committed.ok) {
        committedToStorage = true;
        if (!(await settle(prepared))) {
          return fail("STORAGE_UNAVAILABLE", {
            message: "目标配置已写入本机，但请求记录未能保存；请使用同一请求键重试以确认。",
          });
        }
        return success(prepared);
      }
      if (committed.error.code === "VERSION_CONFLICT") continue;
      if (committed.error.code === "INVALID_INPUT") {
        // A duplicate event id means this same request already committed.
        const winner = await recoverUpdatedAttempt(repository, actor, matterId, targetId, eventId, prepared);
        if (winner.ok && winner.data !== null) {
          const parsed = parseUpdateResponse(winner.data.response);
          if (parsed !== null) {
            committedToStorage = true;
            if (!(await settle(parsed))) {
              return fail("STORAGE_UNAVAILABLE", {
                message: "目标配置已写入本机，但请求记录未能保存；请使用同一请求键重试以确认。",
              });
            }
            return success(parsed, requestKey !== null);
          }
        }
        return fail("INVALID_INPUT", { message: "目标配置被本地存储拒绝，尚未保存。" });
      }
      if (committed.error.code === "INVALID_TRANSITION") return fail("INVALID_TRANSITION");
      return { ok: false, error: mapRepositoryError(committed.error) };
    }
    return fail("VERSION_CONFLICT");
  } finally {
    if (claimId !== null && !settled && !committedToStorage) {
      await releaseClaim(repository, actor, UPDATE_OPERATION, requestKey!, requestHash, claimId);
    }
  }
}

function parseUpdateResponse(response: unknown): UpdateTargetConfigResult | null {
  if (!isRecord(response)) return null;
  const config = targetConfigSchema.safeParse(response.config);
  if (!config.success) return null;
  const target = response.target;
  if (!isRecord(target) || typeof target.id !== "string" || typeof target.matterId !== "string") return null;
  if (typeof target.configVersion !== "number" || typeof target.figureRevisionId !== "string") return null;
  return { target: target as unknown as TargetRecord, config: config.data };
}
