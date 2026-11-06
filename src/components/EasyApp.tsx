"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnalysisSchema, type Analysis, type Answers, type Evidence, type Match } from "@/lib/schema";
import { contentKey, responseJson } from "@/lib/client-api";
import { cleanupUpload, uploadLargeFiles } from "@/lib/client-upload";
import { FILE_ACCEPT, fileMediaType, SUPPORTED_TYPES } from "@/lib/filetypes";
import { MAX_UPLOAD_BYTES } from "@/lib/limits";
import { locate, type Located, type TextIndex } from "@/lib/textmatch";
import { daysUntil, ddayLabel, mainDeadline } from "@/lib/dates";
import { prepareImage } from "@/lib/image";
import { MAX_DOCUMENT_PAGES } from "@/lib/document-limits";
import type { ActiveEvidence, Source } from "./types";
import { EvidenceContext, Logo, Pill, Spinner } from "./ui";
import { CautionsPanel, DocumentsPanel, EligibilityPanel, GlossaryPanel, OverviewPanel } from "./AnalysisPanels";
import ProfileCheck from "./ProfileCheck";
import SourcePanel from "./SourcePanel";

const SourceViewer = dynamic(() => import("./SourceViewer"), {
  ssr: false,
  loading: () => <div className="h-full animate-pulse rounded-2xl bg-surface" />,
});

type Provider = "openai" | "api" | "cli" | "none";
type Status = { provider: Provider; model: string | null; hosted?: boolean; max_upload_bytes?: number; max_direct_upload_bytes?: number; large_uploads?: boolean; access_required?: boolean; message?: string | null };
type Tab = "overview" | "eligibility" | "documents" | "cautions" | "glossary" | "mine";

const ACCEPT = SUPPORTED_TYPES;
const mb = (bytes: number, digits = 0) => (bytes / 1024 / 1024).toFixed(digits);

export default function EasyApp() {
  const [status, setStatus] = useState<Status | null>(null);
  const [stage, setStage] = useState<"upload" | "analyzing" | "result">("upload");
  const [source, setSource] = useState<Source | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [analysisToken, setAnalysisToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [index, setIndex] = useState<TextIndex | null>(null);
  const [active, setActive] = useState<ActiveEvidence | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("overview");
  const [answers, setAnswers] = useState<Answers>({});
  const [extra, setExtra] = useState("");
  const [match, setMatch] = useState<Match | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [startedAt, setStartedAt] = useState(0);
  const filesRef = useRef<File[]>([]);
  const topRef = useRef<HTMLDivElement>(null);
  const operation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const pendingUpload = useRef<{ ticket: string; expiresAt: number; files: File[]; source: Source } | null>(null);
  const [canRetryUpload, setCanRetryUpload] = useState(false);

  useEffect(() => () => {
    controller.current?.abort();
    if (pendingUpload.current) cleanupUpload(pendingUpload.current.ticket);
  }, []);
  useEffect(() => () => {
    if (source?.kind === "pdf" && source.url.startsWith("blob:")) URL.revokeObjectURL(source.url);
    if (source?.kind === "images") source.urls.forEach(URL.revokeObjectURL);
  }, [source]);

  useEffect(() => {
    fetch("/api/status", { cache: "no-store" })
      .then(responseJson)
      .then(setStatus)
      .catch(() => setStatus({ provider: "none", model: null }));
  }, []);

  const canRunAI = !!status && status.provider !== "none" && !status.access_required;

  const updateAnswers = (next: Answers) => {
    const ids = new Set([...Object.keys(answers), ...Object.keys(next)]);
    if (![...ids].some((id) => (answers[id] ?? "") !== (next[id] ?? ""))) return;
    setAnswers(next);
    setMatch(null);
  };

  const updateExtra = (next: string) => {
    if (next === extra) return;
    setExtra(next);
    setMatch(null);
  };

  const reset = () => {
    operation.current++;
    controller.current?.abort();
    if (pendingUpload.current) cleanupUpload(pendingUpload.current.ticket);
    pendingUpload.current = null;
    setCanRetryUpload(false);
    setAnalysisToken(null);
    setError(null);
    setSheetOpen(false);
    if (source?.kind === "pdf" && source.url.startsWith("blob:")) URL.revokeObjectURL(source.url);
    if (source?.kind === "images") source.urls.forEach((u) => URL.revokeObjectURL(u));
    setStage("upload");
    setSource(null);
    setAnalysis(null);
    setIndex(null);
    setActive(null);
    setMatch(null);
    setAnswers({});
    setExtra("");
    setUploadProgress(null);
    setTab("overview");
  };

  const analyze = useCallback(async (files: File[], src: Source, reuse?: { ticket: string; expiresAt: number }) => {
    const current = ++operation.current;
    controller.current?.abort();
    if (pendingUpload.current && pendingUpload.current.ticket !== reuse?.ticket) cleanupUpload(pendingUpload.current.ticket);
    pendingUpload.current = null;
    setCanRetryUpload(false);
    const request = new AbortController(); controller.current = request;
    setAnalysisToken(null);
    setError(null);
    setSource(src);
    setAnalysis(null);
    setIndex(null);
    setActive(null);
    setMatch(null);
    setAnswers({});
    setTab("overview");
    setStage("analyzing");
    setStartedAt(Date.now());
    filesRef.current = files;
    const fd = new FormData();
    files.forEach((f) => fd.append("files", f));
    let ticket = reuse?.ticket;
    const expiresAt = reuse?.expiresAt ?? Date.now() + 29 * 60_000;
    let retainUpload = false;
    try {
      const staged = status?.large_uploads && files.reduce((sum, file) => sum + file.size, 0) > (status.max_direct_upload_bytes ?? 4 * 1024 * 1024);
      setUploadProgress(staged ? 0 : null);
      if (staged && !ticket) {
        ticket = await uploadLargeFiles(files, AbortSignal.any([request.signal, AbortSignal.timeout(180_000)]), value => { if (current === operation.current) setUploadProgress(value); });
      }
      if (staged && current === operation.current) { setUploadProgress(null); setStartedAt(Date.now()); }
      const res = await fetch("/api/analyze", {
        method: "POST", body: ticket ? JSON.stringify({ upload_ticket: ticket }) : fd,
        headers: ticket ? { "Content-Type": "application/json" } : undefined,
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(285_000)]),
      });
      retainUpload = !!ticket && res.headers.get("X-Upload-Retryable") === "1" && Date.now() < expiresAt;
      const j = await responseJson(res);
      if (!res.ok || !j?.analysis) {
        // Vercel이 함수 앞단에서 끊으면 JSON이 아닌 응답이 온다
        const fallback =
          res.status === 413
            ? "파일이 너무 커서 서버가 받지 못했어요. 필요한 쪽만 저장하거나 사진 장수를 줄여서 다시 올려 주세요."
            : res.status === 504
              ? "분석이 너무 오래 걸려 중단됐어요. 잠시 후 다시 시도하거나, 필요한 부분만 잘라서 올려 주세요."
              : `분석에 실패했어요 (${res.status}).`;
        throw new Error(j?.error?.message ?? fallback);
      }
      if (current !== operation.current || request.signal.aborted) return;
      const result = AnalysisSchema.parse(j.analysis);
      setAnalysis(result);
      setAnalysisToken(j.analysis_token ?? null);
      if (j.source?.kind === "text") setSource({ ...j.source, originalFile: files[0] });
      setTab(result.profile_questions.length ? "mine" : "overview");
      setStage("result");
    } catch (e) {
      if (current !== operation.current || request.signal.aborted) return;
      setError(e instanceof Error ? e.message : String(e));
      setStage("upload");
      if (retainUpload && ticket) {
        pendingUpload.current = { ticket, expiresAt, files, source: src };
        setCanRetryUpload(true);
      } else setSource(null);
    } finally {
      if (ticket && pendingUpload.current?.ticket !== ticket) cleanupUpload(ticket);
      if (current === operation.current) setUploadProgress(null);
    }
  }, [status]);

  const retryUpload = () => {
    const pending = pendingUpload.current;
    if (!pending) return;
    if (Date.now() >= pending.expiresAt) {
      cleanupUpload(pending.ticket);
      pendingUpload.current = null;
      setCanRetryUpload(false);
      setSource(null);
      setError("임시 파일 보관 시간이 지났어요. 공고문을 다시 선택해 주세요.");
      return;
    }
    void analyze(pending.files, pending.source, pending);
  };

  async function onFiles(list: FileList | File[]) {
    const current = ++operation.current;
    let files = Array.from(list).map((f) => new File([f], f.name, { type: fileMediaType(f.name, f.type) }));
    if (!files.length) return;
    const bad = files.find((f) => !ACCEPT.includes(f.type));
    if (bad) {
      setError(
        /hei[cf]/i.test(bad.type + bad.name)
          ? "아이폰 HEIC 사진은 아직 지원하지 않아요. JPG/PNG로 저장하거나 화면을 캡처해서 올려 주세요."
          : `PDF, HWP, HWPX, JPG, PNG, WEBP, GIF 파일만 올릴 수 있어요: ${bad.name}`,
      );
      return;
    }
    const pdfs = files.filter((f) => !f.type.startsWith("image/"));
    if (pdfs.length > 1 || (pdfs.length && pdfs.length !== files.length)) {
      setError("PDF·한글 문서는 한 번에 한 개만 올릴 수 있어요. 사진은 최대 10장까지 올릴 수 있어요.");
      return;
    }
    if (!pdfs.length && files.length > 10) {
      setError("사진은 최대 10장까지 올릴 수 있어요.");
      return;
    }
    if (!canRunAI) {
      setError(
        status?.access_required ? "이용 코드를 입력한 뒤 공고문을 올려 주세요." : "지금은 AI가 연결되어 있지 않아 새 공고문을 분석할 수 없어요. 잠시 후 다시 시도해 주세요.",
      );
      return;
    }
    const limit = status?.max_upload_bytes ?? MAX_UPLOAD_BYTES;
    if (pdfs.length && pdfs[0].size > limit) {
      setError(
        `문서는 ${mb(limit)}MB까지 올릴 수 있는데, 이 파일은 ${mb(pdfs[0].size, 1)}MB예요. ` +
          "필요한 쪽만 따로 PDF로 저장하거나, 공고문 화면을 캡처해서 사진으로 올려 주세요.",
      );
      return;
    }
    if (!pdfs.length) {
      // 장당 용량을 나눠 줘서 전체가 업로드 한도 안에 들어오게 줄인다
      const per = Math.min(3.5 * 1024 * 1024, Math.floor((limit - 64 * 1024) / files.length));
      files = await Promise.all(files.map((f) => prepareImage(f, per)));
      const total = files.reduce((n, f) => n + f.size, 0);
      if (total > limit) {
        setError(`사진 용량이 합쳐서 ${mb(limit)}MB를 넘어요(${mb(total, 1)}MB). 사진 장수를 줄여서 다시 올려 주세요.`);
        return;
      }
    }
    if (current !== operation.current) return;
    const hangul = files[0].type === "application/x-hwp" || files[0].type === "application/hwp+zip";
    const src: Source = hangul ? { kind: "text", name: files[0].name, originalFile: files[0], sections: [], warning: "한글 원문을 추출하고 있어요…" } : pdfs.length
      ? { kind: "pdf", url: URL.createObjectURL(pdfs[0]), name: pdfs[0].name }
      : { kind: "images", urls: files.map((f) => URL.createObjectURL(f)), names: files.map((f) => f.name) };
    analyze(files, src);
  }

  // ── 근거 처리 ──
  const cache = useMemo(() => {
    const locations = new Map<string, Located>();
    if (analysis && index) {
      const evidence = [...analysis.benefits, ...analysis.schedule, ...analysis.how_to_apply, ...analysis.eligibility,
        ...analysis.documents, ...analysis.cautions, ...analysis.glossary].flatMap(item => item.evidence).concat(analysis.contact_evidence);
      for (const e of evidence) locations.set(`${e.page}|${e.quote}`, locate(index, e.page, e.quote));
    }
    return locations;
  }, [index, analysis]);
  const locateEv = useCallback(
    (e: Evidence) => {
      const k = `${e.page}|${e.quote}`;
      return cache.get(k) ?? locate(index, e.page, e.quote);
    },
    [index, cache],
  );
  const show = useCallback(
    (e: Evidence) => {
      const loc = locateEv(e);
      setActive({ key: Date.now(), page: loc.page, quote: e.quote, items: loc.items, ranges: loc.ranges, status: loc.status });
      setSheetOpen(true);
    },
    [locateEv],
  );
  const evCtx = useMemo(() => ({ locate: locateEv, show, activeQuote: active?.quote ?? null, unit: source?.kind === "text" ? "구역" : "쪽" }), [locateEv, show, active, source]);

  const verify = useMemo(() => {
    if (!analysis || !index) return null;
    const all: Evidence[] = [
      ...analysis.benefits,
      ...analysis.schedule,
      ...analysis.how_to_apply,
      ...analysis.eligibility,
      ...analysis.documents,
      ...analysis.cautions,
      ...analysis.glossary,
    ].flatMap((x) => x.evidence).concat(analysis.contact_evidence);
    const c = { exact: 0, fuzzy: 0, none: 0, unknown: 0 };
    all.forEach((e) => c[locate(index, e.page, e.quote).status]++);
    return { total: all.length, source: index.source, ...c };
  }, [analysis, index]);

  const docKey = useMemo(() => {
    if (!analysis) return "";
    return contentKey(analysis);
  }, [analysis]);

  const goTab = (t: Tab) => {
    setTab(t);
    topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="min-h-screen">
      <Header
        status={status}
        onHome={stage !== "upload" ? reset : undefined}
        fileName={stage !== "upload" && source ? (source.kind !== "images" ? source.name : `이미지 ${source.urls.length}장`) : null}
      />

      {stage === "upload" && (
        <UploadScreen onFiles={onFiles} error={error} status={status} extra={extra} onExtra={updateExtra} onRetryUpload={canRetryUpload ? retryUpload : undefined} onUnlock={async (code) => {
          await fetch("/api/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) }).then(responseJson);
          setStatus(await fetch("/api/status", { cache: "no-store" }).then(responseJson));
        }} />
      )}

      {stage !== "upload" && source && (
        <main className="mx-auto grid max-w-[1440px] gap-5 px-4 pb-24 pt-5 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.92fr)] lg:pb-10">
          <div className="min-w-0">
            {stage === "analyzing" && <AnalyzingPanel startedAt={startedAt} provider={status?.provider ?? "api"} uploadProgress={uploadProgress} />}

            {stage === "result" && analysis && (
              <EvidenceContext.Provider value={evCtx}>
                <ResultHeader
                  a={analysis}
                  verify={verify}
                  onCheck={() => goTab("mine")}
                />
                <div ref={topRef} className="scroll-mt-16" />
                <Tabs tab={tab} onTab={goTab} a={analysis} match={match} />
                <div className="mt-4">
                  {tab === "overview" && <OverviewPanel a={analysis} />}
                  {tab === "eligibility" && <EligibilityPanel a={analysis} match={match} onCheck={() => goTab("mine")} />}
                  {tab === "documents" && <DocumentsPanel a={analysis} />}
                  {tab === "cautions" && <CautionsPanel a={analysis} />}
                  {tab === "glossary" && <GlossaryPanel a={analysis} />}
                  {tab === "mine" && (
                    <ProfileCheck
                      a={analysis}
                      docKey={docKey}
                      match={match}
                      answers={answers}
                      extra={extra}
                      onAnswers={updateAnswers}
                      onExtra={updateExtra}
                      onMatch={setMatch}
                      canRunAI={canRunAI}
                      analysisToken={analysisToken}
                      onOverview={() => goTab("overview")}
                    />
                  )}
                </div>
                {tab !== "mine" && (
                  <button
                    onClick={() => goTab("mine")}
                    className="mt-5 flex w-full items-center justify-between rounded-2xl border border-brand/25 bg-brand-soft px-5 py-4 text-left transition hover:border-brand/50"
                  >
                    <span>
                      <span className="block text-[15px] font-bold text-brand-ink">
                        {match ? "내 체크리스트 보기" : "내 조건으로 신청 가능 여부 확인하기"}
                      </span>
                      <span className="block text-[13px] text-ink-2">
                        {match ? "준비할 서류와 마감일을 한곳에 모았어요" : "나이·거주지 등을 넣으면 조건별 결과와 준비 체크리스트를 만들어 드려요"}
                      </span>
                    </span>
                    <span aria-hidden className="text-xl text-brand">→</span>
                  </button>
                )}
              </EvidenceContext.Provider>
            )}
          </div>

          {/* 원문 뷰어: 데스크톱은 오른쪽 고정, 모바일은 아래에서 올라오는 시트 */}
          <SourcePanel open={sheetOpen} onClose={() => setSheetOpen(false)}>
            <SourceViewer
              source={source}
              transcript={analysis?.transcript?.length ? analysis.transcript : null}
              active={active}
              onIndex={setIndex}
              onClose={() => setSheetOpen(false)}
            />
          </SourcePanel>
            <button
              onClick={() => setSheetOpen(true)}
              className="fixed bottom-4 right-4 z-20 rounded-full bg-ink px-4 py-3 text-[13.5px] font-semibold text-white shadow-lg lg:hidden"
            >
              원문 보기
            </button>
        </main>
      )}
    </div>
  );
}

// ── 헤더 ────────────────────────────────────────────────────────

function Header({
  status,
  onHome,
  fileName,
}: {
  status: Status | null;
  onHome?: () => void;
  fileName: string | null;
}) {
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-surface/90 backdrop-blur">
      <div className="mx-auto flex h-[60px] max-w-[1440px] items-center gap-3 px-4 sm:px-6">
        <button onClick={onHome} className={onHome ? "" : "cursor-default"} aria-label="처음으로">
          <Logo />
        </button>
        {fileName && <span className="hidden min-w-0 truncate text-[13px] text-muted sm:block">/ {fileName}</span>}
        <div className="ml-auto flex items-center gap-2">
          <ProviderBadge status={status} />
          {onHome && (
            <button
              onClick={onHome}
              className="rounded-xl border border-line px-3 py-1.5 text-[13px] font-semibold text-ink-2 hover:bg-surface-2"
            >
              새 공고문
            </button>
          )}
        </div>
      </div>
    </header>
  );
}

function ProviderBadge({ status }: { status: Status | null }) {
  if (!status) return null;
  const map = {
    openai: { dot: "bg-ok", text: "OpenAI 분석" },
    api: { dot: "bg-ok", text: "Claude 분석" },
    cli: { dot: "bg-ok", text: "로컬 AI 분석" },
    none: { dot: "bg-warn", text: "AI 연결 준비 중" },
  }[status.provider];
  return (
    <span
      className="hidden items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-1 text-[12px] font-medium text-ink-2 sm:inline-flex"
      title={status.model ?? undefined}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${map.dot}`} />
      {map.text}
    </span>
  );
}

// ── 업로드 화면 ─────────────────────────────────────────────────

function UploadScreen({
  onFiles,
  error,
  status,
  onUnlock,
  extra,
  onExtra,
  onRetryUpload,
}: {
  onFiles: (f: FileList | File[]) => void;
  error: string | null;
  status: Status | null;
  onUnlock: (code: string) => Promise<void>;
  extra: string;
  onExtra: (value: string) => void;
  onRetryUpload?: () => void;
}) {
  const provider = status?.provider ?? null;
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const [code, setCode] = useState("");
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [unlocking, setUnlocking] = useState(false);

  return (
    <main className="mx-auto max-w-[1180px] px-4 pb-16 pt-10 sm:px-6 lg:pt-16">
      <div className="grid items-center gap-10 lg:grid-cols-[1.05fr_0.95fr]">
        <div>
          <p className="text-[13px] font-semibold text-brand">청년 지원사업 · 장학금 · 정부 지원제도</p>
          <h1 className="mt-3 text-[34px] font-extrabold leading-[1.25] tracking-[-0.02em] text-ink sm:text-[42px]">
            어려운 공고문,
            <br />
            <span className="text-brand">내 상황에 맞게</span> 정리해 드려요
          </h1>
          <p className="mt-4 max-w-[520px] text-[15.5px] leading-relaxed text-ink-2">
            공고문을 올리면 AI가 신청 자격·제출 서류·마감일·주의 사항을 쉬운 말로 정리하고, 내 조건과 비교해 준비 체크리스트까지
            만들어 줘요. 모든 설명에는 근거가 된 공고문 원문을 함께 보여드려요.
          </p>

          {status?.access_required && <form className="mt-5 space-y-2 rounded-xl border border-line p-4" onSubmit={async (e) => {
            e.preventDefault(); setUnlocking(true); setUnlockError(null);
            try { await onUnlock(code); setCode(""); } catch (err) { setUnlockError(err instanceof Error ? err.message : "연결에 실패했어요."); } finally { setUnlocking(false); }
          }}>
            <label htmlFor="access-code" className="block text-sm font-semibold">이용 코드</label>
            <input id="access-code" type="password" autoComplete="current-password" required maxLength={256} value={code} onChange={e => setCode(e.target.value)} className="rounded-lg border border-line p-2" />
            <button disabled={unlocking} className="ml-2 rounded-lg bg-brand px-4 py-2 text-white">{unlocking ? "확인 중…" : "확인"}</button>
            {unlockError && <p role="alert" className="text-sm text-bad">{unlockError}</p>}
          </form>}
          <details className="mt-5 rounded-xl border border-line bg-surface px-4 py-3">
            <summary className="cursor-pointer text-[13.5px] font-semibold text-ink-2">내 상황 미리 적기 <span className="font-normal text-muted">(선택)</span></summary>
            <label htmlFor="initial-profile" className="mt-3 block text-[13px] text-ink-2">거주 지역·나이·소득 범위 등 알고 있는 조건을 메모해 주세요.</label>
            <textarea id="initial-profile" value={extra} onChange={e => onExtra(e.target.value)} rows={3} maxLength={2000} placeholder="예: 춘천 거주, 만 25세, 기준 중위소득 120% 이하" className="mt-2 w-full resize-y rounded-xl border border-line bg-surface-2 px-3.5 py-2.5 text-[14px] outline-none focus:border-brand" />
            <p className="mt-1.5 text-[12px] leading-relaxed text-muted">분석 뒤 공고에 필요한 질문을 확인하고, 이 메모도 함께 비교해요. 개인정보는 필요한 만큼만 적어 주세요.</p>
          </details>
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDrag(false);
              onFiles(e.dataTransfer.files);
            }}
            className={`mt-7 rounded-2xl border-2 border-dashed px-6 py-8 text-center transition ${
              drag ? "border-brand bg-brand-soft" : "border-line-strong bg-surface"
            }`}
          >
            <UploadIcon />
            <p className="mt-3 text-[15.5px] font-semibold text-ink">공고문 PDF·한글 파일이나 사진을 올려 주세요</p>
            <p className="mt-1 text-[13px] text-muted">PDF·HWP·HWPX 1개({mb(status?.max_upload_bytes ?? MAX_UPLOAD_BYTES)}MB 이하) 또는 사진 최대 10장<br />PDF는 최대 {MAX_DOCUMENT_PAGES}쪽까지 지원해요.</p>
            <button
              onClick={() => input.current?.click()}
              className="mt-4 rounded-xl bg-brand px-5 py-2.5 text-[14.5px] font-bold text-white transition hover:bg-brand-ink"
            >
              파일 선택
            </button>
            <input
              ref={input}
              type="file"
              accept={FILE_ACCEPT}
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files) onFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </div>
          <p className="mt-2 text-[11.5px] leading-relaxed text-muted">파일은 분석을 위해 AI 제공자에게 전송돼요. 큰 파일은 비공개로 임시 보관한 뒤 처리 후 삭제해요. 중단된 파일도 하루 한 번 정리해요.</p>

          {error && <div role="alert" className="mt-3 rounded-xl bg-bad-soft px-4 py-3 text-[13.5px] leading-relaxed text-bad">{error}</div>}
          {onRetryUpload && <div className="mt-3 rounded-xl border border-line bg-surface p-4 text-[13px] text-ink-2">
            <p>올린 파일을 잠시 보관하고 있어요. 업로드 준비 후 30분 이내에는 파일을 다시 보내지 않고 시도할 수 있어요. 이 화면을 유지해 주세요.</p>
            <button type="button" onClick={onRetryUpload} className="mt-2 rounded-lg bg-brand px-4 py-2 font-semibold text-white">업로드한 파일로 다시 시도</button>
          </div>}
          {provider === "none" && !error && (
            <div className="mt-3 rounded-xl bg-warn-soft px-4 py-3 text-[13px] leading-relaxed text-warn">
              AI 연결을 준비 중이에요. 잠시 후 다시 방문해 주세요.
            </div>
          )}

        </div>

        <HeroMock />
      </div>

      <div className="mt-14 grid gap-3 sm:grid-cols-3">
        {[
          ["1", "쉬운 말로 정리", "자격·서류·마감일·주의 사항을 나눠서, 행정 용어는 풀어서 설명해요."],
          ["2", "내 조건과 비교", "나이·거주지 등을 넣으면 조건마다 충족 / 확인 필요 / 미충족을 알려줘요."],
          ["3", "원문으로 확인", "모든 설명 옆 ‘원문’을 누르면 공고문의 해당 문장을 하이라이트해요."],
        ].map(([n, t, d]) => (
          <div key={n} className="rounded-2xl border border-line bg-surface p-5">
            <div className="text-[12px] font-bold text-brand">STEP {n}</div>
            <div className="mt-1 text-[15.5px] font-bold text-ink">{t}</div>
            <p className="mt-1 text-[13.5px] leading-relaxed text-ink-2">{d}</p>
          </div>
        ))}
      </div>
    </main>
  );
}

function HeroMock() {
  return (
    <div className="relative hidden lg:block" aria-hidden>
      <div className="absolute -right-6 -top-6 h-[340px] w-[300px] rotate-[4deg] rounded-xl border border-line bg-white p-5 shadow-sm">
        <div className="h-2.5 w-32 rounded bg-line" />
        <div className="mt-4 space-y-2">
          {[92, 80, 86, 60, 88, 74].map((w, i) => (
            <div key={i} className="h-2 rounded bg-surface-2" style={{ width: `${w}%` }} />
          ))}
        </div>
        <div className="mt-4 rounded bg-mark/70 px-1 py-0.5 text-[11px] leading-snug text-ink-2">
          만 19세 이상 ~ 만 34세 이하 청년 (1991. 11. 7. ~ 2007. 11. 6. 출생자)
        </div>
        <div className="mt-3 space-y-2">
          {[70, 84, 66, 90].map((w, i) => (
            <div key={i} className="h-2 rounded bg-surface-2" style={{ width: `${w}%` }} />
          ))}
        </div>
      </div>
      <div className="relative mr-16 mt-10 rounded-2xl border border-line bg-surface p-5 shadow-[0_20px_50px_rgba(16,24,40,.10)]">
        <div className="flex items-center justify-between">
          <Pill tone="brand">주거·월세 지원</Pill>
          <Pill tone="bad">신청 마감 D-12</Pill>
        </div>
        <div className="mt-3 text-[16px] font-bold leading-snug text-ink">청년 월세 지원사업 참여자 모집</div>
        <div className="mt-1 text-[13px] text-ink-2">월세를 월 최대 20만원, 최대 12개월 지원해 줘요.</div>
        <div className="mt-4 space-y-2">
          {[
            ["ok", "✓ 충족", "만 19~34세 청년이어야 해요"],
            ["ok", "✓ 충족", "주민등록상 주소가 가람시여야 해요"],
            ["warn", "? 확인 필요", "원가구 소득이 중위소득 100% 이하"],
          ].map(([tone, s, t]) => (
            <div key={t} className="flex items-center gap-2 rounded-xl bg-surface-2 px-3 py-2">
              <Pill tone={tone as "ok" | "warn"}>{s}</Pill>
              <span className="truncate text-[13px] text-ink">{t}</span>
            </div>
          ))}
        </div>
        <div className="mt-3 inline-flex items-center gap-1 rounded-md border border-brand bg-brand-soft px-2 py-[3px] text-[11.5px] font-medium text-brand-ink">
          원문 1쪽 <span className="font-bold text-ok">✓</span>
        </div>
      </div>
    </div>
  );
}

function UploadIcon() {
  return (
    <svg className="mx-auto" width="44" height="44" viewBox="0 0 44 44" fill="none" aria-hidden>
      <rect width="44" height="44" rx="12" fill="var(--brand-soft)" />
      <path d="M22 28V15m0 0-5 5m5-5 5 5" stroke="var(--brand)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M14 27v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" stroke="var(--brand)" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

// ── 분석 중 ─────────────────────────────────────────────────────

function AnalyzingPanel({ startedAt, provider, uploadProgress }: { startedAt: number; provider: Provider; uploadProgress: number | null }) {
  const [sec, setSec] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setSec(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(id);
  }, [startedAt]);
  const tasks = [
    "공고문 전체를 읽어요",
    "신청 자격을 판단 가능한 조건으로 나눠요",
    "제출 서류, 마감일, 주의 사항을 찾아요",
    "어려운 행정 용어를 쉬운 말로 바꿔요",
    "설명마다 근거가 된 원문 문장을 붙여요",
    "내 조건 확인에 필요한 질문을 만들어요",
  ];
  const mm = Math.floor(sec / 60);
  const ss = String(sec % 60).padStart(2, "0");
  return (
    <div className="rounded-2xl border border-line bg-surface p-6 sm:p-8">
      <div className="flex items-center gap-3">
        <Spinner className="text-brand" />
        <h2 className="text-[19px] font-bold tracking-tight text-ink">{uploadProgress !== null ? "공고문을 보내고 있어요" : "공고문을 분석하고 있어요"}</h2>
        <span className="ml-auto font-mono text-[13px] tabular-nums text-muted">
          {mm}:{ss}
        </span>
      </div>
      {uploadProgress !== null && <div className="mt-4">
        <progress aria-label="공고문 업로드" max={100} value={uploadProgress} className="w-full accent-brand" />
        <p role="status" className="mt-1 text-sm text-muted">{uploadProgress}% · 전송이 끝나면 바로 분석해요.</p>
      </div>}
      <p className="mt-2 text-[13.5px] leading-relaxed text-ink-2">
        {provider === "cli"
          ? "이 컴퓨터의 Claude Code로 분석 중이에요. 긴 공고문은 몇 분이 걸릴 수 있어요."
          : "긴 공고문은 분석에 몇 분이 걸릴 수 있어요."}{" "}
        그동안 오른쪽에서 원문을 먼저 살펴보세요.
      </p>
      <div hidden={uploadProgress !== null} className="mt-6 text-[12px] font-bold text-muted">AI가 하는 일</div>
      <ul hidden={uploadProgress !== null} className="mt-2 space-y-2">
        {tasks.map((t) => (
          <li key={t} className="flex items-center gap-2.5 rounded-xl bg-surface-2 px-3.5 py-2.5 text-[14px] text-ink-2">
            <span className="h-1.5 w-1.5 rounded-full bg-brand/60" />
            {t}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── 결과 상단 ───────────────────────────────────────────────────

function ResultHeader({
  a,
  verify,
  onCheck,
}: {
  a: Analysis;
  verify: { total: number; source: TextIndex["source"]; exact: number; fuzzy: number; none: number; unknown: number } | null;
  onCheck: () => void;
}) {
  const deadline = mainDeadline(a);
  const d = daysUntil(deadline?.date_iso);
  const dd = ddayLabel(d);
  return (
    <div className="rounded-2xl border border-line bg-surface p-5 sm:p-6">
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone="brand">{a.category}</Pill>
        {a.organization && <span className="text-[12.5px] text-muted">{a.organization}</span>}
      </div>
      <h1 className="mt-2.5 text-[21px] font-extrabold leading-snug tracking-[-0.01em] text-ink sm:text-[24px]">{a.title}</h1>
      <p className="mt-2 text-[15px] leading-relaxed text-ink-2">{a.one_line}</p>

      <div className="mt-4 grid gap-2.5 sm:grid-cols-[1.2fr_1fr]">
        <div className={`rounded-xl px-4 py-3 ${d !== null && d >= 0 && d <= 7 ? "bg-bad-soft" : "bg-surface-2"}`}>
          <div className="text-[12px] font-semibold text-muted">접수 마감</div>
          {deadline ? (
            <div className="mt-0.5 flex items-baseline gap-2">
              <span className={`text-[20px] font-extrabold ${d !== null && d >= 0 && d <= 7 ? "text-bad" : "text-ink"}`}>{dd}</span>
              <span className="truncate text-[13px] text-ink-2">{deadline.date_text}</span>
            </div>
          ) : (
            <div className="mt-0.5 text-[14px] text-ink-2">공고문에서 마감일을 찾지 못했어요</div>
          )}
        </div>
        <div className="rounded-xl bg-surface-2 px-4 py-3">
          <div className="text-[12px] font-semibold text-muted">{verify?.source === "transcript" ? "원문 확인 필요" : "원문에서 확인한 내용"}</div>
          {verify?.source === "transcript" ? (
            <p className="mt-1 text-[13px] leading-snug text-warn">사진의 글자를 잘못 읽을 수 있어요. 중요한 조건은 원본 사진에서 확인해 주세요.</p>
          ) : verify ? (
            verify.unknown === verify.total ? (
              <div className="mt-0.5 text-[13px] leading-snug text-ink-2">스캔한 문서는 글자를 잘못 읽을 수 있어요. ‘원문’을 눌러 직접 확인해 주세요.</div>
            ) : (
              <div className="mt-0.5 flex items-baseline gap-2">
                <span className="text-[20px] font-extrabold text-ok">
                  {verify.exact}/{verify.total}
                </span>
                <span className="text-[13px] text-ink-2">개 문장 일치{verify.fuzzy > 0 ? ` · 유사 ${verify.fuzzy}개` : ""}</span>
              </div>
            )
          ) : (
            <div className="mt-1 flex items-center gap-2 text-[13px] text-muted">
              <Spinner /> 원문과 맞춰보는 중
            </div>
          )}
        </div>
      </div>
      <button
        onClick={onCheck}
        className="mt-4 w-full rounded-xl bg-brand px-4 py-3 text-[14.5px] font-bold text-white transition hover:bg-brand-ink sm:hidden"
      >
        내 조건으로 확인하기
      </button>
    </div>
  );
}

// ── 탭 ──────────────────────────────────────────────────────────

function Tabs({ tab, onTab, a, match }: { tab: Tab; onTab: (t: Tab) => void; a: Analysis; match: Match | null }) {
  const items: [Tab, string, number | null][] = [
    ["mine", match ? "내 결과" : "내 조건 입력", null],
    ["overview", "한눈에 보기", null],
    ["eligibility", "신청 자격", a.eligibility.length],
    ["documents", "제출 서류", a.documents.length],
    ["cautions", "주의 사항", a.cautions.length],
    ["glossary", "용어 풀이", a.glossary.length],
  ];
  return (
    <nav className="sticky top-[60px] z-10 -mx-4 mt-4 border-b border-line bg-bg/95 px-4 backdrop-blur sm:mx-0 sm:px-0">
      <div className="scrollbar-thin flex gap-1 overflow-x-auto py-2">
        {items.map(([k, label, n]) => {
          const on = tab === k;
          const mine = k === "mine";
          return (
            <button
              key={k}
              onClick={() => onTab(k)}
              className={`shrink-0 rounded-xl px-3.5 py-2 text-[14px] font-semibold transition ${
                on
                  ? mine
                    ? "bg-brand text-white"
                    : "bg-ink text-white"
                  : mine
                    ? "text-brand-ink hover:bg-brand-soft"
                    : "text-ink-2 hover:bg-surface"
              }`}
            >
              {mine && !on && "★ "}
              {label}
              {n !== null && <span className={`ml-1 text-[12px] ${on ? "text-white/70" : "text-muted"}`}>{n}</span>}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
