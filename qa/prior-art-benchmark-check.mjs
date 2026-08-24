#!/usr/bin/env node
/**
 * beta-slice-2a invention benchmark validator (deterministic, offline).
 * Gate for fixtures/sanitized/search-benchmarks/invention-run.json and
 * docs/beta/benchmarks/invention-search-report.md (EP2845700A1 only).
 * Fails (exit 1) on: fixture/report missing or invalid; query count != 10;
 * > 40 dedup families; > 8 deep reads; family double-count (incl. EP family
 * merge must be exactly one slot); missing/mislabeled recovery anchors;
 * evidence-type mismatch; non-fresh-verified URL statuses; missing rerun
 * assertions/hashes; forbidden grant/FTO/legal language.
 * Extended to utility_model in beta-slice-2b.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RUN = join(ROOT, "fixtures", "sanitized", "search-benchmarks", "invention-run.json");
const REPORT = join(ROOT, "docs", "beta", "benchmarks", "invention-search-report.md");

const ANCHORS = ["FR742229A", "DE202006019957U1", "US20090308211A1", "US20110289784A1", "US20130183631A1"];
const FAMILY_MEMBERS = ["EP2845700A1", "EP2845700B1", "DK2845700T3", "DE202013104051U1"];
const QUERY_FAMILIES = ["keyword", "classification", "citation", "semantic_neighbor"];
const ENUM_EVIDENCE = ["examiner_citation", "applicant_background", "technical_neighbor"];
const RISK_LEVELS = ["low", "medium", "high"];
const FORBIDDEN_PATTERNS = [
  "grant probability",
  "likely to be granted",
  "授权概率高",
  "授权概率低",
  "授权概率为",
  "freedom to operate",
  "FTO clearance",
  "FTO 无风险",
  "legal opinion",
  "法律意见为"
];
const REQUIRED_DISCLAIMERS = ["不提供授权概率", "不表示穷尽"];
const REPORT_MARKERS = ["特征映射", "风险", "局限", "失败/缺口", "人工签核", "不提供授权概率", "不表示穷尽"];

const checks = [];
function check(name, ok, detail) {
  checks.push({ name, ok, detail });
  console.log("[" + (ok ? "PASS" : "FAIL") + "] " + name + (ok ? "" : " :: " + (detail || "")));
}
function sha256Hex(s) {
  return createHash("sha256").update(s, "utf8").digest("hex");
}
function verified200(v) {
  return !!(v && v.verified === true && v.statusCode === 200 &&
    typeof v.checkedAt === "string" && v.checkedAt.length > 0);
}
function finish() {
  const total = checks.length;
  const failed = checks.filter((c) => !c.ok).length;
  console.log("Result: " + (total - failed) + "/" + total + " PASS");
  if (failed > 0) {
    console.error("Blocking: " + failed + " check(s) failed. beta-slice-2a artifacts not acceptable.");
    process.exit(1);
  }
  console.log("GREEN: beta-slice-2a invention artifacts deterministic and protocol-compliant.");
  process.exit(0);
}

console.log("prior-art-benchmark-check (beta-slice-2a invention validator)");
console.log("root: " + ROOT);

if (!existsSync(RUN)) {
  check("run fixture exists", false, "missing fixtures/sanitized/search-benchmarks/invention-run.json");
  finish();
}

let doc;
try {
  doc = JSON.parse(readFileSync(RUN, "utf8"));
  check("run fixture parses as JSON", true);
} catch (e) {
  check("run fixture parses as JSON", false, e.message);
  finish();
}
check("run fixture is a JSON object", !!doc && typeof doc === "object" && !Array.isArray(doc));
check("caseId references EP2845700 benchmark", typeof doc.caseId === "string" && /EP2845700/i.test(doc.caseId));
check("type is invention", doc.type === "invention");
check("slice identifies beta-slice-2a", typeof doc.slice === "string" && doc.slice.includes("beta-slice-2a"));

// ---- 1) queries: exactly 10, four protocol families covered ----
const q = doc.queryRecords;
check("queryRecords is an array", Array.isArray(q));
if (Array.isArray(q)) {
  check("exactly 10 query records", q.length === 10, "got " + q.length);
  const ids = q.map((r) => r && r.queryId);
  check("queryIds unique Q01..Q10", ids.length === 10 &&
    ids.every((v, i) => v === "Q" + String(i + 1).padStart(2, "0")), JSON.stringify(ids));
  const fams = new Set(q.map((r) => r && r.family));
  const missingFams = QUERY_FAMILIES.filter((f) => !fams.has(f));
  check("all four query families covered", missingFams.length === 0, "missing: " + missingFams.join(","));
  const recOk = q.every((r) => r && typeof r.queryText === "string" && r.queryText.trim().length > 0 &&
    typeof r.database === "string" && r.database.trim().length > 0 &&
    typeof r.runAt === "string" && r.runAt.length > 0 &&
    typeof r.hitCount === "number" && r.hitCount >= 0);
  check("query record fields valid", recOk);
  const qIds = new Set(ids);
  if (Array.isArray(doc.evidenceRecovery)) {
    const badRefs = doc.evidenceRecovery.filter((e) => !(Array.isArray(e.recoveredByQuery) && e.recoveredByQuery.every((x) => qIds.has(x))));
    check("recoveredByQuery references valid queryIds", badRefs.length === 0);
  }
}

// ---- 2) families: <= 40, unique, no double count, EP merge one slot ----
const fam = doc.deduplicatedFamilies;
check("deduplicatedFamilies is an array", Array.isArray(fam));
if (Array.isArray(fam)) {
  check("family count <= 40", fam.length <= 40, "got " + fam.length);
  check("family count >= 1", fam.length >= 1);
  const ids = fam.map((f) => f && f.familyId);
  check("familyId unique", ids.length === new Set(ids).size, "duplicate familyId");
  const memberCounts = {};
  let dup = false;
  let shapeOk = true;
  for (const f of fam) {
    if (!(f && typeof f.familyId === "string" && typeof f.representative === "string" && Array.isArray(f.members) && f.members.length > 0)) shapeOk = false;
    if (f && Array.isArray(f.members)) {
      for (const m of f.members) {
        if (memberCounts[m]) dup = true;
        memberCounts[m] = (memberCounts[m] || 0) + 1;
      }
    }
  }
  check("family entries well-formed", shapeOk);
  check("no publication in more than one family", !dup, "family double count");
  const epFams = fam.filter((f) => Array.isArray(f.members) && FAMILY_MEMBERS.every((m) => f.members.includes(m)));
  check("EP2845700 family merge exactly one slot", epFams.length === 1, "got " + epFams.length);
  if (epFams.length === 1) {
    const f = epFams[0];
    check("merged family member count >= 4", f.members.length >= FAMILY_MEMBERS.length, "got " + f.members.length);
    check("merged family evidence url https", typeof f.familyEvidence === "string" && f.familyEvidence.startsWith("https://"));
    check("merged family evidence source recorded", typeof f.familyEvidenceSource === "string" && f.familyEvidenceSource.trim().length > 0);
    check("merged family limitations recorded", typeof f.limitations === "string" && f.limitations.trim().length > 0);
    check("merged family url fresh-verified 200 (first + rerun)",
      verified200(f.familyUrlFirstRun) && verified200(f.familyUrlRerun));
  }
}

// ---- 3) deep reads: <= 8, mapped to families ----
const dr = doc.deepReads;
check("deepReads is an array", Array.isArray(dr));
if (Array.isArray(dr)) {
  check("deep reads <= 8", dr.length <= 8, "got " + dr.length);
  const drOk = dr.every((d) => d && typeof d.identifier === "string" && d.identifier.trim().length > 0 &&
    typeof d.familyId === "string" && d.familyId.trim().length > 0 &&
    typeof d.featureMatrix === "string" && d.featureMatrix.trim().length > 0 &&
    RISK_LEVELS.includes(d.riskLevel));
  check("deep read fields valid", drOk);
  if (Array.isArray(fam)) {
    const famIds = new Set(fam.map((f) => f && f.familyId));
    check("deep reads map to dedup families", dr.every((d) => famIds.has(d.familyId)));
  }
}

// ---- 4) anchors: 5 recovered, typed examiner_citation, no dup ----
const er = doc.evidenceRecovery;
check("evidenceRecovery is an array", Array.isArray(er));
if (Array.isArray(er)) {
  const counts = {};
  const types = {};
  for (const e of er) {
    if (e && typeof e.identifier === "string") {
      counts[e.identifier] = (counts[e.identifier] || 0) + 1;
      types[e.identifier] = e.evidenceType;
    }
  }
  const missingAnchors = ANCHORS.filter((a) => !counts[a]);
  check("all 5 examiner anchors recovered", missingAnchors.length === 0, "missing: " + missingAnchors.join(","));
  check("no anchor double-counted", ANCHORS.every((a) => counts[a] === 1), "anchor double count");
  const wrongType = ANCHORS.filter((a) => types[a] !== "examiner_citation");
  check("anchors typed examiner_citation", wrongType.length === 0, "wrong type: " + wrongType.join(","));
  const typeOk = er.every((e) => e && ENUM_EVIDENCE.includes(e.evidenceType));
  check("evidenceType in enum", typeOk, "strict three-state enum");
  const urlOk = er.every((e) => e && typeof e.evidenceUrl === "string" && e.evidenceUrl.startsWith("https://"));
  check("evidence urls https", urlOk);
  const notFresh = er.filter((e) => !(verified200(e.firstRunUrlCheck) && verified200(e.rerunUrlCheck)));
  check("every evidence url fresh-verified 200 (first + rerun)", notFresh.length === 0,
    "not fresh: " + notFresh.map((e) => e.identifier).join(","));
}

// ---- 5) urlVerification summary ----
const uv = doc.urlVerification;
check("urlVerification array present", Array.isArray(uv));
if (Array.isArray(uv) && Array.isArray(er)) {
  const urls = new Set(uv.map((u) => u && u.url));
  const missingUrls = er.map((e) => e.evidenceUrl).filter((u) => !urls.has(u));
  check("all evidence urls listed in urlVerification", missingUrls.length === 0, "missing: " + missingUrls.join(","));
  const vOk = uv.every((u) => u && typeof u.url === "string" && u.url.startsWith("https://") &&
    (u.statusCode === 200 || u.statusCode === 403 || u.statusCode === 404 || u.statusCode === 0));
  check("urlVerification entries well-formed", vOk);
}

// ---- 6) rerun: identical inputs, stable assertions, deterministic hashes ----
const rr = doc.rerun;
if (rr && rr.firstRun && rr.rerun) {
  check("rerun first-run timestamp recorded", typeof rr.firstRun.at === "string" && rr.firstRun.at.length > 0);
  check("rerun rerun timestamp recorded", typeof rr.rerun.at === "string" && rr.rerun.at.length > 0);
  check("rerun inputs identical", typeof rr.firstRun.inputsHash === "string" && rr.firstRun.inputsHash === rr.rerun.inputsHash);
  check("rerun stable assertions declared", rr.assertionsStable === true);
  check("rerun ordering drift disclosed", typeof rr.orderingDriftDisclosure === "string" && rr.orderingDriftDisclosure.trim().length > 0);
  const computed = {
    queryRecordsHash: sha256Hex(JSON.stringify(doc.queryRecords)),
    familiesHash: sha256Hex(JSON.stringify(doc.deduplicatedFamilies)),
    deepReadsHash: sha256Hex(JSON.stringify(doc.deepReads))
  };
  const h = (rr.hashes || {});
  check("queryRecords hash matches content", h.queryRecordsHash === computed.queryRecordsHash, computed.queryRecordsHash);
  check("families hash matches content", h.familiesHash === computed.familiesHash, computed.familiesHash);
  check("deepReads hash matches content", h.deepReadsHash === computed.deepReadsHash, computed.deepReadsHash);
} else {
  check("rerun section present with firstRun/rerun", false, "rerun block missing");
}

// ---- 7) forbidden legal claims + required disclaimers ----
const fullText = readFileSync(RUN, "utf8");
const forbiddenHits = FORBIDDEN_PATTERNS.filter((p) => fullText.includes(p));
check("no forbidden grant/FTO/legal-claim language", forbiddenHits.length === 0, "found: " + forbiddenHits.join(","));
const disOk = REQUIRED_DISCLAIMERS.every((d) => fullText.includes(d));
check("disclaimers present (no grant prob / no exhaustive guarantee)", disOk);

// ---- 8) verdict, human signoff, limitations, failure/gap log ----
check("verdict explicit go/conditional_go/no_go", ["go", "conditional_go", "no_go"].includes(doc.verdict), "got " + doc.verdict);
const hs = doc.humanSignoff;
check("humanSignoff recorded", !!(hs && typeof hs.retriever === "string" && hs.retriever.trim().length > 0 &&
  typeof hs.checkDate === "string" && Array.isArray(hs.items) && hs.items.length >= 5));
check("limitations array non-empty", Array.isArray(doc.limitations) && doc.limitations.length > 0 &&
  doc.limitations.every((s) => typeof s === "string" && s.trim().length > 0));
check("failureGapLog array present", Array.isArray(doc.failureGapLog));

// ---- 9) report gate ----
if (!existsSync(REPORT)) {
  check("invention search report exists", false, "missing docs/beta/benchmarks/invention-search-report.md");
} else {
  check("invention search report exists", true);
  const rep = readFileSync(REPORT, "utf8");
  const missingMarkers = REPORT_MARKERS.filter((m) => !rep.includes(m));
  check("report contains required sections/disclaimers", missingMarkers.length === 0, "missing: " + missingMarkers.join(","));
  const repForbidden = FORBIDDEN_PATTERNS.filter((p) => rep.includes(p));
  check("report free of forbidden legal claims", repForbidden.length === 0, "found: " + repForbidden.join(","));
}

finish();
