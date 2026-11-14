/**
 * Project -> export artifacts assembly. Pure functions over normalized
 * project data, so the same code drives the browser UI and Node tests.
 */
import { buildDocx, type DocxParagraph } from "./docx.ts";
import { type FigureMeta } from "./figures.ts";
import {
  buildFiguresPdf,
  buildReviewPdf,
  type FigurePageSpec,
  type PageRenderer,
  type ReportPageSpec,
  type Tone,
} from "./pdf.ts";
import { buildPatentPack } from "./patentpack.ts";
import {
  DEFAULT_EXPORT_SELECTION,
  EXPORT_FILE_NAMES,
  type ExportArtifact,
  type ExportArtifactKey,
  type ExportAudit,
  type ExportClaim,
  type ExportProjectData,
  type ExportSpecSection,
  type ExportSelection,
} from "./notes.ts";

function blank(): DocxParagraph {
  return { text: "", style: "body" };
}

export function buildClaimsDocx(d: ExportProjectData, notice?: string): Uint8Array {
  const paras: DocxParagraph[] = [{ text: "权利要求书", style: "title" }, blank()];
  for (const c of d.claims) {
    paras.push({ text: c.text, style: "body" }, blank());
  }
  return buildDocx(withNotice(notice, paras));
}

export function buildSpecificationDocx(d: ExportProjectData, notice?: string): Uint8Array {
  const paras: DocxParagraph[] = [{ text: "说明书", style: "title" }, blank()];
  for (const s of d.specSections) {
    paras.push({ text: s.title, style: "heading" }, { text: s.body, style: "body" }, blank());
  }
  return buildDocx(withNotice(notice, paras));
}

export function buildAbstractDocx(d: ExportProjectData, notice?: string): Uint8Array {
  const paras: DocxParagraph[] = [{ text: "说明书摘要", style: "title" }, blank()];
  paras.push({ text: d.abstractText.trim() || "（暂无摘要内容）", style: "body" });
  return buildDocx(withNotice(notice, paras));
}

export function buildBundleDocx(d: ExportProjectData, notice?: string): Uint8Array {
  const paras: DocxParagraph[] = [{ text: "专利申请文件草案合集", style: "title" }, blank()];
  paras.push({ text: "第一部分 权利要求书", style: "heading" }, blank());
  for (const c of d.claims) paras.push({ text: c.text, style: "body" }, blank());
  paras.push({ text: "第二部分 说明书", style: "heading" }, blank());
  for (const s of d.specSections) {
    paras.push({ text: s.title, style: "heading" }, { text: s.body, style: "body" }, blank());
  }
  paras.push({ text: "第三部分 说明书摘要", style: "heading" }, blank());
  paras.push({ text: d.abstractText.trim() || "（暂无摘要内容）", style: "body" });
  return buildDocx(withNotice(notice, paras));
}

export function buildReviewReportSpec(
  d: ExportProjectData,
  rulePackVersion: string,
  exportedAt: string,
): ReportPageSpec {
  return {
    title: "起草审阅报告",
    meta: [
      { label: "项目", value: d.name || "未命名项目" },
      { label: "专利类型", value: d.patentType ?? "未填写" },
      { label: "导出时间", value: exportedAt },
      { label: "规则包版本", value: rulePackVersion },
    ],
    sections: [
      {
        heading: "一、支持矩阵",
        items: (d.audit?.rows ?? []).map((r) => {
          const statusLabel = r.status === "source" ? "有来源" : r.status === "user" ? "用户确认" : "无来源";
          const tone: Tone = r.status === "source" ? "ok" : r.status === "user" ? "warn" : "err";
          return { text: `[${statusLabel}] ${r.feature}${r.source ? `（来源：${r.source}）` : ""}`, tone };
        }),
        emptyText: "（暂无支持矩阵数据）",
      },
      {
        heading: "二、审校检查",
        items: (d.audit?.checks ?? []).map((c) => ({
          text: `[${c.icon === "err" ? "需处理" : c.icon === "warn" ? "提示" : "通过"}] ${c.text}`,
          tone: (c.icon === "err" ? "err" : c.icon === "warn" ? "warn" : "ok") as Tone,
        })),
        emptyText: "（暂无审校检查数据）",
      },
      {
        heading: "三、AI 辅助标识",
        items: [
          {
            text: "本报告由 AI 辅助起草工具生成，内容已由人工审阅确认。申请文件正文不含 AI 声明；AI 辅助信息仅记录于本报告与项目元数据。",
            tone: "ink",
          },
          { text: `生成记录：${d.aiRecord ?? "无（项目无版本记录）"}`, tone: "muted" },
        ],
        emptyText: "",
      },
    ],
    footer: "全部文件均在浏览器本机生成，无任何数据上传。",
  };
}

export interface PatentPackSnapshot {
  v: 1;
  exportedAt: string;
  rulePackVersion: string;
  project: { name: string; patentType?: string };
  claims: ExportClaim[];
  specSections: ExportSpecSection[];
  abstractText: string;
  figures: FigureMeta[];
  audit: ExportAudit | null;
  versions: Array<{ version: string; note: string; meta: string }>;
}

export function buildSnapshot(d: ExportProjectData, rulePackVersion: string, exportedAt: string): PatentPackSnapshot {
  return {
    v: 1,
    exportedAt,
    rulePackVersion,
    project: { name: d.name, patentType: d.patentType },
    claims: d.claims,
    specSections: d.specSections,
    abstractText: d.abstractText,
    figures: d.figures,
    audit: d.audit ?? null,
    versions: d.versions ?? [],
  };
}

export interface AssembleOptions {
  renderReport?: PageRenderer<ReportPageSpec>;
  renderFigure?: PageRenderer<FigurePageSpec>;
  passphrase?: string;
  exportedAt?: string;
  /** Prepended to every generated DOCX as its first paragraph. */
  notice?: string;
}

function withNotice(notice: string | undefined, paragraphs: DocxParagraph[]): DocxParagraph[] {
  return notice ? [{ text: notice, style: "heading" }, blank(), ...paragraphs] : paragraphs;
}

/**
 * Builds exactly the selected artifacts. `selection` determines the output
 * truthfully: unselected files are never produced.
 */
export async function assembleExportArtifacts(
  d: ExportProjectData,
  selection: ExportSelection,
  opts: AssembleOptions = {},
): Promise<ExportArtifact[]> {
  const rulePackVersion = d.rulePackVersion ?? "cnipa-2026-01-01";
  const exportedAt = opts.exportedAt ?? new Date().toISOString();
  const out: ExportArtifact[] = [];
  const add = (key: ExportArtifactKey, data: Uint8Array) => out.push({ key, fileName: EXPORT_FILE_NAMES[key], data });

  if (selection.bundle) add("bundle", buildBundleDocx(d, opts.notice));
  if (selection.claims) add("claims", buildClaimsDocx(d, opts.notice));
  if (selection.specification) add("specification", buildSpecificationDocx(d, opts.notice));
  if (selection.abstract) add("abstract", buildAbstractDocx(d, opts.notice));
  if (selection.figures) {
    if (!opts.renderFigure) throw new Error("export assembly requires a figure page renderer");
    add("figures", await buildFiguresPdf(d.figures, { renderPages: opts.renderFigure }));
  }
  if (selection.report) {
    if (!opts.renderReport) throw new Error("export assembly requires a report page renderer");
    add(
      "report",
      await buildReviewPdf(buildReviewReportSpec(d, rulePackVersion, exportedAt), { renderPages: opts.renderReport }),
    );
  }
  if (selection.patentpack) {
    if (!opts.passphrase) throw new Error("patentpack export requires a passphrase");
    add("patentpack", await buildPatentPack(buildSnapshot(d, rulePackVersion, exportedAt), opts.passphrase));
  }
  return out;
}
