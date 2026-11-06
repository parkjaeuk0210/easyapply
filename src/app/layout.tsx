import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "EasyApply — 공고문 쉽게 읽고 신청 준비까지",
  description:
    "청년 지원사업·장학금·정부 지원 공고문을 올리면 AI가 쉬운 말로 정리하고, 내 조건과 비교해 신청 준비 체크리스트를 만들어 줘요. 모든 내용에 공고문 원문 근거를 함께 보여줘요.",
};

export const viewport: Viewport = {
  themeColor: "#2f5be7",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko" className="h-full">
      <head>
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css"
        />
      </head>
      <body className="min-h-full antialiased">{children}</body>
    </html>
  );
}
