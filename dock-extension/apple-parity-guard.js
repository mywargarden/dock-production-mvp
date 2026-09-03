// Apple-only parity guard installed before shared Safe Harbor logic.
// It owns only the live Safari failure that remains browser-specific:
// quota-safe Delete All. Sharing, drag sorting, backgrounds, Open/Relax/Notes,
// and all ordinary Safe Harbor behavior stay in the shared Dock implementation.

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
  } catch {
    return "";
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

  // Safari can reject the shared delete sequence when screenshots already put
  // storage near quota: writing tombstones first makes the intermediate state
  // larger. Build tombstones in memory and atomically commit them together with
  // the smaller saved-memory state.
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

  // Remote cleanup is a separate support path. A temporary network failure must
  // not roll back a locally completed destructive action.
  deleteRemoteMemoriesByUrls(all, { userInitiated: true }).catch(() => {});
  window.location.reload();
}

clearAllBtn?.addEventListener("click", (event) => {
  event.preventDefault();
  event.stopImmediatePropagation();
  quotaSafeDeleteAll().catch((error) => alert(error?.message || "Delete All failed."));
}, true);
