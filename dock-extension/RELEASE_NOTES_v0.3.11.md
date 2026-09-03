# Dock 0.3.11

## Managed Dock resilience

- A previously loaded district-managed Dock now remains visible through temporary authentication, session-refresh, bootstrap, or network failures.
- `PROFILE_REQUIRED` receives one authenticated bootstrap/retry opportunity so a valid district user can be provisioned without losing the current managed Dock.
- Managed state is cleared only when the server returns an explicit hard-revocation condition, such as a disabled account, tenant mismatch, denied access, suspended/expired/past-due license, or archived district.
- Sync failures are recorded as degraded/revoked state instead of treating every HTTP 401/403 as equivalent.

## Scope

No sharing, drag/reorder, Theme Store, personal-memory, or managed-branding behavior is intentionally changed in this release.
