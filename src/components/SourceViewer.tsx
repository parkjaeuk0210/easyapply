"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import type { PDFDocumentProxy } from "pdfjs-dist";
import "react-pdf/dist/Page/TextLayer.css";
import { buildIndex, escapeHtml, type PageItems, type TextIndex } from "@/lib/textmatch";
import type { ActiveEvidence, Source } from "./types";

// workerSrc는 react-pdf 컴포넌트를 쓰는 같은 모듈에서 지정해야 한다.
pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

type Props = {
  source: Source;
  transcript: { page: number; text: string }[] | null;
  active: ActiveEvidence | null;
  onIndex: (index: TextIndex) => void;
  onClose?: () => void;
};

export default function SourceViewer({ source, transcript, active, onIndex, onClose }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [pageCount, setPageCount] = useState(source.kind === "images" ? source.urls.length : 0);
  const [zoom, setZoom] = useState(1);

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-none bg-surface lg:rounded-2xl lg:border lg:border-line">
      <div className="flex items-center gap-2 border-b border-line px-4 py-3">
        <DocIcon />
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold text-ink">공고문 원문</div>
          <div className="truncate text-xs text-muted">
            {source.kind === "pdf" ? source.name : `이미지 ${source.urls.length}장`}
            {pageCount ? ` · ${pageCount}쪽` : ""}
          </div>
        </div>
        <div className="flex items-center rounded-lg border border-line" role="group" aria-label="확대/축소">
          <button
            onClick={() => setZoom((z) => Math.max(1, +(z - 0.5).toFixed(1)))}
            disabled={zoom <= 1}
            className="px-2.5 py-1 text-sm font-semibold text-ink-2 disabled:opacity-30"
            aria-label="축소"
          >
            −
          </button>
          <span className="w-10 text-center text-[11px] tabular-nums text-muted">{Math.round(zoom * 100)}%</span>
          <button
            onClick={() => setZoom((z) => Math.min(3, z + 0.5))}
            disabled={zoom >= 3}
            className="px-2.5 py-1 text-sm font-semibold text-ink-2 disabled:opacity-30"
            aria-label="확대"
          >
            +
          </button>
        </div>
        {source.kind === "pdf" && (
          <a
            href={source.url}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-muted hover:bg-surface-2 hover:text-ink"
          >
            새 창으로
          </a>
        )}
        {onClose && (
          <button
            onClick={onClose}
            className="rounded-lg px-2.5 py-1.5 text-sm font-medium text-ink-2 hover:bg-surface-2 lg:hidden"
            aria-label="원문 닫기"
          >
            닫기
          </button>
        )}
      </div>

      {active && <EvidenceBanner active={active} photo={source.kind === "images"} />}

      <div ref={scrollRef} className="scrollbar-thin relative flex-1 overflow-auto bg-[#e9ecf1] px-3 py-4 sm:px-5">
        {source.kind === "pdf" ? (
          <PdfPane url={source.url} active={active} onIndex={onIndex} onPages={setPageCount} scrollRef={scrollRef} zoom={zoom} />
        ) : (
          <ImagePane
            urls={source.urls}
            transcript={transcript}
            active={active}
            onIndex={onIndex}
            scrollRef={scrollRef}
            zoom={zoom}
          />
        )}
      </div>
    </div>
  );
}

function EvidenceBanner({ active, photo }: { active: ActiveEvidence; photo: boolean }) {
  const msg = {
    exact: {
      tone: "text-ok",
      icon: "✓",
      text: photo
        ? `사진 ${active.page}쪽 판독 글자에서 같은 문장을 찾았어요 · 사진에서도 확인해 보세요`
        : `원문 ${active.page}쪽에서 같은 문장을 찾았어요`,
    },
    fuzzy: { tone: "text-warn", icon: "≈", text: `${active.page}쪽에서 비슷한 문장을 찾았어요 · 표시된 곳을 직접 확인해 주세요` },
    none: { tone: "text-bad", icon: "!", text: `원문에서 같은 문장을 찾지 못했어요 · ${active.page}쪽을 직접 확인해 주세요` },
    unknown: { tone: "text-ink-2", icon: "i", text: `글자 인식이 안 되는 스캔 문서예요 · ${active.page}쪽에서 직접 확인해 주세요` },
  }[active.status];
  return (
    <div key={active.key} className="border-b border-line bg-surface-2 px-4 py-3">
      <div className={`flex items-center gap-1.5 text-xs font-semibold ${msg.tone}`}>
        <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-current/10 text-[10px]">{msg.icon}</span>
        {msg.text}
      </div>
      <p className="mt-1.5 line-clamp-3 border-l-[3px] border-mark pl-2.5 text-[13px] leading-relaxed text-ink-2">
        “{active.quote}”
      </p>
    </div>
  );
}

// ── PDF ─────────────────────────────────────────────────────────

function PdfPane({
  url,
  active,
  onIndex,
  onPages,
  scrollRef,
  zoom,
}: {
  url: string;
  active: ActiveEvidence | null;
  onIndex: (i: TextIndex) => void;
  onPages: (n: number) => void;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  zoom: number;
}) {
  const [numPages, setNumPages] = useState(0);
  const [width, setWidth] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const pageEl = useCallback(
    (page: number) => scrollRef.current?.querySelector<HTMLElement>(`[data-page="${page}"]`) ?? null,
    [scrollRef],
  );

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.min(el.clientWidth - 24, 900)));
    ro.observe(el);
    setWidth(Math.min(el.clientWidth - 24, 900));
    return () => ro.disconnect();
  }, [scrollRef]);

  const onLoad = useCallback(
    async (pdf: PDFDocumentProxy) => {
      setNumPages(pdf.numPages);
      onPages(pdf.numPages);
      const pages: PageItems[] = [];
      for (let i = 1; i <= pdf.numPages; i++) {
        const content = await (await pdf.getPage(i)).getTextContent();
        pages.push({ page: i, items: content.items.map((it) => ("str" in it ? it.str : "")) });
      }
      onIndex(buildIndex(pages, "pdf"));
    },
    [onIndex, onPages],
  );

  const scrollToPage = useCallback(
    (page: number) => {
      const box = scrollRef.current;
      const el = pageEl(page);
      if (box && el) box.scrollTo({ top: el.offsetTop - 12, behavior: "smooth" });
    },
    [scrollRef, pageEl],
  );

  const scrollToMark = useCallback(
    (page: number) => {
      const box = scrollRef.current;
      const mark = pageEl(page)?.querySelector("mark.ea-hl");
      if (!box || !mark) return false;
      const b = box.getBoundingClientRect();
      const m = mark.getBoundingClientRect();
      box.scrollTo({
        top: box.scrollTop + (m.top - b.top) - box.clientHeight / 3,
        left: box.scrollLeft + (m.left - b.left) - 24,
        behavior: "smooth",
      });
      return true;
    },
    [scrollRef, pageEl],
  );

  // 하이라이트가 없는 근거는 해당 쪽으로만 이동. 있는 경우는 텍스트 레이어가 다시 그려진 뒤 이동한다.
  useEffect(() => {
    if (!active) return;
    if (!active.items.length) {
      scrollToPage(active.page);
      return;
    }
    const t = setTimeout(() => {
      if (!scrollToMark(active.page)) scrollToPage(active.page);
    }, 900);
    return () => clearTimeout(t);
  }, [active, scrollToMark, scrollToPage]);

  const renderer = useCallback(
    ({ str, itemIndex }: { str: string; itemIndex: number }) => {
      const r = active?.ranges[itemIndex];
      if (!r) return escapeHtml(str);
      const [a, b] = r;
      return `${escapeHtml(str.slice(0, a))}<mark class="ea-hl">${escapeHtml(str.slice(a, b))}</mark>${escapeHtml(str.slice(b))}`;
    },
    [active],
  );

  if (error) return <p className="p-6 text-center text-sm text-bad">{error}</p>;

  return (
    <Document
      file={url}
      onLoadSuccess={onLoad}
      onLoadError={() => setError("PDF를 열지 못했어요. 암호가 걸려 있거나 손상된 파일일 수 있어요.")}
      loading={<PagePlaceholder width={width} label="원문 불러오는 중" />}
      className={`flex flex-col gap-4 ${zoom > 1 ? "items-start" : "items-center"}`}
    >
      {width > 0 &&
        Array.from({ length: numPages }, (_, i) => i + 1).map((n) => (
          <div key={n} data-page={n} className="relative">
            <div className="pointer-events-none absolute -left-1 -top-2.5 z-10 rounded-md bg-ink/75 px-1.5 py-0.5 text-[10px] font-semibold text-white">
              {n}쪽
            </div>
            <Page
              pageNumber={n}
              width={width * zoom}
              renderAnnotationLayer={false}
              customTextRenderer={active?.page === n ? renderer : undefined}
              onRenderTextLayerSuccess={() => {
                if (active?.page === n && active.items.length) scrollToMark(n);
              }}
              loading={<PagePlaceholder width={width} />}
              className={`overflow-hidden rounded-sm bg-white shadow-[0_1px_3px_rgba(16,24,40,.12),0_6px_20px_rgba(16,24,40,.06)] ${
                active?.page === n ? "ring-2 ring-brand/50" : ""
              }`}
            />
          </div>
        ))}
    </Document>
  );
}

function PagePlaceholder({ width, label }: { width: number; label?: string }) {
  return (
    <div
      style={{ width: width || 320, height: (width || 320) * 1.414 }}
      className="flex animate-pulse items-center justify-center rounded-sm bg-white/70 text-xs text-muted"
    >
      {label}
    </div>
  );
}

// ── 이미지 ──────────────────────────────────────────────────────

function ImagePane({
  urls,
  transcript,
  active,
  onIndex,
  scrollRef,
  zoom,
}: {
  urls: string[];
  transcript: { page: number; text: string }[] | null;
  active: ActiveEvidence | null;
  onIndex: (i: TextIndex) => void;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  zoom: number;
}) {
  const lines = useMemo(
    () =>
      urls.map((_, i) => {
        const t = transcript?.find((p) => p.page === i + 1)?.text ?? "";
        return t.split(/\r?\n/);
      }),
    [urls, transcript],
  );

  useEffect(() => {
    if (!transcript) return;
    onIndex(buildIndex(lines.map((items, i) => ({ page: i + 1, items })), "transcript"));
  }, [lines, transcript, onIndex]);

  useEffect(() => {
    if (!active) return;
    const box = scrollRef.current;
    const el = box?.querySelector<HTMLElement>(`[data-page="${active.page}"]`);
    if (box && el) box.scrollTo({ top: el.offsetTop - 12, behavior: "smooth" });
  }, [active, scrollRef]);

  return (
    <div className={`flex flex-col gap-5 ${zoom > 1 ? "items-start" : "items-center"}`}>
      {urls.map((u, i) => {
        const page = i + 1;
        const isActive = active?.page === page;
        const hasText = lines[i].some((l) => l.trim());
        return (
          <div
            key={u}
            data-page={page}
            className="relative max-w-none shrink-0"
            style={{ width: `min(${900 * zoom}px, ${100 * zoom}%)` }}
          >
            <div className="absolute -left-1 -top-2.5 z-10 rounded-md bg-ink/75 px-1.5 py-0.5 text-[10px] font-semibold text-white">
              {page}쪽
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element -- 사용자가 올린 로컬 이미지(blob URL) */}
            <img
              src={u}
              alt={`공고문 ${page}쪽`}
              className={`w-full rounded-sm bg-white shadow-[0_1px_3px_rgba(16,24,40,.12),0_6px_20px_rgba(16,24,40,.06)] ${
                isActive ? "ring-2 ring-brand/50" : ""
              }`}
            />
            {hasText && (
              <details open={isActive && !!active?.items.length} className="mt-2 rounded-lg bg-white/80 px-3 py-2 text-[13px]">
                <summary className="cursor-pointer select-none text-xs font-medium text-muted">AI가 읽은 글자 보기</summary>
                <div className="mt-2 space-y-0.5 leading-relaxed text-ink-2">
                  {lines[i].map((l, li) => (
                    <div key={li}>
                      {isActive && active?.items.includes(li) ? <mark className="ea-line">{l}</mark> : l || " "}
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>
        );
      })}
    </div>
  );
}

function DocIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden>
      <rect width="28" height="28" rx="8" fill="var(--brand-soft)" />
      <path d="M9 7.5h6.5L19 11v9.5H9z" stroke="var(--brand)" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M11.5 14h5M11.5 17h3.5" stroke="var(--brand)" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
