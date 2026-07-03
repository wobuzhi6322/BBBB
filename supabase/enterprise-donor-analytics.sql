create table if not exists public.bbbb_enterprises (
  id text primary key default gen_random_uuid()::text,
  name text not null,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.bbbb_enterprise_members (
  id text primary key default gen_random_uuid()::text,
  enterprise_id text not null references public.bbbb_enterprises(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'streamer', 'viewer')),
  streamer_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (enterprise_id, user_id)
);

create table if not exists public.bbbb_enterprise_streamers (
  id text primary key default gen_random_uuid()::text,
  enterprise_id text not null references public.bbbb_enterprises(id) on delete cascade,
  display_name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.bbbb_enterprise_donation_imports (
  id text primary key default gen_random_uuid()::text,
  enterprise_id text not null references public.bbbb_enterprises(id) on delete cascade,
  streamer_id text references public.bbbb_enterprise_streamers(id) on delete set null,
  source_kind text not null check (source_kind in ('csv', 'google_sheet', 'manual')),
  source_label text,
  status text not null check (status in ('processing', 'imported', 'failed', 'reverted')),
  raw_row_count integer not null default 0,
  imported_row_count integer not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.bbbb_enterprise_donations (
  id text primary key default gen_random_uuid()::text,
  enterprise_id text not null references public.bbbb_enterprises(id) on delete cascade,
  streamer_id text not null references public.bbbb_enterprise_streamers(id) on delete cascade,
  import_id text references public.bbbb_enterprise_donation_imports(id) on delete set null,
  donor_name text not null,
  donor_key text not null,
  amount_krw integer not null check (amount_krw > 0),
  donated_on date not null,
  source_row_hash text not null,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (enterprise_id, source_row_hash)
);

create table if not exists public.bbbb_enterprise_donor_aliases (
  id text primary key default gen_random_uuid()::text,
  enterprise_id text not null references public.bbbb_enterprises(id) on delete cascade,
  donor_key text not null,
  alias text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (enterprise_id, alias)
);

alter table public.bbbb_enterprises enable row level security;
alter table public.bbbb_enterprise_members enable row level security;
alter table public.bbbb_enterprise_streamers enable row level security;
alter table public.bbbb_enterprise_donation_imports enable row level security;
alter table public.bbbb_enterprise_donations enable row level security;
alter table public.bbbb_enterprise_donor_aliases enable row level security;

grant select, insert, update, delete on table public.bbbb_enterprises to authenticated;
grant select, insert, update, delete on table public.bbbb_enterprise_members to authenticated;
grant select, insert, update, delete on table public.bbbb_enterprise_streamers to authenticated;
grant select, insert, update, delete on table public.bbbb_enterprise_donation_imports to authenticated;
grant select, insert, update, delete on table public.bbbb_enterprise_donations to authenticated;
grant select, insert, update, delete on table public.bbbb_enterprise_donor_aliases to authenticated;

create or replace function public.bbbb_enterprise_member_role(target_enterprise_id text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role
  from public.bbbb_enterprise_members
  where enterprise_id = target_enterprise_id
    and user_id = auth.uid()
  limit 1
$$;

create or replace function public.bbbb_enterprise_can_manage(target_enterprise_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.bbbb_enterprise_member_role(target_enterprise_id) in ('owner', 'admin')
$$;

create or replace function public.bbbb_enterprise_can_read_streamer_data(target_enterprise_id text, target_streamer_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.bbbb_enterprise_members
    where enterprise_id = target_enterprise_id
      and user_id = auth.uid()
      and (
        role in ('owner', 'admin')
        or (role = 'streamer' and streamer_id = target_streamer_id)
      )
  )
$$;

create policy "bbbb enterprises read enterprise"
on public.bbbb_enterprises
for select
to authenticated
using (public.bbbb_enterprise_member_role(id) is not null);

create policy "bbbb enterprises write manage"
on public.bbbb_enterprises
for all
to authenticated
using (public.bbbb_enterprise_can_manage(id))
with check (public.bbbb_enterprise_can_manage(id));

create policy "bbbb members read enterprise"
on public.bbbb_enterprise_members
for select
to authenticated
using (public.bbbb_enterprise_can_manage(enterprise_id) or user_id = auth.uid());

create policy "bbbb members write manage"
on public.bbbb_enterprise_members
for all
to authenticated
using (public.bbbb_enterprise_can_manage(enterprise_id))
with check (public.bbbb_enterprise_can_manage(enterprise_id));

create policy "bbbb streamers read enterprise"
on public.bbbb_enterprise_streamers
for select
to authenticated
using (
  public.bbbb_enterprise_can_manage(enterprise_id)
  or public.bbbb_enterprise_can_read_streamer_data(enterprise_id, id)
);

create policy "bbbb streamers write manage"
on public.bbbb_enterprise_streamers
for all
to authenticated
using (public.bbbb_enterprise_can_manage(enterprise_id))
with check (public.bbbb_enterprise_can_manage(enterprise_id));

create policy "bbbb imports read enterprise"
on public.bbbb_enterprise_donation_imports
for select
to authenticated
using (
  public.bbbb_enterprise_can_manage(enterprise_id)
  or public.bbbb_enterprise_can_read_streamer_data(enterprise_id, streamer_id)
  or exists (
    select 1
    from public.bbbb_enterprise_donations donation
    where donation.import_id = bbbb_enterprise_donation_imports.id
      and public.bbbb_enterprise_can_read_streamer_data(donation.enterprise_id, donation.streamer_id)
  )
);

create policy "bbbb imports write manage"
on public.bbbb_enterprise_donation_imports
for all
to authenticated
using (public.bbbb_enterprise_can_manage(enterprise_id))
with check (public.bbbb_enterprise_can_manage(enterprise_id));

create policy "bbbb donations read enterprise"
on public.bbbb_enterprise_donations
for select
to authenticated
using (
  public.bbbb_enterprise_can_manage(enterprise_id)
  or public.bbbb_enterprise_can_read_streamer_data(enterprise_id, streamer_id)
);

create policy "bbbb donations write manage"
on public.bbbb_enterprise_donations
for all
to authenticated
using (public.bbbb_enterprise_can_manage(enterprise_id))
with check (public.bbbb_enterprise_can_manage(enterprise_id));

create policy "bbbb donor aliases read enterprise"
on public.bbbb_enterprise_donor_aliases
for select
to authenticated
using (public.bbbb_enterprise_can_manage(enterprise_id));

create policy "bbbb donor aliases write manage"
on public.bbbb_enterprise_donor_aliases
for all
to authenticated
using (public.bbbb_enterprise_can_manage(enterprise_id))
with check (public.bbbb_enterprise_can_manage(enterprise_id));
