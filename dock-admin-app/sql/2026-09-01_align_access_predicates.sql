-- Align user/admin current-access predicates and prevent authenticated callers
-- from using SECURITY DEFINER functions as arbitrary-user status oracles.

create or replace function public.dock_user_access_allowed(
  p_user_id uuid,
  p_organization_id uuid default null
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    case when auth.role() = 'authenticated' then p_user_id = auth.uid() else true end
    and exists (
      select 1
      from public.profiles p
      join public.organizations o on o.id = p.organization_id
      where p.id = p_user_id
        and p.status = 'active'
        and (p_organization_id is null or p.organization_id = p_organization_id)
        and coalesce(o.customer_lifecycle, 'setup') <> 'archived'
        and (
          lower(coalesce(o.license_status, 'trial')) in ('trial', 'active')
          or (
            lower(coalesce(o.license_status, 'trial')) = 'past_due'
            and o.license_renewal_date is not null
            and now() <= o.license_renewal_date + make_interval(days => coalesce(o.grace_period_days, 30))
          )
        )
        and (
          exists (
            select 1 from public.organization_domains od
            where od.organization_id = p.organization_id
              and od.status = 'verified'
              and lower(od.normalized_domain) = split_part(lower(trim(coalesce(p.email, ''))), '@', 2)
          )
          or exists (
            select 1 from public.organization_allowed_users au
            where au.organization_id = p.organization_id
              and au.status = 'active'
              and lower(au.email) = lower(trim(coalesce(p.email, '')))
              and (au.expires_at is null or au.expires_at > now())
          )
          or exists (
            select 1 from public.organization_admins oa
            where oa.organization_id = p.organization_id
              and coalesce(oa.status, 'active') = 'active'
              and lower(oa.email) = lower(trim(coalesce(p.email, '')))
          )
        )
    );
$$;

create or replace function public.dock_admin_access_allowed(
  p_user_id uuid,
  p_organization_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    case when auth.role() = 'authenticated' then p_user_id = auth.uid() else true end
    and exists (
      select 1
      from public.profiles p
      join public.organizations o on o.id = p.organization_id
      join public.organization_admins a
        on a.organization_id = p.organization_id
       and lower(a.email) = lower(p.email)
       and coalesce(a.status,'active') = 'active'
      where p.id = p_user_id
        and p.organization_id = p_organization_id
        and p.role = 'admin'
        and p.status = 'active'
        and coalesce(o.customer_lifecycle,'setup') <> 'archived'
        and (
          lower(coalesce(o.license_status,'trial')) in ('trial','active')
          or (
            lower(coalesce(o.license_status,'trial')) = 'past_due'
            and o.license_renewal_date is not null
            and now() <= o.license_renewal_date + make_interval(days => coalesce(o.grace_period_days,30))
          )
        )
    );
$$;

revoke all on function public.dock_user_access_allowed(uuid,uuid) from public,anon;
revoke all on function public.dock_admin_access_allowed(uuid,uuid) from public,anon;
grant execute on function public.dock_user_access_allowed(uuid,uuid) to authenticated,service_role;
grant execute on function public.dock_admin_access_allowed(uuid,uuid) to authenticated,service_role;
