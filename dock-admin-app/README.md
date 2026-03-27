
# Dock Admin MVP

## 1. Install

```bash
npm install
```

## 2. Configure environment

Copy `.env.local.example` to `.env.local` and add:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

## 3. Run locally

```bash
npm run dev
```

Open `http://localhost:3000`

## 4. Save a workspace

Use the form to save a district workspace.

## 5. Test the API

Open:

```text
http://localhost:3000/api/org/henry-county/workspace
```

## 6. Connect Dock extension

In Dock admin:
- Hosted Dock Admin URL: `http://localhost:3000`
- Organization Code: `henry-county`
- Save Managed Settings
- Join Org on This Browser
- Sync Managed Workspace Now
