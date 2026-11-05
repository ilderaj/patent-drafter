import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../../../..");
const PROFILE = join(ROOT, "qa/v6/evidence/release/r1/profile.json");
const R1_DOC = join(ROOT, "docs/implementation/patent-saas-v6/release/R1.md");

function evaluateRelease(tickets, gates) {
  const missingTickets = tickets
    .filter((ticket) => ticket.status !== "accepted")
    .map((ticket) => ticket.ticket);
  const missingGates = ["G-RELEASE"].filter(
    (gate) => gates?.[gate]?.status !== "satisfied_for_r1_candidate",
  );
  return {
    conclusion: missingTickets.length === 0 && missingGates.length === 0
      ? "candidate_ready"
      : "not_ready",
    missingTickets,
    missingGates,
  };
}

function readClosure() {
  return Array.from({ length: 26 }, (_, index) => {
    const id = String(index + 1).padStart(2, "0");
    const file = id === "01"
      ? join(ROOT, "qa/v6/baseline/receipt.json")
      : join(ROOT, "qa/v6/evidence", `V6-${id}`, "receipt.json");
    const receipt = JSON.parse(readFileSync(file, "utf8"));
    return { ticket: `V6-${id}`, status: receipt.status, baseCommit: receipt.baseCommit ?? null };
  });
}

test("V6-47a-A01: all 26 R1 dependencies are accepted, G-RELEASE is satisfied and the profile is candidate_ready", () => {
  const profile = JSON.parse(readFileSync(PROFILE, "utf8"));
  assert.equal(profile.ticket, "V6-47a");
  assert.equal(profile.profile, "R1");
  assert.equal(profile.tickets.length, 26);
  const closure = readClosure();
  assert.deepEqual(profile.tickets.map((t) => ({ ticket: t.ticket, status: t.status, baseCommit: t.baseCommit })), closure);
  assert.equal(profile.conclusion, "candidate_ready");
  assert.deepEqual(profile.missingTickets, []);
  assert.deepEqual(profile.missingGates, []);
  assert.equal(existsSync(R1_DOC), true);
  const doc = readFileSync(R1_DOC, "utf8");
  assert.match(doc, /candidate_ready/);
  assert.match(doc, /G-RELEASE/);
  assert.match(doc, /R1 出口条件映射/);
});

test("V6-47a-A02: a missing acceptance OR a closed G-RELEASE makes the record not_ready", () => {
  const profile = JSON.parse(readFileSync(PROFILE, "utf8"));
  const degraded = profile.tickets.map((ticket, index) =>
    index === 3 ? { ...ticket, status: "candidate" } : ticket);
  const degradedResult = evaluateRelease(degraded, profile.gates);
  assert.equal(degradedResult.conclusion, "not_ready");
  assert.deepEqual(degradedResult.missingTickets, ["V6-04"]);
  assert.deepEqual(degradedResult.missingGates, []);

  const closedGate = structuredClone(profile);
  closedGate.gates["G-RELEASE"].status = "closed";
  const closedResult = evaluateRelease(closedGate.tickets, closedGate.gates);
  assert.equal(closedResult.conclusion, "not_ready");
  assert.deepEqual(closedResult.missingTickets, []);
  assert.deepEqual(closedResult.missingGates, ["G-RELEASE"]);

  const missingGate = structuredClone(profile);
  delete missingGate.gates["G-RELEASE"];
  const missingGateResult = evaluateRelease(missingGate.tickets, missingGate.gates);
  assert.equal(missingGateResult.conclusion, "not_ready");
  assert.deepEqual(missingGateResult.missingTickets, []);
  assert.deepEqual(missingGateResult.missingGates, ["G-RELEASE"]);
});

test("V6-47a-A03: regenerating the closure from receipts twice yields the same conclusion and no duplicate rows", () => {
  const profile = JSON.parse(readFileSync(PROFILE, "utf8"));
  const first = readClosure();
  const second = readClosure();
  assert.deepEqual(first, second);
  assert.deepEqual(evaluateRelease(first, profile.gates), evaluateRelease(second, profile.gates));
  assert.equal(evaluateRelease(first, profile.gates).conclusion, profile.conclusion);
  assert.deepEqual(evaluateRelease(first, profile.gates).missingTickets, profile.missingTickets);
  assert.deepEqual(evaluateRelease(first, profile.gates).missingGates, profile.missingGates);
  assert.equal(new Set(first.map((row) => row.ticket)).size, 26);
});

test("V6-47a-A03b: each gate row names an owner, an evidence source and a validity scope", () => {
  const profile = JSON.parse(readFileSync(PROFILE, "utf8"));
  for (const [gate, row] of Object.entries(profile.gates)) {
    assert.ok(row.owners.length > 0, `${gate} has no owner`);
    assert.ok(row.evidence.length > 0, `${gate} has no evidence source`);
    assert.ok(row.evidence.every((entry) => entry.trim().length > 0), `${gate} has an empty evidence entry`);
    assert.match(row.validity, /not_applicable|Valid for the R1 candidate/, `${gate} has no validity scope`);
  }
});

test("V6-47a: the profile contains no cloud tickets or charged capabilities", () => {
  const profile = JSON.parse(readFileSync(PROFILE, "utf8"));
  for (const ticket of profile.tickets) {
    const number = Number(ticket.ticket.slice(3));
    assert.ok(number <= 26, `${ticket.ticket} is a cloud/R2+ ticket`);
  }
  assert.equal(profile.gates["G-MODEL"].status, "closed");
  assert.equal(profile.gates["G-XML"].status, "closed");
  assert.equal(profile.gates["G-RULES"].status, "closed");
});
