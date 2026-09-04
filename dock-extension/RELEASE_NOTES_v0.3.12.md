# Dock 0.3.12

## Safe Harbor continuity

- Preserves the last valid district Dock while checking for a newer published version.
- Checks for managed updates when Safe Harbor loads, regains focus, becomes visible, and every five minutes while visible.
- Newly published district workspace versions flow into local storage and the existing Safe Harbor storage listener rerenders them without reinstalling the extension.
- Adds a prepaint continuity shell so reload does not expose the raw default tan page before theme/managed state has loaded.
- Masks brief multi-item/delete-all/Dock'em All transitions so intermediate empty render states are not exposed to the user.

## Inherited from 0.3.11

- Temporary auth/session/bootstrap/network failures preserve the last known valid managed Dock.
- Explicit hard revocation still clears managed state.

## Scope

No new permissions. No intentional changes to sharing, drag/reorder, personal-memory semantics, Theme Store, or district authoring controls.
