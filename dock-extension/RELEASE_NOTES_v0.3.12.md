# Dock 0.3.12

## Safe Harbor continuity and resilience

- Preserves the last valid district Dock while checking for a newer published version.
- Checks for managed updates on load, focus, visibility return, and a short foreground cadence.
- Newly published district workspace versions replace the previous valid local state only after successful fetch and validation.
- Keeps managed workspace, metadata, and organization caches coherent across extension contexts so an already-open Safe Harbor can repaint immediately after the background worker applies a newer district publish or revocation.
- Temporary auth/session/bootstrap/network failures preserve the last known valid managed Dock; explicit hard revocation still clears it.
- Transient token-refresh failures preserve the signed-in identity and recover automatically instead of converting an outage into a sign-out.
- Personal-memory cloud writes are queued rather than allowing rapid writes to overwrite one pending sync job.
- Identity changes isolate personal state and clear identity-scoped district state before the new account is announced.

## Storage and extension surface

- Adds the `unlimitedStorage` permission because Dock intentionally stores screenshot-rich local memories and must not fail at the default local-storage quota.
- Canonicalizes personal-memory preview storage so heavy screenshot aliases are not multiplied across the local cache while preserving legitimate custom imagery.
- Reduces web-accessible resources to the external import handoff page; its packaged scripts, styles, icons, and schema remain internal extension resources.

## Still under 7

- Real Chrome testing has already independently demonstrated runtime installation, degraded managed-sync preservation, cached managed rendering, and atomic version-1 to version-2 storage replacement. The cross-context repaint defect exposed by that test was fixed in the canonical storage layer and must now survive the full exact-head Chrome 7 before merge.
- This candidate remains unmerged until the exact-head browser gate also proves visual continuity, live managed replacement, hard revocation, update-required view-without-mutation behavior, preview persistence, and absence of the retired Safe Harbor repair loops/scanner.
- Personal Dock group membership/layout remains local-device state for 1.0; cross-device group-layout sync is parked rather than added to RC1 scope.
