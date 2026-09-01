-- Preserve command identity at the owner district boundary.
-- A create command (no id) must fail when org_code already exists.
-- An update command (id present) may update only that immutable org_code.

create or replace function public.dock_owner_upsert_district(
  p_organization jsonb,
  p_domains jsonb,
  p_admins jsonb,
  p_allowed_users jsonb,
  p_actor_email text
)
returns jsonb
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_input public.organizations%rowtype;
  v_existing public.organizations%rowtype;
  v_org public.organizations%rowtype;
  v_input_id uuid;
begin
  select * into v_input from jsonb_populate_record(null::public.organizations, coalesce(p_organization, '{}'::jsonb));
  if nullif(trim(coalesce(v_input.name, '')), '') is null then raise exception 'DISTRICT_NAME_REQUIRED'; end if;
  if nullif(trim(coalesce(v_input.org_code, '')), '') is null then raise exception 'ORG_CODE_REQUIRED'; end if;

  if nullif(trim(coalesce(p_organization->>'id', '')), '') is not null then
    v_input_id := (p_organization->>'id')::uuid;
    select * into v_existing from public.organizations where id = v_input_id for update;
    if not found then raise exception 'DISTRICT_NOT_FOUND'; end if;
    if v_existing.org_code <> v_input.org_code then raise exception 'ORG_CODE_IMMUTABLE'; end if;
  else
    if exists(select 1 from public.organizations where org_code = v_input.org_code) then
      raise exception 'ORG_CODE_ALREADY_EXISTS';
    end if;
  end if;

  insert into public.organizations (
    name, org_code, email_domain, plan, max_users, license_status, license_renewal_date,
    grace_period_days, minimum_extension_version, owner_notes,
    district_logo_url, district_background_url, district_accent_color,
    default_theme, allow_user_theme_override, allow_admin_branding,
    customer_contact_name, customer_contact_email, customer_contact_phone,
    customer_lifecycle, trial_start_date, trial_end_date, billing_price_cents, billing_cadence,
    district_primary_color, district_secondary_color, branding_permissions,
    technical_contact_name, technical_contact_email, technical_contact_phone,
    billing_contact_name, billing_contact_email, billing_contact_phone, updated_at
  ) values (
    v_input.name, v_input.org_code, v_input.email_domain, coalesce(v_input.plan,'district'), coalesce(v_input.max_users,500),
    coalesce(v_input.license_status,'trial'), v_input.license_renewal_date, coalesce(v_input.grace_period_days,30),
    v_input.minimum_extension_version, v_input.owner_notes,
    v_input.district_logo_url, v_input.district_background_url, v_input.district_accent_color,
    coalesce(v_input.default_theme,'dock-green'), coalesce(v_input.allow_user_theme_override,true), coalesce(v_input.allow_admin_branding,true),
    v_input.customer_contact_name, v_input.customer_contact_email, v_input.customer_contact_phone,
    coalesce(v_input.customer_lifecycle,'setup'), v_input.trial_start_date, v_input.trial_end_date,
    v_input.billing_price_cents, coalesce(v_input.billing_cadence,'annual'),
    v_input.district_primary_color, v_input.district_secondary_color,
    coalesce(v_input.branding_permissions,'{"logo":true,"theme":true,"colors":true,"background":true}'::jsonb),
    v_input.technical_contact_name, v_input.technical_contact_email, v_input.technical_contact_phone,
    v_input.billing_contact_name, v_input.billing_contact_email, v_input.billing_contact_phone, now()
  )
  on conflict (org_code) do update set
    name=excluded.name,
    email_domain=excluded.email_domain,
    plan=excluded.plan,
    max_users=excluded.max_users,
    license_status=excluded.license_status,
    license_renewal_date=excluded.license_renewal_date,
    grace_period_days=excluded.grace_period_days,
    minimum_extension_version=excluded.minimum_extension_version,
    owner_notes=excluded.owner_notes,
    district_logo_url=excluded.district_logo_url,
    district_background_url=excluded.district_background_url,
    district_accent_color=excluded.district_accent_color,
    default_theme=excluded.default_theme,
    allow_user_theme_override=excluded.allow_user_theme_override,
    allow_admin_branding=excluded.allow_admin_branding,
    customer_contact_name=excluded.customer_contact_name,
    customer_contact_email=excluded.customer_contact_email,
    customer_contact_phone=excluded.customer_contact_phone,
    customer_lifecycle=excluded.customer_lifecycle,
    trial_start_date=excluded.trial_start_date,
    trial_end_date=excluded.trial_end_date,
    billing_price_cents=excluded.billing_price_cents,
    billing_cadence=excluded.billing_cadence,
    district_primary_color=excluded.district_primary_color,
    district_secondary_color=excluded.district_secondary_color,
    branding_permissions=excluded.branding_permissions,
    technical_contact_name=excluded.technical_contact_name,
    technical_contact_email=excluded.technical_contact_email,
    technical_contact_phone=excluded.technical_contact_phone,
    billing_contact_name=excluded.billing_contact_name,
    billing_contact_email=excluded.billing_contact_email,
    billing_contact_phone=excluded.billing_contact_phone,
    updated_at=now()
  returning * into v_org;

  if v_input_id is not null and v_org.id <> v_input_id then raise exception 'DISTRICT_ID_OR_CODE_CONFLICT'; end if;

  delete from public.organization_domains where organization_id = v_org.id;
  insert into public.organization_domains (organization_id,domain,normalized_domain,status,domain_type,verified_at,updated_at)
  select v_org.id,
         lower(trim(x.domain)),
         lower(trim(coalesce(nullif(x.normalized_domain,''),x.domain))),
         case when x.status='pending' then 'pending' else 'verified' end,
         case when x.domain_type='primary' then 'primary' else 'additional' end,
         case when x.status='pending' then null else now() end,
         now()
  from jsonb_to_recordset(coalesce(p_domains,'[]'::jsonb)) as x(domain text, normalized_domain text, status text, domain_type text)
  where nullif(trim(coalesce(x.domain,'')),'') is not null;

  delete from public.organization_admins where organization_id = v_org.id;
  insert into public.organization_admins (organization_id,email,name,role,status,updated_at)
  select v_org.id, lower(trim(x.email)), nullif(trim(x.name),''),
         case when x.role='owner' then 'owner' else 'district_admin' end,
         case when x.status='disabled' then 'disabled' else 'active' end,
         now()
  from jsonb_to_recordset(coalesce(p_admins,'[]'::jsonb)) as x(email text,name text,role text,status text)
  where position('@' in coalesce(x.email,'')) > 1;

  delete from public.organization_allowed_users where organization_id = v_org.id;
  insert into public.organization_allowed_users (organization_id,email,name,note,status,expires_at,updated_at)
  select v_org.id, lower(trim(x.email)), nullif(trim(x.name),''), nullif(trim(x.note),''),
         case when x.status='inactive' then 'inactive' else 'active' end,
         case when nullif(trim(coalesce(x.expires_at,'')),'') is null then null else x.expires_at::timestamptz end,
         now()
  from jsonb_to_recordset(coalesce(p_allowed_users,'[]'::jsonb)) as x(email text,name text,note text,status text,expires_at text)
  where position('@' in coalesce(x.email,'')) > 1;

  insert into public.audit_logs (organization_id,actor_email,action,target_type,target_id,details)
  values (v_org.id,nullif(trim(coalesce(p_actor_email,'')),''),'owner_upsert_district','organization',v_org.id::text,
    jsonb_build_object('orgCode',v_org.org_code,'licenseStatus',v_org.license_status,'maxUsers',v_org.max_users,'defaultTheme',v_org.default_theme,'lifecycle',v_org.customer_lifecycle));

  return to_jsonb(v_org);
end;
$function$;
