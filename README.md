# Traini — 개인 러닝 코치

개인용 MVP로 기존 Google 관리자 계정과 로컬 Garmin FIT 수집기를 사용합니다.
FIT 분석 결과는 Supabase `activities`에 저장하고, 오늘·Garmin 관리 화면에 실제 주간 요약을 표시합니다.
ChatGPT 구독 연결 후 목표·훈련 요일·러닝 기록으로 주간 계획을 생성하고 오늘·일정에 반영합니다.

지난주 가져오기 버튼은 수집·FIT 분석·업로드·주간 요약 갱신을 실행합니다. 계획 생성은 별도의 수동 동작이며,
Garmin 활동은 훈련 날짜·거리·세션 근거로 계획에 연결하며, 애매한 기록은 직접 확인합니다.
자동 주간 리뷰·로드맵 단계 및 분석 화면의 추정치는 후속 구현 범위입니다.
수면·회복 데이터가 없으면 오늘 화면에서 미수집 상태로 표시합니다.
[Garmin 완료 연결과 검증 안내](docs/garmin-workout-matching.md)를 참고하세요.

## Garmin 수집기

```sh
python3 -m venv collector/.venv
collector/.venv/bin/python -m pip install -r collector/requirements.lock -e ./collector
collector/.venv/bin/traini-collect
```

Python 3.12 이상이 필요합니다. 기본 조회 범위는 설정한 시간대 기준으로 완료된 지난 월요일~일요일입니다.
오늘 포함 최근 7일은 `--days 7`, 한국 시간대는 `--timezone Asia/Seoul`로 지정합니다.
FIT는 `~/Projects/Traini-data/garmin/activities/`, 인증 토큰은
`~/Library/Application Support/Traini/auth/`에 저장합니다.
설치·재인증·날짜 지정·오류 처리는 [수집기 안내](collector/README.md)를 참고하세요.

## FIT 분석·전처리

수집기 의존성을 최신 잠금 파일로 설치한 뒤 실행합니다. Garmin 로그인이나 네트워크 연결은 필요하지 않습니다.

```sh
collector/.venv/bin/python -m pip install -r collector/requirements.lock -e ./collector
collector/.venv/bin/traini-parse --timezone America/Los_Angeles
```

기본 데이터 폴더의 `activities/`에 있는 FIT를 모두 분석하고 `normalized/활동ID.json`에 저장합니다.
원본은 수정하지 않으며, 같은 결과는 다시 저장하지 않습니다. 파일별 실패는 `parse-state.json`에
기록되고 다른 파일 분석은 계속됩니다. 이 명령은 과거 FIT 전체를 수동으로 재분석할 때 사용합니다.

단위·누락 값·이동 시간과 타이머 시간의 차이·재처리 정책은
[FIT 정규화 계약](collector/docs/fit-normalization.md)에 정리했습니다.

## Supabase에 러닝 기록 저장

기존 `.env.local`의 Supabase 서버 키, 관리자 UUID, 수집기 Python 경로를 사용합니다.
원본·분석 결과를 확인한 뒤 업로드합니다.

```sh
npm run garmin:upload -- --dry-run
npm run garmin:upload
```

완료된 분석 결과만 원본 FIT로 다시 검증해 기존 `activities`에 저장합니다. 같은 활동은 중복
생성하지 않으며 변경 내용만 갱신합니다. 업로드 명령은 프로필·목표를 만들거나 덮어쓰지 않습니다.
기존 이름·race_name·계정 UUID는 유지합니다. 마이그레이션·RLS 테스트·복구 절차와 테이블별
용도는 [활동 저장 안내](collector/docs/activity-storage.md)를 참고하세요.

## 개인용 Google 로그인

Google 로그인과 Supabase의 기존 UUID를 유지합니다. Apple 로그인과 가입 UI는 제공하지 않습니다.
`.env.local`의 기존 Supabase 설정을 사용해서 다음 명령으로 관리자 Google 계정을 선택합니다.

```sh
npm run admin:setup
npm run dev
```

설정 명령은 기존 Google 계정을 선택해 UUID를 로컬 `.env.local`의
`TRAINI_ADMIN_USER_ID`에 저장하고, DB의 단일 관리자 접근 정책과 동기화합니다.
기존 UUID가 이미 설정되어 있으면 `npm run admin:sync`로 DB 정책만 동기화할 수 있습니다. 계정·이름·race_name·생성일을 변경하지 않습니다.
관리자 설정이 없으면 접근을 차단합니다. 배포 시에는 동일한 UUID를 서버 환경변수로
등록해야 합니다. Service role 키를 브라우저 환경변수에 넣지 마세요.
Supabase Auth의 Google provider와 OAuth redirect URL(`/auth/callback`) 설정은 유지합니다.

Google 로그인은 PKCE와 쿠키 기반 SSR 세션을 사용합니다. Proxy와 서버 레이아웃은
페이지를 보내기 전에 관리자를 확인하고, 모든 API도 서버에서 별도로 검증합니다.
비로그인 API 요청은 401, 비관리자는 403이며 쿠키 기반 변경 요청은 동일 Origin을 요구합니다.
Supabase RLS에도 관리자 조건을 추가해 다른 계정의 직접 데이터 접근을 차단합니다.
기존 localStorage 로그인은 자동 이전하지 않으므로 최초 한 번 Google 로그인이 필요합니다.
[인증 구조·설정·검증 안내](docs/admin-session-proxy.md)를 참고하세요.
승인 기반 Garmin OAuth와 웹훅 API는 종료되어 관리자 인증 후 HTTP 410을 반환합니다. 과거 연결 테이블은
`traini_legacy` 스키마로 보관하며 로컬 Garmin 토큰은 DB로 보내지 않습니다.
오늘 화면의 **지난주 가져오기** 버튼 또는 `/garmin-connect`에서 로컬 수집기를 실행할 수 있습니다.
아래 서버 환경변수를 `.env.local`에 설정하고 개발 서버를 다시 시작합니다.

```dotenv
TRAINI_LOCAL_COLLECTOR_ENABLED=true
TRAINI_COLLECTOR_PYTHON=/absolute/path/to/traini/collector/.venv/bin/python
TRAINI_TIMEZONE=America/Los_Angeles
```

Python 경로는 설치한 가상환경의 절대 경로로 바꾸세요. 최초 Garmin 로그인은 위 CLI로 완료해야 합니다.
버튼은 Mac에서 실행 중인 Next 서버와 저장된 Garmin 인증을 사용합니다. Vercel에서는 비활성화됩니다.
진행 중에는 중복 실행을 막고, 새로고침 후에도 마지막 실행 결과를 확인할 수 있습니다.
상세 설정과 재인증 방법은 [수집기 안내](collector/README.md#traini에서-가져오기)를 참고하세요.
버튼은 지난주에 확인한 활동만 수집 → 분석 → 업로드하고 주간 요약을 자동 갱신합니다.
저장·갱신 / 기존 기록 / 실패를 구분하며, 일부 실패 후 재실행해도 중복 저장되지 않습니다.
[통합 가져오기와 복구 정책](collector/docs/garmin-import-pipeline.md)을 참고하세요.
훈련 계획은 별도 수동 생성하며 예약 자동 실행은 후속 단계입니다.

## 주간 러닝 요약

오늘 화면과 Garmin 관리 화면에서 이번 주/지난주를 선택합니다. 설정된 훈련 시간대에서
월요일부터 일요일까지 시작한 본인의 검증된 러닝 활동만 집계합니다. 평균 페이스는 거리와
타이머 시간이 모두 있는 활동들의 합계로 계산하며 누락 값은 표시합니다. 실제 주간 목표가
생성되기 전에는 예시 거리 목표나 달성률을 보여주지 않습니다.

Garmin 관리 화면에는 해당 주의 활동 목록을 함께 보여줍니다. 수동 업로드 후에는 새로고침
버튼이나 창으로 돌아올 때 최신 값을 확인할 수 있습니다. 조회 실패를 기록 0개로 처리하지 않습니다.
집계·시간대·접근 제어 정책은 [주간 요약 안내](collector/docs/weekly-running-summary.md)에 정리했습니다.

## 확인 명령

```sh
collector/.venv/bin/python -m unittest discover -s collector/tests -v
npm run test:admin
npm run test:garmin
npm run test:summary
npx tsc --noEmit
npm run lint
npm run build
```

실제 Garmin 인증과 Google OAuth 완료는 본인 계정으로 별도 확인해야 합니다.

---

## 초기 제품 구상 (프로토타입 참고)

# Traini 🏃

> Garmin-powered adaptive running coach  
> The right training for your body, every week.

Traini is a data-driven running coaching service that analyzes Garmin running and recovery data to generate training plans tailored to each runner’s current condition.

Instead of presenting a fixed multi-month schedule, Traini provides a long-term training roadmap and adaptive 1–2 week training plans that evolve with the runner’s performance and recovery.

---

## Problem

Most marathon and long-distance training plans are fixed months in advance. In reality, a runner’s condition changes constantly depending on sleep, heart rate, completed workouts, fatigue, and weather.

Fixed plans can lead to:

- Training through poor recovery or fatigue
- Increased risk of overtraining and injury
- Psychological pressure from seeing months of workouts at once
- Difficulty understanding how today’s workout supports a long-term goal

Traini turns Garmin data into actionable, short-term training guidance while keeping the long-term goal visible.

---

## Core Value

- **See the big picture, focus on this week.**  
  Users can understand their long-term training direction without being overwhelmed by a full training calendar.

- **Adapt training to real condition.**  
  Running activity, heart rate, sleep score, HRV, and training load inform every new plan.

- **Reduce unnecessary strain.**  
  When recovery is low, Traini can recommend lighter runs, reduced intensity, or rest.

- **Explain the reason behind the workout.**  
  Traini does not only provide distance and pace. It explains the runner’s current condition, training purpose, and next best step.

---

## Key Features

### 1. Garmin Data Connection

Users can connect their Garmin account to import recent activity and recovery data.

- Recent running activities
- VO₂ Max
- Average heart rate
- Sleep score
- HRV and stress indicators
- Weekly distance and training frequency

> Garmin data is used to generate personalized training recommendations and recovery insights.

### 2. Running Baseline Analysis

After connecting Garmin, Traini creates a comprehensive analysis of the user’s current running condition.

- Current running level based on VDOT
- Estimated 5K, 10K, half marathon, and marathon times
- Weekly training volume and consistency analysis
- Sleep and recovery analysis
- Training load analysis
- Personalized strengths, improvement areas, and recovery insights

Example:

> Your heart rate has become more stable at similar paces.  
> This is a good time to maintain your aerobic base and gradually introduce threshold training.

### 3. Goal Setting

Users can set their own running goal.

- Select goal distance: 5K / 10K / Half Marathon / Marathon
- Set target finish time
- Set target date
- Compare current predicted time with goal time
- View goal difficulty guidance

> Traini does not provide race discovery, race schedule recommendations, or event registration features.

### 4. Long-Term Training Roadmap

Traini provides a high-level, phase-based training strategy toward the user’s target.

The roadmap is not a fixed day-by-day training calendar. It helps users understand their current phase, the next phase, and the purpose of each stage.

- Base building and mileage development
- Aerobic capacity and threshold development
- Race pace adaptation
- Tapering and race-day preparation

Each phase includes:

- Training objective
- Recommended weekly mileage range
- Key workout types
- Current progress status
- Focus areas for the current phase

### 5. Adaptive 1–2 Week Training Plan

Rather than giving users a fixed long-term schedule, Traini creates a short, adaptable training plan based on current data.

Each workout card includes:

- Workout type: easy run, threshold run, interval, LSD, rest, etc.
- Target distance
- Target pace
- Target heart-rate zone
- Workout purpose
- Weather and fatigue-based pace adjustments

### 6. Today’s Workout

The home screen highlights the most important action: today’s workout.

- Workout type and target distance
- Target pace and heart-rate zone
- Weather-based pace adjustment
- Sleep, HRV, and recovery summary
- Start workout with Garmin
- Weekly training progress

### 7. Weekly Review and Plan Adjustment

After workouts are completed, Traini analyzes new Garmin data and adjusts the next training plan.

- Workout completion analysis
- Heart-rate trend analysis
- Recovery status analysis
- Weekly training load analysis
- Distance and pace adjustment for the following week
- Lower-intensity workout or rest recommendation when fatigue is high

Example:

> Your recent sleep score and HRV indicate that you need more recovery.  
> Next week’s interval session will be replaced with an easy run.

---

## User Flow

```text
Sign in
  ↓
Connect Garmin account
  ↓
Running baseline analysis
  ↓
Set goal distance, target time, and target date
  ↓
Generate long-term training roadmap
  ↓
Receive weekly training plan
  ↓
Complete workouts and sync Garmin data
  ↓
Review performance and adjust the next plan
```

## 훈련 입력 데이터

`/my/goals` 또는 `/goal-setting`에서 실제 목표와 훈련 가능 요일·장거리 요일을 저장합니다.
`/my/goals`와 Garmin 관리 화면에서 목표의 누락 항목 및 최근 8주 기록의 수집 범위를 확인할 수 있습니다.
`GET /api/training/context`는 관리자에게만 버전이 있는 입력 데이터를 반환하며, 기록이 없는 주를
휴식이나 0km로 가정하지 않습니다. 이 단계에서는 OpenAI 호출이나 훈련계획 생성을 하지 않습니다.

새 환경에는 `20261016000000_add_training_availability.sql` 마이그레이션을 적용해야 합니다.
목표 저장·단위·주간 경계·오류·검증 방법은 [훈련 입력 데이터 안내](collector/docs/training-context.md)를 참고하세요.

## 로컬 ChatGPT 구독 연결

`/my/goals`의 **ChatGPT 연결 준비 → Continue with ChatGPT**에서 OpenAI 로그인과
권한 승인을 직접 진행합니다. 기존 Google 관리자 로그인과 별도이며 API 키는 필요하지 않습니다.
연결 토큰은 이 Mac의 보호된 폴더에만 저장하고, 연결 후 실제 사용 가능한 모델을 확인합니다.
구독 연결은 로컬 Mac 전용이며, 오늘·일정의 별도 버튼으로 훈련계획을 생성합니다.
설정·제약·실패 처리·테스트는 [ChatGPT 연결 안내](docs/chatgpt-connection.md)를 참고하세요.

## 주간 훈련계획

오늘·일정에서 ChatGPT 구독으로 이번 주 남은 날짜 또는 다음 주의 계획을 생성합니다.
같은 입력의 저장된 계획은 재호출 없이 반환하고, 변경된 목표·기록으로 업데이트할 때는 완료 훈련을 보존합니다. 실제 목표와 러닝 기록을 검증한 결과만
Supabase에 원자적으로 저장합니다. 오늘의 러닝 훈련은 직접 완료로 표시할 수 있습니다.
검증 규칙·중복 요청 방지·누락 데이터·실행 방법은 [주간 계획 안내](docs/weekly-training-plan.md)를 참고하세요.

주간 훈련 리뷰의 집계 기준, AI 검증·저장, 다음 계획 반영 및 테스트 방법은 [주간 리뷰 문서](docs/weekly-training-review.md)에 정리되어 있습니다.
