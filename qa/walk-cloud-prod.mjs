// Cloud-mode E2E walk: shared-password unlock + attachment/text upload through
// the real cloud pipeline (wrangler dev + vite proxy + DeepSeek stub).
// Prereqs: node qa/deepseek-stub.mjs, npx wrangler dev --port 8787,
//          npm run dev (vite on 5173). Usage: node qa/walk-cloud.mjs
import { chromium } from '/Users/jared/.npm/_npx/420ff84f11983ee5/node_modules/playwright-core/index.mjs';

const EXE = '/Users/jared/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const BASE = 'https://vibing.paymond.me/patent/';
// The production access password must be injected — never hardcoded in the repo.
const PASSWORD = process.env.PATENT_CLOUD_PASSWORD;
if (!PASSWORD) {
  console.error('PATENT_CLOUD_PASSWORD env var is required (e.g. PATENT_CLOUD_PASSWORD=... node qa/walk-cloud-prod.mjs)');
  process.exit(2);
}

const browser = await chromium.launch({ executablePath: EXE, headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const logs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
page.on('response', (r) => { if (r.status() >= 400 || r.url().includes('/api/providers/deepseek/chat')) logs.push(`[http ${r.status()}] ${r.url()}`); });

async function shot(name) {
  await page.screenshot({ path: `qa/screens/prod-cloud-${name}.png` });
}

async function go(path = '') {
  await page.goto(BASE + path, { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);
}

async function dump(label) {
  const data = await page.evaluate(() => {
    const q = (s) => [...document.querySelectorAll(s)];
    return {
      url: location.pathname,
      h1: q('h1').map((e) => e.textContent.trim()),
      buttons: q('button').map((e) => e.textContent.trim()).filter(Boolean),
      disabled: q('button[disabled]').map((e) => e.textContent.trim()),
      files: q('.file-row').map((e) => e.textContent.trim().replace(/\s+/g, ' ')),
      status: q('.bridge-status').map((e) => e.textContent.trim().replace(/\s+/g, ' ')),
      paras: q('p').map((e) => e.textContent.trim().slice(0, 80)),
    };
  });
  console.log(`\n=== ${label} === ${data.url}`);
  console.log(JSON.stringify(data));
}

async function clickText(text) {
  const btn = page.getByRole('button', { name: text, exact: false });
  const n = await btn.count();
  if (!n) throw new Error(`button not found: ${text}`);
  await btn.first().click();
  await page.waitForTimeout(400);
}

let pass = 0;
const check = (name, ok, extra = '') => {
  pass += ok ? 1 : 0;
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${extra ? ' — ' + extra : ''}`);
};

await go();
await page.evaluate(() => localStorage.clear());
await go();
await dump('home');

// 1) Cloud mode detected (sidebar shows unlock entry, not "Bridge 未连接").
await page.waitForTimeout(800);
const statusText = await page.locator('.bridge-status').textContent();
check('cloud mode detected in sidebar', statusText.includes('云端'), statusText.trim());

// 2) Unlock with the shared password.
await clickText('云端未解锁');
await dump('unlock');
await page.getByPlaceholder('访问密码').fill(PASSWORD);
await clickText('解锁');
await page.waitForTimeout(800);
const afterUnlock = await page.locator('.bridge-status').textContent();
check('unlock succeeded', afterUnlock.includes('已解锁'), afterUnlock.trim());

// 3) New project → upload attachment + pasted text together.
await clickText('＋ 新建项目');
await page.getByPlaceholder('例如：一种基于三模通讯的共享热水表').fill('云端走查项目');
await clickText('下一步');
await dump('upload');
await page.setInputFiles('input[type="file"]', {
  name: '交底云端.txt',
  mimeType: 'text/plain',
  buffer: Buffer.from(
    '一种基于三模通讯的共享热水表，包括热水表本体、控制主板与控制器；控制主板连接射频模块、蓝牙模块与 470MHz 通讯模块；蓝牙 mesh 自组网，470MHz 连接网关，网关连接云端，云端连接远程控制器。',
  ),
});
await page.waitForTimeout(900);
await page.getByPlaceholder('在此粘贴技术交底内容（例如：产品结构、通讯方式、技术效果等）。支持多个段落，每段一行。')
  .fill('补充说明：热水表本体长度为 87.9mm，宽度 75.23mm。');
await dump('upload-filled');
await shot('upload-filled');

const uploadText = await page.locator('body').textContent();
check('attachment extracted', uploadText.includes('已提取') && uploadText.includes('✓ 已提取'));
check('combined material counted', /已就绪材料共 [\d,]+ 字/.test(uploadText));

// 4) Start live drafting through the cloud pipeline (stub upstream).
await clickText('开始真实起草');
await page.waitForFunction(
  () => location.pathname.includes('/intake'),
  { timeout: 600000 },
).catch(() => {});
await dump('intake');
await shot('intake');
const intakeText = await page.locator('body').textContent();
check('pipeline reached intake questions', /补充通讯模块与表体的连接安装结构/.test(intakeText) || intakeText.includes('问题'), '');

// 5) Answer the intake (first question) to prove the live runner round-trips.
const nextBtn = page.getByRole('button').filter({ hasText: /下一个问题|完成补充/ }).first();
if (await nextBtn.count()) {
  const radio = page.locator('.radio-card, [class*="radio"]').first();
  if (await radio.count()) await radio.click();
  await page.waitForTimeout(200);
  await nextBtn.click();
  await page.waitForTimeout(1500);
  await shot('intake-answered');
}

console.log(`\nRESULT: ${pass} passed`);
console.log('CONSOLE:\n' + (logs.join('\n') || '(clean)'));
await browser.close();
process.exit(pass >= 8 ? 0 : 1);
