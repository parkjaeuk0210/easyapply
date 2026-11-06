import { randomUUID } from "node:crypto";
import { AppError } from "./errors";
import { configurationIssues, intEnv, isHosted, isProduction, redisConfig } from "./config";
import { assertOrigin } from "./http";
import { privateKey, requireSession } from "./tokens";
import { MAX_UPLOAD_BYTES } from "../limits";

type Counter = { count: number; expires: number };
type Lease = { id: string; session: string; expires: number };
const state = globalThis as typeof globalThis & {
  easyapplyLimits?: { counters: Map<string, Counter>; leases: Map<string, Lease> };
};
const local = () => state.easyapplyLimits ??= { counters: new Map(), leases: new Map() };

export function requireConfiguration() {
  if (configurationIssues().length) throw new AppError("configuration", "서비스 연결을 준비 중이에요. 잠시 후 다시 방문해 주세요.", 503);
}

export function guard(req: Request) {
  assertOrigin(req);
  requireConfiguration();
  return requireSession(req);
}

function identity(req: Request) {
  // Vercel overwrites this header. Other hosts share a conservative bucket;
  // arbitrary client-supplied X-Forwarded-For must never bypass the quota.
  const ip = isHosted() ? req.headers.get("x-vercel-forwarded-for")?.split(",")[0].trim() : undefined;
  return privateKey(ip || "shared-origin");
}

async function redis(command: (string | number)[]): Promise<unknown> {
  const { url, token } = redisConfig();
  if (!url || !token) throw new AppError("rate_limit_unavailable", "요청량 확인에 실패했어요. 잠시 후 다시 시도해 주세요.", 503);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(command), signal: AbortSignal.timeout(5000), cache: "no-store",
    });
    const data = await res.json();
    if (!res.ok || data.error || !("result" in data)) throw new Error("Redis unavailable");
    return data.result;
  } catch {
    // Fail closed: an unavailable limiter must not turn a paid API into unlimited access.
    throw new AppError("rate_limit_unavailable", "요청량 확인에 실패했어요. 잠시 후 다시 시도해 주세요.", 503);
  }
}

const remote = () => isProduction() || !!redisConfig().url;

function prune(now: number) {
  const s = local();
  for (const [k, v] of s.counters) if (v.expires <= now) s.counters.delete(k);
  for (const [k, v] of s.leases) if (v.expires <= now) s.leases.delete(k);
  if (s.counters.size > 10_000) throw new AppError("busy", "요청이 많아요. 잠시 후 다시 시도해 주세요.", 503, 60);
}

const ATTEMPT_SCRIPT = `
local n = redis.call('INCR', KEYS[1])
if n == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
return {n, redis.call('PTTL', KEYS[1])}`;

export async function limitAttempts(req: Request, kind = "request", limit = 40) {
  const key = `easyapply:v1:attempt:${kind}:${identity(req)}`;
  let count: number, ttl: number;
  if (remote()) {
    const result = await redis(["EVAL", ATTEMPT_SCRIPT, 1, key, 60_000]);
    if (!Array.isArray(result) || result.length !== 2 || !result.every(Number.isFinite)) throw new AppError("rate_limit_unavailable", "요청량 확인에 실패했어요.", 503);
    [count, ttl] = result;
  } else {
    prune(Date.now());
    const c = local().counters.get(key) ?? { count: 0, expires: Date.now() + 60_000 };
    c.count++; local().counters.set(key, c);
    count = c.count; ttl = c.expires - Date.now();
  }
  if (count > limit) throw new AppError("rate_limit", "요청이 많아요. 잠시 후 다시 시도해 주세요.", 429, Math.max(1, Math.ceil(ttl / 1000)));
}

// Never refund issued capacity: failed/abandoned grants may still be usable.
// 1,000 objects/day leaves room in the 5,000-file cleanup.
const UPLOAD_BYTES = [100 * MAX_UPLOAD_BYTES, 10 * MAX_UPLOAD_BYTES, 10 * MAX_UPLOAD_BYTES];
const UPLOAD_FILES = [1000, 100, 100];
const UPLOAD_BUDGET_SCRIPT = `
for i=1,#KEYS do
  if tonumber(redis.call('GET', KEYS[i]) or '0') + tonumber(ARGV[i]) > tonumber(ARGV[#KEYS+i]) then
    return {1, redis.call('PTTL', KEYS[i])}
  end
end
for i=1,#KEYS do
  local n = redis.call('INCRBY', KEYS[i], ARGV[i])
  if n == tonumber(ARGV[i]) then redis.call('PEXPIRE', KEYS[i], ARGV[2*#KEYS+1]) end
end
return {0, 0}`;

export async function reserveUploadBudget(req: Request, sessionId: string, bytes: number, files: number) {
  if (!Number.isSafeInteger(bytes) || bytes <= 0 || bytes > MAX_UPLOAD_BYTES || !Number.isInteger(files) || files < 1 || files > 10) {
    throw new AppError("invalid_input", "파일 정보나 용량이 올바르지 않아요.", 400);
  }
  const scopes = ["global", `ip:${identity(req)}`, `session:${sessionId}`];
  const keys = ["bytes", "files"].flatMap(unit => scopes.map(scope => `easyapply:v1:upload:${unit}:${scope}`));
  const increments = [bytes, bytes, bytes, files, files, files];
  const limits = [...UPLOAD_BYTES, ...UPLOAD_FILES], ttl = 86_400_000;
  let result: number[];
  if (remote()) {
    const r = await redis(["EVAL", UPLOAD_BUDGET_SCRIPT, keys.length, ...keys, ...increments, ...limits, ttl]);
    if (!Array.isArray(r) || r.length !== 2 || !r.every(Number.isFinite)) throw new AppError("rate_limit_unavailable", "요청량 확인에 실패했어요.", 503);
    result = r;
  } else {
    const now = Date.now(); prune(now);
    const counters = local().counters;
    const blocked = keys.findIndex((key, i) => (counters.get(key)?.count ?? 0) + increments[i] > limits[i]);
    result = blocked < 0 ? [0, 0] : [1, (counters.get(keys[blocked])?.expires ?? now + ttl) - now];
    if (!result[0]) for (let i = 0; i < keys.length; i++) {
      const counter = counters.get(keys[i]) ?? { count: 0, expires: now + ttl };
      counter.count += increments[i]; counters.set(keys[i], counter);
    }
  }
  if (result[0]) throw new AppError("upload_limit", "오늘의 파일 업로드 한도에 도달했어요. 나중에 다시 시도해 주세요.", 429, Math.max(1, Math.ceil(result[1] / 1000)));
}

// The entire quota + concurrency reservation is atomic across server instances.
const ACQUIRE_SCRIPT = `
local now = tonumber(ARGV[1])
redis.call('ZREMRANGEBYSCORE', KEYS[4], '-inf', now)
if redis.call('EXISTS', KEYS[5]) == 1 then return {2, redis.call('PTTL', KEYS[5])} end
if redis.call('ZCARD', KEYS[4]) >= tonumber(ARGV[4]) then return {3, 5000} end
for i=1,3 do
  if tonumber(redis.call('GET', KEYS[i]) or '0') >= tonumber(ARGV[4+i]) then
    return {1, redis.call('PTTL', KEYS[i])}
  end
end
for i=1,3 do
  local n = redis.call('INCR', KEYS[i])
  if n == 1 then redis.call('PEXPIRE', KEYS[i], ARGV[7+i]) end
end
redis.call('SET', KEYS[5], ARGV[2], 'PX', ARGV[3])
redis.call('ZADD', KEYS[4], now + tonumber(ARGV[3]), ARGV[2])
redis.call('PEXPIRE', KEYS[4], ARGV[3])
return {0, 0}`;
const RELEASE_SCRIPT = `
redis.call('ZREM', KEYS[1], ARGV[1])
if redis.call('GET', KEYS[2]) == ARGV[1] then redis.call('DEL', KEYS[2]) end
return 1`;

export async function acquireAI(req: Request, sessionId: string, kind: "analyze" | "match") {
  const now = Date.now(), id = randomUUID(), leaseMs = 280_000;
  const quota = kind === "analyze" ? 8 : 24;
  const daily = intEnv("EASYAPPLY_DAILY_AI_LIMIT", 100, 1, 100_000);
  const concurrent = intEnv("EASYAPPLY_MAX_CONCURRENT", 3, 1, 20);
  const keys = [
    `easyapply:v1:ip:${identity(req)}:${kind}`,
    `easyapply:v1:session:${sessionId}:${kind}`,
    "easyapply:v1:daily", "easyapply:v1:active", `easyapply:v1:active:${sessionId}`,
  ];
  const limits = [quota, quota, daily], ttls = [600_000, 600_000, 86_400_000];
  let result: number[];
  if (remote()) {
    const r = await redis(["EVAL", ACQUIRE_SCRIPT, keys.length, ...keys, now, id, leaseMs, concurrent, ...limits, ...ttls]);
    if (!Array.isArray(r) || r.length !== 2 || !r.every(Number.isFinite)) throw new AppError("rate_limit_unavailable", "요청량 확인에 실패했어요.", 503);
    result = r;
  } else {
    prune(now);
    const s = local();
    const busy = [...s.leases.values()].find((v) => v.session === sessionId);
    result = busy ? [2, busy.expires - now] : s.leases.size >= concurrent ? [3, 5000] : [0, 0];
    if (!result[0]) for (let i = 0; i < 3; i++) {
      const c = s.counters.get(keys[i]);
      if (c && c.count >= limits[i]) { result = [1, c.expires - now]; break; }
    }
    if (!result[0]) {
      for (let i = 0; i < 3; i++) {
        const c = s.counters.get(keys[i]) ?? { count: 0, expires: now + ttls[i] };
        c.count++; s.counters.set(keys[i], c);
      }
      s.leases.set(id, { id, session: sessionId, expires: now + leaseMs });
    }
  }
  if (result[0]) {
    const duplicate = result[0] === 2;
    throw new AppError(duplicate ? "in_progress" : "rate_limit", duplicate
      ? "이미 처리 중인 요청이 있어요. 완료된 뒤 다시 시도해 주세요."
      : "지금은 분석 요청이 많거나 이용 한도에 도달했어요. 잠시 후 다시 시도해 주세요.", duplicate ? 409 : 429, Math.max(1, Math.ceil(result[1] / 1000)));
  }
  let released = false;
  return async () => {
    if (released) return;
    released = true;
    if (remote()) {
      try { await redis(["EVAL", RELEASE_SCRIPT, 2, keys[3], keys[4], id]); }
      catch { console.error(JSON.stringify({ event: "lease_release_failed", lease: id })); }
    } else local().leases.delete(id);
  };
}
