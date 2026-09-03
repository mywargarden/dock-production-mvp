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

const SUPABASE_URL = "https://mcqohghghfxtchxpaddj.supabase.co";
const CALLBACK_URL = "https://dock-production-mvp.vercel.app/";
const PENDING_KEY = "dockSafariPendingAuthAction";
const LAST_RESULT_KEY = "dockSafariLastAuthAction";

// Snapshot the browser tab behind the popup as soon as the popup loads. The
// signed-out click path must not await anything before opening OAuth; Safari can
// lose the user activation after an async hop.
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

function buildAuthUrl() {
  const url = new URL(`${SUPABASE_URL}/auth/v1/authorize`);
  url.searchParams.set("provider", "google");
  url.searchParams.set("redirect_to", CALLBACK_URL);
  url.searchParams.set("scopes", "openid email profile");
  url.searchParams.set("flow_type", "implicit");
  return url.toString();
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

async function recordLaunchResult(result) {
  try {
    await api.storage.local.set({
      [LAST_RESULT_KEY]: {
        ...result,
        at: Date.now()
      }
    });
  } catch {}
}

// IMPORTANT: this function deliberately performs no await before tabs.create.
// Both the durable storage write and OAuth tab creation are issued directly in
// the click's user-activation turn. The popup may die immediately afterward;
// the pending record is what lets the background resume the exact action.
function beginDurableAuth(action, extra = {}) {
  const launchId = `auth_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const pending = {
    launchId,
    source: "popup-direct",
    action: action === "save-all" ? "save-all" : "sign-in",
    reason: String(extra.reason || "").slice(0, 500),
    openMemories: extra.openMemories !== false,
    targetGroupId: String(extra.targetGroupId || ""),
    originWindowId: originSnapshot.windowId,
    originTabId: originSnapshot.tabId,
    authTabId: null,
    startedAt: Date.now()
  };

  // Start persistence first, but do not await it before opening the OAuth tab.
  const persistPromise = api.storage.local.set({ [PENDING_KEY]: pending });
  const openPromise = api.tabs.create({ url: buildAuthUrl(), active: true });

  Promise.resolve(persistPromise).catch((error) => {
    void recordLaunchResult({
      ok: false,
      phase: "auth-pending-write",
      launchId,
      error: String(error?.message || error || "SAFARI_AUTH_PENDING_WRITE_FAILED")
    });
  });

  Promise.resolve(openPromise)
    .then(async (authTab) => {
      const authTabId = authTab?.id ?? null;
      if (authTabId == null) throw new Error("Safari Dock could not open the Google sign-in tab.");
      try {
        const stored = await api.storage.local.get([PENDING_KEY]);
        const current = stored?.[PENDING_KEY];
        if (current?.launchId === launchId) {
          await api.storage.local.set({
            [PENDING_KEY]: { ...current, authTabId }
          });
        }
      } catch {}
      await recordLaunchResult({
        ok: true,
        phase: "auth-tab-opened",
        source: "popup-direct",
        action: pending.action,
        launchId,
        authTabId
      });
    })
    .catch(async (error) => {
      try {
        const stored = await api.storage.local.get([PENDING_KEY]);
        if (stored?.[PENDING_KEY]?.launchId === launchId) {
          await api.storage.local.remove([PENDING_KEY]);
        }
      } catch {}
      await recordLaunchResult({
        ok: false,
        phase: "auth-tab-open",
        source: "popup-direct",
        action: pending.action,
        launchId,
        error: String(error?.message || error || "SAFARI_AUTH_TAB_OPEN_FAILED")
      });
      setAuthLaunching(false);
      try { alert(error?.message || "Google sign-in could not open."); } catch {}
    });

  return { ok: true, started: true, action: pending.action, launchId };
}

async function runSignedInBulk(reason, groupId) {
  try {
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
  } catch (error) {
    try { alert(error?.message || "Dock'em All failed to start."); } catch {}
  }
}

// Capture before popup.js sees the event. Signed-out Safari must launch OAuth
// directly from this user gesture. Once signed in, the unchanged shared
// background remains the authority for the actual Dock'em All operation.
saveAllBtn?.addEventListener("click", (event) => {
  event.preventDefault();
  event.stopImmediatePropagation();

  const reason = reasonInput?.value?.trim?.() || "";
  const groupId = targetGroupId();

  if (!isVisiblySignedIn()) {
    setAuthLaunching(true, "Opening Google sign-in… Dock'em All will continue automatically.");
    beginDurableAuth("save-all", {
      reason,
      openMemories: true,
      targetGroupId: groupId
    });
    return;
  }

  void runSignedInBulk(reason, groupId);
}, true);

// Sign-out can be asynchronous. Signed-out sign-in must preserve the original
// click's user activation, so it launches before any await occurs.
authBtn?.addEventListener("click", (event) => {
  event.preventDefault();
  event.stopImmediatePropagation();

  if (!isVisiblySignedIn()) {
    setAuthLaunching(true, "Opening Google sign-in…");
    beginDurableAuth("sign-in");
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
