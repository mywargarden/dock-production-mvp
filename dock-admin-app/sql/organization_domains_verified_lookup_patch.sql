-- Dock organization domain registry patch
-- Safe to run more than once.

alter table organization_domains
add column if not exists id uuid default gen_random_uuid();

alter table organization_domains
add column if not exists organization_id uuid;

alter table organization_domains
add column if not exists updated_at timestamptz not null default now();

alter table organization_domains
add column if not exists domain_type text not null default 'primary';

alter table organization_domains
add column if not exists status text not null default 'pending';

alter table organization_domains
add column if not exists verified_at timestamptz;

alter table organization_domains
add column if not exists verification_method text;

alter table organization_domains
add column if not exists verification_token text;

update organization_domains
set id = gen_random_uuid()
where id is null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'organization_domains'::regclass
    and contype = 'p'
  ) then
    alter table organization_domains
    add constraint organization_domains_pkey primary key (id);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'organization_domains_organization_id_fkey'
  ) then
    alter table organization_domains
    add constraint organization_domains_organization_id_fkey
    foreign key (organization_id)
    references organizations(id)
    on delete cascade;
  end if;
end $$;

create index if not exists idx_organization_domains_org
on organization_domains (organization_id);

create index if not exists idx_organization_domains_lookup
on organization_domains (normalized_domain, status);
