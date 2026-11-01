/**
 * V6-11 — parse progress and failure recovery (S02, 05-contracts §3 Source /
 * Chunk / SourceRef, §5 Job, C11 R1).
 *
 * Everything here goes through the module's public interface
 * (`parseSource`/`resumeParse`/`retryParse`/`abandonParse`/`readParseState`)
 * against the real `LocalRepository` over an in-memory backend, so a "refresh"
 * is a new repository over the same stored bytes — all a reloaded page has.
 * The PDF, DOCX, TXT and legacy .doc fixtures are synthesised in
 * `fixtures/generate.mjs`; no real customer material is used, nothing is sent
 * to a network and no model is called.
 *
 * Acceptance: V6-11-A01 (text PDF/DOCX/TXT produce locatable chunks, and a
 * refresh matches persisted state), V6-11-A02 (a scanned PDF ends partial with
 * ocrNeeded and OCR_UNAVAILABLE and no fake text; unsupported input fails
 * explicitly; no timer or invented success), V6-11-A03 (R1 interruption,
 * resume-from-saved-stage, abandon, and retry as a new job).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  CONTRACT_VERSION,
  STORES,
  openLocalRepository,
  sha256Hex,
} from "../../../../apps/web/src/v6/lib/repository.ts";
import { ingestFiles } from "../../../../apps/web/src/v6/features/sources/ingest.ts";
import {
  DOCUMENT_MAX_PAGES,
  LEASE_MS,
  PARSE_ERROR_MESSAGES,
  PARSE_STAGES,
  PARSER_VERSION,
  abandonParse,
  cancelParse,
  buildParseRows,
  describeParseRows,
  loadPdfPagesDefault,
  locateQuote,
  markInterrupted,
  normalizeText,
  orphanInterruptAllowed,
  parseSource,
  readChunkSet,
  readChunkSets,
  readMatterSources,
  readParseState,
  resumeParse,
  retryParse,
  splitParagraphs,
  chunkIdFor,
  sourceIdFor,
} from "../../../../apps/web/src/v6/features/sources/parse.ts";
import {
  chunkSchema,
  jobSchema,
  sourceRefSchema,
  sourceSchema,
} from "../../../../packages/contracts/src/index.ts";

import {
  TENANT_A,
  USER_A,
  MATTER_ID,
  REQUEST_ID,
  T0,
  ACTOR_A,
  MemoryBackend,
  uuidSource,
  fixture,
  fileFrom,
  createMatterWrite,
  seed,
  ingest,
  seedSourceAsset,
  parseDeps,
  stateOf,
  freshRepository,
  assertChunksValid,
  storedParseRows,
} from "./harness.mjs";

// ---------------------------------------------------------------------------
// A01 — text PDF, DOCX and TXT
// ---------------------------------------------------------------------------

test("V6-11-A01 a TXT source becomes chunks with hash, locators and deterministic ids; a refresh reads the same state", async () => {
  const { backend, repository, newIds } = await seed();
  const [asset] = (await ingest(repository, newIds, [fileFrom(fixture("plain-text.txt"), "plain-text.txt", "text/plain")])).values();
  const run = parseDeps(newIds);

  const outcome = await parseSource(repository, ACTOR_A, MATTER_ID, asset.id, run.deps);
  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  assert.equal(outcome.state, "parsed");
  assert.equal(outcome.ocrNeeded, false);
  assert.equal(outcome.pageCount, 1);
  assert.equal(outcome.chunkCount, 2);
  assert.deepEqual(outcome.savedStages, ["verify", "extract_text", "ocr_check", "chunk"]);

  const state = await stateOf(repository, asset.id);
  assert.equal(state.status, "parsed");
  assert.equal(state.source.parseStatus, "parsed");
  assert.equal(state.source.parserVersion, PARSER_VERSION);
  assert.equal(state.job.job.state, "succeeded");
  assert.equal(state.job.job.kind, "parse");
  assert.equal(state.job.job.leaseOwner, null);
  assert.deepEqual(state.checkpoints.map((item) => item.stage), ["verify", "extract_text", "ocr_check", "chunk"]);

  const sourceId = await sourceIdFor(asset.id);
  assert.equal(state.source.id, sourceId);
  const set = await readChunkSet(repository, sourceId, PARSER_VERSION);
  assert.notEqual(set, null);
  assert.deepEqual(set.chunks.map((chunk) => chunk.text), [
    "V6-11 synthetic text.",
    "第二段：文本文件按段落切分。",
  ]);
  await assertChunksValid(set.chunks);
  for (const [index, chunk] of set.chunks.entries()) {
    assert.equal(chunk.sourceId, sourceId);
    assert.equal(chunk.index, index);
    assert.equal(chunk.kind, "paragraph");
    assert.equal(chunk.page, 1);
    assert.equal(chunk.id, await chunkIdFor(sourceId, PARSER_VERSION, index));
  }

  // A SourceRef built from a chunk: half-open code-point range over NFC text.
  const target = set.chunks[1];
  const range = locateQuote(target.text, "文本文件");
  assert.notEqual(range, null);
  const ref = {
    sourceId,
    chunkId: target.id,
    chunkHash: target.hash,
    page: target.page,
    start: range.start,
    end: range.end,
    quote: "文本文件",
  };
  assert.equal(sourceRefSchema.safeParse(ref).success, true);
  assert.equal(Array.from(target.text).slice(ref.start, ref.end).join(""), ref.quote);

  // Refresh: a new repository over the same bytes sees the same rows and chunks.
  const reloaded = await freshRepository(backend);
  const again = await stateOf(reloaded, asset.id);
  assert.equal(again.status, "parsed");
  assert.equal(again.job.job.id, state.job.job.id);
  assert.deepEqual(again.source, state.source);
  const sameSet = await readChunkSet(reloaded, sourceId, PARSER_VERSION);
  assert.deepEqual(sameSet, set);
});

test("V6-11-A01 a text PDF keeps page numbers per chunk and normalises each page", async () => {
  const { repository, newIds } = await seed();
  const [asset] = (await ingest(repository, newIds, [fileFrom(fixture("text-two-pages.pdf"), "text-two-pages.pdf", "application/pdf")])).values();
  const run = parseDeps(newIds);

  const outcome = await parseSource(repository, ACTOR_A, MATTER_ID, asset.id, run.deps);
  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  assert.equal(outcome.state, "parsed");
  assert.equal(outcome.pageCount, 2);

  const sourceId = await sourceIdFor(asset.id);
  const set = await readChunkSet(repository, sourceId, PARSER_VERSION);
  assert.notEqual(set, null);
  assert.equal(set.pageCount, 2);
  assert.deepEqual(set.chunks.map((chunk) => chunk.text), [
    "V6-11 synthetic text PDF, page one.",
    "每页都有文字层，段落可定位。",
    "Second page for locators.",
    "第二页用来验证页码归属。",
  ]);
  assert.deepEqual(set.chunks.map((chunk) => chunk.page), [1, 1, 2, 2]);
  await assertChunksValid(set.chunks);
  // Page two's text really came from page two of the PDF.
  const pages = await loadPdfPagesDefault(fixture("text-two-pages.pdf"));
  assert.equal(pages.length, 2);
  assert.match(pages[1].text, /Second page for locators/);
});

test("V6-11-A01 a DOCX source is extracted through the shared reader and chunked", async () => {
  const { repository, newIds } = await seed();
  const [asset] = (await ingest(repository, newIds, [fileFrom(fixture("plain-docx.docx"), "plain-docx.docx", "")])).values();
  const run = parseDeps(newIds);

  const outcome = await parseSource(repository, ACTOR_A, MATTER_ID, asset.id, run.deps);
  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  assert.equal(outcome.state, "parsed");
  assert.equal(outcome.chunkCount, 2);

  const sourceId = await sourceIdFor(asset.id);
  const set = await readChunkSet(repository, sourceId, PARSER_VERSION);
  assert.deepEqual(set.chunks.map((chunk) => chunk.text), [
    "V6-11 synthetic DOCX.",
    "第二段：DOCX 正文会被切分为段落。",
  ]);
  assert.deepEqual(set.chunks.map((chunk) => chunk.page), [1, 1]);
  await assertChunksValid(set.chunks);
});

// ---------------------------------------------------------------------------
// A02 — scans, unsupported input, budgets, and no invented progress
// ---------------------------------------------------------------------------

test("V6-11-A02 a scanned PDF ends partial with ocrNeeded and OCR_UNAVAILABLE, and invents no text", async () => {
  const { backend, repository, newIds } = await seed();
  const [asset] = (await ingest(repository, newIds, [fileFrom(fixture("scan-no-text-layer.pdf"), "scan-no-text-layer.pdf", "application/pdf")])).values();
  const run = parseDeps(newIds);

  const outcome = await parseSource(repository, ACTOR_A, MATTER_ID, asset.id, run.deps);
  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  assert.equal(outcome.state, "partial");
  assert.equal(outcome.ocrNeeded, true);
  assert.equal(outcome.chunkCount, 0);
  assert.equal(outcome.pageCount, 1);

  const state = await stateOf(repository, asset.id);
  assert.equal(state.status, "partial");
  assert.equal(state.source.parseStatus, "partial");
  assert.equal(state.source.ocrNeeded, true);
  assert.equal(state.job.job.state, "succeeded");
  assert.equal(state.job.job.errorCode, "OCR_UNAVAILABLE");

  const sourceId = await sourceIdFor(asset.id);
  const set = await readChunkSet(repository, sourceId, PARSER_VERSION);
  assert.equal(set.chunks.length, 0);
  // Nothing anywhere in the stored parse rows invented text for this page.
  const checkpoint = state.checkpoints.find((item) => item.stage === "extract_text");
  assert.equal(checkpoint.payload.pages[0].text, "");

  // The success event names the real reason, and `ocr_check` is what ended it.
  const events = await repository.listEvents(ACTOR_A, MATTER_ID);
  assert.equal(events.ok, true);
  const finished = events.data.items.filter((event) => event.action === "job.succeeded");
  assert.equal(finished.length, 1);
  assert.equal(finished[0].metadata.stage, "ocr_check");
  // §10 whitelists no errorCode on job.succeeded; the code lives on the job row.
  assert.equal("errorCode" in finished[0].metadata, false);
  assert.equal(finished[0].metadata.count, 0);
  assert.equal(finished[0].jobId, state.job.job.id);

  // The UI copy for that end state offers a manual supplement and a retry,
  // and the row is an error state, never a success.
  const rows = buildParseRows({ assets: [asset], states: new Map([[asset.id, state]]) });
  const view = describeParseRows(rows);
  assert.equal(view.state, "error");
  assert.equal(rows[0].ocrNeeded, true);
  assert.equal(rows[0].errorCode, "OCR_UNAVAILABLE");
  assert.equal(rows[0].errorMessage, PARSE_ERROR_MESSAGES.OCR_UNAVAILABLE);
  assert.equal(rows[0].canRetry, true);
  assert.equal(rows[0].chunkCount, 0);
  assert.equal(backend.store(STORES.blobs).get(`parse/chunks/${sourceId}/${PARSER_VERSION}`)?.chunks.length, 0);
});

test("V6-11-A02 a legacy .doc fails explicitly and creates no chunk set", async () => {
  const { repository, newIds } = await seed();
  const asset = await seedSourceAsset(repository, "legacy-doc.doc", fixture("legacy-doc.doc"));
  const run = parseDeps(newIds);

  const outcome = await parseSource(repository, ACTOR_A, MATTER_ID, asset.id, run.deps);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.state, "failed");
  assert.equal(outcome.errorCode, "UNSUPPORTED_MEDIA");

  const state = await stateOf(repository, asset.id);
  assert.equal(state.status, "failed");
  assert.equal(state.source.parseStatus, "failed");
  assert.equal(state.job.job.state, "failed");
  assert.equal(state.job.job.errorCode, "UNSUPPORTED_MEDIA");
  assert.equal(state.job.job.stage, "verify");
  const sourceId = await sourceIdFor(asset.id);
  assert.equal(await readChunkSet(repository, sourceId, PARSER_VERSION), null);
  assert.equal(state.checkpoints.length, 0);
});

test("V6-11-A02 bytes renamed to a PDF are refused as a MIME mismatch, not parsed", async () => {
  const { repository, newIds } = await seed();
  // The V6-10 upload gate already refuses this; a stored asset must still be
  // re-checked at parse time rather than trusted.
  const asset = await seedSourceAsset(repository, "renamed.pdf", fixture("plain-text.txt"), "application/pdf");
  const run = parseDeps(newIds);

  const outcome = await parseSource(repository, ACTOR_A, MATTER_ID, asset.id, run.deps);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.errorCode, "MIME_MISMATCH");
  const state = await stateOf(repository, asset.id);
  assert.equal(state.status, "failed");
  assert.equal(state.job.job.errorCode, "MIME_MISMATCH");
});

test("V6-11-A02 the 200-page limit is enforced before any text is extracted", async () => {
  const { repository, newIds } = await seed();
  const [asset] = (await ingest(repository, newIds, [fileFrom(fixture("text-two-pages.pdf"), "long.pdf", "application/pdf")])).values();
  const run = parseDeps(newIds);

  let extractionAsked = 0;
  const tooLong = Array.from({ length: DOCUMENT_MAX_PAGES + 1 }, (_, index) => ({ page: index + 1, text: "" }));
  const outcome = await parseSource(repository, ACTOR_A, MATTER_ID, asset.id, {
    ...run.deps,
    loadPdfPages: async () => {
      extractionAsked += 1;
      return tooLong;
    },
  });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.errorCode, "PARSE_BUDGET_EXCEEDED");
  assert.equal(extractionAsked, 1, "only the page count is read; extract_text never runs");
  const state = await stateOf(repository, asset.id);
  assert.equal(state.job.job.stage, "verify");
  assert.equal(state.job.job.errorCode, "PARSE_BUDGET_EXCEEDED");
  assert.equal(await readChunkSet(repository, await sourceIdFor(asset.id), PARSER_VERSION), null);
});

test("V6-11-A02 progress comes only from real stages and pages, never from the lease timer", async () => {
  const { repository, newIds } = await seed();
  const [asset] = (await ingest(repository, newIds, [fileFrom(fixture("text-two-pages.pdf"), "progress.pdf", "application/pdf")])).values();
  const run = parseDeps(newIds);
  const seen = [];

  const outcome = await parseSource(repository, ACTOR_A, MATTER_ID, asset.id, {
    ...run.deps,
    onProgress: (event) => seen.push(event),
  });
  assert.equal(outcome.ok, true);
  assert.deepEqual(
    seen.map((event) => [event.stage, event.completed, event.total, event.unit]),
    [
      ["verify", 1, 1, "stage"],
      ["extract_text", 2, 2, "page"],
      ["ocr_check", 2, 2, "page"],
      ["chunk", 1, 1, "stage"],
    ],
  );
  // Every reported stage is one of the five the contract knows.
  for (const event of seen) assert.ok(PARSE_STAGES.includes(event.stage));
  // And the stored job ends at 5/5 stages, not at a made-up percentage.
  const state = await stateOf(repository, asset.id);
  assert.deepEqual(state.job.job.progress, { completed: 5, total: 5, unit: "stage" });
});

// ---------------------------------------------------------------------------
// A03 — interruption, resume from the saved stage, abandon
// ---------------------------------------------------------------------------

test("V6-11-A03 an interrupted parse shows `interrupted` (never queued) and resumes from the saved stage", async () => {
  const { backend, repository, newIds } = await seed();
  const [asset] = (await ingest(repository, newIds, [fileFrom(fixture("text-two-pages.pdf"), "interrupt.pdf", "application/pdf")])).values();
  const run = parseDeps(newIds);
  const loaderCalls = [];

  // The second page's text is where the tab "closes": another page (lease owner
  // `session-0002`) marks the job interrupted at a later time.
  const outcome = await parseSource(repository, ACTOR_A, MATTER_ID, asset.id, {
    ...run.deps,
    loadPdfPages: async (bytes) => {
      loaderCalls.push(bytes.byteLength);
      if (loaderCalls.length === 2) {
        run.advance("2026-11-01T00:10:00.000Z");
        const marked = await markInterrupted(repository, ACTOR_A, MATTER_ID, asset.id, {
          sessionId: "session-0002",
          now: run.now,
          newId: newIds,
        });
        assert.equal(marked.ok, true, JSON.stringify(marked));
      }
      return loadPdfPagesDefault(bytes);
    },
  });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.state, "interrupted");
  assert.deepEqual(outcome.savedStages, ["verify"]);

  const interrupted = await stateOf(repository, asset.id, { sessionId: "session-0003", now: run.now });
  assert.equal(interrupted.status, "interrupted");
  assert.equal(interrupted.job.job.state, "interrupted");
  assert.equal(interrupted.job.job.leaseOwner, null);
  assert.deepEqual(
    interrupted.checkpoints.map((item) => item.stage),
    ["verify"],
    "the checkpoint that raced the interruption is not counted",
  );

  // Reloading in a fresh repository (a real refresh) reports the same thing and
  // never `queued`.
  const reloaded = await freshRepository(backend);
  const afterReload = await stateOf(reloaded, asset.id, { sessionId: "session-0004", now: run.now });
  assert.equal(afterReload.status, "interrupted");
  const rows = buildParseRows({ assets: [asset], states: new Map([[asset.id, afterReload]]) });
  assert.equal(rows[0].state, "interrupted");
  assert.equal(rows[0].canResume, true);
  assert.equal(rows[0].canAbandon, true);
  assert.equal(rows[0].resumeFrom, "extract_text");
  assert.equal(describeParseRows(rows).state, "stale");

  // A live lease is not interrupted: resuming from the owning session is refused.
  const live = await resumeParse(repository, ACTOR_A, MATTER_ID, asset.id, {
    ...run.deps,
    sessionId: "session-0009",
  });
  assert.equal(live.ok, true, "a job whose lease expired is resumable from any session");

  // The resume produced a new job that continued from `extract_text`: verify was
  // carried forward, so the PDF was opened once (extract), not twice.
  const resumed = await stateOf(repository, asset.id, { sessionId: "session-0009", now: run.now });
  assert.equal(resumed.status, "parsed");
  assert.equal(resumed.source.parseStatus, "parsed");
  assert.notEqual(resumed.job.job.id, afterReload.job.job.id);
  assert.equal(resumed.job.previousJobId, afterReload.job.job.id);
  assert.equal(resumed.job.resumedFromStage, "extract_text");
  assert.equal(resumed.job.ownerPageId, null, "a resume without a page instance records none");
  assert.equal(resumed.job.abandonedAt, null);
  assert.equal(loaderCalls.length, 2, "verify ran once; extract ran once and was reused");

  const events = await repository.listEvents(ACTOR_A, MATTER_ID);
  const started = events.data.items.filter((event) => event.action === "job.started").sort((a, b) => a.id.localeCompare(b.id));
  assert.equal(started.at(-1).metadata.stage, "extract_text");
  assert.equal(started.at(-1).jobId, resumed.job.job.id);

  const sourceId = await sourceIdFor(asset.id);
  const set = await readChunkSet(repository, sourceId, PARSER_VERSION);
  assert.equal(set.chunks.length, 4);
  await assertChunksValid(set.chunks);

  // Resume on an already-finished job runs nothing and invents no second job.
  const nothing = await resumeParse(repository, ACTOR_A, MATTER_ID, asset.id, {
    ...run.deps,
    sessionId: "session-0009",
  });
  assert.equal(nothing.ok, true);
  assert.equal(nothing.run, false);
  assert.equal(nothing.jobId, resumed.job.job.id);
});

test("V6-11-A03 abandon ends an interrupted job for good", async () => {
  const { repository, newIds } = await seed();
  const [asset] = (await ingest(repository, newIds, [fileFrom(fixture("text-two-pages.pdf"), "abandon.pdf", "application/pdf")])).values();
  const run = parseDeps(newIds);

  const outcome = await parseSource(repository, ACTOR_A, MATTER_ID, asset.id, {
    ...run.deps,
    loadPdfPages: async (bytes) => {
      run.advance("2026-11-01T00:10:00.000Z");
      await markInterrupted(repository, ACTOR_A, MATTER_ID, asset.id, { sessionId: "session-0002", now: run.now, newId: newIds });
      return loadPdfPagesDefault(bytes);
    },
  });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.state, "interrupted");

  const abandoned = await abandonParse(repository, ACTOR_A, MATTER_ID, asset.id, {
    sessionId: "session-0002",
    now: run.now,
    newId: newIds,
  });
  assert.equal(abandoned.ok, true, JSON.stringify(abandoned));

  const state = await stateOf(repository, asset.id, { sessionId: "session-0002", now: run.now });
  assert.equal(state.status, "cancelled");
  assert.equal(state.source.parseStatus, "cancelled");
  assert.equal(state.job.job.state, "cancelled");
  assert.equal(state.job.abandonedAt !== null, true);
  assert.equal(await readChunkSet(repository, await sourceIdFor(asset.id), PARSER_VERSION), null);

  const rows = buildParseRows({ assets: [asset], states: new Map([[asset.id, state]]) });
  assert.equal(rows[0].state, "cancelled");
  assert.equal(rows[0].canRetry, true);

  const again = await abandonParse(repository, ACTOR_A, MATTER_ID, asset.id, { sessionId: "session-0002", now: run.now });
  assert.equal(again.ok, false, "an abandoned job cannot be abandoned twice");
});

test("V6-11-A03 a cancelled run stops at a real stage and keeps the stages already saved", async () => {
  const { repository, newIds } = await seed();
  const [asset] = (await ingest(repository, newIds, [fileFrom(fixture("text-two-pages.pdf"), "cancel.pdf", "application/pdf")])).values();
  const run = parseDeps(newIds);
  const controller = new AbortController();
  let opened = 0;

  const outcome = await parseSource(repository, ACTOR_A, MATTER_ID, asset.id, {
    ...run.deps,
    signal: controller.signal,
    loadPdfPages: async (bytes) => {
      opened += 1;
      return loadPdfPagesDefault(bytes);
    },
    onProgress: (event) => {
      if (event.stage === "verify") controller.abort();
    },
  });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.state, "cancelled");
  assert.equal(opened, 1, "the abort lands before extract_text starts");

  const state = await stateOf(repository, asset.id, { sessionId: "session-0001", now: run.now });
  assert.equal(state.status, "cancelled");
  assert.equal(state.job.job.state, "cancelled");
  assert.deepEqual(state.checkpoints.map((item) => item.stage), ["verify"]);
  assert.equal(await readChunkSet(repository, await sourceIdFor(asset.id), PARSER_VERSION), null);
});

// ---------------------------------------------------------------------------
// A03 — retry is a new job; a parser version change adds a chunk set
// ---------------------------------------------------------------------------

test("V6-11-A03 retry creates a new job linked to the old one, and never replays the old id", async () => {
  const { repository, newIds } = await seed();
  const asset = await seedSourceAsset(repository, "legacy-doc.doc", fixture("legacy-doc.doc"));
  const run = parseDeps(newIds);

  const first = await parseSource(repository, ACTOR_A, MATTER_ID, asset.id, run.deps);
  assert.equal(first.ok, false);
  assert.equal(first.errorCode, "UNSUPPORTED_MEDIA");
  const failedState = await stateOf(repository, asset.id, { sessionId: "session-0001", now: run.now });

  const retry = await retryParse(repository, ACTOR_A, MATTER_ID, asset.id, run.deps);
  assert.equal(retry.ok, false, "the file is still unsupported");
  const retried = await stateOf(repository, asset.id, { sessionId: "session-0001", now: run.now });
  assert.notEqual(retried.job.job.id, failedState.job.job.id);
  assert.equal(retried.job.previousJobId, failedState.job.job.id);
  assert.equal(retried.job.resumedFromStage, null);
  assert.equal(retried.status, "failed");
  assert.equal(retried.job.ownerPageId, null, "a retry without a page instance records none");
  assert.equal(retried.job.abandonedAt, null);
  assert.equal(retried.jobs.length, 2);
  assert.deepEqual(retried.jobs.map((item) => item.job.id).sort(), [failedState.job.job.id, retried.job.job.id].sort());

  // Retry after a successful parse also starts a new job (attempt semantics),
  // and the chunk ids are stable because they hash the source and version.
  const [good] = (await ingest(repository, newIds, [fileFrom(fixture("plain-text.txt"), "retry.txt", "text/plain")])).values();
  const firstGood = await parseSource(repository, ACTOR_A, MATTER_ID, good.id, run.deps);
  const second = await retryParse(repository, ACTOR_A, MATTER_ID, good.id, run.deps);
  assert.equal(second.ok, true);
  assert.notEqual(second.jobId, firstGood.jobId);
  const goodState = await stateOf(repository, good.id, { now: run.now });
  assert.equal(goodState.job.job.id, second.jobId);
  assert.equal(goodState.job.previousJobId, firstGood.jobId);
  const sourceId = await sourceIdFor(good.id);
  const sets = await readChunkSets(repository, sourceId);
  assert.equal(sets.length, 1, "the same parser version keeps one chunk set");
});

test("V6-11-A03 a parser version change writes a new chunk set and keeps the old one", async () => {
  const { repository, newIds } = await seed();
  const [asset] = (await ingest(repository, newIds, [fileFrom(fixture("text-two-pages.pdf"), "version.pdf", "application/pdf")])).values();
  const run = parseDeps(newIds);
  const V2 = "v6-local-parser-2";

  const first = await parseSource(repository, ACTOR_A, MATTER_ID, asset.id, run.deps);
  assert.equal(first.ok, true);
  const sourceId = await sourceIdFor(asset.id);
  const oldSet = await readChunkSet(repository, sourceId, PARSER_VERSION);
  assert.equal(oldSet.chunks.length, 4);

  // An upgraded parser re-parses the same source as a new job.
  const upgraded = await retryParse(repository, ACTOR_A, MATTER_ID, asset.id, { ...run.deps, parserVersion: V2 });
  assert.equal(upgraded.ok, true, JSON.stringify(upgraded));
  assert.notEqual(upgraded.jobId, first.jobId);

  const newSet = await readChunkSet(repository, sourceId, V2);
  assert.notEqual(newSet, null);
  assert.deepEqual(await readChunkSet(repository, sourceId, PARSER_VERSION), oldSet, "the old set is kept unchanged");
  assert.deepEqual(newSet.chunks.map((chunk) => chunk.text), oldSet.chunks.map((chunk) => chunk.text));
  for (const chunk of newSet.chunks) assert.equal(chunk.parserVersion, V2);
  const oldIds = new Set(oldSet.chunks.map((chunk) => chunk.id));
  for (const chunk of newSet.chunks) assert.equal(oldIds.has(chunk.id), false, "chunk ids never collide across versions");
  await assertChunksValid(newSet.chunks);
  const sets = await readChunkSets(repository, sourceId);
  assert.deepEqual(sets.map((set) => set.parserVersion), [PARSER_VERSION, V2]);

  const state = await stateOf(repository, asset.id, { now: run.now });
  assert.equal(state.source.parserVersion, V2);
  assert.equal(state.job.parserVersion, V2);
  const rows = buildParseRows({ assets: [asset], states: new Map([[asset.id, state]]) });
  assert.equal(rows[0].chunkCount, 4);
});

test("V6-11-A03 a resume under a newer parser reuses the saved text stages and writes only the new set", async () => {
  const { repository, newIds } = await seed();
  const [asset] = (await ingest(repository, newIds, [fileFrom(fixture("text-two-pages.pdf"), "resume-v2.pdf", "application/pdf")])).values();
  const run = parseDeps(newIds);
  const V2 = "v6-local-parser-2";
  let calls = 0;

  // Interrupted during extract_text: only verify is saved.
  const interrupted = await parseSource(repository, ACTOR_A, MATTER_ID, asset.id, {
    ...run.deps,
    loadPdfPages: async (bytes) => {
      calls += 1;
      if (calls === 2) {
        run.advance("2026-11-01T00:10:00.000Z");
        await markInterrupted(repository, ACTOR_A, MATTER_ID, asset.id, { sessionId: "session-0002", now: run.now, newId: newIds });
      }
      return loadPdfPagesDefault(bytes);
    },
  });
  assert.equal(interrupted.ok, false);
  assert.deepEqual(interrupted.savedStages, ["verify"]);

  let opened = 0;
  const resumed = await resumeParse(repository, ACTOR_A, MATTER_ID, asset.id, {
    ...run.deps,
    sessionId: "session-0002",
    parserVersion: V2,
    loadPdfPages: async (bytes) => {
      opened += 1;
      return loadPdfPagesDefault(bytes);
    },
  });
  assert.equal(resumed.ok, true, JSON.stringify(resumed));
  assert.equal(opened, 1, "verify is reused; only extract_text opens the PDF");
  const sourceId = await sourceIdFor(asset.id);
  assert.equal(await readChunkSet(repository, sourceId, PARSER_VERSION), null);
  const set = await readChunkSet(repository, sourceId, V2);
  assert.equal(set.chunks.length, 4);
  const state = await stateOf(repository, asset.id, { sessionId: "session-0002", now: run.now });
  assert.equal(state.job.resumedFromStage, "extract_text");
  assert.equal(state.source.parserVersion, V2);
});

// ---------------------------------------------------------------------------
// Persistence, schemas and contract shapes
// ---------------------------------------------------------------------------

test("V6-11 stored Source, Chunk and Job rows all parse against the frozen contract", async () => {
  const { backend, repository, newIds } = await seed();
  const assets = await ingest(repository, newIds, [
    fileFrom(fixture("plain-text.txt"), "schema.txt", "text/plain"),
    fileFrom(fixture("scan-no-text-layer.pdf"), "schema-scan.pdf", "application/pdf"),
  ]);
  const run = parseDeps(newIds);
  for (const asset of assets.values()) {
    await parseSource(repository, ACTOR_A, MATTER_ID, asset.id, run.deps);
  }

  const sources = storedParseRows(backend, "parse.source");
  assert.equal(sources.length, 2);
  for (const record of sources) {
    const parsed = sourceSchema.safeParse(record.source);
    assert.equal(parsed.success, true, JSON.stringify(parsed.error?.issues));
    assert.equal(record.source.matterId, MATTER_ID);
  }

  const jobs = storedParseRows(backend, "parse.job");
  assert.ok(jobs.length >= 2);
  for (const envelope of jobs) {
    assert.equal(jobSchema.safeParse(envelope.job).success, true, JSON.stringify(jobSchema.safeParse(envelope.job).error?.issues));
    assert.equal(envelope.job.kind, "parse");
    assert.equal(envelope.job.tenantId, TENANT_A);
    assert.equal(envelope.job.createdBy, USER_A);
    assert.equal(envelope.job.input, null);
    assert.equal(envelope.job.consentId, null);
    assert.equal(envelope.job.usageUnknown, false);
  }

  const chunkSets = storedParseRows(backend, "parse.chunks");
  assert.equal(chunkSets.length, 2);
  for (const set of chunkSets) {
    assert.equal(set.chunks.length, set.chunks.length);
    assert.equal(chunkSchema.array().safeParse(set.chunks).success, true);
  }
});

test("V6-11 job versions move forward exactly once per transition and the matter commits every time", async () => {
  const { repository, newIds } = await seed();
  const [asset] = (await ingest(repository, newIds, [fileFrom(fixture("text-two-pages.pdf"), "versions.pdf", "application/pdf")])).values();
  const run = parseDeps(newIds);
  const before = await repository.loadMatter(ACTOR_A, MATTER_ID);
  assert.equal(before.ok, true);

  await parseSource(repository, ACTOR_A, MATTER_ID, asset.id, run.deps);
  const state = await stateOf(repository, asset.id, { now: run.now });
  // queued (v1, never stored) -> started v2 -> four checkpoint saves -> succeeded v7.
  assert.equal(state.job.job.version, 7);
  const after = await repository.loadMatter(ACTOR_A, MATTER_ID);
  assert.equal(after.ok, true);
  // started + four checkpoint/lease commits + succeeded = 6 matter versions.
  assert.equal(after.data.data.matter.version, before.data.data.matter.version + 6);

  const events = await repository.listEvents(ACTOR_A, MATTER_ID);
  const ordered = [...events.data.items].sort((a, b) => a.id.localeCompare(b.id));
  assert.deepEqual(ordered.map((event) => event.action), ["job.started", "job.succeeded"]);
  assert.equal(ordered[0].jobId, state.job.job.id);
  assert.equal(ordered[0].metadata.stage, "verify");
  assert.equal(ordered[1].metadata.stage, "chunk");
  assert.equal(ordered[1].metadata.count, 4, "count is the number of chunks saved");
  // No document text reaches an activity row (C10).
  for (const event of ordered) {
    for (const value of Object.values(event.metadata)) {
      if (typeof value === "string") assert.ok(value.length < 128);
    }
    assert.equal(event.snapshot, null);
  }
});

test("V6-11 a storage failure during a checkpoint is reported and leaves no fake success", async () => {
  const { backend, repository, newIds } = await seed();
  const [asset] = (await ingest(repository, newIds, [fileFrom(fixture("plain-text.txt"), "storage.txt", "text/plain")])).values();
  const run = parseDeps(newIds);
  backend.setPutFault(({ key }) => (key.startsWith("parse/checkpoint/") ? Object.assign(new Error("disk full"), { name: "QuotaExceededError" }) : null));

  const outcome = await parseSource(repository, ACTOR_A, MATTER_ID, asset.id, run.deps);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.state, "storage_unavailable");
  assert.equal(outcome.errorCode, "STORAGE_UNAVAILABLE");

  backend.setPutFault(null);
  const state = await stateOf(repository, asset.id, { sessionId: "session-0001", now: run.now });
  assert.equal(state.status, "running", "the job is still owned by this page, not marked parsed");
  assert.equal(state.source.parseStatus, "parsing");
  assert.equal(state.checkpoints.length, 0);
  assert.equal(await readChunkSet(repository, await sourceIdFor(asset.id), PARSER_VERSION), null);
});

test("V6-11 leases stay live past their original expiry without inventing progress", async () => {
  const { repository, newIds } = await seed();
  const [asset] = (await ingest(repository, newIds, [fileFrom(fixture("plain-text.txt"), "long.txt", "text/plain")])).values();
  let tick;
  let stopped = false;
  let interval;
  const seen = [];
  const run = parseDeps(newIds, {
    scheduleLeaseRenewal: (renew, ms) => { tick = renew; interval = ms; return () => { stopped = true; }; },
  });
  const outcome = await parseSource(repository, ACTOR_A, MATTER_ID, asset.id, {
    ...run.deps,
    onProgress: (event) => seen.push(event.stage),
    extractText: async () => {
      const original = await stateOf(repository, asset.id, { now: run.now });
      const initialExpiry = original.job.job.leaseExpiresAt;
      for (const seconds of [20, 40, 60, 80, 100]) {
        run.advance(new Date(Date.parse(T0) + seconds * 1000).toISOString());
        await tick();
        const observer = await stateOf(repository, asset.id, { sessionId: "other-tab", now: run.now });
        assert.equal(observer.status, "running");
        assert.equal(observer.job.job.stage, original.job.job.stage);
        assert.deepEqual(observer.job.job.progress, original.job.job.progress);
        assert.ok(observer.job.job.leaseExpiresAt > run.now());
      }
      assert.ok(run.now() > initialExpiry);
      assert.deepEqual(seen, ["verify"], "heartbeats do not emit progress");
      return { text: "real text", note: "" };
    },
  });
  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  assert.equal(interval, 20_000);
  assert.equal(stopped, true);
  const done = await stateOf(repository, asset.id, { now: run.now });
  await tick();
  assert.deepEqual(await stateOf(repository, asset.id, { now: run.now }), done, "late ticks cannot renew a finished job");
});

for (const mode of ["retry-conflict", "exhaust-conflict", "cancel", "abort"]) {
  test(`V6-11 renewal handles ${mode} and cannot revive a stopped job`, async () => {
    const { repository, newIds } = await seed();
    const [asset] = (await ingest(repository, newIds, [fileFrom(fixture("plain-text.txt"), `${mode}.txt`, "text/plain")])).values();
    let tick;
    let stopped = false;
    let attempts = 0;
    const controller = new AbortController();
    const commit = repository.commit.bind(repository);
    const run = parseDeps(newIds, {
      signal: controller.signal,
      scheduleLeaseRenewal: (renew) => { tick = renew; return () => { stopped = true; }; },
    });
    const outcome = await parseSource(repository, ACTOR_A, MATTER_ID, asset.id, {
      ...run.deps,
      extractText: async () => {
        if (mode.includes("conflict")) {
          repository.commit = async (...args) => {
            attempts += 1;
            if (mode === "exhaust-conflict" || attempts === 1) return { ok: false, error: { code: "VERSION_CONFLICT" } };
            return commit(...args);
          };
          await tick();
          repository.commit = commit;
        } else if (mode === "cancel") {
          assert.equal((await cancelParse(repository, ACTOR_A, MATTER_ID, asset.id, run.deps)).ok, true);
          await tick();
          assert.equal(stopped, true);
          assert.equal((await stateOf(repository, asset.id, { now: run.now })).status, "cancelled");
        } else {
          controller.abort();
          assert.equal(stopped, true, "abort stops the timer immediately");
          await tick();
        }
        return { text: "real text", note: "" };
      },
    });
    assert.equal(stopped, true);
    if (mode === "retry-conflict") {
      assert.equal(outcome.ok, true);
      assert.equal(attempts, 2);
    } else {
      assert.equal(outcome.ok, false);
      assert.equal(outcome.state, mode === "exhaust-conflict" ? "storage_unavailable" : mode === "abort" ? "cancelled" : "interrupted");
      if (mode === "exhaust-conflict") assert.equal(attempts, 5);
      assert.equal(await readChunkSet(repository, await sourceIdFor(asset.id), PARSER_VERSION), null);
    }
  });
}

// ---------------------------------------------------------------------------
// Page identity — a copied session id is not proof that the owner disappeared
// ---------------------------------------------------------------------------

function runningStateForDecision({
  id = "job-1",
  state = "running",
  leaseOwner = "session-1",
  leaseExpiresAt = "2026-11-01T00:01:00.000Z",
  pageOwner = "page-1",
  status = "running",
} = {}) {
  return {
    status,
    source: { parseStatus: "parsing" },
    job: {
      kind: "parse.job",
      job: { id, state, leaseOwner, leaseExpiresAt },
      previousJobId: null,
      resumedFromStage: null,
      abandonedAt: null,
      ownerPageId: pageOwner,
    },
    jobs: [],
    checkpoints: [],
  };
}

test("V6-11 orphanInterruptAllowed requires the owning page's exit marker, not just the session", () => {
  const state = runningStateForDecision();
  const renewedAt = new Date(Date.parse(state.job.job.leaseExpiresAt) - LEASE_MS).toISOString();
  const base = { sessionId: "session-1", orphanedJobId: "job-1", leaseMs: LEASE_MS };
  const exit = (overrides = {}) => ({ sessionId: "session-1", pageId: "page-1", at: renewedAt, ...overrides });

  assert.equal(orphanInterruptAllowed(state, { ...base, pageExit: exit() }), true);
  assert.equal(orphanInterruptAllowed(state, { ...base, pageExit: exit({ at: new Date(Date.parse(renewedAt) + 1000).toISOString() }) }), true);
  assert.equal(orphanInterruptAllowed(state, { ...base, pageExit: null }), false, "a live lease with no evidence");
  assert.equal(orphanInterruptAllowed(state, { ...base }), false, "an absent option is not evidence");
  assert.equal(orphanInterruptAllowed(state, { ...base, pageExit: exit({ pageId: "page-2" }) }), false, "another page instance");
  assert.equal(orphanInterruptAllowed(state, { ...base, sessionId: "session-2", pageExit: exit({ sessionId: "session-2" }) }), false, "the job belongs to session-1");
  assert.equal(orphanInterruptAllowed(state, { ...base, pageExit: exit({ sessionId: "session-2" }) }), false, "the marker belongs to another session");
  assert.equal(orphanInterruptAllowed(state, { ...base, orphanedJobId: "job-2", pageExit: exit() }), false, "another job id");
  assert.equal(orphanInterruptAllowed(state, { ...base, pageExit: exit({ at: new Date(Date.parse(renewedAt) - 1).toISOString() }) }), false, "renewed after the exit");
  assert.equal(orphanInterruptAllowed(state, { ...base, pageExit: exit({ at: "not-a-date" }) }), false);
  assert.equal(orphanInterruptAllowed(runningStateForDecision({ pageOwner: null }), { ...base, pageExit: exit() }), false, "a job without an owner page id");
  assert.equal(orphanInterruptAllowed(runningStateForDecision({ pageOwner: "" }), { ...base, pageExit: exit() }), false);
  assert.equal(orphanInterruptAllowed(runningStateForDecision({ leaseExpiresAt: null }), { ...base, pageExit: exit() }), false);
  assert.equal(orphanInterruptAllowed(runningStateForDecision({ leaseOwner: null }), { ...base, pageExit: exit() }), false);
  assert.equal(orphanInterruptAllowed(runningStateForDecision({ state: "cancelled" }), { ...base, pageExit: exit() }), false);
  assert.equal(orphanInterruptAllowed(runningStateForDecision({ status: "interrupted" }), { ...base, pageExit: exit() }), false, "an expired lease is handled by the status, not this check");
  assert.equal(orphanInterruptAllowed(state, { ...base, pageExit: exit(), leaseMs: LEASE_MS - 1000 }), false, "a wrong lease length moves the assumed renewal past the exit");
});

test("V6-11 a duplicated tab sharing the session id cannot interrupt the first page's live job", async () => {
  const { repository, newIds } = await seed();
  const [asset] = (await ingest(repository, newIds, [fileFrom(fixture("plain-text.txt"), "duplicated-tab.txt", "text/plain")])).values();
  const run = parseDeps(newIds);
  const sessionId = "shared-session";
  let before;

  const outcome = await parseSource(repository, ACTOR_A, MATTER_ID, asset.id, {
    ...run.deps,
    sessionId,
    pageId: "page-instance-1",
    extractText: async () => {
      before = await stateOf(repository, asset.id, { sessionId, now: run.now });
      assert.equal(before.status, "running");
      assert.equal(before.job.ownerPageId, "page-instance-1");
      assert.ok(Date.parse(before.job.job.leaseExpiresAt) > Date.parse(run.now()));
      run.advance("2026-11-01T00:00:02.000Z");

      // The second tab copied sessionStorage, so it claims the same session,
      // but its marker (if any) names a different page instance.
      const foreign = await markInterrupted(repository, ACTOR_A, MATTER_ID, asset.id, {
        sessionId, now: run.now, newId: newIds, orphanedJobId: before.job.job.id,
        pageExit: { sessionId, pageId: "page-instance-2", at: run.now() },
      });
      assert.equal(foreign.ok, false, "another page instance is not evidence");
      assert.equal(foreign.errorCode, "INVALID_INPUT");

      // A duplicated tab writes no marker at all.
      const noEvidence = await markInterrupted(repository, ACTOR_A, MATTER_ID, asset.id, {
        sessionId, now: run.now, newId: newIds, orphanedJobId: before.job.job.id, pageExit: null,
      });
      assert.equal(noEvidence.ok, false);
      assert.equal(noEvidence.errorCode, "INVALID_INPUT");

      const still = await stateOf(repository, asset.id, { sessionId, now: run.now });
      assert.deepEqual(still.job.job, before.job.job, "no job row was written");
      assert.deepEqual(still.checkpoints, before.checkpoints);
      assert.equal(still.source.parseStatus, before.source.parseStatus);
      assert.equal(still.status, "running");
      return { text: "the first page keeps parsing", note: "" };
    },
  });

  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  const done = await stateOf(repository, asset.id, { now: run.now });
  assert.equal(done.status, "parsed", "the untouched job finished normally");
  assert.equal(done.jobs.length, 1);
});

test("V6-11 the owning page's exit marker interrupts inside the lease and leaves a resumable record", async () => {
  const { repository, newIds } = await seed();
  const [asset] = (await ingest(repository, newIds, [fileFrom(fixture("plain-text.txt"), "owner-exit.txt", "text/plain")])).values();
  const run = parseDeps(newIds);
  const sessionId = "session-0001";
  let before;
  let marked;

  const outcome = await parseSource(repository, ACTOR_A, MATTER_ID, asset.id, {
    ...run.deps,
    sessionId,
    pageId: "page-instance-1",
    extractText: async () => {
      before = await stateOf(repository, asset.id, { sessionId, now: run.now });
      run.advance("2026-11-01T00:00:02.000Z");
      assert.ok(Date.parse(before.job.job.leaseExpiresAt) > Date.parse(run.now()), "the original lease is still live");
      marked = await markInterrupted(repository, ACTOR_A, MATTER_ID, asset.id, {
        sessionId, now: run.now, newId: newIds, orphanedJobId: before.job.job.id,
        pageExit: { sessionId, pageId: "page-instance-1", at: run.now() },
      });
      return { text: "the racing commit must not win", note: "" };
    },
  });

  assert.equal(marked.ok, true, JSON.stringify(marked));
  assert.equal(marked.fromStage, "extract_text", "resume continues from the saved verify stage");
  assert.equal(outcome.ok, false);
  assert.equal(outcome.state, "interrupted");
  assert.deepEqual(outcome.savedStages, ["verify"]);

  const persisted = await stateOf(repository, asset.id, { sessionId, now: run.now });
  assert.equal(persisted.status, "interrupted");
  assert.equal(persisted.job.job.state, "interrupted");
  assert.equal(persisted.job.job.leaseOwner, null);
  assert.equal(persisted.job.job.leaseExpiresAt, null);
  assert.equal(persisted.job.job.version, before.job.job.version + 1);
  assert.equal(persisted.job.ownerPageId, "page-instance-1");
  assert.deepEqual(persisted.checkpoints.map((item) => item.stage), ["verify"]);

  // The same evidence is idempotent and does not bump the record again.
  const again = await markInterrupted(repository, ACTOR_A, MATTER_ID, asset.id, {
    sessionId, now: run.now, newId: newIds, orphanedJobId: persisted.job.job.id,
    pageExit: { sessionId, pageId: "page-instance-1", at: run.now() },
  });
  assert.equal(again.ok, true);
  const unchanged = await stateOf(repository, asset.id, { sessionId, now: run.now });
  assert.deepEqual(unchanged.job.job, persisted.job.job);
});

test("V6-11 parseSource refuses a second job while this page is already starting one", async () => {
  const { repository, newIds } = await seed();
  const [asset] = (await ingest(repository, newIds, [fileFrom(fixture("plain-text.txt"), "concurrent.txt", "text/plain")])).values();
  const run = parseDeps(newIds);
  let startedResolve;
  const started = new Promise((resolve) => { startedResolve = resolve; });
  let releaseResolve;
  const release = new Promise((resolve) => { releaseResolve = resolve; });

  const firstPromise = parseSource(repository, ACTOR_A, MATTER_ID, asset.id, {
    ...run.deps,
    pageId: "page-instance-1",
    extractText: async () => {
      startedResolve();
      await release;
      return { text: "real text", note: "" };
    },
  });
  await started;

  const second = await parseSource(repository, ACTOR_A, MATTER_ID, asset.id, run.deps);
  assert.equal(second.ok, false);
  assert.equal(second.errorCode, "INVALID_INPUT");
  assert.equal(second.state, "failed");
  assert.equal(second.jobId, null, "the refused call creates no job");

  releaseResolve();
  const first = await firstPromise;
  assert.equal(first.ok, true, JSON.stringify(first));
  const done = await stateOf(repository, asset.id, { now: run.now });
  assert.equal(done.status, "parsed");
  assert.equal(done.jobs.length, 1, "exactly one job was created");
  assert.equal(done.job.job.id, first.jobId);
});

test("V6-11 parseSource refuses a second job while a stored live lease exists", async () => {
  const { backend, repository, newIds } = await seed();
  const [asset] = (await ingest(repository, newIds, [fileFrom(fixture("plain-text.txt"), "live-lease.txt", "text/plain")])).values();
  const run = parseDeps(newIds);
  backend.setPutFault(({ key }) => (key.startsWith("parse/checkpoint/") ? Object.assign(new Error("disk full"), { name: "QuotaExceededError" }) : null));
  const first = await parseSource(repository, ACTOR_A, MATTER_ID, asset.id, run.deps);
  assert.equal(first.state, "storage_unavailable");
  backend.setPutFault(null);

  const before = await stateOf(repository, asset.id, { sessionId: run.deps.sessionId, now: run.now });
  assert.equal(before.status, "running");
  const second = await parseSource(repository, ACTOR_A, MATTER_ID, asset.id, run.deps);
  assert.equal(second.ok, false);
  assert.equal(second.errorCode, "INVALID_INPUT");
  assert.equal(second.state, "interrupted");
  assert.equal(second.jobId, before.job.job.id);

  const after = await stateOf(repository, asset.id, { sessionId: run.deps.sessionId, now: run.now });
  assert.deepEqual(after.job.job, before.job.job, "the refused start writes nothing");
  assert.equal(after.jobs.length, 1);
});

test("V6-11 an expired lease reads interrupted for any reader without a write", async () => {
  const { repository, newIds } = await seed();
  const [asset] = (await ingest(repository, newIds, [fileFrom(fixture("plain-text.txt"), "lease-expiry.txt", "text/plain")])).values();
  const run = parseDeps(newIds);
  let live;
  let expired;

  const outcome = await parseSource(repository, ACTOR_A, MATTER_ID, asset.id, {
    ...run.deps,
    pageId: "page-instance-crashed",
    extractText: async () => {
      live = await readParseState(repository, ACTOR_A, MATTER_ID, asset.id, { now: run.now });
      assert.equal(live.status, "running");
      run.advance("2026-11-01T00:01:01.000Z");
      expired = await readParseState(repository, ACTOR_A, MATTER_ID, asset.id, { sessionId: "other-tab", now: run.now });
      assert.equal(expired.status, "interrupted");
      assert.equal(expired.job.job.state, "running", "the reader did not rewrite the job");
      assert.equal(expired.job.job.version, live.job.job.version);
      assert.equal(expired.job.job.leaseOwner, run.deps.sessionId);
      return { text: "the owner may still be alive", note: "" };
    },
  });
  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  const done = await stateOf(repository, asset.id, { now: run.now });
  assert.equal(done.status, "parsed");
});

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

test("V6-11 splitParagraphs keeps every paragraph, caps long ones, and emits nothing empty", () => {
  assert.deepEqual(splitParagraphs("a\n\nb\nc", 10), ["a", "b", "c"]);
  const long = `${"第".repeat(30)}。${"二".repeat(30)}。`;
  const parts = splitParagraphs(long, 20);
  assert.ok(parts.length >= 2);
  for (const part of parts) {
    assert.ok(part.length > 0);
    assert.ok(part.length <= 20);
  }
  assert.equal(parts.join(""), long);
  assert.deepEqual(splitParagraphs("   \n\n \t ", 10), []);
});

test("V6-11 normalizeText unifies newlines and composes NFC without changing code points after it", () => {
  assert.equal(normalizeText("a\r\nb\r\n\r\n\r\nc  "), "a\nb\n\nc");
  assert.equal(normalizeText("é"), "é");
  const range = locateQuote("前缀 café 后缀", "café");
  assert.deepEqual(range, { start: 3, end: 7 });
  assert.equal(Array.from("前缀 café 后缀").slice(range.start, range.end).join(""), "café");
  assert.equal(locateQuote("abc", ""), null);
  assert.equal(locateQuote("abc", "z"), null);
});

test("V6-11 buildParseRows derives actions from persisted state, and an empty list is the empty state", async () => {
  const { repository, newIds } = await seed();
  const assets = await ingest(repository, newIds, [fileFrom(fixture("plain-text.txt"), "rows.txt", "text/plain")]);
  const asset = [...assets.values()][0];
  const snapshot = await readMatterSources(repository, ACTOR_A, MATTER_ID);
  assert.equal(snapshot.ok, true);

  const pending = buildParseRows({ assets: [asset], states: snapshot.data.sources });
  assert.equal(pending.length, 1);
  assert.equal(pending[0].state, "pending");
  assert.equal(pending[0].canStart, true);
  assert.equal(pending[0].chunkCount, 0);
  assert.equal(describeParseRows([]).state, "empty");

  const run = parseDeps(newIds);
  await parseSource(repository, ACTOR_A, MATTER_ID, asset.id, run.deps);
  const state = await stateOf(repository, asset.id, { now: run.now });
  const done = buildParseRows({ assets: [asset], states: new Map([[asset.id, state]]) });
  assert.equal(done[0].state, "parsed");
  assert.equal(done[0].chunkCount, 2);
  assert.equal(done[0].canStart, false);
  assert.equal(done[0].jobState, "succeeded");
  assert.equal(done[0].stageLabel, "切分段落");
  assert.deepEqual(done[0].savedStages, ["verify", "extract_text", "ocr_check", "chunk"]);
  assert.equal(describeParseRows(done).state, "parsed");
});
