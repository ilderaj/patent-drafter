import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'tsx/esm/api';
register();
const { z } = await import('zod');
const { RemoteGenerationProvider } = await import('../../../../apps/web/src/v6/features/generation/remote-provider.ts');
const { resolveGenerationRuntime } = await import('../../../../apps/web/src/v6/features/generation/runtime.ts');
const { createGenerationEngine } = await import('../../../../apps/web/src/v6/features/generation/generation.ts');
const { revokeConsent } = await import('../../../../apps/web/src/v6/features/ai/ai.ts');
const { targetConfigKey } = await import('../../../../apps/web/src/v6/features/targets/targets.ts');
const { ACTOR, MATTER_ID, TARGET_ID, T0, SUPPORT_ASSET_ID, createFixture, waitForJob } = await import('../V6-17/harness.mjs');
const { MOCK_STAGE_OUTPUTS } = await import('../../../../packages/pipeline/src/mock.ts');
const SCHEMA = z.object({ answer:z.string() });
const request = {requestId:'fixture:r1',prompt:'fixture prompt',stage:'draft_claims'};
const STATUS = { available:true, configured:true, authenticated:true, sessionId:'a'.repeat(64), model:'fixture-real-model', profileVersion:123,
  processor:{name:'Fixture Processor',region:'fixture-region',retention:'fixture-retention',trainingPolicy:'no_training',termsVersion:'fixture-terms-v1'},unavailableReason:null };
function json(value,status=200){return new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}})}
async function fixture() {
  const f = await createFixture({ withFacts:true });
  const writeId = crypto.randomUUID();
  await f.backend.transaction('readwrite',async tx=>{
    const aggregate=await tx.get('matters',MATTER_ID);
    aggregate.assets.push({id:SUPPORT_ASSET_ID,tenantId:ACTOR.tenantId,matterId:MATTER_ID,serviceOrderId:null,purpose:'source',originalName:'fixture.txt',mime:'text/plain',byteLength:1,sha256:'a'.repeat(64),state:'available',objectKey:'fixture.txt',createdAt:T0});
    await tx.put('matters',MATTER_ID,aggregate);
    await tx.put('events',writeId,{id:writeId,tenantId:ACTOR.tenantId,matterId:MATTER_ID,targetId:TARGET_ID,action:'target.created',metadata:{version:1},occurredAt:T0});
    await tx.put('blobs',targetConfigKey(ACTOR.tenantId,MATTER_ID,TARGET_ID,1,writeId),{
      kind:'target.config',tenantId:ACTOR.tenantId,matterId:MATTER_ID,targetId:TARGET_ID,at:T0,
      config:{targetId:TARGET_ID,version:1,route:'cn_um',language:'zh-CN',purpose:'preparation',applicantIds:[],inventorIds:[],priorityClaims:[]},
    });
  });
  let status=structuredClone(STATUS), current=Date.parse(T0), chatCalls=0;
  const deps={now:()=>new Date(current),loadPrompts:async()=>f.pipeline.prompts,fetchImpl:async (url,init)=>{
    if(url==='/api/v6/status')return json(status);
    if(url==='/api/v6/consent')return json({credential:'fixture-proof',expiresAt:new Date(current+30*60*1000).toISOString(),allowedStages:['draft_claims']});
    assert.equal(url,'/api/v6/chat'); chatCalls++;
    const body=JSON.parse(init.body);
    assert.equal(body.profileVersion,status.profileVersion);
    return json({content:JSON.stringify(MOCK_STAGE_OUTPUTS[body.stage])});
  }};
  return {...f,deps,status:()=>status,setStatus:v=>{status={...status,...v}},advance:ms=>{current+=ms},chatCalls:()=>chatCalls};
}
test('remote provider sends only same-origin cookie-authenticated requests and validates the supplied schema',async()=>{
  let init;
  const provider=new RemoteGenerationProvider({model:STATUS.model,profileVersion:123,beforeCall:async()=>({credential:'fixture-proof',manifestHash:'a'.repeat(64)}),fetchImpl:async(url,options)=>{
    assert.equal(url,'/api/v6/chat');init=options;return json({content:'{"answer":"fixture"}'});
  }});
  assert.deepEqual(await provider.generateStructured(request,SCHEMA),{answer:'fixture'});
  assert.equal(init.credentials,'same-origin');assert.equal(init.cache,'no-store');
  assert.ok(JSON.parse(init.body).prompt.includes('"required":["answer"]'));
  for(const content of ['not json','{"wrong":true}']){
    const p=new RemoteGenerationProvider({model:STATUS.model,profileVersion:123,beforeCall:async()=>({credential:'fixture-proof',manifestHash:'a'.repeat(64)}),fetchImpl:async()=>json({content})});
    await assert.rejects(p.generateStructured(request,SCHEMA),e=>e.code==='INVALID_SCHEMA');
  }
});
test('remote provider maps authorization, throttling and unavailability without leaking arbitrary body text',async()=>{
  for(const [http,code] of [[401,'AUTH_FAILED'],[403,'AUTH_FAILED'],[429,'RATE_LIMITED'],[503,'NOT_CONFIGURED'],[504,'TIMEOUT'],[502,'UPSTREAM_ERROR']]){
    const p=new RemoteGenerationProvider({model:STATUS.model,profileVersion:123,beforeCall:async()=>({credential:'fixture-proof',manifestHash:'a'.repeat(64)}),fetchImpl:async()=>json({error:{message:'private-body'}},http)});
    await assert.rejects(p.generateStructured(request,SCHEMA),e=>e.code===code&&!e.message.includes('private-body'));
  }
});
test('remote provider cancellation and timeout abort the in-flight request',async()=>{
  for(const isTimeout of [false,true]){
    let entered;const ready=new Promise(r=>{entered=r});
    const p=new RemoteGenerationProvider({model:STATUS.model,profileVersion:123,beforeCall:async()=>({credential:'fixture-proof',manifestHash:'a'.repeat(64)}),timeoutMs:isTimeout?10:1000,fetchImpl:async(_url,{signal})=>{
      entered();return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('Abort','AbortError')),{once:true}));
    }});
    const result=p.generateStructured(request,SCHEMA);const expectation=assert.rejects(result,e=>e.code===(isTimeout?'TIMEOUT':'CANCELLED'));
    await ready;if(!isTimeout)await p.cancel(request.requestId);await expectation;
  }
});
test('runtime falls back with visible reason when configuration or access session is unavailable',async()=>{
  const f=await fixture();
  for(const override of [{available:false,unavailableReason:'未配置'},{available:true,authenticated:false}]){
    f.setStatus(override);const runtime=await resolveGenerationRuntime(f.repository,ACTOR,MATTER_ID,TARGET_ID,f.deps);
    assert.equal(runtime.mode,'test');assert.equal(runtime.engineOptions.execution,'stub');assert.equal(runtime.engineOptions.allowTestAdoption,true);assert.ok(runtime.unavailableReason);
  }
  assert.equal(f.chatCalls(),0);
});
test('real runtime cannot send without explicit manifest consent; grant persists it without invoking a model',async()=>{
  const f=await fixture();const runtime=await resolveGenerationRuntime(f.repository,ACTOR,MATTER_ID,TARGET_ID,f.deps);
  assert.equal(runtime.mode,'real');assert.equal(runtime.consent.required,true);assert.ok(runtime.consent.manifest.payloadManifestHash);
  await assert.rejects(runtime.engineOptions.provider.generateStructured(request,SCHEMA),e=>e.code==='CONSENT_REQUIRED');assert.equal(f.chatCalls(),0);
  const granted=await runtime.consent.grant();assert.equal(granted.mode,'real');assert.equal(granted.consent.required,false);assert.ok(granted.engineOptions.consentId);
  assert.equal(f.chatCalls(),0,'grant alone never invokes a model');
});
test('expired, revoked, stale consent and unavailable service never reach chat',async()=>{
  for(const change of ['expired','revoked','stale','unavailable','profile']){
    const f=await fixture();const runtime=await(await resolveGenerationRuntime(f.repository,ACTOR,MATTER_ID,TARGET_ID,f.deps)).consent.grant();
    if(change==='expired')f.advance(7_200_001);
    if(change==='revoked')assert.equal((await revokeConsent(f.repository,ACTOR,MATTER_ID,{consentId:runtime.engineOptions.consentId},{config:runtime.engineOptions.config,now:()=>T0})).ok,true);
    if(change==='stale')await f.backend.transaction('readwrite',async tx=>{const row=await tx.get('matters',MATTER_ID);row.matter.sourceVersion++;await tx.put('matters',MATTER_ID,row)});
    if(change==='unavailable')f.setStatus({available:false});
    if(change==='profile')f.setStatus({profileVersion:124});
    await assert.rejects(runtime.engineOptions.provider.generateStructured(request,SCHEMA),e=>['CONSENT_REQUIRED','CONSENT_REVOKED','PROVIDER_UNAVAILABLE'].includes(e.code),change);
    assert.equal(f.chatCalls(),0,change);
  }
});
test('grant cannot silently authorize a different manifest than the one shown',async()=>{
  const f=await fixture();const runtime=await resolveGenerationRuntime(f.repository,ACTOR,MATTER_ID,TARGET_ID,f.deps);
  await f.backend.transaction('readwrite',async tx=>{const row=await tx.get('matters',MATTER_ID);row.matter.sourceVersion++;await tx.put('matters',MATTER_ID,row)});
  await assert.rejects(runtime.consent.grant());assert.equal(f.chatCalls(),0);
});
test('provider execution runs through candidate adoption without a testOutput marker; unknown costs stay unknown and bounded',async()=>{
  const f=await fixture();const runtime=await(await resolveGenerationRuntime(f.repository,ACTOR,MATTER_ID,TARGET_ID,f.deps)).consent.grant();
  const engine=createGenerationEngine({...runtime.engineOptions,repository:f.repository,actor:ACTOR,now:f.deps.now});
  const start=await engine.start(MATTER_ID,TARGET_ID);assert.equal(start.ok,true,start.ok?'':JSON.stringify(start.error));
  const done=await waitForJob(engine,start.data.job.id,10000);
  assert.equal(done.job.state,'succeeded',JSON.stringify(done));assert.equal(done.result.testOutput,false);
  const adopted=await engine.adopt(done.job.id);assert.equal(adopted.ok,true,adopted.ok?'':JSON.stringify(adopted.error));
  assert.equal(adopted.data.status,'adopted');assert.equal(adopted.data.revision.testOutput,undefined);
  assert.ok(f.chatCalls()>1);assert.ok(f.chatCalls()<=16);
  const invocations=await engine.listInvocations(done.job.id);assert.ok(invocations.data.every(i=>i.costMinor===null&&i.usageUnknown));
});
test('cancelling a running real job aborts transport after durably fencing the job',async()=>{
  const f=await fixture();let entered,aborted=false;const ready=new Promise(r=>{entered=r});
  const baseFetch=f.deps.fetchImpl;
  f.deps.fetchImpl=async(url,init)=>{
    if(url!=='/api/v6/chat')return baseFetch(url,init);
    entered();return new Promise((_resolve,reject)=>init.signal.addEventListener('abort',()=>{aborted=true;reject(new DOMException('cancelled','AbortError'))},{once:true}));
  };
  const runtime=await(await resolveGenerationRuntime(f.repository,ACTOR,MATTER_ID,TARGET_ID,f.deps)).consent.grant();
  const engine=createGenerationEngine({...runtime.engineOptions,repository:f.repository,actor:ACTOR,now:f.deps.now});
  const start=await engine.start(MATTER_ID,TARGET_ID);assert.equal(start.ok,true);
  await ready;const cancel=await engine.cancel(start.data.job.id);
  assert.equal(cancel.ok,true);assert.equal(cancel.data.job.state,'cancelled');assert.equal(aborted,true);
});
test('full provider regeneration after a test revision creates fresh provenance; editing still inherits test output',async()=>{
  const f=await fixture();
  const {LOCAL_TEST_GENERATION_OPTIONS}=await import('../../../../apps/web/src/v6/features/generation/local-runtime.ts');
  const stub=createGenerationEngine({...LOCAL_TEST_GENERATION_OPTIONS,repository:f.repository,actor:ACTOR,now:f.deps.now});
  const started=await stub.start(MATTER_ID,TARGET_ID);assert.equal(started.ok,true);
  const completed=await waitForJob(stub,started.data.job.id);
  const adoptedTest=await stub.adopt(completed.job.id);assert.equal(adoptedTest.ok,true);assert.equal(adoptedTest.data.revision.testOutput,true);
  const runtime=await(await resolveGenerationRuntime(f.repository,ACTOR,MATTER_ID,TARGET_ID,f.deps)).consent.grant();
  const real=createGenerationEngine({...runtime.engineOptions,repository:f.repository,actor:ACTOR,now:f.deps.now});
  const start=await real.start(MATTER_ID,TARGET_ID);assert.equal(start.ok,true,start.ok?'':JSON.stringify(start.error));
  const done=await waitForJob(real,start.data.job.id);
  assert.equal(done.job.state,'succeeded',JSON.stringify(done));
  const adopted=await real.adopt(done.job.id);assert.equal(adopted.ok,true,adopted.ok?'':JSON.stringify(adopted.error));
  assert.equal(adopted.data.revision.parentId,adoptedTest.data.revision.id);assert.equal(adopted.data.revision.testOutput,undefined);
  assert.equal((await stub.getRevision(adoptedTest.data.revision.id)).data.revision.testOutput,true,'history remains marked');
});
test('explicit unknown-cost call cap stops further upstream calls while preserving unknown usage',async()=>{
  const f=await fixture();const runtime=await(await resolveGenerationRuntime(f.repository,ACTOR,MATTER_ID,TARGET_ID,f.deps)).consent.grant();
  const engine=createGenerationEngine({...runtime.engineOptions,limits:{...runtime.engineOptions.limits,maxUnknownCostCalls:1},repository:f.repository,actor:ACTOR,now:f.deps.now});
  const started=await engine.start(MATTER_ID,TARGET_ID);assert.equal(started.ok,true);
  const done=await waitForJob(engine,started.data.job.id);
  assert.equal(done.job.state,'failed');assert.equal(done.job.errorCode,'JOB_LIMIT_EXCEEDED');assert.equal(f.chatCalls(),1);
});
test('unparsed/absent sources do not produce a real empty-context request',async()=>{
  const f=await fixture();
  await f.backend.transaction('readwrite',async tx=>{const row=await tx.get('matters',MATTER_ID);row.assets=[];await tx.put('matters',MATTER_ID,row)});
  const runtime=await resolveGenerationRuntime(f.repository,ACTOR,MATTER_ID,TARGET_ID,f.deps);
  assert.equal(runtime.mode,'test');assert.match(runtime.unavailableReason,/已解析/);assert.equal(f.chatCalls(),0);
});
