import { getSavedTabs, saveTab, deleteTab, ensureHardcodedManagedBootstrap, syncManagedWorkspace } from "./core/storage.js";
import { api } from "./adapters/index.js";

const saveBtn = document.getElementById("saveBtn");
const saveAllBtn = document.getElementById("saveAllBtn");
const reasonInput = document.getElementById("reason");
const workspaceSelect = document.getElementById("workspaceSelect");
const tabList = document.getElementById("tabList");
const progressEl = document.getElementById("progress");
const viewAllBtn = document.getElementById("viewAllBtn");
const upgradeModal = document.getElementById("upgradeModal");
const upgradeBtn = document.getElementById("upgradeBtn");
const dismissBtn = document.getElementById("dismissBtn");
const replaceBtn = document.getElementById("replaceBtn");
const replaceModal = document.getElementById("replaceModal");
const replaceList = document.getElementById("replaceList");
const cancelReplaceBtn = document.getElementById("cancelReplaceBtn");

let pendingTabPayload = null;
let bulkActive = false;

const THEME_KEY = "dockTheme";
const DEFAULT_THEME = "dock-green";
const THEMES = new Set(["dock-green","dock-blue","slate","warm","light","tie-dye"]);

function applyTheme(theme) {
  const next = THEMES.has(theme) ? theme : DEFAULT_THEME;
  document.body.dataset.theme = next;
}
async function loadTheme() {
  const res = await api.storage.local.get([THEME_KEY]);
  applyTheme(String(res[THEME_KEY] || DEFAULT_THEME));
}
function showProgress(text) { if (progressEl) { progressEl.textContent = text; progressEl.classList.remove("hidden"); } }
function hideProgress() { if (progressEl) { progressEl.classList.add("hidden"); progressEl.textContent = ""; } }
function hideAllModals() { upgradeModal?.classList.add("hidden"); replaceModal?.classList.add("hidden"); }
function selectedWorkspaceId(){ return workspaceSelect?.value || "__all__"; }

function createThumbImage(tab, { forReplace = false } = {}) {
  const img = document.createElement("img");
  img.alt = "";
  if (tab.screenshot) img.src = tab.screenshot;
  else { img.src = "assets/screenshot-unavailable.png"; if (!forReplace) img.classList.add("fallbackThumb"); }
  return img;
}
function renderTabs(tabs) {
  tabList.innerHTML = "";
  tabs.forEach((tab, i) => {
    const li = document.createElement("li");
    li.className = "tabItem";
    const thumb = document.createElement("div");
    thumb.className = "thumb";
    thumb.appendChild(createThumbImage(tab));
    const main = document.createElement("div");
    main.className = "main";
    const title = document.createElement("div");
    title.className = "title";
    title.textContent = tab.title || tab.url || "(untitled)";
    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = tab.reason ? `— ${tab.reason}` : (tab.url || "");
    if (tab.screenshotBlocked) meta.textContent = (meta.textContent ? meta.textContent + " " : "") + "• Screenshot blocked";
    main.append(title, meta);
    main.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); if (tab.url) api.tabs.create({ url: tab.url }); });
    const delBtn = document.createElement("button");
    delBtn.className = "deleteBtn";
    delBtn.type = "button";
    delBtn.title = "Delete";
    delBtn.textContent = "✕";
    delBtn.addEventListener("click", async (e) => { e.preventDefault(); e.stopPropagation(); await deleteTab(i); await loadTabs(); hideAllModals(); });
    li.append(thumb, main, delBtn);
    tabList.appendChild(li);
  });
}
async function loadTabs() { renderTabs(await getSavedTabs()); }
async function captureScreenshot() { try { return await api.tabs.captureVisibleTab(null, { format: "jpeg", quality: 60 }); } catch { return null; } }
async function loadWorkspaceOptions(){
  if (!workspaceSelect) return;
  const res = await api.storage.local.get(["dockGroups", "dockActiveGroup"]);
  const groups = Array.isArray(res.dockGroups) ? res.dockGroups : [];
  const current = workspaceSelect.value || "__all__";
  workspaceSelect.innerHTML = '<option value="__all__">Main Library</option>' + groups.map(g => `<option value="${g.id}">${g.name || 'Workspace'}</option>`).join("");
  workspaceSelect.value = groups.some(g => g.id === current) ? current : "__all__";
}
async function savePayloadToTarget(payload, targetId) {
  if (!targetId || targetId === "__all__") {
    await saveTab(payload);
    return true;
  }
  await api.runtime.sendMessage({ type: "SAVE_TAB_TO_WORKSPACE", payload, targetGroupId: targetId });
  return true;
}
async function trySavePayload(payload) {
  try {
    await savePayloadToTarget(payload, selectedWorkspaceId());
    return true;
  } catch (e) {
    if (e === "LIMIT_REACHED") {
      pendingTabPayload = payload;
      upgradeModal?.classList.remove("hidden");
      return false;
    }
    console.error(e);
    return false;
  }
}

saveBtn?.addEventListener("click", async () => {
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  const shot = await captureScreenshot();
  const payload = { title: tab.title, url: tab.url, reason: reasonInput.value.trim(), savedAt: Date.now(), screenshot: shot, faviconUrl: tab.favIconUrl || null };
  const ok = await trySavePayload(payload);
  if (ok) { pendingTabPayload = null; reasonInput.value = ""; await loadTabs(); }
});

api.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "BULK_PROGRESS") { bulkActive = true; showProgress(`Capturing ${msg.current}/${msg.total}…`); }
  if (msg?.type === "BULK_DONE") {
    bulkActive = false;
    showProgress(`Done — saved ${msg.saved}`);
    setTimeout(() => { if (!bulkActive) hideProgress(); }, 1800);
    loadTabs().catch(() => {});
  }
});

saveAllBtn?.addEventListener("click", async () => {
  const reason = reasonInput.value.trim();
  showProgress("Starting…");
  try {
    await api.runtime.sendMessage({
      type: "SAVE_ALL_OPEN_TABS",
      reason,
      openMemories: true,
      targetGroupId: selectedWorkspaceId() === "__all__" ? "" : selectedWorkspaceId()
    });
  } catch (e) {
    console.warn("Bulk save failed:", e);
    showProgress("Bulk save failed (see console).");
    setTimeout(hideProgress, 1500);
  }
  try { await loadTabs(); } catch {}
});

replaceBtn?.addEventListener("click", async () => {
  upgradeModal?.classList.add("hidden");
  replaceModal?.classList.remove("hidden");
  const tabs = await getSavedTabs();
  replaceList.innerHTML = "";
  tabs.forEach((tab, i) => {
    const li = document.createElement("li");
    li.className = "replaceItem";
    li.appendChild(createThumbImage(tab, { forReplace: true }));
    const span = document.createElement("span");
    span.textContent = tab.title || tab.url || "(untitled)";
    li.appendChild(span);
    li.addEventListener("click", async () => {
      await deleteTab(i);
      const ok = await trySavePayload(pendingTabPayload);
      if (ok) { pendingTabPayload = null; reasonInput.value = ""; }
      hideAllModals();
      await loadTabs();
    });
    replaceList.appendChild(li);
  });
});

upgradeBtn?.addEventListener("click", () => { api.tabs.create({ url: "https://example.com/upgrade" }); });
dismissBtn?.addEventListener("click", hideAllModals);
cancelReplaceBtn?.addEventListener("click", hideAllModals);
viewAllBtn?.addEventListener("click", () => { api.tabs.create({ url: api.runtime.getURL("memories.html") }); });
reasonInput?.addEventListener("keydown", (e) => { if (e.key === "Enter") saveBtn.click(); });

async function bootManagedSync() {
  try { await ensureHardcodedManagedBootstrap(); } catch {}
  try { await syncManagedWorkspace({ force: true }); } catch {}
  try { await loadTabs(); } catch {}
  try { await loadWorkspaceOptions(); } catch {}
}

loadTheme().catch(() => {});
bootManagedSync().catch(() => {});
window.addEventListener("focus", () => { bootManagedSync().catch(() => {}); });

if (api.storage?.onChanged?.addListener) {
  api.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;
    if (changes?.[THEME_KEY]) applyTheme(changes[THEME_KEY].newValue || DEFAULT_THEME);
    if (changes?.dockGroups) loadWorkspaceOptions().catch(() => {});
  });
}
