import { test, beforeEach, afterEach, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { crc32 } from 'node:zlib';
import { AnalysisSchema, MatchSchema, type Analysis } from '../src/lib/schema';
import { POST as analyze } from '../src/app/api/analyze/route';
import { POST as match } from '../src/app/api/match/route';
import { POST as upload } from '../src/app/api/uploads/route';
import { createSession, privateKey, signUpload, verifyAnalysis } from '../src/lib/server/tokens';
import { consumeUploads, uploadManifest } from '../src/lib/server/staged-uploads';
import { maxUploadBytes } from '../src/lib/limits';
import sample from './fixtures/samples/garam-analysis.json';

const baseline = { ...process.env };
const origin = 'http://localhost:3161';
beforeEach(() => {
  for (const key of Object.keys(process.env)) if (/^(?:EASYAPPLY_|ANTHROPIC_|OPENAI_|UPSTASH_|KV_|VERCEL|BLOB_|CRON_SECRET)/.test(key)) delete process.env[key];
  Object.assign(process.env, { NODE_ENV: 'test', EASYAPPLY_PROVIDER: 'api', ANTHROPIC_API_KEY: 'test-only', ANTHROPIC_BASE_URL: `${origin}/mock-provider`, BLOB_STORE_ID: 'test-only', CRON_SECRET: 'test-only' });
});
afterEach(() => {
  for (const key of Object.keys(process.env)) if (!(key in baseline)) delete process.env[key];
  Object.assign(process.env, baseline);
});

function outputs(t: TestContext, replies: unknown[]) {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (url: string | URL | Request) => {
    assert(String(url).startsWith(`${origin}/mock-provider`), 'only the mocked provider may be called');
    assert(calls < replies.length, 'unexpected retry');
    const output = replies[calls++];
    const event = (type: string, data: object) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
    return new Response([
      event('message_start', { message: { id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 2, output_tokens: 0 } } }),
      event('content_block_start', { index: 0, content_block: { type: 'tool_use', id: 'tool_test', name: 'easyapply_result', input: {} } }),
      event('content_block_delta', { index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(output) } }),
      event('content_block_stop', { index: 0 }),
      event('message_delta', { delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 3 } }),
      event('message_stop', {}),
    ].join(''), { headers: { 'content-type': 'text/event-stream' } });
  });
  return () => calls;
}
function analysis(): Analysis {
  const a = AnalysisSchema.parse(structuredClone(sample.analysis));
  a.eligibility = [{ ...a.eligibility[1], id: 'c1' }, { ...a.eligibility[4], id: 'c2', evidence: [{ page: 1, quote: ' ' }] }];
  a.profile_questions = a.eligibility.map((c, i) => ({ id: `q${i + 1}`, label: c.requirement, input: 'yes_no', options: [], unit: null, help: null, criteria_ids: [c.id] }));
  a.schedule = [];
  a.benefits = []; a.cautions = []; a.glossary = []; a.contact_evidence = []; a.transcript = [];
  a.documents = [{ ...a.documents[0], evidence: [] }];
  return a;
}
function result(a: Analysis) {
  return MatchSchema.parse({ overall: 'likely_eligible', overall_message: '모델 판정', criteria: a.eligibility.map((c) => ({ criterion_id: c.id, status: 'met', reason: '답변 충족', how_to_check: null })), checklist: [], next_searches: [] });
}
async function analyzeThenMatch(a: Analysis, bytes: Buffer, name: string, mediaType: string) {
  const session = createSession(new Request(origin));
  const cookie = session.cookie.split(';')[0];
  const form = new FormData();
  form.append('files', new File([new Uint8Array(bytes)], name, { type: mediaType }));
  const response = await analyze(new Request(`${origin}/api/analyze`, { method: 'POST', headers: { cookie }, body: form }));
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  const parsed = AnalysisSchema.parse(body.analysis);
  assert.deepEqual(verifyAnalysis(parsed, body.analysis_token, session.id), body.verification.flags);
  const judged = await match(new Request(`${origin}/api/match`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ analysis: parsed, analysis_token: body.analysis_token, answers: Object.fromEntries(a.profile_questions.map((q) => [q.id, '예'])) }) }));
  const matched = await judged.json();
  assert.equal(judged.status, 200, JSON.stringify(matched));
  return { body, parsed, match: MatchSchema.parse(matched.match) };
}

test('review 2 and 6: a blank required income citation survives PDF analyze→signature→match and quotes stay out of logs', async (t) => {
  const a = analysis();
  // The residence quote is on page 1: page correction must stay in the response, not in logs.
  a.eligibility[0].evidence[0].page = 2;
  const sourceQuote = a.eligibility[0].evidence[0].quote;
  const calls = outputs(t, [a, result(a)]), logs: string[] = [];
  t.mock.method(console, 'info', (line: string) => logs.push(line));
  const r = await analyzeThenMatch(a, await readFile('tests/fixtures/samples/garam-youth-rent-2026.pdf'), 'notice.pdf', 'application/pdf');
  assert.equal(calls(), 2);
  assert.deepEqual(r.parsed.eligibility, a.eligibility);
  assert.deepEqual(r.parsed.profile_questions, a.profile_questions);
  assert.deepEqual(r.parsed.documents, a.documents);
  assert.deepEqual(r.body.verification.unverified_criteria, ['c2']);
  assert.equal(r.match.criteria.find((c) => c.criterion_id === 'c2')?.status, 'check');
  assert.equal(r.match.overall, 'needs_check');
  assert(r.body.verification.page_corrections.some((c: { quote: string }) => c.quote === sourceQuote));
  const event = logs.map((line) => JSON.parse(line)).find((e) => e.event === 'analyze_complete');
  assert.deepEqual(event.verification.page_corrections[0], { page: 2, found_page: 1 });
  assert(!logs.join('\n').includes(sourceQuote));
  assert(!Object.hasOwn(event.verification.page_corrections[0], 'quote'));
});

// In-memory package: text residence condition plus an image containing a separate income condition.
function hwpx() {
  const entries = {
    'Contents/section0.xml': '<hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph"><hp:p><hp:run><hp:t>서울시 거주자여야 합니다. 소득 기준은 첨부한 그림 표를 확인해 주세요.</hp:t></hp:run></hp:p></hs:sec>',
    'BinData/image1.svg': '<svg xmlns="http://www.w3.org/2000/svg"><text x="10" y="20">기준 중위소득 60% 이하</text></svg>',
  };
  const chunks: Buffer[] = [], directory: Buffer[] = [];
  let offset = 0;
  for (const [pathname, content] of Object.entries(entries)) {
    const name = Buffer.from(pathname), data = Buffer.from(content), sum = crc32(data);
    const header = Buffer.alloc(30), central = Buffer.alloc(46);
    header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(20, 4); header.writeUInt32LE(sum, 14);
    header.writeUInt32LE(data.length, 18); header.writeUInt32LE(data.length, 22); header.writeUInt16LE(name.length, 26);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt32LE(sum, 16);
    central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(name.length, 28); central.writeUInt32LE(offset, 42);
    chunks.push(header, name, data); directory.push(central, name); offset += header.length + name.length + data.length;
  }
  const central = Buffer.concat(directory), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(2, 8); end.writeUInt16LE(2, 10); end.writeUInt32LE(central.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, central, end]);
}

test('review 5: an image the extractor cannot read keeps the whole HWPX notice from "likely eligible", without blanking met criteria', async (t) => {
  const a = analysis();
  a.eligibility = [{ ...a.eligibility[0], requirement: '서울시 거주자', evidence: [{ page: 1, quote: '서울시 거주자여야 합니다.' }] }];
  a.profile_questions = a.profile_questions.slice(0, 1);
  a.documents = []; a.how_to_apply = [];
  const calls = outputs(t, [a, result(a)]);
  const r = await analyzeThenMatch(a, hwpx(), 'notice.hwpx', 'application/hwp+zip');
  assert.equal(calls(), 2);
  assert.equal(r.body.verification.exact, 1, 'even an exact text quote cannot account for the omitted image');
  assert.doesNotMatch(JSON.stringify(r.body.source.sections), /중위소득 60%/);
  assert.match(r.body.source.warning, /이미지·도형의 글자는 추출하지 않았/);
  assert.deepEqual(r.body.verification.unverified_criteria, []);
  assert(r.body.verification.flags.includes('#images'));
  assert.equal(r.match.overall, 'needs_check');
  assert.match(r.match.overall_message, /그림/);
  assert.equal(r.match.criteria[0].status, 'met', 'an exact, answered residence condition is not sent back to the user');
});

test('review 11: upload route and previously signed tickets enforce the active 22 MiB limit before storage', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('No external call allowed'); });
  const session = createSession(new Request(origin));
  for (const size of [maxUploadBytes('api') + 1, 24 * 1024 * 1024 + 1]) {
    const response = await upload(new Request(`${origin}/api/uploads`, { method: 'POST', headers: { cookie: session.cookie.split(';')[0], 'content-type': 'application/json' }, body: JSON.stringify({ files: [{ name: 'notice.pdf', mediaType: 'application/pdf', size }] }) }));
    const body = await response.json();
    assert.equal(response.status, 413);
    assert.equal(body.error.code, 'too_large');
    assert.match(body.error.message, /22MB/);
    assert.doesNotMatch(body.error.message, /24MB/);
  }
  const file = { name: 'notice.pdf', mediaType: 'application/pdf', size: 24 * 1024 * 1024, pathname: `easyapply-tmp/${privateKey(session.id)}/${Date.now()}-12345678-1234-1234-1234-123456789abc` };
  const ticket = signUpload([file], session.id);
  assert.throws(() => uploadManifest(ticket, session.id), { code: 'too_large', status: 413 });
  await assert.rejects(consumeUploads(ticket, session.id, new AbortController().signal), { code: 'too_large', status: 413 });
  process.env.EASYAPPLY_PROVIDER = 'cli';
  assert.deepEqual(uploadManifest(ticket, session.id), [file], '24 MiB remains valid for the local CLI, whose limit is 24 MiB');
});
