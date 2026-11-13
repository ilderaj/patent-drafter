import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'tsx/esm/api';
register();
const { createWorker, MAX_BODY_BYTES, ALLOWED_LLM_STAGES, MIN_ACCESS_CODE_LENGTH } = await import('../src/index.ts');
const { STAGES } = await import('../../../packages/pipeline/src/stages.ts');
const NOW = Date.parse('2026-11-12T12:00:00Z');
const MANIFEST = 'a'.repeat(64);
function setup(overrides = {}, fetchImpl = async () => new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }))) {
  const rows = new Map();
  const env = { ASSETS: { fetch: async () => new Response('asset') }, RATE_LIMIT: { get: async k => rows.get(k) ?? null, put: async (k,v) => { rows.set(k,v); } },
    MODEL_API_KEY: 'test-key-not-real', MODEL_BASE_URL: 'https://model.example/v1', MODEL_NAME: 'fixture-model', ACCESS_CODE: 'fixture-access-code-long', SESSION_SECRET: 'x'.repeat(48),
    PROCESSOR_NAME: 'Fixture processor', PROCESSOR_REGION: 'fixture-region', PROCESSOR_RETENTION: 'fixture-policy-v1', PROCESSOR_TRAINING_POLICY: 'no_training', PROCESSOR_TERMS_VERSION: 'fixture-terms-v1', ...overrides };
  let calls = 0, sent, clock = NOW;
  const worker = createWorker(env, { now: () => clock, fetchImpl: async (...args) => { calls++; sent = args; return fetchImpl(...args); } });
  const req = (path, options = {}) => worker.fetch(new Request(`https://app.example${path}`, options));
  const post = (path, body, cookie = '', headers = {}) => req(path, { method: 'POST', headers: { 'content-type':'application/json', cookie, ...headers }, body: JSON.stringify(body) });
  const login = async () => {
    const response = await post('/api/v6/session', { accessCode: env.ACCESS_CODE });
    assert.equal(response.status, 200);
    return response.headers.get('set-cookie').split(';')[0];
  };
  const status = async (cookie = '') => (await req('/api/v6/status', { headers: { cookie } })).json();
  const grant = async (cookie, fields = {}) => {
    const body = { profileVersion:(await status()).profileVersion, manifestHash:MANIFEST, ...fields };
    const response = await post('/api/v6/consent',body,cookie);
    assert.equal(response.status,200);
    return { ...(await response.json()), profileVersion:body.profileVersion, manifestHash:body.manifestHash };
  };
  const chatBody = (proof, overrides = {}) => ({ requestId:'r1',prompt:'fixture',stage:'draft_claims',profileVersion:proof.profileVersion,
    manifestHash:proof.manifestHash,consentCredential:proof.credential,...overrides });
  return { env, req, post, login, status, grant, chatBody, rows, now: ms=>{clock=ms}, calls: () => calls, sent: () => sent };
}
test('stage allowlist exactly matches the 13 actual LLM stages',()=>{
  assert.deepEqual([...ALLOWED_LLM_STAGES],STAGES.filter(s=>s.kind==='llm').map(s=>s.id));
});
test('status discloses only public configuration and separates authentication', async () => {
  const s = setup(); const value = await s.status();
  assert.equal(value.available, true); assert.equal(value.authenticated, false);assert.equal(value.sessionId,null);
  assert.equal(value.processor.region, 'fixture-region');assert.ok(Number.isSafeInteger(value.profileVersion));
  const raw = JSON.stringify(value);
  for (const secret of [s.env.MODEL_API_KEY, s.env.ACCESS_CODE, s.env.SESSION_SECRET, s.env.MODEL_BASE_URL]) assert.ok(!raw.includes(secret));
  const cookie = await s.login();const authenticated = await s.status(cookie);
  assert.equal(authenticated.authenticated, true);assert.match(authenticated.sessionId,/^[0-9a-f]{64}$/);
  assert.ok(!JSON.stringify(authenticated).includes(cookie));
});
test('missing configuration or unknown disclosure disables chat without upstream call', async () => {
  for (const key of ['MODEL_API_KEY','MODEL_BASE_URL','MODEL_NAME','ACCESS_CODE','SESSION_SECRET','RATE_LIMIT','PROCESSOR_NAME','PROCESSOR_REGION','PROCESSOR_RETENTION','PROCESSOR_TRAINING_POLICY','PROCESSOR_TERMS_VERSION']) {
    const s = setup({ [key]: undefined }); assert.equal((await s.status()).available, false, key);
    assert.equal((await s.post('/api/v6/chat', {})).status, 503); assert.equal(s.calls(), 0);
  }
  assert.equal((await setup({ MODEL_BASE_URL: 'http://model.example' }).status()).available, false);
  assert.equal((await setup({ MODEL_BASE_URL: 'https://user@example.com' }).status()).available, false);
});
test('short access code fails configuration closed; the minimum is explicit',async()=>{
  assert.equal(MIN_ACCESS_CODE_LENGTH,16);
  const s=setup({ACCESS_CODE:'x'.repeat(15)});assert.equal((await s.status()).available,false);
  assert.equal((await s.post('/api/v6/session',{accessCode:s.env.ACCESS_CODE})).status,503);
  assert.equal((await setup({ACCESS_CODE:'x'.repeat(16)}).status()).available,true);
});
test('session requires access code, uses protected short cookie, and counts attempts best effort by IP', async () => {
  const s = setup();const ok = await s.post('/api/v6/session', { accessCode: s.env.ACCESS_CODE });
  assert.match(ok.headers.get('set-cookie'), /HttpOnly; Secure; SameSite=Strict/);
  for (let i=0;i<9;i++) assert.equal((await s.post('/api/v6/session', { accessCode: 'bad' })).status, 401);
  assert.equal((await s.post('/api/v6/session', { accessCode: s.env.ACCESS_CODE })).status, 429);
  assert.equal(s.calls(), 0);
});
test('chat requires untampered unexpired session and same-origin writes', async () => {
  const s = setup();const proofVersion = (await s.status()).profileVersion;
  const body = {requestId:'r1',prompt:'fixture',profileVersion:proofVersion};
  assert.equal((await s.post('/api/v6/chat', body)).status, 401);
  const cookie = await s.login();
  assert.equal((await s.post('/api/v6/chat', body, cookie+'bad')).status, 401);
  assert.equal((await s.post('/api/v6/chat', body, cookie, { origin:'https://evil.example' })).status, 403);
  s.now(NOW+7_200_001);
  assert.equal((await s.post('/api/v6/chat',body,cookie)).status,401);assert.equal(s.calls(),0);
});
test('consent requires a session, current profile and exact hash; it never invokes a model or stores material',async()=>{
  const s=setup();const profileVersion=(await s.status()).profileVersion;
  assert.equal((await s.post('/api/v6/consent',{profileVersion,manifestHash:MANIFEST})).status,401);
  const cookie=await s.login();
  for(const manifestHash of ['bad','A'.repeat(64),''])assert.equal((await s.post('/api/v6/consent',{profileVersion,manifestHash},cookie)).status,400);
  assert.equal((await s.post('/api/v6/consent',{profileVersion:profileVersion+1,manifestHash:MANIFEST},cookie)).status,409);
  assert.equal((await s.post('/api/v6/consent',{profileVersion,manifestHash:MANIFEST},cookie,{origin:'https://evil.example'})).status,403);
  const proof=await s.grant(cookie);assert.match(proof.credential,/^c1\./);assert.deepEqual(proof.allowedStages,[...ALLOWED_LLM_STAGES]);
  assert.equal(Date.parse(proof.expiresAt),NOW+30*60*1000);assert.equal(s.calls(),0);assert.equal(s.rows.size,1);
});
test('chat without proof, with a forged proof or a mismatched manifest never reaches upstream',async()=>{
  const s=setup();const cookie=await s.login();const proof=await s.grant(cookie);const body=s.chatBody(proof);
  for(const override of [{consentCredential:undefined},{consentCredential:proof.credential+'bad'},{manifestHash:'b'.repeat(64)}]) {
    assert.equal((await s.post('/api/v6/chat',{...body,...override},cookie)).status,409);
  }
  assert.equal(s.calls(),0);
});
test('unknown/local stages and malformed request fields are rejected before upstream',async()=>{
  const s=setup();const cookie=await s.login();const proof=await s.grant(cookie);const body=s.chatBody(proof);
  for(const stage of ['unknown','support','export','ingest_sources','merge_user_confirmations',null,42]) {
    assert.equal((await s.post('/api/v6/chat',{...body,stage},cookie)).status,400,String(stage));
  }
  for(const override of [{context:{}},{maxTokens:16385},{maxTokens:1.5},{temperature:-1},{requestId:'x'.repeat(129)},{model:'attacker-model'},{profileVersion:'1'}]){
    assert.equal((await s.post('/api/v6/chat',{...body,...override},cookie)).status,400);
  }
  assert.equal(s.calls(),0);
});
test('proof expiry, a new login, and a changed processor profile all block old proof without upstream',async()=>{
  for(const change of ['expired','new-session','profile']){
    const s=setup();let cookie=await s.login();const proof=await s.grant(cookie);
    if(change==='expired')s.now(NOW+30*60*1000+1);
    if(change==='new-session')cookie=await s.login();
    if(change==='profile')s.env.MODEL_NAME='changed-model';
    assert.equal((await s.post('/api/v6/chat',s.chatBody(proof),cookie)).status,409,change);assert.equal(s.calls(),0);
  }
});
test('secret/access rotation invalidates sessions; changing profile invalidates proof but not the login',async()=>{
  for(const key of ['ACCESS_CODE','SESSION_SECRET']){
    const s=setup();const cookie=await s.login();const proof=await s.grant(cookie);s.env[key]='rotated-fixture-value-that-is-long-enough';
    assert.equal((await s.post('/api/v6/chat',s.chatBody(proof),cookie)).status,401);assert.equal(s.calls(),0);
  }
  const s=setup();const cookie=await s.login();s.env.PROCESSOR_RETENTION='changed-policy';assert.equal((await s.status(cookie)).authenticated,true);
});
test('DELETE session clears the current cookie, rejects cross-origin, and does not claim to revoke copied tokens',async()=>{
  const s=setup();const cookie=await s.login();
  assert.equal((await s.req('/api/v6/session',{method:'DELETE',headers:{cookie,origin:'https://evil.example'}})).status,403);
  const response=await s.req('/api/v6/session',{method:'DELETE',headers:{cookie}});
  assert.equal(response.status,200);assert.deepEqual(await response.json(),{authenticated:false});
  assert.match(response.headers.get('set-cookie'),/Max-Age=0; HttpOnly; Secure; SameSite=Strict/);
  assert.equal((await s.status()).authenticated,false,'browser with cleared cookie');
  assert.equal((await s.status(cookie)).authenticated,true,'copied stateless token is still valid until expiry');
});
test('chat fixes model/endpoint and returns content without upstream metadata', async () => {
  const s=setup();const cookie=await s.login();const proof=await s.grant(cookie);
  assert.equal((await s.post('/api/v6/chat',s.chatBody(proof,{profileVersion:proof.profileVersion+1}),cookie)).status,409);
  const response=await s.post('/api/v6/chat',s.chatBody(proof,{context:[{text:'source'}]}),cookie);
  assert.equal(response.status,200);assert.deepEqual(await response.json(),{content:'{"ok":true}'});
  const [url,init]=s.sent();assert.equal(url,'https://model.example/v1/chat/completions');
  assert.equal(JSON.parse(init.body).model,s.env.MODEL_NAME);assert.equal(init.redirect,'manual');
  assert.equal(s.rows.size,2,'only session and chat counters are stored');assert.ok([...s.rows.values()].every(v=>/^\d+$/.test(v)));
});
test('body limit counts actual bytes without trusting content-length', async () => {
  const s=setup();const cookie=await s.login();const proof=await s.grant(cookie);
  const response=await s.post('/api/v6/chat',s.chatBody(proof,{prompt:'x'.repeat(MAX_BODY_BYTES)}),cookie);
  assert.equal(response.status,413);assert.equal(s.calls(),0);
});
test('sequential best-effort daily counter and KV failure fail closed', async () => {
  const s=setup({RATE_LIMIT_PER_DAY:'1'});const cookie=await s.login();const proof=await s.grant(cookie);const body=s.chatBody(proof);
  assert.equal((await s.post('/api/v6/chat',body,cookie)).status,200);
  assert.equal((await s.post('/api/v6/chat',body,cookie)).status,429);assert.equal(s.calls(),1);
  s.env.RATE_LIMIT.get=async()=>{throw Error('private detail')};
  const fail=await s.post('/api/v6/chat',body,cookie);assert.equal(fail.status,503);assert.ok(!(await fail.text()).includes('private detail'));
});
test('upstream failures expose only status, never body/key; malformed success fails', async () => {
  for(const upstreamStatus of [400,401,429,500]){
    const s=setup({},async()=>new Response('private-upstream-detail',{status:upstreamStatus}));const cookie=await s.login();const proof=await s.grant(cookie);
    const response=await s.post('/api/v6/chat',s.chatBody(proof),cookie);assert.equal(response.status,upstreamStatus===429?429:502);
    assert.deepEqual(await response.json(),{error:{code:'UPSTREAM_ERROR',upstreamStatus}});
  }
  const s=setup({},async()=>new Response('malformed-upstream-private-data'));const cookie=await s.login();const proof=await s.grant(cookie);
  const response=await s.post('/api/v6/chat',s.chatBody(proof),cookie);assert.equal(response.status,502);assert.ok(!(await response.text()).includes('private-data'));
});
test('root redirects to v6, static resources retain asset binding, unknown API does not return SPA', async () => {
  const s=setup();assert.equal((await s.req('/')).headers.get('location'),'/v6');
  assert.equal(await(await s.req('/assets/app.js')).text(),'asset');assert.equal((await s.req('/api/v6/missing')).status,404);
});
test('upstream redirects are never followed and never forward the key', async () => {
  for(const status of [301,302,307,308]){
    const s=setup({},async()=>new Response(null,{status,headers:{location:'https://evil.example/steal'}}));
    const cookie=await s.login();const proof=await s.grant(cookie);const response=await s.post('/api/v6/chat',s.chatBody(proof),cookie);
    assert.equal(response.status,502);assert.deepEqual(await response.json(),{error:{code:'UPSTREAM_ERROR',upstreamStatus:status}});
    assert.equal(s.calls(),1);assert.equal(s.sent()[1].redirect,'manual');
  }
});
