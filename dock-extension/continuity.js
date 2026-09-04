import { api } from "./adapters/index.js";
import { ensureManagedBootstrap, getManagedSyncState, syncManagedWorkspace } from "./core/storage.js";

const POLL_BASE_MS = 5 * 60 * 1000;
const POLL_JITTER_MS = 30 * 1000;
const MIN_SYNC_GAP_MS = 45 * 1000;
const TRANSITION_HOLD_MS = 180;
const PREPAINT_MAX_MS = 1600;

let syncPromise = null;
let transitionTimer = null;
let pollTimer = null;
let readyObserver = null;
let readyTimer = null;

function captureVisualState() {
  try {
    const body = document.body;
    if (!body) return;
    const cs = getComputedStyle(body);
    const visual = {
      backgroundColor: cs.backgroundColor || "#183246",
      backgroundImage: cs.backgroundImage && cs.backgroundImage !== "none"
        ? cs.backgroundImage
        : "linear-gradient(180deg, #183246 0%, #274f62 100%)",
      backgroundSize: cs.backgroundSize || "cover",
      backgroundPosition: cs.backgroundPosition || "center center"
    };
    localStorage.setItem("dockContinuityVisual", JSON.stringify(visual));
    const root = document.documentElement;
    root.style.setProperty("--dock-continuity-bg-color", visual.backgroundColor);
    root.style.setProperty("--dock-continuity-bg-image", visual.backgroundImage);
    root.style.setProperty("--dock-continuity-bg-size", visual.backgroundSize);
    root.style.setProperty("--dock-continuity-bg-position", visual.backgroundPosition);
  } catch {}
}

function clearPrepaint() {
  if (readyObserver) {
    try { readyObserver.disconnect(); } catch {}
    readyObserver = null;
  }
  if (readyTimer) {
    clearTimeout(readyTimer);
    readyTimer = null;
  }
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      captureVisualState();
      document.documentElement.classList.remove("dock-prepaint-loading");
    });
  });
}

function hasRenderedState() {
  const grid = document.getElementById("grid");
  const empty = document.getElementById("emptyState");
  if (grid?.children?.length) return true;
  if (empty && !empty.classList.contains("hidden")) return true;
  return false;
}

function waitForRenderedState() {
  if (hasRenderedState()) {
    clearPrepaint();
    return;
  }

  const grid = document.getElementById("grid");
  const target = grid?.parentElement || document.body;
  if (target && typeof MutationObserver !== "undefined") {
    readyObserver = new MutationObserver(() => {
      if (hasRenderedState()) clearPrepaint();
    });
    readyObserver.observe(target, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
  }

  readyTimer = setTimeout(clearPrepaint, PREPAINT_MAX_MS);
}

function finishTransition(delay = TRANSITION_HOLD_MS) {
  if (transitionTimer) clearTimeout(transitionTimer);
  transitionTimer = setTimeout(() => {
    transitionTimer = null;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        captureVisualState();
        document.documentElement.classList.remove("dock-continuity-transition");
      });
    });
  }, delay);
}

function beginTransition() {
  captureVisualState();
  document.documentElement.classList.add("dock-continuity-transition");
  finishTransition();
}

function isMaterialSavedTabsChange(change) {
  const before = Array.isArray(change?.oldValue) ? change.oldValue.length : 0;
  const after = Array.isArray(change?.newValue) ? change.newValue.length : 0;
  return (before > 0 && after === 0) || Math.abs(after - before) > 1;
}

async function refreshManagedWorkspace(reason = "foreground") {
  if (syncPromise) return syncPromise;

  syncPromise = (async () => {
    try { await ensureManagedBootstrap(); } catch {}

    try {
      const state = await getManagedSyncState({ ttlMs: MIN_SYNC_GAP_MS });
      if (!state?.hasConfig) return { ok: true, skipped: true, reason: "NO_MANAGED_CONFIG" };
      if (state?.syncedAt && (Date.now() - state.syncedAt) < MIN_SYNC_GAP_MS) {
        return { ok: true, skipped: true, reason: "RECENT_SYNC" };
      }
      return await syncManagedWorkspace({ force: true, reason });
    } catch (error) {
      return { ok: false, reason: "CONTINUITY_SYNC_FAILED", error: String(error?.message || error || "") };
    }
  })();

  try {
    return await syncPromise;
  } finally {
    syncPromise = null;
  }
}

function nextPollDelay() {
  const jitter = Math.round((Math.random() * 2 - 1) * POLL_JITTER_MS);
  return Math.max(MIN_SYNC_GAP_MS, POLL_BASE_MS + jitter);
}

function scheduleForegroundPoll() {
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = setTimeout(async () => {
    pollTimer = null;
    if (document.visibilityState === "visible") {
      await refreshManagedWorkspace("poll").catch(() => {});
    }
    scheduleForegroundPoll();
  }, nextPollDelay());
}

if (api.storage?.onChanged?.addListener) {
  api.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;

    if (changes?.dockManagedWorkspace) {
      beginTransition();
      finishTransition(220);
      return;
    }

    if (changes?.savedTabs && isMaterialSavedTabsChange(changes.savedTabs)) {
      beginTransition();
      return;
    }
  });
}

if (api.runtime?.onMessage?.addListener) {
  api.runtime.onMessage.addListener((msg) => {
    if (msg?.type === "DOCK_MEMORIES_REFRESH") {
      beginTransition();
      finishTransition(260);
    }
  });
}

window.addEventListener("focus", () => {
  refreshManagedWorkspace("focus").catch(() => {});
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    refreshManagedWorkspace("visible").catch(() => {});
  }
});

document.addEventListener("DOMContentLoaded", () => {
  scheduleForegroundPoll();
  waitForRenderedState();
});

window.addEventListener("load", () => {
  refreshManagedWorkspace("load").catch(() => {});
});
