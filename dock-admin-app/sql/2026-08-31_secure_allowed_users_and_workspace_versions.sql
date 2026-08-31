-- Dock 1.0 RC1 security hardening for outside-domain access and workspace history.
-- Mirrors the production migration applied on 2026-08-31.

begin;

alter table public.organization_allowed_users enable row level security;
alter table public.workspace_versions enable row level security;

revoke all privileges on table public.organization_allowed_users from anon;
revoke all privileges on table public.organization_allowed_users from authenticated;

revoke all privileges on table public.workspace_versions from anon;
revoke all privileges on table public.workspace_versions from authenticated;
grant select on table public.workspace_versions to authenticated;

drop policy if exists organization_allowed_users_service_role_all on public.organization_allowed_users;
create policy organization_allowed_users_service_role_all
on public.organization_allowed_users
for all
to public
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

drop policy if exists workspace_versions_service_role_all on public.workspace_versions;
create policy workspace_versions_service_role_all
on public.workspace_versions
for all
to public
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

drop policy if exists workspace_versions_admin_select on public.workspace_versions;
create policy workspace_versions_admin_select
on public.workspace_versions
for select
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.organization_id = workspace_versions.organization_id
      and p.role = any (array['admin'::text, 'owner'::text])
      and coalesce(p.status, 'active') <> 'inactive'
  )
);

commit;
