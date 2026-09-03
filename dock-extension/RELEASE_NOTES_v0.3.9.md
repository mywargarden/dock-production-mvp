# Dock 0.3.9 — Teacher-Friendly Short Sharing

- Replaces oversized payload-in-URL sharing with concise first-party Dock HTTPS links.
- Stores the shared Dock behind a cryptographically random opaque share ID in Dock's existing share store.
- Shares the workspace layer only: Dock name/color plus tab titles, URLs, and favicons. Personal Notes and screenshot previews stay private.
- Requires normal Dock authentication before shared workspace contents are retrieved.
- Shared snapshots expire after 30 days and expired records are automatically purged from the share store.
- Share is one click: the link is copied and Dock gives nonblocking confirmation instead of a browser alert.
- Keeps legacy `#data=` share links readable for backward compatibility.
- Uses the existing Import into Dock flow after a short link is opened.
- Adds no teacher directory, messaging inbox, third-party URL shortener, or new browser permission.
- Includes the 0.3.8 managed-background fit and drag-ghost positioning fixes.

Apple parity note: Safari uses the same authenticated first-party share API and opaque HTTPS links. The public Add to Dock handoff is translated locally into the installed Safari extension without exposing Admin/Owner surfaces or embedding private Notes/screenshots in the URL.

Candidate status: requires real Safari macOS cross-browser validation, then independent iPad validation.
