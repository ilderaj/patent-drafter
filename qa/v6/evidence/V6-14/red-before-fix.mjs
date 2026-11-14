#!/usr/bin/env node
/**
 * V6-14 red-before-fix proof.
 *
 * For each guard, install a pre-fix fixture of `targets.ts` with exactly that
 * guard disabled, run the V6-14 suite, and require the named guard tests to go
 * red. The final source is restored byte for byte after every fixture (and in
 * `finally`), its sha256 is checked against the value read at start, and the
 * suite is run green once more on the restored file.
 *
 * Usage: node qa/v6/evidence/V6-14/red-before-fix.mjs > qa/v6/evidence/V6-14/red-before-fix.txt
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const TARGET = join(ROOT, "apps/web/src/v6/features/targets/targets.ts");
const SUITE = join(ROOT, "qa/v6/scenarios/V6-14");
const FILES = readdirSync(SUITE)
  .filter((file) => file.endsWith(".test.mjs"))
  .sort()
  .map((file) => join(SUITE, file));

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const original = readFileSync(TARGET);
const originalSha = sha256(original);

const GUARDS = [
  {
    name: "EP rejection",
    before: `  if (route.trim().toUpperCase() === "EP" || route.trim().toLowerCase() === "european") {
    return { path: "route", reason: EP_ROUTE_MESSAGE };
  }`,
    after: `  // PRE-FIX: EP is not singled out.`,
    expectRed: [
      "V6-14-A01 refuses EP and unknown routes with INVALID_INPUT and writes nothing",
      "V6-14-A02 update refuses EP without touching either target",
    ],
  },
  {
    name: "per-target isolation",
    before: `targets: latest.targets.map((item) => (item.id === targetId ? updated : item)),`,
    after: `targets: latest.targets.map((item) => (item.id === targetId ? updated : { ...item, configVersion: item.configVersion + 1 })),`,
    expectRed: [
      "V6-14-A02 updating target A bumps only A's configVersion; B's config and version are unchanged",
    ],
  },
  {
    name: "recommendation rule (method excludes cn_um)",
    before: `      recommend: [],
      exclude: ["cn_um"],
      triggers: factTriggers(methodFacts),`,
    after: `      recommend: [],
      exclude: [],
      triggers: factTriggers(methodFacts),`,
    expectRed: [
      "S03-A09 a method fact excludes cn_um and names the triggering rule and fact",
      "S03-A09 the method rule and its triggering fact are shown on the trace and the cn_um card",
    ],
  },
  {
    name: "unverified number suppression",
    before: `  return { value: verified ? value : null, note: verified ? note : null, verified, label };`,
    after: `  return { value, note, verified: value !== null, label };`,
    // The R1 pack carries no numbers at all, so only tests with a synthetic
    // pack that holds numbers on unverified entries can see this guard.
    expectRed: [
      "S03-A07 numbers appear only for a verified rule entry",
      "S03-A07 a verified rule entry shows its numbers on that card only",
    ],
  },
  {
    name: "language gating (en-US needs translation_en)",
    before: `      disabled: translation?.state !== "available",`,
    after: `      disabled: false,`,
    expectRed: [
      "S03-A08 en-US is disabled with a visible reason unless translation_en is available",
      "en-US is refused at write time while translation_en is unavailable",
      "S03-A08 US and PCT cards show the exact handoff sentence; en-US is disabled with its reason",
    ],
  },
];

function runSuite() {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const run = spawnSync(process.execPath, ["--test", "--test-reporter=tap", ...FILES], {
    cwd: ROOT,
    encoding: "utf8",
    env,
  });
  const out = run.stdout ?? "";
  const failed = [...out.matchAll(/^\s*not ok \d+ - (.+)$/gm)].map((match) => match[1].trim());
  const count = (key) => Number(new RegExp(`^# ${key} (\\d+)$`, "m").exec(out)?.[1] ?? NaN);
  return { status: run.status, failed, tests: count("tests"), pass: count("pass"), fail: count("fail") };
}

function restore() {
  writeFileSync(TARGET, original);
  const now = sha256(readFileSync(TARGET));
  if (now !== originalSha) throw new Error(`restore mismatch: ${now} != ${originalSha}`);
  return now;
}

const log = [];
const say = (line = "") => {
  log.push(line);
  console.log(line);
};
let verdict = true;

say("V6-14 red-before-fix");
say(`started ${new Date().toISOString()}`);
say(`file ${TARGET.slice(ROOT.length + 1)}`);
say(`final sha256 at start ${originalSha}`);
say(`suite ${FILES.map((file) => file.slice(ROOT.length + 1)).join(", ")}`);
say();

try {
  for (const guard of GUARDS) {
    const source = original.toString("utf8");
    const first = source.indexOf(guard.before);
    if (first < 0 || source.indexOf(guard.before, first + 1) >= 0) {
      throw new Error(`guard "${guard.name}": anchor not found exactly once`);
    }
    const fixture = source.replace(guard.before, () => guard.after);
    writeFileSync(TARGET, fixture);
    const fixtureSha = sha256(Buffer.from(fixture, "utf8"));
    const result = runSuite();
    const restoredSha = restore();
    const missing = guard.expectRed.filter((name) => !result.failed.includes(name));
    const red = result.status !== 0 && missing.length === 0;
    if (!red) verdict = false;
    say(`== guard: ${guard.name}`);
    say(`pre-fix fixture sha256 ${fixtureSha}`);
    say(`suite exit=${result.status} tests=${result.tests} pass=${result.pass} fail=${result.fail}`);
    for (const name of guard.expectRed) {
      say(`  ${result.failed.includes(name) ? "RED" : "MISSING-RED"}  ${name}`);
    }
    const extra = result.failed.filter((name) => !guard.expectRed.includes(name));
    for (const name of extra) say(`  also red  ${name}`);
    say(`restored sha256 ${restoredSha} ${restoredSha === originalSha ? "(matches final)" : "(MISMATCH)"}`);
    say(`verdict ${red ? "named guards red as expected" : "FAILED: named guards not all red"}`);
    say();
  }
} finally {
  restore();
}

const green = runSuite();
const finalSha = sha256(readFileSync(TARGET));
say("== final source restored");
say(`sha256 ${finalSha} ${finalSha === originalSha ? "(matches final at start)" : "(MISMATCH)"}`);
say(`suite exit=${green.status} tests=${green.tests} pass=${green.pass} fail=${green.fail}`);
if (green.status !== 0 || finalSha !== originalSha) verdict = false;
say(`overall ${verdict ? "PASS" : "FAIL"}`);
say(`finished ${new Date().toISOString()}`);
process.exitCode = verdict ? 0 : 1;
