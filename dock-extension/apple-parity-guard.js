// Apple-only runtime repair layer installed before shared Safe Harbor logic.
// Chrome remains the product contract. This file owns only Safari behaviors that
// user testing has independently falsified: quota-safe Delete All, quota-safe
// Add All into personal Docks, and Safari's drag-ghost cursor anchoring.

import { api } from "./adapters/index.js";
import { getSavedTabs } from "./core/storage.js";
import { deleteRemoteMemoriesByUrls } from "./core/auth.js";

const TOMBSTONE_KEY = "dockDeletedMemoryTombstones";
const clearAllBtn = document.getElementById("clearAllBtn");

function norm(value) { return String(value || "").trim(); }
function normalizeUrl(value) {
  const raw = norm(value);
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    if (!["http:", "https:"].includes(parsed.protocol)) return "";
    parsed.hash = "";
    return parsed.toString();
  } catch { return ""; }
}
function safeHttp(value) {
  const raw = norm(value);
  if (!raw || /^data:/i.test(raw)) return "";
  try {
    const parsed = new URL(raw);
    if (!["http:", "https:"].includes(parsed.protocol)) return "";
    return parsed.toString();
  } catch { return ""; }
}
function bestRemotePreview(item) {
  const candidates = [
    item?.screenshot_url,
    item?.screenshotUrl,
    item?.screenshotThumb,
    item?.previewUrl,
    item?.thumbnailUrl,
    item?.customIcon,
  ];
  for (const candidate of candidates) {
    const url = safeHttp(candidate);
    if (url) return url;
  }
  return "";
}
function toLightGroupItem(item) {
  const url = normalizeUrl(item?.url);
  if (!url) return null;
  const preview = bestRemotePreview(item);
  const favicon = safeHttp(item?.faviconUrl || item?.favIconUrl || item?.icon_url || item?.customIcon);
  return {
    title: norm(item?.title) || url,
    url,
    reason: norm(item?.reason).slice(0, 500),
    faviconUrl: favicon || null,
    savedAt: Number(item?.savedAt || 0) || Date.now(),
    screenshot_url: preview || null,
    screenshotUrl: preview || null,
    screenshotThumb: preview || null,
    screenshot: null,
    screenshot_data_url: null,
    screenshotBlocked: preview ? false : Boolean(item?.screenshotBlocked),
    __kind: "main",
    sourceKind: norm(item?.__kind || item?.sourceKind),
    sourceId: norm(item?.id || item?.local_id || item?.sourceId || url),
    copiedFromAdmin: item?.__kind === "admin" || Boolean(item?.copiedFromAdmin),
  };
}
function recentTombstones(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const cutoff = Date.now() - (45 * 24 * 60 * 60 * 1000);
  const next = {};
  for (const [url, at] of Object.entries(source)) {
    if (Number(at || 0) >= cutoff) next[url] = Number(at);
  }
  return next;
}
function showAppleToast(message, tone = "success") {
  let toast = document.getElementById("dockAppleRuntimeToast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "dockAppleRuntimeToast";
    Object.assign(toast.style, {
      position: "fixed", left: "50%", bottom: "24px", transform: "translateX(-50%)",
      zIndex: "2147483600", maxWidth: "min(520px, calc(100vw - 32px))", padding: "12px 16px",
      borderRadius: "14px", background: "rgba(255,255,255,.97)", color: "#1c2a3a",
      boxShadow: "0 14px 34px rgba(28,42,58,.16)", fontSize: "13px", fontWeight: "800",
      textAlign: "center", pointerEvents: "none"
    });
    document.body.appendChild(toast);
  }
  toast.style.border = tone === "error" ? "1px solid rgba(176,57,46,.28)" : "1px solid rgba(43,140,143,.22)";
  toast.textContent = message;
  toast.style.opacity = "1";
  clearTimeout(showAppleToast.timer);
  showAppleToast.timer = setTimeout(() => { toast.style.opacity = "0"; }, 2800);
}

async function quotaSafeDeleteAll() {
  const state = await api.storage.local.get([
    "dockActiveGroup",
    "dockGroupItems",
    TOMBSTONE_KEY
  ]);
  const activeGroup = norm(state?.dockActiveGroup) || "__all__";
  if (activeGroup === "__admin__") throw new Error("Dock is locked.");

  if (activeGroup !== "__all__") {
    const groupItems = state?.dockGroupItems && typeof state.dockGroupItems === "object"
      ? { ...state.dockGroupItems }
      : {};
    const items = Array.isArray(groupItems[activeGroup]) ? groupItems[activeGroup] : [];
    if (!items.length) return;
    if (!confirm("Delete all tabs in this Dock? The Dock itself will stay.")) return;
    groupItems[activeGroup] = [];
    await api.storage.local.set({ dockGroupItems: groupItems });
    window.location.reload();
    return;
  }

  const all = await getSavedTabs({ localOnly: true });
  if (!all.length) return;
  if (!confirm("Delete all memories from Library? Your other Docks will stay intact.")) return;

  const now = Date.now();
  const tombstones = recentTombstones(state?.[TOMBSTONE_KEY]);
  for (const item of all) {
    const url = normalizeUrl(item?.url);
    if (url) tombstones[url] = now;
  }

  // Critical Safari difference: release the large screenshot-bearing keys FIRST.
  // browser.storage.local.set() can reject a logically smaller replacement when
  // the existing store is already near quota. remove() cannot increase quota.
  await api.storage.local.remove(["savedTabs", "savedTabsLite"]);

  let tombstonesPersisted = false;
  try {
    await api.storage.local.set({ [TOMBSTONE_KEY]: tombstones });
    tombstonesPersisted = true;
  } catch {}

  // If tombstones could not be persisted, wait for server deletion before reload
  // so a remote hydrate cannot immediately resurrect the just-deleted memories.
  if (tombstonesPersisted) {
    deleteRemoteMemoriesByUrls(all, { userInitiated: true }).catch(() => {});
  } else {
    await deleteRemoteMemoriesByUrls(all, { userInitiated: true });
  }

  try {
    await api.storage.local.set({
      dockSafariLastDeleteAll: { ok: true, count: all.length, at: now, tombstonesPersisted }
    });
  } catch {}

  window.location.reload();
}

function resolveTargetDockId(button) {
  const wrap = button?.closest?.(".groupPillWrap");
  if (wrap?.dataset?.groupId) return norm(wrap.dataset.groupId);
  const menu = button?.closest?.(".groupPillMenu");
  const home = menu?.__dockHome;
  return norm(home?.dataset?.groupId);
}

async function quotaSafeAddAll(button) {
  const targetDockId = resolveTargetDockId(button);
  if (!targetDockId || targetDockId === "__all__" || targetDockId === "__admin__") {
    throw new Error("Choose a personal Dock first.");
  }

  const state = await api.storage.local.get([
    "dockActiveGroup", "dockGroups", "dockGroupItems", "savedTabs", "savedTabsLite", "dockManagedWorkspace"
  ]);
  const activeGroup = norm(state?.dockActiveGroup) || "__all__";
  const groupItems = state?.dockGroupItems && typeof state.dockGroupItems === "object"
    ? { ...state.dockGroupItems }
    : {};

  let source = [];
  if (activeGroup === "__all__") {
    source = Array.isArray(state?.savedTabsLite) && state.savedTabsLite.length
      ? state.savedTabsLite
      : (Array.isArray(state?.savedTabs) ? state.savedTabs : []);
  } else if (activeGroup === "__admin__") {
    source = Array.isArray(state?.dockManagedWorkspace?.tabs) ? state.dockManagedWorkspace.tabs : [];
  } else {
    source = Array.isArray(groupItems[activeGroup]) ? groupItems[activeGroup] : [];
  }

  const additions = source.map(toLightGroupItem).filter(Boolean);
  if (!additions.length) throw new Error("There are no website memories to add from this view.");

  // Personal Dock membership is a reference set, not a second screenshot store.
  // Normalize the target to lightweight records before adding new items so Safari
  // does not duplicate base64 screenshots and cross its smaller local quota.
  const existing = (Array.isArray(groupItems[targetDockId]) ? groupItems[targetDockId] : [])
    .map(toLightGroupItem).filter(Boolean);
  const seen = new Set(existing.map((item) => normalizeUrl(item.url)).filter(Boolean));
  let added = 0;
  for (const item of additions) {
    const key = normalizeUrl(item.url);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    existing.push(item);
    added += 1;
  }
  groupItems[targetDockId] = existing;

  // Do not rewrite dockActiveGroup or dockGroups. That was the path that could
  // make the managed HCPS pill temporarily disappear after a failed quota write.
  await api.storage.local.set({ dockGroupItems: groupItems });
  document.querySelectorAll(".groupPillMenu").forEach((menu) => menu.classList.add("hidden"));
  const targetName = (Array.isArray(state?.dockGroups) ? state.dockGroups : []).find((g) => g?.id === targetDockId)?.name || "Dock";
  showAppleToast(added ? `Added ${added} ${added === 1 ? "memory" : "memories"} to ${targetName}.` : `${targetName} already has these memories.`);
}

clearAllBtn?.addEventListener("click", (event) => {
  event.preventDefault();
  event.stopImmediatePropagation();
  quotaSafeDeleteAll().catch((error) => alert(error?.message || "Delete All failed."));
}, true);

// Safari-only Add All authority. Capture before the shared handler so a quota
// failure cannot mutate the in-memory group state and leave HCPS visually absent.
document.addEventListener("click", (event) => {
  const button = event.target?.closest?.("button.groupPillMenuItem");
  if (!button || norm(button.textContent).toLowerCase() !== "add all") return;
  event.preventDefault();
  event.stopImmediatePropagation();
  quotaSafeAddAll(button).catch((error) => {
    showAppleToast(error?.message || "Could not add these memories.", "error");
  });
}, true);

// Safari live testing established that the shared drag clone can still drift far
// below the pointer even with the Chrome fixed-position CSS. Keep Chrome's sort
// logic, but re-anchor only the visual clone to Safari's live pointer coordinates.
window.addEventListener("pointermove", (event) => {
  const x = event.clientX;
  const y = event.clientY;
  requestAnimationFrame(() => {
    const ghost = document.querySelector(".cardDragGhost");
    if (!ghost) return;
    ghost.style.setProperty("left", `${Math.round(x + 14)}px`, "important");
    ghost.style.setProperty("top", `${Math.round(y + 14)}px`, "important");
  });
}, true);
