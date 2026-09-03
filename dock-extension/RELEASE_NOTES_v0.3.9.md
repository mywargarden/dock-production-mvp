# Dock 0.3.9 — Teacher-Friendly Short Sharing

- Replaces oversized payload-in-URL sharing with concise first-party Dock HTTPS links.
- Stores the sanitized shared Dock behind a cryptographically random opaque share ID in Dock's existing share store.
- Requires normal Dock authentication before shared workspace contents are retrieved.
- Keeps legacy `#data=` share links readable for backward compatibility.
- Uses the existing Import into Dock flow after a short link is opened.
- Adds no teacher directory, messaging inbox, third-party URL shortener, or new browser permission.
- Includes the 0.3.8 managed-background fit and drag-ghost positioning fixes.

Candidate status: requires real Chrome validation of short-link creation, public landing handoff, authenticated retrieval, import, and the still-open 0.3.8 drag interaction.
