from pathlib import Path

path = Path("dock-extension/core/storage.js")
text = path.read_text()

needle = '''let remoteHydrationPromise = null;
let remoteHydrationFetchedAt = 0;
let managedWorkspaceCache = null;
let managedMetaCache = null;
let orgStateCache = null;

async function clearManagedWorkspaceState() {
'''

replacement = '''let remoteHydrationPromise = null;
let remoteHydrationFetchedAt = 0;
let managedWorkspaceCache = null;
let managedMetaCache = null;
let orgStateCache = null;

// Each extension page/service worker has its own ES-module instance and therefore
// its own in-memory caches. Keep those caches coherent with chrome.storage so a
// managed publish or revocation performed in one context is immediately visible
// to every other open Dock context.
if (api.storage?.onChanged?.addListener) {
  api.storage.onChanged.addListener((changes, areaName) => {
    if (areaName != "local") return;

    if (changes?.[MANAGED_WS_KEY]) {
      const next = changes[MANAGED_WS_KEY].newValue;
      managedWorkspaceCache = next && typeof next === "object" ? next : null;
      workspaceCache = Array.isArray(next?.tabs) ? next.tabs : null;
      workspaceLastFetch = next ? Date.now() : 0;
      workspacePromise = null;
    }

    if (changes?.[MANAGED_META_KEY]) {
      const next = changes[MANAGED_META_KEY].newValue;
      managedMetaCache = next && typeof next === "object" ? next : null;
    }

    if (changes?.[ORG_KEY]) {
      const next = changes[ORG_KEY].newValue;
      orgStateCache = next && typeof next === "object" ? next : null;
    }
  });
}

async function clearManagedWorkspaceState() {
'''

count = text.count(needle)
if count != 1:
    raise SystemExit(f"expected exactly one cache declaration block, found {count}")

path.write_text(text.replace(needle, replacement, 1))
print("managed cache coherence patch applied")
