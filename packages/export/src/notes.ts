/**
 * Lightweight export metadata + derived notes. No library imports, so the
 * web app can import this statically without pulling pdf-lib into the main
 * bundle (builders are imported dynamically on the export action).
 */
import type { FigureMeta } from "./figures.ts";

export interface ExportClaim {
  id?: string;
  label?: string;
  text: string;
}

export interface ExportSpecSection {
  id?: string;
  title: string;
  body: string;
}

export interface ExportAuditRow {
  feature: string;
  status: "source" | "user" | "none";
  source?: string;
}

export interface ExportAuditCheck {
  icon: "ok" | "warn" | "err";
  text: string;
}

export interface ExportAudit {
  passed: number;
  warnings: number;
  errors: number;
  rows: ExportAuditRow[];
  checks: ExportAuditCheck[];
}

export interface ExportProjectData {
  name: string;
  patentType?: string;
  claims: ExportClaim[];
  specSections: ExportSpecSection[];
  abstractText: string;
  figures: FigureMeta[];
  audit?: ExportAudit | null;
  versions?: Array<{ version: string; note: string; meta: string }>;
  rulePackVersion?: string;
  aiRecord?: string;
}

export interface ExportSelection {
  bundle: boolean;
  claims: boolean;
  specification: boolean;
  abstract: boolean;
  figures: boolean;
  report: boolean;
  patentpack: boolean;
}

export type ExportArtifactKey = keyof ExportSelection;

export interface ExportArtifact {
  key: ExportArtifactKey;
  /** Actual file name inside the zip (matches the UI list). */
  fileName: string;
  data: Uint8Array;
}

export const EXPORT_FILE_NAMES: Record<ExportArtifactKey, string> = {
  bundle: "专利申请文件草案合集.docx",
  claims: "权利要求书.docx",
  specification: "说明书.docx",
  abstract: "说明书摘要.docx",
  figures: "说明书附图.pdf",
  report: "起草审阅报告.pdf",
  patentpack: "项目备份.patentpack",
};

export const EXPORT_ORDER: ExportArtifactKey[] = [
  "bundle",
  "claims",
  "specification",
  "abstract",
  "figures",
  "report",
  "patentpack",
];

export const DEFAULT_EXPORT_SELECTION: ExportSelection = {
  bundle: true,
  claims: true,
  specification: true,
  abstract: true,
  figures: true,
  report: true,
  patentpack: true,
};

/** Derived per-file notes (no hardcoded claim/char/figure counts). */
export function exportFileNotes(d: ExportProjectData): Record<ExportArtifactKey, string> {
  const claims = d.claims.length > 0 ? `${d.claims.length} 条权利要求` : "暂无权利要求数据";
  const specification = d.specSections.length > 0 ? `${d.specSections.length} 个章节` : "暂无说明书章节";
  const abstract = d.abstractText.trim().length > 0 ? `${d.abstractText.trim().length} 字` : "暂无摘要内容";
  const figures = d.figures.length > 0 ? `图1-${d.figures.length}` : "暂无附图";
  const report = d.audit ? `${d.audit.rows.length} 项特征 · ${d.audit.checks.length} 项检查` : "无审校数据";
  return {
    bundle: "全部文件打包",
    claims,
    specification,
    abstract,
    figures,
    report,
    patentpack: "可选，含快照与来源",
  };
}

/** Real exported file names joined for the version-history note. */
export function exportedFileNames(artifacts: ExportArtifact[]): string {
  return EXPORT_ORDER.filter((k) => artifacts.some((a) => a.key === k))
    .map((k) => EXPORT_FILE_NAMES[k])
    .join("、");
}
