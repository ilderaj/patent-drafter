// Real export builder tests (packages/export). Run: node packages/export/tests/export-builders.test.mjs
// Node >= 23.6 type stripping loads the TS sources directly.
import { unzipSync, strFromU8 } from "fflate";
import { PDFDocument } from "pdf-lib";
import {
  assembleExportArtifacts,
  buildAbstractDocx,
  buildBundleDocx,
  buildClaimsDocx,
  buildDocx,
  buildFiguresPdf,
  buildPatentPack,
  buildReviewPdf,
  buildReviewReportSpec,
  buildSpecificationDocx,
  buildZip,
  exportFileNotes,
  exportedFileNames,
  figureSvg,
  openPatentPack,
  sanitizeFileName,
  DEFAULT_EXPORT_SELECTION,
} from "../src/index.ts";

let passed = 0;
let failed = 0;
const failures = [];

function assert(name, cond, detail = "") {
  if (cond) {
    passed++;
    console.log(`  [PASS] ${name}`);
  } else {
    failed++;
    failures.push(name);
    console.log(`  [FAIL] ${name} ${detail}`);
  }
}

const TEXT_DECODER = new TextDecoder();
const str = (b) => TEXT_DECODER.decode(b);

const PROJECT = {
  name: "一种基于三模通讯的共享热水表",
  patentType: "utility_model",
  claims: [
    { id: "c1", label: "权利要求 1（独立）", text: "1、一种基于三模通讯的共享热水表，包括热水表本体。" },
    { id: "c2", label: "权利要求 2", text: "2、根据权利要求 1 所述的热水表，所述控制主板设有插卡槽 & 水通路（含 <试验> 字符）。" },
  ],
  specSections: [
    { id: "s1", title: "技术领域", body: "本实用新型涉及智慧水表技术领域。" },
    { id: "s2", title: "具体实施方式", body: "如图 1 所示，热水表本体 1 内设有控制主板。" },
  ],
  abstractText: "本实用新型公开了一种基于三模通讯的共享热水表。",
  figures: [
    { id: "f1", title: "图1 系统结构图", mode: "auto", badge: "自动生成", previewLabel: "系统结构框图" },
    { id: "f2", title: "图2 主视图", mode: "brief", badge: "需上传", previewLabel: "需上传图纸" },
  ],
  audit: {
    passed: 38,
    warnings: 0,
    errors: 0,
    rows: [
      { feature: "三模通讯", status: "source", source: "材料原文 p.3" },
      { feature: "插卡槽下端水通路", status: "user", source: "用户确认" },
    ],
    checks: [{ icon: "ok", text: "术语统一" }],
  },
  versions: [{ version: "v5", note: "审校修正", meta: "2026-08-05 · deepseek-v4-flash" }],
  rulePackVersion: "cnipa-2026-01-01",
};

const ALL = { ...DEFAULT_EXPORT_SELECTION };
const NONE = {
  bundle: false,
  claims: false,
  specification: false,
  abstract: false,
  figures: false,
  report: false,
  patentpack: false,
};

// A 1x1 red PNG used to simulate browser SVG->PNG rasterization in Node.
const PNG_1PX = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  ),
);
const fakePageRenderer = async () => [PNG_1PX];

// ── 1. DOCX: real OOXML zip ─────────────────────────────────────────────
{
  const extractParagraphTexts = (xml) =>
    [...xml.matchAll(/<w:p>[\s\S]*?<w:t[^>]*>([\s\S]*?)<\/w:t>[\s\S]*?<\/w:p>/g)].map((m) => m[1]);

  const docx = buildClaimsDocx(PROJECT);
  assert("docx starts with zip magic PK", docx[0] === 0x50 && docx[1] === 0x4b);
  const entries = unzipSync(docx);
  const names = Object.keys(entries).sort();
  assert(
    "docx contains OOXML core parts and footer relationship",
    names.join(",") === "[Content_Types].xml,_rels/.rels,word/_rels/document.xml.rels,word/document.xml,word/footer1.xml",
    names.join(","),
  );
  const documentXml = str(entries["word/document.xml"]);
  const contentTypesXml = str(entries["[Content_Types].xml"]);
  const documentRelsXml = str(entries["word/_rels/document.xml.rels"]);
  const footerXml = str(entries["word/footer1.xml"]);

  assert("document.xml contains claim 1 text", documentXml.includes("一种基于三模通讯的共享热水表"));
  assert(
    "document.xml escapes XML entities (& -> &amp;)",
    documentXml.includes("插卡槽 &amp; 水通路") && !/插卡槽 & 水通路/.test(documentXml),
  );
  assert(
    "document.xml escapes angle brackets",
    documentXml.includes("&lt;试验&gt;") && !documentXml.includes("<试验>"),
  );
  assert("docx has no plain <w:body> nesting issue", documentXml.includes("<w:body>") && documentXml.includes("</w:body>"));
  assert(
    "document.xml declares xmlns:r and mounts default footerReference rIdFooter1",
    documentXml.includes('xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"') &&
      documentXml.includes('<w:footerReference w:type="default" r:id="rIdFooter1"/>'),
  );
  assert(
    "word/_rels/document.xml.rels links rIdFooter1 to footer1.xml",
    documentRelsXml.includes('Id="rIdFooter1"') &&
      documentRelsXml.includes('Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer"') &&
      documentRelsXml.includes('Target="footer1.xml"'),
  );
  assert(
    "[Content_Types].xml registers /word/footer1.xml as OOXML footer",
    contentTypesXml.includes(
      'PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"',
    ),
  );
  assert(
    "word/footer1.xml contains centered PAGE field",
    footerXml.includes('<w:jc w:val="center"/>') &&
      footerXml.includes('<w:fldChar w:fldCharType="begin"/>') &&
      footerXml.includes(" PAGE ") &&
      footerXml.includes('<w:fldChar w:fldCharType="end"/>'),
  );
  assert(
    "body paragraphs use 1.5x line spacing and 2-char Chinese first-line indent",
    documentXml.includes('<w:spacing w:line="360" w:lineRule="auto"/>') &&
      documentXml.includes('<w:ind w:firstLineChars="200" w:firstLine="480"/>') &&
      documentXml.includes('<w:sz w:val="24"/>'),
  );

  const empty = buildDocx([{ text: "", style: "body" }]);
  const emptyXml = str(unzipSync(empty)["word/document.xml"]);
  assert("docx builder handles empty paragraph without first-line indent", emptyXml.length > 0 && !emptyXml.includes("<w:ind "));

  // Multi-paragraph splitting (direct buildDocx, claims, spec, abstract) and CNIPA spec formatting
  const rawMulti = buildDocx([{ text: "第一行\n第二行\r\n第三行", style: "body" }]);
  const rawMultiXml = str(unzipSync(rawMulti)["word/document.xml"]);
  const rawMultiTexts = extractParagraphTexts(rawMultiXml);
  assert(
    "buildDocx splits embedded newlines into independent <w:p> without bare \\n in <w:t>",
    rawMultiTexts.join("|") === "第一行|第二行|第三行" && ![...rawMultiXml.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)].some((m) => /[\r\n]/.test(m[1])),
    rawMultiTexts.join("|"),
  );

  const MULTI_PROJECT = {
    ...PROJECT,
    claims: [
      {
        id: "mc1",
        label: "权利要求 1",
        text: "1、一种多段权利要求，包括：\n第一模块；\n第二模块。",
        paragraphs: ["1、一种多段权利要求，包括：", "第一模块；", "第二模块。"],
      },
      {
        id: "mc2",
        label: "权利要求 2",
        text: "2、根据权利要求1所述的装置，其特征在于：\n进一步包括第三模块。",
      },
    ],
    specSections: [
      {
        id: "ms1",
        title: "技术领域",
        body: "[0001] 本发明涉及温控技术领域。",
        paragraphs: ["[0001] 本发明涉及温控技术领域。"],
      },
      {
        id: "ms2",
        title: "背景技术",
        body: "现有方案存在热滞后。\n并且难以动态补偿。",
        paragraphs: ["现有方案存在热滞后。", "并且难以动态补偿。"],
      },
      {
        id: "ms3",
        title: "具体实施方式",
        body: "实施例一描述传感器布局。\n实施例二描述控制策略。",
      },
    ],
    abstractText: "摘要第一段。\n摘要第二段。",
  };

  const multiClaimsXml = str(unzipSync(buildClaimsDocx(MULTI_PROJECT))["word/document.xml"]);
  const multiClaimTexts = extractParagraphTexts(multiClaimsXml).filter((t) => t.length > 0);
  assert(
    "claims docx splits multi-paragraph claims into independent <w:p> without bare \\n",
    multiClaimTexts.includes("1、一种多段权利要求，包括：") &&
      multiClaimTexts.includes("第一模块；") &&
      multiClaimTexts.includes("第二模块。") &&
      multiClaimTexts.includes("2、根据权利要求1所述的装置，其特征在于：") &&
      multiClaimTexts.includes("进一步包括第三模块。") &&
      ![...multiClaimsXml.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)].some((m) => /[\r\n]/.test(m[1])),
    multiClaimTexts.join(" | "),
  );

  const specXml = str(unzipSync(buildSpecificationDocx(MULTI_PROJECT))["word/document.xml"]);
  const specTexts = extractParagraphTexts(specXml).filter((t) => t.length > 0);
  assert(
    "specification docx includes title, invention name, and continuous [0001]-[0005] without double-numbering",
    specTexts[0] === "说明书" &&
      specTexts[1] === MULTI_PROJECT.name &&
      specTexts.includes("[0001] 本发明涉及温控技术领域。") &&
      !specXml.includes("[0001] [0001]") &&
      specTexts.includes("[0002] 现有方案存在热滞后。") &&
      specTexts.includes("[0003] 并且难以动态补偿。") &&
      specTexts.includes("[0004] 实施例一描述传感器布局。") &&
      specTexts.includes("[0005] 实施例二描述控制策略。") &&
      ![...specXml.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)].some((m) => /[\r\n]/.test(m[1])),
    specTexts.join(" | "),
  );

  const noticeText = "测试输出，仅用于验证流程，不能作为正式申请材料";
  const noticedSpecXml = str(unzipSync(buildSpecificationDocx(MULTI_PROJECT, noticeText))["word/document.xml"]);
  const noticedSpecTexts = extractParagraphTexts(noticedSpecXml).filter((t) => t.length > 0);
  assert(
    "specification docx with notice keeps notice as first paragraph before title and invention name",
    noticedSpecTexts[0] === noticeText && noticedSpecTexts[1] === "说明书" && noticedSpecTexts[2] === MULTI_PROJECT.name,
    noticedSpecTexts.slice(0, 4).join(" | "),
  );

  const bundleXml = str(unzipSync(buildBundleDocx(MULTI_PROJECT))["word/document.xml"]);
  const bundleTexts = extractParagraphTexts(bundleXml).filter((t) => t.length > 0);
  assert(
    "bundle docx numbers specification paragraphs [0001]-[0005] and leaves claims unnumbered",
    bundleTexts.includes("[0001] 本发明涉及温控技术领域。") &&
      bundleTexts.includes("[0005] 实施例二描述控制策略。") &&
      bundleTexts.includes("第一模块；") &&
      !bundleXml.includes("[0001] 1、一种多段权利要求"),
  );

  const abstractXml = str(unzipSync(buildAbstractDocx(MULTI_PROJECT))["word/document.xml"]);
  const abstractTexts = extractParagraphTexts(abstractXml).filter((t) => t.length > 0);
  assert(
    "abstract docx splits multi-paragraph text into independent <w:p>",
    abstractTexts.join("|") === "说明书摘要|摘要第一段。|摘要第二段。",
    abstractTexts.join("|"),
  );
}

// ── 2. PDF: figures + review ────────────────────────────────────────────
{
  const figuresPdf = await buildFiguresPdf(PROJECT.figures, { renderPages: fakePageRenderer });
  assert("figures pdf starts with %PDF", str(figuresPdf.slice(0, 4)) === "%PDF");
  const doc = await PDFDocument.load(figuresPdf);
  assert("figures pdf page count equals figure count", doc.getPageCount() === 2, `pages=${doc.getPageCount()}`);

  const placeholderPdf = await buildFiguresPdf([PROJECT.figures[1]], { renderPages: fakePageRenderer });
  const doc2 = await PDFDocument.load(placeholderPdf);
  assert("brief figure without raster gets placeholder page", doc2.getPageCount() === 1);

  const noFiguresPdf = await buildFiguresPdf([], { renderPages: fakePageRenderer });
  const doc3 = await PDFDocument.load(noFiguresPdf);
  assert("no-figures pdf has single 无附图 page", doc3.getPageCount() === 1);

  const reportSpec = buildReviewReportSpec(PROJECT, "cnipa-2026-01-01", "2026-08-09T00:00:00.000Z");
  let capturedSpec = null;
  const spyRenderer = async (spec) => {
    capturedSpec = spec;
    return [PNG_1PX];
  };
  const reviewPdf = await buildReviewPdf(reportSpec, { renderPages: spyRenderer });
  assert("review pdf starts with %PDF", str(reviewPdf.slice(0, 4)) === "%PDF");
  const doc4 = await PDFDocument.load(reviewPdf);
  assert("review pdf has at least 1 page", doc4.getPageCount() >= 1, `pages=${doc4.getPageCount()}`);
  assert("report spec carries support matrix rows", capturedSpec.sections[0].items.length === 2 && capturedSpec.sections[0].items[0].text.includes("三模通讯"));
  assert("report spec carries audit checks", capturedSpec.sections[1].items[0].text.includes("术语统一"));
  assert("report spec carries AI label + rule pack version", capturedSpec.sections[2].items.length === 2 && capturedSpec.meta.some((m) => m.label === "规则包版本" && m.value === "cnipa-2026-01-01"));
  assert("report spec carries exported time", capturedSpec.meta.some((m) => m.label === "导出时间" && m.value === "2026-08-09T00:00:00.000Z"));

  const svg = figureSvg(PROJECT.figures[0], 0);
  assert("figureSvg is self-contained svg with title", svg.startsWith("<svg") && svg.includes("图1 系统结构图"));
}

// ── 3. patentpack: encrypted envelope ───────────────────────────────────
{
  const snapshot = {
    v: 1,
    exportedAt: "2026-08-09T00:00:00.000Z",
    project: { name: PROJECT.name },
    claims: PROJECT.claims,
    audit: PROJECT.audit,
  };
  const pack = await buildPatentPack(snapshot, "test-pass-2026");
  const packText = str(pack);
  const envelope = JSON.parse(packText);
  assert("patentpack is JSON envelope v1", envelope.v === 1 && typeof envelope.ciphertext === "string");
  assert(
    "patentpack uses PBKDF2-SHA256-AESGCM-200000",
    envelope.alg === "PBKDF2-SHA256-AESGCM-200000",
    envelope.alg,
  );
  assert("patentpack has salt+iv base64", /^[A-Za-z0-9+/=]+$/.test(envelope.salt) && /^[A-Za-z0-9+/=]+$/.test(envelope.iv));
  assert("patentpack envelope is ASCII-only (no plaintext CJK)", /^[\x00-\x7F]*$/.test(packText));
  assert(
    "patentpack file contains no plaintext claim text",
    !packText.includes("一种基于三模通讯的共享热水表") && !packText.includes("权利要求"),
  );

  const opened = await openPatentPack(pack, "test-pass-2026");
  assert("patentpack decrypts with same passphrase", JSON.stringify(opened) === JSON.stringify(snapshot));

  let wrongRejected = false;
  try {
    await openPatentPack(pack, "wrong-pass");
  } catch {
    wrongRejected = true;
  }
  assert("patentpack rejects wrong passphrase", wrongRejected);

  let emptyRejected = false;
  try {
    await buildPatentPack(snapshot, "");
  } catch {
    emptyRejected = true;
  }
  assert("patentpack requires non-empty passphrase", emptyRejected);
}

// ── 4. assembly: selection drives output truthfully ─────────────────────
{
  const partial = { ...ALL, bundle: false, report: false, patentpack: false };
  const artifacts = await assembleExportArtifacts(PROJECT, partial, {
    passphrase: "test-pass-2026",
    renderReport: fakePageRenderer,
    renderFigure: fakePageRenderer,
  });
  const names = artifacts.map((a) => a.fileName);
  assert(
    "selection subset produces exactly selected files in UI order",
    names.join("|") === "权利要求书.docx|说明书.docx|说明书摘要.docx|说明书附图.pdf",
    names.join("|"),
  );
  assert("unselected 合集 not produced", !names.includes("专利申请文件草案合集.docx"));
  assert("unselected report not produced", !names.includes("起草审阅报告.pdf"));
  assert("unselected patentpack not produced", !names.includes("项目备份.patentpack"));

  const allArtifacts = await assembleExportArtifacts(PROJECT, ALL, {
    passphrase: "test-pass-2026",
    renderReport: fakePageRenderer,
    renderFigure: fakePageRenderer,
  });
  assert(
    "all-selected produces 7 files in UI order",
    allArtifacts.map((a) => a.fileName).join("|") ===
      "专利申请文件草案合集.docx|权利要求书.docx|说明书.docx|说明书摘要.docx|说明书附图.pdf|起草审阅报告.pdf|项目备份.patentpack",
  );
  assert(
    "version note lists real exported file names",
    exportedFileNames(allArtifacts).includes("权利要求书.docx") && exportedFileNames(allArtifacts).includes("项目备份.patentpack"),
    exportedFileNames(allArtifacts),
  );

  let noPassRejected = false;
  try {
    await assembleExportArtifacts(PROJECT, { ...NONE, patentpack: true }, {});
  } catch {
    noPassRejected = true;
  }
  assert("patentpack assembly without passphrase throws", noPassRejected);

  const none = await assembleExportArtifacts(PROJECT, NONE, {
    renderReport: fakePageRenderer,
    renderFigure: fakePageRenderer,
  });
  assert("empty selection produces zero files", none.length === 0);

  // patentpack decryption matches the snapshot content
  const packArtifact = allArtifacts.find((a) => a.key === "patentpack");
  const openedSnap = await openPatentPack(packArtifact.data, "test-pass-2026");
  assert(
    "patentpack payload snapshot matches project data",
    openedSnap.claims[0].text === PROJECT.claims[0].text &&
      openedSnap.audit.rows.length === 2 &&
      openedSnap.figures.length === 2 &&
      openedSnap.versions[0].version === "v5",
  );
}

// ── 5. zip + notes + file names ─────────────────────────────────────────
{
  const zip = buildZip([
    { name: "权利要求书.docx", data: new Uint8Array([0x50, 0x4b, 0x03, 0x04]) },
    { name: "起草审阅报告.pdf", data: new Uint8Array([0x25, 0x50, 0x44, 0x46]) },
  ]);
  const entries = unzipSync(zip);
  assert(
    "zip preserves entry names and bytes",
    Object.keys(entries).join("|") === "权利要求书.docx|起草审阅报告.pdf" &&
      entries["起草审阅报告.pdf"][0] === 0x25,
  );

  const notes = exportFileNotes(PROJECT);
  assert("note derives claim count", notes.claims === "2 条权利要求", notes.claims);
  assert("note derives spec sections", notes.specification === "2 个章节", notes.specification);
  assert("note derives abstract char count", notes.abstract === "23 字", notes.abstract);
  assert("note derives figure range", notes.figures === "图1-2", notes.figures);
  assert("note derives report stats", notes.report === "2 项特征 · 1 项检查", notes.report);

  const emptyNotes = exportFileNotes({
    name: "空项目",
    claims: [],
    specSections: [],
    abstractText: "",
    figures: [],
    audit: null,
  });
  assert("empty project notes fall back to generic copy", emptyNotes.claims === "暂无权利要求数据" && emptyNotes.figures === "暂无附图");
  assert("sanitizeFileName handles slashes/spaces", sanitizeFileName("a/b c:d") === "a-b-c-d", sanitizeFileName("a/b c:d"));
  assert("sanitizeFileName empty fallback", sanitizeFileName("///") === "patent-draft");
}

console.log(`\n结果: ${passed} 通过 / ${failed} 失败`);
if (failed > 0) {
  console.log("失败项:", failures.join(" | "));
  process.exit(1);
}
