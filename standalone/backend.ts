/**
 * 단일 HTML(공유용)에서 서버 대신 동작하는 부분.
 *
 * 화면 코드는 Next.js 앱과 똑같이 /api/*, /samples/* 를 fetch 한다. 여기서 window.fetch를 감싸
 * 그 요청만 브라우저 안에서 처리한다.
 * - /samples/*  : 빌드 때 파일 안에 넣어 둔 샘플 공고문·분석 결과
 * - /api/status : claude.ai 공유 페이지로 열었으면 보는 사람의 Claude 계정(sample 기능)으로 AI 연결
 * - /api/analyze, /api/match : 같은 프롬프트·스키마로 Claude에 묻고, 형식을 맞춰 검증
 */
import { pdfjs } from "react-pdf";
import { z } from "zod";
import analysisSample from "../public/samples/garam-analysis.json";
import matchSample from "../public/samples/garam-match.json";
import samplePdfB64 from "../public/samples/garam-youth-rent-2026.pdf";
import { AnalysisSchema, MatchSchema, toOutputSchema } from "@/lib/schema";
import { ANALYZE_SYSTEM, MATCH_SYSTEM, analyzeUserText, matchUserText } from "@/lib/prompts";

// ── claude.ai 페이지의 sample 기능(보는 사람의 Claude 계정) ─────────────

type SampleLimits = {
  maxPromptBytes: number;
  images?: { maxCount: number; maxInputBytes: number; mediaTypes: string[] };
};
type SampleOpts = { modelTier?: "quick" | "default" | "complex"; effort?: "low" | "medium" | "high"; images?: Blob[] };
type SampleFn = {
  (input: string, opts?: SampleOpts): Promise<{ text: string; truncated: boolean }>;
  json: <T = unknown>(input: string, opts?: SampleOpts) => Promise<T>;
  limits: () => Promise<SampleLimits>;
};
type ClaudeRuntime = { use: (name: string) => Promise<unknown> };

const runtime = (): ClaudeRuntime | undefined => (window as unknown as { claude?: ClaudeRuntime }).claude;

let samplePromise: Promise<SampleFn | null> | null = null;
function getSample() {
  samplePromise ??= (async () => {
    const c = runtime();
    if (!c?.use) return null;
    try {
      return ((await c.use("sample")) as SampleFn | null) ?? null;
    } catch {
      return null;
    }
  })();
  return samplePromise;
}

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

function sampleError(e: unknown): HttpError {
  const code = (e as { code?: string })?.code ?? "";
  const msg: Record<string, [number, string]> = {
    not_granted: [403, "Claude 사용을 허용해야 분석할 수 있어요. 허용 창이 뜨면 ‘허용’을 눌러 주세요."],
    sampling_disabled: [403, "이 계정에서는 Claude를 쓸 수 없어요."],
    session_expired: [401, "claude.ai 로그인이 풀렸어요. 다시 로그인한 뒤 시도해 주세요."],
    rate_limited: [429, "Claude 사용량 한도에 걸렸어요. 잠시 뒤 다시 시도해 주세요."],
    refused: [422, "AI가 이 문서의 분석을 거절했어요. 다른 공고문으로 시도해 주세요."],
    prompt_too_large: [413, "공고문이 너무 길어요. 필요한 쪽만 나눠서 올려 주세요."],
    invalid_json: [502, "AI 응답이 잘렸거나 형식이 맞지 않아요. 다시 시도하거나, 필요한 쪽만 나눠서 올려 주세요."],
    empty_completion: [502, "AI가 답을 만들지 못했어요. 다시 시도해 주세요."],
    image_rejected: [400, "사진을 읽지 못했어요. JPG나 PNG로 다시 올려 주세요."],
    images_unavailable: [400, "이 화면에서는 사진을 보낼 수 없어요. PDF로 올려 주세요."],
  };
  const [status, message] = msg[code] ?? [502, "AI 서버 오류예요. 잠시 뒤 다시 시도해 주세요."];
  return new HttpError(status, message);
}

// ── 응답 형식 맞추기 ─────────────────────────────────────────────
// API의 structured output과 달리 sample은 JSON을 강제하지 않는다. 빠진 칸은 빈 값으로 채우고,
// 목록에 없는 값은 첫 값으로 돌린 뒤 zod로 한 번 더 검증한다.

type JS = {
  type?: string | string[];
  anyOf?: JS[];
  enum?: unknown[];
  properties?: Record<string, JS>;
  items?: JS;
};

function conform(s: JS, v: unknown): unknown {
  if (s.anyOf) {
    const nullable = s.anyOf.some((x) => x.type === "null");
    if (v === null || v === undefined) return nullable ? null : conform(s.anyOf[0], v);
    return conform(s.anyOf.find((x) => x.type !== "null") ?? s.anyOf[0], v);
  }
  const t = Array.isArray(s.type) ? s.type : [s.type];
  if (s.enum) return s.enum.includes(v) ? v : v == null && t.includes("null") ? null : s.enum[0];
  if (t.includes("object")) {
    const o = v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
    const out: Record<string, unknown> = {};
    for (const [k, ps] of Object.entries(s.properties ?? {})) out[k] = conform(ps, o[k]);
    return out;
  }
  if (t.includes("array")) return Array.isArray(v) ? v.map((x) => conform(s.items ?? {}, x)) : [];
  if (v == null) return t.includes("null") ? null : t.includes("string") ? "" : t.includes("boolean") ? false : 0;
  if (t.includes("string")) return typeof v === "string" ? v : String(v);
  if (t.includes("number") || t.includes("integer")) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  if (t.includes("boolean")) return v === true || v === "true";
  return v;
}

async function askJson<S extends z.ZodType>(schema: S, prompt: string, images?: Blob[]): Promise<z.infer<S>> {
  const sample = await getSample();
  if (!sample) throw new HttpError(503, "AI가 연결되어 있지 않아요. claude.ai에 로그인한 상태로 이 페이지를 열어 주세요.");
  const js = toOutputSchema(schema) as JS;
  let raw: unknown;
  try {
    raw = await sample.json(prompt, { modelTier: "complex", effort: "medium", ...(images?.length ? { images } : {}) });
  } catch (e) {
    throw sampleError(e);
  }
  const parsed = schema.safeParse(conform(js, raw));
  if (!parsed.success) {
    console.error("[easyapply] schema mismatch", parsed.error.issues.slice(0, 5));
    throw new HttpError(502, "AI 응답 형식이 올바르지 않아요. 다시 시도해 주세요.");
  }
  return parsed.data;
}

function formatBlock(schema: z.ZodType) {
  return (
    "\n\n## 답변 형식\n아래 JSON 스키마에 맞는 JSON 객체 하나만 답하세요. 앞뒤 설명이나 코드 블록 표시 없이 JSON만 씁니다.\n" +
    JSON.stringify(toOutputSchema(schema))
  );
}

function todayKST() {
  const now = new Date();
  const ymd = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(now);
  const wd = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", weekday: "short" }).format(now);
  return `${ymd}(${wd})`;
}

// ── PDF 다루기 ───────────────────────────────────────────────────

async function openPdf(file: Blob) {
  return pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
}

async function pdfText(file: Blob): Promise<string[]> {
  const doc = await openPdf(file);
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const tc = await (await doc.getPage(i)).getTextContent();
    let s = "";
    for (const it of tc.items) if ("str" in it) s += it.str + (it.hasEOL ? "\n" : "");
    pages.push(s.replace(/[ \t]+\n/g, "\n").trim());
  }
  await doc.destroy();
  return pages;
}

/** 글자가 없는 스캔 PDF는 쪽마다 그림으로 바꿔 보낸다. */
async function pdfPagesAsImages(file: Blob, max: number): Promise<Blob[]> {
  const doc = await openPdf(file);
  const out: Blob[] = [];
  for (let i = 1; i <= Math.min(doc.numPages, max); i++) {
    const page = await doc.getPage(i);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: 1600 / Math.max(base.width, base.height) });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, canvas, viewport }).promise;
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.9));
    if (blob) out.push(blob);
  }
  await doc.destroy();
  return out;
}

// ── 가짜 API ─────────────────────────────────────────────────────

const MAX_UPLOAD = 25 * 1024 * 1024;

async function status() {
  const sample = await getSample();
  if (sample) return { provider: "api", model: "Claude (내 계정)", hosted: true, max_upload_bytes: MAX_UPLOAD };
  return {
    provider: "none",
    model: null,
    hosted: true,
    max_upload_bytes: MAX_UPLOAD,
    note: runtime()
      ? "지금은 샘플 공고문만 볼 수 있어요. claude.ai에 로그인한 상태로 이 페이지를 열면 새 공고문도 분석할 수 있어요."
      : "이 파일에서는 샘플 공고문으로 모든 기능을 체험할 수 있어요. 새 공고문 분석은 claude.ai 공유 링크에서 할 수 있어요.",
  };
}

async function analyze(form: FormData) {
  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (!files.length) throw new HttpError(400, "공고문 PDF나 이미지를 올려 주세요.");
  const sample = await getSample();
  if (!sample) throw new HttpError(503, "AI가 연결되어 있지 않아요. claude.ai에 로그인한 상태로 이 페이지를 열어 주세요.");
  const limits = await sample.limits().catch(() => null);
  const today = todayKST();
  const pdf = files.find((f) => f.type === "application/pdf");

  let prompt: string;
  let images: Blob[] | undefined;
  if (pdf) {
    const pages = await pdfText(pdf).catch(() => {
      throw new HttpError(400, "PDF를 열지 못했어요. 암호가 걸려 있거나 손상된 파일인지 확인해 주세요.");
    });
    const letters = pages.join("").replace(/\s/g, "").length;
    if (letters >= 40 * pages.length) {
      prompt =
        ANALYZE_SYSTEM +
        "\n\n---\n" +
        analyzeUserText({ kind: "pdf", count: 1, today }) +
        "\n공고문 PDF에서 뽑은 글자를 아래에 붙였어요. ‘=== N쪽 ===’ 줄이 쪽 구분이에요. evidence의 page는 이 쪽 번호를, quote는 아래 글자를 그대로 옮겨 씁니다(표는 칸이 줄바꿈으로 나뉘어 있을 수 있어요)." +
        formatBlock(AnalysisSchema) +
        "\n\n## 공고문 원문\n" +
        pages.map((t, i) => `=== ${i + 1}쪽 ===\n${t}`).join("\n\n");
    } else {
      if (!limits?.images) throw new HttpError(400, "글자를 읽을 수 없는 스캔 PDF예요. 공고문 화면을 캡처해서 사진으로 올려 주세요.");
      images = await pdfPagesAsImages(pdf, limits.images.maxCount);
      prompt =
        ANALYZE_SYSTEM +
        "\n\n---\n" +
        analyzeUserText({ kind: "images", count: images.length, today }) +
        "\n(이미지는 PDF의 각 쪽을 순서대로 찍은 것이에요.)" +
        formatBlock(AnalysisSchema);
    }
  } else {
    if (!limits?.images) throw new HttpError(400, "이 화면에서는 사진을 보낼 수 없어요. PDF로 올려 주세요.");
    if (files.length > limits.images.maxCount)
      throw new HttpError(400, `사진은 한 번에 ${limits.images.maxCount}장까지 올릴 수 있어요.`);
    images = files;
    prompt = ANALYZE_SYSTEM + "\n\n---\n" + analyzeUserText({ kind: "images", count: files.length, today }) + formatBlock(AnalysisSchema);
  }
  if (limits && new TextEncoder().encode(prompt).length > limits.maxPromptBytes)
    throw new HttpError(413, "공고문이 너무 길어요. 필요한 쪽만 나눠서 올려 주세요.");

  const started = Date.now();
  const analysis = await askJson(AnalysisSchema, prompt, images);
  return { analysis, provider: "api", elapsed_ms: Date.now() - started };
}

const MatchBody = z.object({
  analysis: AnalysisSchema.optional(),
  sample: z.boolean().optional(),
  answers: z.record(z.string(), z.string()),
  extra: z.string().max(2000).default(""),
});

async function match(body: unknown) {
  const parsed = MatchBody.safeParse(body);
  if (!parsed.success) throw new HttpError(400, "요청 형식이 올바르지 않아요. 공고문을 다시 분석해 주세요.");
  const { answers, extra } = parsed.data;
  const analysis = parsed.data.sample ? AnalysisSchema.parse(analysisSample.analysis) : parsed.data.analysis;
  if (!analysis) throw new HttpError(400, "공고문 분석 결과가 없어요.");
  const prompt = MATCH_SYSTEM + "\n\n---\n" + matchUserText(analysis, answers, extra, todayKST()) + formatBlock(MatchSchema);
  return { match: await askJson(MatchSchema, prompt), provider: "api" };
}

function b64ToBlob(b64: string, type: string) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

export function installBackend() {
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    let path = "";
    try {
      path = new URL(raw, location.href).pathname;
    } catch {}
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    try {
      if (path.endsWith("/samples/garam-analysis.json")) return json(analysisSample);
      if (path.endsWith("/samples/garam-match.json")) return json(matchSample);
      if (path.endsWith("/samples/garam-youth-rent-2026.pdf"))
        return new Response(b64ToBlob(samplePdfB64, "application/pdf"), { headers: { "content-type": "application/pdf" } });
      if (path.endsWith("/api/status")) return json(await status());
      if (path.endsWith("/api/analyze") && method === "POST") return json(await analyze(init?.body as FormData));
      if (path.endsWith("/api/match") && method === "POST") return json(await match(JSON.parse(String(init?.body ?? "null"))));
    } catch (e) {
      const err = e instanceof HttpError ? e : new HttpError(500, e instanceof Error ? e.message : String(e));
      return json({ error: { code: "error", message: err.message } }, err.status);
    }
    return realFetch(input, init);
  };
}
