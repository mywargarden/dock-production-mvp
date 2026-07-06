# Dock multi-district build: run and test

## What's included
- `dock-admin-app` — Vercel/Next.js admin app
- `dock-extension` — Chrome extension

## What changed in this build
- added `/api/bootstrap` so the extension can resolve a district from `email_domain` or `orgCode`
- extension now resolves district in this order:
  1. enterprise managed policy (`chrome.storage.managed`)
  2. Chrome profile email domain (`chrome.identity.getProfileUserInfo()`)
  3. cached org bootstrap from prior successful boot
  4. Henry County legacy fallback for backward-safe testing
- managed workspace endpoint is now derived from the resolved org instead of hardcoded Henry-only wiring
- kept local-first hydration and managed workspace sync behavior intact

## Admin app: local run
1. Open a terminal in `dock-admin-app`
2. On macOS, clear quarantine if needed:
   `xattr -dr com.apple.quarantine .`
3. Install dependencies:
   `npm install`
4. Start the admin app:
   `npm run dev`
5. Open `http://localhost:3000`

## Admin app: Vercel deploy
1. Push the updated `dock-admin-app` to your `dock-production-mvp` repo
2. In Vercel, set **Root Directory** to `dock-admin-app`
3. Set env vars:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
4. Redeploy
5. In Supabase auth settings, allow the Vercel URL as a redirect URL

## Multi-district setup in the admin app
For each district, create or update the organization fields in the admin app:
- **Organization Name**
- **Organization Code** (example: `henry-county`)
- **Email Domain** (example: `henry.k12.va.us`)
- publish the workspace

The bootstrap endpoint will use `email_domain` to map the extension to that organization.

## Extension: load for testing
1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select the `dock-extension` folder from this build
5. Keep the extension pinned while testing

## How the extension now resolves district
### Preferred production path
District IT sets managed policy values such as:
- `orgCode`
- `organizationName`
- `emailDomain`
- `apiBaseUrl`
- `configUrl`

### Automatic path
If managed policy is not present, the extension tries the Chrome profile email domain and calls:
- `https://dock-production-mvp.vercel.app/api/bootstrap?domain=<teacher-domain>`

If a matching organization exists in Supabase, Dock resolves the correct workspace endpoint automatically.

## Quick tests
### Test 1 — bootstrap endpoint
Open:
`https://dock-production-mvp.vercel.app/api/bootstrap?domain=henry.k12.va.us`

You should get JSON containing:
- `organization.orgCode`
- `configUrl`
- `workspacePath`

### Test 2 — Vercel publish
1. Open the Vercel admin app
2. Log in
3. Edit the district workspace
4. Click **Publish Live**
5. Verify the live JSON updates at:
   `https://dock-production-mvp.vercel.app/api/org/<orgCode>/workspace`

### Test 3 — extension auto-resolution
1. Use a Chrome profile whose email domain matches a district `email_domain`
2. Open the extension
3. Open the managed workspace tab in Dock
4. Confirm the published cards appear

### Test 4 — managed policy override
If your district IT policy sets `orgCode` or `configUrl`, the extension should use that instead of profile-domain lookup.

## Example managed policy values
```json
{
  "orgCode": "henry-county",
  "organizationName": "Henry County Public Schools",
  "emailDomain": "henry.k12.va.us",
  "apiBaseUrl": "https://dock-production-mvp.vercel.app",
  "configUrl": "https://dock-production-mvp.vercel.app/api/org/henry-county/workspace",
  "forceManagedMode": true
}
```

## Important notes
- The endpoint `/api/org/<orgCode>/workspace` is supposed to return raw JSON. That is correct.
- The extension still includes a Henry County legacy fallback so your current stable testing path does not break.
- For true district rollout, create an organization row per district and publish a workspace for each one.

## District deployment hard gate

Before selling or handing this to school IT, verify:
- first owner/admin is seeded intentionally, not by open self-claim;
- `/admin` persists primary domain, additional verified domains, admin emails, max users, and tabs after Save Draft, Publish Live, and reload;
- `/api/bootstrap?domain=<primary-domain>` and `/api/bootstrap?domain=<additional-domain>` resolve the same organization;
- a bad domain or bad org setup produces an unresolved/error state instead of silently falling back to a local-only district;
- a fresh extension install on a clean Chrome profile receives the managed workspace from the district deployment path;
- the Chrome Web Store or enterprise deployment privacy text explains tab access, screenshots, storage, and `<all_urls>`.

