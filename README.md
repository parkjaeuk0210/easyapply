# EasyApply — AI 공고문 이해 · 맞춤형 신청 도우미

청년 지원사업·장학금·정부 지원제도 공고문(PDF/사진)을 올리면

1. **쉽게 정리** — 신청 자격, 제출 서류, 마감일, 주의 사항, 어려운 용어를 쉬운 말로 정리하고
2. **내 조건과 비교** — 공고문에 맞춰 만든 질문(나이·거주지·소득 등)에 답하면 조건마다 `충족 / 확인 필요 / 미충족`을 알려주고
3. **체크리스트** — 내 상황에 맞는 준비 체크리스트(서류 발급처, 기한, D-day)를 만들어 줍니다. 캘린더(.ics)·복사·인쇄 지원.
4. **원문 근거** — 모든 설명 옆의 `원문 N쪽` 버튼을 누르면 공고문 원문에서 해당 문장을 찾아 하이라이트합니다.
   AI가 인용한 문장을 실제 PDF 텍스트와 자동 대조해서 `✓ 일치 / ≈ 비슷 / ? 못 찾음`을 표시하므로, AI가 지어낸 근거를 바로 걸러낼 수 있어요.

## 실행

```bash
npm install
npm run dev        # http://localhost:3000
```

첫 화면의 **샘플 공고문으로 먼저 체험하기**는 AI 연결 없이도 모든 기능을 보여줍니다(미리 분석해 둔 결과).

### AI 연결

| 방법 | 설정 | 비고 |
|---|---|---|
| Anthropic API | `.env.local`에 `ANTHROPIC_API_KEY=...` | 배포용. 분석 30초~2분 |
| 로컬 Claude Code | 설정 없음 — `claude`가 설치·로그인돼 있으면 자동 사용 | 키 없이 내 컴퓨터에서만. 분석 1~2분 |
| 없음 | — | 샘플 체험만 가능 |

그 밖의 설정은 `.env.example` 참고 (`EASYAPPLY_EFFORT`, `EASYAPPLY_MODEL`, `EASYAPPLY_PROVIDER`).

## 구조

```
src/
  app/
    page.tsx                 화면 진입점
    api/analyze/route.ts     공고문(PDF 1개 또는 이미지 ≤10장) → 구조화된 분석 결과
    api/match/route.ts       분석 결과 + 사용자 답변 → 조건별 판정 + 체크리스트
    api/status/route.ts      현재 AI 연결 방식
  lib/
    schema.ts                분석/판정 결과 스키마(zod) → 구조화 출력 JSON Schema
    prompts.ts               분석·판정 프롬프트
    llm.ts                   Claude 호출 (API: 스트리밍 + 구조화 출력 / 로컬: claude -p --json-schema)
    textmatch.ts             AI 인용문 ↔ 원문 텍스트 대조, 하이라이트 위치 계산
    dates.ts                 D-day, 캘린더(.ics) 내보내기
  components/
    EasyApp.tsx              화면 흐름(업로드 → 분석 → 결과)
    AnalysisPanels.tsx       한눈에 보기 / 자격 / 서류 / 주의 / 용어
    ProfileCheck.tsx         내 조건 입력 → 판정 결과 + 체크리스트
    SourceViewer.tsx         원문 뷰어(PDF.js 텍스트 레이어 하이라이트, 이미지 + AI 판독 텍스트)
public/samples/              시연용 가상 공고문 PDF와 미리 분석한 결과
samples-src/notice.html      샘플 공고문 원본(HTML → PDF)
```

## 동작 방식

- **분석**: PDF는 Claude가 텍스트와 페이지 이미지를 함께 읽습니다(표·스캔본 포함). 결과는 JSON Schema로 강제된 구조화 출력이라 화면이 깨지지 않습니다.
  모든 항목에는 `{page, quote}` 근거가 붙고, quote는 원문 글자 그대로 인용하도록 지시합니다.
- **근거 대조**: 브라우저에서 PDF.js로 원문 텍스트를 뽑아 quote를 찾습니다(띄어쓰기·전각문자 차이 무시, 실패 시 부분 일치).
  찾은 위치는 텍스트 레이어에서 해당 구절만 하이라이트합니다. 사진은 AI가 옮겨 적은 판독 텍스트와 대조합니다.
- **판정**: 파일을 다시 보내지 않고 분석 결과 + 답변만 보내 빠르고 저렴합니다. 애매하면 `확인 필요`로 두도록 지시해서 "틀린 충족"을 줄였습니다.
- **개인정보**: 업로드 파일과 답변은 서버에 저장하지 않습니다(로컬 Claude Code 모드는 임시 폴더에 쓴 뒤 바로 삭제). 체크리스트 완료 표시만 브라우저 localStorage에 남습니다.

## 한계

- 아이폰 HEIC 사진은 아직 미지원(JPG/PNG로 저장 후 업로드).
- 글자 레이어가 없는 스캔 PDF는 자동 대조가 안 되고, 해당 쪽으로 이동만 합니다.
- AI 판정은 참고용입니다. 최종 자격은 기관 심사로 결정됩니다.
- Vercel은 요청 본문을 약 4.5MB까지만 받습니다. 그래서 배포 환경(`VERCEL=1`)에서는 업로드 한도를 4MB로 잡고,
  사진은 브라우저에서 전체 4MB 안으로 자동 압축하며, 4MB가 넘는 PDF는 업로드 전에 안내 문구로 막습니다.
  큰 PDF까지 받으려면 스토리지(Vercel Blob 등)에 먼저 올린 뒤 서버에서 가져오는 방식이 필요합니다.
  분석 요청은 최대 5분(`maxDuration = 300`)으로 잡혀 있습니다.

## Vercel 배포

```bash
vercel deploy --prod                       # API 키 없이 올리면 '체험판'(샘플만)으로 동작
vercel env add ANTHROPIC_API_KEY production # 키를 넣고
vercel deploy --prod                       # 다시 배포하면 새 공고문 분석이 켜집니다
```

키를 넣으면 주소를 아는 누구나 분석을 돌릴 수 있고 비용은 키 주인에게 청구됩니다.
공개 전에는 Anthropic 콘솔에서 월 사용 한도를 걸어 두세요.
