import { readFileSync } from "node:fs";
import { loadPdfPagesDefault } from "../../../../../apps/web/src/v6/features/sources/parse.ts";

for (const name of ["text-two-pages.pdf", "scan-no-text-layer.pdf"]) {
  const bytes = new Uint8Array(readFileSync(new URL(`./${name}`, import.meta.url)));
  try {
    const pages = await loadPdfPagesDefault(bytes);
    console.log("OK", name, pages.length, JSON.stringify(pages.map((page) => page.text)));
  } catch (error) {
    console.log("FAIL", name, error?.name, String(error?.message ?? error).slice(0, 300));
  }
}

const { extractFileText } = await import("../../../../../apps/web/src/lib/extract.ts");
const docx = readFileSync(new URL("./plain-docx.docx", import.meta.url));
const extracted = await extractFileText(new File([docx], "plain-docx.docx", { type: "" }));
console.log("DOCX", JSON.stringify(extracted));
