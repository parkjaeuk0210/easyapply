import { randomUUID } from "node:crypto";
import { cleanupAbandonedUploads } from "@/lib/server/staged-uploads";
import { equal } from "@/lib/server/tokens";
import { errorResponse, json } from "@/lib/server/errors";

export const maxDuration = 60;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !equal(req.headers.get("authorization") ?? "", `Bearer ${secret}`)) return json({ error: "unauthorized" }, 401);
  try { return json({ deleted: await cleanupAbandonedUploads() }); }
  catch (error) { return errorResponse(error, randomUUID()); }
}
