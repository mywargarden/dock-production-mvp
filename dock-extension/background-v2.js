import { api } from "./adapters/index.js";
import {
  assertCanSavePersonalMemory,
  ensureManagedBootstrap,
  getSavedTabs,
  loadGroupState,
  normalizeUrl,
  saveGroupState,
  setSavedTabs,
  syncManagedWorkspace
} from "./core/storage.js";
import { ensureDockMutationAllowed } from "./core/license.js";
import { isInternalUrl } from "./core/logic.js";

const DEBUG = false;
const MANAGED_SYNC_ALARM = "dockManagedSync";
const MANAGED_SYNC_PERIOD_MINUTES = 180;
const MIN_CAPTURE_INTERVAL_MS = 525;

let lastVisibleCaptureAt = 0;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function norm(value) {
  return String(value || "").trim();
}

function isDockInternalPath(pathname = "") {
  const path = String(pathname || "/").toLowerCase();
  return (
    path === "/" ||
    path === "/admin" ||
    path.startsWith("/admin/") ||
    path === "/api/bootstrap" ||
    /^\/api\/(?:org\/[^/]+\/workspace|workspace|user\/memories)\/?$/i.test(path)
  );
}

function isLogoutLikePath(pathname = "") {
  const path = String(pathname || "/").toLowerCase();
  return /(^|\/)(log(?:out|off)|sign(?:out|off))(\/|$)/i.test(path);
}

function shouldExcludeMemoryUrl(value) {
  const raw = norm(value?.url || value?.local_id || value);
  if (!raw) return true;
  if (isInternalUrl(raw)) return true;
  if (/^(blob|data|devtools|file):/i.test(raw)) return true;
  if (/^https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d+)?(?:\/|$)/i.test(raw)) return true;

  try {
    const parsed = new URL(raw);
    const host = parsed.hostname.toLowerCase();
    if (host === "dock-production-mvp.vercel.app" && isDockInternalPath(parsed.pathname || "/")) return true;
    if (isLogoutLikePath(parsed.pathname || "/")) return true;
  } catch {
    return true;
  }
  return false;
}

function hasDuplicateUrl(payload, items = []) {
  const target = normalizeUrl(payload?.url || "");
  if (!target) return false;
  return (Array.isArray(items) ? items : []).some((item) => normalizeUrl(item?.url || "") === target);
}

async function dataUrlFromBlob(blob) {
  if (!blob) return null;
  if (typeof FileReader !== "undefined") {
    return new Promise((resolve) => {
      try {
        const reader = new FileReader();
        reader.onloadend = () => resolve(typeof reader.result === "string" ? reader.result : null);
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(blob);
      } catch {
        resolve(null);
      }
    });
  }

  try {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return `data:${blob.type || "image/jpeg"};base64,${btoa(binary)}`;
  } catch {
    return null;
  }
}

async function compressScreenshotDataUrl(dataUrl) {
  try {
    if (!dataUrl || typeof OffscreenCanvas === "undefined" || typeof createImageBitmap === "undefined") return dataUrl;
    const response = await fetch(dataUrl);
    const sourceBlob = await response.blob();
    const bitmap = await createImageBitmap(sourceBlob);
    const maxWidth = 640;
    const maxHeight = 420;
    const scale = Math.min(1, maxWidth / bitmap.width, maxHeight / bitmap.height);
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return dataUrl;
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();
    const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.42 });
    return await dataUrlFromBlob(blob) || dataUrl;
  } catch {
    return dataUrl;
  }
}

async function waitForCaptureBudget() {
  const waitMs = Math.max(0, MIN_CAPTURE_INTERVAL_MS - (Date.now() - lastVisibleCaptureAt));
  if (waitMs) await sleep(waitMs);
  lastVisibleCaptureAt = Date.now();
}

async function setLauncherCaptureHidden(tabId, hidden) {
  if (tabId == null) return false;
  try {
    await api.tabs.sendMessage?.(tabId, {
      type: "SET_DOCK_LAUNCHER_CAPTURE_HIDDEN",
      hidden: !!hidden
    });
    if (hidden) await sleep(34);
    return true;
  } catch {
    return false;
  }
}

async function captureVisible(windowId) {
  await waitForCaptureBudget();
  try {
    const shot = await api.tabs.captureVisibleTab(windowId, { format: "jpeg", quality: 55 });
    return await compressScreenshotDataUrl(shot);
  } catch {
    return null;
  }
}

async function captureVisibleWithRetries(windowId, strong = false, tabId = null) {
  const delays = strong ? [0, 575, 825] : [0, 575];
  await setLauncherCaptureHidden(tabId, true);
  try {
    for (const delay of delays) {
      if (delay) await sleep(delay);
      const shot = await captureVisible(windowId);
      if (shot) return shot;
    }
    return null;
  } finally {
    await setLauncherCaptureHidden(tabId, false);
  }
}

function waitForActivation(tabId, timeoutMs = 240) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { api.tabs.onActivated.removeListener(onActivated); } catch {}
      resolve(value);
    };
    const onActivated = (activeInfo) => {
      if (activeInfo?.tabId === tabId) finish(true);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    api.tabs.onActivated.addListener(onActivated);
  });
}

async function activateTabReliable(tabId) {
  try { await api.tabs.update(tabId, { active: true }); } catch {}
  await waitForActivation(tabId);
  await sleep(12);
}

function orderTabsFromActive(tabs, activeTabId) {
  const sorted = [...(Array.isArray(tabs) ? tabs : [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  const start = sorted.findIndex((tab) => tab.id === activeTabId);
  return start > 0 ? [...sorted.slice(start), ...sorted.slice(0, start)] : sorted;
}

async function findMemoriesTabs() {
  const url = api.runtime.getURL("memories.html");
  const tabs = await api.tabs.query({});
  return (Array.isArray(tabs) ? tabs : []).filter((tab) => typeof tab?.url === "string" && tab.url.startsWith(url));
}

async function openOrRefreshMemoriesTab() {
  const memoriesUrl = api.runtime.getURL("memories.html");
  const matches = (await findMemoriesTabs()).sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  let primary = matches[0] || null;

  if (matches.length) {
    const currentWindow = await api.windows.getCurrent({ populate: false }).catch(() => null);
    primary = (currentWindow?.id != null && matches.find((tab) => tab.windowId === currentWindow.id)) || primary;
    const duplicates = matches.filter((tab) => tab?.id != null && tab.id !== primary?.id).map((tab) => tab.id);
    if (duplicates.length) {
      try { await api.tabs.remove(duplicates); } catch {}
    }
  }

  if (primary?.id != null) {
    try { await api.tabs.move(primary.id, { index: 0 }); } catch {}
    try { await api.windows.update(primary.windowId, { focused: true }); } catch {}
    try { await api.tabs.update(primary.id, { active: true }); } catch {}
    try { await api.tabs.sendMessage?.(primary.id, { type: "DOCK_MEMORIES_REFRESH" }); } catch {}
    return primary;
  }

  try { return await api.tabs.create({ url: memoriesUrl, active: true, index: 0 }); }
  catch { return null; }
}

async function closeAllOtherTabs() {
  const keepTab = await openOrRefreshMemoriesTab();
  if (keepTab?.id == null) return { ok: false, error: "DOCK_TAB_NOT_FOUND" };
  const tabs = await api.tabs.query({});
  const toClose = (Array.isArray(tabs) ? tabs : []).filter((tab) => tab?.id != null && tab.id !== keepTab.id).map((tab) => tab.id);
  if (toClose.length) {
    try { await api.tabs.remove(toClose); } catch {
      const failed = [];
      for (const id of toClose) {
        try { await api.tabs.remove(id); } catch { failed.push(id); }
      }
      if (failed.length) return { ok: false, error: `FAILED_TO_CLOSE_${failed.length}_TABS`, closedCount: toClose.length - failed.length };
    }
  }
  try { await api.windows.update(keepTab.windowId, { focused: true }); } catch {}
  try { await api.tabs.update(keepTab.id, { active: true }); } catch {}
  return { ok: true, closedCount: toClose.length, keptTabId: keepTab.id };
}

async function assertMutationAndCapacity() {
  await ensureDockMutationAllowed();
  await assertCanSavePersonalMemory();
}

async function saveAllOpenTabs({ reason = "", openMemories = false, targetGroupId = "", skipDuplicates = true } = {}) {
  await assertMutationAndCapacity();

  const win = await api.windows.getCurrent({ populate: false });
  const windowId = win?.id;
  if (windowId == null) throw new Error("WINDOW_NOT_FOUND");
  try { await api.windows.update(windowId, { focused: true }); } catch {}

  const [activeTab] = await api.tabs.query({ active: true, currentWindow: true });
  const activeTabId = activeTab?.id;
  const ordered = orderTabsFromActive(await api.tabs.query({ currentWindow: true }), activeTabId);
  const savedTabs = await getSavedTabs({ localOnly: true });
  const groupState = await loadGroupState();
  let targetItems = targetGroupId && Array.isArray(groupState.groupItems?.[targetGroupId])
    ? [...groupState.groupItems[targetGroupId]]
    : [];

  let saved = 0;
  let attempted = 0;
  let duplicatesSkipped = 0;
  const savedAt = Date.now();

  let startingShot = null;
  let startingBlocked = false;
  if (activeTabId && !shouldExcludeMemoryUrl(activeTab)) {
    startingShot = await captureVisibleWithRetries(windowId, true, activeTabId);
    startingBlocked = !startingShot;
  }

  for (let index = 0; index < ordered.length; index += 1) {
    const tab = ordered[index];
    attempted += 1;
    try { await api.runtime.sendMessage({ type: "BULK_PROGRESS", current: index + 1, total: ordered.length }); } catch {}
    if (shouldExcludeMemoryUrl(tab)) continue;

    let shot = null;
    let blocked = false;
    if (tab.id === activeTabId) {
      shot = startingShot;
      blocked = startingBlocked;
      if (!shot) {
        shot = await captureVisibleWithRetries(windowId, true, tab.id);
        blocked = !shot;
      }
    } else {
      await activateTabReliable(tab.id);
      shot = await captureVisibleWithRetries(windowId, false, tab.id);
      if (!shot) shot = await captureVisibleWithRetries(windowId, true, tab.id);
      blocked = !shot;
    }

    const payload = {
      title: tab.title,
      url: tab.url,
      reason: norm(reason),
      savedAt,
      screenshotThumb: shot || "",
      screenshotBlocked: blocked,
      faviconUrl: tab.favIconUrl || null
    };

    const destination = targetGroupId ? targetItems : savedTabs;
    if (skipDuplicates && hasDuplicateUrl(payload, destination)) {
      duplicatesSkipped += 1;
      continue;
    }
    destination.push(payload);
    saved += 1;
  }

  if (targetGroupId) {
    groupState.groupItems[targetGroupId] = targetItems;
    await saveGroupState(groupState);
  } else {
    await setSavedTabs(savedTabs);
  }

  if (openMemories) await openOrRefreshMemoriesTab();
  else if (activeTabId != null) {
    try { await api.tabs.update(activeTabId, { active: true }); } catch {}
  }

  try { await api.runtime.sendMessage({ type: "BULK_DONE", saved, attempted, duplicatesSkipped }); } catch {}
  return { saved, attempted, duplicatesSkipped };
}

async function saveTabToWorkspace(payload, targetGroupId, skipDuplicates = true) {
  await assertMutationAndCapacity();
  if (!targetGroupId || !payload) return { ok: false, code: "INVALID_SAVE_TARGET" };
  if (shouldExcludeMemoryUrl(payload)) return { ok: true, skippedExcluded: true };

  const state = await loadGroupState();
  const current = Array.isArray(state.groupItems?.[targetGroupId]) ? [...state.groupItems[targetGroupId]] : [];
  if (skipDuplicates && hasDuplicateUrl(payload, current)) return { ok: true, skippedDuplicate: true };
  current.push(payload);
  state.groupItems[targetGroupId] = current;
  await saveGroupState(state);
  return { ok: true, skippedDuplicate: false };
}

async function syncManagedFromCanonicalCore({ force = false } = {}) {
  try { await ensureManagedBootstrap(); } catch {}
  return syncManagedWorkspace({ force });
}

async function ensureManagedSyncAlarm() {
  if (!api.alarms?.get || !api.alarms?.create) return;
  const existing = await api.alarms.get(MANAGED_SYNC_ALARM).catch(() => null);
  if (existing) return;
  api.alarms.create(MANAGED_SYNC_ALARM, { periodInMinutes: MANAGED_SYNC_PERIOD_MINUTES });
}

api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "SAVE_ALL_OPEN_TABS") {
    (async () => {
      try {
        const result = await saveAllOpenTabs({
          reason: msg.reason || "",
          openMemories: !!msg.openMemories,
          targetGroupId: msg.targetGroupId || "",
          skipDuplicates: msg.skipDuplicates !== false
        });
        sendResponse({ ok: true, ...result });
      } catch (error) {
        const code = error === "LIMIT_REACHED" ? "LIMIT_REACHED" : (error?.code || "SAVE_ALL_FAILED");
        sendResponse({ ok: false, code, error: error?.message || String(error) });
      }
    })();
    return true;
  }

  if (msg?.type === "SAVE_TAB_TO_WORKSPACE") {
    (async () => {
      try {
        sendResponse(await saveTabToWorkspace(msg.payload, msg.targetGroupId, msg.skipDuplicates !== false));
      } catch (error) {
        const code = error === "LIMIT_REACHED" ? "LIMIT_REACHED" : (error?.code || "SAVE_FAILED");
        sendResponse({ ok: false, code, error: error?.message || String(error) });
      }
    })();
    return true;
  }

  if (msg?.type === "SYNC_MANAGED_WORKSPACE") {
    (async () => {
      try {
        const result = await syncManagedFromCanonicalCore({ force: true });
        sendResponse(result?.ok ? { ok: true, ...result } : { ok: false, ...(result || {}) });
      } catch (error) {
        sendResponse({ ok: false, reason: "SYNC_FAILED", error: error?.message || String(error) });
      }
    })();
    return true;
  }

  if (msg?.type === "CLOSE_ALL_OTHER_TABS") {
    (async () => sendResponse(await closeAllOtherTabs()))();
    return true;
  }
});

api.runtime.onInstalled?.addListener(() => {
  ensureManagedSyncAlarm().catch(() => {});
  syncManagedFromCanonicalCore({ force: true }).catch(() => {});
});

api.runtime.onStartup?.addListener(() => {
  ensureManagedSyncAlarm().catch(() => {});
  ensureManagedBootstrap().catch(() => {});
});

api.alarms?.onAlarm?.addListener((alarm) => {
  if (alarm?.name === MANAGED_SYNC_ALARM) syncManagedFromCanonicalCore({ force: false }).catch(() => {});
});

ensureManagedSyncAlarm().catch(() => {});

DEBUG && console.log("Dock canonical background worker loaded");
