-- Recovery must restore one coherent state: the recovered live branding also becomes
-- the draft baseline so reopening District Admin cannot overlay a stale pre-restore draft.

create or replace function public.dock_owner_restore_workspace(
  p_organization_id uuid,
  p_snapshot_id uuid,
  p_actor_email text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org public.organizations%rowtype;
  v_target public.workspace_versions%rowtype;
  v_live public.workspaces%rowtype;
  v_current_tabs jsonb := '[]'::jsonb;
  v_now timestamptz := now();
  v_current_version integer;
  v_next_version integer;
  v_inserted_tabs integer := 0;
  v_restored_branding jsonb := '{}'::jsonb;
begin
  if p_organization_id is null or p_snapshot_id is null then raise exception 'ORGANIZATION_AND_SNAPSHOT_REQUIRED'; end if;
  if length(trim(coalesce(p_reason, ''))) < 5 then raise exception 'RESTORE_REASON_REQUIRED'; end if;

  select * into v_org from public.organizations where id = p_organization_id for update;
  if not found then raise exception 'DISTRICT_NOT_FOUND'; end if;

  select * into v_target from public.workspace_versions where id = p_snapshot_id and organization_id = p_organization_id;
  if not found then raise exception 'SNAPSHOT_NOT_FOUND_FOR_DISTRICT'; end if;

  if coalesce(v_target.branding->>'district_logo_url','') like 'data:%'
     or coalesce(v_target.branding->>'district_background_url','') like 'data:%'
     or exists (
       select 1 from jsonb_array_elements(coalesce(v_target.tabs,'[]'::jsonb)) elem
       where coalesce(elem->>'icon_url','') like 'data:%'
     ) then
    raise exception 'LEGACY_INLINE_ASSET_SNAPSHOT_REQUIRES_MATERIALIZATION';
  end if;

  select * into v_live
  from public.workspaces
  where organization_id = p_organization_id and status = 'published'
  order by published_at desc nulls last, created_at desc
  limit 1 for update;
  if not found then raise exception 'PUBLISHED_WORKSPACE_NOT_FOUND'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'title', wt.title,
    'url', wt.url,
    'icon_url', wt.icon_url,
    'position', wt.position,
    'is_locked', wt.is_locked
  ) order by wt.position, wt.created_at), '[]'::jsonb)
  into v_current_tabs
  from public.workspace_tabs wt
  where wt.workspace_id = v_live.id;

  v_current_version := greatest(1, coalesce(v_live.version, 1)::integer);
  v_next_version := v_current_version + 1;

  insert into public.workspace_versions (
    organization_id, workspace_id, version, name, tabs, branding, published_at, created_by
  ) values (
    p_organization_id,
    v_live.id,
    v_current_version,
    v_live.name,
    v_current_tabs,
    jsonb_build_object(
      'district_logo_url', v_org.district_logo_url,
      'district_background_url', v_org.district_background_url,
      'district_accent_color', v_org.district_accent_color,
      'district_primary_color', v_org.district_primary_color,
      'district_secondary_color', v_org.district_secondary_color,
      'default_theme', v_org.default_theme
    ),
    coalesce(v_live.published_at, v_now),
    null
  );

  update public.workspaces
  set name = v_target.name,
      version = v_next_version,
      status = 'published',
      is_locked = true,
      published_at = v_now,
      updated_at = v_now
  where id = v_live.id;

  delete from public.workspace_tabs where workspace_id = v_live.id;
  insert into public.workspace_tabs (workspace_id, title, url, icon_url, position, is_locked, updated_at)
  select
    v_live.id,
    coalesce(nullif(trim(elem->>'title'), ''), 'Resource ' || ord::text),
    trim(elem->>'url'),
    nullif(trim(elem->>'icon_url'), ''),
    (ord - 1)::integer,
    case when elem ? 'is_locked' and jsonb_typeof(elem->'is_locked') = 'boolean' then (elem->>'is_locked')::boolean else true end,
    v_now
  from jsonb_array_elements(coalesce(v_target.tabs, '[]'::jsonb)) with ordinality as x(elem, ord)
  where nullif(trim(elem->>'url'), '') is not null;
  get diagnostics v_inserted_tabs = row_count;

  v_restored_branding := jsonb_strip_nulls(jsonb_build_object(
    'district_logo_url', case when v_target.branding ? 'district_logo_url' then v_target.branding->>'district_logo_url' else v_org.district_logo_url end,
    'district_background_url', case when v_target.branding ? 'district_background_url' then v_target.branding->>'district_background_url' else v_org.district_background_url end,
    'district_accent_color', case when v_target.branding ? 'district_accent_color' then v_target.branding->>'district_accent_color' else v_org.district_accent_color end
  ));

  update public.organizations
  set draft_workspace_name = v_target.name,
      draft_tabs = coalesce(v_target.tabs, '[]'::jsonb),
      draft_branding = v_restored_branding,
      published_at = v_now,
      updated_at = v_now,
      district_logo_url = case when v_target.branding ? 'district_logo_url' then v_target.branding->>'district_logo_url' else v_org.district_logo_url end,
      district_background_url = case when v_target.branding ? 'district_background_url' then v_target.branding->>'district_background_url' else v_org.district_background_url end,
      district_accent_color = case when v_target.branding ? 'district_accent_color' then v_target.branding->>'district_accent_color' else v_org.district_accent_color end,
      district_primary_color = case when v_target.branding ? 'district_primary_color' then v_target.branding->>'district_primary_color' else v_org.district_primary_color end,
      district_secondary_color = case when v_target.branding ? 'district_secondary_color' then v_target.branding->>'district_secondary_color' else v_org.district_secondary_color end,
      default_theme = case when v_target.branding ? 'default_theme' then coalesce(v_target.branding->>'default_theme', v_org.default_theme) else v_org.default_theme end
  where id = p_organization_id;

  insert into public.audit_logs (organization_id, actor_email, action, target_type, target_id, details)
  values (
    p_organization_id,
    nullif(trim(coalesce(p_actor_email, '')), ''),
    'owner_restore_workspace',
    'workspace',
    v_live.id::text,
    jsonb_build_object(
      'reason', trim(p_reason),
      'restoredSnapshotId', v_target.id,
      'restoredSnapshotVersion', v_target.version,
      'previousLiveVersion', v_current_version,
      'newLiveVersion', v_next_version,
      'resourceCount', v_inserted_tabs
    )
  );

  return jsonb_build_object(
    'snapshotId', v_target.id,
    'snapshotVersion', v_target.version,
    'liveVersion', v_next_version,
    'resourceCount', v_inserted_tabs
  );
end;
$$;

revoke all on function public.dock_owner_restore_workspace(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.dock_owner_restore_workspace(uuid, uuid, text, text) to service_role;
