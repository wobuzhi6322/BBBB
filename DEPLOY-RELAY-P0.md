# DEPLOY-RELAY-P0 — 운영자용 배포 체크리스트

대상: `release/relay-p0` (gaeideuk.com — Vercel + Supabase).
원칙: DB 마이그레이션 → env 확인 → 배포(통합자 런북) → 스모크 → 문제 시 롤백.
service key 값은 어디에도 붙여넣거나 출력하지 않는다 — 이 문서는 **이름만** 다룬다.

---

## 1. Supabase 마이그레이션 적용

1. Supabase 대시보드 로그인 → 프로덕션 프로젝트 선택 → **SQL Editor**.
2. `supabase/migrations-relay-p0.sql` 파일 전체를 붙여넣고 **1회 실행**.
   - 서비스 키 불필요 — 대시보드 세션 권한으로 충분하다.
   - 재실행해도 안전(모든 문장이 `create ... if not exists` / `on conflict do nothing`).
   - 기존 테이블 데이터 변경 없음(신규 생성 + `ip_hash` 컬럼 추가 1건뿐).
3. 확인: Table Editor에서 `bbbb_streamer_pages`, `bbbb_donation_messages`,
   `bbbb_relay_devices`, `bbbb_handle_history`, `bbbb_reserved_handles` 존재 +
   각 테이블 RLS enabled 표시 확인. Storage에 `bbbb-web-thumbs` 버킷(공개) 확인.

## 2. Vercel 환경변수 확인 (이름만 — 값 기재·출력 금지)

Vercel 프로젝트 → Settings → Environment Variables 에서 아래가 Production에 설정돼
있는지 확인한다:

- [ ] `SUPABASE_URL`
- [ ] `SUPABASE_SERVICE_ROLE_KEY` (서버 함수 전용 — 절대 클라이언트/로그 노출 금지)
- [ ] `SUPABASE_ANON_KEY` (또는 기존 배포가 쓰는 `SUPABASE_PUBLISHABLE_KEY` /
      `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `VITE_SUPABASE_ANON_KEY` 중 실제 설정된 것)
- [ ] `BBBB_OWNER_EMAILS`
- [ ] `BBBB_SHARED_ADMIN_TOKEN`
- [ ] (선택) `BBBB_PASSWORD_RESET_REDIRECT_URL`, `SUPABASE_STORAGE_BUCKET`,
      `GITHUB_TOKEN` / `GITHUB_REPO` (릴리스 다운로드 프록시 사용 시)

## 3. 배포 — 통합자 런북 준수 (INTEGRATOR_HANDOFF §6)

배포·promote는 **통합자 + 운영자 승인** 전용. 워커에게 위임 금지.

1. 배포 전 `release/relay-p0` **커밋 + GitHub 푸시** 완료 확인 (git에 없는 소스 배포 금지).
2. diff 검토: `api/auth-login.ts` 라이선스 게이트 무변경, `api/_owner.ts` 무변경,
   트라이얼 자동지급 재도입 없음.
3. 해당 브랜치 워크트리에서 `vercel deploy` → 출력된 배포 URL을 `curl`로 검증 →
   `vercel promote <배포URL>` (프로덕션이 pinned 상태라 promote 필수).
4. 검증: `curl -s https://gaeideuk.com/ | head` + 로그인 게이트 문구
   ("사용 가능한 요금제가 없습니다...") 경로 확인.

## 4. 배포 후 스모크 (기획서 VIEWER_MESSAGE_RELAY_PLAN §11 그대로)

- [ ] 시청자: 바로가기 접속 → 등록 → 안내 화면에 계좌·닉네임·금액·시한 표시
- [ ] 이체 후 1분 내(폴링 30초 주기) 방송 오버레이에 메시지 출력, 상태 페이지 "출력됨"
- [ ] 닉네임/금액 불일치 이체 → 일반 알림만 출력(메시지 없음), pending 유지
- [ ] 24시간 경과 → 상태 "만료", 이후 동일 입금에 미부착
- [ ] 릴레이 끊김(웹 장애) 상태에서 입금 → 방송 알림 정상(불변식)
- [ ] 라이선스 비활성 계정 → 디렉터리 미노출 + 등록 API 403
- [ ] 엔터 페이지 → 멤버 그리드 → 멤버 바로가기 직행 (P2 배포 후 항목)
- [ ] 핸들 변경 → 구 주소 301 리다이렉트

## 5. 롤백

**웹(Vercel)**: `vercel rollback` 으로 직전 프로덕션 배포로 복귀
(또는 대시보드 Deployments → 직전 배포 → Promote). CLI 토큰 위치는
INTEGRATOR_HANDOFF §6 참조.

**DB(Supabase)**: 이 마이그레이션은 신규 테이블 생성뿐이므로 웹 롤백만으로 서비스는
복구된다(구 코드가 신규 테이블을 참조하지 않음). 테이블까지 제거해야 하면 SQL Editor
에서 역순으로:

```sql
drop table if exists public.bbbb_handle_history;
drop table if exists public.bbbb_reserved_handles;
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
