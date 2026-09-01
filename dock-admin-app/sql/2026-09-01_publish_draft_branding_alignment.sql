-- Publish is the only transition that copies admin draft branding into live delivery.

create or replace function public.dock_admin_publish_workspace(
  p_organization_id uuid,
  p_workspace_name text,
  p_tabs jsonb,
  p_branding jsonb,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_org public.organizations%rowtype;
  v_live public.workspaces%rowtype;
  v_workspace_id uuid;
  v_current_tabs jsonb := '[]'::jsonb;
  v_now timestamptz := now();
  v_current_version integer := 0;
  v_next_version integer := 1;
  v_tab_count integer := 0;
begin
  if nullif(trim(coalesce(p_workspace_name,'')),'') is null then raise exception 'WORKSPACE_NAME_REQUIRED'; end if;
  if jsonb_typeof(coalesce(p_tabs,'[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_tabs,'[]'::jsonb)) = 0 then raise exception 'WORKSPACE_TABS_REQUIRED'; end if;

  select * into v_org from public.organizations where id=p_organization_id for update;
  if not found then raise exception 'DISTRICT_NOT_FOUND'; end if;
  if lower(coalesce(v_org.license_status,'trial')) in ('suspended','expired') then raise exception 'DISTRICT_LICENSE_BLOCKED'; end if;
  if lower(coalesce(v_org.license_status,'trial'))='past_due' and
     (v_org.license_renewal_date is null or v_now > v_org.license_renewal_date + make_interval(days=>coalesce(v_org.grace_period_days,30))) then
    raise exception 'DISTRICT_LICENSE_PAST_DUE';
  end if;
  if coalesce(v_org.customer_lifecycle,'setup')='archived' then raise exception 'DISTRICT_ARCHIVED'; end if;

  select * into v_live
  from public.workspaces
  where organization_id=p_organization_id and status='published'
  order by published_at desc nulls last, created_at desc
  limit 1 for update;

  if found then
    v_workspace_id := v_live.id;
    v_current_version := greatest(1,coalesce(v_live.version,1)::integer);
    v_next_version := v_current_version + 1;
    select coalesce(jsonb_agg(jsonb_build_object(
      'title',wt.title,'url',wt.url,'icon_url',wt.icon_url,'position',wt.position,'is_locked',wt.is_locked
    ) order by wt.position,wt.created_at),'[]'::jsonb)
    into v_current_tabs from public.workspace_tabs wt where wt.workspace_id=v_live.id;

    insert into public.workspace_versions (organization_id,workspace_id,version,name,tabs,branding,published_at,created_by)
    values (p_organization_id,v_live.id,v_current_version,v_live.name,v_current_tabs,
      jsonb_build_object('district_logo_url',v_org.district_logo_url,'district_background_url',v_org.district_background_url,'district_accent_color',v_org.district_accent_color,'district_primary_color',v_org.district_primary_color,'district_secondary_color',v_org.district_secondary_color,'default_theme',v_org.default_theme),
      coalesce(v_live.published_at,v_now),p_actor_user_id);

    update public.workspaces set name=p_workspace_name,status='published',version=v_next_version,is_locked=true,updated_at=v_now,published_at=v_now where id=v_live.id;
  else
    insert into public.workspaces (organization_id,name,status,version,is_locked,updated_at,published_at)
    values (p_organization_id,p_workspace_name,'published',1,true,v_now,v_now)
    returning id into v_workspace_id;
    v_next_version := 1;
  end if;

  update public.organizations set
    draft_workspace_name=p_workspace_name,
    draft_tabs=coalesce(p_tabs,'[]'::jsonb),
    draft_branding=coalesce(p_branding,'{}'::jsonb),
    district_logo_url=case when p_branding ? 'district_logo_url' then p_branding->>'district_logo_url' else district_logo_url end,
    district_background_url=case when p_branding ? 'district_background_url' then p_branding->>'district_background_url' else district_background_url end,
    district_accent_color=case when p_branding ? 'district_accent_color' then p_branding->>'district_accent_color' else district_accent_color end,
    published_at=v_now,updated_at=v_now
  where id=p_organization_id;

  delete from public.workspace_tabs where workspace_id=v_workspace_id;
  insert into public.workspace_tabs (workspace_id,title,url,icon_url,position,is_locked,updated_at)
  select v_workspace_id,
         coalesce(nullif(trim(elem->>'title'),''),split_part(replace(replace(trim(elem->>'url'),'https://',''),'http://',''), '/', 1)),
         trim(elem->>'url'),
         nullif(trim(elem->>'icon_url'),''),
         (ord-1)::integer,
         true,
         v_now
  from jsonb_array_elements(p_tabs) with ordinality as t(elem,ord)
  where nullif(trim(elem->>'url'),'') is not null;
  get diagnostics v_tab_count = row_count;
  if v_tab_count=0 then raise exception 'NO_VALID_WORKSPACE_TABS'; end if;

  insert into public.audit_logs (organization_id,actor_user_id,action,target_type,target_id,details)
  values (p_organization_id,p_actor_user_id,'district_admin_publish','workspace',v_workspace_id::text,
    jsonb_build_object('workspaceName',p_workspace_name,'version',v_next_version,'tabCount',v_tab_count));

  return jsonb_build_object('workspaceId',v_workspace_id,'version',v_next_version,'publishedAt',v_now,'tabCount',v_tab_count);
end;
$$;

revoke all on function public.dock_admin_publish_workspace(uuid,text,jsonb,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.dock_admin_publish_workspace(uuid,text,jsonb,jsonb,uuid) to service_role;
