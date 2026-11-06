import { ZodError } from "zod";

export async function responseJson(response: Response) {
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const fallback = response.status === 413 ? "파일이 너무 커요. 필요한 쪽만 따로 저장해서 다시 올려 주세요."
      : response.status === 504 ? "시간이 너무 오래 걸렸어요. 공고문을 나눠서 다시 올려 주세요."
      : "요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.";
    throw new Error(withRetryAfter(body?.error?.message ?? fallback, Number(response.headers.get("Retry-After"))));
  }
  if (!body || typeof body !== "object") throw new Error("결과를 읽지 못했어요. 새로고침 후 다시 시도해 주세요.");
  return body;
}

// 서버 문구가 이미 "다시 시도해 주세요"로 끝나면 그 자리에 기다릴 시간을 넣는다.
function withRetryAfter(message: string, seconds: number) {
  if (!(seconds > 0)) return message;
  const when = seconds > 90 * 60 ? `약 ${Math.ceil(seconds / 3600)}시간 뒤` : `약 ${Math.ceil(seconds / 60)}분 뒤`;
  const retry = /(?:잠시 후|나중에|완료된 뒤)?\s*다시 시도해 주세요\.?$/;
  return retry.test(message) ? message.replace(retry, `${when} 다시 시도해 주세요.`) : `${message} ${when} 다시 시도해 주세요.`;
}

/** 브라우저·검증 오류를 사람이 읽을 한 문장으로 바꾼다. */
export function errorMessage(error: unknown) {
  if (error instanceof DOMException && error.name === "TimeoutError") return "시간이 너무 오래 걸렸어요. 다시 시도해 주세요.";
  if (error instanceof TypeError && /fetch|network|load failed/i.test(error.message)) return "인터넷 연결을 확인하고 다시 시도해 주세요.";
  if (error instanceof ZodError || (error instanceof Error && error.name === "ZodError")) return "결과를 읽지 못했어요. 새로고침 후 다시 시도해 주세요.";
  if (error instanceof Error && /[가-힣]/.test(error.message)) return error.message;
  return "문제가 생겼어요. 새로고침 후 다시 시도해 주세요.";
}

export function contentKey(value: unknown) {
  let a = 2166136261, b = 5381;
  for (const c of JSON.stringify(value)) { a = Math.imul(a ^ c.charCodeAt(0), 16777619); b = Math.imul(b, 33) ^ c.charCodeAt(0); }
  return `${a >>> 0}-${b >>> 0}`;
}
