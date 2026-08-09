// Browser-level real multi-file export verification (playwright-core headless).
// Demo project: gate block -> confirm source -> subset zip -> full zip with
// patentpack password -> per-file magic bytes + content. Live-shaped project:
// seeded localStorage project with pipeline ctx (same source the store derives
// claims/spec/abstract from) -> real zip with ctx-derived content.
// Run: node qa/export-files.mjs  (dev server on :5173 required)
import { chromium } from '/Users/jared/.npm/_npx/420ff84f11983ee5/node_modules/playwright-core/index.mjs';
import { readFileSync } from 'node:fs';
import { unzipSync, strFromU8 } from 'fflate';
import { PDFDocument } from 'pdf-lib';
import { openPatentPack } from '../packages/export/src/patentpack.ts';

const EXE = '/Users/jared/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const BASE = process.env.EXPORT_BASE ?? 'http://localhost:5173/patent/';
const PASSWORD = 'qa-export-pass-2026';

const browser = await chromium.launch({ executablePath: EXE, headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const page = await context.newPage();
const logs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };

async function go(path = '') {
  await page.goto(BASE + path, { waitUntil: 'networkidle' });
  await page.waitForTimeout(250);
}

async function exportWithPassword() {
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 60000 }),
    page.getByRole('button', { name: '在本机生成导出包' }).click(),
  ]);
  // patentpack dialog
  await page.getByPlaceholder('输入导出口令').fill(PASSWORD);
  await page.getByRole('button', { name: '确认导出' }).click();
  return download;
}

async function readZip(download) {
  const zip = new Uint8Array(readFileSync(await download.path()));
  return { entries: unzipSync(zip), suggested: download.suggestedFilename() };
}

function checkDocx(bytes, label) {
  const head = strFromU8(bytes.slice(0, 4));
  if (head !== 'PK\x03\x04') return false;
  try {
    const inner = unzipSync(bytes);
    return !!inner['[Content_Types].xml'] && !!inner['_rels/.rels'] && !!inner['word/document.xml'];
  } catch {
    return false;
  }
}

function docxXml(bytes) {
  const inner = unzipSync(bytes);
  return strFromU8(inner['word/document.xml']);
}

async function checkPdfPages(bytes) {
  if (strFromU8(bytes.slice(0, 4)) !== '%PDF') return -1;
  const doc = await PDFDocument.load(bytes);
  return doc.getPageCount();
}

// ── Round 1: demo project ───────────────────────────────────────────────
await go();
await page.evaluate(() => localStorage.clear());
await go();
await page.getByRole('button', { name: /载入示例项目/ }).click();
await page.waitForTimeout(300);
await go('projects/demo-hot-water-meter/export');

// Derived notes replace hardcoded copy
const bodyText = await page.evaluate(() => document.body.textContent);
check('demo export notes derive from data (10 claims / 177 chars / 图1-6, no stale hardcode)',
  bodyText.includes('10 条权利要求') && bodyText.includes('177 字') && bodyText.includes('图1-6') && !bodyText.includes('294 字'),
  bodyText.match(/10 条权利要求|\d+ 字|图1-6/g)?.join(','));

// Gate blocks while audit.errors > 0 (unchanged semantics)
await page.getByRole('button', { name: '在本机生成导出包' }).click();
await page.waitForTimeout(400);
const gateBlocked = await page.evaluate(() => document.body.textContent.includes('正式申请文件导出已被阻止'));
check('demo gate blocks export with error-severity audit', gateBlocked);
const fixPath = await page.getByRole('button', { name: '去处理' }).count();
check('demo gate shows 去处理 path', fixPath === 1);

// Unblock via audit confirm (existing flow)
await go('projects/demo-hot-water-meter/audit');
await page.waitForTimeout(250);
const confirmBtn = page.getByRole('button', { name: '确认来源' }).first();
if (await confirmBtn.count()) await confirmBtn.click();
await page.waitForTimeout(300);
await go('projects/demo-hot-water-meter/export');

// Subset export: uncheck 2 files -> only selected files in the zip
await page.getByLabel('权利要求书.docx').uncheck();
await page.getByLabel('项目备份.patentpack（加密）').uncheck();
await page.waitForTimeout(150);
const [dl1] = await Promise.all([
  page.waitForEvent('download', { timeout: 60000 }),
  page.getByRole('button', { name: '在本机生成导出包' }).click(),
]);
const subset = await readZip(dl1);
const subsetNames = Object.keys(subset.entries).sort();
check('subset zip contains exactly the 5 selected files',
  subsetNames.join('|') === '专利申请文件草案合集.docx|说明书.docx|说明书摘要.docx|说明书附图.pdf|起草审阅报告.pdf',
  subsetNames.join('|'));
check('subset zip omits unselected 权利要求书.docx', !subset.entries['权利要求书.docx']);
check('subset zip omits unselected 项目备份.patentpack', !subset.entries['项目备份.patentpack']);
check('subset zip download name matches project',
  subset.suggested === '一种基于三模通讯的共享热水表-草案包.zip', subset.suggested);

// Full export with patentpack + password dialog
await go('projects/demo-hot-water-meter/export');
await page.getByLabel('权利要求书.docx').check();
await page.getByLabel('项目备份.patentpack（加密）').check();
await page.getByRole('button', { name: '在本机生成导出包' }).click();
await page.getByPlaceholder('输入导出口令').fill(PASSWORD);
const [dl2] = await Promise.all([
  page.waitForEvent('download', { timeout: 90000 }),
  page.getByRole('button', { name: '确认导出' }).click(),
]);
const full = await readZip(dl2);
const fullNames = Object.keys(full.entries).sort();
check('full zip contains all 7 files with UI-matching names',
  fullNames.join('|') ===
    '专利申请文件草案合集.docx|权利要求书.docx|说明书.docx|说明书摘要.docx|说明书附图.pdf|起草审阅报告.pdf|项目备份.patentpack',
  fullNames.join('|'));

// Magic bytes + structure per file
check('claims.docx is real docx (zip + word/document.xml)', checkDocx(full.entries['权利要求书.docx'], 'claims'));
check('spec.docx is real docx', checkDocx(full.entries['说明书.docx'], 'spec'));
check('abstract.docx is real docx', checkDocx(full.entries['说明书摘要.docx'], 'abstract'));
check('bundle.docx is real docx', checkDocx(full.entries['专利申请文件草案合集.docx'], 'bundle'));
const claimsXml = docxXml(full.entries['权利要求书.docx']);
check('claims.docx contains claim 1 text', claimsXml.includes('一种基于三模通讯的共享热水表'));
const abstractXml = docxXml(full.entries['说明书摘要.docx']);
check('abstract.docx contains abstract text', abstractXml.includes('本实用新型公开了一种基于三模通讯的共享热水表'));
const bundleXml = docxXml(full.entries['专利申请文件草案合集.docx']);
check('bundle.docx contains all three documents', bundleXml.includes('第一部分 权利要求书') && bundleXml.includes('第二部分 说明书') && bundleXml.includes('第三部分 说明书摘要'));

const reportPages = await checkPdfPages(full.entries['起草审阅报告.pdf']);
check('report.pdf is real PDF (parseable)', reportPages >= 1, `pages=${reportPages}`);
const figuresPages = await checkPdfPages(full.entries['说明书附图.pdf']);
check('figures.pdf is real PDF with 6 figure pages', figuresPages === 6, `pages=${figuresPages}`);

const packText = strFromU8(full.entries['项目备份.patentpack']);
const envelope = JSON.parse(packText);
check('patentpack is v1 envelope with base64 fields',
  envelope.v === 1 && envelope.alg === 'PBKDF2-SHA256-AESGCM-200000' && typeof envelope.ciphertext === 'string');
check('patentpack envelope ASCII-only (no plaintext claims)',
  /^[\x00-\x7F]*$/.test(packText) && !packText.includes('共享热水表'));
const snapshot = await openPatentPack(full.entries['项目备份.patentpack'], PASSWORD);
check('patentpack decrypts with same passphrase (10 claims in snapshot)',
  snapshot.claims.length === 10 && snapshot.audit.rows.length > 0, `claims=${snapshot.claims.length}`);

// Version history lists real exported file names (honesty fix)
await go('projects/demo-hot-water-meter/history');
const historyText = await page.evaluate(() => document.body.textContent);
check('version note lists real exported file names',
  historyText.includes('导出：') && historyText.includes('权利要求书.docx') && historyText.includes('项目备份.patentpack'),
  historyText.match(/导出：[^\n]{0,120}/)?.[0]?.slice(0, 80));

// ── Round 2: live-shaped project (ctx-derived content, no network) ──────
const liveSeed = {
  projects: [
    {
      id: 'live-export-test',
      name: '联调热水表（live）',
      patentType: 'utility_model',
      status: 'ready',
      statusLabel: '审校完成',
      updatedAt: '2026-08-09 10:00',
      claimsCount: 2,
      files: [],
      coverage: 70,
      coverageNote: '',
      dimensions: [],
      intakeNote: '',
      intakeQuestions: [],
      intakeAnswers: [],
      strategyConfirmed: true,
      claims: [
        { id: 'live-claim-1', label: '权利要求 1', text: '1、一种联调热水表，包括表体与控制单元，所述控制单元集成蓝牙mesh 与 470MHz 双模通讯。', sources: [{ label: '材料原文', kind: 'source' }] },
        { id: 'live-claim-2', label: '权利要求 2', text: '2、根据权利要求 1 所述的热水表，所述表体为圆柱形壳体。', sources: [{ label: '材料原文', kind: 'source' }] },
      ],
      specSections: [
        { id: 'live-sec-0', title: '技术领域', body: '本实用新型涉及联调热水表技术领域。' },
        { id: 'live-sec-1', title: '背景技术', body: '现有热水表通讯方式单一。' },
        { id: 'live-sec-2', title: '具体实施方式', body: '表体内集成控制单元与双模通讯模块。' },
      ],
      abstractText: '本实用新型公开了一种联调热水表，支持蓝牙mesh 与 470MHz 双模通讯。',
      figures: [
        { id: 'live-fig-0', title: '图1 系统结构图', mode: 'auto', badge: 'auto', previewLabel: '系统结构框图' },
        { id: 'live-fig-1', title: '图2 壳体剖视图', mode: 'auto', badge: 'auto', previewLabel: '壳体结构图' },
      ],
      figureBrief: '',
      audit: {
        passed: 5,
        warnings: 0,
        errors: 0,
        rows: [
          { feature: '双模通讯', status: 'source', source: '材料原文 p.1' },
          { feature: '圆柱形壳体', status: 'source', source: '材料原文 p.1' },
        ],
        checks: [{ icon: 'ok', text: '术语统一' }],
      },
      versions: [],
      live: {
        reached: 'export',
        running: false,
        disclosure: '',
        ctx: {
          projectId: 'live-export-test',
          title: '联调热水表（live）',
          assets: [],
          chunks: [],
          userAnswers: {},
          rulePackVersion: 'cnipa-2026-01-01',
          promptVersion: '0.1.0',
          results: {
            draft_claims: {
              stage: 'draft_claims',
              meta: { provider: 'deepseek', model: 'deepseek-v4-flash', promptVersion: '0.1.0', rulePackVersion: 'cnipa-2026-01-01' },
              output: { claims: [{ number: 1, text: '1、一种联调热水表，包括表体与控制单元，所述控制单元集成蓝牙mesh 与 470MHz 双模通讯。', features: [] }] },
            },
            draft_specification: {
              stage: 'draft_specification',
              meta: { provider: 'deepseek', model: 'deepseek-v4-flash', promptVersion: '0.1.0', rulePackVersion: 'cnipa-2026-01-01' },
              output: { sections: [{ section: 'technical_field', content: '本实用新型涉及联调热水表技术领域。' }] },
            },
            draft_abstract: {
              stage: 'draft_abstract',
              meta: { provider: 'deepseek', model: 'deepseek-v4-flash', promptVersion: '0.1.0', rulePackVersion: 'cnipa-2026-01-01' },
              output: { abstract: '本实用新型公开了一种联调热水表，支持蓝牙mesh 与 470MHz 双模通讯。' },
            },
            generate_figure_specs: {
              stage: 'generate_figure_specs',
              meta: { provider: 'deepseek', model: 'deepseek-v4-flash', promptVersion: '0.1.0', rulePackVersion: 'cnipa-2026-01-01' },
              output: { figures: [{ kind: 'topology', title: '图1 系统结构图' }] },
            },
          },
        },
      },
    },
  ],
  currentId: 'live-export-test',
  bridgeMode: 'connected',
};

await go();
await page.evaluate((seed) => localStorage.setItem('patent-drafter.v1', JSON.stringify(seed)), liveSeed);
await go('projects/live-export-test/export');
const liveBody = await page.evaluate(() => document.body.textContent);
check('live export notes derive from ctx (2 claims / 图1-2)',
  liveBody.includes('2 条权利要求') && liveBody.includes('图1-2'), '');
check('live project not blocked (audit.errors = 0)', !liveBody.includes('正式申请文件导出已被阻止'));

await page.getByRole('button', { name: '在本机生成导出包' }).click();
await page.getByPlaceholder('输入导出口令').fill(PASSWORD);
const [dl3] = await Promise.all([
  page.waitForEvent('download', { timeout: 90000 }),
  page.getByRole('button', { name: '确认导出' }).click(),
]);
const liveZip = await readZip(dl3);
const liveNames = Object.keys(liveZip.entries).sort();
check('live zip contains all 7 files', liveNames.length === 7, liveNames.join('|'));
const liveClaimsXml = docxXml(liveZip.entries['权利要求书.docx']);
check('live claims.docx contains ctx-derived claim text',
  liveClaimsXml.includes('1、一种联调热水表') && liveClaimsXml.includes('470MHz 双模通讯'));
const liveFiguresPages = await checkPdfPages(liveZip.entries['说明书附图.pdf']);
check('live figures.pdf has 2 pages from ctx figure specs', liveFiguresPages === 2, `pages=${liveFiguresPages}`);
const liveReportPages = await checkPdfPages(liveZip.entries['起草审阅报告.pdf']);
check('live report.pdf parseable', liveReportPages >= 1, `pages=${liveReportPages}`);
const liveSnap = await openPatentPack(liveZip.entries['项目备份.patentpack'], PASSWORD);
check('live patentpack snapshot carries ctx-derived claims',
  liveSnap.claims.length === 2 && liveSnap.project.name === '联调热水表（live）');

await go('projects/live-export-test/history');
const liveHistory = await page.evaluate(() => document.body.textContent);
check('live version note lists real exported file names',
  liveHistory.includes('导出：') && liveHistory.includes('起草审阅报告.pdf'));

console.log('\nconsole errors/warnings:', logs.length ? logs.join(' | ') : 'none');
const failed = results.filter((r) => !r.ok).length;
console.log(`\nverdict: ${failed === 0 ? 'PASS' : 'FAIL'} (${results.length - failed}/${results.length})`);
await browser.close();
process.exit(failed === 0 ? 0 : 1);
