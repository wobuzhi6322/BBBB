# DEPLOY-RELAY-P0 — gaeideuk.com 통합 배포 체크리스트 (운영자·통합자용)

대상: `feat/toonation-web` (워크트리 `C:\BBBB\cloud-toonation`) → **기존 gaeideuk.com
Vercel 프로젝트** 그대로 배포. 별도 프로젝트를 만들지 않는다 — 지금 사이트가 돌고 있는
그 프로젝트에 새 배포를 올리고 promote 한다.

이 배포가 바꾸는 것: `/` 가 시청자 랜딩이 되고, 기존 프로그램 랜딩은 `/streamer` 로
이동(내용·동작 동일), `/login` 은 시청자/스트리머 탭 겸용, `/@handle`·`/channels`·
`/me`·`/studio`·`/signup` 웹 플랫폼 페이지 신설. admin·다운로드·프로그램 로그인
게이트는 무변경이어야 한다.

원칙: 게이트 통과 → 커밋+푸시 → DB 마이그레이션 → env 확인 → `vercel deploy` →
promote → 프로덕션 스모크 → 문제 시 즉시 롤백.
service key 값은 어디에도 붙여넣거나 출력하지 않는다 — 이 문서는 **이름만** 다룬다.
배포·promote·rollback은 **통합자 + 운영자 승인** 전용(INTEGRATOR_HANDOFF §6) — 워커 위임 금지.

---

## 0. 배포 전 게이트 (이 체크아웃에서)

- [ ] `npm run check` — tsc --noEmit + check-admin-static + check-web-static 모두 통과
- [ ] `npx vitest run` — 132 테스트 0 실패
- [ ] diff 검토: `api/auth-login.ts` 라이선스 게이트 무변경, `api/_owner.ts` 무변경,
      트라이얼 자동지급 재도입 없음, `public/assets/site.js` 무변경
- [ ] **커밋 + GitHub 푸시 완료** (git에 없는 소스 배포 금지 — 2026-07-06 사고 교훈)

## 1. Supabase 마이그레이션 적용 — promote **전에** 실행

같은 Supabase 프로젝트다(현재 사이트의 라이선스·계정 스키마가 이미 있는 곳).
새 코드가 참조하는 테이블을 promote 전에 만들어 둬야 한다. 구 코드는 신규 테이블을
참조하지 않으므로 미리 실행해도 현행 서비스에 영향 없다.

1. Supabase 대시보드 로그인 → **현행 프로덕션 프로젝트** 선택 → **SQL Editor**.
2. `supabase/migrations-relay-p0.sql` 파일 전체를 붙여넣고 **1회 실행**.
   - 서비스 키 불필요 — 대시보드 세션 권한으로 충분하다.
   - 재실행해도 안전(모든 문장이 `create ... if not exists` / `on conflict do nothing`).
   - 기존 테이블 데이터 변경 없음(신규 생성 + `ip_hash` 컬럼 추가 1건뿐).
3. 확인: Table Editor에서 `bbbb_streamer_pages`, `bbbb_donation_messages`,
   `bbbb_relay_devices`, `bbbb_handle_history`, `bbbb_reserved_handles` 존재 +
   각 테이블 RLS enabled 표시 확인. Storage에 `bbbb-web-thumbs` 버킷(공개) 확인.

## 2. Vercel 환경변수 (이름만 — 값 기재·출력 금지)

**기존 프로젝트라 대부분 이미 설정돼 있다** — 지금 사이트가 그 값으로 돌고 있다.
새로 추가할 env는 없다. 확인만 한다:

- [ ] `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_ANON_KEY`(또는 기존
      배포가 쓰는 동등 키) — 기설정. 손대지 않는다.
- [ ] `BBBB_OWNER_EMAILS`, `BBBB_SHARED_ADMIN_TOKEN` — 기설정(admin·프로그램 경로).
- [ ] `BBBB_PASSWORD_RESET_REDIRECT_URL` — 미설정이면 기본값
      `https://www.gaeideuk.com/` 사용(`api/auth-password-reset.ts:8`). 프로그램
      비밀번호 재설정 링크는 URL의 `type=recovery` 를 **site.js가** 처리한다.
      **이 배포 후 `/` 는 시청자 랜딩이고, 작성 시점 기준 새 index.html은 site.js를
      로드하지 않는다** — 이 상태로 promote 하면 재설정 링크가 핸들러 없는 페이지에
      떨어진다. promote 전에 최종 index.html을 확인하고, site.js가 없으면 이 env를
      `https://www.gaeideuk.com/login` 으로 설정할 것(로그인 페이지는 site.js 유지).
- [ ] `SITE_ORIGIN` 은 **불필요** — `api/channel-page.ts:16`이
      `https://gaeideuk.com` 을 하드코딩한다(OG url·canonical 생성용).
      ⚠️ 내비게이션 레인이 보고한 정식(canonical) 도메인과 대조할 것:
      정식이 `www.gaeideuk.com` 이면 이 상수는 **통합자가** 배포 전에 수정해야 한다
      (api/*.ts는 워커 레인에게 read-only).

## 3. 배포 — INTEGRATOR_HANDOFF §6 런북 그대로

1. 이 워크트리(`feat/toonation-web` 체크아웃)에서 `vercel deploy` 실행.
2. 출력된 배포(프리뷰) URL 확인 — **프리뷰 URL은 Vercel SSO로 보호돼 있어**
   curl 하면 SSO 리다이렉트(HTML)가 온다. 200/리다이렉트가 오는지(빌드 성공)만
   확인하고, **실질 검증은 promote 후 프로덕션 알리아스에서** 한다.
3. `vercel promote <배포URL>` — 프로덕션이 pinned 상태라 promote 없이는 반영 안 됨.
   - CLI 토큰: `%APPDATA%\xdg.data\com.vercel.cli\auth.json`
     (⚠️ `...\Data\auth.json` 쪽 토큰은 invalidToken).
4. 즉시 1차 확인:
   ```
   curl -s https://gaeideuk.com/ | head            # 시청자 랜딩 HTML
   curl -s https://gaeideuk.com/streamer | head    # 프로그램 랜딩 HTML
   curl -s https://gaeideuk.com/@<핸들> | grep og:  # SSR OG 태그
   ```

## 4. 배포 후 스모크 — 프로덕션 알리아스에서

### 4a. 통합 회귀 (이 배포로 깨지면 안 되는 것들)

- [ ] `/` — 시청자 랜딩 렌더링(모바일 360px 가로 스크롤 0), 헤더·테마 토글 동작
- [ ] `/streamer` — 기존 프로그램 랜딩 **원형 그대로**: 요금제 표, **다운로드 링크
      동작**, 로그인 게이트 문구("사용 가능한 요금제가 없습니다...") 경로 확인
- [ ] `/login` — 시청자/스트리머 **두 탭 모두** 동작. 스트리머 탭은 기존
      라이선스 게이트 `/api/auth-login`(site.js) 경로 그대로
- [ ] `/admin/` — 관리자 화면 진입·로그인 정상
- [ ] `/@<핸들>` — 채널 페이지 SSR + OG 태그(위 curl), `/channels` — 디렉터리 렌더링
- [ ] `/@<핸들>?mock=1`, `/studio?mock=1` — 목 모드 유지
- [ ] 프로그램 페어링: 데스크톱 프로그램 관리자 → 릴레이 카드에
      `https://gaeideuk.com` + 연결코드 입력 → 페어링 성공

### 4b. 릴레이 기능 스모크 (VIEWER_MESSAGE_RELAY_PLAN §11 그대로)

- [ ] 시청자: 바로가기 접속 → 등록 → 안내 화면에 계좌·닉네임·금액·시한 표시
- [ ] 이체 후 1분 내(폴링 30초 주기) 방송 오버레이에 메시지 출력, 상태 페이지 "출력됨"
- [ ] 닉네임/금액 불일치 이체 → 일반 알림만 출력(메시지 없음), pending 유지
- [ ] 24시간 경과 → 상태 "만료", 이후 동일 입금에 미부착
- [ ] 릴레이 끊김(웹 장애) 상태에서 입금 → 방송 알림 정상(불변식)
- [ ] 라이선스 비활성 계정 → 디렉터리 미노출 + 등록 API 403
- [ ] 엔터 페이지 → 멤버 그리드 → 멤버 바로가기 직행 (P2 배포 후 항목)
- [ ] 핸들 변경 → 구 주소 301 리다이렉트

## 5. 롤백

**웹(Vercel) — 즉시 롤백**: Deployments에서 **직전 프로덕션 배포**(641af1d D-reskin)
를 찾아 `vercel promote <직전 배포URL>` (또는 대시보드 → 해당 배포 → Promote to
Production). 프로덕션이 pinned 방식이라 promote가 곧 즉시 롤백이다.

**DB(Supabase)**: 이 마이그레이션은 신규 테이블 생성뿐이므로 **웹 롤백만으로 서비스는
복구된다**(구 코드가 신규 테이블을 참조하지 않음). 테이블까지 제거해야 하면 SQL Editor
에서 역순으로 — PART 2(핸들 이력·예약어)부터, 그다음 PART 1(웹 플랫폼 스키마):

```sql
-- PART 2 (핸들 바로가기)
drop table if exists public.bbbb_handle_history;
drop table if exists public.bbbb_reserved_handles;
-- PART 1 (웹 플랫폼 스키마, 역순)
drop table if exists public.bbbb_payment_intents;
drop table if exists public.bbbb_ledger_entries;
drop table if exists public.bbbb_wallets;
drop table if exists public.bbbb_web_reports;
drop table if exists public.bbbb_relay_devices;
drop table if exists public.bbbb_page_blocks;
drop table if exists public.bbbb_donation_matches;
drop table if exists public.bbbb_donation_messages;
drop table if exists public.bbbb_page_signatures;
drop table if exists public.bbbb_page_follows;
drop table if exists public.bbbb_streamer_pages;
drop table if exists public.bbbb_web_profiles;
delete from storage.buckets where id = 'bbbb-web-thumbs';
-- 버킷에 객체가 있으면 먼저: delete from storage.objects where bucket_id = 'bbbb-web-thumbs';
```

⚠️ drop은 pending·매칭 감사 데이터를 지운다 — 운영 개시 후에는 drop 대신 웹 롤백만.
