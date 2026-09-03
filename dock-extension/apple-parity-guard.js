// Apple-only parity guard installed before shared Safe Harbor logic.
// It owns only live Safari failures established by user testing:
// - Delete All quota-safe atomic deletion
// - Cross-platform Share URL generation
// Drag sorting now inherits Dock's browser-agnostic drag-sort-fix.css.

import { api } from "./adapters/index.js";
import { getSavedTabs } from "./core/storage.js";
import { deleteRemoteMemoriesByUrls } from "./core/auth.js";

const SHARE_ORIGIN = "https://dock-production-mvp.vercel.app/share";
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
  } catch {
    return "";
  }
}

function isShareableUrl(value) {
  const url = normalizeUrl(value);
  if (!url) return false;
  try {
    const parsed = new URL(url);
    if (parsed.hostname === "dock-production-mvp.vercel.app") return false;
    return true;
  } catch {
    return false;
  }
}

function ensureColor(value) {
  return /^#[0-9a-f]{6}$/i.test(norm(value)) ? norm(value) : "#8fd8c6";
}

function preview(tab) {
  const candidates = [
    tab?.screenshot_url,
    tab?.screenshotUrl,
    tab?.screenshotThumb,
    tab?.screenshot,
    tab?.screenshot_data_url
  ].map(norm).filter(Boolean);
  const best = candidates.sort((a, b) => b.length - a.length)[0] || "";
  return best.length <= 90000 ? best : "";
}

function encode(value) {
  const json = JSON.stringify(value);
  const bytes = new TextEncoder().encode(json);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function resolveShareGroup(button) {
  const pillId = norm(button?.closest?.(".groupPillWrap")?.dataset?.groupId);
  if (pillId) return pillId;
  const state = await api.storage.local.get(["dockActiveGroup"]);
  return norm(state?.dockActiveGroup);
}

async function buildShareLink(groupId) {
  const state = await api.storage.local.get(["dockGroups", "dockGroupItems"]);
  const groups = Array.isArray(state?.dockGroups) ? state.dockGroups : [];
  const group = groups.find((entry) => norm(entry?.id) === groupId);
  const items = Array.isArray(state?.dockGroupItems?.[groupId]) ? state.dockGroupItems[groupId] : [];
  if (!group) throw new Error("Dock not found.");

  const tabs = items.filter((item) => isShareableUrl(item?.url)).map((item) => {
    const shot = preview(item);
    return {
      title: norm(item?.title) || normalizeUrl(item?.url),
      url: normalizeUrl(item?.url),
      reason: norm(item?.reason).slice(0, 500),
      faviconUrl: norm(item?.faviconUrl || item?.favIconUrl) || null,
      savedAt: Number(item?.savedAt || 0) || Date.now(),
      screenshot_url: shot || null,
      screenshotBlocked: !shot && !!item?.screenshotBlocked
    };
  });

  if (!tabs.length) throw new Error("This Dock has no regular website tabs to share.");
  const payload = {
    version: 1,
    type: "dock-workspace-share",
    workspace: {
      name: norm(group?.name) || "Dock",
      color: ensureColor(group?.color),
      exportedAt: Date.now(),
      tabs
    }
  };
  return `${SHARE_ORIGIN}#dock-share=${encode(payload)}`;
}

async function shareDock(button) {
  const groupId = await resolveShareGroup(button);
  if (!groupId || groupId.startsWith("__")) throw new Error("Open a personal Dock first, then click Share.");
  const link = await buildShareLink(groupId);

  try {
    await navigator.clipboard.writeText(link);
    alert(`Share link copied.\n\n${link}`);
  } catch {
    prompt("Copy and share this Dock link:", link);
  }
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
  if (!confirm("Delete all Docks on this page? Other Docks will stay intact.")) return;

  // Safari can reject a deletion if tombstones are written before screenshots
  // are removed because the temporary intermediate state is larger. Commit the
  // smaller memory state and tombstones atomically in one storage write.
  const tombstones = state?.[TOMBSTONE_KEY] && typeof state[TOMBSTONE_KEY] === "object"
    ? { ...state[TOMBSTONE_KEY] }
    : {};
  const now = Date.now();
  for (const item of all) {
    const url = normalizeUrl(item?.url);
    if (url) tombstones[url] = now;
  }

  await api.storage.local.set({
    savedTabs: [],
    savedTabsLite: [],
    [TOMBSTONE_KEY]: tombstones,
    dockSafariLastDeleteAll: { ok: true, count: all.length, at: now }
  });

  // Remote deletion is independent cleanup. Local success must not be rolled
  // back merely because remote sync is temporarily unavailable.
  deleteRemoteMemoriesByUrls(all, { userInitiated: true }).catch(() => {});
  window.location.reload();
}

clearAllBtn?.addEventListener("click", (event) => {
  event.preventDefault();
  event.stopImmediatePropagation();
  quotaSafeDeleteAll().catch((error) => alert(error?.message || "Delete All failed."));
}, true);

document.addEventListener("click", (event) => {
  const button = event.target?.closest?.("button");
  if (!button || !/^Share(?:\s|$|▾)/i.test(norm(button.textContent))) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  shareDock(button).catch((error) => alert(error?.message || "Share failed."));
}, true);
