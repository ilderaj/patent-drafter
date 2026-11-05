#!/usr/bin/env node
/**
 * V6-15 red-before-fix evidence.
 *
 * Each guard below removes one safety property from the real AI module, runs
 * the one engine test that owns that property, and requires:
 *   - a non-zero exit,
 *   - a TAP `not ok` line naming that test,
 *   - the source restored byte for byte (sha256 checked after every attempt).
 *
 * Guards that own more than one independent check mutate every check; removing
 * only one would leave the guarantee enforced by the other. Mutations exist
 * only for the duration of one child process and are never committed.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../../../..");
const SOURCE = join(ROOT, "apps/web/src/v6/features/ai/ai.ts");
const ENGINE = join(ROOT, "qa/v6/scenarios/V6-15/ai-engine.test.mjs");

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function run(args) {
  return spawnSync(process.execPath, args, {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 120_000,
  });
}

function namedFailure(output) {
  return output
    .split(/\r?\n/)
    .filter((line) => line.startsWith("not ok ") || /^\s+(?:error|code|failureType):/.test(line))
    .slice(0, 6)
    .join("\n");
}

function applyMutations(text, mutations) {
  let mutated = text;
  for (const mutation of mutations) {
    const occurrences = mutated.split(mutation.find).length - 1;
    assert.equal(occurrences, 1, `mutation anchor must be unique (found ${occurrences}): ${mutation.find}`);
    mutated = mutated.replace(mutation.find, mutation.replace);
  }
  return mutated;
}

const original = readFileSync(SOURCE);
const originalText = original.toString("utf8");
const originalHash = sha256(original);
console.log(`source: ${SOURCE}`);
console.log(`sha256 before: ${originalHash}`);
console.log("");

const guards = [
  {
    id: "unknown-profile-field-gate",
    claim: "an incomplete provider profile cannot be granted consent",
    testName: "V6-15 engine: unknown processor fields make consent impossible and report the fields",
    pattern: "unknown processor fields make consent impossible",
    mutations: [
      {
        find: "  if (problem) return { ok: false, error: problem };\n  if (!profile.allowedPurposes.includes(normalized.data.purpose)) {",
        replace:
          "  if (problem && false) return { ok: false, error: problem };\n  if (!profile.allowedPurposes.includes(normalized.data.purpose)) {",
      },
    ],
  },
  {
    id: "manifest-hash-binding",
    claim: "a grant must hash-bind and scope-bind the current payload manifest",
    testName: "V6-15 engine: a stale manifest hash or a mismatched scope is refused without writing",
    pattern: "a stale manifest hash or a mismatched scope",
    mutations: [
      {
        find: "    initialManifest.data.payloadManifestHash !== normalized.data.manifestHash ||",
        replace: "    false ||",
      },
      {
        find: "      manifest.data.payloadManifestHash !== normalized.data.manifestHash ||",
        replace: "      false ||",
      },
    ],
  },
  {
    id: "new-file-needs-new-consent",
    claim: "adding a source file makes the earlier consent unusable (S04-A02)",
    testName: "V6-15 engine: adding a file makes the old consent stale and unusable (S04-A02)",
    pattern: "adding a file makes the old consent stale and unusable",
    mutations: [
      {
        find:
          "  if (\n    manifest.data.payloadManifestHash !== stored.consent.scope.payloadManifestHash ||\n    !sameScope(manifest.data.scope, stored.consent.scope)\n  ) {",
        replace: "  if (false) {",
      },
    ],
  },
  {
    id: "revoked-consent-cannot-authorize",
    claim: "a revoked consent cannot authorize a call",
    testName: "V6-15 engine: revocation is append-only, blocks use, and a second revocation adds no event",
    pattern: "revocation is append-only, blocks use",
    mutations: [
      {
        find: "  if (revoked !== null) {",
        replace: "  if (revoked !== null && false) {",
      },
    ],
  },
  {
    id: "revocation-append-only-idempotent",
    claim: "revoking twice adds no second event and reports alreadyRevoked",
    testName: "V6-15 engine: revocation is append-only, blocks use, and a second revocation adds no event",
    pattern: "revocation is append-only, blocks use",
    mutations: [
      {
        find: "  if (already !== null) {",
        replace: "  if (already !== null && false) {",
      },
      {
        find: "  const eventId = await derivedId(`v6/ai/event/consent-revoked/${matterId}/${stored.consent.id}`);",
        replace: "  const eventId = await derivedId(`v6/ai/event/consent-revoked/${matterId}/${stored.consent.id}/${now}`);",
      },
    ],
  },
  {
    id: "request-key-replay-conflict",
    claim: "the same request key with different content is IDEMPOTENCY_CONFLICT",
    testName: "V6-15 engine: request keys replay the original response and conflict on different content",
    pattern: "request keys replay the original response",
    mutations: [
      {
        find:
          "    const existing = await readIdempotency(repository, actor, GRANT_OPERATION, requestKey);\n    if (!existing.ok) return existing;\n    if (existing.data !== null) {\n      if (existing.data.requestHash !== requestHash) {",
        replace:
          "    const existing = await readIdempotency(repository, actor, GRANT_OPERATION, requestKey);\n    if (!existing.ok) return existing;\n    if (existing.data !== null) {\n      if (false) {",
      },
    ],
  },
  {
    id: "archived-matter-gate",
    claim: "a completed key still replays after the matter is archived",
    testName: "V6-15 engine: an archived matter replays a completed key but refuses new work",
    pattern: "an archived matter replays a completed key",
    mutations: [
      {
        find:
          "    const existing = await readIdempotency(repository, actor, GRANT_OPERATION, requestKey);\n    if (!existing.ok) return existing;\n    if (existing.data !== null) {",
        replace:
          "    const existing = await readIdempotency(repository, actor, GRANT_OPERATION, requestKey);\n    if (!existing.ok) return existing;\n    if (existing.data !== null && false) {",
      },
      {
        find: "      if (grantedEvent(events.data, consentId) !== null) {",
        replace: "      if (grantedEvent(events.data, consentId) !== null && false) {",
      },
    ],
  },
  {
    id: "invocation-view-has-no-content",
    claim: "the invocation view model never carries prompt, case content or keys",
    testName: "V6-15 engine: the invocation view model projects contract metadata only",
    pattern: "the invocation view model projects contract metadata only",
    mutations: [
      {
        find: "  return {\n    id: parsed.data.id,\n    jobId: parsed.data.jobId,",
        replace: "  return {\n    ...value,\n    id: parsed.data.id,\n    jobId: parsed.data.jobId,",
      },
    ],
  },
  {
    id: "actor-tenant-boundary",
    claim: "another actor or tenant cannot read this matter's AI view",
    testName: "V6-15 engine: another actor or tenant cannot read, grant, validate or revoke",
    pattern: "another actor or tenant cannot read, grant, validate or revoke",
    mutations: [
      {
        find:
          "  const loaded = await repository.loadMatter(actor, matterId);\n  if (!loaded.ok) return { ok: false, error: mapRepositoryError(loaded.error) };\n  const aggregate = loaded.data.data;\n  if (aggregate.matter.status === \"deletion_pending\") {",
        replace:
          '  const loaded = await repository.loadMatter(actor, matterId);\n  if (!loaded.ok) return success(emptyView(config, "no_matters", "access-check-disabled"));\n  const aggregate = loaded.data.data;\n  if (aggregate.matter.status === "deletion_pending") {',
      },
    ],
  },
];

let failures = 0;

for (const guard of guards) {
  let mutatedText;
  let result;
  try {
    mutatedText = applyMutations(originalText, guard.mutations);
    assert.notEqual(mutatedText, originalText, `${guard.id}: mutation changed nothing`);
    writeFileSync(SOURCE, mutatedText);
    result = run([
      "--test",
      "--test-reporter=tap",
      "--test-name-pattern",
      guard.pattern,
      ENGINE,
    ]);
  } finally {
    writeFileSync(SOURCE, original);
  }

  const restored = readFileSync(SOURCE);
  const restoredHash = sha256(restored);
  assert.equal(restoredHash, originalHash, `${guard.id}: source was not restored byte for byte`);

  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  const red =
    result.status !== 0 &&
    output.includes(`not ok 1 - ${guard.testName}`) &&
    output.includes("# fail 1");
  console.log(`== ${guard.id} ==`);
  console.log(`claim: ${guard.claim}`);
  console.log(`test: ${guard.testName}`);
  console.log(`mutated sha256: ${sha256(Buffer.from(mutatedText, "utf8"))}`);
  console.log(`exit: ${result.status}`);
  console.log(`restored sha256: ${restoredHash} ${restoredHash === originalHash ? "MATCH" : "MISMATCH"}`);
  if (red) {
    console.log("verdict: RED (guard detects the regression)");
    console.log(namedFailure(output));
  } else {
    failures += 1;
    console.log("verdict: NOT RED — guard did not fail as required");
    console.log(output.slice(-2500));
  }
  console.log("");
}

const baseline = run(["--test", "--test-reporter=tap", ENGINE]);
const baselineOutput = `${baseline.stdout ?? ""}${baseline.stderr ?? ""}`;
const baselineGreen =
  baseline.status === 0 &&
  /^# fail 0\s*$/m.test(baselineOutput) &&
  /^# pass \d+\s*$/m.test(baselineOutput);
console.log("== unmutated baseline ==");
console.log(`exit: ${baseline.status}`);
console.log(
  baselineOutput
    .split(/\r?\n/)
    .filter((line) => /^# (tests|pass|fail|skipped)\b/.test(line))
    .join("\n"),
);
console.log(`restored sha256: ${sha256(readFileSync(SOURCE))}`);
if (!baselineGreen) {
  failures += 1;
  console.log("verdict: BASELINE NOT GREEN");
  console.log(baselineOutput.slice(-2500));
} else {
  console.log("verdict: GREEN");
}

if (sha256(readFileSync(SOURCE)) !== originalHash) {
  failures += 1;
  console.log("SOURCE HASH CHANGED AFTER EVIDENCE RUN");
}

console.log("");
console.log(
  failures === 0
    ? "RED-BEFORE-FIX: ALL GUARDS RED, BASELINE GREEN"
    : `RED-BEFORE-FIX: ${failures} FAILURE(S)`,
);
process.exit(failures === 0 ? 0 : 1);
