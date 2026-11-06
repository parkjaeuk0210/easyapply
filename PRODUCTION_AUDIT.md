# EasyApply 백엔드 점검 및 수정 결과

점검일: 2026-11-06. 대상: `/Users/online/easyapply`의 Next.js 앱.

## 현재 결론

OpenAI API로 실제 PDF 분석 → 서명된 결과 기반 자격 판정 → 체크리스트 생성이 동작합니다. HWPX도 본문 추출 → 실제 OpenAI 분석 → 브라우저 원문 표시까지 확인했습니다. HWP 5는 실제 공개 문서의 본문 추출을 검증했습니다.

**Vercel 공개 운영 전환과 배포 서버의 실제 AI 호출 검증을 완료했습니다.** 운영 주소는 https://easyapply-five.vercel.app 입니다. 기존 `easyapply` 프로젝트에 서버 비밀 환경변수와 무료 Upstash Redis를 연결하고, 검증한 Production 배포 `dpl_o1MRJKuwRE9h6GqxxvUkRhdzJaSx`를 기존 도메인으로 승격했습니다.

해당 배포에서 실제 PDF 분석 → 서명된 분석 기반 자격 확인·체크리스트 → HWPX 분석을 확인했습니다. 승격 후 공개 주소에서도 HWPX를 다시 업로드해 OpenAI 응답을 확인했습니다. 초기 운영 한도는 분석·판정 합계 24시간 100회, 동시 3회이며, 대규모 동시 접속이나 다양한 실제 공고의 정확도 검증을 완료했다는 의미는 아닙니다.

## 주요 발견과 수정

| 중요도 | 기존 문제 / 영향 | 수정과 관련 코드 |
|---|---|---|
| 높음 | 운영 API에 공유 호출 한도·동시 실행 통제가 없어 키 비용을 소진할 수 있음 | `server/guard.ts`: Redis 원자적 Lua 예약, 세션/IP별 한도, 전체 24시간 상한, 동시 실행 및 장애 시 차단 |
| 높음 | `/api/match`가 클라이언트가 보낸 분석을 그대로 신뢰 | `server/tokens.ts`: 분석 해시·세션·만료·근거 신뢰도를 HMAC 서명. 변조·다른 세션 재사용 거절 |
| 높음 | 입력 형식만 맞으면 AI의 잘못된 판정·참조를 그대로 사용 | `server/validation.ts`: 중복/외부 ID, 누락된 조건, 잘못된 날짜/선택지 검사. 빈 답변·불확실한 근거는 확인 필요. 우대 순위는 필수 자격 탈락에서 제외 |
| 높음 | 본문 파싱 후 파일 크기를 확인하고, 오류·취소 처리가 불완전 | `server/http.ts`, `uploads.ts`, `llm.ts`: 스트림 단계 용량 제한, 실제 파일 헤더, 처리 시간/출력 한도, 중단 신호, 비밀이 제거된 오류 응답 |
| 높음 | 로컬 CLI가 일반 파일 읽기 권한과 주변 설정을 상속 | `llm.ts`: 제한 모드, 정확한 임시 파일만 Read 허용, MCP/설정 비활성화, stdin으로 입력 전달, 세션 저장 금지, 종료 후 임시 파일 삭제. Vercel에서 CLI 차단 |
| 중간 | OpenAI 연결 부재, 한글 파일 미지원 | OpenAI Responses 구조화 출력 및 `store:false`; HWP 5 OLE 본문/HWPX XML 추출 worker 추가 |
| 중간 | 비슷한 인용과 AI 자체 판독문을 독립 검증처럼 표시 | 정확/유사 일치를 분리. 이미지 판독문 내부 대조임을 명시. 서버 검증 결과가 판정 제한에 반영됨 |
| 중간 | 브라우저의 127.0.0.1 origin과 Next.js 내부 localhost URL 불일치 | 실제 브라우저 업로드에서 재현 후 검증된 Host와 origin 비교로 수정. 교차 origin 거절 회귀 테스트 포함 |
| 중간 | 분석 중 재업로드/취소, 낡은 완료 표시·원문 위치 캐시 문제 | 클라이언트 AbortController, 요청 순서 검사, 공고/체크리스트 내용 기반 저장 키, 원문 인덱스별 위치 계산 |
| 중간 | 다른 공고 캘린더 UID 충돌 및 잘못된 일정 형식 | 한국 시간→UTC, 종료 시간이 시작 이후인 일정, UTF-8 75바이트 줄 접기, 줄바꿈 이스케이프와 공고별 UID |
| 높음 | 첫 Vercel 검증에서 정상 PDF가 `invalid_pdf`로 거절됨. 배포 추적 목록에 PDF.js worker·네이티브 canvas 누락 | `next.config.ts`: 해당 런타임 파일을 `/api/analyze` 추적에 포함. 재배포 후 실제 PDF 분석 성공 |
| 중간 | Vercel Marketplace가 제공하는 Redis 환경변수 이름과 앱 설정 이름이 다름 | `server/config.ts`: `KV_REST_API_URL` / `KV_REST_API_TOKEN` 지원. 서로 다른 연결의 URL과 토큰을 섞지 않으며 불완전한 명시 설정은 차단 |

서버 모듈 경로는 `src/lib/` 기준이며 `next.config.ts`는 프로젝트 루트에 있습니다. 운영 안내와 환경변수 목록은 [README](README.md), 빈 환경변수 양식은 [.env.example](.env.example)에 있습니다.

## 실제 검증 결과

| 검증 | 결과 / 범위 |
|---|---|
| 자동 테스트 | 31개 통과, 실패/생략 0. 서명·입력·원문·한글·로그인·운영 설정·실제 Redis Lua 동시성/장애·OpenAI SDK 요청 형식·캘린더·Marketplace Redis 설정 |
| `npm run lint` / `npm run typecheck` | 통과 |
| `npm run build` | 통과. 정적 화면과 4개 동적 API 생성 |
| `npm audit --omit=dev` | 운영 의존성 취약점 0 |
| 전체 의존성 감사 | 개발 도구의 minimatch 및 관련 ESLint 의존성에 moderate 8개. 운영 의존성에는 없음. 권장 자동 수정은 Next ESLint 설정의 major downgrade여서 적용하지 않음 |
| OpenAI 실제 PDF 분석 | 합성 2쪽 공고, 약 61초. 인용 75개 정확 일치, 누락/유사/미검증 0 |
| OpenAI 실제 판정 | 위 분석과 서명 토큰 사용. 답변을 비워 13개 조건 모두 확인 필요, 체크리스트 12개 반환 |
| OpenAI 실제 HWPX 분석 | 표를 포함한 합성 공고. 약 11초. 인용 8개 일치 |
| 실제 브라우저 HWPX 업로드 | 같은 합성 파일 업로드, 약 13초. HTTP 200, 분석/원문 구역/8개 일치 표시 확인 |
| 실제 HWP 5 추출 | hwp.js의 Apache-2.0 공개 fixture 345KB에서 본문 2천 자 이상 추출. 미리보기 대신 본문 사용 |
| 로컬 Claude PDF | 실제 분석 약 84초, 인용 53개 일치. 제한 CLI 옵션을 포함한 추가 JSON 호출도 성공 |
| 화면 확인 | 샘플 열기, PDF 원문 하이라이트, 예시 답변→체크리스트, 실제 HWPX 업로드→결과 표시 |
| 배포 파일 추적 | 분석 함수 추적 목록에 한글 worker, @mdgate/containers, PDF.js 포함 |
| 비밀 값 검사 | 소스/정적 번들/빌드/검증 파일에서 실제 API 키와 서명 키 발견 0. 로컬 환경파일 권한 0600 |
| Vercel 운영 빌드 | 성공. PDF.js worker 및 네이티브 canvas를 포함한 Linux 배포 |
| Vercel 실제 PDF 분석 | HTTP 200, 약 65초. 인용 78개 정확 일치, 누락/유사/미검증 0 |
| Vercel 실제 자격 확인 | HTTP 200, 약 29초. 빈 답변의 16개 조건 모두 확인 필요, 체크리스트 12개 |
| Vercel 실제 HWPX 분석 | HTTP 200, 약 13초. 합성 공고 본문과 표 추출, 인용 11개 정확 일치 |
| Vercel 요청 차단 | 세션 없음 401, 외부 origin 403, 변조 서명 409. 정상 요청에서는 운영 Redis 제한을 거쳐 실제 AI 호출 성공 |
| 공개 주소 전환 후 재검증 | 페이지와 JS 8개 HTTP 200, 실제 키·서명 키 일치 0. OpenAI ready 상태, HWPX 실제 분석 약 10초·인용 8개 일치 |

실제 호출은 고정 결과 재생과 구분해 수행했습니다. 브라우저의 예시 답변은 기존 데모 결과임을 별도로 표시합니다. 실제 문서/모델 응답에 따라 인용 수, 지연, 정확도는 달라집니다. 이는 전 분야 공고의 정확도를 보장하는 평가가 아닙니다.

증거 파일: `/Users/online/reports/easyapply-production-20261106/` 안의 `tests.log`, `build.log`, `audit-production.json`, `audit-all.json`, `openai-live.log`, `openai-pdf-analysis.json`, `openai-pdf-match.json`, `openai-hwpx-analysis.json`, `dev.log`, `cli-restricted.log`, `secret-scan.json`.

운영 배포 증거: 같은 폴더의 `deployment-tests.log`, `vercel-build-final.log`, `vercel-verification.json`, `vercel-pdf-analysis.json`, `vercel-pdf-match.json`, `vercel-hwpx-analysis.json`, `promotion.json`, `public-verification.json`, `public-hwpx-analysis.json`, `release.json`. 분석 증거에는 세션 쿠키와 서명 토큰을 저장하지 않았습니다.

## 운영 배포와 현재 설정

1. `OPENAI_API_KEY`와 `EASYAPPLY_SIGNING_SECRET`를 Vercel Production의 Secret 환경변수로 등록했습니다. 모델은 OpenAI `gpt-5.4`입니다.
2. Vercel Marketplace의 `easyapply-rate-limit` Upstash Redis를 Production에 연결했습니다. Free 플랜이며 `autoUpgrade=false`, `prodPack=false`입니다. 주입된 `KV_REST_API_URL` / `KV_REST_API_TOKEN`을 서버에서 사용합니다.
3. 이용 코드 없이 세션을 발급하는 공개 서비스입니다. 전체 24시간 100회·동시 3회와 IP/세션별 한도를 적용합니다. 이는 OpenAI 과금 금액 상한과는 다릅니다.
4. 운영 설정과 실제 Redis 경로는 배포 서버의 성공한 API 호출로 검증했습니다. 기존 로컬 `.env.local`에는 운영 Redis 자격증명을 내려받지 않았으므로 로컬 `--production` 점검은 여전히 저장소 누락을 표시할 수 있습니다.
5. 검증한 배포를 기존 공개 도메인으로 승격했습니다. Git 저장소 연결 없이 Vercel CLI로 배포했으므로 이후 소스 변경이 자동 배포되지는 않습니다.

채팅에 기재한 키는 대화에서 회수할 수 없습니다. 키 재발급 시 Vercel Production Secret과 로컬 환경파일을 갱신하고 재배포해야 합니다. 키를 `NEXT_PUBLIC_` 변수·브라우저 JS·Git에 넣지 않습니다. 실제 환경파일·테스트 자료·독립 HTML 결과는 Vercel 업로드에서 제외했습니다.

## 남는 제품 한계

- HWP의 복잡한 표, HWPX의 병합 셀 의미, 그림·스캔 속 글자와 도장은 완전 인식을 보장하지 않습니다. HWP와 이미지가 포함된 한글 문서의 조건은 확인 필요로 제한합니다. 중요한 레이아웃은 PDF 변환 후 다시 확인해야 합니다.
- 같은 AI가 읽은 이미지 판독문은 독립적인 원문 검증 자료가 아닙니다. 독립 텍스트가 없는 조건은 자동으로 충족 판정하지 않습니다.
- 이용 코드는 공유 접근 통제이며 개별 회원 계정/권한 관리 시스템은 아닙니다. 현재 제품은 문서/답변을 DB에 보관하지 않는 단일 분석 흐름입니다.
- 4 MiB를 넘는 Vercel 업로드, 장기 작업 큐, 사용자별 분석 내역 보관은 구현 범위에 포함하지 않았습니다.
- 개인정보 처리 고지의 운영자 정보·실제 서비스 정책은 공개 운영 주체가 확정해야 합니다. AI 제공자 전송 사실과 앱 자체 저장 범위는 화면/README에 표시했습니다.

기존 폴더에 Git 메타데이터가 없어 커밋은 만들지 않았습니다. 수정 전 소스는 위 증거 폴더의 `before/`에 보존했습니다. 사용자의 환경파일은 이 백업에 포함하지 않았습니다.
