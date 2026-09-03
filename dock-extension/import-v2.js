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
  return JSON.parse(new TextDecoder().decode(bytes));
}
function ensureColor(value){ return /^#[0-9a-f]{6}$/i.test(norm(value)) ? value : '#6f4cff'; }
function sanitizeUrl(url){
  const raw = norm(url);
  if (!raw || /^(chrome|chrome-extension|edge|about|file|safari-extension|safari-web-extension):/i.test(raw)) return '';
  try {
    const parsed = new URL(raw);
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.toString() : '';
  } catch { return ''; }
}
function pickSharedPreview(tab){
  return norm(tab?.screenshot_url || tab?.screenshotUrl || tab?.screenshotThumb || tab?.screenshot || tab?.screenshot_data_url);
}
function xmlEscape(value){
  return String(value || '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'
  }[char]));
}
function clampText(value, max = 48){
  const text = norm(value).replace(/\s+/g, ' ');
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
}
function sharedPreviewDomain(url){
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./i, '') || 'Shared website';
  } catch { return 'Shared website'; }
}
function buildSafeSharedPreview(tab, workspaceColor){
  const url = sanitizeUrl(tab?.url);
  const domain = sharedPreviewDomain(url);
  const title = clampText(norm(tab?.title) || domain, 54);
  const accent = ensureColor(workspaceColor);
  const initial = (domain.match(/[a-z0-9]/i)?.[0] || 'D').toUpperCase();
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#fbf7f2"/>
          <stop offset="1" stop-color="#eef7f6"/>
        </linearGradient>
      </defs>
      <rect width="640" height="360" rx="28" fill="url(#bg)"/>
      <rect x="0" y="0" width="16" height="360" fill="${xmlEscape(accent)}"/>
      <circle cx="110" cy="126" r="58" fill="${xmlEscape(accent)}" opacity="0.16"/>
      <circle cx="110" cy="126" r="42" fill="${xmlEscape(accent)}"/>
      <text x="110" y="143" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="46" font-weight="800" fill="#ffffff">${xmlEscape(initial)}</text>
      <text x="190" y="106" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="22" font-weight="800" fill="#2b8c8f">SHARED DOCK</text>
      <text x="190" y="148" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="30" font-weight="800" fill="#1c2a3a">${xmlEscape(clampText(domain, 30))}</text>
      <text x="62" y="252" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="26" font-weight="700" fill="#1c2a3a">${xmlEscape(title)}</text>
      <text x="62" y="294" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="20" font-weight="600" fill="#6d7b89">Preview generated locally — sender screenshot not shared</text>
    </svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
function uniqueWorkspaceName(base, groups){
  const existing = new Set((groups || []).map(g => norm(g.name).toLowerCase()).filter(Boolean));
  const root = norm(base) || 'Imported Dock';
  if (!existing.has(root.toLowerCase())) return root;
  let i = 2;
  while (existing.has(`${root} (${i})`.toLowerCase())) i += 1;
  return `${root} (${i})`;
}
function displayPayload(payload){
  const workspace = payload?.workspace;
  if (!workspace || !Array.isArray(workspace.tabs)) throw new Error('Invalid workspace payload');
  sharePayload = payload;
  nameEl.textContent = norm(workspace.name) || 'Dock';
  countEl.textContent = String(workspace.tabs.filter(tab => sanitizeUrl(tab.url)).length);
  colorEl.style.background = ensureColor(workspace.color);
  detailsEl.classList.remove('hidden');
}
async function importWorkspace(){
  if (!sharePayload?.workspace) return;
  const res = await api.storage.local.get(['dockGroups', 'dockGroupItems']);
  const groups = Array.isArray(res.dockGroups) ? [...res.dockGroups] : [];
  const groupItems = (res.dockGroupItems && typeof res.dockGroupItems === 'object') ? { ...res.dockGroupItems } : {};

  const workspace = sharePayload.workspace;
  const name = uniqueWorkspaceName(workspace.name, groups);
  const id = 'g_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(2, 6);
  const tabs = Array.isArray(workspace.tabs) ? workspace.tabs.map((tab) => {
    const realPreview = pickSharedPreview(tab);
    const localPreview = realPreview || buildSafeSharedPreview(tab, workspace.color);
    return {
      title: norm(tab.title) || norm(tab.url) || 'Untitled',
      url: sanitizeUrl(tab.url),
      reason: norm(tab.reason),
      faviconUrl: norm(tab.faviconUrl) || null,
      savedAt: tab.savedAt || Date.now(),
      screenshot_url: localPreview || null,
      screenshotUrl: localPreview || null,
      screenshotThumb: localPreview || null,
      screenshot: null,
      screenshot_data_url: null,
      screenshotBlocked: false,
      sharedPreviewGenerated: !realPreview,
    };
  }).filter(t => t.url) : [];

  groups.push({ id, name, color: ensureColor(workspace.color), createdAt: Date.now(), importedAt: Date.now() });
  groupItems[id] = tabs;
  await api.storage.local.set({ dockGroups: groups, dockGroupItems: groupItems, dockActiveGroup: id });
  return name;
}
async function loadShortShare(id, interactive = false){
  pendingShareId = norm(id);
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(pendingShareId)) throw new Error('This Dock share link is invalid.');

  let session = await getSession();
  if (!session?.access_token && interactive) {
    await ensureSignedInInteractive();
    session = await getSession();
  }
  if (!session?.access_token) {
    statusEl.textContent = 'Sign in with Google to add this shared Dock.';
    importBtn.textContent = 'Sign in with Google';
    importBtn.disabled = false;
    mode = 'signin';
    return;
  }

  statusEl.textContent = 'Adding shared Dock…';
  importBtn.disabled = true;
  mode = 'loading';
  const response = await fetch(`${SHARE_API}?id=${encodeURIComponent(pendingShareId)}`, {
    method: 'GET', cache: 'no-store',
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
  const importedName = await importWorkspace();
  statusEl.textContent = `Added “${importedName}” to Dock.`;
  window.location.replace(api.runtime.getURL('memories.html'));
}
function loadLegacyData(encoded){
  try {
    const payload = decodeShareData(encoded);
    displayPayload(payload);
    statusEl.textContent = 'This older Dock share is ready to import.';
    importBtn.textContent = 'Import into Dock';
    importBtn.disabled = false;
    mode = 'legacy-import';
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
  if (mode === 'legacy-import') {
    importWorkspace().then((name) => {
      statusEl.textContent = `Imported “${name}” into Dock.`;
      importBtn.disabled = true;
      openLibraryBtn.classList.remove('hidden');
    }).catch((err) => {
      DEBUG && console.error(err);
      statusEl.textContent = 'Import failed. Please try again.';
    });
  }
});
openLibraryBtn.addEventListener('click', () => { window.location.href = api.runtime.getURL('memories.html'); });

loadFromHash();
