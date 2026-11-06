import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { acquireAI } from '../src/lib/server/guard';
import { createSession, privateKey, signUpload } from '../src/lib/server/tokens';
import { prepareUploads, uploadManifest } from '../src/lib/server/staged-uploads';
import { POST as analyze } from '../src/app/api/analyze/route';
import { POST as login } from '../src/app/api/session/route';
import { MAX_UPLOAD_BYTES } from '../src/lib/limits';

const baseline={...process.env}, originalFetch=globalThis.fetch;
const state=globalThis as typeof globalThis & { easyapplyLimits?: unknown };
beforeEach(()=>{
  process.env.EASYAPPLY_USAGE_LIMITS='on';
  delete state.easyapplyLimits;
  for(const key of ['VERCEL','UPSTASH_REDIS_REST_URL','UPSTASH_REDIS_REST_TOKEN','KV_REST_API_URL','KV_REST_API_TOKEN','EASYAPPLY_ACCESS_CODE'])delete process.env[key];
  Object.assign(process.env,{NODE_ENV:'test',EASYAPPLY_PROVIDER:'openai',OPENAI_API_KEY:'test-not-real',EASYAPPLY_DAILY_AI_LIMIT:'100',EASYAPPLY_DAILY_IP_AI_LIMIT:'20',EASYAPPLY_DAILY_SESSION_AI_LIMIT:'20',EASYAPPLY_MAX_CONCURRENT:'3',BLOB_STORE_ID:'test-no-storage',CRON_SECRET:'test-cron'});
});
afterEach(()=>{
  globalThis.fetch=originalFetch;
  delete state.easyapplyLimits;
  for(const key of Object.keys(process.env))if(!(key in baseline))delete process.env[key];
  Object.assign(process.env,baseline);
});
function uploadedRequest() {
  const session=createSession(new Request('http://localhost:3123'));
  const files=[{name:'large.pdf',mediaType:'application/pdf',size:MAX_UPLOAD_BYTES,pathname:`easyapply-tmp/${privateKey(session.id)}/${Date.now()}-${randomUUID()}`}];
  const ticket=signUpload(files,session.id);
  const request=()=>new Request('http://localhost:3123/api/analyze',{method:'POST',headers:{'content-type':'application/json',cookie:session.cookie.split(';')[0]},body:JSON.stringify({upload_ticket:ticket})});
  return {session,files,ticket,request};
}
test('daily exhaustion rejects a 24 MiB upload grant before any storage operation',async()=>{
  const f=uploadedRequest();
  for(let i=0;i<20;i++){const release=await acquireAI(f.request(),`rotated-${i}`,'match');await release();}
  let calls=0;globalThis.fetch=async()=>{calls++;throw new Error('Storage must not be touched');};
  await assert.rejects(prepareUploads({files:f.files.map(({name,mediaType,size})=>({name,mediaType,size}))},f.session.id,f.request()),(e:{code:string})=>e.code==='daily_limit');
  assert.equal(calls,0);
});
test('a 25 MiB PDF is rejected before upload because its base64 exceeds the provider limit',async()=>{
  const f=uploadedRequest();
  let calls=0;globalThis.fetch=async()=>{calls++;throw new Error('Storage must not be touched');};
  await assert.rejects(prepareUploads({files:[{name:'too-large.pdf',mediaType:'application/pdf',size:25*1024*1024}]},f.session.id,f.request()),(e:Error)=>/24MB/.test(e.message));
  assert.equal(calls,0);
});
test('quota denial leaves an existing large upload untouched and explicitly retryable',async()=>{
  const f=uploadedRequest();
  for(let i=0;i<20;i++){const release=await acquireAI(f.request(),`rotated-${i}`,'match');await release();}
  let calls=0;globalThis.fetch=async()=>{calls++;throw new Error('Neither download nor delete is allowed');};
  for(let i=0;i<2;i++){
    const response=await analyze(f.request());
    assert.equal(response.status,429);
    assert.equal(response.headers.get('X-Upload-Retryable'),'1');
    assert.equal((await response.json()).error.code,'daily_limit');
    assert.deepEqual(uploadManifest(f.ticket,f.session.id),f.files);
  }
  assert.equal(calls,0);
});
test('concurrency denial preserves the uploaded file, then allows admission after capacity is released',async()=>{
  process.env.EASYAPPLY_MAX_CONCURRENT='1';
  const f=uploadedRequest(), release=await acquireAI(f.request(),'another-judge','match');
  let calls=0;globalThis.fetch=async()=>{calls++;throw new Error('Storage must not be touched');};
  const response=await analyze(f.request());
  assert.equal(response.status,429);
  assert.equal(response.headers.get('X-Upload-Retryable'),'1');
  assert.equal(calls,0);
  await release();
  const accepted=await acquireAI(f.request(),f.session.id,'analyze');await accepted();
});
test('invalid upload tickets are rejected before reserving the only AI allowance',async()=>{
  process.env.EASYAPPLY_DAILY_AI_LIMIT='1';
  const f=uploadedRequest(), request=f.request();
  const response=await analyze(new Request(request.url,{method:'POST',headers:request.headers,body:JSON.stringify({upload_ticket:f.ticket+'x'})}));
  assert.equal(response.status,409);
  assert.equal(response.headers.get('X-Upload-Retryable'),null);
  const release=await acquireAI(f.request(),f.session.id,'analyze');await release();
});
test('logging in with a valid session does not issue a new identity',async()=>{
  process.env.EASYAPPLY_ACCESS_CODE='fixture-review-access-code';
  const f=uploadedRequest();
  const response=await login(new Request('http://localhost:3123/api/session',{method:'POST',headers:{'content-type':'application/json',cookie:f.session.cookie.split(';')[0]},body:JSON.stringify({code:process.env.EASYAPPLY_ACCESS_CODE})}));
  assert.equal(response.status,200);
  assert.equal(response.headers.get('set-cookie'),null);
});
