// Browser interaction tests of the real consent UI with isolated fake runtime/
// generation seams. No provider endpoint is contacted and no real code is used.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { launchChromeWithPageTarget } from "../../helpers/chrome.mjs";
import * as esbuild from "esbuild";

let browser, server, ws, send;
const pending = new Map();
const errors = [];
let messageId = 0;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const evaluate = async expression => {
  const response = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.text);
  return response.result.value;
};
async function waitFor(expression) {
  for (let i = 0; i < 100; i++) {
    if (await evaluate(expression)) return;
    await pause(50);
  }
  throw new Error(`UI condition timed out: ${expression}`);
}
const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click(); true`);
const text = selector => evaluate(`document.querySelector(${JSON.stringify(selector)})?.textContent ?? null`);
const exists = selector => evaluate(`!!document.querySelector(${JSON.stringify(selector)})`);
async function mount(mode = "real", required = true, overrides = {}) {
  await evaluate(`fixture.reset(${JSON.stringify(mode)}, ${required}, ${JSON.stringify(overrides)}); true`);
  await waitFor(`!!document.querySelector('[data-testid="self-runtime-${mode}"]')`);
}
const codeInput = async value => {
  await evaluate(`(() => { const input = document.querySelector('[data-testid="self-consent-access-code"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event('input', {bubbles: true})); return true; })()`);
};

before(async () => {
  const root = resolve(import.meta.dirname, "../../../..");
  const build = await esbuild.build({
    stdin: { resolveDir: root, sourcefile: "consent-browser.tsx", loader: "tsx", contents: `
      import { createRoot } from 'react-dom/client';
      import { MemoryRouter } from 'react-router-dom';
      import { SelfGeneration } from './apps/web/src/v6/features/self-service/SelfGeneration.tsx';
      const root = createRoot(document.getElementById('root'));
      const repository = {}; const actor = {userId:'synthetic-user',tenantId:'synthetic-tenant'};
      let key=0;
      const DEFAULT_ANSWERS = { total:5, answered:5, sentCount:2, complete:true, missing:[], items:[
        {questionNo:1,key:'problem',label:'问题',answered:true,sent:true,characters:12,chunkId:'answer-problem'},
        {questionNo:2,key:'difference',label:'区别',answered:true,sent:true,characters:24,chunkId:'answer-difference'},
        {questionNo:3,key:'inventorIds',label:'发明人',answered:true,sent:false,characters:null,chunkId:null},
        {questionNo:4,key:'disclosure',label:'公开历史',answered:true,sent:false,characters:null,chunkId:null},
        {questionNo:5,key:'maturity',label:'成熟度',answered:true,sent:false,characters:null,chunkId:null},
      ]};
      const makeRuntime = (mode, required, overrides={}) => {
        const answers = overrides.answers ?? DEFAULT_ANSWERS;
        const files = overrides.noFiles ? [] : [{assetId:'synthetic-asset',name:'合成技术交底.docx',pageCount:6}];
        const chunks = answers.items.filter(item=>item.sent&&item.chunkId).map(item=>item.chunkId);
        if(files.length) chunks.push('document-chunk');
        const manifest = {files, title: overrides.title === undefined ? '合成案件标题' : overrides.title,
          titleSent: overrides.titleSent ?? true, factCount:4,chunkIds:chunks,draftRevisionIds:[],figureRevisionIds:[],answers};
        return { mode, engineOptions:{execution: mode === 'real' ? 'provider' : 'test'},
          processor:{name:'合成处理方',region:'合成区域',retention:'合成保留政策',trainingPolicy:'unknown',termsVersion:'synthetic-v1',model:'synthetic-model',...(overrides.processor??{})},
          unavailableReason: mode === 'test' ? (overrides.reason ?? '真实起草需要访问码。') : null,
          consent:{required,manifest:mode === 'test' && !overrides.includeManifest ? null : manifest,
            grant:async () => { fixture.grants++; if(fixture.defer) await new Promise(resolve=>fixture.release=resolve); return makeRuntime('real',false,overrides); }}
        };
      };
      window.fixture = {
        reset(mode,required,overrides) { this.grants=0;this.sessions=0;this.calls=0;this.defer=false;this.failAuth=false;
          this.runtime=makeRuntime(mode,required,overrides); this.mount(); },
        mount(targetId='synthetic-target') { root.render(<MemoryRouter><SelfGeneration key={++key} repository={repository} actor={actor} matterId='synthetic-matter' targetId={targetId} onAdopted={()=>{}} answerHref='/v6/new/synthetic-matter/questions'/></MemoryRouter>); },
        authenticated() { this.runtime=makeRuntime('real',true); },
      };
    ` },
    bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' }, logLevel: "silent",
    plugins: [{ name: "isolated-generation-seams", setup(build) {
      build.onResolve({ filter: /\/generation\/(runtime\.ts|Generation\.tsx)$/ }, args => ({path:args.path, namespace:"fixture"}));
      build.onLoad({ filter: /runtime\.ts$/, namespace: "fixture" }, () => ({loader:"js",contents:`
        export async function resolveGenerationRuntime() { return window.fixture.runtime; }
        export async function createGenerationSession(code) { window.fixture.sessions++; if(window.fixture.failAuth) throw new Error('synthetic authentication failure'); window.fixture.authenticated(); }
      `}));
      build.onLoad({ filter: /Generation\.tsx$/, namespace:"fixture" }, () => ({loader:"tsx",resolveDir:root,contents:`
        export function GenerationPanel(props) { return <div data-testid="fixture-generation" data-execution={props.engineOptions.execution}>
          <button data-testid="fixture-start" onClick={()=>window.fixture.calls++}>开始生成</button></div>; }
      `}));
    }}],
  });
  server = createServer((request,response) => {
    response.setHeader("content-type", request.url === "/fixture.js" ? "application/javascript" : "text/html; charset=utf-8");
    response.end(request.url === "/fixture.js" ? build.outputFiles[0].contents : '<div id="root"></div><script src="/fixture.js"></script>');
  });
  await new Promise(resolve => server.listen(0,"127.0.0.1",resolve));
  browser = await launchChromeWithPageTarget({ profilePrefix: "v6-consent-browser-" });
  ws = browser.socket;
  ws.addEventListener("message",event=> {
    const message=JSON.parse(event.data);
    if(message.id){ const handler=pending.get(message.id);pending.delete(message.id); if(handler) message.error ? handler.reject(new Error(JSON.stringify(message.error))) : handler.resolve(message.result); }
    if(message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails.text);
  });
  send=(method,params={})=>new Promise((resolve,reject)=> { const id=++messageId;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params})); });
  await send("Runtime.enable");
  await send("Page.navigate", {url:`http://127.0.0.1:${server.address().port}`});
  await waitFor("!!window.fixture");
});
after(async()=> {
  await browser?.close();
  if(server) await new Promise(resolve=>server.close(resolve));
});

test("real mode exposes the exact disclosure and mounts no generation engine before consent",async()=> {
  await mount();
  assert.match(await text('[data-testid="self-consent-disclosure"]'),/合成处理方.*合成区域.*合成保留政策/);
  assert.match(await text('[data-testid="self-consent-materials"]'),/合成技术交底.docx.*6 页.*4 条事实/s);
  const answers = await text('[data-testid="self-consent-answers"]');
  assert.match(answers,/第 1 题 · 问题 · 约 12 字/);
  assert.match(answers,/第 2 题 · 区别 · 约 24 字/);
  assert.match(answers,/发明人、公开历史、成熟度只在本机/);
  assert.doesNotMatch(answers,/宠物|技术交底正文/);
  assert.equal(await text('[data-testid="self-consent-title-sent"]'),"合成案件标题");
  assert.match(await text('[data-testid="self-consent-title"]'),/可能作为主题背景随本次请求外发/);
  assert.equal(await exists('[data-testid="fixture-generation"]'),false);
  assert.equal(await evaluate("fixture.grants+fixture.calls"),0);
});

test("a title that is not sent is disclosed as staying on the device, never hidden or implied sent",async()=> {
  await mount("real",true,{title:"仅本机标题",titleSent:false});
  assert.match(await text('[data-testid="self-consent-title-local"]'),/不外发；标题仅留在本机：仅本机标题/);
  assert.equal(await exists('[data-testid="self-consent-title-sent"]'),false);
});

test("answer-only disclosure has no empty file row and explains the actual outbound answers",async()=> {
  await mount("real",true,{noFiles:true});
  const materials = await text('[data-testid="self-consent-materials"]');
  assert.match(materials,/没有上传文档；本次内容来自你保存的回答与事实/);
  assert.doesNotMatch(materials,/0 个文件|0 份文件|0 个材料片段/);
  assert.match(await text('[data-testid="self-consent-answers"]'),/第 1 题 · 问题 · 约 12 字/);
  assert.match(await text('[data-testid="self-consent-answers"]'),/第 2 题 · 区别 · 约 24 字/);
});

test("incomplete answer-only manifest lists missing questions, links back, and disables real consent",async()=> {
  const answers = { total:5, answered:4, sentCount:2, complete:false, missing:["第 5 题（成熟度）"], items:[
    {questionNo:1,key:"problem",label:"问题",answered:true,sent:true,characters:12,chunkId:"answer-problem"},
    {questionNo:2,key:"difference",label:"区别",answered:true,sent:true,characters:24,chunkId:"answer-difference"},
    {questionNo:3,key:"inventorIds",label:"发明人",answered:true,sent:false,characters:null,chunkId:null},
    {questionNo:4,key:"disclosure",label:"公开历史",answered:true,sent:false,characters:null,chunkId:null},
    {questionNo:5,key:"maturity",label:"成熟度",answered:false,sent:false,characters:null,chunkId:null},
  ]};
  await mount("real",true,{noFiles:true,answers});
  assert.match(await text('[data-testid="self-consent-answer-gate"]'),/五题答完后才能真实起草/);
  assert.match(await text('[data-testid="self-consent-missing"]'),/第 5 题（成熟度）/);
  assert.equal(await evaluate("document.querySelector('[data-testid=self-consent-agree]').disabled"),true);
  assert.equal(await evaluate("document.querySelector('[data-testid=self-consent-answer-link]').getAttribute('href')"),"/v6/new/synthetic-matter/questions");
  assert.equal(await exists('[data-testid="fixture-generation"]'),false);
});

test("test fallback displays missing answer gates and a route back to questions",async()=> {
  await mount("test",false,{reason:"没有已解析的文档，且五个问题还没答完，缺：第 2 题（区别）、第 5 题（成熟度）。答完后才能真实起草。"});
  assert.match(await text('[data-testid="self-answer-incomplete"]'),/第 2 题（区别）、第 5 题（成熟度）/);
  assert.equal(await evaluate("document.querySelector('[data-testid=self-answer-link]').getAttribute('href')"),"/v6/new/synthetic-matter/questions");
});

test("cancelling consent makes no grant or model call and keeps real generation blocked",async()=> {
  await mount();
  await evaluate(`document.querySelector('[aria-label="关闭"]').click();true`);
  await waitFor("!document.querySelector('[role=dialog]')");
  assert.equal(await exists('[data-testid="fixture-generation"]'),false);
  assert.equal(await evaluate("fixture.grants+fixture.calls"),0);
});

test("explicit agreement enables real generation without a test-output notice",async()=> {
  await mount();
  await click('[data-testid="self-consent-agree"]');
  await waitFor("!!document.querySelector('[data-testid=fixture-generation]')");
  assert.equal(await evaluate("fixture.grants"),1);
  assert.equal(await evaluate("fixture.calls"),0);
  assert.equal(await exists('[data-testid="self-runtime-test"]'),false);
  assert.equal(await evaluate("document.querySelector('[data-testid=fixture-generation]').dataset.execution"),"provider");
  await click('[data-testid="fixture-start"]');
  assert.equal(await evaluate("fixture.calls"),1);
});

test("test fallback explains why real drafting is unavailable; session verification alone never grants consent",async()=> {
  await mount("test",false);
  assert.match(await text('[data-testid="self-runtime-test"]'),/真实起草需要访问码/);
  assert.match(await text('[data-testid="self-runtime-test"]'),/固定测试输出/);
  await click('[data-testid="self-runtime-consent-open"]');
  await waitFor("!!document.querySelector('[data-testid=self-consent-access-code]')");
  await codeInput("synthetic-test-code");
  await click('[data-testid="self-consent-authenticate"]');
  await waitFor("!!document.querySelector('[data-testid=self-runtime-real]')");
  assert.equal(await exists('[role="dialog"]'),true);
  assert.equal(await exists('[data-testid="fixture-generation"]'),false);
  assert.equal(await evaluate("fixture.sessions"),1);
  assert.equal(await evaluate("fixture.grants+fixture.calls"),0);
  assert.equal(await evaluate("localStorage.length + sessionStorage.length"),0);
  await click('[data-testid="self-consent-agree"]');
  await waitFor("!!document.querySelector('[data-testid=fixture-generation]')");
  assert.equal(await evaluate("fixture.grants"),1);
});

test("failed session authentication clears the input without allowing real generation",async()=> {
  await mount("test",false);
  await evaluate("fixture.failAuth=true;true");
  await click('[data-testid="self-runtime-consent-open"]');
  await waitFor("!!document.querySelector('[data-testid=self-consent-access-code]')");
  await codeInput("synthetic-invalid-code");
  await click('[data-testid="self-consent-authenticate"]');
  await waitFor("!!document.querySelector('[data-testid=self-consent-error]')");
  assert.equal(await evaluate("document.querySelector('[data-testid=self-consent-access-code]').value"),"");
  assert.equal(await evaluate("fixture.grants+fixture.calls"),0);
  assert.equal(await exists('[data-testid="fixture-generation"]'),false);
});

test("unknown policy fields stay unknown, and cancellation clears a temporary access code",async()=> {
  await mount("test",false,{processor:{name:"未知",region:"unknown",retention:"",model:null,termsVersion:null}});
  await click('[data-testid="self-runtime-consent-open"]');
  await waitFor("!!document.querySelector('[data-testid=self-consent-access-code]')");
  const disclosure=await text('[data-testid="self-consent-disclosure"]');
  assert.match(disclosure,/处理方未知区域未知保留未知/);
  assert.doesNotMatch(disclosure,/零保留|不用于训练/);
  await codeInput("synthetic-temporary-code");
  await send("Input.dispatchKeyEvent",{type:"keyDown",key:"Escape",code:"Escape",windowsVirtualKeyCode:27});
  await waitFor("!document.querySelector('[role=dialog]')");
  await click('[data-testid="self-runtime-consent-open"]');
  await waitFor("!!document.querySelector('[data-testid=self-consent-access-code]')");
  assert.equal(await evaluate("document.querySelector('[data-testid=self-consent-access-code]').value"),"");
});

test("an old asynchronous grant cannot enable generation after switching target",async()=> {
  await mount();
  await evaluate("fixture.defer=true;true");
  await click('[data-testid="self-consent-agree"]');
  await waitFor("!!fixture.release");
  await evaluate("fixture.mount('synthetic-other-target');true");
  await waitFor("!!document.querySelector('[data-testid=self-consent-agree]:not(:disabled)')");
  await evaluate("fixture.release();true");
  await pause(100);
  assert.equal(await exists('[data-testid="fixture-generation"]'),false);
  assert.equal(await exists('[role="dialog"]'),true);
  assert.deepEqual(errors,[]);
});
