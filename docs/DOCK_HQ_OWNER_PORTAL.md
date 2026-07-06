# Dock HQ Owner Portal

Dock HQ is the owner-only control plane for district sales and deployment.

## Owner route

- URL: `/owner`
- Access: authenticated Google/Supabase user whose email is listed in `DOCK_OWNER_EMAILS`.
- Default safety fallback includes `mywargarden@gmail.com` and `drew.lowery@henry.k12.va.us`, but production should set `DOCK_OWNER_EMAILS` explicitly in Vercel.

## Dock HQ controls

Dock HQ can:

- create a district/customer profile
- set the org code
- set the primary email domain
- add verified additional domains
- set plan, license status, seats, renewal date, and grace period
- add outside-domain allowed users
- assign the first school/district admin
- suspend, expire, or reactivate a district license
- view live workspace version and district JSON endpoint

## District Admin controls

The school admin portal at `/admin` is intentionally limited. School admins can:

- rename the District Dock
- add/remove/reorder managed links
- upload images/screenshots for managed links
- upload district logo
- upload District Dock background image
- choose District Dock accent color
- save draft
- publish live

School admins cannot change:

- license status
- seat count
- verified domains
- allowed outside users
- district admin grants
- org code
- owner billing notes

## SQL migration required

Before using Dock HQ in production, run:

```sql
sql/owner_portal_licensing_branding.sql
```

This adds license fields, outside-domain user exceptions, district branding fields, profile status, and workspace version history.

## Deployment flow

1. Deploy admin app to Vercel with `DOCK_OWNER_EMAILS` set.
2. Run `sql/owner_portal_licensing_branding.sql` in Supabase.
3. Open `/owner` with the owner account.
4. Create the district profile and license.
5. Add verified domains and any outside-domain allowed users.
6. Add the first school admin email.
7. Give the school admin `/admin` after purchase/onboarding.
8. School admin builds and publishes the managed Dock.
9. School IT deploys the extension.
10. Extension resolves by verified domain or allowed outside email.

## License statuses

- `trial`: works normally for pilot/testing.
- `active`: paid/current license.
- `past_due`: works only through grace period.
- `suspended`: blocked immediately.
- `expired`: blocked immediately.

Chrome Web Store handles extension binary updates. Dock HQ controls live workspace/config updates and can require a minimum extension version in bootstrap metadata.
