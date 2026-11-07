"use client";

import { useEffect, useRef, useState } from "react";
import { MatchSchema, type Analysis, type Answers, type Criterion, type Match, type ProfileQuestion } from "@/lib/schema";
import { contentKey, errorMessage, responseJson } from "@/lib/client-api";
import { buildIcs, daysUntil, download, todayLocalISO } from "@/lib/dates";
import { Card, deadlineInfo, EvidenceLinks, koDate, SectionTitle, Spinner, STATUS } from "./ui";

type Props = {
  a: Analysis;
  docKey: string;
  match: Match | null;
  answers: Answers;
  extra: string;
  onAnswers: (a: Answers) => void;
  onExtra: (s: string) => void;
  onMatch: (m: Match | null) => void;
  canRunAI: boolean;
  analysisToken?: string | null;
  /** 판정을 기다리는 동안 다른 탭으로 못 가게 부모에 알린다 */
  onBusy?: (busy: boolean) => void;
};

const UNSURE = "잘 모르겠어요";

export default function ProfileCheck(props: Props) {
  const { a, match } = props;
  const [editing, setEditing] = useState(!match);
  const [fresh, setFresh] = useState(false);

  return (
    <div className="space-y-4">
      {editing || !match ? (
        <ProfileForm {...props} onDone={() => { setFresh(true); setEditing(false); }} />
      ) : (
        <MatchResult
          a={a}
          match={match}
          answers={props.answers}
          extra={props.extra}
          docKey={props.docKey}
          fresh={fresh}
          onShown={() => setFresh(false)}
          onEdit={() => setEditing(true)}
        />
      )}
    </div>
  );
}

// ── 입력 폼 ─────────────────────────────────────────────────────

function ProfileForm({ a, answers, extra, onAnswers, onExtra, onMatch, canRunAI, analysisToken, onBusy, onDone }: Props & { onDone: () => void }) {
  const [busy, setBusyState] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => {
    request.current?.abort();
    onBusy?.(false);
  }, [onBusy]);

  const setBusy = (value: boolean) => {
    setBusyState(value);
    onBusy?.(value);
  };
  const filled = a.profile_questions.filter((q) => answers[q.id]?.trim()).length;
  const set = (id: string, v: string) => onAnswers({ ...answers, [id]: v });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (request.current) return;
    setError(null);
    if (!filled && !extra.trim()) {
      setError("질문에 하나 이상 답해 주세요.");
      return;
    }
    if (!canRunAI) {
      setError("지금은 확인할 수 없어요. 잠시 후 다시 시도해 주세요.");
      return;
    }
    setBusy(true);
    const controller = new AbortController(); request.current = controller;
    try {
      const res = await fetch("/api/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ analysis: a, analysis_token: analysisToken ?? undefined, answers, extra }),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(285_000)]),
      });
      const j = await responseJson(res);
      if (controller.signal.aborted) return;
      onMatch(MatchSchema.parse(j.match));
      onDone();
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(errorMessage(err));
    } finally {
      if (request.current === controller) request.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4" aria-busy={busy}>
      <fieldset disabled={busy} className="space-y-4">
        <Card className="p-5">
          <h2 className="text-[19px] font-bold tracking-tight text-ink">몇 가지만 답해 주세요</h2>
          <p className="mt-1 text-[16px] leading-relaxed text-ink-2">모르는 건 비워 둬도 돼요.</p>
        </Card>

        {a.profile_questions.map((q) => (
          <Card key={q.id} className="p-5">
            <p id={`${q.id}-label`} className="text-[16px] font-semibold leading-relaxed text-ink">{q.label}</p>
            {q.help && <p id={`${q.id}-help`} className="mt-1 text-[15px] leading-relaxed text-ink-2">{q.help}</p>}
            <div className="mt-3">
              <QuestionInput q={q} value={answers[q.id] ?? ""} onChange={(v) => set(q.id, v)} />
            </div>
          </Card>
        ))}

        <Card className="p-5">
          <label className="block text-[16px] font-semibold text-ink" htmlFor="extra">
            더 알려 줄 상황 <span className="font-normal text-muted">(선택)</span>
          </label>
          <textarea
            id="extra"
            value={extra}
            onChange={(e) => onExtra(e.target.value)}
            rows={3}
            maxLength={2000}
            placeholder="예: 다음 달에 이사 예정이에요"
            className="mt-2 w-full resize-y rounded-xl border border-line bg-surface-2 px-3.5 py-2.5 text-[16px] outline-none transition focus:border-brand focus:bg-surface"
          />
        </Card>

        {error && <div role="alert" className="rounded-xl bg-bad-soft px-4 py-3 text-[16px] leading-relaxed text-bad">{error}</div>}

        <div className="sticky bottom-0 z-10 -mx-1 bg-gradient-to-t from-bg via-bg to-bg/0 px-1 pb-3 pt-4">
          <button
            type="submit"
            disabled={busy}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-brand px-5 py-4 text-[17px] font-bold text-white shadow-[0_8px_24px_rgba(47,91,231,.28)] transition hover:bg-brand-ink disabled:opacity-80"
          >
            {busy ? <><Spinner /> 확인하고 있어요…</> : "신청할 수 있는지 확인하기"}
          </button>
        </div>
      </fieldset>
      <p role="status" className="sr-only">{busy ? "확인하고 있어요. 1분쯤 걸릴 수 있어요." : ""}</p>
      {busy && (
        <button
          type="button"
          className="text-[15px] font-medium text-ink-2 underline underline-offset-2"
          onClick={() => { request.current?.abort(); request.current = null; setBusy(false); }}
        >
          취소
        </button>
      )}
    </form>
  );
}

function QuestionInput({ q, value, onChange }: { q: ProfileQuestion; value: string; onChange: (v: string) => void }) {
  const labelled = { "aria-labelledby": `${q.id}-label`, "aria-describedby": q.help ? `${q.id}-help` : undefined };
  const base =
    "w-full rounded-xl border border-line bg-surface-2 px-3.5 py-2.5 text-[16px] outline-none transition focus:border-brand focus:bg-surface";

  if (q.input === "select" || q.input === "yes_no") {
    const opts = q.input === "yes_no" ? ["예", "아니오", UNSURE] : withUnsure(q.options);
    return (
      <div className="flex flex-wrap gap-2" role="radiogroup" {...labelled}>
        {opts.map((o) => (
          <Choice key={o} on={value === o} onClick={() => onChange(value === o ? "" : o)}>
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
      <div className="flex flex-col gap-2" role="group" {...labelled}>
        {opts.map((o) => {
          const on = picked.includes(o);
          return (
            <label
              key={o}
              className={`flex cursor-pointer items-center gap-3 rounded-xl border px-3.5 py-3 text-[16px] leading-snug transition ${
                on ? "border-brand bg-brand-soft font-semibold text-brand-ink" : "border-line bg-surface text-ink-2 hover:border-line-strong"
              }`}
            >
              <input type="checkbox" checked={on} onChange={() => toggle(o)} className="h-5 w-5 shrink-0 accent-[var(--brand)]" />
              {o}
            </label>
          );
        })}
      </div>
    );
  }
  if (q.input === "number") {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="number"
          inputMode="decimal"
          value={value === UNSURE ? "" : value}
          {...labelled}
          onChange={(e) => onChange(e.target.value)}
          className={`${base} max-w-[220px]`}
        />
        {q.unit && <span className="text-[16px] text-ink-2">{q.unit}</span>}
        <Choice on={value === UNSURE} onClick={() => onChange(value === UNSURE ? "" : UNSURE)} toggle>
          모름
        </Choice>
      </div>
    );
  }
  if (q.input === "date") {
    return <input type="date" {...labelled} value={value} onChange={(e) => onChange(e.target.value)} className={`${base} max-w-[220px]`} />;
  }
  return <input type="text" {...labelled} maxLength={2000} value={value} onChange={(e) => onChange(e.target.value)} className={base} />;
}

function withUnsure(options: string[]) {
  return options.some((o) => o.includes("모르")) ? options : [...options, UNSURE];
}

function Choice({ on, onClick, children, toggle }: { on: boolean; onClick: () => void; children: React.ReactNode; toggle?: boolean }) {
  return (
    <button
      type="button"
      role={toggle ? undefined : "radio"}
      aria-checked={toggle ? undefined : on}
      aria-pressed={toggle ? on : undefined}
      onClick={onClick}
      className={`inline-flex rounded-xl border px-4 py-2.5 text-[16px] leading-snug transition ${
        on ? "border-brand bg-brand-soft font-semibold text-brand-ink ring-1 ring-brand" : "border-line bg-surface font-medium text-ink-2 hover:border-line-strong"
      }`}
    >
      {children}
    </button>
  );
}

// ── 판정 + 체크리스트 ────────────────────────────────────────────

const OVERALL = {
  likely_eligible: "신청할 수 있을 것 같아요",
  needs_check: "확인이 더 필요해요",
  likely_ineligible: "이 공고는 신청 대상이 아닐 가능성이 커요",
};
const DISCLAIMER = "AI가 정리한 내용이라 틀릴 수 있어요. 최종 자격은 기관 심사로 정해져요.";

type Result = Match["criteria"][number];

/** 조건 종류에 맞춰 결과를 낱말 하나로 */
function verdictWord(c: Criterion | undefined, r: Result) {
  if (r.status === "check") return STATUS.check;
  if (c?.kind === "preference") return r.status === "met" ? { label: "우대 대상", className: "text-ok" } : { label: "우대 대상 아님", className: "text-ink-2" };
  if (c?.kind === "exclusion") return r.status === "met" ? { label: "해당 없음", className: "text-ok" } : { label: "제외 대상", className: "text-bad" };
  return STATUS[r.status];
}

// 지난 일정은 캘린더에 넣지 않고, 일정 제목의 기호도 뺀다.
function upcomingIcs(ics: string) {
  const today = todayLocalISO().replace(/-/g, "");
  const now = Date.now();
  const kept = ics
    .replace(/BEGIN:VEVENT\r\n[\s\S]*?END:VEVENT\r\n/g, (event) => {
      const day = event.match(/\r\nDTSTART;VALUE=DATE:(\d{8})/);
      if (day) return day[1] >= today ? event : "";
      const t = event.match(/\r\nDTSTART:(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/);
      if (t) return Date.UTC(+t[1], +t[2] - 1, +t[3], +t[4], +t[5], +t[6]) >= now ? event : "";
      return event;
    })
    .replace(/^(SUMMARY|DESCRIPTION):(?:⏰|☑) /gm, "$1:");
  return kept.includes("BEGIN:VEVENT") ? kept : null;
}

function MatchResult({ a, match, answers, extra, docKey, fresh, onShown, onEdit }: {
  a: Analysis; match: Match; answers: Answers; extra: string; docKey: string; fresh: boolean; onShown: () => void; onEdit: () => void;
}) {
  const storeKey = `easyapply:done:${docKey}:${contentKey(match.checklist)}`;
  const [done, setDone] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(localStorage.getItem(storeKey) || "{}");
    } catch {
      return {};
    }
  });
  const [copied, setCopied] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const toggle = (id: string) => setDone((prev) => ({ ...prev, [id]: !prev[id] }));
  useEffect(() => {
    try {
      localStorage.setItem(storeKey, JSON.stringify(done));
    } catch {}
  }, [done, storeKey]);

  // 판정이 막 나왔으면 결론으로 옮겨 읽게 한다.
  useEffect(() => {
    if (!fresh) return;
    const title = titleRef.current;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    title?.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
    title?.focus({ preventScroll: true });
    onShown();
  }, [fresh, onShown]);

  const crit = new Map(a.eligibility.map((c) => [c.id, c]));
  const docs = new Map(a.documents.map((d) => [d.id, d]));
  const order = { not_met: 0, check: 1, met: 2 };
  const sorted = [...match.criteria].sort((x, y) => order[x.status] - order[y.status]);
  const main = sorted.filter((r) => crit.get(r.criterion_id)?.kind !== "preference");
  const preferences = sorted.filter((r) => crit.get(r.criterion_id)?.kind === "preference");
  const failed = main.filter((r) => r.status === "not_met");
  const searches = match.overall === "likely_ineligible"
    ? failed.map((r) => ({ r, s: match.next_searches.find((s) => s.criterion_id === r.criterion_id) }))
    : [];
  const deadline = deadlineInfo(a);
  const hasUpcoming = [...a.schedule.map((s) => s.date_iso), ...match.checklist.map((t) => t.due_date_iso)]
    .some((iso) => (daysUntil(iso) ?? -1) >= 0);

  function addToCalendar() {
    const ics = upcomingIcs(buildIcs(a, match));
    if (!ics) { setNotice("캘린더에 넣을 일정이 없어요."); return; }
    download("easyapply-일정.ics", ics, "text/calendar;charset=utf-8");
  }

  function copyText() {
    const lines = [a.title];
    if (deadline) lines.push(deadline.text);
    lines.push("", OVERALL[match.overall], match.overall_message, DISCLAIMER, "", "조건별 결과");
    [...main, ...preferences].forEach((r) => {
      const c = crit.get(r.criterion_id);
      lines.push(`- ${c?.requirement ?? r.criterion_id}: ${verdictWord(c, r).label}`, `  ${r.reason}`);
      if (r.how_to_check) lines.push(`  확인 방법: ${r.how_to_check}`);
    });
    const suggestions = searches.filter((x) => x.s);
    if (suggestions.length) {
      lines.push("", "다른 공고를 찾을 때");
      suggestions.forEach(({ s }) => lines.push(`- ${s!.advice}`, `  검색어 예시: ${s!.query}`));
    }
    lines.push("", "신청 준비 체크리스트");
    match.checklist.forEach((t, i) => {
      const due = koDate(t.due_date_iso, false);
      lines.push(`${i + 1}. ${t.title}${due ? ` (${due}까지)` : ""}${done[t.id] ? " - 완료" : ""}`);
      if (t.detail) lines.push(`   ${t.detail.replace(/\n/g, "\n   ")}`);
    });
    const fail = () => setNotice("복사하지 못했어요. 인쇄하기를 이용해 주세요.");
    if (!navigator.clipboard) { fail(); return; }
    navigator.clipboard.writeText(lines.join("\n")).then(() => {
      setNotice(null);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }).catch(fail);
  }

  const row = (r: Result) => {
    const c = crit.get(r.criterion_id);
    const word = verdictWord(c, r);
    const failedHere = r.status === "not_met" && c?.kind !== "preference";
    const ids = r.failed_answer_ids.length ? r.failed_answer_ids : a.profile_questions.filter((q) => q.criteria_ids.includes(r.criterion_id)).map((q) => q.id);
    const inputs = failedHere ? a.profile_questions.filter((q) => ids.includes(q.id) && answers[q.id]?.trim()) : [];
    return (
      <li key={r.criterion_id} className="py-4 first:pt-0 last:pb-0">
        <p className={`text-[15px] font-bold ${word.className}`}>{word.label}</p>
        <p className="mt-0.5 text-[16px] font-medium leading-relaxed text-ink">{c?.requirement ?? r.criterion_id}</p>
        <p className="mt-1 text-[15px] leading-relaxed text-ink-2">{r.reason}</p>
        {inputs.length > 0 && (
          <p className="mt-1 break-words text-[15px] leading-relaxed text-ink-2">
            내 답변: {inputs.map((q) => `${q.label} ${answers[q.id]}${q.unit ? ` ${q.unit}` : ""}`).join(" / ")}
          </p>
        )}
        {r.how_to_check && (
          <p className="mt-1 text-[15px] leading-relaxed text-ink-2">
            <span className="font-semibold text-ink">확인 방법: </span>
            {r.how_to_check}
          </p>
        )}
        {c && <EvidenceLinks evidence={c.evidence} className="no-print mt-2" />}
      </li>
    );
  };

  return (
    <div className="print-area space-y-4">
      <section aria-labelledby="verdict-title" className="rounded-2xl border border-line bg-surface p-5 sm:p-6">
        <div className="hidden print:mb-4 print:block">
          <p className="text-lg font-bold">{a.title}</p>
          {deadline && <p>{deadline.text}</p>}
        </div>
        <h2 id="verdict-title" ref={titleRef} tabIndex={-1} className="scroll-mt-36 text-[22px] font-extrabold leading-snug tracking-tight text-ink outline-none">
          {OVERALL[match.overall]}
        </h2>
        <p className="mt-2 text-[16px] leading-relaxed text-ink-2">{match.overall_message}</p>
        <p className="mt-2 text-[16px] leading-relaxed text-ink-2">{DISCLAIMER}</p>
        <button type="button" onClick={onEdit} className="no-print mt-4 rounded-xl border border-line px-4 py-2 text-[15px] font-semibold text-ink-2 hover:bg-surface-2">
          답변 고치기
        </button>
      </section>

      <Card className="p-5">
        <SectionTitle>조건별 결과</SectionTitle>
        <ul className="divide-y divide-line">{main.map(row)}</ul>
        {preferences.length > 0 && (
          <>
            <h4 className="mb-3 mt-6 text-[16px] font-bold text-ink">해당하면 유리한 조건</h4>
            <ul className="divide-y divide-line">{preferences.map(row)}</ul>
          </>
        )}
      </Card>

      {searches.length > 0 && (
        <Card className="p-5">
          <SectionTitle>다른 공고를 찾을 때</SectionTitle>
          <ul className="space-y-3">
            {searches.map(({ r, s }) => (
              <li key={r.criterion_id} className="rounded-xl bg-surface-2 px-4 py-3">
                <p className="text-[15px] font-semibold text-ink">{crit.get(r.criterion_id)?.requirement}</p>
                <p className="mt-1 text-[15px] leading-relaxed text-ink-2">{s?.advice ?? "이 조건이 다른 공고를 찾아보세요."}</p>
                {s && <p className="mt-2 break-words text-[15px] text-ink-2">검색어 예시: <span className="font-semibold text-ink">{s.query}</span></p>}
              </li>
            ))}
          </ul>
          <details className="no-print mt-3 rounded-xl border border-line px-4 py-3 text-[15px]">
            <summary className="cursor-pointer font-semibold text-ink-2">내가 답한 내용</summary>
            <dl className="mt-3 space-y-2 leading-relaxed">
              {a.profile_questions.filter((q) => answers[q.id]?.trim()).map((q) => (
                <div key={q.id}>
                  <dt className="text-muted">{q.label}</dt>
                  <dd className="break-words font-medium text-ink">{answers[q.id]}{q.unit ? ` ${q.unit}` : ""}</dd>
                </div>
              ))}
              {extra.trim() && <div><dt className="text-muted">더 알려 준 상황</dt><dd className="whitespace-pre-wrap break-words text-ink">{extra}</dd></div>}
            </dl>
          </details>
        </Card>
      )}

      <Card className="p-5">
        <SectionTitle>신청 준비 체크리스트</SectionTitle>
        {/* 모델이 낸 순서 그대로 한 목록으로 보여 준다(종류별로 다시 묶지 않는다). */}
        <ul className="divide-y divide-line">
          {match.checklist.map((t) => {
            const doc = t.document_id ? docs.get(t.document_id) : null;
            const due = koDate(t.due_date_iso);
            const past = (daysUntil(t.due_date_iso) ?? 0) < 0;
            return (
              <li key={t.id} className="flex gap-3 py-3">
                <input
                  id={`task-${t.id}`}
                  type="checkbox"
                  checked={!!done[t.id]}
                  onChange={() => toggle(t.id)}
                  className="mt-1 h-5 w-5 shrink-0 accent-[var(--ok)]"
                />
                <div className="min-w-0 flex-1">
                  <label htmlFor={`task-${t.id}`} className={`cursor-pointer text-[16px] font-semibold ${done[t.id] ? "text-muted line-through" : "text-ink"}`}>
                    {t.title}
                    {t.priority === "high" && !done[t.id] && <span className="ml-2 text-[14px] font-semibold text-bad">중요</span>}
                  </label>
                  {t.detail && <p className="mt-0.5 whitespace-pre-line text-[15px] leading-relaxed text-ink-2">{t.detail}</p>}
                  {due && <p className="mt-1 text-[14px] text-ink-2">{due}까지{past ? " (지났어요)" : ""}</p>}
                  {doc && <EvidenceLinks evidence={doc.evidence} className="no-print mt-2" />}
                </div>
              </li>
            );
          })}
        </ul>
        <div className="no-print mt-5 flex flex-wrap gap-2 border-t border-line pt-4">
          {hasUpcoming && <ActionBtn onClick={addToCalendar}>캘린더에 추가</ActionBtn>}
          <ActionBtn onClick={copyText}>{copied ? "복사했어요" : "복사하기"}</ActionBtn>
          <ActionBtn onClick={() => window.print()}>인쇄하기</ActionBtn>
        </div>
        {notice && <p role="alert" className="no-print mt-2 text-[15px] text-bad">{notice}</p>}
      </Card>
    </div>
  );
}

function ActionBtn({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-xl border border-line bg-surface px-4 py-2.5 text-[15px] font-semibold text-ink-2 transition hover:border-line-strong hover:bg-surface-2"
    >
      {children}
    </button>
  );
}
