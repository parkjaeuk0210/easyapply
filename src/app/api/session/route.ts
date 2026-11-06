import { randomUUID } from "node:crypto";
import { AppError, errorResponse, json } from "@/lib/server/errors";
import { limitAttempts, requireConfiguration } from "@/lib/server/guard";
import { assertOrigin, readJson } from "@/lib/server/http";
import { createSession, equal } from "@/lib/server/tokens";
export async function POST(req: Request) {
  try {
    assertOrigin(req); requireConfiguration();
    await limitAttempts(req, "login", 6);
    const body = await readJson(req, 1024) as { code?: unknown } | null;
    if (typeof body?.code !== "string" || !equal(body.code, process.env.EASYAPPLY_ACCESS_CODE ?? "")) throw new AppError("access_denied", "이용 코드가 맞지 않아요.", 401);
    return json({ ok: true }, 200, { "Set-Cookie": createSession(req).cookie });
  } catch (e) { return errorResponse(e, randomUUID()); }
}
