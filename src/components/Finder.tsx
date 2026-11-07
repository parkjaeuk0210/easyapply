"use client";

// 'AI 맞춤 공고 찾기': 내 상황 → 공고 최대 5개 → 추천 순서. 비교는 src/lib/finder.ts의 규칙 코드가 이 기기에서 한다.
import { useMemo, useRef, useState } from "react";
import { AnalysisSchema, type Analysis } from "@/lib/schema";
import { errorMessage, responseJson } from "@/lib/client-api";
import { cleanupUpload, uploadLargeFiles } from "@/lib/client-upload";
import { fileMediaType } from "@/lib/filetypes";
import { MAX_UPLOAD_BYTES } from "@/lib/limits";
import { todayLocalISO } from "@/lib/dates";
import {
  EDUCATION, EDUCATION_LABELS, EMPLOYMENT, EMPLOYMENT_LABELS, EMPTY_PROFILE, SIDO_OPTIONS, TOPICS, TOPIC_LABELS,
  evaluateNotice, rankNotices, type NoticeResult, type Profile, type SidoKey, type Status as RuleStatus, type Verdict,
} from "@/lib/finder";
import { deadlineInfo, Spinner } from "./ui";

export type AnalyzeResponse = {
  analysis: unknown; analysis_token?: string | null;
  verification?: { unverified_criteria?: string[]; flags?: string[] };
  source?: { kind: "text"; name: string; sections: { page: number; text: string }[]; warning: string };
  cached?: boolean; analyzed_at?: string;
};
type FinderStatus = { large_uploads?: boolean; max_direct_upload_bytes?: number; max_upload_bytes?: number };
type Item = { id: number; file: File; state: "ready" | "reading" | "done" | "failed"; error?: string; response?: AnalyzeResponse; analysis?: Analysis };

const MAX_FILES = 5;
const DOCS = ["application/pdf", "application/x-hwp", "application/hwp+zip"];
const field = "mt-1.5 w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 text-[16px] text-ink outline-none focus:border-brand";

async function analyzeOne(file: File, status: FinderStatus | null, signal: AbortSignal): Promise<AnalyzeResponse> {
  const staged = !!status?.large_uploads && file.size > (status.max_direct_upload_bytes ?? 4 * 1024 * 1024);
  const ticket = staged ? await uploadLargeFiles([file], AbortSignal.any([signal, AbortSignal.timeout(180_000)]), () => {}) : null;
  try {
    const body = new FormData(); body.append("files", file);
    const res = await fetch("/api/analyze", {
      method: "POST", body: ticket ? JSON.stringify({ upload_ticket: ticket }) : body,
      headers: ticket ? { "Content-Type": "application/json" } : undefined,
      signal: AbortSignal.any([signal, AbortSignal.timeout(285_000)]),
    });
    const j = await responseJson(res) as AnalyzeResponse;
    if (!j?.analysis) throw new Error("결과를 읽지 못했어요. 다시 해 보세요.");
    return j;
  } finally { if (ticket) cleanupUpload(ticket); }
}

function ago(iso?: string) {
  if (!iso) return "";
  const hours = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 3_600_000));
  return hours < 1 ? "1시간 안에" : hours < 24 ? `${hours}시간 전` : `${Math.round(hours / 24)}일 전`;
}

export default function Finder({ status, canRunAI, onOpen }: { status: FinderStatus | null; canRunAI: boolean; onOpen: (file: File, response: AnalyzeResponse, profile: Profile) => void }) {
  const [step, setStep] = useState<"profile" | "notices">("profile");
  const [profile, setProfile] = useState<Profile>(EMPTY_PROFILE);
  const [items, setItems] = useState<Item[]>([]);
  const [error, setError] = useState<string | null>(null);
  const nextId = useRef(1);
  const input = useRef<HTMLInputElement>(null);
  // 오늘 날짜는 결과가 생긴 뒤에만 읽는다(첫 화면은 미리 만들어 두는 화면이라 시각을 읽으면 안 된다).
  const today = items.some((i) => i.state === "done") ? todayLocalISO() : "";

  const set = <K extends keyof Profile>(key: K, value: Profile[K]) => setProfile((p) => ({ ...p, [key]: value }));
  const update = (id: number, patch: Partial<Item>) => setItems((list) => list.map((i) => (i.id === id ? { ...i, ...patch } : i)));

  // 공고마다 따로 분석하고, 모두 한꺼번에 보낸다(서버가 한 사람당 동시 실행 수를 제한한다).
  const run = (targets: Item[]) => {
    for (const item of targets) {
      update(item.id, { state: "reading", error: undefined });
      analyzeOne(item.file, status, new AbortController().signal)
        .then((response) => update(item.id, { state: "done", response, analysis: AnalysisSchema.parse(response.analysis) }))
        .catch((e) => update(item.id, { state: "failed", error: errorMessage(e) }));
    }
  };

  const add = (list: FileList | File[]) => {
    setError(null);
    const files = Array.from(list).map((f) => new File([f], f.name, { type: fileMediaType(f.name, f.type) }));
    if (!files.length) return;
    if (files.some((f) => !DOCS.includes(f.type))) return setError("PDF나 한글(HWP·HWPX) 공고 파일만 올릴 수 있어요. 사진 공고는 '공고문 분석'에서 확인해 주세요.");
    if (items.length + files.length > MAX_FILES) return setError(`공고는 한 번에 ${MAX_FILES}개까지 올릴 수 있어요.`);
    const limit = status?.max_upload_bytes ?? MAX_UPLOAD_BYTES;
    if (files.some((f) => f.size > limit)) return setError("너무 큰 파일이 있어요. 필요한 쪽만 따로 저장해서 올려 주세요.");
    if (!canRunAI) return setError("지금은 분석을 할 수 없어요. 잠시 후 다시 시도해 주세요.");
    // 고르기만 하고, '분석 시작'을 눌러야 읽기 시작한다.
    setItems((list) => [...list, ...files.map((file): Item => ({ id: nextId.current++, file, state: "ready" }))]);
  };
  const ready = items.filter((i) => i.state === "ready");

  const ranked = useMemo(() => rankNotices(
    items.filter((i) => i.state === "done" && i.analysis).map((i) => ({ item: i, result: evaluateNotice(i.analysis!, i.response?.verification?.flags ?? i.response?.verification?.unverified_criteria ?? [], profile, today) })),
    today,
  ), [items, profile, today]);
  const pending = items.filter((i) => i.state !== "done");

  if (step === "profile") return (
    <section aria-labelledby="finder-title" className="mx-auto max-w-[640px]">
      <h1 id="finder-title" className="text-[24px] font-extrabold leading-snug tracking-[-0.02em] text-ink sm:text-[30px]">내 상황을 적으면,<br />올린 공고 중 맞는 것부터 보여 드려요</h1>
      <p className="mt-3 text-[16px] leading-relaxed text-ink-2">모르는 건 비워 두셔도 돼요. 적은 내용은 이 기기에서 비교에만 쓰고 서버로 보내지 않아요.</p>
      <div className="mt-6 space-y-5 rounded-2xl border border-line bg-surface p-5 sm:p-6">
        <label className="block text-[16px] font-semibold text-ink">생년월일
          <input type="date" value={profile.birth ?? ""} onChange={(e) => set("birth", e.target.value || null)} className={field} />
        </label>
        <div>
          <p className="text-[16px] font-semibold text-ink">사는 곳</p>
          <div className="mt-1.5 grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] gap-2">
            <select aria-label="시·도" value={profile.sido ?? ""} onChange={(e) => set("sido", (e.target.value || null) as SidoKey | null)} className={`${field} mt-0`}>
              <option value="">시·도</option>
              {SIDO_OPTIONS.map((s) => <option key={s.key} value={s.key}>{s.name}</option>)}
            </select>
            <input aria-label="시·군·구" value={profile.sigungu} onChange={(e) => set("sigungu", e.target.value)} placeholder="예: 수원시 영통구" maxLength={40} className={`${field} mt-0`} />
          </div>
        </div>
        <label className="block text-[16px] font-semibold text-ink">학력·재학 상태
          <select value={profile.education ?? ""} onChange={(e) => set("education", (e.target.value || null) as Profile["education"])} className={field}>
            <option value="">고르지 않음</option>
            {EDUCATION.map((k) => <option key={k} value={k}>{EDUCATION_LABELS[k]}</option>)}
          </select>
        </label>
        <label className="block text-[16px] font-semibold text-ink">하는 일
          <select value={profile.employment ?? ""} onChange={(e) => set("employment", (e.target.value || null) as Profile["employment"])} className={field}>
            <option value="">고르지 않음</option>
            {EMPLOYMENT.map((k) => <option key={k} value={k}>{EMPLOYMENT_LABELS[k]}</option>)}
          </select>
        </label>
        <div>
          <p className="text-[16px] font-semibold text-ink">가구 소득 <span className="font-normal text-ink-2">(대략, 세금 떼기 전)</span></p>
          <div className="mt-1.5 grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] gap-2">
            <select aria-label="가구원 수" value={profile.householdSize ?? ""} onChange={(e) => set("householdSize", e.target.value ? Number(e.target.value) : null)} className={`${field} mt-0`}>
              <option value="">가구원 수</option>
              {[1, 2, 3, 4, 5, 6, 7].map((n) => <option key={n} value={n}>{n === 7 ? "7명 이상" : `${n}명`}</option>)}
            </select>
            <div className="flex items-center gap-2">
              <input aria-label="월 가구 소득(만 원)" inputMode="numeric" value={profile.monthlyIncome ?? ""} placeholder="모르면 비워 두세요"
                onChange={(e) => { const v = e.target.value.replace(/[^0-9]/g, ""); set("monthlyIncome", v ? Math.min(Number(v), 100_000) : null); }} className={`${field} mt-0 min-w-0`} />
              <span className="shrink-0 text-[15px] text-ink-2">만 원/월</span>
            </div>
          </div>
        </div>
        <fieldset>
          <legend className="text-[16px] font-semibold text-ink">관심 분야 <span className="font-normal text-ink-2">(여러 개 고를 수 있어요)</span></legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {TOPICS.filter((t) => t !== "other").map((t) => {
              const on = profile.topics.includes(t);
              return <button key={t} type="button" aria-pressed={on} onClick={() => set("topics", on ? profile.topics.filter((x) => x !== t) : [...profile.topics, t])}
                className={`rounded-full border px-3.5 py-2 text-[15px] font-semibold transition ${on ? "border-brand bg-brand-soft text-brand-ink" : "border-line text-ink-2 hover:bg-surface-2"}`}>{TOPIC_LABELS[t]}</button>;
            })}
          </div>
        </fieldset>
      </div>
      <button type="button" onClick={() => setStep("notices")} className="mt-5 w-full rounded-xl bg-brand px-6 py-3.5 text-[17px] font-bold text-white transition hover:bg-brand-ink">다음: 공고 올리기</button>
    </section>
  );

  return (
    <section aria-labelledby="finder-results" className="mx-auto max-w-[760px]">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <h1 id="finder-results" className="text-[24px] font-extrabold tracking-[-0.02em] text-ink sm:text-[28px]">{ranked.length ? "맞는 공고부터 보여 드려요" : "공고 파일을 올려 주세요"}</h1>
        <button type="button" onClick={() => setStep("profile")} className="rounded-xl border border-line px-3 py-2 text-[15px] font-semibold text-ink-2 hover:bg-surface-2">내 상황 고치기</button>
      </div>

      {items.length < MAX_FILES && (
        <div onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); add(e.dataTransfer.files); }}
          className="mt-4 rounded-2xl border-2 border-dashed border-line-strong bg-surface px-5 py-6 text-center">
          <p className="text-[16px] font-semibold text-ink">PDF·한글 공고를 {items.length ? `${MAX_FILES - items.length}개 더` : `${MAX_FILES}개까지`} 올릴 수 있어요</p>
          <p className="mt-1 text-[15px] text-ink-2">다 고른 뒤 &apos;분석 시작&apos;을 누르면 한꺼번에 읽어요.</p>
          <button type="button" onClick={() => input.current?.click()} className={`mt-3 rounded-xl px-6 py-3 text-[16px] font-bold transition ${ready.length ? "border border-line text-ink-2 hover:bg-surface-2" : "bg-brand text-white hover:bg-brand-ink"}`}>파일 선택</button>
          <input ref={input} type="file" multiple accept=".pdf,.hwp,.hwpx" className="hidden" onChange={(e) => { if (e.target.files) add(e.target.files); e.target.value = ""; }} />
        </div>
      )}
      <p className="mt-2 text-[14px] leading-relaxed text-ink-2">올린 파일은 분석에만 쓰고 이 서비스에 저장하지 않아요. 분석은 미국 Anthropic의 AI가 하고, 그쪽에서도 30일 안에 지워져요. 같은 파일을 다시 올리면 7일 동안은 지난 분석 결과를 다시 써요. 파일 자체는 저장하지 않아요.</p>
      {error && <p role="alert" className="mt-3 rounded-xl bg-bad-soft px-4 py-3 text-[16px] text-bad">{error}</p>}

      {pending.length > 0 && (
        <ul className="mt-4 space-y-2" aria-label="고른 공고">
          {pending.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3">
              {i.state === "reading" && <Spinner className="text-brand" />}
              <span className="min-w-0 flex-1 truncate text-[16px] text-ink">{i.file.name}</span>
              {i.state === "failed"
                ? <><span className="w-full text-[15px] text-bad sm:w-auto">{i.error}</span>
                  <button type="button" onClick={() => run([i])} className="rounded-lg border border-line px-3 py-1.5 text-[15px] font-semibold text-ink-2">다시 해 보기</button>
                  <button type="button" onClick={() => setItems((l) => l.filter((x) => x.id !== i.id))} className="text-[15px] text-ink-2 underline">빼기</button></>
                : i.state === "ready"
                  ? <button type="button" onClick={() => setItems((l) => l.filter((x) => x.id !== i.id))} className="text-[15px] text-ink-2 underline">빼기</button>
                  : <span className="text-[15px] text-ink-2">읽는 중…</span>}
            </li>
          ))}
        </ul>
      )}

      {ready.length > 0 && (
        <button type="button" onClick={() => run(ready)} className="mt-4 w-full rounded-xl bg-brand px-6 py-3.5 text-[17px] font-bold text-white transition hover:bg-brand-ink">
          분석 시작 ({ready.length}개) · 1분 안팎 걸려요
        </button>
      )}

      <ol className="mt-5 space-y-3">
        {ranked.map(({ item, result }, n) => <NoticeCard key={item.id} rank={n + 1} item={item} result={result} onOpen={() => onOpen(item.file, item.response!, profile)} />)}
      </ol>
      {ranked.length > 0 && <p className="mt-4 text-[15px] leading-relaxed text-ink-2">AI가 공고문에서 조건을 뽑고, 비교는 정해진 규칙으로 했어요. 최종 자격은 기관 심사로 정해져요.</p>}
    </section>
  );
}

const VERDICT: Record<Verdict, [string, string]> = {
  eligible: ["지원 가능", "bg-ok-soft text-ok"], check: ["추가 확인 필요", "bg-warn-soft text-warn"], ineligible: ["지원 불가", "bg-bad-soft text-bad"],
};
const STATUS: Record<RuleStatus, [string, string]> = { met: ["맞아요", "text-ok"], not_met: ["안 맞아요", "text-bad"], unknown: ["확인 필요", "text-warn"] };

function NoticeCard({ rank, item, result, onOpen }: { rank: number; item: Item; result: NoticeResult; onOpen: () => void }) {
  const a = item.analysis!;
  const deadline = deadlineInfo(a);
  const [label, tone] = a.application_status === "closed" ? ["접수 마감", "bg-bad-soft text-bad"] : VERDICT[result.verdict];
  const unit = item.file.type === "application/pdf" ? "쪽" : "구역";
  const main = result.criteria.filter((c) => !c.track && (c.kind === "required" || (c.kind === "exclusion" && c.status !== "unknown")));
  // 규칙으로 가리지 못한 제외 조건은 '확인 필요'가 아니라 "이런 경우는 안 돼요" 목록으로 보여 준다.
  const excluded = result.criteria.filter((c) => !c.track && c.kind === "exclusion" && c.status === "unknown");
  const tracks = result.criteria.filter((c) => c.track);
  return (
    <li className="rounded-2xl border border-line bg-surface p-5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[15px] font-bold text-ink-2">{rank}</span>
        <span className={`rounded-full px-2.5 py-1 text-[15px] font-bold ${tone}`}>{label}</span>
        {deadline.days !== null && !deadline.expired && <span className={`text-[15px] font-semibold ${deadline.days <= 7 ? "text-bad" : "text-ink-2"}`}>{deadline.left}</span>}
      </div>
      <h2 className="mt-2 text-[18px] font-bold leading-snug text-ink">{a.title}</h2>
      {a.organization && <p className="text-[15px] text-ink-2">{a.organization}</p>}
      <p className="mt-2 text-[16px] leading-relaxed text-ink">{result.headline}</p>
      {item.response?.cached && <p className="mt-1 text-[14px] text-ink-2">저장된 분석 결과예요({ago(item.response.analyzed_at)} 분석)</p>}
      <details className="mt-3">
        <summary className="cursor-pointer text-[15px] font-semibold text-brand-ink">조건별로 보기</summary>
        <ul className="mt-2 space-y-2">
          {main.map((c) => <CriterionRow key={c.id} c={c} unit={unit} />)}
        </ul>
        {excluded.length > 0 && <>
          <p className="mt-3 text-[15px] font-semibold text-ink-2">이런 경우는 신청할 수 없어요</p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-[15px] leading-relaxed text-ink-2">{excluded.map((c) => <li key={c.id}>{c.requirement}</li>)}</ul>
        </>}
        {tracks.length > 0 && <>
          <p className="mt-3 text-[15px] font-semibold text-ink-2">특정 대상에게만 붙는 조건</p>
          <ul className="mt-1 space-y-2">{tracks.map((c) => <CriterionRow key={c.id} c={c} unit={unit} />)}</ul>
        </>}
      </details>
      <button type="button" onClick={onOpen} className="mt-4 w-full rounded-xl border border-brand/40 bg-brand-soft px-4 py-3 text-[16px] font-bold text-brand-ink transition hover:border-brand sm:w-auto">공고 자세히 보기</button>
    </li>
  );
}

function CriterionRow({ c, unit }: { c: NoticeResult["criteria"][number]; unit: string }) {
  const [label, tone] = STATUS[c.status];
  const quote = c.evidence.find((e) => e.quote.trim());
  return (
    <li className="rounded-xl bg-surface-2 px-3.5 py-2.5">
      <p className="text-[15px] text-ink"><span className={`font-bold ${tone}`}>{label}</span> · {c.requirement}</p>
      <p className="mt-1 text-[15px] leading-relaxed text-ink-2">{c.reason}</p>
      {quote && <p className="mt-1 text-[14px] leading-relaxed text-ink-2">원문 {quote.page}{unit}: “{quote.quote.length > 90 ? `${quote.quote.slice(0, 90)}…` : quote.quote}”{c.track ? ` (${c.track})` : ""}</p>}
    </li>
  );
}
