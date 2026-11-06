import { Worker } from "node:worker_threads";
import path from "node:path";
import type { InputFile } from "../llm";
import { MAX_DOCUMENT_PAGES, MAX_EXTRACTED_CHARS } from "../document-limits";
import { buildIndex } from "../textmatch";
import { AppError } from "./errors";

export async function extractHangul(file: InputFile, signal: AbortSignal) {
  const format = file.mediaType === "application/x-hwp" ? "hwp" : "hwpx";
  const result = await new Promise<{ sections: string[]; images: number; uncertainLayout: boolean }>((resolve, reject) => {
    const worker = new Worker(path.join(process.cwd(), "server/hangul-worker.cjs"), {
      workerData: { bytes: new Uint8Array(file.data), format, maxExtractedChars: MAX_EXTRACTED_CHARS },
      resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 32, stackSizeMb: 4 },
    });
    let settled = false;
    const finish = (error?: AppError, value?: { sections: string[]; images: number; uncertainLayout: boolean }) => {
      if (settled) return; settled = true;
      clearTimeout(timer); signal.removeEventListener("abort", abort);
      void worker.terminate();
      if (error) reject(error); else resolve(value!);
    };
    const abort = () => finish(new AppError("cancelled", "요청을 취소했어요.", 499));
    const timer = setTimeout(() => finish(new AppError("document_timeout", "한글 파일을 읽는 데 너무 오래 걸려요. PDF로 저장해서 올려 주세요.", 422)), 15_000);
    signal.addEventListener("abort", abort, { once: true });
    worker.once("message", (message) => {
      if (message.error) {
        const descriptions: Record<string, string> = {
          encrypted: "암호 또는 배포용 보호가 적용된 한글 파일이에요. 보호를 해제하거나 PDF로 저장해 주세요.",
          version: "이 한글 파일 버전은 지원하지 않아요. HWPX나 PDF로 다시 저장해 주세요.",
          too_long: "한글 파일 내용이 너무 커요. 필요한 부분만 나눠 올려 주세요.",
          no_text: "읽을 수 있는 본문 글자가 없어요. 스캔 문서는 PDF나 이미지로 올려 주세요.",
          invalid: "한글 파일이 손상되었거나 지원하지 않는 구조예요. PDF로 저장해서 올려 주세요.",
        };
        finish(new AppError("invalid_hangul", descriptions[message.error] ?? descriptions.invalid, 422));
      } else finish(undefined, message);
    });
    worker.once("error", () => finish(new AppError("invalid_hangul", "한글 파일을 안전하게 읽지 못했어요. PDF로 저장해서 올려 주세요.", 422)));
    worker.once("exit", () => { if (!settled) finish(new AppError("invalid_hangul", "한글 파일을 끝까지 읽지 못했어요. PDF로 저장해서 올려 주세요.", 422)); });
    if (signal.aborted) abort();
  });
  const sections: { page: number; text: string }[] = [];
  for (const text of result.sections) {
    // These are extraction sections, never purported to be physical pages.
    for (let at = 0; at < text.length; at += 12_000) sections.push({ page: sections.length + 1, text: text.slice(at, at + 12_000) });
  }
  // The worker's 100 native-section / 1M-character limits currently produce at most 183 sections.
  if (sections.length > MAX_DOCUMENT_PAGES) throw new AppError("too_many_sections", "한글 문서의 본문 구역이 너무 많아요. 문서를 나눠 올려 주세요.", 413);
  const warning = `${format.toUpperCase()}에서 추출한 본문이에요. 구역 번호는 실제 쪽수와 다릅니다. ${result.uncertainLayout ? "표의 셀 관계와 배치는 보존되지 않을 수 있어요. " : ""}${result.images ? "포함된 이미지·도형의 글자는 추출하지 않았어요. " : ""}복잡한 표·스캔·도장이 중요하면 PDF로 저장해 다시 분석해 주세요.`;
  // HWP5 requires a verified simple grid; merged or unsupported layouts keep source verification blocked.
  return { sections, warning, index: buildIndex(sections.map((s) => ({ page: s.page, items: s.text.split("\n") })), "extracted"), uncertainLayout: result.uncertainLayout };
}
