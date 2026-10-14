# Traini — 개인 러닝 코치

현재 개인용 MVP로 전환 중입니다. 기존 Google 계정 하나로 로그인하고, 로컬 Python 수집기로
Garmin 러닝 FIT 원본을 가져옵니다. 기존 화면의 훈련·분석 데이터는 아직 프로토타입이며
수집한 파일의 DB 전송과 목표 기간 기반 계획 생성은 다음 구현 단계입니다.

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

## 개인용 Google 로그인

Google 로그인과 Supabase의 기존 UUID를 유지합니다. Apple 로그인과 가입 UI는 제공하지 않습니다.
`.env.local`의 기존 Supabase 설정을 사용해서 다음 명령으로 관리자 Google 계정을 선택합니다.

```sh
npm run admin:setup
npm run dev
```

설정 명령은 Supabase Auth 계정 목록만 읽고 선택한 UUID를 로컬 `.env.local`의
`TRAINI_ADMIN_USER_ID`에 저장합니다. 계정·이름·race_name·생성일을 변경하지 않습니다.
관리자 설정이 없으면 접근을 차단합니다. 배포 시에는 동일한 UUID를 서버 환경변수로
등록해야 합니다. Service role 키를 브라우저 환경변수에 넣지 마세요.
Supabase Auth의 Google provider와 OAuth redirect URL(`/auth/callback`) 설정은 유지합니다.

화면 진입과 훈련 생성·리뷰 API는 서버에서 검증된 관리자 토큰을 요구합니다.
기존 Garmin OAuth 코드는 승인 기반 연동을 위한 이전 구현으로, 로컬 수집기에서는 사용하지 않습니다.
로컬 수집기에 웹 버튼·Supabase 전송·자동 스케줄은 아직 연결하지 않았습니다.

## 확인 명령

```sh
collector/.venv/bin/python -m unittest discover -s collector/tests -v
npm run test:admin
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
