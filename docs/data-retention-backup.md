# 개인 코칭 데이터 백업과 복원

Traini는 Garmin 파일과 관리자 한 명의 코칭 데이터를 저장소 밖에 있는 하나의 ZIP으로 백업합니다. 맥에서 다음 명령을 실행하면 이번 정리 대상의 수와 용량을 먼저 확인할 수 있습니다.

```sh
npm run data:maintenance -- preview
```

**실행 환경** — 프로젝트 루트에서 Node 22.14 이상, Python 3.12 이상, `npm ci`로 설치한 개발 의존성을 사용합니다. DB 읽기에는 기존 Supabase CLI 관리 로그인이 필요합니다. 기본 명령은 프로젝트에 고정한 CLI 버전을 npx로 실행합니다. `TRAINI_SUPABASE_CLI`로 설치된 실행 파일을 지정할 수도 있습니다. 키체인 접근이 필요하면 먼저 본인 터미널에서 미리보기를 실행하세요. `.env.local`의 기존 관리자 UUID로 범위를 제한합니다.

## 보관 기준

| 데이터 | 기본 동작 |
| --- | --- |
| 원본 FIT | 백업에 계속 보관. 수정 후 180일이 지난 로컬 사본은 DB에 저장된 원본 해시와 백업 해시까지 일치할 때 정리 |
| 정규화 JSON | 백업에 보관. 같은 확인을 거쳐 수정 후 90일이 지난 로컬 사본 정리 |
| 목표·컨디션·거리·랩·계획·운동·매칭·피드백·리뷰·마감 | 관리자 소유 기록 전체를 매번 동일한 시점의 DB 스냅샷으로 저장 |
| 생성 요청 | 기본은 보관. 선택 옵션으로 90일 지난 실패 요청 중 계획·리뷰가 참조하지 않고 백업 시점과 값이 동일한 행만 정리 |
| 수집·분석·업로드 진행 상태 | 수집기가 고정 파일에 덮어씀. 마지막 분석 목록에 있는 파일은 업로드 재시도를 위해 유지 |
| 임시 파일 | 수집기와 백업기가 만드는 이름을 구분해 7일 지난 파일만 정리 |
| 백업과 로그 | 정리 실행 후 전체 백업 3개 유지. 자동 실행 결과는 개인 폴더의 JSON 파일 하나에 최근 32회까지 기록 |
| 인증 | Google 계정, Garmin 토큰, Supabase 키와 ChatGPT 인증은 각 서비스에서 다시 연결. 백업 범위에는 공개 스키마의 코칭 테이블과 관리자 매핑이 포함됨 |

운영 DB의 코칭 이력은 계획 근거이므로 장기 보관합니다. 파일 수는 회전 정책으로 제한되며, 누적 원본과 DB 기록이 늘면 백업 한 개의 크기도 증가합니다. 로컬에서 정리한 FIT와 정규화 파일은 다음 백업에도 이어서 담깁니다. 복구에는 **전체 ZIP 한 개**면 됩니다.

## 백업과 자동 정리

```sh
npm run data:maintenance -- backup
npm run data:maintenance -- preview --prune-failed
npm run data:maintenance -- maintain
```

- `backup`은 검증한 백업 한 개를 만듭니다. `maintain`은 새 백업을 검증한 뒤 정리와 회전까지 수행합니다. 실패 요청도 정리하려면 `maintain --prune-failed`로 실행합니다.
- 기본 위치는 `~/Projects/Traini-data/garmin`과 `~/Projects/Traini-data/backups`입니다. `--data`, `--store`로 Git 밖의 별도 디렉터리를 지정할 수 있습니다. 백업 폴더 권한은 0700, 백업 파일은 0600입니다. ZIP에는 개인 운동·컨디션 기록이 포함되며 자체 암호화는 제공하지 않습니다. 기기 분실까지 대비하려면 검증한 ZIP을 암호화된 별도 저장장치에 복사하세요.
- 보관 정책은 `--fit-days`, `--normalized-days`, `--temp-days`, `--request-days`, `--keep`으로 조정합니다. 백업은 최소 2개 세대를 유지합니다.
- 일괄 정리는 Garmin 전체 파이프라인과 같은 잠금을 사용합니다. 수집 중이거나, 백업 검증이 실패하거나, 이전 백업의 무결성·소유자가 달라지면 정리를 중단합니다. 이전 백업 오류 시 해당 파일을 보존하고 정상 사본을 확인한 뒤 재실행하세요.
- `preview`는 변경 없이 현재 파일 나이, 체크포인트, DB 해시를 비교합니다. 실제 정리 직전에 다시 확인합니다.

macOS 자동 실행은 사용 중인 프로젝트 체크아웃에 연결됩니다. 해당 브랜치를 머지한 뒤 평소 실행하는 체크아웃에서 한 번 설치하세요.

```sh
npm run data:schedule -- preview
npm run data:schedule -- install
npm run data:schedule -- status
npm run data:schedule -- uninstall
```

기본은 **현지 시각 월요일 오전 3시**, 사용자 로그인 세션의 LaunchAgent입니다. 설치 시 `--weekday 0..6`(일요일 0), `--hour 0..23`, 보관 정책과 선택적 `--prune-failed`를 지정할 수 있습니다. 옵션이나 Node 설치 위치가 바뀌면 제거 후 재설치하세요. 마지막 결과는 `~/Projects/Traini-data/maintenance/runs.json`에서 확인합니다. 잠금 충돌·인증 실패가 있으면 로그를 확인하고 수집 종료 또는 CLI 재로그인 후 수동으로 재실행할 수 있습니다.

## 복원 연습과 실제 복구

```sh
npm run data:maintenance -- verify --archive "/absolute/path/to/traini-v1-....zip"
npm run data:maintenance -- restore --archive "/absolute/path/to/traini-v1-....zip" --to "$HOME/Projects/Traini-data/recovered"
```

1. 대상은 **새 디렉터리**여야 합니다. ZIP 내 파일명·중복 항목·크기·SHA-256을 검사합니다.
2. 내장 PostgreSQL(PGlite)에 백업 시점의 저장소 마이그레이션을 적용합니다. Supabase의 인증·스토리지 인터페이스만 격리 환경에 준비합니다. 실제 테이블·외래 키·체크 제약·트리거를 거쳐 복원한 뒤 각 테이블의 모든 행과 생성 열까지 원본 JSON 값과 비교합니다. 스키마가 일치해야 하므로 마이그레이션 이력과 소스 저장소도 보관하세요.
3. 검증에 성공하면 `recovered/garmin/`에 파일을, `recovered/coaching.sql`에 한 트랜잭션으로 적용할 복원 SQL을 생성합니다. 검증과 추출은 오프라인에서 가능합니다.
4. DB 복구 시 먼저 격리한 Supabase 대상에 동일한 마이그레이션과 **원래 UUID의 인증 계정**을 준비합니다. 해당 관리자 범위의 코칭 테이블은 비어 있어야 합니다. 새 대상의 관리 SQL 연결로 `psql -X -v ON_ERROR_STOP=1 -f /private/path/coaching.sql`을 실행하세요. 계정 생성 훅이 프로필을 미리 만들었다면 새 복원 대상의 프로비저닝을 조정하세요. 기존 서비스 데이터와 병합하는 SQL이 아닙니다.
5. 복구한 Garmin 디렉터리를 새 수집 위치에 두고 FIT 분석을 실행해 진행 상태를 다시 생성합니다. 복원한 목표·일정·활동·피드백을 확인한 다음 서비스 연결을 전환하세요.

아바타 이미지 파일, 외부 계정 자격 증명, 레거시 토큰 스키마는 별도로 관리합니다. ZIP 체크섬은 손상 확인용이며 외부에서 받은 백업의 작성자 신원을 인증하지 않습니다.
