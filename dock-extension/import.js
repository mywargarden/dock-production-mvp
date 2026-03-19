const api = (typeof browser !== "undefined" && browser?.runtime?.getURL) ? browser : chrome;

const statusEl = document.getElementById("status");
const detailsEl = document.getElementById("details");
const nameEl = document.getElementById("wsName");
const countEl = document.getElementById("wsCount");
const colorEl = document.getElementById("wsColor");
const importBtn = document.getElementById("importBtn");
const openLibraryBtn = document.getElementById("openLibraryBtn");

let sharePayload = null;

function norm(s){ return String(s || "").trim(); }
function decodeShareData(encoded){
  const base64 = String(encoded || "").replace(/-/g, "+").replace(/_/g, "/");
  const pad = base64.length % 4 ? "=".repeat(4 - (base64.length % 4)) : "";
  const binary = atob(base64 + pad);
  const bytes = Uint8Array.from(binary, ch => ch.charCodeAt(0));
  const json = new TextDecoder().decode(bytes);
  return JSON.parse(json);
}
function ensureColor(value){
  return /^#[0-9a-f]{6}$/i.test(norm(value)) ? value : "#6f4cff";
}
function sanitizeUrl(url){
  const raw = norm(url);
  if (!raw) return "";
  if (/^(chrome|chrome-extension|edge|about|file):/i.test(raw)) return "";
  return raw;
}
function uniqueWorkspaceName(base, groups){
  const existing = new Set((groups || []).map(g => norm(g.name).toLowerCase()).filter(Boolean));
  let candidate = norm(base) || "Imported Workspace";
  if (!existing.has(candidate.toLowerCase())) return candidate;
  let i = 2;
  while (existing.has(`${candidate} (${i})`.toLowerCase())) i += 1;
  return `${candidate} (${i})`;
}
async function importWorkspace(){
  if (!sharePayload?.workspace) return;
  const res = await api.storage.local.get(["dockGroups", "dockGroupItems", "dockActiveGroup"]);
  const groups = Array.isArray(res.dockGroups) ? [...res.dockGroups] : [];
  const groupItems = (res.dockGroupItems && typeof res.dockGroupItems === "object") ? { ...res.dockGroupItems } : {};

  const workspace = sharePayload.workspace;
  const name = uniqueWorkspaceName(workspace.name, groups);
  const id = "g_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(2, 6);
  const tabs = Array.isArray(workspace.tabs) ? workspace.tabs.map((tab) => ({
    title: norm(tab.title) || norm(tab.url) || "Untitled",
    url: sanitizeUrl(tab.url),
    reason: norm(tab.reason),
    faviconUrl: norm(tab.faviconUrl) || null,
    savedAt: tab.savedAt || Date.now(),
    screenshot: null,
    screenshotBlocked: true
  })).filter(t => t.url) : [];

  groups.push({ id, name, color: ensureColor(workspace.color), createdAt: Date.now(), importedAt: Date.now() });
  groupItems[id] = tabs;

  await api.storage.local.set({ dockGroups: groups, dockGroupItems: groupItems, dockActiveGroup: id });
  statusEl.textContent = `Imported “${name}” into Dock.`;
  importBtn.disabled = true;
  openLibraryBtn.classList.remove("hidden");
}

function loadFromHash(){
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const encoded = hash.get("data");
  if (!encoded) {
    statusEl.textContent = "This share link is missing workspace data.";
    return;
  }
  try {
    const payload = decodeShareData(encoded);
    const workspace = payload?.workspace;
    if (!workspace || !Array.isArray(workspace.tabs)) throw new Error("Invalid workspace payload");
    sharePayload = payload;
    nameEl.textContent = norm(workspace.name) || "Workspace";
    countEl.textContent = String(workspace.tabs.filter(tab => sanitizeUrl(tab.url)).length);
    colorEl.style.background = ensureColor(workspace.color);
    detailsEl.classList.remove("hidden");
    statusEl.textContent = "This Dock workspace is ready to import.";
    importBtn.disabled = false;
  } catch (err) {
    console.error(err);
    statusEl.textContent = "This share link could not be read.";
  }
}

importBtn.addEventListener("click", () => { importWorkspace().catch((err) => {
  console.error(err);
  statusEl.textContent = "Import failed. Please try again.";
}); });
openLibraryBtn.addEventListener("click", () => { window.location.href = api.runtime.getURL("memories.html"); });

loadFromHash();
