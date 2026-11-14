/**
 * V6-10 — selecting source material and storing its original bytes (S02,
 * 05-contracts §3 Asset/§10).
 *
 * One deep module owns every rule between a picked file and a saved asset:
 *
 * - `classifyFile` is the pure gate. It decides the kind from the bytes' magic,
 *   never from the name alone, and enforces S02's limits: PDF/DOCX/UTF-8
 *   TXT/MD ≤ 50 MiB; PNG/JPEG ≤ 8 MiB and ≤ 16 MP; extension or declared type
 *   that disagrees with the bytes is `MIME_MISMATCH`; a DOCX must fit the
 *   archive budget (≤ 200 MiB inflated, ≤ 10,000 entries, ratio ≤ 100) and
 *   must not carry macros, remote or absolute relationships, traversal,
 *   drive-letter, NUL or symlink entries, encryption or ZIP64. It reads and
 *   inflates every entry with a hard output cap, so a forged central directory
 *   cannot turn into a memory bomb.
 * - `ingestFiles` reads bytes once, hashes them, and writes the asset row and
 *   its bytes in ONE repository commit, so metadata and bytes cannot diverge.
 *   A file becomes usable only when that commit succeeds; a rejection or a
 *   storage failure leaves nothing behind.
 * - Uploads are deduplicated by content hash inside a matter: the same bytes
 *   picked twice answer `duplicate` with the asset already stored, and write
 *   nothing. Commits are serialized per repository and retried on
 *   `VERSION_CONFLICT` after re-reading, so up to three parallel files cannot
 *   lose each other's writes.
 * - At most `MAX_CONCURRENT_UPLOADS` (3) files are read at once (S02).
 * - Progress reports the real stage (`selected`, `uploading` with byte counts,
 *   `verifying`, `saved`, `rejected`) and never a timer.
 *
 * Parsing, OCR and `Source` creation are later tickets; this module stops at
 * `Asset.state = "available"`.
 */
import {
  MAX_DRAWING_BYTES,
  MAX_DRAWING_PIXELS,
  validateDrawing,
} from "../../lib/legacy-import.ts";
import {
  CONTRACT_VERSION,
  sha256Hex,
  type Actor,
  type AssetRecord,
  type LocalRepository,
  type MatterAggregate,
  type RepositoryErrorCode,
} from "../../lib/repository.ts";

export const DOCUMENT_MAX_BYTES = 50 * 1024 * 1024;
export const IMAGE_MAX_BYTES = MAX_DRAWING_BYTES;
export const IMAGE_MAX_PIXELS = MAX_DRAWING_PIXELS;
export const DOCX_MAX_INFLATED_BYTES = 200 * 1024 * 1024;
export const DOCX_MAX_ENTRIES = 10_000;
export const DOCX_MAX_RATIO = 100;
export const MAX_CONCURRENT_UPLOADS = 3;
/** How many times one file re-reads and retries after a `VERSION_CONFLICT`. */
export const COMMIT_ATTEMPTS = 4;

export type DocumentKind = "pdf" | "docx" | "txt" | "md";
export type ImageKind = "png" | "jpeg";
export type AcceptedKind = DocumentKind | ImageKind;

/**
 * Every code a rejected file can carry, drawn from 05-contracts §10 where the
 * contract defines one. `INVALID_INPUT` is the closest contract code for the
 * S02 rules the contract names only in prose (unreadable DOCX archive, PDF
 * trailer, non-UTF-8 text, encryption); see the receipt's decisionsRequested.
 */
export type IngestErrorCode =
  | "FILE_TOO_LARGE"
  | "IMAGE_TOO_LARGE"
  | "MIME_MISMATCH"
  | "UNSUPPORTED_MEDIA"
  | "INVALID_INPUT";

export type Classification =
  | {
      ok: true;
      kind: AcceptedKind;
      mime: string;
      bytes: Uint8Array;
      /** PNG/JPEG only: the header dimensions, checked against 16 MP. */
      dimensions?: { width: number; height: number };
    }
  | { ok: false; code: IngestErrorCode; message: string };

export interface ClassifyInput {
  bytes: Uint8Array;
  name: string;
  /** The declared MIME (`File.type` or a drag event's type); may be empty. */
  declaredType?: string | null;
}

export const KIND_MIME: Readonly<Record<AcceptedKind, string>> = Object.freeze({
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  txt: "text/plain",
  md: "text/markdown",
  png: "image/png",
  jpeg: "image/jpeg",
});

export function isImageKind(kind: AcceptedKind): kind is ImageKind {
  return kind === "png" || kind === "jpeg";
}

export function isDocumentKind(kind: AcceptedKind): kind is DocumentKind {
  return !isImageKind(kind);
}

/** The S02 limit that applies to one kind, for display and for the first check. */
export function limitForKind(kind: AcceptedKind): { code: "FILE_TOO_LARGE" | "IMAGE_TOO_LARGE"; bytes: number; label: string } {
  return isImageKind(kind)
    ? { code: "IMAGE_TOO_LARGE", bytes: IMAGE_MAX_BYTES, label: "8 MiB" }
    : { code: "FILE_TOO_LARGE", bytes: DOCUMENT_MAX_BYTES, label: "50 MiB" };
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

/**
 * Decide whether `bytes` are an acceptable source, from the bytes themselves.
 * Declared type and extension may only agree; neither can make bytes acceptable
 * that the magic does not support. Pure: no storage, no clock, no network.
 */
export function classifyFile({ bytes, name, declaredType }: ClassifyInput): Classification {
  if (!(bytes instanceof Uint8Array)) {
    return reject("INVALID_INPUT", "文件内容无法读取。");
  }
  if (bytes.byteLength === 0) {
    return reject("INVALID_INPUT", "文件是空的，换一个文件。");
  }
  const declared = normalizeDeclaredType(declaredType);
  const ext = extensionOf(name);
  const sniffed = sniffFormat(bytes);
  // Size first: a 51 MiB PDF must answer FILE_TOO_LARGE even though its kind is
  // already known from the magic, and an 8 MiB image limit applies to images.
  if (sniffed === "png" || sniffed === "jpeg") {
    if (bytes.byteLength > IMAGE_MAX_BYTES) {
      return reject("IMAGE_TOO_LARGE", `图片是 ${formatMiB(bytes.byteLength)}，上限 8 MiB。`);
    }
  } else if (bytes.byteLength > DOCUMENT_MAX_BYTES) {
    return reject("FILE_TOO_LARGE", `文件是 ${formatMiB(bytes.byteLength)}，上限 50 MiB。`);
  }

  if (sniffed === null) {
    // An OLE/CFB container declared .docx is encrypted OOXML (or a legacy .doc
    // renamed): report it as encryption, not a generic content mismatch.
    if (isCompoundFile(bytes) && (ext === "docx" || declared === KIND_MIME.docx)) {
      return reject("UNSUPPORTED_MEDIA", DOCX_ENCRYPTED_MESSAGE);
    }
    // No magic matched: only a text extension can make it a text document, and
    // claiming a binary format it does not carry is a mismatch.
    if (declared !== null && BINARY_MIMES.has(declared)) {
      return reject("MIME_MISMATCH", "文件内容与声明格式不一致；改扩展名不会改变内容。");
    }
    if (ext !== "txt" && ext !== "md") {
      // A known extension over bytes of another format is a mismatch, not an
      // unsupported type: the user renamed a file; renaming it back will not
      // help, because the content is what is wrong.
      if (ext !== null && KNOWN_EXTENSIONS.has(ext)) {
        return reject("MIME_MISMATCH", `扩展名 .${ext} 与文件内容不一致。`);
      }
      return reject(
        "UNSUPPORTED_MEDIA",
        ext === null
          ? "只接受 PDF、DOCX、TXT、MD、PNG、JPEG。"
          : `不支持 .${ext} 文件；只接受 PDF、DOCX、TXT、MD、PNG、JPEG。`,
      );
    }
    if (bytes.byteLength > DOCUMENT_MAX_BYTES) {
      return reject("FILE_TOO_LARGE", `文档是 ${formatMiB(bytes.byteLength)}，上限 50 MiB。`);
    }
    return classifyText(bytes, ext, declared ? TEXT_MIMES.has(declared) : true);
  }

  const kind = KIND_BY_FORMAT[sniffed];
  if (ext !== null && !extensionsFor(kind).includes(ext)) {
    return reject("MIME_MISMATCH", `扩展名 .${ext} 与文件内容（${kind}）不一致。`);
  }
  if (declared !== null && !mimeMatchesKind(declared, kind)) {
    return reject("MIME_MISMATCH", `声明的 ${declared} 与文件内容（${kind}）不一致。`);
  }

  switch (sniffed) {
    case "pdf": {
      const problem = checkPdfStructure(bytes);
      return problem ? problem : { ok: true, kind: "pdf", mime: KIND_MIME.pdf, bytes };
    }
    case "png":
    case "jpeg": {
      const problem = validateDrawing(KIND_MIME[sniffed], bytes);
      if (!problem.ok) {
        if (problem.code === "IMAGE_TOO_LARGE") {
          return reject("IMAGE_TOO_LARGE", `图片超过 16 MP 上限。`);
        }
        if (problem.code === "FILE_TOO_LARGE") {
          return reject("IMAGE_TOO_LARGE", `图片是 ${formatMiB(bytes.byteLength)}，上限 8 MiB。`);
        }
        return reject("MIME_MISMATCH", "图片内容不完整或已损坏，无法确认是原图。");
      }
      return {
        ok: true,
        kind: sniffed,
        mime: KIND_MIME[sniffed],
        bytes,
        dimensions: problem.dimensions,
      };
    }
    case "zip": {
      const docx = checkDocxPackage(bytes);
      return docx.ok ? { ok: true, kind: "docx", mime: KIND_MIME.docx, bytes } : docx;
    }
  }
}

const KIND_BY_FORMAT = Object.freeze({ pdf: "pdf", zip: "docx", png: "png", jpeg: "jpeg" } as const);
type SniffedFormat = keyof typeof KIND_BY_FORMAT;

const BINARY_MIMES = new Set([KIND_MIME.pdf, KIND_MIME.docx, KIND_MIME.png, KIND_MIME.jpeg]);
const TEXT_MIMES = new Set([KIND_MIME.txt, KIND_MIME.md, "text/x-markdown", "text/x-web-markdown"]);
const EXTENSIONS: Readonly<Record<AcceptedKind, readonly string[]>> = Object.freeze({
  pdf: ["pdf"],
  docx: ["docx"],
  txt: ["txt"],
  md: ["md"],
  png: ["png"],
  jpeg: ["jpg", "jpeg"],
});

function extensionsFor(kind: AcceptedKind): readonly string[] {
  return EXTENSIONS[kind];
}

const KNOWN_EXTENSIONS: ReadonlySet<string> = new Set(Object.values(EXTENSIONS).flat());

function reject(code: IngestErrorCode, message: string): { ok: false; code: IngestErrorCode; message: string } {
  return { ok: false, code, message };
}

/** Browsers report these for files whose type they do not know; they are not
 * a claim about the format, so they cannot cause a mismatch. */
const NEUTRAL_MIMES: ReadonlySet<string> = new Set(["application/octet-stream", "binary/octet-stream"]);

function normalizeDeclaredType(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const type = value.split(";")[0]!.trim().toLowerCase();
  return type === "" || NEUTRAL_MIMES.has(type) ? null : type;
}

function mimeMatchesKind(declared: string, kind: AcceptedKind): boolean {
  if (kind === "jpeg" && (declared === "image/jpg" || declared === "image/pjpeg")) return true;
  if (kind === "txt" && declared === "text/x-markdown") return true;
  if (kind === "md") return TEXT_MIMES.has(declared);
  return KIND_MIME[kind] === declared;
}

/** Lowercase extension without the dot, or null when there is none. */
export function extensionOf(name: string): string | null {
  const base = String(name ?? "").split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return null;
  const ext = base.slice(dot + 1).toLowerCase();
  return /^[a-z0-9]{1,16}$/.test(ext) ? ext : null;
}

function sniffFormat(bytes: Uint8Array): SniffedFormat | null {
  // PDF: the header may follow leading junk (ISO 32000 §7.5.2 allows it), but
  // it must appear within the first 1024 bytes.
  const head = Math.min(bytes.byteLength, 1024);
  if (ascii(bytes, 0, head).includes("%PDF-")) return "pdf";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return "png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  // A ZIP local header, or an empty archive's end record: OOXML is a ZIP, and
  // checkDocxPackage decides whether this ZIP is actually a DOCX.
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && (
    (bytes[2] === 0x03 && bytes[3] === 0x04)
    || (bytes[2] === 0x05 && bytes[3] === 0x06)
    || (bytes[2] === 0x07 && bytes[3] === 0x08)
  )) return "zip";
  return null;
}

const PDF_TRAILER = new Uint8Array([0x25, 0x25, 0x45, 0x4f, 0x46]); // %%EOF

function checkPdfStructure(bytes: Uint8Array): { ok: false; code: IngestErrorCode; message: string } | null {
  const headerAt = findBytes(bytes, asciiBytes("%PDF-"), 0);
  if (headerAt < 0 || headerAt > 1024) {
    return reject("MIME_MISMATCH", "PDF 头不正确，文件可能已损坏。");
  }
  const tailStart = Math.max(0, bytes.byteLength - 2048);
  if (findBytes(bytes, PDF_TRAILER, tailStart) < 0) {
    return reject("INVALID_INPUT", "PDF 缺少结束标记，文件可能不完整。");
  }
  // Scan every raw name, including trailer and xref-stream dictionaries. This
  // deliberately also refuses an Encrypt name in a comment/string/stream.
  if (hasPdfEncryptionName(bytes)) {
    return reject("UNSUPPORTED_MEDIA", "PDF 已加密；受密码保护的文件不能上传。");
  }
  return null;
}

/** PDF name tokens end at whitespace/delimiters; #xx encodes a name byte. */
function hasPdfEncryptionName(bytes: Uint8Array): boolean {
  const encrypt = asciiBytes("Encrypt");
  for (let index = 0; index < bytes.length; index += 1) {
    if (bytes[index] !== 0x2f) continue; // /
    let length = 0;
    let matches = true;
    index += 1;
    while (index < bytes.length && !isPdfDelimiter(bytes[index]!)) {
      let byte = bytes[index]!;
      if (byte === 0x23 && index + 2 < bytes.length) { // #
        const high = hexDigit(bytes[index + 1]!);
        const low = hexDigit(bytes[index + 2]!);
        if (high >= 0 && low >= 0) {
          byte = high * 16 + low;
          index += 2;
        }
      }
      if (byte !== encrypt[length]) matches = false;
      length += 1;
      index += 1;
    }
    if (matches && length === encrypt.length) return true;
    index -= 1; // The delimiter may begin the next name.
  }
  return false;
}

function isPdfDelimiter(byte: number): boolean {
  return byte === 0 || byte === 9 || byte === 10 || byte === 12 || byte === 13 || byte === 32
    || byte === 0x28 || byte === 0x29 || byte === 0x3c || byte === 0x3e
    || byte === 0x5b || byte === 0x5d || byte === 0x7b || byte === 0x7d
    || byte === 0x2f || byte === 0x25;
}

function hexDigit(byte: number): number {
  if (byte >= 0x30 && byte <= 0x39) return byte - 0x30;
  if (byte >= 0x41 && byte <= 0x46) return byte - 0x41 + 10;
  if (byte >= 0x61 && byte <= 0x66) return byte - 0x61 + 10;
  return -1;
}

function asciiBytes(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index += 1) out[index] = text.charCodeAt(index) & 0xff;
  return out;
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  let text = "";
  for (let index = start; index < end; index += 1) text += String.fromCharCode(bytes[index]!);
  return text;
}

function findBytes(haystack: Uint8Array, needle: Uint8Array, from: number): number {
  outer: for (let index = Math.max(0, from); index + needle.byteLength <= haystack.byteLength; index += 1) {
    for (let offset = 0; offset < needle.byteLength; offset += 1) {
      if (haystack[index + offset] !== needle[offset]) continue outer;
    }
    return index;
  }
  return -1;
}

/** TXT/MD must decode as UTF-8 and must not be binary dressed up as text. */
function classifyText(bytes: Uint8Array, ext: "txt" | "md", declaredText: boolean): Classification {
  if (!declaredText) {
    return reject("MIME_MISMATCH", "声明的类型是文本，扩展名却不是 .txt 或 .md。");
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return reject("INVALID_INPUT", "文本不是有效的 UTF-8，请另存为 UTF-8 后重试。");
  }
  // A decodable run of NUL bytes is a binary file, not text.
  if (text.includes("\u0000")) {
    return reject("MIME_MISMATCH", "文件包含二进制内容，不是文本文档。");
  }
  const kind = ext === "md" ? "md" : "txt";
  return { ok: true, kind, mime: KIND_MIME[kind], bytes };
}

// ---------------------------------------------------------------------------
// DOCX package checks (ZIP walk + real inflation under a hard cap)
// ---------------------------------------------------------------------------

const REQUIRED_DOCX_PARTS = Object.freeze(["[Content_Types].xml", "_rels/.rels", "word/document.xml"]);
const DOCUMENT_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml";
const MACRO_MARKERS = Object.freeze([
  "vbaProject",
  "macroEnabled",
  "wordprocessingml.document.macro",
  "wordprocessingml.template.macro",
]);
const REMOTE_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const DOCX_ENCRYPTED_MESSAGE = "DOCX 已加密；受密码保护的文件不能上传。";
const COMPOUND_FILE_MAGIC = Object.freeze([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const DRIVE_LETTER_PATH = /^[A-Za-z]:/;

type DocxCheck = { ok: true } | { ok: false; code: IngestErrorCode; message: string };

/**
 * Walk the whole central directory and inflate every entry with a hard output
 * cap. The declared sizes are only trusted after they agree with the real
 * output; a mismatch is an unreadable archive, not a file to accept.
 */
function checkDocxPackage(bytes: Uint8Array): DocxCheck {
  const archive = readZip(bytes);
  if (!archive.ok) return archive;
  const { entries } = archive;
  if (entries.length === 0) return reject("INVALID_INPUT", "DOCX 压缩包是空的。");
  if (entries.length > DOCX_MAX_ENTRIES) {
    return reject("FILE_TOO_LARGE", `DOCX 含 ${entries.length} 个条目，上限 ${DOCX_MAX_ENTRIES}。`);
  }

  let inflatedTotal = 0;
  let compressedInputTotal = 0;
  const names = new Set<string>();
  const inflated = new Map<string, Uint8Array>();

  for (const entry of entries) {
    if (entry.encrypted) {
      return reject("UNSUPPORTED_MEDIA", DOCX_ENCRYPTED_MESSAGE);
    }
    // A NUL in a name can truncate it in a later native consumer; names that
    // are absolute (POSIX, drive-letter or UNC) or traverse stay refused.
    if (entry.name.includes("\u0000")) {
      return reject("UNSUPPORTED_MEDIA", "DOCX 含不安全的条目名。");
    }
    if (
      entry.name.startsWith("/")
      || DRIVE_LETTER_PATH.test(entry.name)
      || entry.name.includes("\\")
      || entry.name.split("/").includes("..")
    ) {
      return reject("UNSUPPORTED_MEDIA", `DOCX 含不安全路径：${entry.name}`);
    }
    // A Unix symlink entry could make a later extractor write outside the
    // package; this module never needs one.
    if (isSymlinkEntry(entry)) {
      return reject("UNSUPPORTED_MEDIA", `DOCX 含符号链接条目：${entry.name}`);
    }
    if (names.has(entry.name)) return reject("INVALID_INPUT", `DOCX 重复条目：${entry.name}`);
    names.add(entry.name);
    if (entry.uncompressedSize > DOCX_MAX_INFLATED_BYTES) {
      return reject("FILE_TOO_LARGE", "DOCX 解压后会超过 200 MiB 上限。");
    }
    let output: Uint8Array;
    try {
      output = inflateEntry(bytes, entry, DOCX_MAX_INFLATED_BYTES - inflatedTotal);
    } catch (error) {
      if (error instanceof InflateCapError) return reject("FILE_TOO_LARGE", "DOCX 解压后会超过 200 MiB 上限。");
      return reject("INVALID_INPUT", `DOCX 条目无法解压：${entry.name}`);
    }
    if (output.byteLength !== entry.uncompressedSize || crc32(output) !== entry.crc32) {
      return reject("INVALID_INPUT", `DOCX 条目大小或校验和不符：${entry.name}`);
    }
    inflatedTotal += output.byteLength;
    compressedInputTotal += Math.max(entry.compressedSize, 0);
    if (inflatedTotal > DOCX_MAX_INFLATED_BYTES) {
      return reject("FILE_TOO_LARGE", "DOCX 解压后会超过 200 MiB 上限。");
    }
    // Only the content-types part and relationship parts are read after this
    // loop. Keeping every inflated part alive would let a package with many
    // small parts retain one backing buffer per entry for no benefit.
    if (entry.name === "[Content_Types].xml" || /\.rels$/i.test(entry.name)) {
      inflated.set(entry.name, output);
    }
  }

  // A ratio compares real output with real input; an all-stored archive has no
  // compression and cannot be a bomb.
  if (inflatedTotal > 0 && (compressedInputTotal === 0 || inflatedTotal > compressedInputTotal * DOCX_MAX_RATIO)) {
    return reject("FILE_TOO_LARGE", `DOCX 压缩比超过 ${DOCX_MAX_RATIO}。`);
  }

  const isDocxPackage = names.has("[Content_Types].xml") || names.has("word/document.xml");
  if (!isDocxPackage) {
    return reject("UNSUPPORTED_MEDIA", "不是 Word 文档（缺主文档部件声明）。");
  }
  for (const part of REQUIRED_DOCX_PARTS) {
    if (!names.has(part)) return reject("INVALID_INPUT", `DOCX 缺少必需部件：${part}`);
  }
  if (names.has("EncryptedPackage") || names.has("EncryptionInfo")) {
    return reject("UNSUPPORTED_MEDIA", DOCX_ENCRYPTED_MESSAGE);
  }
  for (const name of names) {
    const lower = name.toLowerCase();
    for (const marker of MACRO_MARKERS) {
      if (lower.includes(marker.toLowerCase())) {
        return reject("UNSUPPORTED_MEDIA", "DOCX 含宏；含 VBA 的文档不能上传。");
      }
    }
  }

  const contentTypes = decodeXmlPart(inflated.get("[Content_Types].xml")!, "[Content_Types].xml");
  if (!contentTypes.ok) return contentTypes;
  const contentTypesProblem = checkContentTypes(contentTypes.xml);
  if (contentTypesProblem) return contentTypesProblem;

  for (const [name, part] of inflated) {
    if (!/\.rels$/i.test(name)) continue;
    const decoded = decodeXmlPart(part, name);
    if (!decoded.ok) return decoded;
    const problem = checkRelationships(decoded.xml, name);
    if (problem) return problem;
  }
  return { ok: true };
}

type XmlPart = { ok: true; xml: string } | { ok: false; code: IngestErrorCode; message: string };

/**
 * Decode a package metadata part the way a conforming XML consumer does: UTF-8 unless
 * a BOM selects UTF-16LE/BE, fatal on invalid byte sequences, and no DTD.
 * `<!DOCTYPE` is refused rather than resolved: an internal entity such as
 * `<!ENTITY ext "External">` turns a visible `TargetMode="&ext;"` into an
 * external relationship for a parser that expands entities, and OPC
 * metadata parts never need a DTD.
 */
function decodeXmlPart(bytes: Uint8Array, partName: string): XmlPart {
  let encoding = "utf-8";
  let start = 0;
  if (bytes.byteLength >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    start = 3;
  } else if (bytes.byteLength >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    encoding = "utf-16le";
    start = 2;
  } else if (bytes.byteLength >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    encoding = "utf-16be";
    start = 2;
  }
  let xml: string;
  try {
    xml = new TextDecoder(encoding, { fatal: true }).decode(bytes.subarray(start));
  } catch {
    return reject("INVALID_INPUT", `${partName} 的编码无法识别。`);
  }
  // UTF-16 without a BOM is not valid XML but can look like UTF-8 once its
  // interleaved NUL bytes are ignored; XML 1.0 forbids U+0000 outright.
  if (xml.includes("\u0000")) return reject("INVALID_INPUT", `${partName} 的编码无法识别。`);
  if (/<!DOCTYPE/i.test(xml)) {
    return reject("UNSUPPORTED_MEDIA", `${partName} 含不允许的实体声明。`);
  }
  return { ok: true, xml };
}

/** A Unix symlink: host OS 3 in the version-made-by high byte, S_IFLNK mode. */
function isSymlinkEntry(entry: ZipEntry): boolean {
  return (entry.versionMadeBy >>> 8) === 3 && ((entry.externalAttrs >>> 16) & 0xf000) === 0xa000;
}

/** OLE/CFB signature: Word's encrypted .docx wrapper is a compound file. */
function isCompoundFile(bytes: Uint8Array): boolean {
  if (bytes.byteLength < COMPOUND_FILE_MAGIC.length) return false;
  return COMPOUND_FILE_MAGIC.every((byte, index) => bytes[index] === byte);
}

function checkContentTypes(xml: string): DocxCheck | null {
  const elements = xmlElements(xml);
  if (elements === null) return reject("INVALID_INPUT", "DOCX 部件声明无法识别。");
  let hasMain = false;
  for (const { name, attributes } of elements) {
    if (name !== "Default" && name !== "Override") continue;
    let partName = "";
    let contentType = "";
    const seen = new Set<string>();
    for (const { name: key, value } of attributes) {
      if (seen.has(key)) return reject("INVALID_INPUT", "DOCX 部件声明含重复属性。");
      seen.add(key);
      if (key === "partname") partName = value;
      if (key === "contenttype") contentType = value;
    }
    if (/(macroEnabled|vbaProject|vbaData|activeX|ms-word\.(?:template|document)\.macro)/i.test(contentType)) {
      return reject("UNSUPPORTED_MEDIA", "DOCX 含宏；含 VBA 的文档不能上传。");
    }
    if (name === "Override" && partName.toLowerCase() === "/word/document.xml") {
      if (hasMain || contentType !== DOCUMENT_CONTENT_TYPE) {
        return reject("UNSUPPORTED_MEDIA", "不是 Word 文档（主文档部件声明不符）。");
      }
      hasMain = true;
    }
  }
  return hasMain ? null : reject("UNSUPPORTED_MEDIA", "不是 Word 文档（缺主文档部件声明）。");
}

/**
 * External and remote relationships are refused: an uploaded original must not
 * make the later parser fetch anything (S02: 远程关系拒绝). Every `.rels` part
 * is scanned, not just the package root, and attributes are parsed tolerantly:
 * a lax consumer accepts single quotes, odd whitespace, any attribute-name
 * case and a namespace prefix on the element or an attribute. The prefix may
 * be any Unicode NCName (`<é:Relationship>`), so names are matched by their
 * local part after the last colon. Values are XML-decoded twice before
 * comparison, because a lax consumer may decode `&amp;#69;xternal` to
 * `External` and `https&amp;#58;//…` to `https://…`. Relationship Targets may
 * not traverse (`..`) or start with a backslash UNC (`\\host`).
 */
// XML 1.0 fifth edition NameStartChar/NameChar, without ':' inside an
// NCName. Unicode categories alone miss valid characters such as U+00B7.
function isXmlNameStart(code: number): boolean {
  return (code >= 0x41 && code <= 0x5a) || code === 0x5f || (code >= 0x61 && code <= 0x7a)
    || (code >= 0xc0 && code <= 0xd6) || (code >= 0xd8 && code <= 0xf6)
    || (code >= 0xf8 && code <= 0x2ff) || (code >= 0x370 && code <= 0x37d)
    || (code >= 0x37f && code <= 0x1fff) || (code >= 0x200c && code <= 0x200d)
    || (code >= 0x2070 && code <= 0x218f) || (code >= 0x2c00 && code <= 0x2fef)
    || (code >= 0x3001 && code <= 0xd7ff) || (code >= 0xf900 && code <= 0xfdcf)
    || (code >= 0xfdf0 && code <= 0xfffd) || (code >= 0x10000 && code <= 0xeffff);
}

function isXmlQualifiedName(name: string): boolean {
  const parts = name.split(":");
  if (parts.length > 2) return false;
  return parts.every((part) => {
    if (part.length === 0) return false;
    let first = true;
    for (const char of part) {
      const code = char.codePointAt(0)!;
      const continuation = code === 0x2d || code === 0x2e || code === 0xb7
        || (code >= 0x30 && code <= 0x39) || (code >= 0x300 && code <= 0x36f)
        || (code >= 0x203f && code <= 0x2040);
      if (!isXmlNameStart(code) && (first || !continuation)) return false;
      first = false;
    }
    return true;
  });
}
// Tokenise broadly first, then validate the entire name. Sticky matching
// prevents an unrecognised prefix/attribute from silently disappearing.
const XML_NAME_TOKEN = /[^ \t\r\n/>=]+/uy;
const XML_ATTRIBUTE = /([^ \t\r\n/>=]+)[ \t\r\n]*=[ \t\r\n]*(?:"([^"<]*)"|'([^'<]*)'|([^ \t\r\n"'<>]+?)(?=[ \t\r\n]|\/?>))/uy;
const XML_ENTITY = /&(?:#x([0-9a-f]+)|#([0-9]+)|(amp|lt|gt|quot|apos));?/gi;

/** The local part of a possibly namespace-prefixed XML name. */
function localName(qualified: string): string {
  const colon = qualified.lastIndexOf(":");
  return colon === -1 ? qualified : qualified.slice(colon + 1);
}

function checkRelationships(xml: string, partName: string): DocxCheck | null {
  const elements = xmlElements(xml);
  if (elements === null) return reject("INVALID_INPUT", `${partName} 的 XML 名称或语法无法识别。`);
  const remote = reject("UNSUPPORTED_MEDIA", `${partName} 含外部或远程关系。`);
  for (const { name: elementName, attributes } of elements) {
    if (elementName !== "Relationship") continue;
    for (const { name, value } of attributes) {
      if (name === "type" && /(?:vbaProject|\/wordVbaData$)/i.test(value)) {
        return reject("UNSUPPORTED_MEDIA", `${partName} 含宏；含 VBA 的文档不能上传。`);
      }
      if (name === "targetmode" && value.toLowerCase() === "external") return remote;
      if (
        name === "target"
        && (REMOTE_SCHEME.test(value)
          || value.startsWith("//")
          || value.startsWith("\\\\")
          || value.split(/[\\/]/).includes(".."))
      ) return remote;
    }
  }
  return null;
}

type XmlElement = { name: string; attributes: { name: string; value: string }[] };

/** Consume each tag and attribute in order. Nothing unrecognised is skipped;
 * comments, CDATA and processing instructions are the only ignored markup.
 * Matching names by local part remains conservative about namespace identity. */
function xmlElements(xml: string): XmlElement[] | null {
  const elements: XmlElement[] = [];
  let index = 0;
  while (index < xml.length) {
    const start = xml.indexOf("<", index);
    if (start === -1) break;
    const terminator = xml.startsWith("<!--", start) ? "-->"
      : xml.startsWith("<![CDATA[", start) ? "]]>"
      : xml.startsWith("<?", start) ? "?>" : null;
    if (terminator !== null) {
      const end = xml.indexOf(terminator, start + (terminator === "-->" ? 4 : terminator === "]]>" ? 9 : 2));
      if (end === -1) return null;
      index = end + terminator.length;
      continue;
    }
    index = start + 1;
    const closing = xml[index] === "/";
    if (closing) index += 1;
    XML_NAME_TOKEN.lastIndex = index;
    const token = XML_NAME_TOKEN.exec(xml);
    if (!token || !isXmlQualifiedName(token[0])) return null;
    index = XML_NAME_TOKEN.lastIndex;
    const element: XmlElement = { name: localName(token[0]), attributes: [] };
    let ended = false;
    while (index < xml.length) {
      const beforeSpace = index;
      while (index < xml.length && /[ \t\r\n]/.test(xml[index]!)) index += 1;
      if (xml[index] === ">") {
        index += 1;
        ended = true;
        break;
      }
      if (!closing && xml.startsWith("/>", index)) {
        index += 2;
        ended = true;
        break;
      }
      if (closing || beforeSpace === index) return null;
      XML_ATTRIBUTE.lastIndex = index;
      const attribute = XML_ATTRIBUTE.exec(xml);
      if (!attribute || !isXmlQualifiedName(attribute[1]!)) return null;
      element.attributes.push({
        name: localName(attribute[1]!).toLowerCase(),
        value: relationshipValue(attribute[2] ?? attribute[3] ?? attribute[4] ?? ""),
      });
      index = XML_ATTRIBUTE.lastIndex;
    }
    if (!ended) return null;
    if (!closing) elements.push(element);
  }
  return elements;
}

/** Decode XML character and named entities the way a lax consumer may. */
function decodeXmlEntitiesOnce(text: string): string {
  return text.replace(
    XML_ENTITY,
    (_whole: string, hex: string | undefined, decimal: string | undefined, named: string | undefined) => {
      if (hex !== undefined) return xmlCodePoint(Number.parseInt(hex, 16));
      if (decimal !== undefined) return xmlCodePoint(Number.parseInt(decimal, 10));
      switch (named!.toLowerCase()) {
        case "amp":
          return "&";
        case "lt":
          return "<";
        case "gt":
          return ">";
        case "quot":
          return '"';
        default:
          return "'";
      }
    },
  );
}

function decodeXmlEntitiesTwice(text: string): string {
  return decodeXmlEntitiesOnce(decodeXmlEntitiesOnce(text));
}

/**
 * Decode twice, then drop surrounding quotes: a lax consumer that decodes
 * entities before tokenising reads `TargetMode=&quot;External&quot;` as
 * `TargetMode="External"`.
 */
function relationshipValue(raw: string): string {
  return decodeXmlEntitiesTwice(raw).trim().replace(/^["']+|["']+$/g, "").trim();
}

function xmlCodePoint(value: number): string {
  return Number.isInteger(value) && value >= 0 && value <= 0x10ffff ? String.fromCodePoint(value) : "�";
}

interface ZipEntry {
  name: string;
  compression: number;
  encrypted: boolean;
  crc32: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
  /** Host OS of the maker (high byte) and raw external attributes. */
  versionMadeBy: number;
  externalAttrs: number;
}

type ZipRead = { ok: true; entries: ZipEntry[] } | { ok: false; code: IngestErrorCode; message: string };

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const ZIP64_MARKER = 0xffffffff;

function readZip(bytes: Uint8Array): ZipRead {
  const eocd = findEocd(bytes);
  if (eocd < 0) return reject("INVALID_INPUT", "DOCX 压缩包结构不完整。");
  const entryCount = readU16(bytes, eocd + 10);
  const directoryOffset = readU32(bytes, eocd + 16);
  if (readU16(bytes, eocd + 4) !== 0 || readU16(bytes, eocd + 6) !== 0) {
    return reject("UNSUPPORTED_MEDIA", "多卷 DOCX 不受支持。");
  }
  if (readU16(bytes, eocd + 8) !== entryCount) {
    return reject("UNSUPPORTED_MEDIA", "多盘 DOCX 不受支持。");
  }
  if (entryCount === 0xffff || directoryOffset === ZIP64_MARKER) {
    return reject("UNSUPPORTED_MEDIA", "ZIP64 DOCX 不受支持。");
  }
  if (directoryOffset + entryCount * 46 > eocd) {
    return reject("INVALID_INPUT", "DOCX 目录偏移不正确。");
  }

  const entries: ZipEntry[] = [];
  let offset = directoryOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > eocd || readU32(bytes, offset) !== CENTRAL_SIGNATURE) {
      return reject("INVALID_INPUT", "DOCX 中央目录损坏。");
    }
    const flags = readU16(bytes, offset + 8);
    const compression = readU16(bytes, offset + 10);
    const crc = readU32(bytes, offset + 16);
    const compressedSize = readU32(bytes, offset + 20);
    const uncompressedSize = readU32(bytes, offset + 24);
    const nameLength = readU16(bytes, offset + 28);
    const extraLength = readU16(bytes, offset + 30);
    const commentLength = readU16(bytes, offset + 32);
    const externalAttrs = readU32(bytes, offset + 38);
    const localHeaderOffset = readU32(bytes, offset + 42);
    const versionMadeBy = readU16(bytes, offset + 4);
    const nameStart = offset + 46;
    const nameEnd = nameStart + nameLength;
    if (nameEnd > eocd) return reject("INVALID_INPUT", "DOCX 条目名越界。");
    let name: string;
    try {
      name = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(nameStart, nameEnd));
    } catch {
      return reject("INVALID_INPUT", "DOCX 条目名不是 UTF-8。");
    }
    if (compressedSize === ZIP64_MARKER || uncompressedSize === ZIP64_MARKER || localHeaderOffset === ZIP64_MARKER) {
      return reject("UNSUPPORTED_MEDIA", "ZIP64 DOCX 不受支持。");
    }
    entries.push({
      name,
      compression,
      encrypted: (flags & 0x0001) !== 0,
      crc32: crc,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
      versionMadeBy,
      externalAttrs,
    });
    offset = nameEnd + extraLength + commentLength;
  }
  return { ok: true, entries };
}

function findEocd(bytes: Uint8Array): number {
  const last = bytes.byteLength - 22;
  const first = Math.max(0, bytes.byteLength - 22 - 0xffff);
  for (let offset = last; offset >= first; offset -= 1) {
    if (readU32(bytes, offset) === EOCD_SIGNATURE) return offset;
  }
  return -1;
}

function readU16(bytes: Uint8Array, offset: number): number {
  if (offset + 2 > bytes.byteLength) return -1;
  return bytes[offset]! | (bytes[offset + 1]! << 8);
}

function readU32(bytes: Uint8Array, offset: number): number {
  if (offset + 4 > bytes.byteLength) return -1;
  return (bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16) | (bytes[offset + 3]! << 24)) >>> 0;
}

class InflateCapError extends Error {
  constructor() {
    super("inflate output exceeds the DOCX budget");
    this.name = "InflateCapError";
  }
}

/** Inflate one entry's real bytes from its local header; `cap` bounds output. */
function inflateEntry(bytes: Uint8Array, entry: ZipEntry, cap: number): Uint8Array {
  const local = entry.localHeaderOffset;
  if (local + 30 > bytes.byteLength || readU32(bytes, local) !== LOCAL_SIGNATURE) {
    throw new Error("local header missing");
  }
  const nameLength = readU16(bytes, local + 26);
  const extraLength = readU16(bytes, local + 28);
  const dataStart = local + 30 + nameLength + extraLength;
  const dataEnd = dataStart + entry.compressedSize;
  if (dataStart < 0 || dataEnd > bytes.byteLength) throw new Error("entry data out of bounds");
  const data = bytes.subarray(dataStart, dataEnd);
  if (entry.compression === 0) {
    if (data.byteLength > cap) throw new InflateCapError();
    return new Uint8Array(data);
  }
  if (entry.compression !== 8) throw new Error(`compression ${entry.compression} unsupported`);
  return inflateRaw(data, cap, entry.uncompressedSize);
}

// ---------------------------------------------------------------------------
// Raw DEFLATE (RFC 1951) — small, synchronous, cap-aware
// ---------------------------------------------------------------------------

const LENGTH_BASE = Object.freeze([
  3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31,
  35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258,
]);
const LENGTH_EXTRA = Object.freeze([
  0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2,
  3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0,
]);
const DISTANCE_BASE = Object.freeze([
  1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193,
  257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577,
]);
const DISTANCE_EXTRA = Object.freeze([
  0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6,
  7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13,
]);
const CODE_LENGTH_ORDER = Object.freeze([16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15]);

interface Huffman {
  counts: Int32Array;
  symbols: Int32Array;
}

/** Canonical Huffman decoding table (counts per length, symbols in order). */
function buildHuffman(lengths: ArrayLike<number>): Huffman {
  const counts = new Int32Array(16);
  for (let index = 0; index < lengths.length; index += 1) counts[lengths[index]!]! += 1;
  counts[0] = 0;
  const offsets = new Int32Array(16);
  for (let bits = 1; bits < 16; bits += 1) offsets[bits] = offsets[bits - 1]! + counts[bits - 1]!;
  const symbols = new Int32Array(lengths.length);
  for (let symbol = 0; symbol < lengths.length; symbol += 1) {
    const length = lengths[symbol]!;
    if (length !== 0) symbols[offsets[length]!++] = symbol;
  }
  return { counts, symbols };
}

class Bits {
  private buffer = 0;
  private bitCount = 0;
  private readonly bytes: Uint8Array;
  private offset = 0;

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
  }

  read(count: number): number {
    while (this.bitCount < count) {
      if (this.offset >= this.bytes.byteLength) throw new Error("deflate stream ended early");
      this.buffer |= this.bytes[this.offset++]! << this.bitCount;
      this.bitCount += 8;
    }
    const value = this.buffer & ((1 << count) - 1);
    this.buffer >>>= count;
    this.bitCount -= count;
    return value;
  }

  alignToByte(): void {
    this.buffer = 0;
    this.bitCount = 0;
  }
}

function decodeSymbol(bits: Bits, table: Huffman): number {
  let code = 0;
  let first = 0;
  let index = 0;
  for (let length = 1; length < 16; length += 1) {
    code |= bits.read(1);
    const count = table.counts[length]!;
    if (code - first < count) return table.symbols[index + (code - first)]!;
    index += count;
    first = (first + count) << 1;
    code <<= 1;
  }
  throw new Error("invalid Huffman code");
}

let fixedLiteral: Huffman | null = null;
let fixedDistance: Huffman | null = null;

function fixedTables(): { literal: Huffman; distance: Huffman } {
  if (fixedLiteral === null || fixedDistance === null) {
    const lengths = new Uint8Array(288);
    lengths.fill(8, 0, 144);
    lengths.fill(9, 144, 256);
    lengths.fill(7, 256, 280);
    lengths.fill(8, 280, 288);
    fixedLiteral = buildHuffman(lengths);
    const distances = new Uint8Array(30).fill(5);
    fixedDistance = buildHuffman(distances);
  }
  return { literal: fixedLiteral, distance: fixedDistance };
}

/**
 * Inflate a raw DEFLATE stream; throws `InflateCapError` past `cap` bytes.
 *
 * `sizeHint` is the central-directory size (untrusted, used only to size the
 * first buffer). Tiny parts otherwise start with a 64 KiB buffer, and keeping
 * one of those per archive entry would retain 64 KiB for a 13-byte part. The
 * hint is capped at 8 KiB so a lying declared size cannot preallocate 64 KiB
 * per entry either; growth below 64 KiB is geometric anyway. The result is
 * copied down to its real length whenever the buffer is larger, so a retained
 * part never pins an oversized backing store.
 */
export function inflateRaw(input: Uint8Array, cap: number, sizeHint = -1): Uint8Array {
  const bits = new Bits(input);
  const initial = sizeHint >= 0
    ? Math.min(cap, Math.min(Math.trunc(sizeHint), 1 << 13))
    : Math.min(cap, 1 << 16);
  let output: Uint8Array = new Uint8Array(initial);
  let length = 0;
  let final = false;
  while (!final) {
    final = bits.read(1) === 1;
    const type = bits.read(2);
    if (type === 0) {
      bits.alignToByte();
      const blockLength = bits.read(16);
      const inverse = bits.read(16);
      if ((blockLength ^ 0xffff) !== inverse) throw new Error("stored block length mismatch");
      if (length + blockLength > cap) throw new InflateCapError();
      output = ensureCapacity(output, length + blockLength, cap);
      for (let index = 0; index < blockLength; index += 1) {
        output[length++] = bits.read(8);
      }
      continue;
    }
    let literal: Huffman;
    let distance: Huffman;
    if (type === 1) {
      ({ literal, distance } = fixedTables());
    } else if (type === 2) {
      const literalCount = bits.read(5) + 257;
      const distanceCount = bits.read(5) + 1;
      const codeLengthCount = bits.read(4) + 4;
      const codeLengths = new Uint8Array(19);
      for (let index = 0; index < codeLengthCount; index += 1) {
        codeLengths[CODE_LENGTH_ORDER[index]!] = bits.read(3);
      }
      const codeLengthTable = buildHuffman(codeLengths);
      const lengths = new Uint8Array(literalCount + distanceCount);
      let index = 0;
      while (index < lengths.length) {
        const symbol = decodeSymbol(bits, codeLengthTable);
        if (symbol < 16) {
          lengths[index++] = symbol;
        } else if (symbol === 16) {
          if (index === 0) throw new Error("repeat with no previous length");
          const previous = lengths[index - 1]!;
          const repeat = 3 + bits.read(2);
          for (let count = 0; count < repeat; count += 1) lengths[index++] = previous;
        } else if (symbol === 17) {
          for (let count = 0, repeat = 3 + bits.read(3); count < repeat; count += 1) lengths[index++] = 0;
        } else {
          for (let count = 0, repeat = 11 + bits.read(7); count < repeat; count += 1) lengths[index++] = 0;
        }
        if (index > lengths.length) throw new Error("code lengths overflow");
      }
      literal = buildHuffman(lengths.subarray(0, literalCount));
      distance = buildHuffman(lengths.subarray(literalCount));
    } else {
      throw new Error("reserved deflate block type");
    }

    let symbol: number;
    while ((symbol = decodeSymbol(bits, literal)) !== 256) {
      if (symbol < 256) {
        if (length >= cap) throw new InflateCapError();
        output = ensureCapacity(output, length + 1, cap);
        output[length++] = symbol;
        continue;
      }
      const lengthIndex = symbol - 257;
      if (lengthIndex >= LENGTH_BASE.length) throw new Error("invalid length code");
      const copyLength = LENGTH_BASE[lengthIndex]! + bits.read(LENGTH_EXTRA[lengthIndex]!);
      const distanceSymbol = decodeSymbol(bits, distance);
      if (distanceSymbol >= DISTANCE_BASE.length) throw new Error("invalid distance code");
      const copyDistance = DISTANCE_BASE[distanceSymbol]! + bits.read(DISTANCE_EXTRA[distanceSymbol]!);
      if (copyDistance > length) throw new Error("distance before start of output");
      if (length + copyLength > cap) throw new InflateCapError();
      output = ensureCapacity(output, length + copyLength, cap);
      for (let count = 0; count < copyLength; count += 1) {
        output[length] = output[length - copyDistance]!;
        length += 1;
      }
    }
  }
  // `slice` copies; `subarray` would keep the (possibly 64 KiB) backing buffer
  // alive for as long as the caller retains a 13-byte part.
  return length === output.byteLength ? output : output.slice(0, length);
}

/**
 * Grow geometrically, never by the exact amount needed: a stream of literals
 * and short matches would otherwise reallocate and copy the whole buffer on
 * every symbol, which is quadratic in the output size (a 4 MiB all-zeros
 * stream took seconds). Doubling keeps the total copied bytes linear and the
 * number of allocations logarithmic; `cap` still bounds the allocation.
 */
function ensureCapacity(buffer: Uint8Array, needed: number, cap: number): Uint8Array {
  if (needed <= buffer.byteLength) return buffer;
  if (needed > cap) throw new InflateCapError();
  const grown = Math.min(cap, Math.max(buffer.byteLength * 2, 1 << 16));
  const next = new Uint8Array(Math.max(needed, grown));
  next.set(buffer.subarray(0, buffer.byteLength));
  return next;
}

let crcTable: Uint32Array | null = null;

/** CRC-32 (IEEE) of `bytes`, matched against each ZIP entry's declared CRC. */
export function crc32(bytes: Uint8Array): number {
  if (crcTable === null) {
    crcTable = new Uint32Array(256);
    for (let index = 0; index < 256; index += 1) {
      let value = index;
      for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
      crcTable[index] = value >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let index = 0; index < bytes.byteLength; index += 1) {
    crc = (crcTable[(crc ^ bytes[index]!) & 0xff]! ^ (crc >>> 8)) >>> 0;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// ---------------------------------------------------------------------------
// Ingestion
// ---------------------------------------------------------------------------

/** Anything with a name and `File`-like bytes: a browser `File` works as-is. */
export type IngestFile = Blob & { readonly name: string };

export type IngestStage = "selected" | "uploading" | "verifying" | "saved" | "rejected";

export interface IngestProgress {
  /** Stable per call: `file.name` is not unique across picks. */
  fileId: string;
  name: string;
  stage: IngestStage;
  receivedBytes: number;
  totalBytes: number;
  /** Present on `rejected` only. */
  code?: IngestErrorCode;
  /** Present on `saved`/`duplicate` only. */
  assetId?: string;
}

/** Why a valid file still was not stored; every code is in CONTRACT_ERROR_CODES. */
export type IngestFailureCode = RepositoryErrorCode | "CAPABILITY_UNAVAILABLE" | "INTERNAL_ERROR";

export type IngestOutcome =
  | { status: "saved"; fileId: string; name: string; assetId: string; sha256: string; byteLength: number; kind: AcceptedKind }
  | { status: "duplicate"; fileId: string; name: string; assetId: string; sha256: string; byteLength: number; kind: AcceptedKind }
  | { status: "rejected"; fileId: string; name: string; code: IngestErrorCode; message: string }
  | { status: "cancelled"; fileId: string; name: string }
  | { status: "failed"; fileId: string; name: string; code: IngestFailureCode; message: string };

export interface IngestOptions {
  onProgress?: (progress: IngestProgress) => void;
  signal?: AbortSignal;
  /**
   * Stable ids for the files, in input order. The UI reuses the same row when a
   * failed file is retried, so progress and the outcome can be matched even
   * though the underlying bytes are read again.
   */
  fileIds?: readonly string[];
  /** Injectable clock for deterministic tests; defaults to `new Date()`. */
  now?: () => Date;
  /** Injectable id source for deterministic tests; defaults to `crypto.randomUUID`. */
  newId?: () => string;
}

interface ByteSource {
  name: string;
  declaredType: string;
  size: number;
  read: (onProgress: (received: number) => void, signal?: AbortSignal) => Promise<Uint8Array>;
}

/**
 * Validate and store every picked file as a `source` asset of `matterId`.
 * Each file is independent: one rejection or failure does not stop the others,
 * and nothing is written for a file that does not reach a successful commit.
 */
export async function ingestFiles(
  repository: LocalRepository,
  actor: Actor,
  matterId: string,
  files: readonly IngestFile[],
  options: IngestOptions = {},
): Promise<IngestOutcome[]> {
  const now = options.now ?? (() => new Date());
  const newId = options.newId ?? (() => globalThis.crypto.randomUUID());
  const lock = commitLock(repository);
  const sources = files.map(toSource);
  const outcomes = new Array<IngestOutcome>(sources.length);
  let next = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      if (options.signal?.aborted) return;
      const index = next++;
      if (index >= sources.length) return;
      outcomes[index] = await ingestOne(repository, actor, matterId, sources[index]!, index, {
        now,
        newId,
        lock,
        options,
      });
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(MAX_CONCURRENT_UPLOADS, sources.length) }, () => worker()),
  );
  // Files the cancellation stopped before they started still own a row.
  for (let index = 0; index < sources.length; index += 1) {
    outcomes[index] ??= { status: "cancelled", fileId: sourceId(options, index), name: sources[index]!.name };
  }
  return outcomes;
}

function toSource(file: IngestFile): ByteSource {
  return {
    name: typeof file.name === "string" && file.name.length > 0 ? file.name : "未命名文件",
    declaredType: typeof file.type === "string" ? file.type : "",
    size: typeof file.size === "number" ? file.size : 0,
    read: (onProgress, signal) => readBlob(file, onProgress, signal),
  };
}

/** Read a Blob in slices, so progress is real bytes and cancellation is prompt.
 * The signal is checked between slices as well as by the caller afterwards. */
async function readBlob(
  blob: Blob,
  onProgress: (received: number) => void,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const size = blob.size;
  if (size === 0) return new Uint8Array();
  const out = new Uint8Array(size);
  const chunkSize = 256 * 1024;
  let offset = 0;
  while (offset < size) {
    if (signal?.aborted) throw abortError();
    const end = Math.min(offset + chunkSize, size);
    const chunk = new Uint8Array(await blob.slice(offset, end).arrayBuffer());
    if (chunk.byteLength === 0) break;
    out.set(chunk, offset);
    offset += chunk.byteLength;
    onProgress(offset);
  }
  return offset === size ? out : out.subarray(0, offset);
}

function abortError(): Error {
  const error = new Error("已取消。");
  error.name = "AbortError";
  return error;
}

function sourceId(options: IngestOptions, index: number): string {
  return options.fileIds?.[index] ?? `file-${index}`;
}

async function ingestOne(
  repository: LocalRepository,
  actor: Actor,
  matterId: string,
  source: ByteSource,
  index: number,
  context: {
    now: () => Date;
    newId: () => string;
    lock: <T>(run: () => Promise<T>) => Promise<T>;
    options: IngestOptions;
  },
): Promise<IngestOutcome> {
  const fileId = sourceId(context.options, index);
  const emit = (progress: Omit<IngestProgress, "fileId" | "name">): void => {
    context.options.onProgress?.({ fileId, name: source.name, ...progress });
  };
  emit({ stage: "selected", receivedBytes: 0, totalBytes: source.size });

  if (context.options.signal?.aborted) return { status: "cancelled", fileId, name: source.name };
  if (source.size > DOCUMENT_MAX_BYTES) {
    return rejectOutcome(fileId, source.name, "FILE_TOO_LARGE", `文件是 ${formatMiB(source.size)}，上限 50 MiB。`, emit);
  }

  let bytes: Uint8Array;
  try {
    bytes = await source.read(
      (received) => emit({ stage: "uploading", receivedBytes: received, totalBytes: source.size }),
      context.options.signal,
    );
  } catch (error) {
    if (isAbort(error) || context.options.signal?.aborted) {
      return { status: "cancelled", fileId, name: source.name };
    }
    return rejectOutcome(fileId, source.name, "INVALID_INPUT", "文件无法读取。", emit);
  }
  if (context.options.signal?.aborted) return { status: "cancelled", fileId, name: source.name };
  // `read` already reported the last byte; the next real stage is verification.
  emit({ stage: "verifying", receivedBytes: bytes.byteLength, totalBytes: bytes.byteLength });

  const classification = classifyFile({ bytes, name: source.name, declaredType: source.declaredType });
  if (!classification.ok) {
    return rejectOutcome(fileId, source.name, classification.code, classification.message, emit);
  }

  let sha256: string;
  try {
    sha256 = await sha256Hex(classification.bytes);
  } catch {
    return {
      status: "failed",
      fileId,
      name: source.name,
      code: "CAPABILITY_UNAVAILABLE",
      message: "这台设备无法计算文件哈希，文件没有保存。",
    };
  }

  const store = () =>
    writeAsset(repository, actor, matterId, {
      fileId,
      name: source.name,
      kind: classification.kind,
      mime: classification.mime,
      bytes: classification.bytes,
      sha256,
      now: context.now,
      newId: context.newId,
      signal: context.options.signal,
    });

  const result: WriteResult = context.options.signal?.aborted
    ? { ok: false, code: "CANCELLED", message: "已取消。" }
    : await context.lock(store);
  if (!result.ok) {
    if (result.code === "CANCELLED") return { status: "cancelled", fileId, name: source.name };
    return {
      status: "failed",
      fileId,
      name: source.name,
      code: result.code,
      message: result.message,
    };
  }
  emit({
    stage: "saved",
    receivedBytes: bytes.byteLength,
    totalBytes: bytes.byteLength,
    assetId: result.asset.id,
  });
  return {
    status: result.duplicate ? "duplicate" : "saved",
    fileId,
    name: source.name,
    assetId: result.asset.id,
    sha256: result.asset.sha256,
    byteLength: result.asset.byteLength,
    kind: classification.kind,
  };
}

function rejectOutcome(
  fileId: string,
  name: string,
  code: IngestErrorCode,
  message: string,
  emit: (progress: Omit<IngestProgress, "fileId" | "name">) => void,
): IngestOutcome {
  emit({ stage: "rejected", receivedBytes: 0, totalBytes: 0, code });
  return { status: "rejected", fileId, name, code, message };
}

function isAbort(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { name?: unknown }).name === "AbortError";
}

type WriteResult =
  | { ok: true; asset: AssetRecord; duplicate: boolean }
  | { ok: false; code: IngestFailureCode | "CANCELLED"; message: string };

interface WriteAssetInput {
  fileId: string;
  name: string;
  kind: AcceptedKind;
  mime: string;
  bytes: Uint8Array;
  sha256: string;
  now: () => Date;
  newId: () => string;
  signal?: AbortSignal;
}

/**
 * Write the asset row and its bytes in one commit. A duplicate hash inside the
 * matter reuses the stored asset and writes nothing; a version race re-reads
 * and retries, re-checking the duplicate before every attempt.
 */
async function writeAsset(
  repository: LocalRepository,
  actor: Actor,
  matterId: string,
  input: WriteAssetInput,
): Promise<WriteResult> {
  for (let attempt = 0; attempt < COMMIT_ATTEMPTS; attempt += 1) {
    if (input.signal?.aborted) return { ok: false, code: "CANCELLED", message: "已取消。" };
    const loaded = await repository.loadMatter(actor, matterId);
    if (!loaded.ok) return { ok: false, code: loaded.error.code, message: loaded.error.message };
    const { data, version } = loaded.data;
    if (data.matter.status !== "active") {
      return { ok: false, code: "INVALID_TRANSITION", message: "案件已归档，不能添加材料。" };
    }
    const existing = data.assets.find(
      (asset) =>
        asset.purpose === "source"
        && asset.state === "available"
        && asset.sha256 === input.sha256
        && asset.byteLength === input.bytes.byteLength,
    );
    if (existing) return { ok: true, asset: existing, duplicate: true };

    const timestamp = input.now().toISOString();
    const id = input.newId();
    const asset: AssetRecord = {
      id,
      tenantId: data.matter.tenantId,
      matterId,
      serviceOrderId: null,
      purpose: "source",
      originalName: sanitizeName(input.name),
      mime: input.mime,
      byteLength: input.bytes.byteLength,
      sha256: input.sha256,
      state: "available",
      objectKey: `local/${data.matter.tenantId}/${matterId}/${id}`,
      createdAt: timestamp,
    };
    const written = await repository.commit(
      actor,
      {
        contractVersion: CONTRACT_VERSION,
        expectedVersion: version,
        payload: {
          matter: { ...data.matter, version: version + 1, updatedAt: timestamp },
          targets: data.targets,
          assets: [...data.assets, asset],
          events: [],
          blobs: [{ assetId: id, bytes: input.bytes, sha256: input.sha256, byteLength: input.bytes.byteLength }],
        },
      },
      { requestId: input.newId() },
    );
    if (written.ok) {
      const stored = written.data.data.assets.find((candidate) => candidate.id === id);
      if (!stored) return { ok: false, code: "INTERNAL_ERROR", message: "保存后的资产记录缺失。" };
      return { ok: true, asset: stored, duplicate: false };
    }
    if (written.error.code !== "VERSION_CONFLICT") {
      return { ok: false, code: written.error.code, message: written.error.message };
    }
  }
  return {
    ok: false,
    code: "VERSION_CONFLICT",
    message: "案件同时被其他操作更新，材料没有全部保存，请重试。",
  };
}

/** Keep a display name short and harmless; the object key never uses it. */
function sanitizeName(name: string): string {
  const base = String(name).split(/[\\/]/).pop() ?? "";
  const trimmed = base.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (trimmed.length === 0) return "未命名文件";
  return Array.from(trimmed).slice(0, 200).join("");
}

/**
 * One commit chain per repository instance: three parallel files append to the
 * same aggregate, and serializing them locally turns a version race into a
 * queue instead of retries. A WeakMap keeps the chain from outliving the
 * repository.
 */
const LOCKS = new WeakMap<LocalRepository, Promise<unknown>>();

function commitLock(repository: LocalRepository): <T>(run: () => Promise<T>) => Promise<T> {
  return <T>(run: () => Promise<T>): Promise<T> => {
    const previous = LOCKS.get(repository) ?? Promise.resolve();
    const current = previous.then(run, run);
    LOCKS.set(repository, current.then(() => undefined, () => undefined));
    return current;
  };
}

function formatMiB(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

// ---------------------------------------------------------------------------
// UI view model (pure, so the component stays thin and this file is testable)
// ---------------------------------------------------------------------------

export interface UploadRow {
  fileId: string;
  name: string;
  stage: IngestStage;
  /** 0..1 while uploading, 1 otherwise; never a timer-driven value. */
  fraction: number;
  label: string;
  error: string | null;
  canRemove: boolean;
  saved: boolean;
  assetId: string | null;
}

export interface UploadView {
  rows: UploadRow[];
  /** Every row is saved/duplicate; nothing is in flight. */
  allSaved: boolean;
  /** A row was rejected or failed and needs the user's attention. */
  hasProblems: boolean;
  canAnswerWithoutDocuments: boolean;
}

export const STAGE_LABELS: Readonly<Record<IngestStage, string>> = Object.freeze({
  selected: "已选择",
  uploading: "正在读取",
  verifying: "正在校验",
  saved: "已保存",
  rejected: "未接受",
});

export const INGEST_ERROR_MESSAGES: Readonly<Record<IngestErrorCode | IngestFailureCode, string>> = Object.freeze({
  FILE_TOO_LARGE: "超过 50 MiB 上限；换一个文件。",
  IMAGE_TOO_LARGE: "图片超过 8 MiB 或 16 MP 上限；没有生成缩小副本。",
  MIME_MISMATCH: "文件内容与扩展名或声明类型不一致；换一个文件。",
  UNSUPPORTED_MEDIA: "不接受这种文件；只接受 PDF、DOCX、TXT、MD、PNG、JPEG。",
  INVALID_INPUT: "文件无法通过校验；换一个文件。",
  VERSION_CONFLICT: "案件同时被其他操作更新，请重试。",
  RESOURCE_NOT_FOUND: "案件不存在或无权访问。",
  INVALID_TRANSITION: "案件当前状态不允许添加材料。",
  QUOTA_EXCEEDED: "本机存储空间已满；释放空间后重试。",
  STORAGE_UNAVAILABLE: "本机存储不可用；文件没有保存。",
  HASH_MISMATCH: "已存字节与记录的哈希不符；文件没有保存。",
  CAPABILITY_UNAVAILABLE: "这台设备无法校验文件；文件没有保存。",
  INTERNAL_ERROR: "保存时发生内部错误；文件没有保存。",
});

/**
 * Derive everything the upload section shows from the rows it owns. `saved`
 * is true only for a committed (or already stored) asset, so no failure path
 * can show 「已保存」.
 */
export function describeUploadRows(rows: readonly UploadRow[]): UploadView {
  const allSaved = rows.length > 0 && rows.every((row) => row.saved);
  // A cancelled row is not a problem: the user asked for it and can remove it.
  const hasProblems = rows.some((row) => row.error !== null);
  return {
    rows: [...rows],
    allSaved,
    hasProblems,
    // S02: answering without any document is always available and creates no
    // virtual attachment.
    canAnswerWithoutDocuments: true,
  };
}

/** Build one row from a progress event and, when finished, its outcome. */
export function rowFromProgress(
  progress: IngestProgress,
  outcome: IngestOutcome | null,
): UploadRow {
  if (outcome) {
    if (outcome.status === "cancelled") {
      return {
        fileId: outcome.fileId,
        name: outcome.name,
        stage: "rejected",
        fraction: fractionOf(progress),
        label: "已取消",
        error: null,
        canRemove: true,
        saved: false,
        assetId: null,
      };
    }
    const saved = outcome.status === "saved" || outcome.status === "duplicate";
    const error =
      outcome.status === "rejected" || outcome.status === "failed"
        ? INGEST_ERROR_MESSAGES[outcome.code]
        : null;
    return {
      fileId: outcome.fileId,
      name: outcome.name,
      stage: saved ? "saved" : outcome.status === "rejected" || outcome.status === "failed" ? "rejected" : progress.stage,
      fraction: saved ? 1 : fractionOf(progress),
      label: saved ? STAGE_LABELS.saved : error ?? STAGE_LABELS[progress.stage],
      error,
      canRemove: !saved,
      saved,
      assetId: saved ? outcome.assetId : null,
    };
  }
  const saved = progress.stage === "saved";
  return {
    fileId: progress.fileId,
    name: progress.name,
    stage: progress.stage,
    fraction: fractionOf(progress),
    label: progress.stage === "rejected"
      ? INGEST_ERROR_MESSAGES[progress.code ?? "INVALID_INPUT"]
      : STAGE_LABELS[progress.stage],
    error: progress.stage === "rejected" ? INGEST_ERROR_MESSAGES[progress.code ?? "INVALID_INPUT"] : null,
    canRemove: !saved,
    saved,
    assetId: progress.assetId ?? null,
  };
}

function fractionOf(progress: IngestProgress): number {
  if (progress.stage === "saved" || progress.stage === "rejected" || progress.stage === "verifying") return 1;
  if (progress.totalBytes <= 0) return 0;
  return Math.max(0, Math.min(1, progress.receivedBytes / progress.totalBytes));
}
