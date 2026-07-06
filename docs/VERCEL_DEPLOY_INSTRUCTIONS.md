# Dock Admin Vercel Deploy Instructions

This build is prepared so the Vercel admin site matches the localhost admin site.

## What changed
- `src/app/page.tsx` is the full localhost-style Dock Admin editor UI.
- `src/lib/auth.ts` now uses the current site origin for Supabase magic-link redirect instead of hardcoded localhost.
- `.next` and `node_modules` were removed so Vercel builds fresh from source.

## Deploy on Vercel
1. Point Vercel at the `dock-admin-app` folder.
2. Ensure these environment variables are set in Vercel:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
3. In Supabase Auth settings, add these redirect/site URLs:
   - `https://dock-production-mvp.vercel.app`
   - your preview URL if you use one
4. Redeploy.

## Expected result
The Vercel root page should show the same full Dock Admin editor as localhost:
- Workspace Status
- Organization section
- Draft Workspace
- Tabs editor
- Teacher Preview
- Save Draft / Publish Live

The endpoint `/api/org/henry-county/workspace` is raw JSON by design. The extension reads it directly.
