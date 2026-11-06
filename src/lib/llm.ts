import Anthropic from "@anthropic-ai/sdk";
import { spawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { z } from "zod";
import { toOutputSchema } from "./schema";

/**
 * AI 연결 방식
 * - api : Anthropic API (ANTHROPIC_API_KEY). 배포용.
 * - cli : 이 컴퓨터에 설치된 Claude Code(`claude -p`). API 키 없이 로컬에서 실행할 때.
 * - none: 연결 없음 → 화면에서는 샘플 공고문 체험만 가능.
 */
export type Provider = "api" | "cli" | "none";

export type InputFile = { name: string; mediaType: string; data: Buffer };
type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export const MODEL = process.env.EASYAPPLY_MODEL || "claude-opus-5-5";
const EFFORT = (process.env.EASYAPPLY_EFFORT as Effort) || "medium";
const CLI_TIMEOUT_MS = Number(process.env.EASYAPPLY_CLI_TIMEOUT_MS || 6 * 60 * 1000);

export class LlmError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 500,
  ) {
    super(message);
  }
}

// ── provider 감지 ────────────────────────────────────────────────

let cachedClaudeBin: string | null | undefined;

async function isExecutable(p: string) {
  try {
    await fs.access(p, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export async function findClaudeBinary(): Promise<string | null> {
  if (cachedClaudeBin !== undefined) return cachedClaudeBin;
  const candidates = [
    process.env.CLAUDE_BIN,
    ...(process.env.PATH || "").split(path.delimiter).map((d) => path.join(d, "claude")),
    "/opt/homebrew/bin/claude",
    "/usr/local/bin/claude",
    path.join(os.homedir(), ".claude/local/claude"),
    path.join(os.homedir(), ".local/bin/claude"),
  ].filter(Boolean) as string[];
  for (const c of candidates) {
    if (await isExecutable(c)) return (cachedClaudeBin = c);
  }
  return (cachedClaudeBin = null);
}

export async function detectProvider(): Promise<Provider> {
  const pref = (process.env.EASYAPPLY_PROVIDER || "auto").toLowerCase();
  if (pref === "demo") return "none";
  if (pref === "api") return "api";
  if (pref === "cli") return (await findClaudeBinary()) ? "cli" : "none";
  if (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) return "api";
  if (await findClaudeBinary()) return "cli";
  return "none";
}

// ── 공통 진입점 ──────────────────────────────────────────────────

export async function runStructured<S extends z.ZodType>(opts: {
  system: string;
  text: string;
  files?: InputFile[];
  schema: S;
  effort?: Effort;
}): Promise<{ data: z.infer<S>; provider: Provider }> {
  const provider = await detectProvider();
  if (provider === "none") {
    throw new LlmError(
      "no_provider",
      "AI 연결이 설정되어 있지 않아요. ANTHROPIC_API_KEY를 설정하거나 Claude Code가 설치된 컴퓨터에서 실행해 주세요.",
      503,
    );
  }
  const raw = provider === "api" ? await viaApi(opts) : await viaCli(opts);
  const parsed = opts.schema.safeParse(raw);
  if (!parsed.success) {
    console.error("[easyapply] schema mismatch", parsed.error.issues.slice(0, 5));
    throw new LlmError("bad_output", "AI 응답 형식이 올바르지 않아요. 다시 시도해 주세요.", 502);
  }
  return { data: parsed.data, provider };
}

// ── Anthropic API ────────────────────────────────────────────────

let client: Anthropic | null = null;

async function viaApi(opts: {
  system: string;
  text: string;
  files?: InputFile[];
  schema: z.ZodType;
  effort?: Effort;
}): Promise<unknown> {
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN)
    throw new LlmError("auth", "Anthropic API 키가 설정되지 않았어요. ANTHROPIC_API_KEY 환경 변수를 넣어 주세요.", 503);
  client ??= new Anthropic();
  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  for (const f of opts.files ?? []) {
    const data = f.data.toString("base64");
    if (f.mediaType === "application/pdf") {
      content.push({
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data },
      });
    } else {
      content.push({
        type: "image",
        source: {
          type: "base64",
          media_type: f.mediaType as "image/png" | "image/jpeg" | "image/webp" | "image/gif",
          data,
        },
      });
    }
  }
  content.push({ type: "text", text: opts.text });

  let message: Anthropic.Beta.BetaMessage;
  try {
    // 긴 PDF 입력 + 큰 JSON 출력이라 스트리밍으로 받고 finalMessage()로 합친다(HTTP 타임아웃 방지).
    const stream = client.beta.messages.stream({
      model: MODEL,
      max_tokens: 64000,
      // 안전 분류기가 거절하면 서버가 권장 대체 모델로 같은 요청을 다시 실행한다.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: opts.system,
      output_config: {
        effort: opts.effort ?? EFFORT,
        format: { type: "json_schema", schema: toOutputSchema(opts.schema) },
      },
      messages: [{ role: "user", content }],
    });
    message = await stream.finalMessage();
  } catch (e) {
    throw mapApiError(e);
  }

  if (message.stop_reason === "refusal") {
    throw new LlmError("refusal", "AI가 이 문서의 분석을 거절했어요. 다른 공고문으로 시도해 주세요.", 422);
  }
  if (message.stop_reason === "max_tokens") {
    throw new LlmError("too_long", "공고문이 너무 길어 결과가 잘렸어요. 필요한 쪽만 나눠서 올려 주세요.", 413);
  }
  const text = message.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  try {
    return JSON.parse(text);
  } catch {
    throw new LlmError("bad_output", "AI 응답을 읽지 못했어요. 다시 시도해 주세요.", 502);
  }
}

function mapApiError(e: unknown): LlmError {
  if (e instanceof Anthropic.AuthenticationError)
    return new LlmError("auth", "Anthropic API 키가 올바르지 않아요. ANTHROPIC_API_KEY 값(로컬은 .env.local, Vercel은 환경 변수)을 확인해 주세요.", 401);
  if (e instanceof Anthropic.PermissionDeniedError)
    return new LlmError("permission", "이 API 키로는 해당 모델을 쓸 수 없어요.", 403);
  if (e instanceof Anthropic.RateLimitError)
    return new LlmError("rate_limit", "요청이 몰려 잠시 쉬어가요. 1분 뒤 다시 시도해 주세요.", 429);
  if (e instanceof Anthropic.BadRequestError)
    return new LlmError("bad_request", `파일을 처리하지 못했어요: ${e.message}`, 400);
  if (e instanceof Anthropic.ContentTooLargeError)
    return new LlmError("too_large", "파일이 너무 커요. 쪽수를 줄이거나 나눠서 올려 주세요.", 413);
  // APIConnectionError는 APIError의 하위 클래스라 먼저 검사한다.
  if (e instanceof Anthropic.APIConnectionError)
    return new LlmError("network", "AI 서버에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.", 502);
  if (e instanceof Anthropic.APIError)
    return new LlmError("upstream", `AI 서버 오류(${e.status ?? "?"})예요. 잠시 뒤 다시 시도해 주세요.`, 502);
  return new LlmError("unknown", e instanceof Error ? e.message : String(e));
}

// ── Claude Code CLI (로컬 실행용) ─────────────────────────────────

async function viaCli(opts: {
  system: string;
  text: string;
  files?: InputFile[];
  schema: z.ZodType;
  effort?: Effort;
}): Promise<unknown> {
  const bin = await findClaudeBinary();
  if (!bin) throw new LlmError("no_provider", "Claude Code(claude)를 찾지 못했어요.", 503);

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "easyapply-"));
  try {
    const paths: string[] = [];
    for (const [i, f] of (opts.files ?? []).entries()) {
      const ext = extFor(f.mediaType);
      const p = path.join(dir, f.mediaType === "application/pdf" ? `notice.${ext}` : `page-${i + 1}.${ext}`);
      await fs.writeFile(p, f.data);
      paths.push(p);
    }
    const fileNote = paths.length
      ? `\n\n분석할 파일입니다. Read 도구로 모든 쪽을 빠짐없이 직접 열어 읽으세요(긴 PDF는 pages를 나눠 읽기):\n${paths
          .map((p, i) => `${i + 1}. ${p}`)
          .join("\n")}\n파일을 다 읽은 뒤 지정된 JSON 스키마에 맞춰 답하세요.`
      : "";

    const args = [
      "-p",
      opts.text + fileNote,
      "--output-format",
      "json",
      "--json-schema",
      JSON.stringify(toOutputSchema(opts.schema)),
      "--system-prompt",
      opts.system,
      "--tools",
      paths.length ? "Read" : "",
      "--no-session-persistence",
      "--effort",
      opts.effort ?? EFFORT,
    ];
    if (paths.length) args.push("--allowedTools", "Read", "--add-dir", dir);
    if (process.env.EASYAPPLY_CLI_MODEL) args.push("--model", process.env.EASYAPPLY_CLI_MODEL);

    const stdout = await new Promise<string>((resolve, reject) => {
      const child = spawn(/*turbopackIgnore: true*/ bin, args, { cwd: dir, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
      let out = "";
      let err = "";
      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        reject(new LlmError("timeout", "분석 시간이 너무 오래 걸려 중단했어요. 다시 시도해 주세요.", 504));
      }, CLI_TIMEOUT_MS);
      child.stdout.on("data", (d) => (out += d));
      child.stderr.on("data", (d) => (err += d));
      child.on("error", (e) => {
        clearTimeout(timer);
        reject(new LlmError("cli", `Claude Code 실행 실패: ${e.message}`, 502));
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code !== 0 && !out.trim()) {
          reject(new LlmError("cli", `Claude Code가 오류로 종료됐어요(${code}). ${err.slice(0, 300)}`, 502));
        } else resolve(out);
      });
    });

    let result: { is_error?: boolean; subtype?: string; result?: string; structured_output?: unknown };
    try {
      result = JSON.parse(stdout);
    } catch {
      throw new LlmError("cli", "Claude Code 응답을 읽지 못했어요.", 502);
    }
    if (result.is_error || !result.structured_output) {
      const hint = /login|auth|credential/i.test(result.result ?? "")
        ? " 터미널에서 `claude`로 로그인했는지 확인해 주세요."
        : "";
      throw new LlmError("cli", `Claude Code 분석 실패(${result.subtype ?? "error"}).${hint}`, 502);
    }
    return result.structured_output;
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

function extFor(mediaType: string) {
  return (
    {
      "application/pdf": "pdf",
      "image/png": "png",
      "image/jpeg": "jpg",
      "image/webp": "webp",
      "image/gif": "gif",
    }[mediaType] ?? "bin"
  );
}

/** 한국 시간 기준 오늘 날짜 "2026-11-06(금)" */
export function todayKST() {
  const now = new Date();
  const ymd = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(now);
  const wd = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", weekday: "short" }).format(now);
  return `${ymd}(${wd})`;
}
