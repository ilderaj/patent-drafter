/**
 * Deterministic, self-contained SVG per figure, derived from the figure
 * metadata the data model actually stores (demo: 6 figure items; live:
 * generate_figure_specs output). The browser rasterizes these to PNG for
 * embedding into 说明书附图.pdf.
 */

export interface FigureMeta {
  id?: string;
  title: string;
  mode?: "auto" | "brief";
  badge?: string;
  previewLabel?: string;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function figureSvg(fig: FigureMeta, index: number): string {
  const title = fig.title || `图${index + 1}`;
  const label = fig.previewLabel || (fig.mode === "brief" ? "需上传图纸" : "可自动生成");
  const badge = fig.badge || (fig.mode === "brief" ? "brief" : "auto");
  const w = 800;
  const h = 560;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<rect x="0" y="0" width="${w}" height="${h}" fill="#ffffff"/>` +
    `<rect x="16" y="16" width="${w - 32}" height="${h - 32}" fill="none" stroke="#8a8f98" stroke-width="1.5"/>` +
    `<text x="40" y="58" font-family="sans-serif" font-size="26" font-weight="bold" fill="#1f2430">${esc(title)}</text>` +
    `<text x="40" y="88" font-family="sans-serif" font-size="16" fill="#5c6470">${esc(badge)}</text>` +
    `<rect x="120" y="210" width="${w - 240}" height="150" rx="10" fill="#f4f6f9" stroke="#9aa3ad" stroke-width="1.5"/>` +
    `<text x="${w / 2}" y="292" font-family="sans-serif" font-size="22" fill="#3d4653" text-anchor="middle">${esc(label)}</text>` +
    `</svg>`
  );
}
