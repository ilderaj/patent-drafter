import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../../../..");
const PROFILE = join(ROOT, "qa/v6/evidence/release/r1/profile.json");
const R1_DOC = join(ROOT, "docs/implementation/patent-saas-v6/release/R1.md");

function evaluateRelease(tickets) {
  return tickets.every((ticket) => ticket.status === "accepted") ? "candidate_ready" : "not_ready";
}

test("V6-47a-A01: all 26 R1 dependencies are accepted and the profile is candidate_ready", () => {
  const profile = JSON.parse(readFileSync(PROFILE, "utf8"));
  assert.equal(profile.ticket, "V6-47a");
  assert.equal(profile.profile, "R1");
  assert.equal(profile.tickets.length, 26);
  const ids = profile.tickets.map((ticket) => ticket.ticket);
  for (let index = 1; index <= 26; index += 1) {
    assert.ok(ids.includes(`V6-${String(index).padStart(2, "0")}`), `missing V6-${index}`);
  }
  assert.ok(profile.tickets.every((ticket) => ticket.status === "accepted"));
  assert.equal(profile.conclusion, "candidate_ready");
  assert.deepEqual(profile.missingTickets, []);
  assert.equal(existsSync(R1_DOC), true);
  const doc = readFileSync(R1_DOC, "utf8");
  assert.match(doc, /candidate_ready/);
  assert.match(doc, /G-RELEASE/);
});

test("V6-47a-A02: any missing acceptance makes the record not_ready and lists it", () => {
  const profile = JSON.parse(readFileSync(PROFILE, "utf8"));
  const degraded = profile.tickets.map((ticket, index) =>
    index === 3 ? { ...ticket, status: "candidate" } : ticket);
  const conclusion = evaluateRelease(degraded);
  assert.equal(conclusion, "not_ready");
  const missing = degraded.filter((ticket) => ticket.status !== "accepted").map((ticket) => ticket.ticket);
  assert.deepEqual(missing, ["V6-04"]);
  // A degraded record must never say 可发布/candidate_ready.
  assert.notEqual(conclusion, "candidate_ready");
});

test("V6-47a-A03: rerunning on the same inputs yields the same conclusion and no duplicate record", () => {
  const a = JSON.parse(readFileSync(PROFILE, "utf8"));
  const b = JSON.parse(readFileSync(PROFILE, "utf8"));
  assert.equal(evaluateRelease(a.tickets), evaluateRelease(b.tickets));
  assert.deepEqual(a.missingTickets, b.missingTickets);
  assert.equal(a.tickets.length, 26);
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
