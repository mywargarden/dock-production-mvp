// Apple-only popup authority shim.
// The shared popup UI and its normal signed-in behavior remain in popup.js.
// Safari differs only when an action must survive opening an OAuth tab, because
// Safari may tear down the action popup as soon as focus leaves it.

import { getAuthSummary, signOut } from "./core/auth.js";
import { getSavedTabs } from "./core/storage.js";
import { api } from "./adapters/index.js";

const authBtn = document.getElementById("authBtn");
const saveAllBtn = document.getElementById("saveAllBtn");
const reasonInput = document.getElementById("reason");
const workspaceSelect = document.getElementById("workspaceSelect");
const progressEl = document.getElementById("progress");

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

async function beginDurableAuth(action, extra = {}) {
  const result = await api.runtime.sendMessage({
    type: "DOCK_SAFARI_BEGIN_AUTH",
    action,
    ...extra
  });
  if (!result?.ok) throw new Error(result?.error || "Safari sign-in could not start.");
  return result;
}

// Capture before popup.js sees the event. For Safari, Dock'em All must either
// run from the background immediately (already signed in) or hand its intent to
// the background before OAuth can destroy this popup.
saveAllBtn?.addEventListener("click", async (event) => {
  event.preventDefault();
  event.stopImmediatePropagation();

  try {
    const auth = await getAuthSummary();
    const reason = reasonInput?.value?.trim?.() || "";
    const groupId = targetGroupId();

    if (auth?.signedIn) {
      // Safari live 7 found that a second Dock'em All could spend ~30 seconds
      // recapturing tabs that shared background.js would later reject as URL
      // duplicates. Prove the no-op case before any capture work begins.
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
      return;
    }

    showProgress("Sign in with Google, then Dock'em All will continue automatically…");
    await beginDurableAuth("save-all", {
      reason,
      openMemories: true,
      targetGroupId: groupId
    });
  } catch (error) {
    alert(error?.message || "Dock'em All failed to start.");
  }
}, true);

// Make the explicit Sign in button durable for the same reason. Sign-out stays
// local and uses the shared auth module.
authBtn?.addEventListener("click", async (event) => {
  event.preventDefault();
  event.stopImmediatePropagation();

  try {
    const auth = await getAuthSummary();
    if (auth?.signedIn) {
      await signOut();
      authBtn.textContent = "Sign in";
      authBtn.title = "Sign in with Google";
      return;
    }

    showProgress("Opening Google sign-in…");
    await beginDurableAuth("sign-in");
  } catch (error) {
    alert(error?.message || "Google sign-in failed.");
  }
}, true);

// Load the unchanged shared popup after Safari's authority hooks are installed.
await import("./popup.js");
