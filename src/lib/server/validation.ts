import { z } from "zod";
import { MatchSchema, type Analysis, type Answers, type Match } from "../schema";
import { AppError } from "./errors";

const invalidOutput = () => new AppError("bad_output", "AI 결과에 누락되거나 서로 맞지 않는 정보가 있어요. 다시 분석해 주세요.", 502);
function unique(values: (string | number)[]) { return new Set(values).size === values.length; }

export function validateAnalysis(a: Analysis, pageCount?: number) {
  if (![a.eligibility, a.documents, a.profile_questions].every((items) => unique(items.map((i) => i.id)))) throw invalidOutput();
  const ids = new Set(a.eligibility.map((c) => c.id));
  for (const q of a.profile_questions) {
    if (!q.criteria_ids.length || !unique(q.criteria_ids) || q.criteria_ids.some((id) => !ids.has(id))) throw invalidOutput();
    if (!unique(q.options) || q.options.some((o) => o.includes(" | "))) throw invalidOutput();
    if (["multi", "select"].includes(q.input) && !q.options.length) throw invalidOutput();
  }
  if (!unique(a.transcript.map((t) => t.page))) throw invalidOutput();
  const evidence = [...a.benefits, ...a.schedule, ...a.how_to_apply, ...a.eligibility, ...a.documents, ...a.cautions, ...a.glossary].flatMap((i) => i.evidence);
  if (pageCount && [...evidence, ...a.transcript].some((e) => e.page > pageCount)) throw invalidOutput();
}

const unsure = (s: string) => /모르|확인\s*필요/.test(s);

export function validateAnswers(a: Analysis, answers: Answers): Answers {
  const questions = new Map(a.profile_questions.map((q) => [q.id, q]));
  const output: Answers = {};
  for (const [id, raw] of Object.entries(answers)) {
    const q = questions.get(id), value = raw.trim();
    const bad = () => new AppError("invalid_answer", "답변 형식이 맞지 않아요. 날짜·숫자·선택 항목을 확인해 주세요.", 400);
    if (!q || value.length > 2000) throw bad();
    if (!value || value === "잘 모르겠어요") { output[id] = value; continue; }
    if (q.input === "date" && !z.iso.date().safeParse(value).success) throw bad();
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

/** Semantic checks are deterministic; the model cannot override these decisions. */
export function finalizeMatch(a: Analysis, answers: Answers, match: Match, unverifiedCriteria: string[] = [], now = new Date()): Match {
  const ids = new Set(a.eligibility.map((c) => c.id));
  const docIds = new Set(a.documents.map((d) => d.id));
  if (!unique(match.criteria.map((c) => c.criterion_id)) || match.criteria.length !== ids.size ||
    match.criteria.some((c) => !ids.has(c.criterion_id)) || !unique(match.checklist.map((t) => t.id)) ||
    match.checklist.some((t) => t.document_id !== null && !docIds.has(t.document_id))) throw invalidOutput();

  const criteria = match.criteria.map((c) => {
    const related = a.profile_questions.filter((q) => q.criteria_ids.includes(c.criterion_id));
    const unanswered = !related.length || related.some((q) => !answers[q.id]?.trim() || unsure(answers[q.id]));
    const unverified = unverifiedCriteria.includes(c.criterion_id);
    if ((unanswered || unverified) && c.status !== "check") {
      return { ...c, status: "check" as const,
        reason: unverified ? "이 조건의 원문 근거나 표 구조를 자동으로 검증하지 못했어요." : "이 조건을 판단하는 데 필요한 답변이 부족하거나 불확실해요.",
        how_to_check: "공고문 원문과 관련 서류를 확인하고 담당 기관에 문의해 주세요." };
    }
    return c;
  });
  const required = criteria.filter((c) => a.eligibility.find((e) => e.id === c.criterion_id)?.kind !== "preference");
  const overall: Match["overall"] = required.some((c) => c.status === "not_met") ? "likely_ineligible"
    : !required.length || required.some((c) => c.status === "check") ? "needs_check" : "likely_eligible";
  const messages = {
    likely_ineligible: "필수 자격이나 제외 조건 중 맞지 않는 항목이 있어요. 해당 조건과 예외를 담당 기관에 확인해 주세요.",
    needs_check: "확인이 더 필요한 조건이 있어요. 아래 항목을 확인한 뒤 신청을 준비해 주세요.",
    likely_eligible: "입력한 정보로는 필수 자격과 제외 조건을 충족할 가능성이 있어요. 최종 자격은 기관 심사로 결정돼요.",
  };
  const deadlines = a.schedule.filter((s) => s.is_deadline && s.date_iso);
  const expired = deadlines.length > 0 && deadlines.every((s) => {
    const end = new Date(`${s.date_iso}T${s.time ?? "23:59"}:59+09:00`);
    return end.getTime() < now.getTime();
  });
  const checklist = [...match.checklist];
  // Required documents and a submit action must not silently disappear from AI output.
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
  const order = { verify: 0, document: 1, apply: 2, schedule: 3 };
  checklist.sort((x, y) => order[x.kind] - order[y.kind]);
  const result = MatchSchema.safeParse({ overall, overall_message: `${expired ? "공고문에 적힌 접수 마감일이 모두 지났어요. 추가 모집 여부를 확인해 주세요. " : ""}${messages[overall]}`, criteria, checklist });
  if (!result.success) throw invalidOutput();
  return result.data;
}
