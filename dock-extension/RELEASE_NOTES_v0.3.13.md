# Dock 0.3.13

## Dock follows the active web tab

- Adds a draggable Dock launcher to ordinary HTTP and HTTPS pages.
- Clicking the launcher opens Dock's real extension popup in the current browser window, so the current page can be docked through the existing save flow.
- Shares the launcher position with Safe Harbor and remembers it across tabs and reloads.
- Keeps the launcher out of iframes and uses an isolated Shadow DOM surface so page styling cannot accidentally restyle Dock.
- Uses the clean Dock mark in a warm neutral floating token rather than the earlier dark utility-button treatment.
- Keeps Safe Harbor's launcher and routes it through the same canonical popup bridge.

## Security and scope

- No new extension permissions.
- No new page-content collection or background polling.
- The floating launcher is injected only on ordinary `http://` and `https://` pages.
- Chrome-restricted pages such as browser settings, the New Tab page, and other protected browser surfaces remain outside normal content-script injection.
