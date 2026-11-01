/**
 * Red-before-fix evidence for V6-13.
 *
 * For each acceptance guarantee the ticket requires, this script disables the
 * guard that enforces it, runs the V6-13 suite, records the failing tests and
 * the exit code, restores the file from a backup, and proves the restore by
 * comparing SHA-256 digests. The repo copy of intake.ts is never left modified.
 *
 * Run: node qa/v6/evidence/V6-13/red-before-fix.mjs
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, copyFileSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../../../..");
const TARGET = resolve(ROOT, "apps/web/src/v6/features/intake/intake.ts");
// The byte copy lives outside the repo so no second copy of production source
// is ever left in the evidence folder.
const BACKUP = `/tmp/v6-13-red-before-fix-intake.${process.pid}.ts`;
const OUT = resolve(HERE, "red-before-fix.txt");

const sha = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");

const MUTATIONS = [
  {
    id: "G1-source-required",
    guarantee: "an answered question must name its source (material / not found / direct)",
    find: '    if (!isAnswered(key, answers)) continue;\n    const checked = validateQuestionSource',
    replace: '    continue;\n    const checked = validateQuestionSource',
    expect: "V6-13-A02 invalid input ... (sources.problem)",
  },
  {
    id: "G2-fact-version-required",
    guarantee: "a save must state the fact version it was based on",
    find: "  if (!Number.isSafeInteger(command?.baseSourceVersion) || command.baseSourceVersion < 1) {",
    replace: "  if (false && !Number.isSafeInteger(command?.baseSourceVersion)) {",
    expect: "V6-13-A02 invalid input ... (baseSourceVersion)",
  },
  {
    id: "G2b-fact-version-recorded",
    guarantee: "each answer's provenance records the fact version it was based on",
    find: "          basedOnVersion: matter.sourceVersion,",
    replace: "          basedOnVersion: matter.sourceVersion - 1,",
    expect: "V6-13-A01 / S03-A01 provenance basedOnVersion",
  },
  {
    id: "G3-no-inferred-history",
    guarantee: "disclosure is never inferred; an unanswered question stays null",
    find: "    disclosure: null,\n    maturity: null,\n    disclosureDetail: null,",
    replace: '    disclosure: "unsure",\n    maturity: "idea",\n    disclosureDetail: null,',
    expect: "S03-A01 / V6-13-A02 / UI empty-state disclosure stays null",
  },
  {
    id: "G4-conflicts-preserved",
    guarantee: "conflicting answers are preserved instead of collapsed",
    find: "    conflicts: conflictResult.conflicts,\n    answers,",
    replace: "    conflicts: [],\n    answers,",
    expect: "S03-A06 retained conflict is preserved",
  },
  {
    id: "G5-stale-derived-draft",
    guarantee: "a fact change makes a draft derived from it stale",
    find: "      stale: current === null || isInputStale(binding.input, current),",
    replace: "      stale: current === null,",
    expect: "S03-A04 / V6-13-A02 derived draft becomes stale",
  },
  // Fix round 1 (review-01). Each guard below was also shown red against the
  // pre-fix code as a whole: see fix-round-1-red.txt.
  {
    id: "G6-B1-recovery-read",
    guarantee: "a committed version without its snapshot reads as recovery, not a lockout",
    find: "  if (envelope === null && matter.sourceVersion !== 1) {\n    const older",
    replace:
      '  if (envelope === null && matter.sourceVersion !== 1) {\n    return { ok: false, errorCode: "STORAGE_UNAVAILABLE", message: INTAKE_ERROR_MESSAGES.STORAGE_UNAVAILABLE };\n    const older',
    expect: "V6-13-A03 B1 fresh read recovers at the committed version (engine and UI)",
  },
  {
    id: "G6b-B1-gap-filled",
    guarantee: "a save on a recovered version always writes, so the missing snapshot is filled",
    find: "    !recovering &&\n    sameJson(",
    replace: "    sameJson(",
    expect: "V6-13-A03 B1 save at the committed version fills the gap",
  },
  {
    id: "G6c-B1-committed-copy",
    guarantee: "a committed version is never reported as not saved",
    find: "        committedVersion: version,\n        message: committedWithoutSnapshotMessage(version),\n",
    replace: "        committedVersion: version,\n",
    expect: "V6-13-A03 post-commit failure copy (engine and UI)",
  },
  {
    id: "G7-B2-evidence-validated",
    guarantee: "disclosure evidence refs must locate their chunk (hash and quote) at save",
    find: '  if (evidenceFields.length > 0) return failure("SOURCE_LOCATOR_INVALID", evidenceFields);',
    replace: "  void evidenceFields;",
    expect: "V6-13 B2 forged evidence ref is refused as SOURCE_LOCATOR_INVALID",
  },
  {
    id: "G7b-B2-evidence-stale-read",
    guarantee: "a stored disclosure evidence ref that no longer locates reads as changed",
    find: "            (ref) => sourceRefProblem(ref, chunkIndex.index) !== null,",
    replace: "            (ref) => false,",
    expect: "V6-13 B2 evidence ref reads as changed (engine and UI)",
  },
  {
    id: "G8-idempotency-scope",
    guarantee: "idempotency is scoped by (tenant, actor, operation, key)",
    find: '    SAVE_OPERATION,\n    requestKey,\n  ].join("/");',
    replace: '    requestKey,\n  ].join("/");',
    expect: "V6-13 idempotency records are scoped by (tenant, actor, operation, key)",
  },
  // Fix round 2 (review-02). G9-G12b were also shown red against the pre-fix
  // code as a whole: see fix-round-2-red.txt. G13 and G14 cover checks that
  // already existed (review-02 N4) and are red only when the check is removed.
  {
    id: "G9-B3-commit-conflict-reload",
    guarantee: "a commit that loses its version check reloads instead of reporting the aggregate matter version",
    find: '    if (committed.error.code === "VERSION_CONFLICT") return MATTER_MOVED;',
    replace:
      '    if (committed.error.code === "VERSION_CONFLICT") {\n      return versionConflict(repository, matterId, committed.error.latestVersion ?? matter.sourceVersion);\n    }',
    expect: "V6-13 B3 two-save race (engine and UI) / unrelated commit / bounded rebuild",
  },
  {
    id: "G10-B3-conflict-latest-snapshot",
    guarantee: "a fact conflict carries the latest version's readable snapshot for the side-by-side view",
    find: "  let latest: SourceSnapshot | null = stored.ok ? (stored.state.envelope?.snapshot ?? null) : null;",
    replace: "  let latest: SourceSnapshot | null = null;",
    expect: "V6-13 B3 two-save race (engine and UI) / A03 stale base returns both sides",
  },
  {
    id: "G11-B3-rebuild-on-fresh-matter",
    guarantee: "a save that lost only to an unrelated matter write is rebuilt and retried",
    find: "  for (let attempt = 1; attempt <= MAX_SAVE_ATTEMPTS; attempt += 1) {",
    replace: "  for (let attempt = 1; attempt <= 1; attempt += 1) {",
    expect: "V6-13 B3 save racing a target add commits once",
  },
  {
    id: "G12-B3-rebuild-bounded",
    guarantee: "the rebuild is bounded to MAX_SAVE_ATTEMPTS commits",
    find: "  for (let attempt = 1; attempt <= MAX_SAVE_ATTEMPTS; attempt += 1) {",
    replace: "  for (let attempt = 1; attempt <= MAX_SAVE_ATTEMPTS + 1; attempt += 1) {",
    expect: "V6-13 B3 the rebuild is bounded",
  },
  {
    id: "G12b-B3-conflict-older-snapshot",
    guarantee: "a conflict whose latest snapshot is missing shows the newest older snapshot",
    find: "  if (stored.ok && latest === null && sourceVersion !== 1) {",
    replace: "  if (false) {",
    expect: "V6-13 UI conflict whose latest snapshot was never written",
  },
  {
    id: "G13-N4-chunk-source-match",
    guarantee: "a source ref must name the source its chunk belongs to",
    find: '  if (chunk.sourceId !== ref.sourceId) return "来源段落不属于这份材料";\n',
    replace: "",
    expect: "V6-13 a source ref naming a real chunk under another source id is refused",
  },
  {
    id: "G14-N4-recovery-matter-match",
    guarantee: "recovery only shows an older snapshot of this matter",
    find: "parsed.success && parsed.data.matterId === matterId && parsed.data.version === version",
    replace: "parsed.success && parsed.data.version === version",
    expect: "V6-13 recovery never shows an older snapshot whose matterId is not this matter's",
  },
  // Fix round 3 (review-03 B4, N-a, N-c) and round 4 (review-04 B5). G15-G17
  // were also shown red against the pre-fix code as a whole: see
  // fix-round-3-red.txt. G18 was shown red against the round-3 code in
  // fix-round-4-red.txt; the keep-mine control is UI-only, so it is red only
  // through the pre-fix run (UI test 39).
  {
    id: "G15-B4-noop-idempotency",
    guarantee: "a no-op save with a request key settles its claim with the response, so an identical replay returns it and a different payload is refused",
    find: "      const finalized = await completeNoopClaim(repository, actor, requestKey, claim.claimId, requestHash, {",
    replace:
      '      const finalized = { kind: "completed" as const }; if (false) await completeNoopClaim(repository, actor, requestKey, claim.claimId, requestHash, {',
    expect: "V6-13 B4 I1 / I5 no-op idempotency",
  },
  {
    id: "G16-B4-replay-before-status",
    guarantee: "a completed request is replayed before the matter status gate, so a replay still succeeds after archive",
    find: '  if (requestKey !== null) {\n    const claimId = newId();',
    replace: '  if (requestKey !== null && matter.status === "active") {\n    const claimId = newId();',
    expect: "V6-13 B4 I3 replay after archive",
  },
  {
    id: "G18-B5-atomic-claim",
    guarantee: "the idempotency key is claimed in one read-write transaction before any business write, so only one request owns it",
    find: '    const claimId = newId();\n    const claimed = await claimIdempotency(',
    replace:
      '    const claimId = newId();\n    const claimed = { kind: "claimed" as const, claimId }; if (false) await claimIdempotency(',
    expect: "V6-13 B5 one owner per key (no-op vs write race)",
  },
  {
    id: "G17-retired-source-hidden",
    guarantee: "a retired source is not offered in the chunk or suggestion pickers",
    find: "        if (record.source.retiredAt === null) latest.push(...lastSet);",
    replace: "        latest.push(...lastSet);",
    expect: "V6-13 a retired source is not offered in the chunk or suggestion pickers",
  },
];

const before = sha(TARGET);
copyFileSync(TARGET, BACKUP);
if (sha(BACKUP) !== before) throw new Error("backup does not match the original");
const original = readFileSync(TARGET, "utf8");

/** Copy the backup back over intake.ts and prove the bytes match by SHA-256. */
function restore(label) {
  copyFileSync(BACKUP, TARGET);
  if (sha(TARGET) !== before) throw new Error(`${label}: restore failed`);
}
const lines = [
  "V6-13 red-before-fix evidence",
  "worktree: /private/tmp/patent-v6-13-worktree (base 953e05d)",
  `intake.ts sha256 before: ${before}`,
  "",
  "Each guard was disabled one at a time in apps/web/src/v6/features/intake/intake.ts,",
  "then `npm run test:v6 -- V6-13` was run. Exit code 1 with the named test failing is",
  "the expected red state. The file was restored from a byte copy after every run.",
  "",
];

let allRed = true;
let allRestored = true;
try {
  for (const mutation of MUTATIONS) {
    if (!original.includes(mutation.find)) {
      throw new Error(`${mutation.id}: anchor not found`);
    }
    const mutated = original.replace(mutation.find, mutation.replace);
    if (mutated === original) throw new Error(`${mutation.id}: replacement changed nothing`);
    writeFileSync(TARGET, mutated);
    try {
      const run = spawnSync(
        "npm",
        ["--prefix", ROOT, "run", "test:v6", "--", "V6-13"],
        { cwd: ROOT, encoding: "utf8", timeout: 240_000 },
      );
      const output = `${run.stdout ?? ""}\n${run.stderr ?? ""}`;
      const failing = output
        .split("\n")
        .filter((line) => line.startsWith("not ok "))
        .map((line) => line.trim());
      const red = run.status === 1 && failing.length > 0;
      allRed &&= red;
      lines.push(
        `## ${mutation.id}`,
        `guarantee: ${mutation.guarantee}`,
        `expected red test: ${mutation.expect}`,
        `command: npm --prefix ${ROOT} run test:v6 -- V6-13`,
        `exit code: ${run.status}${run.signal ? ` (signal ${run.signal})` : ""}`,
        `failing tests: ${failing.length === 0 ? "(none)" : ""}`,
        ...failing.map((line) => `  - ${line}`),
        "",
      );
    } finally {
      restore(mutation.id);
    }
  }
} finally {
  restore("final");
}

const after = sha(TARGET);
allRestored = after === before;
rmSync(BACKUP);
lines.push(
  "## Restore proof",
  `backup (outside the repo): ${BACKUP}`,
  `intake.ts sha256 after: ${after}`,
  `identical to before: ${after === before}`,
  "",
  `all guards produced a red run: ${allRed}`,
  "",
);
writeFileSync(OUT, lines.join("\n"));
process.stdout.write(lines.join("\n"));
process.exit(allRed && allRestored ? 0 : 1);
