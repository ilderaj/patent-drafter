/**
 * V6-12 — real drawings and figure references (S02 附图, 05-contracts §3
 * Drawing / FigureSetRevision, C02, §10).
 *
 * One deep module owns every rule between a PNG/JPEG and a target's figure set:
 *
 * - `inspectDrawing` is the pure gate. It reuses V6-10/V6-07 for everything
 *   they already decide (magic, container walk, chunk CRCs, segment walk, 8 MiB
 *   and 16 MP) and adds the two checks their own comment leaves to a decoder: a
 *   PNG's IDAT stream is really inflated to the row-filter layout the IHDR
 *   declares, and a baseline JPEG's entropy-coded scan is really Huffman-decoded
 *   to the block count the frame header declares. Declared dimensions that the
 *   data cannot support are `BAD_DRAWING`; a corrupt container is `BAD_DRAWING`
 *   too. Nothing is ever downsampled and no thumbnail is invented.
 * - `importDrawing` / `deleteDrawing` own the library. A drawing row (contract
 *   `Drawing`) and its asset share one repository commit; importing the same
 *   bytes twice inside an untouched library answers `duplicate` and writes
 *   nothing; importing after a delete mints a new id, so a re-import is a new
 *   drawing version rather than a resurrection of the old one.
 * - `bindFigures` appends a `FigureSetRevision` for ONE target. Numbers must be
 *   1..n contiguous and unique, every drawing must exist, `baseFigureRevisionId`
 *   is a compare-and-swap, and the new revision's `parentId` is the bound one.
 *   No other target's figure set moves (C02). A retry with the same base and the
 *   same entries returns the revision the first attempt wrote; it never appends
 *   a second one.
 * - `checkFigureExportGate` is the pure export-side check: a snapshot whose
 *   figure revision is no longer the target's current one is `STALE_BINDING`;
 *   a figure the text references but the set does not address is
 *   `RESOURCE_NOT_FOUND`; a drawing whose row, asset or bytes are gone is
 *   `MISSING_BYTES`. It answers `GateDecision.reasons`-shaped entries and a
 *   `filesAvailable` flag, so §6's `evaluateGate` receives the result of an
 *   existence query instead of guessing.
 *
 * Persistence reuses V6-06 without changing it. `MatterAggregate` carries the
 * matter, its targets and its assets — never a drawing row or a figure set. As
 * V6-11 did for parse rows, those values live in the repository's own blobs
 * store under `drawings/` and `figures/` key namespaces, and every state change
 * that the aggregate can express (target pointer) is written by
 * `LocalRepository.commit` with a §10 activity row. The receipt records this.
 *
 * The events used are ones the contract already lists: `source.committed` and
 * `source.retired` (metadata `version`) when drawing bytes enter or leave the
 * library, and `figures.bound` (metadata `version`, `count`) when a target's
 * pointer moves. No action name is invented.
 */
import {
  drawingSchema,
  figureEntrySchema,
  figureSetRevisionSchema,
  type Drawing,
  type FigureSetRevision,
} from "../../../../../../packages/contracts/src/matter.ts";
import { MAX_DRAWING_BYTES, MAX_DRAWING_PIXELS, validateDrawing } from "../../lib/legacy-import.ts";
import {
  CONTRACT_VERSION,
  STORES,
  sha256Hex,
  type ActivityRecord,
  type Actor,
  type AssetRecord,
  type LocalRepository,
  type MatterAggregate,
  type TargetRecord,
} from "../../lib/repository.ts";
import { derivedId } from "./parse.ts";
import { crc32, inflateRaw } from "./ingest.ts";

export const DRAWING_MAX_BYTES = MAX_DRAWING_BYTES;
export const DRAWING_MAX_PIXELS = MAX_DRAWING_PIXELS;
/** How many times one write re-reads and retries after a `VERSION_CONFLICT`. */
export const FIGURE_COMMIT_ATTEMPTS = 4;
/** A figure set on a real target stays small; the cap only stops a runaway. */
export const MAX_FIGURES = 500;
/** Numbers are 1..n by contract (§S02 `BindFigures` precondition). */
export const FIGURE_NUMBER_START = 1;

export type DrawingKind = "png" | "jpeg";

/**
 * The §10 codes this module answers with. Everything it can refuse is already a
 * contract code: `BAD_DRAWING` for an image whose bytes cannot support it,
 * `IMAGE_TOO_LARGE` for the 16 MP / 8 MiB budget, `DUPLICATE_FIGURE_NUMBER` for
 * the numbering precondition, `INPUT_STALE` for a compare-and-swap on the bound
 * figure revision, `STALE_BINDING` for an export that names an older one.
 */
export type FigureErrorCode =
  | "INVALID_INPUT"
  | "RESOURCE_NOT_FOUND"
  | "VERSION_CONFLICT"
  | "STORAGE_UNAVAILABLE"
  | "QUOTA_EXCEEDED"
  | "HASH_MISMATCH"
  | "BAD_DRAWING"
  | "IMAGE_TOO_LARGE"
  | "MIME_MISMATCH"
  | "UNSUPPORTED_MEDIA"
  | "DUPLICATE_FIGURE_NUMBER"
  | "INPUT_STALE"
  | "STALE_BINDING"
  | "MISSING_BYTES";

export interface FigureError {
  code: FigureErrorCode;
  message: string;
  /** Ids an operator can act on: the stale revision, the missing drawing, … */
  resourceIds?: string[];
  /** On `INPUT_STALE`: the revision the target is actually bound to now. */
  currentFigureRevisionId?: string | null;
}

export type FigureResult<T> = { ok: true; data: T } | { ok: false; error: FigureError };

// ---------------------------------------------------------------------------
// Image validation: V6-10's gate plus a real decode of the declared shape
// ---------------------------------------------------------------------------

export interface ImageContent {
  kind: DrawingKind;
  mime: "image/png" | "image/jpeg";
  width: number;
  height: number;
}

export type DrawingInspection = { ok: true; image: ImageContent } | { ok: false; error: FigureError };

const PNG_SIGNATURE = Object.freeze([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_BIT_DEPTH_BY_COLOUR: Readonly<Record<number, number>> = Object.freeze({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 });
const PNG_CHANNELS_BY_COLOUR: Readonly<Record<number, number>> = Object.freeze({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 });
/** Adam7 passes: x start, y start, x step, y step. */
const ADAM7 = Object.freeze([
  Object.freeze([0, 0, 8, 8]),
  Object.freeze([4, 0, 8, 8]),
  Object.freeze([0, 4, 4, 8]),
  Object.freeze([2, 0, 4, 4]),
  Object.freeze([0, 2, 2, 4]),
  Object.freeze([1, 0, 2, 2]),
  Object.freeze([0, 1, 1, 2]),
]);

function badDrawing(message: string, resourceIds?: string[]): FigureResult<never> {
  return { ok: false, error: { code: "BAD_DRAWING", message, ...(resourceIds ? { resourceIds } : {}) } };
}

/**
 * The format the bytes actually carry, from their magic. A drawing has to be
 * PNG or JPEG; anything else cannot become one by renaming it.
 */
export function drawingKindOf(bytes: Uint8Array): DrawingKind | null {
  if (bytes.byteLength >= 8 && PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)) return "png";
  if (bytes.byteLength >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  return null;
}

/**
 * Validate a picked drawing end to end. Pure: no storage, no clock, no DOM.
 *
 * 1. The bytes decide the format (`drawingKindOf`); a declared-but-wrong type
 *    is not consulted, so renaming a PDF `.png` is `BAD_DRAWING`, not a pass.
 * 2. Size and pixel budget: 8 MiB and 16 MP, exactly S02's drawing limit. The
 *    file is refused, never resampled.
 * 3. V6-07's `validateDrawing` walks the PNG container (chunk bounds, every
 *    chunk CRC, IDAT presence, IEND last) and the JPEG segment chain, and reads
 *    the declared dimensions.
 * 4. V6-12 adds the decode step that walk deliberately leaves out:
 *    `verifyPngData` inflates the IDAT stream and requires exactly the
 *    filter-byte layout the IHDR implies; `verifyJpegScan` Huffman-decodes a
 *    baseline scan and requires exactly the block count the frame header
 *    implies. A header that lies about its dimensions fails here.
 */
export function inspectDrawing(bytes: Uint8Array): DrawingInspection {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) {
    return { ok: false, error: { code: "INVALID_INPUT", message: "图片内容无法读取。" } };
  }
  if (bytes.byteLength > DRAWING_MAX_BYTES) {
    return {
      ok: false,
      error: { code: "IMAGE_TOO_LARGE", message: `图片是 ${formatMiB(bytes.byteLength)}，附图上限 8 MiB。` },
    };
  }
  const kind = drawingKindOf(bytes);
  if (kind === null) {
    return {
      ok: false,
      error: { code: "BAD_DRAWING", message: "附图必须是 PNG 或 JPEG，改扩展名不会改变内容。" },
    };
  }
  const mime = kind === "png" ? "image/png" : "image/jpeg";
  const structure = validateDrawing(mime, bytes);
  if (!structure.ok) {
    if (structure.code === "IMAGE_TOO_LARGE") {
      return { ok: false, error: { code: "IMAGE_TOO_LARGE", message: "图片超过 16 MP 上限，请换原图，不会自动缩小。" } };
    }
    if (structure.code === "FILE_TOO_LARGE") {
      return {
        ok: false,
        error: { code: "IMAGE_TOO_LARGE", message: `图片是 ${formatMiB(bytes.byteLength)}，附图上限 8 MiB。` },
      };
    }
    if (structure.code === "UNSUPPORTED_MEDIA" || structure.code === "MIME_MISMATCH") {
      return { ok: false, error: { code: "MIME_MISMATCH", message: "图片格式与内容不一致。" } };
    }
    return { ok: false, error: { code: "BAD_DRAWING", message: "图片内容不完整或已损坏，无法作为附图。" } };
  }
  const decoded = kind === "png" ? verifyPngData(bytes, structure.dimensions) : verifyJpegScan(bytes, structure.dimensions);
  if (!decoded.ok) return decoded;
  if (structure.dimensions.width * structure.dimensions.height > DRAWING_MAX_PIXELS) {
    return { ok: false, error: { code: "IMAGE_TOO_LARGE", message: "图片超过 16 MP 上限，请换原图，不会自动缩小。" } };
  }
  return {
    ok: true,
    image: { kind, mime, width: structure.dimensions.width, height: structure.dimensions.height },
  };
}

function formatMiB(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

/** Row-filter bytes a PNG scanline may carry (RFC 2083 §6). */
const MAX_PNG_FILTER = 4;

/**
 * Walk the PNG again, collecting the IHDR fields the container walk already
 * checked and concatenating every IDAT payload, then require the zlib stream to
 * inflate to exactly the filtered row layout IHDR declares. Only the 8-bit
 * formats reach here (the container walk enforces legal depth/colour pairs);
 * palette and sub-byte images are decoded by bit depth like any other row.
 */
function verifyPngData(
  bytes: Uint8Array,
  declared: { width: number; height: number },
): { ok: true } | { ok: false; error: FigureError } {
  let offset = 8;
  let width = 0;
  let height = 0;
  let depth = 8;
  let colourType = 6;
  let interlaced = false;
  const idat: Uint8Array[] = [];
  let idatLength = 0;
  while (offset + 12 <= bytes.byteLength) {
    const length = readU32(bytes, offset);
    const type = offset + 4;
    const data = offset + 8;
    if (data + length + 4 > bytes.byteLength) break;
    const name = String.fromCharCode(bytes[type]!, bytes[type + 1]!, bytes[type + 2]!, bytes[type + 3]!);
    if (name === "IHDR") {
      width = readU32(bytes, data);
      height = readU32(bytes, data + 4);
      depth = bytes[data + 8]!;
      colourType = bytes[data + 9]!;
      interlaced = bytes[data + 12] === 1;
    } else if (name === "IDAT") {
      idat.push(bytes.subarray(data, data + length));
      idatLength += length;
    } else if (name === "IEND") {
      break;
    }
    offset = data + length + 4;
  }
  if (width !== declared.width || height !== declared.height) {
    return badDrawing("PNG 头声明的尺寸与解析结果不一致。");
  }
  const channels = PNG_CHANNELS_BY_COLOUR[colourType];
  if (channels === undefined || idatLength === 0) return badDrawing("PNG 缺少可解码的图像数据。");

  // One entry per Adam7 pass (or the single non-interlaced pass), in stream
  // order. Each row is its filter byte plus the pass's pixel bytes; the same
  // list computes the inflated size and drives the per-row filter walk.
  const passRows: PngPassRows[] = interlaced
    ? ADAM7.flatMap(([xStart, yStart, xStep, yStep]) => {
        const passWidth = Math.max(0, Math.ceil((width - xStart) / xStep));
        const passHeight = Math.max(0, Math.ceil((height - yStart) / yStep));
        return passWidth === 0 || passHeight === 0
          ? []
          : [{ rows: passHeight, stride: 1 + Math.ceil((passWidth * channels * depth) / 8) }];
      })
    : [{ rows: height, stride: 1 + Math.ceil((width * channels * depth) / 8) }];
  const expected = passRows.reduce((total, pass) => total + pass.rows * pass.stride, 0);

  const compressed = concatChunks(idat, idatLength);
  // A PNG zlib stream starts with CMF/FLG. The container walk only guarantees
  // structure; a stream without the zlib header cannot be the IDAT it claims.
  if (compressed.byteLength < 2 || (compressed[0]! & 0x0f) !== 8) {
    return badDrawing("PNG 的图像数据不是有效的 zlib 流。");
  }
  const body = compressed.subarray(2);
  let rows: Uint8Array;
  try {
    // `expected` is the real row layout; a stream that inflates past it is
    // already a lie, and the cap keeps a compression bomb from being inflated.
    rows = inflateRaw(body, expected + 1);
  } catch {
    return badDrawing("PNG 的图像数据无法解压，文件已损坏。");
  }
  if (rows.byteLength !== expected) {
    return badDrawing("PNG 的像素数据与声明的尺寸不符。");
  }
  return verifyPngRowFilters(rows, passRows);
}

interface PngPassRows {
  /** Rows this pass contributes to the filtered image, in stream order. */
  rows: number;
  /** One row: the filter byte plus this pass's pixel bytes. */
  stride: number;
}

/**
 * Every PNG scanline starts with its filter byte, and 0-4 are the only filters
 * a decoder may apply (RFC 2083 §6). Adam7 stores its seven passes back to
 * back, so walking the pass list in order visits each row exactly where a
 * decoder would; the final offset check proves the walk covered the stream.
 */
function verifyPngRowFilters(
  rows: Uint8Array,
  passes: readonly PngPassRows[],
): { ok: true } | { ok: false; error: FigureError } {
  let offset = 0;
  for (const pass of passes) {
    for (let row = 0; row < pass.rows; row += 1) {
      if (rows[offset]! > MAX_PNG_FILTER) return badDrawing("PNG 的扫描行过滤类型无效，文件已损坏。");
      offset += pass.stride;
    }
  }
  if (offset !== rows.byteLength) return badDrawing("PNG 的像素数据与声明的尺寸不符。");
  return { ok: true };
}

function concatChunks(parts: readonly Uint8Array[], total: number): Uint8Array {
  if (parts.length === 1) return parts[0]!;
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.byteLength;
  }
  return out;
}

function readU32(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset]! << 24) | (bytes[offset + 1]! << 16) | (bytes[offset + 2]! << 8) | bytes[offset + 3]!) >>> 0
  );
}

interface JpegFrame {
  width: number;
  height: number;
  components: Array<{ id: number; h: number; v: number; quant: number }>;
}

interface JpegHuffmanTable {
  counts: Int32Array;
  symbols: Int32Array;
}

/**
 * Huffman-decode a baseline JPEG's scans and require the data to describe
 * exactly the MCU/block count the frame header declares.
 *
 * This is what catches a "dimension lie": a 1×1 image whose SOF claims
 * 8000×8000 carries one MCU, so the 64,000,000-block claim cannot be satisfied
 * by real entropy data. Only SOF0/SOF1 frames reach the decoder; every other
 * coding process is refused before its declared size can be trusted. That limit
 * is recorded in the receipt.
 */
function verifyJpegScan(
  bytes: Uint8Array,
  declared: { width: number; height: number },
): { ok: true } | { ok: false; error: FigureError } {
  let offset = 2;
  let frame: JpegFrame | null = null;
  const tables = new Map<string, JpegHuffmanTable>();
  const seenScans = new Set<number>();
  let sawEnd = false;
  let restartInterval = 0;

  while (offset < bytes.byteLength) {
    if (bytes[offset] !== 0xff) {
      return badDrawing("JPEG 段结构无效。");
    }
    while (offset < bytes.byteLength && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.byteLength) return badDrawing("JPEG 在段中间结束。");
    const marker = bytes[offset]!;
    offset += 1;
    if (marker === 0xd9) {
      sawEnd = true;
      break;
    }
    if (marker === 0x01) continue;
    if (marker >= 0xd0 && marker <= 0xd7) return badDrawing("JPEG 的扫描之间出现游程标记。");
    if (offset + 2 > bytes.byteLength) return badDrawing("JPEG 段长度越界。");
    const length = (bytes[offset]! << 8) | bytes[offset + 1]!;
    if (length < 2 || offset + length > bytes.byteLength) return badDrawing("JPEG 段长度越界。");
    const segmentStart = offset + 2;
    const segmentEnd = offset + length;
    if (marker === 0xc4) parseHuffmanTables(bytes, segmentStart, segmentEnd, tables);
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      // Only baseline (SOF0) and extended sequential Huffman (SOF1) frames can
      // be walked by the baseline entropy decoder below. Every other frame
      // marker (progressive, lossless, differential, arithmetic-coded) declares
      // a coding process whose data this verifier cannot check, so it fails
      // closed instead of trusting the declared geometry.
      if (marker !== 0xc0 && marker !== 0xc1) {
        return badDrawing(
          marker === 0xc2
            ? "暂不支持渐进式 JPEG，请另存为基线 JPEG 或 PNG。"
            : "暂不支持这种 JPEG 编码，请另存为基线 JPEG 或 PNG。",
        );
      }
      frame = parseFrame(bytes, segmentStart, segmentEnd);
      if (frame === null) return badDrawing("JPEG 的帧头无效。");
    }
    if (marker === 0xda) {
      if (frame === null) return badDrawing("JPEG 的扫描出现在帧头之前。");
      const scan = parseScanHeader(bytes, segmentStart, segmentEnd);
      if (scan === null) return badDrawing("JPEG 的扫描头无效。");
      const scanEnd = decodeBaselineScan(bytes, segmentEnd, scan, frame, tables, seenScans, restartInterval);
      if (typeof scanEnd !== "number") return scanEnd;
      // Resume the segment walk at the marker that ended the entropy data.
      offset = scanEnd;
      continue;
    }
    if (marker === 0xdd) {
      if (segmentEnd - segmentStart !== 2) return badDrawing("JPEG 的重启间隔段无效。");
      restartInterval = (bytes[segmentStart]! << 8) | bytes[segmentStart + 1]!;
    }
    offset = segmentEnd;
  }
  if (!sawEnd) return badDrawing("JPEG 缺少结束标记。");
  if (frame === null || seenScans.size === 0) return badDrawing("JPEG 没有可解码的扫描。");
  // Every component the frame declares must be coded by some scan. A frame
  // that names three components but codes only one decodes to no image at all.
  const uncoded = frame.components.filter((component) => !seenScans.has(component.id));
  if (uncoded.length > 0) {
    return badDrawing("JPEG 的扫描没有覆盖帧头声明的全部颜色分量。");
  }
  if (frame.width !== declared.width || frame.height !== declared.height) {
    return badDrawing("JPEG 头声明的尺寸与解析结果不一致。");
  }
  return { ok: true };
}

function parseHuffmanTables(
  bytes: Uint8Array,
  start: number,
  end: number,
  tables: Map<string, JpegHuffmanTable>,
): void {
  let offset = start;
  while (offset < end) {
    const byte = bytes[offset]!;
    offset += 1;
    const classId = byte >> 4;
    const tableId = byte & 0x0f;
    if (offset + 16 > end) return;
    const counts = new Int32Array(17);
    let symbolsNeeded = 0;
    for (let index = 1; index <= 16; index += 1) {
      counts[index] = bytes[offset + index - 1]!;
      symbolsNeeded += counts[index]!;
    }
    offset += 16;
    if (offset + symbolsNeeded > end) return;
    const table: JpegHuffmanTable = { counts, symbols: new Int32Array(symbolsNeeded + 1) };
    for (let index = 0; index < symbolsNeeded; index += 1) table.symbols[index] = bytes[offset + index]!;
    tables.set(`${classId}:${tableId}`, table);
    offset += symbolsNeeded;
  }
}

function parseFrame(bytes: Uint8Array, start: number, end: number): JpegFrame | null {
  if (end - start < 6) return null;
  const height = (bytes[start + 1]! << 8) | bytes[start + 2]!;
  const width = (bytes[start + 3]! << 8) | bytes[start + 4]!;
  const count = bytes[start + 5]!;
  if (width === 0 || height === 0 || count < 1 || count > 4) return null;
  if (end - start !== 6 + 3 * count) return null;
  const components: JpegFrame["components"] = [];
  for (let index = 0; index < count; index += 1) {
    const at = start + 6 + index * 3;
    const id = bytes[at]!;
    const h = bytes[at + 1]! >> 4;
    const v = bytes[at + 1]! & 0x0f;
    if (h < 1 || h > 4 || v < 1 || v > 4) return null;
    // One component id names one component; a repeated id (libjpeg's
    // "Duplicate component ID") has no unambiguous scan mapping.
    if (components.some((component) => component.id === id)) return null;
    components.push({ id, h, v, quant: bytes[at + 2]! });
  }
  return { width, height, components };
}

interface ScanHeader {
  components: Array<{ id: number; dcTable: number; acTable: number }>;
  /** Index in `bytes` where entropy-coded data begins. */
  bytesAfter: number;
}

function parseScanHeader(bytes: Uint8Array, start: number, end: number): ScanHeader | null {
  if (end - start < 3) return null;
  const count = bytes[start]!;
  if (count < 1 || count > 4) return null;
  if (end - start !== 1 + count * 2 + 3) return null;
  const components: ScanHeader["components"] = [];
  for (let index = 0; index < count; index += 1) {
    const at = start + 1 + index * 2;
    components.push({ id: bytes[at]!, dcTable: bytes[at + 1]! >> 4, acTable: bytes[at + 1]! & 0x0f });
  }
  // Ss, Se and Ah/Al belong to progressive scans; a baseline scan must carry
  // the sequential values.
  const ss = bytes[start + 1 + count * 2]!;
  const se = bytes[start + 2 + count * 2]!;
  const ahal = bytes[start + 3 + count * 2]!;
  if (ss !== 0 || se !== 63 || ahal !== 0) return null;
  return { components, bytesAfter: end };
}

/**
 * MSB-first bit reader for one entropy-coded segment. Reading stops at the
 * marker that ends the segment instead of consuming it: the marker is left
 * latched (with a rewind point) so the caller can inspect it and continue the
 * segment walk from the right byte.
 */
class JpegBits {
  /**
   * MSB-first bit reader for one entropy-coded segment.
   *
   * `buffer` holds every bit read ahead in its low `rest` bits, oldest bit at
   * the top; there is no whole-byte bookkeeping to lose track of, so after the
   * last block it can still say precisely how much data was left over. That is
   * what separates "the declared image ended here" from "the header claims more
   * image than the scan carries". A byte whose value is 0xFF is stuffed, so at
   * most seven padding bits of the final byte sit unread at a marker.
   */
  private buffer = 0;
  private rest = 0;
  /** A marker was reached; every further `read` fails. */
  private ended = false;
  private latched: number | null = null;
  /** Where the latched marker starts. */
  private markerAt = -1;
  private at: number;
  private readonly bytes: Uint8Array;

  constructor(bytes: Uint8Array, start: number) {
    this.bytes = bytes;
    this.at = start;
  }

  /**
   * Hand out the next `count` bits, MSB first. The read never looks past the
   * marker that ends the segment: `nextByte` throws when it would have to, so a
   * block whose bits run out before the geometry is satisfied fails here.
   */
  read(count: number): number {
    while (this.rest < count) this.prefetch();
    this.rest -= count;
    return (this.buffer >>> this.rest) & (count === 32 ? -1 : (1 << count) - 1);
  }

  /**
   * The marker that now ends the segment, or null while data remains. After the
   * last block the marker may be at the current position rather than one the
   * reader already failed on, so it is read from there.
   */
  marker(): number | null {
    if (this.ended) return this.latched;
    if (this.at >= this.bytes.byteLength) return -1;
    if (this.bytes[this.at] !== 0xff) return null;
    if (this.at + 1 >= this.bytes.byteLength) return -1;
    // 0xFF 0x00 is a stuffed data byte, not a marker; skip any run of them at
    // the current position before deciding.
    if (this.bytes[this.at + 1] === 0x00) return null;
    return this.bytes[this.at + 1]!;
  }

  /** True when a real marker (not end of data) ends the segment right here. */
  /** Byte offset of the 0xFF that starts the marker ending the entropy data. */
  markerOffset(): number {
    return this.ended ? this.markerAt : this.at;
  }

  endsAtMarker(): boolean {
    const marker = this.marker();
    return marker !== null && marker >= 0;
  }

  /** Bits that are read but not yet handed out. */
  available(): number {
    return this.rest;
  }

  /** Whole bytes read ahead of the last block. */
  pendingBytes(): number {
    return this.rest >> 3;
  }

  /**
   * True when nothing but padding is left before the marker: at most seven
   * 1-bits at the end of the block's own byte, or those plus one all-ones fill
   * byte. A marker may not sit less than eight bits after the last code, so the
   * fill byte is legal; a stream with more unread entropy than this describes
   * an image larger than the frame header declares.
   */
  paddingCoversDataEnd(): boolean {
    if (this.rest <= 7) return true;
    if (this.rest > MAX_ENTROPY_TAIL_BITS) return false;
    const padBits = this.rest - 8;
    const unread = this.buffer >>> this.rest;
    const oldest = (unread >>> padBits) & 0xff;
    const padding = unread & ((1 << padBits) - 1);
    return oldest === 0xff && padding === (1 << padBits) - 1;
  }

  /** Drop the buffered bits and place the reader just past this marker. */
  takeMarker(): number {
    const marker = this.marker();
    if (marker === null || marker < 0) throw new JpegMarkerError();
    const at = this.ended ? this.markerAt : this.at;
    this.buffer = 0;
    this.rest = 0;
    this.at = at + 2;
    this.latched = null;
    this.ended = false;
    return marker;
  }

  private prefetch(): void {
    const byte = this.nextByte();
    // Bits already in hand are older, so they stay above the new byte.
    this.buffer = (this.buffer << 8) | byte;
    this.rest += 8;
  }

  private nextByte(): number {
    if (this.ended) throw new JpegMarkerError();
    if (this.at + 1 >= this.bytes.byteLength) {
      this.ended = true;
      this.latched = -1;
      this.markerAt = this.at;
      throw new JpegMarkerError();
    }
    const byte = this.bytes[this.at]!;
    if (byte === 0xff) {
      const next = this.bytes[this.at + 1]!;
      if (next === 0x00) {
        this.at += 2;
        return 0xff;
      }
      this.ended = true;
      this.latched = next;
      this.markerAt = this.at;
      throw new JpegMarkerError();
    }
    this.at += 1;
    return byte;
  }
}

/** At most seven padding bits of the final block plus one 0xFF fill byte. */
const MAX_ENTROPY_TAIL_BITS = 15;

class JpegMarkerError extends Error {
  constructor() {
    super("jpeg entropy data ended");
    this.name = "JpegMarkerError";
  }
}

function huffmanDecode(bits: JpegBits, table: JpegHuffmanTable): number {
  let code = 0;
  let first = 0;
  let index = 0;
  for (let length = 1; length <= 16; length += 1) {
    code = (code << 1) | bits.read(1);
    const count = table.counts[length]!;
    if (code - first < count) return table.symbols[index + (code - first)]!;
    index += count;
    first = (first + count) << 1;
  }
  throw new JpegMarkerError();
}

/**
 * Decode one baseline scan. Coefficients are not reconstructed (no IDCT and no
 * pixels are needed to prove the data describes the declared geometry), but
 * every Huffman symbol, coefficient range, restart interval and the final
 * block count are checked.
 */
function decodeBaselineScan(
  bytes: Uint8Array,
  start: number,
  scan: ScanHeader,
  frame: JpegFrame,
  tables: Map<string, JpegHuffmanTable>,
  seenScans: Set<number>,
  restartInterval: number,
): FigureResult<never> | number {
  const hMax = Math.max(...frame.components.map((component) => component.h));
  const vMax = Math.max(...frame.components.map((component) => component.v));
  const interleaved = scan.components.length > 1;

  // Each component may appear once per scan.
  if (new Set(scan.components.map((component) => component.id)).size !== scan.components.length) {
    return badDrawing("JPEG 的扫描重复引用了同一个颜色分量。");
  }
  const tablesFor = scan.components.map((component) => {
    const frameComponent = frame.components.find((item) => item.id === component.id);
    const dc = tables.get(`0:${component.dcTable}`);
    const ac = tables.get(`1:${component.acTable}`);
    if (!dc || !ac || !frameComponent) return null;
    return { dc, ac, component: frameComponent };
  });
  if (tablesFor.some((entry) => entry === null)) return badDrawing("JPEG 的扫描引用了未定义的 Huffman 表。");
  // Sequential baseline codes each component exactly once. A component coded by
  // a second scan is not a layout this verifier can vouch for, so it fails closed.
  if (scan.components.some((component) => seenScans.has(component.id))) {
    return badDrawing("JPEG 的同一颜色分量被多次扫描，暂不支持。");
  }
  for (const component of scan.components) seenScans.add(component.id);

  // ITU T.81 A.2: an interleaved scan walks the frame MCU grid and codes h*v
  // blocks of each component per MCU. A non-interleaved scan codes one block
  // per MCU on that component's own grid, ceil(Xi/8) by ceil(Yi/8), with
  // Xi = ceil(X*h/Hmax) and Yi = ceil(Y*v/Vmax). DRI counts these MCUs in both.
  let cols: number;
  let rows: number;
  if (interleaved) {
    cols = Math.ceil(frame.width / (8 * hMax));
    rows = Math.ceil(frame.height / (8 * vMax));
  } else {
    const only = tablesFor[0]!.component;
    cols = Math.ceil(Math.ceil((frame.width * only.h) / hMax) / 8);
    rows = Math.ceil(Math.ceil((frame.height * only.v) / vMax) / 8);
  }
  // ITU T.81 B.2.3: an interleaved MCU holds h*v data units of every component
  // in the frame, and the total may not exceed 10. A larger MCU is not a
  // baseline JPEG a decoder accepts.
  if (interleaved) {
    const blocksPerMcu = frame.components.reduce((total, component) => total + component.h * component.v, 0);
    if (blocksPerMcu > 10) return badDrawing("JPEG 的交错扫描每个 MCU 超过 10 个数据块，不符合基线 JPEG 规范。");
  }
  const units = tablesFor.map((entry) => ({
    ...entry!,
    repeats: interleaved ? entry!.component.h * entry!.component.v : 1,
  }));

  const bits = new JpegBits(bytes, start);
  let restartCount = 0;
  const totalUnits = cols * rows;
  try {
    for (let unitIndex = 0; unitIndex < totalUnits; unitIndex += 1) {
      for (const { dc, ac, repeats } of units) {
        for (let block = 0; block < repeats; block += 1) decodeBlock(bits, dc, ac);
      }
      // Between MCUs only restart markers may appear, and only when the
      // previous block finished exactly on the marker with at most padding bits
      // left. A marker interrupting a block, or one reached with whole bytes
      // still unread, means the scan ended before the declared geometry did.
      // A restart marker is due after every `restartInterval` MCUs (DRI) and
      // nowhere else. Any other marker reached mid-scan makes the next read
      // throw, which reports the data as ending before the declared geometry.
      const due = restartInterval > 0 && (unitIndex + 1) % restartInterval === 0 && unitIndex + 1 < totalUnits;
      if (due) {
        if (!bits.endsAtMarker()) return badDrawing("JPEG 的扫描数据多于声明的尺寸。");
        if (!bits.paddingCoversDataEnd()) return badDrawing("JPEG 的扫描数据多于声明的尺寸。");
        const marker = bits.takeMarker();
        if (marker < 0xd0 || marker > 0xd7) return badDrawing("JPEG 的扫描数据提前结束，与声明的尺寸不符。");
        const expected = 0xd0 + (restartCount % 8);
        if (marker !== expected) return badDrawing("JPEG 的重启标记顺序错误。");
        restartCount += 1;
      }
    }
    // The scan must end exactly where the declared geometry ends. A whole byte
    // that was read ahead and never used is real entropy data: the header
    // understates the image. A marker reached exactly here with at most seven
    // bits of padding (or one fill byte) in play is the legal end.
    if (!bits.endsAtMarker() || !bits.paddingCoversDataEnd()) {
      return badDrawing("JPEG 的扫描数据多于声明的尺寸。");
    }
    return bits.markerOffset();
  } catch (error) {
    if (error instanceof JpegMarkerError) return badDrawing("JPEG 的扫描数据提前结束，与声明的尺寸不符。");
    return badDrawing("JPEG 的图像数据无法解码。");
  }
}

function decodeBlock(
  bits: JpegBits,
  dc: JpegHuffmanTable,
  ac: JpegHuffmanTable,
): void {
  const size = huffmanDecode(bits, dc);
  if (size > 11) throw new JpegMarkerError();
  // The DC difference's magnitude bits are part of the stream and must be
  // consumed even though the coefficient itself is not reconstructed.
  if (size !== 0) bits.read(size);
  let coefficient = 1;
  while (coefficient < 64) {
    const symbol = huffmanDecode(bits, ac);
    if (symbol === 0x00) return;
    const run = symbol >> 4;
    const acSize = symbol & 0x0f;
    if (acSize === 0) {
      if (run !== 15) throw new JpegMarkerError();
      coefficient += 16;
      continue;
    }
    coefficient += run;
    if (coefficient >= 64) throw new JpegMarkerError();
    bits.read(acSize);
    coefficient += 1;
  }
}

// ---------------------------------------------------------------------------
// Storage keys
// ---------------------------------------------------------------------------

const DRAWING_KEY_PREFIX = "drawings/";
const FIGURE_SET_KEY_PREFIX = "figures/";

function drawingKey(drawingId: string): string {
  return `${DRAWING_KEY_PREFIX}${drawingId}`;
}

function figureSetKey(targetId: string, revisionId: string): string {
  return `${FIGURE_SET_KEY_PREFIX}${targetId}/${revisionId}`;
}

interface StoredDrawing {
  kind: "drawings.drawing";
  tenantId: string;
  matterId: string;
  drawing: Drawing;
}

interface StoredFigureSet {
  kind: "figures.set";
  tenantId: string;
  matterId: string;
  revision: FigureSetRevision;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asStoredDrawing(value: unknown): StoredDrawing | null {
  if (!isRecord(value) || value.kind !== "drawings.drawing" || !isRecord(value.drawing)) return null;
  return drawingSchema.safeParse(value.drawing).success ? (value as unknown as StoredDrawing) : null;
}

function asStoredFigureSet(value: unknown): StoredFigureSet | null {
  if (!isRecord(value) || value.kind !== "figures.set" || !isRecord(value.revision)) return null;
  return figureSetRevisionSchema.safeParse(value.revision).success ? (value as unknown as StoredFigureSet) : null;
}

// ---------------------------------------------------------------------------
// Timestamps and ids
// ---------------------------------------------------------------------------

/** ISO-8601 with milliseconds, the form every contract timestamp uses. */
function isoSeconds(milliseconds: number): string {
  return new Date(milliseconds).toISOString();
}

interface FigureClock {
  now: () => number;
}

function clockOf(options: { now?: () => number } = {}): FigureClock {
  return { now: options.now ?? (() => Date.now()) };
}

/** A UUID-shaped id from a seed; the same seed always yields the same id. */
function figureId(seed: string): Promise<string> {
  return derivedId(`v6/figures/${seed}`);
}

// ---------------------------------------------------------------------------
// The library: import and delete
// ---------------------------------------------------------------------------

export type DrawingImportStatus = "created" | "duplicate";

export interface DrawingImport {
  drawing: Drawing;
  asset: AssetRecord;
  status: DrawingImportStatus;
  /** True when the caller's bytes were stored by this call. */
  wrote: boolean;
}

export interface ImportDrawingInput {
  bytes: Uint8Array;
  fileName: string;
  /** Import a drawing whose bytes are already an asset of this matter. */
  fromAssetId?: string | null;
}

export interface ImportDrawingOptions {
  /** Return an identical existing drawing instead of refusing a duplicate. */
  reuseExisting?: boolean;
  /** Injected clock (milliseconds), for deterministic tests. */
  now?: () => number;
}

/**
 * Add one image to the matter's drawing library (S02 `AddDrawing{assetId}`).
 *
 * The bytes are validated by `inspectDrawing`, hashed, and stored as an asset of
 * purpose `drawing`. The `Drawing` row is a namespaced row the matter commit
 * cannot carry, so it is written just before the commit under an id unique to
 * that attempt; readers join rows with committed assets, so a row whose commit
 * lost is invisible and is then removed by its own writer. An identical drawing already in the
 * library answers `duplicate` and writes nothing; after that drawing is deleted
 * the same bytes import again under a new id, which is what makes "delete and
 * re-import" a new drawing version instead of a resurrection.
 */
export async function importDrawing(
  repository: LocalRepository,
  actor: Actor,
  matterId: string,
  input: ImportDrawingInput,
  options: ImportDrawingOptions = {},
): Promise<FigureResult<DrawingImport>> {
  if (!(input.bytes instanceof Uint8Array) || input.bytes.byteLength === 0) {
    return { ok: false, error: { code: "INVALID_INPUT", message: "没有可导入的图片内容。" } };
  }
  const inspection = inspectDrawing(input.bytes);
  if (!inspection.ok) return inspection;
  const image = inspection.image;
  let sha256: string;
  try {
    sha256 = await sha256Hex(input.bytes);
  } catch {
    return { ok: false, error: { code: "STORAGE_UNAVAILABLE", message: "这台设备无法校验图片摘要。" } };
  }
  return storeDrawing(repository, actor, matterId, {
    bytes: input.bytes,
    fileName: input.fileName,
    sha256,
    image,
    fromAssetId: input.fromAssetId ?? null,
    reuseExisting: options.reuseExisting === true,
    now: clockOf(options).now(),
  });
}

interface StoreDrawing {
  bytes: Uint8Array;
  fileName: string;
  sha256: string;
  image: ImageContent;
  fromAssetId: string | null;
  reuseExisting: boolean;
  now: number;
}

async function storeDrawing(
  repository: LocalRepository,
  actor: Actor,
  matterId: string,
  request: StoreDrawing,
): Promise<FigureResult<DrawingImport>> {
  for (let attempt = 0; attempt < FIGURE_COMMIT_ATTEMPTS; attempt += 1) {
    const loaded = await repository.loadMatter(actor, matterId);
    if (!loaded.ok) return storageFailure(loaded.error);
    const aggregate = loaded.data.data;
    const drawings = await readDrawings(repository, actor, matterId);
    if (!drawings.ok) return drawings;

    const duplicate = drawings.data.find(
      (entry) => entry.asset.sha256 === request.sha256 && entry.asset.state === "available",
    );
    if (duplicate) {
      if (!request.reuseExisting) {
        return {
          ok: false,
          error: {
            code: "INVALID_INPUT",
            message: "这张图已经在附图库里；删除后重新导入才会生成新版本。",
            resourceIds: [duplicate.drawing.id],
          },
        };
      }
      return { ok: true, data: { drawing: duplicate.drawing, asset: duplicate.asset, status: "duplicate", wrote: false } };
    }

    // Provenance must name a real, available asset of this same matter; an id
    // the matter does not hold is refused before anything is written.
    if (
      request.fromAssetId !== null &&
      !aggregate.assets.some(
        (asset) =>
          asset.id === request.fromAssetId &&
          asset.tenantId === actor.tenantId &&
          asset.matterId === matterId &&
          asset.state === "available",
      )
    ) {
      return {
        ok: false,
        error: {
          code: "RESOURCE_NOT_FOUND",
          message: "附图来源的素材不在本案中。",
          resourceIds: [request.fromAssetId],
        },
      };
    }

    // Every attempt mints its own id (the nonce), so the row it writes before
    // committing is its alone: a writer that loses the commit race deletes only
    // its own row, never one another writer has already committed against.
    const drawingId = await figureId(
      `drawing/${matterId}/${request.sha256}/${aggregate.matter.version}/${globalThis.crypto.randomUUID()}`,
    );
    const assetId = await uniqueAssetId(aggregate, drawingId);
    const now = isoSeconds(request.now);
    const asset: AssetRecord = {
      id: assetId,
      tenantId: actor.tenantId,
      matterId,
      serviceOrderId: null,
      purpose: "drawing",
      originalName: request.fileName,
      mime: request.image.mime,
      byteLength: request.bytes.byteLength,
      sha256: request.sha256,
      state: "available",
      objectKey: `local/${actor.tenantId}/${matterId}/${assetId}`,
      createdAt: now,
    };
    const drawing: Drawing = {
      id: drawingId,
      matterId,
      assetId,
      width: request.image.width,
      height: request.image.height,
      mime: request.image.mime,
      sha256: request.sha256,
      derivedFromAssetId: request.fromAssetId,
    };
    const parsed = drawingSchema.safeParse(drawing);
    if (!parsed.success) {
      return { ok: false, error: { code: "INVALID_INPUT", message: "附图记录不符合合同结构。" } };
    }

    // The drawing row goes first: an unreferenced row is invisible (readers
    // join it with the asset), while an asset without a row would be a drawing
    // the library silently forgot. Both orders crash-safe, this one self-heals.
    const wroteRow = await writeDrawingRow(repository, actor, matterId, parsed.data);
    if (!wroteRow.ok) return wroteRow;
    const committed = await repository.commit(
      actor,
      {
        contractVersion: CONTRACT_VERSION,
        expectedVersion: aggregate.matter.version,
        payload: {
          matter: { ...aggregate.matter, version: aggregate.matter.version + 1, updatedAt: now },
          targets: aggregate.targets,
          assets: [...aggregate.assets, asset],
          events: [
            {
              id: await figureId(`event/drawing/${assetId}`),
              tenantId: actor.tenantId,
              matterId,
              targetId: null,
              actorId: actor.userId,
              actorKind: "user",
              action: "source.committed",
              snapshot: null,
              jobId: null,
              resourceId: assetId,
              occurredAt: now,
              metadata: { version: aggregate.matter.version + 1 },
            },
          ],
          blobs: [{ assetId, bytes: request.bytes, sha256: request.sha256, byteLength: request.bytes.byteLength }],
        },
      },
      { requestId: await figureId(`request/drawing/${assetId}`) },
    );
    if (committed.ok) {
      return { ok: true, data: { drawing: parsed.data, asset, status: "created", wrote: true } };
    }
    // A losing write leaves only this attempt's unreferenced row; remove it.
    // The id is unique to this attempt, so no other writer can depend on it.
    // On VERSION_CONFLICT the loop reloads and runs the duplicate check again,
    // so identical bytes committed meanwhile answer `duplicate`, not a second
    // asset.
    await deleteRow(repository, drawingKey(drawingId));
    if (committed.error.code !== "VERSION_CONFLICT") return storageFailure(committed.error);
    if (attempt === FIGURE_COMMIT_ATTEMPTS - 1) return storageFailure(committed.error);
  }
  return { ok: false, error: { code: "STORAGE_UNAVAILABLE", message: "附图保存多次冲突，请重试。" } };
}

/** An asset id that no asset of the matter carries yet. */
async function uniqueAssetId(aggregate: MatterAggregate, seed: string): Promise<string> {
  for (let suffix = 0; suffix < 1000; suffix += 1) {
    const candidate = await figureId(`${seed}/asset/${suffix}`);
    if (!aggregate.assets.some((asset) => asset.id === candidate)) return candidate;
  }
  throw new Error("no free asset id");
}

async function writeDrawingRow(
  repository: LocalRepository,
  actor: Actor,
  matterId: string,
  drawing: Drawing,
): Promise<FigureResult<true>> {
  try {
    await repository.backend.transaction("readwrite", async (tx) => {
      const stored = asStoredDrawing(await tx.get(STORES.blobs, drawingKey(drawing.id)));
      if (stored && (stored.tenantId !== actor.tenantId || stored.matterId !== matterId)) {
        throw new Error("drawing row belongs to another matter");
      }
      const row: StoredDrawing = {
        kind: "drawings.drawing",
        tenantId: actor.tenantId,
        matterId,
        drawing,
      };
      await tx.put(STORES.blobs, drawingKey(drawing.id), row);
    });
    return { ok: true, data: true };
  } catch {
    return { ok: false, error: { code: "STORAGE_UNAVAILABLE", message: "无法写入附图记录。" } };
  }
}

async function deleteRow(repository: LocalRepository, key: string): Promise<void> {
  try {
    await repository.backend.transaction("readwrite", async (tx) => {
      await tx.delete(STORES.blobs, key);
    });
  } catch {
    // A leftover unreferenced row is invisible; the next read ignores it.
  }
}

export interface LibraryDrawing {
  drawing: Drawing;
  asset: AssetRecord;
}

export type DrawingLibraryRead = FigureResult<LibraryDrawing[]>;

/** Every drawing of the matter whose row and asset both still exist, oldest first. */
export async function readDrawingLibrary(
  repository: LocalRepository,
  actor: Actor,
  matterId: string,
): Promise<DrawingLibraryRead> {
  return readDrawings(repository, actor, matterId);
}

async function readDrawings(repository: LocalRepository, actor: Actor, matterId: string): Promise<DrawingLibraryRead> {
  const loaded = await repository.loadMatter(actor, matterId);
  if (!loaded.ok) return storageFailure(loaded.error);
  const assets = new Map(
    loaded.data.data.assets.filter((asset) => asset.purpose === "drawing").map((asset) => [asset.id, asset]),
  );
  let rows: readonly unknown[];
  try {
    rows = await repository.backend.transaction("readonly", async (tx) => tx.getAll(STORES.blobs));
  } catch {
    return { ok: false, error: { code: "STORAGE_UNAVAILABLE", message: "无法读取本机的附图记录。" } };
  }
  const out: LibraryDrawing[] = [];
  for (const value of rows) {
    const stored = asStoredDrawing(value);
    if (!stored || stored.tenantId !== actor.tenantId || stored.matterId !== matterId) continue;
    const asset = assets.get(stored.drawing.assetId);
    // A drawing whose asset is gone is not shown as if it were usable; the
    // export gate is where its absence is reported.
    if (!asset) continue;
    out.push({ drawing: stored.drawing, asset });
  }
  out.sort((a, b) => a.drawing.id.localeCompare(b.drawing.id));
  return { ok: true, data: out };
}

export interface DeletedDrawing {
  drawingId: string;
  /** Ids a new revision no longer resolves; an export must be re-checked. */
  assetId: string;
}

/**
 * Remove one drawing from the library. Historical figure sets are NOT rewritten
 * (§C02: revisions are append-only), so any set that still binds this drawing
 * now has a missing drawing and the export gate reports `MISSING_BYTES` until
 * the target is rebound.
 */
export async function deleteDrawing(
  repository: LocalRepository,
  actor: Actor,
  matterId: string,
  drawingId: string,
): Promise<FigureResult<DeletedDrawing>> {
  const loaded = await repository.loadMatter(actor, matterId);
  if (!loaded.ok) return storageFailure(loaded.error);
  const aggregate = loaded.data.data;
  const stored = await readDrawingRow(repository, actor, matterId, drawingId);
  if (!stored.ok) return stored;
  const now = clockOf().now();
  const at = isoSeconds(now);
  const asset = aggregate.assets.find((item) => item.id === stored.data.drawing.assetId);
  const committed = await repository.commit(
    actor,
    {
      contractVersion: CONTRACT_VERSION,
      expectedVersion: aggregate.matter.version,
      payload: {
        matter: { ...aggregate.matter, version: aggregate.matter.version + 1, updatedAt: at },
        targets: aggregate.targets,
        assets: aggregate.assets.filter((item) => item.id !== stored.data.drawing.assetId),
        events: asset
          ? [
              {
                id: await figureId(`event/drawing-deleted/${drawingId}/${aggregate.matter.version}`),
                tenantId: actor.tenantId,
                matterId,
                targetId: null,
                actorId: actor.userId,
                actorKind: "user",
                action: "source.retired",
                snapshot: null,
                jobId: null,
                resourceId: asset.id,
                occurredAt: at,
                metadata: { version: aggregate.matter.version + 1 },
              },
            ]
          : [],
        blobs: [],
      },
    },
    { requestId: await figureId(`request/drawing-deleted/${drawingId}/${aggregate.matter.version}`) },
  );
  if (!committed.ok) return storageFailure(committed.error);
  await deleteRow(repository, drawingKey(drawingId));
  return { ok: true, data: { drawingId, assetId: stored.data.drawing.assetId } };
}

async function readDrawingRow(
  repository: LocalRepository,
  actor: Actor,
  matterId: string,
  drawingId: string,
): Promise<FigureResult<StoredDrawing>> {
  try {
    const stored = await repository.backend.transaction("readonly", async (tx) =>
      asStoredDrawing(await tx.get(STORES.blobs, drawingKey(drawingId))),
    );
    if (!stored || stored.tenantId !== actor.tenantId || stored.matterId !== matterId) {
      return { ok: false, error: { code: "RESOURCE_NOT_FOUND", message: "附图不在这个案件里。", resourceIds: [drawingId] } };
    }
    return { ok: true, data: stored };
  } catch {
    return { ok: false, error: { code: "STORAGE_UNAVAILABLE", message: "无法读取本机的附图记录。" } };
  }
}

// ---------------------------------------------------------------------------
// Figure sets
// ---------------------------------------------------------------------------

export interface FigureEntryInput {
  figureId: string;
  number: number;
  title: string;
  drawingId: string | null;
  numerals: Array<{ value: string; label: string }>;
}

export interface FigureSetView {
  targetId: string;
  current: FigureSetRevision;
  entries: FigureSetRevision["entries"];
  /** The revision the target named before `current`, null for the first. */
  parent: FigureSetRevision | null;
  revisions: readonly FigureSetRevision[];
}

/**
 * Figure numbers 1..n, each exactly once, in ascending order. This is S02's
 * precondition for `BindFigures`; a set the user can address as 图1..图n is the
 * only set binding accepts. Pure.
 */
export function checkFigureNumbers(entries: readonly { number: number }[]): FigureError | null {
  // An empty set is 1..0: unbinding every figure is a legal new revision (C02).
  if (entries.length > MAX_FIGURES) {
    return { code: "INVALID_INPUT", message: `一个目标最多 ${MAX_FIGURES} 张附图。` };
  }
  const seen = new Set<number>();
  for (const entry of entries) {
    if (!Number.isSafeInteger(entry.number) || entry.number < FIGURE_NUMBER_START) {
      return { code: "DUPLICATE_FIGURE_NUMBER", message: "图号必须是从 1 开始的整数。" };
    }
    if (seen.has(entry.number)) {
      return { code: "DUPLICATE_FIGURE_NUMBER", message: `图号 ${entry.number} 重复。` };
    }
    seen.add(entry.number);
  }
  for (let number = 1; number <= entries.length; number += 1) {
    if (!seen.has(number)) {
      return { code: "DUPLICATE_FIGURE_NUMBER", message: `图号必须连续：缺少第 ${number} 图。` };
    }
  }
  return null;
}

/** A figure set's digest: canonical entry JSON, independent of spelling order. */
export async function figureSetHash(entries: readonly FigureEntryInput[]): Promise<string> {
  const canonical = [...entries]
    .sort((a, b) => a.number - b.number || a.figureId.localeCompare(b.figureId))
    .map((entry) => ({
      figureId: entry.figureId,
      number: entry.number,
      title: entry.title.normalize("NFC"),
      drawingId: entry.drawingId,
      numerals: entry.numerals.map((numeral) => ({
        value: numeral.value.normalize("NFC"),
        label: numeral.label.normalize("NFC"),
      })),
    }));
  return sha256Hex(new TextEncoder().encode(JSON.stringify(canonical)));
}

/**
 * Bind a target's figure set (S02 `BindFigures{targetId,entries,baseFigureRevisionId}`).
 *
 * - `baseFigureRevisionId` is a compare-and-swap on the target's current set: a
 *   page that still shows an older binding gets `INPUT_STALE` with the revision
 *   it should reload, never a silent merge.
 * - every drawing must exist in this matter's library, and the entry's number
 *   set must be 1..n contiguous and unique;
 * - a new `FigureSetRevision` is appended with `parentId` = the bound revision;
 *   no other target's pointer moves (C02);
 * - a retry with the same base and the same entries returns the same revision
 *   id and writes nothing, so a refreshed page cannot append a duplicate;
 * - two identical binds racing on the same base end with one revision: the
 *   loser removes only its own row and re-reads, then answers the winner's
 *   revision (or `INPUT_STALE` if the target moved elsewhere).
 */
export async function bindFigures(
  repository: LocalRepository,
  actor: Actor,
  matterId: string,
  input: BindFiguresInput,
  options: { now?: () => number } = {},
): Promise<FigureResult<FigureSetView>> {
  for (let attempt = 0; ; attempt += 1) {
    const result = await bindFiguresAttempt(repository, actor, matterId, input, options);
    if (!("lostRace" in result)) return result;
    if (attempt === FIGURE_COMMIT_ATTEMPTS - 1) return result.lostRace;
  }
}

interface BindFiguresInput {
  targetId: string;
  baseFigureRevisionId: string | null;
  entries: readonly FigureEntryInput[];
}

/** A pointer commit that lost to another writer; the caller re-reads and decides again. */
interface LostRace {
  lostRace: FigureResult<never>;
}

async function bindFiguresAttempt(
  repository: LocalRepository,
  actor: Actor,
  matterId: string,
  input: BindFiguresInput,
  options: { now?: () => number },
): Promise<FigureResult<FigureSetView> | LostRace> {
  const loaded = await repository.loadMatter(actor, matterId);
  if (!loaded.ok) return storageFailure(loaded.error);
  const aggregate = loaded.data.data;
  const target = aggregate.targets.find((item) => item.id === input.targetId);
  if (!target) {
    return { ok: false, error: { code: "RESOURCE_NOT_FOUND", message: "目标不在这个案件里。", resourceIds: [input.targetId] } };
  }
  const numberProblem = checkFigureNumbers(input.entries);
  if (numberProblem) return { ok: false, error: numberProblem };

  const drafts: FigureEntryInput[] = [];
  for (const entry of input.entries) {
    const numerals = entry.numerals.map((numeral) => ({
      value: String(numeral.value ?? ""),
      label: String(numeral.label ?? ""),
    }));
    drafts.push({
      figureId: entry.figureId,
      number: entry.number,
      title: entry.title,
      drawingId: entry.drawingId,
      numerals,
    });
  }
  const canonical: FigureSetRevision["entries"] = drafts
    .map((entry) => ({
      figureId: entry.figureId,
      number: entry.number,
      title: entry.title.normalize("NFC"),
      drawingId: entry.drawingId,
      numerals: entry.numerals,
    }))
    .sort((a, b) => a.number - b.number);
  const parsedEntries = canonical.map((entry) => {
    const parsed = figureEntrySchema.safeParse(entry);
    return parsed.success ? parsed.data : null;
  });
  if (parsedEntries.some((entry) => entry === null)) {
    return { ok: false, error: { code: "INVALID_INPUT", message: "图集条目不完整。" } };
  }
  const entries = parsedEntries as FigureSetRevision["entries"];
  const drawings = await readDrawings(repository, actor, matterId);
  if (!drawings.ok) return drawings;
  const byId = new Map(drawings.data.map((entry) => [entry.drawing.id, entry.drawing]));
  const missing: string[] = [];
  for (const entry of entries) {
    if (entry.figureId.length === 0) {
      return { ok: false, error: { code: "INVALID_INPUT", message: "每张图都需要 figureId。" } };
    }
    if (entry.drawingId === null) continue;
    const drawing = byId.get(entry.drawingId);
    if (!drawing) missing.push(entry.drawingId);
    else if (drawing.sha256 === "" || drawing.width < 1 || drawing.height < 1) missing.push(entry.drawingId);
  }
  if (missing.length > 0) {
    return {
      ok: false,
      error: { code: "RESOURCE_NOT_FOUND", message: "绑定的附图已不在图库中。", resourceIds: missing },
    };
  }

  const currentId = target.figureRevisionId;
  const current = await readFigureSetRow(repository, actor, matterId, target.id, currentId);
  if (!current.ok) return current;
  const sameEntries = current.data !== null && JSON.stringify(current.data.entries) === JSON.stringify(entries);
  // A retry of a bind that already landed: the target moved from exactly this
  // base to exactly these entries. Answer the persisted revision, write nothing.
  if (
    input.baseFigureRevisionId !== currentId &&
    sameEntries &&
    current.data!.parentId === input.baseFigureRevisionId
  ) {
    return { ok: true, data: await viewOf(repository, actor, matterId, target, current.data!) };
  }
  if (input.baseFigureRevisionId !== currentId) {
    return {
      ok: false,
      error: {
        code: "INPUT_STALE",
        message: "图集已被更新，请刷新后再绑定。",
        resourceIds: [input.targetId],
        currentFigureRevisionId: currentId,
      },
    };
  }
  if (sameEntries) {
    return { ok: true, data: await viewOf(repository, actor, matterId, target, current.data!) };
  }

  const hash = await figureSetHash(entries);
  // The nonce makes the revision row this attempt's alone, so cleaning it up
  // after a lost race can never remove a row another writer's pointer names.
  const revisionId = await figureId(
    `set/${matterId}/${target.id}/${currentId}/${JSON.stringify(entries)}/${globalThis.crypto.randomUUID()}`,
  );
  const now = clockOf(options).now();
  const at = isoSeconds(now);
  const revision: FigureSetRevision = {
    id: revisionId,
    matterId,
    targetId: target.id,
    parentId: currentId,
    entries,
    hash,
    createdAt: at,
  };
  const parsedRevision = figureSetRevisionSchema.safeParse(revision);
  if (!parsedRevision.success) {
    return { ok: false, error: { code: "INVALID_INPUT", message: "图集修订不符合合同结构。" } };
  }
  const written = await writeFigureSetRow(repository, actor, matterId, parsedRevision.data);
  if (!written.ok) return written;
  const committed = await writeTargetPointer(repository, actor, matterId, target, revisionId, now, entries.length);
  if (!committed.ok) {
    await deleteRow(repository, figureSetKey(target.id, revisionId));
    // Another writer committed first. Re-reading decides: the same bind landed
    // (answer it), the target moved elsewhere (INPUT_STALE), or only the
    // matter version moved (write again on the new version).
    if (committed.error.code === "VERSION_CONFLICT" || committed.error.code === "INPUT_STALE") {
      return { lostRace: committed };
    }
    return committed;
  }
  const bound = { ...target, figureRevisionId: revisionId };
  return { ok: true, data: await viewOf(repository, actor, matterId, bound, parsedRevision.data) };
}

async function writeTargetPointer(
  repository: LocalRepository,
  actor: Actor,
  matterId: string,
  target: TargetRecord,
  revisionId: string,
  nowMs: number,
  count: number,
): Promise<FigureResult<true>> {
  const loaded = await repository.loadMatter(actor, matterId);
  if (!loaded.ok) return storageFailure(loaded.error);
  const aggregate = loaded.data.data;
  const fresh = aggregate.targets.find((item) => item.id === target.id);
  if (!fresh || fresh.figureRevisionId !== target.figureRevisionId) {
    // Another writer moved this target between our read and this commit.
    return {
      ok: false,
      error: {
        code: "INPUT_STALE",
        message: "图集已被更新，请刷新后再绑定。",
        resourceIds: [target.id],
        currentFigureRevisionId: fresh?.figureRevisionId ?? null,
      },
    };
  }
  const at = isoSeconds(nowMs);
  const committed = await repository.commit(
    actor,
    {
      contractVersion: CONTRACT_VERSION,
      expectedVersion: aggregate.matter.version,
      payload: {
        matter: { ...aggregate.matter, version: aggregate.matter.version + 1, updatedAt: at },
        targets: aggregate.targets.map((item) =>
          item.id === target.id ? { ...item, figureRevisionId: revisionId } : item,
        ),
        assets: aggregate.assets,
        events: [
          {
            id: await figureId(`event/figures-bound/${target.id}/${revisionId}`),
            tenantId: actor.tenantId,
            matterId,
            targetId: target.id,
            actorId: actor.userId,
            actorKind: "user",
            action: "figures.bound",
            snapshot: null,
            jobId: null,
            resourceId: revisionId,
            occurredAt: at,
            metadata: { version: aggregate.matter.version + 1, count },
          },
        ],
        blobs: [],
      },
    },
    { requestId: await figureId(`request/figures-bound/${target.id}/${revisionId}`) },
  );
  if (committed.ok) return { ok: true, data: true };
  return storageFailure(committed.error);
}

async function writeFigureSetRow(
  repository: LocalRepository,
  actor: Actor,
  matterId: string,
  revision: FigureSetRevision,
): Promise<FigureResult<true>> {
  try {
    await repository.backend.transaction("readwrite", async (tx) => {
      const existing = asStoredFigureSet(await tx.get(STORES.blobs, figureSetKey(revision.targetId, revision.id)));
      if (existing) {
        if (existing.tenantId !== actor.tenantId || existing.matterId !== matterId) {
          throw new Error("figure set belongs to another matter");
        }
        return;
      }
      const row: StoredFigureSet = { kind: "figures.set", tenantId: actor.tenantId, matterId, revision };
      await tx.put(STORES.blobs, figureSetKey(revision.targetId, revision.id), row);
    });
    return { ok: true, data: true };
  } catch {
    return { ok: false, error: { code: "STORAGE_UNAVAILABLE", message: "无法写入图集修订。" } };
  }
}

async function readFigureSetRow(
  repository: LocalRepository,
  actor: Actor,
  matterId: string,
  targetId: string,
  revisionId: string,
): Promise<FigureResult<FigureSetRevision | null>> {
  try {
    const stored = await repository.backend.transaction("readonly", async (tx) =>
      asStoredFigureSet(await tx.get(STORES.blobs, figureSetKey(targetId, revisionId))),
    );
    if (stored && (stored.tenantId !== actor.tenantId || stored.matterId !== matterId)) {
      return { ok: false, error: { code: "RESOURCE_NOT_FOUND", message: "图集不属于这个案件。", resourceIds: [revisionId] } };
    }
    return { ok: true, data: stored?.revision ?? null };
  } catch {
    return { ok: false, error: { code: "STORAGE_UNAVAILABLE", message: "无法读取本机的图集记录。" } };
  }
}

async function readFigureSets(
  repository: LocalRepository,
  actor: Actor,
  matterId: string,
): Promise<FigureResult<StoredFigureSet[]>> {
  let rows: readonly unknown[];
  try {
    rows = await repository.backend.transaction("readonly", async (tx) => tx.getAll(STORES.blobs));
  } catch {
    return { ok: false, error: { code: "STORAGE_UNAVAILABLE", message: "无法读取本机的图集记录。" } };
  }
  const out: StoredFigureSet[] = [];
  for (const value of rows) {
    const stored = asStoredFigureSet(value);
    if (!stored || stored.tenantId !== actor.tenantId || stored.matterId !== matterId) continue;
    out.push(stored);
  }
  return { ok: true, data: out };
}

async function viewOf(
  repository: LocalRepository,
  actor: Actor,
  matterId: string,
  target: TargetRecord,
  current: FigureSetRevision,
): Promise<FigureSetView> {
  const sets = await readFigureSets(repository, actor, matterId);
  const revisions = sets.ok
    ? historyOrder(sets.data.filter((stored) => stored.revision.targetId === target.id).map((stored) => stored.revision))
    : [];
  const parent = current.parentId === null ? null : (revisions.find((item) => item.id === current.parentId) ?? null);
  return { targetId: target.id, current, entries: current.entries, parent, revisions };
}

/**
 * Oldest first: a revision comes after every ancestor on its `parentId` chain.
 * Revision ids are random, and several binds can share one `createdAt` second,
 * so neither alone gives the append order; ties beyond depth fall back to them.
 */
function historyOrder(revisions: readonly FigureSetRevision[]): FigureSetRevision[] {
  const byId = new Map(revisions.map((revision) => [revision.id, revision]));
  const depth = new Map<string, number>();
  for (const revision of revisions) {
    let steps = 0;
    const seen = new Set<string>([revision.id]);
    for (let parentId = revision.parentId; parentId !== null; ) {
      const parent = byId.get(parentId);
      if (!parent || seen.has(parent.id)) break;
      seen.add(parent.id);
      steps += 1;
      parentId = parent.parentId;
    }
    depth.set(revision.id, steps);
  }
  return [...revisions].sort(
    (a, b) =>
      depth.get(a.id)! - depth.get(b.id)! || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  );
}

/**
 * A target's first figure set. There is no "create target" command in this
 * build yet (reported as NEEDS_DECISION), so the first binding is created with
 * an empty set instead of a null pointer: the contract's `figureRevisionId` is
 * non-null.
 */
export async function createEmptyFigureSet(
  repository: LocalRepository,
  actor: Actor,
  matterId: string,
  targetId: string,
  options: { now?: () => number } = {},
): Promise<FigureResult<FigureSetView>> {
  const loaded = await repository.loadMatter(actor, matterId);
  if (!loaded.ok) return storageFailure(loaded.error);
  const target = loaded.data.data.targets.find((item) => item.id === targetId);
  if (!target) {
    return { ok: false, error: { code: "RESOURCE_NOT_FOUND", message: "目标不在这个案件里。", resourceIds: [targetId] } };
  }
  const existing = await readFigureSetRow(repository, actor, matterId, target.id, target.figureRevisionId);
  if (!existing.ok) return existing;
  if (existing.data) return { ok: true, data: await viewOf(repository, actor, matterId, target, existing.data) };
  const at = isoSeconds(clockOf(options).now());
  // The target already names its (non-null) first revision; materialise that
  // id as the empty set rather than inventing a second one it never points at.
  const revision: FigureSetRevision = {
    id: target.figureRevisionId,
    matterId,
    targetId: target.id,
    parentId: null,
    entries: [],
    hash: await figureSetHash([]),
    createdAt: at,
  };
  const written = await writeFigureSetRow(repository, actor, matterId, revision);
  if (!written.ok) return written;
  return { ok: true, data: await viewOf(repository, actor, matterId, target, revision) };
}

export interface FigureSetRead {
  targets: readonly TargetRecord[];
  /** Current figure set per target, keyed by target id; absent when none. */
  current: ReadonlyMap<string, FigureSetRevision>;
  revisions: readonly FigureSetRevision[];
  drawings: readonly LibraryDrawing[];
}

/** Everything the figure surface shows, read from persisted state only. */
export async function readFigureLibrary(
  repository: LocalRepository,
  actor: Actor,
  matterId: string,
): Promise<FigureResult<FigureSetRead>> {
  const loaded = await repository.loadMatter(actor, matterId);
  if (!loaded.ok) return storageFailure(loaded.error);
  const drawings = await readDrawings(repository, actor, matterId);
  if (!drawings.ok) return drawings;
  const sets = await readFigureSets(repository, actor, matterId);
  if (!sets.ok) return sets;
  const current = new Map<string, FigureSetRevision>();
  const revisions = historyOrder(sets.data.map((stored) => stored.revision));
  for (const target of loaded.data.data.targets) {
    const bound = revisions.find((revision) => revision.id === target.figureRevisionId);
    if (bound) current.set(target.id, bound);
  }
  return { ok: true, data: { targets: loaded.data.data.targets, current, revisions, drawings: drawings.data } };
}

// ---------------------------------------------------------------------------
// Body-text figure references
// ---------------------------------------------------------------------------

export interface FigureReference {
  /** The reference exactly as it appears in the text ("图3", "FIG. 3"). */
  text: string;
  number: number | null;
  figureId: string | null;
}

export interface FigureReferenceResolution {
  references: readonly FigureReference[];
  /** References whose number the set does not address, or does not parse. */
  missing: readonly FigureReference[];
  resolved: readonly FigureReference[];
}

const FIGURE_REFERENCE_PATTERN = /(?:图|圖)\s*(\d{1,4})(?![0-9])|(?:\bFIG(?:URE)?S?\.?\s*)(\d{1,4})(?![0-9])/gi;

/**
 * Resolve the figure references in body text against ONE figure-set revision.
 * Pure: the revision must already be loaded, so a reference can never be
 * resolved against "whatever the target points at now". A reference the set
 * does not address is returned in `missing`; it is never dropped.
 */
export function resolveFigureReferences(
  text: string,
  revision: Pick<FigureSetRevision, "entries">,
): FigureReferenceResolution {
  const byNumber = new Map(revision.entries.map((entry) => [entry.number, entry.figureId]));
  const references: FigureReference[] = [];
  for (const match of String(text ?? "").matchAll(FIGURE_REFERENCE_PATTERN)) {
    const raw = match[1] ?? match[2] ?? "";
    const number = raw === "" ? null : Number(raw);
    references.push({
      text: match[0]!,
      number,
      figureId: number === null ? null : (byNumber.get(number) ?? null),
    });
  }
  return {
    references,
    missing: references.filter((reference) => reference.figureId === null),
    resolved: references.filter((reference) => reference.figureId !== null),
  };
}

/** The distinct figure ids a draft AST references, in document order. */
export function collectFigureIds(ast: unknown): string[] {
  const out: string[] = [];
  const add = (value: unknown) => {
    if (typeof value !== "string" || value.length === 0 || out.includes(value)) return;
    out.push(value);
  };
  const visitParagraph = (paragraph: unknown) => {
    if (!isRecord(paragraph) || !Array.isArray(paragraph.figureIds)) return;
    for (const id of paragraph.figureIds) add(id);
  };
  if (!isRecord(ast)) return out;
  if (Array.isArray(ast.claims)) {
    for (const claim of ast.claims) {
      if (!isRecord(claim) || !Array.isArray(claim.paragraphs)) continue;
      for (const paragraph of claim.paragraphs) visitParagraph(paragraph);
    }
  }
  if (Array.isArray(ast.sections)) {
    for (const section of ast.sections) {
      if (!isRecord(section) || !Array.isArray(section.paragraphs)) continue;
      for (const paragraph of section.paragraphs) visitParagraph(paragraph);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Export gate
// ---------------------------------------------------------------------------

export interface FigureGateReason {
  code: FigureErrorCode;
  resourceId?: string;
}

export interface FigureGateDecision {
  allowed: boolean;
  /** What §6's `GateContext.filesAvailable` receives. */
  filesAvailable: boolean;
  evaluatedAt: string;
  reasons: readonly FigureGateReason[];
}

export interface FigureGateInput {
  targetId: string;
  /** The snapshot the export names, if it names one. */
  figureRevisionId?: string | null;
  /** Figure ids the body text references (`DraftAST` paragraph.figureIds). */
  referencedFigureIds?: readonly string[];
}

export type FigureGateRead = FigureResult<FigureGateDecision>;

/**
 * The export-side check for drawings: does the figure set of this target still
 * resolve, and are the bytes still there? Pure with respect to the persisted
 * state it is handed — no clock beyond the supplied one, no network, no writes.
 *
 * Reasons are ordered and deterministic:
 * - `STALE_BINDING` — a snapshot names a figure revision the target no longer
 *   points at, or the target points at a revision row that is gone;
 * - `RESOURCE_NOT_FOUND` — the text references a figure the set does not address;
 * - `MISSING_BYTES` — an entry's drawing row, asset or bytes are gone, or the
 *   stored bytes no longer match the recorded digest;
 * - `DUPLICATE_FIGURE_NUMBER` — a historical set that violates 1..n (a check
 *   finding; §6 says the check blocker uses this code).
 */
export async function checkFigureExportGate(
  repository: LocalRepository,
  actor: Actor,
  matterId: string,
  input: FigureGateInput,
  options: { now?: () => number } = {},
): Promise<FigureGateRead> {
  const loaded = await repository.loadMatter(actor, matterId);
  if (!loaded.ok) return storageFailure(loaded.error);
  const aggregate = loaded.data.data;
  const target = aggregate.targets.find((item) => item.id === input.targetId);
  if (!target) {
    return { ok: false, error: { code: "RESOURCE_NOT_FOUND", message: "目标不在这个案件里。", resourceIds: [input.targetId] } };
  }
  const reasons: FigureGateReason[] = [];
  const boundId = input.figureRevisionId ?? target.figureRevisionId;
  if (input.figureRevisionId != null && input.figureRevisionId !== target.figureRevisionId) {
    reasons.push({ code: "STALE_BINDING", resourceId: input.figureRevisionId });
  }
  const bound = await readFigureSetRow(repository, actor, matterId, target.id, boundId);
  if (!bound.ok) return bound;
  if (!bound.data) {
    reasons.push({ code: "STALE_BINDING", resourceId: boundId });
  } else {
    const numbers = checkFigureNumbers(bound.data.entries);
    if (numbers?.code === "DUPLICATE_FIGURE_NUMBER") {
      reasons.push({ code: "DUPLICATE_FIGURE_NUMBER", resourceId: bound.data.id });
    }
    const addressed = new Set(bound.data.entries.map((entry) => entry.figureId));
    for (const referenced of input.referencedFigureIds ?? []) {
      if (!addressed.has(referenced)) {
        reasons.push({ code: "RESOURCE_NOT_FOUND", resourceId: referenced });
      }
    }
    const missing = new Set<string>();
    for (const entry of bound.data.entries) {
      if (entry.drawingId === null) {
        missing.add(entry.figureId);
        continue;
      }
      const usable = await drawingBytesUsable(repository, actor, aggregate, entry.drawingId);
      if (!usable) missing.add(entry.drawingId);
    }
    for (const resourceId of missing) reasons.push({ code: "MISSING_BYTES", resourceId });
  }
  // `filesAvailable` answers only "are the bound figures' bytes here?": a stale
  // snapshot, a duplicate number or an unaddressed reference with every byte
  // present leaves it true. A revision row that is gone names no files at all,
  // so their bytes cannot be shown present and it fails closed.
  const filesAvailable = bound.data !== null && !reasons.some((reason) => reason.code === "MISSING_BYTES");
  return {
    ok: true,
    data: {
      allowed: reasons.length === 0,
      filesAvailable,
      evaluatedAt: isoSeconds(clockOf(options).now()),
      reasons,
    },
  };
}

/**
 * Whether a drawing's bytes are really present and still the bytes the asset
 * record names: the row exists in this matter, the asset is visible, the blob
 * exists under that asset id, and its digest and length match.
 */
async function drawingBytesUsable(
  repository: LocalRepository,
  actor: Actor,
  aggregate: MatterAggregate,
  drawingId: string,
): Promise<boolean> {
  const row = await readDrawingRow(repository, actor, aggregate.matter.id, drawingId);
  if (!row.ok) return false;
  const asset = aggregate.assets.find((item) => item.id === row.data.drawing.assetId);
  if (!asset || asset.purpose !== "drawing" || asset.state !== "available") return false;
  if (asset.sha256 !== row.data.drawing.sha256) return false;
  try {
    const blob = await repository.backend.transaction("readonly", async (tx) => {
      const value = await tx.get(STORES.blobs, asset.id);
      return isRecord(value) && value.bytes instanceof Uint8Array ? value : null;
    });
    if (!blob) return false;
    const bytes = blob.bytes as Uint8Array;
    if (bytes.byteLength !== asset.byteLength) return false;
    if (blob.sha256 !== asset.sha256 || blob.tenantId !== actor.tenantId) return false;
    return (await sha256Hex(bytes)) === asset.sha256;
  } catch {
    return false;
  }
}

const REPOSITORY_CODES = new Set<string>([
  "INVALID_INPUT",
  "RESOURCE_NOT_FOUND",
  "VERSION_CONFLICT",
  "QUOTA_EXCEEDED",
  "HASH_MISMATCH",
]);

/** A repository refusal keeps its §10 code; anything else is a storage failure. */
function storageFailure(error: { code: string; message: string; latestVersion?: number }): FigureResult<never> {
  const code = (REPOSITORY_CODES.has(error.code) ? error.code : "STORAGE_UNAVAILABLE") as FigureErrorCode;
  return { ok: false, error: { code, message: error.message } };
}

// ---------------------------------------------------------------------------
// View model for the figure surface
// ---------------------------------------------------------------------------

export interface FigurePanelEntry {
  figureId: string;
  number: number;
  title: string;
  drawingId: string | null;
  /** The bound reference numerals; a rebind from the panel carries them over. */
  numerals: readonly { value: string; label: string }[];
}

export interface FigurePanelRevision {
  id: string;
  parentId: string | null;
  hash: string;
  createdAt: string;
  entries: readonly FigurePanelEntry[];
}

export interface FigurePanelData {
  matterId: string;
  matterVersion: number;
  targets: readonly TargetRecord[];
  drawings: readonly LibraryDrawing[];
  /** Per target id: the figure set the target currently binds, if any. */
  revisions: ReadonlyMap<string, FigurePanelRevision>;
  /** Per target id: every revision that target has had, oldest first. */
  history: ReadonlyMap<string, readonly FigurePanelRevision[]>;
  /** Per target id: the export gate's verdict over persisted state. */
  gates: ReadonlyMap<string, FigureGateDecision>;
  /** The gate of the target the panel is showing, when it shows one. */
  gate: FigureGateDecision | null;
  /** The figure revision the draft on screen was built against, if any. */
  draftFigureRevisionId: string | null;
}

export type FigurePanelView =
  | { kind: "loading" }
  | { kind: "storage_unavailable"; message: string }
  | { kind: "empty"; data: FigurePanelData }
  | { kind: "library"; data: FigurePanelData; targetId: string | null; stale: boolean }
  | { kind: "failed"; code: FigureErrorCode; message: string; data: FigurePanelData | null };

export function figuresStale(
  data: FigurePanelData,
  targetId: string | null,
  draftFigureRevisionId: string | null,
): boolean {
  if (targetId === null || draftFigureRevisionId === null) return false;
  const current = data.revisions.get(targetId);
  if (!current) return true;
  return current.id !== draftFigureRevisionId;
}

/** Read everything the figure surface needs; no writes, no fabricated rows. */
export async function loadFigurePanel(
  repository: LocalRepository,
  actor: Actor,
  matterId: string,
  options: { targetId?: string | null; draftFigureRevisionId?: string | null; now?: () => number } = {},
): Promise<FigurePanelView> {
  const read = await readFigureLibrary(repository, actor, matterId);
  if (!read.ok) {
    if (read.error.code === "STORAGE_UNAVAILABLE") {
      return { kind: "storage_unavailable", message: read.error.message };
    }
    return { kind: "failed", code: read.error.code, message: read.error.message, data: null };
  }
  const loaded = await repository.loadMatter(actor, matterId);
  const matterVersion = loaded.ok ? loaded.data.version : 0;
  const revisions = new Map<string, FigurePanelRevision>();
  const history = new Map<string, readonly FigurePanelRevision[]>();
  const gates = new Map<string, FigureGateDecision>();
  for (const target of read.data.targets) {
    const current = read.data.current.get(target.id) ?? null;
    if (!current) continue;
    revisions.set(target.id, panelRevision(current));
    history.set(
      target.id,
      read.data.revisions.filter((revision) => revision.targetId === target.id).map(panelRevision),
    );
    const gate = await checkFigureExportGate(repository, actor, matterId, { targetId: target.id }, options);
    if (gate.ok) gates.set(target.id, gate.data);
  }
  const targetId = options.targetId ?? null;
  const data: FigurePanelData = {
    matterId,
    matterVersion,
    targets: read.data.targets,
    drawings: read.data.drawings,
    revisions,
    history,
    gates,
    gate: targetId === null ? null : (gates.get(targetId) ?? null),
    draftFigureRevisionId: options.draftFigureRevisionId ?? null,
  };
  if (data.drawings.length === 0 && data.targets.length === 0) return { kind: "empty", data };
  return {
    kind: "library",
    data,
    targetId,
    stale: figuresStale(data, targetId, data.draftFigureRevisionId),
  };
}

function panelRevision(revision: FigureSetRevision): FigurePanelRevision {
  return {
    id: revision.id,
    parentId: revision.parentId,
    hash: revision.hash,
    createdAt: revision.createdAt,
    entries: revision.entries.map((entry) => ({
      figureId: entry.figureId,
      number: entry.number,
      title: entry.title,
      drawingId: entry.drawingId,
      numerals: entry.numerals.map((numeral) => ({ value: numeral.value, label: numeral.label })),
    })),
  };
}

export const FIGURE_ERROR_MESSAGES: Readonly<Record<FigureErrorCode, string>> = Object.freeze({
  INVALID_INPUT: "输入不完整，检查后重试。",
  RESOURCE_NOT_FOUND: "要引用的内容已不在案件中。",
  VERSION_CONFLICT: "案件已被另一处更新，请刷新后重试。",
  STORAGE_UNAVAILABLE: "无法访问本机存储，稍后重试。",
  QUOTA_EXCEEDED: "本机存储已满，请清理空间后重试。",
  HASH_MISMATCH: "文件内容与记录不符。",
  BAD_DRAWING: "图片内容不完整或已损坏。",
  IMAGE_TOO_LARGE: "图片超过 8 MiB 或 16 MP 上限，请换原图。",
  MIME_MISMATCH: "图片格式与内容不一致。",
  UNSUPPORTED_MEDIA: "只接受 PNG 或 JPEG 附图。",
  DUPLICATE_FIGURE_NUMBER: "图号必须从 1 起连续且不重复。",
  INPUT_STALE: "图集已被更新，请刷新后再绑定。",
  STALE_BINDING: "正文引用的图集不是当前版本。",
  MISSING_BYTES: "附图文件已不在本机，导出会失败。",
});

export function figureErrorMessage(code: FigureErrorCode): string {
  return FIGURE_ERROR_MESSAGES[code] ?? "操作失败。";
}
