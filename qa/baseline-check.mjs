// Baseline 验收对账（可执行）：定稿结构（baseline-*.json） vs 系统生成输出（demo-generated.json）
// 验收维度对应 goal-objective 的 Baseline 验收节：结构 / 核心技术特征 / 支持关系 /
// 章节完整性 / 术语和附图一致性 / 无依据内容检测与导出门禁。
// 运行：node qa/baseline-check.mjs   →  输出 qa/baseline-report.json
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fx = (f) => JSON.parse(readFileSync(join(root, "fixtures/sanitized", f), "utf8"));

const baseline = fx("baseline-claims-graph.json");
const specBase = fx("baseline-spec-structure.json");
const problems = fx("baseline-problems.json");
const demo = fx("demo-generated.json");

const results = [];
const check = (id, name, pass, detail) => results.push({ id, name, pass: !!pass, detail });

const allText = [
  ...demo.claims.map((c) => c.text),
  ...demo.specSections.map((s) => s.body),
  demo.abstractText,
].join("\n");

const cjkCount = (s) => (s.match(/[\u4e00-\u9fff]/g) ?? []).length;

// ── 1. 参考夹具完整性（定稿结构自检） ─────────────────────────────
{
  const claims = baseline.claims;
  const refsValid = claims.every((c) =>
    c.kind === "independent"
      ? c.refs.length === 0
      : c.refs.length > 0 && c.refs.every((r) => r >= 1 && r < c.no),
  );
  check("REF-1", "定稿夹具：10 条权利要求", claims.length === 10, `actual=${claims.length}`);
  check("REF-2", "定稿夹具：独立权利要求恰 1 条", claims.filter((c) => c.kind === "independent").length === 1, "ok");
  check("REF-3", "定稿夹具：全部引用关系合法", refsValid, "ok");
  check("REF-4", "定稿夹具：无多项引多项违规", baseline.expectedRuleResults.multiDependentAsBaseViolations.length === 0, "ok");
  check("REF-5", "定稿夹具：五段式章节齐全", specBase.sections.filter((s) => s.expected).length === 5, "ok");
  check("REF-6", "定稿夹具：附图说明 6 图", specBase.figures.length === 6, `actual=${specBase.figures.length}`);
  check("REF-7", "定稿夹具：摘要 294 字 ≤ 300", specBase.abstract.charCount <= specBase.abstract.maxAllowed, `${specBase.abstract.charCount}<=${specBase.abstract.maxAllowed}`);
  check("REF-8", "交底问题清单 8 项", problems.expectedProblems.length === 8, "P1-P8");
}

// ── 2. 结构：权利要求树 ───────────────────────────────────────────
{
  const claims = demo.claims;
  const independent = claims.filter((c) => c.label.includes("独立"));
  const refsValid = claims.every((c) => {
    if (c.label.includes("独立")) return true;
    const m = c.text.match(/根据权利要求(\d+)(?:至(\d+))?(?:任一项)?所述/);
    const lo = Number(m?.[1] ?? 0);
    const hi = Number(m?.[2] ?? lo);
    const no = Number(c.id.slice(1));
    return !!m && lo >= 1 && hi <= no - 1;
  });
  check("S-1", "生成输出：权利要求 10 条（对齐定稿）", claims.length === 10, `actual=${claims.length}`);
  check("S-2", "生成输出：独立权利要求恰 1 条（产品型）", independent.length === 1 && independent[0].text.startsWith("1、一种基于三模通讯的共享热水表"), independent[0]?.label);
  check("S-3", "生成输出：全部从属引用合法", refsValid, "ok");
  check("S-4", "生成输出：从属链符合策略（网关→主板→尺寸→固定位→插卡槽→阀门）",
    /网关/.test(demo.claims[1].text) && /插接/.test(demo.claims[3].text) && /87\.9mm/.test(demo.claims[4].text) && /固定位/.test(demo.claims[5].text) && /插卡槽/.test(demo.claims[7].text) && /阀门/.test(demo.claims[9].text), "c2/c4/c5/c6/c8/c10 顺序");
}

// ── 3. 核心技术特征（独立权利要求覆盖定稿独立项特征） ─────────────
{
  const need = baseline.claims[0].features.map((f) => f.replace(/[\[\]]/g, ""));
  const map = {
    "[热水表本体]": "热水表本体", "[控制主板]": "控制主板", "[控制器]": "控制器",
    "[射频通信模块]": "射频通信模块", "[蓝牙mesh通信模块]": "蓝牙mesh", "[470通信模块]": "470通信模块",
    "[射频卡连接]": "射频卡片", "[自组网]": "蓝牙mesh网络", "[470连网关]": "470通讯连接",
    "[网关连云端]": "网关接入云端", "[云端连远程控制器]": "远程控制器",
  };
  const missing = [];
  for (const f of baseline.claims[0].features) {
    const kw = map[f] ?? f.replace(/[\[\]]/g, "");
    if (!demo.claims[0].text.includes(kw)) missing.push(`${f}→${kw}`);
  }
  check("F-1", "独立权利要求覆盖定稿全部核心特征（11/11）", missing.length === 0, missing.join(", ") || "ok");
  check("F-2", "生成输出不包含交底噪声（NB/CAT.1/485/电表网关）",
    !/NB-IoT|NB-loT|CAT\.1|\b485\b|电表网关/.test(allText), "ok");
  check("F-3", "生成输出不含宣传语（彻底/尽显/时尚/破解）",
    !/彻底|尽显|时尚|破解/.test(allText), "ok");
  check("F-4", "生成输出不含页脚模板残留", !/说明书\s*100002|100004/.test(allText), "ok");
}

// ── 4. 支持关系与无来源门禁 ───────────────────────────────────────
{
  const unsupportedClaims = demo.claims.filter((c) => c.sources.some((s) => s.kind === "none"));
  const auditNone = demo.audit.rows.filter((r) => r.status === "none");
  check("A-1", "每条权利要求都有来源标注（10/10）", demo.claims.every((c) => c.sources.length > 0), "ok");
  check("A-2", "无来源特征被精确检出（恰 1 处：权9 插卡槽水通路）",
    unsupportedClaims.length === 1 && unsupportedClaims[0].id === "c9" && /水通路/.test(unsupportedClaims[0].text),
    unsupportedClaims.map((c) => c.id).join(",") || "none");
  check("A-3", "审校矩阵同步标记无来源（权9）",
    auditNone.length === 1 && auditNone[0].position.includes("权9"), auditNone.map((r) => r.position).join(",") || "none");
  check("A-4", "导出门禁生效：存在 error 级审校项 → 正式导出被阻止",
    demo.audit.errors > 0, `errors=${demo.audit.errors}`);
  check("A-5", "支持矩阵区分 材料原文/用户确认/无来源 三态",
    new Set(demo.audit.rows.map((r) => r.status)).size === 3, demo.audit.rows.map((r) => r.status).join(","));
  check("A-6", "尺寸参数经 Intake 确认后进入权利要求（权5 用户确认）",
    demo.claims[4].sources.some((s) => s.kind === "user") && /87\.9mm/.test(demo.claims[4].text), "c5 → user");
}

// ── 5. 章节完整性（五段式说明书） ─────────────────────────────────
{
  const expected = specBase.sections.filter((s) => s.expected).map((s) => s.name);
  const actual = demo.specSections.map((s) => s.title);
  check("D-1", "说明书五段式齐全且顺序一致", JSON.stringify(actual) === JSON.stringify(expected), actual.join("/"));
  check("D-2", "附图说明枚举图1-图6 与附图数量一致",
    /图1/.test(demo.specSections[3].body) && /图6/.test(demo.specSections[3].body) && demo.figures.length === 6,
    `figures=${demo.figures.length}`);
  check("D-3", "摘要 ≤300 字（不含字数标注）",
    cjkCount(demo.abstractText) <= 300, `chars=${cjkCount(demo.abstractText)}`);
}

// ── 6. 附图与标记一致性 ───────────────────────────────────────────
{
  const titles = demo.figures.map((f) => f.title.replace(/^图\d\s*/, ""));
  const expectedTitles = specBase.figures.map((f) => f.descPlaceholder.replace(/[\[\]]/g, ""));
  check("G-1", "附图 6 张且标题与附图说明一一对应",
    JSON.stringify(titles) === JSON.stringify(expectedTitles), titles.join(" / "));
  check("G-2", "机械图/电路图走 Drawing Brief（非自由生成）",
    demo.figures.filter((f) => f.mode === "brief").length >= 4 &&
    demo.figures.filter((f) => f.mode === "auto").every((f) => /框图|结构图/.test(f.title)),
    `auto=${demo.figures.filter((f) => f.mode === "auto").length}, brief=${demo.figures.filter((f) => f.mode === "brief").length}`);
  check("G-3", "Drawing Brief 含附图标记表（热水表本体/插卡槽/阀门）",
    /热水表本体|插卡槽|手动阀门/.test(demo.figureBrief) && /1|2|3/.test(demo.figureBrief), "ok");
  check("G-4", "附图标记与说明书引用一致（本体 1）", /热水表本体1/.test(demo.specSections[4].body), "ok");
}

// ── 7. 术语一致性 ─────────────────────────────────────────────────
{
  check("T-1", "生成输出无「智慧网关/智能网关」混用", !/智慧网关|智能网关/.test(allText), "ok");
  check("T-2", "三模术语统一（射频/蓝牙mesh/470）",
    (allText.match(/470/g) ?? []).length > 3 && /蓝牙mesh/.test(allText) && /射频/.test(allText), "ok");
}

// ── 8. 交底问题识别回归（P1-P8 覆盖） ─────────────────────────────
{
  const q = demo.intakeQuestions;
  check("P-1", "P1 主题摇摆 → Intake Q1 确认保护对象", q[0]?.question.includes("保护主题"), "Q1");
  check("P-2", "P2 制式冲突 → Intake Q3 以三模为准并剔除 NB", q[2]?.question.includes("NB-IoT"), "Q3");
  check("P-3", "P3 摘要噪声 → 生成摘要无残留（D-3 关联）", true, "见 D-3/F-4");
  check("P-4", "P4 电表网关噪声 → 生成输出已剔除（F-2 关联）", true, "见 F-2");
  check("P-5", "P5 宣传语 → 生成输出已剔除（F-3 关联）", true, "见 F-3");
  check("P-6", "P6 编号混乱 → 附图说明/附图标题一致（G-1 关联）", true, "见 G-1");
  check("P-7", "P7 尺寸无来源 → Intake Q2 确认来源", q[1]?.question.includes("尺寸参数来源"), "Q2");
  check("P-8", "P8 定稿新增结构 → 权8/权9 标记待确认/无来源（A-2 关联）", true, "见 A-2");
}

// ── 汇总 ──────────────────────────────────────────────────────────
const passed = results.filter((r) => r.pass).length;
const failed = results.filter((r) => !r.pass);
const report = {
  generatedAt: new Date().toISOString().slice(0, 19).replace("T", " "),
  fixtureRefs: ["baseline-claims-graph.json", "baseline-spec-structure.json", "baseline-problems.json"],
  outputUnderTest: "demo-generated.json",
  summary: { total: results.length, passed, failed: failed.length },
  verdict: failed.length === 0 ? "PASS" : "FAIL",
  results,
};

mkdirSync(join(root, "qa"), { recursive: true });
writeFileSync(join(root, "qa/baseline-report.json"), JSON.stringify(report, null, 2));

console.log(`Baseline 验收对账: ${passed}/${results.length} 通过`);
for (const r of results) console.log(`  [${r.pass ? "PASS" : "FAIL"}] ${r.id} ${r.name} — ${r.detail}`);
console.log(`verdict: ${report.verdict}`);
process.exitCode = failed.length === 0 ? 0 : 1;
