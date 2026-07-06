# Dock Phase 1 Google Auth Setup

This build starts wiring Google sign-in for personal memories.

## What you still need to configure

### Extension
Edit `dock-extension/core/auth.js` and replace:
- `supabaseUrl`
- `supabaseAnonKey`

### Supabase
Enable Google as an auth provider and add your extension redirect URL from:
`chrome.identity.getRedirectURL("supabase-auth")`

### Vercel
Set:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

## What this build wires now
- Google sign-in button in popup and view-all page
- save/save all requires sign-in
- main-library personal saves sync to `/api/user/memories` when signed in
- admin app sign-in uses Google OAuth
- backend personal memories route now verifies bearer auth
- schema now includes users, organization_admins, memory_groups, personal_memories, and audit_logs

## Not fully finished yet
- personal workspace/group cloud sync is not complete
- publish is not moved server-side in this scaffold
- offline retry queue is not complete yet
