import { AppError } from "./errors";
import { isHosted, isProduction } from "./config";

export function isLoopbackRequest(req: Request) {
  const local = (host: string) => ["localhost", "127.0.0.1", "[::1]"].includes(host);
  try {
    return local(new URL(req.url).hostname) &&
      (!req.headers.has("host") || local(new URL(`http://${req.headers.get("host")}`).hostname)) &&
      (!req.headers.has("x-forwarded-for") || ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.headers.get("x-forwarded-for")!)) && !req.headers.has("x-vercel-forwarded-for");
  } catch { return false; }
}

export function assertOrigin(req: Request) {
  if (!isProduction() && !isLoopbackRequest(req)) {
    throw new AppError("local_only", "로컬 분석은 이 컴퓨터의 localhost에서만 사용할 수 있어요.", 403);
  }
  if (req.headers.get("sec-fetch-site") === "cross-site") throw new AppError("origin", "허용되지 않은 요청이에요.", 403);
  const origin = req.headers.get("origin");
  // Next.js can normalize req.url to localhost even when the browser uses 127.0.0.1.
  // On Vercel the routing layer validates Host; self-hosted production uses APP_ORIGIN only.
  const host = req.headers.get("host");
  const hostOrigin = host && /^(?:[a-z0-9.-]+|\[[a-f0-9:]+\])(?::\d+)?$/i.test(host)
    ? `${isHosted() ? "https:" : new URL(req.url).protocol}//${host}` : undefined;
  const allowed = new Set([
    process.env.EASYAPPLY_APP_ORIGIN,
    isHosted() ? new URL(req.url).origin : undefined,
    !isProduction() ? new URL(req.url).origin : undefined,
    isHosted() || (!isProduction() && isLoopbackRequest(req)) ? hostOrigin : undefined,
  ].filter(Boolean));
  if (origin && !allowed.has(origin)) throw new AppError("origin", "허용되지 않은 요청이에요.", 403);
}

/** Bound streamed bytes before formData/JSON parsing, including chunked requests. */
export async function readBody(req: Request, maxBytes: number, mediaType: string): Promise<Uint8Array> {
  const contentType = req.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  if (contentType !== mediaType) throw new AppError("content_type", "요청의 파일 형식이 올바르지 않아요.", 415);
  const length = req.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > maxBytes)) {
    throw new AppError("too_large", "요청 용량이 한도를 넘어요. 파일 크기를 줄여 주세요.", 413);
  }
  if (!req.body) throw new AppError("invalid_input", "요청 내용이 비어 있어요.", 400);
  const reader = req.body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; void reader.cancel().catch(() => {}); }, 30_000);
  let ended = false;
  const abort = () => { void reader.cancel().catch(() => {}); };
  req.signal.addEventListener("abort", abort, { once: true });
  try {
    if (req.signal.aborted) throw new AppError("cancelled", "요청을 취소했어요.", 499);
    while (true) {
      const { value, done } = await reader.read();
      if (done) { ended = true; break; }
      total += value.byteLength;
      if (total > maxBytes) throw new AppError("too_large", "요청 용량이 한도를 넘어요. 파일 크기를 줄여 주세요.", 413);
      parts.push(value);
    }
    if (req.signal.aborted) throw new AppError("cancelled", "요청을 취소했어요.", 499);
    if (timedOut) throw new AppError("timeout", "업로드 시간이 너무 오래 걸렸어요. 다시 시도해 주세요.", 408);
    if (!total || (length && total !== Number(length))) throw new AppError("invalid_input", "요청 내용을 끝까지 받지 못했어요.", 400);
    const out = new Uint8Array(total);
    let at = 0;
    for (const part of parts) { out.set(part, at); at += part.byteLength; }
    return out;
  } finally {
    clearTimeout(timeout);
    req.signal.removeEventListener("abort", abort);
    if (!ended) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function readJson(req: Request, maxBytes: number): Promise<unknown> {
  const bytes = await readBody(req, maxBytes, "application/json");
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new AppError("invalid_json", "요청 내용을 읽지 못했어요.", 400); }
}
