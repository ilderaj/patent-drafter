import type { FactStatus } from "@patent/domain";

export type Severity = "error" | "warning" | "info";

/** Mirrors one entry of packages/rules-cn rule pack JSON. */
export interface RuleEntry {
  ruleId: string;
  patentType: Array<"utility_model" | "invention">;
  severity: Severity;
  deterministicCheck: string;
  sourceDocument: string;
  sourceSection: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  userMessage: string;
  remediation: string;
}

export interface RulePack {
  rulePackVersion: string;
  effectiveFrom: string;
  rules: RuleEntry[];
}

/** Input surface a deterministic check can read (project state at a stage). */
export interface RuleCheckContext {
  patentType: "utility_model" | "invention";
  projectId: string;
  claims: unknown[];
  specSections: unknown[];
  figures: unknown[];
  abstractText: string | null;
  facts: unknown[];
}

export interface RuleCheckResult {
  ruleId: string;
  passed: boolean;
  severity: Severity;
  message: string;
  remediation: string;
  /** Machine-readable location for UI jump-to (claim id, section id, figure id...). */
  target?: { kind: "claim" | "section" | "figure" | "fact" | "abstract" | "name"; id: string };
}

export type DeterministicCheckFn = (ctx: RuleCheckContext) => RuleCheckResult[];

export interface SupportLink {
  claimId: string;
  featureId: string;
  factId: string;
  status: FactStatus;
  sourceRefs: Array<{ assetId: string; chunkId?: string; page?: number; offset?: number }>;
}

export interface AuditReport {
  projectId: string;
  rulePackVersion: string;
  generatedAt: string;
  supportLinks: SupportLink[];
  unsupportedCount: number;
  results: RuleCheckResult[];
  /** true when any error-severity result failed or unsupportedCount > 0. */
  blocking: boolean;
}
