/**
 * 恶意输入防护（安全验收第 11 项的可执行证据）。
 * 所有检查返回 ParseRejection 或 null，绝不抛异常；材料视为不可信数据。
 */
import type { ParseLimits, ParseRejection } from "./types.ts";

const DOC_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]; // OLE2
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04]; // PK\x03\x04
const ZIP_CENTRAL = [0x50, 0x4b, 0x01, 0x02];
const ZIP_EOCD = [0x50, 0x4b, 0x05, 0x06];

function bytesAt(bytes: Uint8Array, offset: number, len: number): Uint8Array {
  return bytes.subarray(offset, offset + len);
}

function u16(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function u32(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset] |
    (bytes[offset + 1] << 8) |
    (bytes[offset + 2] << 16) |
    (bytes[offset + 3] << 24)
  ) >>> 0;
}

function startsWith(bytes: Uint8Array, magic: number[], offset = 0): boolean {
  for (let i = 0; i < magic.length; i++) if (bytes[offset + i] !== magic[i]) return false;
  return true;
}

export interface ZipEntryInfo {
  name: string;
  compressed: number;
  uncompressed: number;
}

/** 最小 ZIP 目录读取器：解析 EOCD + 中央目录（无外部依赖）。 */
export function readZipEntries(bytes: Uint8Array): ZipEntryInfo[] | null {
  if (!startsWith(bytes, ZIP_MAGIC)) return null;
  // EOCD: 从尾部 64KB+22B 范围内查找 PK\x05\x06
  const tailStart = Math.max(0, bytes.length - 65557);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= tailStart; i--) {
    if (startsWith(bytes, ZIP_EOCD, i)) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  const count = u16(bytes, eocd + 10);
  const dirOffset = u32(bytes, eocd + 16);
  const entries: ZipEntryInfo[] = [];
  let p = dirOffset;
  for (let i = 0; i < count && p + 46 <= bytes.length; i++) {
    if (!startsWith(bytes, ZIP_CENTRAL, p)) break;
    const nameLen = u16(bytes, p + 28);
    const extraLen = u16(bytes, p + 30);
    const commentLen = u16(bytes, p + 32);
    const compressed = u32(bytes, p + 20);
    const uncompressed = u32(bytes, p + 24);
    const name = new TextDecoder("utf-8", { fatal: false }).decode(bytesAt(bytes, p + 46, nameLen));
    entries.push({ name, compressed, uncompressed });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** 文件大小上限（内存安全，先于任何解析执行）。 */
export function checkSize(bytes: Uint8Array, limits: ParseLimits): ParseRejection | null {
  if (bytes.length > limits.maxBytes) {
    return { reason: "TOO_LARGE", message: `file size ${bytes.length} exceeds limit ${limits.maxBytes}` };
  }
  return null;
}

export function checkUnsupportedType(fileName: string): ParseRejection | null {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  const allowed = ["doc", "docx", "pdf", "txt", "md", "png", "jpeg", "jpg", "html", "zip"];
  if (!allowed.includes(ext)) {
    return { reason: "UNSUPPORTED_TYPE", message: `unsupported extension .${ext}` };
  }
  return null;
}

/** ZIP bomb：压缩比（解压/压缩）超限即拒绝；同时校验路径穿越。 */
export function checkZip(bytes: Uint8Array, limits: ParseLimits): ParseRejection | null {
  const entries = readZipEntries(bytes);
  if (!entries) return null; // 非 ZIP（DOC/PDF/TXT 等）
  let totalCompressed = 0;
  let totalUncompressed = 0;
  for (const e of entries) {
    if (e.name.includes("..") || e.name.startsWith("/") || /^[a-zA-Z]:/.test(e.name)) {
      return { reason: "PATH_TRAVERSAL", message: `zip entry escapes archive: ${e.name}` };
    }
    totalCompressed += e.compressed;
    totalUncompressed += e.uncompressed;
  }
  if (totalCompressed > 0 && totalUncompressed / totalCompressed > limits.maxZipRatio) {
    return {
      reason: "ZIP_BOMB",
      message: `zip ratio ${(totalUncompressed / totalCompressed).toFixed(0)}x exceeds limit ${limits.maxZipRatio}x`,
    };
  }
  return null;
}

/** 宏/脚本检测：DOC(OLE2 VBA)、DOCX(vbaProject.bin)、HTML(<script>/事件处理器)。 */
export function checkMacroOrScript(bytes: Uint8Array, fileName: string): ParseRejection | null {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".doc") && startsWith(bytes, DOC_MAGIC)) {
    const head = new TextDecoder("latin1").decode(bytesAt(bytes, 0, Math.min(bytes.length, 1_000_000)));
    if (head.includes("VBA") || head.includes("Macros")) {
      return { reason: "MACRO_OR_SCRIPT_DETECTED", message: "DOC contains VBA macros" };
    }
  }
  if (lower.endsWith(".docx") || lower.endsWith(".xlsx")) {
    const entries = readZipEntries(bytes);
    if (entries?.some((e) => /vbaProject\.bin|vbaData\.xml|word\/macro/i.test(e.name))) {
      return { reason: "MACRO_OR_SCRIPT_DETECTED", message: "OOXML contains VBA project" };
    }
  }
  if (lower.endsWith(".html") || lower.endsWith(".htm")) {
    const head = new TextDecoder("latin1").decode(bytesAt(bytes, 0, Math.min(bytes.length, 200_000)));
    if (/<script[\s>]/i.test(head) || /\son\w+\s*=/i.test(head)) {
      return { reason: "MACRO_OR_SCRIPT_DETECTED", message: "HTML contains active script" };
    }
  }
  return null;
}

/** 入口：按序执行全部防护，返回首个拒绝原因或 null。 */
export function guardInput(
  buffer: ArrayBuffer,
  meta: { fileName: string; limits: ParseLimits },
): ParseRejection | null {
  const bytes = new Uint8Array(buffer);
  return (
    checkUnsupportedType(meta.fileName) ??
    checkSize(bytes, meta.limits) ??
    checkZip(bytes, meta.limits) ??
    checkMacroOrScript(bytes, meta.fileName) ??
    null
  );
}
