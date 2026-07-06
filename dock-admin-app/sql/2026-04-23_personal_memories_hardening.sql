-- Production hardening for Dock personal memories.
-- Safe to run after the current schema is in place.
-- This does three things:
-- 1) collapses active exact-URL duplicates per user, keeping the most recently updated row
-- 2) keeps deleted history available
-- 3) enforces one active row per (user_id, url)

begin;

with ranked as (
  select
    id,
    row_number() over (
      partition by user_id, url
      order by coalesce(updated_at, created_at) desc, created_at desc, id desc
    ) as rn
  from public.personal_memories
  where deleted_at is null
)
update public.personal_memories pm
set
  deleted_at = now(),
  updated_at = now()
from ranked r
where pm.id = r.id
  and r.rn > 1;

create unique index if not exists idx_personal_memories_user_url_active_unique
on public.personal_memories (user_id, url)
where deleted_at is null;

create index if not exists idx_personal_memories_user_updated_at
on public.personal_memories (user_id, updated_at desc);

commit;
