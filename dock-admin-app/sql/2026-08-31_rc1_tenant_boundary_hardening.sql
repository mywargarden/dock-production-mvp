-- Dock 1.0 RC1 tenant-boundary hardening.
-- Mirrors production migrations applied during the RC1 falsification pass on 2026-08-31.

begin;

-- Profiles must default to the only non-admin application role allowed by the schema.
alter table public.profiles alter column role set default 'member';

-- A user profile may only be initially bound to a tenant justified by a verified domain,
-- explicit allowed-user record, or active district-admin grant. Existing profiles may not
-- silently move between tenants.
create or replace function public.dock_enforce_profile_tenant_binding()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_email text := lower(trim(coalesce(new.email, '')));
  v_domain text := split_part(lower(trim(coalesce(new.email, ''))), '@', 2);
  v_authorized boolean := false;
begin
  if new.organization_id is null then
    raise exception 'PROFILE_ORGANIZATION_REQUIRED';
  end if;

  if v_email = '' or position('@' in v_email) = 0 then
    raise exception 'PROFILE_EMAIL_REQUIRED_FOR_ORGANIZATION_BINDING';
  end if;

  if tg_op = 'UPDATE'
     and old.organization_id is not null
     and new.organization_id is distinct from old.organization_id then
    raise exception 'PROFILE_ORGANIZATION_IMMUTABLE';
  end if;

  select (
    exists (
      select 1 from public.organization_domains od
      where od.organization_id = new.organization_id
        and od.status = 'verified'
        and lower(od.normalized_domain) = v_domain
    )
    or exists (
      select 1 from public.organization_allowed_users au
      where au.organization_id = new.organization_id
        and au.status = 'active'
        and lower(au.email) = v_email
        and (au.expires_at is null or au.expires_at > now())
    )
    or exists (
      select 1 from public.organization_admins oa
      where oa.organization_id = new.organization_id
        and coalesce(oa.status, 'active') = 'active'
        and lower(oa.email) = v_email
    )
  ) into v_authorized;

  if not v_authorized then
    raise exception 'PROFILE_ORGANIZATION_NOT_AUTHORIZED';
  end if;

  return new;
end;
$$;

revoke execute on function public.dock_enforce_profile_tenant_binding() from public, anon, authenticated;
grant execute on function public.dock_enforce_profile_tenant_binding() to service_role;

drop trigger if exists dock_profiles_tenant_binding_guard on public.profiles;
create trigger dock_profiles_tenant_binding_guard
before insert or update of organization_id, email
on public.profiles
for each row
execute function public.dock_enforce_profile_tenant_binding();

-- Remove mutable search paths from generic trigger functions.
alter function public.dock_touch_updated_at() set search_path = public, pg_temp;
alter function public.set_current_timestamp_updated_at() set search_path = public, pg_temp;

-- Delete the old HCPS special-case RLS paths. A district admin only controls its own tenant.
drop policy if exists organizations_admin_insert_hcps on public.organizations;
drop policy if exists organizations_admin_select on public.organizations;
drop policy if exists organizations_admin_update on public.organizations;

create policy organizations_admin_select on public.organizations for select to authenticated
using (exists (select 1 from public.profiles p where p.id=(select auth.uid()) and p.organization_id=organizations.id and p.role='admin' and p.status='active'));

create policy organizations_admin_update on public.organizations for update to authenticated
using (exists (select 1 from public.profiles p where p.id=(select auth.uid()) and p.organization_id=organizations.id and p.role='admin' and p.status='active'))
with check (exists (select 1 from public.profiles p where p.id=(select auth.uid()) and p.organization_id=organizations.id and p.role='admin' and p.status='active'));

-- Disabled admins lose all workspace and workspace-history privileges immediately.
drop policy if exists workspaces_admin_select on public.workspaces;
drop policy if exists workspaces_admin_insert on public.workspaces;
drop policy if exists workspaces_admin_update on public.workspaces;
drop policy if exists workspaces_admin_delete on public.workspaces;
create policy workspaces_admin_select on public.workspaces for select to authenticated using (exists (select 1 from public.profiles p where p.id=(select auth.uid()) and p.organization_id=workspaces.organization_id and p.role='admin' and p.status='active'));
create policy workspaces_admin_insert on public.workspaces for insert to authenticated with check (exists (select 1 from public.profiles p where p.id=(select auth.uid()) and p.organization_id=workspaces.organization_id and p.role='admin' and p.status='active'));
create policy workspaces_admin_update on public.workspaces for update to authenticated using (exists (select 1 from public.profiles p where p.id=(select auth.uid()) and p.organization_id=workspaces.organization_id and p.role='admin' and p.status='active')) with check (exists (select 1 from public.profiles p where p.id=(select auth.uid()) and p.organization_id=workspaces.organization_id and p.role='admin' and p.status='active'));
create policy workspaces_admin_delete on public.workspaces for delete to authenticated using (exists (select 1 from public.profiles p where p.id=(select auth.uid()) and p.organization_id=workspaces.organization_id and p.role='admin' and p.status='active'));

drop policy if exists workspace_tabs_admin_select on public.workspace_tabs;
drop policy if exists workspace_tabs_admin_insert on public.workspace_tabs;
drop policy if exists workspace_tabs_admin_update on public.workspace_tabs;
drop policy if exists workspace_tabs_admin_delete on public.workspace_tabs;
create policy workspace_tabs_admin_select on public.workspace_tabs for select to authenticated using (exists (select 1 from public.workspaces w join public.profiles p on p.organization_id=w.organization_id where w.id=workspace_tabs.workspace_id and p.id=(select auth.uid()) and p.role='admin' and p.status='active'));
create policy workspace_tabs_admin_insert on public.workspace_tabs for insert to authenticated with check (exists (select 1 from public.workspaces w join public.profiles p on p.organization_id=w.organization_id where w.id=workspace_tabs.workspace_id and p.id=(select auth.uid()) and p.role='admin' and p.status='active'));
create policy workspace_tabs_admin_update on public.workspace_tabs for update to authenticated using (exists (select 1 from public.workspaces w join public.profiles p on p.organization_id=w.organization_id where w.id=workspace_tabs.workspace_id and p.id=(select auth.uid()) and p.role='admin' and p.status='active')) with check (exists (select 1 from public.workspaces w join public.profiles p on p.organization_id=w.organization_id where w.id=workspace_tabs.workspace_id and p.id=(select auth.uid()) and p.role='admin' and p.status='active'));
create policy workspace_tabs_admin_delete on public.workspace_tabs for delete to authenticated using (exists (select 1 from public.workspaces w join public.profiles p on p.organization_id=w.organization_id where w.id=workspace_tabs.workspace_id and p.id=(select auth.uid()) and p.role='admin' and p.status='active'));

drop policy if exists workspace_versions_admin_select on public.workspace_versions;
create policy workspace_versions_admin_select on public.workspace_versions for select to authenticated
using (exists (select 1 from public.profiles p where p.id=(select auth.uid()) and p.organization_id=workspace_versions.organization_id and p.role='admin' and p.status='active'));

commit;
