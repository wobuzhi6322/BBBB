create table if not exists public.bbbb_shared_profiles (
  code text primary key,
  latest_version integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.bbbb_shared_profile_versions (
  id uuid primary key default gen_random_uuid(),
  code text not null references public.bbbb_shared_profiles(code) on delete cascade,
  version integer not null,
  status text not null check (status in ('prepared', 'finalized')),
  bundle jsonb not null,
  media_files jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  finalized_at timestamptz,
  unique (code, version)
);

create index if not exists bbbb_shared_profile_versions_code_version_idx
  on public.bbbb_shared_profile_versions(code, version desc);

insert into storage.buckets (id, name, public)
values ('bbbb-shared-media', 'bbbb-shared-media', false)
on conflict (id) do nothing;

create table if not exists public.bbbb_site_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  role text not null default 'user' check (role in ('user', 'admin')),
  role_version bigint not null default 0 check (role_version >= 0),
  channel_platform text not null default 'youtube',
  channel_name text,
  channel_url text,
  trial_started_at timestamptz,
  trial_license_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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

create table if not exists public.bbbb_account_licenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  license_code text not null unique,
  plan text not null default 'starter' check (plan in ('starter', 'standard', 'pro')),
  status text not null default 'pending' check (status in ('pending', 'inactive', 'active', 'expired', 'suspended')),
  max_signatures integer not null default 3 check (max_signatures >= 0),
  max_media_mb integer not null default 50 check (max_media_mb >= 0),
  max_devices integer not null default 1 check (max_devices >= 0),
  shared_sync_enabled boolean not null default false,
  feature_flags jsonb not null default '{"signatures":true,"wallpapers":true,"tagBattle":true,"chatRace":true,"manualOverlays":true}'::jsonb,
  notes text,
  issued_at timestamptz not null default now(),
  activated_at timestamptz,
  expires_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.bbbb_account_devices (
  id uuid primary key default gen_random_uuid(),
  license_id uuid not null references public.bbbb_account_licenses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  device_fingerprint text not null,
  device_name text,
  app_version text,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (license_id, device_fingerprint)
);

create table if not exists public.bbbb_license_codes (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null unique,
  code_prefix text not null,
  plan text not null default 'starter' check (plan in ('starter', 'standard', 'pro')),
  duration_hours integer check (duration_hours is null or duration_hours > 0),
  max_redemptions integer not null default 1 check (max_redemptions > 0),
  redeemed_count integer not null default 0 check (redeemed_count >= 0),
  valid_until timestamptz,
  is_active boolean not null default true,
  feature_flags jsonb not null default '{"signatures":true,"wallpapers":true,"tagBattle":true,"chatRace":true,"manualOverlays":true}'::jsonb,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.bbbb_license_code_redemptions (
  id uuid primary key default gen_random_uuid(),
  code_id uuid not null references public.bbbb_license_codes(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  license_id uuid references public.bbbb_account_licenses(id) on delete set null,
  redeemed_at timestamptz not null default now(),
  unique (code_id, user_id)
);

create table if not exists public.bbbb_shared_code_members (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  code text not null references public.bbbb_shared_profiles(code) on delete cascade,
  role text not null default 'viewer' check (role in ('owner', 'editor', 'viewer')),
  created_at timestamptz not null default now(),
  unique (user_id, code)
);

create table if not exists public.bbbb_app_releases (
  id uuid primary key default gen_random_uuid(),
  tag_name text not null unique,
  title text not null,
  github_url text not null,
  download_url text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.bbbb_download_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  release_tag text not null,
  asset_name text not null,
  asset_url text,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists bbbb_shared_code_members_user_idx
  on public.bbbb_shared_code_members(user_id);

create index if not exists bbbb_account_licenses_user_status_idx
  on public.bbbb_account_licenses(user_id, status);

create unique index if not exists bbbb_account_licenses_one_trial_idx
  on public.bbbb_account_licenses(user_id)
  where notes = 'system:free-trial-2d';

create index if not exists bbbb_account_devices_user_seen_idx
  on public.bbbb_account_devices(user_id, last_seen_at desc);

create index if not exists bbbb_license_codes_created_idx
  on public.bbbb_license_codes(created_at desc);

create index if not exists bbbb_license_code_redemptions_user_idx
  on public.bbbb_license_code_redemptions(user_id, redeemed_at desc);

create index if not exists bbbb_shared_code_members_code_idx
  on public.bbbb_shared_code_members(code);

create index if not exists bbbb_download_events_user_created_idx
  on public.bbbb_download_events(user_id, created_at desc);

alter table public.bbbb_account_licenses
  drop constraint if exists bbbb_account_licenses_status_check;

alter table public.bbbb_account_licenses
  add constraint bbbb_account_licenses_status_check
  check (status in ('pending', 'inactive', 'active', 'expired', 'suspended'));

alter table public.bbbb_account_licenses
  add column if not exists feature_flags jsonb not null default '{"signatures":true,"wallpapers":true,"tagBattle":true,"chatRace":true,"manualOverlays":true}'::jsonb;

alter table public.bbbb_license_codes
  add column if not exists feature_flags jsonb not null default '{"signatures":true,"wallpapers":true,"tagBattle":true,"chatRace":true,"manualOverlays":true}'::jsonb;

alter table public.bbbb_site_profiles
  add column if not exists channel_platform text not null default 'youtube';

alter table public.bbbb_site_profiles
  add column if not exists channel_name text;

alter table public.bbbb_site_profiles
  add column if not exists channel_url text;

alter table public.bbbb_site_profiles
  add column if not exists trial_started_at timestamptz;

alter table public.bbbb_site_profiles
  add column if not exists trial_license_id uuid;

alter table public.bbbb_site_profiles
  drop constraint if exists bbbb_site_profiles_channel_platform_check;

alter table public.bbbb_site_profiles
  add constraint bbbb_site_profiles_channel_platform_check
  check (channel_platform in ('youtube', 'instagram', 'tiktok'));

alter table public.bbbb_site_profiles
  drop constraint if exists bbbb_site_profiles_trial_license_id_fkey;

alter table public.bbbb_site_profiles
  add constraint bbbb_site_profiles_trial_license_id_fkey
  foreign key (trial_license_id) references public.bbbb_account_licenses(id) on delete set null;

create index if not exists bbbb_site_profiles_channel_idx
  on public.bbbb_site_profiles(channel_platform, channel_name);

alter table public.bbbb_site_profiles enable row level security;
alter table public.bbbb_admin_owners enable row level security;
alter table public.bbbb_admin_role_audit enable row level security;
alter table public.bbbb_account_licenses enable row level security;
alter table public.bbbb_account_devices enable row level security;
alter table public.bbbb_license_codes enable row level security;
alter table public.bbbb_license_code_redemptions enable row level security;
alter table public.bbbb_shared_code_members enable row level security;
alter table public.bbbb_app_releases enable row level security;

revoke insert on table public.bbbb_site_profiles from authenticated;
revoke update on table public.bbbb_site_profiles from authenticated;
grant update (display_name, channel_platform, channel_name, channel_url, updated_at)
  on table public.bbbb_site_profiles to authenticated;
revoke all on table public.bbbb_admin_owners from public, anon, authenticated, service_role;
grant select on table public.bbbb_admin_owners to service_role;
revoke all on table public.bbbb_admin_role_audit from public, anon, authenticated, service_role;
grant select, insert on table public.bbbb_admin_role_audit to service_role;
alter table public.bbbb_download_events enable row level security;

create or replace function public.bbbb_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.bbbb_site_profiles
    where user_id = auth.uid()
      and role = 'admin'
  );
$$;

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

create or replace function public.bbbb_handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.bbbb_site_profiles (user_id, email, channel_platform, channel_name, channel_url)
  values (
    new.id,
    new.email,
    case
      when lower(coalesce(new.raw_user_meta_data->>'channel_platform', 'youtube')) in ('youtube', 'instagram', 'tiktok')
        then lower(coalesce(new.raw_user_meta_data->>'channel_platform', 'youtube'))
      else 'youtube'
    end,
    nullif(left(coalesce(new.raw_user_meta_data->>'channel_name', ''), 120), ''),
    nullif(left(coalesce(new.raw_user_meta_data->>'channel_url', ''), 500), '')
  )
  on conflict (user_id) do update
    set email = excluded.email,
        channel_platform = coalesce(public.bbbb_site_profiles.channel_platform, excluded.channel_platform),
        channel_name = coalesce(public.bbbb_site_profiles.channel_name, excluded.channel_name),
        channel_url = coalesce(public.bbbb_site_profiles.channel_url, excluded.channel_url),
        updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_bbbb_profile on auth.users;
create trigger on_auth_user_created_bbbb_profile
  after insert on auth.users
  for each row execute function public.bbbb_handle_new_user();

drop policy if exists "bbbb profiles read own" on public.bbbb_site_profiles;
create policy "bbbb profiles read own"
  on public.bbbb_site_profiles
  for select
  using (auth.uid() = user_id or public.bbbb_is_admin());

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

drop policy if exists "bbbb account licenses read own" on public.bbbb_account_licenses;
create policy "bbbb account licenses read own"
  on public.bbbb_account_licenses
  for select
  using (auth.uid() = user_id or public.bbbb_is_admin());

drop policy if exists "bbbb account licenses admin write" on public.bbbb_account_licenses;
create policy "bbbb account licenses admin write"
  on public.bbbb_account_licenses
  for all
  using (public.bbbb_is_admin())
  with check (public.bbbb_is_admin());

drop policy if exists "bbbb account devices read own" on public.bbbb_account_devices;
create policy "bbbb account devices read own"
  on public.bbbb_account_devices
  for select
  using (auth.uid() = user_id or public.bbbb_is_admin());

drop policy if exists "bbbb account devices admin write" on public.bbbb_account_devices;
create policy "bbbb account devices admin write"
  on public.bbbb_account_devices
  for all
  using (public.bbbb_is_admin())
  with check (public.bbbb_is_admin());

drop policy if exists "bbbb license codes admin read" on public.bbbb_license_codes;
create policy "bbbb license codes admin read"
  on public.bbbb_license_codes
  for select
  using (public.bbbb_is_admin());

drop policy if exists "bbbb license codes admin write" on public.bbbb_license_codes;
create policy "bbbb license codes admin write"
  on public.bbbb_license_codes
  for all
  using (public.bbbb_is_admin())
  with check (public.bbbb_is_admin());

drop policy if exists "bbbb license redemptions read own" on public.bbbb_license_code_redemptions;
create policy "bbbb license redemptions read own"
  on public.bbbb_license_code_redemptions
  for select
  using (auth.uid() = user_id or public.bbbb_is_admin());

drop policy if exists "bbbb license redemptions admin write" on public.bbbb_license_code_redemptions;
create policy "bbbb license redemptions admin write"
  on public.bbbb_license_code_redemptions
  for all
  using (public.bbbb_is_admin())
  with check (public.bbbb_is_admin());

drop policy if exists "bbbb shared code members read" on public.bbbb_shared_code_members;
create policy "bbbb shared code members read"
  on public.bbbb_shared_code_members
  for select
  using (auth.uid() = user_id or public.bbbb_is_admin());

drop policy if exists "bbbb shared code members admin write" on public.bbbb_shared_code_members;
create policy "bbbb shared code members admin write"
  on public.bbbb_shared_code_members
  for all
  using (public.bbbb_is_admin())
  with check (public.bbbb_is_admin());

drop policy if exists "bbbb app releases public read" on public.bbbb_app_releases;
create policy "bbbb app releases public read"
  on public.bbbb_app_releases
  for select
  using (is_active = true);

drop policy if exists "bbbb app releases admin write" on public.bbbb_app_releases;
create policy "bbbb app releases admin write"
  on public.bbbb_app_releases
  for all
  using (public.bbbb_is_admin())
  with check (public.bbbb_is_admin());

drop policy if exists "bbbb download events read own" on public.bbbb_download_events;
create policy "bbbb download events read own"
  on public.bbbb_download_events
  for select
  using (auth.uid() = user_id or public.bbbb_is_admin());
