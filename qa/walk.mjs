// QA walkthrough helper: drives the patent web app with playwright-core (headless).
// Usage: node qa/walk.mjs <command> [args]
import { chromium } from '/Users/jared/.npm/_npx/420ff84f11983ee5/node_modules/playwright-core/index.mjs';

const EXE = '/Users/jared/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const BASE = 'http://localhost:5173/patent/';

const browser = await chromium.launch({ executablePath: EXE, headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const logs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
page.on('response', (r) => { if (r.status() >= 400) logs.push(`[http ${r.status()}] ${r.url()}`); });

async function shot(name) {
  await page.screenshot({ path: `qa/screens/walk-${name}.png` });
  return name;
}

async function go(path = '') {
  const joined = BASE.endsWith('/') && path.startsWith('/') ? BASE + path.slice(1) : BASE + path;
  await page.goto(joined, { waitUntil: 'networkidle' });
  await page.waitForTimeout(200);
}

async function dump(label) {
  const data = await page.evaluate(() => {
    const q = (s) => [...document.querySelectorAll(s)];
    return {
      url: location.pathname,
      h1: q('h1').map((e) => e.textContent.trim()),
      buttons: q('button').map((e) => e.textContent.trim()).filter(Boolean),
      disabled: q('button[disabled]').map((e) => e.textContent.trim()),
      inputs: q('input,textarea').map((e) => `${e.tagName.toLowerCase()}${e.placeholder ? '[' + e.placeholder + ']' : ''}${e.getAttribute('aria-label') ? '@' + e.getAttribute('aria-label') : ''}`),
      alerts: q('[role="alert"]').map((e) => e.textContent.trim().slice(0, 80)),
    };
  });
  console.log(`\n=== ${label} === ${data.url}`);
  console.log(JSON.stringify(data));
}

async function clickText(text, opts = {}) {
  const btn = page.getByRole('button', { name: text, exact: opts.exact ?? false });
  const n = await btn.count();
  if (!n) throw new Error(`button not found: ${text}`);
  await btn.first().click();
  await page.waitForTimeout(300);
}

async function fillPlaceholder(ph, value) {
  await page.getByPlaceholder(ph).fill(value);
  await page.waitForTimeout(150);
}

async function a11y(label) {
  const issues = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('button').forEach((b) => {
      if (!b.textContent.trim() && !b.getAttribute('aria-label')) out.push(`button w/o name: ${b.outerHTML.slice(0, 80)}`);
    });
    document.querySelectorAll('input:not([type="hidden"]),textarea').forEach((i) => {
      const labelled = i.getAttribute('aria-label') || i.labels?.length > 0 || i.placeholder;
      if (!labelled) out.push(`input w/o label: <${i.tagName.toLowerCase()}> ${i.outerHTML.slice(0, 80)}`);
    });
    document.querySelectorAll('img').forEach((im) => {
      if (!im.alt && im.getAttribute('role') !== 'presentation') out.push(`img w/o alt: ${im.src.slice(-40)}`);
    });
    document.querySelectorAll('a').forEach((a) => {
      if (!a.textContent.trim() && !a.getAttribute('aria-label')) out.push(`link w/o name: ${a.getAttribute('href')}`);
    });
    return out;
  });
  console.log(`[a11y:${label}] ${issues.length ? issues.join(' | ') : 'OK'}`);
}

const cmd = process.argv[2] || 'flow';

if (cmd === 'flow') {
  // Fresh state
  await go();
  await page.evaluate(() => localStorage.clear());
  await go();
  await dump('home');
  await shot('01-home');
  await a11y('home');

  // New project
  await clickText('新建项目');
  await dump('new');
  await shot('02-new');
  await a11y('new');
  await fillPlaceholder('例如：一种基于三模通讯的共享热水表', '走查测试项目');
  await clickText('下一步：上传交底材料');

  // Upload
  await dump('upload');
  await shot('03-upload');
  await a11y('upload');
  await clickText('载入示例交底');
  await clickText('开始解析');

  // Readiness
  await dump('readiness');
  await shot('04-readiness');
  await a11y('readiness');
  await clickText(/开始 Intake|开始补充|补充信息/);

  // Intake: answer 4 questions
  for (let i = 0; i < 4; i++) {
    await dump(`intake-${i + 1}`);
    const radio = page.locator('.radio-card, [class*="radio"]').first();
    if (await radio.count()) await radio.click();
    await page.waitForTimeout(150);
    const nextBtn = page.getByRole('button').filter({ hasText: /下一个问题|完成补充/ }).first();
    if (await nextBtn.count()) await nextBtn.click();
    await page.waitForTimeout(300);
  }
  await shot('05-intake-end');

  // Strategy
  await dump('strategy');
  await shot('06-strategy');
  await a11y('strategy');
  const chk = page.locator('input[type="checkbox"]').first();
  if (await chk.count()) { await chk.check(); await page.waitForTimeout(150); }
  const confirmBtn = page.getByRole('button').filter({ hasText: /确认|开始起草/ }).first();
  if (await confirmBtn.count()) await confirmBtn.click();
  await page.waitForTimeout(400);

  // Workbench
  await dump('workbench');
  await shot('07-workbench');
  await a11y('workbench');

  // Audit
  const auditLink = page.locator('a[href*="/audit"]').first();
  if (await auditLink.count()) { await auditLink.click(); await page.waitForTimeout(300); await dump('audit'); await shot('08-audit'); }

  // Export
  await go('/projects/' + (await page.evaluate(() => location.pathname.split('/')[3])) + '/export');
  await dump('export');
  await shot('09-export');
  await clickText('在本机生成导出包');
  const gate = await page.locator('.notice').filter({ hasText: '审校门禁' }).count();
  console.log(`[export-gate] blocked-by-audit: ${gate > 0}`);
  await shot('09b-export-gate');
  const fixBtn = page.getByRole('button').filter({ hasText: /去处理/ }).first();
  if (await fixBtn.count()) await fixBtn.click();
  await page.waitForTimeout(300);
  await dump('back-to-workbench');

  // History
  await go('/projects/' + (await page.evaluate(() => location.pathname.split('/')[3])) + '/history');
  await dump('history');
  await shot('10-history');

  console.log('\nCONSOLE:\n' + (logs.join('\n') || '(clean)'));
}

if (cmd === 'screenshot') {
  await go(process.argv[3] || '');
  await shot('manual');
  console.log('done');
}

if (cmd === 'keys') {
  await go();
  await page.evaluate(() => localStorage.clear());
  await go();

  const tabUntil = async (match, max = 24) => {
    for (let i = 0; i < max; i++) {
      const t = await page.evaluate(() => (document.activeElement?.textContent || document.activeElement?.getAttribute('placeholder') || document.activeElement?.tagName || '').trim().slice(0, 30));
      if (t.includes(match)) return t;
      await page.keyboard.press('Tab');
      await page.waitForTimeout(40);
    }
    return '(not found)';
  };

  // 1) New project: autofocus on title input; Enter proceeds after typing
  await clickText('新建项目');
  const active0 = await page.evaluate(() => document.activeElement?.tagName + (document.activeElement?.placeholder ? '[' + document.activeElement.placeholder + ']' : ''));
  console.log(`[keys] autofocus on /new: ${active0}`);
  await page.keyboard.type('键盘测试项目');
  await page.keyboard.press('Tab');
  const active1 = await page.evaluate(() => document.activeElement?.textContent?.trim().slice(0, 20));
  console.log(`[keys] after 1x Tab: ${active1}`);

  // Tab until the primary action and Enter
  const active2 = await tabUntil('下一步');
  console.log(`[keys] reached: ${active2}`);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  console.log(`[keys] after Enter url: ${await page.evaluate(() => location.pathname)}`);

  // 2) Intake options: Tab into radio-card, Space to select, Enter on next
  await clickText('载入示例交底');
  await clickText('开始解析');
  await clickText('开始补充信息（4 个问题）');
  for (let q = 0; q < 4; q++) {
    await page.keyboard.press('Tab'); // first option
    await page.keyboard.press('Space'); // select
    await page.waitForTimeout(120);
    const t = await tabUntil(q === 3 ? '完成补充' : '下一个问题');
    console.log(`[keys] intake q${q + 1} focused: ${t}`);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
  }
  console.log(`[keys] after intake url: ${await page.evaluate(() => location.pathname)}`);

  // 3) Strategy: Tab to checkbox, Space check, Tab to confirm, Enter
  const tabUntilType = async (type, max = 24) => {
    for (let i = 0; i < max; i++) {
      const t = await page.evaluate(() => document.activeElement?.type || '');
      if (t === type) return t;
      await page.keyboard.press('Tab');
      await page.waitForTimeout(40);
    }
    return '(not found)';
  };
  const cbType = await tabUntilType('checkbox');
  console.log(`[keys] strategy reached: checkbox(${cbType})`);
  const cb = await page.evaluate(() => document.activeElement?.type);
  await page.keyboard.press('Space');
  await page.waitForTimeout(120);
  const confirmTxt = await tabUntil('确认并生成权利要求骨架');
  console.log(`[keys] strategy confirm reached: ${confirmTxt}`);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  console.log(`[keys] after strategy url: ${await page.evaluate(() => location.pathname)}`);
}

if (cmd === 'tour') {
  // Spot check remaining screens with fresh demo state
  await go();
  await page.evaluate(() => localStorage.clear());
  await go();
  await clickText('载入示例项目（热水表）');
  await page.waitForTimeout(400);
  const pid = await page.evaluate(() => location.pathname.split('/')[3]);
  console.log(`[tour] demo project: ${pid}, url: ${await page.evaluate(() => location.pathname)}`);
  await dump('demo-workbench');
  await shot('demo-01-workbench');

  for (const [seg, label] of [['figures', 'figures'], ['audit', 'audit'], ['export', 'export'], ['history', 'history']]) {
    await go(`/projects/${pid}/${seg}`);
    await dump(label);
    await shot(`demo-02-${label}`);
  }

  await go('/rules');
  await dump('rules');
  await shot('demo-03-rules');
  await go('/nobridge');
  await dump('nobridge');
  await shot('demo-04-nobridge');

  const mp = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await mp.goto(BASE + 'mobile', { waitUntil: 'networkidle' });
  await mp.waitForTimeout(300);
  console.log(`[tour] mobile url: ${await mp.evaluate(() => location.pathname)}`);
  await mp.screenshot({ path: 'qa/screens/walk-demo-05-mobile-home.png' });
  await mp.goto(BASE + 'mobile/workbench', { waitUntil: 'networkidle' });
  await mp.waitForTimeout(300);
  await mp.screenshot({ path: 'qa/screens/walk-demo-06-mobile-workbench.png' });
  await mp.close();
}

await browser.close();
