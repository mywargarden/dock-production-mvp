-- Dock HQ owner portal, licensing, outside-user access, and district branding.

alter table organizations add column if not exists license_status text not null default 'trial';
alter table organizations add column if not exists license_renewal_date timestamptz;
alter table organizations add column if not exists grace_period_days integer not null default 30;
alter table organizations add column if not exists suspended_at timestamptz;
alter table organizations add column if not exists minimum_extension_version text;
alter table organizations add column if not exists owner_notes text;
alter table organizations add column if not exists district_logo_url text;
alter table organizations add column if not exists district_background_url text;
alter table organizations add column if not exists district_accent_color text;

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

alter table profiles add column if not exists status text not null default 'active';
