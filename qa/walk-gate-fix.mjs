// Gate-fix verification: confirm-source path unblocks export; new projects are not blocked by demo audit.
import { chromium } from '/Users/jared/.npm/_npx/420ff84f11983ee5/node_modules/playwright-core/index.mjs';

const EXE = '/Users/jared/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const BASE = 'http://localhost:5173/patent/';
const browser = await chromium.launch({ executablePath: EXE, headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const logs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };
const btn = async (label, exact = true) => {
  const b = page.getByRole('button', { name: label, exact });
  await b.click();
  await page.waitForTimeout(250);
};

async function go(path = '') {
  await page.goto(BASE + path, { waitUntil: 'networkidle' });
  await page.waitForTimeout(200);
}

// ---- Scenario 1: demo project, workbench confirm-source unblocks export ----
await go();
await page.getByRole('button', { name: /载入示例项目/ }).click();
await page.waitForTimeout(300);

// Workbench: select claim 9, confirm-source action shows + live check flag
await go('projects/demo-hot-water-meter');
await page.evaluate(() => { const items = [...document.querySelectorAll('.outline-item')]; const c9 = items.find((e) => e.textContent.includes('无来源')); if (c9) c9.click(); });
await page.waitForTimeout(150);
const wbHasConfirm = await page.getByRole('button', { name: '确认来源' }).count();
const wbCheckFlag = await page.evaluate(() => document.body.textContent.includes('存在无来源特征（需确认）'));
check('工作台权9显示「确认来源」按钮', wbHasConfirm === 1, `buttons=${wbHasConfirm}`);
check('工作台实时检查显示无来源提示', wbCheckFlag);

// Export first: gate blocks with dynamic feature name
await go('projects/demo-hot-water-meter/export');
await btn('在本机生成导出包');
const gateText = await page.evaluate(() => document.body.textContent.includes('插卡槽下端水通路'));
const gateBlocked = await page.evaluate(() => document.body.textContent.includes('正式申请文件导出已被阻止'));
check('导出门禁拦截并显示动态特征名「插卡槽下端水通路」', gateText && gateBlocked);

// Back to workbench, confirm source on claim 9
await go('projects/demo-hot-water-meter');
await page.evaluate(() => { const items = [...document.querySelectorAll('.outline-item')]; const c9 = items.find((e) => e.textContent.includes('无来源')); if (c9) c9.click(); });
await page.waitForTimeout(150);
await btn('确认来源');
const srcTag = await page.evaluate(() => document.body.textContent.includes('用户确认'));
const flagGone = await page.evaluate(() => !document.body.textContent.includes('存在无来源特征（需确认）'));
const btnGone = (await page.getByRole('button', { name: '确认来源' }).count()) === 0;
check('确认来源后权9标签变为「用户确认」', srcTag);
check('确认来源后实时检查无来源提示消失', flagGone);
check('确认来源后按钮消失', btnGone);

// Audit screen: errors 1 -> 0, row shows 用户确认
await go('projects/demo-hot-water-meter/audit');
const stat0 = await page.evaluate(() => { const b = document.querySelector('.audit-stat b'); return b ? b.textContent : null; });
const rowUser = await page.evaluate(() => [...document.querySelectorAll('.matrix-table tbody tr')].some((tr) => tr.textContent.includes('插卡槽下端水通路') && tr.textContent.includes('用户确认')));
check('审校页 passed 39（确认后 errors=0）', stat0 === '39', `passed=${stat0}`);
check('审校矩阵该行变为「用户确认」', rowUser);

// Export again: gate unblocked
await go('projects/demo-hot-water-meter/export');
await btn('在本机生成导出包');
const unblocked = await page.evaluate(() => !document.body.textContent.includes('正式申请文件导出已被阻止'));
const doneState = await page.evaluate(() => document.body.textContent.includes('已在本机生成导出包'));
check('确认来源后导出放行', unblocked && doneState);

// ---- Scenario 2: fresh project (no audit) is not blocked ----
const ctx2 = await browser.newContext();
const page2 = await ctx2.newPage();
page2.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[p2:${m.type()}] ${m.text()}`); });
await page2.goto(BASE, { waitUntil: 'networkidle' });
await page2.getByRole('button', { name: /新建项目/ }).click();
await page2.waitForTimeout(250);
await page2.getByPlaceholder(/热水表/).fill('门禁回归验证项目');
await page2.locator('button:has-text("实用新型")').first().click();
await page2.getByRole('button', { name: /下一步：上传/ }).click();
await page2.waitForTimeout(300);
// Audit screen shows empty state
const id = page2.url().match(/projects\/([^/]+)/)?.[1];
if (!id) throw new Error('project id not found in ' + page2.url());
await page2.goto(BASE + `projects/${id}/audit`, { waitUntil: 'networkidle' });
await page2.waitForTimeout(200);
const emptyState = await page2.evaluate(() => document.body.textContent.includes('暂无审校结果'));
check('新项目审校屏显示空态（不再借用 demo 数据）', emptyState, `id=${id}`);
// Export must not block
await page2.goto(BASE + `projects/${id}/export`, { waitUntil: 'networkidle' });
await page2.getByRole('button', { name: '在本机生成导出包' }).click();
await page2.waitForTimeout(200);
const notBlocked = await page2.evaluate(() => !document.body.textContent.includes('正式申请文件导出已被阻止'));
check('新项目导出不再被 demo 门禁误拦', notBlocked);

// ---- Scenario 3: Audit matrix inline confirm button (fresh demo load) ----
const ctx3 = await browser.newContext();
const page3 = await ctx3.newPage();
page3.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[p3:${m.type()}] ${m.text()}`); });
await page3.goto(BASE, { waitUntil: 'networkidle' });
await page3.getByRole('button', { name: /载入示例项目/ }).click();
await page.waitForTimeout(300);
await page3.goto(BASE + 'projects/demo-hot-water-meter/audit', { waitUntil: 'networkidle' });
await page3.waitForTimeout(200);
const inlineBtn = await page3.getByRole('button', { name: '确认来源' }).count();
check('审校矩阵无来源行提供行内「确认来源」', inlineBtn === 1, `count=${inlineBtn}`);

console.log('\nconsole errors/warnings:', logs.length ? logs.join(' | ') : 'none');
const failed = results.filter((r) => !r.ok).length;
console.log(`\nverdict: ${failed === 0 ? 'PASS' : 'FAIL'} (${results.length - failed}/${results.length})`);
await browser.close();
process.exit(failed === 0 ? 0 : 1);
