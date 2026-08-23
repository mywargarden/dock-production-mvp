-- Dock license/admin schema
-- Run this in Supabase SQL editor or through Supabase migrations.

create extension if not exists pgcrypto;

create type if not exists dock_license_status as enum (
  'active',
  'trial',
  'grace',
  'past_due',
  'suspended',
  'inactive',
  'expired',
  'canceled',
  'disabled',
  'terminated'
);

create table if not exists public.dock_districts (
  id uuid primary key default gen_random_uuid(),
  district_id text not null unique,
  name text not null,
  contact_name text,
  contact_email text,
  api_base_url text default 'https://dock-production-mvp.vercel.app',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.dock_district_domains (
  id uuid primary key default gen_random_uuid(),
  district_id uuid not null references public.dock_districts(id) on delete cascade,
  domain text not null unique,
  auto_assign boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.dock_licenses (
  id uuid primary key default gen_random_uuid(),
  district_id uuid not null references public.dock_districts(id) on delete cascade,
  plan text not null default 'district',
  status dock_license_status not null default 'trial',
  max_users integer not null default 0,
  min_extension_version text not null default '0.3.3',
  starts_at timestamptz,
  expires_at timestamptz,
  grace_until timestamptz,
  stripe_customer_id text,
  stripe_subscription_id text,
  stripe_price_id text,
  stripe_subscription_status text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.dock_license_users (
  id uuid primary key default gen_random_uuid(),
  license_id uuid not null references public.dock_licenses(id) on delete cascade,
  district_id uuid not null references public.dock_districts(id) on delete cascade,
  email text not null,
  name text,
  role text not null default 'teacher',
  status text not null default 'active',
  first_seen_at timestamptz,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (license_id, email)
);

create table if not exists public.dock_license_audit_events (
  id uuid primary key default gen_random_uuid(),
  district_id uuid references public.dock_districts(id) on delete set null,
  license_id uuid references public.dock_licenses(id) on delete set null,
  actor text,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.dock_touch_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists dock_districts_touch_updated_at on public.dock_districts;
create trigger dock_districts_touch_updated_at
before update on public.dock_districts
for each row execute function public.dock_touch_updated_at();

drop trigger if exists dock_licenses_touch_updated_at on public.dock_licenses;
create trigger dock_licenses_touch_updated_at
before update on public.dock_licenses
for each row execute function public.dock_touch_updated_at();

drop trigger if exists dock_license_users_touch_updated_at on public.dock_license_users;
create trigger dock_license_users_touch_updated_at
before update on public.dock_license_users
for each row execute function public.dock_touch_updated_at();

alter table public.dock_districts enable row level security;
alter table public.dock_district_domains enable row level security;
alter table public.dock_licenses enable row level security;
alter table public.dock_license_users enable row level security;
alter table public.dock_license_audit_events enable row level security;

-- Server-side API uses Supabase secret/service key. Do not expose that key in the extension or browser.
-- RLS intentionally has no broad client policies here.
