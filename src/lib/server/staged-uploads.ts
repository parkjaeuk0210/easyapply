import { randomUUID } from "node:crypto";
import { del, get, issueSignedToken, list, presignUrl } from "@vercel/blob";
import { z } from "zod";
import type { InputFile } from "../llm";
import { MAX_UPLOAD_BYTES } from "../limits";
import { fileMediaType } from "../filetypes";
import { AppError } from "./errors";
import { privateKey, signUpload, verifyUpload } from "./tokens";
import { matchesSignature, validateUploadSpecs } from "./uploads";
import { reserveUploadBudget } from "./guard";

const PREFIX = "easyapply-tmp/";
const FileSchema = z.object({ name: z.string().min(1).max(200), mediaType: z.string().max(100), size: z.number().int().positive().max(MAX_UPLOAD_BYTES) }).strict();
const ManifestSchema = z.array(FileSchema.extend({ pathname: z.string().max(250) }).strict()).min(1).max(10);
type Manifest = z.infer<typeof ManifestSchema>;
const storage = { get, del };

export function largeUploadsAvailable() {
  return !!(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID) && !!process.env.CRON_SECRET;
}

export function uploadManifest(ticket: string, sessionId: string): Manifest {
  const files = ManifestSchema.parse(verifyUpload(ticket, sessionId));
  const prefix = `${PREFIX}${privateKey(sessionId)}/`;
  for (const file of files) {
    const suffix = file.pathname.slice(prefix.length);
    if (!file.pathname.startsWith(prefix) || !/^\d{13}-[a-f0-9-]{36}$/.test(suffix)) throw new AppError("invalid_upload", "업로드 경로가 올바르지 않아요.", 400);
  }
  if (new Set(files.map(f => f.pathname)).size !== files.length) throw new AppError("invalid_upload", "같은 파일을 중복 지정할 수 없어요.", 400);
  validateUploadSpecs(files);
  return files;
}

export async function prepareUploads(value: unknown, sessionId: string, req: Request) {
  if (!largeUploadsAvailable()) throw new AppError("upload_unavailable", "큰 파일 업로드를 준비 중이에요. 잠시 후 다시 시도해 주세요.", 503);
  const parsed = z.object({ files: z.array(FileSchema).min(1).max(10) }).strict().safeParse(value);
  if (!parsed.success) throw new AppError("invalid_input", "파일 정보나 용량이 올바르지 않아요. 최대 25MB까지 올려 주세요.", 400);
  const files = parsed.data.files.map(f => ({ ...f, mediaType: fileMediaType(f.name, f.mediaType) }));
  validateUploadSpecs(files);
  await reserveUploadBudget(req, sessionId, files.reduce((sum, file) => sum + file.size, 0), files.length);
  const manifest = files.map(f => ({ ...f, pathname: `${PREFIX}${privateKey(sessionId)}/${Date.now()}-${randomUUID()}` }));
  const validUntil = Date.now() + 10 * 60_000;
  const uploads = [];
  for (const file of manifest) {
    const scope = { pathname: file.pathname, operations: ["put" as const], validUntil, allowedContentTypes: [file.mediaType], maximumSizeInBytes: file.size };
    const signed = await issueSignedToken(scope);
    const { presignedUrl } = await presignUrl(signed, { ...scope, operation: "put", access: "private", addRandomSuffix: false, allowOverwrite: false });
    uploads.push({ url: presignedUrl, contentType: file.mediaType });
  }
  return { upload_ticket: signUpload(manifest, sessionId), uploads };
}

export async function discardUploads(files: Manifest, store: Pick<typeof storage, "del"> = storage) {
  if (!files.length) return;
  try { await store.del(files.map(f => f.pathname)); }
  catch { console.error(JSON.stringify({ event: "temporary_upload_cleanup_failed", count: files.length })); }
}

export async function consumeUploads(ticket: string, sessionId: string, signal: AbortSignal, store = storage): Promise<InputFile[]> {
  const files = uploadManifest(ticket, sessionId);
  try {
    const result: InputFile[] = [];
    for (const file of files) {
      signal.throwIfAborted();
      const blob = await store.get(file.pathname, { access: "private", useCache: false, abortSignal: AbortSignal.any([signal, AbortSignal.timeout(45_000)]) });
      if (!blob || blob.statusCode !== 200) throw new AppError("upload_missing", "업로드한 파일을 찾지 못했어요. 다시 올려 주세요.", 409);
      const reader = blob.stream.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        if (blob.blob.size !== file.size) throw new AppError("invalid_upload", "업로드한 파일 용량이 일치하지 않아요.", 400);
        while (true) {
          signal.throwIfAborted();
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > file.size) throw new AppError("too_large", "업로드 용량을 초과했어요.", 413);
          chunks.push(value);
        }
      } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
      const data = Buffer.concat(chunks, size);
      if (size !== file.size || !matchesSignature(file.mediaType, data)) throw new AppError("invalid_file", "파일이 손상되었거나 확장자와 내용이 달라요.", 400);
      result.push({ name: file.name, mediaType: file.mediaType, data });
    }
    return result;
  } finally { await discardUploads(files, store); }
}

export async function cleanupAbandonedUploads() {
  const cutoff = Date.now() - 60 * 60_000;
  let cursor: string | undefined;
  let deleted = 0;
  for (let page = 0; page < 5; page++) {
    const batch = await list({ prefix: PREFIX, cursor, limit: 1000 });
    const stale = batch.blobs.filter(b => b.uploadedAt.getTime() < cutoff).map(b => b.pathname);
    for (let at = 0; at < stale.length; at += 50) { await del(stale.slice(at, at + 50)); deleted += Math.min(50, stale.length - at); }
    if (!batch.hasMore) break;
    cursor = batch.cursor;
  }
  return deleted;
}
