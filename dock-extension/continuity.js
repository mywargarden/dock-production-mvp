import { api } from "./adapters/index.js";
import { ensureManagedBootstrap, syncManagedWorkspace } from "./core/storage.js";

const POLL_MS = 5 * 60 * 1000;
const MIN_SYNC_GAP_MS = 45 * 1000;
const TRANSITION_HOLD_MS = 180;
const PREPAINT_MAX_MS = 1600;

let lastSyncAttemptAt = 0;
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
  const empty = document.getElementById("emptyState");
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

async function refreshManagedWorkspace(reason = "foreground", { force = true } = {}) {
  if (syncPromise) return syncPromise;
  const now = Date.now();
  if (now - lastSyncAttemptAt < MIN_SYNC_GAP_MS) return { ok: true, skipped: true, reason: "THROTTLED" };
  lastSyncAttemptAt = now;

  syncPromise = (async () => {
    try { await ensureManagedBootstrap(); } catch {}
    try {
      return await syncManagedWorkspace({ force });
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

function scheduleForegroundPoll() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(() => {
    if (document.visibilityState !== "visible") return;
    refreshManagedWorkspace("poll", { force: true }).catch(() => {});
  }, POLL_MS);
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
  refreshManagedWorkspace("focus", { force: true }).catch(() => {});
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    refreshManagedWorkspace("visible", { force: true }).catch(() => {});
  }
});

document.addEventListener("DOMContentLoaded", () => {
  scheduleForegroundPoll();
  waitForRenderedState();
});

window.addEventListener("load", () => {
  refreshManagedWorkspace("load", { force: true }).catch(() => {});
});
