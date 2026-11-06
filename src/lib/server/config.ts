export const isHosted = () => process.env.VERCEL === "1";
export const isProduction = () => process.env.NODE_ENV === "production" || isHosted();

export function intEnv(name: string, fallback: number, min: number, max: number) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`Invalid configuration: ${name}`);
  return value;
}

export function redisConfig() {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  // Keep each credential pair together; never combine two Redis connections.
  if (url || token) return { url, token };
  return { url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN };
}

export function configurationIssues(): string[] {
  const issues: string[] = [];
  if (isProduction()) {
    if ((process.env.EASYAPPLY_SIGNING_SECRET?.length ?? 0) < 32) issues.push("signing_secret");
    const { url, token } = redisConfig();
    if (!url?.startsWith("https://") || !token) issues.push("rate_limit_store");
    if (!isHosted() && !process.env.EASYAPPLY_APP_ORIGIN) issues.push("app_origin");
  }
  if (process.env.EASYAPPLY_ACCESS_CODE && process.env.EASYAPPLY_ACCESS_CODE.length < 12) issues.push("access_code");
  try {
    if (process.env.EASYAPPLY_APP_ORIGIN) {
      const u = new URL(process.env.EASYAPPLY_APP_ORIGIN);
      if (!/^https?:$/.test(u.protocol) || u.origin !== process.env.EASYAPPLY_APP_ORIGIN) issues.push("app_origin");
    }
    intEnv("EASYAPPLY_REQUEST_TIMEOUT_MS", 240_000, 1000, 260_000);
    intEnv("EASYAPPLY_DAILY_AI_LIMIT", 100, 1, 100_000);
    intEnv("EASYAPPLY_MAX_CONCURRENT", 3, 1, 20);
  } catch { issues.push("limits"); }
  return [...new Set(issues)];
}
