# Garmin 활동의 Supabase 저장

## 테이블 구성과 기존 데이터

2026-10-15 실제 프로젝트의 테이블·컬럼·제약·RLS·마이그레이션 이력을 확인했습니다.
기존 프로필 1개와 러닝/훈련 테이블을 유지하고 활동 테이블을 확장합니다. 중복 활동 테이블이나
동일한 정보를 담는 별도 raw JSON 테이블은 만들지 않습니다.

| 테이블 | 용도 / 이번 변경 |
| --- | --- |
| `public.profiles` | Google 계정·이름·사진·race_name·목표. 변경 없음 |
| `public.activities` | FIT로 검증된 활동을 저장. 기존 UUID·사용자 FK·Garmin ID 유니크 키 재사용 |
| `public.training_plans` | 훈련 계획 저장. 다음 계획 생성 단계에서 사용, 유지 |
| `public.workouts` | 훈련과 완료 활동 연결. activities UUID 참조 유지 |
| `public.garmin_snapshots` | 회복/수면 등 일별 지표용. 현재 training API 참조가 있어 유지. FIT에서 없는 값을 생성하지 않음 |
| `traini_legacy.garmin_connections` | 사용하지 않는 승인 기반 OAuth 테이블. 삭제 대신 비공개 스키마로 보관 |

과거 `/api/garmin/connect`, `/callback`, `/webhook`은 410을 반환합니다. 검증되지 않은 웹훅이
정규화 활동을 덮어쓰거나 임의 프로필을 만드는 경로를 종료했습니다. 토큰 암호화 유틸리티와
사용하지 않는 OAuth 타입·환경변수 템플릿도 제거했습니다. 실제 `.env.local` 비밀 값은 변경하지 않습니다.

## 마이그레이션

대상: `kmmutfcgshellvjgpick` (Traini). `20261015000000_store_normalized_garmin_activities.sql`을 적용합니다.
기존 20260803/05/06 마이그레이션은 이미 적용된 상태였습니다. 변경 전 트랜잭션에서 실제 DB로
마이그레이션과 SQL 테스트를 실행하고 롤백한 뒤, CLI로 정식 적용했습니다.

새 환경에서는 해당 환경의 프로젝트 연결을 확인한 뒤 정상 마이그레이션 흐름을 사용합니다.
비밀번호·토큰을 명령 인자나 저장소에 넣지 않습니다.

```sh
npx supabase login
npx supabase migration list --linked
npx supabase db push --linked
```

DB를 reset하거나 기존 마이그레이션을 다시 수동 실행하지 않습니다.
보관 테이블을 되돌려야 하면 기존 public 이름이 비어 있는지 확인한 후 DBA가
`alter table traini_legacy.garmin_connections set schema public`으로 복원할 수 있습니다.
이는 OAuth 라우트를 다시 활성화하지 않으며, 현재 서비스에는 복원이 필요하지 않습니다.

## 실행

프로젝트의 Node 서버 환경으로 기존 Supabase URL·서버 키·관리자 UUID·Python 경로를 읽습니다.
Python 업로더에 필요한 설정만 전달하고 Garmin/날씨 등 다른 비밀은 전달하지 않습니다.

```sh
# 의존성과 추가된 CLI 엔트리 포인트 설치
collector/.venv/bin/python -m pip install -r collector/requirements.lock -e ./collector

# 먼저 로컬 FIT를 분석
collector/.venv/bin/traini-parse --timezone America/Los_Angeles

# 오프라인 검증 (DB 연결/쓰기 없음)
npm run garmin:upload -- --dry-run

# 실제 저장
npm run garmin:upload
```

`TRAINI_ADMIN_USER_ID`는 로컬 설정의 기존 관리자이며 업로더 인자로 임의 소유자를 지정할 수 없습니다.
Supabase Auth에서 계정 존재와 기존 프로필을 확인합니다. 프로필이 없으면 먼저 Google 로그인하도록
안내하고 자동 생성·이름 덮어쓰기는 하지 않습니다. 실수로 다른 서버에 인증 정보를 보내지 않도록
업로더 URL은 위 Traini 프로젝트의 HTTPS 주소로 제한합니다. `--data-dir`가 필요한 개발자는
동일한 서버 환경에서 `python -m traini_collector.upload_cli --data-dir ...`을 사용할 수 있습니다.

현재 **다운로드 버튼 → 로컬 분석 명령 → 업로드 명령**은 별도 단계입니다. UI 디자인·표시 수치·
계획 생성에는 이번 변경을 연결하지 않습니다.

## 검증과 저장 계약

1. 수집/분석과 같은 `.sync.lock`을 잡고 실행합니다.
2. 완료된 `parse-state.json`만 읽습니다. `partial`이면 성공 항목만 선택하고 실패 항목은 제외합니다.
3. manifest 버전·SDK 버전·완료 시각·집계·경로·활동 ID를 확인합니다.
4. 원본과 JSON의 SHA-256을 각각 검증합니다.
5. 원본 FIT를 다시 해석해 정규화 문서 전체를 재현하고 비교합니다. 해시까지 수정된 잘못된 JSON도 거절합니다.
6. 검증된 명시적 필드만 기존 활동 컬럼으로 매핑합니다. GPS·record·원본 FIT·Garmin 토큰은 업로드하지 않습니다.
7. 서비스 역할 전용 `import_garmin_activity` RPC 한 번으로 활동 하나를 원자적으로 저장합니다.

`(user_id, garmin_activity_id)` 유니크 키를 재사용합니다. 결과는 `inserted`, `updated`, `unchanged`입니다.
변경되지 않으면 UUID·생성일·수정일을 유지합니다. 변경되면 같은 행을 갱신해 workout 연결도 유지합니다.
해시만 비교하지 않고 실제 저장 컬럼도 비교하므로 DB 값이 달라졌을 때 다시 복구할 수 있습니다.
로컬 업로드 이력만으로 생략하지 않으며 매 실행 서버에 확인하므로 원격에서 없어진 행도 복구합니다.

| 정규화 필드 | 기존/추가 DB 컬럼 |
| --- | --- |
| `activity_id`, `sport` | `garmin_activity_id`, `activity_type` |
| `timer_time_seconds` | 기존 `duration_seconds` (numeric으로 정밀도 보존) |
| `average_heart_rate_bpm` | 기존 `average_heart_rate` |
| `average_pace_seconds_per_km` | 기존 동일 컬럼 (integer → numeric) |
| `elapsed_time_seconds`, `moving_time_seconds` | 별도 컬럼. 이동 시간 null 유지 |
| `started_at`, `training_date`, `training_timezone` | UTC 시각·훈련 날짜·IANA 시간대 |
| 월~일 경계 | DB가 `training_date`로 자동 생성하는 저장 컬럼 |
| 나머지 정규화 지표·근거 | 케이던스·세부 종목·metric_sources·warnings 컬럼 |
| 파일 해시·분석 버전 | source_file/source_sha256/normalized_sha256/스키마·파서·SDK 버전 |

활동은 `source=garmin_fit`으로 구분합니다. 기존 행은 `source=legacy`로 보존합니다.
FIT 행에는 필수 출처·날짜 일치·유효 단위·유한 수치·시간 간 관계를 DB에서도 검증합니다.
`raw_payload`는 FIT 행에 저장하지 않습니다. 이미 정리한 컬럼과 전체 JSON을 중복 보관하지 않습니다.
사용자별 날짜 조회 인덱스로 다음 주간 요약 단계를 지원합니다.

## 권한과 실패 복구

활동 RLS는 인증된 소유자만 조회/쓰기할 수 있고 소유권 변경도 차단합니다. 익명 역할에는
활동 테이블 권한이 없습니다. import RPC는 `security invoker`이며 service_role만 호출할 수 있습니다.
서비스 키는 RLS를 우회하므로 로컬 서버 프로세스에서만 사용하고 브라우저나 공개 환경변수로 보내지 않습니다.
비공개 보관 스키마는 익명/인증 사용자에게 접근 권한이 없습니다.

HTTP 리다이렉트는 따르지 않습니다. 연결 오류·408·429·5xx는 최대 3번까지 타임아웃을 두고
재시도합니다. 응답이 유실돼도 RPC 재시도는 중복을 만들지 않습니다. 인증·검증 오류는 자동 재시도하지
않고 파일별 안전한 코드만 남깁니다. 서버 오류의 상세 응답과 키는 로그에 기록하지 않습니다.

`upload-state.json`은 활동별 체크포인트입니다. `upload-validation.json`은 dry-run 결과이며
실제 업로드 이력을 덮어쓰지 않습니다. 둘 다 Git에서 제외되고 600 권한으로 저장됩니다.
DB commit 후 로컬 체크포인트 저장 전에 중단되더라도 재실행 시 서버가 중복을 방지합니다.
manifest 저장 자체가 실패하면 실행을 중단합니다. 실패·중단 뒤 같은 명령으로 재실행하세요.

| 오류 | 조치 |
| --- | --- |
| `invalid_manifest`, `reparse_required` | 로컬 `traini-parse` 재실행 |
| `source_changed`, `normalized_changed` | 원본/결과 확인 후 재분석 |
| `access_denied` | Supabase 서버 키/권한 확인 |
| `schema_not_ready` | 마이그레이션 적용 확인 |
| `profile_missing`, `owner_not_found` | 기존 Google 계정·관리자 설정 확인 |
| `connection_failed`, `temporarily_unavailable` | 연결 확인 후 재실행 |
| `database_rejected` | DB 제약·배포 버전 확인; 로컬 원본은 보존됨 |

CLI 종료 코드는 성공 0, 파일별 실패/제외 또는 설정/DB 오류 1, 사용자 중단 130입니다.

## 검증

```sh
collector/.venv/bin/python -m unittest discover -s collector/tests -v
npm run test:db
npm run test:admin
npm run test:garmin
npm run lint
npm run build
```

`test:db`는 로그인된 CLI와 연결된 Traini 프로젝트를 사용합니다. SQL 테스트는 하나의 트랜잭션 안에서
합성 사용자/프로필/활동/훈련을 만들고 **항상 최종 rollback**합니다. 중복·갱신·정밀도·참조 보존·
다른 사용자 조회/수정/생성/소유권 이전 차단·익명 차단·서비스 RPC 권한·DB 제약을 검사합니다.
개인 원본이나 계정 비밀은 테스트 파일에 포함하지 않습니다.

2026-10-15 실제 파일 6개를 새로 저장했고 실패/제외는 0개였습니다. 재실행은 기존 6개,
신규/변경/실패 0개였습니다. 저장된 지표·월~일 경계·해시·null 값을 로컬 결과와 비교했고,
재실행 전후 DB 행 전체(UUID·생성일·수정일 포함)가 동일했습니다. 프로필 전체의 변경 전후
지문도 같았으며 테스트용 프로필은 남지 않았습니다.
