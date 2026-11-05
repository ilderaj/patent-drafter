/**
 * Regenerates the V6-11 synthetic fixtures. Run from the repo root:
 *   node qa/v6/scenarios/V6-11/fixtures/generate.mjs
 * This is not a test: `*.test.mjs` is the only file name the runner collects.
 *
 * The PDFs are written byte by byte here: embedded Type0/CIDFontType2 font with
 * Identity-H encoding and a ToUnicode CMap, so pdf.js returns the encoded text
 * instead of glyph codes. The scanned PDF has no text-showing operator at all.
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { zipSync } from "fflate";

const HERE = dirname(fileURLToPath(import.meta.url));

const PAGE_ONE = ["V6-11 synthetic text PDF, page one.", "每页都有文字层，段落可定位。"];
const PAGE_TWO = ["Second page for locators.", "第二页用来验证页码归属。"];
const SCAN_TEXT = "V6-11 scanned page without a text layer";

function utf16Hex(text) {
  let out = "";
  for (const char of text) {
    for (let i = 0; i < char.length; i += 1) out += char.charCodeAt(i).toString(16).padStart(4, "0");
  }
  return out.toUpperCase();
}

function cmap(lines) {
  const entries = lines
    .flatMap((line) => Array.from(line))
    .map((char) => `<<${utf16Hex(char)}>>`)
    .filter((value, index, all) => all.indexOf(value) === index)
    .map((value) => `<${value.slice(2, 6)}> <${value.slice(2, 6)}>`)
    .join("\n");
  return `/CIDInit /ProcSet findresource begin
12 dict begin
begincmap
/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def
/CMapName /Adobe-Identity-UCS def
/CMapType 2 def
1 begincodespacerange
<0000> <FFFF>
endcodespacerange
${Math.max(1, entries.split("\n").length)} beginbfchar
${entries || "<0000> <0000>"}
endbfchar
endcmap
CMapName currentdict /CMap defineresource pop
end
end`;
}

function pdfString(text) {
  // ASCII-only PDF literal string; the Chinese text goes through the Tj hex form.
  return `(${text.replace(/([()\\])/g, "\\$1")})`;
}

function textOperators(lines, startY) {
  return lines
    .map((line, index) => `BT /F1 12 Tf 72 ${startY - index * 20} Td <${utf16Hex(line)}> Tj ET`)
    .join("\n");
}

/**
 * Build a PDF from page descriptions. Each page is `{ text: string[] }` for a
 * text page or `{ drawingOnly: true }` for a page with no text operator.
 */
function buildPdf(pages) {
  const objects = [];
  const push = (body) => {
    objects.push(body);
    return objects.length; // 1-based object number
  };

  const catalogId = push("");
  const pagesId = push("");
  const fontId = push("");
  const descriptorId = push("");
  const cidFontId = push("");
  const tounicodeId = push("");
  push("");

  const pageIds = [];
  for (const page of pages) {
    const content = page.drawingOnly
      ? ["0.9 g 72 72 100 100 re f", "% no text show operator: this page has no text layer"].join("\n")
      : textOperators(page.text, 720);
    const contentObjectId = push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    pageIds.push(
      push(
        `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentObjectId} 0 R >>`,
      ),
    );
  }

  const cmapBody = cmap(pages.flatMap((page) => page.text ?? []));
  objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;
  objects[fontId - 1] =
    `<< /Type /Font /Subtype /Type0 /BaseFont /V6Synthetic /Encoding /Identity-H /DescendantFonts [${cidFontId} 0 R] /ToUnicode ${tounicodeId} 0 R >>`;
  objects[cidFontId - 1] =
    `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /V6Synthetic /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${descriptorId} 0 R /DW 1000 >>`;
  objects[descriptorId - 1] =
    `<< /Type /FontDescriptor /FontName /V6Synthetic /Flags 4 /FontBBox [0 -200 1000 900] /ItalicAngle 0 /Ascent 880 /Descent -200 /CapHeight 700 /StemV 80 >>`;
  objects[tounicodeId - 1] = `<< /Length ${cmapBody.length} >>\nstream\n${cmapBody}\nendstream`;

  let out = "%PDF-1.7\n%âãÏÓ\n";
  const offsets = [0];
  objects.forEach((body, index) => {
    offsets.push(out.length);
    out += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i += 1) {
    out += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

function docx(bodyParagraphs) {
  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${bodyParagraphs
    .map((text) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`)
    .join("")}</w:body></w:document>`;
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;
  return zipSync(
    {
      "[Content_Types].xml": Buffer.from(contentTypes, "utf8"),
      "_rels/.rels": Buffer.from(rels, "utf8"),
      "word/document.xml": Buffer.from(xml, "utf8"),
    },
    { level: 0 },
  );
}

const textPdf = buildPdf([{ text: PAGE_ONE }, { text: PAGE_TWO }]);
const scanPdf = buildPdf([{ drawingOnly: true }]);
const document = docx(["V6-11 synthetic DOCX.", "第二段：DOCX 正文会被切分为段落。"]);

writeFileSync(join(HERE, "text-two-pages.pdf"), textPdf);
writeFileSync(join(HERE, "scan-no-text-layer.pdf"), scanPdf);
writeFileSync(join(HERE, "plain-docx.docx"), document);
writeFileSync(join(HERE, "plain-text.txt"), Buffer.from("V6-11 synthetic text.\n\n第二段：文本文件按段落切分。\n", "utf8"));
writeFileSync(
  join(HERE, "scanned-page-note.txt"),
  Buffer.from(
    `${SCAN_TEXT}\n\nGenerated by generate.mjs: the scanned PDF has one page and no text operator.\n`,
    "utf8",
  ),
);

// A legacy .doc header (OLE2) is enough for the explicit unsupported answer.
writeFileSync(
  join(HERE, "legacy-doc.doc"),
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, ...Buffer.from("V6-11 synthetic legacy doc")]),
);

console.log("wrote text-two-pages.pdf scan-no-text-layer.pdf plain-docx.docx plain-text.txt legacy-doc.doc");
