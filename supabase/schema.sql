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
