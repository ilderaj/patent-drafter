import type { AuditReport } from "@patent/audit";
import type { Snapshot } from "@patent/domain";

export type ExportArtifactKind =
  | "abstract.docx"
  | "claims.docx"
  | "specification.docx"
  | "abstract-figure.svg"
  | "abstract-figure.png"
  | "figures.pdf"
  | "figures.svg"
  | "draft-bundle.docx"
  | "review-report.pdf"
  | "review-report.html"
  | "patentpack";

export interface ExportManifest {
  projectId: string;
  snapshotId: string;
  artifactKinds: ExportArtifactKind[];
  rulePackVersion: string;
  promptVersion: string;
  generatedAt: string;
  aiAssisted: true;
  humanReviewedAt?: string;
}

export interface ExportGateResult {
  allowed: boolean;
  audit: AuditReport;
  reasons: string[];
}

/** Gate: formal application files must not contain unsupported facts. */
export function evaluateExportGate(audit: AuditReport): ExportGateResult {
  const reasons: string[] = [];
  if (audit.blocking) reasons.push("audit blocking: unsupported facts or error-severity findings present");
  if (audit.unsupportedCount > 0) reasons.push(`unsupported facts: ${audit.unsupportedCount}`);
  return { allowed: reasons.length === 0, audit, reasons };
}

export interface PatentPackVault {
  /** Encrypted project bundle (.patentpack) operations live in the Bridge. */
  export(projectId: string): Promise<Uint8Array>;
  import(data: Uint8Array, passphrase: string): Promise<Snapshot>;
}
