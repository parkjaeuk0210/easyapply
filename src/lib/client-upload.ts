import { responseJson } from "./client-api";

function sendFile(url: string, file: File, contentType: string, signal: AbortSignal, progress: (loaded: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest();
    const stop = () => request.abort();
    const finish = (error?: Error) => {
      signal.removeEventListener("abort", stop);
      if (error) reject(error); else resolve();
    };
    request.open("PUT", url);
    request.setRequestHeader("x-content-type", contentType);
    request.setRequestHeader("x-vercel-blob-access", "private");
    request.setRequestHeader("x-api-version", "13");
    request.timeout = 180_000;
    request.upload.onprogress = event => progress(event.loaded);
    request.onload = () => request.status >= 200 && request.status < 300
      ? finish() : finish(new Error("파일 전송에 실패했어요. 잠시 후 다시 올려 주세요."));
    request.onerror = () => finish(new Error("파일을 보내지 못했어요. 인터넷 연결을 확인해 주세요."));
    request.ontimeout = () => finish(new Error("파일 전송 시간이 초과됐어요. 연결을 확인한 뒤 다시 올려 주세요."));
    request.onabort = () => finish(new DOMException("업로드를 취소했어요.", "AbortError"));
    if (signal.aborted) { finish(new DOMException("업로드를 취소했어요.", "AbortError")); return; }
    signal.addEventListener("abort", stop, { once: true });
    request.send(file);
  });
}

export function cleanupUpload(ticket: string) {
  void fetch("/api/uploads", {
    method: "DELETE", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ upload_ticket: ticket }), keepalive: true,
  }).catch(() => {});
}

export async function uploadLargeFiles(files: File[], signal: AbortSignal, progress: (percentage: number) => void): Promise<string> {
  const response = await fetch("/api/uploads", {
    method: "POST", headers: { "Content-Type": "application/json" }, signal,
    body: JSON.stringify({ files: files.map(f => ({ name: f.name, mediaType: f.type, size: f.size })) }),
  });
  const grant = await responseJson(response) as { upload_ticket: string; uploads: { url: string; contentType: string }[] };
  if (typeof grant.upload_ticket !== "string" || !Array.isArray(grant.uploads) || grant.uploads.length !== files.length) throw new Error("업로드 준비에 실패했어요. 다시 시도해 주세요.");
  try {
    const total = files.reduce((sum, f) => sum + f.size, 0);
    let sent = 0;
    for (let i = 0; i < files.length; i++) {
      const entry = grant.uploads[i];
      await sendFile(entry.url, files[i], entry.contentType, signal, loaded => progress(Math.min(100, Math.round((sent + loaded) / total * 100))));
      sent += files[i].size;
    }
    return grant.upload_ticket;
  } catch (error) { cleanupUpload(grant.upload_ticket); throw error; }
}
