import { getSavedTabs, saveTab, deleteTab, ensureManagedBootstrap, syncManagedWorkspace, recoverSavedTabsFromRemote } from "./core/storage.js";
import { isInternalUrl } from "./core/logic.js";
import { ensureSignedInInteractive, getAuthSummary, signOut } from "./core/auth.js";
import { api } from "./adapters/index.js";
import { getCachedImage, getPreviewIdentity } from "./core/imageCache.js";

const DEBUG = false;
const saveBtn = document.getElementById("saveBtn");
const saveAllBtn = document.getElementById("saveAllBtn");
const reasonInput = document.getElementById("reason");
const workspaceSelect = document.getElementById("workspaceSelect");
const tabList = document.getElementById("tabList");
const progressEl = document.getElementById("progress");
const viewAllBtn = document.getElementById("viewAllBtn");
const authBtn = document.getElementById("authBtn");
const upgradeModal = document.getElementById("upgradeModal");
const upgradeBtn = document.getElementById("upgradeBtn");
const dismissBtn = document.getElementById("dismissBtn");
const replaceBtn = document.getElementById("replaceBtn");
const replaceModal = document.getElementById("replaceModal");
const replaceList = document.getElementById("replaceList");
const cancelReplaceBtn = document.getElementById("cancelReplaceBtn");

let pendingTabPayload = null;
let bulkActive = false;
let lastRenderedTabsHash = "";

function buildTabsRenderHash(tabs = []) {
  return JSON.stringify((Array.isArray(tabs) ? tabs : []).map((tab, index) => ({
    key: String(tab?.id || tab?.local_id || tab?.url || `${tab?.title || ""}:${index}`),
    title: String(tab?.title || ""),
    url: String(tab?.url || ""),
    reason: String(tab?.reason || ""),
    savedAt: Number(tab?.savedAt || 0),
    screenshotBlocked: !!tab?.screenshotBlocked,
    hasPreview: !!String(
      tab?.screenshot_url ||
      tab?.screenshotUrl ||
      tab?.screenshotThumb ||
      tab?.screenshot ||
      tab?.screenshot_data_url ||
      ""
    ).trim(),
    previewKey: getPreviewIdentity(tab)
  })));
}

const THEME_KEY = "dockTheme";
const DEFAULT_THEME = "dock-green";
const THEMES = new Set([
  "dock-green",
  "slate",
  "warm",
  "sunset",
  "tie-dye",
  "rubber-ducky",
  "crazy-ducky",
  "violet-harbor",
  "skipper-harbor"
]);
const THEME_SCENE_ASSETS = {
  "sunset": "assets/dock-sunset.webp",
  "tie-dye": "assets/tie-dye-bg.webp",
  "rubber-ducky": "assets/rubber-ducky-theme.webp",
  "crazy-ducky": "assets/crazy-ducky-theme.webp",
  "skipper-harbor": "assets/skipper-harbor.webp"
};

function applyTheme(theme) {
  const next = THEMES.has(theme) ? theme : DEFAULT_THEME;
  document.body.dataset.theme = next;
  const sceneAsset = THEME_SCENE_ASSETS[next];
  document.documentElement.style.setProperty("--dock-theme-scene", sceneAsset ? `url("${sceneAsset}")` : "none");
}

async function loadTheme() {
  const res = await api.storage.local.get([THEME_KEY]);
  applyTheme(String(res[THEME_KEY] || DEFAULT_THEME));
}

function showProgress(text) {
  if (progressEl) {
    progressEl.textContent = text;
    progressEl.classList.remove("hidden");
  }
}

function hideProgress() {
  if (progressEl) {
    progressEl.classList.add("hidden");
    progressEl.textContent = "";
  }
}

function hideAllModals() {
  upgradeModal?.classList.add("hidden");
  replaceModal?.classList.add("hidden");
}

function selectedWorkspaceId() {
  return workspaceSelect?.value || "__all__";
}

async function refreshAuthUi() {
  if (!authBtn) return;
  const auth = await getAuthSummary();
  authBtn.textContent = auth.signedIn ? "Signed in" : "Sign in";
  authBtn.title = auth.signedIn
    ? `Signed in${auth.userEmail ? ` as ${auth.userEmail}` : ""}. Click to sign out.`
    : "Sign in with Google";
}

async function requirePersonalSignIn() {
  const auth = await getAuthSummary();
  if (auth.signedIn) return true;
  showProgress("Sign in with Google to save personal Dock memories...");
  try {
    await ensureSignedInInteractive();
    await recoverSavedTabsFromRemote();
    await refreshAuthUi();
    return true;
  } catch (error) {
    alert(error?.message || "Google sign-in failed.");
    return false;
  } finally {
    hideProgress();
  }
}

function createThumbImage(tab, { forReplace = false } = {}) {
  const img = document.createElement("img");
  img.alt = "";
  const screenshot =
    tab?.screenshot_url ||
    tab?.screenshotUrl ||
    tab?.screenshot ||
    tab?.screenshotThumb ||
    tab?.screenshot_data_url ||
    "";

  if (screenshot) {
    img.src = getCachedImage(screenshot) || screenshot;
  } else {
    img.src = "assets/screenshot-unavailable.webp";
    if (!forReplace) img.classList.add("fallbackThumb");
  }

  img.loading = "lazy";
  img.decoding = "async";
  return img;
}

function renderTabs(tabs) {
  tabList.innerHTML = "";
  tabs.forEach((tab, i) => {
    const li = document.createElement("li");
    li.className = "tabItem";

    const thumb = document.createElement("div");
    thumb.className = "thumb";
    thumb.appendChild(createThumbImage(tab));

    const main = document.createElement("div");
    main.className = "main";

    const title = document.createElement("div");
    title.className = "title";
    title.textContent = tab.title || tab.url || "(untitled)";

    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = tab.reason ? `— ${tab.reason}` : (tab.url || "");
    if (tab.screenshotBlocked) {
      meta.textContent = (meta.textContent ? `${meta.textContent} ` : "") + "• Screenshot blocked";
    }

    main.append(title, meta);
    main.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (tab.url) api.tabs.create({ url: tab.url });
    });

    const delBtn = document.createElement("button");
    delBtn.className = "deleteBtn";
    delBtn.type = "button";
    delBtn.title = "Delete";
    delBtn.textContent = "✕";
    delBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      await deleteTabFromCurrentTarget(i);
      await loadTabs();
      hideAllModals();
    });

    li.append(thumb, main, delBtn);
    tabList.appendChild(li);
  });
}

function renderTabsSafe(tabs) {
  const hash = buildTabsRenderHash(tabs);
  if (hash === lastRenderedTabsHash) return false;
  lastRenderedTabsHash = hash;
  renderTabs(tabs);
  return true;
}

function hasMissingHydratablePreview(tab) {
  if (!tab || tab.screenshotBlocked) return false;
  const url = String(tab.url || "").trim();
  if (!/^https?:\/\//i.test(url)) return false;

  const preview = String(
    tab.screenshot_url ||
    tab.screenshotUrl ||
    tab.screenshot ||
    tab.screenshotThumb ||
    tab.screenshot_data_url ||
    ""
  ).trim();

  if (preview) return false;

  const previewMissing = !!tab.previewMissing;
  const previewCheckedAt = Number(tab.previewCheckedAt || 0);
  const retryAfterMs = 24 * 60 * 60 * 1000;

  if (!previewMissing) return true;
  if (!previewCheckedAt) return true;
  return (Date.now() - previewCheckedAt) > retryAfterMs;
}

let popupPreviewHydrationPromise = null;
let popupPreviewHydratedThisSession = false;

async function ensurePopupPreviewsHydrated() {
  // Popup should stay local-first and never block first paint on remote hydration.
  popupPreviewHydratedThisSession = true;
  return false;
}

async function getTabsForCurrentTarget() {
  const targetId = selectedWorkspaceId();
  if (!targetId || targetId === "__all__") {
    return await getSavedTabs({ localOnly: true });
  }

  const res = await api.storage.local.get(["dockGroupItems"]);
  const groupItems = (res.dockGroupItems && typeof res.dockGroupItems === "object") ? res.dockGroupItems : {};
  return Array.isArray(groupItems[targetId]) ? groupItems[targetId] : [];
}

async function deleteTabFromCurrentTarget(index) {
  const targetId = selectedWorkspaceId();
  if (!targetId || targetId === "__all__") {
    await deleteTab(index);
    return;
  }

  const res = await api.storage.local.get(["dockGroupItems"]);
  const groupItems = (res.dockGroupItems && typeof res.dockGroupItems === "object") ? res.dockGroupItems : {};
  const nextItems = Array.isArray(groupItems[targetId]) ? [...groupItems[targetId]] : [];
  nextItems.splice(index, 1);
  groupItems[targetId] = nextItems;
  await api.storage.local.set({ dockGroupItems: groupItems });
}

async function loadTabs() {
  const tabs = await getTabsForCurrentTarget();
  renderTabsSafe(tabs);

  queueMicrotask(() => {
    ensurePopupPreviewsHydrated()
      .then(async (changed) => {
        if (changed) renderTabsSafe(await getTabsForCurrentTarget());
      })
      .catch(() => {});
  });
}

async function dataUrlFromBlob(blob) {
  return await new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(typeof reader.result === "string" ? reader.result : null);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(blob);
  });
}

async function compressScreenshotDataUrl(dataUrl) {
  try {
    if (!dataUrl) return null;

    const img = new Image();
    img.decoding = "async";
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = dataUrl;
    });

    const maxWidth = 640;
    const maxHeight = 420;
    const scale = Math.min(1, maxWidth / img.width, maxHeight / img.height);
    const width = Math.max(1, Math.round(img.width * scale));
    const height = Math.max(1, Math.round(img.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return dataUrl;

    ctx.drawImage(img, 0, 0, width, height);

    const blob = await new Promise((resolve) => {
      canvas.toBlob(resolve, "image/jpeg", 0.42);
    });

    if (!blob) return dataUrl;
    return await dataUrlFromBlob(blob) || dataUrl;
  } catch {
    return dataUrl;
  }
}

async function captureScreenshot() {
  try {
    const shot = await api.tabs.captureVisibleTab(null, { format: "jpeg", quality: 55 });
    return await compressScreenshotDataUrl(shot);
  } catch {
    return null;
  }
}

function isDockInternalPath(pathname = "") {
  const path = String(pathname || "/").toLowerCase();
  return (
    path === "/" ||
    path === "/admin" ||
    path.startsWith("/admin/") ||
    path === "/api/bootstrap" ||
    /^\/api\/org\/[^/]+\/workspace\/?$/i.test(path) ||
    /^\/api\/user\/memories\/?$/i.test(path)
  );
}

function isLogoutLikePath(pathname = "") {
  const path = String(pathname || "/").toLowerCase();
  return /(^|\/)(log(?:out|off)|sign(?:out|off))(\/|$)/i.test(path);
}

function shouldExcludePersonalSave(url) {
  const raw = String(url || "").trim();
  if (!raw) return true;
  if (isInternalUrl(raw)) return true;
  if (/^(blob|data|devtools|file):/i.test(raw)) return true;
  if (/^https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d+)?(?:\/|$)/i.test(raw)) return true;

  try {
    const parsed = new URL(raw);
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname || "/";
    if (host === "dock-production-mvp.vercel.app" && isDockInternalPath(path)) return true;
    if (isLogoutLikePath(path)) return true;
  } catch {
    return true;
  }

  return false;
}

async function loadWorkspaceOptions() {
  if (!workspaceSelect) return;
  const res = await api.storage.local.get(["dockGroups", "dockActiveGroup"]);
  const groups = Array.isArray(res.dockGroups) ? res.dockGroups : [];
  const current = workspaceSelect.value || "__all__";
  workspaceSelect.innerHTML =
    '<option value="__all__">Library</option>' +
    groups.map((g) => `<option value="${g.id}">${g.name || "Dock"}</option>`).join("");
  workspaceSelect.value = groups.some((g) => g.id === current) ? current : "__all__";
}

async function savePayloadToTarget(payload, targetId) {
  if (!targetId || targetId === "__all__") {
    await saveTab(payload);
    return true;
  }
  await api.runtime.sendMessage({ type: "SAVE_TAB_TO_WORKSPACE", payload, targetGroupId: targetId });
  return true;
}

async function trySavePayload(payload) {
  try {
    await savePayloadToTarget(payload, selectedWorkspaceId());
    return true;
  } catch (e) {
    if (e === "LIMIT_REACHED") {
      pendingTabPayload = payload;
      upgradeModal?.classList.remove("hidden");
      return false;
    }
    DEBUG && console.error(e);
    return false;
  }
}

workspaceSelect?.addEventListener("change", async () => {
  await loadTabs();
});

saveBtn?.addEventListener("click", async () => {
  if (!(await requirePersonalSignIn())) return;

  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  if (shouldExcludePersonalSave(tab?.url)) {
    showProgress("Skipped internal/debug page.");
    setTimeout(() => {
      if (!bulkActive) hideProgress();
    }, 1400);
    return;
  }

  const shot = await captureScreenshot();
  const payload = {
    title: tab.title,
    url: tab.url,
    reason: reasonInput.value.trim(),
    savedAt: Date.now(),
    screenshot: shot,
    faviconUrl: tab.favIconUrl || null
  };

  const ok = await trySavePayload(payload);
  if (ok) {
    pendingTabPayload = null;
    reasonInput.value = "";
    await loadTabs();
  }
});

api.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "BULK_PROGRESS") {
    bulkActive = true;
    showProgress(`Capturing ${msg.current}/${msg.total}…`);
  }
  if (msg?.type === "BULK_DONE") {
    bulkActive = false;
    showProgress(`Done — saved ${msg.saved}`);
    setTimeout(() => {
      if (!bulkActive) hideProgress();
    }, 1800);
    loadTabs().catch(() => {});
  }
});

async function focusOrOpenViewAllAtEnd() {
  const safeHarborUrl = chrome.runtime.getURL("memories.html");

  try {
    const allTabs = await chrome.tabs.query({});
    const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true }).catch(() => []);
    const activeWindowId = activeTab?.windowId;

    const safeHarborTabs = (allTabs || []).filter((tab) =>
      typeof tab?.url === "string" && tab.url.startsWith(safeHarborUrl)
    );

    if (safeHarborTabs.length > 0) {
      const primaryTab =
        safeHarborTabs.find((tab) => tab.windowId === activeWindowId) ||
        safeHarborTabs.slice().sort((a, b) => (a.index ?? 9999) - (b.index ?? 9999))[0];

      const duplicateIds = safeHarborTabs
        .filter((tab) => tab.id !== primaryTab.id && tab.id != null)
        .map((tab) => tab.id);

      if (duplicateIds.length) {
        await chrome.tabs.remove(duplicateIds).catch(() => null);
      }

      if (primaryTab.id != null) {
        await chrome.tabs.move(primaryTab.id, { index: 0 }).catch(() => null);
        await chrome.tabs.update(primaryTab.id, { active: true }).catch(() => null);
      }

      if (primaryTab.windowId != null) {
        await chrome.windows.update(primaryTab.windowId, { focused: true }).catch(() => null);
      }

      if (primaryTab.windowId != null) {
        await chrome.tabs.highlight({ windowId: primaryTab.windowId, tabs: 0 }).catch(() => null);
      }

      return primaryTab;
    }

    return await chrome.tabs.create({
      url: safeHarborUrl,
      active: true,
      index: 0
    });
  } catch (error) {
    DEBUG && console.error("Safe Harbor button failed to open memories.html:", error);
    alert("Safe Harbor failed to open. Check the extension console.");
    return null;
  }
}

saveAllBtn?.addEventListener("click", async () => {
  if (!(await requirePersonalSignIn())) return;

  const reason = reasonInput.value.trim();
  showProgress("Starting Dock'em All…");

  api.runtime.sendMessage({
    type: "SAVE_ALL_OPEN_TABS",
    reason,
    openMemories: true,
    targetGroupId: selectedWorkspaceId() === "__all__" ? "" : selectedWorkspaceId()
  }).then((result) => {
    if (!result?.ok) {
      DEBUG && console.warn("Bulk save failed:", result);
      showProgress(result?.error || "Bulk save failed.");
      setTimeout(hideProgress, 1800);
      return;
    }
    showProgress(`Done — saved ${result.saved || 0}`);
    loadTabs().catch(() => {});
  }).catch((e) => {
    DEBUG && console.warn("Bulk save failed:", e);
    showProgress("Bulk save failed (see console).");
    setTimeout(hideProgress, 1800);
  });
});

replaceBtn?.addEventListener("click", async () => {
  upgradeModal?.classList.add("hidden");
  replaceModal?.classList.remove("hidden");

  const tabs = await getSavedTabs({ localOnly: true });
  replaceList.innerHTML = "";

  tabs.forEach((tab, i) => {
    const li = document.createElement("li");
    li.className = "replaceItem";
    li.appendChild(createThumbImage(tab, { forReplace: true }));

    const span = document.createElement("span");
    span.textContent = tab.title || tab.url || "(untitled)";
    li.appendChild(span);

    li.addEventListener("click", async () => {
      await deleteTab(i);
      const ok = await trySavePayload(pendingTabPayload);
      if (ok) {
        pendingTabPayload = null;
        reasonInput.value = "";
      }
      hideAllModals();
      await loadTabs();
    });

    replaceList.appendChild(li);
  });
});

upgradeBtn?.addEventListener("click", () => {
  upgradeModal?.classList.remove("hidden");
});

dismissBtn?.addEventListener("click", hideAllModals);
cancelReplaceBtn?.addEventListener("click", hideAllModals);

authBtn?.addEventListener("click", async () => {
  const auth = await getAuthSummary();
  if (auth.signedIn) {
    await signOut();
  } else {
    try {
      await ensureSignedInInteractive();
      await recoverSavedTabsFromRemote();
      await loadTabs();
    } catch (error) {
      alert(error?.message || "Google sign-in failed.");
    }
  }
  await refreshAuthUi();
});

viewAllBtn?.addEventListener("click", async () => {
  await focusOrOpenViewAllAtEnd();
});

reasonInput?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") saveBtn.click();
});

let managedSyncPromise = null;

async function syncManagedOnce({ force = false } = {}) {
  if (managedSyncPromise) return managedSyncPromise;
  managedSyncPromise = (async () => {
    try {
      await ensureManagedBootstrap();
    } catch {}
    try {
      return await syncManagedWorkspace({ force });
    } catch {
      return { ok: false };
    }
  })();

  try {
    return await managedSyncPromise;
  } finally {
    managedSyncPromise = null;
  }
}

function afterFirstPaint() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      setTimeout(resolve, 0);
    });
  });
}

async function bootPopup() {
  // First paint must stay local and lightweight so the Chrome action popup can surface immediately.
  try { await loadTheme(); } catch {}
  try { await refreshAuthUi(); } catch {}
  try { await loadWorkspaceOptions(); } catch {}
  try { await loadTabs(); } catch {}

  // Anything that can touch slower storage paths or remote recovery gets deferred
  // until after the popup is already visible.
  afterFirstPaint().then(async () => {
    try {
      const [auth, localTabs] = await Promise.all([
        getAuthSummary(),
        getSavedTabs({ localOnly: true })
      ]);

      if (auth?.signedIn && !localTabs.length) {
        await recoverSavedTabsFromRemote();
        await loadTabs();
      }
    } catch {}

    try {
      await loadWorkspaceOptions();
    } catch {}

    try {
      await refreshAuthUi();
    } catch {}
  }).catch(() => {});
}

bootPopup().catch(() => {});

let popupRefreshTimer = null;

function schedulePopupRefresh() {
  if (popupRefreshTimer) clearTimeout(popupRefreshTimer);
  popupRefreshTimer = setTimeout(() => {
    popupRefreshTimer = null;
    loadTabs().catch(() => {});
    loadWorkspaceOptions().catch(() => {});
  }, 60);
}

if (api.storage?.onChanged?.addListener) {
  api.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;
    if (changes?.[THEME_KEY]) applyTheme(changes[THEME_KEY].newValue || DEFAULT_THEME);
    if (changes?.savedTabs || changes?.dockGroupItems || changes?.dockGroups) {
      schedulePopupRefresh();
    }
  });
}