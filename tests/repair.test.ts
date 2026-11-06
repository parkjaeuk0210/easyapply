import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { AnalysisSchema, MatchSchema } from '../src/lib/schema';
import { repairOutput } from '../src/lib/server/repair';
import { runStructured } from '../src/lib/llm';
import sample from './fixtures/samples/garam-analysis.json';

const analysis = () => AnalysisSchema.parse(structuredClone(sample.analysis));

test('near-miss analysis output is repaired instead of failing the paid call', () => {
  const raw = analysis();
  raw.schedule[0].time = '24:00';
  raw.schedule[1].time = '오후 6시';
  raw.profile_questions.push({ ...raw.profile_questions[0], id: 'q9' });
  raw.benefits[0].evidence.unshift({ page: 1, quote: '' });
  raw.eligibility[10].evidence = [{ page: 1, quote: ' ' }];
  raw.eligibility[0].id = 'C1 ';
  raw.profile_questions[0].criteria_ids = ['C1'];
  raw.how_to_apply[0].evidence[0].page = 7;
  raw.profile_questions[1].options.push(raw.profile_questions[1].options[0]);
  raw.summary[0] = '가'.repeat(5000);
  assert.equal(AnalysisSchema.safeParse(raw).success, false);

  const repaired = repairOutput(raw, AnalysisSchema, { pages: 2 });
  const parsed = AnalysisSchema.safeParse(repaired.value);
  assert(parsed.success, JSON.stringify(parsed.error?.issues.slice(0, 3)));
  const a = parsed.data;
  assert.equal(a.schedule[0].time, '23:59');
  assert.equal(a.schedule[1].time, null);
  assert.equal(a.profile_questions.length, 8);
  assert(a.benefits[0].evidence.every((e) => e.quote.length >= 2));
  assert(!a.eligibility.some((c) => c.id === 'c11'));
  assert.deepEqual(a.profile_questions.find((q) => q.id === 'q5')?.criteria_ids, ['c5']);
  assert.equal(a.eligibility[0].id, 'c1');
  assert.deepEqual(a.profile_questions[0].criteria_ids, ['c1']);
  assert.equal(a.how_to_apply[0].evidence[0].page, 2);
  assert.equal(new Set(a.profile_questions[1].options).size, a.profile_questions[1].options.length);
  assert.equal(a.summary[0].length, 4000);
  assert(repaired.repairs >= 9);
  // The input object is not mutated.
  assert.equal(raw.schedule[0].time, '24:00');
});

test('repair leaves real problems for validation and retry', () => {
  const badDate = analysis();
  badDate.schedule[0].date_iso = '2026-02-30';
  assert.equal(AnalysisSchema.safeParse(repairOutput(badDate, AnalysisSchema).value).success, false);
  const noSummary = analysis();
  noSummary.summary = [];
  assert.equal(AnalysisSchema.safeParse(repairOutput(noSummary, AnalysisSchema).value).success, false);
  const clean = repairOutput(analysis(), AnalysisSchema, { pages: 2 });
  assert.equal(clean.repairs, 0);
});

test('transcript pages beyond the document are dropped, not clamped into duplicates', () => {
  const raw = analysis();
  raw.transcript = [{ page: 1, text: '첫 장' }, { page: 2, text: '둘째 장' }, { page: 3, text: '없는 장' }];
  const a = AnalysisSchema.parse(repairOutput(raw, AnalysisSchema, { pages: 2 }).value);
  assert.deepEqual(a.transcript.map((t) => t.page), [1, 2]);
});

test('match output gets format repairs inside runStructured, with a logged summary', async (t) => {
  const logs: string[] = [];
  t.mock.method(console, 'info', (line: string) => { logs.push(line); });
  const output = {
    overall: 'needs_check', overall_message: '확인이 필요해요.',
    criteria: [{ criterion_id: 'C1', status: 'check', reason: '답변 없음', how_to_check: null, failed_answer_ids: [] }],
    next_searches: Array.from({ length: 9 }, (_, i) => ({ criterion_id: 'c1', advice: '다른 공고', query: `검색 ${i}` })),
    checklist: [],
  };
  const server = createServer((req, res) => {
    req.resume();
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const send = (type: string, data: Record<string, unknown>) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
    send('message_start', { message: { id: 'msg_repair', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 2, output_tokens: 0 } } });
    send('content_block_start', { index: 0, content_block: { type: 'tool_use', id: 'tool_repair', name: 'easyapply_result', input: {} } });
    send('content_block_delta', { index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(output) } });
    send('content_block_stop', { index: 0 });
    send('message_delta', { delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 3 } });
    send('message_stop', {}); res.end();
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const original = { ...process.env };
  try {
    Object.assign(process.env, { ANTHROPIC_API_KEY: 'test-only', ANTHROPIC_BASE_URL: `http://127.0.0.1:${(server.address() as { port: number }).port}`, EASYAPPLY_PROVIDER: 'api' });
    const { data } = await runStructured({ system: 'test', text: 'match', schema: MatchSchema, requestId: 'request-repair' });
    assert.equal(data.criteria[0].criterion_id, 'c1');
    assert.equal(data.next_searches.length, 8);
    const event = logs.map((line) => JSON.parse(line)).find((e) => e.event === 'ai_output_repaired');
    assert.equal(event?.request_id, 'request-repair');
    assert(event?.repairs >= 2);
    assert(!JSON.stringify(event).includes('검색'));
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in original)) delete process.env[key];
    Object.assign(process.env, original);
    server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
