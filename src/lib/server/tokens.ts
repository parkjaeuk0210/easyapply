import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Analysis } from "../schema";
import { AppError } from "./errors";
import { isProduction } from "./config";

const state = globalThis as typeof globalThis & { easyapplyDevSecret?: string };
const COOKIE = "easyapply_session";
const TTL = 12 * 60 * 60;

function secret() {
  const configured = process.env.EASYAPPLY_SIGNING_SECRET;
  if (configured && configured.length >= 32) return configured;
  if (isProduction()) throw new AppError("configuration", "서비스 연결을 준비 중이에요. 잠시 후 다시 방문해 주세요.", 503);
  return state.easyapplyDevSecret ??= randomBytes(32).toString("hex");
}

export function digest(value: string) { return createHash("sha256").update(value).digest("hex"); }
export function privateKey(value: string) { return createHmac("sha256", secret()).update(value).digest("hex"); }
export function equal(a: string, b: string) { return timingSafeEqual(Buffer.from(digest(a)), Buffer.from(digest(b))); }

function sign(payload: object) {
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${data}.${privateKey(data)}`;
}

function verify(token: string): Record<string, unknown> | null {
  if (token.length > 16_384) return null;
  const [data, sig, extra] = token.split(".");
  if (!data || !sig || extra || !equal(privateKey(data), sig)) return null;
  try {
    const p = JSON.parse(Buffer.from(data, "base64url").toString());
    return p && typeof p.exp === "number" && p.exp > Date.now() ? p : null;
  } catch { return null; }
}

export function session(req: Request): string | null {
  const cookie = req.headers.get("cookie")?.split(";").map((c) => c.trim()).find((c) => c.startsWith(`${COOKIE}=`));
  const value = cookie ? verify(cookie.slice(COOKIE.length + 1)) : null;
  return value?.kind === "session" && typeof value.id === "string" &&
    value.access === privateKey(process.env.EASYAPPLY_ACCESS_CODE ?? "public") ? value.id : null;
}

export function createSession(req: Request) {
  const id = randomBytes(24).toString("hex");
  const token = sign({ kind: "session", id, exp: Date.now() + TTL * 1000, access: privateKey(process.env.EASYAPPLY_ACCESS_CODE ?? "public") });
  const secure = isProduction() || new URL(req.url).protocol === "https:";
  return { id, cookie: `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${TTL}${secure ? "; Secure" : ""}` };
}

export function requireSession(req: Request) {
  const id = session(req);
  if (!id) throw new AppError("session_required", "이용 시간이 만료됐어요. 새로고침한 뒤 다시 시도해 주세요.", 401);
  return id;
}

export function signAnalysis(analysis: Analysis, sessionId: string, unverifiedCriteria: string[] = []) {
  return sign({ kind: "analysis", sid: sessionId, hash: digest(JSON.stringify(analysis)), unchecked: unverifiedCriteria, exp: Date.now() + TTL * 1000 });
}

export function verifyAnalysis(analysis: Analysis, token: string, sessionId: string) {
  const p = verify(token);
  if (p?.kind !== "analysis" || p.sid !== sessionId || p.hash !== digest(JSON.stringify(analysis))) {
    throw new AppError("analysis_expired", "분석 결과가 만료되었거나 변경됐어요. 공고문을 다시 분석해 주세요.", 409);
  }
  return Array.isArray(p.unchecked) ? p.unchecked.filter((v): v is string => typeof v === "string") : [];
}
