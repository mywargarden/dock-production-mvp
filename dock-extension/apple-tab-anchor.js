// Safari tab-position authority for Dock Safe Harbor.
// Chrome already keeps the library in the first tab slot. Safari can silently
// ignore a one-shot move while focus/navigation is changing, so reassert the
// invariant whenever the library tab is created, updated, or the background wakes.
(() => {
  const api = globalThis.browser;
  if (!api?.tabs?.query || !api?.runtime?.getURL) return;

  const memoriesUrl = api.runtime.getURL('memories.html');
  let anchoring = false;
  let timer = null;

  async function anchorSafeHarbor() {
    if (anchoring) return;
    anchoring = true;
    try {
      const tabs = await api.tabs.query({});
      const matches = (Array.isArray(tabs) ? tabs : [])
        .filter((tab) => typeof tab?.url === 'string' && tab.url.startsWith(memoriesUrl))
        .sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
      if (!matches.length) return;

      // One Safe Harbor tab per window. Keep each one at index 0 in its window.
      const byWindow = new Map();
      for (const tab of matches) {
        if (tab?.id == null || tab?.windowId == null) continue;
        if (!byWindow.has(tab.windowId)) byWindow.set(tab.windowId, tab);
      }
      for (const tab of byWindow.values()) {
        if ((tab.index ?? 0) === 0) continue;
        try { await api.tabs.move(tab.id, { index: 0 }); } catch {}
      }
    } finally {
      anchoring = false;
    }
  }

  function scheduleAnchor(delay = 80) {
    clearTimeout(timer);
    timer = setTimeout(() => { anchorSafeHarbor().catch(() => {}); }, delay);
  }

  try { api.runtime.onStartup?.addListener(() => scheduleAnchor(100)); } catch {}
  try { api.runtime.onInstalled?.addListener(() => scheduleAnchor(100)); } catch {}
  try { api.tabs.onCreated?.addListener(() => scheduleAnchor(120)); } catch {}
  try {
    api.tabs.onUpdated?.addListener((_tabId, changeInfo, tab) => {
      if (typeof tab?.url === 'string' && tab.url.startsWith(memoriesUrl)) scheduleAnchor(40);
      else if (changeInfo?.status === 'complete') scheduleAnchor(120);
    });
  } catch {}
  try { api.tabs.onMoved?.addListener(() => scheduleAnchor(120)); } catch {}
  try { api.windows?.onFocusChanged?.addListener(() => scheduleAnchor(100)); } catch {}

  scheduleAnchor(120);
})();
