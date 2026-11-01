/**
 * V6-12 fixture generator. Synthetic and deterministic: every byte written
 * here is produced from the patterns below, so the same checkout always yields
 * the same files and no real customer material is involved.
 *
 *   node qa/v6/scenarios/V6-12/fixtures/generate.mjs
 *
 * Files:
 *   drawing-valid.png       128x96 RGB, stored-deflate IDAT, real row filters
 *   drawing-valid.jpg       40x16 baseline grayscale, Huffman-decodable scan
 *   drawing-dimension-lie.png  IHDR claims 640x400, IDAT holds 320x200 rows
 *   drawing-dimension-lie.jpg  SOF claims 4000x3000, scan holds 40x16 blocks
 *   drawing-17mp.png        real 4352x4000 grey PNG, every row present (17.4 MP)
 *   drawing-corrupt.png     valid structure, IDAT bytes are not deflate data
 *   drawing-truncated.jpg   baseline stream cut before EOI
 *   drawing-valid-restart.jpg  40x16 baseline with DRI=2 and RST0..RST3
 *   drawing-valid-noninterleaved.jpg  4:2:0 with one scan per component (valid)
 *   drawing-noninterleaved-lie.jpg  SOF 4000x3000 4:2:0, luma scan holds 47,000 of 187,500 blocks
 *   drawing-missing-component-scan.jpg  three components declared, only component 1 coded
 *   drawing-restart-order.jpg  same, with the second restart marker out of order
 *   drawing-not-an-image.png  UTF-8 text with a .png name
 *   drawing-interlaced-valid.png  33x7 Adam7 RGB PNG, every pass row filter 0
 *   drawing-interlaced-bad-filter.png  same image, one pass row filter byte 7
 *   drawing-duplicate-component.jpg  frame lists component id 1 twice
 *   drawing-mcu-overflow.jpg  interleaved 4x4+1x1+1x1 = 18 blocks per MCU
 */
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const HERE = new URL("./", import.meta.url);

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)) >>> 0;
  return (crc ^ 0xffffffff) >>> 0;
}

function adler32(bytes) {
  let a = 1;
  let b = 0;
  for (const byte of bytes) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

/** zlib (RFC 1950) around stored DEFLATE blocks: no compression, fully valid. */
function zlibStored(raw) {
  const blocks = Math.max(1, Math.ceil(raw.length / 65535));
  const out = [0x78, 0x01];
  for (let block = 0; block < blocks; block += 1) {
    const start = block * 65535;
    const slice = raw.subarray(start, Math.min(raw.length, start + 65535));
    out.push(block === blocks - 1 ? 0x01 : 0x00);
    out.push(slice.length & 0xff, (slice.length >> 8) & 0xff);
    out.push(~slice.length & 0xff, (~slice.length >> 8) & 0xff);
    for (const byte of slice) out.push(byte);
  }
  const sum = adler32(raw);
  out.push((sum >>> 24) & 0xff, (sum >>> 16) & 0xff, (sum >>> 8) & 0xff, sum & 0xff);
  return Uint8Array.from(out);
}

function u32(value) {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

function pngChunk(type, data) {
  const typeBytes = [...type].map((character) => character.charCodeAt(0));
  const body = Uint8Array.from([...typeBytes, ...data]);
  return Uint8Array.from([...u32(data.length), ...body, ...u32(crc32(body))]);
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function ihdr(width, height, colour = 2, interlace = 0) {
  return pngChunk(
    "IHDR",
    Uint8Array.from([...u32(width), ...u32(height), 8, colour, 0, 0, interlace]),
  );
}

/**
 * A screenshot-like drawing: white field, a dark border and two crossing
 * rules, plus a caption bar. Deterministic, so its digest is stable.
 */
function rgbRows(width, height) {
  const stride = 1 + width * 3;
  const rows = new Uint8Array(stride * height);
  for (let y = 0; y < height; y += 1) {
    const start = y * stride;
    rows[start] = 0; // filter: None
    for (let x = 0; x < width; x += 1) {
      const at = start + 1 + x * 3;
      const border = x < 2 || y < 2 || x >= width - 2 || y >= height - 2;
      const rule = (x === Math.floor(width / 2) && y > height / 4) || (y === Math.floor(height / 2) && x > width / 4);
      const caption = y >= height - 14 && y < height - 6 && x > 8 && x < width - 8;
      const value = border || rule ? 24 : caption ? 96 : 235;
      rows[at] = value;
      rows[at + 1] = value;
      rows[at + 2] = value;
    }
  }
  return rows;
}

function writePng(name, { width, height, rows, header = null }) {
  const idat = zlibStored(rows);
  const png = Uint8Array.from([
    ...PNG_SIGNATURE,
    ...ihdr(header?.width ?? width, header?.height ?? height),
    ...pngChunk("IDAT", idat),
    ...pngChunk("IEND", new Uint8Array(0)),
  ]);
  writeFileSync(new URL(name, HERE), png);
  return png;
}

// Adam7 pass geometry: x start, y start, x step, y step.
const ADAM7 = [
  [0, 0, 8, 8],
  [4, 0, 8, 8],
  [0, 4, 4, 8],
  [2, 0, 4, 4],
  [0, 2, 2, 4],
  [1, 0, 2, 2],
  [0, 1, 1, 2],
];

/**
 * The filtered image an Adam7-interlaced PNG carries: seven passes, in pass
 * order, each pass row prefixed by its own filter byte (None here). The RGB
 * values follow a fixed pattern, so every byte is deterministic. `rowStarts`
 * records each row's filter-byte offset for the deliberately-bad fixture.
 */
function adam7Rows(width, height) {
  const bytes = [];
  const rowStarts = [];
  for (const [xStart, yStart, xStep, yStep] of ADAM7) {
    const passWidth = Math.max(0, Math.ceil((width - xStart) / xStep));
    const passHeight = Math.max(0, Math.ceil((height - yStart) / yStep));
    if (passWidth === 0 || passHeight === 0) continue;
    for (let row = 0; row < passHeight; row += 1) {
      rowStarts.push(bytes.length);
      bytes.push(0); // filter: None
      for (let column = 0; column < passWidth; column += 1) {
        const x = xStart + column * xStep;
        const y = yStart + row * yStep;
        const value = (x * 7 + y * 13) % 256;
        bytes.push(value, (value + 61) % 256, (value + 173) % 256);
      }
    }
  }
  return { rows: Uint8Array.from(bytes), rowStarts };
}

function writeInterlacedPng(name, { width, height, rows }) {
  const png = Uint8Array.from([
    ...PNG_SIGNATURE,
    ...ihdr(width, height, 2, 1),
    ...pngChunk("IDAT", zlibStored(rows)),
    ...pngChunk("IEND", new Uint8Array(0)),
  ]);
  writeFileSync(new URL(name, HERE), png);
  return png;
}

// ---------------------------------------------------------------------------
// Baseline JPEG writer
// ---------------------------------------------------------------------------

/**
 * Minimal baseline JPEG encoder for an 8-bit image of all-DC-zero blocks. The
 * Huffman tables are one symbol per class, so every block is the two-bit
 * sequence "DC size 0" + "EOB": the smallest stream that a real Huffman decoder
 * can still decode to the declared block count.
 *
 * `scans` lists the component ids each SOS codes, in stream order, so both
 * interleaved (one scan with every component) and non-interleaved (one scan per
 * component) files can be written. Each block grid is the one a decoder walks:
 * ceil(ceil(width * h / hMax) / 8) by ceil(ceil(height * v / vMax) / 8).
 */
function baselineJpegMulti(width, height, { restartInterval = 0, wrongRestart = false, components, scans, lumaBlocks = null }) {
  const octets = [];
  const push = (...values) => octets.push(...values);
  const u16 = (value) => push((value >> 8) & 0xff, value & 0xff);

  const hMax = Math.max(...components.map((component) => component.h));
  const vMax = Math.max(...components.map((component) => component.v));
  const blockGrid = (component) => [
    Math.ceil(Math.ceil((width * component.h) / hMax) / 8),
    Math.ceil(Math.ceil((height * component.v) / vMax) / 8),
  ];
  const byId = new Map(components.map((component) => [component.id, component]));
  const interleaved = scans.some((scan) => scan.length > 1);
  if (interleaved && scans.length !== 1) throw new Error("interleaved files use one scan");
  const mcuCols = Math.ceil(width / (8 * hMax));
  const mcuRows = Math.ceil(height / (8 * vMax));

  push(0xff, 0xd8); // SOI

  // DQT: one 8-bit table, all ones.
  push(0xff, 0xdb);
  u16(2 + 1 + 64);
  push(0x00);
  for (let index = 0; index < 64; index += 1) push(1);

  // SOF0: precision 8, then the declared size, then the components' sampling
  // factors and quantiser table (0 for all).
  push(0xff, 0xc0);
  u16(8 + 3 * components.length);
  push(8);
  u16(height);
  u16(width);
  push(components.length);
  for (const component of components) push(component.id, (component.h << 4) | component.v, 0);

  // DHT: DC table 0 and AC table 0, one code of length 1 each.
  push(0xff, 0xc4);
  u16(2 + 1 + 16 + 1);
  push(0x00);
  push(1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
  push(0x00);
  push(0xff, 0xc4);
  u16(2 + 1 + 16 + 1);
  push(0x10);
  push(1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
  push(0x00);

  // DRI: a restart marker after every `restartInterval` MCUs.
  if (restartInterval > 0) {
    push(0xff, 0xdd);
    u16(4);
    u16(restartInterval);
  }

  for (const scan of scans) {
    push(0xff, 0xda);
    u16(6 + 2 * scan.length);
    push(scan.length);
    for (const id of scan) push(id, 0x00);
    push(0, 63, 0);

    // Coding units for this scan: MCUs when interleaved, blocks of the one
    // component otherwise. Each unit is "0" (DC category 0) + "0" (AC EOB) per
    // block, MSB first, then 1-bits of padding to the next byte boundary. With
    // a restart interval each interval of `restartInterval` units (MCUs; one
    // block each in a non-interleaved scan) is padded on its own and followed
    // by RSTn. `lumaBlocks` overrides the first component's count to write a lie.
    const perUnit = interleaved
      ? components.filter((component) => scan.includes(component.id))
      : [byId.get(scan[0])];
    const units = interleaved
      ? mcuCols * mcuRows
      : lumaBlocks !== null && scan[0] === components[0].id
        ? lumaBlocks
        : blockGrid(perUnit[0]).reduce((a, b) => a * b, 1);
    const interval = restartInterval > 0 ? restartInterval : units;
    for (let first = 0, restart = 0; first < units; first += interval, restart += 1) {
      const bits = [];
      for (let unit = first; unit < Math.min(units, first + interval); unit += 1) {
        for (const component of perUnit) {
          const repeats = interleaved ? component.h * component.v : 1;
          for (let block = 0; block < repeats; block += 1) bits.push(0, 0);
        }
      }
      while (bits.length % 8 !== 0) bits.push(1);
      for (let index = 0; index < bits.length; index += 8) {
        let byte = 0;
        for (let bit = 0; bit < 8; bit += 1) byte = (byte << 1) | bits[index + bit];
        // An all-ones byte must be stuffed because 0xFF starts a marker.
        if (byte === 0xff) push(0xff, 0x00);
        else push(byte);
      }
      if (first + interval < units) {
        const number = wrongRestart && restart === 1 ? 3 : restart % 8;
        push(0xff, 0xd0 + number);
      }
    }
  }

  push(0xff, 0xd9); // EOI
  return Uint8Array.from(octets);
}

/** The original single-component writer, on the general one. */
function baselineJpeg(width, height, options = {}) {
  return baselineJpegMulti(width, height, {
    ...options,
    components: [{ id: 1, h: 1, v: 1 }],
    scans: [[1]],
  });
}

// ---------------------------------------------------------------------------
// Write the fixtures
// ---------------------------------------------------------------------------

writePng("drawing-valid.png", { width: 128, height: 96, rows: rgbRows(128, 96) });

// IHDR lies: it claims 640x400 (inside the 16 MP budget) while IDAT only
// carries 320x200 rows, so only a real inflate can catch it.
{
  const width = 320;
  const height = 200;
  const rows = rgbRows(width, height);
  writePng("drawing-dimension-lie.png", {
    width,
    height,
    rows,
    header: { width: 640, height: 400 },
  });
}

// A real 17 MP PNG (S02-A02): 4352x4000 8-bit grey, every row present, so the
// only thing wrong with it is the pixel budget. The rows are deflated with
// zlib level 9 to keep the file small; the content is a flat white field.
{
  const width = 4352;
  const height = 4000;
  const rows = new Uint8Array((1 + width) * height).fill(0xff);
  for (let y = 0; y < height; y += 1) rows[y * (1 + width)] = 0;
  const png = Uint8Array.from([
    ...PNG_SIGNATURE,
    ...ihdr(width, height, 0),
    ...pngChunk("IDAT", deflateSync(rows, { level: 9 })),
    ...pngChunk("IEND", new Uint8Array(0)),
  ]);
  writeFileSync(new URL("drawing-17mp.png", HERE), png);
}

// Corrupt IDAT with a correct CRC: the container is well formed, the stream is
// not deflate data.
{
  const width = 64;
  const height = 48;
  const junk = Uint8Array.from({ length: 96 }, (_, index) => (index * 37) % 251);
  junk[0] = 0x78;
  junk[1] = 0x9c;
  const png = Uint8Array.from([
    ...PNG_SIGNATURE,
    ...ihdr(width, height),
    ...pngChunk("IDAT", junk),
    ...pngChunk("IEND", new Uint8Array(0)),
  ]);
  writeFileSync(new URL("drawing-corrupt.png", HERE), png);
}

// A file that is not an image at all, named .png.
writeFileSync(
  new URL("drawing-not-an-image.png", HERE),
  new TextEncoder().encode("This is a text file renamed to .png; it has no image bytes.\n"),
);

// Valid baseline JPEG. 40x16 with 1x1 sampling is 5x2 MCUs = 10 blocks, two
// bits each: 20 bits, padded with four 1-bits to three bytes (00 00 0F).
writeFileSync(new URL("drawing-valid.jpg", HERE), baselineJpeg(40, 16));

// SOF claims 4000x3000 but the scan carries a single 40x16 image's blocks
// (kept small so 4000x3000 stays under 16 MP while being impossible to satisfy).
{
  const jpeg = baselineJpeg(40, 16);
  const lying = new Uint8Array(jpeg);
  // marker (2) + length (2) + precision (1), then height (2), width (2).
  const sof = findMarker(lying, 0xc0) + 5;
  lying[sof] = (3000 >> 8) & 0xff;
  lying[sof + 1] = 3000 & 0xff;
  lying[sof + 2] = (4000 >> 8) & 0xff;
  lying[sof + 3] = 4000 & 0xff;
  writeFileSync(new URL("drawing-dimension-lie.jpg", HERE), lying);
}

// Truncated JPEG: cut inside the entropy data, before EOI.
{
  const jpeg = baselineJpeg(40, 16);
  // Drop EOI and the last entropy byte, so the declared blocks cannot all decode.
  writeFileSync(new URL("drawing-truncated.jpg", HERE), jpeg.subarray(0, jpeg.length - 3));
}

// Valid baseline JPEG with DRI = 2: five intervals separated by RST0..RST3.
writeFileSync(new URL("drawing-valid-restart.jpg", HERE), baselineJpeg(40, 16, { restartInterval: 2 }));

// Same stream with the second restart marker out of order (RST3 for RST1).
writeFileSync(
  new URL("drawing-restart-order.jpg", HERE),
  baselineJpeg(40, 16, { restartInterval: 2, wrongRestart: true }),
);

// Non-interleaved baseline JPEG: 4:2:0 luma (2x2) plus 1x1 chroma, each
// component coded by its own scan, with DRI = 2. A legal layout whose block
// counts differ per component (Y is 40x16 samples: 5x2 = 10 blocks; Cb and Cr
// are 20x8 samples: 3x1 = 3 blocks each, the right column partly padding), so
// it passes only when each scan is measured on its own grid.
writeFileSync(
  new URL("drawing-valid-noninterleaved.jpg", HERE),
  baselineJpegMulti(40, 16, {
    restartInterval: 2,
    components: [
      { id: 1, h: 2, v: 2 },
      { id: 2, h: 1, v: 1 },
      { id: 3, h: 1, v: 1 },
    ],
    scans: [[1], [2], [3]],
  }),
);

// The reviewer's "dimension lie" for non-interleaved scans: SOF0 declares
// 4000x3000 with 2x2 luma sampling (12 MP, inside the budget), but the single
// luma scan carries only ceil(4000/16)*ceil(3000/16) = 47,000 blocks, the count
// a per-MCU block formula yields, against the 187,500 blocks the luma grid
// really needs. No chroma scan exists at all.
writeFileSync(
  new URL("drawing-noninterleaved-lie.jpg", HERE),
  baselineJpegMulti(4000, 3000, {
    components: [
      { id: 1, h: 2, v: 2 },
      { id: 2, h: 1, v: 1 },
      { id: 3, h: 1, v: 1 },
    ],
    scans: [[1]],
    lumaBlocks: Math.ceil(4000 / 16) * Math.ceil(3000 / 16),
  }),
);

// A frame that declares three components but codes only component 1: the chroma
// components are never scanned, so no decoder can produce the declared image.
writeFileSync(
  new URL("drawing-missing-component-scan.jpg", HERE),
  baselineJpegMulti(40, 16, {
    components: [
      { id: 1, h: 1, v: 1 },
      { id: 2, h: 1, v: 1 },
      { id: 3, h: 1, v: 1 },
    ],
    scans: [[1]],
  }),
);

// Adam7 interlaced PNGs (33x7, 8-bit RGB). The first is a valid image: seven
// passes, every pass row filtered independently. The second is the same image
// with one pass row's filter byte set to 7 (no decoder can apply it); the
// zlib stream is re-deflated after the change, so only the row check can tell.
{
  const { rows, rowStarts } = adam7Rows(33, 7);
  writeInterlacedPng("drawing-interlaced-valid.png", { width: 33, height: 7, rows });
  const broken = Uint8Array.from(rows);
  broken[rowStarts[4]] = 7;
  writeInterlacedPng("drawing-interlaced-bad-filter.png", { width: 33, height: 7, rows: broken });
}

// A frame that lists component id 1 twice. libjpeg refuses it ("Duplicate
// component ID"), and a scan naming id 1 could not say which one it codes.
writeFileSync(
  new URL("drawing-duplicate-component.jpg", HERE),
  baselineJpegMulti(40, 16, {
    components: [
      { id: 1, h: 1, v: 1 },
      { id: 1, h: 1, v: 1 },
    ],
    scans: [[1]],
  }),
);

// An interleaved MCU of 4x4 + 1x1 + 1x1 = 18 data units. T.81 B.2.3 caps an
// MCU at 10; libjpeg refuses it. The entropy data is still shaped to the
// writer's 2x1 MCU grid, so only the MCU-size rule can catch it.
writeFileSync(
  new URL("drawing-mcu-overflow.jpg", HERE),
  baselineJpegMulti(40, 16, {
    components: [
      { id: 1, h: 4, v: 4 },
      { id: 2, h: 1, v: 1 },
      { id: 3, h: 1, v: 1 },
    ],
    scans: [[1, 2, 3]],
  }),
);

function findMarker(bytes, marker) {
  for (let index = 0; index + 1 < bytes.length; index += 1) {
    if (bytes[index] === 0xff && bytes[index + 1] === marker) return index;
  }
  throw new Error(`marker ${marker.toString(16)} not found`);
}

console.log("V6-12 fixtures written");
