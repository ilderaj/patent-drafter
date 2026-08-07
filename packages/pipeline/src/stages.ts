// 18-stage pipeline definition (docs/architecture.md ADR-003).
// `deterministic` stages run pure functions; `llm` stages call the provider
// with the per-stage prompt from packages/prompts and validate with Zod.
import type { PipelineStage } from "@patent/domain";
import type { z } from "zod";
import { schemas } from "./schemas.js";
import type { PipelineContext } from "./types.js";

export type StageKind = "llm" | "deterministic" | "local";

export interface StageDef {
  id: PipelineStage;
  kind: StageKind;
  promptFile: string | null;
  deps: PipelineStage[];
  schema: z.ZodTypeAny;
  /** Pauses the runner: the web app collects answers before the next stage. */
  needsUserInput: boolean;
  /** Build the JSON input context for the LLM call. */
  inputOf: (ctx: PipelineContext) => unknown;
  /** Deterministic handler (only for kind === "deterministic"). */
  run?: (ctx: PipelineContext) => unknown;
}

/** Deterministic state derivation shared by build_invention_model. */
export function resolveFacts(ctx: PipelineContext): Array<Record<string, unknown>> {
  const base = (ctx.results.extract_invention_facts?.output as { facts: Array<Record<string, unknown>> } | undefined)?.facts ?? [];
  const merge = ctx.results.merge_user_confirmations?.output as
    | { updates: Array<{ factId: string; statement: string; status: string }>; newFacts: Array<{ category: string; statement: string; status: string }> }
    | undefined;
  if (!merge) return base;
  const byId = new Map(base.map((f) => [String(f.id), f]));
  for (const u of merge.updates) {
    const f = byId.get(u.factId);
    if (f) {
      f.statement = u.statement;
      f.status = u.status;
    }
  }
  let n = 0;
  const facts = [...byId.values()];
  for (const nf of merge.newFacts) {
    facts.push({ id: `nf-${++n}`, category: nf.category, statement: nf.statement, status: nf.status, refs: [] });
  }
  return facts;
}

const factsOf = (ctx: PipelineContext) =>
  (ctx.results.extract_invention_facts?.output as { facts: Array<Record<string, unknown>> } | undefined)?.facts ?? [];

function mergeUserConfirmations(ctx: PipelineContext): unknown {
  const questions = (ctx.results.generate_intake_questions?.output as { questions: Array<{ id: string; factId?: string; kind: string }> } | undefined)
    ?.questions ?? [];
  const updates = [];
  const newFacts = [];
  for (const q of questions) {
    const answer = ctx.userAnswers[q.id];
    if (answer === undefined) continue;
    if (q.factId) {
      updates.push({ factId: q.factId, statement: answer, status: "user_confirmed" });
    } else {
      newFacts.push({
        category: q.kind === "scope" ? "subject" : "structure",
        statement: answer,
        status: "user_confirmed",
      });
    }
  }
  return { updates, newFacts, answersUsed: Object.keys(ctx.userAnswers) };
}

function buildInventionModel(ctx: PipelineContext): unknown {
  const facts = resolveFacts(ctx);
  const subject = facts.find((f) => f.category === "subject" && f.status !== "unsupported");
  const ok = (f: Record<string, unknown>) => f.status !== "unsupported";
  return {
    subject: subject ? { statement: subject.statement, factId: subject.id } : { statement: ctx.title },
    components: facts.filter((f) => f.category === "structure" && ok(f)).map((f) => ({ name: String(f.statement), role: "structure" })),
    connections: facts.filter((f) => f.category === "comm_scheme" && ok(f)).map((f) => ({ from: "", to: "", kind: String(f.statement) })),
    effects: facts.filter((f) => f.category === "effect" && ok(f)).map((f) => ({ statement: f.statement, factId: f.id })),
    parameters: facts.filter((f) => f.category === "parameter" && ok(f)).map((f) => ({ name: String(f.statement), factId: f.id })),
  };
}

function recommendPatentType(ctx: PipelineContext): unknown {
  const facts = factsOf(ctx);
  const hints = facts
    .map((f) => f.patentTypeHint)
    .filter((h): h is "utility_model" | "invention" => h === "utility_model" || h === "invention");
  const counts = { utility_model: 0, invention: 0 };
  for (const h of hints) counts[h]++;
  if (counts.invention > counts.utility_model) {
    return { patentType: "invention", rationale: "交底材料中的发明类型提示以发明专利为主", confidence: 0.7 };
  }
  if (counts.utility_model > 0) {
    return { patentType: "utility_model", rationale: "交底材料中的发明类型提示以实用新型为主", confidence: 0.7 };
  }
  return {
    patentType: "utility_model",
    rationale: "材料未明确类型提示，MVP 默认实用新型（正式支持；发明专利为 Beta）",
    confidence: 0.5,
  };
}

function exportGate(ctx: PipelineContext): unknown {
  const blockers: string[] = [];
  for (const stage of ["audit_support", "audit_consistency", "audit_formal_rules"] as const) {
    const out = ctx.results[stage]?.output as { findings: Array<{ severity: string; message: string }> } | undefined;
    for (const f of out?.findings ?? []) {
      if (f.severity === "error") blockers.push(`[${stage}] ${f.message}`);
    }
  }
  const claims = (ctx.results.draft_claims?.output as { claims: Array<{ features: Array<{ status: string }> }> } | undefined)?.claims ?? [];
  for (const [i, c] of claims.entries()) {
    const unsupported = c.features.filter((f) => f.status === "unsupported").length;
    if (unsupported > 0) blockers.push(`权利要求 ${i + 1} 含 ${unsupported} 个无来源特征`);
  }
  return { allowed: blockers.length === 0, blockers };
}

export const STAGES: StageDef[] = [
  {
    id: "ingest_sources",
    kind: "local",
    promptFile: null,
    deps: [],
    schema: schemas.ingest_sources,
    needsUserInput: false,
    inputOf: (ctx) => ({ assets: ctx.assets.length, chunks: ctx.chunks.length }),
    run: (ctx) => ({ assets: ctx.assets, chunks: ctx.chunks }),
  },
  {
    id: "extract_invention_facts",
    kind: "llm",
    promptFile: "extract-facts.md",
    deps: ["ingest_sources"],
    schema: schemas.extract_invention_facts,
    needsUserInput: false,
    inputOf: (ctx) => ({ chunks: ctx.chunks.map((c) => ({ id: c.id, page: c.page, text: c.text })) }),
  },
  {
    id: "detect_conflicts",
    kind: "llm",
    promptFile: "detect-conflicts.md",
    deps: ["extract_invention_facts"],
    schema: schemas.detect_conflicts,
    needsUserInput: false,
    inputOf: (ctx) => ({ facts: factsOf(ctx) }),
  },
  {
    id: "assess_readiness",
    kind: "llm",
    promptFile: "readiness.md",
    deps: ["extract_invention_facts", "detect_conflicts"],
    schema: schemas.assess_readiness,
    needsUserInput: false,
    inputOf: (ctx) => ({
      facts: factsOf(ctx),
      conflicts: (ctx.results.detect_conflicts?.output as { conflicts: unknown } | undefined)?.conflicts ?? [],
    }),
  },
  {
    id: "generate_intake_questions",
    kind: "llm",
    promptFile: "intake.md",
    deps: ["assess_readiness"],
    schema: schemas.generate_intake_questions,
    needsUserInput: true,
    inputOf: (ctx) => ({
      readiness: ctx.results.assess_readiness?.output,
      facts: factsOf(ctx),
      conflicts: (ctx.results.detect_conflicts?.output as { conflicts: unknown } | undefined)?.conflicts ?? [],
    }),
  },
  {
    id: "merge_user_confirmations",
    kind: "deterministic",
    promptFile: null,
    deps: ["generate_intake_questions"],
    schema: schemas.merge_user_confirmations,
    needsUserInput: false,
    inputOf: () => ({}),
    run: mergeUserConfirmations,
  },
  {
    id: "build_invention_model",
    kind: "deterministic",
    promptFile: null,
    deps: ["merge_user_confirmations"],
    schema: schemas.build_invention_model,
    needsUserInput: false,
    inputOf: () => ({}),
    run: buildInventionModel,
  },
  {
    id: "recommend_patent_type",
    kind: "deterministic",
    promptFile: null,
    deps: ["build_invention_model"],
    schema: schemas.recommend_patent_type,
    needsUserInput: false,
    inputOf: () => ({}),
    run: recommendPatentType,
  },
  {
    id: "propose_claim_strategy",
    kind: "llm",
    promptFile: "patent-strategy.md",
    deps: ["recommend_patent_type"],
    schema: schemas.propose_claim_strategy,
    needsUserInput: false,
    inputOf: (ctx) => ({
      model: ctx.results.build_invention_model?.output,
      patentType: ctx.results.recommend_patent_type?.output,
      facts: factsOf(ctx),
    }),
  },
  {
    id: "draft_claim_skeleton",
    kind: "llm",
    promptFile: "claim-skeleton.md",
    deps: ["propose_claim_strategy"],
    schema: schemas.draft_claim_skeleton,
    needsUserInput: false,
    inputOf: (ctx) => ({
      strategy: ctx.results.propose_claim_strategy?.output,
      model: ctx.results.build_invention_model?.output,
      patentType: ctx.results.recommend_patent_type?.output,
    }),
  },
  {
    id: "draft_claims",
    kind: "llm",
    promptFile: "draft-claims.md",
    deps: ["draft_claim_skeleton"],
    schema: schemas.draft_claims,
    needsUserInput: false,
    inputOf: (ctx) => ({
      skeleton: ctx.results.draft_claim_skeleton?.output,
      facts: resolveFacts(ctx),
    }),
  },
  {
    id: "draft_specification",
    kind: "llm",
    promptFile: "draft-specification.md",
    deps: ["draft_claims"],
    schema: schemas.draft_specification,
    needsUserInput: false,
    inputOf: (ctx) => ({
      claims: ctx.results.draft_claims?.output,
      facts: resolveFacts(ctx),
      model: ctx.results.build_invention_model?.output,
    }),
  },
  {
    id: "generate_figure_specs",
    kind: "llm",
    promptFile: "figure-spec.md",
    deps: ["draft_claims"],
    schema: schemas.generate_figure_specs,
    needsUserInput: false,
    inputOf: (ctx) => ({
      claims: ctx.results.draft_claims?.output,
      facts: resolveFacts(ctx),
    }),
  },
  {
    id: "draft_abstract",
    kind: "llm",
    promptFile: "draft-abstract.md",
    deps: ["draft_specification", "generate_figure_specs"],
    schema: schemas.draft_abstract,
    needsUserInput: false,
    inputOf: (ctx) => ({
      claims: ctx.results.draft_claims?.output,
      spec: ctx.results.draft_specification?.output,
      figures: ctx.results.generate_figure_specs?.output,
    }),
  },
  {
    id: "audit_support",
    kind: "llm",
    promptFile: "audit-support.md",
    deps: ["draft_claims", "draft_specification"],
    schema: schemas.audit_support,
    needsUserInput: false,
    inputOf: (ctx) => ({
      claims: ctx.results.draft_claims?.output,
      spec: ctx.results.draft_specification?.output,
      facts: resolveFacts(ctx),
    }),
  },
  {
    id: "audit_consistency",
    kind: "llm",
    promptFile: "audit-consistency.md",
    deps: ["draft_claims", "draft_specification", "generate_figure_specs"],
    schema: schemas.audit_consistency,
    needsUserInput: false,
    inputOf: (ctx) => ({
      claims: ctx.results.draft_claims?.output,
      spec: ctx.results.draft_specification?.output,
      figures: ctx.results.generate_figure_specs?.output,
    }),
  },
  {
    id: "audit_formal_rules",
    kind: "llm",
    promptFile: "audit-formal-rules.md",
    deps: ["draft_claims", "draft_abstract"],
    schema: schemas.audit_formal_rules,
    needsUserInput: false,
    inputOf: (ctx) => ({
      patentType: ctx.results.recommend_patent_type?.output,
      claims: ctx.results.draft_claims?.output,
      abstract: ctx.results.draft_abstract?.output,
      figures: ctx.results.generate_figure_specs?.output,
    }),
  },
  {
    id: "export",
    kind: "deterministic",
    promptFile: null,
    deps: ["audit_support", "audit_consistency", "audit_formal_rules"],
    schema: schemas.export,
    needsUserInput: false,
    inputOf: () => ({}),
    run: exportGate,
  },
];

export const STAGE_BY_ID = new Map(STAGES.map((s) => [s.id, s]));

export const LLM_STAGES = STAGES.filter((s) => s.kind === "llm").map((s) => s.id);
