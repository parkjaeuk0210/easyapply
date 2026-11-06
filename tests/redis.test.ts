import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { acquireAI, limitAttempts } from '../src/lib/server/guard';

const exec=promisify(execFile);
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
    process.env.UPSTASH_REDIS_REST_URL=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
    process.env.UPSTASH_REDIS_REST_TOKEN='local-test-only';process.env.EASYAPPLY_MAX_CONCURRENT='2';process.env.EASYAPPLY_DAILY_AI_LIMIT='3';
    const req=new Request('http://localhost:3123/api/analyze');
    const attempts=await Promise.allSettled([acquireAI(req,'a','analyze'),acquireAI(req,'a','analyze')]);
    assert.equal(attempts.filter(r=>r.status==='fulfilled').length,1);
    const winner=attempts.find(r=>r.status==='fulfilled') as PromiseFulfilledResult<()=>Promise<void>>;
    const releaseB=await acquireAI(req,'b','analyze');
    await assert.rejects(acquireAI(req,'c','analyze'));
    await winner.value();await releaseB();
    const releaseC=await acquireAI(req,'c','match');await releaseC();
    await assert.rejects(acquireAI(req,'d','match'));
    await limitAttempts(req,'test',1);await assert.rejects(limitAttempts(req,'test',1));
    await exec('redis-cli',['-s',socket,'shutdown','nosave']);
    await assert.rejects(limitAttempts(req,'outage',1),(e:{status:number})=>e.status===503);
  }finally{
    for(const k of Object.keys(process.env))if(!(k in env))delete process.env[k];Object.assign(process.env,env);
    server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));redis.kill();await rm(dir,{recursive:true,force:true});
  }
});
