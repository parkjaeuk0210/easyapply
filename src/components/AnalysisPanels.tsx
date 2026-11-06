"use client";

import type { Analysis, Match } from "@/lib/schema";
import { contactParts } from "@/lib/contact";
import { daysUntil, ddayLabel } from "@/lib/dates";
import { Card, EvidenceChips, Pill, SectionTitle, StatusPill } from "./ui";

function Empty({ children, hint = true }: { children: React.ReactNode; hint?: boolean }) {
  return (
    <Card className="px-5 py-8 text-center text-[14px] leading-relaxed text-muted">
      {children}
      {hint && <div className="mt-1 text-[13px]">공고문이 잘렸거나 다른 쪽에 있을 수 있어요. 원문 전체를 올렸는지 확인해 주세요.</div>}
    </Card>
  );
}

// ── 한눈에 보기 ─────────────────────────────────────────────────

export function OverviewPanel({ a }: { a: Analysis }) {
  return (
    <div className="space-y-4">
      <Card className="p-5">
        <SectionTitle>핵심만 먼저</SectionTitle>
        <ul className="space-y-2.5">
          {a.summary.map((s, i) => (
            <li key={i} className="flex gap-3 text-[14.5px] leading-relaxed text-ink">
              <span className="mt-[3px] flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-soft text-[11px] font-bold text-brand-ink">
                {i + 1}
              </span>
              <span>{s}</span>
            </li>
          ))}
        </ul>
      </Card>

      {a.benefits.length > 0 && (
        <Card className="p-5">
          <SectionTitle>무엇을 받을 수 있나요</SectionTitle>
          <ul className="space-y-3">
            {a.benefits.map((b, i) => (
              <li key={i} className="text-[14.5px] leading-relaxed">
                <div>{b.text}</div>
                <EvidenceChips evidence={b.evidence} className="mt-1.5" />
              </li>
            ))}
          </ul>
        </Card>
      )}

      {a.schedule.length > 0 && (
        <Card className="p-5">
          <SectionTitle>일정</SectionTitle>
          <ol className="relative ml-1.5 border-l-2 border-line">
            {a.schedule.map((s, i) => {
              const d = daysUntil(s.date_iso);
              const dd = ddayLabel(d);
              return (
                <li key={i} className="relative pb-4 pl-5 last:pb-0">
                  <span
                    className={`absolute -left-[7px] top-1.5 h-3 w-3 rounded-full border-2 border-surface ${
                      s.is_deadline ? "bg-bad" : "bg-line-strong"
                    }`}
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[14.5px] font-semibold text-ink">{s.label}</span>
                    {s.is_deadline && dd && (
                      <Pill tone={d !== null && d < 0 ? "neutral" : d !== null && d <= 7 ? "bad" : "warn"}>{dd}</Pill>
                    )}
                  </div>
                  <div className="mt-0.5 text-[13.5px] text-ink-2">{s.date_text}</div>
                  <EvidenceChips evidence={s.evidence} className="mt-1.5" />
                </li>
              );
            })}
          </ol>
        </Card>
      )}

      {a.how_to_apply.length > 0 && (
        <Card className="p-5">
          <SectionTitle>신청 방법</SectionTitle>
          <ul className="space-y-3">
            {a.how_to_apply.map((h, i) => (
              <li key={i} className="text-[14.5px] leading-relaxed">
                <div>{h.text}</div>
                <EvidenceChips evidence={h.evidence} className="mt-1.5" />
              </li>
            ))}
          </ul>
        </Card>
      )}

      {a.reading_notes && (
        <div className="rounded-2xl border border-warn/30 bg-warn-soft px-4 py-3 text-[13.5px] leading-relaxed text-warn">
          <span className="font-bold">AI가 읽으며 남긴 메모 · </span>
          {a.reading_notes}
        </div>
      )}

      {a.contact && (
        <Card className="p-5">
          <SectionTitle>문의처</SectionTitle>
          <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-ink-2">
            {contactParts(a.contact).map((part, i) => part.href ? (
              <a key={i} href={part.href} className="font-semibold text-brand-ink underline underline-offset-2">{part.text}</a>
            ) : <span key={i}>{part.text}</span>)}
          </p>
          {a.contact_evidence?.length > 0 && <EvidenceChips evidence={a.contact_evidence} className="mt-2" />}
        </Card>
      )}
    </div>
  );
}

// ── 신청 자격 ───────────────────────────────────────────────────

const KIND_TITLE = {
  required: { title: "꼭 충족해야 하는 조건", sub: "모두 해당돼야 신청할 수 있어요" },
  exclusion: { title: "이런 경우는 신청할 수 없어요", sub: "하나라도 해당하면 제외돼요" },
  preference: { title: "우대 조건", sub: "해당하면 유리해요" },
} as const;

export function EligibilityPanel({ a, match, onCheck }: { a: Analysis; match: Match | null; onCheck: () => void }) {
  const byId = new Map(match?.criteria.map((c) => [c.criterion_id, c]) ?? []);
  if (!a.eligibility.length) return <Empty>공고문에서 신청 자격 조건을 찾지 못했어요.</Empty>;
  return (
    <div className="space-y-4">
      {!match && (
        <button
          onClick={onCheck}
          className="flex w-full items-center justify-between gap-3 rounded-2xl bg-brand px-5 py-4 text-left text-white transition hover:bg-brand-ink"
        >
          <span>
            <span className="block text-[15px] font-bold">나도 신청할 수 있을까?</span>
            <span className="block text-[13px] text-white/80">내 정보를 넣으면 조건별로 충족 여부를 알려드려요</span>
          </span>
          <span aria-hidden className="text-xl">→</span>
        </button>
      )}
      {(["required", "exclusion", "preference"] as const).map((kind) => {
        const list = a.eligibility.filter((c) => c.kind === kind);
        if (!list.length) return null;
        return (
          <Card key={kind} className="p-5">
            <SectionTitle sub={KIND_TITLE[kind].sub}>{KIND_TITLE[kind].title}</SectionTitle>
            <ul className="space-y-3">
              {list.map((c) => {
                const r = byId.get(c.id);
                const disqualifying = kind !== "preference" && r?.status === "not_met";
                return (
                  <li key={c.id} className={`rounded-xl border p-3.5 ${disqualifying ? "border-bad/25 bg-bad-soft/70" : "border-line"}`}>
                    {disqualifying && <div className="mb-2 text-[12px] font-bold text-bad">{kind === "exclusion" ? "제외 조건에 해당" : "필수 자격 미충족"}</div>}
                    <div className="flex items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="mb-1 text-[11.5px] font-semibold text-muted">{c.category}</div>
                        <div className="text-[14.5px] font-medium leading-relaxed text-ink">{c.requirement}</div>
                        {c.detail && <div className="mt-1 text-[13.5px] leading-relaxed text-ink-2">{c.detail}</div>}
                      </div>
                      {r && (kind === "preference" && r.status === "not_met" ? <Pill tone="neutral">우대 대상 아님</Pill> : <StatusPill status={r.status} />)}
                    </div>
                    {r && (
                      <div className="mt-2 rounded-xl bg-surface-2 px-3 py-2 text-[13.5px] leading-relaxed text-ink-2">
                        {r.reason}
                        {r.how_to_check && <div className="mt-1 text-[13px] text-muted">확인 방법: {r.how_to_check}</div>}
                      </div>
                    )}
                    <EvidenceChips evidence={c.evidence} className="mt-2" />
                  </li>
                );
              })}
            </ul>
          </Card>
        );
      })}
    </div>
  );
}

// ── 제출 서류 ───────────────────────────────────────────────────

const NEED = {
  required: { label: "필수", tone: "brand" as const },
  conditional: { label: "해당자만", tone: "warn" as const },
  optional: { label: "선택", tone: "neutral" as const },
};

export function DocumentsPanel({ a }: { a: Analysis }) {
  const req = a.documents.filter((d) => d.necessity === "required").length;
  if (!a.documents.length) return <Empty>공고문에서 제출 서류 목록을 찾지 못했어요.</Empty>;
  return (
    <Card className="p-5">
      <SectionTitle sub={`필수 ${req}개 · 전체 ${a.documents.length}개`}>제출 서류</SectionTitle>
      <ul className="divide-y divide-line">
        {a.documents.map((d) => (
          <li key={d.id} className="py-3.5 first:pt-0 last:pb-0">
            <div className="flex flex-wrap items-center gap-2">
              <Pill tone={NEED[d.necessity].tone}>{NEED[d.necessity].label}</Pill>
              <span className="text-[14.5px] font-semibold text-ink">{d.name}</span>
            </div>
            <dl className="mt-1.5 space-y-1 text-[13.5px] leading-relaxed text-ink-2">
              {d.condition && (
                <div className="flex gap-2">
                  <dt className="w-12 shrink-0 text-muted">대상</dt>
                  <dd>{d.condition}</dd>
                </div>
              )}
              {d.how_to_get && (
                <div className="flex gap-2">
                  <dt className="w-12 shrink-0 text-muted">발급처</dt>
                  <dd>{d.how_to_get}</dd>
                </div>
              )}
              {d.tip && (
                <div className="flex gap-2">
                  <dt className="w-12 shrink-0 text-muted">주의</dt>
                  <dd>{d.tip}</dd>
                </div>
              )}
            </dl>
            <EvidenceChips evidence={d.evidence} className="mt-2" />
          </li>
        ))}
      </ul>
    </Card>
  );
}

// ── 주의 사항 ───────────────────────────────────────────────────

export function CautionsPanel({ a }: { a: Analysis }) {
  const sorted = [...a.cautions].sort((x, y) => Number(y.severity === "high") - Number(x.severity === "high"));
  if (!a.cautions.length) return <Empty>공고문에서 따로 적힌 주의 사항을 찾지 못했어요.</Empty>;
  return (
    <Card className="p-5">
      <SectionTitle sub="놓치면 탈락·환수될 수 있는 내용">주의 사항</SectionTitle>
      <ul className="space-y-3">
        {sorted.map((c, i) => (
          <li
            key={i}
            className={`rounded-xl px-4 py-3 text-[14.5px] leading-relaxed ${
              c.severity === "high" ? "bg-bad-soft/70" : "bg-surface-2"
            }`}
          >
            <div className="flex gap-2.5">
              <span
                aria-hidden
                className={`mt-[3px] flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                  c.severity === "high" ? "bg-bad text-white" : "bg-line-strong text-ink-2"
                }`}
              >
                !
              </span>
              <div className="min-w-0">
                <div className={c.severity === "high" ? "font-medium text-ink" : "text-ink"}>{c.text}</div>
                <EvidenceChips evidence={c.evidence} className="mt-1.5" />
              </div>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

// ── 용어 풀이 ───────────────────────────────────────────────────

export function GlossaryPanel({ a }: { a: Analysis }) {
  return (
    <div className="space-y-3">
      <p className="px-1 text-[13px] leading-relaxed text-muted">공고문에 실제 등장하며 신청 자격·서류·절차를 이해하는 데 필요한 행정·법률·소득 기준 용어를 골라 설명해요. 개수를 맞추려고 용어를 추가하지 않아요.</p>
      {!a.glossary.length ? <Empty hint={false}>이 기준에 따라 따로 풀어 설명할 용어를 찾지 못했어요.</Empty> : (
        <div className="grid gap-3 sm:grid-cols-2">
          {a.glossary.map((g, i) => (
            <Card key={i} className="p-4">
              <div className="text-[14.5px] font-bold text-ink">{g.term}</div>
              <p className="mt-1 text-[13.5px] leading-relaxed text-ink-2">{g.plain}</p>
              <EvidenceChips evidence={g.evidence} className="mt-2" />
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

