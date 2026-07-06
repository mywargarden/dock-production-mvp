
create extension if not exists pgcrypto;

create table if not exists organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  org_code text not null unique,
  email_domain text,
  plan text not null default 'district',
  max_users integer not null default 500,
  license_status text not null default 'trial',
  license_renewal_date timestamptz,
  grace_period_days integer not null default 30,
  suspended_at timestamptz,
  minimum_extension_version text,
  owner_notes text,
  district_logo_url text,
  district_background_url text,
  district_accent_color text,
  draft_workspace_name text,
  draft_tabs jsonb not null default '[]'::jsonb,
  published_at timestamptz,
  updated_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists workspaces (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  status text not null default 'draft',
  version integer not null default 1,
  is_locked boolean not null default true,
  published_at timestamptz,
  updated_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_workspaces_org_status on workspaces (organization_id, status, published_at desc);

create table if not exists workspace_tabs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  title text not null,
  url text not null,
  icon_url text,
  position integer not null default 0,
  is_locked boolean not null default true,
  updated_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_workspace_tabs_workspace on workspace_tabs (workspace_id, position, created_at);

create table if not exists users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  google_sub text,
  display_name text,
  avatar_url text,
  current_org_id uuid references organizations(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_users_google_sub on users (google_sub) where google_sub is not null;

create or replace function public.handle_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, email, google_sub, display_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'sub', new.raw_app_meta_data->>'provider_id'),
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'),
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do update
    set email = excluded.email,
        google_sub = coalesce(excluded.google_sub, public.users.google_sub),
        display_name = coalesce(excluded.display_name, public.users.display_name),
        avatar_url = coalesce(excluded.avatar_url, public.users.avatar_url),
        updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert or update on auth.users
for each row execute procedure public.handle_auth_user();

create table if not exists organization_admins (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  user_id uuid references users(id) on delete cascade,
  email text,
  role text not null default 'district_admin',
  created_at timestamptz not null default now(),
  unique (organization_id, user_id),
  unique (organization_id, email)
);

create table if not exists organization_domains (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  domain text not null,
  normalized_domain text not null unique,
  domain_type text not null default 'primary',
  status text not null default 'pending',
  verified_at timestamptz,
  verification_method text,
  verification_token text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_organization_domains_org on organization_domains (organization_id);
create index if not exists idx_organization_domains_lookup on organization_domains (normalized_domain, status);


create table if not exists organization_allowed_users (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  email text not null,
  name text,
  note text,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, email)
);

create index if not exists idx_organization_allowed_users_email on organization_allowed_users (email, status);
create index if not exists idx_organization_allowed_users_org on organization_allowed_users (organization_id);

create table if not exists workspace_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  workspace_id uuid references workspaces(id) on delete set null,
  version integer not null,
  name text not null,
  tabs jsonb not null default '[]'::jsonb,
  branding jsonb not null default '{}'::jsonb,
  published_at timestamptz,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_workspace_versions_org on workspace_versions (organization_id, version desc, created_at desc);

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  organization_id uuid references organizations(id) on delete set null,
  role text not null default 'member',
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_profiles_org on profiles (organization_id, role);

create or replace function public.handle_profile_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (
    new.id,
    new.email
  )
  on conflict (id) do update
    set email = excluded.email,
        updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_profile_created on auth.users;
create trigger on_auth_profile_created
after insert or update on auth.users
for each row execute procedure public.handle_profile_user();

create table if not exists memory_groups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  name text not null,
  color text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_memory_groups_user on memory_groups (user_id, updated_at desc);

create table if not exists personal_memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  group_id uuid references memory_groups(id) on delete set null,
  local_id text,
  title text,
  url text not null,
  icon_url text,
  screenshot_data_url text,
  screenshot_blocked boolean not null default false,
  reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (user_id, url)
);

create index if not exists idx_personal_memories_user on personal_memories (user_id, updated_at desc);
create index if not exists idx_personal_memories_active on personal_memories (user_id, deleted_at, updated_at desc);

create table if not exists audit_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) on delete cascade,
  actor_user_id uuid references users(id) on delete set null,
  action text not null,
  target_type text,
  target_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_audit_logs_org on audit_logs (organization_id, created_at desc);
create index if not exists idx_audit_logs_actor on audit_logs (actor_user_id, created_at desc);
