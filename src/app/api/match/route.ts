import { randomUUID } from "node:crypto";
import { z } from "zod";
import sample from "../../../../public/samples/garam-analysis.json";
import { AnalysisSchema, MatchSchema } from "@/lib/schema";
import { MATCH_SYSTEM, matchUserText } from "@/lib/prompts";
import { detectProvider, runStructured, todayKST } from "@/lib/llm";
import { AppError, errorResponse, json } from "@/lib/server/errors";
import { acquireAI, guard, limitAttempts } from "@/lib/server/guard";
import { isLoopbackRequest, readJson } from "@/lib/server/http";
import { verifyAnalysis } from "@/lib/server/tokens";
import { validateAnalysis, validateAnswers, finalizeMatch } from "@/lib/server/validation";

export const maxDuration = 300;
const Body = z.strictObject({
  analysis: AnalysisSchema.optional(), analysis_token: z.string().max(16_384).optional(), sample: z.boolean().optional(),
  answers: z.record(z.string().max(40), z.string().max(2000)).refine(v => Object.keys(v).length <= 8),
  extra: z.string().max(2000).default(""),
});
export async function POST(req: Request) {
  const requestId = randomUUID();
  let release: (() => Promise<void>) | undefined;
  try {
    const sid = guard(req);
    await limitAttempts(req);
    const parsed = Body.safeParse(await readJson(req, 768 * 1024));
    if (!parsed.success) throw new AppError("invalid_input", "요청 형식이 올바르지 않아요. 공고문을 다시 분석해 주세요.", 400);
    const b = parsed.data;
    const analysis = b.sample ? AnalysisSchema.parse(sample.analysis) : b.analysis;
    if (!analysis) throw new AppError("invalid_input", "공고문을 먼저 분석해 주세요.", 400);
    const unchecked = b.sample ? [] : verifyAnalysis(analysis, b.analysis_token ?? "", sid);
    validateAnalysis(analysis);
    const answers = validateAnswers(analysis, b.answers);
    const provider = await detectProvider();
    if (provider === "cli" && !isLoopbackRequest(req)) throw new AppError("local_only", "로컬 분석은 localhost에서만 사용할 수 있어요.", 403);
    if (provider === "none") throw new AppError("no_provider", "AI 연결이 준비되지 않았어요.", 503);
    release = await acquireAI(req, sid, "match");
    const { data, provider: used } = await runStructured({ system: MATCH_SYSTEM,
      text: matchUserText(analysis, answers, b.extra, todayKST()), schema: MatchSchema, signal: req.signal, maxTokens: 10_000 });
    return json({ match: finalizeMatch(analysis, answers, data, unchecked), provider: used, request_id: requestId }, 200, { "X-Request-Id": requestId });
  } catch (e) { return errorResponse(e, requestId); }
  finally { await release?.(); }
}
