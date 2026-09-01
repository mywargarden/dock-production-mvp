-- Owner access is current revocable state, not a hardcoded application allowlist.

create table if not exists public.dock_owner_access (
  email text primary key,
  status text not null default 'active' check (status in ('active','disabled')),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.dock_owner_access enable row level security;

insert into public.dock_owner_access (email,status,note)
values
  ('mywargarden@gmail.com','active','Migrated from Dock owner allowlist'),
  ('drew.lowery@henry.k12.va.us','active','Migrated from Dock owner allowlist'),
  ('southcreeksystems@gmail.com','active','Migrated from Dock owner allowlist')
on conflict (email) do nothing;

revoke all on table public.dock_owner_access from public,anon,authenticated;
grant select,insert,update,delete on table public.dock_owner_access to service_role;

create or replace function public.dock_touch_owner_access_updated_at()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
begin
  new.email := lower(trim(new.email));
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists dock_owner_access_touch on public.dock_owner_access;
create trigger dock_owner_access_touch
before insert or update on public.dock_owner_access
for each row execute function public.dock_touch_owner_access_updated_at();
