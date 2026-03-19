
create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  org_code text not null unique,
  email_domain text,
  plan text not null default 'district',
  max_users integer not null default 500,
  created_at timestamptz not null default now()
);

create table workspaces (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  is_locked boolean not null default true,
  updated_at bigint not null default 0,
  created_at timestamptz not null default now()
);

create table workspace_tabs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  title text not null,
  url text not null,
  icon_url text,
  position integer not null default 0,
  is_locked boolean not null default true,
  created_at timestamptz not null default now()
);
