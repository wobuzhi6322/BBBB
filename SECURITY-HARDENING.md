# gaeideuk.com 보안 운영 기준

이 문서는 현재 저장소의 방어 계층과 운영 반영 순서를 정의한다. 보안 설정을 한꺼번에 켜서 정상 사용자를 차단하지 않도록 데이터베이스, 환경 변수, 애플리케이션, WAF 순서로 적용한다.

## 적용된 방어 계층

### 요청마다 관리자 권한 재검증

- `/admin` HTML과 관리자 JS/CSS는 15분 수명의 서명된 HttpOnly 게이트 쿠키 없이는 `404`를 반환한다.
- 게이트 쿠키는 화면 노출만 제한한다. 관리자 데이터 API는 요청마다 Supabase access token과 현재 `bbbb_site_profiles.role`을 다시 확인한다.
- 교차 사이트 요청은 `Origin`과 `Sec-Fetch-Site`로 인증 전에 거부한다.
- 운영 자동화용 공유 토큰은 브라우저 Origin이 없는 요청에서만 고정시간 비교로 허용한다. `admin-license-code`는 계속 사용자 Bearer 인증만 허용한다.

장점: 네트워크 안쪽이나 페이지 URL을 안다는 이유로 신뢰하지 않는 NIST/Google식 Zero Trust 원칙을 관리자 기능에 최소 범위로 적용한다. 계정 역할을 회수하면 기존 페이지 쿠키가 남아 있어도 데이터 API 권한은 즉시 사라진다.

### 데이터베이스 최소 권한

- `authenticated` 사용자는 자신의 프로필에서도 `role`, `trial_*`, `email` 등 권한 열을 쓸 수 없다.
- 직접 수정이 필요한 공개 프로필 열만 PostgreSQL column privilege로 허용한다.
- 신규 설치 기준 스키마와 기존 운영 DB용 `supabase/security-hardening-20260816.sql`을 함께 유지한다.

장점: 애플리케이션 코드 한 곳에서 검사를 빠뜨려도 데이터베이스가 권한상승을 다시 차단한다.

### 소유자 전용 관리자 권한 위임

- 관리자 회원 상세 화면의 권한 부여·해제 버튼은 서버가 `canManageAdminRoles`를 반환한 소유자에게만 표시한다.
- `PATCH /api/admin-role`은 Origin이 있는 브라우저 요청, Supabase 사용자 Bearer, 서버 `BBBB_OWNER_USER_IDS`의 불변 Auth user ID 판정을 모두 요구한다. 이메일 주소는 소유자 권한 근거로 사용하지 않는다.
- 대상 계정은 요청 본문이 아니라 Supabase Auth에서 다시 조회하며, 현재 소유자 user ID는 변경 대상에서 제외한다.
- PostgreSQL RPC도 잠근 `bbbb_admin_owners`에서 actor가 소유자이고 target은 소유자가 아닌지 독립적으로 재검증한다. 역할과 `role_version`을 함께 비교한 뒤 역할 변경과 `bbbb_admin_role_audit` 기록을 한 트랜잭션으로 처리한다.
- 감사 테이블은 일반 사용자와 관리자 브라우저에 공개하지 않는다. service role도 `SELECT`, `INSERT`만 가능하고 `UPDATE`, `DELETE`, `TRUNCATE`는 할 수 없다.

장점: 위임받은 관리자 계정이 다른 관리자를 추가하거나 소유자를 잠그지 못한다. 중복·동시 요청은 오래된 화면 상태로 새 값을 덮어쓰지 못하고, 실제 변경은 actor/target ID와 전후 역할 버전으로 추적할 수 있다.

### 브라우저 방어 심층화

- 관리자 응답은 CSP, `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `nosniff`, 엄격한 referrer/capability 정책을 사용한다.
- 관리자 Supabase SDK는 lockfile 버전으로 고정하고 SRI로 실제 바이트를 검증한다.
- 공개 회원가입은 Supabase `signUp` 흐름으로 확인 메일을 보내며, 브라우저는 메일 인증 전에 자동 로그인하지 않는다.
- 전체 사이트에는 임베드 기능을 깨뜨리지 않는 `nosniff`, referrer, capability 기본 헤더만 적용한다.

장점: XSS 공급망 변조, clickjacking, MIME sniffing, 불필요한 브라우저 장치 권한을 서로 독립된 계층에서 줄인다.

### 남용·관측 방어

- 관리자 JSON 본문은 Vercel 사전 파싱과 스트리밍 입력 모두 64KiB로 제한하고 초과 시 `413`을 반환한다. 역할 변경 명령은 별도로 2KiB까지만 허용한다.
- 관리자 인증 거부는 토큰, 쿠키, 요청 본문 없이 구조화된 `admin.authorization` 이벤트로 기록한다.
- 서버리스 인스턴스 메모리 카운터는 사용하지 않는다. 속도 제한은 아래 WAF 단계에서 전역 적용한다.

장점: 큰 본문을 이용한 메모리 고갈을 줄이고, 공격 징후를 비밀정보 유출 없이 추적한다.

## 운영 반영 순서

1. Supabase Auth에서 사전 등록된 복구 소유자 두 계정의 Auth user ID가 migration의 `bbbb_admin_owners` seed와 일치하는지 확인한 뒤 SQL Editor에서 `supabase/security-hardening-20260816.sql`을 실행한다.
2. Supabase Auth Email provider의 `Confirm email`을 켜고 운영·preview redirect URL을 정확히 등록한다. 기존 확인 완료 사용자의 로그인 상태에는 영향을 주지 않는다.
3. Vercel Preview와 Production에 서로 다른 32바이트 이상의 `BBBB_ADMIN_SESSION_SECRET`을 암호화 환경 변수로 등록한다.
   - 예: `openssl rand -base64 48`
   - `BBBB_SHARED_ADMIN_TOKEN`이나 `SUPABASE_SERVICE_ROLE_KEY`를 재사용하지 않는다.
4. `BBBB_OWNER_USER_IDS`에 migration과 같은 Auth user ID 두 개를 쉼표로 구분해 등록한다. 이메일 주소나 새로 가입할 수 있는 식별자는 넣지 않는다.
5. `BBBB_SITE_ORIGINS`를 환경별 정확한 origin 목록으로 등록한다.
   - Production: `https://www.gaeideuk.com,https://gaeideuk.com`
   - Preview: 위 목록에 실제 preview origin 하나만 추가한다.
6. 보호된 preview 배포를 만들고 아래 수동 검증을 모두 수행한다. 소유자가 QA 회원에게 관리자 권한을 부여한 뒤 다시 해제하고, `role_version` 증가와 감사 행 두 건을 확인한다.
7. Production으로 승격한다.
8. Vercel WAF 규칙을 먼저 Log 모드로 24시간 관찰한 뒤 정상 트래픽 상한보다 충분히 높은 값으로 Block 전환한다.

애플리케이션을 먼저 배포하면 전용 세션 비밀키가 없어 관리자 진입이 fail-closed 되고 `role_version` 조회도 실패한다. 반드시 환경 변수와 DB migration을 먼저 적용한다.

## Vercel WAF 시작 기준

| 경로 | 시작 기준 | 키 |
|---|---:|---|
| `/api/admin-session` | 10회 / 10분 | IP |
| `/api/admin-role` | 6회 / 10분 | IP |
| `/api/admin-*` 읽기 | 120회 / 1분 | IP |
| `/api/admin-*` 쓰기 | 30회 / 1분 | IP |
| `/api/auth-login` | 10회 / 10분 | IP |
| `/api/auth-signup` | 5회 / 1시간 | IP |
| `/api/auth-password-reset` | 5회 / 1시간 | IP |
| `/api/license-code`, `/api/guest-license-code` | 20회 / 10분 | IP |
| `/api/download-events` | 30회 / 1분 | IP |

- `OPTIONS`는 가능하면 집계에서 제외한다.
- 차단 응답은 `429`와 `Retry-After`를 사용한다.
- 관리자 쓰기, 로그인, 비밀번호 재설정은 각각 별도 규칙으로 관찰한다.
- 사용자별 실제 최대 요청량을 확인하기 전에는 더 낮은 값으로 즉시 차단하지 않는다.

## 관리자 MFA 단계

1. 모든 관리자 계정에 Supabase TOTP factor를 등록한다.
2. Preview에서 AAL2 access token으로 관리자 진입과 전체 탭을 검증한다.
3. AAL1 관리자 접근을 로그로 관찰한다.
4. 모든 관리자가 AAL2로 진입한 증거가 확인된 뒤에만 서버 측 AAL2 강제를 켠다.

MFA를 코드보다 먼저 강제하면 관리자 전체가 잠길 수 있으므로 이번 변경에서는 등록·검증 절차만 정의하고 즉시 강제하지 않는다.

## 수동 검증

- 익명 `/admin/`, `/admin/index.html`, `/admin/admin.js`, `/admin/admin.css`가 모두 `404`.
- 메인 사이트 로그인 후 관리자 버튼으로 진입하면 `200`이며 모든 관리 탭이 동작.
- 일반 로그인 사용자는 모든 `/api/admin-*`에서 `403`.
- 잘못된 토큰은 `401`, 교차 출처는 `403`, 64KiB 초과 본문은 `413`.
- 소유자는 QA 회원의 `user → admin → user`를 변경할 수 있고 각 변경마다 `role_version`과 감사 행이 하나씩 증가.
- 위임 관리자, 자동화 토큰, Origin 없는 요청은 `/api/admin-role`에서 모두 거부되고 DB 역할과 감사 행이 변하지 않음.
- 브라우저나 일반 사용자 JWT로 `bbbb_site_profiles.role`, `role_version`을 직접 수정하면 PostgreSQL 권한 오류.
- 소유자 계정에는 권한 버튼이 표시되지 않고 API 직접 호출도 `owner-role-immutable`로 거부.
- 관리자 응답 CSP 위반과 브라우저 console error가 없음.
- 일반 로그인, 확인 메일을 거친 신규 회원가입, 프로필, 스튜디오, 팀코드 공유, 공개 채널 페이지가 동작.
- 로그에 Authorization, Cookie, 라이선스 평문 코드, 비밀번호, 요청 본문이 없음.

## 롤백

1. 관리자 화면이나 API 회귀가 있으면 직전 Vercel 배포로 즉시 승격 복귀한다.
2. WAF는 규칙 삭제 대신 Log 모드로 되돌려 원인 요청을 보존한다.
3. 프로필 column privilege migration은 기존 앱의 서비스 역할 쓰기를 막지 않으므로 유지한다.
4. 전용 세션 비밀키를 기존 공유 토큰이나 service-role key로 되돌리지 않는다.
5. 잘못 위임한 역할은 소유자 API로 역변경해 감사 기록을 남긴다. 앱 롤백 후에도 `role_version`, 감사 테이블과 RPC migration은 유지한다.

## 근거

- OWASP Authorization Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html
- OWASP Content Security Policy Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Content_Security_Policy_Cheat_Sheet.html
- Supabase Column Level Security: https://supabase.com/docs/guides/database/postgres/column-level-security
- NIST SP 800-207 Zero Trust Architecture: https://csrc.nist.gov/pubs/sp/800/207/final
- Google BeyondCorp paper: https://research.google/pubs/beyondcorp-a-new-approach-to-enterprise-security/
- Vercel WAF Rate Limiting: https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting
