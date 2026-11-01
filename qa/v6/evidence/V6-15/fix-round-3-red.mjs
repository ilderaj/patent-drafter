/**
 * V6-15 fix round 3 — red before fix.
 *
 * Swaps the fixed ai.ts for the exact round-3 pre-fix source (the round-2 fixed
 * bytes), runs the concurrency suite, asserts the new same-key retry test fails
 * while the round-2 takeover test and every earlier guard stay green, then
 * restores the fixed file from a byte backup and proves restoration by
 * SHA-256. Exit 0 only when the new guard was red, every earlier test stayed
 * green and the source was restored byte for byte.
 *
 * The source is always restored in a finally block; the worktree is never left
 * with the pre-fix file in place.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const worktree = resolve(here, "../../../..");
const source = join(worktree, "apps/web/src/v6/features/ai/ai.ts");
const fixture = join(here, "fix-round-3-prefix-ai.txt");
const testFile = join(worktree, "qa/v6/scenarios/V6-15/ai-consent-concurrency.test.mjs");

const REQUIRED_RED = [
  "a same-key retry after a failed commit re-executes instead of conflicting on the invisible orphan row",
];

const ROUND_1_GUARDS = [
  "identical concurrent grants both succeed with one creation and equal results",
  "revoke same key with different consentIds gets one winner and one conflict",
  "a grant whose finalize fails after commit replays the original response",
  "a revoke whose finalize fails after commit replays the original response",
  "cleanup cannot delete a consent row whose granted event survived",
  "a live claim makes an identical request wait, then report busy, then replay",
];

const ROUND_2_GUARD =
  "an expired owner's cleanup cannot delete the new claim owner's consent row";

const REQUIRED_GREEN = [...ROUND_1_GUARDS, ROUND_2_GUARD];

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function tapResults(stdout) {
  const results = [];
  for (const line of stdout.split("\n")) {
    const match = line.match(/^(not ok|ok) \d+ - (.*)$/);
    if (match) results.push({ ok: match[1] === "ok", name: match[2].trim() });
  }
  return results;
}

let tempDir = null;
let restored = false;
let exitCode = 1;
let fixedSha = null;
let fixtureSha = null;
try {
  fixedSha = sha256(source);
  fixtureSha = sha256(fixture);
  console.log(`worktree: ${worktree}`);
  console.log(`fixed ai.ts sha256:   ${fixedSha}`);
  console.log(`pre-fix ai.ts sha256: ${fixtureSha}`);

  tempDir = mkdtempSync(join(tmpdir(), "v6-15-fix-round-3-"));
  const backup = join(tempDir, "ai.fixed.ts");
  copyFileSync(source, backup);
  if (sha256(backup) !== fixedSha) throw new Error("backup copy does not match the fixed source");

  copyFileSync(fixture, source);
  const preFixInPlace = sha256(source);
  console.log(`pre-fix in place sha256: ${preFixInPlace}`);
  if (preFixInPlace !== fixtureSha) throw new Error("the pre-fix fixture was not installed correctly");

  console.log("\n--- running the concurrency suite against the round-3 pre-fix source ---\n");
  const run = spawnSync(process.execPath, ["--test", "--test-reporter=tap", testFile], {
    cwd: worktree,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  process.stdout.write(run.stdout ?? "");
  if (run.stderr) process.stderr.write(run.stderr);

  const results = tapResults(run.stdout ?? "");
  const failures = results.filter((result) => !result.ok);
  console.log(`\npre-fix run: ${results.length} tests, ${results.length - failures.length} pass, ${failures.length} fail`);
  for (const failure of failures) console.log(`FAIL: ${failure.name}`);

  const missingRed = REQUIRED_RED.filter(
    (name) => !failures.some((failure) => failure.name.includes(name)),
  );
  const vanishedGreen = REQUIRED_GREEN.filter(
    (name) => !results.some((result) => result.ok && result.name.includes(name)),
  );
  const unexpected = failures.filter(
    (failure) => !REQUIRED_RED.some((name) => failure.name.includes(name)),
  );

  if (missingRed.length > 0) {
    console.error("\nThe new guard did not turn red against the pre-fix source:");
    for (const name of missingRed) console.error(`  - ${name}`);
  } else {
    console.log(`\nRed as required: ${REQUIRED_RED[0]}`);
  }
  if (vanishedGreen.length > 0) {
    console.error("\nThe following earlier guards did not stay green:");
    for (const name of vanishedGreen) console.error(`  - ${name}`);
  } else {
    console.log(`All ${REQUIRED_GREEN.length} earlier guards stayed green (6 round 1 + round 2 takeover).`);
  }
  if (unexpected.length > 0) {
    console.error("\nUnexpected failures against the pre-fix source:");
    for (const failure of unexpected) console.error(`  - ${failure.name}`);
  }

  exitCode = missingRed.length === 0 && vanishedGreen.length === 0 && unexpected.length === 0 ? 0 : 1;
} finally {
  if (tempDir !== null) {
    const backup = join(tempDir, "ai.fixed.ts");
    try {
      if (sha256(backup) !== fixedSha) throw new Error("the byte backup no longer matches the fixed source");
      copyFileSync(backup, source);
      restored = sha256(source) === fixedSha;
    } catch (error) {
      console.error(`restore failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    rmSync(tempDir, { recursive: true, force: true });
  }
  const finalSha = sha256(source);
  console.log(`\nrestored ai.ts sha256: ${finalSha}`);
  console.log(`restored source matches the fixed bytes: ${restored ? "MATCH" : "MISMATCH"}`);
  console.log(`restored source differs from the pre-fix fixture: ${finalSha !== fixtureSha ? "yes" : "NO"}`);
  if (!restored) exitCode = 1;
}

process.exit(exitCode);
