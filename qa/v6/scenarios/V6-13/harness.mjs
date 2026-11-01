/**
 * Shared V6-13 scenario harness.
 *
 * Reuses the V6-11 in-memory backend and real ingest path, then adds one parsed
 * synthetic source whose paragraphs mention every intake question. Nothing is
 * sent anywhere: the fixture is written for this ticket and every byte is
 * produced locally.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  CONTRACT_VERSION,
  STORES,
  openLocalRepository,
} from "../../../../apps/web/src/v6/lib/repository.ts";
import { parseSource, readChunkSet, PARSER_VERSION, sourceIdFor } from "../../../../apps/web/src/v6/features/sources/parse.ts";
import { sourceRefForChunk } from "../../../../apps/web/src/v6/features/intake/intake.ts";

import {
  ACTOR_A,
  MATTER_ID,
  TENANT_A,
  T0,
  USER_A,
  MemoryBackend,
  fileFrom,
  freshRepository,
  ingest,
  parseDeps,
  seed,
  uuidSource,
} from "../V6-11/harness.mjs";

export {
  ACTOR_A,
  MATTER_ID,
  TENANT_A,
  T0,
  USER_A,
  MemoryBackend,
  fileFrom,
  freshRepository,
  seed,
  uuidSource,
  STORES,
  CONTRACT_VERSION,
};

export function fixtureBytes(name = "intake-source.txt") {
  return new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));
}

/** A target record the draft-binding seam can point at. */
export function targetRecord(id, index = 1) {
  return {
    id,
    matterId: MATTER_ID,
    status: "active",
    configVersion: 1,
    draftRevisionId: null,
    figureRevisionId: `00000000-0000-4000-8000-${String(900000 + index).padStart(12, "0")}`,
  };
}

/** Add targets to the seeded matter; this changes `version`, never `sourceVersion`. */
export async function addTargets(repository, targets) {
  const loaded = await repository.loadMatter(ACTOR_A, MATTER_ID);
  assert.equal(loaded.ok, true, loaded.ok ? "" : JSON.stringify(loaded.error));
  const matter = loaded.data.data.matter;
  const committed = await repository.commit(
    ACTOR_A,
    {
      contractVersion: CONTRACT_VERSION,
      expectedVersion: matter.version,
      payload: {
        matter: { ...matter, version: matter.version + 1, updatedAt: T0 },
        targets: [...loaded.data.data.targets, ...targets],
        assets: loaded.data.data.assets,
        events: [],
        blobs: [],
      },
    },
    { requestId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" },
  );
  assert.equal(committed.ok, true, committed.ok ? "" : JSON.stringify(committed.error));
  return committed.data.data.targets;
}

/**
 * Ingest and parse the ticket fixture through the real V6-10/V6-11 paths.
 * Returns the parsed chunks, in order, with their source id.
 */
export async function addParsedSource(repository, newIds) {
  const [asset] = (await ingest(repository, newIds, [fileFrom(fixtureBytes(), "intake-source.txt", "text/plain")])).values();
  assert.ok(asset, "the fixture was ingested");
  const run = parseDeps(newIds);
  const outcome = await parseSource(repository, ACTOR_A, MATTER_ID, asset.id, run.deps);
  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  assert.equal(outcome.state, "parsed");
  const sourceId = await sourceIdFor(asset.id);
  const set = await readChunkSet(repository, sourceId, PARSER_VERSION);
  assert.notEqual(set, null);
  return { asset, sourceId, chunks: set.chunks };
}

/** Seed a matter with the parsed fixture and no snapshot yet. */
export async function seedParsedMatter({ targets = [] } = {}) {
  const { backend, repository, newIds } = await seed();
  if (targets.length > 0) await addTargets(repository, targets);
  const source = await addParsedSource(repository, newIds);
  return { backend, repository, newIds, ...source };
}

/**
 * Mark one parsed source as retired. No feature retires a source yet, so this
 * writes the row's own field, which is exactly what a later retire action will
 * set. Returns the number of rows changed (always 1 here).
 */
export function retireSource(backend, sourceId, at = T0) {
  let changed = 0;
  for (const [key, value] of backend.store(STORES.blobs)) {
    if (value?.kind === "parse.source" && value.source.id === sourceId) {
      backend.store(STORES.blobs).set(key, { ...value, source: { ...value.source, retiredAt: at } });
      changed += 1;
    }
  }
  assert.equal(changed, 1, "exactly one stored source row was retired");
  return changed;
}

/** The one chunk mentioning `keyword`; the real SourceRef for all of its text. */export function refFor(chunks, keyword) {
  const chunk = chunks.find((candidate) => candidate.text.includes(keyword));
  assert.ok(chunk, `a parsed chunk mentions ${keyword}`);
  const ref = sourceRefForChunk(chunk);
  assert.ok(ref, "the chunk locates its own text");
  return ref;
}

export function chunkFor(chunks, keyword) {
  const chunk = chunks.find((candidate) => candidate.text.includes(keyword));
  assert.ok(chunk, `a parsed chunk mentions ${keyword}`);
  return chunk;
}

export function fiveAnswers(overrides = {}) {
  return {
    problem: "低温环境效率低，运行成本高。",
    difference: "改进了流道结构，降低了流动阻力。",
    inventorIds: [],
    disclosure: null,
    maturity: null,
    disclosureDetail: null,
    ...overrides,
  };
}

/** Every answered question gets an explicit source; the caller may replace one. */
export function directSources(overrides = {}) {
  return {
    problem: { kind: "direct" },
    difference: { kind: "direct" },
    inventorIds: { kind: "direct" },
    disclosure: { kind: "direct" },
    maturity: { kind: "direct" },
    ...overrides,
  };
}

export function personParty(id, name = "张三") {
  return { id, kind: "person", name, roles: ["inventor"], country: null };
}

export function organizationParty(id, name = "某某公司") {
  return { id, kind: "organization", name, roles: ["applicant"], country: null };
}
