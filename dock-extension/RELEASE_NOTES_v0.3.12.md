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
- Keeps inline screenshot previews authoritative across save/reorder cycles; custom icons and generic image fields are no longer allowed to displace a valid screenshot during preview preservation.
- Reduces web-accessible resources to the external import handoff page; its packaged scripts, styles, icons, and schema remain internal extension resources.

## Still under 7

- Real Chrome testing independently exposed and then verified the cross-context managed-cache repaint defect: degraded state preservation, cached rendering, atomic version replacement, live repaint, hard revocation, and update-required view-without-mutation behavior have survived the browser attack after the fix.
- The expanded real Chrome attack then exposed a preview-reorder regression caused by two competing preview-scoring doctrines. The preservation layer now matches the canonical preview rule and must survive the full exact-head browser pass, including save/reorder/reload/import rendering and retired-loop instrumentation.
- This candidate remains unmerged until that exact-head static, artifact-lineage, and expanded Chrome 7 triad passes together.
- Personal Dock group membership/layout remains local-device state for 1.0; cross-device group-layout sync is parked rather than added to RC1 scope.
