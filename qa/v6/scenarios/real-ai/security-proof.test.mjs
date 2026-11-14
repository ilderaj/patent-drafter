import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'tsx/esm/api';
register();
const { createWorker } = await import('../../../../apps/worker-v6/src/index.ts');
const { resolveGenerationRuntime, createGenerationSession, endGenerationSession } = await import('../../../../apps/web/src/v6/features/generation/runtime.ts');
const { createGenerationEngine } = await import('../../../../apps/web/src/v6/features/generation/generation.ts');
const { loadAiView, validateConsentForUse, revokeConsent } = await import('../../../../apps/web/src/v6/features/ai/ai.ts');
const { targetConfigKey } = await import('../../../../apps/web/src/v6/features/targets/targets.ts');
const { ACTOR, MATTER_ID, TARGET_ID, T0, SUPPORT_ASSET_ID, createFixture, waitForJob } = await import('../V6-17/harness.mjs');
const { MOCK_STAGE_OUTPUTS } = await import('../../../../packages/pipeline/src/mock.ts');
const { providerRecoveryFor, userMessageFor } = await import('../../../../apps/web/src/v6/lib/user-messages.ts');
const { draftRevisionSchema } = await import('../../../../packages/contracts/src/draft.ts');

/** Actual browser provider -> actual relay -> injected synthetic upstream. No external model or real secrets. */
async function fixture(uploaded = false) {
  const f = await createFixture({withFacts:uploaded});
  const writeId = crypto.randomUUID();
  await f.backend.transaction('readwrite',async tx=>{
    const snapshotKey=`intake/snapshot/${MATTER_ID}/1`;const snapshot=await tx.get('blobs',snapshotKey);
    snapshot.snapshot.answers={problem:'手工抄表成本高。',difference:'使用三模通讯模块自动上报读数。',inventorIds:['44444444-4444-4444-8444-444444444441'],disclosure:'none',maturity:'drawing',disclosureDetail:null};
    await tx.put('blobs',snapshotKey,snapshot);
    const aggregate=await tx.get('matters',MATTER_ID);aggregate.matter.title='真实外发标题-原始';
    if(uploaded)aggregate.assets.push({id:SUPPORT_ASSET_ID,tenantId:ACTOR.tenantId,matterId:MATTER_ID,serviceOrderId:null,purpose:'source',originalName:'fixture.txt',mime:'text/plain',byteLength:1,sha256:'a'.repeat(64),state:'available',objectKey:'fixture.txt',createdAt:T0});
    await tx.put('matters',MATTER_ID,aggregate);
    await tx.put('events',writeId,{id:writeId,tenantId:ACTOR.tenantId,matterId:MATTER_ID,targetId:TARGET_ID,action:'target.created',metadata:{version:1},occurredAt:T0});
    await tx.put('blobs',targetConfigKey(ACTOR.tenantId,MATTER_ID,TARGET_ID,1,writeId),{kind:'target.config',tenantId:ACTOR.tenantId,matterId:MATTER_ID,targetId:TARGET_ID,at:T0,
      config:{targetId:TARGET_ID,version:1,route:'cn_um',language:'zh-CN',purpose:'preparation',applicantIds:[],inventorIds:[],priorityClaims:[]}});
  });
  const kv=new Map(), requests=[];
  let cookie='',clock=Date.parse(T0),stage=null,upstreamCalls=0;
  const env={ASSETS:{fetch:async()=>new Response('asset')},RATE_LIMIT:{get:async k=>kv.get(k)??null,put:async(k,v)=>{kv.set(k,v)}},
    MODEL_API_KEY:'synthetic-key',MODEL_BASE_URL:'https://upstream.example/v1',MODEL_NAME:'fixture-real-model',ACCESS_CODE:'fixture-access-code-long',SESSION_SECRET:'x'.repeat(48),
    PROCESSOR_NAME:'Fixture Processor',PROCESSOR_REGION:'fixture-region',PROCESSOR_RETENTION:'fixture-retention',PROCESSOR_TRAINING_POLICY:'no_training',PROCESSOR_TERMS_VERSION:'fixture-terms-v1'};
  const worker=createWorker(env,{now:()=>clock,fetchImpl:async(_url,init)=>{
    upstreamCalls++;assert.equal(init.redirect,'manual');
    return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(MOCK_STAGE_OUTPUTS[stage])}}]}));
  }});
  const fetchImpl=async(url,init={})=>{
    const body=typeof init.body==='string'?JSON.parse(init.body):null;
    requests.push({url,method:init.method??'GET',body});
    if(url==='/api/v6/chat')stage=body.stage;
    const request=new Request(`https://app.example${url}`,{...init,headers:{...init.headers,cookie,origin:'https://app.example'}});
    const response=await worker.fetch(request);
    if(response.headers.has('set-cookie')){
      const set=response.headers.get('set-cookie');cookie=set.includes('Max-Age=0')?'':set.split(';')[0];
    }
    return response;
  };
  const deps={fetchImpl,now:()=>new Date(clock),loadPrompts:async()=>f.pipeline.prompts};
  await createGenerationSession(env.ACCESS_CODE,fetchImpl);
  const resolve=()=>resolveGenerationRuntime(f.repository,ACTOR,MATTER_ID,TARGET_ID,deps);
  return {...f,deps,env,requests,resolve,fetchImpl,advance:ms=>{clock+=ms},upstreamCalls:()=>upstreamCalls,
    engine:runtime=>createGenerationEngine({...runtime.engineOptions,repository:f.repository,actor:ACTOR,now:deps.now})};
}
for(const uploaded of [false,true]) {
  const label=uploaded?'uploaded document':'answers only';
  test(`title consent (${label}): title is disclosed and hashed; renaming invalidates grant and sends no chat`,async()=>{
    const f=await fixture(uploaded);const before=await f.resolve();
    assert.equal(before.mode,'real');assert.equal(before.consent.manifest.title,'真实外发标题-原始');assert.equal(before.consent.manifest.titleSent,true);
    assert.equal(f.requests.filter(r=>r.url==='/api/v6/consent').length,0,'resolve never automatically issues a credential');
    const runtime=await before.consent.grant();assert.equal(runtime.consent.required,false);
    assert.equal(f.requests.filter(r=>r.url==='/api/v6/consent').length,1);
    await f.backend.transaction('readwrite',async tx=>{const row=await tx.get('matters',MATTER_ID);row.matter.title='新标题-需重新同意';await tx.put('matters',MATTER_ID,row)});
    const after=await f.resolve();assert.notEqual(after.consent.manifest.payloadManifestHash,before.consent.manifest.payloadManifestHash);
    assert.equal(after.consent.manifest.title,'新标题-需重新同意');assert.equal(after.consent.required,true);
    const validated=await validateConsentForUse(f.repository,ACTOR,MATTER_ID,{consentId:runtime.engineOptions.consentId,purpose:'draft',targetId:TARGET_ID},{config:runtime.engineOptions.config,now:()=>T0});
    assert.equal(validated.ok,false);assert.equal(validated.error.code,'CONSENT_REQUIRED');
    await assert.rejects(runtime.engineOptions.provider.generateStructured({requestId:'title-test',stage:'draft_claims',prompt:'must not be sent'},draftRevisionSchema),e=>e.code==='CONSENT_REQUIRED');
    await assert.rejects(before.consent.grant(),e=>e.code==='STALE_BINDING'||e.code==='CONSENT_REQUIRED');
    assert.equal(f.requests.filter(r=>r.url==='/api/v6/chat').length,0);assert.equal(f.upstreamCalls(),0);
  });
  test(`actual signed proof (${label}): explicit grant -> 13 real stages -> unmarked provider revision`,async()=>{
    const f=await fixture(uploaded);const runtime=await(await f.resolve()).consent.grant();
    const engine=f.engine(runtime),started=await engine.start(MATTER_ID,TARGET_ID);assert.equal(started.ok,true,JSON.stringify(started.error));
    const done=await waitForJob(engine,started.data.job.id,10000);assert.equal(done.job.state,'succeeded',JSON.stringify(done));
    const adopted=await engine.adopt(done.job.id);assert.equal(adopted.ok,true,JSON.stringify(adopted.error));assert.equal(adopted.data.revision.testOutput,undefined);
    const chats=f.requests.filter(r=>r.url==='/api/v6/chat');assert.equal(chats.length,13);assert.equal(f.upstreamCalls(),13);
    assert.ok(chats.every(r=>r.body.consentCredential.startsWith('c1.')&&r.body.manifestHash===runtime.consent.manifest.payloadManifestHash));
  });
}
test('new session and logout require another explicit grant; resolver never silently calls consent',async()=>{
  const f=await fixture();const granted=await(await f.resolve()).consent.grant();assert.equal(granted.consent.required,false);
  await createGenerationSession(f.env.ACCESS_CODE,f.fetchImpl);
  const fresh=await f.resolve();assert.equal(fresh.mode,'real');assert.equal(fresh.consent.required,true);
  assert.equal(f.requests.filter(r=>r.url==='/api/v6/consent').length,1);
  await assert.rejects(granted.engineOptions.provider.generateStructured({requestId:'old-session',stage:'draft_claims',prompt:'x'},draftRevisionSchema),e=>e.code==='CONSENT_REQUIRED');
  const current=await fresh.consent.grant();assert.equal(current.consent.required,false);
  await endGenerationSession(f.fetchImpl);assert.equal((await f.resolve()).mode,'test');
  await assert.rejects(current.engineOptions.provider.generateStructured({requestId:'after-logout',stage:'draft_claims',prompt:'x'},draftRevisionSchema),e=>e.code==='CONSENT_REQUIRED');
  await assert.rejects(current.consent.grant(),e=>e.code==='CONSENT_REQUIRED','an old runtime cannot re-grant after logout');
  assert.equal(f.requests.filter(r=>r.method==='DELETE'&&r.url==='/api/v6/session').length,1);assert.equal(f.upstreamCalls(),0);
});
test('failed logout still clears tab credentials and permanently invalidates old runtime objects',async()=>{
  const f=await fixture();const old=await(await f.resolve()).consent.grant();
  await assert.rejects(endGenerationSession(async()=>{throw new TypeError('network failure')}),/服务器会话尚未退出/);
  const fresh=await f.resolve();assert.equal(fresh.mode,'real');assert.equal(fresh.consent.required,true);
  // The cookie still exists after the failed DELETE. Even re-granting the same digest cannot revive an older runtime.
  const granted=await fresh.consent.grant();assert.equal(granted.consent.required,false);
  await assert.rejects(old.engineOptions.provider.generateStructured({requestId:'stale-runtime',stage:'draft_claims',prompt:'x'},draftRevisionSchema),e=>e.code==='CONSENT_REQUIRED');
  await assert.rejects(old.consent.grant(),e=>e.code==='CONSENT_REQUIRED');assert.equal(f.upstreamCalls(),0);
});
test('cancel invalidates even a queued job credential, and no later provider request can reuse it',async()=>{
  const f=await fixture();const runtime=await(await f.resolve()).consent.grant();const engine=f.engine(runtime);
  const started=await engine.start(MATTER_ID,TARGET_ID);assert.equal(started.ok,true);assert.equal((await engine.cancel(started.data.job.id)).ok,true);
  assert.equal((await f.resolve()).consent.required,true);
  await assert.rejects(runtime.engineOptions.provider.generateStructured({requestId:'after-cancel',stage:'draft_claims',prompt:'x'},draftRevisionSchema),e=>e.code==='CONSENT_REQUIRED');
  assert.equal(f.upstreamCalls(),0);
});
test('expired server credential and local revocation send no chat and never automatically re-grant',async()=>{
  for(const change of ['expired','revoked']) {
    const f=await fixture();const runtime=await(await f.resolve()).consent.grant();
    if(change==='expired')f.advance(30*60*1000+1);
    else assert.equal((await revokeConsent(f.repository,ACTOR,MATTER_ID,{consentId:runtime.engineOptions.consentId},{config:runtime.engineOptions.config,now:()=>T0})).ok,true);
    await assert.rejects(runtime.engineOptions.provider.generateStructured({requestId:'invalid-proof',stage:'draft_claims',prompt:'x'},draftRevisionSchema),e=>['CONSENT_REQUIRED','CONSENT_REVOKED'].includes(e.code));
    assert.equal(f.upstreamCalls(),0);assert.equal((await f.resolve()).consent.required,true);
    assert.equal(f.requests.filter(r=>r.url==='/api/v6/consent').length,1);
  }
});
test('upstream 400 has its own neutral Chinese next step',()=>{
  assert.equal(providerRecoveryFor('PROVIDER_REQUEST_INVALID'),'请求内容或参数不符合模型要求，请减少材料或检查服务配置。');
  assert.equal(userMessageFor('PROVIDER_REQUEST_INVALID'),'请求内容或参数不符合模型要求');
});
