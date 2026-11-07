# EasyApply 백엔드 점검 및 수정 결과

점검일: 2026-11-06. 대상: `/Users/online/easyapply`의 Next.js 앱.

## 현재 운영 상태 (2026-11-07 09:20 KST 기준)

이 절만 현재 사실입니다. 아래 절들은 작성 당시의 기록이며 그 안의 OpenAI 모델·테스트 수·한도 수치는 당시 값입니다.

- 배포: 공개 주소 https://easyapply-five.vercel.app 은 Production `dpl_AqPskTwmhsxq8SyreEziJjVm7Z5p`(11-07 01:46:41 생성, 01:47 승격)를 가리킵니다. 소스는 00:36 배포 `dpl_5eQuXZrXd5P6SaEsGtDUjqkmvXBC`의 소스에 첫 화면 중간안(`src/components/EasyApp.tsx`만 변경)을 더한 `release-landing` 브랜치(태그 `prod-20261107-0146`)입니다. 승격 전 확인: 테스트 112/112, 타입체크, 린트, 상태 API configured, 첫 화면 HTML에 태그줄 포함·제공자 배지 없음. 승격 직후 공개 주소에서 실제 공고(화성 PDF)로 분석 200(40.1초)·판정 200(9.4초), 페이지 오류 0건. main의 서버 결함 수리분은 3차 수리(`42df683`: 접수 상태 단일 출처, 마감 추정·연령 계산 제거, 날짜는 틀리면 비우기, 체크리스트 순서·날짜 보정 제거)와 AI 고지 복원(`f700f89`)까지 반영됐고 테스트 204개·사전 점검(비공개 배포 `dpl_9QksExg9LBByyYwaycmKRjsgLuu7`)을 통과했지만, 09:05 독립 재검토(Codex)가 마감 판정 경로의 결함 7건(인용과 다른 날짜 채택, 같은 날 후속 회차 무시, 상시 모집 시작일 종료 처리, 근거 없는 시각 유지, 접수 미확정인데 신청 가능 표현, 분석 뒤 마감 경과 미반영, 원문에 없는 서류 날짜 통과)을 실제 함수 실행으로 재현해 보류로 판정했으므로 수정 전까지 배포하지 않습니다. 검토 기록: `reports/easyapply-eval-20261107/round3-0900/REVIEW3-codex.md`. 되돌리기: `vercel promote https://easyapply-58d14v5vm-feras-projects-59a977f0.vercel.app`(00:36 빌드).
- AI: Anthropic API `claude-opus-5-5`, 추론 `medium`, 처리 속도 `fast`(23:00 상태 API `provider:"api"`, `ready:true`). Production에는 `OPENAI_API_KEY`와 OpenAI 설정 3개도 남아 있지만 `EASYAPPLY_PROVIDER=api`라 사용하지 않습니다.
- 호출 한도: **해제**(`usage_limits_enabled:false`). Production에 `EASYAPPLY_USAGE_LIMITS`, `EASYAPPLY_DAILY_IP_AI_LIMIT`, `EASYAPPLY_DAILY_SESSION_AI_LIMIT`, `EASYAPPLY_ACCESS_CODE`가 없어 이용 코드 없이 세션을 받고, Redis로 같은 세션의 중복 실행만 막습니다. 켜려면 `EASYAPPLY_USAGE_LIMITS=on`을 추가하고 재배포합니다. 이때 IP·세션별 10분당 분석 8회·판정 24회는 코드 고정값(`src/lib/server/guard.ts`의 `quota()`)이라 같은 Wi-Fi의 심사위원들이 함께 걸릴 수 있습니다. 전체 일일·동시 한도는 등록된 `EASYAPPLY_DAILY_AI_LIMIT`·`EASYAPPLY_MAX_CONCURRENT` 값을, IP·세션별 24시간 한도는 기본 20회를 따릅니다.
- 업로드·형식: 합계 상한은 공급자별(Anthropic 22 MiB, OpenAI·로컬 24 MiB), 함수 직접 전송 4 MiB, 초과분은 비공개 Blob(`large_uploads:true`). PDF·HWP·HWPX·JPG·PNG·WEBP·GIF.
- 검증: `npm test`, `npm run typecheck`(`next typegen && tsc --noEmit`), `npm run lint`. 변경 내용은 맨 아래 [Claude 전환과 후속 수정](#claude-opus-55-운영-전환과-후속-수정-2220-이후)에 있습니다.

## 초기 결론 (OpenAI 운영 당시)

OpenAI API로 실제 PDF 분석 → 서명된 결과 기반 자격 판정 → 체크리스트 생성이 동작합니다. HWPX도 본문 추출 → 실제 OpenAI 분석 → 브라우저 원문 표시까지 확인했습니다. HWP 5는 실제 공개 문서의 본문 추출을 검증했습니다.

**Vercel 공개 운영 전환과 배포 서버의 실제 AI 호출 검증을 완료했습니다.** 운영 주소는 https://easyapply-five.vercel.app 입니다. 기존 `easyapply` 프로젝트에 서버 비밀 환경변수와 무료 Upstash Redis를 연결하고, 검증한 Production 배포 `dpl_WZP5iqrCXPdVamkkEyZcw5UEAFTQ`를 기존 도메인으로 승격했습니다.

해당 배포에서 실제 PDF 분석 → 서명된 분석 기반 자격 확인·체크리스트 → HWPX 분석을 확인했습니다. 승격 후 공개 주소에서도 HWPX를 다시 업로드해 OpenAI 응답을 확인했습니다. 당시 운영 한도는 분석·판정 합계 24시간 100회, 동시 3회였으며(현재는 해제), 대규모 동시 접속이나 다양한 실제 공고의 정확도 검증을 완료했다는 의미는 아닙니다.

## 주요 발견과 수정

| 중요도 | 기존 문제 / 영향 | 수정과 관련 코드 |
|---|---|---|
| 높음 | 운영 API에 공유 호출 한도·동시 실행 통제가 없어 키 비용을 소진할 수 있음 | `server/guard.ts`: Redis 원자적 Lua 예약, 세션/IP별 한도, 전체 24시간 상한, 동시 실행 및 장애 시 차단. 22:48 이후 한도는 `EASYAPPLY_USAGE_LIMITS=on`일 때만 적용 |
| 높음 | `/api/match`가 클라이언트가 보낸 분석을 그대로 신뢰 | `server/tokens.ts`: 분석 해시·세션·만료·근거 신뢰도를 HMAC 서명. 변조·다른 세션 재사용 거절 |
| 높음 | 입력 형식만 맞으면 AI의 잘못된 판정·참조를 그대로 사용 | `server/validation.ts`: 중복/외부 ID, 누락된 조건, 잘못된 날짜/선택지 검사. 빈 답변·불확실한 근거는 확인 필요. 우대 순위는 필수 자격 탈락에서 제외 |
| 높음 | 본문 파싱 후 파일 크기를 확인하고, 오류·취소 처리가 불완전 | `server/http.ts`, `uploads.ts`, `llm.ts`: 스트림 단계 용량 제한, 실제 파일 헤더, 처리 시간/출력 한도, 중단 신호, 비밀이 제거된 오류 응답 |
| 높음 | 로컬 CLI가 일반 파일 읽기 권한과 주변 설정을 상속 | `llm.ts`: 제한 모드, 정확한 임시 파일만 Read 허용, MCP/설정 비활성화, stdin으로 입력 전달, 세션 저장 금지, 종료 후 임시 파일 삭제. Vercel에서 CLI 차단 |
| 중간 | OpenAI 연결 부재, 한글 파일 미지원 | OpenAI Responses 구조화 출력 및 `store:false`; HWP 5 OLE 본문/HWPX XML 추출 worker 추가 |
| 중간 | 비슷한 인용과 AI 자체 판독문을 독립 검증처럼 표시 | 정확/유사 일치를 분리. 이미지에는 ‘원문 확인 필요’와 원본 사진 확인 안내를 표시하며 내부 일치 비율을 숨김. 서버 검증 결과가 판정 제한에 반영됨 |
| 중간 | 브라우저의 127.0.0.1 origin과 Next.js 내부 localhost URL 불일치 | 실제 브라우저 업로드에서 재현 후 검증된 Host와 origin 비교로 수정. 교차 origin 거절 회귀 테스트 포함 |
| 중간 | 분석 중 재업로드/취소, 낡은 완료 표시·원문 위치 캐시 문제 | 클라이언트 AbortController, 요청 순서 검사, 공고/체크리스트 내용 기반 저장 키, 원문 인덱스별 위치 계산 |
| 중간 | 다른 공고 캘린더 UID 충돌 및 잘못된 일정 형식 | 한국 시간→UTC, 종료 시간이 시작 이후인 일정, UTF-8 75바이트 줄 접기, 줄바꿈 이스케이프와 공고별 UID |
| 높음 | 첫 Vercel 검증에서 정상 PDF가 `invalid_pdf`로 거절됨. 배포 추적 목록에 PDF.js worker·네이티브 canvas 누락 | `next.config.ts`: 해당 런타임 파일을 `/api/analyze` 추적에 포함. 재배포 후 실제 PDF 분석 성공 |
| 중간 | Vercel Marketplace가 제공하는 Redis 환경변수 이름과 앱 설정 이름이 다름 | `server/config.ts`: `KV_REST_API_URL` / `KV_REST_API_TOKEN` 지원. 서로 다른 연결의 URL과 토큰을 섞지 않으며 불완전한 명시 설정은 차단 |

서버 모듈 경로는 `src/lib/` 기준이며 `next.config.ts`는 프로젝트 루트에 있습니다. 운영 안내와 환경변수 목록은 [README](README.md), 빈 환경변수 양식은 [.env.example](.env.example)에 있습니다.

## 실제 검증 결과 (OpenAI 운영 당시)

| 검증 | 결과 / 범위 |
|---|---|
| 자동 테스트 | 당시 39개 통과, 실패/생략 0. 서명·입력·원문·한글·로그인·운영 설정·실제 Redis Lua 동시성/장애·OpenAI SDK 요청 형식·캘린더·Marketplace Redis 설정 |
| `npm run lint` / `npm run typecheck` | 통과 |
| `npm run build` | 통과. 정적 화면과 6개 API 생성 |
| `npm audit --omit=dev` | 운영 의존성 취약점 0 |
| 전체 의존성 감사 | 개발 도구의 minimatch 및 관련 ESLint 의존성에 moderate 8개. 운영 의존성에는 없음. 권장 자동 수정은 Next ESLint 설정의 major downgrade여서 적용하지 않음 |
| OpenAI 실제 PDF 분석 | 합성 2쪽 공고, 약 61초. 인용 75개 정확 일치, 누락/유사/미검증 0 |
| OpenAI 실제 판정 | 위 분석과 서명 토큰 사용. 답변을 비워 13개 조건 모두 확인 필요, 체크리스트 12개 반환 |
| OpenAI 실제 HWPX 분석 | 표를 포함한 합성 공고. 약 11초. 인용 8개 일치 |
| 실제 브라우저 HWPX 업로드 | 같은 합성 파일 업로드, 약 13초. HTTP 200, 분석/원문 구역/8개 일치 표시 확인 |
| 실제 HWP 5 추출 | hwp.js의 Apache-2.0 공개 fixture 345KB에서 본문 2천 자 이상 추출. 미리보기 대신 본문 사용 |
| 로컬 Claude PDF | 실제 분석 약 84초, 인용 53개 일치. 제한 CLI 옵션을 포함한 추가 JSON 호출도 성공 |
| 화면 확인 | 초기 HWPX 실제 업로드 검증에 이어 WebKit iPhone 13 환경에서 실제 24.3 MiB PDF 업로드·분석·원문 2쪽 렌더링 확인. 샘플 버튼/예시 답변 제거 |
| 배포 파일 추적 | 분석 함수 추적 목록에 한글 worker, @mdgate/containers, PDF.js 포함 |
| 비밀 값 검사 | 소스/정적 번들/빌드/검증 파일에서 실제 API 키와 서명 키 발견 0. 로컬 환경파일 권한 0600 |
| Vercel 운영 빌드 | 성공. PDF.js worker 및 네이티브 canvas를 포함한 Linux 배포 |
| Vercel 실제 PDF 분석 | HTTP 200, 약 65초. 인용 78개 정확 일치, 누락/유사/미검증 0 |
| Vercel 실제 자격 확인 | HTTP 200, 약 29초. 빈 답변의 16개 조건 모두 확인 필요, 체크리스트 12개 |
| Vercel 실제 HWPX 분석 | HTTP 200, 약 13초. 합성 공고 본문과 표 추출, 인용 11개 정확 일치 |
| Vercel 요청 차단 | 세션 없음 401, 외부 origin 403, 변조 서명 409. 정상 요청에서는 운영 Redis 제한을 거쳐 실제 AI 호출 성공 |
| 공개 주소 전환 후 재검증 | 페이지와 JS 8개 HTTP 200, 실제 키·서명 키 일치 0. OpenAI ready 상태, HWPX 실제 분석 약 10초·인용 8개 일치 |

실제 호출은 고정 결과 재생과 구분해 수행했습니다. 브라우저의 샘플 체험·예시 답변과 서버의 sample 플래그 우회 경로를 제거했습니다. 합성 자료는 공개 경로에서 tests/fixtures/samples로 이동했습니다. 실제 문서/모델 응답에 따라 인용 수, 지연, 정확도는 달라집니다. 이는 전 분야 공고의 정확도를 보장하는 평가가 아닙니다.

증거 파일: `/Users/online/reports/easyapply-production-20261106/` 안의 `tests.log`, `build.log`, `audit-production.json`, `audit-all.json`, `openai-live.log`, `openai-pdf-analysis.json`, `openai-pdf-match.json`, `openai-hwpx-analysis.json`, `dev.log`, `cli-restricted.log`, `secret-scan.json`.

운영 배포 증거: 같은 폴더의 `deployment-tests.log`, `vercel-build-final.log`, `vercel-verification.json`, `vercel-pdf-analysis.json`, `vercel-pdf-match.json`, `vercel-hwpx-analysis.json`, `promotion.json`, `public-verification.json`, `public-hwpx-analysis.json`, `release.json`. 분석 증거에는 세션 쿠키와 서명 토큰을 저장하지 않았습니다.

## 운영 배포와 설정 (OpenAI 운영 당시)

1. `OPENAI_API_KEY`와 `EASYAPPLY_SIGNING_SECRET`를 Vercel Production의 Secret 환경변수로 등록했습니다. 당시 모델은 OpenAI `gpt-6-astra`, 추론 `medium`, 처리 등급 `fast`였고 분석과 자격 확인 모두에 적용했습니다. 22:27부터는 Anthropic `claude-opus-5-5`를 사용합니다.
2. Vercel Marketplace의 `easyapply-rate-limit` Upstash Redis를 Production에 연결했습니다. Free 플랜이며 `autoUpgrade=false`, `prodPack=false`입니다. 주입된 `KV_REST_API_URL` / `KV_REST_API_TOKEN`을 서버에서 사용합니다.
3. 이용 코드 없이 세션을 발급하는 공개 서비스입니다. 당시에는 전체 24시간 100회·동시 3회와 IP/세션별 한도를 적용했습니다. 22:48 코드 변경 이후 이 한도는 `EASYAPPLY_USAGE_LIMITS=on`일 때만 적용되며 현재 운영은 해제 상태입니다. 어느 경우든 공급자 과금 금액 상한과는 다릅니다.
4. 운영 설정과 실제 Redis 경로는 배포 서버의 성공한 API 호출로 검증했습니다. 기존 로컬 `.env.local`에는 운영 Redis 자격증명을 내려받지 않았으므로 로컬 `--production` 점검은 여전히 저장소 누락을 표시할 수 있습니다.
5. 검증한 배포를 기존 공개 도메인으로 승격했습니다. Git 저장소 연결 없이 Vercel CLI로 배포했으므로 이후 소스 변경이 자동 배포되지는 않습니다.

채팅에 기재한 키는 대화에서 회수할 수 없습니다. 키 재발급 시 Vercel Production Secret과 로컬 환경파일을 갱신하고 재배포해야 합니다. 키를 `NEXT_PUBLIC_` 변수·브라우저 JS·Git에 넣지 않습니다. 실제 환경파일·테스트 자료·독립 HTML 결과는 Vercel 업로드에서 제외했습니다.

## 남는 제품 한계

- HWP의 복잡한 표, HWPX의 병합 셀 의미, 그림·스캔 속 글자와 도장은 완전 인식을 보장하지 않습니다. HWP 파일, 그리고 이미지나 해석할 수 없는 병합 표가 있는 HWPX는 답변과 관계없이 모든 자격 조건을 '확인 필요'로 제한합니다. 중요한 레이아웃은 PDF 변환 후 다시 확인해야 합니다.
- 형식 위반(시각 "24:00", 개수·길이 초과, 빈 인용, 대문자 ID, 총 쪽수를 넘는 쪽 번호)은 서버가 결정적으로 고칩니다(`src/lib/server/repair.ts`). 그래도 스키마나 서버 검증에 걸리거나 공급자 일시 오류(429·5xx·529·연결 끊김)가 나면 요청 시간이 남아 있을 때 한 번만 다시 요청하고, 두 번째도 실패하면 502를 반환합니다. 2026-11-06 실제 공고 판정 9회 중 3회가 재시도가 없던 시절 이 경로의 502였습니다(`/Users/online/reports/easyapply-eval-20261106/rubric-2300/00-SUMMARY.md`).
- 현재 운영은 호출 한도가 해제되어 공개 주소의 누구나 세션을 받아 유료 AI 호출을 반복할 수 있습니다. 같은 세션의 동시 실행만 막으므로 비용 상한은 공급자 계정 설정에만 의존합니다.
- 같은 AI가 읽은 이미지 판독문은 독립적인 원문 검증 자료가 아닙니다. 독립 텍스트가 없는 조건은 자동으로 충족 판정하지 않습니다.
- 이용 코드는 공유 접근 통제이며 개별 회원 계정/권한 관리 시스템은 아닙니다. 현재 제품은 문서/답변을 DB에 보관하지 않는 단일 분석 흐름입니다.
- 장기 작업 큐와 사용자별 분석 내역 보관은 구현 범위에 포함하지 않았습니다. 업로드는 공급자별 22~24 MiB까지 지원하지만 AI 분석 시간·200쪽·추출 100만 자 제한은 유지합니다.
- 개인정보 처리 고지의 운영자 정보·실제 서비스 정책은 공개 운영 주체가 확정해야 합니다. AI 제공자 전송 사실과 앱 자체 저장 범위는 화면/README에 표시했습니다.

기존 폴더에 Git 메타데이터가 없어 커밋은 만들지 않았습니다. 수정 전 소스는 위 증거 폴더의 `before/`에 보존했습니다. 사용자의 환경파일은 이 백업에 포함하지 않았습니다.


## 25 MiB 업로드 및 모바일 후속 배포 (당시 상한, 현재 24 MiB)

2026-11-06 Production `dpl_BGEu7E8ASNBje6E9XQzrAyQzLs8d`를 기존 공개 주소로 승격했습니다. 비공개 Vercel Blob `easyapply-temp-uploads`를 서울(icn1)에 연결했고, `CRON_SECRET`으로 인증하는 매일 임시 파일 정리를 등록했습니다. 4 MiB 초과 파일은 브라우저에서 비공개 Blob으로 직접 전송하며 서버는 세션에 서명된 경로만 읽습니다. 해당 임시 파일은 AI 호출 전에 삭제하고, 취소·오류 시에도 삭제합니다. 중단된 파일은 매일 정리하며 저장소 장애 시 다음 작업에서 재시도합니다.

- 배포 전 24.322 MiB(25,503,003바이트) 실제 PDF 전송·삭제 HTTP 200, Cron 무인증 401, 제거된 sample 플래그 400을 확인했습니다.
- 공개 주소에서 WebKit iPhone 13 에뮬레이션으로 같은 파일을 실제 업로드했습니다. 전체 75.4초, 서버 분석 65.5초, HTTP 200, 인용 71개 원문 일치였습니다. 실제 아이폰 하드웨어 테스트는 아닙니다.
- 결과 표시 후 원문 2쪽 캔버스를 렌더링했고 브라우저 실행 오류는 없었습니다. 같은 티켓으로 파일을 다시 읽을 때 `upload_missing` 409로 임시 파일 삭제를 확인했습니다. 기존 샘플 JSON URL은 404입니다.
- 일부 Safari에 ReadableStream 비동기 반복 기능이 없어 PDF.js가 화면을 중단시키는 문제를 재현했습니다. 호환 처리를 추가하고 PDF 원문 추출 오류가 전체 앱으로 전파되지 않게 수정했습니다.
- 용량·세션/경로 변조·초과 스트림·취소/실패 후 삭제·Safari 스트림·sample 우회 제거를 포함한 당시 38개 테스트와 lint/typecheck가 통과했습니다. 운영 의존성 감사는 취약점 0입니다.

증거: `/Users/online/reports/easyapply-upload-20261106/`의 `deployment.json`, `promotion.json`, `upload-verification.json`, `mobile-live-verification.json`, `large-pdf-analysis.json`, `mobile-live-large-pdf.png`, `tests.log`, `typecheck.log`, `lint.log`. 비밀 값과 서명 토큰은 증거에 포함하지 않았습니다.

## 모델 비교 (Astra 전환 전 측정)

동일한 입력/프롬프트/스키마로 GPT-5.4 none default와 GPT-6 Astra high fast를 각각 실제 호출했습니다. 응답 처리 등급도 확인했습니다. PDF는 58.00초 대 86.92초, HWPX는 12.36초 대 18.85초였습니다. 문서별 각 1회 측정이고 캐시 상태와 모델별 PDF 토큰화가 달라 일반 성능 순위로 볼 수 없습니다.

원문 인용은 모두 일치했지만 GPT-5.4가 병역 연령 연장을 우대 조건으로 분류했고 Astra는 나이 요건의 예외로 처리했습니다. 인용 일치만으로 해석의 정확도를 보장할 수 없음을 보여줍니다. 실제 신청자의 후속 자격 판정까지 비교한 것은 아닙니다. 상세 출력·시간·토큰·한계는 위 증거 폴더의 `model-comparison/RESULTS.md`에 기록했습니다. 이 비교 당시 운영 모델은 GPT-5.4였으며, 이후 사용자 요청으로 아래 Astra medium Fast 배포를 적용했습니다.


## GPT-6 Astra medium Fast 운영 전환 (당시 기준, 22:27 Claude로 교체)

사용자가 high 대신 medium을 지정해 Production `dpl_WZP5iqrCXPdVamkkEyZcw5UEAFTQ`를 기존 공개 주소에 승격했습니다. 모델명뿐 아니라 Responses API의 `reasoning.effort=medium`, `service_tier=fast`를 명시합니다. Vercel Production에는 이 세 값을 Config 환경변수로 저장했습니다. 비밀 API 키와 다른 운영 설정은 그대로 사용합니다.

- 당시 39개 테스트·lint·typecheck 및 Vercel 빌드 통과. SDK 테스트는 실제 요청 본문의 model/reasoning/service_tier를 확인합니다.
- 배포 서버의 실제 PDF 분석 HTTP 200: 서버 약 54.8초, 원문 인용 84개 일치. 나이 상한 연장을 나이 조건의 예외로 정리했습니다.
- 같은 분석의 서명 토큰으로 실제 자격 확인 HTTP 200: 약 24.7초, 빈 답변의 16개 조건 모두 확인 필요, 체크리스트 16개.
- 기존 공개 주소에서 HWPX 실제 분석 HTTP 200: 약 11초, 인용 8개 일치.
- 세 호출의 OpenAI 응답 로그에서 실제 모델 `gpt-6-astra`, 추론 `medium`, 처리 등급 `fast`를 확인했습니다. 상태 API 값만으로 성공을 판단하지 않았습니다.
- 배포 로그의 오류 3개는 직접 실행한 세션 없음 401·교차 origin 403·잘못된 서명 409 차단 테스트입니다. 해당 검증 구간에 예상하지 않은 오류는 없었습니다.

증거: `/Users/online/reports/easyapply-astra-medium-20261106/`의 `deploy.json`, `promotion.json`, `vercel-verification.json`, `public-verification.json`, `runtime-usage-final.md`, `release.json`. 각 시간과 인용 수는 합성 공고 1회 호출 결과이며 모든 공고의 속도·정확도를 보장하지 않습니다.


## Claude Opus 5.5 운영 전환과 후속 수정 (22:20 이후)

전환 전 같은 입력·프롬프트·스키마로 비교했습니다. 합성 PDF 분석은 Opus 5.5 medium fast 38.0초·인용 67개, Astra medium fast 46.9초·인용 82개였습니다. 판정 2건(병역 예외·나이 제외)의 정답 체크 3개(나이 예외, 월세 환산, 잘못된 적격 판정 없음)는 양쪽 모두 통과했습니다. 각 1회 측정입니다. 증거: `/Users/online/reports/easyapply-opus-comparison-20261106/*/summary.json`.

22:27 Production `dpl_EJMzD6oShTJnCn4rgffiuyjH2nbZ`를 공개 주소에 승격했습니다. `ANTHROPIC_API_KEY`(Secret)와 `EASYAPPLY_PROVIDER=api`, `EASYAPPLY_MODEL=claude-opus-5-5`, `EASYAPPLY_EFFORT=medium`, `EASYAPPLY_ANTHROPIC_SPEED=fast`(Config)를 등록했습니다. 배포 서버에서 PDF 분석 40.2초·인용 61개 정확 일치, 판정 20.9초(미답변 조건은 확인 필요 유지), 공개 주소 HWPX 7.3초·인용 8개 일치를 확인했고, 공급자 사용량 로그에서 속도 `fast`를 확인했습니다. 당시 테스트는 86개였습니다. 증거: `/Users/online/reports/easyapply-opus-deploy-20261106/DEPLOYMENT.md`.

후속 코드 변경:

- Claude 어댑터(`llm.ts`): 전체 분석 스키마가 Anthropic의 엄격한 출력 문법 한도를 넘어 `easyapply_result` 도구 입력(`tool_choice: auto`)으로 결과를 받고, 서버에서 Zod 전체 검증을 합니다. 추론은 `output_config.effort`, 속도는 `speed`로 지정하고 출력 한도 종료는 별도 오류로 구분합니다.
- 인용 대조(`textmatch.ts`): `ㆍ`를 NFKC 정규화 전에 `·`로 바꾸고 `∼`를 `~`로 매핑합니다.
- 큰 파일 분석(`analyze/route.ts`): 업로드 정보를 확인하고 `acquireAI`로 AI 실행을 예약한 뒤에 Blob 파일을 소비합니다. 예약 단계에서 한도·중복 실행으로 거절되면 `X-Upload-Retryable: 1`을 보내고, 화면의 재시도 버튼이 같은 업로드를 재사용합니다.
- 호출 한도(`guard.ts`, `config.ts:4`): IP·세션별 24시간 한도와 IP당 세션 발급 30개를 추가한 뒤, `EASYAPPLY_USAGE_LIMITS` 플래그로 기본 해제했습니다.
- 마감 처리: `is_application_deadline`으로 신청 접수 마감과 후속 서류·이의신청 마감을 구분합니다. 접수 마감이 모두 지난 공고는 서류·제출 할 일을 빼고 "추가 모집 여부 확인"을 맨 앞에 둡니다(`validation.ts:84-117`).
- 한도 상수: 업로드 24 MiB(`limits.ts`), 분석·판정 출력 128,000토큰(`llm-limits.ts`), 문서 200쪽·추출 100만 자(`document-limits.ts`).
- 테스트 86개 → 112개. 112/112 통과(22:51), typecheck·lint 통과(22:39).

실제 공고 라이브 검증(22:45–22:50, 당시 공개 배포 22:34 대상): 분석 42.9초·인용 66/66 정확 일치. 판정은 A(필수 조건 모두 충족) 10개 모두 met, B(필수 조건 미충족) `likely_ineligible`, C(답변 대부분 비움) 10개 모두 check였습니다. 이 배포에는 만료 공고 할 일 정리가 없어 A·C에 서류·제출 할 일이 남아 있었습니다. 증거: `/Users/online/reports/easyapply-eval-20261106/rubric-2300/live/`.
