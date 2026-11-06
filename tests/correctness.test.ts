import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crc32 } from 'node:zlib';
import { AnalysisSchema, MatchSchema, type Analysis } from '../src/lib/schema';
import { validateAnalysis, validateAnswers, finalizeMatch } from '../src/lib/server/validation';
import { verifyEvidence } from '../src/lib/server/uploads';
import { extractHangul } from '../src/lib/server/hangul';
import { buildIndex, locate, normalize } from '../src/lib/textmatch';
import { buildIcs, deadlineDays, deadlineEnd, deadlinePassed, mainDeadline, parseKoreanDates } from '../src/lib/dates';
import { ANALYZE_SYSTEM, MATCH_SYSTEM } from '../src/lib/prompts';
import sample from './fixtures/samples/garam-analysis.json';

// Reproductions from the 2026-11-06 deep review (aipipe t2/t3, codex reproduce.ts).
type Schedule = Analysis['schedule'][number];
type Criterion = Analysis['eligibility'][number];
const ev = (quote: string, page = 1) => ({ page, quote });

function base(): Analysis {
  return AnalysisSchema.parse({
    title: '2026년 청년 주거 지원 공고', organization: '청년정책과', category: '주거',
    one_line: '청년의 월세를 지원해요.', summary: ['자격과 접수 마감을 확인하세요.'],
    benefits: [], schedule: [], how_to_apply: [], documents: [], cautions: [], glossary: [],
    eligibility: [{ id: 'c1', category: '연령', kind: 'required', requirement: '만 19세 이상 34세 이하', detail: null, evidence: [ev('만 19세 이상 34세 이하')] }],
    profile_questions: [{ id: 'q1', label: '만 나이는 몇 세인가요?', input: 'number', options: [], unit: '세', help: null, criteria_ids: ['c1'] }],
    contact: null, contact_evidence: [], reading_notes: null, transcript: [],
  });
}
function entry(label: string, date_text: string, date_iso: string | null, extra: Partial<Schedule> = {}): Schedule {
  return { label, date_text, date_iso, time: null, is_deadline: false, is_application_deadline: false, deadline_inferred: false, date_uncertain: false, evidence: [ev(date_text)], ...extra };
}
function model(statuses: Record<string, 'met' | 'not_met' | 'check'>, failed: Record<string, string[]> = {}) {
  return MatchSchema.parse({
    overall: 'likely_eligible', overall_message: '모델 문장',
    criteria: Object.entries(statuses).map(([id, status]) => ({ criterion_id: id, status, reason: '모델 판정', how_to_check: null, failed_answer_ids: failed[id] ?? [] })),
    checklist: [], next_searches: [],
  });
}
const kst = (s: string) => new Date(`${s}+09:00`);

// ── B1 접수 마감 추정 ────────────────────────────────────────────
test('B1: a missing application flag no longer hides the closed Hwaseong period', () => {
  const a = base();
  a.schedule = [
    entry('모집 기간 (청년일경험 포털 온라인 접수)', '2026. 5. 8(금) ~ 5. 17(일) 자정', '2026-05-17', { is_deadline: true }),
    entry('서류 합격 발표 (개별 문자)', '2026. 5. 21(목) 14:00 예정', '2026-05-21', { time: '14:00' }),
    entry('ZOOM 화상 면접', '2026. 5. 22 (금) ~ 2026. 5. 28(목) 09:00~18:00', '2026-05-22'),
  ];
  validateAnalysis(a, 1);
  const inferred = a.schedule[0];
  assert.equal(inferred.is_application_deadline, true);
  assert.equal(inferred.deadline_inferred, true);
  assert.equal(inferred.time, '23:59');
  assert.equal(a.schedule.filter((s) => s.is_application_deadline).length, 1);
  assert.equal(a.schedule[2].date_iso, '2026-05-22', 'non-deadline ranges keep their start date');
  assert.equal(mainDeadline(a, '2026-11-06')?.label, inferred.label);
  const r = finalizeMatch(a, { q1: '25' }, model({ c1: 'met' }), [], kst('2026-11-06T12:00:00'));
  assert.equal(r.overall, 'needs_check');
  assert.match(r.overall_message, /마감일이 모두 지났/);
});

test('B1: bounded application schedules are inferred per round, follow-up stages are not', () => {
  const a = AnalysisSchema.parse(structuredClone(sample.analysis));
  validateAnalysis(a, 2);
  assert.deepEqual(a.schedule.filter((s) => s.is_application_deadline).map((s) => [s.label, s.date_iso, s.time, s.deadline_inferred]), [['신청 마감', '2026-12-04', '18:00', true]]);
  const b = base();
  b.schedule = [entry('선정자 서류 제출 마감', '2026. 12. 20.', '2026-12-20', { is_deadline: true }), entry('결과 발표', '2027. 1. 5.', '2027-01-05')];
  validateAnalysis(b, 1);
  assert(b.schedule.every((s) => !s.is_application_deadline && !s.deadline_inferred));
  const flagged = base();
  flagged.schedule = [entry('신청 접수 마감', '2026. 11. 30.', '2026-11-30', { is_deadline: true, is_application_deadline: true }), entry('추가 모집 기간', '2026. 12. 1. ~ 12. 10.', '2026-12-10')];
  validateAnalysis(flagged, 1);
  // An explicit first round must not hide a separately bounded later round.
  assert.deepEqual(flagged.schedule.map((s) => s.deadline_inferred), [false, true]);
  const r = finalizeMatch(flagged, { q1: '25' }, model({ c1: 'met' }), [], kst('2026-12-05T12:00:00'));
  assert.equal(r.overall, 'likely_eligible');
  assert.doesNotMatch(r.overall_message, /마감일이 모두 지났/);
});

// ── B2 date_iso ↔ 원문 대조 ──────────────────────────────────────
test('B2: an exact quote with a contradicting date_iso no longer yields likely_eligible or a calendar event', () => {
  const a = base();
  const quote = '접수 마감: 2026. 11. 06. 18:00';
  a.schedule = [entry('신청 접수 마감', quote, '2027-12-31', { time: '18:00', is_deadline: true, is_application_deadline: true })];
  validateAnalysis(a, 1);
  assert.equal(a.schedule[0].date_iso, null);
  assert.equal(a.schedule[0].date_uncertain, true);
  const v = verifyEvidence(a, buildIndex([{ page: 1, items: [`신청 자격은 만 19세 이상 34세 이하입니다. ${quote}`] }], 'pdf'));
  assert.equal(v.exact, 2);
  const r = finalizeMatch(a, { q1: '25' }, model({ c1: 'met' }), v.unverified_criteria, kst('2026-11-07T12:00:00'));
  assert.equal(r.overall, 'needs_check');
  assert.match(r.overall_message, /접수 마감일/);
  assert.doesNotMatch(buildIcs(a, r), /2027/);
  validateAnalysis(a, 1);
  assert.equal(a.schedule[0].date_uncertain, true, 'reconciliation is idempotent on the match route');
});

test('B2: range deadlines use the end date and midnight becomes 23:59 of that day', () => {
  const cases: [string, string, string | null, string, string][] = [
    ['2026. 5. 8(금) ~ 5. 17(일) 자정', '2026-05-08', null, '2026-05-17', '23:59'],
    ['2026. 5. 8(금) ~ 5. 17(일) 자정', '2026-05-17', '00:00', '2026-05-17', '23:59'],
    ['2026. 5. 8(금) ~ 5. 17(일) 자정', '2026-05-18', '00:00', '2026-05-17', '23:59'],
    ['2026. 5. 17.(일) 24:00까지', '2026-05-17', null, '2026-05-17', '23:59'],
    ['2026. 11. 16.(월) 10:00 ~ 2026. 12. 4.(금) 18:00', '2026-11-16', '10:00', '2026-12-04', '18:00'],
    ['2026년 5월 1일부터 5월 17일까지', '2026-05-01', null, '2026-05-17', '23:59:59'],
    ['5월 17일(일) 오후 6시', '2026-05-17', null, '2026-05-17', '18:00'],
    ["'26.5.17 18:00", '2026-05-17', null, '2026-05-17', '18:00'],
    ['’26. 5. 17', '2026-05-17', null, '2026-05-17', '23:59:59'],
    ['2026.05.17', '2026-05-17', null, '2026-05-17', '23:59:59'],
    ['2026. 12. 28.(월) ~ 1. 5.(화)', '2026-12-28', null, '2027-01-05', '23:59:59'],
  ];
  for (const [text, iso, time, want, wantTime] of cases) {
    const a = base();
    a.schedule = [entry('신청 접수 기간', text, iso, { time, is_deadline: true, is_application_deadline: true }), entry('공고', '2026. 4. 30.', '2026-04-30')];
    validateAnalysis(a, 1);
    const s = a.schedule[0];
    assert.equal(s.date_iso, want, text);
    assert.equal(s.date_uncertain, false, text);
    assert.equal(deadlineEnd(s)?.toISOString(), kst(`${want}T${wantTime.length === 5 ? `${wantTime}:00` : wantTime}`).toISOString(), text);
  }
});

test('B2: wrong weekday, guessed year and invented days become uncertain', () => {
  const cases: [string, string][] = [
    ['2026. 5. 17.(토)', '2026-05-17'], // 2026-05-17 is a Sunday
    ['5. 17(일)', '2027-05-17'], // year guessed from today: weekday disagrees
    ['5월 17일', '2027-05-17'], // no weekday and 2027 never appears in the notice
    ['2026. 12. ~ 2027. 11. (12개월)', '2026-12-01'], // the day was invented
    ['접수 마감일 자정', '2026-05-17'], // no date in the text or quote
  ];
  for (const [text, iso] of cases) {
    const a = base();
    a.schedule = [entry('신청 마감', text, iso, { is_deadline: true, is_application_deadline: true }), entry('공고', '2026. 4. 30.(목)', '2026-04-30')];
    validateAnalysis(a, 1);
    assert.equal(a.schedule[0].date_iso, null, text);
    assert.equal(a.schedule[0].date_uncertain, true, text);
  }
  const ok = base();
  ok.schedule = [entry('신청 마감', '5월 17일', '2026-05-17', { is_deadline: true, is_application_deadline: true }), entry('공고', '2026. 4. 30.(목)', '2026-04-30')];
  validateAnalysis(ok, 1);
  assert.equal(ok.schedule[0].date_iso, '2026-05-17');
  // No year anywhere, but the written weekday pins the date near this year.
  const weekday = base();
  weekday.title = '청년 주거 지원 공고';
  weekday.schedule = [entry('신청 마감', '11. 30.(월) 18:00', '2026-11-30', { is_deadline: true, is_application_deadline: true })];
  validateAnalysis(weekday, 1);
  assert.equal(weekday.schedule[0].date_iso, '2026-11-30');
  assert.equal(parseKoreanDates('2026. 6. 4(목) 8시간 교육')[0].time, null, '8시간 is a duration, not 08:00');
});

test('B2: the Korean date parser reads the notice formats', () => {
  const one = (s: string) => parseKoreanDates(s).map((m) => [m.year, m.month, m.day, m.weekday, m.time, m.rangeEnd && [m.rangeEnd.year, m.rangeEnd.month, m.rangeEnd.day, m.rangeEnd.time]]);
  assert.deepEqual(one('2026. 5. 8(금) ~ 5. 17(일) 자정')[0], [2026, 5, 8, 5, null, [2026, 5, 17, '23:59']]);
  assert.deepEqual(one('2026. 6. 1(월)~2(화)')[0], [2026, 6, 1, 1, null, [2026, 6, 2, null]]);
  assert.deepEqual(one('2026년 5월 17일 (일요일) 오전 9시 30분')[0], [2026, 5, 17, 0, '09:30', null]);
  assert.deepEqual(one('5. 17. 18:00 도착분')[0], [null, 5, 17, null, '18:00', null]);
  for (const noise of ['기준 중위소득 60% 1,538,543', '전월세전환율 5.5%', '2026. 12.', '033-250-1234', '(12개월)']) {
    assert.deepEqual(parseKoreanDates(noise), [], noise);
  }
});

test('B2: the real Garam and Hwaseong schedules stay intact', () => {
  const a = AnalysisSchema.parse(structuredClone(sample.analysis));
  const before = a.schedule.map((s) => s.date_iso);
  validateAnalysis(a, 2);
  assert.deepEqual(a.schedule.map((s) => s.date_iso), before);
  assert(a.schedule.every((s) => !s.date_uncertain));
  const h = base();
  h.schedule = [
    entry('선수교육 (합격자 전원, 온라인)', '2026. 5. 29(금) ~ 5. 31(일)', '2026-05-29'),
    entry('사전직무교육', '2026. 6. 1(월)~2(화) / 09:00~18:00(월), 09:00~17:00(화)', '2026-06-01', { time: '09:00' }),
    entry('최종 합격 발표', '2026. 5. 29(금) 10:00 예정', '2026-05-29', { time: '10:00' }),
  ];
  validateAnalysis(h, 1);
  assert.deepEqual(h.schedule.map((s) => [s.date_iso, s.time, s.date_uncertain]), [['2026-05-29', null, false], ['2026-06-01', '09:00', false], ['2026-05-29', '10:00', false]]);
});

// ── B3 마감 시각 통일 ───────────────────────────────────────────
test('B3: a stated deadline time is not extended by 59 seconds and D-day respects it', () => {
  const s = entry('신청 접수 마감', '2026. 11. 06. 18:00 마감', '2026-11-06', { time: '18:00', is_deadline: true, is_application_deadline: true });
  assert.equal(deadlinePassed(s, kst('2026-11-06T18:00:00')), false);
  assert.equal(deadlinePassed(s, kst('2026-11-06T18:00:30')), true);
  const dateOnly = { ...s, time: null };
  assert.equal(deadlinePassed(dateOnly, kst('2026-11-06T23:59:00')), false);
  assert.equal(deadlinePassed(dateOnly, kst('2026-11-07T00:00:01')), true);
  const a = base(); a.schedule = [s];
  const r = finalizeMatch(a, { q1: '25' }, model({ c1: 'met' }), [], kst('2026-11-06T18:00:30'));
  assert.equal(r.overall, 'needs_check');
  assert.equal(deadlineDays(s, kst('2026-11-06T17:00:00')), 0);
  assert.equal(deadlineDays(s, kst('2026-11-06T21:00:00')), -1);
  a.schedule.push({ ...s, date_iso: '2026-11-20', date_text: '2026. 11. 20. 18:00' });
  assert.equal(mainDeadline(a, '2026-11-06', kst('2026-11-06T19:00:00'))?.date_iso, '2026-11-20');
});

test('B3: application and document tasks are pulled back to the application deadline', () => {
  const a = base();
  a.schedule = [entry('신청 접수 마감', '2026. 11. 06. 18:00', '2026-11-06', { time: '18:00', is_deadline: true, is_application_deadline: true })];
  const m = model({ c1: 'met' });
  m.checklist = [
    { id: 't1', title: '신청서 제출', detail: null, kind: 'apply', due_date_iso: '2026-12-31', document_id: null, priority: 'high' },
    { id: 't2', title: '결과 발표 확인', detail: null, kind: 'schedule', due_date_iso: '2026-12-31', document_id: null, priority: 'normal' },
  ];
  const r = finalizeMatch(a, { q1: '25' }, m, [], kst('2026-11-05T12:00:00'));
  assert.equal(r.checklist.find((t) => t.id === 't1')?.due_date_iso, '2026-11-06');
  assert.equal(r.checklist.find((t) => t.id === 't2')?.due_date_iso, '2026-12-31');
});

// ── B4 관대한 입력, 보수적 결론 ────────────────────────────────
function many(n: number) {
  const a = base();
  a.eligibility = Array.from({ length: n }, (_, i) => ({ id: `c${i + 1}`, category: '자격', kind: 'required' as const, requirement: `조건 ${i + 1}`, detail: null, applies_to: null, evidence: [ev(`조건 ${i + 1}`)] }));
  a.profile_questions = [{ id: 'q1', label: '해당하나요?', input: 'yes_no', options: [], unit: null, help: null, criteria_ids: a.eligibility.map((c) => c.id) }];
  return a;
}

test('B4: 9 of 10 criteria, unknown ids and duplicate searches no longer fail the whole request', () => {
  const a = many(10);
  const m = model(Object.fromEntries(a.eligibility.slice(0, 9).map((c) => [c.id, 'met'])));
  m.criteria.push({ criterion_id: 'c99', status: 'not_met', reason: '없는 조건', how_to_check: null, failed_answer_ids: ['q1'] });
  const r = finalizeMatch(a, { q1: '예' }, m);
  assert.deepEqual(r.criteria.map((c) => c.criterion_id), a.eligibility.map((c) => c.id));
  assert.equal(r.criteria[9].status, 'check');
  assert.equal(r.overall, 'needs_check');
  const f = model({ ...Object.fromEntries(a.eligibility.map((c) => [c.id, 'met'])), c1: 'not_met' }, { c1: ['q1'] });
  f.next_searches = [
    { criterion_id: 'c1', advice: '첫 제안', query: '첫 검색어' },
    { criterion_id: 'c1', advice: '두 번째 제안', query: '두 번째 검색어' },
    { criterion_id: 'c42', advice: '없는 조건', query: '없는 검색어' },
  ];
  const failed = finalizeMatch(a, { q1: '아니오' }, f);
  assert.equal(failed.overall, 'likely_ineligible');
  assert.deepEqual(failed.next_searches.map((s) => s.query), ['첫 검색어']);
});

test('B4: invalid or missing failure evidence becomes check instead of a confirmed failure', () => {
  const a = many(2);
  a.profile_questions.push({ id: 'q2', label: '다른 질문', input: 'yes_no', options: [], unit: null, help: null, criteria_ids: ['c2'] });
  for (const failedIds of [['q2'], ['missing'], []]) {
    const r = finalizeMatch(a, { q1: '아니오', q2: '예' }, model({ c1: 'not_met', c2: 'met' }, { c1: failedIds }));
    assert.equal(r.criteria[0].status, 'check', JSON.stringify(failedIds));
    assert.deepEqual(r.criteria[0].failed_answer_ids, []);
    assert.notEqual(r.overall, 'likely_ineligible');
  }
});

test('B4: an unanswered exception keeps a failure at check', () => {
  const a = base();
  a.eligibility[0].detail = '군 복무 기간만큼 상한 연령을 최대 3년 연장합니다.';
  a.profile_questions.push({ id: 'q2', label: '군 복무 기간은 몇 년인가요?', input: 'number', options: [], unit: '년', help: null, criteria_ids: ['c1'] });
  const r = finalizeMatch(a, { q1: '35' }, model({ c1: 'not_met' }, { c1: ['q1'] }));
  assert.equal(r.criteria[0].status, 'check');
  assert.equal(r.overall, 'needs_check');
  assert.equal(finalizeMatch(a, { q1: '35', q2: '0' }, model({ c1: 'not_met' }, { c1: ['q1'] })).criteria[0].status, 'not_met');
});

test('B4: free-text unknown answers are uncertain and impossible answers are rejected', () => {
  const a = base(); a.profile_questions[0].input = 'text';
  for (const unknown of ['모름', '몰라요', '잘 모르겠어요', '확인 필요', '잘모름']) {
    const answers = validateAnswers(a, { q1: unknown });
    assert.equal(finalizeMatch(a, answers, model({ c1: 'met' })).overall, 'needs_check', unknown);
  }
  const d = base(); d.profile_questions[0] = { ...d.profile_questions[0], label: '생년월일이 언제예요?', input: 'date', unit: null };
  for (const bad of ['2031-01-01', '1800-01-01']) assert.throws(() => validateAnswers(d, { q1: bad }), bad);
  assert.doesNotThrow(() => validateAnswers(d, { q1: '1999-03-15' }));
  const n = base();
  // Generic numeric validation cannot infer a domain's lower bound from its input type.
  n.profile_questions[0].label = '지난해 영업이익(만원)';
  assert.deepEqual(validateAnswers(n, { q1: '-100' }), { q1: '-100' });
  assert.doesNotThrow(() => validateAnswers(n, { q1: '0.5' }));
});

test('B4: choosing "해당 없음" for exclusions cannot be cited as falling into one (review S3)', () => {
  const a = many(2);
  a.eligibility[1].kind = 'exclusion';
  a.profile_questions.push({ id: 'q5', label: '해당하는 것을 모두 골라 주세요.', input: 'multi', options: ['대한민국 국적이 없어요', '해당 없음'], unit: null, help: null, criteria_ids: ['c2'] });
  const r = finalizeMatch(a, { q1: '예', q5: '해당 없음' }, model({ c1: 'met', c2: 'not_met' }, { c2: ['q5'] }));
  assert.equal(r.criteria[1].status, 'check');
  assert.equal(r.overall, 'needs_check');
  assert.equal(finalizeMatch(a, { q1: '예', q5: '대한민국 국적이 없어요' }, model({ c1: 'met', c2: 'not_met' }, { c2: ['q5'] })).overall, 'likely_ineligible');
});

// ── B5 서버의 만 나이 계산 ──────────────────────────────────────
function ageAnalysis(quote: string, detail: string | null = null) {
  const a = base();
  a.eligibility = [{ id: 'c1', category: '연령', kind: 'required', requirement: '나이 조건을 충족해야 해요.', detail, applies_to: null, evidence: [ev(quote)] }];
  a.profile_questions = [{ id: 'q1', label: '생년월일이 언제인가요?', input: 'date', options: [], unit: null, help: null, criteria_ids: ['c1'] }];
  a.schedule = [entry('신청 접수 마감', '2026. 12. 4.(금) 18:00', '2026-12-04', { time: '18:00', is_deadline: true, is_application_deadline: true })];
  return a;
}
const NOW = kst('2026-11-07T12:00:00');

test('B5: the server computes full age when the model contradicts it', () => {
  const a = ageAnalysis('만 18세 이상 ~ 34세 이하 미취업 청년');
  const old = finalizeMatch(a, { q1: '1985-03-01' }, model({ c1: 'met' }), [], NOW);
  assert.equal(old.criteria[0].status, 'not_met');
  assert.deepEqual(old.criteria[0].failed_answer_ids, ['q1']);
  assert.match(old.criteria[0].reason, /생년월일 기준 만 41세/);
  assert.equal(old.overall, 'likely_ineligible');
  const young = finalizeMatch(a, { q1: '1999-03-15' }, model({ c1: 'not_met' }, { c1: ['q1'] }), [], NOW);
  // A passing age calculation cannot prove the other parts of a composite criterion.
  assert.equal(young.criteria[0].status, 'not_met');
  assert.equal(young.criteria[0].reason, '모델 판정');
  const agreeing = finalizeMatch(a, { q1: '1985-03-01' }, model({ c1: 'not_met' }), [], NOW);
  assert.equal(agreeing.criteria[0].status, 'not_met', 'an agreeing server result supplies the missing evidence');
});

test('B5: extensions, borderline base dates and birth-date ranges never produce a server failure', () => {
  const ext = ageAnalysis('만 18세 이상 ~ 34세 이하 미취업 청년', '군필자는 의무복무기간에 비례하여 연장해요(최고 만 39세).');
  assert.equal(finalizeMatch(ext, { q1: '1990-06-01' }, model({ c1: 'met' }), [], NOW).criteria[0].status, 'check');
  const edge = ageAnalysis('만 19세 이상 만 34세 이하');
  // 1991-11-20: 34 today, 35 at the 12-04 deadline.
  assert.equal(finalizeMatch(edge, { q1: '1991-11-20' }, model({ c1: 'met' }), [], NOW).criteria[0].status, 'check');
  const range = ageAnalysis('만 19세 이상 ~ 만 34세 이하 청년 (1991. 11. 7. ~ 2007. 11. 6. 출생)');
  assert.equal(finalizeMatch(range, { q1: '1991-11-07' }, model({ c1: 'met' }), [], NOW).criteria[0].status, 'met');
  const explicit = ageAnalysis('2026. 1. 1. 기준 만 19세 이상 34세 이하');
  const r = finalizeMatch(explicit, { q1: '1991-06-01' }, model({ c1: 'met' }), [], NOW);
  assert.equal(r.criteria[0].status, 'met', 'aged 34 on the stated base date');
  const none = ageAnalysis('청년 누구나');
  assert.equal(finalizeMatch(none, { q1: '1950-01-01' }, model({ c1: 'met' }), [], NOW).criteria[0].status, 'met');
});

// ── B6 HWPX ─────────────────────────────────────────────────────
function zip(entries: Record<string, string>, corrupt?: string) {
  const local: Buffer[] = [], directory: Buffer[] = [];
  let offset = 0;
  for (const [pathname, content] of Object.entries(entries)) {
    const name = Buffer.from(pathname), data = Buffer.from(content), sum = crc32(data);
    if (pathname === corrupt) data.write('9', data.indexOf('6'));
    const header = Buffer.alloc(30), central = Buffer.alloc(46);
    header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(20, 4);
    header.writeUInt32LE(sum, 14); header.writeUInt32LE(data.length, 18); header.writeUInt32LE(data.length, 22); header.writeUInt16LE(name.length, 26);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
    central.writeUInt32LE(sum, 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(name.length, 28); central.writeUInt32LE(offset, 42);
    local.push(header, name, data); directory.push(central, name); offset += header.length + name.length + data.length;
  }
  const central = Buffer.concat(directory), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(entries).length, 8); end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(central.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, central, end]);
}
const section = (text: string) => `<?xml version="1.0"?><hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph"><hp:p><hp:run><hp:t>${text}</hp:t></hp:run></hp:p></hs:sec>`;
const BODY = '청년 주거 지원사업의 신청 대상은 만 19세 이상 34세 이하이며 기준 중위소득 60% 이하를 충족해야 합니다.';
const hpf = (ids: string[], prefix = 'Contents/') => `<opf:package xmlns:opf="http://www.idpf.org/2007/opf"><opf:manifest><opf:item id="header" href="${prefix}header.xml"/>${ids.map((id) => `<opf:item id="${id}" href="${prefix}${id}.xml"/>`).join('')}</opf:manifest><opf:spine><opf:itemref idref="header"/>${ids.map((id) => `<opf:itemref idref="${id}"/>`).join('')}</opf:spine></opf:package>`;
const hwpx = (data: Buffer) => extractHangul({ name: 'notice.hwpx', mediaType: 'application/hwp+zip', data }, new AbortController().signal);

test('B6: every HWPX image keeps source verification on hold', async () => {
  const r = await hwpx(zip({ 'Contents/section0.xml': section(BODY), 'BinData/image1.png': 'logo' }));
  assert.equal(r.uncertainLayout, true);
  assert.match(r.warning, /이미지·도형의 글자는 추출하지 않았/);
});

test('B6: CRC mismatches and sections missing from the manifest spine are rejected', async () => {
  await assert.rejects(hwpx(zip({ 'Contents/section0.xml': section(BODY) }, 'Contents/section0.xml')), { code: 'invalid_hangul' });
  const missing = zip({ 'Contents/content.hpf': hpf(['section0', 'section1', 'section2']), 'Contents/header.xml': '<h/>', 'Contents/section0.xml': section(BODY), 'Contents/section2.xml': section(BODY) });
  await assert.rejects(hwpx(missing), { code: 'invalid_hangul' });
  for (const prefix of ['Contents/', '']) {
    const complete = zip({ 'Contents/content.hpf': hpf(['section0', 'section1'], prefix), 'Contents/header.xml': '<h/>', 'Contents/section0.xml': section(BODY), 'Contents/section1.xml': section(BODY) });
    assert.equal((await hwpx(complete)).sections.length, 2, prefix || 'relative href');
  }
});

// ── B7 인용 정규화 ──────────────────────────────────────────────
test('B7: punctuation variants, invisible characters and bullets normalize away', () => {
  const same: [string, string][] = [
    ['대학생ᆞ대학원생', '대학생·대학원생'],
    ['대학생⋅대학원생', '대학생·대학원생'],
    ['2026‐001', '2026-001'],
    ['2026‑001', '2026-001'],
    ['2026‒001', '2026-001'],
    ['피­보험자', '피보험자'],
    ['피​보‌험‍자', '피보험자'],
    [' 신청 자격', '○ 신청 자격'],
    ['■ 제출 서류', '□ 제출 서류'],
    ['● 문의 ▪ 안내 ◦ 기타 ▫', '문의 안내 기타'],
    ['「월세 지원」', "'월세 지원'"],
    ['『청년 기본법』', '"청년 기본법"'],
  ];
  for (const [raw, quote] of same) assert.equal(normalize(raw), normalize(quote), raw);
  assert.notEqual(normalize('① 2회 이상 중도 이탈한 자'), normalize('12회 이상 중도 이탈한 자'));
  const index = buildIndex([{ page: 1, items: ['단순 변심으로 청년 일경험 지원사업에 참여하여 ① 2회 이상 중도 이탈한 자'] }], 'pdf');
  assert.notEqual(locate(index, 1, '12회 이상 중도 이탈한 자').status, 'exact');
  assert.equal(locate(index, 1, '① 2회 이상 중도 이탈한 자').status, 'exact');
});

test('B7: decomposed Hangul highlights the matched words, not neighbouring syllables', () => {
  const raw = '신청 대상은 청년이며 지역 거주 요건을 충족해야 합니다.'.normalize('NFD');
  const found = locate(buildIndex([{ page: 1, items: [raw] }], 'pdf'), 1, '청년');
  assert.equal(found.status, 'exact');
  assert.equal(raw.slice(...found.ranges[0]).normalize('NFC'), '청년');
  const second = locate(buildIndex([{ page: 1, items: [raw] }], 'pdf'), 1, '지역 거주 요건');
  assert.equal(raw.slice(...second.ranges[0]).normalize('NFC'), '지역 거주 요건');
});

test('B7: the server accepts a neighbouring page and reports the corrected page', () => {
  const a = base();
  a.eligibility[0].evidence = [ev('만 19세 이상 34세 이하', 2)];
  const index = buildIndex([
    { page: 1, items: ['제출 서류는 주민등록등본과 임대차계약서 사본입니다.'] },
    { page: 2, items: ['문의는 청년정책과로 해 주세요. 전화 상담도 가능합니다.'] },
    { page: 3, items: ['신청 자격은 만 19세 이상 34세 이하이며 지원금은 월 20만원입니다.'] },
  ], 'pdf');
  const v = verifyEvidence(a, index);
  assert.deepEqual(v.unverified_criteria, []);
  assert.deepEqual(v.page_corrections, [{ page: 2, found_page: 3, quote: '만 19세 이상 34세 이하' }]);
  a.eligibility[0].evidence = [ev('만 19세 이상 34세 이하', 1)];
  assert.deepEqual(verifyEvidence(a, index).unverified_criteria, ['c1'], 'two pages away is still missing');
});

// ── B8 프롬프트·조건부 요건 ─────────────────────────────────────
test('B8: prompts carry the deadline, range, midnight, duplication, search and applies_to rules', () => {
  assert.match(ANALYZE_SYSTEM, /반드시 is_application_deadline=true/);
  assert.match(ANALYZE_SYSTEM, /끝 날짜/);
  assert.match(ANALYZE_SYSTEM, /23:59/);
  assert.match(ANALYZE_SYSTEM, /뒤집어 제외 조건/);
  assert.match(ANALYZE_SYSTEM, /applies_to/);
  assert.match(MATCH_SYSTEM, /조건당 1개/);
});

test('B8: a failure of a condition that applies only to some applicants stays at check', () => {
  const a = many(2);
  (a.eligibility[1] as Criterion).applies_to = '제약기업 지원자';
  const r = finalizeMatch(a, { q1: '아니오' }, model({ c1: 'met', c2: 'not_met' }, { c2: ['q1'] }));
  assert.equal(r.criteria[1].status, 'check');
  assert.match(r.criteria[1].reason, /제약기업 지원자/);
  assert.equal(r.overall, 'needs_check');
  assert.equal(AnalysisSchema.parse(structuredClone(sample.analysis)).eligibility[0].applies_to, null);
});

test('review 1: passing age never overwrites a failed residence answer in the same criterion', () => {
  const a = ageAnalysis('2026-11-07 기준 만 19~34세이며 서울시 거주자');
  a.profile_questions.push({ id: 'q2', label: '서울시에 거주하나요?', input: 'yes_no', options: [], unit: null, help: null, criteria_ids: ['c1'] });
  validateAnalysis(a, 1);
  const m = model({ c1: 'not_met' }, { c1: ['q2'] });
  m.criteria[0].reason = '서울 거주 질문에 아니오라고 답했어요.';
  const r = finalizeMatch(a, validateAnswers(a, { q1: '2000-01-01', q2: '아니오' }), m, [], NOW);
  assert.equal(r.overall, 'likely_ineligible');
  assert.equal(r.criteria[0].status, 'not_met');
  assert.deepEqual(r.criteria[0].failed_answer_ids, ['q2']);
  assert.equal(r.criteria[0].reason, m.criteria[0].reason);
});

test('review 3: open-ended recruitment and start-only dates never infer an application deadline', () => {
  for (const text of ['2026. 1. 1.부터 상시 모집 (예산 소진 시까지)', '2026. 1. 1.부터 수시 모집', '2026. 1. 1.부터 예산 소진 시까지', '2026. 1. 1.부터', '2026. 1. 1. 시작']) {
    const a = base();
    a.schedule = [entry('신청 기간', text, '2026-01-01')];
    const m = model({ c1: 'met' });
    m.checklist = [{ id: 't1', title: '신청', kind: 'apply', detail: null, due_date_iso: null, document_id: null, priority: 'high' }];
    validateAnalysis(a, 1);
    validateAnalysis(a, 1);
    assert.equal(a.schedule[0].deadline_inferred, false, text);
    assert.equal(a.schedule[0].is_application_deadline, false, text);
    const r = finalizeMatch(a, { q1: '25' }, m, [], NOW);
    assert.doesNotMatch(r.overall_message, /마감일이 모두 지났/, text);
    assert(r.checklist.some((t) => t.kind === 'apply'), text);
  }
});

test('review 3: an expired first round cannot close an ongoing or unknown second round', () => {
  for (const second of [entry('2차 상시 모집', '상시 모집', null), entry('2차 모집 기간', '2026. 11. 30.까지', '2026-11-30'), entry('2차 신청 기간', '2026. 11. 1.부터', '2026-11-01')]) {
    const a = base();
    a.schedule = [entry('1차 모집 마감', '2026. 5. 31. 종료', '2026-05-31', { is_deadline: true, is_application_deadline: true }), second];
    const m = model({ c1: 'met' });
    m.checklist = [{ id: 't1', title: '신청', kind: 'apply', detail: null, due_date_iso: '2026-11-30', document_id: null, priority: 'high' }];
    validateAnalysis(a, 1);
    const r = finalizeMatch(a, { q1: '25' }, m, [], NOW);
    assert.doesNotMatch(r.overall_message, /마감일이 모두 지났/);
    assert(!r.checklist.some((t) => t.id === 'verify_reopening'));
    assert.equal(r.checklist.find((t) => t.kind === 'apply')?.due_date_iso, '2026-11-30');
    assert.equal(r.overall, second.date_iso === '2026-11-30' ? 'likely_eligible' : 'needs_check');
  }
  const ended = base();
  ended.schedule = [entry('1차 모집 마감', '2026. 5. 31. 종료', '2026-05-31', { is_deadline: true, is_application_deadline: true }), entry('2차 모집 기간', '2026. 6. 30.까지', '2026-06-30')];
  validateAnalysis(ended, 1);
  assert.match(finalizeMatch(ended, { q1: '25' }, model({ c1: 'met' }), [], NOW).overall_message, /마감일이 모두 지났/);
});

test('review 4: only identical criterion duplicates merge; differing status or evidence stays check in either order', () => {
  const a = base();
  a.eligibility[0].requirement = '서울시 거주자';
  a.profile_questions[0] = { ...a.profile_questions[0], label: '서울 거주', input: 'yes_no', unit: null };
  const m = model({ c1: 'met' });
  const met = m.criteria[0];
  const conflicts = [
    { ...met, status: 'not_met' as const, reason: '서울 비거주', failed_answer_ids: ['q1'] },
    { ...met, reason: '다른 근거' },
    { ...met, failed_answer_ids: ['q1'] },
    { ...met, how_to_check: '담당 기관 확인' },
  ];
  for (const conflict of conflicts) for (const criteria of [[met, conflict], [conflict, met], [met, conflict, met]]) {
    const r = finalizeMatch(a, { q1: '아니오' }, { ...m, criteria }, [], NOW);
    assert.equal(r.overall, 'needs_check');
    assert.equal(r.criteria.length, 1);
    assert.equal(r.criteria[0].status, 'check');
    assert.deepEqual(r.criteria[0].failed_answer_ids, []);
  }
  const r = finalizeMatch(a, { q1: '예' }, { ...m, criteria: [met, structuredClone(met)] }, [], NOW);
  assert.equal(r.criteria.length, 1);
  assert.equal(r.overall, 'likely_eligible');
});


test('review 2: missing citations cannot become met even without a supplied verification list', () => {
  for (const evidence of [[], [ev('')], [ev('   ')]]) {
    const a = base(); a.eligibility[0].evidence = evidence;
    validateAnalysis(a, 1);
    const r = finalizeMatch(a, { q1: '25' }, model({ c1: 'met' }), [], NOW);
    assert.equal(r.criteria[0].status, 'check');
    assert.equal(r.overall, 'needs_check');
  }
});

test('review 3: multiple round ends in one schedule entry cannot be closed using only the first end', () => {
  const a = base();
  a.schedule = [entry('신청 기간', '1차 2026. 5. 1. ~ 5. 31. / 2차 2026. 11. 1. ~ 11. 30.', '2026-05-31', { is_deadline: true, is_application_deadline: true })];
  validateAnalysis(a, 1);
  assert.equal(a.schedule[0].date_iso, null);
  const r = finalizeMatch(a, { q1: '25' }, model({ c1: 'met' }), [], NOW);
  assert.equal(r.overall, 'needs_check');
  assert.doesNotMatch(r.overall_message, /마감일이 모두 지났/);
});
