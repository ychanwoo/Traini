# 관리자 인증과 서버 세션

## 접근 경계

Google OAuth는 `@supabase/ssr`의 PKCE 흐름을 사용합니다. 브라우저는 코드 검증자를
쿠키에 저장하고 `/auth/callback` 서버 Route Handler가 일회용 코드를 세션으로 교환합니다.
콜백은 `getUser()`로 사용자를 다시 검증하고 서버 전용 `TRAINI_ADMIN_USER_ID`와 비교합니다.
외부 URL·인증 경로·알 수 없는 경로를 로그인 복귀 주소로 사용하지 않습니다.

`proxy.ts`는 보호된 페이지 렌더링 전에 `getUser()`를 실행합니다. 토큰을 갱신하면 요청과
응답 양쪽에 쿠키를 전달하고 리다이렉트에도 갱신 결과를 유지합니다. 보호된 두 서버
레이아웃도 독립적으로 검증합니다. API는 HTML 리다이렉트 대신 각 Route Handler에서
공통 `requireAdmin()`을 호출해 401/403/503 JSON 응답을 반환합니다. 날씨와 종료된
Garmin OAuth·웹훅 경로도 포함합니다. Proxy 통과 여부나 사용자 지정 헤더를 신뢰하지 않습니다.

서버는 브라우저가 제공한 사용자 객체나 쿠키 존재만으로 권한을 허용하지 않습니다.
쿠키 기반 POST/PUT/DELETE는 같은 Origin을 요구합니다. 명시적인 Bearer 토큰을 사용하는
기존 로컬 클라이언트는 계속 서버 검증을 거치며, 잘못된 Authorization 헤더가 있으면
정상 쿠키로 우회하지 않습니다. 기존 API별 본문 크기·형식·요청 제한은 유지합니다.

모든 인증·개인 데이터 응답은 캐시하지 않습니다. Service role 클라이언트는 server-only로
표시하고 네트워크 요청에 시간 제한을 둡니다. Supabase SSR 쿠키는 브라우저 SDK와 공유하므로
HttpOnly가 아니며 SameSite=Lax를 사용합니다. 운영 서버는 HTTPS와 Secure 쿠키를 전제로 합니다.
쿠키 유효 기간 자체가 고정 로그인 보장 기간은 아닙니다. 실제 세션 만료·갱신·철회는
Supabase Auth 정책을 따릅니다. 로그아웃은 현재 세션의 갱신 토큰과 쿠키를 정리합니다.
이미 발급된 JWT는 만료 전까지 유효할 수 있으므로 탈취된 JWT의 즉시 무효화를 보장하지 않습니다.

## Supabase 직접 접근

`20261016030000_admin_access_restrictions.sql`은 기존 소유자 정책에 restrictive 관리자
조건을 추가합니다. 프로필·활동·계획·훈련·생성 작업·랩 데이터와 아바타 쓰기를 제한하며
기존 행이나 목표를 삭제하지 않습니다. 관리자는 다른 계정의 행도 소유자 조건 때문에 읽지 못합니다.
단일 관리자 UUID는 `traini_admin_config`에 저장하며 anon/authenticated가 조회·변경할 수 없습니다.
`is_traini_admin()`은 현재 인증 사용자가 일치하는지만 반환합니다. Service role은 기존처럼
서버에서만 사용하며 마이그레이션/수집기 작업에 필요한 권한을 유지합니다.

기존 아바타 버킷은 공개 이미지 제공을 유지합니다. 이 변경은 공개 아바타 URL을 비공개로
전환하거나 Google/Supabase 자체의 계정 생성을 비활성화하지 않습니다. 다른 Google 계정이
인증되더라도 Traini 페이지·API·DB 사용 권한은 부여하지 않습니다.

## 설정 및 복구

먼저 저장소의 Supabase 마이그레이션을 적용합니다. 그 뒤 기존 `.env.local`의 서버 관리자와
DB 정책을 맞춥니다. 이번 프로젝트에는 마이그레이션과 기존 관리자 동기화를 적용했습니다.

```sh
npm ci
npm run admin:sync
npm run dev -- --port 3017
```

다른 기존 Google 계정을 관리자로 지정할 때는 `npm run admin:setup`을 실행합니다.
이 명령은 로컬 UUID 선택 후 DB 접근 정책도 동기화합니다. 변경 후 서버를 재시작하세요.
배포 환경의 서버 UUID도 DB와 같아야 합니다. 동기화 오류 시 서버를 공개하지 말고 원인을
수정한 뒤 다시 실행합니다. 계정·비밀번호·이름·목표를 재생성하지 않습니다.
Supabase에 Google provider와 사용 중인 사이트의 `/auth/callback` Redirect URL이 필요합니다.
기존 localStorage 세션 키는 브라우저 초기화 시 정리하고 자동 복사하지 않습니다. 이 버전 첫 진입 시 Google로 다시 로그인하세요.

## 검증

```sh
node --test tests/*.test.mjs
npm run test:db:admin
npm run test:db:training
npm run test:db:plan
npm run test:db:lap
collector/.venv/bin/python -m unittest discover -s collector/tests -q
npm run lint
npx tsc --noEmit
npm run build
```

프로덕션 서버를 3017에서 실행한 상태에서 별도 터미널로 실제 HTTP/DB 통합 검증을 실행합니다.

```sh
npm run start -- --port 3017
# 별도 터미널
npm run test:admin:integration
```

통합 검증은 임시 비관리자 계정을 만들고 finally에서 제거합니다. 기존 관리자는 이메일을
발송하지 않는 서버 생성 링크로 별도 테스트 세션만 발급하며 비밀번호를 변경하지 않습니다.
로그인 링크·토큰을 출력하지 않습니다. 실제 Google 브라우저 로그인을 대체하는 테스트가
아니므로 Google 로그인·페이지 이동·로그아웃도 브라우저에서 별도로 확인합니다.
실제 AI 생성·Garmin 수집·목표 수정은 호출하지 않고 기존 데이터의 인증된 조회를 검증합니다.
DB 테스트는 모든 데이터를 롤백하며 실제 훈련 완료 상태를 변경하지 않습니다.

Next.js와 eslint-config-next는 16.4.2로 맞추고 Supabase SDK는 SSR의 peer dependency와
호환되는 2.118.0으로 고정했습니다. 프로덕션 의존성 `npm audit --omit=dev`는 취약점 0건입니다.
전체 audit에는 ESLint의 braces → micromatch → fast-glob 경로 개발 의존성 경고 5건이 남습니다.
공식 수정 버전 없이 eslint-config-next 14로 강제 다운그레이드하는 자동 제안은 적용하지 않았습니다.

## 이번 브랜치 검증 결과

Node 117개와 Python 103개 테스트, 관리자 접근·활동 저장·훈련 요일·주간 계획·랩 데이터
SQL 회귀 검증, lint, TypeScript와 프로덕션 빌드를 통과했습니다. 실제 HTTP 검증에서
비로그인 401, 비관리자 403, CSRF 거부, 만료 토큰 갱신과 로그아웃을 확인했습니다.
실제 Google 로그인·로그아웃·원래 페이지 복귀와 320/375/430/768px 화면도 확인했습니다.
기존 목표, FIT 활동과 훈련 완료 기록은 유지했습니다.
