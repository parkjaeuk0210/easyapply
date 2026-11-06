import { z } from "zod";
import { AnalysisSchema, MatchSchema } from "@/lib/schema";
import { MATCH_SYSTEM, matchUserText } from "@/lib/prompts";
import { LlmError, runStructured, todayKST } from "@/lib/llm";

export const maxDuration = 300;

const Body = z.object({
  analysis: AnalysisSchema,
  answers: z.record(z.string(), z.string()),
  extra: z.string().max(2000).default(""),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: { code: "invalid_input", message: "요청 형식이 올바르지 않아요. 공고문을 다시 분석해 주세요." } },
      { status: 400 },
    );
  }
  const { analysis, answers, extra } = parsed.data;
  try {
    const { data, provider } = await runStructured({
      system: MATCH_SYSTEM,
      text: matchUserText(analysis, answers, extra, todayKST()),
      schema: MatchSchema,
    });
    return Response.json({ match: data, provider });
  } catch (e) {
    const err = e instanceof LlmError ? e : new LlmError("unknown", String(e));
    console.error("[easyapply/match]", err.code, err.message);
    return Response.json({ error: { code: err.code, message: err.message } }, { status: err.status });
  }
}
