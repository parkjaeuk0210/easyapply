import { randomUUID } from "node:crypto";
import { connection } from "next/server";
import { MODEL, OPENAI_MODEL, detectProvider } from "@/lib/llm";
import { HOSTED, MAX_UPLOAD_BYTES, DIRECT_UPLOAD_BYTES } from "@/lib/limits";
import { largeUploadsAvailable } from "@/lib/server/staged-uploads";
import { configurationIssues, openAIConfig, usageLimitsEnabled } from "@/lib/server/config";
import { errorResponse, json } from "@/lib/server/errors";
import { assertOrigin, isLoopbackRequest } from "@/lib/server/http";
import { session } from "@/lib/server/tokens";
import { issueSession } from "@/lib/server/guard";

export async function GET(req: Request) {
  await connection();
  try {
    assertOrigin(req);
    const configured = await detectProvider();
    const ready = !configurationIssues().length && configured !== "none" && (configured !== "cli" || isLoopbackRequest(req));
    const sid = ready ? session(req) : null;
    const accessRequired = !!process.env.EASYAPPLY_ACCESS_CODE && !sid;
    const cookie = ready && !sid && !accessRequired ? (await issueSession(req)).cookie : null;
    const openai = ready && configured === "openai" ? openAIConfig() : null;
    return json({
      provider: ready ? configured : "none", model: configured === "openai" ? OPENAI_MODEL : configured === "api" ? MODEL : configured === "cli" ? "Claude Code" : null,
      reasoning_effort: openai?.reasoning.effort ?? (ready && configured === "api" ? process.env.EASYAPPLY_EFFORT || "medium" : null),
      service_tier: openai?.service_tier ?? null,
      processing_speed: ready && configured === "api" ? process.env.EASYAPPLY_ANTHROPIC_SPEED || "standard" : null,
      ready, access_required: accessRequired, hosted: HOSTED,
      usage_limits_enabled: usageLimitsEnabled(),
      max_upload_bytes: !HOSTED || largeUploadsAvailable() ? MAX_UPLOAD_BYTES : DIRECT_UPLOAD_BYTES,
      max_direct_upload_bytes: DIRECT_UPLOAD_BYTES, large_uploads: largeUploadsAvailable(),
      status: ready ? "configured" : "setup_required",
      message: ready ? null : "AI 연결을 준비 중이에요. 잠시 후 다시 방문해 주세요.",
      supported_formats: ["pdf", "hwp", "hwpx", "jpg", "png", "webp", "gif"],
    }, 200, cookie ? { "Set-Cookie": cookie } : undefined);
  } catch (e) { return errorResponse(e, randomUUID()); }
}
