import { AnalysisSchema } from "@/lib/schema";
import { ANALYZE_SYSTEM, analyzeUserText } from "@/lib/prompts";
import { LlmError, runStructured, todayKST, type InputFile } from "@/lib/llm";
import { MAX_UPLOAD_BYTES } from "@/lib/limits";

export const maxDuration = 300;

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
const MAX_PDF = MAX_UPLOAD_BYTES;
const MAX_IMAGE = 5 * 1024 * 1024;
const MAX_IMAGES = 10;

function bad(message: string, status = 400, code = "invalid_input") {
  return Response.json({ error: { code, message } }, { status });
}

export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return bad("업로드한 파일을 읽지 못했어요.");
  }
  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (!files.length) return bad("공고문 PDF나 이미지를 올려 주세요.");

  const pdfs = files.filter((f) => f.type === "application/pdf");
  const images = files.filter((f) => IMAGE_TYPES.includes(f.type));
  const unsupported = files.find((f) => f.type !== "application/pdf" && !IMAGE_TYPES.includes(f.type));
  if (unsupported) {
    const heic = /heic|heif/i.test(unsupported.type) || /\.hei[cf]$/i.test(unsupported.name);
    return bad(
      heic
        ? "아이폰 HEIC 사진은 아직 지원하지 않아요. JPG/PNG로 저장하거나 캡처해서 올려 주세요."
        : `지원하지 않는 파일 형식이에요: ${unsupported.name} (PDF, JPG, PNG, WEBP만 가능)`,
    );
  }
  if (pdfs.length > 1 || (pdfs.length && images.length))
    return bad("PDF는 한 번에 한 개만 올릴 수 있어요. (이미지는 여러 장 가능)");
  const mb = Math.floor(MAX_UPLOAD_BYTES / 1024 / 1024);
  if (pdfs[0] && pdfs[0].size > MAX_PDF) return bad(`PDF가 너무 커요. ${mb}MB 이하로 올려 주세요.`, 413);
  if (images.length > MAX_IMAGES) return bad(`이미지는 최대 ${MAX_IMAGES}장까지 올릴 수 있어요.`);
  const bigImage = images.find((f) => f.size > MAX_IMAGE);
  if (bigImage) return bad(`이미지가 너무 커요(5MB 초과): ${bigImage.name}`, 413);
  if (files.reduce((n, f) => n + f.size, 0) > MAX_UPLOAD_BYTES)
    return bad(`올린 파일이 합쳐서 ${mb}MB를 넘어요. 사진 장수를 줄여서 다시 올려 주세요.`, 413);

  const input: InputFile[] = await Promise.all(
    files.map(async (f) => ({ name: f.name, mediaType: f.type, data: Buffer.from(await f.arrayBuffer()) })),
  );

  const started = Date.now();
  try {
    const { data, provider } = await runStructured({
      system: ANALYZE_SYSTEM,
      text: analyzeUserText({ kind: pdfs.length ? "pdf" : "images", count: files.length, today: todayKST() }),
      files: input,
      schema: AnalysisSchema,
    });
    return Response.json({ analysis: data, provider, elapsed_ms: Date.now() - started });
  } catch (e) {
    const err = e instanceof LlmError ? e : new LlmError("unknown", String(e));
    console.error("[easyapply/analyze]", err.code, err.message);
    return Response.json({ error: { code: err.code, message: err.message } }, { status: err.status });
  }
}
