begin;

revoke insert on table public.bbbb_site_profiles from authenticated;
revoke update on table public.bbbb_site_profiles from authenticated;
grant update (display_name, channel_platform, channel_name, channel_url, updated_at)
  on table public.bbbb_site_profiles to authenticated;

alter table public.bbbb_site_profiles
  add column if not exists role_version bigint not null default 0;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'bbbb_site_profiles_role_version_check'
      and conrelid = 'public.bbbb_site_profiles'::regclass
  ) then
    alter table public.bbbb_site_profiles
      add constraint bbbb_site_profiles_role_version_check
      check (role_version >= 0);
  end if;
end;
$$;

create table if not exists public.bbbb_admin_owners (
  user_id uuid primary key,
  created_at timestamptz not null default now()
);

insert into public.bbbb_admin_owners (user_id)
values
  ('49ba6b61-f491-47a5-a687-97dcf4c14b61'),
  ('fec25c39-3108-4715-a10a-62b41d6df24d')
on conflict (user_id) do nothing;

alter table public.bbbb_admin_owners enable row level security;
revoke all on table public.bbbb_admin_owners from public, anon, authenticated, service_role;
grant select on table public.bbbb_admin_owners to service_role;

create table if not exists public.bbbb_admin_role_audit (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid not null,
  target_user_id uuid not null,
  previous_role text not null check (previous_role in ('user', 'admin')),
  new_role text not null check (new_role in ('user', 'admin')),
  previous_version bigint not null check (previous_version >= 0),
  new_version bigint not null check (new_version = previous_version + 1),
  reason text check (reason is null or char_length(reason) <= 200),
  request_id text check (request_id is null or char_length(request_id) <= 200),
  created_at timestamptz not null default now()
);

create index if not exists bbbb_admin_role_audit_target_created_idx
  on public.bbbb_admin_role_audit(target_user_id, created_at desc);

alter table public.bbbb_admin_role_audit enable row level security;
revoke all on table public.bbbb_admin_role_audit from public, anon, authenticated, service_role;
grant select, insert on table public.bbbb_admin_role_audit to service_role;

drop policy if exists "bbbb profiles insert own" on public.bbbb_site_profiles;
create policy "bbbb profiles insert own"
  on public.bbbb_site_profiles
  for insert
  with check (auth.uid() = user_id and role = 'user');

drop policy if exists "bbbb profiles update own" on public.bbbb_site_profiles;
create policy "bbbb profiles update own"
  on public.bbbb_site_profiles
  for update
  using (auth.uid() = user_id and role = 'user')
  with check (auth.uid() = user_id and role = 'user');

drop policy if exists "bbbb profiles admin update" on public.bbbb_site_profiles;
create policy "bbbb profiles admin update"
  on public.bbbb_site_profiles
  for update
  using (public.bbbb_is_admin())
  with check (public.bbbb_is_admin());

create or replace function public.bbbb_owner_change_admin_role(
  p_actor_user_id uuid,
  p_target_user_id uuid,
  p_expected_role text,
  p_expected_role_version bigint,
  p_new_role text,
  p_reason text default null,
  p_request_id text default null
)
returns table (
  user_id uuid,
  email text,
  role text,
  role_version bigint,
  audit_event_id uuid
)
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  current_email text;
  current_profile_role text;
  current_version bigint;
  next_version bigint;
  new_audit_event_id uuid;
begin
  if p_actor_user_id is null
    or p_target_user_id is null
    or p_expected_role is null
    or p_expected_role_version is null
    or p_new_role is null
    or p_expected_role not in ('user', 'admin')
    or p_new_role not in ('user', 'admin')
    or p_expected_role_version < 0
    or (p_reason is not null and char_length(p_reason) > 200)
    or (p_request_id is not null and char_length(p_request_id) > 200)
  then
    raise exception 'invalid admin role change command' using errcode = '22023';
  end if;

  perform 1
  from public.bbbb_admin_owners as owner_record
  where owner_record.user_id = p_actor_user_id
  for share;

  if not found then
    raise exception 'owner role is required' using errcode = '42501';
  end if;

  perform 1
  from public.bbbb_admin_owners as owner_record
  where owner_record.user_id = p_target_user_id
  for share;

  if found then
    raise exception 'owner role is immutable' using errcode = '42501';
  end if;

  select profile.email, profile.role, profile.role_version
    into current_email, current_profile_role, current_version
  from public.bbbb_site_profiles as profile
  where profile.user_id = p_target_user_id
  for update;

  if not found
    or current_profile_role <> p_expected_role
    or current_version <> p_expected_role_version
  then
    return;
  end if;

  if current_profile_role = p_new_role then
    return query
      select p_target_user_id, current_email, current_profile_role, current_version, null::uuid;
    return;
  end if;

  next_version := current_version + 1;

  update public.bbbb_site_profiles as profile
  set role = p_new_role,
      role_version = next_version,
      updated_at = now()
  where profile.user_id = p_target_user_id;

  insert into public.bbbb_admin_role_audit (
    actor_user_id,
    target_user_id,
    previous_role,
    new_role,
    previous_version,
    new_version,
    reason,
    request_id
  )
  values (
    p_actor_user_id,
    p_target_user_id,
    current_profile_role,
    p_new_role,
    current_version,
    next_version,
    p_reason,
    p_request_id
  )
  returning id into new_audit_event_id;

  return query
    select p_target_user_id, current_email, p_new_role, next_version, new_audit_event_id;
end;
$$;

revoke execute on function public.bbbb_owner_change_admin_role(
  uuid, uuid, text, bigint, text, text, text
) from public, anon, authenticated;
grant execute on function public.bbbb_owner_change_admin_role(
  uuid, uuid, text, bigint, text, text, text
) to service_role;

commit;
