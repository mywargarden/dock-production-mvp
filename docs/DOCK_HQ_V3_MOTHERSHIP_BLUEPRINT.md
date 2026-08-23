# Dock HQ V3 — Mothership Blueprint

## Product rule

If the task exists because the user owns Dock, it belongs in Dock HQ.

District Admin is a separate customer-facing workspace editor. Normal Dock users never see owner controls. Raw API endpoints are never navigation destinations.

## Web surfaces

### `/`
Public/role landing page only.

- Open Dock HQ
- Open District Admin
- Product/help copy
- No Bootstrap API button
- No raw JSON/API links
- No confusing workspace-index link

### `/owner`
The single owner mothership. All owner work stays inside this route with an internal sidebar. It must not require separate owner sites.

Core modules:

1. Overview
   - districts/customers
   - licensed seats / seats used
   - active / trial / past-due / suspended counts
   - renewals needing attention
   - recent activity
   - system health summary

2. Districts
   - create customer/district
   - customer identity/contact metadata
   - org code
   - primary + additional verified domains
   - district admins
   - outside-domain exceptions
   - owner notes
   - archive/suspend controls

3. Licensing & Billing
   - plan
   - seat limit
   - trial / active / past_due / suspended / expired
   - renewal date
   - grace period
   - Stripe customer/subscription status
   - invoices/payment status
   - billing history
   - manual owner override with audit reason
   - one source of truth for license enforcement

4. Users & Seats
   - active users by district
   - role
   - first seen / last seen
   - seat utilization
   - activate/deactivate
   - search/filter
   - outside-domain users
   - district admins

5. Theme Studio
   - built-in theme library
   - create new theme
   - duplicate theme
   - theme name/slug
   - background color/image/gradient
   - card/surface color + opacity
   - primary/accent color
   - text + muted text colors
   - border color
   - radius/shadow presets
   - live Dock preview
   - save draft / publish
   - assign theme to one or many districts
   - user-theme override policy
   - theme version history / rollback

6. Branding
   - district logo
   - district background
   - accent color
   - default theme
   - preview managed Dock
   - branding ownership policy (owner-only vs delegated)

7. Workspaces & Publishing Oversight
   - selected district workspace name
   - live version
   - last publish
   - draft status
   - recent versions
   - preview
   - rollback (owner emergency tool)
   - owner does not normally edit school links; that remains District Admin work

8. Releases
   - current extension release
   - minimum supported extension version
   - district-specific minimum override
   - staged rollout status
   - release notes
   - emergency kill/disable policy if ever implemented

9. Diagnostics & Support
   - Supabase connectivity
   - auth health
   - managed-config health
   - district resolution test
   - domain resolution test
   - license enforcement result
   - workspace publish health
   - last sync / last seen
   - readable diagnostics, never raw API pages as the primary UI

10. Audit & Activity
    - owner changes
    - district admin publishes
    - user status changes
    - license changes
    - domain/admin changes
    - theme/branding changes
    - billing events

11. Owner Settings
    - owner accounts
    - security/access policy
    - global defaults
    - support contact
    - product-wide feature flags (future)

### `/admin`
District Admin only.

- persistent Dock Home link
- district identity/read-only licensing summary
- workspace links editor
- branding controls only if owner permits delegation
- save draft
- publish live
- preview
- no billing/license/domain/seat/owner tools

### `/district/[orgCode]`
Read-only workspace preview.

- opened from HQ or District Admin
- clear Back to Dock HQ / Back to District Admin context where appropriate
- `/district` index is not a management destination

### `/api/*`
Machine-only routes.

- never linked as normal navigation
- Bootstrap remains for extension bootstrapping
- managed-config remains for extension/workspace delivery

## Current audit findings (2026-08-23)

- The current root page still exposes Admin, Workspace Pages, and Bootstrap API. This is wrong for the finished product.
- `/district` currently only sends the user to Admin, so it is not a useful workspace index.
- District Admin has no reliable navigation back to the site.
- The current HQ Theme Studio is a branding/default-theme selector, not a true theme generator.
- The extension theme system is currently hard-coded to a fixed set of theme IDs and CSS definitions.
- Managed district rendering intentionally clears normal personal themes and applies district branding separately.
- A `default_theme` value can be stored/delivered, but the extension does not yet apply a dynamic owner-created theme schema.
- Stripe automation is not implemented in the current web app code.
- The database contains an unused second licensing schema (`dock_districts`, `dock_licenses`, `dock_license_users`) with zero rows while the live application uses `organizations`, `organization_domains`, `profiles`, and `workspaces`. Do not create two competing license sources of truth.
- Current live tenant data is in the `organizations` model. V3 should keep that model authoritative and add billing fields/subscription events to it (or a single linked subscription table) rather than activating the unused parallel schema.

## Data architecture decision

V3 uses `organizations` as the tenant/customer identity source of truth.

Recommended supporting model:

- `organizations` — tenant identity, plan summary, enforcement status, seat cap, branding defaults
- `organization_domains` — verified domains
- `organization_admins` — delegated district admins
- `organization_allowed_users` — outside-domain exceptions
- `profiles` — users/seats
- `workspaces`, `workspace_tabs`, `workspace_versions` — managed content
- `dock_themes` — owner-created/built-in theme definitions and versions
- `billing_subscriptions` or equivalent — Stripe customer/subscription/invoice state linked directly to `organizations.id`
- `audit_logs` — owner/admin/system events

The empty legacy `dock_districts` / `dock_licenses` tables should remain unused until we intentionally migrate/remove them. They must not become a second enforcement path.

## Theme runtime contract

A real Theme Studio requires a dynamic theme object delivered to the extension, not only a theme name.

Example managed theme payload:

```json
{
  "id": "hcps-custom-1",
  "name": "HCPS Harbor",
  "background": "#f4f8fc",
  "foreground": "#14263a",
  "muted": "#607286",
  "primary": "#0b7a53",
  "primaryText": "#ffffff",
  "card": "rgba(255,255,255,.88)",
  "border": "rgba(20,38,58,.14)",
  "sceneImageUrl": "",
  "radius": 16,
  "shadow": "soft"
}
```

The extension must validate this payload, map it to CSS variables, and fall back safely to a built-in theme when invalid.

## Billing rule

Stripe should eventually be the payment-state source, but Dock remains the enforcement layer.

Flow:

Stripe event -> verified webhook -> organization/subscription state update -> audit event -> Dock bootstrap/config enforcement.

Owner may have an explicit audited manual override, but there must never be two unrelated license records controlling the same district.

## Release rule

Do not merge V3 to production until all of the following pass on a preview deployment:

- owner can enter HQ from `/`
- owner never needs raw API pages
- every HQ module stays inside `/owner`
- admin can return home
- preview can return to its originating management surface
- HCPS data loads correctly
- license status enforcement still works
- domain resolution still works
- existing HCPS workspace v297 still renders correctly
- personal Dock memories are unaffected
- existing extension themes are unaffected until dynamic-theme support is intentionally enabled
