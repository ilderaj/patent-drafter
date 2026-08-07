// Browser-local disclosure file parsers. Text is extracted entirely in the
// browser; nothing is uploaded to any server during parsing. Only the
// material the user explicitly drafts with is later sent to the model.
import { unzipSync } from "fflate";

export interface ExtractResult {
  /** Extracted plain text (null when extraction is impossible/unsupported). */
  text: string | null;
  /** Human-readable outcome, e.g. "已提取 5,306 字" or a failure reason. */
  note: string;
}

const MAX_FILE_BYTES = 50 * 1024 * 1024;
const MAX_DOCX_XML_BYTES = 64 * 1024 * 1024;
const MAX_TEXT_CHARS = 400_000;
const MAX_PDF_PAGES = 100;

/** Parse one user-supplied file into plain text, or explain why not. */
export async function extractFileText(file: File): Promise<ExtractResult> {
  const ext = (file.name.split(".").pop() ?? "").toLowerCase();
  if (file.size > MAX_FILE_BYTES) return { text: null, note: "超过 50MB 上限" };
  try {
    switch (ext) {
      case "txt":
      case "md":
      case "markdown":
        return finish(await file.text(), "文本");
      case "docx":
        return await readDocx(file);
      case "pdf":
        return await readPdf(file);
      case "doc":
        return { text: null, note: "旧版 .doc 无法在浏览器内安全解析：请在 Word/WPS 中另存为 .docx，或直接粘贴文本" };
      case "png":
      case "jpg":
      case "jpeg":
        return { text: null, note: "图片暂不支持识别文字：请把图中文字粘贴到下方文本框" };
      default:
        return { text: null, note: `暂不支持的格式 .${ext}：可改用 DOCX / PDF / TXT，或直接粘贴文本` };
    }
  } catch (e) {
    console.error("file extraction failed:", e instanceof Error ? e.message : String(e));
    return { text: null, note: "解析失败：文件可能已损坏，请尝试另存后重试，或直接粘贴文本" };
  }
}

function finish(raw: string, source: string): ExtractResult {
  const text = raw.trim();
  if (!text) return { text: null, note: `${source}中没有提取到文字内容` };
  const clipped = [...text].slice(0, MAX_TEXT_CHARS).join("");
  const suffix = clipped.length < text.length ? "（已截断）" : "";
  return { text: clipped, note: `已提取 ${clipped.length.toLocaleString()} 字${suffix}` };
}

/** Minimal DOCX text extraction: word/document.xml only, with a zip-bomb guard. */
async function readDocx(file: File): Promise<ExtractResult> {
  const buf = new Uint8Array(await file.arrayBuffer());
  const entries = unzipSync(buf, {
    filter: (info) => info.name === "word/document.xml" && info.originalSize <= MAX_DOCX_XML_BYTES,
  });
  const docXml = entries["word/document.xml"];
  if (!docXml) return { text: null, note: "不是有效的 DOCX（找不到正文），请另存后重试或直接粘贴文本" };
  const xml = new TextDecoder().decode(docXml);
  const text = xml
    .replace(/<w:tab\b[^>]*\/>/g, "\t")
    .replace(/<w:br\b[^>]*\/>/g, "\n")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<[^>]+>/g, "");
  return finish(decodeXmlEntities(text), "DOCX");
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/** PDF text-layer extraction via pdf.js (lazy-loaded, worker bundled as asset). */
async function readPdf(file: File): Promise<ExtractResult> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.min.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/legacy/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();
  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjs.getDocument({
    data,
    // Text-layer extraction only: render against system fonts instead of
    // fetching pdf.js standard-font assets (CSP blocks remote font data).
    useSystemFonts: true,
    // Strict CSP (script-src 'self' without unsafe-eval) forbids pdf.js eval.
    isEvalSupported: false,
  }).promise;
  const pages = Math.min(doc.numPages, MAX_PDF_PAGES);
  let out = "";
  for (let i = 1; i <= pages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    out += `${content.items
      .map((it: { str?: string }) => ("str" in it ? (it.str ?? "") : ""))
      .join("")}\n`;
    if (out.length > MAX_TEXT_CHARS) break;
  }
  // pdf.js v6 legacy build exposes cleanup() but not destroy() on the proxy.
  if (typeof (doc as { destroy?: () => void }).destroy === "function") void doc.destroy();
  else void doc.cleanup();
  const result = finish(out, "PDF");
  if (result.text === null) {
    return { text: null, note: "PDF 中没有文字层（可能是扫描件）：请粘贴其中的文字" };
  }
  return result;
}
