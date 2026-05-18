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
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.bbbb_account_licenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  license_code text not null unique,
  plan text not null default 'starter' check (plan in ('starter', 'standard', 'pro')),
  status text not null default 'pending' check (status in ('pending', 'active', 'expired', 'suspended')),
  max_signatures integer not null default 3 check (max_signatures >= 0),
  max_media_mb integer not null default 50 check (max_media_mb >= 0),
  max_devices integer not null default 1 check (max_devices >= 0),
  shared_sync_enabled boolean not null default false,
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

alter table public.bbbb_site_profiles enable row level security;
alter table public.bbbb_account_licenses enable row level security;
alter table public.bbbb_account_devices enable row level security;
alter table public.bbbb_license_codes enable row level security;
alter table public.bbbb_license_code_redemptions enable row level security;
alter table public.bbbb_shared_code_members enable row level security;
alter table public.bbbb_app_releases enable row level security;
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

create or replace function public.bbbb_handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.bbbb_site_profiles (user_id, email)
  values (new.id, new.email)
  on conflict (user_id) do update
    set email = excluded.email,
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
  with check (auth.uid() = user_id);

drop policy if exists "bbbb profiles update own" on public.bbbb_site_profiles;
create policy "bbbb profiles update own"
  on public.bbbb_site_profiles
  for update
  using (auth.uid() = user_id or public.bbbb_is_admin())
  with check (auth.uid() = user_id or public.bbbb_is_admin());

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
