import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(OUT, "../../../..");
const runs = [
  ...["V6-18", "V6-17", "V6-16", "V6-15", "V6-14", "V6-10", "V6-08", "V6-05"].map((ticket) => ({
    name: ticket,
    args: ["--prefix", ROOT, "run", "test:v6", "--", ticket],
  })),
  {
    name: "workspace",
    args: ["--prefix", ROOT, "test", "--workspaces", "--if-present"],
  },
];
let failed = false;
const sections = [];
for (const run of runs) {
  const result = spawnSync("npm", run.args, { cwd: ROOT, encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  const status = result.status ?? 1;
  if (status !== 0) failed = true;
  sections.push([
    `## ${run.name}`,
    `$ npm ${run.args.join(" ")}`,
    `exitCode: ${status}`,
    output.trimEnd(),
  ].join("\n"));
}
writeFileSync(resolve(OUT, "regression.txt"), `${sections.join("\n\n")}\n`);
console.log(`Saved ${runs.length} regression runs; ${failed ? "one or more failed" : "all passed"}.`);
if (failed) process.exitCode = 1;
