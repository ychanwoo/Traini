# FIT 정규화 계약 (schema 1 / parser 1)

## 실행과 범위

프로젝트 루트에서 실행합니다.

```sh
collector/.venv/bin/python -m pip install -r collector/requirements.lock -e ./collector
collector/.venv/bin/traini-parse --timezone America/Los_Angeles

# 다른 데이터 폴더: 아래 경로 안에 activities/가 있어야 합니다.
collector/.venv/bin/traini-parse --data-dir ~/Projects/Traini-data/garmin --timezone Asia/Seoul

# 실행 파일 대신 모듈로도 실행할 수 있습니다.
collector/.venv/bin/python -m traini_collector.parse_cli --help
```

`TRAINI_TIMEZONE` 환경변수도 지원합니다. 우선순위는 `--timezone`, 환경변수, 기본값
`America/Los_Angeles`입니다. Python CLI는 Next의 `.env.local`을 자동으로 읽지 않습니다.
이 명령은 오프라인이며 인증·Garmin API 조회·DB 저장·UI 변경을 하지 않습니다. 입력 폴더의
모든 FIT를 대상으로 하며, 최근 일주일만으로 제한하지 않습니다.

Garmin 공식 [FIT Python SDK](https://github.com/garmin/fit-python-sdk)의 잠긴 버전을 사용합니다.
전체 파일의 길이·헤더·CRC와 SDK 디코딩 오류를 확인한 후, `file_id.type=activity`인
**러닝 세션 한 개**만 지원합니다. multisport/여러 세션은 합산하거나 일부만 선택하지 않고
실패로 기록합니다. 기록 샘플·랩을 평균 내어 없는 세션 값을 채우지 않습니다.

## 파일과 식별자

기본 데이터 폴더는 `~/Projects/Traini-data/garmin/`입니다.

| 파일 | 의미 |
| --- | --- |
| `activities/<activity_id>.fit` | 수집한 원본. 분석기가 내용이나 수정 시각을 바꾸지 않음 |
| `normalized/<activity_id>.json` | 결정적인 정규화 결과. GPS·장치 일련번호·record 메시지는 제외 |
| `parse-state.json` | 이번 실행의 진행 상태·파일별 성공/실패·해시·집계 |
| `.sync.lock` | 웹/CLI 수집기와 분석기가 공유하는 실행 잠금 |

Garmin 활동 ID는 수집기가 부여한 파일명에서 가져옵니다. FIT의 장치 일련번호나 파일 생성
시각을 활동 ID로 사용하지 않습니다. 양의 uint64 십진수이며 앞자리 0은 허용하지 않습니다.
잘못된 이름과 같은 ID의 여러 FIT는 실패로 기록합니다. `.FIT` 확장자도 지원합니다.
원본과 파생 파일에 대한 심볼릭 링크는 거절합니다. 새 결과 파일은 600, 결과 폴더는 700 권한입니다.

## 결과 필드

선택 지표가 없거나 유효하지 않으면 **`null`**입니다. 0과 구분하며 `NaN`/무한대는 저장하지
않습니다. 단위는 필드명에 포함합니다. 숫자는 최대 소수점 6자리까지 보존하며, 표시용
km·분:초·정수 반올림은 이 단계에서 수행하지 않습니다.

| 필드 | 단위 / 계산 근거 |
| --- | --- |
| `activity_id` | Garmin 활동 ID 문자열 |
| `sport`, `sub_sport` | `running`, FIT 세부 종목 (없으면 null) |
| `started_at` | 세션 `start_time`의 UTC ISO 8601, 오프셋 포함 |
| `started_at_local` | 같은 순간을 훈련 시간대로 변환한 ISO 8601, 오프셋 포함 |
| `training_date` | 변환한 시작일. 운동 종료일이 아님 |
| `training_timezone` | IANA 시간대 이름 |
| `training_week_starts_on`, `training_week_ends_on` | 시작일이 속한 월요일·일요일, 양끝 포함 |
| `distance_meters` | `session.total_distance`, m |
| `elapsed_time_seconds` | `session.total_elapsed_time`, 일시정지 포함 경과 시간, s |
| `timer_time_seconds` | `session.total_timer_time`, 타이머가 켜진 시간, s |
| `moving_time_seconds` | `session.total_moving_time`, FIT에 명시된 경우만, s |
| `average_pace_seconds_per_km` | 타이머 시간 ÷ 거리 × 1000, s/km |
| `average_heart_rate_bpm` | `session.avg_heart_rate`, bpm |
| `average_cadence_steps_per_minute` | 2 × (평균 러닝 케이던스 + fractional cadence), steps/min |
| `metric_sources` | 각 지표의 FIT 필드 또는 계산식, 없으면 null |
| `warnings` | `missing:<지표>`, `invalid:<FIT 필드>`, `inconsistent:<지표>` 코드 |
| `source.file`, `source.sha256` | 원본 파일명과 SHA-256 |
| `schema_version`, `parser_version`, `decoder` | 스키마·계산 정책·SDK 버전 |

### 시간·페이스·케이던스 주의점

- UTC 시작 시각이 없으면 활동을 실패로 처리합니다. 종료 시각이나 시간대 없는 로컬 시각으로
  시작 시각을 추측하지 않습니다. 일요일 밤 시작해 월요일에 끝난 활동은 일요일 주간에 속합니다.
  DST 변경과 연말 주간은 IANA 시간대와 실제 달력으로 계산합니다.
- **타이머 시간과 이동 시간은 다릅니다.** 자동 일시정지를 사용하지 않으면 정지한 동안에도
  타이머가 켜져 있을 수 있습니다. Garmin Connect가 별도로 계산한 `movingDuration`이 있어도
  FIT에 `total_moving_time`이 없으면 여기서는 null입니다.
- 타이머 시간이 없을 때만 `enhanced_avg_speed`, 그다음 `avg_speed`의 역수로 평균 페이스를
  구합니다. 거리 또는 타이머 시간이 명시적으로 0이면 페이스는 null입니다. 서로 다른 시간
  기준으로 계산한 ‘이동 페이스’와 비교하지 않습니다. FIT의 평균 속도는 이미 반올림되어
  있어 거리/타이머로 계산한 페이스와 미세하게 다를 수 있습니다.
- SDK는 러닝 케이던스를 strides/min으로 해석합니다. `avg_running_cadence`가 있으면 우선하고,
  없으면 `avg_cadence`를 사용합니다. fractional cadence는 선택 값이며 있으면 더한 뒤
  2를 곱해 양발 기준 steps/min으로 변환합니다. 심박 0/255와 범위 밖 fractional 값 등은
  유효한 센서 값으로 취급하지 않습니다.
- 타이머가 경과 시간보다 크거나 이동 시간이 타이머(없으면 경과 시간)보다 크면
  해당 시간을 null로 제외하고 경고합니다. FIT 밀리초 반올림을 위해 0.01초 오차를 허용합니다.

## 재실행·장애 복구

매 실행마다 원본을 검증하고 다시 해석해 결정적인 JSON을 만듭니다. 기존 JSON과 바이트가
같으면 수정 시각도 유지합니다. 원본·시간대·스키마·파서·SDK 버전이 바뀌거나 파생 JSON이
손상되면 같은 활동 ID 경로에 새 결과를 원자적으로 교체합니다. 중복 행/파일을 추가하지 않습니다.

manifest는 시작 시 모든 입력을 `pending`으로 기록하고 파일 처리마다 체크포인트를 저장합니다.
최종 상태는 `complete` 또는 `partial`입니다. 파일별 `status=complete`는 새 분석뿐 아니라
기존 결과 검증 성공도 포함합니다. 집계는 `found`, `processed`, `skipped`, `failed`입니다.

실패한 입력의 이전 정상 JSON은 복구용으로 남기되 manifest에 `failed`로 표시하고
`normalized_file`을 제공하지 않습니다. 삭제된 입력의 파생 JSON도 자동 삭제하지 않습니다.
**후속 DB 업로드는 디렉터리 전체를 무조건 읽지 말고, 완료된 manifest의 `complete` 항목만
선택하고 기록된 원본·결과 SHA-256을 검증해야 합니다.** 중단된 `running` manifest는 완료된 실행이 아닙니다.

원본 파일 오류는 다음 파일로 진행합니다. manifest 자체 저장 실패는 안전한 체크포인트를
남길 수 없으므로 실행 전체를 중단합니다. 중단·실패 후 같은 명령으로 다시 실행하면 복구됩니다.
CLI 종료 코드는 전부 성공 0, 파일별 실패/설정/저장 오류/잠금 충돌 1, 사용자 중단 130입니다.

| 주요 오류 코드 | 조치 |
| --- | --- |
| `invalid_filename`, `duplicate_activity_id` | 수집기가 만든 `활동ID.fit` 한 개씩 사용 |
| `invalid_fit`, `decode_failed` | 원본을 확인하고 필요하면 Garmin에서 다시 다운로드 |
| `unsupported_file_type`, `unsupported_sport`, `unsupported_session_count` | 단일 러닝 activity만 지원 |
| `missing_start_time` | 활동 시작 시각이 있는 원본 필요 |
| `unsafe_file`, `file_too_large` | 심볼릭 링크/일반 파일 여부와 64 MiB 제한 확인 |
| `storage_error` | 로컬 권한·디스크 공간 확인 후 재실행 |
| `parser_failed` | 원본을 보존하고 파서 호환성 확인 |

## 검증

```sh
collector/.venv/bin/python -m unittest discover -s collector/tests -v
collector/.venv/bin/python -m pip check
```

자동 테스트는 Garmin SDK Encoder로 만든 합성 FIT를 실제 Decoder로 읽습니다. 개인 원본이나
계정 접속 없이 단위·케이던스·페이스·일시정지·누락 값·CRC·종목·세션 수·DST·주간 경계,
중복·재처리·파일 보존·잠금·저장 실패·중단 복구를 검증합니다.

실제 Garmin Connect와 비교할 때는 UTC 시작 시각·거리·경과/타이머 시간·심박·케이던스의
출처와 반올림을 확인합니다. FIT에 이동 시간이 없으면 Connect의 별도 값으로 채우지 않습니다.
실계정 측정값·파일 개수·개인 FIT·정규화 결과·계정 정보는 공개 문서에 포함하지 않습니다.
