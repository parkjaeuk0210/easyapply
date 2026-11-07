import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex, locate, normalize } from '../src/lib/textmatch';
import { buildFlags } from '../src/lib/verification-flags';
import { AnalysisSchema, MatchSchema } from '../src/lib/schema';
import { verifyEvidence } from '../src/lib/server/uploads';
import { finalizeMatch } from '../src/lib/server/validation';
import sample from './fixtures/samples/garam-analysis.json';

test('NFKC araea and range tildes normalize consistently', () => {
  assert.equal('ㆍ'.normalize('NFKC'), '\u119E');
  for (const dot of ['ㆍ', '·']) {
    assert.equal(normalize(`대학생${dot}대학원생`), '대학생·대학원생');
  }
  for (const tilde of ['∼', '~', '～', '〜']) {
    assert.equal(normalize(`만 19${tilde}34세`), '만19~34세');
  }
  const once = normalize('대학생ㆍ대학원생 만 19∼34세');
  assert.equal(normalize(once), once);
});

test('a standalone araea is a middle dot, but an archaic syllable keeps its vowel', () => {
  assert.equal(normalize('\u119E'), '·');
  assert.equal(normalize('대학생\u119E대학원생'), '대학생·대학원생');
  assert.equal(normalize('ᄀ\u119E'), 'ᄀ\u119E');
});

for (const [original, quote] of [
  ['대학생ㆍ대학원생', '대학생·대학원생'],
  ['만 19∼34세', '만 19~34세'],
]) {
  test(`punctuation variants match exactly and highlight the original: ${original}`, () => {
    for (const [source, citation] of [[original, quote], [quote, original]]) {
      const raw = `신청 대상은 ${source}이며 공고문의 다른 요건도 충족해야 합니다.`;
      const result = locate(buildIndex([{ page: 1, items: [raw] }], 'extracted'), 1, citation);
      assert.equal(result.status, 'exact');
      assert.deepEqual(result.items, [0]);
      assert.equal(raw.slice(...result.ranges[0]), source);
    }
  });
}

test('normalization preserves highlights across PDF text items', () => {
  const items = ['신청 대상은 대학생', 'ㆍ', '대학원생이며 나이 요건은 만 19', '∼', '34세입니다.'];
  const index = buildIndex([{ page: 1, items }], 'pdf');
  for (const [quote, expected] of [['대학생·대학원생', '대학생ㆍ대학원생'], ['만 19~34세', '만 19∼34세']]) {
    const result = locate(index, 1, quote);
    assert.equal(result.status, 'exact');
    assert.equal(result.items.map(i => items[i].slice(...result.ranges[i])).join(''), expected);
  }
});

function evaluateCitation(raw: string, quote: string) {
  const a = AnalysisSchema.parse(structuredClone(sample.analysis));
  a.eligibility = [{ id: 'c1', category: '자격', kind: 'required', requirement: quote, detail: null, applies_to: null, evidence: [{ page: 1, quote }] }];
  a.profile_questions = [{ id: 'q1', label: '해당하나요?', input: 'yes_no', options: [], unit: null, help: null, criteria_ids: ['c1'] }];
  a.schedule = [];
  const verification = verifyEvidence(a, buildIndex([{ page: 1, items: [raw] }], 'extracted'));
  const match = MatchSchema.parse({ overall: 'likely_eligible', overall_message: '', criteria: [{ criterion_id: 'c1', status: 'met', reason: '입력한 조건을 충족해요.', how_to_check: null }], checklist: [] });
  return { verification, result: finalizeMatch(a, { q1: '예' }, match, buildFlags(a, verification, false)) };
}

test('punctuation alone no longer downgrades a verified criterion to check', () => {
  const { verification, result } = evaluateCitation(
    '신청 대상은 대학생ㆍ대학원생이며 나이 요건은 만 19∼34세입니다.',
    '대학생·대학원생이며 나이 요건은 만 19~34세',
  );
  assert.deepEqual(verification.unverified_criteria, []);
  assert.equal(result.criteria[0].status, 'met');
  assert.equal(result.overall, 'likely_eligible');
});

test('different numbers remain unverified and still downgrade the criterion', () => {
  const raw = '신청일 기준 만 19∼34세 청년으로 지역 거주 요건도 충족해야 합니다.';
  const quote = '만 19~35세';
  assert.notEqual(locate(buildIndex([{ page: 1, items: [raw] }], 'extracted'), 1, quote).status, 'exact');
  const { verification, result } = evaluateCitation(raw, quote);
  assert.deepEqual(verification.unverified_criteria, ['c1']);
  assert.equal(result.criteria[0].status, 'check');
  assert.equal(result.overall, 'needs_check');
});
