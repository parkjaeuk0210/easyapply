export const isHosted = () => process.env.VERCEL === "1";
export const isProduction = () => process.env.NODE_ENV === "production" || isHosted();
// This app is for judging: usage quotas are opt-in, not the default.
export const usageLimitsEnabled = () => process.env.EASYAPPLY_USAGE_LIMITS === "on";

// "demo" and "none" switch AI off on purpose.
const PROVIDER_SETTINGS = ["auto", "api", "anthropic", "cli", "demo", "none"];
export const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;

/** EASYAPPLY_PROVIDER, or null when it is not a known setting. */
export function providerSetting(): string | null {
  const value = (process.env.EASYAPPLY_PROVIDER || "auto").toLowerCase();
  return PROVIDER_SETTINGS.includes(value) ? value : null;
}

/** The provider the environment selects. "cli" still needs a local binary check. */
/** All hosted AI calls go through the Anthropic SDK; "cli" is a localhost-only fallback. */
export function selectedProvider(): "api" | "cli" | "none" {
  const setting = providerSetting();
  const anthropic = !!(process.env.ANTHROPIC_API_KEY?.trim() || process.env.ANTHROPIC_AUTH_TOKEN?.trim());
  if (setting === "api" || setting === "anthropic") return anthropic ? "api" : "none";
  if (setting === "cli") return "cli";
  if (setting !== "auto") return "none";
  return anthropic ? "api" : "cli";
}

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
    intEnv("EASYAPPLY_ANALYZE_OUTPUT_TOKENS", 48_000, 1000, 128_000);
    intEnv("EASYAPPLY_MATCH_OUTPUT_TOKENS", 16_000, 1000, 128_000);
    if (usageLimitsEnabled()) {
      intEnv("EASYAPPLY_DAILY_AI_LIMIT", 100, 1, 100_000);
      intEnv("EASYAPPLY_DAILY_IP_AI_LIMIT", 20, 1, 100_000);
      intEnv("EASYAPPLY_DAILY_SESSION_AI_LIMIT", 20, 1, 100_000);
      intEnv("EASYAPPLY_MAX_CONCURRENT", 3, 1, 20);
    }
  } catch { issues.push("limits"); }
  if (!providerSetting()) issues.push("provider");
  // Only the active provider's settings can break a request.
  const provider = selectedProvider();
  const effort = process.env.EASYAPPLY_EFFORT || "medium";
  if ((provider === "api" || provider === "cli") && !EFFORTS.includes(effort as typeof EFFORTS[number])) issues.push("ai_settings");
  const speed = process.env.EASYAPPLY_ANTHROPIC_SPEED || "standard";
  if (provider === "api" && speed !== "standard" && speed !== "fast") issues.push("ai_settings");
  return [...new Set(issues)];
}
