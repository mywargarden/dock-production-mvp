# Run and test dedupe hardening

## What changed
- Dock now dedupes on exact normalized URLs.
- Meaningful page params like `id=123` are preserved.
- Junk tracking params like `utm_*`, `fbclid`, and `gclid` are stripped.
- Dock internal/admin/bootstrap/workspace pages are excluded from memories.
- Personal memory writes now use database-backed upsert on `(user_id, url)`.

## Quick test
1. Load the updated extension.
2. Save:
   - `https://example.com/page?utm_source=test&id=123`
   - `https://example.com/page?id=123&utm_medium=email`
3. Confirm Dock shows only **one** card for page `id=123`.
4. Save:
   - `https://example.com/page?id=456`
5. Confirm Dock shows a **second** distinct card.
6. Open Dock admin, `/api/bootstrap`, and any `/api/org/.../workspace` page.
7. Confirm none of those new internal pages appear in Dock.
8. In Supabase, run:

```sql
select url, count(*)
from public.personal_memories
group by url
having count(*) > 1
order by count(*) desc, url;
```

Expected result: no new duplicates for normalized URLs.

## Recommended one-time cleanup
Run:

- `dock-admin-app/sql/2026-04-23_personal_memories_cleanup.sql`

Then verify latest rows:

```sql
select url, created_at
from public.personal_memories
order by created_at desc
limit 20;
```
