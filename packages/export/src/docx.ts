/**
 * Minimal-but-real OOXML (docx) builder: a zip package containing
 * [Content_Types].xml, _rels/.rels, word/_rels/document.xml.rels,
 * word/document.xml and word/footer1.xml. This keeps the bundle
 * dependency-free (fflate only, already a workspace dep) while producing
 * CNIPA-aligned typography (SimSun / Times New Roman 12pt, 1.5x line spacing,
 * 2-char first-line indent for body paragraphs, centered PAGE footer).
 */
import { strToU8, zipSync } from "fflate";

export interface DocxParagraph {
  text: string;
  /** title = centered large bold; heading = bold; body = default. */
  style?: "title" | "heading" | "body";
  /** Optional indentation override (non-empty body paragraphs default to 2-char first-line indent). */
  indent?: "first-line" | "none";
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Strip XML-invalid control characters (keep \t and \n). */
function cleanText(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, "");
}

function expandParagraphs(paragraphs: DocxParagraph[]): DocxParagraph[] {
  const expanded: DocxParagraph[] = [];
  for (const p of paragraphs) {
    const normalized = p.text.replace(/\r\n?/g, "\n");
    if (!normalized.includes("\n")) {
      expanded.push({ ...p, text: normalized });
      continue;
    }
    for (const line of normalized.split("\n")) {
      expanded.push({ ...p, text: line });
    }
  }
  return expanded;
}

function paragraphXml(p: DocxParagraph): string {
  const style = p.style ?? "body";
  const isTitle = style === "title";
  const isHeading = style === "heading" || isTitle;
  const isBody = style === "body";
  const size = isTitle ? 36 : isHeading ? 32 : 24;
  const bold = isHeading;
  const rPr =
    `<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="宋体"/>` +
    (bold ? "<w:b/>" : "") +
    `<w:sz w:val="${size}"/><w:szCs w:val="${size}"/>`;
  const spacing = `<w:spacing w:line="360" w:lineRule="auto"/>`;
  const hasIndent = isBody && p.indent !== "none" && p.text.trim().length > 0;
  const ind = hasIndent ? `<w:ind w:firstLineChars="200" w:firstLine="480"/>` : "";
  const jc = isTitle ? `<w:jc w:val="center"/>` : "";
  const text = escapeXml(cleanText(p.text));
  return (
    `<w:p><w:pPr>${spacing}${ind}${jc}<w:rPr>${rPr}</w:rPr></w:pPr>` +
    `<w:r><w:rPr>${rPr}</w:rPr><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`
  );
}

function footerXml(): string {
  const rPr =
    `<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="宋体"/>` +
    `<w:sz w:val="20"/><w:szCs w:val="20"/>`;
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
    `<w:p>` +
    `<w:pPr><w:jc w:val="center"/><w:rPr>${rPr}</w:rPr></w:pPr>` +
    `<w:r><w:rPr>${rPr}</w:rPr><w:fldChar w:fldCharType="begin"/></w:r>` +
    `<w:r><w:rPr>${rPr}</w:rPr><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>` +
    `<w:r><w:rPr>${rPr}</w:rPr><w:fldChar w:fldCharType="separate"/></w:r>` +
    `<w:r><w:rPr>${rPr}</w:rPr><w:t>1</w:t></w:r>` +
    `<w:r><w:rPr>${rPr}</w:rPr><w:fldChar w:fldCharType="end"/></w:r>` +
    `</w:p>` +
    `</w:ftr>`
  );
}

export function buildDocx(paragraphs: DocxParagraph[]): Uint8Array {
  const expanded = expandParagraphs(paragraphs);
  const body =
    expanded.map(paragraphXml).join("") +
    `<w:sectPr><w:footerReference w:type="default" r:id="rIdFooter1"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>`;
  const documentXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${body}</w:body></w:document>`;
  const contentTypes =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
    `<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>` +
    `</Types>`;
  const rels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
    `</Relationships>`;
  const documentRels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rIdFooter1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>` +
    `</Relationships>`;
  return zipSync(
    {
      "[Content_Types].xml": strToU8(contentTypes),
      "_rels/.rels": strToU8(rels),
      "word/document.xml": strToU8(documentXml),
      "word/_rels/document.xml.rels": strToU8(documentRels),
      "word/footer1.xml": strToU8(footerXml()),
    },
    { level: 6 },
  );
}
