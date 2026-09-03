// Apple-only popup authority shim.
// Chrome remains Dock's behavior contract. Safari differs only where browser
// authority must survive the action popup disappearing during OAuth.

import { signOut } from "./core/auth.js";
import { getSavedTabs } from "./core/storage.js";
import { api } from "./adapters/index.js";

const authBtn = document.getElementById("authBtn");
const saveAllBtn = document.getElementById("saveAllBtn");
const reasonInput = document.getElementById("reason");
const workspaceSelect = document.getElementById("workspaceSelect");
const progressEl = document.getElementById("progress");

// Snapshot the browser tab behind the popup while that context is definitely
// alive. Safari auth continuation must restore this exact origin after OAuth.
let originSnapshot = { tabId: null, windowId: null };
try {
  api.tabs.query({ active: true, currentWindow: true })
    .then(([tab]) => {
      originSnapshot = {
        tabId: tab?.id ?? null,
        windowId: tab?.windowId ?? null
      };
    })
    .catch(() => {});
} catch {}

function showProgress(text) {
  if (!progressEl) return;
  progressEl.textContent = text;
  progressEl.classList.remove("hidden");
}

function targetGroupId() {
  const value = workspaceSelect?.value || "__all__";
  return value === "__all__" ? "" : value;
}

function normalizeUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    if (!["http:", "https:"].includes(url.protocol)) return "";
    url.hash = "";
    const params = [...url.searchParams.entries()]
      .filter(([key]) => !["utm_source","utm_medium","utm_campaign","utm_term","utm_content","fbclid","gclid"].includes(String(key).toLowerCase()))
      .sort(([aKey, aValue], [bKey, bValue]) => aKey.localeCompare(bKey) || aValue.localeCompare(bValue));
    url.search = "";
    for (const [key, val] of params) url.searchParams.append(key, val);
    return url.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}

function isDockInternalUrl(value) {
  const normalized = normalizeUrl(value);
  if (!normalized) return true;
  try {
    const url = new URL(normalized);
    if (url.hostname !== "dock-production-mvp.vercel.app") return false;
    const path = url.pathname || "/";
    return path === "/" || path === "/admin" || path.startsWith("/admin/") || path.startsWith("/api/");
  } catch {
    return true;
  }
}

async function allEligibleTabsAlreadyDocked(groupId) {
  const tabs = await api.tabs.query({ currentWindow: true });
  const eligible = (Array.isArray(tabs) ? tabs : [])
    .map((tab) => normalizeUrl(tab?.url))
    .filter((url) => url && !isDockInternalUrl(url));

  if (!eligible.length) return { allDuplicates: false, eligibleCount: 0 };

  let existing = [];
  if (groupId) {
    const res = await api.storage.local.get(["dockGroupItems"]);
    const groupItems = res?.dockGroupItems && typeof res.dockGroupItems === "object" ? res.dockGroupItems : {};
    existing = Array.isArray(groupItems[groupId]) ? groupItems[groupId] : [];
  } else {
    existing = await getSavedTabs({ localOnly: true });
  }

  const existingUrls = new Set((Array.isArray(existing) ? existing : []).map((item) => normalizeUrl(item?.url)).filter(Boolean));
  const uniqueEligible = [...new Set(eligible)];
  const novel = uniqueEligible.filter((url) => !existingUrls.has(url));
  return {
    allDuplicates: uniqueEligible.length > 0 && novel.length === 0,
    eligibleCount: uniqueEligible.length,
    novelCount: novel.length
  };
}

function setAuthLaunching(active, message = "") {
  document.body.dataset.safariAuthLaunching = active ? "true" : "false";
  for (const button of [authBtn, saveAllBtn]) {
    if (!button) continue;
    button.disabled = !!active;
    button.setAttribute("aria-busy", active ? "true" : "false");
  }
  if (message) showProgress(message);
}

function isVisiblySignedIn() {
  return String(authBtn?.textContent || "").trim().toLowerCase() === "signed in";
}

async function cancelStagedAuth(launchId) {
  try {
    await api.runtime.sendMessage({
      type: "DOCK_SAFARI_CANCEL_AUTH",
      launchId: String(launchId || "")
    });
  } catch {}
}

// Safari 7 established that fire-and-forget storage from the popup is not a
// valid continuation boundary: the popup can be torn down before the write is
// committed. Stage the exact continuation in the background, require a
// read-after-write acknowledgement, and only then permit OAuth to open.
async function beginDurableAuth(action, extra = {}) {
  const staged = await api.runtime.sendMessage({
    type: "DOCK_SAFARI_STAGE_AUTH",
    action: action === "save-all" ? "save-all" : "sign-in",
    reason: String(extra.reason || "").slice(0, 500),
    openMemories: extra.openMemories !== false,
    targetGroupId: String(extra.targetGroupId || ""),
    originWindowId: originSnapshot.windowId,
    originTabId: originSnapshot.tabId
  });

  if (!staged?.ok || !staged?.staged || !staged?.launchId || !staged?.authUrl) {
    throw new Error(staged?.error || "Safari could not durably stage Dock sign-in.");
  }

  let authTab = null;
  try {
    // tabs.create is extension authority and does not need to be raced against
    // the durable write. The destructive transition happens only after staging
    // has been positively acknowledged.
    authTab = await api.tabs.create({ url: staged.authUrl, active: true });
    const authTabId = authTab?.id ?? null;
    if (authTabId == null) throw new Error("Safari Dock could not open the Google sign-in tab.");

    // This attachment is diagnostic/closing metadata, not continuation state.
    // If the popup dies here, the callback can adopt sender.tab.id instead.
    api.runtime.sendMessage({
      type: "DOCK_SAFARI_ATTACH_AUTH_TAB",
      launchId: staged.launchId,
      authTabId
    }).catch(() => {});

    return { ok: true, launchId: staged.launchId, authTabId };
  } catch (error) {
    await cancelStagedAuth(staged.launchId);
    throw error;
  }
}

async function runSignedInBulk(reason, groupId) {
  const duplicateCheck = await allEligibleTabsAlreadyDocked(groupId);
  if (duplicateCheck.allDuplicates) {
    showProgress(`Done — ${duplicateCheck.eligibleCount} already Docked`);
    try {
      await api.storage.local.set({
        dockSafariLastBulkFastPath: {
          ok: true,
          skippedDuplicates: duplicateCheck.eligibleCount,
          at: Date.now()
        }
      });
    } catch {}
    return;
  }

  showProgress("Starting Dock'em All…");
  const result = await api.runtime.sendMessage({
    type: "SAVE_ALL_OPEN_TABS",
    reason,
    openMemories: true,
    targetGroupId: groupId
  });
  if (!result?.ok) throw new Error(result?.error || "Bulk save failed.");
  showProgress(`Done — saved ${result.saved || 0}`);
}

// Capture before popup.js sees the event. Once signed in, the unchanged shared
// background remains the authority for the actual Dock'em All operation.
saveAllBtn?.addEventListener("click", (event) => {
  event.preventDefault();
  event.stopImmediatePropagation();

  const reason = reasonInput?.value?.trim?.() || "";
  const groupId = targetGroupId();

  if (!isVisiblySignedIn()) {
    setAuthLaunching(true, "Preparing secure Google sign-in…");
    void beginDurableAuth("save-all", {
      reason,
      openMemories: true,
      targetGroupId: groupId
    }).catch((error) => {
      setAuthLaunching(false);
      try { alert(error?.message || "Dock'em All sign-in failed to start."); } catch {}
    });
    return;
  }

  void runSignedInBulk(reason, groupId).catch((error) => {
    try { alert(error?.message || "Dock'em All failed to start."); } catch {}
  });
}, true);

// Sign-out stays in the shared auth module. Signed-out sign-in uses the same
// acknowledged continuation boundary as Dock'em All.
authBtn?.addEventListener("click", (event) => {
  event.preventDefault();
  event.stopImmediatePropagation();

  if (!isVisiblySignedIn()) {
    setAuthLaunching(true, "Preparing secure Google sign-in…");
    void beginDurableAuth("sign-in").catch((error) => {
      setAuthLaunching(false);
      try { alert(error?.message || "Google sign-in failed to start."); } catch {}
    });
    return;
  }

  void (async () => {
    try {
      await signOut();
      authBtn.textContent = "Sign in";
      authBtn.title = "Sign in with Google";
    } catch (error) {
      try { alert(error?.message || "Dock sign-out failed."); } catch {}
    }
  })();
}, true);

// Load the unchanged shared popup after Safari's authority hooks are installed.
await import("./popup.js");
