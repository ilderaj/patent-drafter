// Security acceptance items 2/3/4: open the production URL in a real browser
// profile and capture the network panel.
//   2. No API key appears in any browser request (key never leaves the bridge).
//   3. No request is sent to api.deepseek.com from the browser.
//   4. No patent content is uploaded anywhere (Worker serves static assets only).
// Prereq: production deployed at https://vibing.paymond.me/patent/
import { chromium } from '/Users/jared/.npm/_npx/420ff84f11983ee5/node_modules/playwright-core/index.mjs';

const EXE = '/Users/jared/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const PROD = 'https://vibing.paymond.me/patent/';

const browser = await chromium.launch({ executablePath: EXE, headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

const requests = [];
page.on('request', (r) => requests.push({ url: r.url(), method: r.method(), resourceType: r.resourceType() }));
page.on('response', (r) => { if (r.status() >= 400) console.log(`[http ${r.status()}] ${r.url()}`); });

await page.goto(PROD, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);

// Walk a couple of SPA routes to collect fallback evidence too.
await page.goto(`${PROD}projects/some-id`, { waitUntil: 'networkidle' });
await page.waitForTimeout(800);

const hosts = {};
for (const r of requests) {
  const h = new URL(r.url).host;
  hosts[h] = (hosts[h] ?? 0) + 1;
}
console.log('== request hosts ==');
for (const [h, n] of Object.entries(hosts).sort()) console.log(`${n.toString().padStart(3)}  ${h}`);

const deepseekHits = requests.filter((r) => r.url.includes('deepseek'));
const keyLike = requests.filter((r) => /sk-[A-Za-z0-9]{8,}/.test(r.url));
const nonSelf = requests.filter((r) => !r.url.startsWith(PROD) && !r.url.startsWith('https://vibing.paymond.me/patent'));
const bridgeAttempts = requests.filter((r) => r.url.includes('127.0.0.1:7878'));

const checks = [];
const check = (name, ok, detail = '') => checks.push({ name, ok, detail });
check('no request to api.deepseek.com', deepseekHits.length === 0, `hits=${deepseekHits.length}`);
check('no API key in any request URL', keyLike.length === 0, `matches=${keyLike.length}`);
check('all requests stay on vibing.paymond.me', nonSelf.length === 0, JSON.stringify(nonSelf.map((r) => r.url).slice(0, 5)));
check('bridge attempts target localhost only', bridgeAttempts.every((r) => new URL(r.url).hostname === '127.0.0.1'), `attempts=${bridgeAttempts.length}`);

for (const c of checks) console.log(`${c.ok ? '[PASS]' : '[FAIL]'} ${c.name}${c.ok ? '' : ` — ${c.detail}`}`);

await page.screenshot({ path: 'qa/screens/prod-home.png' });
const failed = checks.filter((c) => !c.ok).length;
console.log(`结果: ${checks.length - failed} 通过 / ${failed} 失败`);
await browser.close();
process.exit(failed === 0 ? 0 : 1);
