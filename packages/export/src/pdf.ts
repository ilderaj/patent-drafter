/**
 * Real PDF builders (pdf-lib, pure JS, browser + Node).
 *
 * pdf-lib's standard fonts only cover WinAnsi, and CJK text with a standard
 * font throws at encode time (no silent fallback). Chinese-capable rendering
 * therefore happens on a <canvas> in the browser (system fonts), and the
 * resulting page images are embedded losslessly into the PDF. Renderers are
 * injected so the builders stay pure and Node-testable: unit tests provide a
 * fake renderer and verify the produced spec + PDF structure via pdf-lib.
 */
import { PDFDocument } from "pdf-lib";
import { figureSvg, type FigureMeta } from "./figures.ts";

const A4_W = 595.28;
const A4_H = 841.89;

export type Tone = "ok" | "warn" | "err" | "muted" | "ink";

export interface ReportSectionSpec {
  heading: string;
  items: Array<{ text: string; tone?: Tone }>;
  emptyText: string;
}

/** Full content model handed to the browser canvas renderer. */
export interface ReportPageSpec {
  title: string;
  meta: Array<{ label: string; value: string }>;
  sections: ReportSectionSpec[];
  footer: string;
}

export interface FigurePageSpec {
  pageHeading: string;
  svg?: string;
  placeholder?: string;
}

/** Renders one or more A4 page images (PNG) for the given spec. */
export type PageRenderer<S> = (spec: S) => Promise<Uint8Array[]>;

export interface ReportPdfMetadata {
  title?: string;
  subject?: string;
  keywords?: string;
}

export async function buildReviewPdf(
  spec: ReportPageSpec,
  opts: { renderPages: PageRenderer<ReportPageSpec>; metadata?: ReportPdfMetadata },
): Promise<Uint8Array> {
  const pages = await opts.renderPages(spec);
  return embedPages(pages, opts.metadata);
}

export async function buildFiguresPdf(
  figures: FigureMeta[],
  opts: { renderPages: PageRenderer<FigurePageSpec> },
): Promise<Uint8Array> {
  const specs: FigurePageSpec[] =
    figures.length === 0
      ? [{ pageHeading: "说明书附图（无附图）", placeholder: "本项目暂无附图数据，未生成附图页。" }]
      : figures.map((fig, i) => {
          const pageHeading = `图${i + 1} ${fig.title || ""}`.trim();
          if (fig.mode === "brief") {
            return {
              pageHeading,
              placeholder: "该附图模式为 brief（需上传图纸），暂无可用图像。",
            };
          }
          return { pageHeading, svg: figureSvg(fig, i) };
        });
  const pages: Uint8Array[] = [];
  for (const spec of specs) {
    pages.push(...(await opts.renderPages(spec)));
  }
  return embedPages(pages);
}

async function embedPages(pageImages: Uint8Array[], metadata?: ReportPdfMetadata): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  if (metadata?.title) doc.setTitle(metadata.title);
  if (metadata?.subject) doc.setSubject(metadata.subject);
  if (metadata?.keywords) doc.setKeywords([metadata.keywords]);
  for (const png of pageImages) {
    const img = await doc.embedPng(png);
    const page = doc.addPage([A4_W, A4_H]);
    // Scale the page image to the A4 page (renderers produce A4-ratio images).
    const scale = Math.min(A4_W / img.width, A4_H / img.height);
    const w = img.width * scale;
    const h = img.height * scale;
    page.drawImage(img, { x: (A4_W - w) / 2, y: (A4_H - h) / 2, width: w, height: h });
  }
  return doc.save();
}
