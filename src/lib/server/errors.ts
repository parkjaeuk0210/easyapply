export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 500,
    public retryAfter?: number,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "AppError";
  }
}

export function json(data: unknown, status = 200, headers?: HeadersInit) {
  const h = new Headers(headers);
  h.set("Cache-Control", "private, no-store");
  h.set("X-Content-Type-Options", "nosniff");
  return Response.json(data, { status, headers: h });
}

// Parse errors quote the model output, which may quote the uploaded document.
const CONTENT_ERRORS = ["SyntaxError", "ZodError"];

/**
 * Why a request failed, for logs only. Provider status, type and request-id
 * make server-side failures traceable; bodies and credentials are left out.
 */
export function describeCause(error: unknown) {
  const cause = error instanceof AppError ? error.cause : error;
  if (!(cause instanceof Error)) return undefined;
  const api = cause as Error & { status?: unknown; type?: unknown; requestID?: unknown; apiMessage?: unknown };
  const message = typeof api.apiMessage === "string" ? api.apiMessage : cause.message;
  return {
    name: cause.name,
    message: CONTENT_ERRORS.includes(cause.name) ? undefined : redact(message),
    provider_status: typeof api.status === "number" ? api.status : undefined,
    provider_type: typeof api.type === "string" ? api.type : undefined,
    provider_request_id: typeof api.requestID === "string" ? api.requestID : undefined,
  };
}

function redact(message: string) {
  return message.replace(/sk-[\w-]+|Bearer\s+\S+|[\w-]{32,}/g, "[redacted]").slice(0, 300);
}

export function errorResponse(error: unknown, requestId: string) {
  const e = error instanceof AppError
    ? error
    : new AppError("internal", "처리 중 오류가 발생했어요. 잠시 후 다시 시도해 주세요.");
  // Never log uploaded content, answers, provider response bodies, or credentials.
  console.error(JSON.stringify({ event: "request_error", request_id: requestId, code: e.code, status: e.status, cause: describeCause(error) }));
  return json({ error: { code: e.code, message: e.message }, request_id: requestId }, e.status, {
    "X-Request-Id": requestId,
    ...(e.retryAfter ? { "Retry-After": String(e.retryAfter) } : {}),
  });
}
