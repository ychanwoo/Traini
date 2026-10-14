# Traini Garmin 수집기

개인 컴퓨터에서 Garmin Connect의 러닝 활동을 조회하고 원본 FIT를 저장하는 CLI입니다.
Garmin 계정의 활동을 변경하거나 Supabase로 전송하지 않습니다. Garmin 워치는 먼저
Garmin Connect 앱과 동기화해야 오늘 활동까지 조회됩니다.

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

기본 조회 범위는 `America/Los_Angeles` 시간대의 **오늘 포함 7일**입니다.
활동의 날짜는 Garmin의 `startTimeLocal` 기준이며 다른 시간대에 있으면 `--timezone`을 지정합니다.
주간 FIT 하나가 아니라 활동마다 `활동ID.fit`가 저장됩니다.

| 항목 | 기본 위치 |
| --- | --- |
| FIT 원본 | `~/Projects/Traini-data/garmin/activities/` |
| 진행 기록 | `~/Projects/Traini-data/garmin/sync-state.json` |
| 인증 토큰 | `~/Library/Application Support/Traini/auth/garmin_tokens.json` |

개인 폴더는 700, 새 파일은 600 권한으로 저장합니다. 인증 토큰은 비밀번호처럼 취급하고
공유하거나 Git에 추가하지 마세요. 날짜 범위별 조회 결과는 계정 전체 활동 수를 뜻하지 않습니다.

## 다시 실행 / 날짜 지정

```sh
# 토큰으로 인증하고 최근 7일 수집 (정상 파일은 건너뜀)
collector/.venv/bin/traini-collect

# 최초 분석용 최근 8주
collector/.venv/bin/traini-collect --days 56

# 시작일과 종료일을 모두 포함
collector/.venv/bin/traini-collect --start 2026-10-07 --end 2026-10-13

# 한국 현지 날짜로 오늘 계산
collector/.venv/bin/traini-collect --timezone Asia/Seoul

# 계정 변경 또는 재인증 (새 인증 성공 전까지 기존 토큰 보존)
collector/.venv/bin/traini-collect --login

# 이후 자동 실행용: 입력을 기다리지 않고 인증 실패 시 종료
collector/.venv/bin/traini-collect --non-interactive
```

`--data-dir`와 `--token-dir`로 경로를 바꿀 수 있습니다. 계정을 바꾸는 경우에는
두 경로를 모두 별도로 지정해서 서로 다른 계정의 데이터를 섞지 마세요.

원본 ZIP은 경로를 그대로 압축 해제하지 않고 FIT 한 개만 메모리에서 읽습니다.
헤더·길이·CRC를 검증한 파일만 임시 파일을 거쳐 원자적으로 저장합니다.
실패한 다운로드는 기록되고 다른 활동 수집은 계속됩니다. 다음 실행에서 실패 항목을 다시
시도하며, 기존 정상 파일은 재사용합니다. 조회 자체가 실패하면 완료로 기록하지 않습니다.
같은 저장 폴더의 동시 실행은 잠금으로 막습니다. FIT의 활동 메시지 분석은 다음 단계입니다.

종료 코드는 성공 0, 일부 실패 또는 인증·연결·설정 오류 1, 사용자 중단 130입니다.
일부 실패 시 `sync-state.json`의 활동별 `error_type`을 확인할 수 있습니다.

## 검증

```sh
collector/.venv/bin/python -m unittest discover -s collector/tests -v
```

테스트는 실제 Garmin 계정에 접속하지 않습니다. 실제 로그인과 워치 데이터는
최초 실행에서 별도로 확인해야 합니다. 비공식 라이브러리라 Garmin 서비스 변경으로
재인증 또는 의존성 업데이트가 필요할 수 있습니다. 정상 실행을 확인하기 전에는
주간 자동 실행을 등록하지 않습니다.
