"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnalysisSchema, type Analysis, type Answers, type Evidence, type Match } from "@/lib/schema";
import { contentKey, errorMessage, responseJson } from "@/lib/client-api";
import { cleanupUpload, uploadLargeFiles } from "@/lib/client-upload";
import { FILE_ACCEPT, fileMediaType, SUPPORTED_TYPES } from "@/lib/filetypes";
import { MAX_UPLOAD_BYTES } from "@/lib/limits";
import { locate, type Located, type TextIndex } from "@/lib/textmatch";
import { prepareImage } from "@/lib/image";
import type { ActiveEvidence, Source } from "./types";
import { deadlineInfo, EvidenceContext, evidenceId, Logo, Spinner } from "./ui";
import { CautionsPanel, DocumentsPanel, EligibilityPanel, GlossaryPanel, OverviewPanel } from "./AnalysisPanels";
import ProfileCheck from "./ProfileCheck";
import Finder, { type AnalyzeResponse } from "./Finder";
import SourcePanel from "./SourcePanel";

const SourceViewer = dynamic(() => import("./SourceViewer"), {
  ssr: false,
  loading: () => <div className="h-full animate-pulse rounded-2xl bg-surface" />,
});

type Provider = "api" | "cli" | "none";
type Status = { provider: Provider; model: string | null; hosted?: boolean; max_upload_bytes?: number; max_direct_upload_bytes?: number; large_uploads?: boolean; access_required?: boolean; message?: string | null };
type Tab = "overview" | "eligibility" | "documents" | "cautions" | "glossary" | "mine";

const ACCEPT = SUPPORTED_TYPES;
const UNREADABLE = "결과를 읽지 못했어요. 새로고침 후 다시 시도해 주세요.";

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
  const [matching, setMatching] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const filesRef = useRef<File[]>([]);
  const topRef = useRef<HTMLDivElement>(null);
  const operation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const pendingUpload = useRef<{ ticket: string; expiresAt: number; files: File[]; source: Source } | null>(null);
  const [canRetryUpload, setCanRetryUpload] = useState(false);
  const [menu, setMenu] = useState<"analyze" | "finder">("analyze");
  // 맞춤 공고 찾기에서 연 상세 화면이면, 머리글 버튼이 추천 목록으로 돌아간다.
  const [fromFinder, setFromFinder] = useState(false);

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
    setMatching(false);
    setAnswers({});
    setExtra("");
    setUploadProgress(null);
    setTab("overview");
    setFromFinder(false);
  };

  // 맞춤 공고 찾기에서 이미 받은 분석으로 상세 화면을 연다(다시 호출하지 않는다).
  const openFound = (file: File, j: AnalyzeResponse) => {
    operation.current++;
    controller.current?.abort();
    const src: Source = j.source?.kind === "text" ? { ...j.source, originalFile: file } : { kind: "pdf", url: URL.createObjectURL(file), name: file.name };
    filesRef.current = [file];
    setError(null);
    setSource(src);
    setAnalysis(AnalysisSchema.parse(j.analysis));
    setAnalysisToken(j.analysis_token ?? null);
    setIndex(null);
    setActive(null);
    setMatch(null);
    setAnswers({});
    setExtra("");
    setTab("overview");
    setStage("result");
    setFromFinder(true);
    window.scrollTo(0, 0);
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
      if (staged && current === operation.current) setUploadProgress(null);
      const res = await fetch("/api/analyze", {
        method: "POST", body: ticket ? JSON.stringify({ upload_ticket: ticket }) : fd,
        headers: ticket ? { "Content-Type": "application/json" } : undefined,
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(285_000)]),
      });
      retainUpload = !!ticket && res.headers.get("X-Upload-Retryable") === "1" && Date.now() < expiresAt;
      const j = await responseJson(res);
      if (!j?.analysis) throw new Error(UNREADABLE);
      if (current !== operation.current || request.signal.aborted) return;
      const result = AnalysisSchema.parse(j.analysis);
      setAnalysis(result);
      setAnalysisToken(j.analysis_token ?? null);
      if (j.source?.kind === "text") setSource({ ...j.source, originalFile: files[0] });
      // 접수가 끝난 공고는 답변부터 받지 않고 내용부터 보여 준다.
      setTab(result.profile_questions.length && !deadlineInfo(result)?.expired ? "mine" : "overview");
      setStage("result");
    } catch (e) {
      if (current !== operation.current || request.signal.aborted) return;
      setError(errorMessage(e));
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
      setError("시간이 지났어요. 공고문을 다시 올려 주세요.");
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
          ? "아이폰 HEIC 사진은 올릴 수 없어요. 화면을 캡처해서 올려 주세요."
          : "PDF, 한글 파일이나 사진만 올릴 수 있어요.",
      );
      return;
    }
    const pdfs = files.filter((f) => !f.type.startsWith("image/"));
    if (pdfs.length > 1 || (pdfs.length && pdfs.length !== files.length)) {
      setError("문서 파일은 한 번에 하나만 올려 주세요.");
      return;
    }
    if (!pdfs.length && files.length > 10) {
      setError("사진은 10장까지 올릴 수 있어요.");
      return;
    }
    if (!canRunAI) {
      setError(status?.access_required ? "이용 코드를 먼저 입력해 주세요." : "지금은 분석을 할 수 없어요. 잠시 후 다시 시도해 주세요.");
      return;
    }
    const limit = status?.max_upload_bytes ?? MAX_UPLOAD_BYTES;
    if (pdfs.length && pdfs[0].size > limit) {
      setError("파일이 너무 커요. 필요한 쪽만 따로 저장하거나 화면을 캡처해서 올려 주세요.");
      return;
    }
    if (!pdfs.length) {
      // 장당 용량을 나눠 줘서 전체가 업로드 한도 안에 들어오게 줄인다
      const per = Math.min(3.5 * 1024 * 1024, Math.floor((limit - 64 * 1024) / files.length));
      files = await Promise.all(files.map((f) => prepareImage(f, per)));
      const total = files.reduce((n, f) => n + f.size, 0);
      if (total > limit) {
        setError("사진 용량이 너무 커요. 사진 수를 줄여서 다시 올려 주세요.");
        return;
      }
    }
    if (current !== operation.current) return;
    const hangul = files[0].type === "application/x-hwp" || files[0].type === "application/hwp+zip";
    const src: Source = hangul ? { kind: "text", name: files[0].name, originalFile: files[0], sections: [], warning: "" } : pdfs.length
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
    (e: Evidence) => cache.get(`${e.page}|${e.quote}`) ?? locate(index, e.page, e.quote),
    [index, cache],
  );
  // 같은 쪽에 있는 근거 문장을 한 번에 강조한다.
  const show = useCallback(
    (group: Evidence[]) => {
      const located = group.map(locateEv);
      const page = located[0].page;
      const items = new Set<number>();
      const ranges: Located["ranges"] = {};
      for (const loc of located) {
        if (loc.page !== page) continue;
        loc.items.forEach((i) => items.add(i));
        for (const [key, [from, to]] of Object.entries(loc.ranges)) {
          const prev = ranges[Number(key)];
          ranges[Number(key)] = prev ? [Math.min(prev[0], from), Math.max(prev[1], to)] : [from, to];
        }
      }
      const statuses = located.map((l) => l.status);
      const status = (["exact", "fuzzy", "none"] as const).find((s) => statuses.includes(s)) ?? "unknown";
      setActive({ key: Date.now(), id: evidenceId(group), page, quotes: group.map((e) => e.quote), items: [...items].sort((x, y) => x - y), ranges, status });
      setSheetOpen(true);
    },
    [locateEv],
  );
  const evCtx = useMemo(() => ({ locate: locateEv, show, activeId: active?.id ?? null, paged: source?.kind !== "text" }), [locateEv, show, active, source]);

  // 사진·스캔본은 AI가 글자를 읽은 것이라 틀릴 수 있다.
  const readFromImage = source?.kind === "images" ? "사진에서 읽은 내용이라 틀린 글자가 있을 수 있어요."
    : index?.source === "pdf" && !index.hasText ? "스캔한 문서에서 읽은 내용이라 틀린 글자가 있을 수 있어요." : null;
  const resultNote = [readFromImage, "AI가 정리한 내용이라 틀릴 수 있어요. 신청 전에 원문을 꼭 확인해 주세요."].filter(Boolean).join(" ");

  const docKey = useMemo(() => {
    if (!analysis) return "";
    return contentKey(analysis);
  }, [analysis]);

  const goTab = (t: Tab) => {
    setTab(t);
    topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const expired = analysis ? !!deadlineInfo(analysis)?.expired : false;

  return (
    <div className="min-h-screen">
      <Header
        onHome={stage !== "upload" ? reset : undefined}
        homeLabel={fromFinder ? "추천 목록으로" : "새 공고문"}
        onSource={stage !== "upload" && source ? () => setSheetOpen(true) : undefined}
      />

      {stage === "upload" && <MenuBar menu={menu} onMenu={(m) => { setError(null); setMenu(m); }} />}
      {/* 목록 상태를 지키려고 상세 화면을 보는 동안에도 맞춤 찾기를 숨겨 둔 채 유지한다. */}
      <div hidden={!(stage === "upload" && menu === "finder")} className="mx-auto max-w-[1180px] px-4 pb-16 pt-6 sm:px-6">
        <Finder status={status} canRunAI={canRunAI} onOpen={openFound} />
      </div>

      {stage === "upload" && menu === "analyze" && (
        <UploadScreen onFiles={onFiles} error={error} status={status} extra={extra} onExtra={updateExtra} onRetryUpload={canRetryUpload ? retryUpload : undefined} onUnlock={async (code) => {
          await fetch("/api/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) }).then(responseJson);
          setStatus(await fetch("/api/status", { cache: "no-store" }).then(responseJson));
        }} />
      )}

      {stage !== "upload" && source && (
        <main className="mx-auto grid max-w-[1440px] gap-5 px-4 pb-16 pt-5 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.92fr)] lg:pb-10">
          <div className="min-w-0">
            {stage === "analyzing" && <AnalyzingPanel uploadProgress={uploadProgress} />}

            {stage === "result" && analysis && (
              <EvidenceContext.Provider value={evCtx}>
                <ResultHeader a={analysis} note={resultNote} matched={!!match} onCheck={tab !== "mine" ? () => goTab("mine") : undefined} />
                <div ref={topRef} className="scroll-mt-16" />
                <Tabs tab={tab} onTab={goTab} match={match} matching={matching} />
                <div id="tab-panel" role="tabpanel" aria-labelledby={`tab-${tab}`} className="mt-4">
                  {tab === "overview" && <OverviewPanel a={analysis} />}
                  {tab === "eligibility" && <EligibilityPanel a={analysis} />}
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
                      onBusy={setMatching}
                    />
                  )}
                </div>
                {tab !== "mine" && (match || !expired) && (
                  <button
                    type="button"
                    onClick={() => goTab("mine")}
                    className="mt-5 w-full rounded-2xl border border-brand/30 bg-brand-soft px-5 py-4 text-left text-[16px] font-bold text-brand-ink transition hover:border-brand/60"
                  >
                    {match ? "내 결과 보기" : "신청할 수 있는지 확인하기"}
                  </button>
                )}
              </EvidenceContext.Provider>
            )}
          </div>

          {/* 원문 뷰어: 데스크톱은 오른쪽 고정, 모바일은 머리글의 '원문 보기'로 여는 시트 */}
          <SourcePanel open={sheetOpen} onClose={() => setSheetOpen(false)}>
            <SourceViewer
              source={source}
              transcript={analysis?.transcript?.length ? analysis.transcript : null}
              active={active}
              onIndex={setIndex}
              onClose={() => setSheetOpen(false)}
            />
          </SourcePanel>
        </main>
      )}
    </div>
  );
}

// ── 머리글 ──────────────────────────────────────────────────────

function Header({ onHome, homeLabel, onSource }: { onHome?: () => void; homeLabel: string; onSource?: () => void }) {
  const button = "rounded-xl border border-line px-3 py-2 text-[15px] font-semibold text-ink-2 hover:bg-surface-2";
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-surface/90 backdrop-blur">
      <div className="mx-auto flex h-[60px] max-w-[1440px] items-center gap-2 px-4 sm:px-6">
        {onHome ? <button type="button" onClick={onHome} aria-label="처음으로"><Logo /></button> : <Logo />}
        <div className="ml-auto flex items-center gap-2">
          {onSource && <button type="button" onClick={onSource} className={`${button} lg:hidden`}>원문 보기</button>}
          {onHome && <button type="button" onClick={onHome} className={button}>{homeLabel}</button>}
        </div>
      </div>
    </header>
  );
}

// ── 메뉴 ────────────────────────────────────────────────────────

function MenuBar({ menu, onMenu }: { menu: "analyze" | "finder"; onMenu: (m: "analyze" | "finder") => void }) {
  const items: ["analyze" | "finder", string][] = [["analyze", "공고문 분석"], ["finder", "AI 맞춤 공고 찾기"]];
  return (
    <nav aria-label="기능" className="mx-auto max-w-[1180px] px-4 pt-4 sm:px-6">
      <div className="grid grid-cols-2 gap-1 rounded-2xl border border-line bg-surface p-1 sm:inline-grid">
        {items.map(([key, name]) => (
          <button key={key} type="button" aria-current={menu === key ? "page" : undefined} onClick={() => onMenu(key)}
            className={`rounded-xl px-4 py-2.5 text-[16px] font-bold transition ${menu === key ? "bg-ink text-white" : "text-ink-2 hover:bg-surface-2"}`}>{name}</button>
        ))}
      </div>
    </nav>
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
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const [code, setCode] = useState("");
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [unlocking, setUnlocking] = useState(false);

  return (
    <main className="mx-auto max-w-[640px] px-4 pb-16 pt-6 sm:px-6 lg:max-w-[1180px] lg:pt-10">
      <div className="grid items-center gap-10 lg:grid-cols-[1.05fr_0.95fr]">
        <div className="min-w-0">
          <p className="text-[14px] font-semibold text-brand">청년 지원사업 · 장학금 · 정부 지원제도</p>
          <h1 className="mt-3 text-[26px] font-extrabold leading-[1.3] tracking-[-0.02em] text-ink sm:text-[38px]">
            어려운 공고문,
            <br />
            <span className="text-brand">내 상황에 맞게</span> 정리해 드려요
          </h1>
          <p className="mt-4 max-w-[520px] text-[16px] leading-relaxed text-ink-2">
            공고문을 올리면 AI가 신청 자격·제출 서류·마감일·주의 사항을 쉬운 말로 정리하고, 내 조건과 비교해 준비 체크리스트까지 만들어 줘요. 모든 설명에는 근거가 된 공고문 원문을 함께 보여드려요.
          </p>

          {status?.access_required && <form className="mt-6 rounded-xl border border-line bg-surface p-4" onSubmit={async (e) => {
            e.preventDefault(); setUnlocking(true); setUnlockError(null);
            try { await onUnlock(code); setCode(""); } catch (err) { setUnlockError(errorMessage(err)); } finally { setUnlocking(false); }
          }}>
            <label htmlFor="access-code" className="block text-[16px] font-semibold text-ink">이용 코드</label>
            <div className="mt-2 flex gap-2">
              <input id="access-code" type="password" autoComplete="current-password" required maxLength={256} value={code} onChange={e => setCode(e.target.value)} className="min-w-0 flex-1 rounded-lg border border-line px-3 py-2 text-[16px]" />
              <button disabled={unlocking} className="rounded-lg bg-brand px-4 py-2 text-[16px] font-semibold text-white">{unlocking ? "확인 중…" : "확인"}</button>
            </div>
            {unlockError && <p role="alert" className="mt-2 text-[15px] text-bad">{unlockError}</p>}
          </form>}

          <details className="mt-6 rounded-xl border border-line bg-surface px-4 py-3">
            <summary className="cursor-pointer text-[16px] font-semibold text-ink-2">내 상황 미리 적기 <span className="font-normal text-muted">(선택)</span></summary>
            <label htmlFor="initial-profile" className="mt-3 block text-[15px] text-ink-2">나이, 사는 곳처럼 알고 있는 조건</label>
            <textarea id="initial-profile" value={extra} onChange={e => onExtra(e.target.value)} rows={3} maxLength={2000} placeholder="예: 춘천 거주, 만 25세" className="mt-2 w-full resize-y rounded-xl border border-line bg-surface-2 px-3.5 py-2.5 text-[16px] outline-none focus:border-brand" />
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
            role="button"
            tabIndex={0}
            aria-label="공고문 파일이나 사진 선택"
            onClick={() => input.current?.click()}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                input.current?.click();
              }
            }}
            className={`mt-4 cursor-pointer rounded-2xl border-2 border-dashed px-6 py-9 text-center transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
              drag ? "border-brand bg-brand-soft" : "border-line-strong bg-surface"
            }`}
          >
            <UploadIcon />
            <p className="mt-3 text-[17px] font-semibold text-ink">공고문 파일이나 사진을 올려 주세요</p>
            <p className="mt-1 text-[15px] text-ink-2">PDF, 한글 파일, 사진</p>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                input.current?.click();
              }}
              className="mt-4 rounded-xl bg-brand px-6 py-3 text-[16px] font-bold text-white transition hover:bg-brand-ink"
            >
              파일 선택
            </button>
            <input
              ref={input}
              type="file"
              accept={FILE_ACCEPT}
              multiple
              className="hidden"
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => {
                if (e.target.files) onFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </div>
          <p className="mt-2 text-[14px] leading-relaxed text-ink-2">올린 파일과 적은 내용은 분석에만 쓰고 이 서비스에 저장하지 않아요. 분석은 미국 Anthropic의 AI가 하고, 그쪽에서도 30일 안에 지워져요. 같은 파일을 다시 올리면 7일 동안은 지난 분석 결과를 다시 써요. 파일 자체는 저장하지 않아요.</p>

          {error && <div role="alert" className="mt-4 rounded-xl bg-bad-soft px-4 py-3 text-[16px] leading-relaxed text-bad">{error}</div>}
          {onRetryUpload && (
            <button type="button" onClick={onRetryUpload} className="mt-3 rounded-xl bg-brand px-4 py-2.5 text-[16px] font-semibold text-white">
              같은 파일로 다시 시도
            </button>
          )}
          {status?.provider === "none" && !error && (
            <p className="mt-4 rounded-xl bg-warn-soft px-4 py-3 text-[16px] leading-relaxed text-warn">지금은 분석을 할 수 없어요. 잠시 후 다시 와 주세요.</p>
          )}
        </div>
        <HeroMock />
      </div>
    </main>
  );
}

function HeroMock() {
  return (
    <div className="hidden min-w-0 rounded-2xl border border-line bg-surface p-5 shadow-[0_20px_50px_rgba(16,24,40,.10)] lg:block" aria-hidden>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="rounded-full bg-brand-soft px-2.5 py-1 text-[14px] font-semibold text-brand-ink">주거·월세 지원</span>
        <span className="rounded-full bg-bad-soft px-2.5 py-1 text-[14px] font-semibold text-bad">신청 마감 D-12</span>
      </div>
      <div className="mt-3 text-[16px] font-bold leading-snug text-ink">청년 월세 지원사업 참여자 모집</div>
      <div className="mt-1 text-[14px] text-ink-2">월세를 월 최대 20만원, 최대 12개월 지원해 줘요.</div>
      <div className="mt-4 space-y-2">
        {[
          ["ok", "충족", "만 19~34세 청년이어야 해요"],
          ["ok", "충족", "주민등록상 주소가 가람시여야 해요"],
          ["warn", "확인 필요", "원가구 소득이 중위소득 100% 이하"],
        ].map(([tone, status, text]) => (
          <div key={text} className="flex items-center gap-2 rounded-xl bg-surface-2 px-3 py-2">
            <span className={`shrink-0 rounded-full px-2.5 py-1 text-[14px] font-semibold ${tone === "ok" ? "bg-ok-soft text-ok" : "bg-warn-soft text-warn"}`}>{status}</span>
            <span className="text-[14px] text-ink">{text}</span>
          </div>
        ))}
      </div>
      <div className="mt-3 inline-flex rounded-md border border-brand bg-brand-soft px-2 py-1 text-[14px] font-medium text-brand-ink">
        원문 1쪽
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

function AnalyzingPanel({ uploadProgress }: { uploadProgress: number | null }) {
  const sending = uploadProgress !== null;
  return (
    <div className="rounded-2xl border border-line bg-surface p-6 sm:p-8">
      <div role="status" className="flex items-center gap-3">
        <Spinner className="text-brand" />
        <h2 className="text-[20px] font-bold tracking-tight text-ink">{sending ? "공고문을 보내고 있어요" : "공고문을 읽고 있어요"}</h2>
      </div>
      {sending
        ? <progress aria-label="공고문 보내는 중" max={100} value={uploadProgress} className="mt-4 w-full accent-brand" />
        : <p className="mt-3 text-[16px] leading-relaxed text-ink-2">길면 몇 분 걸릴 수 있어요.</p>}
    </div>
  );
}

// ── 결과 첫 화면 ────────────────────────────────────────────────

// 내 조건 탭이 열려 있으면 바로 아래 질문이 확인하는 길이라 버튼을 숨긴다.
function ResultHeader({ a, note, matched, onCheck }: { a: Analysis; note: string | null; matched: boolean; onCheck?: () => void }) {
  const deadline = deadlineInfo(a);
  const expired = !!deadline?.expired;
  return (
    <section aria-labelledby="result-title" className="rounded-2xl border border-line bg-surface p-5 sm:p-6">
      {expired && <p className="mb-3 text-[16px] font-semibold text-bad">{deadline!.text}</p>}
      {a.organization && <p className="text-[15px] text-ink-2">{a.organization}</p>}
      <h1 id="result-title" className="mt-1 text-[22px] font-extrabold leading-snug tracking-[-0.01em] text-ink sm:text-[26px]">{a.title}</h1>
      <p className="mt-2 text-[16px] leading-relaxed text-ink-2">{a.one_line}</p>
      {deadline.days === null ? (
        <p className="mt-3 text-[16px] text-ink-2">{deadline.text}</p>
      ) : !expired && (
        <p className="mt-3 text-[17px] font-bold text-ink">
          {deadline.text}{" "}
          <span className={`whitespace-nowrap font-semibold ${deadline.days <= 7 ? "text-bad" : "text-ink-2"}`}>{deadline.left}</span>
        </p>
      )}
      {note && <p className="mt-2 text-[15px] text-ink-2">{note}</p>}
      {onCheck && <button
        type="button"
        onClick={onCheck}
        className={`mt-4 w-full rounded-xl px-5 py-3 text-[16px] font-bold transition sm:w-auto ${
          expired ? "border border-line text-ink-2 hover:bg-surface-2" : "bg-brand text-white hover:bg-brand-ink"
        }`}
      >
        {matched ? "내 결과 보기" : "신청할 수 있는지 확인하기"}
      </button>}
    </section>
  );
}

// ── 탭 ──────────────────────────────────────────────────────────

const TABS: [Tab, string][] = [
  ["mine", "내 조건 입력"],
  ["overview", "한눈에 보기"],
  ["eligibility", "신청 자격"],
  ["documents", "제출 서류"],
  ["cautions", "주의 사항"],
  ["glossary", "용어 풀이"],
];

function Tabs({ tab, onTab, match, matching }: { tab: Tab; onTab: (t: Tab) => void; match: Match | null; matching: boolean }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const enabled = (k: Tab) => !matching || k === "mine";
  const keyDown = (e: React.KeyboardEvent, i: number) => {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!step && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    const order = e.key === "Home" ? TABS.map((_, j) => j) : e.key === "End" ? TABS.map((_, j) => TABS.length - 1 - j)
      : TABS.map((_, j) => (i + step * (j + 1) + TABS.length * 2) % TABS.length);
    const next = order.find((j) => enabled(TABS[j][0]));
    if (next === undefined) return;
    refs.current[next]?.focus();
    onTab(TABS[next][0]);
  };
  return (
    <div className="sticky top-[60px] z-10 -mx-4 mt-4 border-b border-line bg-bg/95 px-4 backdrop-blur sm:mx-0 sm:px-0">
      <div role="tablist" aria-label="공고 내용" className="scrollbar-thin flex gap-1 overflow-x-auto py-2">
        {TABS.map(([k, name], i) => {
          const on = tab === k;
          const label = k === "mine" ? (matching ? "확인 중…" : match ? "내 결과" : name) : name;
          return (
            <button
              key={k}
              ref={(el) => { refs.current[i] = el; }}
              id={`tab-${k}`}
              type="button"
              role="tab"
              aria-selected={on}
              aria-controls="tab-panel"
              tabIndex={on ? 0 : -1}
              disabled={!enabled(k)}
              onClick={() => onTab(k)}
              onKeyDown={(e) => keyDown(e, i)}
              className={`shrink-0 rounded-xl px-4 py-2 text-[16px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${
                on ? (k === "mine" ? "bg-brand text-white" : "bg-ink text-white") : k === "mine" ? "text-brand-ink hover:bg-brand-soft" : "text-ink-2 hover:bg-surface"
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
