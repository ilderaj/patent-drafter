/**
 * Minimal-but-real OOXML (docx) builder: a zip package containing
 * [Content_Types].xml, _rels/.rels and word/document.xml. This is the
 * documented minimum that Word / LibreOffice / Google Docs open, and it keeps
 * the bundle dependency-free (fflate only, already a workspace dep).
 */
import { strToU8, zipSync } from "fflate";

export interface DocxParagraph {
  text: string;
  /** title = centered large bold; heading = bold; body = default. */
  style?: "title" | "heading" | "body";
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

function paragraphXml(p: DocxParagraph): string {
  const isTitle = p.style === "title";
  const isHeading = p.style === "heading" || isTitle;
  const size = isTitle ? 36 : isHeading ? 32 : 24;
  const bold = isHeading;
  const rPr =
    `<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="宋体"/>` +
    (bold ? "<w:b/>" : "") +
    `<w:sz w:val="${size}"/><w:szCs w:val="${size}"/>`;
  const jc = isTitle ? `<w:jc w:val="center"/>` : "";
  const text = escapeXml(cleanText(p.text));
  return (
    `<w:p><w:pPr>${jc}<w:rPr>${rPr}</w:rPr></w:pPr>` +
    `<w:r><w:rPr>${rPr}</w:rPr><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`
  );
}

export function buildDocx(paragraphs: DocxParagraph[]): Uint8Array {
  const body =
    paragraphs.map(paragraphXml).join("") +
    `<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>`;
  const documentXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`;
  const contentTypes =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
    `</Types>`;
  const rels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
    `</Relationships>`;
  return zipSync(
    {
      "[Content_Types].xml": strToU8(contentTypes),
      "_rels/.rels": strToU8(rels),
      "word/document.xml": strToU8(documentXml),
    },
    { level: 6 },
  );
}
