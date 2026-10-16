# Traini Garmin 수집기

개인 컴퓨터에서 Garmin Connect의 러닝 활동을 조회하고 원본 FIT를 저장하는 CLI입니다.
수집 명령은 Garmin 계정의 활동을 변경하거나 Supabase로 전송하지 않습니다. Garmin 워치는 먼저
Garmin Connect 앱과 동기화해야 최근 활동이 반영됩니다.

## 설치 (macOS, Python 3.12 이상)

프로젝트 루트에서 실행합니다.

```sh
python3 -m venv collector/.venv
collector/.venv/bin/python -m pip install -r collector/requirements.lock -e ./collector
```

## 최초 실행

```sh
collector/.venv/bin/traini-collect
```

Garmin 이메일, 비밀번호, 필요한 경우 2단계 인증 코드를 터미널에서 직접 입력합니다.
비밀번호와 인증 코드는 화면에 표시되지 않으며 코드·동기화 기록에 저장하지 않습니다.
인증 토큰은 다음 실행에 재사용됩니다. Garmin 인증과 Traini의 Google 로그인은 별개입니다.

기본 조회 범위는 `America/Los_Angeles` 시간대에서 **완료된 지난 월요일~일요일**입니다.
예를 들어 2026-10-14(수)에 실행하면 2026-10-05(월)부터 2026-10-11(일)까지 수집합니다.
같은 주의 월~일 어느 날에 실행해도 동일한 지난주를 조회합니다. 이번 주 일요일에 실행해도
아직 이번 주가 끝나지 않았으므로 지난주를 조회합니다.

`--timezone Asia/Seoul` 또는 환경변수 `TRAINI_TIMEZONE=Asia/Seoul`로 훈련 기준 시간대를
변경할 수 있습니다. 활동의 UTC 시작 시각(`startTimeGMT`)을 이 시간대로 변환한 날짜로
분류합니다. 일요일에 시작해 월요일에 끝난 운동은 일요일에 포함합니다.
UTC 시각이 없으면 오프셋이 있는 현지 시각을 사용하고, 오프셋도 없으면 Garmin의 현지
시작 날짜로 분류하면서 안내를 표시합니다. 이 경우 여행 중 활동의 날짜는 설정한 훈련
시간대와 다를 수 있으며, 기록의 `date_source`에 근거를 남깁니다.

Garmin의 날짜 필터와 훈련 시간대가 다를 수 있어 API 조회는 앞뒤 2일을 여유 있게 요청합니다.
다운로드와 집계에는 정확한 월~일 범위로 재분류한 활동만 포함됩니다.
주간 FIT 하나가 아니라 활동마다 `활동ID.fit`가 저장됩니다.

| 항목 | 기본 위치 |
| --- | --- |
| FIT 원본 | `~/Projects/Traini-data/garmin/activities/` |
| 진행 기록 | `~/Projects/Traini-data/garmin/sync-state.json` |
| 웹 실행 상태 | `~/Projects/Traini-data/garmin/web-sync.json` |
| 인증 토큰 | `~/Library/Application Support/Traini/auth/garmin_tokens.json` |

개인 폴더는 700, 새 파일은 600 권한으로 저장합니다. 인증 토큰은 비밀번호처럼 취급하고
공유하거나 Git에 추가하지 마세요. 날짜 범위별 조회 결과는 계정 전체 활동 수를 뜻하지 않습니다.

## 다시 실행 / 날짜 지정

```sh
# 토큰으로 인증하고 완료된 지난 월~일 수집 (정상 파일은 건너뜀)
collector/.venv/bin/traini-collect

# 명시적으로 지난 월~일 수집 (기본 실행과 같음)
collector/.venv/bin/traini-collect --previous-week

# 기존 방식: 오늘 포함 최근 7일
collector/.venv/bin/traini-collect --days 7

# 최초 분석용 최근 8주
collector/.venv/bin/traini-collect --days 56

# 시작일과 종료일을 모두 포함
collector/.venv/bin/traini-collect --start 2026-10-05 --end 2026-10-11

# 한국 시간대를 기준으로 지난 훈련 주간 수집
collector/.venv/bin/traini-collect --timezone Asia/Seoul

# 계정 변경 또는 재인증 (새 인증 성공 전까지 기존 토큰 보존)
collector/.venv/bin/traini-collect --login

# 이후 자동 실행용: 입력을 기다리지 않고 인증 실패 시 종료
collector/.venv/bin/traini-collect --non-interactive
```

`--days N`은 종료일(기본: 오늘)을 포함한 최근 N일, `--start`와 `--end`는 지정한
날짜를 모두 포함하는 범위입니다. `--start`만 지정하면 오늘까지,
`--end`만 지정하면 해당 종료일까지 7일을 수집합니다.
`--previous-week`는 다른 날짜 옵션과, `--start`는 `--days`와 함께 사용할 수 없습니다.

동기화 기록에는 활동별 `training_date`, `training_week_starts_on`, `training_week_ends_on`,
`training_timezone`, `date_source`를 추가합니다. 이전 활동·파일은 보존되고,
재조회한 활동에 주간 분류 정보가 갱신됩니다. 마지막 실행에는 조회 범위·시간대·조회 방식도
기록합니다. 기존 JSON version 1 기록과 호환됩니다.

`--data-dir`와 `--token-dir`로 경로를 바꿀 수 있습니다. 계정을 바꾸는 경우에는
두 경로를 모두 별도로 지정해서 서로 다른 계정의 데이터를 섞지 마세요.

원본 ZIP은 경로를 그대로 압축 해제하지 않고 FIT 한 개만 메모리에서 읽습니다.
헤더·길이·CRC를 검증한 파일만 임시 파일을 거쳐 원자적으로 저장합니다.
실패한 다운로드는 기록되고 다른 활동 수집은 계속됩니다. 다음 실행에서 실패 항목을 다시
시도하며, 기존 정상 파일은 재사용합니다. 조회 자체가 실패하면 완료로 기록하지 않습니다.
같은 저장 폴더의 동시 실행은 잠금으로 막습니다.

종료 코드는 성공 0, 일부 실패 또는 인증·연결·설정 오류 1, 사용자 중단 130입니다.
일부 실패 시 `sync-state.json`의 활동별 `error_type`을 확인할 수 있습니다.

## Traini에서 가져오기

CLI 설치와 최초 Garmin 로그인을 마친 뒤 프로젝트의 `.env.local`에 설정합니다.

```dotenv
TRAINI_LOCAL_COLLECTOR_ENABLED=true
TRAINI_COLLECTOR_PYTHON=/absolute/path/to/traini/collector/.venv/bin/python
TRAINI_TIMEZONE=America/Los_Angeles
```

`TRAINI_COLLECTOR_PYTHON`은 실제 가상환경 Python의 절대 경로입니다. 서버를 다시 시작하고
관리자 Google 계정으로 로그인한 뒤 오늘 화면 또는 `/garmin-connect`의 **지난주 가져오기**를
누릅니다. 선택한 시간대의 지난 월~일 러닝을 조회하고 새 파일·기존 파일·실패 수를 표시합니다.
CLI의 사용자 지정 경로 대신 위 표의 기본 저장·인증 경로를 사용합니다.

웹 API는 서버에서 관리자 토큰을 검증합니다. 인증 토큰·로컬 경로·상세 Garmin 오류는
브라우저로 전달하지 않습니다. 버튼에서 이메일·비밀번호·2단계 인증 코드를 입력받지 않으며,
재인증이 필요하면 Mac 터미널에서 `collector/.venv/bin/traini-collect --login`을 실행합니다.

웹 수집은 Mac의 Next 서버에서 별도 Python 프로세스로 실행되고 최대 5분 후 중단됩니다.
탭을 닫거나 새로고침해도 진행 상태는 파일에 남습니다. CLI와 같은 파일 잠금을 사용하므로
동시 실행은 거절됩니다. 중단·일부 실패 후 다시 실행하면 기존 정상 파일은 건너뜁니다.
Mac이 잠자기 상태이거나 서버가 꺼져 있으면 버튼을 사용할 수 없습니다. 환경변수로 명시적으로
활성화한 macOS에서만 작동하며 Vercel 배포에서는 비활성화됩니다. FIT 분석이나 DB 업로드는 수행하지 않습니다.

## 다운로드한 FIT 분석

의존성을 설치한 뒤 별도 오프라인 명령으로 실행합니다. 다운로드 버튼에는 아직 연결하지 않았습니다.

```sh
collector/.venv/bin/python -m pip install -r collector/requirements.lock -e ./collector
collector/.venv/bin/traini-parse --timezone America/Los_Angeles
```

`activities/`의 원본을 보존하고 `normalized/활동ID.json`에 결과를 저장합니다.
시작 시각·거리·경과 시간·타이머 시간·이동 시간·평균 페이스·심박·케이던스와 훈련 주간을
정리하며 없는 지표는 null입니다. 이동 시간은 타이머 시간으로 대체하지 않습니다.
파일별 오류와 성공 결과는 `parse-state.json`에서 확인하고, 같은 명령으로 재처리할 수 있습니다.
수집기와 같은 잠금을 사용하므로 수집이 끝난 뒤 실행하세요.
단위·시간대·누락 값·지원 범위·복구 정책은 [FIT 정규화 계약](docs/fit-normalization.md)을 참고하세요.

## Supabase 저장

프로젝트 루트에서 기존 `.env.local` 설정을 사용합니다. 로컬 분석 후 별도로 실행합니다.

```sh
npm run garmin:upload -- --dry-run
npm run garmin:upload
```

`--dry-run`은 원본과 분석 결과를 검증하고 네트워크를 사용하지 않습니다.
실제 업로드는 기존 `activities` 테이블에 관리자 소유 기록을 저장합니다. 결과는
`upload-state.json`에 남으며 재실행해도 중복되지 않습니다. 분석에 실패한 파일은 제외합니다.
서버 키·마이그레이션·권한·오류 복구는 [활동 저장 안내](docs/activity-storage.md)를 참고하세요.

## 검증

```sh
collector/.venv/bin/python -m unittest discover -s collector/tests -v
```

테스트는 실제 Garmin 계정에 접속하지 않습니다. 실제 로그인과 워치 데이터는
최초 실행에서 별도로 확인해야 합니다. 비공식 라이브러리라 Garmin 서비스 변경으로
재인증 또는 의존성 업데이트가 필요할 수 있습니다. 정상 실행을 확인하기 전에는
주간 자동 실행을 등록하지 않습니다.
