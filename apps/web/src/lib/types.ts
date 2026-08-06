export type PatentType = "utility_model" | "invention" | "other";

export type ProjectStatus =
  | "new"
  | "uploading"
  | "readiness"
  | "intake"
  | "strategy"
  | "drafting"
  | "auditing"
  | "ready"
  | "needs_material";

export interface ProjectFile {
  id: string;
  name: string;
  kind: string;
  sizeLabel: string;
  parseStatus: "parsing" | "ocr" | "done" | "failed";
  detail: string;
  text?: string;
}

export interface ReadinessDimension {
  name: string;
  status: "ok" | "confirm" | "conflict" | "noise" | "partial";
  label: string;
  note: string;
}

export interface IntakeQuestion {
  id: number;
  question: string;
  source: string;
  options: string[];
  notePlaceholder: string;
}

export interface IntakeAnswer {
  id: number;
  choice?: string;
  note?: string;
}

export interface Strategy {
  type: string;
  reason: string;
  core: string;
  dependentChain: string;
  risks: string;
  confirmText: string;
}

export interface ClaimDraft {
  id: string;
  label: string;
  text: string;
  sources: Array<{ label: string; kind: "source" | "user" | "none" }>;
  stale?: boolean;
}

export interface SpecSection {
  id: string;
  title: string;
  body: string;
}

export interface FigureItem {
  id: string;
  title: string;
  mode: "auto" | "brief";
  badge: string;
  previewLabel: string;
}

export interface AuditRow {
  feature: string;
  status: "source" | "user" | "none";
  source: string;
  position: string;
}

export interface AuditCheck {
  icon: "ok" | "warn" | "err";
  text: string;
}

export interface AuditSummary {
  passed: number;
  warnings: number;
  errors: number;
  rows: AuditRow[];
  checks: AuditCheck[];
}

export interface VersionRecord {
  version: string;
  note: string;
  meta: string;
}

export interface Project {
  id: string;
  name: string;
  patentType: PatentType;
  updatedAt: string;
  status: ProjectStatus;
  statusLabel: string;
  claimsCount?: number;
  files: ProjectFile[];
  coverage: number;
  coverageNote: string;
  dimensions: ReadinessDimension[];
  intakeNote: string;
  intakeQuestions: IntakeQuestion[];
  intakeAnswers: IntakeAnswer[];
  strategy?: Strategy;
  strategyConfirmed: boolean;
  claims: ClaimDraft[];
  specSections: SpecSection[];
  abstractText: string;
  figures: FigureItem[];
  figureBrief: string;
  audit?: AuditSummary;
  versions: VersionRecord[];
  demo?: boolean;
}
