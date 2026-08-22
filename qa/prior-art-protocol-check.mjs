#!/usr/bin/env node
/**
 * Slice 1 deterministic validator: search protocol + historical benchmark selection.
 * - Fails on missing files, invalid schema, or protocol omissions (exit 1).
 * - Passes completed artifacts with an explicit count (exit 0).
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const checks = [];
function check(name, ok, detail) {
  checks.push({ name, ok });
  console.log("[" + (ok ? "PASS" : "FAIL") + "] " + name + (!ok && detail ? " :: " + detail : ""));
}

const FILES = {
  protocol: "docs/beta/search-protocol.md",
  selection: "docs/beta/historical-benchmark-selection.md",
  invention: "fixtures/sanitized/search-benchmarks/invention.json",
  utilityModel: "fixtures/sanitized/search-benchmarks/utility-model.json",
};

console.log("prior-art-protocol-check (deterministic slice-1 gate)");
console.log("root: " + ROOT);

// 1) file presence
for (const rel of Object.values(FILES)) {
  const abs = join(ROOT, rel);
  const ok = existsSync(abs);
  check("file exists: " + rel, ok, ok ? "" : "missing file");
}

const ENUM_TYPE = ["invention", "utility_model"];
const ENUM_EVIDENCE = ["examiner_citation", "applicant_background", "technical_neighbor"];

function validateBenchmark(rel) {
  const abs = join(ROOT, rel);
  if (!existsSync(abs)) return;
  let doc;
  try {
    doc = JSON.parse(readFileSync(abs, "utf8"));
  } catch (e) {
    check("json parse: " + rel, false, e.message);
    return;
  }
  check("json object: " + rel, doc && typeof doc === "object" && !Array.isArray(doc), "not an object");

  const fieldTypes = {
    caseId: "string",
    type: "string",
    title: "string",
    publicationIdentifiers: "array",
    publicSourceUrls: "array",
    knownClosePriorArt: "array",
  };
  for (const k of Object.keys(fieldTypes)) {
    const v = doc[k];
    const t = fieldTypes[k];
    const ok = t === "string"
      ? typeof v === "string" && v.trim().length > 0
      : Array.isArray(v) && v.length > 0;
    check("schema " + rel + ": " + k, ok, ok ? "" : "missing or invalid " + k);
  }

  check("schema " + rel + ": type enum", ENUM_TYPE.includes(doc.type), "got " + doc.type);
  check(
    "schema " + rel + ": publicationIdentifiers non-empty strings",
    doc.publicationIdentifiers.every((x) => typeof x === "string" && x.trim().length > 0),
    "empty entries"
  );
  check(
    "schema " + rel + ": publicSourceUrls https",
    doc.publicSourceUrls.every((x) => typeof x === "string" && /^https:\/\//.test(x)),
    "non-https or malformed entry"
  );

  for (let i = 0; i < doc.knownClosePriorArt.length; i++) {
    const p = doc.knownClosePriorArt[i];
    const missing = [];
    if (!(p && typeof p.identifier === "string" && p.identifier.trim().length > 0)) missing.push("identifier");
    if (!(p && ENUM_EVIDENCE.includes(p.evidenceType))) missing.push("evidenceType");
    if (!(p && typeof p.evidenceUrl === "string" && /^https:\/\//.test(p.evidenceUrl))) missing.push("evidenceUrl");
    if (!(p && Array.isArray(p.expectedRecoveryAssertions) && p.expectedRecoveryAssertions.length > 0 &&
      p.expectedRecoveryAssertions.every((s) => typeof s === "string" && s.trim().length > 0)))
      missing.push("expectedRecoveryAssertions");
    if (!(p && typeof p.dataProvenance === "string" && p.dataProvenance.trim().length > 0)) missing.push("dataProvenance");
    if (!(p && typeof p.sanitizationNote === "string" && p.sanitizationNote.trim().length > 0)) missing.push("sanitizationNote");
    const ok = missing.length === 0;
    check(
      "schema " + rel + ": knownClosePriorArt[" + i + "] " + (p && p.identifier ? p.identifier : "?"),
      ok,
      ok ? "" : "missing fields: " + missing.join(", ")
    );
  }
  check("schema " + rel + ": knownClosePriorArt non-empty", doc.knownClosePriorArt.length > 0);
}

validateBenchmark(FILES.invention);
validateBenchmark(FILES.utilityModel);

const PROTOCOL_MARKERS = [
  "CN", "WIPO", "US", "EP",
  "仅限专利文献",
  "排除项",
  "非专利文献",
  "查询族",
  "10 条查询式",
  "40 个去重专利族",
  "8 篇",
  "去重",
  "证据类型",
  "特征映射",
  "风险",
  "局限",
  "失败/缺口",
  "人工签核",
  "不提供授权概率、FTO 或法律意见",
  "不表示穷尽",
];

const SELECTION_MARKERS = [
  "评分标准",
  "客观",
  "发明",
  "实用新型",
  "examiner_citation",
  "applicant_background",
  "technical_neighbor",
  "局限",
  "US7717017B2",
  "link.epo.org",
  "register.epo.org",
  "403",
  "Slice 2",
  "恢复",
  "不表示穷尽",
];

function checkDocMarkers(rel, markers, label) {
  const abs = join(ROOT, rel);
  if (!existsSync(abs)) return;
  const text = readFileSync(abs, "utf8");
  for (const m of markers) {
    const ok = text.includes(m);
    check(label + ": marker " + m, ok, ok ? "" : "missing marker");
  }
}

checkDocMarkers(FILES.protocol, PROTOCOL_MARKERS, "protocol");
checkDocMarkers(FILES.selection, SELECTION_MARKERS, "selection");

const total = checks.length;
const failed = checks.filter((c) => !c.ok).length;
console.log("Result: " + (total - failed) + "/" + total + " PASS");
if (failed > 0) {
  console.error("Blocking: " + failed + " check(s) failed. Slice-1 artifacts incomplete or schema-invalid.");
  process.exit(1);
}
console.log("GREEN: slice-1 artifacts complete and deterministic.");
process.exit(0);
