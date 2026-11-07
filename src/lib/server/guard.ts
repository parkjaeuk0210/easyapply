import { randomUUID } from "node:crypto";
import { AppError } from "./errors";
import { configurationIssues, intEnv, isHosted, isProduction, redisConfig, usageLimitsEnabled } from "./config";
import { assertOrigin } from "./http";
import { createSession, privateKey, requireSession } from "./tokens";
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
  return privateKey(ip ? ipBucket(ip) : "shared-origin");
}

// One IPv6 subscriber usually owns a whole /64, so rotating within it must not reset quotas.
function ipBucket(ip: string) {
  if (!ip.includes(":")) return ip;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) return mapped[1];
  const [head, tail] = ip.toLowerCase().split("%")[0].split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const groups = tail === undefined ? left : [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right];
  return `${groups.slice(0, 4).map((g) => g.padStart(4, "0")).join(":")}::/64`;
}

export async function redis(command: (string | number)[]): Promise<unknown> {
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
    // An unavailable store cannot reliably prevent duplicate work.
    throw new AppError("rate_limit_unavailable", "요청량 확인에 실패했어요. 잠시 후 다시 시도해 주세요.", 503);
  }
}

const remote = () => isProduction() || !!redisConfig().url;

function prune(now: number) {
  const s = local();
  for (const [k, v] of s.counters) if (v.expires <= now) s.counters.delete(k);
  for (const [k, v] of s.leases) if (v.expires <= now) s.leases.delete(k);
  if (usageLimitsEnabled() && s.counters.size > 10_000) throw new AppError("busy", "요청이 많아요. 잠시 후 다시 시도해 주세요.", 503, 60);
}

const ATTEMPT_SCRIPT = `
local n = redis.call('INCR', KEYS[1])
if n == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
return {n, redis.call('PTTL', KEYS[1])}`;

export async function limitAttempts(req: Request, kind = "request", limit = 40, windowMs = 60_000) {
  if (!usageLimitsEnabled()) return;
  const key = `easyapply:v1:attempt:${kind}:${identity(req)}`;
  let count: number, ttl: number;
  if (remote()) {
    const result = await redis(["EVAL", ATTEMPT_SCRIPT, 1, key, windowMs]);
    if (!Array.isArray(result) || result.length !== 2 || !result.every(Number.isFinite)) throw new AppError("rate_limit_unavailable", "요청량 확인에 실패했어요.", 503);
    [count, ttl] = result;
  } else {
    prune(Date.now());
    const c = local().counters.get(key) ?? { count: 0, expires: Date.now() + windowMs };
    c.count++; local().counters.set(key, c);
    count = c.count; ttl = c.expires - Date.now();
  }
  if (count > limit) throw new AppError("rate_limit", "요청이 많아요. 잠시 후 다시 시도해 주세요.", 429, Math.max(1, Math.ceil(ttl / 1000)));
}

// Separate from the AI quota and sized for many judges behind one venue NAT.
export async function issueSession(req: Request) {
  await limitAttempts(req, "session-issuance", 200, 86_400_000);
  return createSession(req);
}

// Never refund issued capacity: failed/abandoned grants may still be usable.
// Grants are only metadata, so the shared budget lasts one 30-minute ticket
// lifetime; per-IP and per-session budgets still last a day.
const UPLOAD_BYTES = [100 * MAX_UPLOAD_BYTES, 10 * MAX_UPLOAD_BYTES, 10 * MAX_UPLOAD_BYTES];
const UPLOAD_FILES = [1000, 100, 100];
const UPLOAD_TTLS = [30 * 60_000, 86_400_000, 86_400_000];
const UPLOAD_BUDGET_SCRIPT = `
for i=1,#KEYS do
  if tonumber(redis.call('GET', KEYS[i]) or '0') + tonumber(ARGV[i]) > tonumber(ARGV[#KEYS+i]) then
    return {1, redis.call('PTTL', KEYS[i])}
  end
end
for i=1,#KEYS do
  local n = redis.call('INCRBY', KEYS[i], ARGV[i])
  if n == tonumber(ARGV[i]) then redis.call('PEXPIRE', KEYS[i], ARGV[2*#KEYS+i]) end
end
return {0, 0}`;

export async function reserveUploadBudget(req: Request, sessionId: string, bytes: number, files: number) {
  if (!Number.isSafeInteger(bytes) || bytes <= 0 || bytes > MAX_UPLOAD_BYTES || !Number.isInteger(files) || files < 1 || files > 10) {
    throw new AppError("invalid_input", "파일 정보나 용량이 올바르지 않아요.", 400);
  }
  if (!usageLimitsEnabled()) return;
  const scopes = ["global", `ip:${identity(req)}`, `session:${sessionId}`];
  const keys = ["bytes", "files"].flatMap(unit => scopes.map(scope => `easyapply:v1:upload:${unit}:${scope}`));
  const increments = [bytes, bytes, bytes, files, files, files];
  const limits = [...UPLOAD_BYTES, ...UPLOAD_FILES], ttls = [...UPLOAD_TTLS, ...UPLOAD_TTLS];
  let result: number[];
  if (remote()) {
    const r = await redis(["EVAL", UPLOAD_BUDGET_SCRIPT, keys.length, ...keys, ...increments, ...limits, ...ttls]);
    if (!Array.isArray(r) || r.length !== 2 || !r.every(Number.isFinite)) throw new AppError("rate_limit_unavailable", "요청량 확인에 실패했어요.", 503);
    result = r;
  } else {
    const now = Date.now(); prune(now);
    const counters = local().counters;
    const blocked = keys.findIndex((key, i) => (counters.get(key)?.count ?? 0) + increments[i] > limits[i]);
    result = blocked < 0 ? [0, 0] : [1, (counters.get(keys[blocked])?.expires ?? now + ttls[blocked]) - now];
    if (!result[0]) for (let i = 0; i < keys.length; i++) {
      const counter = counters.get(keys[i]) ?? { count: 0, expires: now + ttls[i] };
      counter.count += increments[i]; counters.set(keys[i], counter);
    }
  }
  if (result[0]) throw new AppError("upload_limit", "오늘의 파일 업로드 한도에 도달했어요. 나중에 다시 시도해 주세요.", 429, Math.max(1, Math.ceil(result[1] / 1000)));
}

type Kind = "analyze" | "match";

// Admission is split in two. The lease (early) holds a concurrency slot and
// blocks duplicate runs; the charge (just before the provider call) spends the
// quota. Files that fail to parse therefore never consume anyone's quota.
// Both steps are atomic across server instances.
const LEASE_SCRIPT = `
local now = tonumber(ARGV[1])
local nkeys = #KEYS - 2
local active = KEYS[nkeys+1]
local session = KEYS[nkeys+2]
redis.call('ZREMRANGEBYSCORE', active, '-inf', now)
for i=1,nkeys do
  if tonumber(redis.call('GET', KEYS[i]) or '0') >= tonumber(ARGV[4+i]) then
    return {10+i, redis.call('PTTL', KEYS[i])}
  end
end
redis.call('ZREMRANGEBYSCORE', session, '-inf', now)
if redis.call('ZCARD', session) >= tonumber(ARGV[6+nkeys]) then
  local first = redis.call('ZRANGE', session, 0, 0, 'WITHSCORES')
  return {2, tonumber(first[2]) - now}
end
if tonumber(ARGV[4]) > 0 and redis.call('ZCARD', active) >= tonumber(ARGV[4]) then
  local first = redis.call('ZRANGE', active, 0, 0, 'WITHSCORES')
  return {3, tonumber(first[2]) - now}
end
if ARGV[5+nkeys] == '0' then return {0, 0} end
redis.call('ZADD', session, now + tonumber(ARGV[3]), ARGV[2])
redis.call('PEXPIRE', session, ARGV[3])
redis.call('ZADD', active, now + tonumber(ARGV[3]), ARGV[2])
redis.call('PEXPIRE', active, ARGV[3])
return {0, 0}`;
const CHARGE_SCRIPT = `
local nkeys = #KEYS
for i=1,nkeys do
  if tonumber(redis.call('GET', KEYS[i]) or '0') >= tonumber(ARGV[i]) then
    return {10+i, redis.call('PTTL', KEYS[i])}
  end
end
for i=1,nkeys do
  local n = redis.call('INCR', KEYS[i])
  if n == 1 then redis.call('PEXPIRE', KEYS[i], ARGV[nkeys+i]) end
end
return {0, 0}`;
const RELEASE_SCRIPT = `
redis.call('ZREM', KEYS[1], ARGV[1])
redis.call('ZREM', KEYS[2], ARGV[1])
return 1`;

function quota(req: Request, sessionId: string, kind: Kind) {
  if (!usageLimitsEnabled()) return { keys: [] as string[], limits: [] as number[], ttls: [] as number[] };
  const ip = identity(req);
  const burst = kind === "analyze" ? 8 : 24;
  return {
    keys: [
      `easyapply:v1:ip:${ip}:${kind}`,
      `easyapply:v1:session:${sessionId}:${kind}`,
      `easyapply:v1:daily:ip:${ip}`,
      `easyapply:v1:daily:session:${sessionId}`,
      "easyapply:v1:daily",
    ],
    limits: [
      burst, burst,
      intEnv("EASYAPPLY_DAILY_IP_AI_LIMIT", 20, 1, 100_000),
      intEnv("EASYAPPLY_DAILY_SESSION_AI_LIMIT", 20, 1, 100_000),
      intEnv("EASYAPPLY_DAILY_AI_LIMIT", 100, 1, 100_000),
    ],
    ttls: [600_000, 600_000, 86_400_000, 86_400_000, 86_400_000],
  };
}

function admissionResult(r: unknown): number[] {
  if (!Array.isArray(r) || r.length !== 2 || !r.every(Number.isFinite)) throw new AppError("rate_limit_unavailable", "요청량 확인에 실패했어요.", 503);
  return r;
}

function admissionError([code, retryMs]: number[]) {
  const duplicate = code === 2;
  const personalDaily = code === 13 || code === 14;
  return new AppError(duplicate ? "in_progress" : personalDaily ? "daily_limit" : "rate_limit", duplicate
    ? "이미 처리 중인 요청이 있어요. 완료된 뒤 다시 시도해 주세요."
    : personalDaily ? "현재 이용 환경의 24시간 AI 이용 한도에 도달했어요. 다른 이용자의 심사를 위해 이용량을 나누고 있어요."
    : "지금은 분석 요청이 많거나 이용 한도에 도달했어요. 잠시 후 다시 시도해 주세요.", duplicate ? 409 : 429, Math.max(1, Math.ceil(retryMs / 1000)));
}

// 맞춤 공고 찾기는 공고를 최대 5개 받아 한꺼번에 읽는다. 전체 동시 실행 상한(EASYAPPLY_MAX_CONCURRENT)은 따로 적용된다.
export const SESSION_SLOTS = 5;

async function leaseAI(req: Request, sessionId: string, kind: Kind, reserve: boolean) {
  const now = Date.now(), id = randomUUID(), leaseMs = 310_000;
  const { keys, limits } = quota(req, sessionId, kind);
  const concurrent = usageLimitsEnabled() ? intEnv("EASYAPPLY_MAX_CONCURRENT", 3, 1, 20) : 0;
  // 한 세션은 AI 호출을 동시에 SESSION_SLOTS개까지 돌린다.
  const active = "easyapply:v1:active", own = `easyapply:v1:session-leases:${sessionId}`;
  let result: number[];
  if (remote()) {
    result = admissionResult(await redis(["EVAL", LEASE_SCRIPT, keys.length + 2, ...keys, active, own, now, id, leaseMs, concurrent, ...limits, reserve ? 1 : 0, SESSION_SLOTS]));
  } else {
    prune(now);
    const s = local();
    const leases = [...s.leases.values()];
    const mine = leases.filter((v) => v.session === sessionId);
    const busy = mine.length >= SESSION_SLOTS ? mine.reduce((a, b) => (a.expires <= b.expires ? a : b)) : undefined;
    const blocked = keys.findIndex((key, i) => (s.counters.get(key)?.count ?? 0) >= limits[i]);
    result = blocked >= 0 ? [11 + blocked, s.counters.get(keys[blocked])!.expires - now]
      : busy ? [2, busy.expires - now]
      : concurrent > 0 && leases.length >= concurrent ? [3, Math.min(...leases.map((v) => v.expires)) - now]
      : [0, 0];
    if (!result[0] && reserve) s.leases.set(id, { id, session: sessionId, expires: now + leaseMs });
  }
  if (result[0]) throw admissionError(result);
  let released = false;
  return async () => {
    if (released || !reserve) return;
    released = true;
    if (remote()) {
      try { await redis(["EVAL", RELEASE_SCRIPT, 2, active, own, id]); }
      catch { console.error(JSON.stringify({ event: "lease_release_failed", lease: id })); }
    } else local().leases.delete(id);
  };
}

/** Checks capacity without holding a slot or spending quota. */
export async function checkAIAvailability(req: Request, sessionId: string, kind: Kind) {
  await leaseAI(req, sessionId, kind, false);
}

/** Holds a concurrency slot; the returned function releases it. Spends no quota. */
export async function acquireAI(req: Request, sessionId: string, kind: Kind) {
  return leaseAI(req, sessionId, kind, true);
}

/** Spends one AI call from every quota. Call it immediately before the provider call. */
export async function chargeAI(req: Request, sessionId: string, kind: Kind) {
  const { keys, limits, ttls } = quota(req, sessionId, kind);
  if (!keys.length) return;
  let result: number[];
  if (remote()) {
    result = admissionResult(await redis(["EVAL", CHARGE_SCRIPT, keys.length, ...keys, ...limits, ...ttls]));
  } else {
    const now = Date.now();
    prune(now);
    const counters = local().counters;
    const blocked = keys.findIndex((key, i) => (counters.get(key)?.count ?? 0) >= limits[i]);
    result = blocked >= 0 ? [11 + blocked, counters.get(keys[blocked])!.expires - now] : [0, 0];
    if (!result[0]) keys.forEach((key, i) => {
      const counter = counters.get(key) ?? { count: 0, expires: now + ttls[i] };
      counter.count++;
      counters.set(key, counter);
    });
  }
  if (result[0]) throw admissionError(result);
}
