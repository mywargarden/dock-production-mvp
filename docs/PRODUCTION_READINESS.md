# Dock Production Readiness Notes

This moonshot build starts from the stable Dock build and keeps the proven behavior first. The goal is not a rewrite; it is a cleaned, hardened candidate that preserves the working extension flows while tightening cost, data, and release discipline.

## Sacred behaviors

These must pass before any release candidate is considered valid:

- Dock 1 Tab saves the current normal web page.
- Dock'em All cycles real browser tabs and opens/focuses Safe Harbor at the correct end point.
- Dock'em All does not save Safe Harbor, extension pages, localhost, logout pages, or browser-internal pages as personal memories.
- Personal memory delete removes the remote row and deleted memories do not return after sign-out, extension reload, or sign-in.
- `personal_memories.screenshot_data_url` remains `NULL` for new saves.
- `personal_memories.screenshot_url` is the durable screenshot source when capture/upload succeeds.
- Managed workspace cards remain distinct from personal memories.
- Uploaded managed icons remain visible where expected.

## Screenshot and egress invariant

Full screenshots are allowed only as temporary upload payloads. They should not become persistent local or database state.

Permanent model:

```text
Full screenshot base64 = temporary upload payload only
Small local preview/thumb = bounded and disposable
screenshot_url = durable preview source
screenshot_data_url = NULL in Supabase
Personal favicons = http/https only, no data URLs
Managed custom icons = allowed only where bounded and intentional
```

## Current hardening in this build

- Server memory route keeps `screenshot_data_url` out of list/detail responses.
- Server POST uploads incoming screenshot data to Storage and persists `screenshot_url` while setting `screenshot_data_url` to `NULL`.
- Server POST no longer carries old row-level screenshot base64 forward during merge/upsert.
- Server personal memory icons are sanitized to HTTP/HTTPS URLs only and capped.
- Extension personal-memory sync drops data-url favicons.
- Extension personal-memory sync sends `screenshot_data_url` only when it is a valid bounded image data URL; it does not accidentally send remote URLs as screenshot data.
- Extension delete retains the stable ID-resolution flow, with a URL-delete fallback if ID lookup misses.
- Obvious build junk was removed from the package: `.DS_Store`, `*.bak`, old nested zips, and `tsconfig.tsbuildinfo`.

## Known remaining risks

- Chrome screenshot capture can fail on protected-media pages or some login-heavy pages; placeholders are correct in those cases.
- The extension still has duplicated screenshot/sync logic across `popup.js`, `background.js`, `core/auth.js`, and `core/storage.js`. This is acceptable for a stable MVP but should eventually be consolidated.
- `host_permissions: <all_urls>` is powerful. Keep it only if screenshot/tab capture for arbitrary web pages is central to the product, and document why.
- Google identity and district workspace behavior need repeated clean-install tests.
- Vercel/Supabase environment variables must be configured in production; local builds require `.env.local`.

## Release principle

One bug class. One patch. One proof. Then move.

## District deployment hard gate

Before selling or handing this to school IT, verify:
- first owner/admin is seeded intentionally, not by open self-claim;
- `/admin` persists primary domain, additional verified domains, admin emails, max users, and tabs after Save Draft, Publish Live, and reload;
- `/api/bootstrap?domain=<primary-domain>` and `/api/bootstrap?domain=<additional-domain>` resolve the same organization;
- a bad domain or bad org setup produces an unresolved/error state instead of silently falling back to a local-only district;
- a fresh extension install on a clean Chrome profile receives the managed workspace from the district deployment path;
- the Chrome Web Store or enterprise deployment privacy text explains tab access, screenshots, storage, and `<all_urls>`.

