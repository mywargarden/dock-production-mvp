-- Finalize the personal-memory screenshot storage invariant for Dock 0.3.27.
-- Active rows were already materialized to Supabase Storage; deleted legacy rows may
-- retain history but should not retain obsolete inline image payloads.

begin;

update public.personal_memories
set screenshot_data_url = null
where deleted_at is not null
  and screenshot_data_url is not null;

alter table public.personal_memories
  drop constraint if exists personal_memories_no_inline_screenshot;

alter table public.personal_memories
  add constraint personal_memories_no_inline_screenshot
  check (screenshot_data_url is null) not valid;

alter table public.personal_memories
  validate constraint personal_memories_no_inline_screenshot;

commit;
