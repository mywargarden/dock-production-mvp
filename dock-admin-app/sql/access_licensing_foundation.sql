-- Access & Licensing Foundation
-- Adds exact-email allowlist and active-seat tracking without disturbing existing Dock data.

create table if not exists public.organization_allowed_emails (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email text not null,
  normalized_email text not null,
  role text not null default 'member',
  status text not null default 'active',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint organization_allowed_emails_status_check
    check (status in ('active', 'disabled')),

  constraint organization_allowed_emails_role_check
    check (role in ('member', 'admin', 'viewer'))
);

create unique index if not exists organization_allowed_emails_org_email_key
  on public.organization_allowed_emails (organization_id, normalized_email);

create index if not exists organization_allowed_emails_email_status_idx
  on public.organization_allowed_emails (normalized_email, status);

alter table public.profiles
  add column if not exists status text not null default 'active';

alter table public.profiles
  add column if not exists last_seen_at timestamptz;

alter table public.profiles
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_status_check'
  ) then
    alter table public.profiles
      add constraint profiles_status_check
      check (status in ('active', 'disabled'));
  end if;
end $$;

create index if not exists profiles_org_status_idx
  on public.profiles (organization_id, status);

create index if not exists profiles_email_idx
  on public.profiles (email);

alter table public.organization_allowed_emails enable row level security;

drop policy if exists "service role manages organization allowed emails" on public.organization_allowed_emails;

create policy "service role manages organization allowed emails"
on public.organization_allowed_emails
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');
