# Dock Apple parity candidate

This branch treats the current Chrome Dock 0.3.7 behavior as the contract. Safari on macOS and Safari on iPadOS use the same Dock HTML, CSS, JavaScript, backend, Admin site, Owner HQ, account, organization bootstrap, managed workspace payloads, personal-memory API, licensing model, and visual assets.

Apple-only code exists only where Safari does not expose Chrome's browser authority directly:

- `dock-extension/adapters/safariAdapter.js` supplies the Safari OAuth flow because Safari does not provide the WebExtensions `identity` API.
- The same adapter exposes a Chrome-compatible `storage.managed.get()` surface through Safari native messaging when managed configuration is available.
- `SafariWebExtensionHandler.swift` is shared by the macOS and iOS/iPadOS extension targets and returns only Dock's existing managed-policy keys.
- The Apple manifest uses `nativeMessaging`; Chrome-only `identity` permissions are not requested in the Apple candidate.

## What was deliberately not carried forward

The February `DockHelper` localhost screenshot server is not part of this candidate. It was macOS-only and would create a separate Safari product path. Current Dock's browser capture path remains the first implementation. If real Safari/iPad testing proves a capture gap, that gap must be solved at the Apple adapter/native boundary without forking the Dock data model or UI.

## Generate the Xcode project

On the Mac that has Xcode installed, from the repository root:

```bash
chmod +x apple/generate_xcode_project.command
./apple/generate_xcode_project.command
```

The generator invokes Apple's Safari Web Extension converter against the current `dock-extension` directory, so the generated macOS and iPadOS targets contain the same current Dock product code rather than the old 0.2.0 Safari snapshot.

Recovered defaults from the earlier Dock Apple project are used unless overridden:

- Apple Developer team: `A4JT7VU8Q4`
- Bundle base: `com.anchor.dock.macos`

Override them without editing source if needed:

```bash
DOCK_DEVELOPMENT_TEAM=YOURTEAM DOCK_APP_BUNDLE_ID=com.example.dock ./apple/generate_xcode_project.command
```

## Frozen parity contract for live 7

Do not call Apple parity PASS merely because the Xcode project builds or the extension icon appears. Test the same product behaviors against Chrome 0.3.7:

1. Dock popup visually matches the current Chrome popup.
2. Google/Supabase sign-in completes and the same Dock user is recovered.
3. Personal Library hydrates from the same account/backend.
4. Dock current tab saves title, URL, note/reason, preview/screenshot behavior, and persists after reopen.
5. Dock'em All saves the same eligible tabs, respects duplicate handling, and opens the same Library behavior.
6. Workspaces create/edit/open/reorder/delete with the same local and remote semantics.
7. Admin-published district workspace resolves for the signed-in organization and displays the same branding/cards.
8. Admin changes propagate to Safari/iPad through the same published workspace API.
9. Owner license state and minimum-version/access behavior reach the Apple clients through the same backend contract.
10. Sign-out/sign-in and restart preserve or recover state according to the same current Dock rules.
11. Run the same sequence on macOS Safari and iPadOS Safari. A macOS PASS does not establish iPadOS PASS.

Anything that cannot match because of a Safari/iPad browser limitation must be demonstrated by live behavior before a native fallback is added.
