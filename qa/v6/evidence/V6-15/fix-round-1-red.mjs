/**
 * V6-15 fix round 1 — red before fix.
 *
 * Swaps the fixed ai.ts for the exact pre-fix source, runs the new concurrency
 * suite, asserts the named guards fail, then restores the fixed file from a
 * byte backup and proves restoration by SHA-256. Exit 0 only when every guard
 * was red and the source was restored byte for byte.
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
const fixture = join(here, "fix-round-1-prefix-ai.txt");
const testFile = join(worktree, "qa/v6/scenarios/V6-15/ai-consent-concurrency.test.mjs");

const REQUIRED_RED = [
  "identical concurrent grants both succeed with one creation and equal results",
  "revoke same key with different consentIds gets one winner and one conflict",
  "a grant whose finalize fails after commit replays the original response",
  "a revoke whose finalize fails after commit replays the original response",
  "cleanup cannot delete a consent row whose granted event survived",
  "a live claim makes an identical request wait, then report busy, then replay",
];

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

  tempDir = mkdtempSync(join(tmpdir(), "v6-15-fix-round-1-"));
  const backup = join(tempDir, "ai.fixed.ts");
  copyFileSync(source, backup);
  if (sha256(backup) !== fixedSha) throw new Error("backup copy does not match the fixed source");

  copyFileSync(fixture, source);
  const preFixInPlace = sha256(source);
  console.log(`pre-fix in place sha256: ${preFixInPlace}`);
  if (preFixInPlace !== fixtureSha) throw new Error("the pre-fix fixture was not installed correctly");

  console.log("\n--- running the concurrency suite against the pre-fix source ---\n");
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
  for (const failure of failures) console.log(`FAIL (expected red): ${failure.name}`);

  const missing = REQUIRED_RED.filter(
    (name) => !failures.some((failure) => failure.name.includes(name)),
  );
  if (missing.length > 0) {
    console.error("\nThe following guards did not turn red against the pre-fix source:");
    for (const name of missing) console.error(`  - ${name}`);
  } else {
    console.log(`\nAll ${REQUIRED_RED.length} required guards were red against the pre-fix source.`);
  }
  exitCode = missing.length === 0 ? 0 : 1;
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
