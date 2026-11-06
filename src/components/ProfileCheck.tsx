"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MatchSchema, type Analysis, type Answers, type Match, type ProfileQuestion } from "@/lib/schema";
import { contentKey, responseJson } from "@/lib/client-api";
import { buildIcs, daysUntil, ddayLabel, download, mainDeadline, shortDate } from "@/lib/dates";
import { Card, EvidenceChips, Pill, SectionTitle, Spinner, StatusPill, STATUS } from "./ui";

type Props = {
  a: Analysis;
  docKey: string;
  match: Match | null;
  answers: Answers;
  extra: string;
  onAnswers: (a: Answers) => void;
  onExtra: (s: string) => void;
  onMatch: (m: Match | null) => void;
  /** 샘플 체험 + AI 미연결일 때 쓸 미리 계산된 결과 */
  demoMatch?: { answers: Answers; match: Match } | null;
  canRunAI: boolean;
  analysisToken?: string | null;
  sample?: boolean;
};

const UNSURE = "잘 모르겠어요";

export default function ProfileCheck(props: Props) {
  const { a, match } = props;
  const [editing, setEditing] = useState(!match);

  return (
    <div className="space-y-4">
      {editing || !match ? (
        <ProfileForm {...props} onDone={() => setEditing(false)} />
      ) : (
        <MatchResult a={a} match={match} docKey={props.docKey} onEdit={() => setEditing(true)} />
      )}
    </div>
  );
}

// ── 입력 폼 ─────────────────────────────────────────────────────

function ProfileForm({ a, answers, extra, onAnswers, onExtra, onMatch, demoMatch, canRunAI, analysisToken, sample, onDone }: Props & { onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);

  useEffect(() => {
    if (!busy) return;
    const t0 = Date.now();
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 1000);
    return () => clearInterval(id);
  }, [busy]);

  const filled = a.profile_questions.filter((q) => answers[q.id]?.trim()).length;
  const set = (id: string, v: string) => onAnswers({ ...answers, [id]: v });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (request.current) return;
    setError(null);
    const sameAsDemo =
      !!demoMatch &&
      !extra.trim() &&
      a.profile_questions.every((q) => (answers[q.id] ?? "") === (demoMatch.answers[q.id] ?? ""));
    if (sameAsDemo) {
      // 샘플 + 예시 답변 그대로면 미리 계산해 둔 결과를 바로 보여준다.
      onMatch(demoMatch!.match);
      onDone();
      return;
    }
    if (!canRunAI) {
      setError(
        demoMatch
          ? "지금은 AI가 연결되지 않아 미리 준비한 예시 답변의 결과만 보여드릴 수 있어요. ‘예시 답변 채우기’를 눌러 주세요."
          : "지금은 AI 분석을 이용할 수 없어요. 잠시 후 다시 시도해 주세요.",
      );
      return;
    }
    setBusy(true);
    const controller = new AbortController(); request.current = controller;
    try {
      const res = await fetch("/api/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...(sample ? { sample: true } : { analysis: a, analysis_token: analysisToken ?? undefined }), answers, extra }),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(285_000)]),
      });
      const j = await responseJson(res);
      if (controller.signal.aborted) return;
      onMatch(MatchSchema.parse(j.match));
      onDone();
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (request.current === controller) request.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <fieldset disabled={busy} className="space-y-4">
      <Card className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-[17px] font-bold tracking-tight text-ink">나도 신청할 수 있을까?</h3>
            <p className="mt-1 text-[13.5px] leading-relaxed text-ink-2">
              이 공고문의 자격 조건에 맞춰 만든 질문이에요. 아는 만큼만 답해도 돼요 — 모르는 항목은 ‘확인 필요’로 알려드려요.
            </p>
          </div>
          <span className="shrink-0 text-xs font-semibold text-muted">
            {filled}/{a.profile_questions.length}
          </span>
        </div>
        {demoMatch && (
          <button
            type="button"
            onClick={() => onAnswers({ ...demoMatch.answers })}
            className="mt-3 rounded-lg border border-dashed border-brand/50 px-3 py-1.5 text-[12.5px] font-semibold text-brand-ink hover:bg-brand-soft"
          >
            예시 답변 채우기
          </button>
        )}
      </Card>

      {a.profile_questions.map((q, i) => (
        <Card key={q.id} className="p-5">
          <label className="block">
            <span className="flex gap-2 text-[14.5px] font-semibold leading-relaxed text-ink">
              <span className="text-brand">Q{i + 1}.</span>
              <span>{q.label}</span>
            </span>
            {q.help && <span className="mt-1 block text-[13px] leading-relaxed text-muted">{q.help}</span>}
          </label>
          <div className="mt-3">
            <QuestionInput q={q} value={answers[q.id] ?? ""} onChange={(v) => set(q.id, v)} />
          </div>
        </Card>
      ))}

      <Card className="p-5">
        <label className="block text-[14.5px] font-semibold text-ink" htmlFor="extra">
          그 밖에 알려주고 싶은 상황 <span className="font-normal text-muted">(선택)</span>
        </label>
        <textarea
          id="extra"
          value={extra}
          onChange={(e) => onExtra(e.target.value)}
          rows={3}
          maxLength={2000}
          placeholder="예: 다음 달에 이사 예정이에요 / 월세를 현금으로 내고 있어요"
          className="mt-2 w-full resize-y rounded-xl border border-line bg-surface-2 px-3.5 py-2.5 text-[14.5px] outline-none transition focus:border-brand focus:bg-surface"
        />
      </Card>

      {error && <div role="alert" className="rounded-xl bg-bad-soft px-4 py-3 text-[13.5px] text-bad">{error}</div>}

      <div className="sticky bottom-0 z-10 -mx-1 bg-gradient-to-t from-bg via-bg to-bg/0 px-1 pb-3 pt-4">
        <button
          type="submit"
          disabled={busy}
          className="flex w-full items-center justify-center gap-2 rounded-2xl bg-brand px-5 py-4 text-[15.5px] font-bold text-white shadow-[0_8px_24px_rgba(47,91,231,.28)] transition hover:bg-brand-ink disabled:opacity-80"
        >
          {busy ? (
            <>
              <Spinner /> 공고문 조건과 비교하는 중… {elapsed}초
            </>
          ) : (
            "내 조건으로 확인하기"
          )}
        </button>
      </div>
      </fieldset>
      {busy && <button type="button" className="text-sm text-muted underline" onClick={() => { request.current?.abort(); request.current = null; setBusy(false); }}>비교 취소</button>}
      <p className="text-center text-[11.5px] text-muted">입력한 정보는 AI 제공자에게 분석을 위해 전송돼요. EasyApply 서버에는 저장하지 않아요.</p>
    </form>
  );
}

function QuestionInput({ q, value, onChange }: { q: ProfileQuestion; value: string; onChange: (v: string) => void }) {
  const base =
    "w-full rounded-xl border border-line bg-surface-2 px-3.5 py-2.5 text-[15px] outline-none transition focus:border-brand focus:bg-surface";

  if (q.input === "select" || q.input === "yes_no") {
    const opts = q.input === "yes_no" ? ["예", "아니오", UNSURE] : withUnsure(q.options);
    return (
      <div className="flex flex-wrap gap-2" role="radiogroup">
        {opts.map((o) => (
          <Choice key={o} on={value === o} onClick={() => onChange(value === o ? "" : o)} role="radio">
            {o}
          </Choice>
        ))}
      </div>
    );
  }
  if (q.input === "multi") {
    const picked = value ? value.split(" | ") : [];
    const none = q.options.find((o) => /해당\s*없음/.test(o)) ?? "해당 없음";
    const opts = q.options.includes(none) ? q.options : [...q.options, none];
    const toggle = (o: string) => {
      let next = picked.includes(o) ? picked.filter((p) => p !== o) : [...picked, o];
      if (o === none && next.includes(none)) next = [none];
      else next = next.filter((p) => p !== none || o === none);
      onChange(next.join(" | "));
    };
    return (
      <div className="flex flex-col gap-2">
        {opts.map((o) => (
          <Choice key={o} on={picked.includes(o)} onClick={() => toggle(o)} role="checkbox" block>
            <span
              aria-hidden
              className={`mr-2.5 inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] border text-[11px] ${
                picked.includes(o) ? "border-brand bg-brand text-white" : "border-line-strong bg-white"
              }`}
            >
              {picked.includes(o) ? "✓" : ""}
            </span>
            {o}
          </Choice>
        ))}
      </div>
    );
  }
  if (q.input === "number") {
    return (
      <div className="flex items-center gap-2">
        <input
          type="number"
          inputMode="decimal"
          value={value === UNSURE ? "" : value}
          aria-label={q.label}
          onChange={(e) => onChange(e.target.value)}
          className={`${base} max-w-[220px]`}
          placeholder="숫자 입력"
        />
        {q.unit && <span className="text-[14.5px] text-ink-2">{q.unit}</span>}
        <Choice on={value === UNSURE} onClick={() => onChange(value === UNSURE ? "" : UNSURE)} small>
          모름
        </Choice>
      </div>
    );
  }
  if (q.input === "date") {
    return <input type="date" aria-label={q.label} value={value} onChange={(e) => onChange(e.target.value)} className={`${base} max-w-[220px]`} />;
  }
  return <input type="text" aria-label={q.label} maxLength={2000} value={value} onChange={(e) => onChange(e.target.value)} className={base} placeholder="직접 입력" />;
}

function withUnsure(options: string[]) {
  return options.some((o) => o.includes("모르")) ? options : [...options, UNSURE];
}

function Choice({
  on,
  onClick,
  children,
  role,
  block,
  small,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
  role?: string;
  block?: boolean;
  small?: boolean;
}) {
  return (
    <button
      type="button"
      role={role}
      aria-checked={on}
      onClick={onClick}
      className={`${block ? "flex w-full items-center text-left" : "inline-flex"} rounded-xl border ${
        small ? "px-3 py-2 text-[13px]" : "px-3.5 py-2.5 text-[14px]"
      } font-medium leading-snug transition ${
        on ? "border-brand bg-brand-soft text-brand-ink" : "border-line bg-surface text-ink-2 hover:border-line-strong"
      }`}
    >
      {children}
    </button>
  );
}

// ── 결과 + 체크리스트 ────────────────────────────────────────────

const OVERALL = {
  likely_eligible: { title: "신청할 수 있을 가능성이 높아요", cls: "bg-ok-soft text-ok border-ok/25" },
  needs_check: { title: "몇 가지만 확인하면 돼요", cls: "bg-warn-soft text-warn border-warn/25" },
  likely_ineligible: { title: "이번 공고는 신청이 어려워 보여요", cls: "bg-bad-soft text-bad border-bad/25" },
};

const KIND = {
  verify: { label: "자격 확인", order: 0 },
  document: { label: "서류 준비", order: 1 },
  apply: { label: "신청하기", order: 2 },
  schedule: { label: "기억할 일정", order: 3 },
};

function MatchResult({ a, match, docKey, onEdit }: { a: Analysis; match: Match; docKey: string; onEdit: () => void }) {
  const storeKey = `easyapply:done:${docKey}:${contentKey(match.checklist)}`;
  const [done, setDone] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(localStorage.getItem(storeKey) || "{}");
    } catch {
      return {};
    }
  });
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const toggle = (id: string) => setDone((prev) => ({ ...prev, [id]: !prev[id] }));
  useEffect(() => {
    try {
      localStorage.setItem(storeKey, JSON.stringify(done));
    } catch {}
  }, [done, storeKey]);

  const crit = new Map(a.eligibility.map((c) => [c.id, c]));
  const docs = new Map(a.documents.map((d) => [d.id, d]));
  const counts = { met: 0, check: 0, not_met: 0 };
  match.criteria.forEach((c) => counts[c.status]++);
  const ordered = useMemo(
    () => [...match.criteria].sort((x, y) => order(x.status) - order(y.status)),
    [match.criteria],
  );
  const total = match.checklist.length;
  const doneCount = match.checklist.filter((t) => done[t.id]).length;
  const deadline = mainDeadline(a);
  const dd = daysUntil(deadline?.date_iso);
  const o = OVERALL[match.overall];

  function copyText() {
    const lines = [`[EasyApply] ${a.title}`, deadline ? `마감: ${deadline.date_text}` : "", "", "신청 준비 체크리스트"];
    match.checklist.forEach((t, i) => {
      lines.push(`${done[t.id] ? "☑" : "☐"} ${i + 1}. ${t.title}${t.due_date_iso ? ` (~${shortDate(t.due_date_iso)})` : ""}`);
      if (t.detail) lines.push(`    ${t.detail}`);
    });
    if (!navigator.clipboard) { setCopyError("이 브라우저에서는 복사를 지원하지 않아요. 인쇄 또는 PDF 저장을 이용해 주세요."); return; }
    navigator.clipboard.writeText(lines.filter((l, i) => l || i > 1).join("\n")).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }).catch(() => setCopyError("복사 권한을 확인해 주세요. 인쇄 또는 PDF 저장도 사용할 수 있어요."));
  }

  return (
    <div className="space-y-4">
      <div className={`rounded-2xl border px-5 py-4 ${o.cls}`}>
        <div className="text-[17px] font-extrabold tracking-tight">{o.title}</div>
        <p className="mt-1 text-[14px] leading-relaxed text-ink-2">{match.overall_message}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {(["met", "check", "not_met"] as const).map((s) => (
            <Pill key={s} tone={STATUS[s].tone} className="bg-white/70">
              {STATUS[s].label} {counts[s]}
            </Pill>
          ))}
          <button onClick={onEdit} className="ml-auto text-[13px] font-semibold text-ink-2 underline underline-offset-2">
            정보 수정
          </button>
        </div>
      </div>

      <Card className="p-5">
        <SectionTitle sub="확인이 필요한 것부터">조건별 결과</SectionTitle>
        <ul className="divide-y divide-line">
          {ordered.map((r) => {
            const c = crit.get(r.criterion_id);
            return (
              <li key={r.criterion_id} className="py-3.5 first:pt-0 last:pb-0">
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    {c && <div className="mb-0.5 text-[11.5px] font-semibold text-muted">{c.category}{c.kind === "exclusion" ? " · 제외 조건" : ""}</div>}
                    <div className="text-[14.5px] font-medium leading-relaxed text-ink">{c?.requirement ?? r.criterion_id}</div>
                  </div>
                  <StatusPill status={r.status} />
                </div>
                <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-2">{r.reason}</p>
                {r.how_to_check && (
                  <p className="mt-1 rounded-lg bg-warn-soft/60 px-3 py-2 text-[13px] leading-relaxed text-ink-2">
                    <span className="font-semibold text-warn">확인 방법 · </span>
                    {r.how_to_check}
                  </p>
                )}
                {c && <EvidenceChips evidence={c.evidence} className="mt-2" />}
              </li>
            );
          })}
        </ul>
      </Card>

      <Card className="print-area p-5">
        <div className="mb-1 hidden text-[13px] text-muted print:block">{a.title}</div>
        <SectionTitle sub={`${doneCount}/${total} 완료`}>나의 신청 준비 체크리스트</SectionTitle>
        <div className="no-print mb-4 h-2 overflow-hidden rounded-full bg-surface-2">
          <div className="h-full rounded-full bg-ok transition-all" style={{ width: `${total ? (doneCount / total) * 100 : 0}%` }} />
        </div>
        {deadline && (
          <div className="mb-4 flex items-center gap-2 rounded-xl bg-surface-2 px-3.5 py-2.5 text-[13.5px]">
            <span className="font-semibold text-ink">접수 마감</span>
            <span className="text-ink-2">{deadline.date_text}</span>
            {ddayLabel(dd) && <Pill tone={dd !== null && dd <= 7 ? "bad" : "warn"} className="ml-auto">{ddayLabel(dd)}</Pill>}
          </div>
        )}
        {(Object.keys(KIND) as (keyof typeof KIND)[]).map((k) => {
          const items = match.checklist.filter((t) => t.kind === k);
          if (!items.length) return null;
          return (
            <div key={k} className="mb-4 last:mb-0">
              <div className="mb-2 text-[12px] font-bold uppercase tracking-wide text-muted">{KIND[k].label}</div>
              <ul className="space-y-2">
                {items.map((t) => {
                  const doc = t.document_id ? docs.get(t.document_id) : null;
                  const d = daysUntil(t.due_date_iso);
                  return (
                    <li key={t.id} className={`rounded-xl border px-3.5 py-3 transition ${done[t.id] ? "border-line bg-surface-2" : "border-line bg-surface"}`}>
                      <div className="flex gap-3">
                        <button
                          type="button"
                          role="checkbox"
                          aria-checked={!!done[t.id]}
                          aria-label={t.title}
                          onClick={() => toggle(t.id)}
                          className={`mt-[1px] flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[7px] border-2 text-[12px] font-bold transition ${
                            done[t.id] ? "border-ok bg-ok text-white" : "border-line-strong bg-white hover:border-ok"
                          }`}
                        >
                          {done[t.id] ? "✓" : ""}
                        </button>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span className={`text-[14.5px] font-semibold ${done[t.id] ? "text-muted line-through" : "text-ink"}`}>{t.title}</span>
                            {t.priority === "high" && !done[t.id] && <Pill tone="bad">중요</Pill>}
                          </div>
                          {t.detail && <p className="mt-0.5 text-[13px] leading-relaxed text-ink-2">{t.detail}</p>}
                          <div className="mt-1.5 flex flex-wrap items-center gap-2">
                            {t.due_date_iso && (
                              <span className={`text-[12px] font-semibold ${d !== null && d <= 3 && !done[t.id] ? "text-bad" : "text-muted"}`}>
                                ~{shortDate(t.due_date_iso)}까지{ddayLabel(d) ? ` · ${ddayLabel(d)}` : ""}
                              </span>
                            )}
                            {doc && <EvidenceChips evidence={doc.evidence} className="no-print" />}
                          </div>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
        <div className="no-print mt-5 flex flex-wrap gap-2 border-t border-line pt-4">
          <ActionBtn onClick={() => download("easyapply-일정.ics", buildIcs(a, match), "text/calendar;charset=utf-8")}>📅 캘린더에 추가</ActionBtn>
          <ActionBtn onClick={copyText}>{copied ? "복사했어요" : "📋 텍스트로 복사"}</ActionBtn>
          <ActionBtn onClick={() => window.print()}>🖨 인쇄 / PDF</ActionBtn>
        </div>
        {copyError && <p role="alert" className="mt-2 text-sm text-bad">{copyError}</p>}
      </Card>

      <p className="px-1 text-[12px] leading-relaxed text-muted">
        AI 판단은 참고용이에요. 최종 자격은 기관 심사로 결정되니, ‘확인 필요’ 항목은 문의처에 꼭 확인해 주세요.
      </p>
    </div>
  );
}

function order(s: "met" | "check" | "not_met") {
  return { not_met: 0, check: 1, met: 2 }[s];
}

function ActionBtn({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-xl border border-line bg-surface px-3.5 py-2 text-[13px] font-semibold text-ink-2 transition hover:border-line-strong hover:bg-surface-2"
    >
      {children}
    </button>
  );
}
