# Dock 0.3.10

## Shared screenshot persistence

- Shared Dock imports now copy each available shared screenshot into a compact local preview during import.
- Imported previews no longer depend on the temporary 30-day share URL after the Dock has been added.
- Shared preview copies are bounded and compressed for card use rather than preserving full-size source screenshots.
- Existing short-share authentication, share expiry, drag/reorder behavior, Theme Store behavior, and extension permissions are unchanged.

### Browser verification

Before release, verify with a newly created short share that:
1. the imported card shows the sender's screenshot;
2. reload preserves the imported preview;
3. drag/reorder still commits;
4. short-share creation and import still use the first-party HTTPS flow.
