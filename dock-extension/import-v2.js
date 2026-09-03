import { ensureSignedInInteractive, getSession } from './core/auth.js';

const DEBUG = false;
const api = (typeof browser !== 'undefined' && browser?.runtime?.getURL) ? browser : chrome;
const SHARE_API = 'https://dock-production-mvp.vercel.app/api/share';

const statusEl = document.getElementById('status');
const detailsEl = document.getElementById('details');
const nameEl = document.getElementById('wsName');
const countEl = document.getElementById('wsCount');
const colorEl = document.getElementById('wsColor');
const importBtn = document.getElementById('importBtn');
const openLibraryBtn = document.getElementById('openLibraryBtn');

let sharePayload = null;
let pendingShareId = '';
let mode = 'loading';

function norm(s){ return String(s || '').trim(); }
function decodeShareData(encoded){
  const base64 = String(encoded || '').replace(/-/g, '+').replace(/_/g, '/');
  const pad = base64.length % 4 ? '='.repeat(4 - (base64.length % 4)) : '';
  const binary = atob(base64 + pad);
  const bytes = Uint8Array.from(binary, ch => ch.charCodeAt(0));
  const json = new TextDecoder().decode(bytes);
  return JSON.parse(json);
}
function ensureColor(value){ return /^#[0-9a-f]{6}$/i.test(norm(value)) ? value : '#6f4cff'; }
function sanitizeUrl(url){
  const raw = norm(url);
  if (!raw) return '';
  if (/^(chrome|chrome-extension|edge|about|file):/i.test(raw)) return '';
  try {
    const parsed = new URL(raw);
    if (!['http:', 'https:'].includes(parsed.protocol)) return '';
    return parsed.toString();
  } catch { return ''; }
}
function pickSharedPreview(tab){
  return norm(tab?.screenshot_url || tab?.screenshotUrl || tab?.screenshotThumb || tab?.screenshot || tab?.screenshot_data_url);
}
function uniqueWorkspaceName(base, groups){
  const existing = new Set((groups || []).map(g => norm(g.name).toLowerCase()).filter(Boolean));
  let candidate = norm(base) || 'Imported Dock';
  if (!existing.has(candidate.toLowerCase())) return candidate;
  let i = 2;
  while (existing.has(`${candidate} (${i})`.toLowerCase())) i += 1;
  return `${candidate} (${i})`;
}
function displayPayload(payload){
  const workspace = payload?.workspace;
  if (!workspace || !Array.isArray(workspace.tabs)) throw new Error('Invalid workspace payload');
  sharePayload = payload;
  nameEl.textContent = norm(workspace.name) || 'Dock';
  countEl.textContent = String(workspace.tabs.filter(tab => sanitizeUrl(tab.url)).length);
  colorEl.style.background = ensureColor(workspace.color);
  detailsEl.classList.remove('hidden');
  statusEl.textContent = 'This Dock workspace is ready to import.';
  importBtn.textContent = 'Import into Dock';
  importBtn.disabled = false;
  mode = 'import';
}
async function importWorkspace(){
  if (!sharePayload?.workspace) return;
  const res = await api.storage.local.get(['dockGroups', 'dockGroupItems', 'dockActiveGroup']);
  const groups = Array.isArray(res.dockGroups) ? [...res.dockGroups] : [];
  const groupItems = (res.dockGroupItems && typeof res.dockGroupItems === 'object') ? { ...res.dockGroupItems } : {};

  const workspace = sharePayload.workspace;
  const name = uniqueWorkspaceName(workspace.name, groups);
  const id = 'g_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(2, 6);
  const tabs = Array.isArray(workspace.tabs) ? workspace.tabs.map((tab) => {
    const preview = pickSharedPreview(tab);
    return {
      title: norm(tab.title) || norm(tab.url) || 'Untitled',
      url: sanitizeUrl(tab.url),
      reason: norm(tab.reason),
      faviconUrl: norm(tab.faviconUrl) || null,
      savedAt: tab.savedAt || Date.now(),
      screenshot_url: norm(tab.screenshot_url) || null,
      screenshotUrl: norm(tab.screenshotUrl) || null,
      screenshotThumb: preview || null,
      screenshot: preview || null,
      screenshot_data_url: norm(tab.screenshot_data_url) || (preview.startsWith('data:image/') ? preview : null),
      screenshotBlocked: preview ? false : Boolean(tab.screenshotBlocked),
    };
  }).filter(t => t.url) : [];

  groups.push({ id, name, color: ensureColor(workspace.color), createdAt: Date.now(), importedAt: Date.now() });
  groupItems[id] = tabs;

  await api.storage.local.set({ dockGroups: groups, dockGroupItems: groupItems, dockActiveGroup: id });
  statusEl.textContent = `Imported “${name}” into Dock.`;
  importBtn.disabled = true;
  openLibraryBtn.classList.remove('hidden');
}
async function loadShortShare(id, interactive = false){
  pendingShareId = norm(id);
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(pendingShareId)) {
    statusEl.textContent = 'This Dock share link is invalid.';
    importBtn.disabled = true;
    return;
  }

  let session = await getSession();
  if (!session?.access_token && interactive) {
    await ensureSignedInInteractive();
    session = await getSession();
  }
  if (!session?.access_token) {
    statusEl.textContent = 'Sign in with Google to open this shared Dock.';
    importBtn.textContent = 'Sign in with Google';
    importBtn.disabled = false;
    mode = 'signin';
    return;
  }

  statusEl.textContent = 'Loading shared Dock…';
  importBtn.disabled = true;
  mode = 'loading';
  const response = await fetch(`${SHARE_API}?id=${encodeURIComponent(pendingShareId)}`, {
    method: 'GET',
    cache: 'no-store',
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  let result = null;
  try { result = await response.json(); } catch {}
  if (!response.ok || !result?.payload) {
    if (response.status === 410) throw new Error('This Dock share has expired.');
    if (response.status === 404) throw new Error('This Dock share could not be found.');
    if (response.status === 403) throw new Error('Your Dock account cannot open this shared workspace.');
    throw new Error(result?.error || `Could not load shared Dock (HTTP ${response.status}).`);
  }
  displayPayload(result.payload);
}
function loadLegacyData(encoded){
  try {
    const payload = decodeShareData(encoded);
    displayPayload(payload);
  } catch (err) {
    DEBUG && console.error(err);
    statusEl.textContent = 'This share link could not be read.';
    importBtn.disabled = true;
  }
}
function loadFromHash(){
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const shareId = norm(hash.get('share'));
  const encoded = hash.get('data');
  if (shareId) {
    loadShortShare(shareId, false).catch((err) => {
      DEBUG && console.error(err);
      statusEl.textContent = err?.message || 'This Dock share could not be loaded.';
      importBtn.disabled = true;
    });
    return;
  }
  if (encoded) {
    loadLegacyData(encoded);
    return;
  }
  statusEl.textContent = 'This share link is missing workspace data.';
  importBtn.disabled = true;
}

importBtn.addEventListener('click', () => {
  if (mode === 'signin') {
    loadShortShare(pendingShareId, true).catch((err) => {
      DEBUG && console.error(err);
      statusEl.textContent = err?.message || 'Sign in failed. Please try again.';
      importBtn.textContent = 'Sign in with Google';
      importBtn.disabled = false;
      mode = 'signin';
    });
    return;
  }
  if (mode === 'import') {
    importWorkspace().catch((err) => {
      DEBUG && console.error(err);
      statusEl.textContent = 'Import failed. Please try again.';
    });
  }
});
openLibraryBtn.addEventListener('click', () => { window.location.href = api.runtime.getURL('memories.html'); });

loadFromHash();
