import { randomUUID } from "node:crypto";
import { guard, limitAttempts } from "@/lib/server/guard";
import { readJson } from "@/lib/server/http";
import { AppError, errorResponse, json } from "@/lib/server/errors";
import { selectedProvider } from "@/lib/server/config";
import { maxUploadBytes } from "@/lib/limits";
import { discardUploads, prepareUploads, uploadManifest } from "@/lib/server/staged-uploads";

export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const sid = guard(req);
    await limitAttempts(req, "upload", 12);
    return json(await prepareUploads(await readJson(req, 8192), sid, req, maxUploadBytes(selectedProvider())));
  } catch (error) { return errorResponse(error, randomUUID()); }
}

export async function DELETE(req: Request) {
  try {
    const sid = guard(req);
    await limitAttempts(req, "upload-cleanup", 24);
    const body = await readJson(req, 20_000) as { upload_ticket?: unknown };
    if (typeof body?.upload_ticket !== "string") throw new AppError("invalid_input", "업로드 정보가 없어요.", 400);
    await discardUploads(uploadManifest(body.upload_ticket, sid));
    return json({ ok: true });
  } catch (error) { return errorResponse(error, randomUUID()); }
}
