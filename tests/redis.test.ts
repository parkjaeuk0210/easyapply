import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { acquireAI, chargeAI, checkAIAvailability, issueSession, limitAttempts, reserveUploadBudget } from '../src/lib/server/guard';
import { privateKey } from '../src/lib/server/tokens';
import { MAX_UPLOAD_BYTES } from '../src/lib/limits';

const exec=promisify(execFile);
async function admit(request:Request,sessionId:string,kind:'analyze'|'match'){
  const release=await acquireAI(request,sessionId,kind);
  await chargeAI(request,sessionId,kind);
  return release;
}
test('Redis atomically enforces concurrency, global quota, and outage fails closed',async(t)=>{
  try { await exec('redis-server',['--version']); } catch { t.skip('redis-server unavailable'); return; }
  const dir=await mkdtemp(path.join(os.tmpdir(),'easyapply-redis-test-')),socket=path.join(dir,'redis.sock');
  const redis=spawn('redis-server',['--port','0','--unixsocket',socket,'--save','','--appendonly','no'],{stdio:['ignore','pipe','pipe']});
  let ready=false;
  await new Promise<void>((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(new Error('Redis startup timeout')),5000);
    redis.stdout.on('data',d=>{if(String(d).includes('ready to accept connections')||String(d).includes('Ready to accept connections')){ready=true;clearTimeout(timeout);resolve();}});
    redis.on('error',reject);
  });
  assert(ready);
  const server=createServer(async(req,res)=>{
    let input='';for await(const chunk of req)input+=chunk;
    const args=JSON.parse(input).map(String);
    try {const r=await exec('redis-cli',['-s',socket,'--json',...args]);res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({result:JSON.parse(r.stdout)}));}
    catch {res.writeHead(503);res.end('{}');}
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');const env={...process.env};
  try{
    process.env.EASYAPPLY_USAGE_LIMITS='on';
    process.env.UPSTASH_REDIS_REST_URL=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
    process.env.UPSTASH_REDIS_REST_TOKEN='local-test-only';process.env.EASYAPPLY_MAX_CONCURRENT='2';process.env.EASYAPPLY_DAILY_AI_LIMIT='3';
    const req=new Request('http://localhost:3123/api/analyze');
    const attempts=await Promise.allSettled([acquireAI(req,'a','analyze'),acquireAI(req,'a','analyze')]);
    assert.equal(attempts.filter(r=>r.status==='fulfilled').length,1);
    const winner=attempts.find(r=>r.status==='fulfilled') as PromiseFulfilledResult<()=>Promise<void>>;
    await chargeAI(req,'a','analyze');
    const releaseB=await admit(req,'b','analyze');
    // A full house reports when the earliest lease ends, not a fixed 5 seconds.
    await assert.rejects(acquireAI(req,'c','analyze'),(e:{retryAfter:number})=>e.retryAfter>=300);
    await winner.value();await releaseB();
    const releaseC=await admit(req,'c','match');await releaseC();
    await assert.rejects(acquireAI(req,'d','match'));
    await limitAttempts(req,'test',1);await assert.rejects(limitAttempts(req,'test',1));

    process.env.VERCEL='1';process.env.EASYAPPLY_SIGNING_SECRET='fixture-signing-secret-at-least-32-bytes';
    const uploadRequest=(ip:string)=>new Request('https://easyapply.test/api/uploads',{headers:{'x-vercel-forwarded-for':ip}});
    const value=async(key:string)=>Number((await exec('redis-cli',['-s',socket,'GET',key])).stdout.trim());
    const uploadLimited=(e:unknown)=>!!e && typeof e==='object' && 'code' in e && e.code==='upload_limit';
    await t.test('upload IP budget is atomic across sessions and independent of exhausted AI quota',async()=>{
      const grants=await Promise.allSettled(Array.from({length:12},(_,i)=>reserveUploadBudget(uploadRequest('203.0.113.1'),`ip-${i}`,MAX_UPLOAD_BYTES,1)));
      assert.equal(grants.filter(r=>r.status==='fulfilled').length,10);
      assert(grants.filter(r=>r.status==='rejected').every(r=>uploadLimited(r.reason)));
      assert.equal(await value('easyapply:v1:upload:bytes:global'),10*MAX_UPLOAD_BYTES);
      assert.equal(await value('easyapply:v1:upload:files:global'),10);
      assert.equal(await value('easyapply:v1:daily'),3);
      // Metadata-only grants hold the shared budget for one ticket lifetime, not a day.
      const ttl=async(key:string)=>Number((await exec('redis-cli',['-s',socket,'PTTL',key])).stdout.trim());
      assert(await ttl('easyapply:v1:upload:bytes:global')<=30*60_000);
      assert(await ttl('easyapply:v1:upload:files:global')<=30*60_000);
      assert(await ttl(`easyapply:v1:upload:bytes:ip:${privateKey('203.0.113.1')}`)>86_000_000);
    });
    await t.test('IPv6 addresses in one /64 share a bucket',async()=>{
      await limitAttempts(uploadRequest('2001:db8:1:2::1'),'v6',1);
      await assert.rejects(limitAttempts(uploadRequest('2001:0db8:0001:0002:ffff:0:0:9'),'v6',1));
      await limitAttempts(uploadRequest('2001:db8:1:3::1'),'v6',1);
    });
    await t.test('upload session budget survives IP changes without blocking another session',async()=>{
      await exec('redis-cli',['-s',socket,'FLUSHDB']);
      for(let i=0;i<10;i++)await reserveUploadBudget(uploadRequest(`203.0.113.${i}`),'same-session',MAX_UPLOAD_BYTES,1);
      await assert.rejects(reserveUploadBudget(uploadRequest('203.0.113.20'),'same-session',1,1),uploadLimited);
      await reserveUploadBudget(uploadRequest('203.0.113.20'),'new-session',MAX_UPLOAD_BYTES,1);
      assert.equal(await value('easyapply:v1:upload:bytes:global'),11*MAX_UPLOAD_BYTES);
      assert.equal(await value('easyapply:v1:upload:files:global'),11);
    });
    await t.test('global upload byte budget cannot be bypassed by concurrent IP and session rotation',async()=>{
      await exec('redis-cli',['-s',socket,'FLUSHDB']);
      const grants=await Promise.allSettled(Array.from({length:105},(_,i)=>reserveUploadBudget(uploadRequest(`198.51.100.${i}`),`global-${i}`,MAX_UPLOAD_BYTES,1)));
      assert.equal(grants.filter(r=>r.status==='fulfilled').length,100);
      assert(grants.filter(r=>r.status==='rejected').every(r=>uploadLimited(r.reason)));
      assert.equal(await value('easyapply:v1:upload:bytes:global'),100*MAX_UPLOAD_BYTES);
      assert.equal(await value('easyapply:v1:upload:files:global'),100);
      // The shared budget resets with the 30-minute ticket lifetime.
      const ttl=Number((await exec('redis-cli',['-s',socket,'PTTL','easyapply:v1:upload:bytes:global'])).stdout.trim());
      assert(ttl>29*60_000 && ttl<=30*60_000);
    });
    await t.test('global upload object cap stops tiny-file floods without partially charging rejected grants',async()=>{
      await exec('redis-cli',['-s',socket,'FLUSHDB']);
      const grants=await Promise.allSettled(Array.from({length:105},(_,i)=>reserveUploadBudget(uploadRequest(`192.0.2.${i}`),`objects-${i}`,10,10)));
      assert.equal(grants.filter(r=>r.status==='fulfilled').length,100);
      assert(grants.filter(r=>r.status==='rejected').every(r=>uploadLimited(r.reason)));
      assert.equal(await value('easyapply:v1:upload:files:global'),1000);
      assert.equal(await value('easyapply:v1:upload:bytes:global'),1000);
    });
    const resetAI = async () => {
      await exec('redis-cli',['-s',socket,'FLUSHDB']);
      process.env.EASYAPPLY_DAILY_AI_LIMIT='100';
      process.env.EASYAPPLY_DAILY_IP_AI_LIMIT='20';
      process.env.EASYAPPLY_DAILY_SESSION_AI_LIMIT='20';
      process.env.EASYAPPLY_MAX_CONCURRENT='20';
    };
    const dailyLimited=(e:unknown)=>!!e && typeof e==='object' && 'code' in e && e.code==='daily_limit';
    await t.test('rotating sessions, API kinds and expired burst windows cannot reset the IP daily budget',async()=>{
      await resetAI();
      const ip='203.0.113.210', request=uploadRequest(ip);
      for(let i=0;i<20;i++) {
        const release=await admit(request,`rotated-${i}`,i<8?'analyze':'match'); await release();
      }
      // Simulate the 10-minute buckets expiring; the day bucket must survive.
      await exec('redis-cli',['-s',socket,'DEL',`easyapply:v1:ip:${privateKey(ip)}:analyze`,`easyapply:v1:ip:${privateKey(ip)}:match`]);
      await assert.rejects(acquireAI(request,'fresh-cookie','analyze'),dailyLimited);
      await assert.rejects(acquireAI(request,'fresh-cookie-2','match'),dailyLimited);
      assert.equal(await value('easyapply:v1:daily'),20);
      const ttl=Number((await exec('redis-cli',['-s',socket,'PTTL',`easyapply:v1:daily:ip:${privateKey(ip)}`])).stdout.trim());
      assert(ttl>86_300_000 && ttl<=86_400_000);
      const release=await admit(uploadRequest('203.0.113.211'),'other-judge','analyze');await release();
      assert.equal(await value('easyapply:v1:daily'),21);
    });
    await t.test('a session retains its combined daily budget across IP changes',async()=>{
      await resetAI();
      for(let i=0;i<20;i++) {const release=await admit(uploadRequest(`198.51.100.${i}`),'roaming-session','match');await release();}
      await assert.rejects(acquireAI(uploadRequest('198.51.100.100'),'roaming-session','analyze'),dailyLimited);
      assert.equal(await value('easyapply:v1:daily'),20);
    });
    await t.test('concurrent requests compete atomically for the last IP allowance without charging rejected calls',async()=>{
      await resetAI();
      const request=uploadRequest('192.0.2.210');
      await exec('redis-cli',['-s',socket,'SET',`easyapply:v1:daily:ip:${privateKey('192.0.2.210')}`,'19','PX','86400000']);
      await exec('redis-cli',['-s',socket,'SET','easyapply:v1:daily','19','PX','86400000']);
      const releases=await Promise.all(Array.from({length:12},(_,i)=>acquireAI(request,`race-${i}`,'match')));
      const charges=await Promise.allSettled(Array.from({length:12},(_,i)=>chargeAI(request,`race-${i}`,'match')));
      assert.equal(charges.filter(r=>r.status==='fulfilled').length,1);
      assert(charges.filter(r=>r.status==='rejected').every(r=>dailyLimited(r.reason)));
      await Promise.all(releases.map(release=>release()));
      assert.equal(await value('easyapply:v1:daily'),20);
    });
    await t.test('leases for work that never reaches the provider leave the daily quota untouched',async()=>{
      await resetAI();
      const request=uploadRequest('192.0.2.215');
      for(let i=0;i<100;i++){const release=await acquireAI(uploadRequest(`192.0.2.${i}`),`unreadable-${i}`,'analyze');await release();}
      assert.equal(await value('easyapply:v1:daily'),0);
      const release=await admit(request,'readable','analyze');await release();
      assert.equal(await value('easyapply:v1:daily'),1);
    });
    await t.test('upload preflight checks capacity without spending quota or holding a concurrency slot',async()=>{
      await resetAI();
      const request=uploadRequest('192.0.2.220');
      for(let i=0;i<5;i++)await checkAIAvailability(request,'preflight','analyze');
      assert.equal(await value('easyapply:v1:daily'),0);
      assert.equal(Number((await exec('redis-cli',['-s',socket,'ZCARD','easyapply:v1:active'])).stdout.trim()),0);
      const release=await admit(request,'preflight','analyze');
      await assert.rejects(checkAIAvailability(request,'preflight','analyze'),(e:{code:string})=>e.code==='in_progress');
      await release();
      assert.equal(await value('easyapply:v1:daily'),1);
    });
    await t.test('new session issuance allows a shared venue Wi-Fi, is bounded per IP for 24 hours and cannot consume AI quota',async()=>{
      await resetAI();
      const request=uploadRequest('192.0.2.230');
      const issued=await Promise.allSettled(Array.from({length:35},()=>issueSession(request)));
      assert.equal(issued.filter(r=>r.status==='fulfilled').length,35);
      await exec('redis-cli',['-s',socket,'SET',`easyapply:v1:attempt:session-issuance:${privateKey('192.0.2.230')}`,'199','PX','86400000']);
      await issueSession(request);
      await assert.rejects(issueSession(request),(e:{status:number;code:string;retryAfter:number})=>e.status===429&&e.code==='rate_limit'&&e.retryAfter>86000);
      assert.equal(await value('easyapply:v1:daily'),0);
      await issueSession(uploadRequest('192.0.2.231'));
    });
    await t.test('judging mode ignores exhausted counters and shared-IP caps while preventing duplicate work',async()=>{
      await resetAI();
      process.env.EASYAPPLY_USAGE_LIMITS='off';
      process.env.EASYAPPLY_MAX_CONCURRENT='1';
      process.env.EASYAPPLY_DAILY_AI_LIMIT='1';
      process.env.EASYAPPLY_DAILY_IP_AI_LIMIT='1';
      process.env.EASYAPPLY_DAILY_SESSION_AI_LIMIT='1';
      const request=uploadRequest('192.0.2.240');
      await exec('redis-cli',['-s',socket,'SET','easyapply:v1:daily','100','PX','86400000']);
      await exec('redis-cli',['-s',socket,'SET',`easyapply:v1:daily:ip:${privateKey('192.0.2.240')}`,'20','PX','86400000']);
      const sessions=await Promise.all(Array.from({length:35},()=>issueSession(request)));
      assert.equal(new Set(sessions.map(s=>s.id)).size,35);
      for(let i=0;i<110;i++) {
        await limitAttempts(request,'request',1);
        await reserveUploadBudget(request,'review-session',MAX_UPLOAD_BYTES,1);
      }
      const releases=await Promise.all(Array.from({length:12},(_,i)=>acquireAI(request,`judge-${i}`,'analyze')));
      await assert.rejects(acquireAI(request,'judge-0','match'),(e:{code:string})=>e.code==='in_progress');
      await Promise.all(releases.map(release=>release()));
      for(let i=0;i<110;i++){const release=await admit(request,'review-session',i%2?'analyze':'match');await release();}
      assert.equal(await value('easyapply:v1:daily'),100);
      assert.equal(await value('easyapply:v1:upload:bytes:global'),0);
      assert.equal(Number((await exec('redis-cli',['-s',socket,'ZCARD','easyapply:v1:active'])).stdout.trim()),0);
      await assert.rejects(reserveUploadBudget(request,'review-session',MAX_UPLOAD_BYTES+1,1));
      process.env.EASYAPPLY_USAGE_LIMITS='on';
    });
    await exec('redis-cli',['-s',socket,'shutdown','nosave']);
    await assert.rejects(limitAttempts(req,'outage',1),(e:{status:number})=>e.status===503);
    await assert.rejects(checkAIAvailability(req,'outage','analyze'),(e:{status:number})=>e.status===503);
    await assert.rejects(reserveUploadBudget(uploadRequest('192.0.2.200'),'outage',1,1),(e:{status:number})=>e.status===503);
  }finally{
    for(const k of Object.keys(process.env))if(!(k in env))delete process.env[k];Object.assign(process.env,env);
    server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));redis.kill();await rm(dir,{recursive:true,force:true});
  }
});
