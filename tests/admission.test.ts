import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { acquireAI, chargeAI } from '../src/lib/server/guard';
import { createSession, privateKey, signUpload } from '../src/lib/server/tokens';
import { prepareUploads, uploadManifest } from '../src/lib/server/staged-uploads';
import { POST as analyze } from '../src/app/api/analyze/route';
import { POST as login } from '../src/app/api/session/route';
import { ANTHROPIC_UPLOAD_BYTES } from '../src/lib/limits';

const baseline={...process.env}, originalFetch=globalThis.fetch;
const state=globalThis as typeof globalThis & { easyapplyLimits?: { counters: Map<string,{count:number}> } };
const dailyCount=()=>state.easyapplyLimits?.counters.get('easyapply:v1:daily')?.count ?? 0;
async function admit(request:Request,sessionId:string,kind:'analyze'|'match'){
  const release=await acquireAI(request,sessionId,kind);
  await chargeAI(request,sessionId,kind);
  return release;
}
function pdfRequest(session:ReturnType<typeof createSession>,data:Buffer){
  const form=new FormData();form.append('files',new File([new Uint8Array(data)],'notice.pdf',{type:'application/pdf'}));
  return new Request('http://localhost:3123/api/analyze',{method:'POST',headers:{cookie:session.cookie.split(';')[0]},body:form});
}
beforeEach(()=>{
  process.env.EASYAPPLY_USAGE_LIMITS='on';
  delete state.easyapplyLimits;
  for(const key of ['VERCEL','UPSTASH_REDIS_REST_URL','UPSTASH_REDIS_REST_TOKEN','KV_REST_API_URL','KV_REST_API_TOKEN','EASYAPPLY_ACCESS_CODE'])delete process.env[key];
  Object.assign(process.env,{NODE_ENV:'test',EASYAPPLY_PROVIDER:'api',ANTHROPIC_API_KEY:'test-not-real',EASYAPPLY_DAILY_AI_LIMIT:'100',EASYAPPLY_DAILY_IP_AI_LIMIT:'20',EASYAPPLY_DAILY_SESSION_AI_LIMIT:'20',EASYAPPLY_MAX_CONCURRENT:'3',BLOB_STORE_ID:'test-no-storage',CRON_SECRET:'test-cron'});
});
afterEach(()=>{
  globalThis.fetch=originalFetch;
  delete state.easyapplyLimits;
  for(const key of Object.keys(process.env))if(!(key in baseline))delete process.env[key];
  Object.assign(process.env,baseline);
});
function uploadedRequest() {
  const session=createSession(new Request('http://localhost:3123'));
  const files=[{name:'large.pdf',mediaType:'application/pdf',size:ANTHROPIC_UPLOAD_BYTES,pathname:`easyapply-tmp/${privateKey(session.id)}/${Date.now()}-${randomUUID()}`}];
  const ticket=signUpload(files,session.id);
  const request=()=>new Request('http://localhost:3123/api/analyze',{method:'POST',headers:{'content-type':'application/json',cookie:session.cookie.split(';')[0]},body:JSON.stringify({upload_ticket:ticket})});
  return {session,files,ticket,request};
}
test('daily exhaustion rejects a 22 MiB upload grant before any storage operation',async()=>{
  const f=uploadedRequest();
  for(let i=0;i<20;i++){const release=await admit(f.request(),`rotated-${i}`,'match');await release();}
  let calls=0;globalThis.fetch=async()=>{calls++;throw new Error('Storage must not be touched');};
  await assert.rejects(prepareUploads({files:f.files.map(({name,mediaType,size})=>({name,mediaType,size}))},f.session.id,f.request()),(e:{code:string})=>e.code==='daily_limit');
  assert.equal(calls,0);
});
test('a 23 MiB PDF is rejected before upload because its base64 exceeds the provider limit',async()=>{
  const f=uploadedRequest();
  let calls=0;globalThis.fetch=async()=>{calls++;throw new Error('Storage must not be touched');};
  await assert.rejects(prepareUploads({files:[{name:'too-large.pdf',mediaType:'application/pdf',size:23*1024*1024}]},f.session.id,f.request()),(e:Error)=>/22MB/.test(e.message));
  assert.equal(calls,0);
});
test('quota denial leaves an existing large upload untouched and explicitly retryable',async()=>{
  const f=uploadedRequest();
  for(let i=0;i<20;i++){const release=await admit(f.request(),`rotated-${i}`,'match');await release();}
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
test('100 unreadable PDFs never charge the daily AI quota',async(t)=>{
  t.mock.timers.enable({apis:['Date'],now:Date.now()});
  const session=createSession(new Request('http://localhost:3123'));
  const statuses=new Map<string,number>();
  for(let i=0;i<100;i++){
    // Roll the 40-per-minute attempt window; only the daily quota is under test.
    if(i%30===29)t.mock.timers.tick(61_000);
    const response=await analyze(pdfRequest(session,Buffer.from('%PDF-not-a-valid-document')));
    const key=`${response.status} ${(await response.json()).error.code}`;
    statuses.set(key,(statuses.get(key)??0)+1);
  }
  assert.deepEqual(Object.fromEntries(statuses),{'400 invalid_pdf':100});
  assert.equal(dailyCount(),0);
});
test('a paid call is charged once, even when the provider fails and the call is retried',async()=>{
  let hits=0;
  const server=createServer((req,res)=>{hits++;req.resume();res.writeHead(500,{'content-type':'application/json'});res.end('{"type":"error","error":{"type":"api_error","message":"fixture outage"}}');});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  try{
    process.env.ANTHROPIC_BASE_URL=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
    const session=createSession(new Request('http://localhost:3123'));
    const response=await analyze(pdfRequest(session,await readFile('tests/fixtures/samples/garam-youth-rent-2026.pdf')));
    assert.equal(response.status,502);
    assert.equal(hits,2);
    assert.equal(dailyCount(),1);
  }finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
});
