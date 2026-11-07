# EasyApply

공고문을 쉬운 말로 정리하고, 사용자가 입력한 조건과 비교해 신청 준비 체크리스트를 만드는 Next.js 앱입니다. PDF·사진·HWP 5·HWPX를 받습니다. 신청을 대신 제출하거나 기관의 최종 자격 심사를 대체하지 않습니다.

운영 주소: **https://easyapply-five.vercel.app**. 2026-11-06 Vercel에서 실제 PDF/HWPX 분석과 자격 확인·체크리스트 생성을 검증했습니다. 검증 범위와 남는 제품 한계는 [PRODUCTION_AUDIT.md](PRODUCTION_AUDIT.md)에 기록했습니다.

## 현재 운영 상태 (2026-11-07 09:20 KST 기준)

| 항목 | 상태 |
|---|---|
| 배포 | 공개 주소가 Production `dpl_AqPskTwmhsxq8SyreEziJjVm7Z5p`(11-07 01:46:41 생성, 01:47 승격)를 가리킵니다. 소스는 00:36 배포(`dpl_5eQuXZrXd5P6SaEsGtDUjqkmvXBC`)에 첫 화면 중간안(태그줄·제목·설명·예시 카드 복원)을 더한 `release-landing` 브랜치(태그 `prod-20261107-0146`)입니다. 서버 결함 수리분은 3차 수리(`42df683`)와 AI 고지 복원(`f700f89`)까지 main에 있고 테스트 204개·사전 점검을 통과했지만, 09:05 독립 재검토가 마감 판정 경로의 결함 7건을 재현해 보류로 판정해 아직 배포하지 않았습니다(검토 기록 `reports/easyapply-eval-20261107/round3-0900/REVIEW3-codex.md`) |
| AI | Anthropic API(`EASYAPPLY_PROVIDER=api`, 상태 API `provider:"api"`), `claude-opus-5-5`, 추론 `medium`, 처리 속도 `fast`. OpenAI 키도 등록되어 있지만 사용하지 않습니다 |
| 호출 한도 | **해제.** Production에 `EASYAPPLY_USAGE_LIMITS`가 없어(상태 API `usage_limits_enabled:false`) 같은 세션의 중복 실행 방지만 적용합니다 |
| 업로드·형식 | 합계 상한은 공급자별(Anthropic 22 MiB, OpenAI·로컬 24 MiB, 4 MiB 초과는 비공개 Blob 직접 업로드), 사진 10장·장당 5 MiB. PDF·HWP·HWPX·JPG·PNG·WEBP·GIF |
| 검증 | `npm test`, `npm run typecheck`, `npm run lint`로 확인합니다 |

한도를 켜려면 Vercel Production에 `EASYAPPLY_USAGE_LIMITS=on`을 추가하고 재배포합니다. 이때 IP·세션별 10분당 분석 8회·판정 24회 한도는 코드에 고정되어 있어(`src/lib/server/guard.ts`의 `quota()`) 같은 Wi-Fi(같은 공인 IP)를 쓰는 심사위원들이 함께 걸릴 수 있습니다. 전체 일일·동시 한도는 등록된 `EASYAPPLY_DAILY_AI_LIMIT`·`EASYAPPLY_MAX_CONCURRENT` 값을, IP·세션별 24시간 한도는 변수가 없으므로 기본 20회를 따릅니다.

## 심사용 문서 (docs/)

- [docs/01-기획.md](docs/01-기획.md) — 문제, 대상 사용자, "그냥 ChatGPT에 올리면 안 되는 이유", 해법의 원칙, 범위, 성공 기준, 알려진 한계, AI 전공과의 연결 (A4 1장)
- [docs/02-AI-활용-과정.md](docs/02-AI-활용-과정.md) — 하루의 흐름, 사람·Claude·Codex 역할 분담, 핵심 결정 5개와 근거 수치, 검증 방법, 비용과 운영 선택, 실패에서 배운 것, 남은 과제 (A4 2장)
- [docs/03-오류-유형표.md](docs/03-오류-유형표.md) — 오류 15유형: 증상·원인·발견 경위·수정·현재 상태
- [docs/QUESTIONS-FOR-OWNER.md](docs/QUESTIONS-FOR-OWNER.md) — 제작자만 답할 수 있는 빈칸 10개. 본문의 `[확인 필요: 질문 N]`이 이 번호입니다
- [docs/evidence/](docs/evidence/) — 위 문서의 사실 근거: 출처가 달린 타임라인(TIMELINE), 결정 기록(DECISIONS), 오류 원기록(ERRORS), 출처 공백(GAPS). 보고서 원본 경로는 로컬 `reports/` 폴더 기준입니다

숫자와 시각은 보고서·로그·git 스냅샷에 있는 것만 썼고, 출처가 서로 다르면 보수적인 값을 쓰고 각주로 남겼습니다.

## 로컬 실행

Node.js 22 이상이 필요합니다.

```sh
npm ci
cp .env.example .env.local # 이미 파일이 있으면 덮어쓰지 마세요
chmod 600 .env.local
# 편집기에서 ANTHROPIC_API_KEY(운영과 같게 하려면 EASYAPPLY_PROVIDER=api) 또는 OPENAI_API_KEY를 설정
npm run dev -- -p 3123
```

http://127.0.0.1:3123 에서 사용합니다. 개발 서버는 loopback에만 바인딩됩니다. 키를 명령줄 인자·소스 코드·채팅·스크린샷에 넣지 마세요. `.env.local`은 Git 및 Vercel 업로드에서 제외됩니다. 예제에는 빈 값만 유지하세요.

`EASYAPPLY_PROVIDER=auto`(기본)는 OpenAI 키, Anthropic 키, 개발 환경의 로컬 Claude Code 순서로 선택합니다. 두 키가 모두 있는 운영 환경은 `api`로 Anthropic을 지정합니다. 지정한 공급자의 키가 없으면 다른 공급자로 넘어가지 않고 미설정으로 표시합니다. Anthropic 기본값은 `claude-opus-5-5`, 추론 `medium`, 처리 속도 `standard`이며 운영은 `fast`입니다. 결과는 `easyapply_result` 도구 입력으로 받아 서버에서 전체 스키마를 검증합니다. OpenAI 기본값은 `gpt-6-astra`, 추론 `medium`, 처리 등급 `fast`입니다. 변수와 허용 값은 아래 운영 환경 표에 있으며, 설정은 공고 분석과 자격 확인에 함께 적용합니다. 상태 API는 요청 설정을 표시하고 서버 사용량 로그는 실제 응답의 모델·추론·처리 등급(속도)을 기록합니다. API 오류 시 다른 공급자로 몰래 재시도하지 않습니다. 로컬 Claude Code는 로그인된 CLI를 사용하며 Vercel에서는 실행되지 않습니다. 샘플 체험 기능은 제거했으며 실제 파일 업로드만 제공합니다. 키가 없으면 AI 연결 안내를 표시합니다.

## API와 처리 과정

- `GET /api/status`: 설정 상태·파일 한도 반환 및 HttpOnly 세션 발급. `configured`는 설정 확인이며 공급자 결제/장애 상태를 점검하는 호출은 아닙니다. 응답 계약: 200 `ready:false`는 '준비 중'(설정 미완료), 429 `{error:{code:"rate_limit"}}`(세션 발급 한도, `Retry-After` 초)와 503 `{error:{code:"rate_limit_unavailable"}}`(Redis 장애)은 '잠시 후 다시'입니다.
- `POST /api/session`: 선택적 이용 코드 확인. 로그인 시도 제한(IP별 분당 6회)은 `EASYAPPLY_USAGE_LIMITS=on`일 때만 적용됩니다.
- `POST /api/uploads`: 세션에 귀속된 10분 유효 비공개 Blob 업로드 URL과 서명 티켓을 발급합니다. 파일 경로·형식·용량을 제한하며 업로드 권한으로 다른 파일을 읽거나 덮어쓸 수 없습니다. `DELETE`는 해당 세션의 임시 파일만 정리합니다.
- `GET /api/cleanup-uploads`: `CRON_SECRET` 인증을 거쳐 하루 한 번 중단된 임시 파일을 정리합니다.
- `POST /api/analyze`: 작은 파일은 multipart `files`, 큰 파일은 JSON `upload_ticket`을 받습니다. 실제 파일 헤더와 용량을 확인하고 Blob 임시 파일을 AI 호출 전에 삭제합니다. PDF 텍스트 또는 한글 본문을 추출하고 AI 구조화 출력, 참조 ID, 날짜, 인용 페이지를 검증합니다. 분석 결과와 세션에 귀속된 서명 토큰을 돌려줍니다.
- `POST /api/match`: `analysis`, `analysis_token`, `answers`, `extra`를 받습니다. 변조한 분석 결과는 거절합니다. 선택지·답변 형식을 검사한 뒤 판정합니다.

인용문은 공백 등 표기를 정규화한 뒤 원문 추출 텍스트와 비교합니다. 유사 일치와 정확 일치를 구분합니다. 원문을 확인하지 못한 자격 조건은 서버에서 `check`로 제한합니다. 답변이 누락되면 충족으로 판단하지 않지만, 알려진 관련 답변만으로 미충족이 확실하고 미확인 예외가 없으면 다른 답변이 비어 있어도 `not_met`을 유지합니다. 모델은 `failed_answer_ids`로 근거 답변을 지정하고 서버는 관련성·입력 여부를 검사합니다. 예외의 의미 판단 자체는 모델에 의존합니다. 우대 순위 미충족은 필수 자격 탈락에 포함하지 않습니다. 미충족인 결과에서는 서류 준비·신청 제출을 권하지 않으며, 그 외 결과에서는 빠뜨린 필수 서류와 제출 단계를 보충합니다. 캘린더는 한국 시간, UTF-8 줄 접기 및 공고별 UID를 적용합니다.

업로드 전에는 접힌 선택 메모를 제공하고, 분석 뒤에는 공고별 조건 질문을 먼저 보여줍니다. 메모는 답변을 자동으로 채우지 않으며 조건 비교 시 함께 참고합니다. 필수·제외 조건 미충족은 입력값과 함께 강조하고, 해당 조건이 다른 공고를 찾기 위한 검색 제안을 표시합니다. 이 제안은 실제 공고 검색 결과가 아닙니다. 문의처는 원문 인용과 함께 요약 맨 아래에 표시하며, 용어 풀이는 원문에 등장하고 자격·서류·절차 이해에 필요한 용어만 선정합니다.

접수 마감은 `is_application_deadline`으로 후속 서류 제출·이의신청 등의 마감과 구분합니다. 접수 기간이 끝났으면 자격 조건이 맞아도 확인 필요로 표시하고, 서류·제출 할 일 대신 "추가 모집 여부 확인"을 안내합니다. 답변이나 추가 상황을 수정하면 기존 판정은 즉시 초기화합니다. HWPX 병합 셀이나 해석할 수 없는 셀 병합 정보도 표 구조 확인이 필요한 문서로 처리합니다.

답변과 분석 결과는 EasyApply DB에 저장하지 않습니다. Vercel에서 합계 4 MiB를 넘는 파일은 비공개 Blob에 임시 저장하고 서버에서 읽은 뒤 즉시 삭제합니다. 취소·중단된 파일은 브라우저 정리 요청과 매일 실행되는 Cron으로 정리합니다. 읽기 실패 때도 삭제를 시도하며, 저장소 장애로 삭제되지 않으면 다음 정리 작업에서 재시도합니다. 처리 중인 파일은 메모리에서 사용하고 AI 제공자에게 전송합니다. OpenAI 요청에는 `store:false`를 사용하며, 현재 운영 공급자인 Anthropic 요청에는 이에 해당하는 옵션을 지정하지 않습니다. 제공자의 별도 보존 정책까지 '저장 안 함'으로 보장하지 않습니다. 로컬 CLI 모드의 임시 파일은 처리 후 지웁니다. 로그에는 요청 ID, 공급자, 지연, 사용량, 오류 코드만 남기고 원문·답변·키는 남기지 않습니다. 브라우저에는 체크리스트 완료 표시가 남습니다.

## 한글 문서 지원과 한계

| 형식 | 처리 | 제한 |
|---|---|---|
| PDF | 모델에 PDF 전달 + 서버 PDF.js 텍스트 대조 | 최대 200쪽, 추출 텍스트 100만 자 |
| JPG/PNG/WEBP/GIF | 이미지 전달 | 최대 10장. AI 판독문 내부 비교는 독립 원문 검증이 아닙니다 |
| HWP 5 | OLE 본문 레코드 추출 | 표 셀 관계·배치 손실 가능. 자격 조건을 확인 필요로 제한 |
| HWPX | ZIP 내부 section XML, 표 셀의 텍스트 추출 | 복잡한 병합 표의 의미 및 이미지 속 글자까지 보장하지 않음 |

한글 파일에는 **서식 미리보기 / 추출 텍스트**를 제공합니다. 서식 미리보기는 MIT 라이선스의 `@rhwp/core 0.8.7`을 필요한 시점에만 불러와 브라우저에서 렌더링하며, 같은 사이트의 WASM을 사용합니다. 별도 문서 변환 서비스로 전송하지 않습니다. 최대 200쪽이며 한 번에 한 쪽만 SVG 이미지로 표시합니다. 글꼴·줄바꿈·일부 표 배치는 원본과 다를 수 있고, 실패하면 추출 텍스트나 원본 다운로드를 사용할 수 있습니다. PDF는 화면 근처와 선택한 근거 쪽만 렌더링하여 200개 캔버스를 동시에 만들지 않습니다.

출력 상한은 공고 분석 **32,000토큰**, 조건 비교 **16,000토큰**이며 환경변수로 최대 128,000까지 올릴 수 있습니다. 추론 토큰도 이 예산을 사용하며, 답변이 짧으면 실제 생성된 토큰만 사용합니다. 한 요청 안에서 전체 문서를 읽고 중복 안내·빈 서식 전사를 줄여 결과를 간결하게 작성합니다. 잘린 결과를 이어 붙이거나 완성된 판정처럼 반환하지 않으며, 출력 한도 종료는 파일 크기 초과와 별도 오류로 구분합니다. 종료 이유·토큰 사용량은 본문 없이 로그로 남깁니다. 200쪽은 문서 페이지 한도이며 모델의 컨텍스트·실행 시간·파일 용량 한도까지 없다는 의미는 아닙니다. 한글 본문도 최대 100만 자까지 추출하며 기존 ZIP·메모리 보호를 유지합니다.

분석 근거는 렌더링 쪽수와 다른 추출 **구역**에 연결됩니다. 원문 근거를 누르면 추출 텍스트로 전환하며, 미리보기의 쪽수에 임의로 대응시키지 않습니다. 암호화·배포용 보호 문서와 본문을 읽지 못한 한글 파일, PDF.js가 열지 못하는 PDF는 AI 호출 전에 거절하며(AI 한도 미차감), 잘린 미리보기 텍스트로 성공한 척하지 않습니다. 일부만 손상된 파일과 사진은 파일 헤더만 확인하므로 그대로 분석될 수 있습니다. 서버 worker 메모리·실행 시간, ZIP 압축 해제량을 제한합니다. 이미지·도장·복잡한 표가 중요하면 PDF로 저장해 분석하는 것이 적합합니다. HWP는 공개 라이선스 실제 문서, HWPX 분석은 합성 공고와 표 구조로 검증했습니다. 다양한 실제 공공기관 서식의 정확도를 대표하는 벤치마크는 아닙니다.

## 운영 환경

Vercel 프로젝트 **Settings → Environment Variables**에 아래 값을 서버 전용으로 설정합니다. 키·토큰은 **Secret/Sensitive**, 범위는 필요한 환경만 선택하세요. `NEXT_PUBLIC_` 접두사는 금지합니다. 환경변수 변경 후 새 배포가 필요합니다.

| 변수 | 용도 |
|---|---|
| `ANTHROPIC_API_KEY` | Anthropic API 서버 호출(현재 운영). `ANTHROPIC_AUTH_TOKEN`도 인식 |
| `OPENAI_API_KEY` | OpenAI 서버 호출. 운영에 등록되어 있으나 현재 사용하지 않음 |
| `EASYAPPLY_PROVIDER` | `auto`(기본: OpenAI→Anthropic→로컬 CLI)·`openai`·`api`(`anthropic`)·`cli`·`none`. 그 밖의 값은 설정 오류. 운영 `api` |
| `EASYAPPLY_MODEL` / `EASYAPPLY_EFFORT` / `EASYAPPLY_ANTHROPIC_SPEED` | Anthropic 모델(기본 `claude-opus-5-5`), 추론 `low`·`medium`(기본)·`high`·`xhigh`·`max`(로컬 Claude에도 적용), 속도 `standard`(기본)·`fast` |
| `EASYAPPLY_OPENAI_MODEL` / `EASYAPPLY_OPENAI_REASONING_EFFORT` / `EASYAPPLY_OPENAI_SERVICE_TIER` | OpenAI 모델(기본 `gpt-6-astra`), 추론 `none`~`max`(기본 `medium`, Astra는 `none` 불가), 처리 등급 `auto`·`default`·`flex`·`priority`·`fast`(기본) |
| `EASYAPPLY_SIGNING_SECRET` | 32바이트 이상 무작위 서명 키 |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | 운영 필수. 인스턴스 간 공유하는 중복 실행 방지·(한도 활성화 시) 호출량 저장소. Vercel Marketplace의 `KV_REST_API_URL` / `KV_REST_API_TOKEN` 쌍도 지원 |
| `BLOB_READ_WRITE_TOKEN` / `BLOB_STORE_ID` | Vercel 비공개 Blob 연결 시 자동 주입(둘 중 하나). 4 MiB 초과 업로드용 |
| `CRON_SECRET` | 무작위 비밀 값. 임시 파일 정리 Cron 인증 |
| `EASYAPPLY_ACCESS_CODE` | 선택: 12자 이상 비공개 테스트 이용 코드 |
| `EASYAPPLY_USAGE_LIMITS` | 정확히 `on`일 때만 이용량 상한 적용. 미설정·`off`·그 밖의 값은 해제. 운영 미설정 |
| `EASYAPPLY_DAILY_AI_LIMIT` | 제한 활성화 시 전체 24시간 호출 상한, 기본 100(1~100,000) |
| `EASYAPPLY_DAILY_IP_AI_LIMIT` | 제한 활성화 시 IP별 24시간 합산 상한, 기본 20(1~100,000) |
| `EASYAPPLY_DAILY_SESSION_AI_LIMIT` | 제한 활성화 시 세션별 24시간 합산 상한, 기본 20(1~100,000) |
| `EASYAPPLY_MAX_CONCURRENT` | 제한 활성화 시 전체 동시 AI 호출 상한, 기본 3(1~20) |
| `EASYAPPLY_REQUEST_TIMEOUT_MS` | AI 호출 제한 시간, 기본 240,000(1,000~260,000). 재시도를 포함한 요청 전체는 280초 안에서 남은 시간만 씁니다 |
| `EASYAPPLY_ANALYZE_OUTPUT_TOKENS` / `EASYAPPLY_MATCH_OUTPUT_TOKENS` | 분석·판정 출력 상한, 기본 32,000 / 16,000(1,000~128,000). standard 속도에서 32,000은 제한 시간에 가까울 수 있습니다 |
| `EASYAPPLY_APP_ORIGIN` | 자체 호스팅 운영 필수. 배포 도메인 origin |

심사용 기본 설정에서는 IP·세션별 호출 횟수, 전체 하루 호출량, 새 세션 발급, 요청 빈도, 누적 업로드량, 전체 동시 실행 상한을 적용하지 않습니다. 기존 Redis 사용량이 소진되어 있어도 심사를 막지 않고, 같은 Wi-Fi의 심사위원들이 사용 횟수를 나눠 쓰지 않습니다. 요청 서명과 파일 검증은 유지하며 Redis는 같은 세션의 중복 실행 방지에 사용합니다. 제공자 자체 제한과 파일 크기·처리 시간 제한은 유지합니다.

일반 공개 운영에서 상한이 필요하면 `EASYAPPLY_USAGE_LIMITS=on`으로 명시합니다. 이 경우 같은 IP/세션은 10분에 분석 8회·판정 24회(코드 고정값), 24시간 합산 각각 20회(위 변수로 조정), 새 세션은 IP당 24시간 200개, 분석·판정 요청은 IP당 분당 40회로 제한합니다. 전체 한도와 동시 실행 수는 위 환경변수를 따릅니다. 사용량은 파일 확인을 통과하고 AI를 호출하기 직전에만 차감하므로, 거절된 요청이나 읽을 수 없는 파일은 차감하지 않습니다. 호출이 시작된 뒤 실패한 요청은 환불하지 않습니다. IPv6는 /64 단위로 묶고, IP는 HMAC으로 변환한 값만 Redis에 사용하며 Vercel 이외의 호스트는 IP 버킷을 공유합니다.

큰 파일은 업로드 권한 발급 전에 AI 한도·동시 실행을 사전 확인하며 이 확인 자체는 AI 사용량을 차감하지 않습니다. 실제 분석은 서명된 업로드 정보를 검증하고 AI 실행을 예약한 **뒤에** 파일을 내려받아 삭제합니다. 사전 확인 후 다른 요청으로 한도가 찼으면 파일을 소비하지 않고 재시도 가능 응답을 보내며, 화면의 재시도 버튼은 기존 업로드를 재사용합니다. 임시 업로드 티켓은 발급 후 30분이며 화면을 떠나거나 다른 파일을 선택하면 정리합니다.

제한을 활성화한 경우에만 비공개 Blob 업로드 권한에도 상한(전체 2,400 MiB·1,000개는 업로드 티켓 수명인 30분, IP·세션별 240 MiB·100개는 24시간)을 적용합니다. 심사용 기본 설정에서는 이 누적 상한도 해제됩니다.

파일 합계 상한은 공급자별로 Anthropic **22 MiB**(요청 32 MB 한도에 base64 증가분 고려), OpenAI·로컬 **24 MiB**이고, 사진은 최대 10장·장당 5 MiB입니다. 상한은 상태 API의 `max_upload_bytes`로 화면에 전달하고, 넘는 파일은 업로드 전에 차단합니다. Vercel에서는 4 MiB 초과 파일을 비공개 Blob으로 직접 업로드해 [플랫폼의 함수 요청 크기 제한](https://vercel.com/docs/functions/limitations)을 넘기지 않습니다. Blob 또는 Cron 설정이 없으면 Vercel 한도는 4 MiB로 내려갑니다. 외부 URL에서 임의 파일을 받아오는 경로는 제공하지 않습니다. AI 호출은 기본 240초, API 함수는 최대 300초입니다.

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

`scripts/smoke-live.ts --allow-paid`는 실제 호출 점검 스크립트입니다. 공급자를 강제하지 않고 상태 API의 공급자로 PDF 분석·판정과 HWPX 분석을 호출합니다. 실행하면 분석 비용이 발생하고 결과는 기본 `artifacts/live`에 저장됩니다. 현재 운영(Claude)의 실제 호출 검증 기록은 [PRODUCTION_AUDIT.md](PRODUCTION_AUDIT.md)에 있습니다. 실제 개인정보가 담긴 파일로 바꾸지 마세요.

독립 HTML의 `standalone/`은 기존 Claude 공유 페이지용 시연 코드입니다. 서버 세션·서명·공유 호출 제한이 있는 운영 앱은 Next.js 경로이며, 독립 HTML은 운영 배포에 포함하지 않습니다.

공식 문서: [OpenAI PDF 입력](https://developers.openai.com/api/docs/guides/file-inputs), [구조화 출력](https://developers.openai.com/api/docs/guides/structured-outputs), [Vercel 비밀 환경변수](https://vercel.com/docs/environment-variables/sensitive-environment-variables).
