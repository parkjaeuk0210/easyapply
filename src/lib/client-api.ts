export async function responseJson(response: Response) {
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const fallback = response.status === 413 ? "파일이 너무 커요. 필요한 부분만 나눠 올려 주세요."
      : response.status === 504 ? "처리 시간이 초과됐어요. 필요한 부분만 나눠 다시 시도해 주세요."
      : "요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.";
    const retry = Number(response.headers.get("Retry-After"));
    throw new Error((body?.error?.message ?? fallback) + (retry > 0 ? ` 약 ${Math.ceil(retry / 60)}분 뒤 다시 시도해 주세요.` : ""));
  }
  if (!body || typeof body !== "object") throw new Error("서버 응답을 읽지 못했어요. 다시 시도해 주세요.");
  return body;
}

export function contentKey(value: unknown) {
  let a = 2166136261, b = 5381;
  for (const c of JSON.stringify(value)) { a = Math.imul(a ^ c.charCodeAt(0), 16777619); b = Math.imul(b, 33) ^ c.charCodeAt(0); }
  return `${a >>> 0}-${b >>> 0}`;
}
