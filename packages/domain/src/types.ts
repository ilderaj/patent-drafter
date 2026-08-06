/**
 * Core domain model for the patent drafting pipeline.
 * Mirrors docs/data-model.md.
 */

export type PatentType = "utility_model" | "invention";

export type FactStatus = "source_backed" | "user_confirmed" | "external_context" | "unsupported";

export type PipelineStage =
  | "ingest_sources"
  | "extract_invention_facts"
  | "detect_conflicts"
  | "assess_readiness"
  | "generate_intake_questions"
  | "merge_user_confirmations"
  | "build_invention_model"
  | "recommend_patent_type"
  | "propose_claim_strategy"
  | "draft_claim_skeleton"
  | "draft_claims"
  | "draft_specification"
  | "generate_figure_specs"
  | "draft_abstract"
  | "audit_support"
  | "audit_consistency"
  | "audit_formal_rules"
  | "export";

export interface PatentProject {
  id: string;
  title: string;
  patentType: PatentType;
  status: PipelineStage;
  createdAt: string;
  updatedAt: string;
  rulePackVersion: string;
  promptVersion: string;
}

export interface SourceAsset {
  id: string;
  projectId: string;
  fileName: string;
  fileType: string;
  sizeBytes: number;
  sha256: string;
  storageRef: string;
  parseStatus: "pending" | "ok" | "partial" | "failed";
  pageCount?: number;
  ocrNeeded: boolean;
}

export interface SourceChunk {
  id: string;
  assetId: string;
  chunkIndex: number;
  kind: "paragraph" | "table" | "image" | "ocr_page";
  text?: string;
  page?: number;
  tableRect?: { x: number; y: number; w: number; h: number };
  imageRect?: { x: number; y: number; w: number; h: number };
  ocrConfidence?: number;
  contentHash: string;
}

export interface SourceRef {
  id: string;
  chunkId: string;
  assetId: string;
  start?: number;
  end?: number;
  page?: number;
  quote?: string;
}

export type FactCategory =
  | "subject"
  | "structure"
  | "comm_scheme"
  | "effect"
  | "parameter"
  | "material";

export interface FactConflict {
  id: string;
  factAId: string;
  factBId: string;
  kind: "subject_swing" | "scheme_contradiction" | "numeral_mismatch" | "term_mismatch" | "noise_suspect";
  detail: string;
  resolved: boolean;
}

export interface Fact {
  id: string;
  projectId: string;
  category: FactCategory;
  statement: string;
  status: FactStatus;
  refs: SourceRef[];
  conflicts: FactConflict[];
  patentTypeHint?: PatentType;
  claims: ClaimFeature[];
}

export interface IntakeQuestion {
  id: string;
  projectId: string;
  kind: "missing" | "contradiction" | "parameter_source" | "scope" | "figure";
  factId?: string;
  question: string;
  options?: string[];
  required: boolean;
  status: "pending" | "answered" | "skipped";
}

export interface UserAnswer {
  id: string;
  questionId: string;
  answer: string;
  refs?: SourceRef[];
  answeredAt: string;
  evidenceNote?: string;
}

export interface ClaimStrategyPlan {
  protectionCore: string[];
  dependentExtensions: string[];
  exclusions: string[];
  riskNotes: string[];
}

export interface PatentStrategy {
  id: string;
  projectId: string;
  patentType: PatentType;
  protectionCore: string[];
  claimStrategy: ClaimStrategyPlan;
  exclusions: string[];
  riskNotes: string[];
}

export interface ClaimFeature {
  id: string;
  claimId: string;
  featureText: string;
  factId?: string;
  status: FactStatus;
}

export interface Claim {
  id: string;
  projectId: string;
  number: number;
  independent: boolean;
  parentId?: string;
  claimText: string;
  status: string;
  features: ClaimFeature[];
  refs: SourceRef[];
}

export type DraftSectionName =
  | "title"
  | "technical_field"
  | "background"
  | "summary"
  | "figures_desc"
  | "embodiments"
  | "abstract";

export interface DraftSection {
  id: string;
  projectId: string;
  section: DraftSectionName;
  content: string;
  status: string;
  refs: SourceRef[];
  generatedBy: GenerationRun;
}

export type FigureKind =
  | "block_diagram"
  | "flowchart"
  | "topology"
  | "state_diagram"
  | "mechanical"
  | "circuit"
  | "structure";

export interface ReferenceNumeral {
  id: string;
  numeral: string;
  label: string;
  usedIn: ("claims" | "spec" | "figure")[];
  status: "consistent" | "mismatch";
}

export interface FigureSpec {
  id: string;
  projectId: string;
  figureNo: number;
  kind: FigureKind;
  title: string;
  contentNodes: string[];
  numerals: ReferenceNumeral[];
  generationMode: "auto" | "drawing_brief";
  status: "spec" | "confirmed" | "generated" | "user_uploaded";
}

export type AuditSeverity = "error" | "warning" | "info";
export type AuditScope = "claims" | "spec" | "abstract" | "figures" | "cross" | "formal";

export interface AuditFinding {
  id: string;
  projectId: string;
  ruleId: string;
  severity: AuditSeverity;
  message: string;
  remediation: string;
  scope: AuditScope;
  status: "open" | "accepted" | "fixed";
  refs: SourceRef[];
}

export interface GenerationMeta {
  provider: string;
  model: string;
  promptVersion: string;
  rulePackVersion: string;
}

export interface Snapshot {
  id: string;
  projectId: string;
  version: number;
  createdAt: string;
  kind: "auto" | "manual" | "export";
  claims: Claim[];
  sections: DraftSection[];
  figures: FigureSpec[];
  findings: AuditFinding[];
  meta: GenerationMeta;
}

export interface GenerationRun {
  id: string;
  projectId: string;
  stage: PipelineStage;
  provider: string;
  model: string;
  promptVersion: string;
  rulePackVersion: string;
  inputHash: string;
  outputHash: string;
  status: "running" | "ok" | "cancelled" | "failed";
  errorKind?: string;
  cost?: number;
}

/** unsupported 内容禁止进入最终导出文件（硬规则） */
export const HARD_RULES = {
  unsupportedNotExportable: true,
  externalContextNotInventive: true,
  aiNotInventor: true,
  noAuthorizationGuarantee: true,
} as const;

