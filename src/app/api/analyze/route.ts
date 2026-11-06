import { randomUUID } from "node:crypto";
import { AnalysisSchema } from "@/lib/schema";
import { ANALYZE_SYSTEM, analyzeUserText } from "@/lib/prompts";
import { detectProvider, runStructured, todayKST } from "@/lib/llm";
import { AppError, errorResponse, json } from "@/lib/server/errors";
import { acquireAI, guard, limitAttempts } from "@/lib/server/guard";
import { readUploads, inspectPdf, verifyEvidence } from "@/lib/server/uploads";
import { extractHangul } from "@/lib/server/hangul";
import { validateAnalysis } from "@/lib/server/validation";
import { signAnalysis } from "@/lib/server/tokens";
import type { TextIndex } from "@/lib/textmatch";
import { isLoopbackRequest } from "@/lib/server/http";

export const maxDuration = 300;
export async function POST(req: Request) {
  const requestId = randomUUID(), started = Date.now();
  let release: (() => Promise<void>) | undefined;
  try {
    const sid = guard(req);
    await limitAttempts(req);
    const provider = await detectProvider();
    if (provider === "none") throw new AppError("no_provider", "AI 연결이 준비되지 않았어요. 샘플 체험을 이용해 주세요.", 503);
    if (provider === "cli" && !isLoopbackRequest(req)) throw new AppError("local_only", "로컬 분석은 localhost에서만 사용할 수 있어요.", 403);
    const files = await readUploads(req);
    release = await acquireAI(req, sid, "analyze");
    const first = files[0], pdf = first.mediaType === "application/pdf";
    const hangul = ["application/x-hwp", "application/hwp+zip"].includes(first.mediaType);
    let index: TextIndex | null = null, count = files.length;
    let extracted: Awaited<ReturnType<typeof extractHangul>> | null = null;
    if (pdf) { const inspected = await inspectPdf(first, req.signal); index = inspected.index; count = inspected.pages; }
    if (hangul) { extracted = await extractHangul(first, req.signal); index = extracted.index; count = extracted.sections.length; }
    const text = extracted
      ? `오늘은 ${todayKST()}입니다. 한글 공고문에서 추출한 본문을 분석하세요. page는 아래 구역 번호이며 실제 쪽수는 아닙니다. transcript는 빈 배열로 두세요. 표 셀 연결이 모호하면 추측하지 말고 reading_notes에 명시하세요.\n${extracted.warning}\n\n${extracted.sections.map(s => `=== ${s.page}구역 ===\n${s.text}`).join("\n\n")}`
      : analyzeUserText({ kind: pdf ? "pdf" : "images", count: files.length, today: todayKST() });
    const { data: analysis, provider: used } = await runStructured({
      system: ANALYZE_SYSTEM, text, files: extracted ? [] : files, schema: AnalysisSchema, signal: req.signal,
    });
    validateAnalysis(analysis, count);
    const verification = verifyEvidence(analysis, index);
    if (extracted?.uncertainLayout) verification.unverified_criteria = analysis.eligibility.map(c => c.id);
    const source = extracted ? { kind: "text", name: first.name, sections: extracted.sections, warning: extracted.warning } : undefined;
    console.info(JSON.stringify({ event: "analyze_complete", request_id: requestId, provider: used, elapsed_ms: Date.now() - started, verification }));
    return json({ analysis, analysis_token: signAnalysis(analysis, sid, verification.unverified_criteria), verification, source, provider: used, elapsed_ms: Date.now() - started, request_id: requestId }, 200, { "X-Request-Id": requestId });
  } catch (e) { return errorResponse(e, requestId); }
  finally { await release?.(); }
}
