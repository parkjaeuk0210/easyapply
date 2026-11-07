import { randomUUID } from "node:crypto";
import { AnalysisSchema } from "@/lib/schema";
import { ANALYZE_SYSTEM, analyzeUserText } from "@/lib/prompts";
import { detectProvider, runStructured, todayKST } from "@/lib/llm";
import { REQUEST_BUDGET_MS, analysisOutputTokens } from "@/lib/llm-limits";
import { maxUploadBytes } from "@/lib/limits";
import { AppError, errorResponse, json } from "@/lib/server/errors";
import { acquireAI, chargeAI, guard, limitAttempts } from "@/lib/server/guard";
import { readUploads, inspectPdf, verifyEvidence } from "@/lib/server/uploads";
import { extractHangul } from "@/lib/server/hangul";
import { settleApplication, validateAnalysis } from "@/lib/server/validation";
import { signAnalysis } from "@/lib/server/tokens";
import type { TextIndex } from "@/lib/textmatch";
import { isLoopbackRequest } from "@/lib/server/http";
import { readJson } from "@/lib/server/http";
import { consumeUploads, uploadManifest } from "@/lib/server/staged-uploads";
import { cacheKey, readCache, writeCache } from "@/lib/server/analysis-cache";
import { buildFlags, numbersFound } from "@/lib/verification-flags";

export const maxDuration = 300;
export async function POST(req: Request) {
  const requestId = randomUUID(), started = Date.now();
  let release: (() => Promise<void>) | undefined;
  const staged = req.headers.get("content-type")?.split(";")[0] === "application/json";
  let consumingUpload = false;
  try {
    const sid = guard(req);
    await limitAttempts(req);
    const provider = await detectProvider();
    if (provider === "none") throw new AppError("no_provider", "AI 연결이 준비되지 않았어요. 잠시 후 다시 시도해 주세요.", 503);
    if (provider === "cli" && !isLoopbackRequest(req)) throw new AppError("local_only", "로컬 분석은 localhost에서만 사용할 수 있어요.", 403);
    let files;
    if (staged) {
      const body = await readJson(req, 20_000) as { upload_ticket?: unknown };
      if (typeof body?.upload_ticket !== "string") throw new AppError("invalid_input", "업로드 정보가 없어요.", 400);
      uploadManifest(body.upload_ticket, sid);
      release = await acquireAI(req, sid, "analyze");
      consumingUpload = true;
      files = await consumeUploads(body.upload_ticket, sid, req.signal);
    } else {
      files = await readUploads(req, maxUploadBytes(provider));
      release = await acquireAI(req, sid, "analyze");
    }
    const first = files[0], pdf = first.mediaType === "application/pdf";
    const hangul = ["application/x-hwp", "application/hwp+zip"].includes(first.mediaType);
    let index: TextIndex | null = null, count = files.length;
    let extracted: Awaited<ReturnType<typeof extractHangul>> | null = null;
    if (pdf) { const inspected = await inspectPdf(first, req.signal); index = inspected.index; count = inspected.pages; }
    if (hangul) { extracted = await extractHangul(first, req.signal); index = extracted.index; count = extracted.sections.length; }
    // 같은 파일을 7일 안에 분석했다면 그 결과를 다시 쓴다. AI를 부르지 않고 사용량도 차감하지 않는다.
    // 원문 대조 표시는 저장된 값을 믿지 않고 지금 기준으로 다시 계산한다(대조 규칙이 바뀌어도 바로 반영되게).
    const key = cacheKey(files);
    const hit = key ? await readCache(key) : null;
    if (hit) {
      const verification = { ...hit.verification,
        flags: buildFlags(hit.analysis, hit.verification, !!extracted?.images, index),
        unsure_schedule: hit.verification.unverified_schedule.filter((i) => !numbersFound(hit.analysis.schedule[i].evidence, index)) };
      settleApplication(hit.analysis, verification.unsure_schedule);
      const source = hit.source ? { ...hit.source, name: first.name } : undefined;
      console.info(JSON.stringify({ event: "analyze_cache_hit", request_id: requestId, analyzed_at: hit.analyzed_at, elapsed_ms: Date.now() - started }));
      return json({ analysis: hit.analysis, analysis_token: signAnalysis(hit.analysis, sid, verification.flags), verification, source, provider, cached: true, analyzed_at: hit.analyzed_at, elapsed_ms: Date.now() - started, request_id: requestId }, 200, { "X-Request-Id": requestId });
    }
    const text = extracted
      ? `오늘은 ${todayKST()}입니다. 한글 공고문에서 추출한 본문을 분석하세요. page는 아래 구역 번호이며 실제 쪽수는 아닙니다. transcript는 빈 배열로 두세요. 표 셀 연결이 모호하면 추측하지 말고 reading_notes에 명시하세요.\n${extracted.warning}\n\n${extracted.sections.map(s => `=== ${s.page}구역 ===\n${s.text}`).join("\n\n")}`
      : analyzeUserText({ kind: pdf ? "pdf" : "images", count: files.length, today: todayKST() });
    // Charge only once the files proved readable, right before the paid call.
    await chargeAI(req, sid, "analyze");
    const { data: analysis, provider: used } = await runStructured({
      system: ANALYZE_SYSTEM, text, files: extracted ? [] : files, schema: AnalysisSchema, signal: req.signal,
      maxTokens: analysisOutputTokens(), requestId, deadline: started + REQUEST_BUDGET_MS, pages: count,
      validate: (result) => validateAnalysis(result, count),
    });
    // 원문 대조는 조건 문장 하나하나로 한다. 표가 섞인 한글 파일이라고 문서 전체를 미확인으로 돌리지 않는다
    // (그러면 이미 답한 조건까지 모두 '확인 필요'가 된다). 표 구조 경고는 원문 보기의 안내 문구로 남는다.
    const checked = verifyEvidence(analysis, index);
    // 일정 인용이 글자 그대로 안 맞아도 날짜 숫자가 원문 그 쪽에 있으면 마감일을 확정하는 데 쓴다.
    const unsure_schedule = checked.unverified_schedule.filter((i) => !numbersFound(analysis.schedule[i].evidence, index));
    const verification = { ...checked, flags: buildFlags(analysis, checked, !!extracted?.images, index), unsure_schedule };
    settleApplication(analysis, verification.unsure_schedule);
    const source = extracted ? { kind: "text", name: first.name, sections: extracted.sections, warning: extracted.warning } : undefined;
    if (key) await writeCache(key, { analysis, verification, source, analyzed_at: new Date().toISOString() });
    console.info(JSON.stringify({ event: "analyze_complete", request_id: requestId, provider: used, elapsed_ms: Date.now() - started, verification: { ...verification, page_corrections_count: verification.page_corrections.length, page_corrections: verification.page_corrections.map(({ page, found_page }) => ({ page, found_page })) } }));
    return json({ analysis, analysis_token: signAnalysis(analysis, sid, verification.flags), verification, source, provider: used, cached: false, elapsed_ms: Date.now() - started, request_id: requestId }, 200, { "X-Request-Id": requestId });
  } catch (e) {
    const response = errorResponse(e, requestId);
    if (staged && !consumingUpload && e instanceof AppError && ["rate_limit", "daily_limit", "in_progress", "rate_limit_unavailable"].includes(e.code)) {
      response.headers.set("X-Upload-Retryable", "1");
    }
    return response;
  }
  finally { await release?.(); }
}
