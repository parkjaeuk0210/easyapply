import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createSession } from '../src/lib/server/tokens';
import { POST as analyze } from '../src/app/api/analyze/route';
import { cacheKey } from '../src/lib/server/analysis-cache';
import sample from './fixtures/samples/garam-analysis.json';

const baseline = { ...process.env };
after(() => { for (const k of Object.keys(process.env)) if (!(k in baseline)) delete process.env[k]; Object.assign(process.env, baseline); });

function pdfRequest(session: ReturnType<typeof createSession>, data: Buffer) {
  const form = new FormData(); form.append('files', new File([new Uint8Array(data)], 'notice.pdf', { type: 'application/pdf' }));
  return new Request('http://localhost:3123/api/analyze', { method: 'POST', headers: { cookie: session.cookie.split(';')[0] }, body: form });
}

test('같은 PDF를 다시 올리면 AI를 부르지 않고 지난 분석을 다시 쓴다', async () => {
  let hits = 0;
  const server = createServer((req, res) => {
    hits++; req.resume();
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const send = (type: string, data: Record<string, unknown>) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
    send('message_start', { message: { id: 'msg_cache', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 2, output_tokens: 0 } } });
    send('content_block_start', { index: 0, content_block: { type: 'tool_use', id: 'tool_cache', name: 'easyapply_result', input: {} } });
    send('content_block_delta', { index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(sample.analysis) } });
    send('content_block_stop', { index: 0 });
    send('message_delta', { delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 3 } });
    send('message_stop', {}); res.end();
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    for (const k of Object.keys(process.env)) if (/^(?:EASYAPPLY_|ANTHROPIC_|OPENAI_|UPSTASH_|KV_|VERCEL)/.test(k)) delete process.env[k];
    Object.assign(process.env, { NODE_ENV: 'test', EASYAPPLY_PROVIDER: 'api', ANTHROPIC_API_KEY: 'test-only', ANTHROPIC_BASE_URL: `http://127.0.0.1:${(server.address() as { port: number }).port}` });
    const pdf = await readFile('tests/fixtures/samples/garam-youth-rent-2026.pdf');
    const first = await analyze(pdfRequest(createSession(new Request('http://localhost:3123')), pdf));
    assert.equal(first.status, 200);
    const fresh = await first.json();
    assert.equal(fresh.cached, false);
    // 다른 세션이 같은 파일을 올려도 같은 결과를 쓰고, 서명은 그 세션용으로 새로 받는다.
    const second = await analyze(pdfRequest(createSession(new Request('http://localhost:3123')), pdf));
    const reused = await second.json();
    assert.equal(second.status, 200);
    assert.equal(hits, 1);
    assert.equal(reused.cached, true);
    assert.equal(typeof reused.analyzed_at, 'string');
    assert.equal(reused.analysis.title, fresh.analysis.title);
    assert.deepEqual(reused.verification.unverified_criteria, fresh.verification.unverified_criteria);
    assert.notEqual(reused.analysis_token, fresh.analysis_token);
  } finally {
    server.closeAllConnections(); await new Promise<void>((r) => server.close(() => r()));
  }
});

test('사진과 여러 파일은 보관하지 않는다', () => {
  const data = Buffer.from('x');
  assert.equal(cacheKey([{ name: 'a.jpg', mediaType: 'image/jpeg', data }]), null);
  assert.equal(cacheKey([{ name: 'a.pdf', mediaType: 'application/pdf', data }, { name: 'b.pdf', mediaType: 'application/pdf', data }]), null);
  assert.match(cacheKey([{ name: 'a.hwpx', mediaType: 'application/hwp+zip', data }])!, /^easyapply:analysis:[0-9a-f]{16}:[0-9a-f]{64}$/);
});
