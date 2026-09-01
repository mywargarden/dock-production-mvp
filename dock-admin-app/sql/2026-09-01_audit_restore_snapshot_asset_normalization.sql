-- Restore may normalize legacy inline snapshot assets before applying the live restore.
-- That derived snapshot representation change is its own atomic audited transition.

create or replace function public.dock_owner_normalize_restore_snapshot_assets(
  p_organization_id uuid,
  p_snapshot_id uuid,
  p_tabs jsonb,
  p_branding jsonb,
  p_actor_email text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_snapshot public.workspace_versions%rowtype;
begin
  select * into v_snapshot
  from public.workspace_versions
  where id=p_snapshot_id and organization_id=p_organization_id
  for update;
  if not found then raise exception 'SNAPSHOT_NOT_FOUND_FOR_DISTRICT'; end if;

  if coalesce(p_branding->>'district_logo_url','') like 'data:%'
     or coalesce(p_branding->>'district_background_url','') like 'data:%'
     or exists(select 1 from jsonb_array_elements(coalesce(p_tabs,'[]'::jsonb)) x where coalesce(x->>'icon_url','') like 'data:%') then
    raise exception 'INLINE_RESTORE_SNAPSHOT_ASSET_NOT_ALLOWED';
  end if;

  update public.workspace_versions
  set tabs=coalesce(p_tabs,'[]'::jsonb), branding=coalesce(p_branding,'{}'::jsonb)
  where id=p_snapshot_id and organization_id=p_organization_id;

  insert into public.audit_logs (organization_id,actor_email,action,target_type,target_id,details)
  values (p_organization_id,nullif(trim(coalesce(p_actor_email,'')),''),'owner_normalize_restore_snapshot_assets','workspace_version',p_snapshot_id::text,
    jsonb_build_object('snapshotVersion',v_snapshot.version,'workspaceId',v_snapshot.workspace_id));

  return jsonb_build_object('snapshotId',p_snapshot_id,'snapshotVersion',v_snapshot.version);
end;
$$;

revoke all on function public.dock_owner_normalize_restore_snapshot_assets(uuid,uuid,jsonb,jsonb,text) from public,anon,authenticated;
grant execute on function public.dock_owner_normalize_restore_snapshot_assets(uuid,uuid,jsonb,jsonb,text) to service_role;
