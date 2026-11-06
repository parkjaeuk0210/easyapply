"use client";

import { createContext, useContext } from "react";
import type { Analysis, Evidence } from "@/lib/schema";
import type { Located } from "@/lib/textmatch";
import { daysUntil, mainDeadline, shortDate, todayLocalISO } from "@/lib/dates";

// ── 날짜 ────────────────────────────────────────────────────────

/** "2026-05-17" → "5월 17일(일)". 올해가 아니면 연도를 붙인다. */
export function koDate(iso: string | null | undefined, weekday = true) {
  const short = shortDate(iso)?.match(/^(\d+)\/(\d+)(\(.\))$/);
  if (!iso || !short) return null;
  const year = iso.slice(0, 4) === todayLocalISO().slice(0, 4) ? "" : `${iso.slice(0, 4)}년 `;
  return `${year}${short[1]}월 ${short[2]}일${weekday ? short[3] : ""}`;
}

/** 접수 마감을 사람이 읽는 한 줄로. 마감일을 못 찾으면 null. */
export function deadlineInfo(a: Analysis) {
  const deadline = mainDeadline(a);
  const days = daysUntil(deadline?.date_iso);
  if (!deadline || days === null) return null;
  if (days < 0) return { expired: true, days, text: `이 공고는 ${koDate(deadline.date_iso, false)}에 접수가 끝났어요.`, left: null };
  return {
    expired: false,
    days,
    text: `${koDate(deadline.date_iso)}${deadline.time ? ` ${deadline.time}` : ""}까지 신청`,
    left: days === 0 ? "오늘 마감" : `${days}일 남았어요`,
  };
}

// ── 근거(원문) 컨텍스트 ─────────────────────────────────────────

type EvidenceCtx = {
  locate: (e: Evidence) => Located;
  show: (group: Evidence[]) => void;
  activeId: string | null;
  /** PDF·사진처럼 쪽 번호가 실제 쪽과 같은지 */
  paged: boolean;
};
export const EvidenceContext = createContext<EvidenceCtx>({
  locate: (e) => ({ status: "unknown", page: e.page, items: [], ranges: {} }),
  show: () => {},
  activeId: null,
  paged: true,
});

export const evidenceId = (group: Evidence[]) => group.map((e) => `${e.page}|${e.quote}`).join("\n");

/** 항목마다 "원문 보기" 버튼 하나. 근거가 여러 쪽에 걸칠 때만 쪽마다 버튼을 나눈다. */
export function EvidenceLinks({ evidence, className = "" }: { evidence: Evidence[]; className?: string }) {
  const { locate, show, activeId, paged } = useContext(EvidenceContext);
  if (!evidence?.length) return null;
  const groups = new Map<number, { evidence: Evidence[]; missing: boolean }>();
  for (const e of evidence) {
    const loc = locate(e);
    const group = groups.get(loc.page) ?? { evidence: [], missing: true };
    group.evidence.push(e);
    group.missing &&= loc.status === "none";
    groups.set(loc.page, group);
  }
  const list = [...groups.entries()];
  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-2 ${className}`}>
      {list.map(([page, g], i) => {
        const id = evidenceId(g.evidence);
        const label = list.length === 1 ? "원문 보기" : paged ? `원문 ${page}쪽` : `원문 보기 ${i + 1}`;
        return (
          <span key={id} className="inline-flex items-center gap-2">
            <button
              type="button"
              onClick={() => show(g.evidence)}
              title={g.evidence.map((e) => `“${e.quote}”`).join("\n")}
              className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition ${
                activeId === id
                  ? "border-brand bg-brand-soft text-brand-ink"
                  : "border-line bg-surface text-ink-2 hover:border-brand/50 hover:text-brand-ink"
              }`}
            >
              {label}
            </button>
            {g.missing && <span className="text-sm text-muted">원문에서 못 찾았어요</span>}
          </span>
        );
      })}
    </div>
  );
}

// ── 기본 조각 ───────────────────────────────────────────────────

export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-line bg-surface ${className}`}>{children}</div>;
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="mb-3 text-[17px] font-bold tracking-tight text-ink">{children}</h3>;
}

export const STATUS = {
  met: { label: "충족", className: "text-ok" },
  check: { label: "확인 필요", className: "text-warn" },
  not_met: { label: "미충족", className: "text-bad" },
};

export function Logo() {
  return (
    <span className="inline-flex items-center gap-2">
      <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden>
        <rect width="26" height="26" rx="7.5" fill="var(--brand)" />
        <path d="M7.5 6.5h7.2l3.8 3.8v9.2h-11z" fill="#fff" fillOpacity=".95" />
        <path d="M10 14.2l2.1 2.1 4-4.3" stroke="var(--brand)" strokeWidth="1.9" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="text-[17px] font-extrabold tracking-tight text-ink">
        Easy<span className="text-brand">Apply</span>
      </span>
    </span>
  );
}

export function Spinner({ className = "" }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} width="16" height="16" viewBox="0 0 16 16" aria-hidden>
      <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeOpacity=".2" strokeWidth="2" fill="none" />
      <path d="M14.5 8A6.5 6.5 0 0 0 8 1.5" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />
    </svg>
  );
}
