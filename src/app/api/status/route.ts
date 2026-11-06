import { randomUUID } from "node:crypto";
import { connection } from "next/server";
import { MODEL, OPENAI_MODEL, detectProvider } from "@/lib/llm";
import { HOSTED, MAX_UPLOAD_BYTES } from "@/lib/limits";
import { configurationIssues } from "@/lib/server/config";
import { errorResponse, json } from "@/lib/server/errors";
import { assertOrigin, isLoopbackRequest } from "@/lib/server/http";
import { createSession, session } from "@/lib/server/tokens";

export async function GET(req: Request) {
  await connection();
  try {
    assertOrigin(req);
    const configured = await detectProvider();
    const ready = !configurationIssues().length && configured !== "none" && (configured !== "cli" || isLoopbackRequest(req));
    const sid = ready ? session(req) : null;
    const accessRequired = !!process.env.EASYAPPLY_ACCESS_CODE && !sid;
    const cookie = ready && !sid && !accessRequired ? createSession(req).cookie : null;
    return json({
      provider: ready ? configured : "none", model: configured === "openai" ? OPENAI_MODEL : configured === "api" ? MODEL : configured === "cli" ? "Claude Code" : null,
      ready, access_required: accessRequired, hosted: HOSTED, max_upload_bytes: MAX_UPLOAD_BYTES,
      status: ready ? "configured" : "setup_required",
      message: ready ? null : "AI 연결을 준비 중이에요. 지금은 샘플 공고문을 체험할 수 있어요.",
      supported_formats: ["pdf", "hwp", "hwpx", "jpg", "png", "webp", "gif"],
    }, 200, cookie ? { "Set-Cookie": cookie } : undefined);
  } catch (e) { return errorResponse(e, randomUUID()); }
}
