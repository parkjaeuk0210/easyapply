export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 500,
    public retryAfter?: number,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function json(data: unknown, status = 200, headers?: HeadersInit) {
  const h = new Headers(headers);
  h.set("Cache-Control", "private, no-store");
  h.set("X-Content-Type-Options", "nosniff");
  return Response.json(data, { status, headers: h });
}

export function errorResponse(error: unknown, requestId: string) {
  const e = error instanceof AppError
    ? error
    : new AppError("internal", "처리 중 오류가 발생했어요. 잠시 후 다시 시도해 주세요.");
  // Never log uploaded content, answers, provider response bodies, or credentials.
  console.error(JSON.stringify({ event: "request_error", request_id: requestId, code: e.code, status: e.status }));
  return json({ error: { code: e.code, message: e.message }, request_id: requestId }, e.status, {
    "X-Request-Id": requestId,
    ...(e.retryAfter ? { "Retry-After": String(e.retryAfter) } : {}),
  });
}
