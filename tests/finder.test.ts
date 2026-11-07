import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AnalysisSchema, type Analysis, type Criterion, type Rule } from '../src/lib/schema';
import { EMPTY_PROFILE, evaluateNotice, medianIncome, parseRegion, rankNotices, sanitizeRules, type Profile } from '../src/lib/finder';
import { validateAnalysis } from '../src/lib/server/validation';
import sample from './fixtures/samples/garam-analysis.json';

const TODAY = '2026-11-07';
function notice(criteria: Partial<Criterion>[], extra: Partial<Analysis> = {}): Analysis {
  const a = AnalysisSchema.parse(structuredClone(sample.analysis));
  a.eligibility = criteria.map((c, i) => ({
    id: `c${i + 1}`, category: '조건', kind: 'required', requirement: '조건', detail: null, applies_to: null, rule: null,
    evidence: [{ page: 1, quote: '' }], ...c,
  }));
  a.profile_questions = [];
  a.application_status = 'open'; a.application_deadline_iso = '2026-11-30';
  return Object.assign(a, extra);
}
const rule = (r: Partial<Rule> & Pick<Rule, 'type'>): Rule => ({ has_exception: false, ...r });
const person = (p: Partial<Profile>): Profile => ({ ...EMPTY_PROFILE, ...p });
const one = (c: Partial<Criterion>, p: Partial<Profile>, unverified: string[] = []) => evaluateNotice(notice([c]), unverified, person(p), TODAY);

test('만 나이는 생일 전날까지 한 살 적고, 생일 당일부터 한 살 많다', () => {
  const c = { category: '나이', rule: rule({ type: 'age', min_age: 19, max_age: 34, age_basis_date: '2026-11-07' }) };
  assert.equal(one(c, { birth: '1991-11-08' }).verdict, 'eligible'); // 만 34세(생일 전날)
  const turned = one(c, { birth: '1991-11-07' }); // 생일 당일 만 35세
  assert.equal(turned.verdict, 'ineligible');
  assert.match(turned.headline, /만 35세/);
});

test('나이 기준일이 없고 오늘과 마감일 사이에 경계를 넘으면 확인 필요', () => {
  const c = { category: '나이', rule: rule({ type: 'age', max_age: 34 }) };
  const r = one(c, { birth: '1991-11-20' }); // 오늘 만 34세, 11/30 마감일에는 만 35세
  assert.equal(r.verdict, 'check');
  assert.deepEqual(r.remaining, ['나이']);
});

test('출생일 범위는 경계를 포함한다', () => {
  const c = { rule: rule({ type: 'birth_date', born_from: '1987-01-01', born_to: '2007-12-31' }) };
  assert.equal(one(c, { birth: '1987-01-01' }).verdict, 'eligible');
  assert.equal(one(c, { birth: '1986-12-31' }).verdict, 'ineligible');
});

test('시·군·구 표기가 달라도 같은 곳이면 맞고, 다른 시·도면 불가, 시·군·구가 없으면 확인 필요', () => {
  const c = { category: '거주지', rule: rule({ type: 'region', regions: ['경기도 수원시'] }) };
  assert.equal(one(c, { sido: 'gyeonggi', sigungu: '수원시 영통구' }).verdict, 'eligible');
  assert.equal(one(c, { sido: 'gyeonggi', sigungu: '수원' }).verdict, 'eligible');
  assert.equal(one(c, { sido: 'gyeonggi', sigungu: '용인시' }).verdict, 'ineligible');
  assert.equal(one(c, { sido: 'seoul', sigungu: '' }).verdict, 'ineligible');
  assert.equal(one(c, { sido: 'gyeonggi', sigungu: '' }).verdict, 'check');
  assert.equal(one({ rule: rule({ type: 'region', regions: ['해남군'] }) }, { sido: 'jeonnam', sigungu: '해남군' }).verdict, 'eligible');
});

test('거주 기간 조건은 지역이 맞아도 확인 필요', () => {
  const r = one({ category: '거주 기간', rule: rule({ type: 'region', regions: ['서울특별시'], min_residence_months: 6 }) }, { sido: 'seoul' });
  assert.equal(r.verdict, 'check');
  assert.match(r.criteria[0].reason, /6개월/);
});

test('지역 이름 해석', () => {
  assert.deepEqual(parseRegion('전라남도 해남군'), { sido: 'jeonnam', local: '해남' });
  assert.deepEqual(parseRegion('서울특별시'), { sido: 'seoul', local: '' });
  assert.deepEqual(parseRegion('서울 중구'), { sido: 'seoul', local: '중구' });
  assert.deepEqual(parseRegion('경기도 광주시'), { sido: 'gyeonggi', local: '광주' });
});

test('제외 조건(휴학생)에 해당하면 불가, 아니면 충족', () => {
  const c: Partial<Criterion> = { kind: 'exclusion', category: '휴학생', requirement: '휴학 중인 대학생은 신청할 수 없어요', rule: rule({ type: 'education', education: ['college_leave'] }) };
  const out = one(c, { education: 'college_leave' });
  assert.equal(out.verdict, 'ineligible');
  assert.match(out.headline, /제외 대상/);
  assert.equal(one(c, { education: 'college_grad' }).verdict, 'eligible');
});

test('아르바이트는 미취업 조건에서 불가가 아니라 확인 필요', () => {
  const c = { category: '취업 상태', rule: rule({ type: 'employment', employment: ['unemployed'] }) };
  assert.equal(one(c, { employment: 'part_time' }).verdict, 'check');
  assert.equal(one(c, { employment: 'employee' }).verdict, 'ineligible');
  assert.equal(one(c, { employment: 'unemployed' }).verdict, 'eligible');
});

test('중위소득 비율: 기준 안이면 충족, 10% 안쪽으로 넘으면 확인 필요, 그 이상이면 불가', () => {
  assert.equal(medianIncome(1), 2_564_238);
  assert.equal(medianIncome(4), 6_494_738);
  assert.equal(medianIncome(7), 8_555_952 + (8_555_952 - 7_556_719));
  const c = { category: '소득', rule: rule({ type: 'income', median_pct_max: 150 }) };
  assert.equal(one(c, { householdSize: 1, monthlyIncome: 380 }).verdict, 'eligible'); // 약 148%
  assert.equal(one(c, { householdSize: 1, monthlyIncome: 400 }).verdict, 'check'); // 약 156%
  assert.equal(one(c, { householdSize: 1, monthlyIncome: 500 }).verdict, 'ineligible'); // 약 195%
  assert.equal(one(c, { householdSize: 1, monthlyIncome: null }).verdict, 'check');
});

test('원문 인용이 글자 그대로 안 맞아도 숫자가 없는 조건은 답한 대로, 스캔본의 숫자 조건은 충족만 쓴다', () => {
  const region = { category: '거주지', rule: rule({ type: 'region', regions: ['통영시'] }) };
  assert.equal(one(region, { sido: 'gyeongnam', sigungu: '거창군' }, ['c1']).verdict, 'ineligible');
  const age = { category: '나이', rule: rule({ type: 'age', min_age: 18, age_basis_date: '2026-10-28' }) };
  assert.equal(one(age, { birth: '1998-06-01' }, ['c1', 'c1#s']).verdict, 'eligible');
  const young = one(age, { birth: '2010-01-01' }, ['c1', 'c1#s']);
  assert.equal(young.verdict, 'check');
  assert.match(young.criteria[0].reason, /숫자 기준을 확인하지 못했어요/);
});

test('예외 조항이 있어도 기준과 5년 넘게 차이 나면 불가', () => {
  const c = { category: '나이', rule: rule({ type: 'age', max_age: 39, age_basis_date: '2026-11-07', has_exception: true }) };
  const old = one(c, { birth: '1960-04-05' });
  assert.equal(old.verdict, 'ineligible');
  assert.match(old.headline, /예외 조항을 감안해도/);
  assert.equal(one(c, { birth: '1985-01-01' }).verdict, 'check');
});

test('조건이 모두 특정 신청 유형용이면 "찾지 못했어요" 대신 유형별 확인을 안내한다', () => {
  const r = evaluateNotice(notice([{ category: '평점', applies_to: '성적 장학 유형', rule: null }]), [], person({}), TODAY);
  assert.match(r.headline, /신청 유형마다/);
});

test('규칙이 없는 제외 조건(세금 체납 등)은 남은 확인으로 세지 않는다', () => {
  const a = notice([
    { category: '재학', rule: rule({ type: 'education', education: ['college_student'] }) },
    { category: '세금 체납', kind: 'exclusion', requirement: '국세·지방세 체납자', rule: null },
  ]);
  const r = evaluateNotice(a, [], person({ education: 'college_student' }), TODAY);
  assert.equal(r.verdict, 'eligible');
  assert.deepEqual(r.remaining, []);
  assert.match(r.headline, /제외 대상만 아니면/);
  assert.equal(r.criteria[0].status, 'met');
});

test('예외 조항이 있으면 범위를 넘어도 확인 필요', () => {
  const c = { category: '나이', rule: rule({ type: 'age', max_age: 34, age_basis_date: '2026-11-07', has_exception: true }) };
  assert.equal(one(c, { birth: '1990-01-01' }).verdict, 'check');
});

test('규칙이 없는 필수 조건이 남으면 남은 것을 말하고, 트랙 전용·우대 조건은 판정을 막지 않는다', () => {
  const a = notice([
    { category: '나이', rule: rule({ type: 'age', max_age: 39, age_basis_date: '2026-11-07' }) },
    { category: '사업자등록', rule: null },
    { category: '전공', applies_to: '제약기업 지원자', rule: null },
    { category: '우대', kind: 'preference', rule: null },
  ]);
  const r = evaluateNotice(a, [], person({ birth: '2000-01-01' }), TODAY);
  assert.equal(r.verdict, 'check');
  assert.deepEqual(r.remaining, ['사업자등록']);
  assert.match(r.headline, /사업자등록/);
});

test('접수가 끝난 공고는 조건과 관계없이 불가', () => {
  const r = evaluateNotice(notice([], { application_status: 'closed', application_deadline_iso: '2026-10-01' }), [], person({}), TODAY);
  assert.equal(r.verdict, 'ineligible');
});

test('추천 순서: 가능 → 확인 필요(남은 것 적은 순) → 불가, 같으면 관심 분야와 마감', () => {
  const make = (verdict: 'eligible' | 'check' | 'ineligible', remaining: number, topicMatches = 0, deadline: string | null = null) =>
    ({ name: `${verdict}-${remaining}-${topicMatches}-${deadline}`, result: { verdict, remaining: Array(remaining).fill('x'), topicMatches, deadline, headline: '', criteria: [] } });
  const ranked = rankNotices([make('ineligible', 0), make('check', 3), make('check', 1), make('eligible', 0, 0, '2026-12-30'), make('eligible', 0, 0, '2026-11-10'), make('eligible', 0, 1, '2026-12-30')], TODAY);
  assert.deepEqual(ranked.map((r) => r.name), [
    'eligible-0-1-2026-12-30', 'eligible-0-0-2026-11-10', 'eligible-0-0-2026-12-30', 'check-1-0-null', 'check-3-0-null', 'ineligible-0-0-null',
  ]);
});

test('원문 인용에 없는 숫자·지역의 규칙은 서버가 지운다', () => {
  const a = notice([
    { evidence: [{ page: 1, quote: '공고일 기준 만 19세 이상 39세 이하' }], rule: rule({ type: 'age', min_age: 19, max_age: 39 }) },
    { evidence: [{ page: 1, quote: '공고일 기준 만 19세 이상 39세 이하' }], rule: rule({ type: 'age', min_age: 19, max_age: 34 }) },
    { evidence: [{ page: 1, quote: '기준 중위소득 150% 이하' }], rule: rule({ type: 'income', median_pct_max: 150 }) },
    { evidence: [{ page: 1, quote: '기준 중위소득 이하' }], rule: rule({ type: 'income', median_pct_max: 100 }) },
    { evidence: [{ page: 1, quote: '해남군에 주민등록을 둔 사람' }], rule: rule({ type: 'region', regions: ['전라남도 해남군'] }) },
    { evidence: [{ page: 1, quote: '군내 거주자' }], rule: rule({ type: 'region', regions: ['전라남도 해남군'] }) },
    { evidence: [{ page: 1, quote: '가구 월 소득 3,500,000원 이하' }], rule: rule({ type: 'income', income_max_won: 3_500_000, income_period: 'month', income_basis: 'household' }) },
    { evidence: [{ page: 1, quote: '연 소득 5천만원 이하' }], rule: rule({ type: 'income', income_max_won: 50_000_000, income_period: 'year', income_basis: 'personal' }) },
    { evidence: [{ page: 1, quote: '1990. 1. 1. ~ 2007. 12. 31. 출생자' }], rule: rule({ type: 'birth_date', born_from: '1990-01-01', born_to: '2007-12-31' }) },
  ]);
  sanitizeRules(a);
  assert.deepEqual(a.eligibility.map((c) => !!c.rule), [true, false, true, false, true, false, true, true, true]);
});

test('분석 검증이 규칙 대조를 함께 한다', () => {
  const a = notice([{ evidence: [{ page: 1, quote: '만 39세 이하' }], rule: rule({ type: 'age', max_age: 40 }) }]);
  validateAnalysis(a);
  assert.equal(a.eligibility[0].rule, null);
});

test('글자가 있는 원문에서 숫자를 확인하지 못한 조건은 충족으로 단정하지 않고, 그림을 못 읽은 공고는 가능으로 확정하지 않는다', () => {
  const c = { category: '나이', rule: rule({ type: 'age', max_age: 34, age_basis_date: '2026-11-07' }) };
  assert.equal(one(c, { birth: '2000-01-01' }, ['c1', 'c1#n']).verdict, 'check');
  assert.equal(one(c, { birth: '2000-01-01' }, ['c1']).verdict, 'eligible');
  const pictured = one(c, { birth: '2000-01-01' }, ['#images']);
  assert.equal(pictured.verdict, 'check');
  assert.match(pictured.headline, /그림/);
});

test('접수가 끝난 공고는 마감일과 함께 알린다', () => {
  const r = evaluateNotice(notice([], { application_status: 'closed', application_deadline_iso: '2026-10-01' }), [], person({}), TODAY);
  assert.match(r.headline, /접수가 이미 끝난 공고예요\(2026\.10\.01 마감\)/);
});
