# EasyApply

공고문을 쉬운 말로 정리하고, 사용자가 입력한 조건과 비교해 신청 준비 체크리스트를 만드는 Next.js 앱입니다. PDF·사진·HWP 5·HWPX를 받습니다. 신청을 대신 제출하거나 기관의 최종 자격 심사를 대체하지 않습니다.

운영 주소: **https://easyapply-five.vercel.app**. 2026-11-06 Vercel에서 OpenAI·공유 Redis를 연결하고 실제 PDF/HWPX 분석과 자격 확인·체크리스트 생성을 검증했습니다. 현재 전체 AI 호출은 24시간 100회, 동시 3회로 제한합니다. 검증 범위와 남는 제품 한계는 [PRODUCTION_AUDIT.md](PRODUCTION_AUDIT.md)에 기록했습니다.

## 로컬 실행

Node.js 22 이상이 필요합니다.

```sh
npm ci
cp .env.example .env.local # 이미 파일이 있으면 덮어쓰지 마세요
chmod 600 .env.local
# 편집기에서 OPENAI_API_KEY를 설정
npm run dev -- -p 3123
```

http://127.0.0.1:3123 에서 사용합니다. 개발 서버는 loopback에만 바인딩됩니다. 키를 명령줄 인자·소스 코드·채팅·스크린샷에 넣지 마세요. `.env.local`은 Git 및 Vercel 업로드에서 제외됩니다. 예제에는 빈 값만 유지하세요.

`auto`는 OpenAI 키, Anthropic 키, 개발 환경의 로컬 Claude Code 순서로 선택합니다. OpenAI 기본 모델은 `gpt-5.4`이며 실제 PDF/HWPX 호출을 검증했습니다. `EASYAPPLY_OPENAI_MODEL`로 변경할 수 있습니다. API 오류 시 다른 공급자로 몰래 재시도하지 않습니다. 로컬 Claude Code는 로그인된 CLI를 사용하며 Vercel에서는 실행되지 않습니다. 키가 없으면 미리 준비된 샘플을 체험할 수 있습니다.

## API와 처리 과정

- `GET /api/status`: 설정 상태·파일 한도 반환 및 HttpOnly 세션 발급. `configured`는 설정 확인이며 공급자 결제/장애 상태를 점검하는 호출은 아닙니다.
- `POST /api/session`: 선택적 이용 코드 확인. 로그인 시도 제한이 있습니다.
- `POST /api/analyze`: multipart `files`를 크기 제한 내에서 읽고 실제 파일 헤더를 확인합니다. PDF 텍스트 또는 한글 본문을 추출하고 AI 구조화 출력, 참조 ID, 날짜, 인용 페이지를 검증합니다. 분석 결과와 세션에 귀속된 서명 토큰을 돌려줍니다.
- `POST /api/match`: `analysis`, `analysis_token`, `answers`, `extra`를 받습니다. 변조한 분석 결과는 거절합니다. 샘플은 `sample:true`를 보내 서버에 있는 고정 분석을 사용합니다. 선택지·답변 형식을 검사한 뒤 판정합니다.

인용문은 공백 등 표기를 정규화한 뒤 원문 추출 텍스트와 비교합니다. 유사 일치와 정확 일치를 구분합니다. 원문을 확인하지 못한 자격 조건, 누락되거나 불확실한 답변은 서버에서 `check`로 제한합니다. 우대 순위 미충족은 필수 자격 탈락에 포함하지 않습니다. 모델이 빠뜨린 필수 서류와 제출 단계는 체크리스트에 보충합니다. 캘린더는 한국 시간, UTF-8 줄 접기 및 공고별 UID를 적용합니다.

파일·답변은 EasyApply DB에 저장하지 않습니다. 요청 처리 중 메모리에서 사용하고 AI 제공자에게 전송합니다. OpenAI 요청에는 `store:false`를 사용합니다. 제공자의 별도 보존 정책까지 '저장 안 함'으로 보장하지 않습니다. 로컬 CLI 모드의 임시 파일은 처리 후 지웁니다. 로그에는 요청 ID, 공급자, 지연, 사용량, 오류 코드만 남기고 원문·답변·키는 남기지 않습니다. 브라우저에는 체크리스트 완료 표시가 남습니다.

## 한글 문서 지원과 한계

| 형식 | 처리 | 제한 |
|---|---|---|
| PDF | 모델에 PDF 전달 + 서버 PDF.js 텍스트 대조 | 최대 100쪽, 추출 텍스트 20만 자 |
| JPG/PNG/WEBP/GIF | 이미지 전달 | 최대 10장. AI 판독문 내부 비교는 독립 원문 검증이 아닙니다 |
| HWP 5 | OLE 본문 레코드 추출 | 표 셀 관계·배치 손실 가능. 자격 조건을 확인 필요로 제한 |
| HWPX | ZIP 내부 section XML, 표 셀의 텍스트 추출 | 복잡한 병합 표의 의미 및 이미지 속 글자까지 보장하지 않음 |

한글 파일은 실제 쪽수를 알 수 없어 추출한 **구역**으로 표시합니다. 암호화·배포용 보호·손상·본문 없는 파일은 거절하며, 잘린 미리보기 텍스트로 성공한 척하지 않습니다. worker 메모리·실행 시간, ZIP 압축 해제량을 제한합니다. 이미지·도장·복잡한 표가 중요하면 PDF로 저장해 분석하는 것이 적합합니다. HWP는 공개 라이선스 실제 문서, HWPX는 표를 포함한 합성 공고로 검증했습니다. 다양한 실제 공공기관 서식의 정확도를 대표하는 벤치마크는 아닙니다.

## 운영 환경

Vercel 프로젝트 **Settings → Environment Variables**에 아래 값을 서버 전용으로 설정합니다. 키·토큰은 **Secret/Sensitive**, 범위는 필요한 환경만 선택하세요. `NEXT_PUBLIC_` 접두사는 금지합니다. 환경변수 변경 후 새 배포가 필요합니다.

| 변수 | 용도 |
|---|---|
| `OPENAI_API_KEY` | OpenAI 서버 호출 (또는 `ANTHROPIC_API_KEY`) |
| `EASYAPPLY_SIGNING_SECRET` | 32바이트 이상 무작위 서명 키 |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | 인스턴스 간 공유하는 호출량·동시 실행 저장소. Vercel Marketplace의 `KV_REST_API_URL` / `KV_REST_API_TOKEN` 쌍도 지원 |
| `EASYAPPLY_ACCESS_CODE` | 선택: 12자 이상 비공개 테스트 이용 코드 |
| `EASYAPPLY_DAILY_AI_LIMIT` | 전체 24시간 호출 상한, 기본 100 |
| `EASYAPPLY_MAX_CONCURRENT` | 전체 동시 AI 호출 상한, 기본 3 |
| `EASYAPPLY_APP_ORIGIN` | 자체 호스팅 운영 필수. 배포 도메인 origin |

요청 서명과 Redis가 빠진 운영 환경은 AI 기능을 닫습니다. Redis 장애 때도 제한을 풀지 않습니다. 기본적으로 같은 IP/세션은 10분에 분석 8회, 판정 24회, 세션별 동시 요청 1개입니다. 전체 24시간 상한에는 실패·취소도 포함하며 과금 금액 상한은 아닙니다. 공급자 측 예산·사용량 관리도 별도로 설정하세요. IP는 HMAC으로 변환한 값만 Redis에 사용합니다. Vercel 이외의 호스트는 신뢰할 프록시를 특정하지 않았으므로 IP 버킷을 공유합니다.

Vercel 업로드는 파일 합계 4 MiB, 자체 호스팅은 25 MiB입니다. multipart 오버헤드를 고려한 앱 제한입니다. [플랫폼의 요청 크기 제한](https://vercel.com/docs/functions/limitations) 때문에 대용량 파일은 별도의 직접 업로드 저장소가 필요합니다. 외부 URL에서 임의 파일을 받아오는 경로는 제공하지 않습니다. AI 호출은 기본 240초, API 함수는 최대 300초입니다.

```sh
npm run check:config                 # 키 값 없이 로컬 설정 점검
npm run check:config -- --production # Vercel 배포 필수 값 점검, 누락 시 exit 1
npm test
npm run lint
npm run typecheck
npm run build
npm audit --omit=dev
```

`tests/redis.test.ts`는 로컬 `redis-server`와 `redis-cli`가 있으면 실제 Redis의 Lua 원자성·동시성·장애 처리를 검사합니다. 없으면 그 테스트만 명시적으로 건너뜁니다. 나머지 자동 테스트는 유료 AI를 호출하지 않습니다.

실제 OpenAI 호출 검증은 서버를 실행한 뒤 `npx tsx scripts/smoke-live.ts --allow-paid`로 수행합니다. 합성 PDF 분석→서명된 판정→HWPX 분석을 호출하므로 비용이 발생합니다. 결과는 기본 `artifacts/live`에 저장됩니다. 실제 개인정보가 담긴 파일로 바꾸지 마세요.

독립 HTML의 `standalone/`은 기존 Claude 공유 페이지용 시연 코드입니다. 서버 세션·서명·공유 호출 제한이 있는 운영 앱은 Next.js 경로이며, 독립 HTML은 운영 배포에 포함하지 않습니다.

공식 문서: [OpenAI PDF 입력](https://developers.openai.com/api/docs/guides/file-inputs), [구조화 출력](https://developers.openai.com/api/docs/guides/structured-outputs), [Vercel 비밀 환경변수](https://vercel.com/docs/environment-variables/sensitive-environment-variables).
