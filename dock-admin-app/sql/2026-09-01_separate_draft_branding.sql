-- Draft state must not mutate live extension branding. Branding changes are persisted
-- in draft_branding and become live only through the atomic Publish transition.

alter table public.organizations
  add column if not exists draft_branding jsonb not null default '{}'::jsonb;

update public.organizations
set draft_branding = jsonb_strip_nulls(jsonb_build_object(
  'district_logo_url', district_logo_url,
  'district_background_url', district_background_url,
  'district_accent_color', district_accent_color
))
where draft_branding = '{}'::jsonb;

create or replace function public.dock_admin_save_draft(
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
  v_now timestamptz := now();
begin
  if nullif(trim(coalesce(p_workspace_name,'')),'') is null then raise exception 'WORKSPACE_NAME_REQUIRED'; end if;
  if jsonb_typeof(coalesce(p_tabs,'[]'::jsonb)) <> 'array' then raise exception 'WORKSPACE_TABS_INVALID'; end if;
  select * into v_org from public.organizations where id=p_organization_id for update;
  if not found then raise exception 'DISTRICT_NOT_FOUND'; end if;

  update public.organizations set
    draft_workspace_name=p_workspace_name,
    draft_tabs=coalesce(p_tabs,'[]'::jsonb),
    draft_branding=coalesce(p_branding,'{}'::jsonb),
    updated_at=v_now
  where id=p_organization_id
  returning * into v_org;

  insert into public.audit_logs (organization_id,actor_user_id,action,target_type,target_id,details)
  values (p_organization_id,p_actor_user_id,'district_admin_save_draft','organization',p_organization_id::text,
    jsonb_build_object('workspaceName',p_workspace_name,'tabCount',jsonb_array_length(coalesce(p_tabs,'[]'::jsonb))));

  return jsonb_build_object('organization',to_jsonb(v_org),'savedAt',v_now);
end;
$$;

revoke all on function public.dock_admin_save_draft(uuid,text,jsonb,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.dock_admin_save_draft(uuid,text,jsonb,jsonb,uuid) to service_role;

-- The live publish function in production is updated by the corresponding migration
-- to copy p_branding into both draft_branding and live branding in the same transaction,
-- while retaining license/lifecycle checks, snapshot creation, tab replacement and audit.
