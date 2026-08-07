// Production full-pipeline timing + gate-data capture: unlock -> paste real
// disclosure -> live pipeline to intake -> answer all -> strategy -> draft +
// audit -> export gate probe. Prints per-phase wall-clock durations.
import { chromium } from '/Users/jared/.npm/_npx/420ff84f11983ee5/node_modules/playwright-core/index.mjs';
import { readFileSync } from 'node:fs';
const EXE = '/Users/jared/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const BASE = 'https://vibing.paymond.me/patent/';
const PASSWORD = process.env.PATENT_CLOUD_PASSWORD;
if (!PASSWORD) { console.error('PATENT_CLOUD_PASSWORD required'); process.exit(2); }
const DISCLOSURE = readFileSync('/tmp/jiaodi.txt', 'utf8');

const browser = await chromium.launch({ executablePath: EXE, headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const logs = [];
page.on('console', (m) => { if (m.type() === 'error') logs.push(m.text().slice(0, 200)); });
page.on('pageerror', (e) => logs.push('pageerror: ' + e.message.slice(0, 200)));
const check = (n, ok, d = '') => console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${d ? ' — ' + d : ''}`);
const t0 = Date.now();
const mark = (label) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${label}`);

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(800);
await page.getByRole('button', { name: /云端未解锁/ }).click();
await page.waitForTimeout(400);
await page.getByPlaceholder('访问密码').fill(PASSWORD);
await page.getByRole('button', { name: '解锁' }).click();
await page.waitForTimeout(1000);
const unlocked = (await page.locator('.bridge-status').textContent()).includes('已解锁');
check('云端解锁', unlocked);
await page.getByRole('button', { name: /新建项目/ }).click();
await page.waitForTimeout(400);
await page.getByPlaceholder('例如：一种基于三模通讯的共享热水表').fill('性能基线·三模热水表');
await page.getByRole('button', { name: /下一步/ }).click();
await page.waitForTimeout(400);
await page.getByPlaceholder(/在此粘贴技术交底内容/).fill(DISCLOSURE);
await page.waitForTimeout(300);
mark('材料就绪，开始真实起草');
await page.getByRole('button', { name: '开始真实起草' }).click();
// Wait for intake questions (cards with h2)
let intakeOk = false;
for (let i = 0; i < 200; i++) {
  await page.waitForTimeout(3000);
  const q = await page.evaluate(() => document.querySelectorAll('.card h2').length);
  if (q > 0) { intakeOk = true; break; }
  if (page.url().includes('/strategy')) break;
}
mark(`到达 Intake（${intakeOk ? '有题目' : '无题目'}）`);
check('管线到达 Intake', intakeOk, page.url());
// Answer every question (first option or free text)
let answered = 0;
const cards = await page.$$('div.card');
for (const c of cards) {
  const radio = await c.$('button.radio-card');
  if (radio) { await radio.click(); answered++; }
  else {
    const ta = await c.$('textarea');
    if (ta) { await ta.fill('补充说明：与交底材料一致，无额外信息。'); answered++; }
  }
}
mark(`Intake 已回答 ${answered} 题`);
await page.getByRole('button', { name: /提交回答/ }).click();
mark('提交回答完成');
// Strategy page
let onStrategy = false;
for (let i = 0; i < 120; i++) {
  await page.waitForTimeout(2000);
  if (page.url().includes('/strategy')) { onStrategy = true; break; }
}
check('策略屏出现', onStrategy, page.url());
if (onStrategy) {
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(2000);
    const kv = await page.evaluate(() => document.querySelectorAll('.kv').length);
    if (kv > 0) break;
  }
  const cb = page.locator('input[type="checkbox"]').first();
  if (await cb.count()) await cb.check();
  await page.getByRole('button', { name: /确认并起草/ }).click();
  mark('确认并起草 → 起草+审校开始');
} else {
  // fallback: navigate to workbench directly to capture state
  const m = page.url().match(/projects\/([^/]+)/);
  if (m) await page.goto(BASE + `projects/${m[1]}`, { waitUntil: 'networkidle' });
}
// Wait for workbench with claims (draft+audit complete)
let atWorkbench = false;
for (let i = 0; i < 600; i++) {
  await page.waitForTimeout(3000);
  const n = await page.evaluate(() => document.querySelectorAll('.outline-item').length);
  if (n >= 3) { atWorkbench = true; break; }
  if (i % 20 === 0) mark(`起草中… ${(i * 3).toFixed(0)}s（outline=${n}）`);
}
mark('起草完成（工作台渲染）');
check('起草+审校完成（工作台渲染）', atWorkbench);
const dump = await page.evaluate(() => {
  const raw = localStorage.getItem('patent-drafter.v1');
  const s = raw ? JSON.parse(raw) : null;
  const p = s?.projects?.[0];
  if (!p) return { error: 'no project in LS' };
  const audit = p.audit;
  return {
    url: location.pathname,
    status: p.status, reached: p.live?.reached,
    claims: p.claims?.length,
    noneClaims: p.claims?.filter((c) => c.sources?.some((x) => x.kind === 'none')).map((c) => c.id),
    audit: audit ? {
      passed: audit.passed, warnings: audit.warnings, errors: audit.errors,
      rows: audit.rows.slice(0, 12),
      checks: audit.checks.slice(0, 10),
    } : null,
  };
});
console.log('AUDIT_DUMP ' + JSON.stringify(dump, null, 1));
const m = page.url().match(/projects\/([^/]+)/);
if (m) {
  await page.goto(BASE + `projects/${m[1]}/export`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: '在本机生成导出包' }).click();
  await page.waitForTimeout(600);
  const gateText = await page.evaluate(() => {
    const n = document.querySelector('.notice');
    return n ? n.textContent.replace(/\s+/g, ' ').trim() : '';
  });
  check('导出门禁文案含具体问题（非空括号）', gateText.includes('无来源特征') || gateText.includes('审校问题'), gateText.slice(0, 140));
  console.log('GATE_TEXT ' + gateText.slice(0, 200));
}
console.log('pageerrors:', logs.length ? logs.join(' | ') : 'none');
console.log(`TOTAL ${((Date.now() - t0) / 1000).toFixed(1)}s`);
await browser.close();
