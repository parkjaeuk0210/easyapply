# EasyApply 결정 기록

지정된 보고서·저장 로그·JSON·캡처·README·PRODUCTION_AUDIT와 새로 생긴 Git 로그만 사실 근거로 사용했다. 대화 JSONL과 Codex 세션은 읽지 않았고, 유료 API 호출·웹앱 요청·빌드·테스트 재실행·프로세스 종료는 하지 않았다.

수집 중 원 문서가 바뀌어 `/Users/online/easyapply/README.md`와 `PRODUCTION_AUDIT.md`의 1fce5a5·10346f8 버전을 `git show`로 `.sources/`에 보존했다. Git/문서 수집 기준은 2026-11-07 01:53 KST·HEAD 10346f8이며, 재현 명령은 [/private/tmp/claude-501/-Users-online/f163c745-bd33-487e-b4a2-2883237b9eb5/scratchpad/l3-timeline/.sources/capture.json:1](/private/tmp/claude-501/-Users-online/f163c745-bd33-487e-b4a2-2883237b9eb5/scratchpad/l3-timeline/.sources/capture.json:1)에 있다. 파일 저장시각과 해시는 [/private/tmp/claude-501/-Users-online/f163c745-bd33-487e-b4a2-2883237b9eb5/scratchpad/l3-timeline/.sources/source-metadata.json:1](/private/tmp/claude-501/-Users-online/f163c745-bd33-487e-b4a2-2883237b9eb5/scratchpad/l3-timeline/.sources/source-metadata.json:1)에 기록했다.

결정 사실과 검토자의 권고를 구분했다. 선택 이유가 명시되지 않은 경우 비교 수치로 이유를 추정하지 않고 “출처 없음”으로 표시했다.

## D01 서버에서 원문 인용 대조와 서명 검증 수행

| 항목 | 기록 |
| --- | --- |
| 결정 | 서버에서 원문 인용 대조와 서명 검증 수행 |
| 시각 | 11-06 초기 하드닝 구간; 정확한 결정 분 시각 출처 없음 |
| 검토한 대안 | 기존 상태: 클라이언트가 보낸 분석을 그대로 신뢰; 별도 대안 검토 기록 없음 |
| 택한 이유 | 인용 대조 채택 이유는 출처 없음; 서명은 기존 문제 “/api/match가 클라이언트가 보낸 분석을 그대로 신뢰”에 대한 수정으로 기록 |
| 근거 수치 | 초기 PDF 인용 75개 정확 일치, Vercel 78개; 변조 서명 409 |
| 출처 | [/private/tmp/claude-501/-Users-online/f163c745-bd33-487e-b4a2-2883237b9eb5/scratchpad/l3-timeline/.sources/1fce5a5-PRODUCTION_AUDIT.md:23](/private/tmp/claude-501/-Users-online/f163c745-bd33-487e-b4a2-2883237b9eb5/scratchpad/l3-timeline/.sources/1fce5a5-PRODUCTION_AUDIT.md:23) §주요 발견과 수정<br>[/private/tmp/claude-501/-Users-online/f163c745-bd33-487e-b4a2-2883237b9eb5/scratchpad/l3-timeline/.sources/1fce5a5-PRODUCTION_AUDIT.md:51](/private/tmp/claude-501/-Users-online/f163c745-bd33-487e-b4a2-2883237b9eb5/scratchpad/l3-timeline/.sources/1fce5a5-PRODUCTION_AUDIT.md:51)<br>[/Users/online/reports/easyapply-production-20261106/vercel-verification.json:46](/Users/online/reports/easyapply-production-20261106/vercel-verification.json:46) |

## D02 미응답·불확실·미검증 조건은 확인 필요, 종합 판정은 서버 재계산

| 항목 | 기록 |
| --- | --- |
| 결정 | 미응답·불확실·미검증 조건은 확인 필요, 종합 판정은 서버 재계산 |
| 시각 | 초기 결정 시각 출처 없음; 22:05 평가에서 확인 |
| 검토한 대안 | 기존 상태: 형식만 맞으면 잘못된 판정·참조 사용 |
| 택한 이유 | “애매하면 check로 둡니다 — 틀린 "충족"은 신청자에게 가장 큰 피해입니다”라는 프롬프트를 평가 보고서가 인용 |
| 근거 수치 | 빈 답변 13/13·16/16·10/10 모두 check라는 22:05 평가 기록 |
| 출처 | [/Users/online/reports/easyapply-eval-20261106/rubric-2300/01-plan-presentation.md:22](/Users/online/reports/easyapply-eval-20261106/rubric-2300/01-plan-presentation.md:22) §1-2 코드에만 있는 기획<br>[/Users/online/reports/easyapply-eval-20261106/rubric-2150/00-SUMMARY.md:42](/Users/online/reports/easyapply-eval-20261106/rubric-2150/00-SUMMARY.md:42)<br>[/private/tmp/claude-501/-Users-online/f163c745-bd33-487e-b4a2-2883237b9eb5/scratchpad/l3-timeline/.sources/1fce5a5-PRODUCTION_AUDIT.md:29](/private/tmp/claude-501/-Users-online/f163c745-bd33-487e-b4a2-2883237b9eb5/scratchpad/l3-timeline/.sources/1fce5a5-PRODUCTION_AUDIT.md:29) |

## D03 사진·스캔의 모델 판독문을 독립 검증으로 취급하지 않음

| 항목 | 기록 |
| --- | --- |
| 결정 | 사진·스캔의 모델 판독문을 독립 검증으로 취급하지 않음 |
| 시각 | 결정 시각 출처 없음 |
| 검토한 대안 | 모델 자기 판독문 대조와 독립 PDF/HWPX 텍스트 대조 |
| 택한 이유 | “같은 AI가 읽은 이미지 판독문은 독립적인 원문 검증 자료가 아닙니다.” |
| 근거 수치 | 독립 텍스트 없는 조건은 자동 충족 판정하지 않는다고 AUDIT 기재; 당시 화면 초록 ✓ 문제는 별도로 보고됨 |
| 출처 | [/private/tmp/claude-501/-Users-online/f163c745-bd33-487e-b4a2-2883237b9eb5/scratchpad/l3-timeline/.sources/1fce5a5-PRODUCTION_AUDIT.md:88](/private/tmp/claude-501/-Users-online/f163c745-bd33-487e-b4a2-2883237b9eb5/scratchpad/l3-timeline/.sources/1fce5a5-PRODUCTION_AUDIT.md:88)<br>[/Users/online/reports/easyapply-eval-20261106/deep-review-2225/00-SUMMARY.md:33](/Users/online/reports/easyapply-eval-20261106/deep-review-2225/00-SUMMARY.md:33) |

## D04 샘플·예시 답변 경로 제거

| 항목 | 기록 |
| --- | --- |
| 결정 | 샘플·예시 답변 경로 제거 |
| 시각 | 11-06 21:30 (평가 보고서 기재) |
| 검토한 대안 | 기존 샘플 체험·예시 답변·sample 플래그 우회 |
| 택한 이유 | 출처 없음: “21:30 사용자 결정”만 있음 |
| 근거 수치 | sampleButtonRemoved=true, sample 자산 404, sample 우회 400 |
| 출처 | [/Users/online/reports/easyapply-eval-20261106/rubric-2230/00-SUMMARY.md:32](/Users/online/reports/easyapply-eval-20261106/rubric-2230/00-SUMMARY.md:32)<br>[/Users/online/reports/easyapply-upload-20261106/mobile-live-verification.json:30](/Users/online/reports/easyapply-upload-20261106/mobile-live-verification.json:30)<br>[/Users/online/reports/easyapply-upload-20261106/upload-verification.json:47](/Users/online/reports/easyapply-upload-20261106/upload-verification.json:47) |

## D05 4 MiB 초과 파일은 비공개 Blob 직접 업로드·임시 삭제

| 항목 | 기록 |
| --- | --- |
| 결정 | 4 MiB 초과 파일은 비공개 Blob 직접 업로드·임시 삭제 |
| 시각 | 11-06 21:23–21:48 (2차 기록) |
| 검토한 대안 | 함수 직접 전송 4 MiB 경로 |
| 택한 이유 | “플랫폼의 함수 요청 크기 제한을 넘기지 않습니다.” |
| 근거 수치 | 당시 25 MiB, 실제 25,503,003 B·HTTP 200; 재사용 upload_missing 409 |
| 출처 | [/private/tmp/claude-501/-Users-online/f163c745-bd33-487e-b4a2-2883237b9eb5/scratchpad/l3-timeline/.sources/1fce5a5-README.md:100](/private/tmp/claude-501/-Users-online/f163c745-bd33-487e-b4a2-2883237b9eb5/scratchpad/l3-timeline/.sources/1fce5a5-README.md:100)<br>[/private/tmp/claude-501/-Users-online/f163c745-bd33-487e-b4a2-2883237b9eb5/scratchpad/l3-timeline/.sources/1fce5a5-PRODUCTION_AUDIT.md:98](/private/tmp/claude-501/-Users-online/f163c745-bd33-487e-b4a2-2883237b9eb5/scratchpad/l3-timeline/.sources/1fce5a5-PRODUCTION_AUDIT.md:98)<br>[/Users/online/reports/easyapply-upload-20261106/upload-verification.json:29](/Users/online/reports/easyapply-upload-20261106/upload-verification.json:29)<br>[/Users/online/reports/easyapply-upload-20261106/mobile-live-verification.json:59](/Users/online/reports/easyapply-upload-20261106/mobile-live-verification.json:59) |

## D06 GPT-5.4 none default와 Astra high fast 비교 후 사용자 지정 medium 적용

| 항목 | 기록 |
| --- | --- |
| 결정 | GPT-5.4 none default와 Astra high fast 비교 후 사용자 지정 medium 적용 |
| 시각 | 비교 21:41–21:47; 전환 21:50 / 21:53–21:57 불일치 |
| 검토한 대안 | GPT-5.4 none default, GPT-6 Astra high fast; 최종 운영 Astra medium fast |
| 택한 이유 | “사용자가 high 대신 medium을 지정해” 외 medium 선택 배경은 출처 없음 |
| 근거 수치 | PDF 58.00초 대 86.92초·인용 73/73 대 71/71; GPT-5.4 병역 연장 preference 오분류, Astra는 나이 예외로 처리 |
| 출처 | [/Users/online/reports/easyapply-upload-20261106/model-comparison/RESULTS.md:5](/Users/online/reports/easyapply-upload-20261106/model-comparison/RESULTS.md:5)<br>[/Users/online/reports/easyapply-upload-20261106/model-comparison/RESULTS.md:24](/Users/online/reports/easyapply-upload-20261106/model-comparison/RESULTS.md:24)<br>[/private/tmp/claude-501/-Users-online/f163c745-bd33-487e-b4a2-2883237b9eb5/scratchpad/l3-timeline/.sources/1fce5a5-PRODUCTION_AUDIT.md:117](/private/tmp/claude-501/-Users-online/f163c745-bd33-487e-b4a2-2883237b9eb5/scratchpad/l3-timeline/.sources/1fce5a5-PRODUCTION_AUDIT.md:117)<br>[/Users/online/reports/easyapply-eval-20261106/deep-2230/_draft-product-timeline.md:8](/Users/online/reports/easyapply-eval-20261106/deep-2230/_draft-product-timeline.md:8)<br>[/Users/online/reports/easyapply-eval-20261106/rubric-2300/02-ai-process-major.md:24](/Users/online/reports/easyapply-eval-20261106/rubric-2300/02-ai-process-major.md:24) |

## D07 OpenAI에서 Anthropic Opus 5.5 medium fast로 전환

| 항목 | 기록 |
| --- | --- |
| 결정 | OpenAI에서 Anthropic Opus 5.5 medium fast로 전환 |
| 시각 | 11-06 22:23–22:27; 완료 22:26/승격 22:27 불일치 |
| 검토한 대안 | 비교: Astra medium fast와 Opus 5.5 medium fast |
| 택한 이유 | 출처 없음: 비교 원자료와 전환 기록은 있으나 최종 선택 근거 서술은 없음 |
| 근거 수치 | 동결 비교 PDF Opus 37988 ms·67개, Astra 46855 ms·82개; 두 판정 사례 체크 3개 모두 true |
| 출처 | [/Users/online/reports/easyapply-opus-comparison-20261106/opus55-medium-fast/summary.json:3](/Users/online/reports/easyapply-opus-comparison-20261106/opus55-medium-fast/summary.json:3)<br>[/Users/online/reports/easyapply-opus-comparison-20261106/astra-medium-fast/summary.json:3](/Users/online/reports/easyapply-opus-comparison-20261106/astra-medium-fast/summary.json:3)<br>[/private/tmp/claude-501/-Users-online/f163c745-bd33-487e-b4a2-2883237b9eb5/scratchpad/l3-timeline/.sources/1fce5a5-PRODUCTION_AUDIT.md:133](/private/tmp/claude-501/-Users-online/f163c745-bd33-487e-b4a2-2883237b9eb5/scratchpad/l3-timeline/.sources/1fce5a5-PRODUCTION_AUDIT.md:133)<br>[/Users/online/reports/easyapply-eval-20261106/rubric-2230/00-SUMMARY.md:3](/Users/online/reports/easyapply-eval-20261106/rubric-2230/00-SUMMARY.md:3)<br>[/Users/online/reports/easyapply-eval-20261106/rubric-2300/02-ai-process-major.md:71](/Users/online/reports/easyapply-eval-20261106/rubric-2300/02-ai-process-major.md:71) |

## D08 Anthropic 운영 speed=fast 유지

| 항목 | 기록 |
| --- | --- |
| 결정 | Anthropic 운영 speed=fast 유지 |
| 시각 | 22:27 운영 전환에 포함; 최초 선택 분 시각 출처 없음 |
| 검토한 대안 | standard는 README 기본값이며 리뷰가 대안으로 제시; standard 실측 비교는 없음 |
| 택한 이유 | 출처 없음: 22:46 리뷰의 “데모는 Opus 5.5 · medium · fast 유지”는 권고이며 사용자 결정 이유와 구분 |
| 근거 수치 | Opus 비교 실제 응답 speed=fast; 보고서 추정 Fast $8/$40 per MTok·1회 이용 ≈ $0.9·standard 절반 |
| 출처 | [/private/tmp/claude-501/-Users-online/f163c745-bd33-487e-b4a2-2883237b9eb5/scratchpad/l3-timeline/.sources/1fce5a5-README.md:33](/private/tmp/claude-501/-Users-online/f163c745-bd33-487e-b4a2-2883237b9eb5/scratchpad/l3-timeline/.sources/1fce5a5-README.md:33)<br>[/Users/online/reports/easyapply-eval-20261106/deep-2230/02-ai-pipeline.md:10](/Users/online/reports/easyapply-eval-20261106/deep-2230/02-ai-pipeline.md:10)<br>[/Users/online/reports/easyapply-eval-20261106/rubric-2230/00-SUMMARY.md:25](/Users/online/reports/easyapply-eval-20261106/rubric-2230/00-SUMMARY.md:25)<br>[/Users/online/reports/easyapply-opus-comparison-20261106/opus55-medium-fast/summary.json:3](/Users/online/reports/easyapply-opus-comparison-20261106/opus55-medium-fast/summary.json:3) |

## D09 Anthropic 엄격 출력 대신 easyapply_result 도구 입력 + Zod 검증

| 항목 | 기록 |
| --- | --- |
| 결정 | Anthropic 엄격 출력 대신 easyapply_result 도구 입력 + Zod 검증 |
| 시각 | 11-06 22:12 실패 이후, 22:17 테스트·22:20 비교 성공 |
| 검토한 대안 | 엄격 출력 문법; 도구 강제 호출은 사고 모드에서 400이라는 평가 기록 |
| 택한 이유 | “전체 분석 스키마가 Anthropic의 엄격한 출력 문법 한도를 넘어” |
| 근거 수치 | 초기 HWPX 548 ms 실패·HTTP 400 compiled grammar is too large; 어댑터 테스트 58/58 |
| 출처 | [/Users/online/reports/easyapply-opus-comparison-20261106/opus55-first-failure.json:1](/Users/online/reports/easyapply-opus-comparison-20261106/opus55-first-failure.json:1)<br>[/Users/online/reports/easyapply-opus-comparison-20261106/opus55-medium-fast/provider-error.json:1](/Users/online/reports/easyapply-opus-comparison-20261106/opus55-medium-fast/provider-error.json:1)<br>[/private/tmp/claude-501/-Users-online/f163c745-bd33-487e-b4a2-2883237b9eb5/scratchpad/l3-timeline/.sources/1fce5a5-PRODUCTION_AUDIT.md:137](/private/tmp/claude-501/-Users-online/f163c745-bd33-487e-b4a2-2883237b9eb5/scratchpad/l3-timeline/.sources/1fce5a5-PRODUCTION_AUDIT.md:137)<br>[/Users/online/reports/easyapply-eval-20261106/deep-2230/02-ai-pipeline.md:17](/Users/online/reports/easyapply-eval-20261106/deep-2230/02-ai-pipeline.md:17)<br>[/Users/online/reports/easyapply-opus-comparison-20261106/tests.log:76](/Users/online/reports/easyapply-opus-comparison-20261106/tests.log:76) |

## D10 모델 비교를 동결 코드·동일 프롬프트/스키마 SHA·고정 분석/시각으로 수행

| 항목 | 기록 |
| --- | --- |
| 결정 | 모델 비교를 동결 코드·동일 프롬프트/스키마 SHA·고정 분석/시각으로 수행 |
| 시각 | 11-06 22:08–22:23 (보고서 기재) |
| 검토한 대안 | 평가 중 소스가 바뀌는 상태 |
| 택한 이유 | “비교 중 코드 변경 차단”; “분석 분산 제거” |
| 근거 수치 | Opus/Astra의 시스템·스키마 SHA 일치, 분석 16,000·판정 10,000 토큰; 이전 묶음은 시스템·스키마 SHA가 모두 다름 |
| 출처 | [/Users/online/reports/easyapply-eval-20261106/rubric-2300/02-ai-process-major.md:71](/Users/online/reports/easyapply-eval-20261106/rubric-2300/02-ai-process-major.md:71)<br>[/Users/online/reports/easyapply-opus-comparison-20261106/astra-medium-fast/configuration.json:1](/Users/online/reports/easyapply-opus-comparison-20261106/astra-medium-fast/configuration.json:1)<br>[/Users/online/reports/easyapply-opus-comparison-20261106/opus55-medium-fast/configuration.json:1](/Users/online/reports/easyapply-opus-comparison-20261106/opus55-medium-fast/configuration.json:1)<br>[/Users/online/reports/easyapply-opus-comparison-20261106/astra-prior-prompt/configuration.json:1](/Users/online/reports/easyapply-opus-comparison-20261106/astra-prior-prompt/configuration.json:1) |

## D11 ㆍ 정규화를 NFKC 전으로 이동하고 ∼ 매핑 추가

| 항목 | 기록 |
| --- | --- |
| 결정 | ㆍ 정규화를 NFKC 전으로 이동하고 ∼ 매핑 추가 |
| 시각 | 22:05 발견, 22:30 평가에서 수정 확인 |
| 검토한 대안 | 기존 NFKC 후 CHAR_MAP 적용 |
| 택한 이유 | “NFKC로 U+119E가 되어 매핑이 죽어 있음” |
| 근거 수치 | ㆍ/∼ 때문에 불필요한 확인 필요 발생; 22:30 수정 확인 및 관련 회귀 테스트 언급 |
| 출처 | [/Users/online/reports/easyapply-eval-20261106/rubric-2150/00-SUMMARY.md:28](/Users/online/reports/easyapply-eval-20261106/rubric-2150/00-SUMMARY.md:28)<br>[/Users/online/reports/easyapply-eval-20261106/rubric-2230/00-SUMMARY.md:38](/Users/online/reports/easyapply-eval-20261106/rubric-2230/00-SUMMARY.md:38) |

## D12 Blob 소비 전에 AI 실행 예약, 한도 거절 시 업로드 재사용

| 항목 | 기록 |
| --- | --- |
| 결정 | Blob 소비 전에 AI 실행 예약, 한도 거절 시 업로드 재사용 |
| 시각 | 22:05 발견, 22:30 수정 확인 |
| 검토한 대안 | 기존 Blob 다운로드·삭제 후 acquireAI |
| 택한 이유 | “한도 걸리면 업로드 75초가 날아가고 업로드 예산도 소모” |
| 근거 수치 | X-Upload-Retryable: 1 및 업로드한 파일로 다시 시도 버튼; 이후 유료 실패 재사용 문제까지 해결한 기록은 없음 |
| 출처 | [/Users/online/reports/easyapply-eval-20261106/rubric-2150/00-SUMMARY.md:29](/Users/online/reports/easyapply-eval-20261106/rubric-2150/00-SUMMARY.md:29)<br>[/Users/online/reports/easyapply-eval-20261106/rubric-2230/00-SUMMARY.md:39](/Users/online/reports/easyapply-eval-20261106/rubric-2230/00-SUMMARY.md:39)<br>[/private/tmp/claude-501/-Users-online/f163c745-bd33-487e-b4a2-2883237b9eb5/scratchpad/l3-timeline/.sources/1fce5a5-PRODUCTION_AUDIT.md:139](/private/tmp/claude-501/-Users-online/f163c745-bd33-487e-b4a2-2883237b9eb5/scratchpad/l3-timeline/.sources/1fce5a5-PRODUCTION_AUDIT.md:139)<br>[/Users/online/reports/easyapply-eval-20261106/deep-review-2225/backend/REPORT.md:166](/Users/online/reports/easyapply-eval-20261106/deep-review-2225/backend/REPORT.md:166) |

## D13 IP·세션 일일 제한을 추가한 뒤 심사용 기본 제한 해제

| 항목 | 기록 |
| --- | --- |
| 결정 | IP·세션 일일 제한을 추가한 뒤 심사용 기본 제한 해제 |
| 시각 | 추가 22:30 이전, 기본 해제 코드 22:48 |
| 검토한 대안 | 당시 IP/세션 20/24h·발급 30/24h·전체 100/24h·동시 3; on일 때만 적용으로 변경 |
| 택한 이유 | “기존 Redis 사용량이 소진되어 있어도 심사를 막지 않고, 같은 Wi-Fi의 심사위원들이 사용 횟수를 나눠 쓰지 않습니다.”라는 후속 README 설명 |
| 근거 수치 | Production에 EASYAPPLY_USAGE_LIMITS 없음, 같은 세션 중복 실행 방지 유지; 실제 계정 지출 상한 근거 없음 |
| 출처 | [/Users/online/reports/easyapply-eval-20261106/rubric-2230/00-SUMMARY.md:40](/Users/online/reports/easyapply-eval-20261106/rubric-2230/00-SUMMARY.md:40)<br>[/Users/online/reports/easyapply-eval-20261106/rubric-2300/01-plan-presentation.md:31](/Users/online/reports/easyapply-eval-20261106/rubric-2300/01-plan-presentation.md:31)<br>[/Users/online/reports/easyapply-eval-20261106/rubric-2300/00-SUMMARY.md:39](/Users/online/reports/easyapply-eval-20261106/rubric-2300/00-SUMMARY.md:39)<br>[/private/tmp/claude-501/-Users-online/f163c745-bd33-487e-b4a2-2883237b9eb5/scratchpad/l3-timeline/.sources/1fce5a5-PRODUCTION_AUDIT.md:11](/private/tmp/claude-501/-Users-online/f163c745-bd33-487e-b4a2-2883237b9eb5/scratchpad/l3-timeline/.sources/1fce5a5-PRODUCTION_AUDIT.md:11)<br>[/private/tmp/claude-501/-Users-online/f163c745-bd33-487e-b4a2-2883237b9eb5/scratchpad/l3-timeline/.sources/1fce5a5-README.md:92](/private/tmp/claude-501/-Users-online/f163c745-bd33-487e-b4a2-2883237b9eb5/scratchpad/l3-timeline/.sources/1fce5a5-README.md:92) |

## D14 신청 접수 마감과 후속 마감 구분 및 만료 체크리스트 치환

| 항목 | 기록 |
| --- | --- |
| 결정 | 신청 접수 마감과 후속 마감 구분 및 만료 체크리스트 치환 |
| 시각 | 구분 22:30 이전; 체크리스트 수정 22:44/22:46 불일치 |
| 검토한 대안 | 기존 모든 마감 혼용·만료 후 서류/제출 보충 |
| 택한 이유 | “마감 지났는데 제출 할 일 보충” |
| 근거 수치 | 21:00 raw 6→final 8; 22:45–22:50 테스트 A/C에 서류·제출 잔존, 후속 소스는 verify_reopening 앞 배치 |
| 출처 | [/Users/online/reports/easyapply-eval-20261106/rubric-2300/02-ai-process-major.md:62](/Users/online/reports/easyapply-eval-20261106/rubric-2300/02-ai-process-major.md:62)<br>[/Users/online/reports/easyapply-eval-20261106/rubric-2230/00-SUMMARY.md:41](/Users/online/reports/easyapply-eval-20261106/rubric-2230/00-SUMMARY.md:41)<br>[/Users/online/reports/easyapply-eval-20261106/rubric-2300/00-SUMMARY.md:24](/Users/online/reports/easyapply-eval-20261106/rubric-2300/00-SUMMARY.md:24)<br>[/Users/online/reports/easyapply-eval-20261106/deep-2230/02-ai-pipeline.md:62](/Users/online/reports/easyapply-eval-20261106/deep-2230/02-ai-pipeline.md:62)<br>[/private/tmp/claude-501/-Users-online/f163c745-bd33-487e-b4a2-2883237b9eb5/scratchpad/l3-timeline/.sources/1fce5a5-PRODUCTION_AUDIT.md:141](/private/tmp/claude-501/-Users-online/f163c745-bd33-487e-b4a2-2883237b9eb5/scratchpad/l3-timeline/.sources/1fce5a5-PRODUCTION_AUDIT.md:141) |

## D15 출력 상한 128,000으로 확대 후 분석 32,000·판정 16,000으로 재조정

| 항목 | 기록 |
| --- | --- |
| 결정 | 출력 상한 128,000으로 확대 후 분석 32,000·판정 16,000으로 재조정 |
| 시각 | 11-06 22:46 → 11-07 server-a 보고 구간 |
| 검토한 대안 | 분석 16k/판정 10k → 128,000 → 32,000/16,000; env로 1,000~128,000 |
| 택한 이유 | 후속 선택: “브리프대로 분석 32,000, 판정 16,000으로 낮췄고 env로 조정할 수 있습니다”; 128,000 채택 이유는 출처 없음 |
| 근거 수치 | 5쪽 실제 공고 13.6k(85%), 413 too_long 관측; 후속 요청 본문 32000/16000·env 48000 테스트 |
| 출처 | [/Users/online/reports/easyapply-eval-20261106/deep-review-2225/00-SUMMARY.md:15](/Users/online/reports/easyapply-eval-20261106/deep-review-2225/00-SUMMARY.md:15)<br>[/Users/online/reports/easyapply-eval-20261106/rubric-2300/02-ai-process-major.md:29](/Users/online/reports/easyapply-eval-20261106/rubric-2300/02-ai-process-major.md:29)<br>[/Users/online/reports/easyapply-eval-20261106/deep-2230/03-ux-live.md:27](/Users/online/reports/easyapply-eval-20261106/deep-2230/03-ux-live.md:27)<br>[/Users/online/reports/easyapply-eval-20261106/server-fixes-0130/CHANGES-A-infra.md:53](/Users/online/reports/easyapply-eval-20261106/server-fixes-0130/CHANGES-A-infra.md:53) §A3 출력 상한 |

## D16 결과 화면의 설명·숫자·기호를 제거

| 항목 | 기록 |
| --- | --- |
| 결정 | 결과 화면의 설명·숫자·기호를 제거 |
| 시각 | subtraction-2340; 보고서 저장 11-07 00:07, 실제 변경 분 시각 없음 |
| 검토한 대안 | 기존 제공자 배지·N/N 문장 일치·충족 집계·타이머·답변/완료 수 |
| 택한 이유 | “사람이 가진 질문과 상관없습니다”; “기계 검증 점수입니다” |
| 근거 수치 | 화면 문구 94→65·기계를 재는 숫자 6종→0·✓ 8→0·개인정보/면책 위치 4→2 |
| 출처 | [/Users/online/reports/easyapply-eval-20261106/subtraction-2340/CHANGES.md:24](/Users/online/reports/easyapply-eval-20261106/subtraction-2340/CHANGES.md:24) §지운 것과 이유 |

## D17 마감 안내를 먼저 표시하고 판정 대기 중 탭 이동 잠금

| 항목 | 기록 |
| --- | --- |
| 결정 | 마감 안내를 먼저 표시하고 판정 대기 중 탭 이동 잠금 |
| 시각 | subtraction-2340; 변경 분 시각 출처 없음 |
| 검토한 대안 | 기존 기본 내 조건 입력·판정 중 탭 이동 시 취소 |
| 택한 이유 | “이렇게 해서 탭을 옮길 때 요청이 조용히 취소되던 문제를 막았습니다.” |
| 근거 수치 | 기본 한눈에 보기·지난 캘린더 제외·판정 제목 포커스 144px; 저장 응답 재생·112/112·유료 API 0회 |
| 출처 | [/Users/online/reports/easyapply-eval-20261106/subtraction-2340/CHANGES.md:80](/Users/online/reports/easyapply-eval-20261106/subtraction-2340/CHANGES.md:80) §동작으로 고친 것 |

## D18 AI 한도 예약과 유료 호출 차감을 분리하고 IPv6 /64 사용

| 항목 | 기록 |
| --- | --- |
| 결정 | AI 한도 예약과 유료 호출 차감을 분리하고 IPv6 /64 사용 |
| 시각 | 11-07 server-a 표제 01:00–01:40; 완료 분 시각 불명 |
| 검토한 대안 | 기존 파싱 전 카운터 선차감 |
| 택한 이유 | “한도 선차감(P0)” 수리로 명시; 그 밖의 선택 이유는 출처 없음 |
| 근거 수치 | 수정 전 invalid_pdf 8·rate_limit 92·daily 8, 수정 후 100개 invalid_pdf·daily 0; 공급자 hits=2에도 daily=1 |
| 출처 | [/Users/online/reports/easyapply-eval-20261106/server-fixes-0130/CHANGES-A-infra.md:25](/Users/online/reports/easyapply-eval-20261106/server-fixes-0130/CHANGES-A-infra.md:25) §A1 한도 선차감 |

## D19 업로드 전역 예약 TTL을 티켓 수명 30분으로 제한

| 항목 | 기록 |
| --- | --- |
| 결정 | 업로드 전역 예약 TTL을 티켓 수명 30분으로 제한 |
| 시각 | 11-07 server-a 보고 구간 |
| 검토한 대안 | 소비 시점 차감 / 예약 TTL을 티켓 수명으로 |
| 택한 이유 | “소비 시점 차감은 이미 업로드한 사용자를 분석 직전에 거절하게 됩니다.” |
| 근거 수치 | 전역 30분·IP/세션 24시간; 24시간 점유에 30분마다 새 IP(/64) 10개 필요라는 보고서 계산 |
| 출처 | [/Users/online/reports/easyapply-eval-20261106/server-fixes-0130/CHANGES-A-infra.md:42](/Users/online/reports/easyapply-eval-20261106/server-fixes-0130/CHANGES-A-infra.md:42) §A2 업로드 예산 메타데이터 소진 |

## D20 bad_output·incomplete·일시 공급자 오류에 1회 재시도와 전체 시간 예산 적용

| 항목 | 기록 |
| --- | --- |
| 결정 | bad_output·incomplete·일시 공급자 오류에 1회 재시도와 전체 시간 예산 적용 |
| 시각 | 11-07 server-a 보고 구간 |
| 검토한 대안 | 기존 maxRetries=0·라우트 재시도 없음 |
| 택한 이유 | 출처 없음: A4 수리 항목과 정책은 명시되나 1회라는 횟수의 별도 선택 근거는 없음 |
| 근거 수치 | 전체 280초·LLM 기본 240초, retry-after>10초 또는 남은 시간<max(60초, 첫 시도 시간)이면 재시도 없음; 출력 한도 종료는 재시도하지 않음 |
| 출처 | [/Users/online/reports/easyapply-eval-20261106/server-fixes-0130/CHANGES-A-infra.md:63](/Users/online/reports/easyapply-eval-20261106/server-fixes-0130/CHANGES-A-infra.md:63) §A4 재시도·시간 예산·로그 |

## D21 Zod 전 결정적 수선 및 실패/usage 원인 로그 추가

| 항목 | 기록 |
| --- | --- |
| 결정 | Zod 전 결정적 수선 및 실패/usage 원인 로그 추가 |
| 시각 | 11-07 server-a 보고 구간 |
| 검토한 대안 | 기존 작은 형식 이탈도 전체 502·원인 로그 없음 |
| 택한 이유 | “스키마를 z.toJSONSchema로 읽어 범용으로 걷습니다. 그래서 다른 에이전트의 schema 변경(applies_to, date_uncertain 등)에도 그대로 동작합니다.” |
| 근거 수치 | 24:00→23:59·9:00→09:00·배열/문자열 상한·빈 인용 제거·ID 정리·쪽수 clamp; 수선 테스트 4개 |
| 출처 | [/Users/online/reports/easyapply-eval-20261106/server-fixes-0130/CHANGES-A-infra.md:88](/Users/online/reports/easyapply-eval-20261106/server-fixes-0130/CHANGES-A-infra.md:88) §A5 Zod 앞 수선 단계 |

## D22 업로드 상한을 Anthropic 22 MiB·그 밖 24 MiB로 분리

| 항목 | 기록 |
| --- | --- |
| 결정 | 업로드 상한을 Anthropic 22 MiB·그 밖 24 MiB로 분리 |
| 시각 | 11-07 server-a 보고 구간 |
| 검토한 대안 | 이전 25 MiB, 후속 24 MiB 공통 상한 |
| 택한 이유 | “요청 32 MB 한도에 base64 증가분 고려” |
| 근거 수치 | 23,068,673 B → 413 “22MB”, dev status max_upload_bytes=23068672; 상수 정리는 일부 미완료 |
| 출처 | [/private/tmp/claude-501/-Users-online/f163c745-bd33-487e-b4a2-2883237b9eb5/scratchpad/l3-timeline/.sources/1fce5a5-README.md:100](/private/tmp/claude-501/-Users-online/f163c745-bd33-487e-b4a2-2883237b9eb5/scratchpad/l3-timeline/.sources/1fce5a5-README.md:100)<br>[/Users/online/reports/easyapply-eval-20261106/server-fixes-0130/CHANGES-A-infra.md:100](/Users/online/reports/easyapply-eval-20261106/server-fixes-0130/CHANGES-A-infra.md:100) §A6 업로드 상한과 공급자 정합 |

## D23 세션 발급 30→200/일·활성 공급자만 설정 검증·typegen 선행

| 항목 | 기록 |
| --- | --- |
| 결정 | 세션 발급 30→200/일·활성 공급자만 설정 검증·typegen 선행 |
| 시각 | 11-07 server-a 보고 구간 |
| 검토한 대안 | 기존 30/일·OpenAI 설정으로 Anthropic 차단·tsc만 실행 |
| 택한 이유 | 출처 없음: A7–A9 수리 항목으로 명시 |
| 근거 수치 | 35개 동시 발급 성공, 카운터 199에서 1회 뒤 429, provider 오타 exit 1, typecheck는 next typegen && tsc --noEmit |
| 출처 | [/Users/online/reports/easyapply-eval-20261106/server-fixes-0130/CHANGES-A-infra.md:114](/Users/online/reports/easyapply-eval-20261106/server-fixes-0130/CHANGES-A-infra.md:114) §A7–A9 |

## D24 날짜와 접수 마감은 원문 대조 후 불확실하면 비우고 확인 필요로 하향

| 항목 | 기록 |
| --- | --- |
| 결정 | 날짜와 접수 마감은 원문 대조 후 불확실하면 비우고 확인 필요로 하향 |
| 시각 | 11-07 server-b 보고; 변경 분 시각 출처 없음 |
| 검토한 대안 | 기존 date_iso 형식만 검증·플래그 누락 시 만료 판단 없음 |
| 택한 이유 | “서버는 확신이 없으면 check(확인 필요)로 내린다.” |
| 근거 수치 | 기존 분석 32건·일정 157개 중 날짜 비움 2·정상 잘못 비움 0·마감 16건 올바른 추정; 두 번/JSON 재파싱 후 동일 |
| 출처 | [/Users/online/reports/easyapply-eval-20261106/server-fixes-0130/CHANGES-B-correctness.md:3](/Users/online/reports/easyapply-eval-20261106/server-fixes-0130/CHANGES-B-correctness.md:3) §B1·B2 / 검증 결과 |

## D25 판정 누락 조건은 check로 보충하고 검색 제안은 조건당 첫 항목만 유지

| 항목 | 기록 |
| --- | --- |
| 결정 | 판정 누락 조건은 check로 보충하고 검색 제안은 조건당 첫 항목만 유지 |
| 시각 | 11-07 server-b 보고; 변경 분 시각 출처 없음 |
| 검토한 대안 | 기존 조건 개수·검색 제안 중복 하나로 전체 502 |
| 택한 이유 | “모델 출력의 사소한 이탈은 받아 주되, 근거가 부족한 결론은 확정하지 않는다.” |
| 근거 수치 | 10개 중 9개만 와도 502 아님; 관련 없는 failed_answer_ids 제거·check, legacy failures 허용 제거 |
| 출처 | [/Users/online/reports/easyapply-eval-20261106/server-fixes-0130/CHANGES-B-correctness.md:64](/Users/online/reports/easyapply-eval-20261106/server-fixes-0130/CHANGES-B-correctness.md:64) §B4 판정 규칙 |

## D26 만 나이를 제한된 조건에서 서버 계산하고 애매하면 check

| 항목 | 기록 |
| --- | --- |
| 결정 | 만 나이를 제한된 조건에서 서버 계산하고 애매하면 check |
| 시각 | 11-07 server-b 보고; 변경 분 시각 출처 없음 |
| 검토한 대안 | 모델 조건별 met/not_met 수용; 여러 기준일 후보 |
| 택한 이유 | “그 기간이 기준이라서, 기준일을 추정하면 경계에 있는 사람을 틀리게 ‘불가’로 판정할 수 있다.” |
| 근거 수치 | 41세 met→not_met, 27세 not_met→met, 예외/연장·기준일 경계 check; 소득·거주기간 계산 안 함 |
| 출처 | [/Users/online/reports/easyapply-eval-20261106/server-fixes-0130/CHANGES-B-correctness.md:92](/Users/online/reports/easyapply-eval-20261106/server-fixes-0130/CHANGES-B-correctness.md:92) §B5 서버 만 나이 계산 |

## D27 HWPX 이미지 자체는 불확실 판정 사유에서 빼고 ZIP CRC/spine 검사

| 항목 | 기록 |
| --- | --- |
| 결정 | HWPX 이미지 자체는 불확실 판정 사유에서 빼고 ZIP CRC/spine 검사 |
| 시각 | 11-07 server-b 보고; 변경 분 시각 출처 없음 |
| 검토한 대안 | 기존 모든 HWP·이미지 든 HWPX에 uncertainLayout |
| 택한 이유 | “HWP 추출은 표 셀을 줄 단위로 풀어 버리기 때문이다.”(HWP 표의 불확실 처리 이유) |
| 근거 수치 | HWPX 병합 셀·HWP 표 레코드는 계속 불확실, 로고 1장 uncertainLayout=false; CRC 불일치·누락 section 거절 |
| 출처 | [/Users/online/reports/easyapply-eval-20261106/server-fixes-0130/CHANGES-B-correctness.md:117](/Users/online/reports/easyapply-eval-20261106/server-fixes-0130/CHANGES-B-correctness.md:117) §B6 HWPX 이미지·무결성 |

## D28 인용은 ±1쪽 exact 교정을 허용하고 원문자·NFD 정규화 수정

| 항목 | 기록 |
| --- | --- |
| 결정 | 인용은 ±1쪽 exact 교정을 허용하고 원문자·NFD 정규화 수정 |
| 시각 | 11-07 server-b 보고; 변경 분 시각 출처 없음 |
| 검토한 대안 | 지정 쪽만 exact 검사; 화면 전 쪽 검색과 불일치 |
| 택한 이유 | “그래서 ① 2회와 12회가 더는 같아지지 않는다.” |
| 근거 수치 | 정규화 12쌍·NFD 강조·±1쪽 테스트, 2쪽 떨어진 인용은 미검증; 100만 자 색인 88ms→194ms |
| 출처 | [/Users/online/reports/easyapply-eval-20261106/server-fixes-0130/CHANGES-B-correctness.md:134](/Users/online/reports/easyapply-eval-20261106/server-fixes-0130/CHANGES-B-correctness.md:134) §B7 인용 정규화·검증 범위 |

## D29 조건부 요건에 applies_to만 추가하고 큰 스키마 변경은 제외

| 항목 | 기록 |
| --- | --- |
| 결정 | 조건부 요건에 applies_to만 추가하고 큰 스키마 변경은 제외 |
| 시각 | 11-07 server-b 보고; 변경 분 시각 출처 없음 |
| 검토한 대안 | 조건 간 예외 관계·선택지 대응·상세 HWP 셀 해석 |
| 택한 이유 | “이번 범위(작은 diff, 선택 필드만)를 넘는다”; 단위·선택지 전달은 “‘한 줄 지시 추가만’이라는 범위를 넘는다” |
| 근거 수치 | applies_to가 있는 not_met→check, met 유지; 국취 예외·병역 우대 분리·선택지 혼합·조건 중복 감지는 미완료 |
| 출처 | [/Users/online/reports/easyapply-eval-20261106/server-fixes-0130/CHANGES-B-correctness.md:153](/Users/online/reports/easyapply-eval-20261106/server-fixes-0130/CHANGES-B-correctness.md:153) §B8 프롬프트·조건부 요건<br>[/Users/online/reports/easyapply-eval-20261106/server-fixes-0130/CHANGES-B-correctness.md:179](/Users/online/reports/easyapply-eval-20261106/server-fixes-0130/CHANGES-B-correctness.md:179) §못 고친 것과 이유 |

## D30 서버 수리 검증은 오프라인·가짜 공급자와 로컬 Redis로 수행하고 배포 보류

| 항목 | 기록 |
| --- | --- |
| 결정 | 서버 수리 검증은 오프라인·가짜 공급자와 로컬 Redis로 수행하고 배포 보류 |
| 시각 | 11-07 server-a/b 보고 |
| 검토한 대안 | 유료 실제 모델 호출·운영 배포 |
| 택한 이유 | 출처 없음: “배포하지 않았습니다. 유료 LLM 호출은 0회입니다”라고 실행 범위 명시 |
| 근거 수치 | A 152/152·B 153개 통과(불일치), B 새 correctness 23개·수정 전 21 실패/1 통과; A 중간 타 레인 11 실패 후 마지막 통과 |
| 출처 | [/Users/online/reports/easyapply-eval-20261106/server-fixes-0130/CHANGES-A-infra.md:3](/Users/online/reports/easyapply-eval-20261106/server-fixes-0130/CHANGES-A-infra.md:3)<br>[/Users/online/reports/easyapply-eval-20261106/server-fixes-0130/CHANGES-A-infra.md:21](/Users/online/reports/easyapply-eval-20261106/server-fixes-0130/CHANGES-A-infra.md:21)<br>[/Users/online/reports/easyapply-eval-20261106/server-fixes-0130/CHANGES-B-correctness.md:5](/Users/online/reports/easyapply-eval-20261106/server-fixes-0130/CHANGES-B-correctness.md:5) |

## D31 미충족 결과에는 준비·제출 대신 조건과 검색 제안 표시

| 항목 | 기록 |
| --- | --- |
| 결정 | 미충족 결과에는 준비·제출 대신 조건과 검색 제안 표시 |
| 시각 | 22:29 검증이라는 초안 기록; 최초 결정 분 시각 출처 없음 |
| 검토한 대안 | 기존 결과 흐름과 비교한 명시적 대안 기록 없음 |
| 택한 이유 | 출처 없음: 기능·검증 기록은 있으나 채택 이유 원문은 없음 |
| 근거 수치 | 초안의 소득 120% 미충족, 22:47 B not_met 3·검색 3·서류/제출 권유 0 |
| 출처 | [/Users/online/reports/easyapply-eval-20261106/deep-2230/_draft-product-timeline.md:13](/Users/online/reports/easyapply-eval-20261106/deep-2230/_draft-product-timeline.md:13)<br>[/private/tmp/claude-501/-Users-online/f163c745-bd33-487e-b4a2-2883237b9eb5/scratchpad/l3-timeline/.sources/1fce5a5-README.md:44](/private/tmp/claude-501/-Users-online/f163c745-bd33-487e-b4a2-2883237b9eb5/scratchpad/l3-timeline/.sources/1fce5a5-README.md:44)<br>[/Users/online/reports/easyapply-eval-20261106/rubric-2300/live/00-summary.json:1](/Users/online/reports/easyapply-eval-20261106/rubric-2300/live/00-summary.json:1) |

## D32 문서와 답변은 앱 DB에 저장하지 않고 임시 파일을 정리

| 항목 | 기록 |
| --- | --- |
| 결정 | 문서와 답변은 앱 DB에 저장하지 않고 임시 파일을 정리 |
| 시각 | 최초 결정 분 시각 출처 없음 |
| 검토한 대안 | 장기 작업 큐·분석 내역 보관은 AUDIT의 구현 범위 밖 |
| 택한 이유 | 출처 없음: 보관 정책은 명시되어 있으나 선택 이유는 없음 |
| 근거 수치 | OpenAI store:false, Anthropic 대응 옵션 미지정; Blob 4 MiB 초과 임시 저장·매일 정리·브라우저 체크 완료만 남음 |
| 출처 | [/private/tmp/claude-501/-Users-online/f163c745-bd33-487e-b4a2-2883237b9eb5/scratchpad/l3-timeline/.sources/1fce5a5-README.md:50](/private/tmp/claude-501/-Users-online/f163c745-bd33-487e-b4a2-2883237b9eb5/scratchpad/l3-timeline/.sources/1fce5a5-README.md:50)<br>[/private/tmp/claude-501/-Users-online/f163c745-bd33-487e-b4a2-2883237b9eb5/scratchpad/l3-timeline/.sources/1fce5a5-PRODUCTION_AUDIT.md:89](/private/tmp/claude-501/-Users-online/f163c745-bd33-487e-b4a2-2883237b9eb5/scratchpad/l3-timeline/.sources/1fce5a5-PRODUCTION_AUDIT.md:89) |

## D33 개발 의존성 moderate 8개에 권장 자동 수정을 적용하지 않음

| 항목 | 기록 |
| --- | --- |
| 결정 | 개발 의존성 moderate 8개에 권장 자동 수정을 적용하지 않음 |
| 시각 | 초기 운영 감사 구간; 결정 분 시각 출처 없음 |
| 검토한 대안 | npm audit 권장 자동 수정 |
| 택한 이유 | “권장 자동 수정은 Next ESLint 설정의 major downgrade여서 적용하지 않음” |
| 근거 수치 | 운영 의존성 취약점 0, 전체 개발 도구 moderate 8개 |
| 출처 | [/private/tmp/claude-501/-Users-online/f163c745-bd33-487e-b4a2-2883237b9eb5/scratchpad/l3-timeline/.sources/1fce5a5-PRODUCTION_AUDIT.md:49](/private/tmp/claude-501/-Users-online/f163c745-bd33-487e-b4a2-2883237b9eb5/scratchpad/l3-timeline/.sources/1fce5a5-PRODUCTION_AUDIT.md:49) §실제 검증 결과 (OpenAI 운영 당시) |

## D34 Git 연결 없이 Vercel CLI 배포·수정 전 소스 백업

| 항목 | 기록 |
| --- | --- |
| 결정 | Git 연결 없이 Vercel CLI 배포·수정 전 소스 백업 |
| 시각 | 11-06 운영 배포; 정확한 결정 분 시각 출처 없음 |
| 검토한 대안 | Git 저장소 연결 배포는 구현되어 있지 않았음; 대안 검토 원문 없음 |
| 택한 이유 | “기존 폴더에 Git 메타데이터가 없어 커밋은 만들지 않았습니다.” |
| 근거 수치 | release.json gitRepository=false; 수정 전 before/ 보존·환경파일 제외, 이후 소스 변경은 자동 배포되지 않음 |
| 출처 | [/private/tmp/claude-501/-Users-online/f163c745-bd33-487e-b4a2-2883237b9eb5/scratchpad/l3-timeline/.sources/1fce5a5-PRODUCTION_AUDIT.md:79](/private/tmp/claude-501/-Users-online/f163c745-bd33-487e-b4a2-2883237b9eb5/scratchpad/l3-timeline/.sources/1fce5a5-PRODUCTION_AUDIT.md:79)<br>[/private/tmp/claude-501/-Users-online/f163c745-bd33-487e-b4a2-2883237b9eb5/scratchpad/l3-timeline/.sources/1fce5a5-PRODUCTION_AUDIT.md:93](/private/tmp/claude-501/-Users-online/f163c745-bd33-487e-b4a2-2883237b9eb5/scratchpad/l3-timeline/.sources/1fce5a5-PRODUCTION_AUDIT.md:93)<br>[/Users/online/reports/easyapply-production-20261106/release.json:172](/Users/online/reports/easyapply-production-20261106/release.json:172) |

## D35 첫 화면 중간안으로 서비스 설명 일부 복원

| 항목 | 기록 |
| --- | --- |
| 결정 | 첫 화면 중간안으로 서비스 설명 일부 복원 |
| 시각 | 01:45 Git 스냅샷, 01:46 생성·01:47 승격이라는 문서 기록 |
| 검토한 대안 | 00:36 문구 정리 화면; STEP 카드·홍보 문단은 복원하지 않음 |
| 택한 이유 | “00:36 배포에서 빠진 서비스 설명을 되살림” |
| 근거 수치 | EasyApp.tsx 1파일·122 insertions/86 deletions, Git 메시지 검증 153/153·1280/390; 배포 소스 검증은 별도로 112/112 |
| 출처 | [/private/tmp/claude-501/-Users-online/f163c745-bd33-487e-b4a2-2883237b9eb5/scratchpad/l3-timeline/.sources/git-log-stat.txt:15](/private/tmp/claude-501/-Users-online/f163c745-bd33-487e-b4a2-2883237b9eb5/scratchpad/l3-timeline/.sources/git-log-stat.txt:15) §커밋 068c75d<br>[/private/tmp/claude-501/-Users-online/f163c745-bd33-487e-b4a2-2883237b9eb5/scratchpad/l3-timeline/.sources/10346f8-PRODUCTION_AUDIT.md:9](/private/tmp/claude-501/-Users-online/f163c745-bd33-487e-b4a2-2883237b9eb5/scratchpad/l3-timeline/.sources/10346f8-PRODUCTION_AUDIT.md:9) |

## D36 서버 수리분과 분리해 첫 화면 변경만 배포

| 항목 | 기록 |
| --- | --- |
| 결정 | 서버 수리분과 분리해 첫 화면 변경만 배포 |
| 시각 | 01:50 기준 README/AUDIT; 결정 분 시각은 출처 없음 |
| 검토한 대안 | main 서버 수리분 1fce5a5 / 00:36 배포 기반 release-landing |
| 택한 이유 | “독립 검토(Codex)에서 차단 결함 3건(연령 계산이 다른 미충족을 덮음, 수선이 필수 조건을 삭제, 상시 모집 시작일을 마감으로 확정)이 나와 수정 전까지 배포하지 않습니다.”라는 기록 |
| 근거 수치 | 서버 수리분은 테스트 153개 기록에도 미배포; release-landing은 112/112·분석 40.1초·판정 9.4초 기록 |
| 출처 | [/private/tmp/claude-501/-Users-online/f163c745-bd33-487e-b4a2-2883237b9eb5/scratchpad/l3-timeline/.sources/10346f8-PRODUCTION_AUDIT.md:9](/private/tmp/claude-501/-Users-online/f163c745-bd33-487e-b4a2-2883237b9eb5/scratchpad/l3-timeline/.sources/10346f8-PRODUCTION_AUDIT.md:9)<br>[/private/tmp/claude-501/-Users-online/f163c745-bd33-487e-b4a2-2883237b9eb5/scratchpad/l3-timeline/.sources/10346f8-README.md:11](/private/tmp/claude-501/-Users-online/f163c745-bd33-487e-b4a2-2883237b9eb5/scratchpad/l3-timeline/.sources/10346f8-README.md:11)<br>[/private/tmp/claude-501/-Users-online/f163c745-bd33-487e-b4a2-2883237b9eb5/scratchpad/l3-timeline/.sources/git-log-stat.txt:33](/private/tmp/claude-501/-Users-online/f163c745-bd33-487e-b4a2-2883237b9eb5/scratchpad/l3-timeline/.sources/git-log-stat.txt:33) §커밋 1fce5a5 |

