-- Dock 1.0 current-authority, seat-capacity, legacy-memory, and managed-asset invariants.
-- This file records live Supabase changes discovered during recursive Stage-7 verification.

-- Managed visual assets are public immutable references, not inline config payloads.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('managed-assets','managed-assets',true,1500000,array['image/png','image/jpeg','image/webp'])
on conflict (id) do update set
  public=excluded.public,
  file_size_limit=excluded.file_size_limit,
  allowed_mime_types=excluded.allowed_mime_types;

-- Profile tenant binding remains authoritative at the DB boundary and now serializes seat claims.
create or replace function public.dock_enforce_profile_tenant_binding()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_email text := lower(trim(coalesce(new.email, '')));
  v_domain text := split_part(lower(trim(coalesce(new.email, ''))), '@', 2);
  v_authorized boolean := false;
  v_org public.organizations%rowtype;
  v_active_count integer := 0;
  v_needs_seat boolean := false;
begin
  if new.organization_id is null then raise exception 'PROFILE_ORGANIZATION_REQUIRED'; end if;
  if v_email = '' or position('@' in v_email) = 0 then raise exception 'PROFILE_EMAIL_REQUIRED_FOR_ORGANIZATION_BINDING'; end if;
  if tg_op='UPDATE' and old.organization_id is not null and new.organization_id is distinct from old.organization_id then
    raise exception 'PROFILE_ORGANIZATION_IMMUTABLE';
  end if;

  select * into v_org from public.organizations where id=new.organization_id for update;
  if not found then raise exception 'PROFILE_ORGANIZATION_NOT_FOUND'; end if;

  select (
    exists (select 1 from public.organization_domains od where od.organization_id=new.organization_id and od.status='verified' and lower(od.normalized_domain)=v_domain)
    or exists (select 1 from public.organization_allowed_users au where au.organization_id=new.organization_id and au.status='active' and lower(au.email)=v_email and (au.expires_at is null or au.expires_at>now()))
    or exists (select 1 from public.organization_admins oa where oa.organization_id=new.organization_id and coalesce(oa.status,'active')='active' and lower(oa.email)=v_email)
  ) into v_authorized;
  if not v_authorized then raise exception 'PROFILE_ORGANIZATION_NOT_AUTHORIZED'; end if;

  v_needs_seat := lower(coalesce(new.status,'active'))='active'
    and (tg_op='INSERT' or lower(coalesce(old.status,'disabled'))<>'active');
  if v_needs_seat and coalesce(v_org.max_users,0)>0 then
    select count(*)::integer into v_active_count
    from public.profiles p
    where p.organization_id=new.organization_id and p.status='active'
      and (tg_op<>'UPDATE' or p.id<>new.id);
    if v_active_count>=v_org.max_users then raise exception 'SEAT_LIMIT_EXCEEDED'; end if;
  end if;
  return new;
end;
$$;

drop trigger if exists dock_profiles_tenant_binding_guard on public.profiles;
create trigger dock_profiles_tenant_binding_guard
before insert or update of organization_id,email,status on public.profiles
for each row execute function public.dock_enforce_profile_tenant_binding();

-- One authoritative current-admin predicate for direct-table RLS.
create or replace function public.dock_admin_access_allowed(p_user_id uuid,p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.profiles p
    join public.organizations o on o.id=p.organization_id
    join public.organization_admins a
      on a.organization_id=p.organization_id
     and lower(a.email)=lower(p.email)
     and coalesce(a.status,'active')='active'
    where p.id=p_user_id
      and p.organization_id=p_organization_id
      and p.role='admin'
      and p.status='active'
      and coalesce(o.customer_lifecycle,'setup')<>'archived'
      and (
        lower(coalesce(o.license_status,'trial')) in ('trial','active')
        or (lower(coalesce(o.license_status,'trial'))='past_due'
            and o.license_renewal_date is not null
            and now()<=o.license_renewal_date + make_interval(days=>coalesce(o.grace_period_days,30)))
      )
  );
$$;
revoke all on function public.dock_admin_access_allowed(uuid,uuid) from public,anon;
grant execute on function public.dock_admin_access_allowed(uuid,uuid) to authenticated,service_role;

alter policy organizations_admin_select on public.organizations using (public.dock_admin_access_allowed(auth.uid(),id));
alter policy organizations_admin_update on public.organizations using (public.dock_admin_access_allowed(auth.uid(),id)) with check (public.dock_admin_access_allowed(auth.uid(),id));
alter policy workspaces_admin_select on public.workspaces using (public.dock_admin_access_allowed(auth.uid(),organization_id));
alter policy workspaces_admin_insert on public.workspaces with check (public.dock_admin_access_allowed(auth.uid(),organization_id));
alter policy workspaces_admin_update on public.workspaces using (public.dock_admin_access_allowed(auth.uid(),organization_id)) with check (public.dock_admin_access_allowed(auth.uid(),organization_id));
alter policy workspaces_admin_delete on public.workspaces using (public.dock_admin_access_allowed(auth.uid(),organization_id));
alter policy workspace_versions_admin_select on public.workspace_versions using (public.dock_admin_access_allowed(auth.uid(),organization_id));

alter policy workspace_tabs_admin_select on public.workspace_tabs using (exists (select 1 from public.workspaces w where w.id=workspace_tabs.workspace_id and public.dock_admin_access_allowed(auth.uid(),w.organization_id)));
alter policy workspace_tabs_admin_insert on public.workspace_tabs with check (exists (select 1 from public.workspaces w where w.id=workspace_tabs.workspace_id and public.dock_admin_access_allowed(auth.uid(),w.organization_id)));
alter policy workspace_tabs_admin_update on public.workspace_tabs using (exists (select 1 from public.workspaces w where w.id=workspace_tabs.workspace_id and public.dock_admin_access_allowed(auth.uid(),w.organization_id))) with check (exists (select 1 from public.workspaces w where w.id=workspace_tabs.workspace_id and public.dock_admin_access_allowed(auth.uid(),w.organization_id)));
alter policy workspace_tabs_admin_delete on public.workspace_tabs using (exists (select 1 from public.workspaces w where w.id=workspace_tabs.workspace_id and public.dock_admin_access_allowed(auth.uid(),w.organization_id)));

-- Legacy memory table cannot bypass current-access revocation and cannot accept inline screenshot payloads.
alter policy user_memories_select_own on public.user_memories using (auth.uid()=user_id and public.dock_user_access_allowed(auth.uid(),null::uuid));
alter policy user_memories_insert_own on public.user_memories with check (auth.uid()=user_id and screenshot_data_url is null and public.dock_user_access_allowed(auth.uid(),null::uuid));
alter policy user_memories_update_own on public.user_memories using (auth.uid()=user_id and public.dock_user_access_allowed(auth.uid(),null::uuid)) with check (auth.uid()=user_id and screenshot_data_url is null and public.dock_user_access_allowed(auth.uid(),null::uuid));
alter policy user_memories_delete_own on public.user_memories using (auth.uid()=user_id and public.dock_user_access_allowed(auth.uid(),null::uuid));

-- Owner-only live managed-asset reference application. Asset upload is idempotent/content-addressed;
-- authoritative DB reference changes and evidence remain one transaction.
create or replace function public.dock_owner_apply_managed_asset_refs(
  p_organization_id uuid,
  p_workspace_id uuid,
  p_logo_url text,
  p_background_url text,
  p_tabs jsonb,
  p_actor_email text
)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_org public.organizations%rowtype;
  v_workspace public.workspaces%rowtype;
  v_tab jsonb;
  v_position integer;
  v_updated integer := 0;
begin
  select * into v_org from public.organizations where id=p_organization_id for update;
  if not found then raise exception 'DISTRICT_NOT_FOUND'; end if;
  select * into v_workspace from public.workspaces where id=p_workspace_id and organization_id=p_organization_id and status='published' for update;
  if not found then raise exception 'PUBLISHED_WORKSPACE_NOT_FOUND'; end if;
  if coalesce(p_logo_url,'') like 'data:%' or coalesce(p_background_url,'') like 'data:%' then raise exception 'INLINE_BRANDING_NOT_ALLOWED'; end if;

  update public.organizations
  set district_logo_url=nullif(trim(coalesce(p_logo_url,'')),''),
      district_background_url=nullif(trim(coalesce(p_background_url,'')),''),
      updated_at=now()
  where id=p_organization_id;

  for v_tab in select value from jsonb_array_elements(coalesce(p_tabs,'[]'::jsonb)) loop
    v_position := coalesce((v_tab->>'position')::integer,-1);
    if v_position<0 then continue; end if;
    if coalesce(v_tab->>'icon_url','') like 'data:%' then raise exception 'INLINE_TAB_ICON_NOT_ALLOWED'; end if;
    update public.workspace_tabs
    set icon_url=nullif(trim(coalesce(v_tab->>'icon_url','')),''),updated_at=now()
    where workspace_id=p_workspace_id and position=v_position;
    if found then v_updated:=v_updated+1; end if;
  end loop;

  insert into public.audit_logs (organization_id,actor_email,action,target_type,target_id,details)
  values (p_organization_id,nullif(trim(coalesce(p_actor_email,'')),''),'owner_materialize_managed_assets','workspace',p_workspace_id::text,jsonb_build_object('tabCount',v_updated,'orgCode',v_org.org_code));
  return jsonb_build_object('organizationId',p_organization_id,'workspaceId',p_workspace_id,'tabCount',v_updated);
end;
$$;
revoke all on function public.dock_owner_apply_managed_asset_refs(uuid,uuid,text,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.dock_owner_apply_managed_asset_refs(uuid,uuid,text,text,jsonb,text) to service_role;
