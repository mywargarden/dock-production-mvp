-- One-time cleanup for junk/internal memory rows that should never appear in Dock.
-- Run this before or after the hardening migration.

delete from public.personal_memories
where
  local_id like 'chrome-extension://%'
  or local_id like 'chrome://%'
  or local_id like 'about:%'
  or local_id like 'edge:%'
  or url like 'chrome-extension://%'
  or url like 'chrome://%'
  or url like 'about:%'
  or url like 'edge:%'
  or url like '%/api/bootstrap%'
  or url like '%/api/org/%/workspace%'
  or url like 'https://dock-production-mvp.vercel.app/%';


-- Optional extra cleanup for obvious logout/auth-exit pages captured before hardening.
delete from public.personal_memories
where lower(coalesce(url, '')) ~ '(^|/)(log(out|off)|sign(out|off))(/|$)';
