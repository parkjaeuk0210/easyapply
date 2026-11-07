// 같은 공고 파일을 다시 분석하지 않도록 분석 결과를 7일 동안 보관한다. 파일 자체는 보관하지 않는다.
// 키는 파일 내용의 sha256과, 모델·추론 설정·지시문·스키마로 만든 버전이다. 그중 하나라도 바뀌면 지난 결과를 쓰지 않는다.
import { createHash } from "node:crypto";
import { MODEL, type InputFile } from "../llm";
import { ANALYZE_SYSTEM } from "../prompts";
import { AnalysisSchema, toOutputSchema, type Analysis } from "../schema";
import { isProduction, redisConfig } from "./config";
import { redis } from "./guard";
import type { verifyEvidence } from "./uploads";

export const CACHE_TTL_SECONDS = 7 * 24 * 3600;
// Redis REST 요청 한 번에 넣을 크기. 넘으면 저장하지 않는다.
const MAX_BYTES = 900_000;
const CACHEABLE = ["application/pdf", "application/x-hwp", "application/hwp+zip"];

export type CachedAnalysis = {
  analysis: Analysis;
  verification: ReturnType<typeof verifyEvidence>;
  source?: { kind: string; name: string; sections: { page: number; text: string }[]; warning: string };
  analyzed_at: string;
};

let version: string | null = null;
function cacheVersion() {
  version ??= createHash("sha256")
    .update(JSON.stringify([MODEL, process.env.EASYAPPLY_EFFORT || "medium", ANALYZE_SYSTEM, toOutputSchema(AnalysisSchema)]))
    .digest("hex").slice(0, 16);
  return version;
}

/** PDF·HWP·HWPX 한 개일 때만 키를 만든다. 사진은 보관하지 않는다. */
export function cacheKey(files: InputFile[]): string | null {
  if (files.length !== 1 || !CACHEABLE.includes(files[0].mediaType)) return null;
  return `easyapply:analysis:${cacheVersion()}:${createHash("sha256").update(files[0].data).digest("hex")}`;
}

// Redis가 없는 로컬 개발 서버(next dev)에서만 쓰는 메모리 보관소. 테스트는 서로 섞이지 않게 쓰지 않는다.
const memory = new Map<string, { value: string; expires: number }>();
const hasRedis = () => { const { url, token } = redisConfig(); return !!url && !!token; };
const memoryAllowed = () => !isProduction() && process.env.NODE_ENV === "development";

export async function readCache(key: string): Promise<CachedAnalysis | null> {
  try {
    if (hasRedis()) {
      const value = await redis(["GET", key]);
      return typeof value === "string" ? JSON.parse(value) as CachedAnalysis : null;
    }
    if (!memoryAllowed()) return null;
    const hit = memory.get(key);
    return hit && hit.expires > Date.now() ? JSON.parse(hit.value) as CachedAnalysis : null;
  } catch { return null; }
}

/** 저장에 실패해도 분석 응답은 그대로 나간다. */
export async function writeCache(key: string, entry: CachedAnalysis) {
  const value = JSON.stringify(entry);
  if (Buffer.byteLength(value) > MAX_BYTES) return;
  try {
    if (hasRedis()) await redis(["SET", key, value, "EX", CACHE_TTL_SECONDS]);
    else if (memoryAllowed()) memory.set(key, { value, expires: Date.now() + CACHE_TTL_SECONDS * 1000 });
  } catch { /* 보관 실패는 무시한다 */ }
}
