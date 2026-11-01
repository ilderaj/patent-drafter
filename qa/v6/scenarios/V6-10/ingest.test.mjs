/**
 * V6-10 — material selection and byte storage (S02, 05-contracts §3 Asset/§10).
 *
 * Everything here goes through the module's public interface: `classifyFile`
 * for the pure content gate and `ingestFiles` against the real
 * `LocalRepository` over an in-memory backend. A "refresh" is a new repository
 * over the same stored bytes, which is all a reloaded page has. DOCX, PDF, PNG,
 * JPEG, TXT and Markdown fixtures are synthesised byte by byte here — no real
 * customer material is used, and no network is touched.
 *
 * Acceptance: V6-10-A01 (save + byte-identical read-back after refresh),
 * V6-10-A02 (hostile input leaves nothing usable), V6-10-A03 (retry/refresh
 * matches persisted state, no duplicate side effects, no partial write).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { crc32, deflateRawSync, deflateSync } from "node:zlib";

import {
  CONTRACT_ERROR_CODES,
  CONTRACT_VERSION,
  STORES,
  openLocalRepository,
  sha256Hex,
} from "../../../../apps/web/src/v6/lib/repository.ts";
import {
  DOCUMENT_MAX_BYTES,
  DOCX_MAX_ENTRIES,
  DOCX_MAX_INFLATED_BYTES,
  IMAGE_MAX_BYTES,
  IMAGE_MAX_PIXELS,
  MAX_CONCURRENT_UPLOADS,
  classifyFile,
  ingestFiles,
  inflateRaw,
} from "../../../../apps/web/src/v6/features/sources/ingest.ts";
import { assetSchema, matterSchema } from "../../../../packages/contracts/src/index.ts";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
const USER_A = "33333333-3333-4333-8333-333333333333";
const USER_B = "44444444-4444-4444-8444-444444444444";
const MATTER_ID = "55555555-5555-4555-8555-555555555555";
const REQUEST_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const T0 = "2026-10-31T00:00:00.000Z";
const T1 = "2026-10-31T00:05:00.000Z";

const ACTOR_A = Object.freeze({ tenantId: TENANT_A, userId: USER_A });
const ACTOR_B = Object.freeze({ tenantId: TENANT_B, userId: USER_B });

const PDF_MIME = "application/pdf";
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PNG_MIME = "image/png";
const JPEG_MIME = "image/jpeg";
const TEXT_MIME = "text/plain";
const MD_MIME = "text/markdown";

const CONTRACT_CODES = new Set(CONTRACT_ERROR_CODES);

/**
 * The same backend contract as the IndexedDB adapter: one transaction per call,
 * structured clones in and out, and an abort that restores everything the
 * failed transaction wrote, with read-write transactions serialized.
 */
class MemoryBackend {
  constructor() {
    this.data = new Map(Object.values(STORES).map((name) => [name, new Map()]));
    this.failPut = null;
    this.closed = false;
    this.queue = Promise.resolve();
  }

  setPutFault(fn) {
    this.failPut = fn;
    return this;
  }

  store(name) {
    const store = this.data.get(name);
    if (!store) throw new Error(`unknown store ${name}`);
    return store;
  }

  transaction(mode, run) {
    if (this.closed) return Promise.reject(new Error("backend is closed"));
    if (mode === "readwrite") {
      const next = this.queue.then(() => this.runTransaction(mode, run));
      this.queue = next.then(
        () => undefined,
        () => undefined,
      );
      return next;
    }
    return this.runTransaction(mode, run);
  }

  async runTransaction(mode, run) {
    const snapshot = new Map([...this.data].map(([name, store]) => [name, new Map(store)]));
    const tx = {
      get: async (name, key) => {
        const value = this.store(name).get(key);
        return value === undefined ? undefined : structuredClone(value);
      },
      put: async (name, key, value) => {
        const fault = this.failPut?.({ store: name, key, value, mode }) ?? null;
        if (fault) throw fault;
        this.store(name).set(key, structuredClone(value));
      },
      delete: async (name, key) => {
        this.store(name).delete(key);
      },
      getAll: async (name) => [...this.store(name).values()].map((value) => structuredClone(value)),
      getAllByIndex: async (name, index, value) =>
        [...this.store(name).values()]
          .filter((row) => row !== null && typeof row === "object" && row[index] === value)
          .map((row) => structuredClone(row)),
    };
    try {
      return await run(tx);
    } catch (error) {
      this.data = snapshot;
      throw error;
    }
  }

  close() {
    this.closed = true;
  }
}

function uuidSource(start = 1) {
  let next = start;
  return () => `00000000-0000-4000-8000-${String(next++).padStart(12, "0")}`;
}

/** One monotonic id source for the whole suite: a retry must not reuse an id. */
const NEW_IDS = uuidSource(1000);

function ingestOptions(extra = {}) {
  return { now: () => new Date(T0), newId: NEW_IDS, ...extra };
}

function fileFrom(bytes, name, type = "") {
  return new File([bytes], name, { type });
}

function createMatterWrite({ version = 1, status = "active", updatedAt = T0 } = {}) {
  return {
    matter: {
      id: MATTER_ID,
      tenantId: TENANT_A,
      version,
      title: "V6-10 合成案卷",
      status,
      sourceVersion: 1,
      createdBy: USER_A,
      createdAt: T0,
      updatedAt,
    },
    targets: [],
    assets: [],
    events: [],
    blobs: [],
  };
}

async function seedMatter() {
  const backend = new MemoryBackend();
  const repository = openLocalRepository(backend);
  const created = await repository.commit(
    ACTOR_A,
    { contractVersion: CONTRACT_VERSION, expectedVersion: 0, payload: createMatterWrite() },
    { requestId: REQUEST_ID },
  );
  assert.equal(created.ok, true, created.ok ? "" : JSON.stringify(created.error));
  return { backend, repository };
}

async function assetsOf(repository, actor = ACTOR_A) {
  const loaded = await repository.loadMatter(actor, MATTER_ID);
  assert.equal(loaded.ok, true, loaded.ok ? "" : JSON.stringify(loaded.error));
  return loaded.data;
}

/** A Blob-shaped file whose reported size is larger than its bytes, for the
 * pre-read size gate (the bytes are never read). */
class ReportedSizeBlob extends Blob {
  #name;
  #size;
  #type;
  constructor(name, size, type = "") {
    super([]);
    this.#name = name;
    this.#size = size;
    this.#type = type;
  }
  get type() {
    return this.#type;
  }
  get name() {
    return this.#name;
  }
  get size() {
    return this.#size;
  }
}

// ---------------------------------------------------------------------------
// Synthetic fixtures
// ---------------------------------------------------------------------------

const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function pngU32(value) {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

function pngChunk(type, data) {
  const typed = Buffer.concat([Buffer.from(type, "latin1"), Buffer.from(data)]);
  return Buffer.concat([Buffer.from(pngU32(data.length)), typed, Buffer.from(pngU32(crc32(typed)))]);
}

/** A complete PNG with real filtered scanlines and chunk CRCs. */
function makePng({ width = 4, height = 3, seed = 1 } = {}) {
  const rowBytes = width * 3;
  const raw = Buffer.alloc((rowBytes + 1) * height);
  for (let row = 0; row < height; row += 1) {
    for (let col = 0; col < rowBytes; col += 1) {
      raw[row * (rowBytes + 1) + 1 + col] = (seed * 31 + row * 7 + col) & 0xff;
    }
  }
  return new Uint8Array(
    Buffer.concat([
      Buffer.from(pngSignature),
      pngChunk("IHDR", [...pngU32(width), ...pngU32(height), 8, 2, 0, 0, 0]),
      pngChunk("IDAT", deflateSync(raw)),
      pngChunk("IEND", []),
    ]),
  );
}

/** Structurally valid PNG container whose IHDR reports huge dimensions. */
function makeOversizePng() {
  const width = 4200;
  const height = 4100;
  return new Uint8Array(
    Buffer.concat([
      Buffer.from(pngSignature),
      pngChunk("IHDR", [...pngU32(width), ...pngU32(height), 8, 2, 0, 0, 0]),
      pngChunk("IDAT", deflateSync(Buffer.from([0]))),
      pngChunk("IEND", []),
    ]),
  );
}

function jpegSegment(marker, payload) {
  return [0xff, marker, ((payload.length + 2) >> 8) & 0xff, (payload.length + 2) & 0xff, ...payload];
}

/** A baseline greyscale JPEG for a real 8x8 block. */
function makeJpeg({ width = 8, height = 8, seed = 1 } = {}) {
  return new Uint8Array([
    0xff, 0xd8,
    ...jpegSegment(0xe0, [0x4a, 0x46, 0x49, 0x46, 0x00, 1, 1, 0, 0, 1, 0, 1, 0, 0]),
    ...jpegSegment(0xfe, [...Buffer.from(`v6-10 synthetic ${seed}`, "latin1")]),
    ...jpegSegment(0xdb, [0x00, ...new Array(64).fill(1)]),
    ...jpegSegment(0xc0, [8, (height >> 8) & 0xff, height & 0xff, (width >> 8) & 0xff, width & 0xff, 1, 1, 0x11, 0]),
    ...jpegSegment(0xc4, [0x00, 1, ...new Array(15).fill(0), 0x00]),
    ...jpegSegment(0xc4, [0x10, 1, ...new Array(15).fill(0), 0x00]),
    ...jpegSegment(0xda, [1, 1, 0x00, 0, 63, 0]),
    0x3f,
    0xff, 0xd9,
  ]);
}

/** A real-size PDF padded with spaces: header first, trailer last. */
function makeLargePdf(byteLength) {
  const buffer = Buffer.alloc(byteLength, 0x20);
  Buffer.from("%PDF-1.4\n").copy(buffer, 0);
  Buffer.from("\n%%EOF\n").copy(buffer, byteLength - 8);
  return new Uint8Array(buffer);
}

function makePdf(text = "V6-10 synthetic specification") {
  return new TextEncoder().encode(
    `%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n% ${text}\ntrailer\n<< /Root 1 0 R >>\nstartxref\n0\n%%EOF\n`,
  );
}

// --- ZIP / DOCX ------------------------------------------------------------

function zipU16(value) {
  return Buffer.from([value & 0xff, (value >>> 8) & 0xff]);
}

function zipU32(value) {
  return Buffer.from([value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff]);
}

function zipRecord(name, data, { method = 8, flags = 0, declaredUncompressed, versionMadeBy = 20, externalAttrs = 0 } = {}) {
  const nameBytes = Buffer.from(name, "utf8");
  const compressed = method === 8 ? deflateRawSync(data) : Buffer.from(data);
  return {
    nameBytes,
    method,
    flags,
    crc: crc32(data) >>> 0,
    compressed,
    // A hostile archive lies about the size it will inflate to; the headers
    // carry the lie, the payload stays small.
    uncompressedLength: declaredUncompressed ?? data.length,
    versionMadeBy,
    externalAttrs,
  };
}

/** A real ZIP archive: local headers, central directory, EOCD. */
function makeZip(records) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const record of records) {
    const localHeader = Buffer.concat([
      zipU32(0x04034b50),
      zipU16(20),
      zipU16(record.flags),
      zipU16(record.method),
      zipU16(0),
      zipU16(0),
      zipU32(record.crc),
      zipU32(record.compressed.length),
      zipU32(record.uncompressedLength),
      zipU16(record.nameBytes.length),
      zipU16(0),
    ]);
    const local = Buffer.concat([localHeader, record.nameBytes, record.compressed]);
    locals.push(local);
    centrals.push(
      Buffer.concat([
        zipU32(0x02014b50),
        zipU16(record.versionMadeBy),
        zipU16(20),
        zipU16(record.flags),
        zipU16(record.method),
        zipU16(0),
        zipU16(0),
        zipU32(record.crc),
        zipU32(record.compressed.length),
        zipU32(record.uncompressedLength),
        zipU16(record.nameBytes.length),
        zipU16(0),
        zipU16(0),
        zipU16(0),
        zipU16(0),
        zipU32(record.externalAttrs),
        zipU32(offset),
        record.nameBytes,
      ]),
    );
    offset += local.length;
  }
  const centralDirectory = Buffer.concat(centrals);
  const eocd = Buffer.concat([
    zipU32(0x06054b50),
    zipU16(0),
    zipU16(0),
    zipU16(records.length),
    zipU16(records.length),
    zipU32(centralDirectory.length),
    zipU32(offset),
    zipU16(0),
  ]);
  return new Uint8Array(Buffer.concat([...locals, centralDirectory, eocd]));
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

function rootRels({ external = false } = {}) {
  return external
    ? `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="https://example.invalid/document.xml" TargetMode="External"/>
</Relationships>`
    : `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;
}

function relationshipsXml(...elements) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${elements.join("\n")}
</Relationships>`;
}

/** A BOM-prefixed UTF-16 `.rels` payload; Node encodes LE, so BE swaps pairs. */
function utf16Bytes(text, littleEndian = true) {
  const buffer = Buffer.from(String.fromCharCode(0xfeff) + text, "utf16le");
  if (!littleEndian) {
    for (let index = 0; index < buffer.length; index += 2) {
      const first = buffer[index];
      buffer[index] = buffer[index + 1];
      buffer[index + 1] = first;
    }
  }
  return buffer;
}

/** The OLE/CFB signature Word uses for an encrypted .docx wrapper. */
function compoundFile() {
  return new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x00, 0x00, 0x00, 0x00]);
}

const DOCX_BODY = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>V6-10 合成说明书：一种示例装置，包括壳体与传感器。</w:t></w:r></w:p></w:body></w:document>`;

function docxRecords({ extra = [], rels = rootRels(), contentTypes = CONTENT_TYPES } = {}) {
  return [
    zipRecord("[Content_Types].xml", Buffer.from(contentTypes)),
    zipRecord("_rels/.rels", Buffer.from(rels)),
    zipRecord("word/document.xml", Buffer.from(DOCX_BODY)),
    ...extra,
  ];
}

function makeDocx(options = {}) {
  return makeZip(docxRecords(options));
}

const DOCX = makeDocx();

/** Fixtures that must be a real PDF (a genuine pypdf-encrypted file), not a
 * hand-written string carrying the /Encrypt token. */
function fixtureBytes(name) {
  return new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));
}

test("V6-10-A02 XML name prefixes with XML NameChars cannot hide relationships or macros", async () => {
  const main = `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>`;
  const prefixes = ["a·", "a·", "á", "a‌", "a⁀", "a😀"];
  const encoded = prefixes.map((prefix) => ({
    prefix,
    types: `<Types xmlns:${prefix}="http://schemas.openxmlformats.org/package/2006/content-types">${main}<${prefix}:Override PartName="/word/data1.bin" ContentType="application/vnd.ms-office.vbaProject"/></Types>`,
    defaults: `<Types xmlns:${prefix}="http://schemas.openxmlformats.org/package/2006/content-types">${main}<${prefix}:Default Extension="bin" ContentType="application/vnd.ms-office.vbaProject"/></Types>`,
    rels: relationshipsXml(`<${prefix}:Relationship xmlns:${prefix}="http://schemas.openxmlformats.org/package/2006/relationships" Id="rId7" Type="http://schemas.microsoft.com/office/2006/relationships/vbaProject" Target="data1.bin"/>`),
    remote: relationshipsXml(`<${prefix}:Relationship xmlns:${prefix}="http://schemas.openxmlformats.org/package/2006/relationships" Id="rId7" Type="x" Target="https://evil.invalid/template.dotx" TargetMode="External"/>`),
  }));
  const variants = encoded.flatMap(({ prefix, types, defaults, rels, remote }) => [
    [`${prefix} Override`, { contentTypes: types }],
    [`${prefix} Default`, { contentTypes: defaults }],
    [
      `${prefix} Relationship`,
      { rels: remote, extra: [zipRecord("word/_rels/document.xml.rels", Buffer.from(rels)), zipRecord("word/data1.bin", compoundFile())] },
    ],
  ]);
  const { backend, repository } = await seedMatter();
  const files = variants.map(([label, options], index) =>
    fileFrom(makeDocx(options), `name-${index}.docx`, DOCX_MIME),
  );
  const outcomes = await ingestFiles(repository, ACTOR_A, MATTER_ID, files, ingestOptions());
  for (const [index, result] of outcomes.entries()) {
    assert.equal(result.status, "rejected", variants[index][0]);
    assert.equal(result.code, "UNSUPPORTED_MEDIA", variants[index][0]);
  }
  const loaded = await assetsOf(repository);
  assert.equal(loaded.version, 1);
  assert.equal(loaded.data.assets.length, 0);
  assert.equal(backend.store(STORES.blobs).size, 0);

  // An unusual but valid prefix is still a namespace, not an automatic refusal.
  const mainPrefixed = main.replace("<Override ", '<a·:Override xmlns:a·="urn:test" ').replace("</Override>", "</a·:Override>");
  const accepted = [
    makeDocx({ contentTypes: `<Types>${mainPrefixed}</Types>` }),
    makeDocx({
      rels: relationshipsXml(`<a·:Relationship xmlns:a·="http://schemas.openxmlformats.org/package/2006/relationships" Id="rId1" Type="x" Target="word/document.xml"/>`),
    }),
    makeDocx({
      contentTypes: CONTENT_TYPES.replace("<Override ", '<á:Override xmlns:á="urn:test" '),
    }),
  ];
  for (const bytes of accepted) {
    const result = classifyFile({ bytes, name: "普通.docx", declaredType: DOCX_MIME });
    assert.equal(result.ok, true, `${JSON.stringify(result)}`);
  }

  // A name the scanner cannot classify is refused, never skipped.
  for (const contentTypes of [
    CONTENT_TYPES.replace("<Override ", '<Override\u0001 '),
    CONTENT_TYPES.replace("<Override ", '<a::Override '),
    CONTENT_TYPES.replace("<Override ", "<a:b:c "),
  ]) {
    const result = classifyFile({ bytes: makeDocx({ contentTypes }), name: "无法识别.docx", declaredType: DOCX_MIME });
    assert.equal(result.ok, false);
  }
});

test("V6-10-A02 a password-protected PDF is refused before storage", async () => {
  const encrypted = fixtureBytes("encrypted.pdf");
  const normal = fixtureBytes("normal-text.pdf");
  const normalResult = classifyFile({ bytes: normal, name: "普通文本.pdf", declaredType: PDF_MIME });
  assert.equal(normalResult.ok, true, `${JSON.stringify(normalResult)}`);
  const result = classifyFile({ bytes: encrypted, name: "加密.pdf", declaredType: PDF_MIME });
  assert.equal(result.ok, false);
  assert.equal(result.code, "UNSUPPORTED_MEDIA");
  assert.match(result.message, /加密/);
  for (const bytes of [
    new TextEncoder().encode(`%PDF-1.7\n<< /Type /Catalog /Encrypt 4 0 R >>\ntrailer\n<< /Root 1 0 R >>\nstartxref\n0\n%%EOF\n`),
    new TextEncoder().encode(`%PDF-1.7\n<< /Type /ObjStm /Encr#79pt 4 0 R >>\nstream\nendstream\n%%EOF\n`),
  ]) {
    const result = classifyFile({ bytes, name: "xref加密.pdf", declaredType: PDF_MIME });
    assert.equal(result.ok, false);
    assert.equal(result.code, "UNSUPPORTED_MEDIA");
  }

  const { backend, repository } = await seedMatter();
  const outcomes = await ingestFiles(
    repository,
    ACTOR_A,
    MATTER_ID,
    [fileFrom(encrypted, "加密.pdf", PDF_MIME), fileFrom(normal, "普通文本.pdf", PDF_MIME)],
    ingestOptions(),
  );
  assert.deepEqual(outcomes.map((outcome) => outcome.status), ["rejected", "saved"]);
  assert.equal(outcomes[0].code, "UNSUPPORTED_MEDIA");
  const loaded = await assetsOf(repository);
  assert.equal(loaded.version, 2);
  assert.equal(loaded.data.assets.length, 1);
  assert.equal(loaded.data.assets[0].originalName, "普通文本.pdf");
  assert.equal(backend.store(STORES.blobs).size, 1);
});

test("V6-10-A03 an encrypted PDF leaves a fresh matter at version 1 with no asset or blob", async () => {
  const { backend, repository } = await seedMatter();
  const outcomes = await ingestFiles(
    repository,
    ACTOR_A,
    MATTER_ID,
    [fileFrom(fixtureBytes("encrypted.pdf"), "加密.pdf", PDF_MIME)],
    ingestOptions(),
  );
  assert.equal(outcomes[0].status, "rejected");
  assert.equal(outcomes[0].code, "UNSUPPORTED_MEDIA");
  const loaded = await assetsOf(repository);
  assert.equal(loaded.version, 1);
  assert.equal(loaded.data.assets.length, 0);
  assert.equal(backend.store(STORES.blobs).size, 0);
});

test("V6-10-A02 content-type mappings refuse encoded macros and decoys before storage", async () => {
  const normal = "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml";
  const main = `<Override PartName="/word/document.xml" ContentType="${normal}"/>`;
  const macro = '<Override PartName="/word/document.xml" ContentType="application/vnd.ms-word.docu&#109;ent.macro&#69;nabled.main+xml"/>';
  const types = (...parts) => `<Types>${parts.join("")}</Types>`;
  const fixtures = [
    types(`<!-- ${main} -->`, macro),
    types(main.replace('/word/document.xml', '/word/other.xml'), macro),
    types(main, '<Override PartName="/word/data1.bin" ContentType="application/vnd.ms-office.vba&#x50;roject"/>'),
    types(main, '<Default Extension="bin" ContentType="application/vnd.ms-office.vba&#68;ata"/>'),
    types(main, '<Default Extension="bin" ContentType="application/vnd.ms-office.active&#88;"/>'),
    types(`<!-- ${main} -->`),
    types(`<![CDATA[${main}]]>`),
    types(`<?decoy ${main} ?>`),
    types(main.replace(normal, 'application/xml'), main.replace('/word/document.xml', '/word/other.xml')),
    types(main, main),
    '<!DOCTYPE Types>' + types(main),
    utf16Bytes(types(`<!-- ${main} -->`, macro)),
  ];
  const { backend, repository } = await seedMatter();
  const files = fixtures.map((contentTypes, index) => fileFrom(makeDocx({ contentTypes }), `macro-${index}.docx`, DOCX_MIME));
  const outcomes = await ingestFiles(repository, ACTOR_A, MATTER_ID, files, ingestOptions());
  for (const [index, result] of outcomes.entries()) {
    assert.equal(result.status, 'rejected', `fixture ${index}`);
    assert.equal(result.code, 'UNSUPPORTED_MEDIA', `fixture ${index}`);
  }
  const loaded = await assetsOf(repository);
  assert.equal(loaded.version, 1);
  assert.equal(loaded.data.assets.length, 0);
  assert.equal(backend.store(STORES.blobs).size, 0);
});

test("V6-10-A02 normal content types accept BOM encodings, Unicode names and text decoys", () => {
  for (const contentTypes of [CONTENT_TYPES, utf16Bytes(CONTENT_TYPES), utf16Bytes(CONTENT_TYPES, false),
    CONTENT_TYPES.replace('/word/document.xml', '/WORD/docum&#101;nt.xml').replaceAll('Override', 'é:Override').replace('<Types ', '<Types xmlns:é="urn:test" '),
    CONTENT_TYPES.replace('</Types>', '<!-- <Override ContentType="vbaProject"/> --><![CDATA[<Default ContentType="activeX"/>]]><?decoy <Default ContentType="vbaData"/> ?></Types>')]) {
    assert.equal(classifyFile({ bytes: makeDocx({ contentTypes }), name: 'normal.docx', declaredType: DOCX_MIME }).ok, true);
  }
  for (const contentTypes of [Buffer.from([0x3c, 0xc3, 0x28]), CONTENT_TYPES + '\u0000']) {
    const result = classifyFile({ bytes: makeDocx({ contentTypes }), name: 'invalid.docx', declaredType: DOCX_MIME });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'INVALID_INPUT');
  }
});

test("V6-10-A02 decoded VBA relationship types refuse benign part names", () => {
  for (const type of ['http://schemas.microsoft.com/office/2006/relationships/vbaProject', 'urn:example/vba&#80;roject', 'urn:example/wordVba&#68;ata']) {
    const rels = relationshipsXml(`<é:Relationship xmlns:é="urn:test" Id="r1" Type="${type}" Target="data1.bin"/>`);
    const bytes = makeDocx({ extra: [zipRecord('word/_rels/document.xml.rels', Buffer.from(rels)), zipRecord('word/data1.bin', compoundFile())] });
    const result = classifyFile({ bytes, name: 'macro.docx', declaredType: DOCX_MIME });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'UNSUPPORTED_MEDIA');
  }
  const decoy = '<Relationship Type="urn:vbaProject" Target="https://example.invalid"/>';
  const rels = rootRels().replace('</Relationships>', `<!-- ${decoy} --><![CDATA[${decoy}]]><?decoy ${decoy} ?></Relationships>`);
  assert.equal(classifyFile({ bytes: makeDocx({ rels }), name: 'normal.docx', declaredType: DOCX_MIME }).ok, true);
});

// ---------------------------------------------------------------------------
// A01 — save and read back byte-identical bytes
// ---------------------------------------------------------------------------

test("V6-10-A01 a valid DOCX is saved with its bytes and survives a refresh", async () => {
  const { backend, repository } = await seedMatter();
  const file = fileFrom(DOCX, "合成说明书.docx", DOCX_MIME);
  const sha = await sha256Hex(DOCX);

  const outcomes = await ingestFiles(repository, ACTOR_A, MATTER_ID, [file], ingestOptions());
  assert.equal(outcomes.length, 1);
  assert.equal(outcomes[0].status, "saved");
  assert.equal(outcomes[0].sha256, sha);
  assert.equal(outcomes[0].byteLength, DOCX.byteLength);
  assert.equal(outcomes[0].kind, "docx");

  const loaded = await assetsOf(repository);
  matterSchema.parse(loaded.data.matter);
  assert.equal(loaded.version, 2);
  assert.equal(loaded.data.assets.length, 1);
  const asset = loaded.data.assets[0];
  assetSchema.parse(asset);
  assert.equal(asset.purpose, "source");
  assert.equal(asset.state, "available");
  assert.equal(asset.mime, DOCX_MIME);
  assert.equal(asset.originalName, "合成说明书.docx");
  assert.equal(asset.sha256, sha);
  assert.equal(asset.byteLength, DOCX.byteLength);
  assert.equal(asset.matterId, MATTER_ID);
  assert.equal(asset.serviceOrderId, null);
  // This ticket creates an Asset, not a Source: the parse pipeline is later.
  assert.equal(loaded.data.matter.sourceVersion, 1);

  // Refresh: a new repository over the same stored bytes is what a reload has.
  const refreshed = openLocalRepository(backend);
  const afterReload = await assetsOf(refreshed);
  assert.equal(afterReload.data.assets.length, 1);
  assert.equal(afterReload.data.assets[0].id, asset.id);
  const read = await refreshed.readBlob(ACTOR_A, asset.id);
  assert.equal(read.ok, true, read.ok ? "" : JSON.stringify(read.error));
  assert.deepEqual(Buffer.from(read.data.data.bytes), Buffer.from(DOCX));
  assert.equal(await sha256Hex(read.data.data.bytes), sha);

  // No activity event is invented for this ticket's asset write.
  const events = await refreshed.listEvents(ACTOR_A, MATTER_ID);
  assert.equal(events.ok, true);
  assert.equal(events.data.items.length, 0);
});

test("V6-10-S02 accepts every whitelisted format from its own bytes", async () => {
  const { backend, repository } = await seedMatter();
  const files = [
    fileFrom(makePdf(), "说明书.pdf", PDF_MIME),
    fileFrom(DOCX, "权利要求.docx", DOCX_MIME),
    fileFrom(new TextEncoder().encode("V6-10 合成文本。\n"), "摘要.txt", TEXT_MIME),
    fileFrom(new TextEncoder().encode("# V6-10 合成标题\n"), "笔记.md", MD_MIME),
    fileFrom(makePng({ seed: 5 }), "附图.png", PNG_MIME),
    fileFrom(makeJpeg({ seed: 6 }), "照片.jpg", JPEG_MIME),
  ];
  const outcomes = await ingestFiles(repository, ACTOR_A, MATTER_ID, files, ingestOptions());
  assert.deepEqual(
    outcomes.map((outcome) => [outcome.status, outcome.kind]),
    [
      ["saved", "pdf"],
      ["saved", "docx"],
      ["saved", "txt"],
      ["saved", "md"],
      ["saved", "png"],
      ["saved", "jpeg"],
    ],
  );
  const loaded = await assetsOf(repository);
  assert.equal(loaded.data.assets.length, 6);
  assert.equal(loaded.version, 7);
  const byName = new Map(loaded.data.assets.map((asset) => [asset.originalName, asset]));
  assert.equal(byName.get("说明书.pdf").mime, PDF_MIME);
  assert.equal(byName.get("权利要求.docx").mime, DOCX_MIME);
  assert.equal(byName.get("摘要.txt").mime, TEXT_MIME);
  assert.equal(byName.get("笔记.md").mime, MD_MIME);
  assert.equal(byName.get("附图.png").mime, PNG_MIME);
  assert.equal(byName.get("照片.jpg").mime, JPEG_MIME);

  const refreshed = openLocalRepository(backend);
  for (const asset of loaded.data.assets) {
    const read = await refreshed.readBlob(ACTOR_A, asset.id);
    assert.equal(read.ok, true);
    assert.equal(await sha256Hex(read.data.data.bytes), asset.sha256);
  }
});

test("V6-10-S02-A01 a 49 MiB PDF is saved while a 51 MiB PDF in the same batch is FILE_TOO_LARGE", async () => {
  const { repository } = await seedMatter();
  const big = makeLargePdf(49 * 1024 * 1024);
  const sha = await sha256Hex(big);
  const outcomes = await ingestFiles(
    repository,
    ACTOR_A,
    MATTER_ID,
    [
      fileFrom(big, "49MiB.pdf", PDF_MIME),
      new ReportedSizeBlob("51MiB.pdf", 51 * 1024 * 1024, PDF_MIME),
    ],
    ingestOptions(),
  );
  assert.equal(outcomes[0].status, "saved");
  assert.equal(outcomes[0].sha256, sha);
  assert.equal(outcomes[0].byteLength, big.byteLength);
  assert.equal(outcomes[1].status, "rejected");
  assert.equal(outcomes[1].code, "FILE_TOO_LARGE");
  assert.match(outcomes[1].message, /50 MiB/);

  const loaded = await assetsOf(repository);
  assert.equal(loaded.data.assets.length, 1, "the oversize file must not disturb the saved one");
  assert.equal(loaded.data.assets[0].byteLength, big.byteLength);
  const read = await repository.readBlob(ACTOR_A, loaded.data.assets[0].id);
  assert.equal(read.ok, true);
  assert.equal(read.data.data.bytes.byteLength, big.byteLength);
  assert.equal(Buffer.from(read.data.data.bytes.subarray(0, 8)).toString("latin1"), "%PDF-1.4");
  assert.equal(await sha256Hex(read.data.data.bytes), sha);
});

test("V6-10-S02 the bytes decide the format, never the extension or declared type", () => {
  const png = makePng({ seed: 9 });
  const mismatched = classifyFile({ bytes: png, name: "报告.pdf", declaredType: PDF_MIME });
  assert.equal(mismatched.ok, false);
  assert.equal(mismatched.code, "MIME_MISMATCH");

  const textAsDocx = classifyFile({
    bytes: new TextEncoder().encode("只是文本"),
    name: "权利要求.docx",
    declaredType: DOCX_MIME,
  });
  assert.equal(textAsDocx.ok, false);
  assert.equal(textAsDocx.code, "MIME_MISMATCH");

  const pdfAsTxt = classifyFile({ bytes: makePdf(), name: "摘要.txt", declaredType: TEXT_MIME });
  assert.equal(pdfAsTxt.ok, false);
  assert.equal(pdfAsTxt.code, "MIME_MISMATCH");

  const jpegAsPng = classifyFile({ bytes: makeJpeg(), name: "图.png", declaredType: PNG_MIME });
  assert.equal(jpegAsPng.ok, false);
  assert.equal(jpegAsPng.code, "MIME_MISMATCH");

  const executable = classifyFile({ bytes: new TextEncoder().encode("MZ fake binary"), name: "setup.exe" });
  assert.equal(executable.ok, false);
  assert.equal(executable.code, "UNSUPPORTED_MEDIA");

  const empty = classifyFile({ bytes: new Uint8Array(), name: "空.txt" });
  assert.equal(empty.ok, false);
  assert.equal(empty.code, "INVALID_INPUT");

  const accepted = classifyFile({ bytes: DOCX, name: "合成.docx", declaredType: DOCX_MIME });
  assert.equal(accepted.ok, true);
  assert.equal(accepted.kind, "docx");

  // Browsers report a downloaded file it does not recognise as
  // `application/octet-stream`; that is not a claim about the format, so the
  // real bytes decide and the stored MIME comes from the sniffed kind.
  const neutralPdf = classifyFile({ bytes: makePdf(), name: "下载.pdf", declaredType: "application/octet-stream" });
  assert.equal(neutralPdf.ok, true);
  assert.equal(neutralPdf.mime, PDF_MIME);
  const neutralDocx = classifyFile({
    bytes: DOCX,
    name: "下载.docx",
    declaredType: "binary/octet-stream; charset=binary",
  });
  assert.equal(neutralDocx.ok, true);
  assert.equal(neutralDocx.kind, "docx");
});

test("V6-10-S02 the DOCX archive budget refuses too many entries and an over-cap declared size", async () => {
  const manyEntries = makeDocx({
    extra: Array.from({ length: DOCX_MAX_ENTRIES - 2 }, (_, index) =>
      zipRecord(`word/part-${index}.xml`, Buffer.from(`<x i="${index}"/>`), { method: 0 }),
    ),
  });
  const tooMany = classifyFile({ bytes: manyEntries, name: "条目过多.docx", declaredType: DOCX_MIME });
  assert.equal(tooMany.ok, false);
  assert.equal(tooMany.code, "FILE_TOO_LARGE");
  assert.match(tooMany.message, /条目/);

  const overCap = makeDocx({
    extra: [zipRecord("word/huge.bin", Buffer.from("tiny"), { declaredUncompressed: DOCX_MAX_INFLATED_BYTES + 1 })],
  });
  const declared = classifyFile({ bytes: overCap, name: "声明超限.docx", declaredType: DOCX_MIME });
  assert.equal(declared.ok, false);
  assert.equal(declared.code, "FILE_TOO_LARGE");
  assert.match(declared.message, /200 MiB/);

  const { repository } = await seedMatter();
  const outcomes = await ingestFiles(
    repository,
    ACTOR_A,
    MATTER_ID,
    [fileFrom(manyEntries, "条目过多.docx", DOCX_MIME), fileFrom(overCap, "声明超限.docx", DOCX_MIME)],
    ingestOptions(),
  );
  assert.deepEqual(
    outcomes.map((outcome) => [outcome.status, outcome.code]),
    [
      ["rejected", "FILE_TOO_LARGE"],
      ["rejected", "FILE_TOO_LARGE"],
    ],
  );
  const loaded = await assetsOf(repository);
  assert.equal(loaded.data.assets.length, 0, "a refused DOCX leaves no asset");
  assert.equal(loaded.version, 1, "a refused DOCX commits nothing");
});

test("V6-10-S02 a real 16 MiB deflate stream inflates in linear time", () => {
  // Regression: ensureCapacity used to allocate exactly `needed` bytes on
  // every literal/match, making a 4 MiB zeros stream take seconds and a
  // 16 MiB one most of a minute. Real zlib streams, best of three runs, and
  // limits that only a geometric (O(n) copy) growth can meet.
  const bestOf = (size) => {
    const input = new Uint8Array(deflateRawSync(Buffer.alloc(size)));
    const expected = Buffer.alloc(size);
    let best = Infinity;
    for (let run = 0; run < 3; run += 1) {
      const start = process.hrtime.bigint();
      const output = inflateRaw(input, DOCX_MAX_INFLATED_BYTES);
      const elapsed = Number(process.hrtime.bigint() - start) / 1e6;
      assert.equal(output.byteLength, size);
      assert.equal(Buffer.compare(output, expected), 0, `${size} bytes must inflate exactly`);
      best = Math.min(best, elapsed);
    }
    return best;
  };

  const oneMiB = bestOf(1 * 1024 * 1024);
  const fourMiB = bestOf(4 * 1024 * 1024);
  const sixteenMiB = bestOf(16 * 1024 * 1024);
  assert.ok(oneMiB < 1000, `1 MiB took ${oneMiB.toFixed(0)} ms (limit 1000 ms)`);
  assert.ok(sixteenMiB < 3000, `16 MiB took ${sixteenMiB.toFixed(0)} ms (limit 3000 ms)`);
  const ratio = sixteenMiB / Math.max(fourMiB, 0.5);
  assert.ok(ratio < 8, `16 MiB / 4 MiB ratio ${ratio.toFixed(1)}x stays below the quadratic ~16x`);
});

test("V6-10-A02 many tiny deflated parts retain no 64 KiB backing buffer each", () => {
  // Regression: inflateRaw started every stream with a 64 KiB buffer, returned
  // a subarray, and every inflated part was retained. A standards-valid DOCX
  // with thousands of ~10-byte members therefore held ~64 KiB of arrayBuffers
  // per member (2,000 entries grew by ~125 MiB; 10,000 by ~780 MiB).
  const extra = Array.from({ length: 2_000 }, (_, index) =>
    zipRecord(`word/tiny-${index}.xml`, Buffer.from(`<t i="${index}"/>`)),
  );
  const bytes = makeDocx({ extra });

  const before = process.memoryUsage().arrayBuffers;
  const result = classifyFile({ bytes, name: "tiny-parts.docx", declaredType: DOCX_MIME });
  const delta = process.memoryUsage().arrayBuffers - before;
  assert.equal(result.ok, true);
  assert.ok(
    delta < 64 * 1024 * 1024,
    `2,000 tiny parts grew arrayBuffers by ${(delta / 1048576).toFixed(1)} MiB (limit 64 MiB)`,
  );

  // A small, ordinary package must stay small too.
  const smallBefore = process.memoryUsage().arrayBuffers;
  const small = classifyFile({ bytes: makeDocx(), name: "small.docx", declaredType: DOCX_MIME });
  const smallDelta = process.memoryUsage().arrayBuffers - smallBefore;
  assert.equal(small.ok, true);
  assert.ok(
    smallDelta < 8 * 1024 * 1024,
    `a normal DOCX grew arrayBuffers by ${(smallDelta / 1048576).toFixed(1)} MiB`,
  );
});

test("V6-10-A02 remote or absolute relationships are refused in every .rels part", () => {
  const remote = [
    ["single-quoted External", `<Relationship Id='rId1' Type='x' Target='word/document.xml' TargetMode = 'External'/>`],
    ["entity-encoded External", `<Relationship Id="rId1" Type="x" Target="word/document.xml" TargetMode="&amp;#69;xternal"/>`],
    ["entity-encoded scheme", `<Relationship Id="rId1" Type="x" Target="https&amp;#58;//evil.invalid/document.xml"/>`],
    ["uppercase TargetMode", `<Relationship Id="rId1" Type="x" Target="word/document.xml" TARGETMODE="EXTERNAL"/>`],
    [
      "entity-encoded quotes around External",
      `<Relationship Id="rId1" Type="x" Target="word/document.xml" TargetMode=&quot;External&quot;/>`,
    ],
    ["file scheme", `<Relationship Id="rId1" Type="x" Target="file:///etc/passwd"/>`],
    ["protocol-relative target", `<Relationship Id="rId1" Type="x" Target="//host/share/document.xml"/>`],
  ];
  for (const [label, element] of remote) {
    const result = classifyFile({
      bytes: makeDocx({ rels: relationshipsXml(element) }),
      name: "远程关系.docx",
      declaredType: DOCX_MIME,
    });
    assert.equal(result.ok, false, label);
    assert.equal(result.code, "UNSUPPORTED_MEDIA", label);
    assert.match(result.message, /远程关系/, label);
  }

  // Every part whose name ends in .rels is scanned, not just the package root.
  const child = makeDocx({
    extra: [
      zipRecord(
        "word/_rels/document.xml.rels",
        Buffer.from(
          relationshipsXml(
            `<Relationship Id="rId9" Type="x" Target="https://evil.invalid/document.xml" TargetMode="External"/>`,
          ),
        ),
      ),
    ],
  });
  const childResult = classifyFile({ bytes: child, name: "子部件关系.docx", declaredType: DOCX_MIME });
  assert.equal(childResult.ok, false, "a child part's .rels is scanned");
  assert.equal(childResult.code, "UNSUPPORTED_MEDIA");

  // The tolerant parser still accepts an ordinary internal relationship.
  const internal = classifyFile({
    bytes: makeDocx({
      rels: relationshipsXml(`<Relationship Id='rId1' Type='x' Target='word/document.xml' TargetMode='Internal'/>`),
    }),
    name: "内部关系.docx",
    declaredType: DOCX_MIME,
  });
  assert.equal(internal.ok, true, "a normal internal relative relationship is accepted");
});

test("V6-10-A02 standards-valid .rels encodings and prefixes cannot hide an external relationship", () => {
  const utf16External =
    '<?xml version="1.0" encoding="UTF-16"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="x" Target="word/document.xml" TargetMode="External"/></Relationships>';
  // e + U+0301: one XML name, decomposed, so a prefix match must allow marks.
  const decomposed = "é";
  const bypasses = [
    ["UTF-16LE with BOM", utf16Bytes(utf16External, true)],
    ["UTF-16BE with BOM", utf16Bytes(utf16External, false)],
    [
      "Unicode namespace prefix",
      Buffer.from(
        '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns:é="http://schemas.openxmlformats.org/package/2006/relationships"><é:Relationship Id="rId1" Type="x" Target="https://evil.invalid/document.xml" TargetMode="External"/></Relationships>',
      ),
    ],
    [
      "decomposed namespace prefix",
      Buffer.from(
        `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns:${decomposed}="http://schemas.openxmlformats.org/package/2006/relationships"><${decomposed}:Relationship Id="rId1" Type="x" Target="https://evil.invalid/document.xml" TargetMode="External"/></Relationships>`,
      ),
    ],
    [
      "DOCTYPE entity",
      Buffer.from(
        '<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE Relationships [<!ENTITY ext "External">]><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="x" Target="word/document.xml" TargetMode="&ext;"/></Relationships>',
      ),
    ],
    [
      "prefixed TargetMode attribute",
      Buffer.from(
        relationshipsXml(
          `<Relationship xmlns:r="urn:example" Id="rId1" Type="x" Target="word/document.xml" r:TargetMode="External"/>`,
        ),
      ),
    ],
    [
      "traversal target",
      Buffer.from(relationshipsXml(`<Relationship Id="rId1" Type="x" Target="../word/document.xml"/>`)),
    ],
    [
      "backslash UNC target",
      Buffer.from(relationshipsXml(`<Relationship Id="rId1" Type="x" Target="\\\\host\\share\\document.xml"/>`)),
    ],
  ];
  for (const [label, rels] of bypasses) {
    const result = classifyFile({
      bytes: makeDocx({ rels }),
      name: "编码关系.docx",
      declaredType: DOCX_MIME,
    });
    assert.equal(result.ok, false, label);
    assert.equal(result.code, "UNSUPPORTED_MEDIA", label);
  }

  // UTF-16 decoding is real, not a blanket refusal: an internal relative
  // relationship in either byte order is still accepted.
  const utf16Internal =
    '<?xml version="1.0" encoding="UTF-16"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="x" Target="word/document.xml" TargetMode="Internal"/></Relationships>';
  for (const littleEndian of [true, false]) {
    const accepted = classifyFile({
      bytes: makeDocx({ rels: utf16Bytes(utf16Internal, littleEndian) }),
      name: `UTF16${littleEndian ? "LE" : "BE"}内部.docx`,
      declaredType: DOCX_MIME,
    });
    assert.equal(accepted.ok, true, `a UTF-16${littleEndian ? "LE" : "BE"} internal relationship is decoded and accepted`);
  }

  // A .rels part that is not valid in its implied encoding is refused rather
  // than silently misread by a lossy decode.
  const invalid = classifyFile({
    bytes: makeDocx({ rels: Buffer.from([0x3c, 0x52, 0xc3, 0x28, 0x3e]) }),
    name: "坏编码.docx",
    declaredType: DOCX_MIME,
  });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.code, "INVALID_INPUT");
});

test("V6-10-A02 NUL, drive-letter and Unix symlink entries are refused", () => {
  const refused = [
    ["NUL entry name", makeDocx({ extra: [zipRecord("word/evil\u0000.xml", Buffer.from("<x/>"))] })],
    ["drive-letter path", makeDocx({ extra: [zipRecord("C:/evil.xml", Buffer.from("<x/>"))] })],
    [
      "Unix symlink",
      makeDocx({
        extra: [
          zipRecord("word/link.xml", Buffer.from("../document.xml"), {
            method: 0,
            versionMadeBy: (3 << 8) | 20,
            externalAttrs: 0xa0000000,
          }),
        ],
      }),
    ],
  ];
  for (const [label, bytes] of refused) {
    const result = classifyFile({ bytes, name: "路径.docx", declaredType: DOCX_MIME });
    assert.equal(result.ok, false, label);
    assert.equal(result.code, "UNSUPPORTED_MEDIA", label);
  }

  // A regular Unix-mode file entry is not a symlink and stays acceptable.
  const regular = makeDocx({
    extra: [
      zipRecord("word/data.bin", Buffer.from("data"), {
        method: 0,
        versionMadeBy: (3 << 8) | 20,
        externalAttrs: (0o100644 << 16) >>> 0,
      }),
    ],
  });
  const accepted = classifyFile({ bytes: regular, name: "普通条目.docx", declaredType: DOCX_MIME });
  assert.equal(accepted.ok, true, "a regular Unix entry is not refused as a symlink");
});

test("V6-10-A02 an OLE compound file declared .docx reports encryption, not a mismatch", () => {
  const bytes = compoundFile();
  const result = classifyFile({ bytes, name: "加密.docx", declaredType: DOCX_MIME });
  assert.equal(result.ok, false);
  assert.equal(result.code, "UNSUPPORTED_MEDIA");
  assert.match(result.message, /加密/);
  assert.match(result.message, /密码/);

  // The extension alone is enough to identify the encrypted wrapper.
  const byExtension = classifyFile({ bytes, name: "加密.docx" });
  assert.equal(byExtension.ok, false);
  assert.equal(byExtension.code, "UNSUPPORTED_MEDIA");

  // Other names still go through the ordinary content checks.
  const asPdf = classifyFile({ bytes, name: "旧文档.pdf", declaredType: PDF_MIME });
  assert.equal(asPdf.ok, false);
  assert.equal(asPdf.code, "MIME_MISMATCH");
});

test("V6-10 stores a display name without a path and without control characters", async () => {
  const { repository } = await seedMatter();
  const outcomes = await ingestFiles(
    repository,
    ACTOR_A,
    MATTER_ID,
    [fileFrom(makePdf(), "C:\\用户\\合成\\权利要求\u0000.pdf", PDF_MIME)],
    ingestOptions(),
  );
  assert.equal(outcomes[0].status, "saved");
  const loaded = await assetsOf(repository);
  assert.equal(loaded.data.assets[0].originalName, "权利要求.pdf");
});

// ---------------------------------------------------------------------------
// A02 — hostile input leaves no usable material
// ---------------------------------------------------------------------------

test("V6-10-A02 oversize, fake-extension and hostile DOCX files leave nothing usable", async () => {
  const { backend, repository } = await seedMatter();
  const hugeImage = Buffer.alloc(IMAGE_MAX_BYTES + 1);
  Buffer.from(pngSignature).copy(hugeImage, 0);
  const cases = [
    ["超过 50 MiB 的文档", new ReportedSizeBlob("大文件.pdf", DOCUMENT_MAX_BYTES + 1, PDF_MIME), "FILE_TOO_LARGE"],
    ["超过 8 MiB 的图片", fileFrom(hugeImage, "大图.png", PNG_MIME), "IMAGE_TOO_LARGE"],
    ["超过 16 MP 的图片", fileFrom(makeOversizePng(), "超清.png", PNG_MIME), "IMAGE_TOO_LARGE"],
    ["改名的 PNG", fileFrom(makePng({ seed: 11 }), "报告.pdf", PDF_MIME), "MIME_MISMATCH"],
    ["改名成 PDF 的 ZIP", fileFrom(makeZip([zipRecord("word/document.xml", Buffer.from("<x/>"))]), "伪装.pdf", PDF_MIME), "MIME_MISMATCH"],
    ["改名的文本", fileFrom(new TextEncoder().encode("V6-10 伪装文本"), "权利要求.docx", DOCX_MIME), "MIME_MISMATCH"],
    ["含宏的 DOCX", fileFrom(makeDocx({ extra: [zipRecord("word/vbaProject.bin", Buffer.from([0]))] }), "宏.docx", DOCX_MIME), "UNSUPPORTED_MEDIA"],
    ["含远程关系的 DOCX", fileFrom(makeDocx({ rels: rootRels({ external: true }) }), "远程.docx", DOCX_MIME), "UNSUPPORTED_MEDIA"],
    ["路径穿越的 DOCX", fileFrom(makeDocx({ extra: [zipRecord("../evil.xml", Buffer.from("<x/>"))] }), "穿越.docx", DOCX_MIME), "UNSUPPORTED_MEDIA"],
    ["加密的 DOCX", fileFrom(makeDocx({ extra: [zipRecord("word/secret.xml", Buffer.from("<x/>"), { flags: 1 })] }), "加密.docx", DOCX_MIME), "UNSUPPORTED_MEDIA"],
    ["压缩炸弹 DOCX", fileFrom(makeDocx({ extra: [zipRecord("word/bomb.bin", Buffer.alloc(2 * 1024 * 1024))] }), "炸弹.docx", DOCX_MIME), "FILE_TOO_LARGE"],
    ["非 DOCX 的 ZIP", fileFrom(makeZip([zipRecord("hello.txt", Buffer.from("hello"))]), "假.docx", DOCX_MIME), "UNSUPPORTED_MEDIA"],
    ["非 UTF-8 文本", fileFrom(new Uint8Array([0xc3, 0x28, 0x0a]), "坏文本.txt", TEXT_MIME), "INVALID_INPUT"],
    ["损坏的 PDF", fileFrom(new TextEncoder().encode("%PDF-1.4\n没有结束标记"), "损坏.pdf", PDF_MIME), "INVALID_INPUT"],
    ["未知类型", fileFrom(new TextEncoder().encode("MZ fake binary"), "安装程序.exe"), "UNSUPPORTED_MEDIA"],
  ];
  assert.ok(DOCX_MAX_ENTRIES >= 10_000);

  const files = cases.map(([, file]) => file);
  const outcomes = await ingestFiles(repository, ACTOR_A, MATTER_ID, files, ingestOptions());
  assert.equal(outcomes.length, cases.length);
  cases.forEach(([label, , expected], index) => {
    const outcome = outcomes[index];
    assert.equal(outcome.status, "rejected", `${label} must be rejected`);
    assert.equal(outcome.code, expected, `${label} expected ${expected}, got ${outcome.code}`);
    assert.ok(CONTRACT_CODES.has(outcome.code), `${outcome.code} must be in 05-contracts §10`);
  });

  const loaded = await assetsOf(repository);
  assert.equal(loaded.version, 1, "no commit may happen for rejected files");
  assert.equal(loaded.data.assets.length, 0);
  assert.equal(loaded.data.matter.sourceVersion, 1, "no Source record may be created");
  assert.equal(backend.data.get(STORES.blobs).size, 0, "no bytes may be stored for rejected files");

  // A repeated pick of the same rejected material changes nothing.
  const repeated = await ingestFiles(repository, ACTOR_A, MATTER_ID, files, ingestOptions());
  assert.deepEqual(
    repeated.map((outcome) => outcome.code),
    cases.map(([, , expected]) => expected),
  );
  const afterRepeat = await assetsOf(repository);
  assert.equal(afterRepeat.version, 1);
  assert.equal(afterRepeat.data.assets.length, 0);
});

test("V6-10-A02 repeated picks of the same bytes create one asset, even in parallel", async () => {
  const first = await seedMatter();
  const file = fileFrom(makePdf(), "同一份.pdf", PDF_MIME);
  const saved = await ingestFiles(first.repository, ACTOR_A, MATTER_ID, [file], ingestOptions());
  assert.equal(saved[0].status, "saved");

  const again = await ingestFiles(
    first.repository,
    ACTOR_A,
    MATTER_ID,
    [fileFrom(makePdf(), "换了名字.pdf", PDF_MIME)],
    ingestOptions(),
  );
  assert.equal(again[0].status, "duplicate");
  assert.equal(again[0].assetId, saved[0].assetId);
  const afterRetry = await assetsOf(first.repository);
  assert.equal(afterRetry.data.assets.length, 1);
  assert.equal(afterRetry.version, 2);

  // Two identical picks inside one batch: the commit lock serializes them, and
  // the second sees the first's asset before writing anything.
  const parallel = await seedMatter();
  const outcomes = await ingestFiles(
    parallel.repository,
    ACTOR_A,
    MATTER_ID,
    [fileFrom(makePdf(), "a.pdf", PDF_MIME), fileFrom(makePdf(), "b.pdf", PDF_MIME)],
    ingestOptions(),
  );
  assert.deepEqual(outcomes.map((outcome) => outcome.status).sort(), ["duplicate", "saved"]);
  const afterParallel = await assetsOf(parallel.repository);
  assert.equal(afterParallel.data.assets.length, 1);
  assert.equal(afterParallel.version, 2);
});

// ---------------------------------------------------------------------------
// A03 — refresh and retry match the persisted state
// ---------------------------------------------------------------------------

test("V6-10-A03 a retry after success keeps one asset at one version", async () => {
  const { repository } = await seedMatter();
  const pdf = makePdf();
  const first = await ingestFiles(
    repository,
    ACTOR_A,
    MATTER_ID,
    [fileFrom(pdf, "内容.pdf", PDF_MIME)],
    ingestOptions(),
  );
  assert.equal(first[0].status, "saved");
  const before = await assetsOf(repository);
  const assetId = before.data.assets[0].id;

  const retry = await ingestFiles(
    repository,
    ACTOR_A,
    MATTER_ID,
    [fileFrom(pdf, "内容.pdf", PDF_MIME)],
    ingestOptions(),
  );
  assert.equal(retry[0].status, "duplicate");
  assert.equal(retry[0].assetId, assetId);
  const after = await assetsOf(repository);
  assert.equal(after.data.assets.length, 1);
  assert.equal(after.data.assets[0].id, assetId);
  assert.equal(after.version, 2);
  assert.equal(after.data.matter.updatedAt, T0);
  const read = await repository.readBlob(ACTOR_A, assetId);
  assert.equal(read.ok, true);
  assert.deepEqual(Buffer.from(read.data.data.bytes), Buffer.from(pdf));
});

test("V6-10-A03 a storage failure mid-write leaves neither metadata nor bytes", async () => {
  const { backend, repository } = await seedMatter();
  backend.setPutFault(({ store }) => (store === STORES.blobs ? new Error("simulated disk failure") : null));

  const outcomes = await ingestFiles(
    repository,
    ACTOR_A,
    MATTER_ID,
    [fileFrom(DOCX, "失败.docx", DOCX_MIME)],
    ingestOptions(),
  );
  assert.equal(outcomes[0].status, "failed");
  assert.equal(outcomes[0].code, "STORAGE_UNAVAILABLE");
  assert.ok(CONTRACT_CODES.has(outcomes[0].code));

  const failedState = await assetsOf(repository);
  assert.equal(failedState.version, 1);
  assert.equal(failedState.data.assets.length, 0);
  assert.equal(backend.data.get(STORES.blobs).size, 0);

  // A refresh reports the same persisted state, not the optimistic one.
  const refreshed = openLocalRepository(backend);
  const afterRefresh = await assetsOf(refreshed);
  assert.equal(afterRefresh.version, 1);
  assert.equal(afterRefresh.data.assets.length, 0);

  // Clear the fault and retry: exactly one asset, one version, real bytes.
  backend.setPutFault(null);
  const retry = await ingestFiles(
    refreshed,
    ACTOR_A,
    MATTER_ID,
    [fileFrom(DOCX, "失败.docx", DOCX_MIME)],
    ingestOptions(),
  );
  assert.equal(retry[0].status, "saved");
  const recovered = await assetsOf(refreshed);
  assert.equal(recovered.version, 2);
  assert.equal(recovered.data.assets.length, 1);
  const read = await refreshed.readBlob(ACTOR_A, recovered.data.assets[0].id);
  assert.equal(read.ok, true);
  assert.deepEqual(Buffer.from(read.data.data.bytes), Buffer.from(DOCX));
  assert.equal(backend.data.get(STORES.blobs).size, 1);
});

test("V6-10-A03 a partly failed batch keeps its successes and retries only what failed", async () => {
  const { backend, repository } = await seedMatter();
  const kept = makePdf();
  const first = await ingestFiles(
    repository,
    ACTOR_A,
    MATTER_ID,
    [fileFrom(kept, "已存.pdf", PDF_MIME)],
    ingestOptions(),
  );
  assert.equal(first[0].status, "saved");

  backend.setPutFault(({ store }) => (store === STORES.blobs ? new Error("simulated disk failure") : null));
  const second = await ingestFiles(
    repository,
    ACTOR_A,
    MATTER_ID,
    [fileFrom(kept, "已存.pdf", PDF_MIME), fileFrom(DOCX, "待存.docx", DOCX_MIME)],
    ingestOptions(),
  );
  assert.equal(second[0].status, "duplicate");
  assert.equal(second[1].status, "failed");
  const midway = await assetsOf(repository);
  assert.equal(midway.version, 2);
  assert.equal(midway.data.assets.length, 1);

  backend.setPutFault(null);
  const retry = await ingestFiles(
    repository,
    ACTOR_A,
    MATTER_ID,
    [fileFrom(DOCX, "待存.docx", DOCX_MIME)],
    ingestOptions(),
  );
  assert.equal(retry[0].status, "saved", retry[0].status === "failed" ? retry[0].code : "");
  const final = await assetsOf(repository);
  assert.equal(final.version, 3);
  assert.equal(final.data.assets.length, 2);
  for (const asset of final.data.assets) {
    const read = await repository.readBlob(ACTOR_A, asset.id);
    assert.equal(read.ok, true);
    assert.equal(await sha256Hex(read.data.data.bytes), asset.sha256);
  }
});

test("V6-10 identity and matter state gate the write", async () => {
  const active = await seedMatter();
  const foreign = await ingestFiles(
    active.repository,
    ACTOR_B,
    MATTER_ID,
    [fileFrom(makePdf(), "越权.pdf", PDF_MIME)],
    ingestOptions(),
  );
  assert.equal(foreign[0].status, "failed");
  assert.equal(foreign[0].code, "RESOURCE_NOT_FOUND");

  const archived = await seedMatter();
  const updated = await archived.repository.commit(
    ACTOR_A,
    {
      contractVersion: CONTRACT_VERSION,
      expectedVersion: 1,
      payload: createMatterWrite({ version: 2, status: "archived", updatedAt: T1 }),
    },
    { requestId: REQUEST_ID },
  );
  assert.equal(updated.ok, true, updated.ok ? "" : JSON.stringify(updated.error));
  const refused = await ingestFiles(
    archived.repository,
    ACTOR_A,
    MATTER_ID,
    [fileFrom(makePdf(), "归档.pdf", PDF_MIME)],
    ingestOptions(),
  );
  assert.equal(refused[0].status, "failed");
  assert.equal(refused[0].code, "INVALID_TRANSITION");
  const state = await assetsOf(archived.repository);
  assert.equal(state.version, 2);
  assert.equal(state.data.assets.length, 0);
});

// ---------------------------------------------------------------------------
// S02 concurrency and progress
// ---------------------------------------------------------------------------

/** A file that reports how many reads overlap while it is being read. */
class CountingBlob extends Blob {
  #name;
  #bytes;
  #tracker;
  constructor(bytes, name, tracker, type) {
    super([bytes], { type });
    this.#name = name;
    this.#bytes = new Uint8Array(bytes);
    this.#tracker = tracker;
  }
  get name() {
    return this.#name;
  }
  slice(start, end) {
    const tracker = this.#tracker;
    const bytes = this.#bytes;
    tracker.active += 1;
    tracker.max = Math.max(tracker.max, tracker.active);
    return {
      arrayBuffer: async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        tracker.active -= 1;
        tracker.reads += 1;
        return bytes.slice(start, end).buffer;
      },
    };
  }
}

test("V6-10-S02 reads at most three files at once", async () => {
  const { repository } = await seedMatter();
  const tracker = { active: 0, max: 0, reads: 0 };
  const files = Array.from({ length: 5 }, (_, index) =>
    new CountingBlob(makePng({ seed: 20 + index }), `并发-${index}.png`, tracker, PNG_MIME),
  );
  const outcomes = await ingestFiles(repository, ACTOR_A, MATTER_ID, files, ingestOptions());
  assert.deepEqual(outcomes.map((outcome) => outcome.status), Array(5).fill("saved"));
  assert.equal(tracker.max, MAX_CONCURRENT_UPLOADS);
  const loaded = await assetsOf(repository);
  assert.equal(loaded.data.assets.length, 5);
  assert.equal(new Set(loaded.data.assets.map((asset) => asset.sha256)).size, 5);
});

test("V6-10-S02 progress reports real stages and real byte counts", async () => {
  const { repository } = await seedMatter();
  const text = new Uint8Array(600 * 1024);
  text.fill(0x41);
  text[0] = 0x23; // "#"
  const events = [];
  const options = ingestOptions({ fileIds: ["row-1"], onProgress: (progress) => events.push(progress) });
  const outcomes = await ingestFiles(
    repository,
    ACTOR_A,
    MATTER_ID,
    [fileFrom(text, "长文本.md", MD_MIME)],
    options,
  );
  assert.equal(outcomes[0].status, "saved");
  assert.equal(outcomes[0].fileId, "row-1");
  const stages = events.map((event) => event.stage);
  assert.deepEqual(stages.filter((stage) => stage === "selected"), ["selected"]);
  assert.ok(stages.indexOf("selected") < stages.indexOf("uploading"));
  assert.ok(stages.indexOf("uploading") < stages.indexOf("verifying"));
  assert.ok(stages.indexOf("verifying") < stages.indexOf("saved"));
  const received = events.filter((event) => event.stage === "uploading").map((event) => event.receivedBytes);
  assert.deepEqual(received, [256 * 1024, 512 * 1024, 600 * 1024]);
  assert.ok(received.every((value, index) => index === 0 || value > received[index - 1]));
  const saved = events.at(-1);
  assert.equal(saved.stage, "saved");
  assert.equal(saved.assetId, outcomes[0].assetId);
  assert.equal(saved.totalBytes, text.byteLength);
  assert.equal(events.every((event) => event.fileId === "row-1"), true);
});

test("V6-10 a cancelled upload stores nothing and can be restarted", async () => {
  const { repository } = await seedMatter();
  const controller = new AbortController();
  controller.abort();
  const cancelled = await ingestFiles(
    repository,
    ACTOR_A,
    MATTER_ID,
    [fileFrom(makePdf(), "取消.pdf", PDF_MIME)],
    ingestOptions({ signal: controller.signal }),
  );
  assert.equal(cancelled[0].status, "cancelled");
  const state = await assetsOf(repository);
  assert.equal(state.version, 1);
  assert.equal(state.data.assets.length, 0);

  const retried = await ingestFiles(
    repository,
    ACTOR_A,
    MATTER_ID,
    [fileFrom(makePdf(), "取消.pdf", PDF_MIME)],
    ingestOptions(),
  );
  assert.equal(retried[0].status, "saved");
  const recovered = await assetsOf(repository);
  assert.equal(recovered.version, 2);
  assert.equal(recovered.data.assets.length, 1);
});

/** A file whose slice reads are slow and announce themselves, so the test can
 * abort while a real mid-batch read is in flight. */
class SlowReadBlob extends Blob {
  #name;
  #bytes;
  #onSlice;
  constructor(bytes, name, onSlice) {
    super([]);
    this.#name = name;
    this.#bytes = new Uint8Array(bytes);
    this.#onSlice = onSlice;
  }
  get name() {
    return this.#name;
  }
  get size() {
    return this.#bytes.byteLength;
  }
  get type() {
    return "";
  }
  slice(start, end) {
    const bytes = this.#bytes;
    const onSlice = this.#onSlice;
    return {
      arrayBuffer: async () => {
        await new Promise((resolve) => setTimeout(resolve, 25));
        const chunk = bytes.slice(start, end).buffer;
        // Announce a *completed* slice, so the test can abort after the first
        // real read while the rest of the batch is still in flight.
        onSlice?.();
        return chunk;
      },
    };
  }
}

test("V6-10-A03 cancelling mid-batch after the first slice stores nothing", async () => {
  const { backend, repository } = await seedMatter();
  const controller = new AbortController();
  const events = [];
  let slices = 0;
  let announceFirst;
  const firstSlice = new Promise((resolve) => {
    announceFirst = resolve;
  });
  const files = Array.from({ length: 2 }, (_, index) =>
    new SlowReadBlob(new Uint8Array(1024 * 1024), `慢慢读-${index}.pdf`, () => {
      slices += 1;
      if (slices === 1) announceFirst();
    }),
  );

  const pending = ingestFiles(
    repository,
    ACTOR_A,
    MATTER_ID,
    files,
    ingestOptions({ signal: controller.signal, onProgress: (progress) => events.push(progress) }),
  );
  await firstSlice;
  controller.abort();
  const outcomes = await pending;

  assert.ok(slices >= 1, "the batch had started reading when it was cancelled");
  assert.deepEqual(outcomes.map((outcome) => outcome.status), ["cancelled", "cancelled"]);
  const stages = events.map((event) => event.stage);
  assert.equal(stages.includes("verifying"), false, "a cancelled file is never verified");
  assert.equal(stages.includes("saved"), false, "a cancelled file is never saved");

  const state = await assetsOf(repository);
  assert.equal(state.version, 1, "cancellation commits nothing");
  assert.equal(state.data.assets.length, 0, "no asset row for a cancelled batch");
  assert.equal(backend.data.get(STORES.blobs).size, 0, "no blob for a cancelled batch");
});
