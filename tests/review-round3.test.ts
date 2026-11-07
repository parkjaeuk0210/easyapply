import { test, beforeEach, afterEach, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { crc32 } from 'node:zlib';
import { AnalysisSchema, MatchSchema, type Analysis } from '../src/lib/schema';
import { POST as analyze } from '../src/app/api/analyze/route';
import { POST as match } from '../src/app/api/match/route';
import { createSession, verifyAnalysis } from '../src/lib/server/tokens';
import { extractHangul } from '../src/lib/server/hangul';
import { finalizeMatch, settleApplication, validateAnalysis, validateAnswers } from '../src/lib/server/validation';
import { buildIcs } from '../src/lib/dates';
import { MATCH_SYSTEM } from '../src/lib/prompts';
import { deadlineInfo } from '../src/components/ui';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ProfileCheck from '../src/components/ProfileCheck';

// 2차 재검토(REREVIEW-round2.md)의 A~F와 1차 검토 7번 입력을 그대로 고정한 회귀 테스트.

// ── 공통: 메모리 HWPX와 모의 공급자로 실제 analyze → 클라이언트 parse → match 경로를 돈다 ──
const baseline = { ...process.env };
const origin = 'http://localhost:3171';
beforeEach(() => {
  for (const key of Object.keys(process.env)) if (/^(?:EASYAPPLY_|ANTHROPIC_|OPENAI_|UPSTASH_|KV_|VERCEL|BLOB_|CRON_SECRET)/.test(key)) delete process.env[key];
  Object.assign(process.env, { NODE_ENV: 'test', EASYAPPLY_PROVIDER: 'api', ANTHROPIC_API_KEY: 'test-only', ANTHROPIC_BASE_URL: `${origin}/mock-provider` });
});
afterEach(() => {
  for (const key of Object.keys(process.env)) if (!(key in baseline)) delete process.env[key];
  Object.assign(process.env, baseline);
});

function zip(entries: Record<string, string>) {
  const local: Buffer[] = [], directory: Buffer[] = [];
  let offset = 0;
  for (const [pathname, content] of Object.entries(entries)) {
    const name = Buffer.from(pathname), data = Buffer.from(content), sum = crc32(data);
    const header = Buffer.alloc(30), central = Buffer.alloc(46);
    header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(20, 4); header.writeUInt32LE(sum, 14);
    header.writeUInt32LE(data.length, 18); header.writeUInt32LE(data.length, 22); header.writeUInt16LE(name.length, 26);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt32LE(sum, 16);
    central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(name.length, 28); central.writeUInt32LE(offset, 42);
    local.push(header, name, data); directory.push(central, name); offset += header.length + name.length + data.length;
  }
  const central = Buffer.concat(directory), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(entries).length, 8); end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(central.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, central, end]);
}
const section = (lines: string[]) => `<?xml version="1.0"?><hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph">${lines.map((l) => `<hp:p><hp:run><hp:t>${l}</hp:t></hp:run></hp:p>`).join('')}</hs:sec>`;
const NOTICE = ['2026년 서울 청년 월세 지원 공고', '신청 대상: 서울시에 거주하는 청년', '신청 방법: 온라인으로 신청합니다'];

type Row = Analysis['schedule'][number];
const row = (label: string, date_text: string, date_iso: string | null, quote: string, flagged = false): Row => ({
  label, date_text, date_iso, time: null, is_deadline: flagged, is_application_deadline: flagged, deadline_inferred: false, date_uncertain: false, evidence: [{ page: 1, quote }],
});
function analysis(schedule: Row[]): Analysis {
  return AnalysisSchema.parse({
    title: '2026년 서울 청년 월세 지원 공고', organization: null, category: '주거', one_line: '청년 월세를 지원해요.', summary: ['자격과 접수 기간을 확인하세요.'],
    benefits: [], schedule, how_to_apply: [{ text: '온라인으로 신청', evidence: [{ page: 1, quote: '온라인으로 신청합니다' }] }],
    eligibility: [{ id: 'c1', category: '거주', kind: 'required', requirement: '서울시 거주 청년', detail: null, evidence: [{ page: 1, quote: '서울시에 거주하는 청년' }] }],
    documents: [], cautions: [], glossary: [],
    profile_questions: [{ id: 'q1', label: '서울시에 거주하나요?', input: 'yes_no', options: [], unit: null, help: null, criteria_ids: ['c1'] }],
    contact: null, contact_evidence: [], reading_notes: null, transcript: [],
    // 모델이 서버 전용 값을 채워도 서버가 덮어써야 한다.
    application_status: 'closed', application_deadline_iso: '2000-01-01',
  });
}
const metAll = MatchSchema.parse({ overall: 'likely_eligible', overall_message: '모델 판정', criteria: [{ criterion_id: 'c1', status: 'met', reason: '서울 거주', how_to_check: null }], checklist: [], next_searches: [] });

async function analyzeThenMatch(t: TestContext, extra: string[], schedule: Row[]) {
  const a = analysis(schedule);
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (url: string | URL | Request) => {
    assert(String(url).startsWith(`${origin}/mock-provider`), 'only the mocked provider may be called');
    const output = [a, metAll][calls++];
    assert(output, 'unexpected retry');
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
  t.mock.method(console, 'info', () => {});
  const session = createSession(new Request(origin));
  const cookie = session.cookie.split(';')[0];
  const form = new FormData();
  form.append('files', new File([new Uint8Array(zip({ 'Contents/section0.xml': section([...NOTICE, ...extra]) }))], 'notice.hwpx', { type: 'application/hwp+zip' }));
  const response = await analyze(new Request(`${origin}/api/analyze`, { method: 'POST', headers: { cookie }, body: form }));
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  // 클라이언트(EasyApp)와 같은 방식으로 다시 읽고, 같은 객체로 서명이 맞는지 확인한다.
  const parsed = AnalysisSchema.parse(body.analysis);
  verifyAnalysis(parsed, body.analysis_token, session.id);
  const judged = await match(new Request(`${origin}/api/match`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ analysis: parsed, analysis_token: body.analysis_token, answers: { q1: '예' } }) }));
  const matched = await judged.json();
  assert.equal(judged.status, 200, JSON.stringify(matched));
  assert.equal(calls, 2);
  return { body, parsed, result: MatchSchema.parse(matched.match), info: deadlineInfo(parsed) };
}
const UNKNOWN = '마감일을 확정하지 못했어요. 원문에서 확인해 주세요.';
const hasApply = (m: { checklist: { kind: string }[] }) => m.checklist.some((t) => t.kind === 'apply');

// ── A. 근거(인용)가 빈 접수 마감은 종료를 확정하지 못한다 ──────────────────
test('A: a blank-quote application deadline cannot close the notice (analyze → parse → match → deadlineInfo)', async (t) => {
  const r = await analyzeThenMatch(t, ['신청 마감: 2026.5.31까지'], [row('신청 마감', '2026.5.31까지', '2026-05-31', ' ', true)]);
  assert.deepEqual(r.body.verification.unverified_schedule, [0]);
  assert.equal(r.parsed.schedule.length, 1, 'the row is kept, not deleted');
  assert.deepEqual([r.parsed.application_status, r.parsed.application_deadline_iso], ['unknown', null], 'model-supplied closed/2000-01-01 is overwritten');
  assert.doesNotMatch(r.result.overall_message, /마감일이 모두 지났/);
  assert(!r.result.checklist.some((x) => x.id === 'verify_reopening'));
  assert(hasApply(r.result), 'the apply task is not removed');
  assert.deepEqual([r.info.expired, r.info.text], [false, UNKNOWN]);
});

test('A (control): the same deadline with a verified quote does close the notice everywhere', async (t) => {
  const r = await analyzeThenMatch(t, ['신청 마감: 2026.5.31까지'], [row('신청 마감', '2026.5.31까지', '2026-05-31', '신청 마감: 2026.5.31까지', true)]);
  assert.deepEqual(r.body.verification.unverified_schedule, []);
  assert.deepEqual([r.parsed.application_status, r.parsed.application_deadline_iso], ['closed', '2026-05-31']);
  assert.match(r.result.overall_message, /마감일이 모두 지났/);
  assert.equal(r.result.overall, 'needs_check');
  assert(r.result.checklist.some((x) => x.id === 'verify_reopening'));
  assert(!hasApply(r.result));
  assert.equal(r.info.expired, true);
  assert.match(r.info.text, /^이 공고는 (?:2026년 )?5월 31일에 접수가 끝났어요\.$/);
});

// ── B. 1차는 끝났지만 2차가 상시 모집이면 서버·화면 모두 종료를 말하지 않는다 ──────
test('B: an ended first round plus an ongoing second round is unknown on the server and on screen', async (t) => {
  const r = await analyzeThenMatch(t, ['1차 신청 마감: 2026.5.31까지', '2차 모집: 상시 모집'], [
    row('1차 신청 마감', '2026.5.31까지', '2026-05-31', '1차 신청 마감: 2026.5.31까지', true),
    row('2차 모집', '상시 모집', null, '2차 모집: 상시 모집'),
  ]);
  assert.deepEqual(r.body.verification.unverified_schedule, []);
  assert.equal(r.parsed.application_status, 'unknown');
  assert.doesNotMatch(r.result.overall_message, /마감일이 모두 지났/);
  assert(hasApply(r.result));
  assert.deepEqual([r.info.expired, r.info.text], [false, UNKNOWN], 'the screen no longer says the notice ended on 5/31');
});

// ── C. 고정 최종일 + 예산 소진 시 조기 마감: 최종일을 버리지 않는다 ─────────────
test('C: a fixed final date with an early-close clause keeps that final date (past → closed)', async (t) => {
  const text = '신청 마감: 2026.5.31까지 (예산 소진 시 조기 마감)';
  const r = await analyzeThenMatch(t, [text], [row('신청 마감', '2026.5.31까지 (예산 소진 시 조기 마감)', '2026-05-31', text, true)]);
  assert.deepEqual([r.parsed.application_status, r.parsed.application_deadline_iso], ['closed', '2026-05-31']);
  assert.notEqual(r.result.overall, 'likely_eligible');
  assert.match(r.result.overall_message, /마감일이 모두 지났/);
  assert(!hasApply(r.result));
  assert.equal(r.info.expired, true);
  assert.match(r.info.text, /5월 31일에 접수가 끝났어요/);
});

test('C: a future fixed final date with an early-close clause is open with a D-day and its stated time', async (t) => {
  const text = '신청 마감: 2099.5.31 18:00까지 (예산 소진 시 조기 마감)';
  const r = await analyzeThenMatch(t, [text], [row('신청 마감', '2099.5.31 18:00까지 (예산 소진 시 조기 마감)', '2099-05-31', text, true)]);
  assert.deepEqual([r.parsed.application_status, r.parsed.application_deadline_iso], ['open', '2099-05-31']);
  assert.equal(r.result.overall, 'likely_eligible');
  assert(hasApply(r.result));
  assert.equal(r.info.expired, false);
  assert.match(r.info.text, /^2099년 5월 31일\(일\) 18:00까지 신청$/, 'the deadline time is shown again (display only)');
  assert.match(r.info.left ?? '', /^\d+일 남았어요$/);
});

test('C: deadline inference is gone; an unflagged open-ended start never becomes a deadline', () => {
  const a = analysis([row('신청 기간', '2026. 1. 1.부터 상시 모집 (예산 소진 시까지)', '2026-01-01', '2026. 1. 1.부터 상시 모집 (예산 소진 시까지)')]);
  validateAnalysis(a, 1);
  assert.deepEqual([a.schedule[0].is_application_deadline, a.schedule[0].deadline_inferred, a.schedule[0].date_iso], [false, false, '2026-01-01']);
  settleApplication(a, [], new Date('2026-11-07T12:00:00+09:00'));
  assert.deepEqual([a.application_status, a.application_deadline_iso], ['unknown', null]);
  assert.equal(deadlineInfo(a).text, UNKNOWN);
});

// ── D. 연령 계산 제거: '청년 또는 경력단절여성'을 나이만으로 탈락시키지 않는다 ─────────
test('D: "34세 이하 청년 또는 경력단절여성" stays met for a 46-year-old who answered 경력단절여성 예', () => {
  const a = analysis([]);
  a.eligibility = [{ id: 'c1', category: '대상', kind: 'required', requirement: '청년 또는 경력단절여성', detail: null, applies_to: null, evidence: [{ page: 1, quote: '2026.11.7 기준 만 34세 이하 청년 또는 경력단절여성' }] }];
  a.profile_questions = [
    { id: 'q1', label: '생년월일이 언제인가요?', input: 'date', options: [], unit: null, help: null, criteria_ids: ['c1'] },
    { id: 'q2', label: '경력단절여성인가요?', input: 'yes_no', options: [], unit: null, help: null, criteria_ids: ['c1'] },
  ];
  validateAnalysis(a, 1);
  settleApplication(a, []); // the helper's model-claimed 'closed' is overwritten as on the analyze route
  const answers = validateAnswers(a, { q1: '1980-01-01', q2: '예' });
  const r = finalizeMatch(a, answers, metAll);
  assert.equal(r.criteria[0].status, 'met');
  assert.equal(r.criteria[0].reason, '서울 거주', 'the model reason is not replaced by an age calculation');
  assert.equal(r.overall, 'likely_eligible');
});

// ── E. 신청 시작 일정은 끝 날짜로 옮겨지지 않고 마감 후보도 아니다 ────────────────
test('E: "신청 시작 / 2026년 11월 9일~11월 30일 / 11-09" keeps its start date and is never a deadline', () => {
  const a = analysis([
    row('신청 시작', '2026년 11월 9일~11월 30일', '2026-11-09', '2026년 11월 9일~11월 30일'),
    row('신청 마감', '2026년 11월 30일', '2026-11-30', '2026년 11월 30일', true),
  ]);
  validateAnalysis(a, 1);
  assert.deepEqual(a.schedule.map((s) => [s.label, s.date_iso, s.is_deadline, s.deadline_inferred, s.date_uncertain]),
    [['신청 시작', '2026-11-09', false, false, false], ['신청 마감', '2026-11-30', true, false, false]]);
  assert.match(buildIcs(a, null), /DTSTART;VALUE=DATE:20261109/);
  settleApplication(a, [], new Date('2026-11-07T12:00:00+09:00'));
  assert.deepEqual([a.application_status, a.application_deadline_iso], ['open', '2026-11-30']);
  // 모델이 시작 일정을 접수 마감으로 잘못 표시해도: 기간의 시작일이면 비우고, 단일 날짜여도 마감 후보에서 뺀다.
  const flagged = analysis([row('신청 시작', '2026년 11월 9일~11월 30일', '2026-11-09', '2026년 11월 9일~11월 30일', true)]);
  validateAnalysis(flagged, 1);
  assert.deepEqual([flagged.schedule[0].date_iso, flagged.schedule[0].date_uncertain], [null, true]);
  const single = analysis([row('접수 시작', '2026년 11월 1일', '2026-11-01', '2026년 11월 1일', true)]);
  validateAnalysis(single, 1);
  settleApplication(single, [], new Date('2026-11-07T12:00:00+09:00'));
  assert.equal(single.application_status, 'unknown', 'a past start date never closes the notice');
});

// ── F. HWP5: 표 컨트롤과 본문의 표 앵커가 대응하지 않으면 안전 판정하지 않는다 ─────────
type RecordView = { tag: number; header: Buffer; data: Buffer };
async function hwp(patch?: (records: RecordView[]) => void) {
  const data = readFileSync(new URL('./fixtures/simple-table.hwp', import.meta.url));
  if (patch) {
    const { CompoundFile } = await import('@mdgate/containers');
    const body = Buffer.from(CompoundFile.open(data).readStream('BodyText/Section0'));
    const start = data.indexOf(body); // This tiny fixture's mini stream is physically contiguous.
    assert.ok(start >= 0);
    const records: RecordView[] = [];
    for (let at = 0; at < body.length;) {
      const header = data.subarray(start + at, start + at + 4), size = header.readUInt32LE(0) >>> 20;
      records.push({ tag: header.readUInt32LE(0) & 1023, header, data: data.subarray(start + at + 4, start + at + 4 + size) });
      at += 4 + size;
    }
    patch(records);
  }
  return extractHangul({ name: 'table.hwp', mediaType: 'application/x-hwp', data }, new AbortController().signal);
}
const anchorText = (r: RecordView[]) => {
  const text = r.find((x) => x.tag === 67)!;
  assert.equal(text.data.readUInt16LE(0), 11); assert.equal(text.data.toString('latin1', 2, 6), ' lbt');
  return text.data;
};

test('F: an intact table anchor stays safe; a blanked or renamed anchor sets uncertainLayout', async (t) => {
  assert.equal((await hwp()).uncertainLayout, false);
  const cases: [string, (r: RecordView[]) => void][] = [
    ['anchor replaced by spaces', (r) => { const d = anchorText(r); for (let i = 0; i < 16; i += 2) d.writeUInt16LE(32, i); }],
    ['anchor control id xxxx', (r) => { anchorText(r).write('xxxx', 2, 'latin1'); }],
  ];
  for (const [name, patch] of cases) await t.test(name, async () => {
    const result = await hwp(patch);
    assert.equal(result.uncertainLayout, true);
    assert.match(result.sections[0].text, /만 19세 이상 39세 이하/);
  });
});

// ── 7. HWPX: manifest의 './' 경로는 같은 경로로 보고, 알 수 없는 spine 참조는 거부한다 ──────
const BODY = '청년 주거 지원사업의 신청 대상은 만 19세 이상 34세 이하이며 기준 중위소득 60% 이하를 충족해야 합니다.';
const hpf = (items: [string, string][], spine: string[]) => `<opf:package xmlns:opf="http://www.idpf.org/2007/opf"><opf:manifest>${items.map(([id, href]) => `<opf:item id="${id}" href="${href}"/>`).join('')}</opf:manifest><opf:spine>${spine.map((id) => `<opf:itemref idref="${id}"/>`).join('')}</opf:spine></opf:package>`;
const hwpx = (manifest: string, sections = ['Contents/section0.xml']) => extractHangul({ name: 'n.hwpx', mediaType: 'application/hwp+zip',
  data: zip({ 'Contents/content.hpf': manifest, 'Contents/header.xml': '<h/>', ...Object.fromEntries(sections.map((s) => [s, section([BODY])])) }) }, new AbortController().signal);

test('7: "./section0.xml" is the same path as "section0.xml"', async () => {
  for (const href of ['section0.xml', './section0.xml', './Contents/section0.xml', 'Contents/section0.xml']) {
    const r = await hwpx(hpf([['header', 'Contents/header.xml'], ['section0', href]], ['header', 'section0']));
    assert.equal(r.sections.length, 1, href);
  }
  // Normalizing must not skip the missing-section check.
  await assert.rejects(hwpx(hpf([['section0', './section0.xml'], ['section1', './section1.xml']], ['section0', 'section1'])), { code: 'invalid_hangul' });
});

test('7: an unknown spine idref is rejected instead of passing as an empty path', async () => {
  await assert.rejects(hwpx(hpf([['section0', 'Contents/section0.xml']], ['section0', 'missing-section'])), { code: 'invalid_hangul' });
});

// ── 체크리스트(3차 추가 지시): 공고에 없는 날짜·기한 당기기·종류별 정렬을 뺀다 ─────────
test('checklist 1: the match prompt no longer asks for invented "2~3 days before the deadline" dates', () => {
  assert.doesNotMatch(MATCH_SYSTEM, /여유 있게|2~3일 전/);
  assert.match(MATCH_SYSTEM, /due_date_iso: 그 일을 끝내야 하는 날짜\. 공고에 적힌 날짜만 쓰고, 공고에 없으면 null\./);
});

test('checklist 2: a document due after the application deadline (LH-style post-selection submission) keeps its date', () => {
  const a = analysis([row('신청 마감', '2026년 11월 30일', '2026-11-30', '2026년 11월 30일', true), row('당첨자 서류 제출', '2026년 12월 20일', '2026-12-20', '2026년 12월 20일')]);
  validateAnalysis(a, 1);
  settleApplication(a, [], new Date('2026-11-07T12:00:00+09:00'));
  assert.deepEqual([a.application_status, a.application_deadline_iso], ['open', '2026-11-30']);
  const m = structuredClone(metAll);
  m.checklist = [
    { id: 't1', title: '온라인 신청', detail: null, kind: 'apply', due_date_iso: '2026-11-30', document_id: null, priority: 'high' },
    { id: 't2', title: '당첨자 서류 제출', detail: null, kind: 'document', due_date_iso: '2026-12-20', document_id: null, priority: 'high' },
  ];
  const r = finalizeMatch(a, { q1: '예' }, m);
  assert.deepEqual(r.checklist.map((t) => [t.id, t.due_date_iso]), [['t1', '2026-11-30'], ['t2', '2026-12-20']]);
});

test('checklist 3: the model order is kept, not regrouped by kind (조기폐차: apply before the post-scrapping document)', () => {
  const a = analysis([]);
  settleApplication(a, []);
  const m = structuredClone(metAll);
  m.checklist = [
    { id: 't1', title: '온라인 신청', detail: null, kind: 'apply', due_date_iso: null, document_id: null, priority: 'high' },
    { id: 't2', title: '선정 결과 확인', detail: null, kind: 'schedule', due_date_iso: null, document_id: null, priority: 'normal' },
    { id: 't3', title: '선정 전에는 폐차하지 않기', detail: null, kind: 'verify', due_date_iso: null, document_id: null, priority: 'high' },
    { id: 't4', title: '말소등록증 받기(폐차 후)', detail: null, kind: 'document', due_date_iso: null, document_id: null, priority: 'high' },
  ];
  assert.deepEqual(finalizeMatch(a, { q1: '예' }, m).checklist.map((t) => t.id), ['t1', 't2', 't3', 't4']);
  // 화면(ProfileCheck)도 종류별로 다시 묶지 않고 같은 순서의 한 목록으로 보여 준다.
  const noop = () => {};
  const html = renderToStaticMarkup(createElement(ProfileCheck, {
    a, answers: { q1: '예' }, match: finalizeMatch(a, { q1: '예' }, m), extra: '', docKey: 'round3-order',
    onAnswers: noop, onExtra: noop, onMatch: noop, canRunAI: true,
  }));
  const at = (title: string) => html.indexOf(title);
  assert(at('온라인 신청') > 0 && at('온라인 신청') < at('선정 결과 확인') && at('선정 결과 확인') < at('선정 전에는 폐차하지 않기') && at('선정 전에는 폐차하지 않기') < at('말소등록증 받기(폐차 후)'));
  assert.doesNotMatch(html, /<h4[^>]*>(?:자격 확인|서류 준비|신청하기|기억할 일정)<\/h4>/);
});
