// Structural smoke for the rebuilt self-service shell. Usage: node visual-smoke.mjs <outDir> <baseUrl>
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { launchChromeWithPageTarget } from "../../helpers/chrome.mjs";

const [outDir, base] = process.argv.slice(2);
const browser = await launchChromeWithPageTarget({ profilePrefix: "v6-self-smoke-" });
const ws = browser.socket;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
try {
let id = 0;
const pending = new Map();
const errors = [];
ws.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    pending.get(message.id)(message);
    pending.delete(message.id);
    return;
  }
  if (message.method === "Runtime.exceptionThrown") {
    const details = message.params.exceptionDetails;
    errors.push(`${details.text}${details.exception?.description ? `: ${details.exception.description}` : ""}`);
  }
  if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") {
    errors.push(message.params.args.map((arg) => arg.value ?? arg.description).join(" "));
  }
});
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const next = ++id;
  pending.set(next, (message) => (message.error ? reject(new Error(JSON.stringify(message.error))) : resolve(message.result)));
  ws.send(JSON.stringify({ id: next, method, params }));
});
const evaluate = async (expression) => (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result.value;
const waitFor = async (expression, label) => {
  for (let i = 0; i < 200; i++) {
    if (await evaluate(expression)) return;
    await sleep(100);
  }
  throw new Error(`timeout waiting for ${label}`);
};
const shot = async (name) => {
  const { data } = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(outDir, `${name}.png`), Buffer.from(data, "base64"));
};
const go = async (path) => { await send("Page.navigate", { url: base + path }); await sleep(300); };

await send("Page.enable");
await send("Runtime.enable");
await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });
const log = [];

await go("/patent/v6");
await waitFor(`!!document.querySelector('[data-testid=entry-self]')`, "start page");
await shot("self-start-light");
log.push({ page: "start", shell: await evaluate(`document.querySelector('.v6-simple-shell')?.className ?? null`), entries: await evaluate(`document.querySelectorAll('.entry-card').length`), toolbar: await evaluate(`!!document.querySelector('.toolbar')`) });

await evaluate(`document.querySelector('[data-testid=entry-self]').click(); true`);
await waitFor(`location.pathname.includes('/v6/new/') && !!document.querySelector('.wizard')`, "wizard upload");
const matterPath = await evaluate(`location.pathname`);
await waitFor(`!!document.querySelector('.wiz-rail') && !!document.querySelector('.wiz-card') && !!document.querySelector('.dropzone')`, "wizard structure");
await shot("self-upload-light");
log.push({
  page: "upload",
  path: matterPath,
  rail: await evaluate(`document.querySelectorAll('.wiz-rail .wiz-step').length`),
  railCase: await evaluate(`document.querySelector('.wr-case')?.textContent ?? null`),
  horizontalSteps: await evaluate(`document.querySelectorAll('.v6-self-steps').length`),
  dropzone: await evaluate(`!!document.querySelector('.dropzone')`),
  callout: await evaluate(`document.querySelector('.callout.info')?.textContent ?? null`),
});

const questionsPath = matterPath.replace(/\/upload$/, "/questions");
await go(questionsPath);
await waitFor(`!!document.querySelector('.q-wrap') && !!document.querySelector('.q-title')`, "questions page");
await shot("self-questions-light");
log.push({
  page: "questions",
  title: await evaluate(`document.querySelector('.q-title')?.textContent ?? null`),
  prog: await evaluate(`document.querySelectorAll('.q-prog i').length`),
  src: await evaluate(`document.querySelector('.q-src')?.textContent ?? null`),
  nav: await evaluate(`!!document.querySelector('.q-nav')`),
});

const setValue = async (selector, value) => evaluate(`(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  if (!el) throw new Error("missing " + ${JSON.stringify(selector)});
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value").set.call(el, ${JSON.stringify(value)});
  el.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
})()`);
const chooseSource = async (value) => {
  if (!(await evaluate(`!!document.querySelector('select[aria-label="这道题的来源"]')`))) {
    await evaluate(`(() => {
      const toggle = [...document.querySelectorAll('.q-src .link')].find((item) => item.textContent.includes('更改来源'));
      if (toggle) toggle.click();
      return true;
    })()`);
    await sleep(200);
  }
  return evaluate(`(() => {
    const el = document.querySelector('select[aria-label="这道题的来源"]');
    if (!el) throw new Error("source select missing");
    el.value = ${JSON.stringify(value)};
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`);
};
const clickNext = async () => {
  await evaluate(`document.querySelector('.q-nav .btn.primary').click(); true`);
  await sleep(400);
};
const clickOption = async (text) => evaluate(`(() => {
  const button = [...document.querySelectorAll('.optcard')].find((item) => item.textContent.includes(${JSON.stringify(text)}));
  if (!button) throw new Error("missing option " + ${JSON.stringify(text)});
  button.click();
  return true;
})()`);

await setValue('.q-wrap textarea', '宠物喝水时容易把杯子踩翻，水洒一地；外出携带时还会漏水。');
await chooseSource('not_found');
await sleep(200);
await clickNext();
await waitFor(`document.querySelector('.q-title')?.textContent.includes('改了什么')`, "question 2");
await setValue('.q-wrap textarea', '底部加了配重块，重心更低；出水口加了倾斜时自动关闭的阀片。');
await chooseSource('not_found');
await sleep(200);
await clickNext();
await waitFor(`document.querySelector('.q-title')?.textContent.includes('谁发明了它')`, "question 3");
await setValue('.q-wrap input[aria-label="发明人姓名"]', '测试发明人');
await evaluate(`[...document.querySelectorAll('.btn')].find((item) => item.textContent.trim() === '添加姓名').click(); true`);
await sleep(200);
log.push({ page: 'q3-click', checked: await evaluate(`document.querySelectorAll('.optcard.sel').length`) });
await chooseSource('direct');
await sleep(200);
await clickNext();
await shot("self-after-q3");
log.push({
  page: "after-q3",
  title: await evaluate(`document.querySelector('.q-title')?.textContent ?? null`),
  questionError: await evaluate(`document.querySelector('[data-testid=self-question-error]')?.textContent ?? null`),
  inventorChecked: await evaluate(`document.querySelectorAll('.optcard.sel').length`),
  sourceValue: await evaluate(`document.querySelector('select[aria-label="这道题的来源"]')?.value ?? null`),
});
try {
  await waitFor(`document.querySelector('.q-title')?.textContent.includes('对外公开')`, "question 4");
} catch (error) {
  console.log(JSON.stringify({ log, errors }, null, 2));
  throw error;
}
await clickOption('没有对外公开');
await sleep(200);
await chooseSource('direct');
await sleep(200);
await clickNext();
await waitFor(`document.querySelector('.q-title')?.textContent.includes('什么程度')`, "question 5");
await clickOption('已有测试样品');
await sleep(200);
await chooseSource('direct');
await evaluate(`document.querySelector('.q-nav .btn.primary').click(); true`);
await waitFor(`!!document.querySelector('.route-grid .route-card')`, "route page");
await shot("self-route-light");
log.push({
  page: "route",
  cards: await evaluate(`document.querySelectorAll('.route-grid .route-card').length`),
  extra: await evaluate(`document.querySelector('.route-extra')?.textContent ?? null`),
  foot: await evaluate(`document.querySelector('.wiz-foot')?.textContent ?? null`),
});

await evaluate(`document.querySelector('.wiz-foot .btn.primary').click(); true`);
await waitFor(`!!document.querySelector('[data-testid=generation]')`, "generation page");
await shot("self-generate-light");
log.push({
  page: "generate",
  title: await evaluate(`document.querySelector('.q-title, .wiz-h1')?.textContent ?? null`),
  panel: await evaluate(`document.querySelector('[data-testid=generation]')?.getAttribute('data-state') ?? null`),
  foot: await evaluate(`document.querySelector('.wiz-foot')?.textContent ?? null`),
});

await evaluate(`document.querySelector('[data-testid=generation-start]').click(); true`);
await waitFor(`!!document.querySelector('[data-testid=generation][data-job-state=succeeded]')`, "generation succeeded");
await evaluate(`document.querySelector('[data-testid=generation-adopt]')?.click(); true`);
await waitFor(`!!document.querySelector('[data-testid=self-view-draft]:not([disabled])')`, "adopted revision");
await evaluate(`document.querySelector('[data-testid=self-view-draft]').click(); true`);
await waitFor(`!!document.querySelector('[data-testid=preview]')`, "preview page");
await shot("self-preview-light");
log.push({
  page: "preview",
  rail: await evaluate(`document.querySelectorAll('.wiz-rail').length`),
  toolbar: await evaluate(`document.querySelector('.toolbar .tb-title')?.textContent ?? null`),
  subtitle: await evaluate(`document.querySelector('.toolbar .tb-sub')?.textContent ?? null`),
  pane: await evaluate(`document.querySelector('.pane')?.className ?? null`),
  buttons: await evaluate(`[...document.querySelectorAll('.toolbar .btn')].map((item) => item.textContent.trim())`),
});
await evaluate(`document.querySelector('[data-testid=self-preview-risks]').click(); true`);
await waitFor(`!!document.querySelector('.sheet')`, "risk sheet");
await shot("self-preview-risks-light");
log.push({
  page: "preview-risks",
  items: await evaluate(`document.querySelectorAll('.sheet .riskitem').length`),
  title: await evaluate(`document.querySelector('.sheet .sheet-h')?.textContent ?? null`),
});
await evaluate(`(() => { const close = [...document.querySelectorAll('.sheet .btn')].find((item) => item.textContent.trim() === '知道了'); if (close) close.click(); return true; })()`);
await sleep(300);
await evaluate(`document.querySelector('[data-testid=self-preview-download]').click(); true`);
await waitFor(`!!document.querySelector('[data-testid=done-page]')`, "done page");
await shot("self-done-light");
log.push({
  page: "done",
  rail: await evaluate(`document.querySelectorAll('.wiz-rail').length`),
  toolbar: await evaluate(`document.querySelector('.toolbar .tb-title')?.textContent ?? null`),
  subtitle: await evaluate(`document.querySelector('.toolbar .tb-sub')?.textContent ?? null`),
  pane: await evaluate(`document.querySelector('.pane')?.className ?? null`),
  buttons: await evaluate(`[...document.querySelectorAll('.toolbar .btn')].map((item) => item.textContent.trim())`),
});

for (const [page, path, testId] of [
  ["services", "/patent/v6/services", "section-services"],
  ["pricing", "/patent/v6/pricing", "section-pricing"],
  ["billing", "/patent/v6/billing", "section-billing"],
]) {
  await go(path);
  await waitFor(`!!document.querySelector('[data-testid=${testId}]')`, page);
  await shot(`self-${page}-light`);
  log.push({
    page,
    toolbar: await evaluate(`document.querySelector('.toolbar .tb-title')?.textContent ?? null`),
    cards: await evaluate(`document.querySelectorAll('.svc-card, .price-card, .card').length`),
    disabledButtons: await evaluate(`document.querySelectorAll('button[disabled]').length`),
  });
}

console.log(JSON.stringify({ log, errors }, null, 2));
await send("Page.close").catch(() => {});
} finally {
  await browser.close();
}
