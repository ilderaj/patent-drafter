/**
 * Browser-only canvas page renderers for the export PDF builders.
 * Renders full A4 pages (CJK-capable via system fonts) and returns PNG bytes
 * that packages/export embeds into the PDF. No network involved.
 */
import type { FigurePageSpec, ReportPageSpec, Tone } from "@patent/export";

const PAGE_W = 1191; // A4 (595.28pt) at 2x
const PAGE_H = 1684;
const MARGIN = 96;

const TONE_COLORS: Record<Tone, string> = {
  ok: "#33804a",
  warn: "#b8770e",
  err: "#b82e28",
  muted: "#5c6470",
  ink: "#1f2430",
};

const FONT_STACK = '"PingFang SC", "Hiragino Sans GB", "Noto Sans CJK SC", "Microsoft YaHei", sans-serif';

function fontCss(size: number, weight = "normal"): string {
  return `${weight} ${size}px ${FONT_STACK}`;
}

async function canvasToPng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("canvas.toBlob returned null");
  return new Uint8Array(await blob.arrayBuffer());
}

function newCanvas(): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement("canvas");
  canvas.width = PAGE_W;
  canvas.height = PAGE_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d canvas context unavailable");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, PAGE_W, PAGE_H);
  return [canvas, ctx];
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, size: number): string[] {
  ctx.font = fontCss(size);
  const out: string[] = [];
  let line = "";
  for (const ch of text) {
    if (ch === "\n") {
      out.push(line);
      line = "";
      continue;
    }
    if (ctx.measureText(line + ch).width > maxWidth && line.length > 0) {
      out.push(line);
      line = ch;
    } else {
      line += ch;
    }
  }
  if (line) out.push(line);
  return out;
}

function loadSvgImage(svg: string): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("svg rasterization failed"));
    img.src = url;
  }).finally(() => URL.revokeObjectURL(url));
}

export async function renderReportPages(spec: ReportPageSpec): Promise<Uint8Array[]> {
  const pages: Uint8Array[] = [];
  let [canvas, ctx] = newCanvas();
  let y = MARGIN + 40;

  const flush = async () => {
    pages.push(await canvasToPng(canvas));
    [canvas, ctx] = newCanvas();
    y = MARGIN + 40;
  };

  // Title
  ctx.font = fontCss(36, "bold");
  ctx.fillStyle = TONE_COLORS.ink;
  ctx.textAlign = "center";
  ctx.fillText(spec.title, PAGE_W / 2, y);
  y += 72;
  ctx.textAlign = "left";

  // Meta
  ctx.font = fontCss(21);
  for (const m of spec.meta) {
    ctx.fillStyle = TONE_COLORS.ink;
    ctx.fillText(`${m.label}：${m.value}`, MARGIN, y);
    y += 38;
  }
  y += 24;

  // Sections
  for (const section of spec.sections) {
    if (y > PAGE_H - 260) await flush();
    ctx.font = fontCss(25, "bold");
    ctx.fillStyle = TONE_COLORS.ink;
    ctx.fillText(section.heading, MARGIN, y);
    y += 46;
    const items = section.items.length > 0 ? section.items : [{ text: section.emptyText, tone: "muted" as Tone }];
    for (const item of items) {
      ctx.font = fontCss(19);
      ctx.fillStyle = TONE_COLORS[item.tone ?? "ink"];
      for (const line of wrapText(ctx, item.text, PAGE_W - 2 * MARGIN - 24, 19)) {
        if (y > PAGE_H - 130) await flush();
        ctx.fillText(line, MARGIN + 12, y);
        y += 32;
      }
      y += 8;
    }
    y += 14;
  }

  // Footer
  if (y > PAGE_H - 120) await flush();
  ctx.font = fontCss(16);
  ctx.fillStyle = TONE_COLORS.muted;
  ctx.fillText(spec.footer, MARGIN, PAGE_H - 84);
  await flush();
  return pages;
}

export async function renderFigurePage(spec: FigurePageSpec): Promise<Uint8Array[]> {
  const [canvas, ctx] = newCanvas();
  ctx.font = fontCss(26, "bold");
  ctx.fillStyle = TONE_COLORS.ink;
  ctx.fillText(spec.pageHeading, MARGIN, MARGIN + 36);

  if (spec.svg) {
    const img = await loadSvgImage(spec.svg);
    const maxW = PAGE_W - 2 * MARGIN;
    const maxH = PAGE_H - 2 * MARGIN - 200;
    const scale = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight);
    const w = img.naturalWidth * scale;
    const h = img.naturalHeight * scale;
    ctx.drawImage(img, (PAGE_W - w) / 2, (PAGE_H - h) / 2 + 60, w, h);
  } else if (spec.placeholder) {
    ctx.strokeStyle = "#9aa3ad";
    ctx.strokeRect(MARGIN + 24, PAGE_H / 2 - 96, PAGE_W - 2 * MARGIN - 48, 192);
    ctx.font = fontCss(21);
    ctx.fillStyle = TONE_COLORS.muted;
    ctx.textAlign = "center";
    ctx.fillText("（附图占位页）", PAGE_W / 2, PAGE_H / 2 - 24);
    const lines = wrapText(ctx, spec.placeholder, PAGE_W - 2 * MARGIN - 120, 18);
    let ty = PAGE_H / 2 + 20;
    for (const line of lines) {
      ctx.fillText(line, PAGE_W / 2, ty);
      ty += 28;
    }
    ctx.textAlign = "left";
  }
  return [await canvasToPng(canvas)];
}
