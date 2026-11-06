import { z } from "zod";
import { MatchSchema, type Analysis, type Answers, type Criterion, type Match, type ProfileQuestion } from "../schema";
import { AppError } from "./errors";
import { applicationDeadlines, deadlineEnd, deadlinePassed, kstISO, looksLikeApplication, parseKoreanDates, reconcileDates } from "../dates";

const invalidOutput = () => new AppError("bad_output", "AI 결과에 누락되거나 서로 맞지 않는 정보가 있어요. 다시 분석해 주세요.", 502);
function unique(values: (string | number)[]) { return new Set(values).size === values.length; }

export function validateAnalysis(a: Analysis, pageCount?: number) {
  if (a.schedule.some((s) => s.is_application_deadline && !s.is_deadline)) throw invalidOutput();
  if (![a.eligibility, a.documents, a.profile_questions].every((items) => unique(items.map((i) => i.id)))) throw invalidOutput();
  const ids = new Set(a.eligibility.map((c) => c.id));
  for (const q of a.profile_questions) {
    if (!q.criteria_ids.length || !unique(q.criteria_ids) || q.criteria_ids.some((id) => !ids.has(id))) throw invalidOutput();
    if (!unique(q.options) || q.options.some((o) => o.includes(" | "))) throw invalidOutput();
    if (["multi", "select"].includes(q.input) && !q.options.length) throw invalidOutput();
  }
  if (!unique(a.transcript.map((t) => t.page))) throw invalidOutput();
  const evidence = [...a.benefits, ...a.schedule, ...a.how_to_apply, ...a.eligibility, ...a.documents, ...a.cautions, ...a.glossary].flatMap((i) => i.evidence).concat(a.contact_evidence ?? []);
  if (pageCount && [...evidence, ...a.transcript].some((e) => e.page > pageCount)) throw invalidOutput();
  // 일정 날짜를 원문 표기와 대조하고 접수 마감을 추정한다(제자리 수정, 여러 번 불러도 같다).
  reconcileDates(a);
}

const unsure = (s: string) => /모르|몰라|모름|확인\s*필요|잘\s*모/.test(s);
const BIRTH = /생년월일|출생|태어/;

export function validateAnswers(a: Analysis, answers: Answers): Answers {
  const questions = new Map(a.profile_questions.map((q) => [q.id, q]));
  const output: Answers = {};
  for (const [id, raw] of Object.entries(answers)) {
    const q = questions.get(id), value = raw.trim();
    const bad = () => new AppError("invalid_answer", "답변 형식이 맞지 않아요. 날짜·숫자·선택 항목을 확인해 주세요.", 400);
    if (!q || value.length > 2000) throw bad();
    if (!value || value === "잘 모르겠어요") { output[id] = value; continue; }
    // 생년월일은 오늘 이후일 수 없다. 전역 예정일 같은 다른 날짜 질문은 미래를 허용한다.
    const latest = BIRTH.test(q.label) ? kstISO(new Date()) : "2100-12-31";
    if (q.input === "date" && (!z.iso.date().safeParse(value).success || value < "1900-01-01" || value > latest)) throw bad();
    if (q.input === "number" && (!/^-?\d+(?:\.\d+)?$/.test(value) || !Number.isFinite(Number(value)))) throw bad();
    if (q.input === "yes_no" && !["예", "아니오"].includes(value)) throw bad();
    if (q.input === "select" && !q.options.includes(value)) throw bad();
    if (q.input === "multi") {
      const selected = value.split(" | ");
      if (!unique(selected) || selected.some((s) => !q.options.includes(s) && s !== "해당 없음")) throw bad();
      if (selected.length > 1 && selected.some((s) => /해당\s*없음/.test(s) || unsure(s))) throw bad();
    }
    output[id] = value;
  }
  return output;
}

type Judged = Match["criteria"][number];
const CHECK_HOW = "공고문 원문과 관련 서류를 확인하고 담당 기관에 문의해 주세요.";
const NEED_ANSWER = "이 조건을 판단하는 데 필요한 답변이 부족하거나 불확실해요.";
// 조건 설명에 예외·연장·단서가 있으면 일부 답변만으로 탈락을 확정하지 않는다.
const EXCEPTION = /연장|예외|제외|단\s*,|다만|경우에는/;
// 나이 조건은 병역 연장 같은 표현을 더 넓게 본다. 걸리면 서버 계산으로 판정을 뒤집지 않는다.
const AGE_EXCEPTION = /연장|예외|제외|단\s*,|다만|경우|병역|군\s*복무|군필|복무|비례|늘어|늘려|상향|가산/;
const toCheck = (c: Judged, reason: string): Judged => ({ ...c, status: "check", failed_answer_ids: [], reason, how_to_check: CHECK_HOW });

// 원문 인용에서 '만 N세 이상/이하/미만/초과'를 뽑는다. 상한·하한이 둘 이상이면 모호해서 null.
function ageBounds(text: string) {
  if (!/만\s*\d{1,2}\s*세|만\s*\d{1,2}\s*[~∼～〜-]/.test(text)) return null;
  const mins = new Set<string>(), maxes = new Set<string>();
  const rest = text.replace(/(\d{1,2})\s*(?:세\s*)?(?:이상\s*)?(?:~|∼|～|〜|-|부터)\s*(?:만\s*)?(\d{1,2})\s*세\s*(이하|미만|까지)?/g, (_, lo, hi, kind) => {
    mins.add(`${lo}:1`);
    maxes.add(`${hi}:${kind === "미만" ? 0 : 1}`);
    return " ";
  });
  for (const [, n, kind] of rest.matchAll(/(\d{1,2})\s*세\s*(이상|이하|미만|초과)/g)) {
    if (kind === "이상" || kind === "초과") mins.add(`${n}:${kind === "이상" ? 1 : 0}`);
    else maxes.add(`${n}:${kind === "이하" ? 1 : 0}`);
  }
  if (mins.size > 1 || maxes.size > 1 || mins.size + maxes.size === 0) return null;
  const parse = (v?: string) => v ? { age: Number(v.split(":")[0]), inclusive: v.endsWith(":1") } : null;
  return { min: parse([...mins][0]), max: parse([...maxes][0]) };
}

function fullAge(birth: string, on: string) {
  const [by, bm, bd] = birth.split("-").map(Number), [y, m, d] = on.split("-").map(Number);
  return y - by - (m < bm || (m === bm && d < bd) ? 1 : 0);
}

// 나이 기준일 후보. 원문에 기준일이 있으면 그 날짜, 없으면 공고일·접수 마감일·오늘 모두(판정이 같을 때만 쓴다).
function ageBaseDates(a: Analysis, text: string, now: Date): string[] | null {
  const today = kstISO(now);
  const deadlines = applicationDeadlines(a).flatMap((s) => s.date_iso ? [s.date_iso] : []);
  const stated = parseKoreanDates(text).filter((x) => x.year !== null && /^[\s.)\]]*(?:기준|현재)/.test(text.slice(x.end)));
  if (stated.length) {
    const dates = new Set(stated.map((x) => `${x.year}-${String(x.month).padStart(2, "0")}-${String(x.day).padStart(2, "0")}`));
    return dates.size === 1 ? [...dates] : null;
  }
  const notice = a.schedule.filter((s) => s.date_iso && /공고일/.test(s.label)).map((s) => s.date_iso!);
  if (/공고일[^가-힣]{0,20}(?:기준|현재)/.test(text)) return notice.length === 1 ? notice : null;
  if (/(?:신청|접수)\s*일?[^가-힣]{0,3}(?:기준|현재)/.test(text)) return [today, ...deadlines];
  if (/기준|현재/.test(text)) return null;
  const basis = a.schedule.filter((s) => s.date_iso && /기준일/.test(s.label)).map((s) => s.date_iso!);
  if (basis.length === 1) return basis;
  return [...new Set([...notice, ...deadlines, today])];
}

/**
 * 생년월일 계산은 확인 필요 또는 미충족으로 내릴 때만 쓴다. 복합 조건을 충족으로 올리지 않는다.
 * 예외·연장 문구가 있거나 기준일에 따라 결과가 갈리면 check. 나이 조건을 뽑지 못하면 그대로 둔다.
 */
function judgeAge(a: Analysis, e: Criterion, related: ProfileQuestion[], answers: Answers, c: Judged, now: Date): Judged {
  const births = related.filter((q) => q.input === "date" && BIRTH.test(q.label));
  const birth = births.length === 1 ? answers[births[0].id]?.trim() : undefined;
  if (c.status === "check" || !birth || !/^\d{4}-\d{2}-\d{2}$/.test(birth)) return c;
  const quotes = e.evidence.map((x) => x.quote).join("\n");
  const text = [e.requirement, e.detail ?? "", quotes].join("\n");
  const bounds = ageBounds(quotes);
  // 출생 기간이 적힌 조건은 그 기간이 기준이라 기준일을 추정하지 않는다.
  const bases = bounds && !/출생|년생/.test(text) ? ageBaseDates(a, text, now) : null;
  if (!bounds || !bases?.length) return c;
  const ok = (age: number) => (!bounds.min || (bounds.min.inclusive ? age >= bounds.min.age : age > bounds.min.age)) &&
    (!bounds.max || (bounds.max.inclusive ? age <= bounds.max.age : age < bounds.max.age));
  const ages = bases.map((base) => fullAge(birth, base));
  if (ages.some((age) => age < 0)) return c;
  if (ages.some((age) => ok(age) !== ok(ages[0]))) return toCheck(c, "기준일에 따라 만 나이 판정이 달라질 수 있어 확인이 필요해요.");
  if (ok(ages[0])) return c;
  if (c.status === "not_met" && c.failed_answer_ids.length) return c;
  if (AGE_EXCEPTION.test(text)) return toCheck(c, `생년월일 기준 만 ${ages[0]}세로 계산되지만 예외·연장 조건이 있어 확인이 필요해요.`);
  const limit = [bounds.min && `만 ${bounds.min.age}세 ${bounds.min.inclusive ? "이상" : "초과"}`, bounds.max && `만 ${bounds.max.age}세 ${bounds.max.inclusive ? "이하" : "미만"}`].filter(Boolean).join(" ");
  return { ...c, status: "not_met", failed_answer_ids: [births[0].id],
    reason: `생년월일 기준 만 ${ages[0]}세(${bases[0]} 기준)예요. 공고 기준은 ${limit}이에요.` };
}

/**
 * 모델 출력의 사소한 이탈은 받아 주고(빠진 조건은 check로 보충, 모르는 id는 버림, 상충하는 중복은 check),
 * 근거가 부족한 결론은 check로 내린다. 접수 마감과 서류 일정은 서버가 정한다.
 */
export function finalizeMatch(a: Analysis, answers: Answers, match: Match, unverifiedCriteria: string[] = [], now = new Date()): Match {
  const docIds = new Set(a.documents.map((d) => d.id));
  const judged = new Map<string, Judged>();
  for (const c of match.criteria) {
    const prior = judged.get(c.criterion_id);
    const same = prior && prior.status === c.status && prior.reason === c.reason && prior.how_to_check === c.how_to_check &&
      JSON.stringify(prior.failed_answer_ids) === JSON.stringify(c.failed_answer_ids);
    judged.set(c.criterion_id, !prior || same ? c : toCheck(prior, "같은 조건의 판정이나 근거가 서로 달라 확인이 필요해요."));
  }
  const answered = (id: string) => !!answers[id]?.trim() && !unsure(answers[id]);

  const criteria = a.eligibility.map((e): Judged => {
    const related = a.profile_questions.filter((q) => q.criteria_ids.includes(e.id));
    const model = judged.get(e.id);
    if (!model) return toCheck({ criterion_id: e.id, status: "check", reason: "", how_to_check: null, failed_answer_ids: [] }, "AI가 이 조건을 판정하지 않았어요. 직접 확인이 필요해요.");
    const cited = [...new Set(model.failed_answer_ids ?? [])];
    if (cited.some((id) => !related.some((q) => q.id === id))) return toCheck(model, "판정 근거로 든 답변이 이 조건과 맞지 않아 확인이 필요해요.");
    const c = judgeAge(a, e, related, answers, { ...model, failed_answer_ids: model.status === "not_met" ? cited : [] }, now);
    const unanswered = !related.length || related.some((q) => !answered(q.id));
    const text = [e.requirement, e.detail ?? "", ...e.evidence.map((x) => x.quote)].join("\n");
    if (c.status === "check") return c;
    if (!e.evidence.length || e.evidence.some((x) => x.quote.trim().length < 2) || unverifiedCriteria.includes(e.id)) return toCheck(c, "이 조건의 원문 근거나 표 구조를 자동으로 확인하지 못했어요.");
    if (c.status === "met") return unanswered ? toCheck(c, NEED_ANSWER) : c;
    // 탈락은 이 조건에 연결된, 실제로 답한 질문을 근거로 댈 때만 인정한다. 제외 조건에 '해당 없음'이라 답한 것은 근거가 아니다.
    const supports = (id: string) => answered(id) && !(e.kind === "exclusion" && /^해당\s*없음$/.test(answers[id].trim()));
    if (!c.failed_answer_ids.length || !c.failed_answer_ids.every(supports)) return toCheck(c, NEED_ANSWER);
    if (unanswered && EXCEPTION.test(text)) return toCheck(c, "예외나 연장 조건에 해당하는지 확인할 답변이 부족해요.");
    if (e.applies_to?.trim()) return toCheck(c, `이 조건은 ${e.applies_to.trim()}에게만 해당해요. 해당하는지 확인해 주세요.`);
    return c;
  });
  const required = criteria.filter((c) => a.eligibility.find((e) => e.id === c.criterion_id)?.kind !== "preference");
  const failedRequiredIds = new Set(required.filter((c) => c.status === "not_met").map((c) => c.criterion_id));
  let overall: Match["overall"] = required.some((c) => c.status === "not_met") ? "likely_ineligible"
    : !required.length || required.some((c) => c.status === "check") ? "needs_check" : "likely_eligible";
  const messages = {
    likely_ineligible: "필수 자격이나 제외 조건 중 맞지 않는 항목이 있어요. 해당 조건과 예외를 담당 기관에 확인해 주세요.",
    needs_check: "확인이 더 필요한 조건이 있어요. 아래 항목을 확인한 뒤 신청을 준비해 주세요.",
    likely_eligible: "입력한 정보로는 필수 자격과 제외 조건을 충족할 가능성이 있어요. 최종 자격은 기관 심사로 결정돼요.",
  };
  const deadlines = applicationDeadlines(a);
  const periods = a.schedule.filter((s) => s.is_application_deadline || looksLikeApplication(s));
  const unconfirmed = periods.some((s) => !deadlines.includes(s) || !deadlineEnd(s));
  const expired = deadlines.length > 0 && !unconfirmed && deadlines.every((s) => deadlinePassed(s, now));
  // 접수 마감이 있는데 날짜를 확정하지 못했고 열려 있는 회차도 없으면 '가능'을 확정하지 않는다.
  const unclear = !expired && deadlines.length > 0 && unconfirmed && !deadlines.some((s) => deadlineEnd(s) && !deadlinePassed(s, now));
  // Meeting personal criteria does not reopen an expired (or unconfirmed) application period.
  const heldBack = (expired || unclear) && overall === "likely_eligible";
  if (heldBack) overall = "needs_check";
  const lastDay = unconfirmed ? undefined : deadlines.flatMap((s) => s.date_iso ? [s.date_iso] : []).sort().at(-1);
  const ids = new Set<string>();
  const checklist = match.checklist.map((t) => {
    let id = t.id;
    for (let n = 2; ids.has(id); n++) id = `${t.id.slice(0, 36)}_${n}`;
    ids.add(id);
    // 신청·서류 준비는 접수 마감을 넘길 수 없다.
    const late = (t.kind === "apply" || t.kind === "document") && lastDay && t.due_date_iso && t.due_date_iso > lastDay;
    return { ...t, id, document_id: t.document_id && docIds.has(t.document_id) ? t.document_id : null, due_date_iso: late ? lastDay : t.due_date_iso };
  }).filter((t) => (!expired && overall !== "likely_ineligible") || (t.kind !== "document" && t.kind !== "apply"));
  if (expired) {
    let id = "verify_reopening";
    let n = 1;
    while (checklist.some(t => t.id === id)) id = `verify_reopening_${n++}`;
    checklist.unshift({ id, title: "추가 모집 여부 확인", detail: "기존 접수는 마감됐어요. 담당 기관에 추가 모집 여부와 새 접수 기간을 확인한 뒤 준비해 주세요.", kind: "verify", due_date_iso: null, document_id: null, priority: "high" });
    checklist.splice(100);
  }
  // Supplement application tasks only when no required or exclusion condition has failed.
  if (!expired && overall !== "likely_ineligible") {
    const freshId = () => { let n = checklist.length + 1; while (checklist.some((t) => t.id === `t${n}`)) n++; return `t${n}`; };
    for (const doc of a.documents.filter((d) => d.necessity === "required")) {
      if (!checklist.some((t) => t.document_id === doc.id && t.kind === "document")) checklist.push({
        id: freshId(), title: `${doc.name} 준비`.slice(0, 300), detail: [doc.how_to_get, doc.tip].filter(Boolean).join(" · ").slice(0, 4000) || null,
        kind: "document", due_date_iso: null, document_id: doc.id, priority: "high",
      });
    }
    if (!checklist.some((t) => t.kind === "apply") && a.how_to_apply.length) checklist.push({
      id: freshId(), title: "신청 방법과 접수 기간 확인 후 제출", detail: a.how_to_apply.map((h) => h.text).join("\n").slice(0, 4000),
      kind: "apply", due_date_iso: null, document_id: null, priority: "high",
    });
  }
  const order = { verify: 0, document: 1, apply: 2, schedule: 3 };
  checklist.sort((x, y) => order[x.kind] - order[y.kind]);
  checklist.splice(100);
  const overallMessage = expired
    ? `공고문에 적힌 접수 마감일이 모두 지났어요. 추가 모집 여부와 새 접수 기간을 먼저 확인해 주세요.${overall === "likely_ineligible" ? " 입력한 조건에도 미충족 항목이 있어요." : ""}`
    : unclear && heldBack
      ? "입력한 정보로는 자격 조건을 충족할 가능성이 있지만, 접수 마감일을 공고문 날짜와 맞춰 확인하지 못했어요. 공고문에서 접수 기간을 직접 확인해 주세요."
      : messages[overall];
  // 조건마다 검색 제안은 첫 항목 하나만, 최종 미충족 필수·제외 조건에만 남긴다.
  const searches = new Map<string, Match["next_searches"][number]>();
  for (const s of match.next_searches ?? []) if (!searches.has(s.criterion_id)) searches.set(s.criterion_id, s);
  const result = MatchSchema.safeParse({ overall, overall_message: overallMessage, criteria, checklist, next_searches: [...searches.values()].filter((s) => failedRequiredIds.has(s.criterion_id)) });
  if (!result.success) throw invalidOutput();
  return result.data;
}
