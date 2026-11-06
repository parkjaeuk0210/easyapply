import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { AnalysisSchema, MatchSchema } from '../src/lib/schema';
import { repairOutput } from '../src/lib/server/repair';
import { validateAnalysis } from '../src/lib/server/validation';
import { runStructured } from '../src/lib/llm';
import sample from './fixtures/samples/garam-analysis.json';

const analysis = () => AnalysisSchema.parse(structuredClone(sample.analysis));

test('repair only normalizes recognizable times and IDs without changing the input', () => {
  const raw = analysis();
  raw.schedule[0].time = '24:00';
  raw.schedule[1].time = '9:30';
  raw.eligibility[0].id = 'C1 ';
  raw.profile_questions[0].criteria_ids = ['C1'];
  const repaired = repairOutput(raw, AnalysisSchema);
  const a = AnalysisSchema.parse(repaired.value);
  assert.equal(a.schedule[0].time, '23:59');
  assert.equal(a.schedule[1].time, '09:30');
  assert.equal(a.eligibility[0].id, 'c1');
  assert.deepEqual(a.profile_questions[0].criteria_ids, ['c1']);
  assert.equal(repaired.repairs, 4);
  validateAnalysis(a, 2);
  assert.equal(raw.schedule[0].time, '24:00');
});

test('repair preserves empty citations, criteria, questions, schedules and documents', () => {
  const raw = analysis();
  raw.eligibility[10].evidence = [{ page: 1, quote: ' ' }];
  raw.schedule[0].evidence = [];
  raw.documents[0].evidence = [{ page: 1, quote: '' }];
  const repaired = repairOutput(raw, AnalysisSchema);
  const a = AnalysisSchema.parse(repaired.value);
  validateAnalysis(a, 2);
  assert.deepEqual(a.eligibility, raw.eligibility);
  assert.deepEqual(a.profile_questions, raw.profile_questions);
  assert.deepEqual(a.documents, raw.documents);
  assert.equal(a.schedule.length, raw.schedule.length);
  assert.deepEqual(a.schedule[0].evidence, []);
  // The old test expected c11 and its question reference to disappear: that hid a required condition.
  assert(a.eligibility.some((c) => c.id === 'c11'));
  assert(a.profile_questions.find((q) => q.id === 'q5')?.criteria_ids.includes('c11'));
  assert.equal(repaired.repairs, 0);
});

test('repair never truncates strings or arrays and leaves unknown times for retry', () => {
  const raw = analysis();
  raw.profile_questions.push({ ...raw.profile_questions[0], id: 'q9' });
  raw.summary[0] = '가'.repeat(5000);
  raw.schedule[1].time = '오후 6시';
  const repaired = repairOutput(raw, AnalysisSchema);
  assert.deepEqual(repaired.value, raw);
  assert.equal(AnalysisSchema.safeParse(repaired.value).success, false);
  assert.equal(repaired.repairs, 0);
});

test('repair leaves real problems for validation and retry', () => {
  const badDate = analysis();
  badDate.schedule[0].date_iso = '2026-02-30';
  assert.equal(AnalysisSchema.safeParse(repairOutput(badDate, AnalysisSchema).value).success, false);
  const noSummary = analysis();
  noSummary.summary = [];
  assert.equal(AnalysisSchema.safeParse(repairOutput(noSummary, AnalysisSchema).value).success, false);
  const clean = repairOutput(analysis(), AnalysisSchema);
  assert.equal(clean.repairs, 0);
});

test('out-of-range pages are retained for validation instead of dropped or clamped', () => {
  const raw = analysis();
  raw.transcript = [{ page: 1, text: '첫 장' }, { page: 2, text: '둘째 장' }, { page: 3, text: '없는 장' }];
  raw.eligibility[0].evidence[0].page = 3;
  const a = AnalysisSchema.parse(repairOutput(raw, AnalysisSchema).value);
  assert.deepEqual(a.transcript.map((t) => t.page), [1, 2, 3]);
  assert.equal(a.eligibility[0].evidence[0].page, 3);
  assert.throws(() => validateAnalysis(a, 2), { code: "bad_output" });
});

test('match output gets format repairs inside runStructured, with a logged summary', async (t) => {
  const logs: string[] = [];
  t.mock.method(console, 'info', (line: string) => { logs.push(line); });
  const output = {
    overall: 'needs_check', overall_message: '확인이 필요해요.',
    criteria: [{ criterion_id: 'C1', status: 'check', reason: '답변 없음', how_to_check: null, failed_answer_ids: [] }],
    next_searches: Array.from({ length: 8 }, (_, i) => ({ criterion_id: 'c1', advice: '다른 공고', query: `검색 ${i}` })),
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
    assert.equal(event?.repairs, 1);
    assert(!JSON.stringify(event).includes('검색'));
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in original)) delete process.env[key];
    Object.assign(process.env, original);
    server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
