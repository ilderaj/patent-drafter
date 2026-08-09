import { zipSync } from "fflate";

export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

/**
 * Single-zip packaging for multi-file export. One download avoids browser
 * multi-download blocking; zip entry names equal the UI file list.
 */
export function buildZip(entries: ZipEntry[]): Uint8Array {
  const record: Record<string, Uint8Array> = {};
  for (const e of entries) record[e.name] = e.data;
  return zipSync(record, { level: 6 });
}

/** Safe file/zip base name derived from a project name. */
export function sanitizeFileName(s: string): string {
  const cleaned = s
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return cleaned || "patent-draft";
}
