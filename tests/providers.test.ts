import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { z } from 'zod';
import { runStructured } from '../src/lib/llm';

test('OpenAI adapter sends PDF, strict schema and store:false through the real SDK', async()=>{
  let body: Record<string, unknown> | undefined;
  const server=createServer(async(req,res)=>{
    let input=''; for await(const chunk of req) input+=chunk;
    body=JSON.parse(input);
    res.writeHead(200,{'content-type':'text/event-stream'});
    const send=(event:unknown)=>res.write(`data: ${JSON.stringify(event)}\n\n`);
    const message={id:'msg_test',type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:'{"result":"ok"}',annotations:[]}]};
    const response={id:'resp_test',object:'response',created_at:1,model:'gpt-5.4',status:'in_progress',output:[],parallel_tool_calls:false,tools:[],tool_choice:'auto',usage:{input_tokens:2,output_tokens:3,total_tokens:5}};
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
    const result=await runStructured({system:'system',text:'analyze',schema:z.object({result:z.string()}),files:[{name:'test.pdf',mediaType:'application/pdf',data:Buffer.from('%PDF-test')}]});
    assert.equal(result.provider,'openai');assert.deepEqual(result.data,{result:'ok'});
    assert.equal(body?.store,false);assert.match(JSON.stringify(body),/input_file/);assert.match(JSON.stringify(body),/json_schema/);assert.match(JSON.stringify(body),/strict/);
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
