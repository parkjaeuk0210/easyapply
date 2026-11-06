"use client";

import type { Analysis } from "@/lib/schema";
import { contactParts } from "@/lib/contact";
import { Card, EvidenceLinks, SectionTitle } from "./ui";

function Empty({ children }: { children: React.ReactNode }) {
  return <Card className="px-5 py-8 text-center text-[16px] leading-relaxed text-ink-2">{children}</Card>;
}

function TextList({ items }: { items: Analysis["benefits"] }) {
  return (
    <ul className="divide-y divide-line">
      {items.map((item, i) => (
        <li key={i} className="py-3.5 text-[16px] leading-relaxed text-ink first:pt-0 last:pb-0">
          <p>{item.text}</p>
          <EvidenceLinks evidence={item.evidence} className="mt-2" />
        </li>
      ))}
    </ul>
  );
}

// ── 한눈에 보기 ─────────────────────────────────────────────────

export function OverviewPanel({ a }: { a: Analysis }) {
  return (
    <div className="space-y-4">
      <Card className="p-5">
        <SectionTitle>요약</SectionTitle>
        <ul className="list-disc space-y-2 pl-5 text-[16px] leading-relaxed text-ink marker:text-muted">
          {a.summary.map((s, i) => <li key={i}>{s}</li>)}
        </ul>
      </Card>

      {a.benefits.length > 0 && (
        <Card className="p-5">
          <SectionTitle>무엇을 받을 수 있나요</SectionTitle>
          <TextList items={a.benefits} />
        </Card>
      )}

      {a.schedule.length > 0 && (
        <Card className="p-5">
          <SectionTitle>일정</SectionTitle>
          <ul className="divide-y divide-line">
            {a.schedule.map((s, i) => (
              <li key={i} className="py-3.5 first:pt-0 last:pb-0">
                <p className="text-[16px] font-semibold text-ink">{s.label}</p>
                <p className="mt-0.5 text-[16px] text-ink-2">{s.date_text}</p>
                <EvidenceLinks evidence={s.evidence} className="mt-2" />
              </li>
            ))}
          </ul>
        </Card>
      )}

      {a.how_to_apply.length > 0 && (
        <Card className="p-5">
          <SectionTitle>신청 방법</SectionTitle>
          <TextList items={a.how_to_apply} />
        </Card>
      )}

      {a.reading_notes && (
        <Card className="p-5">
          <SectionTitle>더 확인할 점</SectionTitle>
          <p className="text-[16px] leading-relaxed text-ink">{a.reading_notes}</p>
        </Card>
      )}

      {a.contact && (
        <Card className="p-5">
          <SectionTitle>문의처</SectionTitle>
          <p className="whitespace-pre-wrap text-[16px] leading-relaxed text-ink">
            {contactParts(a.contact).map((part, i) => part.href ? (
              <a key={i} href={part.href} className="font-semibold text-brand-ink underline underline-offset-2">{part.text}</a>
            ) : <span key={i}>{part.text}</span>)}
          </p>
          {a.contact_evidence?.length > 0 && <EvidenceLinks evidence={a.contact_evidence} className="mt-2" />}
        </Card>
      )}
    </div>
  );
}

// ── 신청 자격 ───────────────────────────────────────────────────

const KIND_TITLE = {
  required: "꼭 맞아야 하는 조건",
  exclusion: "이런 경우는 신청할 수 없어요",
  preference: "해당하면 유리한 조건",
} as const;

export function EligibilityPanel({ a }: { a: Analysis }) {
  if (!a.eligibility.length) return <Empty>신청 자격을 찾지 못했어요. 원문에서 직접 확인해 주세요.</Empty>;
  return (
    <div className="space-y-4">
      {(["required", "exclusion", "preference"] as const).map((kind) => {
        const list = a.eligibility.filter((c) => c.kind === kind);
        if (!list.length) return null;
        return (
          <Card key={kind} className="p-5">
            <SectionTitle>{KIND_TITLE[kind]}</SectionTitle>
            <ul className="divide-y divide-line">
              {list.map((c) => (
                <li key={c.id} className="py-3.5 first:pt-0 last:pb-0">
                  <p className="text-[16px] font-medium leading-relaxed text-ink">{c.requirement}</p>
                  {c.detail && <p className="mt-1 text-[15px] leading-relaxed text-ink-2">{c.detail}</p>}
                  <EvidenceLinks evidence={c.evidence} className="mt-2" />
                </li>
              ))}
            </ul>
          </Card>
        );
      })}
    </div>
  );
}

// ── 제출 서류 ───────────────────────────────────────────────────

const NEED = {
  required: "꼭 내야 하는 서류",
  conditional: "해당하는 사람만 내는 서류",
  optional: "선택 서류",
} as const;

export function DocumentsPanel({ a }: { a: Analysis }) {
  if (!a.documents.length) return <Empty>제출 서류를 찾지 못했어요. 원문에서 직접 확인해 주세요.</Empty>;
  return (
    <div className="space-y-4">
      {(["required", "conditional", "optional"] as const).map((need) => {
        const list = a.documents.filter((d) => d.necessity === need);
        if (!list.length) return null;
        return (
          <Card key={need} className="p-5">
            <SectionTitle>{NEED[need]}</SectionTitle>
            <ul className="divide-y divide-line">
              {list.map((d) => (
                <li key={d.id} className="py-3.5 first:pt-0 last:pb-0">
                  <p className="text-[16px] font-semibold text-ink">{d.name}</p>
                  <dl className="mt-1 space-y-1 text-[15px] leading-relaxed text-ink-2">
                    {d.condition && <Row term="대상">{d.condition}</Row>}
                    {d.how_to_get && <Row term="받는 곳">{d.how_to_get}</Row>}
                    {d.tip && <Row term="주의">{d.tip}</Row>}
                  </dl>
                  <EvidenceLinks evidence={d.evidence} className="mt-2" />
                </li>
              ))}
            </ul>
          </Card>
        );
      })}
    </div>
  );
}

function Row({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <dt className="w-14 shrink-0 text-muted">{term}</dt>
      <dd>{children}</dd>
    </div>
  );
}

// ── 주의 사항 ───────────────────────────────────────────────────

export function CautionsPanel({ a }: { a: Analysis }) {
  if (!a.cautions.length) return <Empty>따로 적힌 주의 사항을 찾지 못했어요.</Empty>;
  const sorted = [...a.cautions].sort((x, y) => Number(y.severity === "high") - Number(x.severity === "high"));
  return (
    <Card className="p-5">
      <SectionTitle>주의 사항</SectionTitle>
      <ul className="divide-y divide-line">
        {sorted.map((c, i) => (
          <li key={i} className="py-3.5 text-[16px] leading-relaxed text-ink first:pt-0 last:pb-0">
            <p className={c.severity === "high" ? "font-semibold" : undefined}>{c.text}</p>
            <EvidenceLinks evidence={c.evidence} className="mt-2" />
          </li>
        ))}
      </ul>
    </Card>
  );
}

// ── 용어 풀이 ───────────────────────────────────────────────────

export function GlossaryPanel({ a }: { a: Analysis }) {
  if (!a.glossary.length) return <Empty>따로 풀어 설명할 용어가 없어요.</Empty>;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {a.glossary.map((g, i) => (
        <Card key={i} className="p-5">
          <p className="text-[16px] font-bold text-ink">{g.term}</p>
          <p className="mt-1 text-[15px] leading-relaxed text-ink-2">{g.plain}</p>
          <EvidenceLinks evidence={g.evidence} className="mt-2" />
        </Card>
      ))}
    </div>
  );
}
