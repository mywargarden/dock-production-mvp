# Dock Release Checklist

Run this checklist before naming a build stable.

## 1. Setup

- Build admin app locally.
- Deploy admin app to Vercel.
- Confirm newest Vercel deployment is current and ready.
- Reload unpacked extension.
- Clear old Chrome extension errors.

## 2. Personal memory save

- Dock one normal public page such as Example Domain, Wikipedia, Walmart, or Pinterest.
- Confirm card appears in Safe Harbor.
- Confirm Supabase newest row has:
  - `screenshot_url` populated when capture/upload succeeds.
  - `screenshot_data_url` is `NULL`.
  - `deleted_at` is `NULL`.

## 3. Delete durability

- Delete that exact personal memory.
- Wait five seconds.
- Refresh Safe Harbor.
- Sign out.
- Unload/reload the extension.
- Sign back in.
- Confirm the deleted memory does not return.
- Confirm no new `HTTP_400` delete errors in Chrome extension errors.

## 4. Dock'em All hard case

- Keep Safe Harbor open.
- Switch to a normal web page in another tab.
- Open popup and press Dock'em All.
- Confirm it cycles real tabs.
- Confirm it does not save Safe Harbor as a memory.
- Confirm Safe Harbor opens/focuses at the end.
- Confirm screenshots are present where capture is allowed.

## 5. Network/cost check

- Open Safe Harbor DevTools > Network.
- Reload Safe Harbor.
- Check total transferred/resources.
- Search/filter `data:image`.
- Confirm no giant full-base64 screenshot flood.

## 6. Managed workspace

- Publish/load HCPS or test workspace.
- Confirm managed cards are locked as expected.
- Confirm uploaded managed icons render if present.
- Confirm managed cards are not treated as personal delete targets.

## 7. Package hygiene

- Confirm no `.DS_Store`, `*.bak`, nested zips, or build cache files are included.
- Name the stable build clearly, e.g. `dock-stable-egress-v1`.
- Save the zip and test log outside the working folder.

## District deployment hard gate

Before selling or handing this to school IT, verify:
- first owner/admin is seeded intentionally, not by open self-claim;
- `/admin` persists primary domain, additional verified domains, admin emails, max users, and tabs after Save Draft, Publish Live, and reload;
- `/api/bootstrap?domain=<primary-domain>` and `/api/bootstrap?domain=<additional-domain>` resolve the same organization;
- a bad domain or bad org setup produces an unresolved/error state instead of silently falling back to a local-only district;
- a fresh extension install on a clean Chrome profile receives the managed workspace from the district deployment path;
- the Chrome Web Store or enterprise deployment privacy text explains tab access, screenshots, storage, and `<all_urls>`.

