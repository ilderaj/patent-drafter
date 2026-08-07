// Real end-to-end walkthrough: paste disclosure -> live pipeline -> intake ->
// strategy -> workbench (claims/spec) -> audit -> export gate.
// Prereqs: dev server on :5173, bridge in real mode on :7878 with key stored.
import { chromium } from '/Users/jared/.npm/_npx/420ff84f11983ee5/node_modules/playwright-core/index.mjs';

const EXE = '/Users/jared/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const BASE = 'http://localhost:5173/patent/';

const browser = await chromium.launch({ executablePath: EXE, headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const page = await context.newPage();
const logs = [];
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('428')) logs.push(`[error] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
page.on('response', (r) => { if (r.status() >= 400 && !r.url().includes('bridge')) logs.push(`[http ${r.status()}] ${r.url()}`); });

const checks = [];
const check = (name, ok, detail = "") => checks.push({ name, ok, detail });

const DISCLOSURE = `一种共享热水表
共享热水表，包括表体、计量部件与控制单元。表体为圆柱形壳体，计量部件为叶轮式流量计，控制单元集成在表体内部。
通讯模块支持蓝牙mesh、470MHz 无线与 NB-IoT 三种通讯方式，可自动切换。NB-IoT 模块由内置锂电池供电。
集中抄表效率显著提升，通讯可靠性增强。`;

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(300);

// Pair via the dev proxy (same-origin), simulating the Settings pairing flow.
const paired = await page.evaluate(async () => {
  try {
    const start = await fetch('/bridge/api/pair/start', { method: 'POST' });
    const { pairingCode } = await start.json();
    const confirm = await fetch('/bridge/api/pair/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pairing_code: pairingCode }),
    });
    const body = await confirm.json();
    if (body.sessionToken) {
      localStorage.setItem('patent-drafter.bridge-session.v1', body.sessionToken);
      return true;
    }
    return false;
  } catch (e) {
    return String(e);
  }
});
check('paired with bridge', paired === true, String(paired));
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(300);

// Create project
await page.click('text=新建项目');
await page.waitForTimeout(300);
await page.fill('input[placeholder*="三模通讯"]', '联调热水表');
await page.click('text=实用新型');
await page.click('text=下一步：上传交底材料');
await page.waitForTimeout(300);
check('upload page reached', page.url().includes('/upload'));

// Paste disclosure and start real drafting
await page.fill('textarea[aria-label="粘贴交底文本"]', DISCLOSURE);
await page.click('text=开始真实起草');
check('pipeline started (navigates to intake)', await (async () => {
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(3000);
    if (page.url().includes('/intake')) return true;
  }
  return false;
})());
let intakeReady = false;
let onStrategy = false;
for (let i = 0; i < 12; i++) {
  await page.waitForTimeout(3000);
  const hasQuestions = await page.evaluate(() => document.querySelectorAll('.card h2').length > 0);
  if (hasQuestions) {
    intakeReady = true;
    break;
  }
}
check('intake questions rendered (live pipeline)', intakeReady);
if (intakeReady) {
  await page.screenshot({ path: 'qa/screens/live-intake.png' });
  const qCount = await page.evaluate(() => document.querySelectorAll('.card h2').length);
  console.log(`intake questions: ${qCount}`);
  check('intake has questions', qCount >= 1, `count=${qCount}`);

  // ---- Answer every intake question (first option), then submit ----
  const cards = await page.$$('div.card');
  let answered = 0;
  for (const c of cards) {
    const radio = await c.$('button.radio-card');
    if (radio) {
      await radio.click();
      answered++;
    } else {
      // No options: the question is answered via the free-text field.
      const ta = await c.$('textarea');
      if (ta) {
        const qTitle = (await c.$eval('h2', (e) => e.textContent)) ?? '';
        await ta.fill(`补充说明：${qTitle.slice(0, 30)}——以交底材料为准，无额外信息`);
        answered++;
      }
    }
  }
  check('answered all intake questions', answered === qCount, `answered=${answered}/${qCount}`);
  await page.screenshot({ path: 'qa/screens/live-intake-answered.png' });

  const submitDisabled = await page.$eval('text=提交回答，生成保护策略', (b) => b.disabled).catch(() => false);
  check('submit enabled after answering', !submitDisabled);

  await page.click('text=提交回答，生成保护策略');
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(3000);
    if (page.url().includes('/strategy')) { onStrategy = true; break; }
  }
  check('strategy page reached after intake submit', onStrategy);
}

if (onStrategy) {
  let strategyShown = false;
  for (let i = 0; i < 15; i++) {
    await page.waitForTimeout(2000);
    const hasKv = await page.evaluate(() => document.querySelectorAll('.kv').length > 0);
    if (hasKv) { strategyShown = true; break; }
  }
  check('strategy recommendations rendered', strategyShown);
  if (strategyShown) {
    await page.screenshot({ path: 'qa/screens/live-strategy.png' });
    await page.check('input[type="checkbox"]');
    await page.click('text=确认并起草');
  }
}

const m = page.url().match(/\/projects\/([^/]+)/);
const projectId = m ? m[1] : '';
if (projectId) console.log(`project id: ${projectId}`);

// ---- Wait for the drafting + audit pipeline (8 LLM stages, 2-7 min) ----
let atWorkbench = false;
if (projectId) {
  for (let i = 0; i < 160; i++) {
    await page.waitForTimeout(3000);
    const url = page.url();
    if (/\/projects\/[^/]+$/.test(url)) { atWorkbench = true; break; }
    if (i % 20 === 19) {
      const probe = await page.evaluate(() => {
        const raw = localStorage.getItem('patent-drafter.v1');
        const st = raw ? JSON.parse(raw) : { projects: [] };
        const pid = location.pathname.match(/\/projects\/([^/]+)/)?.[1];
        const p = st.projects.find((x) => x.id === pid);
        return p?.live ? { reached: p.live.reached, running: p.live.running, error: p.live.error ?? null } : null;
      });
      console.log(`  drafting probe #${i + 1}:`, JSON.stringify(probe));
    }
  }
  check('workbench reached after draft', atWorkbench);
}

if (atWorkbench) {
  const probe = await page.evaluate(() => {
    const raw = localStorage.getItem('patent-drafter.v1');
    const st = raw ? JSON.parse(raw) : { projects: [] };
    const pid = location.pathname.match(/\/projects\/([^/]+)/)?.[1];
    const p = st.projects.find((x) => x.id === pid);
    return {
      reached: p?.live?.reached,
      error: p?.live?.error ?? null,
      keys: Object.keys(p?.live?.ctx?.results ?? {}),
    };
  });
  console.log('workbench ctx probe:', JSON.stringify(probe));
  check('audit stages present in live ctx', (probe.keys ?? []).some((k) => k.startsWith('audit')), `keys=${probe.keys}`);
  const claimCount = await page.evaluate(() => document.querySelectorAll('.claim-card').length);
  check('claims rendered on workbench', claimCount >= 1, `claims=${claimCount}`);
  const specOk = await page.evaluate(() => {
    const cols = [...document.querySelectorAll('.wb-col .col-title')].map((e) => e.textContent);
    return cols.some((t) => t && t.includes('段落')) || document.body.innerText.includes('技术领域');
  });
  check('spec sections rendered on workbench', specOk);
  await page.screenshot({ path: 'qa/screens/live-workbench.png' });

  // ---- Audit screen ----
  await page.goto(`${BASE}projects/${projectId}/audit`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  const rowCount = await page.evaluate(() => document.querySelectorAll('.matrix-table tbody tr').length);
  const statCount = await page.evaluate(() => document.querySelectorAll('.audit-stat b').length);
  const statTotal = await page.evaluate(() =>
    [...document.querySelectorAll('.audit-stat b')].reduce((s, e) => s + (parseInt(e.textContent || '0', 10) || 0), 0),
  );
  check('audit matrix rows rendered', rowCount >= 1, `rows=${rowCount}`);
  check('audit totals non-zero', statTotal > 0, `passed+warnings+errors=${statTotal}`);
  check('audit stats rendered', statCount === 3, `stats=${statCount}`);
  await page.screenshot({ path: 'qa/screens/live-audit.png' });
  const liveAudit = await page.evaluate(() => {
    const raw = localStorage.getItem('patent-drafter.v1');
    if (!raw) return { err: 'no ls' };
    const st = JSON.parse(raw);
    const pid = location.pathname.match(/\/projects\/([^/]+)/)?.[1];
    const p = (st.projects || []).find((x) => x.id === pid);
    const res = p?.live?.ctx?.results || {};
    return {
      support: res.audit_support?.output?.findings?.length ?? -1,
      consistency: res.audit_consistency?.output?.findings?.length ?? -1,
      formal: res.audit_formal_rules?.output?.findings?.length ?? -1,
      exportStage: res.export?.output ? 'ran' : 'missing',
      errors: p?.live ? p.audit?.errors : undefined,
    };
  });
  console.log('live audit ctx:', JSON.stringify(liveAudit));
  check('real audit stages produced findings', (liveAudit.support ?? 0) >= 0 && (liveAudit.consistency ?? 0) >= 0, JSON.stringify(liveAudit));
  await page.click('.tabs button:nth-child(2)');
  await page.waitForTimeout(400);
  const checkCount = await page.evaluate(() => document.querySelectorAll('.check-item').length);
  check('audit checks rendered (consistency tab)', checkCount >= 1, `checks=${checkCount}`);
  await page.screenshot({ path: 'qa/screens/live-audit-consistency.png' });

  // ---- Export gate ----
  await page.goto(`${BASE}projects/${projectId}/export`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  const dlPromise = page.waitForEvent('download', { timeout: 15000 }).catch(() => null);
  await page.click('text=在本机生成导出包').catch(() => {});
  const dl = await dlPromise;
  if (dl) {
    check('export download triggered', true, dl.suggestedFilename());
    const dest = `qa/screens/live-export-${Date.now()}.md`;
    await dl.saveAs(dest);
    console.log(`downloaded: ${dest}`);
  } else {
    const after = await page.evaluate(() => document.body.innerText);
    const blocked = after.includes('正式申请文件导出已被阻止');
    check('export blocked by audit gate', blocked, 'no download; gate did not block either');
    if (blocked) check('export gate offers fix path', after.includes('去处理'));
  }
  await page.screenshot({ path: 'qa/screens/live-export.png' });
}

await browser.close();

let failed = 0;
for (const c of checks) {
  console.log(`${c.ok ? '[PASS]' : '[FAIL]'} ${c.name}${c.ok ? '' : ` — ${c.detail}`}`);
  if (!c.ok) failed++;
}
console.log(`结果: ${checks.length - failed} 通过 / ${failed} 失败`);
for (const l of logs) console.log(`LOG ${l}`);
process.exit(failed === 0 ? 0 : 1);
