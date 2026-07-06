# Dock production-hardening build: run and test

## What changed in this build
- Dock extension async background message handlers were hardened so responses always resolve cleanly.
- Multi-district resolution is now **bootstrap-first** and **production-first**.
- Henry County fallback is no longer used by default. It is now **gated** and only activates if explicitly enabled with:
  - managed policy: `allowLegacyFallback: true`
  - or local extension storage key: `dockAllowLegacyFallback = true`
- The admin app includes a **District Directory** switcher so you can open and manage multiple districts from one Vercel deployment using `?org=<orgCode>`.

## Deploy the admin app to Vercel
1. Replace the `dock-admin-app` folder in your `dock-production-mvp` repo with the `dock-admin-app` folder from this build.
2. Push to GitHub.
3. In Vercel, keep **Root Directory** set to `dock-admin-app`.
4. Confirm these environment variables exist:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
5. Redeploy.

## Load the extension for testing
1. Remove any older unpacked Dock extension from `chrome://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked**.
4. Select the `dock-extension` folder from this build.

## Test 1 — bootstrap endpoint
Open:
`https://dock-production-mvp.vercel.app/api/bootstrap?domain=henry.k12.va.us`

Expected:
- JSON returns `organization.orgCode = henry-county`
- `configUrl` points to `/api/org/henry-county/workspace`
- `syncMode = email-domain`

## Test 2 — production publish loop
1. Open `https://dock-production-mvp.vercel.app`
2. Log in.
3. Edit the Henry County workspace.
4. Click **Publish Live**.
5. Verify the live endpoint updates:
   `https://dock-production-mvp.vercel.app/api/org/henry-county/workspace`
6. Open the extension and confirm the managed cards update.

## Test 3 — add a second district
1. In the admin app, use the **District Directory** card.
2. Create a second district by changing:
   - **Organization Code** to something like `demo-district`
   - **Organization Name** to `Demo District`
   - **Email Domain** to `demo.k12.va.us`
3. Create a visibly different managed workspace.
4. Click **Save Draft** and **Publish Live**.
5. Verify bootstrap resolves the second district:
   `https://dock-production-mvp.vercel.app/api/bootstrap?domain=demo.k12.va.us`
6. Verify the second live workspace endpoint:
   `https://dock-production-mvp.vercel.app/api/org/demo-district/workspace`

## Test 4 — first real rollout simulation
1. Use a Chrome profile whose email address is on the second district domain.
2. Open the unpacked extension.
3. Open Dock.
4. Confirm the extension resolves the correct district automatically and loads the matching managed workspace.

## Optional managed policy override
District IT can set managed storage values like:
```json
{
  "orgCode": "demo-district",
  "organizationName": "Demo District",
  "emailDomain": "demo.k12.va.us",
  "apiBaseUrl": "https://dock-production-mvp.vercel.app",
  "configUrl": "https://dock-production-mvp.vercel.app/api/org/demo-district/workspace",
  "forceManagedMode": true,
  "allowLegacyFallback": false
}
```

## Notes
- `/api/org/<orgCode>/workspace` is supposed to return raw JSON.
- If you still see `runtime.lastError` warnings on a normal webpage and the stack points to another extension or `filter.bundle.js`, that warning is not from Dock.
- Dock’s own async runtime message handlers are hardened in this build.
