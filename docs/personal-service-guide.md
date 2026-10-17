# 개인 서비스 가이드

Traini를 실행하는 Mac에서 설정합니다. 웹 관리자 로그인, Garmin 수집기 로그인,
ChatGPT 구독 연결은 서로 다른 인증입니다. 이미 설정한 환경을 재실행할 때마다
세 계정을 다시 만들거나 DB 마이그레이션을 재적용할 필요는 없습니다.

## 1. 기존 환경 재실행

프로젝트 루트에서 다음 명령을 실행합니다. 잠금 파일이 바뀌었거나 새로 설치할 때는 먼저 `npm ci`를 실행합니다.

```sh
npm run service:check
npm run dev -- --port 3017
```

[오늘 화면](http://localhost:3017/today)을 열고 관리자 Google 계정으로 로그인합니다.
`service:check`는 DB·관리자 설정, 실행 가능한 Python 경로, 로컬 ChatGPT 연결 기록과
생성 상태를 확인하는 조회 명령입니다. Garmin 로그인, 연결 토큰 갱신이나 실제 추론은 하지 않습니다.
`localCollector: true`는 Python 경로가 준비됐다는 뜻이며 Garmin 인증 성공을 보증하지 않습니다.
`chatgptConnected: true` 역시 다음 제공자 요청의 성공을 보증하지 않습니다.

프로덕션 모드가 필요하면 기존 개발 서버를 먼저 종료하고 실행합니다.

```sh
npm run build
npm run start -- --port 3017
```

포트 하나에서 개발·프로덕션 서버를 동시에 실행하지 않습니다.

## 2. 최초 환경 준비

### 의존성 설치

macOS, Node.js 22(`.nvmrc`), Python 3.12 이상이 필요합니다.

```sh
npm ci
python3 -m venv collector/.venv
collector/.venv/bin/python -m pip install -r collector/requirements.lock
collector/.venv/bin/python -m pip install --no-deps -e ./collector
collector/.venv/bin/python -m pip check
```

### 환경변수

새 환경에 `.env.local`이 없을 때만 `.env.example`을 복사합니다. 기존 비밀 파일을 덮어쓰지 않습니다.
실제 값은 편집기에서 직접 입력하고 Git·이슈·스크린샷에 포함하지 않습니다.

| 설정 | 용도·범위 |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | 연결할 Supabase URL. 브라우저에서도 사용하는 공개 설정 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 브라우저 Supabase 클라이언트용 키. 권한은 세션·RLS로 제한 |
| `SUPABASE_SERVICE_ROLE_KEY` | 서버 전용 DB 권한. `NEXT_PUBLIC_` 접두사를 붙이지 않음 |
| `TRAINI_ADMIN_USER_ID` | 기존 Google 관리자 UUID. 서버 설정과 DB allowlist를 일치시킴 |
| `TRAINI_LOCAL_COLLECTOR_ENABLED` | 로컬 Mac 웹 수집을 명시적으로 허용하려면 `true` |
| `TRAINI_COLLECTOR_PYTHON` | 설치한 `collector/.venv/bin/python`의 절대 경로 |
| `TRAINI_TIMEZONE` | 모든 훈련 날짜의 기준 IANA 시간대. 기본 `America/Los_Angeles` |
| `WEATHER_API_KEY` | 선택적 OpenWeather 서버 키. 없으면 날씨 조회를 이용할 수 없음 |

환경변수 변경 후 서버를 재시작합니다. 현재 생성 경로에는 `OPENAI_API_KEY`가 필요하지 않습니다.

### DB와 관리자

이 저장소는 기존 개인 Supabase 프로젝트를 기준으로 작성했습니다. 업로더·관리 명령·일부 통합 검사에는
프로젝트 대상 확인이 있으므로 **다른 프로젝트의 URL·키만 넣어서는 전체 흐름이 동작하지 않습니다.**
이 제한을 포함한 이식 작업은 이번 문서 정리 범위에 포함되지 않습니다.

기존 프로젝트의 스키마를 준비할 때는 연결 대상과 미적용 목록부터 확인합니다.

```sh
npx supabase login
npx supabase migration list --linked
```

프로젝트 연결이 없다면 먼저 자신의 대상 프로젝트에 연결하고, 마이그레이션을 검토한 뒤
`npx supabase db push --linked`를 실행합니다. 기존 DB를 reset하거나 이미 적용된 SQL을 반복 실행하지 않습니다.
새 프로젝트는 스키마 적용만으로 앱 설정·프로필·기존 Google 계정이 모두 생기는 것이 아닙니다.

Supabase Auth의 Google provider와 사용 중인 주소의 `/auth/callback` redirect 설정이 필요합니다.
`admin:setup`은 **이미 존재하는 Google 사용자와 프로필**을 전제로 하며 최초 사용자를 생성하는 명령이 아닙니다.
기존 Google 계정을 선택할 때는 다음을 실행합니다.

```sh
npm run admin:setup
```

이 명령은 선택한 UUID를 `.env.local`에 저장하고 DB 관리자 설정도 변경합니다.
UUID가 이미 올바르게 설정되어 있고 DB allowlist만 맞추려면 `npm run admin:sync`를 사용합니다.
두 명령 모두 실제 설정 쓰기이며 단순 상태 검사가 아닙니다. 완료 후 서버를 재시작합니다.
자세한 접근 제어는 [관리자 인증](admin-session-proxy.md)을 참고하세요.

### Garmin과 ChatGPT

1. 워치를 Garmin Connect 앱에 동기화합니다.
2. Mac 터미널에서 `collector/.venv/bin/traini-collect --login`을 실행하고 Garmin 인증을 직접 완료합니다.
   이 명령은 로그인 후 기본 범위인 지난주 수집도 진행합니다.
3. 최초 훈련 기준에 과거 기록이 필요하면 `collector/.venv/bin/traini-collect --days 56`으로 수집합니다.
   수집만으로 DB 업로드되지는 않습니다. 전체 과거 파일은 `traini-parse` 후 `npm run garmin:upload`로 처리합니다.
4. Traini의 목표 화면에서 여러 대회·훈련 가능 요일·현재 컨디션을 확인합니다.
5. 같은 Mac의 `/my/goals`에서 ChatGPT 연결을 준비하고 제공자 로그인·권한 승인을 직접 완료합니다.

연결만으로 AI 계획이 생성되지는 않습니다. 구독 자격·모델 이용 가능성은 제공자와 해당 등록에 따라 달라집니다.
연결 문제는 [수집기](../collector/README.md), [ChatGPT 연결](chatgpt-connection.md)을 참고하세요.

## 3. 매주 사용하는 순서

| 순서 | 할 일 | AI 추론 |
| --- | --- | --- |
| 1 | 워치 → Garmin Connect 동기화, 대상 주간 확인 후 웹 가져오기 | 없음 |
| 2 | 부분 실패·활동 연결 확인, 누락된 피드백·건너뜀 사유 기록 | 없음 |
| 3 | 일요일에 이번 주 훈련을 마쳤다면 주간 마감 확인 | 없음 |
| 4 | 해당 주의 리뷰 생성 또는 업데이트 | 명시적 요청 시 사용 가능 |
| 5 | 컨디션과 처방 기준을 확인한 뒤 원하는 주의 계획 생성·업데이트 | 명시적 요청 시 사용 가능 |

변경 없는 저장 결과가 재사용되면 추가 추론은 없습니다. 실패했다고 생성 버튼을 반복해서 누르기보다
저장 상태와 [운영·복구 안내](service-reliability.md)를 먼저 확인합니다.

### 일요일·월요일 구분

- 웹 가져오기: 일요일에는 현재 월~일, 다른 요일에는 완료된 지난 월~일이 기본입니다.
- 일요일: 현재 주를 직접 마감해야 그 주 리뷰를 만들 수 있습니다. 그 리뷰는 다음 주 계획에 사용됩니다.
- 월요일: 같은 원본 날짜 범위가 지난주가 됩니다. 달력상 완료된 주 리뷰에는 마감 확인이 필수는 아닙니다.
- 현재 주 계획은 이전 주 근거를, 일요일 마감 후 다음 주 계획은 마감한 현재 주 근거를 사용합니다.
- 기록·목표·피드백이 바뀌면 재확인이나 계획 검토 표시가 생길 수 있습니다. 날짜가 바뀌었다고 계획이 자동 갱신되지는 않습니다.

### 늦은 피드백과 컨디션

피드백은 해당 훈련 날짜에 기록합니다. 다음 날 작성했다고 다음 날 운동으로 처리하지 않습니다.
미입력은 정상 컨디션이나 훈련 실패가 아니며, 직접 건너뛴 거리는 보충해야 할 부채가 아닙니다.
통증·몸 상태 이상 보고는 시간이 지났다고 해제하지 않습니다. 목표 화면의 오늘 컨디션과
원래 훈련 피드백에 잘못 입력한 내용이 있다면 각각 실제 상태에 맞게 수정합니다.
저장만으로 이미 보이는 일정이 바뀌지는 않으므로, 변경된 조건에 맞게 계획을 검토·업데이트합니다.

## 데이터와 개인정보

| 위치·대상 | 저장·전송되는 내용 |
| --- | --- |
| 로컬 `~/Projects/Traini-data/garmin/` | 원본 FIT, 정규화 결과, 수집·분석·업로드 체크포인트. 원본에는 민감한 위치·기기 정보가 포함될 수 있음 |
| 로컬 `~/Library/Application Support/Traini/auth/` | Garmin·ChatGPT 인증 자료. 공유하거나 저장소에 추가하지 않음 |
| Supabase | 검증된 활동 필드·랩 근거, 프로필·대회 목표, 컨디션·피드백, 계획·리뷰·마감·생성 상태 |
| OpenAI | 명시적 생성 시 선택된 목표·러닝 근거·제약·자기보고·리뷰 문맥. 대회명·메모·건너뜀 사유 등 입력 문자열도 포함될 수 있음 |
| OpenWeather | 사용자가 날씨 확인을 요청하면 소수 둘째 자리로 반올림한 좌표와 조회 조건 |

AI 입력에서 계정 연락처·사용자 UUID·GPS·원본 FIT·인증 자료는 제외하지만,
이는 모든 입력의 완전한 익명화를 뜻하지 않습니다. 메모나 대회명에 신원·건강 상세를 적으면
일부 내용이 생성 입력에 들어갈 수 있습니다. 외부 제공자 보관·결제 정책을 앱이 대신 보장하지 않습니다.

날씨 좌표는 이 기능의 프로필·훈련·브라우저 저장소에 보관하지 않습니다.
위치 권한을 거부하거나 예보가 없어도 저장된 훈련계획은 유지합니다.

## 휴대폰과 서버 실행 범위

기존 모바일 프레임은 작은 화면에서 사용할 수 있도록 구성되어 있습니다. 다만 반응형 화면 지원과
외부 네트워크 접속 지원은 별개입니다. 휴대폰의 `localhost:3017`은 Mac 서버가 아닙니다.
모바일 원격 접속에는 도메인·TLS·OAuth redirect·세션·로컬 전용 기능을 함께 검토하는 별도 구성이 필요합니다.
이 안내는 공개 터널이나 무인 클라우드 운영을 설정하지 않습니다.

Mac 잠자기·서버 종료·인증 만료·제공자 장애는 실제 사용에 영향을 줍니다.
계속 켜지는 서비스가 필요하면 해당 운영 구성을 별도로 검증해야 합니다.
