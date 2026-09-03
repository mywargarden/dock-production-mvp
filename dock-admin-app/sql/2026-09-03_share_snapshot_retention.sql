-- Dock short-share retention.
-- Shared snapshots are inaccessible after expires_at and are hard-deleted daily
-- so the 30-day share window does not become unbounded database retention.

create extension if not exists pg_cron with schema pg_catalog;
grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;

select cron.schedule(
  'dock-share-expiry-cleanup',
  '17 3 * * *',
  $$delete from public.dock_shares where expires_at is not null and expires_at <= now();$$
);
