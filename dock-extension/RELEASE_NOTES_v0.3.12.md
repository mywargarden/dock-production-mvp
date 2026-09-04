# Dock 0.3.12

## Safe Harbor continuity and resilience

- Preserves the last valid district Dock while checking for a newer published version.
- Checks for managed updates on load, focus, visibility return, and a short foreground cadence.
- Newly published district workspace versions replace the previous valid local state only after successful fetch and validation.
- Temporary auth/session/bootstrap/network failures preserve the last known valid managed Dock; explicit hard revocation still clears it.
- Transient token-refresh failures preserve the signed-in identity and recover automatically instead of converting an outage into a sign-out.
- Personal-memory cloud writes are queued rather than allowing rapid writes to overwrite one pending sync job.
- Identity changes clear identity-scoped district state before the new account is announced.

## Storage and extension surface

- Adds the `unlimitedStorage` permission because Dock intentionally stores screenshot-rich local memories and must not fail at the default local-storage quota.
- Reduces web-accessible resources to the external import handoff page; its packaged scripts, styles, icons, and schema remain internal extension resources.

## Still under 7

- This candidate remains unmerged until real Chrome testing proves visual continuity, managed update replacement, temporary-failure preservation, hard revocation, and mutation gating.
- Personal Dock group membership/layout remains local-device state for 1.0; cross-device group-layout sync is parked rather than added to RC1 scope.
