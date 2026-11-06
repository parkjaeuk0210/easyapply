import { connection } from "next/server";
import { MODEL, detectProvider } from "@/lib/llm";
import { HOSTED, MAX_UPLOAD_BYTES } from "@/lib/limits";

export async function GET() {
  await connection(); // 빌드 시 미리 렌더링하지 않고 요청마다 실행
  const provider = await detectProvider();
  return Response.json({
    provider,
    model: provider === "api" ? MODEL : provider === "cli" ? "Claude Code" : null,
    hosted: HOSTED,
    max_upload_bytes: MAX_UPLOAD_BYTES,
  }, { headers: { "Cache-Control": "no-store" } });
}
