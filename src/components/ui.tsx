"use client";

import { createContext, useContext } from "react";
import type { Evidence } from "@/lib/schema";
import type { Located } from "@/lib/textmatch";

// ── 근거(원문) 컨텍스트 ─────────────────────────────────────────

type EvidenceCtx = {
  locate: (e: Evidence) => Located;
  show: (e: Evidence) => void;
  activeQuote: string | null;
};
export const EvidenceContext = createContext<EvidenceCtx>({
  locate: (e) => ({ status: "unknown", page: e.page, items: [], ranges: {} }),
  show: () => {},
  activeQuote: null,
});

export function EvidenceChips({ evidence, className = "" }: { evidence: Evidence[]; className?: string }) {
  const { locate, show, activeQuote } = useContext(EvidenceContext);
  if (!evidence?.length) return null;
  return (
    <div className={`flex flex-wrap gap-1.5 ${className}`}>
      {evidence.map((e, i) => {
        const loc = locate(e);
        const on = activeQuote === e.quote;
        const mark = { exact: "✓", fuzzy: "≈", none: "?", unknown: "" }[loc.status];
        const tone = {
          exact: "text-ok",
          fuzzy: "text-warn",
          none: "text-bad",
          unknown: "text-muted",
        }[loc.status];
        return (
          <button
            key={i}
            type="button"
            onClick={() => show(e)}
            title={`“${e.quote}”`}
            className={`group inline-flex max-w-full items-center gap-1 rounded-md border px-2 py-[3px] text-[11.5px] font-medium transition ${
              on
                ? "border-brand bg-brand-soft text-brand-ink"
                : "border-line bg-surface-2 text-ink-2 hover:border-brand/40 hover:bg-brand-soft hover:text-brand-ink"
            }`}
          >
            <QuoteIcon />
            <span>원문 {loc.page}쪽</span>
            {mark && <span className={`${tone} font-bold`}>{mark}</span>}
          </button>
        );
      })}
    </div>
  );
}

// ── 기본 조각 ───────────────────────────────────────────────────

export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-line bg-surface ${className}`}>{children}</div>;
}

export function SectionTitle({ children, sub }: { children: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-3">
      <h3 className="text-[15px] font-bold tracking-tight text-ink">{children}</h3>
      {sub && <span className="text-xs text-muted">{sub}</span>}
    </div>
  );
}

type Tone = "brand" | "ok" | "warn" | "bad" | "neutral";
const TONES: Record<Tone, string> = {
  brand: "bg-brand-soft text-brand-ink",
  ok: "bg-ok-soft text-ok",
  warn: "bg-warn-soft text-warn",
  bad: "bg-bad-soft text-bad",
  neutral: "bg-surface-2 text-ink-2 border border-line",
};
export function Pill({ tone = "neutral", children, className = "" }: { tone?: Tone; children: React.ReactNode; className?: string }) {
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11.5px] font-semibold ${TONES[tone]} ${className}`}>
      {children}
    </span>
  );
}

export const STATUS = {
  met: { label: "충족", tone: "ok" as Tone, icon: "✓" },
  check: { label: "확인 필요", tone: "warn" as Tone, icon: "?" },
  not_met: { label: "미충족", tone: "bad" as Tone, icon: "✕" },
};

export function StatusPill({ status }: { status: keyof typeof STATUS }) {
  const s = STATUS[status];
  return (
    <Pill tone={s.tone}>
      <span aria-hidden>{s.icon}</span>
      {s.label}
    </Pill>
  );
}

export function QuoteIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden className="shrink-0 opacity-70">
      <path
        d="M1.5 7.2C1.5 5 2.6 3.4 4.6 2.6l.4.8C3.9 4 3.4 4.8 3.3 5.7h1.6v3.8H1.5zm5.6 0c0-2.2 1.1-3.8 3.1-4.6l.4.8c-1.1.6-1.6 1.4-1.7 2.3h1.6v3.8H7.1z"
        fill="currentColor"
      />
    </svg>
  );
}

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
