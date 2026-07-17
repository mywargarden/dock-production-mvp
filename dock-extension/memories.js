import { getSavedTabs, deleteTab, setSavedTabs, loadGroupState, saveGroupState, getAdminWorkspace, ensureManagedBootstrap, syncManagedWorkspace, recoverSavedTabsFromRemote } from "./core/storage.js";
import { api } from "./adapters/index.js";
import { ensureSignedInInteractive, getAuthSummary, signOut } from "./core/auth.js";
import { ensureActiveGroup } from "./core/groupEngine.js";
import { getCachedImage, getPreviewIdentity, retainCachedImage, releaseCachedImage } from "./core/imageCache.js";

const DEBUG = false;
const headerEl = document.querySelector(".header");
const groupBarEl = document.getElementById("groupBar");
const groupPills = document.getElementById("groupPills");
const grid = document.getElementById("grid");
const emptyState = document.getElementById("emptyState");
const refreshBtn = document.getElementById("refreshBtn");
const openAllBtn = document.getElementById("openAllBtn");
const openSelectedBtn = document.getElementById("openSelectedBtn");
const clearAllBtn = document.getElementById("clearAllBtn");
const deleteSelectedBtn = document.getElementById("deleteSelectedBtn");
const closeOtherTabsBtn = document.getElementById("closeOtherTabsBtn");
const shareMenu = document.getElementById("shareMenu");
const createShareLinkBtn = document.getElementById("createShareLinkBtn");
const actionsMenuBtn = document.getElementById("actionsMenuBtn");
const actionsMenu = document.getElementById("actionsMenu");
const openMenuToggle = document.getElementById("openMenuToggle");
const deleteMenuToggle = document.getElementById("deleteMenuToggle");
const openSubmenu = document.getElementById("openSubmenu");
const deleteSubmenu = document.getElementById("deleteSubmenu");
const themeMenuBtn = document.getElementById("themeMenuBtn");
const themeMenu = document.getElementById("themeMenu");
const themeItems = [...document.querySelectorAll(".themeItem")];
const densityToggleBtn = document.getElementById("densityToggleBtn");
const createGroupBtn = document.getElementById("createGroupBtn");
const addBtn = document.getElementById("addBtn");
const editGroupBtn = document.getElementById("editGroupBtn");
const authBtn = document.getElementById("authBtn");
const calmToast = document.getElementById("calmToast");
try { dockTagActionMenuUi(); } catch {}

const THEME_KEY = "dockTheme";
const DENSITY_KEY = "dockDensity";
const DEFAULT_THEME = "dock-green";
const DEFAULT_DENSITY = "full";
const DEFAULT_GROUP_COLOR = "#8fd8c6";
const THEMES = new Set(["dock-green","skipper-harbor","slate","warm","sunset","tie-dye","rubber-ducky","crazy-ducky","violet-harbor"]);
const THEME_SCENE_ASSETS = {
  "sunset": "assets/dock-sunset.webp",
  "tie-dye": "assets/tie-dye-bg.webp",
  "rubber-ducky": "assets/rubber-ducky-theme.webp",
  "crazy-ducky": "assets/crazy-ducky-theme.webp",
  "skipper-harbor": "assets/skipper-harbor.webp"
};

let activeGroup = "__all__";
let groups = [];
let groupItems = {};
let savedTabs = [];
let visible = [];
let selectedMain = new Set();
let selectedVisible = new Set();
let adminWorkspace = null;
let dragGroupId = null;
let dragDropMode = "before";
let dragTargetGroupId = null;
let pointerSortState = null;
let cardInstanceCounter = 0;

const FIRST_PAINT_BATCH = 8;
const CHUNK_BATCH = 8;
function nextFrame(){ return new Promise(resolve => requestAnimationFrame(() => resolve())); }
function idlePause(ms = 0){ return new Promise(resolve => setTimeout(resolve, ms)); }

async function refreshAuthUi(){
  if (!authBtn) return;
  const auth = await getAuthSummary();
  authBtn.textContent = auth.signedIn ? "Signed in" : "Sign in";
  authBtn.title = auth.signedIn ? `Signed in${auth.userEmail ? ` as ${auth.userEmail}` : ""}. Click to sign out.` : "Sign in with Google";
}

async function requirePersonalSignIn(){
  const auth = await getAuthSummary();
  if (auth.signedIn) return true;
  try {
    await ensureSignedInInteractive();
    await recoverSavedTabsFromRemote();
    await refreshAuthUi();
    return true;
  } catch (error) {
    alert(error?.message || "Sign in with Google to manage personal Dock memories.");
    return false;
  }
}


function norm(s){ return String(s || "").trim(); }
function escapeHtml(s){ return String(s || "").replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function itemKey(tab){ return `${tab.__kind}:${tab.__index}:${tab.url || ''}:${tab.title || ''}`; }
function isSelectedVisible(tab){ return selectedVisible.has(itemKey(tab)); }
function toggleVisibleSelection(tab, checked){ const key = itemKey(tab); if (checked) selectedVisible.add(key); else selectedVisible.delete(key); }
function clearVisibleSelection(){ selectedVisible.clear(); }

/* === FINAL: action menu must use live visible card selection under managed admin background === */
function dockLiveVisibleItemsNow(){
  const source = Array.isArray(visible) ? visible : [];
  if (!grid) return source.slice();

  const cards = Array.from(grid.querySelectorAll(".card"));
  if (!cards.length) return source.slice();

  return cards.map((card, index) => {
    const item = source[index];
    if (item && (item.url || item.title)) return item;

    const title = card.querySelector(".title")?.textContent?.trim() || "";
    const link = card.querySelector("a.url, a[href]")?.getAttribute("href") || "";
    const url = link && link !== "#" ? link : "";
    return { title, url };
  }).filter(item => item && (item.url || item.title));
}

function dockLiveSelectedVisibleItemsNow(){
  const source = dockLiveVisibleItemsNow();
  if (!grid) return [];

  const cards = Array.from(grid.querySelectorAll(".card"));
  if (!cards.length) return source.filter(v => isSelectedVisible(v));

  return cards.map((card, index) => {
    const cb = card.querySelector('input.selBox[type="checkbox"], input.cardSelect[type="checkbox"], .cardSelect input[type="checkbox"], input[type="checkbox"]');
    return cb?.checked ? source[index] : null;
  }).filter(item => item && item.url);
}

function getVisibleOpenableItems(){
  return dockLiveVisibleItemsNow().filter(v => v?.url);
}

function getSelectedVisibleItems(){
  const selectedFromDom = dockLiveSelectedVisibleItemsNow();
  if (selectedFromDom.length) return selectedFromDom;

  return (visible || []).filter(v => isSelectedVisible(v));
}

function dockTagActionMenuUi(){
  try {
    [actionsMenu, openSubmenu, deleteSubmenu, openMenuToggle, deleteMenuToggle, openAllBtn, openSelectedBtn, refreshBtn].forEach((el) => {
      if (el) el.dataset.dockUi = el.dataset.dockUi || "action-menu";
    });
  } catch {}
}


function canDeleteCurrentView(){ return activeGroup !== "__admin__"; }
function currentGroupRecord(){ return (groups || []).find(g => g.id === activeGroup) || null; }
function ensureGroupColor(group){ return norm(group?.color) || DEFAULT_GROUP_COLOR; }


/* === District theme visual cleanup helper === */
function dockClearVisualThemeForDistrict(){
  try {
    document.body.removeAttribute("data-theme");
    document.documentElement.style.removeProperty("--dock-theme-scene");
    document.documentElement.style.removeProperty("--dock-theme-bg");
    document.documentElement.style.removeProperty("--dock-theme-card");
    document.documentElement.style.removeProperty("--dock-theme-accent");
    document.documentElement.style.removeProperty("--theme-bg");
    document.documentElement.style.removeProperty("--theme-scene");
    document.documentElement.style.removeProperty("--theme-accent");
  } catch {}
}

function dockRestoreSavedThemeOutsideDistrict(){
  try {
    if (typeof loadTheme === "function") loadTheme();
  } catch {}
}

function applyTheme(theme){
  const next = THEMES.has(theme) ? theme : DEFAULT_THEME;
  document.body.dataset.theme = next;
  const sceneAsset = THEME_SCENE_ASSETS[next];
  document.documentElement.style.setProperty("--dock-theme-scene", sceneAsset ? `url("${sceneAsset}")` : "none");
}
async function loadTheme(){
  const res = await api.storage.local.get([THEME_KEY]);
  applyTheme(String(res[THEME_KEY] || DEFAULT_THEME));
}
async function saveTheme(theme){
  const next = THEMES.has(theme) ? theme : DEFAULT_THEME;
  applyTheme(next);
  await api.storage.local.set({ [THEME_KEY]: next });
}

function applyDensity(density){
  const next = density === "compact" ? "compact" : "full";
  document.body.dataset.density = next;
  if (densityToggleBtn){
    densityToggleBtn.setAttribute("aria-pressed", String(next === "compact"));
    densityToggleBtn.classList.toggle("isCompact", next === "compact");
  }
}
async function loadDensity(){
  const res = await api.storage.local.get([DENSITY_KEY]);
  applyDensity(String(res[DENSITY_KEY] || DEFAULT_DENSITY));
}
async function toggleDensity(){
  const next = document.body.dataset.density === "compact" ? "full" : "compact";
  applyDensity(next);
  await api.storage.local.set({ [DENSITY_KEY]: next });
}

function syncStickyOffsets(){
  const root = document.documentElement;
  const headerH = headerEl ? Math.ceil(headerEl.getBoundingClientRect().height) : 96;
  root.style.setProperty("--dock-header-height", `${headerH}px`);
}

function closeMenus(){
  actionsMenu?.classList.add("hidden");
  themeMenu?.classList.add("hidden");
  shareMenu?.classList.add("hidden");
  openSubmenu?.classList.add("hidden");
  deleteSubmenu?.classList.add("hidden");
  openMenuToggle?.classList.remove("isOpen");
  deleteMenuToggle?.classList.remove("isOpen");
}

let calmToastTimer = null;
function showCalmToast({ title = "", detail = "", tone = "working", duration = 0 } = {}){
  if (!calmToast) return;

  if (calmToastTimer) {
    clearTimeout(calmToastTimer);
    calmToastTimer = null;
  }

  const accent =
    tone === "success" ? "#2f8f83" :
    tone === "error" ? "#b0392e" :
    "#2f6f95";

  calmToast.innerHTML = `
    <div data-relax-panel="true">
      <div data-relax-title="true">${escapeHtml(title)}</div>
      ${detail ? `<div data-relax-text="true">${escapeHtml(detail)}</div>` : ""}
    </div>
  `;

  const panel = calmToast.querySelector('[data-relax-panel="true"]');
  const titleEl = calmToast.querySelector('[data-relax-title="true"]');
  const textEl = calmToast.querySelector('[data-relax-text="true"]');

  calmToast.className = "";
  calmToast.removeAttribute("data-tone");
  calmToast.classList.remove("hidden");
  calmToast.hidden = false;
  calmToast.style.setProperty("position", "fixed", "important");
  calmToast.style.setProperty("inset", "0", "important");
  calmToast.style.setProperty("left", "0", "important");
  calmToast.style.setProperty("top", "0", "important");
  calmToast.style.setProperty("right", "0", "important");
  calmToast.style.setProperty("bottom", "0", "important");
  calmToast.style.setProperty("width", "100vw", "important");
  calmToast.style.setProperty("height", "100vh", "important");
  calmToast.style.setProperty("display", "flex", "important");
  calmToast.style.setProperty("align-items", "center", "important");
  calmToast.style.setProperty("justify-content", "center", "important");
  calmToast.style.setProperty("padding", "24px", "important");
  calmToast.style.setProperty("margin", "0", "important");
  calmToast.style.setProperty("background", "rgba(12,28,42,0.10)", "important");
  calmToast.style.setProperty("z-index", "2147483647", "important");
  calmToast.style.setProperty("pointer-events", "none", "important");
  calmToast.style.setProperty("box-sizing", "border-box", "important");

  if (panel) {
    panel.style.setProperty("position", "relative");
    panel.style.setProperty("width", "min(360px, calc(100vw - 48px))");
    panel.style.setProperty("max-width", "360px");
    panel.style.setProperty("min-width", "0");
    panel.style.setProperty("margin", "0 auto");
    panel.style.setProperty("padding", "22px 20px");
    panel.style.setProperty("border-radius", "22px");
    panel.style.setProperty("display", "flex");
    panel.style.setProperty("flex-direction", "column");
    panel.style.setProperty("align-items", "center");
    panel.style.setProperty("justify-content", "center");
    panel.style.setProperty("gap", "10px");
    panel.style.setProperty("text-align", "center");
    panel.style.setProperty("background", "linear-gradient(180deg, rgba(248,243,235,.98), rgba(241,233,222,.94))");
    panel.style.setProperty("border", "1px solid rgba(255,255,255,.78)");
    panel.style.setProperty("box-shadow", "0 24px 54px rgba(17,40,61,.18)");
  }

  if (titleEl) {
    titleEl.style.cssText = [
      "margin:0",
      "padding:0",
      "font-size:30px",
      "line-height:1.05",
      "font-weight:800",
      "text-align:center",
      `color:${accent}`
    ].join(";");
  }

  if (textEl) {
    textEl.style.cssText = [
      "margin:0",
      "padding:8px 14px",
      "border-radius:999px",
      "display:inline-flex",
      "align-items:center",
      "justify-content:center",
      "max-width:100%",
      "font-size:14px",
      "line-height:1.25",
      "text-align:center",
      "color:#445468",
      "background:rgba(255,255,255,.96)",
      "box-shadow:0 10px 22px rgba(17,40,61,.10)"
    ].join(";");
  }

  if (duration > 0) {
    calmToastTimer = setTimeout(hideCalmToast, duration);
  }
}
function hideCalmToast(){
  if (!calmToast) return;

  if (calmToastTimer) {
    clearTimeout(calmToastTimer);
    calmToastTimer = null;
  }

  calmToast.innerHTML = "";
  calmToast.className = "calmToast hidden";
  calmToast.hidden = true;
  calmToast.removeAttribute("style");
  calmToast.removeAttribute("data-tone");
}
function setButtonBusy(button, busy, busyLabel = "Working…", idleLabel = ""){
  if (!button) return;
  if (!button.dataset.idleLabel) button.dataset.idleLabel = idleLabel || button.textContent || "";
  button.disabled = !!busy;
  button.textContent = busy ? busyLabel : (button.dataset.idleLabel || idleLabel || button.textContent);
}
function setEmpty(on){ if (!emptyState) return; emptyState.classList.toggle("hidden", !on); }

async function loadState(){
  const [st, tabs] = await Promise.all([
    loadGroupState(),
    getNormalizedSavedTabs().catch(() => [])
  ]);
  savedTabs = Array.isArray(tabs) ? tabs : [];
  groups = Array.isArray(st.groups) ? st.groups.map(g => ({ ...g, color: ensureGroupColor(g) })) : [];
  groupItems = (st.groupItems && typeof st.groupItems === "object") ? st.groupItems : {};
  normalizeAllGroupItemsInMemory();
  activeGroup = ensureActiveGroup(groups, st.activeGroup);
}
async function saveState(){
  await saveGroupState({ groups, groupItems, activeGroup });
}



async function keepDockAsFirstTab(tab = null) {
  const dockTab = tab || await chromeTabsCall("getCurrent").catch(() => null);
  if (!dockTab?.id) return dockTab || null;

  try {
    await chromeTabsCall("move", dockTab.id, { index: 0 });
  } catch (error) {
    DEBUG && console.warn("Dock could not move Safe Harbor to first tab:", error);
  }

  try {
    await chromeTabsCall("update", dockTab.id, { active: true });
  } catch {}

  return { ...dockTab, index: 0 };
}

async function openWorkspaceItems(items){
  const currentDockTab = await chromeTabsCall("getCurrent").catch(() => null);
  const dockTab = await keepDockAsFirstTab(currentDockTab);
  const openable = (Array.isArray(items) ? items : []).filter(item => item?.url);
  let nextIndex = dockTab?.id != null ? 1 : undefined;

  for (const item of openable) {
    const createProps = { url: item.url, active: false };
    if (dockTab?.windowId != null) createProps.windowId = dockTab.windowId;
    if (nextIndex != null) createProps.index = nextIndex++;

    try {
      await chromeTabsCall("create", createProps);
    } catch {
      await chromeTabsCall("create", { url: item.url, active: false }).catch(() => null);
    }
  }

  await keepDockAsFirstTab(dockTab);
}
function getAdminCards(){
  return Array.isArray(adminWorkspace?.tabs) ? adminWorkspace.tabs.map((t, idx) => ({ ...t, __kind: "admin", __index: idx })) : [];
}

function safeCssImageUrl(value){
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (raw.startsWith('data:image/') || /^https?:\/\//i.test(raw)) return raw.replace(/["\\\n\r]/g, '');
  return '';
}


function dockIsManagedDistrictActive(){
  return activeGroup === "__admin__" && !!adminWorkspace;
}

function dockLockDistrictBrandingIfNeeded(){
  try {
    if (dockIsManagedDistrictActive()) {
      applyManagedDockBranding(true);
      if (themeMenu) themeMenu.classList.add("hidden");
      if (themeMenuBtn) {
        themeMenuBtn.disabled = true;
        themeMenuBtn.setAttribute("aria-disabled", "true");
      }
    } else {
      applyManagedDockBranding(false);
      if (themeMenuBtn) {
        themeMenuBtn.disabled = false;
        themeMenuBtn.removeAttribute("aria-disabled");
      }
    }
  } catch {}
}

function applyManagedDockBranding(enabled){
  const body = document.body;
  if (!body) return;
  if (!enabled || !adminWorkspace?.branding) {
    body.removeAttribute('data-managed-dock');
    body.style.removeProperty('--managed-dock-bg');
    body.style.removeProperty('--managed-dock-accent');
    return;
  }
  const branding = adminWorkspace.branding || {};
  const bg = safeCssImageUrl(branding.districtBackgroundUrl || branding.district_background_url || '');
  const accent = String(branding.districtAccentColor || branding.district_accent_color || '').trim();
  body.setAttribute('data-managed-dock', 'true');
  if (bg) body.style.setProperty('--managed-dock-bg', `url("${bg}")`);
  else body.style.removeProperty('--managed-dock-bg');
  if (/^#[0-9a-f]{3,8}$/i.test(accent)) body.style.setProperty('--managed-dock-accent', accent);
  else body.style.removeProperty('--managed-dock-accent');
}

function getFaviconUrl(rawUrl){
  try {
    const u = new URL(rawUrl);
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(u.hostname)}&sz=128`;
  } catch { return ""; }
}

function pickMemoryVisual(item){
  if (!item) return "";

  // Keep this broad because admin-assigned cards, library cards, imported
  // cards, and saved tabs have used different field names over time.
  return (
    item.screenshot ||
    item.screenshotUrl ||
    item.screenshot_url ||
    item.screenshotDataUrl ||
    item.screenshotDataURI ||
    item.screenshot_data_url ||
    item.previewImage ||
    item.previewUrl ||
    item.preview_url ||
    item.thumbnail ||
    item.thumbnailUrl ||
    item.thumbnail_url ||
    item.image ||
    item.imageUrl ||
    item.image_url ||
    item.uploadedImage ||
    item.uploadedImageUrl ||
    item.uploaded_image_url ||
    item.cardImage ||
    item.cardImageUrl ||
    item.card_image_url ||
    item.customImage ||
    item.customImageUrl ||
    item.custom_image_url ||
    item.icon ||
    item.iconUrl ||
    item.faviconUrl ||
    item.favIconUrl ||
    ""
  );
}

function cloneMemoryItem(item){
  const visual = pickMemoryVisual(item);
  const out = {
    ...item,

    // Once copied into a personal dock, this should behave like a normal
    // personal memory, not like a locked admin card.
    __kind: "main",

    // Preserve where it came from for future debugging/support.
    sourceKind: item?.__kind || item?.sourceKind || "",
    sourceId: item?.id || item?.local_id || item?.url || "",
    copiedFromAdmin: item?.__kind === "admin" || activeGroup === "__admin__",

    // Critical: personal cards do not render admin customIcon directly.
    // So promote the admin customIcon into all screenshot/preview fields.
    screenshot_url: item?.screenshot_url || visual,
    screenshotUrl: item?.screenshotUrl || visual,
    screenshotThumb: item?.screenshotThumb || visual,
    screenshot: item?.screenshot || visual,
    screenshot_data_url: item?.screenshot_data_url || visual,
    screenshotDataUrl: item?.screenshotDataUrl || visual,
    screenshotDataURI: item?.screenshotDataURI || visual,

    // Preserve image aliases too.
    customIcon: item?.customIcon || visual,
    icon_url: item?.icon_url || visual,
    image: item?.image || visual,
    imageUrl: item?.imageUrl || visual,
    image_url: item?.image_url || visual,
    previewImage: item?.previewImage || visual,
    previewUrl: item?.previewUrl || visual,
    preview_url: item?.preview_url || visual,
    thumbnail: item?.thumbnail || visual,
    thumbnailUrl: item?.thumbnailUrl || visual,
    thumbnail_url: item?.thumbnail_url || visual,
    faviconUrl: item?.faviconUrl || item?.favIconUrl || ""
  };

  delete out.__kind;
  delete out.__index;
  delete out.__adminIndex;
  delete out.groupId;
  delete out.scope;
  delete out.workspaceId;
  delete out.previewCheckedAt;

  out.id = `mem_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  out.createdAt = Date.now();
  out.updatedAt = Date.now();
  out.screenshotBlocked = false;

  return out;
}

function previewValue(item){
  return item?.customIcon
    || item?.icon_url
    || item?.screenshot_url
    || item?.screenshotUrl
    || item?.screenshotThumb
    || item?.screenshot
    || item?.screenshot_data_url
    || item?.previewImage
    || item?.previewUrl
    || item?.thumbnail
    || item?.image
    || null;
}

function mergePreviewFields(item, source){
  if (!item || !source) return item;
  if (previewValue(item) || !previewValue(source)) return item;

  return {
    ...item,
    screenshot_url: source.screenshot_url || item.screenshot_url,
    screenshotUrl: source.screenshotUrl || item.screenshotUrl,
    screenshotThumb: source.screenshotThumb || item.screenshotThumb,
    screenshot: source.screenshot || item.screenshot,
    screenshot_data_url: source.screenshot_data_url || item.screenshot_data_url,
    screenshotBlocked: false
  };
}

function getSelectedCloneItems(){
  return getSelectedVisibleItems()
    .map(cloneMemoryItem)
    .filter(item => item && (item.url || item.title));
}
function addItemsToGroup(groupId, items){
  if (!groupId || !Array.isArray(items) || !items.length) return;
  const cur = Array.isArray(groupItems[groupId]) ? normalizeOrderedItems(groupItems[groupId], groupId) : [];
  const additions = items.map(cloneMemoryItem).map((item) => ({ ...item, workspaceId: groupId }));
  groupItems[groupId] = normalizeOrderedItems([...cur, ...additions], groupId);
}

function hasFinitePosition(item){
  return Number.isFinite(Number(item?.position));
}

function sortPositionally(items){
  return (items || [])
    .map((item, originalIndex) => ({ item, originalIndex }))
    .sort((a, b) => {
      const ap = hasFinitePosition(a.item) ? Number(a.item.position) : Number.POSITIVE_INFINITY;
      const bp = hasFinitePosition(b.item) ? Number(b.item.position) : Number.POSITIVE_INFINITY;
      if (ap !== bp) return ap - bp;
      const at = Number(a.item?.createdAt || a.item?.savedAt || 0);
      const bt = Number(b.item?.createdAt || b.item?.savedAt || 0);
      if (at && bt && at !== bt) return at - bt;
      return a.originalIndex - b.originalIndex;
    })
    .map(({ item }) => item);
}

function normalizeOrderedItems(items, workspaceId = ""){
  return sortPositionally(items).map((item, index) => ({
    ...item,
    position: index,
    ...(workspaceId ? { workspaceId } : {})
  }));
}

function reindexInCurrentOrder(items, workspaceId = ""){
  return (Array.isArray(items) ? items : []).map((item, index) => ({
    ...cloneMemoryItem(item),
    position: index,
    ...(workspaceId ? { workspaceId } : {})
  }));
}

function arraysDifferByOrderOrPosition(a, b){
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return true;
  for (let i = 0; i < a.length; i += 1) {
    const aa = JSON.stringify(a[i]);
    const bb = JSON.stringify(b[i]);
    if (aa !== bb) return true;
  }
  return false;
}

async function getNormalizedSavedTabs(){
  const raw = await getSavedTabs({ localOnly: true });
  const normalized = normalizeOrderedItems(raw);
  if (arraysDifferByOrderOrPosition(raw, normalized)) {
    await setSavedTabs(normalized);
  }
  return normalized;
}

function normalizeAllGroupItemsInMemory(){
  const next = {};
  let changed = false;
  Object.entries(groupItems || {}).forEach(([groupId, items]) => {
    const normalized = normalizeOrderedItems(Array.isArray(items) ? items : [], groupId);
    next[groupId] = normalized;
    if (arraysDifferByOrderOrPosition(items, normalized)) changed = true;
  });
  groupItems = next;
  return changed;
}

function moveArrayItem(items, fromIndex, targetIndex, mode = "after"){
  const list = Array.isArray(items) ? [...items] : [];
  if (fromIndex < 0 || fromIndex >= list.length || targetIndex < 0 || targetIndex >= list.length) return list;
  const [moved] = list.splice(fromIndex, 1);
  let insertAt = targetIndex;
  if (mode === "after") insertAt += 1;
  if (fromIndex < targetIndex) insertAt -= 1;
  if (insertAt < 0) insertAt = 0;
  if (insertAt > list.length) insertAt = list.length;
  list.splice(insertAt, 0, moved);
  return list;
}

function clearCardDropMarkers(){
  grid?.querySelectorAll('.card').forEach((el) => el.classList.remove('dropBefore', 'dropAfter', 'isDragging', 'dropTarget'));
}

function computeCardDropMode(card, event){
  const rect = card.getBoundingClientRect();
  const relY = event.clientY - rect.top;
  const relX = event.clientX - rect.left;
  if (rect.height >= rect.width * 0.9) {
    return relY < rect.height / 2 ? 'before' : 'after';
  }
  const xRatio = relX / rect.width;
  const yRatio = relY / rect.height;
  return (yRatio < 0.35 || xRatio < 0.5) ? 'before' : 'after';
}

async function persistCardOrderByInsertIndex(scope, fromIndex, insertIndex){
  const reorderByInsertIndex = (items, workspaceId = '') => {
    const list = Array.isArray(items) ? [...items] : [];
    if (fromIndex < 0 || fromIndex >= list.length) return normalizeOrderedItems(list, workspaceId);
    let nextIndex = Number(insertIndex);
    if (!Number.isFinite(nextIndex)) nextIndex = fromIndex;
    if (nextIndex < 0) nextIndex = 0;
    if (nextIndex > list.length - 1) nextIndex = list.length - 1;
    const [moved] = list.splice(fromIndex, 1);
    const boundedInsert = Math.max(0, Math.min(nextIndex, list.length));
    list.splice(boundedInsert, 0, moved);
    return reindexInCurrentOrder(list, workspaceId);
  };

  if (scope === '__all__') {
    const current = await getNormalizedSavedTabs();
    await setSavedTabs(reorderByInsertIndex(current));
    return;
  }
  if (!scope || scope === '__admin__') return;
  const current = normalizeOrderedItems(Array.isArray(groupItems[scope]) ? groupItems[scope] : [], scope);
  groupItems[scope] = reorderByInsertIndex(current, scope);
  await saveState();
}

async function persistCardOrderByTarget(scope, fromKey, targetKey, mode = 'after'){
  if (!fromKey || !targetKey || fromKey === targetKey) return false;
  const reorderByTarget = (items, workspaceId = '') => {
    const list = normalizeOrderedItems(Array.isArray(items) ? items : [], workspaceId);
    const keyed = list.map((item, idx) => ({ ...item, __kind: workspaceId ? 'group' : 'main', __index: idx }));
    const fromIndex = keyed.findIndex((item) => itemKey(item) === fromKey);
    const targetIndex = keyed.findIndex((item) => itemKey(item) === targetKey);
    if (fromIndex < 0 || targetIndex < 0 || fromIndex === targetIndex) return list;
    const moved = moveArrayItem(list, fromIndex, targetIndex, mode);
    return reindexInCurrentOrder(moved, workspaceId);
  };

  if (scope === '__all__') {
    const current = await getNormalizedSavedTabs();
    const reordered = reorderByTarget(current);
    if (arraysDifferByOrderOrPosition(current, reordered)) {
      await setSavedTabs(reordered);
      return true;
    }
    return false;
  }
  if (!scope || scope === '__admin__') return false;
  const current = normalizeOrderedItems(Array.isArray(groupItems[scope]) ? groupItems[scope] : [], scope);
  const reordered = reorderByTarget(current, scope);
  if (arraysDifferByOrderOrPosition(current, reordered)) {
    groupItems[scope] = reordered;
    await saveState();
    return true;
  }
  return false;
}

function findNearestSortableCard(fromKey, clientX, clientY){
  const cards = [...(grid?.querySelectorAll('.card.isSortable') || [])].filter((card) => card.dataset.sortKey !== fromKey);
  if (!cards.length) return null;

  let bestCard = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const card of cards) {
    const rect = card.getBoundingClientRect();
    const clampedX = Math.max(rect.left, Math.min(clientX, rect.right));
    const clampedY = Math.max(rect.top, Math.min(clientY, rect.bottom));
    const dx = clientX - clampedX;
    const dy = clientY - clampedY;
    const dist = (dx * dx) + (dy * dy);
    if (dist < bestDist) {
      bestDist = dist;
      bestCard = card;
    }
  }
  return bestCard;
}

function updateCardDropTarget(scope, fromKey, clientX, clientY){
  clearCardDropMarkers();
  if (!grid) return { key: null, index: null, mode: 'after' };

  const cards = [...grid.querySelectorAll('.card.isSortable')].filter((card) => card.dataset.sortKey !== fromKey);
  if (!cards.length) return { key: null, index: null, mode: 'after' };

  const minTop = Math.min(...cards.map((card) => card.getBoundingClientRect().top));
  const maxBottom = Math.max(...cards.map((card) => card.getBoundingClientRect().bottom));

  let card = null;
  let mode = 'after';

  if (clientY < minTop - 12) {
    card = cards[0];
    mode = 'before';
  } else if (clientY > maxBottom + 12) {
    card = cards[cards.length - 1];
    mode = 'after';
  } else {
    card = findNearestSortableCard(fromKey, clientX, clientY);
    if (!card) return { key: null, index: null, mode: 'after' };
    mode = computeCardDropMode(card, { clientX, clientY });
  }

  card.classList.add(mode === 'before' ? 'dropBefore' : 'dropAfter');
  card.classList.add('dropTarget');
  const idx = Number(card.dataset.sortIndex);
  return { key: card.dataset.sortKey || null, index: Number.isFinite(idx) ? idx : null, mode };
}

function moveGhost(state, clientX, clientY){
  if (!state?.ghost) return;
  state.ghost.style.left = `${Math.round(clientX - state.offsetX)}px`;
  state.ghost.style.top = `${Math.round(clientY - state.offsetY)}px`;
}

function makeCardPlaceholder(sourceCard){
  const ph = document.createElement('div');
  ph.className = 'cardDragPlaceholder';
  ph.style.width = `${Math.round(sourceCard.getBoundingClientRect().width)}px`;
  ph.style.height = `${Math.round(sourceCard.getBoundingClientRect().height)}px`;
  return ph;
}

function movePlaceholderNearTarget(state, targetCard, mode){
  if (!state?.placeholder || !targetCard || targetCard === state.originCard || targetCard === state.placeholder) return;
  if (mode === 'before') {
    targetCard.parentNode?.insertBefore(state.placeholder, targetCard);
  } else {
    targetCard.parentNode?.insertBefore(state.placeholder, targetCard.nextSibling);
  }
}

function getOrderedSortKeysFromGrid(){
  if (!grid) return [];
  return [...grid.querySelectorAll('.card.isSortable')]
    .map((el) => el.dataset.sortKey || '')
    .filter(Boolean);
}

async function persistCardOrderFromKeys(scope, orderedKeys){
  if (!Array.isArray(orderedKeys) || !orderedKeys.length) return;
  if (scope === '__all__') {
    const current = await getNormalizedSavedTabs();
    const keyed = current.map((item, idx) => ({ ...item, __kind: 'main', __index: idx }));
    const byKey = new Map(keyed.map((item) => [itemKey(item), cloneMemoryItem(item)]));
    const reordered = orderedKeys.map((key) => byKey.get(key)).filter(Boolean);
    if (reordered.length === current.length) {
      await setSavedTabs(reindexInCurrentOrder(reordered));
    }
    return;
  }
  if (!scope || scope === '__admin__') return;
  const current = normalizeOrderedItems(Array.isArray(groupItems[scope]) ? groupItems[scope] : [], scope);
  const keyed = current.map((item, idx) => ({ ...item, __kind: 'group', __index: idx }));
  const byKey = new Map(keyed.map((item) => [itemKey(item), cloneMemoryItem(item)]));
  const reordered = orderedKeys.map((key) => byKey.get(key)).filter(Boolean);
  if (reordered.length === current.length) {
    groupItems[scope] = reindexInCurrentOrder(reordered, scope);
    await saveState();
  }
}

function removePointerSortArtifacts(){
  if (!pointerSortState) return;
  try { pointerSortState.ghost?.remove(); } catch {}
  try { pointerSortState.placeholder?.remove(); } catch {}
  if (pointerSortState.originCard) {
    pointerSortState.originCard.classList.remove('isDragging');
    pointerSortState.originCard.style.display = '';
  }
  clearCardDropMarkers();
  window.removeEventListener('pointermove', onCardPointerMove, true);
  window.removeEventListener('pointerup', onCardPointerUp, true);
  window.removeEventListener('pointercancel', onCardPointerCancel, true);
  pointerSortState = null;
}

async function finishPointerSort(commit){
  const state = pointerSortState;
  if (!state) return;

  let orderedKeys = [];
  if (commit && state.placeholder && state.placeholder.parentNode === grid) {
    orderedKeys = [...grid.children].flatMap((el) => {
      if (el === state.placeholder) return [state.fromKey];
      if (el.classList?.contains('card') && el.classList?.contains('isSortable') && el !== state.originCard) {
        const key = el.dataset.sortKey || '';
        return key ? [key] : [];
      }
      return [];
    });
  }

  removePointerSortArtifacts();
  if (!commit) return;

  let changed = false;
  if (orderedKeys.length > 1 && orderedKeys.includes(state.fromKey)) {
    await persistCardOrderFromKeys(state.scope, orderedKeys);
    changed = true;
  }
  if (changed) {
    await load({ reason: "hydrate-start", force: true });
  }
}

function onCardPointerMove(e){
  const state = pointerSortState;
  if (!state) return;
  moveGhost(state, e.clientX, e.clientY);
  const target = updateCardDropTarget(state.scope, state.fromKey, e.clientX, e.clientY);
  state.targetKey = target.key;
  state.targetIndex = target.index;
  state.dropMode = target.mode;
  if (target.key) {
    const targetCard = grid?.querySelector(`.card.isSortable[data-sort-key="${CSS.escape(target.key)}"]`);
    if (targetCard) movePlaceholderNearTarget(state, targetCard, target.mode || 'after');
  }
}

function onCardPointerUp(){
  finishPointerSort(true).catch(() => removePointerSortArtifacts());
}

function onCardPointerCancel(){
  removePointerSortArtifacts();
}

function attachCardSort(card, item, scope){
  if (!card || !item || !scope || scope === '__admin__') return;
  const handle = document.createElement('button');
  handle.type = 'button';
  handle.className = 'cardDragHandle';
  handle.title = 'Drag to reorder';
  handle.setAttribute('aria-label', 'Drag to reorder');
  handle.textContent = '⋮⋮';
  card.appendChild(handle);
  card.classList.add('isSortable');
  card.dataset.sortKey = itemKey(item);
  card.dataset.sortIndex = String(item.__index ?? 0);

  handle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    removePointerSortArtifacts();
    const rect = card.getBoundingClientRect();
    const ghost = card.cloneNode(true);
    ghost.classList.add('cardDragGhost');
    ghost.querySelectorAll('button, input, a').forEach((el) => {
      try { el.disabled = true; } catch {}
      el.tabIndex = -1;
      el.setAttribute('aria-hidden', 'true');
    });
    ghost.style.width = `${Math.round(rect.width)}px`;
    ghost.style.height = `${Math.round(rect.height)}px`;
    document.body.appendChild(ghost);
    const placeholder = makeCardPlaceholder(card);
    card.parentNode?.insertBefore(placeholder, card.nextSibling);
    card.classList.add('isDragging');
    card.style.display = 'none';
    pointerSortState = {
      scope,
      fromIndex: item.__index,
      fromKey: itemKey(item),
      targetKey: null,
      targetIndex: null,
      dropMode: 'after',
      originCard: card,
      ghost,
      placeholder,
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
    };
    moveGhost(pointerSortState, e.clientX, e.clientY);
    window.addEventListener('pointermove', onCardPointerMove, true);
    window.addEventListener('pointerup', onCardPointerUp, true);
    window.addEventListener('pointercancel', onCardPointerCancel, true);
    try { handle.setPointerCapture(e.pointerId); } catch {}
  });
}

function moveGroupRelative(dragId, targetId, mode = "before"){
  if (!dragId || !targetId || dragId === targetId) return false;
  const list = Array.isArray(groups) ? [...groups] : [];
  const from = list.findIndex(g => g.id === dragId);
  const to = list.findIndex(g => g.id === targetId);
  if (from < 0 || to < 0) return false;
  const [moved] = list.splice(from, 1);
  const targetIndex = list.findIndex(g => g.id === targetId);
  if (targetIndex < 0) return false;
  let insertAt = mode === "after" ? targetIndex + 1 : targetIndex;
  if (insertAt < 0) insertAt = 0;
  if (insertAt > list.length) insertAt = list.length;
  list.splice(insertAt, 0, moved);
  groups = list;
  return true;
}

function clearGroupDropMarkers(){
  groupPills?.querySelectorAll(".groupPillWrap").forEach(el => el.classList.remove("dropBefore", "dropAfter"));
  dragTargetGroupId = null;
}

function updateGroupDropTarget(clientX){
  if (!dragGroupId || !groupPills) return;
  const wraps = [...groupPills.querySelectorAll('.groupPillWrap[draggable="true"]')].filter(el => el.dataset.groupId !== dragGroupId);
  clearGroupDropMarkers();
  if (!wraps.length) return;
  let target = wraps[wraps.length - 1];
  let mode = 'after';
  for (const wrap of wraps) {
    const rect = wrap.getBoundingClientRect();
    const midpoint = rect.left + rect.width / 2;
    if (clientX < midpoint) {
      target = wrap;
      mode = 'before';
      break;
    }
    target = wrap;
    mode = 'after';
  }
  dragTargetGroupId = target.dataset.groupId || null;
  dragDropMode = mode;
  target.classList.add(mode === 'before' ? 'dropBefore' : 'dropAfter');
}

function encodeShareData(obj){
  const json = JSON.stringify(obj);
  const bytes = new TextEncoder().encode(json);
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function sanitizeSharedUrl(rawUrl){
  const url = norm(rawUrl);
  if (!url) return "";
  if (/^(chrome|chrome-extension|edge|about|file):/i.test(url)) return "";
  return url;
}

function buildWorkspaceSharePayload(group){
  const tabsRaw = Array.isArray(groupItems[group?.id]) ? groupItems[group.id] : [];
  const tabs = tabsRaw
    .map(cloneMemoryItem)
    .map((tab) => ({
      title: norm(tab.title) || norm(tab.url) || "Untitled",
      url: sanitizeSharedUrl(tab.url),
      reason: norm(tab.reason),
      faviconUrl: norm(tab.faviconUrl) || null,
      screenshot_url: norm(tab.screenshot_url || tab.screenshotUrl || tab.screenshotThumb || tab.screenshot || tab.screenshot_data_url) || null,
      screenshotUrl: norm(tab.screenshotUrl || tab.screenshot_url || tab.screenshotThumb || tab.screenshot || tab.screenshot_data_url) || null,
      screenshotThumb: norm(tab.screenshotThumb || tab.screenshot_url || tab.screenshotUrl || tab.screenshot || tab.screenshot_data_url) || null,
      screenshot: norm(tab.screenshot || tab.screenshot_url || tab.screenshotUrl || tab.screenshotThumb || tab.screenshot_data_url) || null,
      screenshot_data_url: norm(tab.screenshot_data_url || tab.screenshot_url || tab.screenshotUrl || tab.screenshotThumb || tab.screenshot) || null,
      screenshotBlocked: !previewValue(tab) && Boolean(tab.screenshotBlocked),
      savedAt: tab.savedAt || Date.now()
    }))
    .filter((tab) => tab.url);

  return {
    version: 1,
    type: "dock-workspace-share",
    workspace: {
      name: norm(group?.name) || "Dock",
      color: ensureGroupColor(group),
      exportedAt: Date.now(),
      tabs
    }
  };
}

async function copyTextSafe(text){
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {}
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "readonly");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}
async function createShareLinkForDock(groupId){
  await loadState();
  if (!groupId) return alert("Dock not found.");
  if (groupId === "__all__") return alert("Open a Dock first, then click Share.");
  if (groupId === "__admin__") return alert("Dock is locked and cannot be shared from this menu.");

  const group = (groups || []).find(g => g.id === groupId);
  if (!group) return alert("Dock not found.");

  const payload = buildWorkspaceSharePayload(group);
if (!payload.workspace.tabs.length) {
  return alert("This Dock only contains browser or extension pages right now. Save at least one regular website tab to create a share link.");
}
  const encoded = encodeShareData(payload);
  const importUrl = `${api.runtime.getURL("import.html")}#data=${encoded}`;
  const copied = await copyTextSafe(importUrl);
  closeMenus();

  if (copied) {
    alert(`Share link copied. Send it to another teacher who already has Dock installed.\n\n${importUrl}`);
  } else {
    prompt("Copy and share this Dock link:", importUrl);
  }
}
async function createShareLinkForActiveWorkspace(){
  await loadState();
  if (activeGroup === "__all__") return alert("Open a Dock first, then click Share.");
  if (activeGroup === "__admin__") return alert("Dock is locked and cannot be shared from this menu.");
  const group = currentGroupRecord();
  if (!group) return alert("Dock not found.");

  const payload = buildWorkspaceSharePayload(group);
if (!payload.workspace.tabs.length) {
  return alert("This Dock only contains browser or extension pages right now. Save at least one regular website tab to create a share link.");
}
  const encoded = encodeShareData(payload);
  const importUrl = `${api.runtime.getURL("import.html")}#data=${encoded}`;
  const copied = await copyTextSafe(importUrl);
  closeMenus();
  if (copied) {
    alert(`Share link copied. Send it to another teacher who already has Dock installed.\n\n${importUrl}`);
  } else {
    prompt("Copy and share this Dock link:", importUrl);
  }
}

function updateWorkspaceButtons(){
  const selectedCount = getDockItSelectedCountNow();
  const locked = activeGroup === "__admin__";
  const editableWorkspace = !!currentGroupRecord() && activeGroup !== "__admin__";

  if (createGroupBtn){
    const canCreateWorkspace = selectedCount > 0;
    createGroupBtn.disabled = activeGroup === "__admin__" ? selectedCount <= 0 : !canCreateWorkspace;
    createGroupBtn.title = canCreateWorkspace
      ? `Create Dock from ${selectedCount} selected`
      : "Select one or more cards to create a Dock";
    createGroupBtn.classList.toggle("needsSelection", activeGroup === "__admin__" ? selectedCount <= 0 : !canCreateWorkspace);
  }

  if (editGroupBtn){
    editGroupBtn.disabled = !editableWorkspace;
    editGroupBtn.hidden = !editableWorkspace;
    editGroupBtn.title = editableWorkspace ? "Edit this Dock name and color" : "Open a Dock to edit it";
  }

  if (addBtn){
    const eligibleTargetCount = Math.max(0, (groups || []).length - (activeGroup && activeGroup !== "__all__" && activeGroup !== "__admin__" ? 1 : 0));
    addBtn.disabled = selectedCount === 0 || eligibleTargetCount === 0;
    if (!selectedCount) addBtn.title = "Select one or more cards first";
    else if (!eligibleTargetCount) addBtn.title = "Create another Dock first";
    else addBtn.title = `Add ${selectedCount} selected to another Dock`;
  }

}

function updateActionButtons(){
  const openCount = getVisibleOpenableItems().length;
  const selectedCount = getSelectedVisibleItems().length;
  const lockedView = !canDeleteCurrentView();
  if (openAllBtn) {
    openAllBtn.disabled = openCount === 0;
    openAllBtn.title = openCount ? `Open ${openCount} tab${openCount === 1 ? "" : "s"}` : "Nothing to open";
  }
  if (openSelectedBtn) {
    openSelectedBtn.disabled = selectedCount === 0;
    openSelectedBtn.title = selectedCount ? `Open ${selectedCount} selected` : "Select tabs first";
  }
  if (deleteMenuToggle) {
    deleteMenuToggle.hidden = lockedView;
  }
  if (deleteSelectedBtn) {
    deleteSelectedBtn.disabled = selectedCount === 0 || lockedView;
    deleteSelectedBtn.title = lockedView ? "Dock is locked" : (selectedCount ? `Delete ${selectedCount} selected` : "Select tabs first");
    deleteSelectedBtn.hidden = lockedView;
  }
  if (clearAllBtn) {
    const hasVisible = (visible || []).length > 0;
    clearAllBtn.disabled = !hasVisible || lockedView;
    clearAllBtn.hidden = lockedView;
    if (lockedView) clearAllBtn.title = "Dock is locked";
    else if (activeGroup === "__all__") clearAllBtn.title = "Delete all memories on this page";
    else clearAllBtn.title = "Delete all tabs in this Dock";
  }
  updateWorkspaceButtons();
}

function getPillStyles(color, active){
  const safe = norm(color) || DEFAULT_GROUP_COLOR;
  const ring = active ? `0 0 0 2px color-mix(in srgb, ${safe} 28%, #ffffff 72%), 0 8px 18px rgba(10,24,38,.08)` : `0 0 0 1px rgba(255,255,255,.34), 0 8px 18px rgba(10,24,38,.06)`;
  return `--ws-color:${safe}; background:${safe}; color:#fff; border:none; box-shadow:${ring};`;
}

function pill(label, id, opts = {}) {
  const wrap = document.createElement("div");
  wrap.className = "groupPillWrap" + (opts.deletable ? " isDock" : "");
  wrap.dataset.groupId = id;
  if (opts.draggable) {
    wrap.draggable = true;
    wrap.title = `${label} — drag to reorder`;
    wrap.addEventListener("dragstart", (e) => {
      dragGroupId = id;
      dragDropMode = "before";
      dragTargetGroupId = null;
      wrap.classList.add("isDragging");
      try { e.dataTransfer.setData("text/plain", id); } catch {}
      if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
    });
    wrap.addEventListener("dragend", () => {
      dragGroupId = null;
      dragDropMode = "before";
      dragTargetGroupId = null;
      wrap.classList.remove("isDragging");
      clearGroupDropMarkers();
    });
  }

  const b = document.createElement("button");
  b.className = "groupPill" + (activeGroup === id ? " active" : "") + (opts.deletable ? " hasControls" : "");
  b.type = "button";
  b.textContent = label;
  b.style.cssText = getPillStyles(opts.color || DEFAULT_GROUP_COLOR, activeGroup === id);
  b.addEventListener("click", async () => {
    activeGroup = id;
    try { dockApplyDistrictBackgroundFinal(); } catch {}
    await saveState();
    await load();
    try { dockApplyDistrictBackgroundFinal(); } catch {}
  });
  wrap.appendChild(b);

  if (opts.deletable) {
    const deleteDock = async () => {
      const ok = confirm(`Delete Dock "${label}"? This only removes the Dock and the tabs saved inside it.`);
      if (!ok) return;
      groups = (groups || []).filter(g => g.id !== id);
      delete groupItems[id];
      if (activeGroup === id) activeGroup = "__all__";
      await saveState();
await load({ reason: "managed-sync", force: true });
    };

    const quickDeleteBtn = document.createElement("button");
    quickDeleteBtn.className = "groupPillX";
    quickDeleteBtn.type = "button";
    quickDeleteBtn.dataset.groupId = id;
    quickDeleteBtn.title = `Delete ${label}`;
    quickDeleteBtn.textContent = "×";
    quickDeleteBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeDockPillMenus();
      await deleteDock();
    });
    wrap.appendChild(quickDeleteBtn);

 const menuBtn = document.createElement("button");
menuBtn.className = "groupPillMenuBtn";
menuBtn.type = "button";
menuBtn.dataset.groupId = id;
menuBtn.innerHTML = '<span></span><span></span><span></span>';
menuBtn.title = "Dock options";
wrap.appendChild(menuBtn);

const menu = document.createElement("div");
menu.className = "groupPillMenu hidden";
menu.__dockHome = wrap;

menuBtn.__dockMenu = menu;
wrap.__dockMenu = menu;

menuBtn.addEventListener("click", (e) => {
  e.preventDefault();
  e.stopPropagation();
  openDockPillMenu(menuBtn.__dockMenu, menuBtn);
});
    const mk = (labelText, fn, cls = '') => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = `groupPillMenuItem ${cls}`.trim();
      item.textContent = labelText;
      item.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        closeDockPillMenus();
        await fn();
      });
      return item;
    };

    menu.appendChild(mk('Add selected', async () => {
      await addSelectedToDock(id);
    }));
    menu.appendChild(mk('Add all', async () => {
      await addAllFromCurrentDock(id);
    }));
    menu.appendChild(mk('Edit', async () => {
      activeGroup = id;
      await saveState();
      await editDockById(id);
    }));
    menu.appendChild(mk('Share', async () => {
      await createShareLinkForDock(id);
    }));
    menu.appendChild(mk('Delete', async () => {
      await deleteDock();
    }, 'dangerItem'));
    wrap.appendChild(menu);
  }
  return wrap;
}


// === Managed district background final stable mode ===
function dockFindDistrictBackgroundUrlFinal(){
  const candidates = [];

  const add = (value) => {
    if (value && typeof value === "string") candidates.push(value.trim());
  };

  const scan = (obj, depth = 0) => {
    if (!obj || typeof obj !== "object" || depth > 7) return;

    add(obj.districtBackgroundUrl);
    add(obj.district_background_url);
    add(obj.backgroundUrl);
    add(obj.background_url);
    add(obj.background);
    add(obj.bgUrl);
    add(obj.bg_url);

    if (obj.branding) scan(obj.branding, depth + 1);
    if (obj.workspace) scan(obj.workspace, depth + 1);
    if (obj.config) scan(obj.config, depth + 1);
    if (obj.managedConfig) scan(obj.managedConfig, depth + 1);
    if (obj.organization) scan(obj.organization, depth + 1);
    if (obj.org) scan(obj.org, depth + 1);
  };

  scan(adminWorkspace);

  try {
    const cached = localStorage.getItem("dockManagedDistrictBackgroundUrl:last");
    add(cached);
  } catch {}

  const found = candidates.find(v =>
    v.startsWith("data:image/") ||
    v.startsWith("https://") ||
    v.startsWith("http://") ||
    v.startsWith("chrome-extension://")
  ) || "";

  if (found) {
    try { localStorage.setItem("dockManagedDistrictBackgroundUrl:last", found); } catch {}
  }

  return found;
}

function dockIsManagedDistrictViewFinal(){
  return activeGroup === "__admin__";
}

function dockApplyDistrictBackgroundFinal(){
  const url = dockFindDistrictBackgroundUrlFinal();
  const active = dockIsManagedDistrictViewFinal() && !!url;

  document.documentElement.classList.toggle("managedDistrictBackgroundActive", active);
  document.body.classList.toggle("managedDistrictBackgroundActive", active);

  if (active) {
    const safeUrl = String(url).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    document.documentElement.style.setProperty("--managed-district-background-url", `url("${safeUrl}")`);
  } else {
    document.documentElement.style.removeProperty("--managed-district-background-url");
  }
}

let dockManagedDistrictBackgroundTimerFinal = null;

function dockStartDistrictBackgroundFinal(){
  dockApplyDistrictBackgroundFinal();

  if (dockManagedDistrictBackgroundTimerFinal) return;

  dockManagedDistrictBackgroundTimerFinal = window.setInterval(() => {
    dockApplyDistrictBackgroundFinal();
  }, 250);

  document.addEventListener("visibilitychange", dockApplyDistrictBackgroundFinal);
  window.addEventListener("focus", dockApplyDistrictBackgroundFinal);
  window.addEventListener("pageshow", dockApplyDistrictBackgroundFinal);
  document.addEventListener("click", () => {
    window.setTimeout(dockApplyDistrictBackgroundFinal, 0);
    window.setTimeout(dockApplyDistrictBackgroundFinal, 120);
  }, true);
}

dockStartDistrictBackgroundFinal();
// === End managed district background final stable mode ===

function renderPills(){
  if (!groupPills) return;
  groupPills.innerHTML = "";
  const hasGroups = Array.isArray(groups) && groups.length > 0;
  const hasAdmin = !!adminWorkspace && Array.isArray(adminWorkspace.tabs) && adminWorkspace.tabs.length > 0;

  if (hasGroups || hasAdmin) groupPills.appendChild(pill("Library", "__all__", { deletable: false, color: "#4bb7c9" }));
  if (hasAdmin) {
    const adminLabel = String(adminWorkspace.name || "").trim();
    const displayAdminLabel = /workspace/i.test(adminLabel) ? adminLabel.replace(/workspace/ig, "Dock") : (adminLabel || "Dock");
    groupPills.appendChild(pill(displayAdminLabel, "__admin__", { deletable: false, color: "#8fd8c6" }));
  }
  (groups || []).forEach(g => groupPills.appendChild(pill(g.name || "Dock", g.id, { deletable: true, draggable: true, color: ensureGroupColor(g) })));

  const noPills = groupPills.children.length === 0;
  groupPills.style.display = noPills ? "none" : "flex";
  groupPills.classList.toggle("isEmpty", noPills);
  groupBarEl?.classList.toggle("noPills", noPills);
}

function cleanupGridImageRefs(){
  if (!grid) return;
  grid.querySelectorAll('.card[data-preview-source]').forEach((card) => {
    const previewSource = String(card.dataset.previewSource || '').trim();
    if (previewSource) releaseCachedImage(previewSource);
    delete card.dataset.previewSource;
  });
}

function openWorkspaceModal({ title, subtitle, submitLabel = "Create", suggestedName = "", defaultColor = DEFAULT_GROUP_COLOR, showColor = false, workspaceChoices = [], onSubmit }) {
  const backdrop = document.createElement("div");
  backdrop.className = "dockModalBackdrop";
  backdrop.dataset.dockUi = "modal-backdrop";
  const modal = document.createElement("div");
  modal.className = "dockModal";
  modal.dataset.dockUi = "modal";

  const selectHtml = workspaceChoices.length
    ? `<label class="dockField"><span class="dockFieldLabel">Dock</span><select class="dockInput dockSelect" id="dockWorkspaceSelect">${workspaceChoices.map(w => `<option value="${escapeHtml(w.id)}">${escapeHtml(w.name)}</option>`).join("")}</select></label>`
    : "";
  const colorHtml = showColor
    ? `<label class="dockField"><span class="dockFieldLabel">Dock color</span><input class="dockColorInput" id="dockGroupColor" type="color" value="${escapeHtml(defaultColor)}" /></label>`
    : "";
  const nameHtml = suggestedName !== null
    ? `<label class="dockField"><span class="dockFieldLabel">Dock name</span><input class="dockInput" id="dockGroupName" type="text" value="${escapeHtml(suggestedName)}" /></label>`
    : "";

  modal.innerHTML = `
    <div class="dockModalHeader">
      <div class="dockModalTitle">${escapeHtml(title)}</div>
      ${subtitle ? `<div class="dockModalSub">${subtitle}</div>` : ""}
    </div>
    <div class="dockModalBody">
      ${nameHtml}
      ${colorHtml}
      ${selectHtml}
    </div>
    <div class="dockModalActions">
      <button class="dockBtn secondary" id="dockCancel" type="button">Cancel</button>
      <button class="dockBtn" id="dockSubmit" type="button">${escapeHtml(submitLabel)}</button>
    </div>
  `;

  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);

  const nameEl = modal.querySelector("#dockGroupName");
  const colorEl = modal.querySelector("#dockGroupColor");
  const selectEl = modal.querySelector("#dockWorkspaceSelect");
  const cancel = modal.querySelector("#dockCancel");
  const submit = modal.querySelector("#dockSubmit");
  const close = () => backdrop.remove();

  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });
  cancel?.addEventListener("click", close);
  submit?.addEventListener("click", async () => {
    const payload = {
      name: nameEl ? norm(nameEl.value) : "",
      color: colorEl ? colorEl.value : defaultColor,
      workspaceId: selectEl ? selectEl.value : ""
    };
    if (nameEl && !payload.name) return;
    await onSubmit(payload);
    close();
  });

  setTimeout(() => { try { (nameEl || selectEl || colorEl)?.focus(); if (nameEl) nameEl.select(); } catch {} }, 0);
}

function makeCard(tab, delHandler, noteHandler, opts = {}){
  const card = document.createElement("div");
  card.className = "card";

  const noteIdSource = String(tab?.__kind || 'item') + '-' + String(tab?.__index ?? '') + '-' + String(tab?.local_id || tab?.id || tab?.url || tab?.title || 'item').trim();
  const noteDomId = `dock-note-${(++cardInstanceCounter)}-${noteIdSource.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'item'}`;

  if (opts.selectable) {
    const wrap = document.createElement("label");
    wrap.className = "selWrap";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.className = "selBox";
    cb.checked = !!opts.checked;
    const onChange = () => {
      card.classList.toggle("isSelected", cb.checked);
      if (typeof opts.onChange === "function") opts.onChange(cb.checked);
    };
    cb.addEventListener("change", onChange);
    if (cb.checked) card.classList.add("isSelected");
    wrap.appendChild(cb);
    card.appendChild(wrap);
  }

  const preview = document.createElement("div");
  preview.className = "preview";
  const img = document.createElement("img");
  const isAdminCard = tab.__kind === "admin";
// Use persisted remote screenshot URLs first. Supabase returns `screenshot_url`,
// while older local/cache records may still use screenshotUrl/screenshotThumb/screenshot.
// Do not run real URLs through the local image cache; use them directly so hydrated
// memories keep their screenshots after sign-out/reload/reinstall.
const previewSource = String(
  tab.screenshot_url ||
  tab.screenshotUrl ||
  tab.screenshotThumb ||
  tab.screenshot ||
  tab.screenshot_data_url ||
  tab.customIcon ||
  tab.icon_url ||
  tab.previewImage ||
  tab.previewUrl ||
  tab.thumbnail ||
  tab.image ||
  ''
).trim();

const isDirectPreviewUrl = /^(https?:\/\/|data:image\/)/i.test(previewSource);
const cachedPreview = previewSource
  ? (isDirectPreviewUrl ? previewSource : retainCachedImage(previewSource))
  : '';
const previewSrc = isAdminCard
  ? (tab.customIcon || "assets/dock_logo.png")
  : (cachedPreview || getCachedImage(previewSource) || "assets/screenshot-unavailable.webp");

if (!isAdminCard && previewSource) {
  card.dataset.previewSource = previewSource;
}

img.loading = "lazy";
img.decoding = "async";
img.referrerPolicy = "no-referrer";
img.src = previewSrc || "assets/screenshot-unavailable.webp";
img.alt = "";

if (isAdminCard) {
  preview.classList.add("adminPreview");
  img.addEventListener("error", () => { img.src = "assets/dock_logo.png"; }, { once: true });
}

if (!isAdminCard) {
  img.addEventListener("error", () => {
    img.src = "assets/screenshot-unavailable.webp";
  }, { once: true });
}
  preview.appendChild(img);

  const content = document.createElement("div");
  content.className = "content";
  const title = document.createElement("div");
  title.className = "title";
  title.textContent = tab.title || "(untitled)";
  const url = document.createElement("a");
  url.className = "url";
  url.href = tab.url || "#";
  url.target = "_blank";
  url.rel = "noreferrer";
  const safeUrl = tab.url || "";
  url.textContent = safeUrl.replace(/^https?:\/\//, "").slice(0, 80) + (safeUrl.length > 80 ? "…" : "");

  const meta = document.createElement("div");
  meta.className = "noteMeta";
  const left = document.createElement("div");
  left.textContent = "";
  const right = document.createElement("div");
  right.textContent = tab.savedAt ? new Date(tab.savedAt).toLocaleString() : "";
  meta.append(left, right);

  const noteRow = document.createElement("div");
  noteRow.className = "dockNoteRow";
  const note = document.createElement("input");
  note.id = noteDomId;
  note.name = `dockNote-${noteDomId}`;
  note.setAttribute("aria-label", "Dock note");
  note.className = "dockNoteInput";
  note.type = "text";
  note.placeholder = opts.readOnlyNote ? "Dock" : "Note…";
  note.value = tab.reason || "";
  noteRow.appendChild(note);

  let tmr = null;
  const queueSave = () => {
    if (tmr) clearTimeout(tmr);
    tmr = setTimeout(async () => { await noteHandler(note.value); }, 350);
  };
  if (opts.readOnlyNote) {
    note.disabled = true;
    note.placeholder = opts.readOnlyPlaceholder || "Read only";
  } else {
    note.addEventListener("input", queueSave);
    note.addEventListener("blur", queueSave);
  }

  content.appendChild(title);
  content.appendChild(url);
  if (document.body.dataset.density !== "compact") {
    content.appendChild(meta);
    content.appendChild(noteRow);
  }

  const row = document.createElement("div");
  row.className = "row";
  const openBtn = document.createElement("button");
  openBtn.textContent = "Open";
  openBtn.addEventListener("click", async () => { if (tab.url) await openWorkspaceItems([tab]); });
  const delBtn = document.createElement("button");
  delBtn.className = "danger";
  delBtn.textContent = opts.lockDelete ? "Locked" : "Delete";
  if (opts.lockDelete) {
    delBtn.disabled = true;
    delBtn.classList.add("lockedBtn");
  } else {
    delBtn.addEventListener("click", delHandler);
  }
  row.append(openBtn, delBtn);

  card.append(preview, content, row);
  if (opts.sortableScope) {
    attachCardSort(card, tab, opts.sortableScope);
  }
  return card;
}

async function renderAllQuick(){
  const tabsRaw = await getSavedTabs({ localOnly: true });
  const tabs = (tabsRaw || []).map((t, idx) => ({ ...t, __kind: "main", __index: idx }));
  visible = tabs;
  try { dockApplyDistrictBackgroundFinal(); } catch {}
  if (!grid) return;
  cleanupGridImageRefs();
  grid.innerHTML = "";
  setEmpty(tabs.length === 0);
  if (!tabs.length) { updateActionButtons();
  try { dockLockDistrictBrandingIfNeeded(); } catch {}
  try { applyManagedDockBranding(activeGroup === "__admin__"); } catch {} return; }
  tabs.forEach(t => {
    const i = t.__index;
    const delHandler = async () => { await deleteTab(i); await load(); };
    const noteHandler = async (val) => {
      const all = await getSavedTabs({ localOnly: true });
      if (!all[i]) return;
      all[i] = { ...all[i], reason: val };
      await setSavedTabs(all);
    };
    grid.appendChild(makeCard(t, delHandler, noteHandler, {
      selectable: true,
      sortableScope: "__all__",
      checked: selectedMain.has(i) || isSelectedVisible(t),
      onChange: (checked) => {
        if (checked) selectedMain.add(i); else selectedMain.delete(i);
        toggleVisibleSelection(t, checked);
        updateActionButtons();
        updateWorkspaceButtons();
      }
    }));
  });
  updateActionButtons();
  updateWorkspaceButtons();
}


function hasMissingHydratablePreview(tab) {
  if (!tab || tab.screenshotBlocked) return false;
  const url = String(tab.url || '').trim();
  if (!/^https?:\/\//i.test(url)) return false;
  const preview = String(tab.screenshot || tab.screenshotThumb || tab.screenshot_data_url || '').trim();
  if (preview) return false;
  const previewMissing = !!tab.previewMissing;
  const previewCheckedAt = Number(tab.previewCheckedAt || 0);
  const retryAfterMs = 24 * 60 * 60 * 1000;
  if (!previewMissing) return true;
  if (!previewCheckedAt) return true;
  return (Date.now() - previewCheckedAt) > retryAfterMs;
}

let allMemoriesPreviewHydrationPromise = null;
let allMemoriesPreviewHydratedThisSession = false;
async function ensureAllMemoriesPreviewsHydrated() {
  // Production rule: do not auto-revalidate personal memories from remote during
  // normal All Memories rendering. Local runtime data is the source of truth.
  // Auto remote preview hydration was causing repeated background fetch churn.
  allMemoriesPreviewHydratedThisSession = true;
  return false;
}
let renderAllFullPromise = null;

async function renderAll(){
  try { dockRestoreSavedThemeOutsideDistrict(); } catch {}
  try { dockLockDistrictBrandingIfNeeded(); } catch {}
  applyManagedDockBranding(false);
  const localTabsRaw = await getSavedTabs({ localOnly: true });
  const tabs = (localTabsRaw || []).map((t, idx) => ({ ...t, __kind: "main", __index: idx }));
  visible = tabs;
  if (!grid) return;
  cleanupGridImageRefs();
  grid.innerHTML = "";
  setEmpty(tabs.length === 0);
  if (!tabs.length) {
    updateActionButtons();
    return;
  }

  const createCard = (t, enableNotes = false) => {
    const i = t.__index;
    const delHandler = async () => { await deleteTab(i); await load(); };
    const noteHandler = enableNotes ? async (val) => {
      const all = await getSavedTabs({ localOnly: true });
      if (!all[i]) return;
      all[i] = { ...all[i], reason: val };
      await setSavedTabs(all);
    } : null;

    return makeCard(t, delHandler, noteHandler, {
      selectable: true,
      sortableScope: "__all__",
      checked: selectedMain.has(i) || isSelectedVisible(t),
      onChange: (checked) => {
        if (checked) selectedMain.add(i); else selectedMain.delete(i);
        toggleVisibleSelection(t, checked);
        updateActionButtons();
        updateWorkspaceButtons();
      }
    });
  };

  const firstBatch = tabs.slice(0, FIRST_PAINT_BATCH);
  const rest = tabs.slice(FIRST_PAINT_BATCH);

  const firstNodes = firstBatch.map((t) => createCard(t, false));
  const frag = document.createDocumentFragment();
  firstNodes.forEach((n) => frag.appendChild(n));
  grid.appendChild(frag);
  updateActionButtons();

  await nextFrame();

  firstNodes.forEach((node, idx) => {
    const t = firstBatch[idx];
    const note = node.querySelector("textarea, input.note-input, .note-input");
    if (!note) return;
    note.addEventListener("change", async (e) => {
      const i = t.__index;
      const all = await getSavedTabs({ localOnly: true });
      if (!all[i]) return;
      all[i] = { ...all[i], reason: e.target.value };
      await setSavedTabs(all);
    });
  });

  for (let i = 0; i < rest.length; i += CHUNK_BATCH) {
    const chunk = rest.slice(i, i + CHUNK_BATCH);
    const chunkFrag = document.createDocumentFragment();
    const nodes = chunk.map((t) => createCard(t, false));
    nodes.forEach((n) => chunkFrag.appendChild(n));
    grid.appendChild(chunkFrag);
    updateActionButtons();
    await idlePause(0);
  }

  queueMicrotask(() => {
    ensureAllMemoriesPreviewsHydrated().then((changed) => {
      if (changed) load({ reason: "preview-hydrated", force: true }).catch(() => {});
    }).catch(() => {});
  });
}

async function renderAdmin(){
  try { dockClearVisualThemeForDistrict(); } catch {}
  try { dockLockDistrictBrandingIfNeeded(); } catch {}
  applyManagedDockBranding(true);
  const items = getAdminCards();
  visible = items;
  try { dockApplyDistrictBackgroundFinal(); } catch {}
  selectedMain.clear();
  clearVisibleSelection();
  if (!grid) return;
  cleanupGridImageRefs();
  grid.innerHTML = "";
  setEmpty(items.length === 0);
  if (!items.length) { updateActionButtons(); updateWorkspaceButtons(); return; }
  items.forEach(t => {
    grid.appendChild(makeCard(t, async () => {}, async () => {}, {
      selectable: true,
      checked: isSelectedVisible(t),
      onChange: (checked) => { toggleVisibleSelection(t, checked); updateActionButtons(); updateWorkspaceButtons(); },
      lockDelete: true,
      readOnlyNote: true,
      readOnlyPlaceholder: "Dock"
    }));
  });
  updateActionButtons();
  updateWorkspaceButtons();
}

async function renderGroup(groupId){
  try { if (groupId === "__admin__") dockClearVisualThemeForDistrict(); } catch {}
  try { dockLockDistrictBrandingIfNeeded(); } catch {}
  applyManagedDockBranding(false);
  const arr = normalizeOrderedItems(Array.isArray(groupItems[groupId]) ? groupItems[groupId] : [], groupId);
  groupItems[groupId] = arr;
  const items = arr.map((t, idx) => ({ ...t, __kind: "group", __index: idx }));
  visible = items;
  selectedMain.clear();
  clearVisibleSelection();
  if (!grid) return;
  cleanupGridImageRefs();
  grid.innerHTML = "";
  setEmpty(items.length === 0);
  if (!items.length) { updateActionButtons(); updateWorkspaceButtons(); return; }
  items.forEach(t => {
    const j = t.__index;
    const delHandler = async () => {
      const cur = Array.isArray(groupItems[groupId]) ? groupItems[groupId] : [];
      cur.splice(j, 1);
      groupItems[groupId] = cur;
      await saveState();
      await load();
    };
    const noteHandler = async (val) => {
      const cur = Array.isArray(groupItems[groupId]) ? groupItems[groupId] : [];
      if (!cur[j]) return;
      cur[j] = { ...cur[j], reason: val };
      groupItems[groupId] = cur;
      await saveState();
    };
    grid.appendChild(makeCard(t, delHandler, noteHandler, {
      selectable: true,
      sortableScope: groupId,
      checked: isSelectedVisible(t),
      onChange: (checked) => { toggleVisibleSelection(t, checked); updateActionButtons(); updateWorkspaceButtons(); }
    }));
  });
  updateActionButtons();
  updateWorkspaceButtons();
}



function getAdminSelectedCloneItemsSafe(){
  try {
    if (typeof getSelectedCloneItems === "function") {
      const selected = getSelectedCloneItems();
      if (Array.isArray(selected) && selected.length) return selected;
    }
  } catch {}

  try {
    const source = Array.isArray(adminWorkspace?.tabs) ? adminWorkspace.tabs : [];
    return source
      .filter(t => isSelectedVisible(t))
      .map(t => cloneMemoryItem(t));
  } catch {}

  return [];
}

/* === FINAL: Dock It selected snapshot helpers === */
function getDockItSelectedItemsNow() {
  const selected = [];

  try {
    const cards = Array.from(grid?.querySelectorAll(".card") || []);
    cards.forEach((card, index) => {
      const cb = card.querySelector('input.selBox[type="checkbox"], input[type="checkbox"]');
      if (!cb || !cb.checked) return;

      const item = Array.isArray(visible) ? visible[index] : null;
      if (item && (item.url || item.title)) {
        selected.push({ ...item });
      }
    });
  } catch {}

  if (selected.length) return selected;

  try {
    const fallback = getSelectedVisibleItems();
    if (Array.isArray(fallback) && fallback.length) {
      return fallback.map(item => ({ ...item })).filter(item => item && (item.url || item.title));
    }
  } catch {}

  return [];
}

function getDockItSelectedCountNow() {
  try {
    const domCount = Array.from(grid?.querySelectorAll(".card") || []).filter((card) => {
      const cb = card.querySelector('input.selBox[type="checkbox"], input[type="checkbox"]');
      return !!cb?.checked;
    }).length;

    if (domCount) return domCount;
  } catch {}

  try {
    return getSelectedVisibleItems().length;
  } catch {}

  return 0;
}

async function createDockFromSelection(selectionSnapshot = null) {
  const selectedAtClick = Array.isArray(selectionSnapshot) && selectionSnapshot.length
    ? selectionSnapshot.map(item => ({ ...item })).filter(item => item && (item.url || item.title))
    : getDockItSelectedItemsNow();

  if (!selectedAtClick.length) {
    alert("Select one or more memories first.");
    return;
  }

  if (!(await requirePersonalSignIn())) return;
  await loadState();

  const selected = selectedAtClick
    .map(cloneMemoryItem)
    .filter(item => item && (item.url || item.title));

  if (!selected.length) {
    alert("Select one or more memories first.");
    return;
  }

  openWorkspaceModal({
    title: "Create Dock",
    subtitle: `This will copy ${selected.length} tab(s) into a new Dock.`,
    submitLabel: "Create",
    suggestedName: "Dock - " + new Date().toLocaleDateString(),
    defaultColor: DEFAULT_GROUP_COLOR,
    showColor: true,
    onSubmit: async ({ name, color }) => {
      const id = "g_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(2, 6);
      groups.push({ id, name, color: norm(color) || DEFAULT_GROUP_COLOR, createdAt: Date.now() });
      groupItems[id] = normalizeOrderedItems(selected.map(cloneMemoryItem), id);
      selectedMain.clear();
      clearVisibleSelection();
      activeGroup = id;
      await saveState();
      await load();
    }
  });
}

async function addSelectedToDock(targetDockId) {
  if (!(await requirePersonalSignIn())) return;
  await loadState();
  const selected = getSelectedCloneItems();
  if (!selected.length) {
    alert("Select one or more memories first.");
    return;
  }
  addItemsToGroup(targetDockId, selected);
  selectedMain.clear();
  clearVisibleSelection();
  await saveState();
  await load();
}

async function addAllFromCurrentDock(targetDockId) {
  if (!(await requirePersonalSignIn())) return;
  await loadState();
  let sourceItems = [];
  if (activeGroup === "__all__") sourceItems = await getNormalizedSavedTabs();
  else if (activeGroup && activeGroup !== "__admin__") sourceItems = normalizeOrderedItems(Array.isArray(groupItems[activeGroup]) ? groupItems[activeGroup] : [], activeGroup);
  else if (activeGroup === "__admin__") sourceItems = normalizeOrderedItems(Array.isArray(adminWorkspace?.tabs) ? adminWorkspace.tabs : [], "__admin__");
  if (!sourceItems.length) {
    alert("There are no Docks to copy from this view.");
    return;
  }
  addItemsToGroup(targetDockId, sourceItems.map(cloneMemoryItem));
  await saveState();
  await load();
}

async function editDockById(groupId) {
  if (!(await requirePersonalSignIn())) return;
  await loadState();
  if (groupId === "__admin__") {
    alert("Dock is locked.");
    return;
  }
  const group = (groups || []).find(g => g.id === groupId);
  if (!group) return;
  openWorkspaceModal({
    title: "Edit Dock",
    subtitle: "Update the Dock name and color.",
    submitLabel: "Save",
    suggestedName: group.name || "Dock",
    defaultColor: ensureGroupColor(group),
    showColor: true,
    onSubmit: async ({ name, color }) => {
      groups = (groups || []).map(g => g.id === group.id ? { ...g, name, color: norm(color) || DEFAULT_GROUP_COLOR } : g);
      await saveState();
      await load();
    }
  });
}

let activeDockPillMenu = null;

function positionDockPillMenu(menu, anchorBtn) {
  if (!menu || !anchorBtn) return;

  const gap = 8;
  const pad = 12;
  const rect = anchorBtn.getBoundingClientRect();

  menu.style.setProperty("position", "fixed", "important");
  menu.style.setProperty("left", "0px", "important");
  menu.style.setProperty("top", "0px", "important");
  menu.style.setProperty("right", "auto", "important");
  menu.style.setProperty("bottom", "auto", "important");
  menu.style.setProperty("z-index", "99999", "important");
  menu.style.setProperty("visibility", "hidden", "important");

  if (menu.parentNode !== document.body) {
    document.body.appendChild(menu);
  }

  menu.classList.remove("hidden");

  const menuRect = menu.getBoundingClientRect();

  const maxLeft = Math.max(pad, window.innerWidth - menuRect.width - pad);
  const left = Math.min(Math.max(pad, rect.right - menuRect.width), maxLeft);

  let top = rect.bottom + gap;
  if (top + menuRect.height > window.innerHeight - pad) {
    top = Math.max(pad, rect.top - menuRect.height - gap);
  }

  menu.style.setProperty("left", `${left}px`, "important");
  menu.style.setProperty("top", `${top}px`, "important");
  menu.style.setProperty("visibility", "visible", "important");
}

function openDockPillMenu(menu, anchorBtn) {
  if (!menu || !anchorBtn) return;

  const sameMenuAlreadyOpen =
    activeDockPillMenu === menu && !menu.classList.contains("hidden");

  closeDockPillMenus();
  if (sameMenuAlreadyOpen) return;

  menu.__dockAnchorBtn = anchorBtn;
  activeDockPillMenu = menu;
  positionDockPillMenu(menu, anchorBtn);
}

function closeDockPillMenus() {
  document.querySelectorAll(".groupPillMenu").forEach((el) => {
    el.classList.add("hidden");
    el.style.removeProperty("position");
    el.style.removeProperty("left");
    el.style.removeProperty("top");
    el.style.removeProperty("right");
    el.style.removeProperty("bottom");
    el.style.removeProperty("z-index");
    el.style.removeProperty("visibility");

    if (el.__dockHome && el.parentNode !== el.__dockHome) {
      el.__dockHome.appendChild(el);
    }
  });

  activeDockPillMenu = null;
}// Delegated fallback to ensure dock pill controls remain clickable even when styles shift.
groupPills?.addEventListener("click", async (e) => {
  const menuBtn = e.target.closest(".groupPillMenuBtn");
  if (menuBtn) {
    e.preventDefault();
    e.stopPropagation();
    const wrap = menuBtn.closest(".groupPillWrap");
    const menu = menuBtn.__dockMenu || wrap?.__dockMenu || wrap?.querySelector(".groupPillMenu");
    openDockPillMenu(menu, menuBtn);
    return;
  }
});




document.addEventListener("click", () => {
  closeDockPillMenus();
});
window.addEventListener("resize", () => {
  if (activeDockPillMenu && activeDockPillMenu.__dockAnchorBtn) {
    positionDockPillMenu(activeDockPillMenu, activeDockPillMenu.__dockAnchorBtn);
  }
});

window.addEventListener("scroll", () => {
  if (activeDockPillMenu && activeDockPillMenu.__dockAnchorBtn) {
    positionDockPillMenu(activeDockPillMenu, activeDockPillMenu.__dockAnchorBtn);
  }
}, true);



/* === FINAL: one clean Dock It path === */



/* === FINAL: one clean Dock It click path === */
createGroupBtn?.addEventListener("click", async (event) => {
  event?.preventDefault?.();
  event?.stopPropagation?.();

  try { closeMenus(); } catch {}

  const selectionSnapshot = getDockItSelectedItemsNow();
  await createDockFromSelection(selectionSnapshot);
});

addBtn?.addEventListener("click", async () => {
  if (!(await requirePersonalSignIn())) return;
  await loadState();
  if (activeGroup === "__admin__") {
    alert("Dock is locked.");
    return;
  }
  const selected = getSelectedCloneItems();
  if (!selected.length) {
    alert("Select one or more memories first.");
    return;
  }
  const targetChoices = (groups || [])
    .filter(g => g.id !== activeGroup)
    .map(g => ({ id: g.id, name: g.name || "Dock" }));
  if (!targetChoices.length) {
    alert("Create another Dock first.");
    return;
  }
  openWorkspaceModal({
    title: "Add to Dock",
    subtitle: `This will copy <b>${selected.length}</b> tab(s) into an existing Dock.`,
    submitLabel: "Add",
    suggestedName: null,
    workspaceChoices: targetChoices,
    onSubmit: async ({ workspaceId }) => {
      addItemsToGroup(workspaceId, selected);
      selectedMain.clear();
      clearVisibleSelection();
      await saveState();
      await load();
    }
  });
});

editGroupBtn?.addEventListener("click", async () => {
  if (!(await requirePersonalSignIn())) return;
  await loadState();
  if (activeGroup === "__admin__") {
    alert("Dock is locked.");
    return;
  }
  const group = currentGroupRecord();
  if (!group) {
    alert("Open a Dock first.");
    return;
  }
  openWorkspaceModal({
    title: "Edit Dock",
    subtitle: "Update the Dock name and color.",
    submitLabel: "Save",
    suggestedName: group.name || "Dock",
    defaultColor: ensureGroupColor(group),
    showColor: true,
    onSubmit: async ({ name, color }) => {
      groups = (groups || []).map(g => g.id === group.id ? { ...g, name, color: norm(color) || DEFAULT_GROUP_COLOR } : g);
      await saveState();
      await load();
    }
  });
});

refreshBtn?.addEventListener("click", () => { hydratePage({ forceSync: true }).catch(() => {}); });
openAllBtn?.addEventListener("click", async (e) => {
  e?.preventDefault?.();
  e?.stopPropagation?.();
  closeMenus();
  const items = getVisibleOpenableItems();
  if (items.length) await openWorkspaceItems(items);
});
openSelectedBtn?.addEventListener("click", async (e) => {
  e?.preventDefault?.();
  e?.stopPropagation?.();
  closeMenus();
  const items = getSelectedVisibleItems().filter(v => v?.url);
  if (!items.length) return alert("Select one or more tabs first.");
  await openWorkspaceItems(items);
});

closeOtherTabsBtn?.addEventListener("click", async () => {
  closeMenus();
  if (!confirm("Close all other tabs and keep Dock open?")) return;
  setButtonBusy(closeOtherTabsBtn, true, "Relaxing…", "Relax");
  showCalmToast({
    title: "Relax",
    detail: "Dock is clearing the extra tabs and keeping your harbor open.",
    tone: "working"
  });
  try {
    let result = await sendRuntimeMessageSafe({ type: "CLOSE_ALL_OTHER_TABS" });
    if (!result?.ok) {
      DEBUG && console.warn("Dock Relax background close failed; using direct fallback.", result?.error || result);
      result = await closeAllOtherTabsDirectFallback();
    }
    if (!result?.ok) throw new Error(result?.error || "Failed to close tabs.");
    showCalmToast({
      title: "Relax",
      detail: result?.closedCount
        ? `${result.closedCount} tab${result.closedCount === 1 ? " was" : "s were"} cleared.`
        : "Dock is the only tab still open.",
      tone: "success",
      duration: 2500
    });
  } catch (error) {
    hideCalmToast();
    showCalmToast({
      title: "Still here",
      detail: error?.message || "Failed to close tabs.",
      tone: "error",
      duration: 3200
    });
    alert(error?.message || "Failed to close tabs.");
  } finally {
    setButtonBusy(closeOtherTabsBtn, false, "Relaxing…", "Relax");
  }
});


function sendRuntimeMessageSafe(message) {
  return new Promise((resolve) => {
    try {
      const runtime = globalThis.chrome?.runtime || api?.runtime;
      if (!runtime?.sendMessage) {
        resolve({ ok: false, error: "Runtime messaging unavailable." });
        return;
      }

      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        resolve(value || { ok: false, error: "No response from background." });
      };

      const maybePromise = runtime.sendMessage(message, (response) => {
        const lastError = globalThis.chrome?.runtime?.lastError;
        if (lastError) {
          finish({ ok: false, error: lastError.message || "Runtime message failed." });
          return;
        }
        finish(response);
      });

      if (maybePromise && typeof maybePromise.then === "function") {
        maybePromise.then(finish).catch((error) => {
          finish({ ok: false, error: error?.message || "Runtime message failed." });
        });
      }

      setTimeout(() => finish({ ok: false, error: "Background did not respond." }), 2500);
    } catch (error) {
      resolve({ ok: false, error: error?.message || "Runtime message failed." });
    }
  });
}

function chromeTabsCall(method, ...args) {
  return new Promise((resolve, reject) => {
    try {
      const tabsApi = globalThis.chrome?.tabs || api?.tabs;
      if (!tabsApi?.[method]) {
        reject(new Error(`chrome.tabs.${method} unavailable.`));
        return;
      }

      let settled = false;
      const finish = (value, error) => {
        if (settled) return;
        settled = true;
        if (error) reject(error);
        else resolve(value);
      };

      const maybePromise = tabsApi[method](...args, (value) => {
        const lastError = globalThis.chrome?.runtime?.lastError;
        if (lastError) finish(null, new Error(lastError.message || `chrome.tabs.${method} failed.`));
        else finish(value);
      });

      if (maybePromise && typeof maybePromise.then === "function") {
        maybePromise.then((value) => finish(value)).catch((error) => finish(null, error));
      }
    } catch (error) {
      reject(error);
    }
  });
}

async function closeAllOtherTabsDirectFallback() {
  const keepTab = await chromeTabsCall("getCurrent");
  if (!keepTab?.id) return { ok: false, error: "Dock tab not found." };

  const tabs = await chromeTabsCall("query", {});
  const toClose = (Array.isArray(tabs) ? tabs : [])
    .filter(tab => tab?.id != null && tab.id !== keepTab.id)
    .map(tab => tab.id);

  let closedCount = 0;
  const failed = [];
  for (const tabId of toClose) {
    try {
      await chromeTabsCall("remove", tabId);
      closedCount += 1;
    } catch {
      failed.push(tabId);
    }
  }

  await keepDockAsFirstTab(keepTab);

  if (failed.length && closedCount === 0) {
    return { ok: false, error: `Failed to close ${failed.length} tab${failed.length === 1 ? "" : "s"}.`, closedCount };
  }

  return { ok: true, closedCount, failedCount: failed.length, keptTabId: keepTab.id };
}

async function deleteSelectedInCurrentView() {
  const items = getSelectedVisibleItems();
  if (!items.length) return;
  if (activeGroup === "__admin__") return alert("Dock is locked.");
  if (!confirm(`Delete ${items.length} selected item${items.length === 1 ? "" : "s"}?`)) return;

  if (activeGroup === "__all__") {
    const all = await getSavedTabs({ localOnly: true });
    const selectedMainItems = items.filter(v => v.__kind === "main");
    const indices = selectedMainItems.map(v => v.__index).sort((a,b) => b-a);
    const removedTabs = selectedMainItems.map((v) => all[v.__index]).filter(Boolean);
    for (const idx of indices) all.splice(idx, 1);
    await setSavedTabs(all, { removedTabs });
  } else {
    const cur = Array.isArray(groupItems[activeGroup]) ? groupItems[activeGroup] : [];
    const indices = items.filter(v => v.__kind === "group").map(v => v.__index).sort((a,b) => b-a);
    for (const idx of indices) cur.splice(idx, 1);
    groupItems[activeGroup] = cur;
    await saveState();
  }
  selectedMain.clear();
  clearVisibleSelection();
  await load();
}

deleteSelectedBtn?.addEventListener("click", async () => { closeMenus(); await deleteSelectedInCurrentView(); });
clearAllBtn?.addEventListener("click", async () => {
  closeMenus();
  if (activeGroup === "__admin__") return alert("Dock is locked.");
  const msg = activeGroup === "__all__"
    ? "Delete all Docks on this page? Other Docks will stay intact."
    : "Delete all tabs in this Dock? The Dock itself will stay.";
  if (!confirm(msg)) return;
  if (activeGroup === "__all__") {
    const all = await getSavedTabs({ localOnly: true });
    await setSavedTabs([], { removedTabs: all });
  }
  else { groupItems[activeGroup] = []; await saveState(); }
  selectedMain.clear();
  clearVisibleSelection();
  await load();
});

createShareLinkBtn?.addEventListener("click", async (e) => { e.stopPropagation(); await createShareLinkForActiveWorkspace(); });
themeMenuBtn?.addEventListener("click", (e) => {
  e.stopPropagation();

  // District Dock is admin-branded. User theme menu is disabled there.
  if (dockIsManagedDistrictActive()) {
    dockLockDistrictBrandingIfNeeded();
    return;
  }

  const willShow = themeMenu?.classList.contains("hidden");
  closeMenus();
  if (willShow) themeMenu?.classList.remove("hidden");
});
themeItems.forEach(btn => btn.addEventListener("click", async (e) => { e.stopPropagation(); await saveTheme(btn.dataset.theme || DEFAULT_THEME); closeMenus(); }));
actionsMenuBtn?.addEventListener("click", (e) => {
  e.preventDefault();
  e.stopPropagation();
  dockTagActionMenuUi();
  updateActionButtons();
  const willShow = actionsMenu?.classList.contains("hidden");
  closeMenus();
  if (willShow) actionsMenu?.classList.remove("hidden");
});
function bindNestedMenu(toggleEl, panelEl, otherPanelEl){
  if (!toggleEl || !panelEl) return;
  toggleEl.dataset.dockUi = toggleEl.dataset.dockUi || "action-menu-toggle";
  panelEl.dataset.dockUi = panelEl.dataset.dockUi || "action-submenu";
  toggleEl.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    dockTagActionMenuUi();
    updateActionButtons();

    const willShow = panelEl.classList.contains("hidden");
    if (otherPanelEl) otherPanelEl.classList.add("hidden");
    panelEl.classList.toggle("hidden", !willShow);
    panelEl.style.pointerEvents = willShow ? "auto" : "";
    panelEl.style.zIndex = willShow ? "2147483647" : "";
    toggleEl.classList.toggle("isOpen", willShow);
    if (otherPanelEl === openSubmenu) openMenuToggle?.classList.remove("isOpen");
    if (otherPanelEl === deleteSubmenu) deleteMenuToggle?.classList.remove("isOpen");
  });
}
bindNestedMenu(openMenuToggle, openSubmenu, deleteSubmenu);
bindNestedMenu(deleteMenuToggle, deleteSubmenu, openSubmenu);
document.addEventListener("click", () => closeMenus());
actionsMenu?.addEventListener("click", (e) => e.stopPropagation());
openSubmenu?.addEventListener("click", (e) => e.stopPropagation());
deleteSubmenu?.addEventListener("click", (e) => e.stopPropagation());
shareMenu?.addEventListener("click", (e) => e.stopPropagation());
themeMenu?.addEventListener("click", (e) => e.stopPropagation());

groupPills?.addEventListener("dragover", (e) => {
  if (!dragGroupId) return;
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
  updateGroupDropTarget(e.clientX);
});

groupPills?.addEventListener("drop", async (e) => {
  if (!dragGroupId) return;
  e.preventDefault();
  updateGroupDropTarget(e.clientX);
  const moved = moveGroupRelative(dragGroupId, dragTargetGroupId, dragDropMode);
  const movedId = dragGroupId;
  dragGroupId = null;
  dragDropMode = "before";
  dragTargetGroupId = null;
  clearGroupDropMarkers();
  if (!moved) return;
  activeGroup = movedId || activeGroup;
  await saveState();
  await load();
});

groupPills?.addEventListener("dragleave", (e) => {
  if (!dragGroupId) return;
  const rel = e.relatedTarget;
  if (rel && groupPills.contains(rel)) return;
  clearGroupDropMarkers();
});

densityToggleBtn?.addEventListener("click", async (e) => { e.stopPropagation(); await toggleDensity(); });

let scheduledLoadTimer = null;
let scheduledLoadReason = "";
function scheduleLoad(reason = "storage", delay = 140) {
  scheduledLoadReason = reason;
  if (scheduledLoadTimer) clearTimeout(scheduledLoadTimer);
  scheduledLoadTimer = setTimeout(() => {
    const why = scheduledLoadReason;
    scheduledLoadReason = "";
    scheduledLoadTimer = null;
    load({ reason: why }).catch(() => {});
  }, delay);
}

if (api.storage?.onChanged?.addListener) {
  api.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;
    if (changes?.[THEME_KEY]) applyTheme(changes[THEME_KEY].newValue || DEFAULT_THEME);
    if (changes?.[DENSITY_KEY]) applyDensity(changes[DENSITY_KEY].newValue || DEFAULT_DENSITY);
    const contentChanged = changes?.dockGroups || changes?.dockGroupItems || changes?.savedTabs || changes?.dockAdminWorkspace || changes?.dockManagedWorkspace;
    const shellChanged = changes?.dockManagedMeta || changes?.dockOrg;
    if (contentChanged) scheduleLoad("content", 80);
    else if (shellChanged) scheduleLoad("shell", 180);
  });
}

authBtn?.addEventListener("click", async () => {
  const auth = await getAuthSummary();
  if (auth.signedIn) {
    await signOut();
  } else {
    try {
      await ensureSignedInInteractive();
      await recoverSavedTabsFromRemote();
      await load({ reason: "auth-hydrate", force: true });
    } catch (error) { alert(error?.message || "Google sign-in failed."); }
  }
  await refreshAuthUi();
});

window.addEventListener("resize", syncStickyOffsets);
window.addEventListener("load", syncStickyOffsets);

let localLoadPromise = null;
let pendingLocalLoad = false;
let managedHydratePromise = null;
let lastRenderSignature = "";


function buildTabsRenderHash(tabs = []) {
  return JSON.stringify((Array.isArray(tabs) ? tabs : []).map((tab, index) => ({
    key: String(tab?.id || tab?.local_id || tab?.url || `${tab?.title || ''}:${index}`),
    title: String(tab?.title || ''),
    url: String(tab?.url || ''),
    reason: String(tab?.reason || ''),
    savedAt: Number(tab?.savedAt || 0),
    screenshotBlocked: !!tab?.screenshotBlocked,
    hasPreview: !!String(tab?.screenshot_url || tab?.screenshotUrl || tab?.screenshotThumb || tab?.screenshot || tab?.screenshot_data_url || '').trim(),
    previewKey: getPreviewIdentity(tab)
  })));
}


async function computeRenderSignature() {
  const [themeRes, densityRes, state, savedTabs, managedWs] = await Promise.all([
    api.storage.local.get([THEME_KEY]),
    api.storage.local.get([DENSITY_KEY]),
    api.storage.local.get(["dockGroups", "dockGroupItems", "dockActiveGroup"]),
    api.storage.local.get(["savedTabs"]),
    api.storage.local.get(["dockManagedWorkspace"])
  ]);

  const savedTabsLite = (Array.isArray(savedTabs?.savedTabs) ? savedTabs.savedTabs : []).map((tab, index) => ({
    key: String(tab?.id || tab?.local_id || tab?.url || `${tab?.title || ''}:${index}`),
    title: String(tab?.title || ''),
    url: String(tab?.url || ''),
    reason: String(tab?.reason || ''),
    savedAt: Number(tab?.savedAt || 0),
    screenshotBlocked: !!tab?.screenshotBlocked,
    hasPreview: !!String(tab?.screenshot_url || tab?.screenshotUrl || tab?.screenshotThumb || tab?.screenshot || tab?.screenshot_data_url || '').trim(),
    previewKey: getPreviewIdentity(tab)
  }));

  const groupItems = state?.dockGroupItems || {};
  const groupItemsLite = Object.fromEntries(Object.entries(groupItems).map(([groupId, tabs]) => [
    groupId,
    (Array.isArray(tabs) ? tabs : []).map((tab, index) => ({
      key: String(tab?.id || tab?.local_id || tab?.url || `${tab?.title || ''}:${index}`),
      title: String(tab?.title || ''),
      url: String(tab?.url || ''),
      reason: String(tab?.reason || ''),
      savedAt: Number(tab?.savedAt || 0),
      screenshotBlocked: !!tab?.screenshotBlocked,
      hasPreview: !!String(tab?.screenshot_url || tab?.screenshotUrl || tab?.screenshotThumb || tab?.screenshot || tab?.screenshot_data_url || '').trim(),
    previewKey: getPreviewIdentity(tab)
    }))
  ]));

  const managedTabsLite = (Array.isArray(managedWs?.dockManagedWorkspace?.tabs) ? managedWs.dockManagedWorkspace.tabs : []).map((tab, index) => ({
    key: String(tab?.id || tab?.local_id || tab?.url || `${tab?.title || ''}:${index}`),
    title: String(tab?.title || ''),
    url: String(tab?.url || ''),
    reason: String(tab?.reason || ''),
    savedAt: Number(tab?.savedAt || 0),
    screenshotBlocked: !!tab?.screenshotBlocked,
    hasPreview: !!String(tab?.screenshot_url || tab?.screenshotUrl || tab?.screenshotThumb || tab?.screenshot || tab?.screenshot_data_url || '').trim(),
    previewKey: getPreviewIdentity(tab)
  }));

  return JSON.stringify({
    theme: String(themeRes?.[THEME_KEY] || DEFAULT_THEME),
    density: String(densityRes?.[DENSITY_KEY] || DEFAULT_DENSITY),
    activeGroup: String(state?.dockActiveGroup || "__all__"),
    groups: state?.dockGroups || [],
    groupItems: groupItemsLite,
    savedTabs: savedTabsLite,
    managed: managedTabsLite
  });
}

async function runLocalLoad() {
  await refreshAuthUi();
  await loadTheme();
  await loadDensity();
  await loadState();
  adminWorkspace = await getAdminWorkspace();
  clearVisibleSelection();
  renderPills();
  if (activeGroup === "__all__") await renderAll();
  else if (activeGroup === "__admin__") await renderAdmin();
  else await renderGroup(activeGroup);
  updateActionButtons();
  updateWorkspaceButtons();
}

async function load({ reason = "manual", force = false } = {}) {
  if (localLoadPromise) {
    pendingLocalLoad = true;
    return localLoadPromise;
  }
  localLoadPromise = (async () => {
    const beforeSignature = await computeRenderSignature();
    if (!force && beforeSignature === lastRenderSignature && reason !== "manual") {
      return;
    }
    await runLocalLoad();
    lastRenderSignature = await computeRenderSignature();
  })();
  try {
    return await localLoadPromise;
  } finally {
    localLoadPromise = null;
    if (pendingLocalLoad) {
      pendingLocalLoad = false;
      queueMicrotask(() => { load({ reason: "queued" }).catch(() => {}); });
    }
  }
}

async function hydratePage({ forceSync = false } = {}) {
  if (managedHydratePromise) return managedHydratePromise;
  managedHydratePromise = (async () => {
    try {
      const [auth, localTabs] = await Promise.all([getAuthSummary(), getSavedTabs({ localOnly: true })]);
      if (auth?.signedIn && !localTabs.length) await recoverSavedTabsFromRemote();
    } catch {}
    await load();
    if (!forceSync) return;
    try { await ensureManagedBootstrap(); } catch {}
    const beforeWorkspace = JSON.stringify(await api.storage.local.get(["dockManagedWorkspace", "dockManagedMeta", "dockOrg"]));
    try { await syncManagedWorkspace({ force: true }); } catch {}
    const afterWorkspace = JSON.stringify(await api.storage.local.get(["dockManagedWorkspace", "dockManagedMeta", "dockOrg"]));
    if (beforeWorkspace !== afterWorkspace) {
      await load({ reason: "managed-sync", force: true });
    }
  })();
  try {
    return await managedHydratePromise;
  } finally {
    managedHydratePromise = null;
  }
}

let hasInitialized = false;

async function init() {
  if (hasInitialized) return;
  hasInitialized = true;
  await keepDockAsFirstTab();
  await hydratePage({ forceSync: true });
  await keepDockAsFirstTab();
}

init().catch(() => {});



/* === Hide centered Dock watermark on managed district dock === */
(function(){
  function isManagedDistrictDock(){
    return document.body && document.body.dataset.managedDock === "true";
  }

  function looksLikeCenterDockWatermark(el){
    if (!el || !el.getBoundingClientRect) return false;

    const protectedUiSelector = [
      '[data-dock-ui]',
      '.dockModalBackdrop', '.dockModal',
      '.modalBackdrop', '.modal',
      '.workspaceModalBackdrop', '.workspaceModal',
      '.createDockBackdrop', '.createDockModal',
      '.backdrop', '.overlay', '.dialog', '[role="dialog"]',
      '.menuPanel', '.actionsMenuPanel', '.themeMenuPanel', '.subMenuPanel',
      '.groupPillMenu', '.popover', '.dropdown',
      '.card', '.memoryCard', '.previewCard',
      'button', 'input', 'select', 'textarea', 'a'
    ].join(',');

    if (el.matches?.(protectedUiSelector) || el.closest?.(protectedUiSelector)) return false;

    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth || document.documentElement.clientWidth || 0;
    const vh = window.innerHeight || document.documentElement.clientHeight || 0;

    if (!vw || !vh) return false;

    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;

    const isBigEnough = rect.width >= 160 && rect.height >= 90;
    const isCenteredX = cx > vw * 0.30 && cx < vw * 0.72;
    const isLowerThanHeader = cy > vh * 0.28;
    const isNotCard = !el.closest(".card,.memoryCard,.previewCard,.menuPanel,.dockModal,.dockDrawer,.saveDrawer,#themeMenu,.themeMenuPanel,header,.header,.topBar,.groupBar,.groupPillWrap,.groupPillsRail,nav");

    const txt = String(el.textContent || "").trim().toLowerCase();
    const alt = String(el.getAttribute?.("alt") || "").toLowerCase();
    const src = String(el.getAttribute?.("src") || el.currentSrc || "").toLowerCase();
    const cls = String(el.className || "").toLowerCase();

    const looksDock =
      txt === "dock" ||
      alt.includes("dock") ||
      src.includes("dock") ||
      cls.includes("dock") ||
      cls.includes("logo") ||
      cls.includes("empty") ||
      cls.includes("watermark");

    return isBigEnough && isCenteredX && isLowerThanHeader && isNotCard && looksDock;
  }

  function hideCenterDockWatermark(){
    if (!isManagedDistrictDock()) return;

    const els = Array.from(document.querySelectorAll("img, svg, picture, canvas, div, section, main"));
    for (const el of els) {
      if (looksLikeCenterDockWatermark(el)) {
        el.style.setProperty("display", "none", "important");
        el.style.setProperty("visibility", "hidden", "important");
        el.style.setProperty("opacity", "0", "important");
        el.setAttribute("data-hidden-managed-dock-watermark", "true");
      }
    }
  }

  function start(){
    hideCenterDockWatermark();

    if (window.__dockHideCenterWatermarkTimer) return;

    window.__dockHideCenterWatermarkTimer = window.setInterval(() => {
      try { hideCenterDockWatermark(); } catch {}
    }, 350);

    try {
      const obs = new MutationObserver(() => {
        try { hideCenterDockWatermark(); } catch {}
      });
      obs.observe(document.body, { childList: true, subtree: true, attributes: true });
      window.__dockHideCenterWatermarkObserver = obs;
    } catch {}
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }

  window.dockHideCenterDockWatermark = hideCenterDockWatermark;
})();
