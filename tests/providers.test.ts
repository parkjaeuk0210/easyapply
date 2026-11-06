import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { z } from 'zod';
import { runStructured } from '../src/lib/llm';
import { errorResponse } from '../src/lib/server/errors';

test('OpenAI adapter sends Astra medium Fast, PDF and strict JSON through the real SDK', async()=>{
  let body: Record<string, unknown> | undefined;
  const server=createServer(async(req,res)=>{
    let input=''; for await(const chunk of req) input+=chunk;
    body=JSON.parse(input);
    res.writeHead(200,{'content-type':'text/event-stream'});
    const send=(event:unknown)=>res.write(`data: ${JSON.stringify(event)}\n\n`);
    const message={id:'msg_test',type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:'{"result":"ok"}',annotations:[]}]};
    const response={id:'resp_test',object:'response',created_at:1,model:'gpt-6-astra',reasoning:{effort:'medium'},service_tier:'fast',status:'in_progress',output:[],parallel_tool_calls:false,tools:[],tool_choice:'auto',usage:{input_tokens:2,output_tokens:3,total_tokens:5}};
    send({type:'response.created',sequence_number:0,response});
    send({type:'response.output_item.added',sequence_number:1,output_index:0,item:{...message,status:'in_progress',content:[]}});
    send({type:'response.content_part.added',sequence_number:2,item_id:'msg_test',output_index:0,content_index:0,part:{type:'output_text',text:'',annotations:[]}});
    send({type:'response.output_text.delta',sequence_number:3,item_id:'msg_test',output_index:0,content_index:0,delta:'{"result":"ok"}'});
    send({type:'response.output_text.done',sequence_number:4,item_id:'msg_test',output_index:0,content_index:0,text:'{"result":"ok"}'});
    send({type:'response.content_part.done',sequence_number:5,item_id:'msg_test',output_index:0,content_index:0,part:message.content[0]});
    send({type:'response.output_item.done',sequence_number:6,output_index:0,item:message});
    send({type:'response.completed',sequence_number:7,response:{...response,status:'completed',output:[message]}});
    res.end();
  });
  server.listen(0,'127.0.0.1'); await once(server,'listening');
  const original={...process.env};
  try{
    process.env.OPENAI_API_KEY='test-only';process.env.OPENAI_BASE_URL=`http://127.0.0.1:${(server.address() as {port:number}).port}`;process.env.EASYAPPLY_PROVIDER='openai';
    process.env.EASYAPPLY_OPENAI_MODEL='gpt-6-astra';process.env.EASYAPPLY_OPENAI_REASONING_EFFORT='medium';process.env.EASYAPPLY_OPENAI_SERVICE_TIER='fast';
    const result=await runStructured({system:'system',text:'analyze',schema:z.object({result:z.string()}),files:[{name:'test.pdf',mediaType:'application/pdf',data:Buffer.from('%PDF-test')}]});
    assert.equal(result.provider,'openai');assert.deepEqual(result.data,{result:'ok'});
    assert.equal(body?.store,false);assert.match(JSON.stringify(body),/input_file/);assert.match(JSON.stringify(body),/json_schema/);assert.match(JSON.stringify(body),/strict/);
    assert.equal(body?.model,'gpt-6-astra');assert.deepEqual(body?.reasoning,{effort:'medium'});assert.equal(body?.service_tier,'fast');
  }finally{
    for(const k of Object.keys(process.env))if(!(k in original))delete process.env[k];Object.assign(process.env,original);
    server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));
  }
});

test('provider authentication errors are mapped without disclosing response bodies',async()=>{
  const server=createServer((req,res)=>{req.resume();res.writeHead(401,{'content-type':'application/json'});res.end(JSON.stringify({error:{message:'sk-SECRET PRIVATE DOCUMENT',type:'invalid_request_error',code:'invalid_api_key'}}));});
  server.listen(0,'127.0.0.1');await once(server,'listening'); const original={...process.env};
  try{
    process.env.OPENAI_API_KEY='test';process.env.OPENAI_BASE_URL=`http://127.0.0.1:${(server.address() as {port:number}).port}`;process.env.EASYAPPLY_PROVIDER='openai';
    await assert.rejects(runStructured({system:'test',text:'test',schema:z.object({ok:z.boolean()})}),(e:{code:string;message:string})=>e.code==='provider_auth'&&!e.message.includes('PRIVATE'));
  }finally{
    for(const k of Object.keys(process.env))if(!(k in original))delete process.env[k];Object.assign(process.env,original);
    server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));
  }
});

test('Anthropic adapter sends Opus 5.5 medium Fast and validates result tool input after thinking blocks', async()=>{
  let body: Record<string, unknown> | undefined;
  let outputText='{"result":"ok"}';
  const server=createServer(async(req,res)=>{
    let input=''; for await(const chunk of req) input+=chunk; body=JSON.parse(input);
    res.writeHead(200,{'content-type':'text/event-stream'});
    const send=(type:string, data:Record<string,unknown>)=>res.write(`event: ${type}\ndata: ${JSON.stringify({type,...data})}\n\n`);
    send('message_start',{message:{id:'msg_test',type:'message',role:'assistant',model:'claude-opus-5-5',content:[],stop_reason:null,stop_sequence:null,usage:{input_tokens:2,output_tokens:0,speed:'fast'}}});
    send('content_block_start',{index:0,content_block:{type:'thinking',thinking:'',signature:''}});
    send('content_block_stop',{index:0});
    send('content_block_start',{index:1,content_block:{type:'tool_use',id:'tool_test',name:'easyapply_result',input:{}}});
    send('content_block_delta',{index:1,delta:{type:'input_json_delta',partial_json:outputText}});
    send('content_block_stop',{index:1});
    send('message_delta',{delta:{stop_reason:'tool_use',stop_sequence:null},usage:{output_tokens:3,speed:'fast'}});
    send('message_stop',{});res.end();
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');const original={...process.env};
  try {
    process.env.ANTHROPIC_API_KEY='test-only';delete process.env.ANTHROPIC_AUTH_TOKEN;
    process.env.ANTHROPIC_BASE_URL=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
    process.env.EASYAPPLY_PROVIDER='api';process.env.EASYAPPLY_EFFORT='medium';process.env.EASYAPPLY_ANTHROPIC_SPEED='fast';
    const result=await runStructured({system:'test',text:'analyze',schema:z.object({result:z.string().max(3)}),files:[{name:'notice.pdf',mediaType:'application/pdf',data:Buffer.from('%PDF-test')}]});
    assert.deepEqual(result.data,{result:'ok'});assert.equal(result.provider,'api');
    assert.equal(body?.model,'claude-opus-5-5');assert.equal(body?.speed,'fast');
    assert.equal((body?.output_config as {effort:string}).effort,'medium');
    assert.match(JSON.stringify(body?.tools),/easyapply_result/);assert.match(JSON.stringify(body),/document/);
    assert.deepEqual(body?.tool_choice,{type:'auto',disable_parallel_tool_use:true});
    assert.equal((body?.output_config as {format?:unknown}).format,undefined);
    assert.doesNotMatch(JSON.stringify(body),/maxLength/);
    // Truncation could erase a qualification or exception; keep the schema failure and retry.
    await assert.rejects(runStructured({system:'test',text:'analyze',schema:z.object({result:z.string().max(1)})}), {code:'bad_output'});
    await assert.rejects(runStructured({system:'test',text:'analyze',schema:z.object({result:z.number()})}),(error:{code:string})=>error.code==='bad_output');
    outputText='{"items":[{"date":null,"note":null,"required":""}]}';
    const restored=await runStructured({system:'test',text:'analyze',schema:z.object({items:z.array(z.object({date:z.iso.date().nullable(),note:z.string().nullable(),required:z.string()}))})});
    assert.deepEqual(restored.data,{items:[{date:null,note:null,required:''}]});
    outputText='{"items":[{"date":"not-a-date","note":null,"required":""}]}';
    await assert.rejects(runStructured({system:'test',text:'analyze',schema:z.object({items:z.array(z.object({date:z.iso.date().nullable(),note:z.string().nullable(),required:z.string()}))})}),(error:{code:string})=>error.code==='bad_output');
  } finally {
    for(const key of Object.keys(process.env))if(!(key in original))delete process.env[key];Object.assign(process.env,original);
    server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));
  }
});

type Reply = { status: number; body?: unknown; headers?: Record<string,string> } | 'ok';
async function withAnthropic(replies: Reply[], check: (hits: () => number) => Promise<void>) {
  let hits = 0;
  const server = createServer((req, res) => {
    req.resume();
    const reply = replies[Math.min(hits++, replies.length - 1)];
    if (reply !== 'ok') {
      res.writeHead(reply.status, { 'content-type': 'application/json', 'request-id': `req_fixture_${hits}`, ...reply.headers });
      res.end(JSON.stringify(reply.body ?? { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }));
      return;
    }
    res.writeHead(200, { 'content-type': 'text/event-stream', 'request-id': `req_fixture_${hits}` });
    const send = (type: string, data: Record<string, unknown>) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
    send('message_start', { message: { id: 'msg_retry', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 2, output_tokens: 0 } } });
    send('content_block_start', { index: 0, content_block: { type: 'tool_use', id: 'tool_retry', name: 'easyapply_result', input: {} } });
    send('content_block_delta', { index: 0, delta: { type: 'input_json_delta', partial_json: '{"ok":true}' } });
    send('content_block_stop', { index: 0 });
    send('message_delta', { delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 3 } });
    send('message_stop', {}); res.end();
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const original = { ...process.env };
  try {
    Object.assign(process.env, { ANTHROPIC_API_KEY: 'test-only', ANTHROPIC_BASE_URL: `http://127.0.0.1:${(server.address() as { port: number }).port}`, EASYAPPLY_PROVIDER: 'api', EASYAPPLY_EFFORT: 'medium', EASYAPPLY_ANTHROPIC_SPEED: 'fast' });
    delete process.env.ANTHROPIC_AUTH_TOKEN;
    await check(() => hits);
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in original)) delete process.env[key];
    Object.assign(process.env, original);
    server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
const okSchema = { system: 'test', text: 'analyze', schema: z.object({ ok: z.boolean() }), requestId: 'request-fixture' };

test('a transient 529 is retried once within the time budget', async () => {
  await withAnthropic([{ status: 529 }, 'ok'], async (hits) => {
    assert.deepEqual((await runStructured(okSchema)).data, { ok: true });
    assert.equal(hits(), 2);
  });
});

test('no retry when too little of the request budget is left', async () => {
  await withAnthropic([{ status: 529 }, 'ok'], async (hits) => {
    await assert.rejects(runStructured({ ...okSchema, deadline: Date.now() + 30_000 }), (e: { code: string }) => e.code === 'upstream');
    assert.equal(hits(), 1);
  });
});

test('a server-side 400 is a configuration problem, not the user file, and its cause is logged', async (t) => {
  const logs: string[] = [];
  t.mock.method(console, 'error', (line: string) => { logs.push(line); });
  t.mock.method(console, 'info', (line: string) => { logs.push(line); });
  const grammar = { status: 400, body: { type: 'error', error: { type: 'invalid_request_error', message: 'The compiled grammar is too large' } } };
  await withAnthropic([grammar], async (hits) => {
    const error = await runStructured({ ...okSchema, files: [{ name: 'notice.pdf', mediaType: 'application/pdf', data: Buffer.from('%PDF-test') }] }).catch((e) => e);
    assert.equal(error.code, 'configuration');
    assert.equal(error.status, 503);
    assert.equal(hits(), 1);
    errorResponse(error, 'request-fixture');
    const events = logs.map((line) => JSON.parse(line));
    const logged = events.find((event) => event.event === 'request_error');
    assert.equal(logged.request_id, 'request-fixture');
    assert.equal(logged.cause.provider_status, 400);
    assert.equal(logged.cause.provider_type, 'invalid_request_error');
    assert.equal(logged.cause.provider_request_id, 'req_fixture_1');
    assert.match(logged.cause.message, /compiled grammar is too large/);
    const usage = events.find((event) => event.event === 'ai_usage');
    assert.equal(usage?.outcome, 'error');
    assert.equal(usage?.request_id, 'request-fixture');
  });
});

test('a 400 about the uploaded PDF still asks the user to re-save the file', async () => {
  const badPdf = { status: 400, body: { type: 'error', error: { type: 'invalid_request_error', message: 'The PDF specified was not valid.' } } };
  await withAnthropic([badPdf], async () => {
    const error = await runStructured({ ...okSchema, files: [{ name: 'notice.pdf', mediaType: 'application/pdf', data: Buffer.from('%PDF-test') }] }).catch((e) => e);
    assert.equal(error.code, 'provider_input');
  });
});
