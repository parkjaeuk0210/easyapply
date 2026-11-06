// EasyApply를 파일 하나(dist/EasyApply.html)로 묶는다. 먼저 `npm run build`로 CSS를 만들어 둘 것.
import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const r = await build({
  entryPoints: [path.join(root, "standalone/entry.tsx")],
  bundle: true,
  format: "iife",
  minify: true,
  write: false,
  platform: "browser",
  target: "es2022",
  jsx: "automatic",
  alias: { "next/dynamic": path.join(root, "standalone/next-dynamic.tsx") },
  loader: { ".css": "empty", ".pdf": "base64" },
  define: {
    "process.env.NODE_ENV": '"production"',
    "process.env": "{}",
    "import.meta.url": '"https://easyapply.local/"',
  },
  logLevel: "warning",
});
const js = r.outputFiles[0].text.replace(/<\/script/gi, "<\\/script").replace(/<!--/g, "<\\!--");

const index = fs.readFileSync(path.join(root, ".next/server/app/index.html"), "utf8");
const css = [...index.matchAll(/<link rel="stylesheet" href="(\/_next\/[^"]+\.css)"/g)]
  .map((m) => fs.readFileSync(path.join(root, ".next", m[1].replace("/_next/", "")), "utf8"))
  .join("\n");
if (!css) throw new Error("CSS를 찾지 못했어요. 먼저 npm run build 를 실행하세요.");

const html = `<!doctype html>
<html lang="ko" class="h-full">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>EasyApply — 공고문 쉽게 읽고 신청 준비까지</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css">
<style>${css}</style>
</head>
<body class="min-h-full antialiased">
<div id="root"></div>
<script>${js}</script>
</body>
</html>
`;
fs.mkdirSync(path.join(root, "dist"), { recursive: true });
const out = path.join(root, "dist/EasyApply.html");
fs.writeFileSync(out, html);
console.log(out, (html.length / 1024 / 1024).toFixed(2) + " MB");
