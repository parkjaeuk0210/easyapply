/**
 * 휴대폰 사진은 4000px·5MB를 넘기 쉬워 AI 이미지 한도와 서버 업로드 한도에 걸린다.
 * 긴 변 2400px 이하 JPEG로 줄이고, 그래도 크면 화질 → 해상도 순으로 낮춰 maxBytes 안에 맞춘다.
 * (공고문 글자는 긴 변 1500px 정도까지는 충분히 읽힌다.)
 */
const MAX_EDGE = 2400;
const MIN_EDGE = 1200;
const DEFAULT_MAX_BYTES = 3.5 * 1024 * 1024;

export async function prepareImage(file: File, maxBytes = DEFAULT_MAX_BYTES): Promise<File> {
  if (!file.type.startsWith("image/") || file.type === "image/gif") return file;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return file;
  }
  const { width, height } = bitmap;
  const long = Math.max(width, height);
  if (long <= MAX_EDGE && file.size <= maxBytes) {
    bitmap.close();
    return file;
  }
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    return file;
  }

  let edge = Math.min(MAX_EDGE, long);
  let quality = 0.88;
  let blob: Blob | null = null;
  for (let i = 0; i < 8; i++) {
    const scale = edge / long;
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", quality));
    if (!blob || blob.size <= maxBytes) break;
    if (quality > 0.74) quality -= 0.07;
    else if (edge > MIN_EDGE) edge = Math.max(MIN_EDGE, Math.round(edge * 0.82));
    else break; // 더 줄이면 글자가 뭉개진다 — 호출한 쪽에서 용량 초과로 안내
  }
  bitmap.close();
  if (!blob) return file;
  return new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" });
}
