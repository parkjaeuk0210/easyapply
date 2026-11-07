import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AnalysisSchema, MatchSchema } from '../src/lib/schema';
import { finalizeMatch, validateAnalysis } from '../src/lib/server/validation';
import { AppError } from '../src/lib/server/errors';
import sample from './fixtures/samples/garam-analysis.json';

function fixture() {
  const analysis = AnalysisSchema.parse(structuredClone(sample.analysis));
  const criterion = analysis.eligibility[0];
  analysis.eligibility = [
    { ...criterion, id: 'c1', category: '거주지', kind: 'required', requirement: '서울시에 거주해야 해요.', detail: null, evidence: [{ page: 1, quote: '공고일 현재 서울시에 주민등록을 둔 자' }] },
    { ...criterion, id: 'c2', category: '소득', kind: 'required', requirement: '소득 기준을 충족해야 해요.', detail: null, evidence: [{ page: 1, quote: '기준 중위소득 100% 이하' }] },
  ];
  analysis.profile_questions = [
    { id: 'q1', label: '현재 거주 지역은 어디인가요?', input: 'select', options: ['서울시', '강원도', '잘 모르겠어요'], unit: null, help: null, criteria_ids: ['c1'] },
    { id: 'q2', label: '거주 기간은 얼마인가요?', input: 'text', options: [], unit: null, help: null, criteria_ids: ['c1'] },
    { id: 'q3', label: '월 소득은 얼마인가요?', input: 'text', options: [], unit: null, help: null, criteria_ids: ['c2'] },
  ];
  analysis.schedule = []; analysis.documents = []; analysis.how_to_apply = [];
  const match = MatchSchema.parse({
    overall: 'likely_eligible', overall_message: '모델의 종합 결과',
    criteria: [
      { criterion_id: 'c1', status: 'not_met', reason: '입력한 거주지는 강원도여서 서울시 거주 조건과 맞지 않아요.', how_to_check: null, failed_answer_ids: ['q1'] },
      { criterion_id: 'c2', status: 'met', reason: '입력한 소득은 기준 안에 있어요.', how_to_check: null, failed_answer_ids: [] },
    ],
    checklist: [
      { id: 't1', title: '서류 준비', detail: null, kind: 'document', due_date_iso: null, document_id: null, priority: 'high' },
      { id: 't2', title: '신청 제출', detail: null, kind: 'apply', due_date_iso: null, document_id: null, priority: 'high' },
    ],
    next_searches: [{ criterion_id: 'c1', advice: '입력한 강원도 거주 조건에 맞는 지원 공고를 찾아보세요.', query: '강원도 청년 주거 지원' }],
  });
  return { analysis, match, answers: { q1: '강원도', q3: '100만원' } };
}

test('an explicit disqualifying answer survives another missing related answer', () => {
  const { analysis, match, answers } = fixture();
  const result = finalizeMatch(analysis, answers, match);
  assert.equal(result.criteria[0].status, 'not_met');
  assert.deepEqual(result.criteria[0].failed_answer_ids, ['q1']);
  assert.equal(result.criteria[0].reason, match.criteria[0].reason);
  assert.equal(result.overall, 'likely_ineligible');
  assert.deepEqual(result.checklist, []);
  assert.deepEqual(result.next_searches, match.next_searches);
});

test('an unverified number always overrides failure provenance and its search advice', () => {
  const { analysis, match, answers } = fixture();
  // A quote that merely differs in layout ('c1' alone) keeps the failure; an unmatched number ('#n') does not.
  assert.equal(finalizeMatch(analysis, answers, match, ['c1']).criteria[0].status, 'not_met');
  const result = finalizeMatch(analysis, answers, match, ['c1', 'c1#n']);
  assert.equal(result.criteria[0].status, 'check');
  assert.deepEqual(result.criteria[0].failed_answer_ids, []);
  assert.equal(result.overall, 'needs_check');
  assert.deepEqual(result.next_searches, []);
});

test('missing or uncertain cited answers cannot establish a partial-answer failure', () => {
  for (const scenario of ['uncited', 'empty', 'unsure', 'partly-cited'] as const) {
    const { analysis, match, answers } = fixture();
    if (scenario === 'uncited') match.criteria[0].failed_answer_ids = [];
    if (scenario === 'empty') answers.q1 = '';
    if (scenario === 'unsure') answers.q1 = '잘 모르겠어요';
    if (scenario === 'partly-cited') match.criteria[0].failed_answer_ids = ['q1', 'q2'];
    const result = finalizeMatch(analysis, answers, match);
    assert.equal(result.criteria[0].status, 'check', scenario);
    assert.deepEqual(result.next_searches, [], scenario);
  }
});

test('met needs at least one real answer; failures without cited answers are no longer accepted', () => {
  const { analysis, match, answers } = fixture();
  match.criteria[0].status = 'met';
  assert.equal(finalizeMatch(analysis, answers, match).criteria[0].status, 'met');
  assert.equal(finalizeMatch(analysis, {}, match).criteria[0].status, 'check');
  match.criteria[0].status = 'not_met'; match.criteria[0].failed_answer_ids = [];
  assert.equal(finalizeMatch(analysis, { ...answers, q2: '2년' }, match).criteria[0].status, 'check');
});

test('foreign or unrelated failure references downgrade to check; duplicates are merged', () => {
  for (const refs of [['missing'], ['q3']]) {
    const { analysis, match, answers } = fixture();
    match.criteria[0].failed_answer_ids = refs;
    const result = finalizeMatch(analysis, answers, match);
    assert.equal(result.criteria[0].status, 'check', refs.join());
    assert.deepEqual(result.criteria[0].failed_answer_ids, []);
    assert.equal(result.overall, 'needs_check');
  }
  const { analysis, match, answers } = fixture();
  match.criteria[0].failed_answer_ids = ['q1', 'q1'];
  assert.deepEqual(finalizeMatch(analysis, answers, match).criteria[0].failed_answer_ids, ['q1']);
});

test('search suggestions follow final required and exclusion failures, never preferences or met criteria', () => {
  const { analysis, match, answers } = fixture();
  match.next_searches.push({ criterion_id: 'c2', advice: '소득 관련 검색', query: '소득 지원' });
  assert.deepEqual(finalizeMatch(analysis, answers, match).next_searches.map((s) => s.criterion_id), ['c1']);
  analysis.eligibility[0].kind = 'exclusion';
  assert.deepEqual(finalizeMatch(analysis, answers, match).next_searches.map((s) => s.criterion_id), ['c1']);
  analysis.eligibility[0].kind = 'preference';
  const preferred = finalizeMatch(analysis, answers, match);
  assert.equal(preferred.overall, 'likely_eligible');
  assert.deepEqual(preferred.next_searches, []);
});

test('foreign search references are dropped and only the first suggestion per condition is kept', () => {
  const { analysis, match, answers } = fixture();
  match.next_searches.push({ ...match.next_searches[0], query: '두 번째 검색어' });
  assert.deepEqual(finalizeMatch(analysis, answers, match).next_searches.map((s) => s.query), ['강원도 청년 주거 지원']);
  match.next_searches = [{ ...match.next_searches[0], criterion_id: 'missing' }];
  assert.deepEqual(finalizeMatch(analysis, answers, match).next_searches, []);
});

test('contact evidence obeys the same page bounds as other source citations', () => {
  const { analysis } = fixture();
  analysis.contact_evidence = [{ page: 3, quote: '문의처 1234-5678' }];
  assert.throws(() => validateAnalysis(analysis, 2), (error: AppError) => error.code === 'bad_output');
  analysis.contact_evidence[0].page = 1;
  assert.doesNotThrow(() => validateAnalysis(analysis, 2));
});
