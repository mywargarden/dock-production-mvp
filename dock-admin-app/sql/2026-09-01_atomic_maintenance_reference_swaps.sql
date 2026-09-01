-- Stage-7 One-Truth maintenance invariants.
-- Immutable Storage objects may be prepared before the authoritative transaction.
-- Every durable reference swap and its audit evidence must commit atomically.

create or replace function public.dock_owner_apply_complete_managed_asset_refs(
  p_organization_id uuid,
  p_live_logo_url text,
  p_live_background_url text,
  p_draft_branding jsonb,
  p_draft_tabs jsonb,
  p_live_tabs jsonb,
  p_versions jsonb,
  p_actor_email text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org public.organizations%rowtype;
  v_item jsonb;
  v_id uuid;
  v_live_count integer := 0;
  v_version_count integer := 0;
begin
  select * into v_org from public.organizations where id=p_organization_id for update;
  if not found then raise exception 'DISTRICT_NOT_FOUND'; end if;

  if coalesce(p_live_logo_url,'') like 'data:%' or coalesce(p_live_background_url,'') like 'data:%' then raise exception 'INLINE_LIVE_BRANDING_NOT_ALLOWED'; end if;
  if coalesce(p_draft_branding->>'district_logo_url','') like 'data:%' or coalesce(p_draft_branding->>'district_background_url','') like 'data:%' then raise exception 'INLINE_DRAFT_BRANDING_NOT_ALLOWED'; end if;
  if exists(select 1 from jsonb_array_elements(coalesce(p_draft_tabs,'[]'::jsonb)) x where coalesce(x->>'icon_url','') like 'data:%') then raise exception 'INLINE_DRAFT_TAB_NOT_ALLOWED'; end if;

  update public.organizations
  set district_logo_url=nullif(trim(coalesce(p_live_logo_url,'')),''),
      district_background_url=nullif(trim(coalesce(p_live_background_url,'')),''),
      draft_branding=coalesce(p_draft_branding,'{}'::jsonb),
      draft_tabs=coalesce(p_draft_tabs,'[]'::jsonb),
      updated_at=now()
  where id=p_organization_id;

  for v_item in select value from jsonb_array_elements(coalesce(p_live_tabs,'[]'::jsonb)) loop
    if coalesce(v_item->>'icon_url','') like 'data:%' then raise exception 'INLINE_LIVE_TAB_NOT_ALLOWED'; end if;
    v_id := (v_item->>'id')::uuid;
    update public.workspace_tabs wt
    set icon_url=nullif(trim(coalesce(v_item->>'icon_url','')),''), updated_at=now()
    from public.workspaces w
    where wt.id=v_id and wt.workspace_id=w.id and w.organization_id=p_organization_id;
    if not found then raise exception 'LIVE_TAB_NOT_FOUND_FOR_DISTRICT'; end if;
    v_live_count := v_live_count + 1;
  end loop;

  for v_item in select value from jsonb_array_elements(coalesce(p_versions,'[]'::jsonb)) loop
    if coalesce((v_item->'branding')->>'district_logo_url','') like 'data:%'
       or coalesce((v_item->'branding')->>'district_background_url','') like 'data:%'
       or exists(select 1 from jsonb_array_elements(coalesce(v_item->'tabs','[]'::jsonb)) x where coalesce(x->>'icon_url','') like 'data:%') then
      raise exception 'INLINE_SNAPSHOT_ASSET_NOT_ALLOWED';
    end if;
    v_id := (v_item->>'id')::uuid;
    update public.workspace_versions
    set tabs=coalesce(v_item->'tabs','[]'::jsonb), branding=coalesce(v_item->'branding','{}'::jsonb)
    where id=v_id and organization_id=p_organization_id;
    if not found then raise exception 'SNAPSHOT_NOT_FOUND_FOR_DISTRICT'; end if;
    v_version_count := v_version_count + 1;
  end loop;

  insert into public.audit_logs (organization_id,actor_email,action,target_type,target_id,details)
  values (p_organization_id,nullif(trim(coalesce(p_actor_email,'')),''),'owner_materialize_managed_assets','organization',p_organization_id::text,
    jsonb_build_object('orgCode',v_org.org_code,'liveTabCount',v_live_count,'snapshotCount',v_version_count));

  return jsonb_build_object('organizationId',p_organization_id,'orgCode',v_org.org_code,'liveTabCount',v_live_count,'snapshotCount',v_version_count);
end;
$$;
revoke all on function public.dock_owner_apply_complete_managed_asset_refs(uuid,text,text,jsonb,jsonb,jsonb,jsonb,text) from public,anon,authenticated;
grant execute on function public.dock_owner_apply_complete_managed_asset_refs(uuid,text,text,jsonb,jsonb,jsonb,jsonb,text) to service_role;

create or replace function public.dock_owner_apply_legacy_memory_screenshot_refs(
  p_refs jsonb,
  p_actor_email text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_item jsonb;
  v_id uuid;
  v_user_id uuid;
  v_path text;
  v_count integer := 0;
begin
  for v_item in select value from jsonb_array_elements(coalesce(p_refs,'[]'::jsonb)) loop
    v_id := (v_item->>'id')::uuid;
    v_user_id := (v_item->>'user_id')::uuid;
    v_path := trim(coalesce(v_item->>'screenshot_path',''));
    if v_path = '' or v_path not like v_user_id::text || '/%' then raise exception 'INVALID_SCREENSHOT_PATH'; end if;

    update public.personal_memories
    set screenshot_path=v_path, screenshot_data_url=null, updated_at=now()
    where id=v_id and user_id=v_user_id and deleted_at is null and screenshot_path is null and nullif(screenshot_data_url,'') is not null;
    if not found then raise exception 'MEMORY_NOT_ELIGIBLE_FOR_MIGRATION'; end if;
    v_count := v_count + 1;
  end loop;

  insert into public.audit_logs (organization_id,actor_email,action,target_type,target_id,details)
  values (null,nullif(trim(coalesce(p_actor_email,'')),''),'owner_materialize_legacy_memory_screenshots','personal_memories',null,jsonb_build_object('migrated',v_count));

  return jsonb_build_object('migrated',v_count);
end;
$$;
revoke all on function public.dock_owner_apply_legacy_memory_screenshot_refs(jsonb,text) from public,anon,authenticated;
grant execute on function public.dock_owner_apply_legacy_memory_screenshot_refs(jsonb,text) to service_role;
