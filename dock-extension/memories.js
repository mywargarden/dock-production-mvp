import { getSavedTabs, deleteTab, setSavedTabs, loadGroupState, saveGroupState, getAdminWorkspace, ensureHardcodedManagedBootstrap, syncManagedWorkspace } from "./core/storage.js";
import { api } from "./adapters/index.js";
import { ensureActiveGroup } from "./core/groupEngine.js";

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
const shareMenuBtn = document.getElementById("shareMenuBtn");
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

const THEME_KEY = "dockTheme";
const DENSITY_KEY = "dockDensity";
const DEFAULT_THEME = "dock-green";
const DEFAULT_DENSITY = "full";
const DEFAULT_GROUP_COLOR = "#6f4cff";
const THEMES = new Set(["dock-green","dock-blue","slate","warm","light","tie-dye"]);

let activeGroup = "__all__";
let groups = [];
let groupItems = {};
let visible = [];
let selectedMain = new Set();
let selectedVisible = new Set();
let adminWorkspace = null;
let dragGroupId = null;
let dragDropMode = "before";
let dragTargetGroupId = null;
let pointerSortState = null;


function norm(s){ return String(s || "").trim(); }
function escapeHtml(s){ return String(s || "").replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function itemKey(tab){ return `${tab.__kind}:${tab.__index}:${tab.url || ''}:${tab.title || ''}`; }
function isSelectedVisible(tab){ return selectedVisible.has(itemKey(tab)); }
function toggleVisibleSelection(tab, checked){ const key = itemKey(tab); if (checked) selectedVisible.add(key); else selectedVisible.delete(key); }
function clearVisibleSelection(){ selectedVisible.clear(); }
function getSelectedVisibleItems(){ return (visible || []).filter(v => isSelectedVisible(v)); }
function canDeleteCurrentView(){ return activeGroup !== "__admin__"; }
function currentGroupRecord(){ return (groups || []).find(g => g.id === activeGroup) || null; }
function ensureGroupColor(group){ return norm(group?.color) || DEFAULT_GROUP_COLOR; }

function applyTheme(theme){
  const next = THEMES.has(theme) ? theme : DEFAULT_THEME;
  document.body.dataset.theme = next;
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
function setEmpty(on){ if (emptyState) emptyState.style.display = on ? "block" : "none"; }

async function loadState(){
  const st = await loadGroupState();
  groups = Array.isArray(st.groups) ? st.groups.map(g => ({ ...g, color: ensureGroupColor(g) })) : [];
  groupItems = (st.groupItems && typeof st.groupItems === "object") ? st.groupItems : {};
  normalizeAllGroupItemsInMemory();
  activeGroup = ensureActiveGroup(groups, st.activeGroup);
}
async function saveState(){
  await saveGroupState({ groups, groupItems, activeGroup });
}

function getVisibleOpenableItems(){ return (visible || []).filter(v => v?.url); }
async function openWorkspaceItems(items){
  for (const item of items) {
    if (item?.url) await api.tabs.create({ url: item.url });
  }
}
function getAdminCards(){
  return Array.isArray(adminWorkspace?.tabs) ? adminWorkspace.tabs.map((t, idx) => ({ ...t, __kind: "admin", __index: idx })) : [];
}
function getFaviconUrl(rawUrl){
  try {
    const u = new URL(rawUrl);
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(u.hostname)}&sz=128`;
  } catch { return ""; }
}
function cloneMemoryItem(item){
  const out = { ...item };
  delete out.__kind;
  delete out.__index;
  return out;
}
function getSelectedCloneItems(){
  return getSelectedVisibleItems().map(cloneMemoryItem);
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
  const raw = await getSavedTabs();
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
    await bootManagedLoad();
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
      savedAt: tab.savedAt || Date.now()
    }))
    .filter((tab) => tab.url);

  return {
    version: 1,
    type: "dock-workspace-share",
    workspace: {
      name: norm(group?.name) || "Workspace",
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

async function createShareLinkForActiveWorkspace(){
  await loadState();
  if (activeGroup === "__all__") return alert("Open a workspace first, then click Share.");
  if (activeGroup === "__admin__") return alert("District workspace is locked and cannot be shared from this menu.");
  const group = currentGroupRecord();
  if (!group) return alert("Workspace not found.");

  const payload = buildWorkspaceSharePayload(group);
  if (!payload.workspace.tabs.length) return alert("This workspace has no shareable links yet.");

  const encoded = encodeShareData(payload);
  const importUrl = `${api.runtime.getURL("import.html")}#data=${encoded}`;
  const copied = await copyTextSafe(importUrl);
  closeMenus();
  if (copied) {
    alert(`Share link copied. Send it to another teacher who already has Dock installed.\n\n${importUrl}`);
  } else {
    prompt("Copy and share this Dock workspace link:", importUrl);
  }
}

function updateWorkspaceButtons(){
  const selectedCount = getSelectedVisibleItems().length;
  const locked = activeGroup === "__admin__";
  const editableWorkspace = !!currentGroupRecord() && activeGroup !== "__admin__";

  if (createGroupBtn){
    const canCreateWorkspace = selectedCount > 0;
    createGroupBtn.disabled = !canCreateWorkspace;
    createGroupBtn.title = canCreateWorkspace
      ? `Create workspace from ${selectedCount} selected`
      : "Select one or more cards to create a workspace";
    createGroupBtn.classList.toggle("needsSelection", !canCreateWorkspace);
  }

  if (editGroupBtn){
    editGroupBtn.disabled = !editableWorkspace;
    editGroupBtn.hidden = !editableWorkspace;
    editGroupBtn.title = editableWorkspace ? "Edit this workspace name and color" : "Open a workspace to edit it";
  }

  if (addBtn){
    const eligibleTargetCount = Math.max(0, (groups || []).length - (activeGroup && activeGroup !== "__all__" && activeGroup !== "__admin__" ? 1 : 0));
    addBtn.disabled = locked || selectedCount === 0 || eligibleTargetCount === 0;
    if (locked) addBtn.title = "District workspace is locked";
    else if (!selectedCount) addBtn.title = "Select one or more cards first";
    else if (!eligibleTargetCount) addBtn.title = "Create another workspace first";
    else addBtn.title = `Add ${selectedCount} selected to another workspace`;
  }

  if (shareMenuBtn){
    const shareable = !!currentGroupRecord() && activeGroup !== "__admin__";
    shareMenuBtn.disabled = !shareable;
    shareMenuBtn.title = shareable ? "Share this workspace" : "Open a normal workspace to share it";
    shareMenuBtn.classList.toggle("isDisabled", !shareable);
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
    deleteSelectedBtn.title = lockedView ? "District workspace is locked" : (selectedCount ? `Delete ${selectedCount} selected` : "Select tabs first");
    deleteSelectedBtn.hidden = lockedView;
  }
  if (clearAllBtn) {
    const hasVisible = (visible || []).length > 0;
    clearAllBtn.disabled = !hasVisible || lockedView;
    clearAllBtn.hidden = lockedView;
    if (lockedView) clearAllBtn.title = "District workspace is locked";
    else if (activeGroup === "__all__") clearAllBtn.title = "Delete all memories on this page";
    else clearAllBtn.title = "Delete all tabs in this workspace";
  }
  updateWorkspaceButtons();
}

function getPillStyles(color, active){
  const safe = norm(color) || DEFAULT_GROUP_COLOR;
  if (active) {
    return `--ws-color:${safe}; background:${safe}; color:#fff; border:none; box-shadow:0 0 0 2px ${safe}22, 0 2px 8px rgba(0,0,0,.04);`;
  }
  return `--ws-color:${safe}; background:linear-gradient(90deg, ${safe}, color-mix(in srgb, ${safe} 58%, #ff5db1 42%)); color:#fff; border:none;`;
}

function pill(label, id, opts = {}) {
  const wrap = document.createElement("div");
  wrap.className = "groupPillWrap";
  if (opts.draggable) {
    wrap.draggable = true;
    wrap.dataset.groupId = id;
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
  b.className = "groupPill" + (activeGroup === id ? " active" : "");
  b.type = "button";
  b.textContent = label;
  b.style.cssText = getPillStyles(opts.color || DEFAULT_GROUP_COLOR, activeGroup === id);
  b.addEventListener("click", async () => {
    activeGroup = id;
    await saveState();
    await async function bootManagedLoad() {
  try { await ensureHardcodedManagedBootstrap(); } catch {}
  try { await syncManagedWorkspace({ force: true }); } catch {}
  await load();
}

window.addEventListener("focus", () => { bootManagedLoad().catch(() => {}); });
bootManagedLoad().catch(() => {});
  });
  wrap.appendChild(b);

  if (opts.deletable) {
    const x = document.createElement("button");
    x.className = "groupPillX";
    x.type = "button";
    x.textContent = "×";
    x.title = "Delete workspace";
    x.style.cssText = activeGroup === id
      ? `color:${opts.color || DEFAULT_GROUP_COLOR}; border-color:${opts.color || DEFAULT_GROUP_COLOR}66;`
      : `color:#fff; border-color:rgba(255,255,255,.65); background:transparent;`;
    x.addEventListener("click", async (e) => {
      e.stopPropagation();
      const ok = confirm(`Delete workspace "${label}"? This only removes the workspace and the tabs saved inside it.`);
      if (!ok) return;
      groups = (groups || []).filter(g => g.id !== id);
      delete groupItems[id];
      if (activeGroup === id) activeGroup = "__all__";
      await saveState();
      await async function bootManagedLoad() {
  try { await ensureHardcodedManagedBootstrap(); } catch {}
  try { await syncManagedWorkspace({ force: true }); } catch {}
  await load();
}

window.addEventListener("focus", () => { bootManagedLoad().catch(() => {}); });
bootManagedLoad().catch(() => {});
    });
    wrap.appendChild(x);
  }
  return wrap;
}

function renderPills(){
  if (!groupPills) return;
  groupPills.innerHTML = "";
  const hasGroups = Array.isArray(groups) && groups.length > 0;
  const hasAdmin = !!adminWorkspace && Array.isArray(adminWorkspace.tabs) && adminWorkspace.tabs.length > 0;

  if (hasGroups || hasAdmin) groupPills.appendChild(pill("All", "__all__", { deletable: false, color: "#2f8f83" }));
  if (hasAdmin) groupPills.appendChild(pill(adminWorkspace.name || "District Workspace", "__admin__", { deletable: false, color: "#8d79b9" }));
  (groups || []).forEach(g => groupPills.appendChild(pill(g.name || "Workspace", g.id, { deletable: true, draggable: true, color: ensureGroupColor(g) })));

  const noPills = groupPills.children.length === 0;
  groupPills.style.display = noPills ? "none" : "flex";
  groupPills.classList.toggle("isEmpty", noPills);
  groupBarEl?.classList.toggle("noPills", noPills);
}

function openWorkspaceModal({ title, subtitle, submitLabel = "Create", suggestedName = "", defaultColor = DEFAULT_GROUP_COLOR, showColor = false, workspaceChoices = [], onSubmit }) {
  const backdrop = document.createElement("div");
  backdrop.className = "dockModalBackdrop";
  const modal = document.createElement("div");
  modal.className = "dockModal";

  const selectHtml = workspaceChoices.length
    ? `<label class="dockField"><span class="dockFieldLabel">Workspace</span><select class="dockInput dockSelect" id="dockWorkspaceSelect">${workspaceChoices.map(w => `<option value="${escapeHtml(w.id)}">${escapeHtml(w.name)}</option>`).join("")}</select></label>`
    : "";
  const colorHtml = showColor
    ? `<label class="dockField"><span class="dockFieldLabel">Workspace color</span><input class="dockColorInput" id="dockGroupColor" type="color" value="${escapeHtml(defaultColor)}" /></label>`
    : "";
  const nameHtml = suggestedName !== null
    ? `<label class="dockField"><span class="dockFieldLabel">Workspace name</span><input class="dockInput" id="dockGroupName" type="text" value="${escapeHtml(suggestedName)}" /></label>`
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
  const previewSrc = isAdminCard
    ? (tab.customIcon || "assets/dock_logo.png")
    : (tab.screenshot || "assets/screenshot-unavailable.png");
  img.src = previewSrc;
  img.alt = "";
  if (isAdminCard) {
    preview.classList.add("adminPreview");
    img.addEventListener("error", () => { img.src = "assets/dock_logo.png"; }, { once: true });
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
  note.className = "dockNoteInput";
  note.type = "text";
  note.placeholder = "Note…";
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
  openBtn.addEventListener("click", () => { if (tab.url) api.tabs.create({ url: tab.url }); });
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

async function renderAll(){
  const tabsRaw = await getNormalizedSavedTabs();
  const tabs = (tabsRaw || []).map((t, idx) => ({ ...t, __kind: "main", __index: idx }));
  visible = tabs;
  if (!grid) return;
  grid.innerHTML = "";
  setEmpty(tabs.length === 0);
  if (!tabs.length) { updateActionButtons(); return; }
  tabs.forEach(t => {
    const i = t.__index;
    const delHandler = async () => { await deleteTab(i); await async function bootManagedLoad() {
  try { await ensureHardcodedManagedBootstrap(); } catch {}
  try { await syncManagedWorkspace({ force: true }); } catch {}
  await load();
}

window.addEventListener("focus", () => { bootManagedLoad().catch(() => {}); });
bootManagedLoad().catch(() => {}); };
    const noteHandler = async (val) => {
      const all = await getSavedTabs();
      if (!all[i]) return;
      all[i] = { ...all[i], reason: val };
      await api.storage.local.set({ savedTabs: all });
    };
    grid.appendChild(makeCard(t, delHandler, noteHandler, {
      selectable: true,
      sortableScope: "__all__",
      checked: selectedMain.has(i) || isSelectedVisible(t),
      onChange: (checked) => {
        if (checked) selectedMain.add(i); else selectedMain.delete(i);
        toggleVisibleSelection(t, checked);
        updateActionButtons();
      }
    }));
  });
  updateActionButtons();
}

async function renderAdmin(){
  const items = getAdminCards();
  visible = items;
  selectedMain.clear();
  clearVisibleSelection();
  if (!grid) return;
  grid.innerHTML = "";
  setEmpty(items.length === 0);
  if (!items.length) { updateActionButtons(); return; }
  items.forEach(t => {
    grid.appendChild(makeCard(t, async () => {}, async () => {}, {
      selectable: true,
      checked: isSelectedVisible(t),
      onChange: (checked) => { toggleVisibleSelection(t, checked); updateActionButtons(); },
      lockDelete: true,
      readOnlyNote: true,
      readOnlyPlaceholder: "District workspace"
    }));
  });
  updateActionButtons();
}

async function renderGroup(groupId){
  const arr = normalizeOrderedItems(Array.isArray(groupItems[groupId]) ? groupItems[groupId] : [], groupId);
  groupItems[groupId] = arr;
  const items = arr.map((t, idx) => ({ ...t, __kind: "group", __index: idx }));
  visible = items;
  selectedMain.clear();
  clearVisibleSelection();
  if (!grid) return;
  grid.innerHTML = "";
  setEmpty(items.length === 0);
  if (!items.length) { updateActionButtons(); return; }
  items.forEach(t => {
    const j = t.__index;
    const delHandler = async () => {
      const cur = Array.isArray(groupItems[groupId]) ? groupItems[groupId] : [];
      cur.splice(j, 1);
      groupItems[groupId] = cur;
      await saveState();
      await async function bootManagedLoad() {
  try { await ensureHardcodedManagedBootstrap(); } catch {}
  try { await syncManagedWorkspace({ force: true }); } catch {}
  await load();
}

window.addEventListener("focus", () => { bootManagedLoad().catch(() => {}); });
bootManagedLoad().catch(() => {});
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
      onChange: (checked) => { toggleVisibleSelection(t, checked); updateActionButtons(); }
    }));
  });
  updateActionButtons();
}

async function load(){
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
}

createGroupBtn?.addEventListener("click", async () => {
  await loadState();
  const selected = getSelectedCloneItems();
  if (!selected.length) {
    alert("Select one or more memories first.");
    return;
  }
  openWorkspaceModal({
    title: "Create Workspace",
    subtitle: `This will copy ${selected.length} tab(s) into a new workspace.`,
    submitLabel: "Create",
    suggestedName: "Workspace - " + new Date().toLocaleDateString(),
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
      await async function bootManagedLoad() {
  try { await ensureHardcodedManagedBootstrap(); } catch {}
  try { await syncManagedWorkspace({ force: true }); } catch {}
  await load();
}

window.addEventListener("focus", () => { bootManagedLoad().catch(() => {}); });
bootManagedLoad().catch(() => {});
    }
  });
});

addBtn?.addEventListener("click", async () => {
  await loadState();
  if (activeGroup === "__admin__") {
    alert("District workspace is locked.");
    return;
  }
  const selected = getSelectedCloneItems();
  if (!selected.length) {
    alert("Select one or more memories first.");
    return;
  }
  const targetChoices = (groups || [])
    .filter(g => g.id !== activeGroup)
    .map(g => ({ id: g.id, name: g.name || "Workspace" }));
  if (!targetChoices.length) {
    alert("Create another workspace first.");
    return;
  }
  openWorkspaceModal({
    title: "Add to Workspace",
    subtitle: `This will copy <b>${selected.length}</b> tab(s) into an existing workspace.`,
    submitLabel: "Add",
    suggestedName: null,
    workspaceChoices: targetChoices,
    onSubmit: async ({ workspaceId }) => {
      addItemsToGroup(workspaceId, selected);
      selectedMain.clear();
      clearVisibleSelection();
      await saveState();
      await async function bootManagedLoad() {
  try { await ensureHardcodedManagedBootstrap(); } catch {}
  try { await syncManagedWorkspace({ force: true }); } catch {}
  await load();
}

window.addEventListener("focus", () => { bootManagedLoad().catch(() => {}); });
bootManagedLoad().catch(() => {});
    }
  });
});

editGroupBtn?.addEventListener("click", async () => {
  await loadState();
  if (activeGroup === "__admin__") {
    alert("District workspace is locked.");
    return;
  }
  const group = currentGroupRecord();
  if (!group) {
    alert("Open a workspace first.");
    return;
  }
  openWorkspaceModal({
    title: "Edit Workspace",
    subtitle: "Update the workspace name and color.",
    submitLabel: "Save",
    suggestedName: group.name || "Workspace",
    defaultColor: ensureGroupColor(group),
    showColor: true,
    onSubmit: async ({ name, color }) => {
      groups = (groups || []).map(g => g.id === group.id ? { ...g, name, color: norm(color) || DEFAULT_GROUP_COLOR } : g);
      await saveState();
      await async function bootManagedLoad() {
  try { await ensureHardcodedManagedBootstrap(); } catch {}
  try { await syncManagedWorkspace({ force: true }); } catch {}
  await load();
}

window.addEventListener("focus", () => { bootManagedLoad().catch(() => {}); });
bootManagedLoad().catch(() => {});
    }
  });
});

refreshBtn?.addEventListener("click", load);
openAllBtn?.addEventListener("click", async () => { closeMenus(); const items = getVisibleOpenableItems(); if (items.length) await openWorkspaceItems(items); });
openSelectedBtn?.addEventListener("click", async () => {
  closeMenus();
  const items = getSelectedVisibleItems().filter(v => v?.url);
  if (!items.length) return alert("Select one or more tabs first.");
  await openWorkspaceItems(items);
});

async function deleteSelectedInCurrentView() {
  const items = getSelectedVisibleItems();
  if (!items.length) return;
  if (activeGroup === "__admin__") return alert("District Workspace is locked.");
  if (!confirm(`Delete ${items.length} selected item${items.length === 1 ? "" : "s"}?`)) return;

  if (activeGroup === "__all__") {
    const all = await getSavedTabs();
    const indices = items.filter(v => v.__kind === "main").map(v => v.__index).sort((a,b) => b-a);
    for (const idx of indices) all.splice(idx, 1);
    await setSavedTabs(all);
  } else {
    const cur = Array.isArray(groupItems[activeGroup]) ? groupItems[activeGroup] : [];
    const indices = items.filter(v => v.__kind === "group").map(v => v.__index).sort((a,b) => b-a);
    for (const idx of indices) cur.splice(idx, 1);
    groupItems[activeGroup] = cur;
    await saveState();
  }
  selectedMain.clear();
  clearVisibleSelection();
  await async function bootManagedLoad() {
  try { await ensureHardcodedManagedBootstrap(); } catch {}
  try { await syncManagedWorkspace({ force: true }); } catch {}
  await load();
}

window.addEventListener("focus", () => { bootManagedLoad().catch(() => {}); });
bootManagedLoad().catch(() => {});
}

deleteSelectedBtn?.addEventListener("click", async () => { closeMenus(); await deleteSelectedInCurrentView(); });
clearAllBtn?.addEventListener("click", async () => {
  closeMenus();
  if (activeGroup === "__admin__") return alert("District Workspace is locked.");
  const msg = activeGroup === "__all__"
    ? "Delete all memories on this page? Workspaces will stay intact."
    : "Delete all tabs in this workspace? The workspace name will stay.";
  if (!confirm(msg)) return;
  if (activeGroup === "__all__") await setSavedTabs([]);
  else { groupItems[activeGroup] = []; await saveState(); }
  selectedMain.clear();
  clearVisibleSelection();
  await async function bootManagedLoad() {
  try { await ensureHardcodedManagedBootstrap(); } catch {}
  try { await syncManagedWorkspace({ force: true }); } catch {}
  await load();
}

window.addEventListener("focus", () => { bootManagedLoad().catch(() => {}); });
bootManagedLoad().catch(() => {});
});

shareMenuBtn?.addEventListener("click", (e) => { e.stopPropagation(); const willShow = shareMenu?.classList.contains("hidden"); closeMenus(); if (willShow) shareMenu?.classList.remove("hidden"); });
createShareLinkBtn?.addEventListener("click", async (e) => { e.stopPropagation(); await createShareLinkForActiveWorkspace(); });
themeMenuBtn?.addEventListener("click", (e) => { e.stopPropagation(); const willShow = themeMenu?.classList.contains("hidden"); closeMenus(); if (willShow) themeMenu?.classList.remove("hidden"); });
themeItems.forEach(btn => btn.addEventListener("click", async (e) => { e.stopPropagation(); await saveTheme(btn.dataset.theme || DEFAULT_THEME); closeMenus(); }));
actionsMenuBtn?.addEventListener("click", (e) => {
  e.stopPropagation();
  const willShow = actionsMenu?.classList.contains("hidden");
  closeMenus();
  if (willShow) actionsMenu?.classList.remove("hidden");
});
function bindNestedMenu(toggleEl, panelEl, otherPanelEl){
  if (!toggleEl || !panelEl) return;
  toggleEl.addEventListener("click", (e) => {
    e.stopPropagation();
    const willShow = panelEl.classList.contains("hidden");
    if (otherPanelEl) otherPanelEl.classList.add("hidden");
    panelEl.classList.toggle("hidden", !willShow);
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
  await async function bootManagedLoad() {
  try { await ensureHardcodedManagedBootstrap(); } catch {}
  try { await syncManagedWorkspace({ force: true }); } catch {}
  await load();
}

window.addEventListener("focus", () => { bootManagedLoad().catch(() => {}); });
bootManagedLoad().catch(() => {});
});

groupPills?.addEventListener("dragleave", (e) => {
  if (!dragGroupId) return;
  const rel = e.relatedTarget;
  if (rel && groupPills.contains(rel)) return;
  clearGroupDropMarkers();
});

densityToggleBtn?.addEventListener("click", async (e) => { e.stopPropagation(); await toggleDensity(); });

if (api.storage?.onChanged?.addListener) {
  api.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;
    if (changes?.[THEME_KEY]) applyTheme(changes[THEME_KEY].newValue || DEFAULT_THEME);
    if (changes?.[DENSITY_KEY]) applyDensity(changes[DENSITY_KEY].newValue || DEFAULT_DENSITY);
    if (changes?.dockGroups || changes?.dockGroupItems || changes?.savedTabs || changes?.dockAdminWorkspace || changes?.dockManagedWorkspace || changes?.dockManagedMeta || changes?.dockOrg) {
      load().catch(() => {});
    }
  });
}

window.addEventListener("resize", syncStickyOffsets);
window.addEventListener("load", syncStickyOffsets);

async function bootManagedLoad() {
  try { await ensureHardcodedManagedBootstrap(); } catch {}
  try { await syncManagedWorkspace({ force: true }); } catch {}
  await load();
}

window.addEventListener("focus", () => { bootManagedLoad().catch(() => {}); });
bootManagedLoad().catch(() => {});
