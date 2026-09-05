import "./capture-hardening.js";
import "./background-v2.js";
import { migrateLegacyPreviewPayloads } from "./core/previewPayloadStore.js";

const api = (typeof browser !== "undefined" && browser?.runtime?.getURL) ? browser : chrome;

let previewMigrationPromise = null;
function ensurePreviewPayloadMigration() {
  if (previewMigrationPromise) return previewMigrationPromise;
  previewMigrationPromise = migrateLegacyPreviewPayloads(api.storage?.local)
    .catch(() => ({ ok: false }))
    .finally(() => { previewMigrationPromise = null; });
  return previewMigrationPromise;
}

ensurePreviewPayloadMigration().catch(() => {});
api.runtime?.onInstalled?.addListener(() => { ensurePreviewPayloadMigration().catch(() => {}); });
api.runtime?.onStartup?.addListener(() => { ensurePreviewPayloadMigration().catch(() => {}); });

api.tabs?.onZoomChange?.addListener?.(({ tabId, newZoomFactor }) => {
  if (!Number.isInteger(tabId)) return;
  try {
    const pending = api.tabs.sendMessage(tabId, {
      type: "DOCK_PAGE_ZOOM_CHANGED",
      zoom: Number.isFinite(newZoomFactor) && newZoomFactor > 0 ? newZoomFactor : 1
    });
    pending?.catch?.(() => {});
  } catch {}
});

const SIDECAR_TOKEN_PREFIX = "dockSidecarToken:";
const SIDECAR_TOKEN_TTL_MS = 10000;

function validSidecarToken(token) {
  return /^[a-f0-9]{32}$/i.test(String(token || ""));
}

async function registerSidecarToken(token, sender) {
  if (!validSidecarToken(token)) return { ok: false, code: "BAD_TOKEN" };
  const key = `${SIDECAR_TOKEN_PREFIX}${token}`;
  const payload = {
    tabId: Number.isInteger(sender?.tab?.id) ? sender.tab.id : null,
    expiresAt: Date.now() + SIDECAR_TOKEN_TTL_MS
  };
  try {
    if (api.storage?.session) await api.storage.session.set({ [key]: payload });
    else await api.storage.local.set({ [key]: payload });
    return { ok: true };
  } catch {
    return { ok: false, code: "TOKEN_STORE_FAILED" };
  }
}

async function validateSidecarToken(token, sender) {
  if (!validSidecarToken(token)) return { ok: false, code: "BAD_TOKEN" };
  const key = `${SIDECAR_TOKEN_PREFIX}${token}`;
  try {
    const store = api.storage?.session || api.storage?.local;
    const res = await store.get([key]);
    await store.remove([key]);
    const payload = res?.[key];
    if (!payload || Number(payload.expiresAt || 0) < Date.now()) return { ok: false, code: "TOKEN_EXPIRED" };
    const senderTabId = Number.isInteger(sender?.tab?.id) ? sender.tab.id : null;
    if (payload.tabId !== null && senderTabId !== payload.tabId) return { ok: false, code: "TAB_MISMATCH" };
    return { ok: true };
  } catch {
    return { ok: false, code: "TOKEN_VALIDATE_FAILED" };
  }
}

let popupOpenInFlight = null;
let lastPopupOpenAt = 0;
const POPUP_OPEN_GUARD_MS = 850;
const POPUP_TRANSITION_SILENCE_MS = 8000;

async function openDockPopupOnce(sender) {
  if (popupOpenInFlight) return popupOpenInFlight;
  if (Date.now() - lastPopupOpenAt < POPUP_OPEN_GUARD_MS) {
    return { ok: true, coalesced: true };
  }

  popupOpenInFlight = (async () => {
    if (!api.action?.openPopup) return { ok: false, code: "POPUP_API_UNAVAILABLE" };
    try {
      const windowId = sender?.tab?.windowId;
      if (Number.isInteger(windowId)) await api.action.openPopup({ windowId });
      else await api.action.openPopup();
      lastPopupOpenAt = Date.now();
      return { ok: true };
    } catch (error) {
      if (Date.now() - lastPopupOpenAt < POPUP_TRANSITION_SILENCE_MS) {
        return { ok: true, coalesced: true };
      }
      return {
        ok: false,
        code: "POPUP_OPEN_FAILED",
        error: String(error?.message || error || "")
      };
    } finally {
      popupOpenInFlight = null;
    }
  })();

  return popupOpenInFlight;
}

function isAllowedLauncherSender(sender) {
  const tabUrl = String(sender?.tab?.url || "");
  const documentUrl = String(sender?.url || "");
  const memoriesUrl = api.runtime.getURL("memories.html");
  const newTabUrl = api.runtime.getURL("newtab.html");

  if (/^https?:\/\//i.test(tabUrl) || /^https?:\/\//i.test(documentUrl)) return true;
  if (documentUrl === memoriesUrl || documentUrl === newTabUrl) return true;
  if (tabUrl === memoriesUrl || tabUrl === newTabUrl) return true;
  return false;
}

api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "REGISTER_DOCK_SIDECAR_TOKEN") {
    registerSidecarToken(msg?.token, sender).then(sendResponse).catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (msg?.type === "VALIDATE_DOCK_SIDECAR_TOKEN") {
    validateSidecarToken(msg?.token, sender).then(sendResponse).catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (msg?.type === "MIGRATE_DOCK_PREVIEW_PAYLOADS") {
    ensurePreviewPayloadMigration()
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: String(error?.message || error || "") }));
    return true;
  }
  if (msg?.type === "GET_DOCK_PAGE_ZOOM") {
    const tabId = sender?.tab?.id;
    if (!Number.isInteger(tabId)) {
      sendResponse({ ok: true, zoom: 1 });
      return;
    }
    api.tabs.getZoom(tabId)
      .then((zoom) => sendResponse({ ok: true, zoom: Number.isFinite(zoom) && zoom > 0 ? zoom : 1 }))
      .catch(() => sendResponse({ ok: true, zoom: 1 }));
    return true;
  }

  if (msg?.type !== "OPEN_DOCK_POPUP") return;

  (async () => {
    try {
      if (!isAllowedLauncherSender(sender)) {
        sendResponse({ ok: false, code: "LAUNCHER_SENDER_NOT_ALLOWED" });
        return;
      }
      sendResponse(await openDockPopupOnce(sender));
    } catch (error) {
      sendResponse({
        ok: false,
        code: "POPUP_OPEN_FAILED",
        error: String(error?.message || error || "")
      });
    }
  })();

  return true;
});