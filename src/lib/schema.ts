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
  quote: z.string().min(2).max(1000),
});

const withEvidence = { evidence: z.array(EvidenceSchema).min(1).max(10) };

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
  transcript: z.array(z.object({ page: z.number().int().min(1).max(MAX_DOCUMENT_PAGES), text: z.string().max(30_000) })).max(MAX_DOCUMENT_PAGES),
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
