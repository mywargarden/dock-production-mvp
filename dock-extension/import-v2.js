import { ensureSignedInInteractive, getSession } from './core/auth.js';
import { ensureDockMutationAllowed } from './core/license.js';
import { api } from './adapters/index.js';

const DEBUG = false;
const SHARE_API = 'https://dock-production-mvp.vercel.app/api/share';
const IMPORT_PREVIEW_MAX_WIDTH = 420;
const IMPORT_PREVIEW_MAX_HEIGHT = 260;
const IMPORT_PREVIEW_TARGET_CHARS = 45000;

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
  if (!raw || /^(chrome|chrome-extension|edge|about|file):/i.test(raw)) return '';
  try {
    const parsed = new URL(raw);
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.toString() : '';
  } catch { return ''; }
}
function pickSharedPreview(tab){
  return norm(tab?.screenshot_url || tab?.screenshotUrl || tab?.screenshotThumb || tab?.screenshot || tab?.screenshot_data_url);
}
function uniqueWorkspaceName(base, groups){
  const existing = new Set((groups || []).map(g => norm(g.name).toLowerCase()).filter(Boolean));
  const root = norm(base) || 'Imported Dock';
  if (!existing.has(root.toLowerCase())) return root;
  let i = 2;
  while (existing.has(`${root} (${i})`.toLowerCase())) i += 1;
  return `${root} (${i})`;
}
function loadImageFromBlob(blob){
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Shared preview image could not be decoded.'));
    };
    img.src = objectUrl;
  });
}
async function materializeSharedPreview(rawPreview){
  const source = sanitizeUrl(rawPreview);
  if (!source) return '';

  try {
    const response = await fetch(source, { method: 'GET', cache: 'no-store', credentials: 'omit' });
    if (!response.ok) return '';
    const blob = await response.blob();
    if (!blob?.size || !String(blob.type || '').toLowerCase().startsWith('image/')) return '';

    const img = await loadImageFromBlob(blob);
    const naturalWidth = Math.max(1, Number(img.naturalWidth || img.width || 1));
    const naturalHeight = Math.max(1, Number(img.naturalHeight || img.height || 1));
    const scale = Math.min(1, IMPORT_PREVIEW_MAX_WIDTH / naturalWidth, IMPORT_PREVIEW_MAX_HEIGHT / naturalHeight);
    const width = Math.max(1, Math.round(naturalWidth * scale));
    const height = Math.max(1, Math.round(naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return '';
    ctx.drawImage(img, 0, 0, width, height);

    let quality = 0.68;
    let dataUrl = canvas.toDataURL('image/webp', quality);
    while (dataUrl.length > IMPORT_PREVIEW_TARGET_CHARS && quality > 0.28) {
      quality -= 0.08;
      dataUrl = canvas.toDataURL('image/webp', quality);
    }
    if (dataUrl.length > IMPORT_PREVIEW_TARGET_CHARS) return '';
    return /^data:image\/webp;base64,/i.test(dataUrl) ? dataUrl : '';
  } catch (error) {
    DEBUG && console.warn('Dock could not copy shared preview locally', error);
    return '';
  }
}
async function materializeImportedTabs(rawTabs){
  const tabs = [];
  for (const tab of (Array.isArray(rawTabs) ? rawTabs : [])) {
    const url = sanitizeUrl(tab?.url);
    if (!url) continue;
    const remotePreview = pickSharedPreview(tab);
    const localPreview = remotePreview.startsWith('data:image/')
      ? remotePreview
      : await materializeSharedPreview(remotePreview);
    tabs.push({
      title: norm(tab?.title) || url || 'Untitled',
      url,
      reason: norm(tab?.reason),
      faviconUrl: norm(tab?.faviconUrl) || null,
      savedAt: tab?.savedAt || Date.now(),
      screenshotThumb: localPreview || null,
      screenshotBlocked: localPreview ? false : Boolean(tab?.screenshotBlocked),
      importedPreviewCopied: Boolean(localPreview),
    });
  }
  return tabs;
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
  await ensureDockMutationAllowed();

  const res = await api.storage.local.get(['dockGroups', 'dockGroupItems']);
  const groups = Array.isArray(res.dockGroups) ? [...res.dockGroups] : [];
  const groupItems = (res.dockGroupItems && typeof res.dockGroupItems === 'object') ? { ...res.dockGroupItems } : {};

  const workspace = sharePayload.workspace;
  const name = uniqueWorkspaceName(workspace.name, groups);
  const id = 'g_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(2, 6);
  const tabs = await materializeImportedTabs(workspace.tabs);

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
  statusEl.textContent = 'Copying shared previews into Dock…';
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
function showImportError(err, fallback) {
  DEBUG && console.error(err);
  statusEl.textContent = err?.message || fallback;
}
function loadFromHash(){
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const shareId = norm(hash.get('share'));
  const encoded = hash.get('data');
  if (shareId) {
    loadShortShare(shareId, false).catch((err) => {
      showImportError(err, 'This Dock share could not be loaded.');
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
      showImportError(err, 'Sign in failed. Please try again.');
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
      showImportError(err, 'Import failed. Please try again.');
    });
  }
});
openLibraryBtn.addEventListener('click', () => { window.location.href = api.runtime.getURL('memories.html'); });

loadFromHash();
