// 단일 HTML 진입점: pdf.js를 별도 워커 파일 없이 같은 스레드에서 돌리고, 서버 대신 backend.ts가 응답한다.
import * as pdfjsWorker from "pdfjs-dist/build/pdf.worker.min.mjs";
import { createRoot } from "react-dom/client";
import EasyApp from "@/components/EasyApp";
import { installBackend } from "./backend";

(globalThis as unknown as { pdfjsWorker: unknown }).pdfjsWorker = pdfjsWorker;
installBackend();
createRoot(document.getElementById("root")!).render(<EasyApp />);
