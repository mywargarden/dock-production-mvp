// Apple-only Safe Harbor authority bridge.
// The shared memories.js remains the product/UI implementation. Safari/iPadOS
// gets only the browser-specific execution fixes that live testing established:
// durable Delete All and a portable Dock share link.

import { api } from "./adapters/index.js";
import { getSavedTabs, setSavedTabs } from "./core/storage.js";

const DOCK_WEB_ORIGIN = "https://dock-production-mvp.vercel.app/";
const SHARE_HASH_KEY = "dock-share";
const MAX_SHAREABLE_IMAGE_CHARS = 90000;

const clearAllBtn = document.getElementById("clearAllBtn");
let shareCache = new Map();
let shareCachePromise = null;

function norm(value) {
  return String(value || "").trim();
}

function normalizeHttpUrl(value) {
  const raw = norm(value);
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    if (!["http:", "https:"].includes(parsed.protocol)) return "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return "";
  }
}

function ensureColor(value) {
  return /^#[0-9a-f]{6}$/i.test(norm(value)) ? norm(value) : "#8fd8c6";
}

function previewScore(value) {
  const raw = norm(value);
  if (!raw || /screenshot-unavailable/i.test(raw)) return -1;
  if (/^data:image\//i.test(raw)) return raw.length;
  if (/^https?:\/\//i.test(raw)) return 1000 + raw.length;
  return -1;
}

function pickBestPreview(tab) {
  const fields = [
    "screenshot_url",
    "screenshotUrl",
    "screenshotThumb",
    "screenshot",
    "screenshot_data_url",
    "previewImage",
    "previewUrl",
    "thumbnail",
    "thumbnailUrl",
    "image",
    "imageUrl",
    "image_url",
    "customIcon",
    "icon_url",
    "iconUrl",
    "faviconUrl",
    "favIconUrl"
  ];

  let best = "";
  let bestScore = -1;
  for (const field of fields) {
    const candidate = norm(tab?.[field]);
    const score = previewScore(candidate);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return bestScore >= 0 ? best : "";
}

function makeShareTab(tab) {
  const url = normalizeHttpUrl(tab?.url);
  if (!url) return null;

  const preview = pickBestPreview(tab);
  const keepPreview = preview && preview.length <= MAX_SHAREABLE_IMAGE_CHARS ? preview : "";

  return {
    title: norm(tab?.title) || url,
    url,
    reason: norm(tab?.reason).slice(0, 500),
    faviconUrl: norm(tab?.faviconUrl || tab?.favIconUrl || tab?.icon_url || "") || null,
    savedAt: Number(tab?.savedAt || 0) || Date.now(),
    screenshot_url: keepPreview || null,
    screenshotBlocked: !keepPreview && !!tab?.screenshotBlocked
  };
}

function encodeShareData(value) {
  const json = JSON.stringify(value);
  const bytes = new TextEncoder().encode(json);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function buildPortableShareLink(group, items) {
  const tabs = (Array.isArray(items) ? items : []).map(makeShareTab).filter(Boolean);
  if (!tabs.length) return "";

  const encoded = encodeShareData({
    version: 1,
    type: "dock-workspace-share",
    workspace: {
      name: norm(group?.name) || "Dock",
      color: ensureColor(group?.color),
      exportedAt: Date.now(),
      tabs
    }
  });

  return `${DOCK_WEB_ORIGIN}#${SHARE_HASH_KEY}=${encoded}`;
}

async function rebuildShareCache() {
  if (shareCachePromise) return shareCachePromise;
  shareCachePromise = (async () => {
    const res = await api.storage.local.get(["dockGroups", "dockGroupItems"]);
    const groups = Array.isArray(res?.dockGroups) ? res.dockGroups : [];
    const groupItems = res?.dockGroupItems && typeof res.dockGroupItems === "object" ? res.dockGroupItems : {};
    const next = new Map();

    for (const group of groups) {
      const id = norm(group?.id);
      if (!id) continue;
      const link = buildPortableShareLink(group, groupItems[id]);
      if (link) next.set(id, link);
    }

    shareCache = next;
    return next;
  })();

  try {
    return await shareCachePromise;
  } finally {
    shareCachePromise = null;
  }
}

function groupIdForShareButton(button) {
  const direct = norm(button?.closest?.(".groupPillWrap")?.dataset?.groupId);
  if (direct) return direct;
  return "";
}

function finishShareWithLink(link, groupId) {
  if (!link) {
    alert("This Dock only contains browser or extension pages right now. Save at least one regular website tab to create a share link.");
    return;
  }

  // Invoke clipboard immediately while Safari still has the click's transient
  // user activation. The previous shared path awaited storage before copying,
  // which is less reliable under Safari's stricter activation lifetime.
  try {
    const copyPromise = navigator.clipboard?.writeText?.(link);
    if (copyPromise && typeof copyPromise.then === "function") {
      copyPromise.then(async () => {
        try {
          await api.storage.local.set({
            dockSafariLastShare: { ok: true, groupId, linkLength: link.length, at: Date.now() }
          });
        } catch {}
        alert(`Share link copied. Send it to anyone who has Dock installed.\n\n${link}`);
      }).catch(async () => {
        try {
          await api.storage.local.set({
            dockSafariLastShare: { ok: false, groupId, fallback: "prompt", linkLength: link.length, at: Date.now() }
          });
        } catch {}
        prompt("Copy and share this Dock link:", link);
      });
      return;
    }
  } catch {}

  prompt("Copy and share this Dock link:", link);
}

async function portableShare(groupId) {
  const cached = shareCache.get(groupId);
  if (cached) {
    finishShareWithLink(cached, groupId);
    return;
  }

  await rebuildShareCache();
  const link = shareCache.get(groupId) || "";
  // The async fallback no longer has guaranteed clipboard activation, so use a
  // selectable prompt rather than pretending a copy operation succeeded.
  if (!link) {
    finishShareWithLink("", groupId);
    return;
  }
  prompt("Copy and share this Dock link:", link);
}

async function deleteAllCurrentView() {
  const res = await api.storage.local.get(["dockActiveGroup", "dockGroupItems"]);
  const activeGroup = norm(res?.dockActiveGroup) || "__all__";

  if (activeGroup === "__admin__") {
    alert("Dock is locked.");
    return;
  }

  if (activeGroup === "__all__") {
    const all = await getSavedTabs({ localOnly: true });
    if (!all.length) return;
    if (!confirm("Delete all Docks on this page? Other Docks will stay intact.")) return;

    // Use the same canonical storage mutation as the proven selected-delete
    // path, including tombstones and remote delete synchronization.
    await setSavedTabs([], { removedTabs: all });
    try {
      await api.storage.local.set({
        dockSafariLastDeleteAll: { ok: true, scope: "library", count: all.length, at: Date.now() }
      });
    } catch {}
    window.location.reload();
    return;
  }

  const groupItems = res?.dockGroupItems && typeof res.dockGroupItems === "object"
    ? { ...res.dockGroupItems }
    : {};
  const items = Array.isArray(groupItems[activeGroup]) ? groupItems[activeGroup] : [];
  if (!items.length) return;
  if (!confirm("Delete all tabs in this Dock? The Dock itself will stay.")) return;

  groupItems[activeGroup] = [];
  await api.storage.local.set({
    dockGroupItems: groupItems,
    dockSafariLastDeleteAll: { ok: true, scope: "dock", groupId: activeGroup, count: items.length, at: Date.now() }
  });
  window.location.reload();
}

// Install the Delete All capture listener before memories.js registers its
// normal bubble listener. Only this established failing Safari action diverges.
clearAllBtn?.addEventListener("click", (event) => {
  event.preventDefault();
  event.stopImmediatePropagation();
  deleteAllCurrentView().catch((error) => {
    alert(error?.message || "Delete All failed.");
  });
}, true);

// Share buttons are created dynamically by memories.js inside each Dock pill,
// so use capture-phase delegation and recover the owning group id from the pill.
document.addEventListener("click", (event) => {
  const button = event.target?.closest?.("button");
  if (!button || norm(button.textContent) !== "Share") return;

  const groupId = groupIdForShareButton(button);
  if (!groupId || groupId.startsWith("__")) return;

  event.preventDefault();
  event.stopImmediatePropagation();
  portableShare(groupId).catch((error) => {
    alert(error?.message || "Share failed.");
  });
}, true);

// Precompute links so the eventual Share click can invoke the clipboard while
// Safari still grants transient user activation.
rebuildShareCache().catch(() => {});
if (api.storage?.onChanged?.addListener) {
  api.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;
    if (changes?.dockGroups || changes?.dockGroupItems) rebuildShareCache().catch(() => {});
  });
}

// Load the unchanged shared Safe Harbor implementation after Safari hooks exist.
await import("./memories.js");
