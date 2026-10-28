# 문서 지도

[Traini 소개](../README.md)에서 구현 범위를 먼저 확인한 뒤, 목적에 맞는 문서로 이동하세요.
이 문서들은 현재 코드의 동작을 설명합니다. 날짜가 붙은 과거 검증 결과는 당시의 기록이며,
현재 환경의 테스트 통과나 외부 제공자의 이용 가능성을 보장하지 않습니다.

## 실행·운영

| 문서 | 내용 |
| --- | --- |
| [개인 서비스 가이드](personal-service-guide.md) | 설치, 환경변수, 최초 연결, 주간 사용, 데이터 경계 |
| [검증·출시 확인](service-readiness.md) | 검사의 종류, 운영 확인 항목, 포트폴리오 공개 기준 |
| [운영·복구](service-reliability.md) | 실행 상태, 가져오기·생성 실패 복구, 생성 한도 |
| [CI](continuous-integration.md) | GitHub Actions, 필수 검사, 실패 보고서, 로컬 재현 |
| [관리자 인증](admin-session-proxy.md) | Google 로그인, SSR 쿠키, Proxy, API·RLS 접근 제어 |
| [ChatGPT 연결](chatgpt-connection.md) | 로컬 연결·갱신·해제, 개인 토큰 저장, 제공자 제약 |

## 기록 수집·정규화

| 문서 | 내용 |
| --- | --- |
| [수집기 사용](../collector/README.md) | Garmin 최초 로그인, CLI 날짜 지정, 웹 가져오기 |
| [통합 가져오기](../collector/docs/garmin-import-pipeline.md) | 수집 → 분석 → 업로드, 잠금, 부분 실패와 재실행 |
| [FIT 계약](../collector/docs/fit-normalization.md) | 단위·출처·누락 값·랩·원본 보존 |
| [활동 저장](../collector/docs/activity-storage.md) | 원본 재검증, 멱등 저장, DB 권한과 복구 |
| [주간 러닝 요약](../collector/docs/weekly-running-summary.md) | 월~일 분류, 가중 페이스·누락 값·조회 실패 |
| [훈련 입력](../collector/docs/training-context.md) | 목표·훈련 요일·최근 기록의 입력 계약 |

- [개인 코칭 화면 개선](personal-coaching-refinement.md): 평일 최신 기록 가져오기, 핵심 요약, 인증 범위 내 갱신 유지.

## 훈련·피드백

| 문서 | 내용 |
| --- | --- |
| [주간 계획](weekly-training-plan.md) | 명시적 생성, 검증, 트랜잭션 저장과 완료 보존 |
| [계획 생성·검증 계약](training-plan-validation.md) | 최종 거리 재계산, 응답 스키마, 세부 실패 사유와 오프라인 재현 |
| [다중 목표·훈련 처방](training-prescription-refinement.md) | 여러 대회, 세션별 거리·페이스·반복·회복 제약 |
| [대회 단계](race-stage-policy.md) | 준비·테이퍼·대회·회복 및 복귀 확인 |
| [Garmin 수행 연결](garmin-workout-matching.md) | 자동 연결 조건, 애매한 기록의 직접 확인 |
| [피드백·건너뜀](workout-feedback.md) | 뒤늦은 입력, RPE·피로·통증, 건너뜀 사유와 수정 |
| [주간 마감](weekly-training-closeout.md) | 일요일 현재 주 마감, 월요일 전환, 근거 변경 시 재확인 |
| [주간 리뷰](weekly-training-review.md) | 수행 평가, 제한된 제안, 다음 계획과의 정확한 연결 |
| [코칭 설명](coaching-copy-refinement.md) | 검증된 핵심 평가와 실제 저장 계획 반영 설명의 구분 |
| [훈련 진행](training-progress-insights.md) | 로드맵·분석·마이의 실제 기록과 계산 기준 |
| [날씨 참고](weather-training-adjustment.md) | 위치 요청, 예보 범위, 원래 계획을 보존하는 참고 안내 |

## 검증

- [브라우저 회귀 검사](weekly-coaching-e2e.md): 합성 데이터로 실행하는 9개 시나리오와 실제 서버 검사의 경계.
- [개인 계획 인수 확인](personal-training-plan-validation.md): 실제 입력으로 저장된 계획을 읽고 제약을 확인하는 별도 검사.
- [검증·출시 확인](service-readiness.md): AI 호출 없는 기본 검사와 실제 DB·외부 서비스 검사를 구분하는 기준.

## 코드에서 확인할 위치

| 경로 | 역할 |
| --- | --- |
| `app/`, `components/` | 페이지·API 진입점, 인증 레이아웃, 실제 데이터 카드와 공통 모바일 프레임 |
| `proxy.ts`, `lib/auth/`, `lib/security/`, `lib/supabase/` | 서버 인증, 관리자 검사, 요청 검증과 DB 클라이언트 |
| `lib/garmin/`, `collector/traini_collector/` | 주간 분류, 로컬 수집·FIT 분석·검증 업로드 |
| `lib/training/` | 목표·훈련 제약, 수행 연결·피드백, 생성·리뷰·마감·저장 |
| `lib/weather/`, `lib/services/weather.ts` | 날씨 유효성, 참고 규칙, 제공자 요청·캐시 |
| `scripts/lib/chatgpt-*.mjs` | 로컬 구독 인증과 추론 전송 |
| `supabase/migrations/`, `supabase/tests/` | 스키마·RLS·RPC 변경과 트랜잭션 검사 |
| `tests/`, `tests/e2e/`, `collector/tests/` | 오프라인·브라우저·수집기 검사 |

저장소에 남아 있는 `lib/services/training.ts`, `lib/algorithms/vdot.ts`,
`lib/algorithms/fatigue.ts` 같은 초기 유틸리티의 존재만으로 서비스 기능을 판단하지 않습니다.
현재 페이지·API가 사용하는 경로와 위 기능별 문서를 기준으로 확인합니다.
