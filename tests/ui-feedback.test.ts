import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ProfileCheck from '../src/components/ProfileCheck';
import { OverviewPanel, GlossaryPanel } from '../src/components/AnalysisPanels';
import { AnalysisSchema, MatchSchema, type Answers } from '../src/lib/schema';
import { finalizeMatch } from '../src/lib/server/validation';

function analysis() {
  return AnalysisSchema.parse({
    title: '청년 주거 지원 공고', organization: '청년정책과', category: '주거',
    one_line: '신청 조건과 제출 절차를 확인하세요.', summary: ['신청 조건을 먼저 확인하세요.'],
    benefits: [], schedule: [], how_to_apply: [], documents: [], cautions: [], glossary: [],
    eligibility: [
      { id: 'income', category: '소득', kind: 'required', requirement: '기준 중위소득 100% 이하', detail: null, evidence: [{ page: 1, quote: '기준 중위소득 100% 이하' }] },
      { id: 'housing', category: '주택', kind: 'required', requirement: '무주택자', detail: null, evidence: [{ page: 1, quote: '무주택자' }] },
      { id: 'preference', category: '우대', kind: 'preference', requirement: '지역 5년 이상 거주자 우대', detail: null, evidence: [{ page: 1, quote: '지역 5년 이상 거주자 우대' }] },
    ],
    profile_questions: [
      { id: 'q_income', label: '기준 중위소득 비율', input: 'number', options: [], unit: '%', help: null, criteria_ids: ['income'] },
      { id: 'q_housing', label: '무주택자인가요?', input: 'yes_no', options: [], unit: null, help: null, criteria_ids: ['housing'] },
      { id: 'q_preference', label: '지역에 5년 이상 거주했나요?', input: 'yes_no', options: [], unit: null, help: null, criteria_ids: ['preference'] },
    ],
    contact: '청년정책과 033-250-1234 / youth@example.go.kr',
    contact_evidence: [{ page: 1, quote: '청년정책과 033-250-1234' }],
    reading_notes: '제출 전에 원문을 확인하세요.', transcript: [],
  });
}

const noop = () => {};
const textOf = (html: string) => html.replace(/<[^>]*>/g, '');

test('feedback keeps a definite 120% income failure separate from an unknown condition and preference', () => {
  const a = analysis();
  const answers: Answers = { q_income: '120', q_housing: '잘 모르겠어요', q_preference: '아니오' };
  const modelMatch = MatchSchema.parse({
    overall: 'likely_eligible', overall_message: '모델의 잠정 결과',
    criteria: [
      { criterion_id: 'preference', status: 'not_met', reason: '우대 거주 기간에 해당하지 않아요.', how_to_check: null, failed_answer_ids: ['q_preference'] },
      { criterion_id: 'income', status: 'not_met', reason: '입력한 120%는 공고의 100% 상한을 넘어요.', how_to_check: null, failed_answer_ids: ['q_income'] },
      { criterion_id: 'housing', status: 'met', reason: '추가 확인 전 결과', how_to_check: null },
    ],
    next_searches: [
      { criterion_id: 'income', advice: '소득 상한이 더 높은 공고를 찾아보세요.', query: '중위소득 120% 청년 주거 지원' },
      { criterion_id: 'housing', advice: '노출되면 안 되는 미확인 조건 추천', query: 'UNCONFIRMED_QUERY' },
      { criterion_id: 'preference', advice: '노출되면 안 되는 우대 조건 추천', query: 'PREFERENCE_QUERY' },
    ],
    checklist: [{ id: 'apply', title: '지원 신청서를 제출하세요', detail: null, kind: 'apply', due_date_iso: null, document_id: null, priority: 'high' }],
  });
  const match = finalizeMatch(a, answers, modelMatch);
  const html = renderToStaticMarkup(createElement(ProfileCheck, {
    a, answers, match, extra: '추가 메모: 다음 달 이사 예정', docKey: 'feedback-fixture',
    onAnswers: noop, onExtra: noop, onMatch: noop, canRunAI: true,
  }));
  const text = textOf(html);
  assert.match(text, /기준 중위소득 100% 이하/);
  assert.match(text, /내 답변: 기준 중위소득 비율\s*120\s*%/);
  assert.equal(text.match(/미충족/g)?.length, 1);
  assert.equal(text.match(/확인 필요/g)?.length, 1);
  assert.match(text, /우대 대상 아님/);
  assert.match(text, /최종 자격은 기관 심사로 정해져요/);
  assert(text.indexOf('기준 중위소득 100% 이하') < text.indexOf('지역 5년 이상 거주자 우대'));
  assert(text.indexOf('무주택자') < text.indexOf('지역 5년 이상 거주자 우대'));
  assert.match(text, /중위소득 120% 청년 주거 지원/);
  assert.match(text, /추가 메모: 다음 달 이사 예정/);
  assert.doesNotMatch(text, /UNCONFIRMED_QUERY|PREFERENCE_QUERY|지원 신청서를 제출하세요/);
});

test('the post-analysis form retains the supplied memo and offers a non-submit overview action', () => {
  const memo = '춘천 거주, 중위소득 120% — 다음 달 이사 예정';
  const html = renderToStaticMarkup(createElement(ProfileCheck, {
    a: analysis(), answers: {}, match: null, extra: memo, docKey: 'memo-fixture',
    onAnswers: noop, onExtra: noop, onMatch: noop, canRunAI: true,
  }));
  assert.match(html, new RegExp(`<textarea[^>]*id="extra"[^>]*>${memo}</textarea>`));
  assert.match(html, /<label[^>]*for="extra"/);
});

test('contact details and evidence remain available without application steps, and glossary explains empty results', () => {
  const a = analysis();
  const overview = renderToStaticMarkup(createElement(OverviewPanel, { a }));
  assert(overview.indexOf('문의처') > overview.indexOf(a.reading_notes!));
  assert.match(overview, /href="tel:0332501234"/);
  assert.match(overview, /href="mailto:youth@example.go.kr"/);
  assert.match(overview, /title="“청년정책과 033-250-1234”"/);
  const glossary = textOf(renderToStaticMarkup(createElement(GlossaryPanel, { a })));
  assert.match(glossary, /따로 풀어 설명할 용어가 없어요/);
});
