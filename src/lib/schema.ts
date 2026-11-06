import { z } from "zod";

/**
 * 근거(원문 인용). page는 1부터 시작하는 PDF 쪽 번호(이미지라면 업로드한 이미지 순번).
 * quote는 공고문에 적힌 문장을 그대로 옮긴 짧은 구절이어야 한다 — 화면에서 원문과 대조해 하이라이트한다.
 */
export const EvidenceSchema = z.object({
  page: z.number(),
  quote: z.string(),
});

const withEvidence = { evidence: z.array(EvidenceSchema) };

export const AnalysisSchema = z.object({
  title: z.string(),
  organization: z.string().nullable(),
  category: z.string(),
  one_line: z.string(),
  summary: z.array(z.string()),
  benefits: z.array(z.object({ text: z.string(), ...withEvidence })),
  schedule: z.array(
    z.object({
      label: z.string(),
      date_text: z.string(),
      date_iso: z.string().nullable(),
      time: z.string().nullable(),
      is_deadline: z.boolean(),
      ...withEvidence,
    }),
  ),
  how_to_apply: z.array(z.object({ text: z.string(), ...withEvidence })),
  eligibility: z.array(
    z.object({
      id: z.string(),
      category: z.string(),
      kind: z.enum(["required", "exclusion", "preference"]),
      requirement: z.string(),
      detail: z.string().nullable(),
      ...withEvidence,
    }),
  ),
  documents: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      necessity: z.enum(["required", "conditional", "optional"]),
      condition: z.string().nullable(),
      how_to_get: z.string().nullable(),
      tip: z.string().nullable(),
      ...withEvidence,
    }),
  ),
  cautions: z.array(
    z.object({ text: z.string(), severity: z.enum(["high", "normal"]), ...withEvidence }),
  ),
  glossary: z.array(z.object({ term: z.string(), plain: z.string(), ...withEvidence })),
  profile_questions: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      input: z.enum(["number", "date", "select", "multi", "yes_no", "text"]),
      options: z.array(z.string()),
      unit: z.string().nullable(),
      help: z.string().nullable(),
      criteria_ids: z.array(z.string()),
    }),
  ),
  contact: z.string().nullable(),
  reading_notes: z.string().nullable(),
  transcript: z.array(z.object({ page: z.number(), text: z.string() })),
});

export const MatchSchema = z.object({
  overall: z.enum(["likely_eligible", "needs_check", "likely_ineligible"]),
  overall_message: z.string(),
  criteria: z.array(
    z.object({
      criterion_id: z.string(),
      status: z.enum(["met", "not_met", "check"]),
      reason: z.string(),
      how_to_check: z.string().nullable(),
    }),
  ),
  checklist: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      detail: z.string().nullable(),
      kind: z.enum(["document", "verify", "apply", "schedule"]),
      due_date_iso: z.string().nullable(),
      document_id: z.string().nullable(),
      priority: z.enum(["high", "normal"]),
    }),
  ),
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
      if (k === "$schema" || k === "minimum" || k === "maximum") continue;
      out[k] = strip(v);
    }
    return out;
  }
  return node;
}

/** 사용자가 입력한 답변: 질문 id → 값 */
export type Answers = Record<string, string>;
