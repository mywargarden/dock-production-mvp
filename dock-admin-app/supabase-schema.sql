-- Core org tables
create extension if not exists pgcrypto;

create table if not exists organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  org_code text not null unique,
  email_domain text,
  plan text not null default 'district',
  max_users integer not null default 500,
  draft_workspace_name text,
  draft_tabs jsonb not null default '[]'::jsonb,
  published_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists workspaces (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  is_locked boolean not null default true,
  updated_at bigint not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists workspace_tabs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  title text not null,
  url text not null,
  icon_url text,
  position integer not null default 0,
  is_locked boolean not null default true,
  created_at timestamptz not null default now()
);

-- Admin profile table for org-based isolation
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique,
  organization_id uuid not null references organizations(id) on delete cascade,
  role text not null default 'district_admin',
  created_at timestamptz not null default now()
);

alter table organizations enable row level security;
alter table workspaces enable row level security;
alter table workspace_tabs enable row level security;
alter table profiles enable row level security;

drop policy if exists "profiles_select_self" on profiles;
create policy "profiles_select_self"
on profiles for select to authenticated
using (auth.uid() = id);

drop policy if exists "profiles_update_self" on profiles;
create policy "profiles_update_self"
on profiles for update to authenticated
using (auth.uid() = id);

drop policy if exists "org_select_own" on organizations;
create policy "org_select_own"
on organizations for select to authenticated
using (
  exists (
    select 1 from profiles p
    where p.id = auth.uid() and p.organization_id = organizations.id
  )
);

drop policy if exists "org_update_own" on organizations;
create policy "org_update_own"
on organizations for update to authenticated
using (
  exists (
    select 1 from profiles p
    where p.id = auth.uid() and p.organization_id = organizations.id
  )
);

drop policy if exists "workspaces_select_own" on workspaces;
create policy "workspaces_select_own"
on workspaces for select to authenticated
using (
  exists (
    select 1 from profiles p
    where p.id = auth.uid() and p.organization_id = workspaces.organization_id
  )
);

drop policy if exists "workspaces_update_own" on workspaces;
create policy "workspaces_update_own"
on workspaces for update to authenticated
using (
  exists (
    select 1 from profiles p
    where p.id = auth.uid() and p.organization_id = workspaces.organization_id
  )
);

drop policy if exists "workspaces_insert_own" on workspaces;
create policy "workspaces_insert_own"
on workspaces for insert to authenticated
with check (
  exists (
    select 1 from profiles p
    where p.id = auth.uid() and p.organization_id = workspaces.organization_id
  )
);

drop policy if exists "tabs_select_own" on workspace_tabs;
create policy "tabs_select_own"
on workspace_tabs for select to authenticated
using (
  exists (
    select 1
    from workspaces w
    join profiles p on p.organization_id = w.organization_id
    where p.id = auth.uid() and w.id = workspace_tabs.workspace_id
  )
);

drop policy if exists "tabs_write_own" on workspace_tabs;
create policy "tabs_write_own"
on workspace_tabs for all to authenticated
using (
  exists (
    select 1
    from workspaces w
    join profiles p on p.organization_id = w.organization_id
    where p.id = auth.uid() and w.id = workspace_tabs.workspace_id
  )
)
with check (
  exists (
    select 1
    from workspaces w
    join profiles p on p.organization_id = w.organization_id
    where p.id = auth.uid() and w.id = workspace_tabs.workspace_id
  )
);

-- Bootstrap one pilot org
insert into organizations (name, org_code, email_domain, plan, max_users, draft_workspace_name)
values ('Henry County Public Schools', 'henry-county', 'henry.k12.va.us', 'district', 500, 'Henry County Teacher Workspace')
on conflict (org_code) do nothing;

-- After you sign in once, replace USER_UUID below with your auth.users id and run:
-- insert into profiles (id, email, organization_id, role)
-- select 'USER_UUID'::uuid, 'YOUR_EMAIL', id, 'district_admin'
-- from organizations
-- where org_code = 'henry-county'
-- on conflict (id) do update set organization_id = excluded.organization_id, email = excluded.email;
