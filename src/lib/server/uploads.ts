import type { InputFile } from "../llm";
import { HOSTED_DIRECT_UPLOAD_BYTES, MAX_UPLOAD_BYTES } from "../limits";
import { MAX_DOCUMENT_PAGES, MAX_EXTRACTED_CHARS } from "../document-limits";
import { buildIndex, locate, type TextIndex } from "../textmatch";
import type { Analysis } from "../schema";
import { AppError } from "./errors";
import { readBody } from "./http";
import { isHosted } from "./config";
import { fileMediaType, SUPPORTED_TYPES } from "../filetypes";

const TYPES = SUPPORTED_TYPES;

export type UploadSpec = { name: string; mediaType: string; size: number };

export function validateUploadSpecs(files: UploadSpec[], maxBytes = MAX_UPLOAD_BYTES) {
  if (!files.length || files.length > 10) throw new AppError("invalid_input", "문서는 한 개, 사진은 최대 10장까지 올려 주세요.", 400);
  if (files.some(f => !f.name || f.name.length > 200 || !Number.isSafeInteger(f.size) || f.size <= 0)) throw new AppError("invalid_input", "파일 이름과 용량을 확인해 주세요.", 400);
  if (files.some(f => !TYPES.includes(f.mediaType))) throw new AppError("unsupported_file", "PDF, HWP, HWPX, JPG, PNG, WEBP, GIF 파일을 지원해요.", 415);
  if (files.some(f => !f.mediaType.startsWith("image/")) && files.length !== 1) throw new AppError("invalid_input", "PDF·한글 문서는 한 번에 한 개만 올려 주세요.", 400);
  if (files.reduce((sum, f) => sum + f.size, 0) > maxBytes || files.some(f => f.mediaType.startsWith("image/") && f.size > 5 * 1024 * 1024)) throw new AppError("too_large", `파일이 너무 커요. 문서는 ${maxBytes / 1024 / 1024}MB, 사진은 장당 5MB·합계 ${maxBytes / 1024 / 1024}MB까지 올릴 수 있어요.`, 413);
}

export function matchesSignature(type: string, b: Buffer) {
  if (type === "application/x-hwp") return b.subarray(0, 8).equals(Buffer.from([208, 207, 17, 224, 161, 177, 26, 225]));
  if (type === "application/hwp+zip") return b.subarray(0, 4).equals(Buffer.from([80, 75, 3, 4]));
  if (type === "application/pdf") return b.subarray(0, 1024).includes(Buffer.from("%PDF-"));
  if (type === "image/png") return b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (type === "image/jpeg") return b.length > 3 && b[0] === 255 && b[1] === 216 && b[2] === 255;
  if (type === "image/webp") return b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP";
  if (type === "image/gif") return ["GIF87a", "GIF89a"].includes(b.toString("ascii", 0, 6));
  return false;
}

/** `maxBytes` is the active provider's upload limit (see limits.ts). */
export async function readUploads(req: Request, maxBytes = MAX_UPLOAD_BYTES): Promise<InputFile[]> {
  const limit = isHosted() ? Math.min(HOSTED_DIRECT_UPLOAD_BYTES, maxBytes) : maxBytes;
  const bytes = await readBody(req, limit + 128 * 1024, "multipart/form-data");
  let form: FormData;
  try { form = await new Response(bytes as BodyInit, { headers: { "Content-Type": req.headers.get("content-type")! } }).formData(); }
  catch { throw new AppError("invalid_input", "업로드한 파일을 읽지 못했어요.", 400); }
  const entries = [...form.entries()];
  if (!entries.length || entries.some(([k, v]) => k !== "files" || !(v instanceof File))) throw new AppError("invalid_input", "공고문 파일만 올려 주세요.", 400);
  const files = entries.map(([, v]) => { const f = v as File; return new File([f], f.name, { type: fileMediaType(f.name, f.type) }); });
  if (files.length > 10) throw new AppError("invalid_input", "사진은 최대 10장까지 올릴 수 있어요.", 400);
  const docs = files.filter((f) => !f.type.startsWith("image/"));
  if (docs.length && files.length !== 1) throw new AppError("invalid_input", "PDF·한글 문서는 한 번에 한 개만 올려 주세요.", 400);
  if (files.some((f) => !TYPES.includes(f.type))) throw new AppError("unsupported_file", "PDF, HWP, HWPX, JPG, PNG, WEBP, GIF 파일을 지원해요. HEIC는 JPG로 변환해 주세요.", 415);
  if (files.some((f) => !f.size)) throw new AppError("empty_file", "내용이 없는 파일이에요.", 400);
  validateUploadSpecs(files.map(f => ({ name: f.name, mediaType: f.type, size: f.size })), limit);
  const input: InputFile[] = [];
  for (const file of files) {
    const data = Buffer.from(await file.arrayBuffer());
    if (!matchesSignature(file.type, data)) throw new AppError("invalid_file", "확장자와 실제 파일 내용이 다르거나 파일이 손상됐어요.", 400);
    input.push({ name: file.name.slice(0, 200), mediaType: file.type, data });
  }
  return input;
}

export async function inspectPdf(file: InputFile, signal: AbortSignal): Promise<{ pages: number; index: TextIndex }> {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = getDocument({ data: new Uint8Array(file.data), stopAtErrors: true, useSystemFonts: true });
  let timedOut = false;
  const stop = () => { void task.destroy().catch(() => {}); };
  const timer = setTimeout(() => { timedOut = true; stop(); }, 15_000);
  signal.addEventListener("abort", stop, { once: true });
  try {
    signal.throwIfAborted();
    const doc = await task.promise;
    if (doc.numPages > MAX_DOCUMENT_PAGES) throw new AppError("too_many_pages", `PDF는 ${MAX_DOCUMENT_PAGES}쪽까지 분석할 수 있어요. 나눠 올려 주세요.`, 413);
    const pages = [];
    let chars = 0;
    for (let i = 1; i <= doc.numPages; i++) {
      signal.throwIfAborted();
      const page = await doc.getPage(i), content = await page.getTextContent();
      const items = content.items.map((item) => "str" in item ? item.str : "");
      chars += items.reduce((s, v) => s + v.length, 0);
      if (chars > MAX_EXTRACTED_CHARS) throw new AppError("too_long", "추출한 본문이 100만 자를 넘어요. 공고문을 나눠 올려 주세요.", 413);
      pages.push({ page: i, items });
      page.cleanup();
    }
    return { pages: doc.numPages, index: buildIndex(pages, "pdf") };
  } catch (e) {
    if (e instanceof AppError) throw e;
    if (signal.aborted) throw new AppError("cancelled", "요청을 취소했어요.", 499);
    throw new AppError("invalid_pdf", timedOut ? "PDF를 읽는 데 너무 오래 걸려요. 필요한 쪽만 따로 저장해 주세요." : "잠긴 PDF이거나 읽을 수 없는 파일이에요. 암호를 해제하거나 새 PDF로 저장해 주세요.", 400);
  } finally {
    clearTimeout(timer); signal.removeEventListener("abort", stop); await task.destroy().catch(() => {});
  }
}

type Evidence = Analysis["contact_evidence"][number];

export function verifyEvidence(a: Analysis, index: TextIndex | null) {
  const all = [...a.benefits, ...a.schedule, ...a.how_to_apply, ...a.eligibility, ...a.documents, ...a.cautions, ...a.glossary].flatMap((i) => i.evidence).concat(a.contact_evidence);
  const counts = { exact: 0, fuzzy: 0, missing: 0, unverified: 0 };
  // Quotes that matched exactly one page away from the cited page (the browser highlights the same page).
  const pageCorrections: { page: number; found_page: number; quote: string }[] = [];
  const results = new Map<Evidence, keyof typeof counts>();
  const statusOn = (page: TextIndex["pages"][number] | undefined, quote: string) =>
    !page || page.norm.length < 20 ? null : locate({ ...index!, pages: [page], hasText: true }, page.page, quote).status;
  const check = (e: Evidence): keyof typeof counts => {
    if (e.quote.trim().length < 2) return "unverified";
    const own = statusOn(index?.pages.find((p) => p.page === e.page), e.quote);
    if (own === "exact") return "exact";
    const near = index?.pages.find((p) => Math.abs(p.page - e.page) === 1 && statusOn(p, e.quote) === "exact");
    if (near) {
      pageCorrections.push({ page: e.page, found_page: near.page, quote: e.quote });
      return "exact";
    }
    return own === null || own === "unknown" ? "unverified" : own === "none" ? "missing" : own;
  };
  const confidence = (e: Evidence) => {
    if (!results.has(e)) results.set(e, check(e));
    return results.get(e)!;
  };
  for (const e of all) counts[confidence(e)]++;
  return {
    ...counts,
    // OCR produced by the same model is NOT independent source verification.
    method: index?.hasText ? index.source === "extracted" ? "extracted_text" : "pdf_text" : "unverified_scan_or_image",
    // Eligibility still requires an exact match for every quote; fuzzy never verifies a criterion.
    unverified_criteria: a.eligibility.filter((c) => !c.evidence.length || c.evidence.some((e) => confidence(e) !== "exact")).map((c) => c.id),
    // Schedule rows (by index) whose quotes are missing or not found exactly; they cannot confirm a deadline.
    unverified_schedule: a.schedule.flatMap((s, i) => !s.evidence.length || s.evidence.some((e) => confidence(e) !== "exact") ? [i] : []),
    page_corrections: pageCorrections,
  };
}
