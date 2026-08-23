# Dock Production MVP

This branch adds the first real Dock license-management backend:

- District creation/editing
- District license activation/suspension
- Allowed domains with auto-assignment
- User add/delete/edit foundation
- Seat count display
- Stripe webhook sync foundation
- Extension license config endpoint

## Local setup

```bash
npm install
cp .env.example .env.local
npm run dev
```

## Required environment variables

```bash
SUPABASE_URL=
SUPABASE_SECRET_KEY=
DOCK_ADMIN_TOKEN=
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
```

Never expose `SUPABASE_SECRET_KEY` or `STRIPE_SECRET_KEY` in the Chrome extension or client browser code.

## Database setup

Run this SQL in Supabase:

```text
supabase/migrations/001_dock_license_admin.sql
```

## Admin panel

```text
/admin
```

Paste the `DOCK_ADMIN_TOKEN` from Vercel env vars into the admin page for the session.

## Extension config endpoint

```text
GET /api/dock/config?email=drew.lowery@henry.k12.va.us
```

The endpoint returns district and license config based on email domain. If the domain is known and auto-assignment is enabled, the user is attached to the district license.

## Stripe webhook endpoint

```text
POST /api/stripe/webhook
```

Configure this endpoint in Stripe and listen for:

- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.payment_failed`
- `invoice.payment_succeeded`

## License behavior

- `active` / `trial` = extension should work silently
- `grace` / `past_due` = extension should warn but continue
- `suspended` / `expired` / `canceled` / `disabled` / `terminated` = extension should block saving
