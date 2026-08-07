// Zod schemas for every LLM stage output. Contracts mirror packages/prompts/*.md.
import { z } from "zod";

export const FactCategorySchema = z.enum(["subject", "structure", "comm_scheme", "effect", "parameter", "material"]);
export const FactStatusSchema = z.enum(["source_backed", "user_confirmed", "external_context", "unsupported"]);
export const PatentTypeSchema = z.enum(["utility_model", "invention"]);
export const ConflictKindSchema = z.enum([
  "subject_swing",
  "scheme_contradiction",
  "numeral_mismatch",
  "term_mismatch",
  "noise_suspect",
]);
export const SeveritySchema = z.enum(["error", "warning", "info"]);
export const DraftSectionNameSchema = z.enum([
  "title",
  "technical_field",
  "background",
  "summary",
  "figures_desc",
  "embodiments",
  "abstract",
]);
export const FigureKindSchema = z.enum([
  "block_diagram",
  "flowchart",
  "topology",
  "state_diagram",
  "mechanical",
  "circuit",
  "structure",
]);

const sourceRefSchema = z.object({
  chunkId: z.string(),
  page: z.number().int().positive().optional(),
  quote: z.string().optional(),
});

export const ExtractFactsSchema = z.object({
  facts: z
    .array(
      z.object({
        id: z.string().optional(),
        category: FactCategorySchema,
        statement: z.string().min(1),
        status: FactStatusSchema,
        refs: z.array(sourceRefSchema).min(1),
        patentTypeHint: PatentTypeSchema.optional(),
      }),
    )
    .min(1),
});

export const DetectConflictsSchema = z.object({
  conflicts: z.array(
    z.object({
      id: z.string().optional(),
      factAId: z.string(),
      factBId: z.string(),
      kind: ConflictKindSchema,
      detail: z.string().min(1),
      resolved: z.boolean(),
    }),
  ),
});

export const ReadinessSchema = z.object({
  readiness: z.enum(["ready", "partial", "blocked"]),
  coverage: z.number().min(0).max(1).default(0.5),
  dimensions: z.array(
    z.object({
      name: z.string().min(1),
      status: z.enum(["ok", "gap", "blocked"]),
      reason: z.string().default(""),
    }),
  ).default([]),
  gaps: z.array(
    z.object({
      id: z.string(),
      kind: z.enum(["missing", "contradiction", "parameter_source", "scope", "figure"]),
      description: z.string().default(""),
    }),
  ).default([]),
});

export const IntakeQuestionsSchema = z.object({
  questions: z
    .array(
      z.object({
        id: z.string().optional(),
        kind: z.enum(["missing", "contradiction", "parameter_source", "scope", "figure"]),
        factId: z.string().optional(),
        question: z.string().min(1),
        options: z.array(z.string()).max(6).optional(),
        required: z.boolean(),
      }),
    )
    .max(8),
});

export const ClaimStrategySchema = z.object({
  protectionCore: z.array(z.string().min(1)),
  dependentExtensions: z.array(z.string().min(1)),
  exclusions: z.array(z.string().min(1)),
  riskNotes: z.array(z.string().min(1)),
});

const featureSchema = z.object({
  text: z.string().min(1),
  factId: z.string().optional(),
  status: FactStatusSchema,
});

export const ClaimSkeletonSchema = z.object({
  claims: z.array(
    z.object({
      number: z.number().int().positive(),
      independent: z.boolean(),
      parentRefs: z.array(z.number().int().positive()),
      features: z.array(featureSchema).min(1),
    }),
  ),
});

export const DraftClaimsSchema = z.object({
  claims: z.array(
    z.object({
      number: z.number().int().positive(),
      independent: z.boolean(),
      parentRefs: z.array(z.number().int().positive()),
      text: z.string().min(1),
      features: z.array(featureSchema).min(1),
    }),
  ),
});

export const DraftSpecificationSchema = z.object({
  sections: z.array(
    z.object({
      section: DraftSectionNameSchema,
      content: z.string().min(1),
      refs: z.array(z.object({ chunkId: z.string().optional(), claimNo: z.number().nullable().optional() })),
    }),
  ),
});

export const FigureSpecsSchema = z.object({
  figures: z.array(
    z.object({
      kind: FigureKindSchema,
      title: z.string().min(1),
      notes: z.string().optional(),
      refs: z.array(sourceRefSchema),
    }),
  ),
  numerals: z
    .array(
      z.object({
        numeral: z.string().min(1),
        label: z.string().min(1),
        usedIn: z.array(z.enum(["claims", "spec", "figure"])),
      }),
    )
    .default([]),
});

export const DraftAbstractSchema = z.object({
  abstract: z.string().min(1),
  abstractFigureNumeral: z.string().nullable().default(null),
});

export const AuditFindingsSchema = z.object({
  findings: z.array(
    z.object({
      ruleId: z.string().min(1),
      severity: SeveritySchema,
      claimNo: z.number().optional(),
      feature: z.string().optional(),
      message: z.string().min(1),
      remediation: z.string().min(1),
    }),
  ),
});

// Deterministic (non-LLM) stage outputs.
export const MergeConfirmationsSchema = z.object({
  updates: z.array(
    z.object({
      factId: z.string(),
      statement: z.string().min(1),
      status: FactStatusSchema,
    }),
  ),
  newFacts: z.array(
    z.object({
      category: FactCategorySchema,
      statement: z.string().min(1),
      status: FactStatusSchema,
    }),
  ),
  answersUsed: z.array(z.string()),
});

export const InventionModelSchema = z.object({
  subject: z.object({ statement: z.string().min(1), factId: z.string().optional() }),
  components: z.array(z.object({ name: z.string().min(1), role: z.string().min(1) })),
  connections: z.array(z.object({ from: z.string(), to: z.string(), kind: z.string().min(1) })),
  effects: z.array(z.object({ statement: z.string().min(1), factId: z.string().optional() })),
  parameters: z.array(z.object({ name: z.string().min(1), value: z.string().optional(), factId: z.string().optional() })),
});

export const PatentTypeRecommendationSchema = z.object({
  patentType: PatentTypeSchema,
  rationale: z.string().min(1),
  confidence: z.number().min(0).max(1),
});

export const ExportGateSchema = z.object({
  allowed: z.boolean(),
  blockers: z.array(z.string()),
});

export const IngestSchema = z.object({
  assets: z.array(z.unknown()),
  chunks: z.array(z.unknown()),
});

export const schemas = {
  extract_invention_facts: ExtractFactsSchema,
  detect_conflicts: DetectConflictsSchema,
  assess_readiness: ReadinessSchema,
  generate_intake_questions: IntakeQuestionsSchema,
  merge_user_confirmations: MergeConfirmationsSchema,
  build_invention_model: InventionModelSchema,
  recommend_patent_type: PatentTypeRecommendationSchema,
  propose_claim_strategy: ClaimStrategySchema,
  draft_claim_skeleton: ClaimSkeletonSchema,
  draft_claims: DraftClaimsSchema,
  draft_specification: DraftSpecificationSchema,
  generate_figure_specs: FigureSpecsSchema,
  draft_abstract: DraftAbstractSchema,
  audit_support: AuditFindingsSchema,
  audit_consistency: AuditFindingsSchema,
  audit_formal_rules: AuditFindingsSchema,
  ingest_sources: IngestSchema,
  export: ExportGateSchema,
} as const;
