# Dock Cross-Browser Build (Chrome + Safari)

This build reorganizes Dock into a **single shared core** + **thin browser adapter layer**:

- /core: browser-agnostic logic + storage helpers
- /adapters: chrome vs safari namespace selection

## What changed vs your locked Chrome build
- Replaced direct `chrome.*` calls with `api.*` from `/adapters/index.js`
- Moved storage + small utilities into `/core`
- Left UI/HTML/CSS identical

## How to test in Chrome
1. Open **chrome://extensions**
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select this folder (the one containing `manifest.json`)

## How to build for Safari (macOS)
Safari Web Extensions require an app wrapper.

1. Open Safari and enable:
   - Safari > Settings > Advanced > ✅ Show Develop menu
2. In Safari: **Develop > Show Extension Builder** (or use Xcode’s converter)
3. In Xcode, run:
   - **File > New > Project**
   - Choose **Safari Web Extension App**
4. When prompted, select this extension folder as the “Web Extension” source.
5. Build & run the macOS app.
6. In Safari: Settings > Extensions > enable Dock.

### Notes / common parity gotchas
- If screenshots ever return null in Safari, it’s usually a permissions + focused window timing issue.
  The background script already does focus + retries; keep macOS app frontmost during first tests.

## Selling as a bundle
- Safari requires the macOS/iOS app container anyway → that becomes your “app shell” for licensing.
- For Chrome, you can distribute via Chrome Web Store (or enterprise deployment).
- Use the same license key / account in the app shell and show a “Get Chrome Extension” button.

---
Build generated: 2026-03-02


## Prototype additions in this build
- Delete All on View All page
- Open Workspace button
- Groups relabeled as Workspaces in UI
- Local-only Admin Workspace prototype (`admin.html`) with up to 10 tabs
