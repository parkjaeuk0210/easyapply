import { z } from "zod";
import { MAX_DOCUMENT_PAGES } from "./document-limits";

const text = () => z.string().max(4000);
const label = () => z.string().min(1).max(300);
const id = () => z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/);
const date = () => z.iso.date().nullable();

/**
 * 근거(원문 인용). page는 1부터 시작하는 PDF 쪽 번호(이미지라면 업로드한 이미지 순번).
 * quote는 공고문에 적힌 문장을 그대로 옮긴 짧은 구절이어야 한다 — 화면에서 원문과 대조해 하이라이트한다.
 */
export const EvidenceSchema = z.object({
  page: z.number().int().min(1).max(MAX_DOCUMENT_PAGES),
  // Missing citations remain visible and are marked unverified by the server.
  quote: z.string().max(1000),
});

const withEvidence = { evidence: z.array(EvidenceSchema).max(10) };

/** 'AI 맞춤 공고 찾기'가 규칙으로 비교하는 값의 목록. 화면 문구는 src/lib/finder.ts에 있다. */
export const EDUCATION = ["middle_or_less", "hs_student", "hs_grad", "college_student", "college_leave", "college_grad", "grad_school"] as const;
export const EMPLOYMENT = ["unemployed", "employee", "part_time", "self_employed"] as const;
export const TOPICS = ["jobs", "housing", "startup", "education", "living", "health", "culture", "other"] as const;

const maybe = <T extends z.ZodType>(t: T) => t.nullable().optional();
/**
 * 자격 조건을 코드로 비교할 수 있게 옮긴 값. 모델은 조건이 이 형식으로 정확히 옮겨질 때만 채우고,
 * 서버(sanitizeRules)는 숫자·지역명이 그 조건의 원문 인용에 없으면 지운다.
 */
export const RuleSchema = z.object({
  type: z.enum(["age", "birth_date", "region", "education", "employment", "income"]),
  min_age: maybe(z.number().int()),
  max_age: maybe(z.number().int()),
  age_basis_date: maybe(z.iso.date()),
  born_from: maybe(z.iso.date()),
  born_to: maybe(z.iso.date()),
  regions: z.array(z.string().max(60)).max(30).optional(),
  min_residence_months: maybe(z.number().int()),
  education: z.array(z.enum(EDUCATION)).max(EDUCATION.length).optional(),
  employment: z.array(z.enum(EMPLOYMENT)).max(EMPLOYMENT.length).optional(),
  median_pct_max: maybe(z.number()),
  income_max_won: maybe(z.number().int()),
  income_period: maybe(z.enum(["month", "year"])),
  income_basis: maybe(z.enum(["household", "personal"])),
  has_exception: z.boolean().prefault(false),
});

export const AnalysisSchema = z.object({
  title: label(),
  organization: label().nullable(),
  category: label(),
  one_line: label(),
  summary: z.array(text()).min(1).max(10),
  benefits: z.array(z.object({ text: text(), ...withEvidence })).max(50),
  schedule: z.array(
    z.object({
      label: label(),
      date_text: text(),
      date_iso: date(),
      time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).nullable(),
      is_deadline: z.boolean(),
      is_application_deadline: z.boolean().prefault(false),
      // 예전 호환용. 서버는 접수 마감을 추정하지 않으므로 항상 false.
      deadline_inferred: z.boolean().prefault(false).describe("서버 전용 값. 항상 false로 두세요."),
      // 서버가 채우는 값: date_iso가 date_text와 맞지 않아 비운 경우 true.
      date_uncertain: z.boolean().prefault(false).describe("서버 전용 값. 항상 false로 두세요."),
      ...withEvidence,
    }),
  ).max(50),
  how_to_apply: z.array(z.object({ text: text(), ...withEvidence })).max(50),
  eligibility: z.array(
    z.object({
      id: id(),
      category: label(),
      kind: z.enum(["required", "exclusion", "preference"]),
      requirement: text(),
      detail: text().nullable(),
      // 특정 대상(예: 제약기업 지원자)에게만 붙는 조건이면 그 대상. 모두에게 적용되면 null.
      applies_to: z.string().max(300).nullable().prefault(null),
      rule: RuleSchema.nullish(),
      ...withEvidence,
    }),
  ).max(80),
  documents: z.array(
    z.object({
      id: id(),
      name: label(),
      necessity: z.enum(["required", "conditional", "optional"]),
      condition: text().nullable(),
      how_to_get: text().nullable(),
      tip: text().nullable(),
      ...withEvidence,
    }),
  ).max(80),
  cautions: z.array(
    z.object({ text: text(), severity: z.enum(["high", "normal"]), ...withEvidence }),
  ).max(50),
  glossary: z.array(z.object({ term: label(), plain: text(), ...withEvidence })).max(30),
  profile_questions: z.array(
    z.object({
      id: id(),
      label: label(),
      input: z.enum(["number", "date", "select", "multi", "yes_no", "text"]),
      options: z.array(label()).max(30),
      unit: label().nullable(),
      help: text().nullable(),
      criteria_ids: z.array(id()).max(80),
    }),
  ).max(8),
  contact: text().nullable(),
  contact_evidence: z.array(EvidenceSchema).max(10).prefault([]),
  reading_notes: text().nullable(),
  topics: z.array(z.enum(TOPICS)).max(3).prefault([]),
  transcript: z.array(z.object({ page: z.number().int().min(1).max(MAX_DOCUMENT_PAGES), text: z.string().max(30_000) })).max(MAX_DOCUMENT_PAGES),
  // 서버 전용: 인용 검증 뒤 서버가 정하는 공고 전체 접수 상태와 기준 마감일. 판정과 화면이 이 값만 쓴다.
  application_status: z.enum(["open", "closed", "unknown"]).prefault("unknown").describe("서버 전용 값. 항상 unknown으로 두세요."),
  application_deadline_iso: date().prefault(null).describe("서버 전용 값. 항상 null로 두세요."),
});

export const MatchSchema = z.object({
  overall: z.enum(["likely_eligible", "needs_check", "likely_ineligible"]),
  overall_message: text(),
  criteria: z.array(
    z.object({
      criterion_id: id(),
      status: z.enum(["met", "not_met", "check"]),
      reason: text(),
      how_to_check: text().nullable(),
      failed_answer_ids: z.array(id()).max(8).prefault([]),
    }),
  ).max(80),
  next_searches: z.array(z.object({
    criterion_id: id(),
    advice: text(),
    query: label(),
  })).max(8).prefault([]),
  checklist: z.array(
    z.object({
      id: id(),
      title: label(),
      detail: text().nullable(),
      kind: z.enum(["document", "verify", "apply", "schedule"]),
      due_date_iso: date(),
      document_id: id().nullable(),
      priority: z.enum(["high", "normal"]),
    }),
  ).max(100),
});

export type Evidence = z.infer<typeof EvidenceSchema>;
export type Analysis = z.infer<typeof AnalysisSchema>;
export type Match = z.infer<typeof MatchSchema>;
export type ProfileQuestion = Analysis["profile_questions"][number];
export type Criterion = Analysis["eligibility"][number];
export type Rule = z.infer<typeof RuleSchema>;
export type Education = typeof EDUCATION[number];
export type Employment = typeof EMPLOYMENT[number];
export type Topic = typeof TOPICS[number];

/** 구조화 출력(Claude API output_config / Claude CLI --json-schema)에 넘길 JSON Schema. */
export function toOutputSchema(schema: z.ZodType): Record<string, unknown> {
  const raw = z.toJSONSchema(schema, { target: "draft-2020-12", io: "output" }) as Record<
    string,
    unknown
  >;
  return strip(raw) as Record<string, unknown>;
}

// 구조화 출력이 지원하지 않는 숫자 범위 제약과 $schema 표기를 제거한다.
function strip(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(strip);
  if (node && typeof node === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node)) {
      if (["$schema", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "minLength", "maxLength", "minItems", "maxItems", "pattern"].includes(k)) continue;
      out[k] = strip(v);
    }
    return out;
  }
  return node;
}

/** 사용자가 입력한 답변: 질문 id → 값 */
export type Answers = Record<string, string>;
