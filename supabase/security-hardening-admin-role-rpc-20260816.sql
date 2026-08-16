begin;

set local lock_timeout = '3s';
set local statement_timeout = '60s';

alter function public.bbbb_owner_change_admin_role(
  uuid, uuid, text, bigint, text, text, text
) owner to postgres;

alter function public.bbbb_owner_change_admin_role(
  uuid, uuid, text, bigint, text, text, text
) security definer;

alter function public.bbbb_owner_change_admin_role(
  uuid, uuid, text, bigint, text, text, text
) set search_path to pg_catalog, public;

revoke all privileges on function public.bbbb_owner_change_admin_role(
  uuid, uuid, text, bigint, text, text, text
) from public, anon, authenticated, service_role;

grant execute on function public.bbbb_owner_change_admin_role(
  uuid, uuid, text, bigint, text, text, text
) to service_role;

commit;
