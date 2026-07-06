Dock district deployment build with Dock HQ.

Use this package for district-first school rollout:
- dock-admin-app/ contains the Vercel admin app, school admin portal, and owner-only Dock HQ portal.
- dock-extension/ contains the Chrome MV3 extension.
- docs/DOCK_HQ_OWNER_PORTAL.md explains the owner portal and deployment flow.

Do not ship backup folders or macOS archive junk. For production, run the SQL migration in dock-admin-app/sql/owner_portal_licensing_branding.sql and set DOCK_OWNER_EMAILS in Vercel.
