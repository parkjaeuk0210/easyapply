"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import init, { HwpDocument } from "@rhwp/core";
import { MAX_DOCUMENT_PAGES } from "@/lib/document-limits";

const WASM_URL = "/vendor/rhwp-0.8.7/rhwp_bg.wasm";
const MAX_SVG_BYTES = 16 * 1024 * 1024;
let initialization: Promise<void> | null = null;

function initialize() {
  if (!initialization) initialization = (async () => {
    const context = document.createElement("canvas").getContext("2d");
    if (!context) throw new Error("canvas unavailable");
    (globalThis as typeof globalThis & { measureTextWidth: (font: string, text: string) => number }).measureTextWidth = (font, text) => {
      context.font = font;
      return context.measureText(text).width;
    };
    const response = await fetch(WASM_URL, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error("renderer unavailable");
    await init({ module_or_path: await response.arrayBuffer() });
  })().catch(error => { initialization = null; throw error; });
  return initialization;
}

type Props = { file: File; zoom: number; onTextView: () => void; initialPage?: number; onPageChange?: (file: File, page: number) => void };
type DocumentState = { file: File; document: HwpDocument; pages: number };
type PageState = { file: File; url: string; page: number; pages: number };

export default function HangulPreview({ file, zoom, onTextView, initialPage = 0, onPageChange }: Props) {
  const initialPageRef = useRef(initialPage);
  const documentRef = useRef<DocumentState | null>(null);
  const urlRef = useRef<string | null>(null);
  const [page, setPage] = useState<PageState | null>(null);
  const [error, setError] = useState<{ file: File; message: string } | null>(null);

  const renderPage = useCallback((number: number) => {
    const current = documentRef.current;
    if (!current || number < 0 || number >= current.pages) return;
    try {
      const svg = current.document.renderPageSvg(number);
      const blob = new Blob([svg], { type: "image/svg+xml" });
      if (blob.size > MAX_SVG_BYTES) throw new Error("page too large");
      const url = URL.createObjectURL(blob);
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = url;
      setPage({ file: current.file, url, page: number, pages: current.pages });
      onPageChange?.(current.file, number);
      setError(null);
    } catch {
      setError({ file: current.file, message: "이 쪽을 표시하지 못했어요. ‘글자만 보기’로 확인해 주세요." });
    }
  }, [onPageChange]);

  useEffect(() => {
    let cancelled = false;
    let owned: HwpDocument | null = null;
    void (async () => {
      try {
        const [, bytes] = await Promise.all([initialize(), file.arrayBuffer(), document.fonts.ready]);
        if (cancelled) return;
        owned = new HwpDocument(new Uint8Array(bytes));
        const pages = owned.pageCount();
        if (!pages || pages > MAX_DOCUMENT_PAGES) throw new Error("page limit");
        documentRef.current = { file, document: owned, pages };
        renderPage(Math.max(0, Math.min(initialPageRef.current, pages - 1)));
      } catch {
        owned?.free(); owned = null;
        if (!cancelled) setError({ file, message: "이 문서는 원래 모양으로 보여 드릴 수 없어요. ‘글자만 보기’로 확인해 주세요." });
      }
    })();
    return () => {
      cancelled = true;
      if (documentRef.current?.document === owned) documentRef.current = null;
      owned?.free();
      if (urlRef.current) { URL.revokeObjectURL(urlRef.current); urlRef.current = null; }
    };
  }, [file, renderPage]);

  if (error?.file === file) return <div className="rounded-xl bg-white p-4">
    <p role="alert" className="text-[15px] leading-relaxed text-ink-2">{error.message}</p>
    <button onClick={onTextView} className="mt-3 rounded-lg bg-brand px-4 py-2 text-[15px] font-semibold text-white">글자만 보기</button>
  </div>;

  if (!page || page.file !== file) return <p role="status" className="p-6 text-center text-[15px] text-ink-2">원문을 불러오고 있어요…</p>;

  return <div className="space-y-3">
    <nav className="flex items-center justify-between rounded-xl bg-white px-3 py-2" aria-label="문서 쪽 이동">
      <button onClick={() => renderPage(page.page - 1)} disabled={page.page === 0} className="rounded-lg px-3 py-1.5 text-[15px] font-medium text-ink-2 disabled:opacity-30">이전 쪽</button>
      <span aria-live="polite" className="text-[15px] tabular-nums text-ink-2">{page.page + 1} / {page.pages}쪽</span>
      <button onClick={() => renderPage(page.page + 1)} disabled={page.page + 1 === page.pages} className="rounded-lg px-3 py-1.5 text-[15px] font-medium text-ink-2 disabled:opacity-30">다음 쪽</button>
    </nav>
    {/* SVG is an image resource, never active markup in the application's DOM. */}
    {/* eslint-disable-next-line @next/next/no-img-element -- Local SVG Blob URLs cannot use the image optimizer. */}
    <img src={page.url} alt={`${file.name} ${page.page + 1}쪽`} className="h-auto max-w-none rounded-sm bg-white shadow-sm" style={{ width: `${zoom * 100}%` }} onError={() => setError({ file, message: "이 쪽을 표시하지 못했어요. ‘글자만 보기’로 확인해 주세요." })} />
  </div>;
}
