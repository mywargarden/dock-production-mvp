const POSITION_KEY = "dockLauncherPosition";
const THEME_KEY = "dockTheme";
const THEME_MIRROR_KEY = "dockThemeCurrent";
const DEFAULT_THEME = "dock-green";
const THEMES = new Set(["dock-green","skipper-harbor","smiley-pop","warm","sunset","tie-dye","rubber-ducky","crazy-ducky","violet-harbor"]);
const THEME_SCENE_ASSETS = {
  "dock-green": "assets/dock-default-theme-20260901.png",
  "sunset": "assets/dock-sunset-hd.png",
  "tie-dye": "assets/tie-dye-bg.webp",
  "rubber-ducky": "assets/rubber-ducky-theme.webp",
  "crazy-ducky": "assets/cozy-quilt.webp",
  "skipper-harbor": "assets/skipper-harbor-hd.png",
  "violet-harbor": "assets/grape-tide.webp",
  "smiley-pop": "assets/smileys-3d.webp",
  "warm": "assets/sand-castle-theme.webp"
};
const DRAG_THRESHOLD = 5;
const EDGE_GAP = 12;

const launcher = document.getElementById("dockLauncher");
const searchForm = document.getElementById("searchForm");
const searchInput = document.getElementById("searchInput");

let dragState = null;
let suppressClick = false;
let popupOpenPromise = null;
let lastPopupOpenSuccessAt = 0;
let popupLikelyOpen = false;
let popupClosedAt = 0;
const POPUP_REOPEN_GUARD_MS = 900;
const POPUP_TRANSITION_SILENCE_MS = 8000;
const POPUP_CLOSE_CLICK_GUARD_MS = 280;

function normalizeTheme(theme) {
  const value = String(theme || "").trim();
  return THEMES.has(value) ? value : DEFAULT_THEME;
}

function mirrorTheme(theme) {
  const next = normalizeTheme(theme);
  try { localStorage.setItem(THEME_MIRROR_KEY, next); } catch {}
  return next;
}

function mirroredTheme() {
  try { return normalizeTheme(localStorage.getItem(THEME_MIRROR_KEY)); }
  catch { return DEFAULT_THEME; }
}

function applyTheme(theme) {
  const next = mirrorTheme(theme);
  document.body.dataset.theme = next;
  const sceneAsset = THEME_SCENE_ASSETS[next];
  document.documentElement.style.setProperty("--dock-theme-scene", sceneAsset ? `url("${sceneAsset}")` : "none");
  return next;
}

async function loadTheme() {
  applyTheme(mirroredTheme());
  try {
    const stored = await chrome.storage.local.get([THEME_KEY]);
    applyTheme(stored?.[THEME_KEY] || DEFAULT_THEME);
  } catch {
    applyTheme(mirroredTheme());
  }
}

chrome.storage?.onChanged?.addListener((changes, areaName) => {
  if (areaName !== "local" || !changes?.[THEME_KEY]) return;
  applyTheme(changes[THEME_KEY].newValue || DEFAULT_THEME);
});

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function viewportBounds() {
  const rect = launcher.getBoundingClientRect();
  return {
    maxLeft: Math.max(EDGE_GAP, window.innerWidth - rect.width - EDGE_GAP),
    maxTop: Math.max(EDGE_GAP, window.innerHeight - rect.height - EDGE_GAP)
  };
}

function applyPosition(position) {
  if (!launcher || !position || !Number.isFinite(position.left) || !Number.isFinite(position.top)) return;
  const bounds = viewportBounds();
  launcher.style.left = `${clamp(position.left, EDGE_GAP, bounds.maxLeft)}px`;
  launcher.style.top = `${clamp(position.top, EDGE_GAP, bounds.maxTop)}px`;
  launcher.style.right = "auto";
  launcher.style.bottom = "auto";
}

async function loadPosition() {
  try {
    const stored = await chrome.storage.local.get([POSITION_KEY]);
    applyPosition(stored?.[POSITION_KEY]);
  } catch {}
}

async function savePosition() {
  if (!launcher) return;
  const rect = launcher.getBoundingClientRect();
  try {
    await chrome.storage.local.set({
      [POSITION_KEY]: { left: Math.round(rect.left), top: Math.round(rect.top) }
    });
  } catch {}
}

async function openDockPopupNative() {
  if (!launcher) return;
  if (Date.now() - popupClosedAt < POPUP_CLOSE_CLICK_GUARD_MS) return;
  if (popupOpenPromise) return popupOpenPromise;
  if (Date.now() - lastPopupOpenSuccessAt < POPUP_REOPEN_GUARD_MS) return;

  launcher.classList.add("isOpening");
  popupOpenPromise = (async () => {
    try {
      const result = await chrome.runtime.sendMessage({ type: "OPEN_DOCK_POPUP" });
      if (!result?.ok) throw new Error(result?.code || "POPUP_OPEN_FAILED");
      lastPopupOpenSuccessAt = Date.now();
      popupLikelyOpen = true;
    } catch {
      if (Date.now() - lastPopupOpenSuccessAt >= POPUP_TRANSITION_SILENCE_MS) return;
    } finally {
      launcher.classList.remove("isOpening");
      popupOpenPromise = null;
    }
  })();

  return popupOpenPromise;
}

function beginDrag(event) {
  if (!launcher || event.button !== 0) return;
  const rect = launcher.getBoundingClientRect();
  dragState = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    startLeft: rect.left,
    startTop: rect.top,
    moved: false
  };
  launcher.setPointerCapture?.(event.pointerId);
}

function moveDrag(event) {
  if (!launcher || !dragState || event.pointerId !== dragState.pointerId) return;
  const dx = event.clientX - dragState.startX;
  const dy = event.clientY - dragState.startY;
  if (!dragState.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;

  dragState.moved = true;
  suppressClick = true;
  launcher.classList.add("isDragging");

  const bounds = viewportBounds();
  launcher.style.left = `${clamp(dragState.startLeft + dx, EDGE_GAP, bounds.maxLeft)}px`;
  launcher.style.top = `${clamp(dragState.startTop + dy, EDGE_GAP, bounds.maxTop)}px`;
  launcher.style.right = "auto";
  launcher.style.bottom = "auto";
  dockSidecar?.reposition?.();
}

async function endDrag(event) {
  if (!launcher || !dragState || event.pointerId !== dragState.pointerId) return;
  const moved = dragState.moved;
  try { launcher.releasePointerCapture?.(event.pointerId); } catch {}
  launcher.classList.remove("isDragging");
  dragState = null;
  if (moved) {
    await savePosition();
    setTimeout(() => { suppressClick = false; }, 0);
  }
}

function resolveNavigation(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) return raw;
  if (/^(localhost|\d{1,3}(?:\.\d{1,3}){3})(:\d+)?(?:\/|$)/i.test(raw)) return `http://${raw}`;
  if (/^[^\s]+\.[^\s]+(?:\/.*)?$/i.test(raw)) return `https://${raw}`;
  return `https://www.google.com/search?q=${encodeURIComponent(raw)}`;
}

const dockSidecar = globalThis.DockSidecar?.create({
  launcher,
  onFallback: () => { openDockPopupNative().catch(() => {}); }
});

launcher?.addEventListener("pointerdown", beginDrag);
launcher?.addEventListener("pointermove", moveDrag);
launcher?.addEventListener("pointerup", endDrag);
launcher?.addEventListener("pointercancel", endDrag);
launcher?.addEventListener("click", (event) => {
  if (suppressClick) {
    event.preventDefault();
    return;
  }
  dockSidecar?.toggle();
});
launcher?.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    dockSidecar?.toggle();
  }
});

const safeHarborQuick = document.getElementById("safeHarborQuick");
const lastDockQuick = document.getElementById("lastDockQuick");
const relaxQuick = document.getElementById("relaxQuick");

async function focusOrReuseSafeHarbor() {
  const safeHarborUrl = chrome.runtime.getURL("memories.html");
  const dockNewTabUrl = chrome.runtime.getURL("newtab.html");
  try {
    const [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const allTabs = await chrome.tabs.query({});
    const sameWindowHarbors = (allTabs || []).filter((tab) =>
      tab?.windowId === currentTab?.windowId &&
      typeof tab?.url === "string" &&
      tab.url.startsWith(safeHarborUrl)
    );

    if (sameWindowHarbors.length) {
      const primary = sameWindowHarbors
        .slice()
        .sort((a, b) => (a.index ?? 9999) - (b.index ?? 9999))[0];

      if (primary?.id != null) await chrome.tabs.update(primary.id, { active: true }).catch(() => null);
      if (primary?.windowId != null) await chrome.windows.update(primary.windowId, { focused: true }).catch(() => null);

      const duplicateIds = sameWindowHarbors
        .filter((tab) => tab?.id != null && tab.id !== primary?.id)
        .map((tab) => tab.id);
      const currentIsDockNewTab = typeof currentTab?.url === "string" && currentTab.url.startsWith(dockNewTabUrl);
      if (currentIsDockNewTab && currentTab?.id != null && currentTab.id !== primary?.id) duplicateIds.push(currentTab.id);
      if (duplicateIds.length) {
        await chrome.tabs.remove([...new Set(duplicateIds)]).catch(() => null);
      }
      return primary || null;
    }

    if (currentTab?.id != null) {
      return await chrome.tabs.update(currentTab.id, { url: safeHarborUrl, active: true });
    }
  } catch {}

  window.location.replace(safeHarborUrl);
  return null;
}

function openSafeHarborHere() {
  return focusOrReuseSafeHarbor();
}

async function openLastDockHere() {
  try {
    const stored = await chrome.storage.local.get(["dockLastVisitedGroup", "dockActiveGroup", "dockGroups"]);
    const groups = Array.isArray(stored?.dockGroups) ? stored.dockGroups : [];
    const validIds = new Set(groups.map((group) => String(group?.id || "")).filter(Boolean));
    let target = String(stored?.dockLastVisitedGroup || "").trim();
    if (!validIds.has(target)) target = String(stored?.dockActiveGroup || "").trim();
    if (!validIds.has(target)) {
      target = groups.slice().sort((a, b) => Number(b?.createdAt || 0) - Number(a?.createdAt || 0))[0]?.id || "";
    }
    if (target) await chrome.storage.local.set({ dockActiveGroup: target, dockLastVisitedGroup: target });
  } catch {}
  await focusOrReuseSafeHarbor();
}

async function relaxFromNewTab() {
  if (!relaxQuick || relaxQuick.disabled) return;
  relaxQuick.disabled = true;
  const original = relaxQuick.textContent;
  relaxQuick.textContent = "Relaxing…";
  try {
    const result = await chrome.runtime.sendMessage({ type: "CLOSE_ALL_OTHER_TABS", announceResult: true });
    if (!result?.ok) throw new Error(result?.error || "Relax failed");
  } catch {
    relaxQuick.disabled = false;
    relaxQuick.textContent = original;
  }
}

safeHarborQuick?.addEventListener("click", openSafeHarborHere);
lastDockQuick?.addEventListener("click", () => { openLastDockHere().catch(openSafeHarborHere); });
relaxQuick?.addEventListener("click", () => { relaxFromNewTab().catch(() => {}); });

searchForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  const target = resolveNavigation(searchInput?.value);
  if (target) window.location.href = target;
});

window.addEventListener("blur", () => {
  if (Date.now() - lastPopupOpenSuccessAt < 1800) popupLikelyOpen = true;
});
window.addEventListener("focus", () => {
  if (popupLikelyOpen) {
    popupClosedAt = Date.now();
    popupLikelyOpen = false;
    lastPopupOpenSuccessAt = 0;
  }
});

window.addEventListener("resize", () => {
  if (!launcher) return;
  const rect = launcher.getBoundingClientRect();
  applyPosition({ left: rect.left, top: rect.top });
  dockSidecar?.reposition?.();
});

applyTheme(mirroredTheme());
await Promise.all([loadTheme(), loadPosition()]);
searchInput?.focus();
