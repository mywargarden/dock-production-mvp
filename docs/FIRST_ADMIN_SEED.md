# Dock first district admin seed

Dock intentionally does not let an arbitrary signed-in user become a district admin. The first owner/admin for a district must be seeded by a trusted operator using the Supabase service role or SQL editor.

Use this only after the district organization exists. Replace the placeholders before running.

```sql
-- 1. Find the district organization.
select id, name, org_code, email_domain
from organizations
where org_code = 'YOUR_ORG_CODE';

-- 2. Find the signed-in Supabase auth user.
select id, email
from auth.users
where lower(email) = lower('ADMIN_EMAIL@DISTRICT.EDU');

-- 3. Attach the user profile to the district and mark as owner.
insert into profiles (id, email, organization_id, role, created_at, updated_at)
select u.id, lower(u.email), o.id, 'owner', now(), now()
from auth.users u
cross join organizations o
where lower(u.email) = lower('ADMIN_EMAIL@DISTRICT.EDU')
  and o.org_code = 'YOUR_ORG_CODE'
on conflict (id) do update set
  email = excluded.email,
  organization_id = excluded.organization_id,
  role = 'owner',
  updated_at = now();

-- 4. Add explicit org-admin grant used by the admin API.
insert into organization_admins (organization_id, user_id, email, role, status, created_at, updated_at)
select o.id, u.id, lower(u.email), 'owner', 'active', now(), now()
from auth.users u
cross join organizations o
where lower(u.email) = lower('ADMIN_EMAIL@DISTRICT.EDU')
  and o.org_code = 'YOUR_ORG_CODE'
on conflict (organization_id, email) do update set
  user_id = excluded.user_id,
  role = 'owner',
  status = 'active',
  updated_at = now();
```

After seeding, have the admin sign into `/admin`, save the district settings, publish live, then reload `/admin` to confirm the grant works.
