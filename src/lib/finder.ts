// 'AI 맞춤 공고 찾기'의 규칙 비교. AI는 공고에서 조건(rule)을 뽑기만 하고, 사람과 조건의 비교는 여기 코드가 한다.
// 브라우저와 서버가 같이 쓴다. 프로필(생년월일·소득)은 브라우저 밖으로 보내지 않는다.
import { readFlags } from "./verification-flags";
import { EDUCATION, EMPLOYMENT, TOPICS, type Analysis, type Criterion, type Education, type Employment, type Evidence, type Rule, type Topic } from "./schema";

export type Profile = {
  birth: string | null; // YYYY-MM-DD
  sido: SidoKey | null;
  sigungu: string;
  education: Education | null;
  employment: Employment | null;
  householdSize: number | null;
  monthlyIncome: number | null; // 만원, 세전 가구 소득. 모르면 null
  topics: Topic[];
};

export const EMPTY_PROFILE: Profile = { birth: null, sido: null, sigungu: "", education: null, employment: null, householdSize: null, monthlyIncome: null, topics: [] };

export const EDUCATION_LABELS: Record<Education, string> = {
  middle_or_less: "중학교 졸업 이하", hs_student: "고등학교 재학 중", hs_grad: "고등학교 졸업",
  college_student: "대학 재학 중", college_leave: "대학 휴학 중", college_grad: "대학 졸업", grad_school: "대학원 재학·졸업",
};
export const EMPLOYMENT_LABELS: Record<Employment, string> = {
  unemployed: "일하지 않아요(구직 중 포함)", employee: "직장에 다녀요", part_time: "아르바이트·단기 일을 해요", self_employed: "사업자·프리랜서예요",
};
export const TOPIC_LABELS: Record<Topic, string> = {
  jobs: "일자리", housing: "주거", startup: "창업", education: "교육·훈련", living: "생활비·금융", health: "건강·돌봄", culture: "문화·여가", other: "기타",
};
export { EDUCATION, EMPLOYMENT, TOPICS };

// 시·도: [키, 정식 이름, 다른 표기...]
const SIDO = [
  ["seoul", "서울특별시", "서울", "서울시"], ["busan", "부산광역시", "부산", "부산시"], ["daegu", "대구광역시", "대구", "대구시"],
  ["incheon", "인천광역시", "인천", "인천시"], ["gwangju", "광주광역시", "광주"], ["daejeon", "대전광역시", "대전", "대전시"],
  ["ulsan", "울산광역시", "울산", "울산시"], ["sejong", "세종특별자치시", "세종", "세종시"], ["gyeonggi", "경기도", "경기"],
  ["gangwon", "강원특별자치도", "강원도", "강원"], ["chungbuk", "충청북도", "충북"], ["chungnam", "충청남도", "충남"],
  ["jeonbuk", "전북특별자치도", "전라북도", "전북"], ["jeonnam", "전라남도", "전남"], ["gyeongbuk", "경상북도", "경북"],
  ["gyeongnam", "경상남도", "경남"], ["jeju", "제주특별자치도", "제주도", "제주"],
] as const;
export type SidoKey = typeof SIDO[number][0];
export const SIDO_OPTIONS = SIDO.map(([key, name]) => ({ key, name }));
const sidoName = (key: SidoKey) => SIDO.find(([k]) => k === key)![1];

/** "전라남도 해남군" → { sido: "jeonnam", local: "해남" }. 시·도가 없으면 sido는 null. */
export function parseRegion(text: string): { sido: SidoKey | null; local: string } {
  const words = text.trim().split(/\s+/).filter((w) => w && w !== "전국");
  const first = words[0] ?? "";
  const hit = SIDO.find((names) => (names.slice(1) as readonly string[]).includes(first));
  const rest = (hit ? words.slice(1) : words).join("");
  return { sido: hit ? hit[0] : null, local: localCore(rest) };
}
// 시·군·구 이름의 끝 글자(시·군·구)를 떼서 "해남군"과 "해남"을 같게 본다. "중구"처럼 짧은 이름은 그대로 둔다.
function localCore(text: string) {
  const t = text.replace(/\s+/g, "");
  const first = t.match(/^(.+?(?:시|군|구))/)?.[1] ?? t;
  return first.length > 2 ? first.replace(/(시|군|구)$/, "") : first;
}

// 2026년 기준 중위소득(월, 원). 보건복지부 보도자료 "2026년도 기준 중위소득 6.51% 역대 최대로 인상"(2025-07-31, 제77차 중앙생활보장위원회)
// https://www.mohw.go.kr/board.es?mid=a10503000000&bid=0027&act=view&list_no=1487098
const MEDIAN_2026 = [2_564_238, 4_199_292, 5_359_036, 6_494_738, 7_556_719, 8_555_952];
export function medianIncome(size: number) {
  if (size <= 6) return MEDIAN_2026[Math.max(1, size) - 1];
  // 7인 이상: 6인 금액에 (6인 − 5인) 차액을 한 명마다 더한다(보건복지부 산정 방식).
  return MEDIAN_2026[5] + (MEDIAN_2026[5] - MEDIAN_2026[4]) * (size - 6);
}

type InRange = { in: boolean | null; reason: string };
export type Status = "met" | "not_met" | "unknown";
export type CriterionResult = {
  id: string; kind: Criterion["kind"]; label: string; requirement: string; track: string | null;
  status: Status; reason: string; evidence: Evidence[];
};
export type Verdict = "eligible" | "check" | "ineligible";
export type NoticeResult = { verdict: Verdict; headline: string; remaining: string[]; criteria: CriterionResult[]; topicMatches: number; deadline: string | null };


function ageOn(birth: string, on: string) {
  const [by, bm, bd] = birth.split("-").map(Number), [y, m, d] = on.split("-").map(Number);
  return y - by - (m < bm || (m === bm && d < bd) ? 1 : 0);
}
const range = (min?: number | null, max?: number | null) =>
  min != null && max != null ? `만 ${min}~${max}세` : min != null ? `만 ${min}세 이상` : `만 ${max}세 이하`;
const won = (n: number) => n >= 10_000 ? `${Math.round(n / 10_000).toLocaleString("ko-KR")}만 원` : `${n.toLocaleString("ko-KR")}원`;

/** 사람이 규칙의 범위 안에 있는지. in이 null이면 모른다. */
export function inRule(rule: Rule, p: Profile, ctx: { today: string; deadline: string | null }): InRange {
  switch (rule.type) {
    case "age": {
      if (rule.min_age == null && rule.max_age == null) return { in: null, reason: "나이 조건을 공고에서 확인해 주세요." };
      if (!p.birth) return { in: null, reason: "생년월일을 적으면 확인할 수 있어요." };
      const fits = (age: number) => (rule.min_age == null || age >= rule.min_age) && (rule.max_age == null || age <= rule.max_age);
      const dates = rule.age_basis_date ? [rule.age_basis_date] : [ctx.today, ...(ctx.deadline && ctx.deadline > ctx.today ? [ctx.deadline] : [])];
      const ages = dates.map((d) => ageOn(p.birth!, d));
      if (ages.some((a) => fits(a)) !== ages.every((a) => fits(a))) return { in: null, reason: `나이 기준일에 따라 ${range(rule.min_age, rule.max_age)} 조건이 달라질 수 있어요. 기준일을 확인해 주세요.` };
      return { in: fits(ages[0]), reason: `만 ${ages[0]}세라 ${range(rule.min_age, rule.max_age)} 조건에 ${fits(ages[0]) ? "맞아요" : "맞지 않아요"}.` };
    }
    case "birth_date": {
      if (!rule.born_from && !rule.born_to) return { in: null, reason: "출생일 조건을 공고에서 확인해 주세요." };
      if (!p.birth) return { in: null, reason: "생년월일을 적으면 확인할 수 있어요." };
      const fits = (!rule.born_from || p.birth >= rule.born_from) && (!rule.born_to || p.birth <= rule.born_to);
      return { in: fits, reason: `${[rule.born_from, rule.born_to].map((d) => d ? d.replaceAll("-", ".") : "").join("~")} 출생 조건에 ${fits ? "맞아요" : "맞지 않아요"}.` };
    }
    case "region": {
      const regions = (rule.regions ?? []).map(parseRegion).filter((r) => r.sido || r.local);
      if (!regions.length) return { in: null, reason: "거주 지역 조건을 공고에서 확인해 주세요." };
      const named = rule.regions!.join(", ");
      if (!p.sido) return { in: null, reason: "사는 곳을 적으면 확인할 수 있어요." };
      const mine = localCore(p.sigungu).length ? p.sigungu.replace(/\s+/g, "") : "";
      let unknown = false;
      const hit = regions.some((r) => {
        if (r.sido && r.sido !== p.sido) return false;
        if (!r.local) return true;
        if (!mine) { unknown = true; return false; }
        return mine.includes(r.local);
      });
      if (hit && rule.min_residence_months) return { in: null, reason: `${named} 거주는 맞아요. 거주 기간(${rule.min_residence_months}개월 이상)은 직접 확인해 주세요.` };
      if (hit) return { in: true, reason: `${named} 거주 조건에 맞아요.` };
      if (unknown) return { in: null, reason: "시·군·구를 적으면 확인할 수 있어요." };
      return { in: false, reason: `${named} 거주자 대상이라 ${sidoName(p.sido)}${p.sigungu ? ` ${p.sigungu}` : ""} 거주와 맞지 않아요.` };
    }
    case "education": {
      const allowed = rule.education ?? [];
      if (!allowed.length) return { in: null, reason: "학력 조건을 공고에서 확인해 주세요." };
      if (!p.education) return { in: null, reason: "학력·재학 상태를 고르면 확인할 수 있어요." };
      const fits = allowed.includes(p.education);
      return { in: fits, reason: `지금 상태(${EDUCATION_LABELS[p.education]})${fits ? "로는 조건에 맞아요" : "는 이 조건에 해당하지 않아요"}.` };
    }
    case "employment": {
      const allowed = rule.employment ?? [];
      if (!allowed.length) return { in: null, reason: "취업 상태 조건을 공고에서 확인해 주세요." };
      if (!p.employment) return { in: null, reason: "하는 일을 고르면 확인할 수 있어요." };
      if (allowed.includes(p.employment)) return { in: true, reason: "지금 하는 일로 보면 조건에 맞아요." };
      // 아르바이트는 고용보험 가입 여부에 따라 '미취업'으로 보는 공고가 많다.
      if (p.employment === "part_time") return { in: null, reason: "아르바이트는 고용보험 가입 여부에 따라 달라져요. 공고 기준을 확인해 주세요." };
      return { in: false, reason: "지금 하는 일로 보면 조건에 맞지 않아요." };
    }
    case "income": {
      if (rule.median_pct_max != null) {
        if (!p.householdSize || p.monthlyIncome == null) return { in: null, reason: "가구원 수와 월 소득을 적으면 대략 확인할 수 있어요." };
        const pct = Math.round((p.monthlyIncome * 10_000 / medianIncome(p.householdSize)) * 100);
        const base = `입력한 소득은 ${p.householdSize}인 가구 기준 중위소득의 약 ${pct}%예요(공고 기준 ${rule.median_pct_max}% 이하).`;
        if (pct <= rule.median_pct_max) return { in: true, reason: `${base} 실제 소득은 기관이 건강보험료 등으로 다시 계산해요.` };
        // 기준을 조금 넘는 정도는 기관 계산 방식(소득인정액 등)에 따라 달라질 수 있다.
        if (pct <= rule.median_pct_max * 1.1) return { in: null, reason: `${base} 기준 근처라 기관 계산으로 확인해야 해요.` };
        return { in: false, reason: base };
      }
      if (rule.income_max_won != null && rule.income_period && rule.income_basis) {
        if (rule.income_basis === "personal") return { in: null, reason: `본인 소득 ${rule.income_period === "year" ? "연" : "월"} ${won(rule.income_max_won)} 이하 조건이에요. 직접 확인해 주세요.` };
        if (p.monthlyIncome == null) return { in: null, reason: "월 가구 소득을 적으면 대략 확인할 수 있어요." };
        const mine = p.monthlyIncome * 10_000 * (rule.income_period === "year" ? 12 : 1);
        const base = `입력한 가구 소득은 ${rule.income_period === "year" ? "연" : "월"} 약 ${won(mine)}이에요(공고 기준 ${won(rule.income_max_won)} 이하).`;
        if (mine <= rule.income_max_won) return { in: true, reason: `${base} 실제 소득은 기관이 다시 계산해요.` };
        if (mine <= rule.income_max_won * 1.1) return { in: null, reason: `${base} 기준 근처라 기관 계산으로 확인해야 해요.` };
        return { in: false, reason: base };
      }
      return { in: null, reason: "소득 조건을 공고에서 확인해 주세요." };
    }
  }
}

// 원문 대조 결과를 어떻게 쓰는지는 src/lib/verification-flags.ts에서 정한다.
function judge(c: Criterion, p: Profile, flags: ReturnType<typeof readFlags>, ctx: { today: string; deadline: string | null }): Pick<CriterionResult, "status" | "reason"> {
  if (!c.rule) return { status: "unknown", reason: "이 조건은 공고를 보고 직접 확인해 주세요." };
  const r = inRule(c.rule, p, ctx);
  if (r.in === null) return { status: "unknown", reason: r.reason };
  // exclusion은 "이 범위에 들면 신청 불가"다.
  let status: Status = (c.kind === "exclusion" ? !r.in : r.in) ? "met" : "not_met";
  let reason = c.kind === "exclusion" ? (r.in ? `제외 대상이에요: ${c.requirement}` : "제외 대상에 해당하지 않아요.") : r.reason;
  if (status === "not_met" && c.rule.has_exception) {
    status = "unknown"; reason = `${reason} 다만 예외 조항이 있어 확인이 필요해요.`;
  }
  if (status === "not_met" && flags.unverified.has(c.id)) {
    status = "unknown"; reason = `${reason} 다만 원문에서 이 문장을 그대로 찾지 못했어요. 공고를 확인해 주세요.`;
  } else if (status === "met" && flags.doubtful.has(c.id)) {
    status = "unknown"; reason = "원문에서 이 조건의 숫자 기준을 확인하지 못했어요. 공고문에서 기준을 확인해 주세요.";
  }
  return { status, reason };
}

/** 공고 하나를 프로필과 비교한다. AI를 부르지 않는다. */
export function evaluateNotice(a: Analysis, verificationFlags: string[], p: Profile, today: string): NoticeResult {
  const ctx = { today, deadline: a.application_deadline_iso ?? null };
  const flags = readFlags(verificationFlags);
  const criteria: CriterionResult[] = a.eligibility.map((c) => ({
    id: c.id, kind: c.kind, label: c.category, requirement: c.requirement, track: c.applies_to ?? null, evidence: c.evidence,
    ...judge(c, p, flags, ctx),
  }));
  const topicMatches = (a.topics ?? []).filter((t) => p.topics.includes(t)).length;
  const base = { criteria, topicMatches, deadline: a.application_deadline_iso ?? null };
  // 특정 트랙 전용 조건과 우대 조건은 판정에 쓰지 않는다.
  const deciding = criteria.filter((c) => c.kind !== "preference" && !c.track);
  if (a.application_status === "closed") return { ...base, verdict: "ineligible", remaining: [],
    headline: `접수가 이미 끝난 공고예요${a.application_deadline_iso ? `(${a.application_deadline_iso.replaceAll("-", ".")} 마감)` : ""}.` };
  const failed = deciding.find((c) => c.status === "not_met");
  if (failed) return { ...base, verdict: "ineligible", headline: failed.reason, remaining: [] };
  if (!deciding.length) return { ...base, verdict: "check", headline: "공고에서 자격 조건을 찾지 못했어요. 공고를 직접 확인해 주세요.", remaining: [] };
  // 세금 체납·중복 수혜 같은 제외 조건은 대부분의 사람과 무관하다. '남은 확인'으로 세지 않고 따로 보여 준다.
  const open = deciding.filter((c) => c.kind === "required" && c.status === "unknown");
  const exclusions = deciding.some((c) => c.kind === "exclusion" && c.status === "unknown");
  if (!open.length && flags.unreadImages) return { ...base, verdict: "check", remaining: ["그림 속 내용"],
    headline: "적어 주신 내용으로는 필수 조건에 맞아요. 다만 공고 속 그림은 읽지 못해 다른 조건이 있는지 원문을 확인해 주세요." };
  if (!open.length) return { ...base, verdict: "eligible", remaining: [], headline: exclusions
    ? "적어 주신 내용으로는 필수 조건에 모두 맞아요. 아래 제외 대상만 아니면 신청할 수 있어요."
    : "적어 주신 내용으로는 필수 조건에 모두 맞아요." };
  const remaining = [...new Set(open.map((c) => c.label))];
  return { ...base, verdict: "check", headline: `남은 확인: ${remaining.slice(0, 3).join(", ")}${remaining.length > 3 ? ` 외 ${remaining.length - 3}개` : ""}`, remaining };
}

const ORDER: Record<Verdict, number> = { eligible: 0, check: 1, ineligible: 2 };
/** 추천 순서: 판정 → 남은 확인이 적은 순 → 관심 분야 일치 → 마감이 가까운 순. */
export function rankNotices<T extends { result: NoticeResult }>(items: T[], today: string): T[] {
  const due = (r: NoticeResult) => (r.deadline && r.deadline >= today ? r.deadline : "9999-12-31");
  return [...items].sort((x, y) =>
    ORDER[x.result.verdict] - ORDER[y.result.verdict]
    || x.result.remaining.length - y.result.remaining.length
    || y.result.topicMatches - x.result.topicMatches
    || due(x.result).localeCompare(due(y.result)));
}

// 숫자·지역명이 조건의 원문 인용에 실제로 있는지 본다. 없으면 AI가 만든 값일 수 있으니 규칙을 지운다.
const flat = (s: string) => s.replace(/[\s,]/g, "");
function hasNumber(quotes: string, n: number) {
  return new RegExp(`(^|[^0-9.])${String(n).replace(".", "\\.")}(?![0-9])`).test(quotes);
}
function amountQuoted(quotes: string, won: number) {
  const forms = [won, won / 10_000, won / 1_000].filter((v) => Number.isInteger(v) && v > 0);
  if (forms.some((v) => hasNumber(quotes, v))) return true;
  // "5천만원", "1억원" 같은 표기
  return (won % 10_000_000 === 0 && quotes.includes(`${won / 10_000_000}천만`)) || (won % 100_000_000 === 0 && quotes.includes(`${won / 100_000_000}억`));
}
function ruleQuoted(rule: Rule, quotes: string): boolean {
  switch (rule.type) {
    case "age":
      return (rule.min_age != null || rule.max_age != null)
        && [rule.min_age, rule.max_age].every((n) => n == null || (n >= 0 && n <= 120 && hasNumber(quotes, n)))
        && (rule.min_age == null || rule.max_age == null || rule.min_age <= rule.max_age);
    case "birth_date":
      return (!!rule.born_from || !!rule.born_to) && [rule.born_from, rule.born_to].every((d) => {
        if (!d) return true;
        const y = d.slice(0, 4);
        return quotes.includes(y) || new RegExp(`'?${y.slice(2)}(\\.|년)`).test(quotes);
      });
    case "region":
      return !!rule.regions?.length && rule.regions.every((r) => {
        const { sido, local } = parseRegion(r);
        if (local) return quotes.includes(local);
        return !!sido && SIDO.find(([k]) => k === sido)!.slice(1).some((n) => quotes.includes(n));
      });
    case "education": return !!rule.education?.length;
    case "employment": return !!rule.employment?.length;
    case "income":
      if (rule.median_pct_max != null) return rule.median_pct_max > 0 && hasNumber(quotes, rule.median_pct_max);
      return rule.income_max_won != null && rule.income_max_won > 0 && !!rule.income_period && !!rule.income_basis && amountQuoted(quotes, rule.income_max_won);
  }
}

/** 분석 결과의 규칙 중 원문 인용으로 뒷받침되지 않는 것을 지운다(제자리 수정). */
export function sanitizeRules(a: Analysis) {
  for (const c of a.eligibility) {
    if (c.rule && !ruleQuoted(c.rule, flat(c.evidence.map((e) => e.quote).join(" ")))) c.rule = null;
  }
}
