import { api } from './adapters/index.js';
import { ensureSignedInInteractive, getCurrentUser, getSession, syncSavedTabsDiff } from './core/auth.js';

const SHARE_API = 'https://dock-production-mvp.vercel.app/api/share';
let sharing = false;
let shareToastTimer = null;

function norm(value){ return String(value || '').trim(); }
function sanitizeUrl(raw){
  const value = norm(raw);
  if (!value || /^(chrome|chrome-extension|edge|about|file|data|blob|devtools|safari-extension|safari-web-extension):/i.test(value)) return '';
  try {
    const parsed = new URL(value);
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.toString() : '';
  } catch { return ''; }
}

function isDataImage(value){
  const raw = norm(value);
  return /^data:image\/(?:png|jpeg|jpg|webp);base64,/i.test(raw) && raw.length <= 750000;
}
function firstPreview(item){
  const values = [
    item?.screenshot_data_url,
    item?.screenshot,
    item?.screenshotThumb,
    item?.['screenshot' + '_url'],
    item?.screenshotUrl,
    item?.previewImage,
    item?.previewUrl,
    item?.image,
    item?.imageUrl,
    item?.customIcon,
  ];
  for (const value of values) {
    const raw = norm(value);
    if (raw) return raw;
  }
  return '';
}
async function blobToDataUrl(blob){
  return await new Promise((resolve) => {
    try {
      const reader = new FileReader();
      reader.onloadend = () => resolve(typeof reader.result === 'string' ? reader.result : '');
      reader.onerror = () => resolve('');
      reader.readAsDataURL(blob);
    } catch { resolve(''); }
  });
}
async function materializePreviewForSync(item){
  const preview = firstPreview(item);
  if (!preview) return item;
  if (isDataImage(preview)) {
    return {
      ...item,
      screenshot: preview,
      screenshotThumb: preview,
      screenshot_data_url: preview,
    };
  }
  try {
    const parsed = new URL(preview);
    if (!['http:', 'https:'].includes(parsed.protocol)) return item;
    const response = await fetch(parsed.toString(), { method: 'GET', cache: 'no-store', credentials: 'omit' });
    if (!response.ok) return item;
    const blob = await response.blob();
    if (!blob?.type?.startsWith('image/') || blob.size <= 0 || blob.size > 600000) return item;
    const dataUrl = await blobToDataUrl(blob);
    if (!isDataImage(dataUrl)) return item;
    return {
      ...item,
      screenshot: dataUrl,
      screenshotThumb: dataUrl,
      screenshot_data_url: dataUrl,
    };
  } catch {
    return item;
  }
}
async function ensureSharePreviewsMaterialized(items){
  const source = (Array.isArray(items) ? items : []).filter((item) => sanitizeUrl(item?.url));
  if (!source.length) return { ok: true, expectedPreviewUrls: [] };

  const expectedPreviewUrls = source
    .filter((item) => !!firstPreview(item))
    .map((item) => sanitizeUrl(item?.url))
    .filter(Boolean);

  const prepared = [];
  for (const item of source) prepared.push(await materializePreviewForSync(item));

  // Only a bounded image data URL can create the server-owned screenshot_path
  // that the share-preview endpoint requires. Existing already-materialized
  // memories do not need another upload and are verified after share creation.
  const uploadable = prepared.filter((item) => isDataImage(firstPreview(item)));
  if (uploadable.length) {
    const syncResult = await syncSavedTabsDiff([], uploadable);
    if (!syncResult?.ok) {
      throw new Error('Dock could not prepare the screenshots for sharing. Please try Share again.');
    }
  }

  return { ok: true, expectedPreviewUrls: [...new Set(expectedPreviewUrls)] };
}
function comparableUrl(value){
  const raw = sanitizeUrl(value);
  if (!raw) return '';
  try {
    const url = new URL(raw);
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch { return raw.replace(/\/$/, ''); }
}
async function verifySharedPreviewCoverage(shareId, headers, expectedPreviewUrls){
  const expected = new Set((expectedPreviewUrls || []).map(comparableUrl).filter(Boolean));
  if (!expected.size) return { ok: true, expected: 0, verified: 0 };

  const response = await fetch(`${SHARE_API}?id=${encodeURIComponent(shareId)}`, {
    method: 'GET', cache: 'no-store', headers,
  });
  let result = null;
  try { result = await response.json(); } catch {}
  if (!response.ok || !result?.payload?.workspace?.tabs) {
    throw new Error(result?.error || 'Dock could not verify the shared screenshots.');
  }

  const verified = new Set();
  for (const tab of result.payload.workspace.tabs) {
    const url = comparableUrl(tab?.url);
    const preview = norm(tab?.['screenshot' + '_url'] || tab?.screenshotUrl);
    if (url && expected.has(url) && /^https:\/\//i.test(preview)) verified.add(url);
  }

  const missing = [...expected].filter((url) => !verified.has(url));
  if (missing.length) {
    throw new Error(`Dock could not attach ${missing.length} ${missing.length === 1 ? 'screenshot' : 'screenshots'} to this share. Please try Share again.`);
  }
  return { ok: true, expected: expected.size, verified: verified.size };
}

function buildPayload(group, items){
  const tabs = (Array.isArray(items) ? items : []).map((tab) => {
    const url = sanitizeUrl(tab?.url);
    if (!url) return null;
    return {
      title: norm(tab?.title) || url,
      url,
      faviconUrl: sanitizeUrl(tab?.faviconUrl || tab?.icon_url) || null,
    };
  }).filter(Boolean);
  return {
    version: 1,
    type: 'dock-workspace-share',
    workspace: {
      name: norm(group?.name) || 'Dock',
      color: /^#[0-9a-f]{6}$/i.test(norm(group?.color)) ? group.color : '#8fd8c6',
      tabs,
    },
  };
}
async function copyTextSafe(text){
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {}
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', 'readonly');
    ta.style.position = 'fixed';
    ta.style.left = '-10000px';
    ta.style.top = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, ta.value.length);
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch { return false; }
}
function showShareToast(message, tone = 'success'){
  let toast = document.getElementById('dockShareToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'dockShareToast';
    Object.assign(toast.style, {
      position: 'fixed', left: '50%', bottom: '24px', transform: 'translateX(-50%) translateY(8px)',
      zIndex: '12000', maxWidth: 'min(520px, calc(100vw - 32px))', padding: '12px 16px',
      borderRadius: '14px', border: '1px solid rgba(28,42,58,.14)', background: 'rgba(255,255,255,.97)',
      color: '#1c2a3a', boxShadow: '0 14px 34px rgba(28,42,58,.16)', fontSize: '13px',
      fontWeight: '800', lineHeight: '1.35', textAlign: 'center', opacity: '0', pointerEvents: 'none',
      transition: 'opacity .16s ease, transform .16s ease',
    });
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.style.borderColor = tone === 'error' ? 'rgba(176,57,46,.24)' : 'rgba(43,140,143,.20)';
  requestAnimationFrame(() => {
    toast.style.opacity = '1';
    toast.style.transform = 'translateX(-50%) translateY(0)';
  });
  if (shareToastTimer) clearTimeout(shareToastTimer);
  shareToastTimer = setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(-50%) translateY(8px)';
  }, 3200);
}
async function resolveGroupId(button){
  const directWrap = button?.closest?.('.groupPillWrap');
  if (directWrap?.dataset?.groupId) return directWrap.dataset.groupId;
  const menu = button?.closest?.('.groupPillMenu');
  const homeWrap = menu?.__dockHome;
  if (homeWrap?.dataset?.groupId) return homeWrap.dataset.groupId;
  const state = await api.storage.local.get(['dockActiveGroup']);
  return norm(state?.dockActiveGroup);
}
async function deliverShareUrl(url, name) {
  try {
    if (navigator.share) {
      await navigator.share({ title: norm(name) || 'Dock', text: 'A Dock was shared with you.', url });
      return 'shared';
    }
  } catch {}
  if (await copyTextSafe(url)) return 'copied';
  return 'manual';
}
async function createShortShare(groupId){
  if (sharing) return;
  sharing = true;
  try {
    if (!groupId || groupId === '__all__') return showShareToast('Open a Dock first, then click Share.', 'error');
    if (groupId === '__admin__') return showShareToast('Managed district Docks cannot be shared from this menu.', 'error');

    const state = await api.storage.local.get(['dockGroups', 'dockGroupItems']);
    const groups = Array.isArray(state?.dockGroups) ? state.dockGroups : [];
    const groupItems = state?.dockGroupItems && typeof state.dockGroupItems === 'object' ? state.dockGroupItems : {};
    const group = groups.find((item) => item?.id === groupId);
    if (!group) return showShareToast('Dock not found.', 'error');

    const payload = buildPayload(group, groupItems[groupId]);
    if (!payload.workspace.tabs.length) return showShareToast('Save at least one regular website tab before sharing this Dock.', 'error');

    let session = await getSession();
    if (!session?.access_token) {
      await ensureSignedInInteractive();
      session = await getSession();
    }
    if (!session?.access_token) throw new Error('Sign in with Google to share this Dock.');

    showShareToast('Preparing Dock screenshots…');
    const previewPrep = await ensureSharePreviewsMaterialized(groupItems[groupId]);

    const user = await getCurrentUser();
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` };
    if (user?.id) headers['X-Dock-User-Id'] = norm(user.id);
    if (user?.email) headers['X-Dock-User-Email'] = norm(user.email).toLowerCase();

    const response = await fetch(SHARE_API, {
      method: 'POST', cache: 'no-store', headers,
      body: JSON.stringify({ payload }),
    });
    let result = null;
    try { result = await response.json(); } catch {}
    if (!response.ok || !result?.url || !result?.id) throw new Error(result?.error || `Share failed (HTTP ${response.status}).`);

    await verifySharedPreviewCoverage(result.id, headers, previewPrep.expectedPreviewUrls);

    const shortUrl = norm(result.url);
    if (!/^https:\/\/dock-production-mvp\.vercel\.app\/share\/[A-Za-z0-9_-]{8,64}\/?$/.test(shortUrl)) {
      throw new Error('Dock received an invalid share link from the server.');
    }

    document.querySelectorAll('.groupPillMenu').forEach((menuEl) => menuEl.classList.add('hidden'));
    const delivery = await deliverShareUrl(shortUrl, group.name);
    if (delivery === 'shared') showShareToast('Dock shared. The link is also ready through your Share Sheet.');
    else if (delivery === 'copied') showShareToast('Dock link copied — just paste it where you want it. Expires in 30 days.');
    else prompt('Copy and share this Dock link:', shortUrl);
  } catch (error) {
    showShareToast(error?.message || 'Dock could not create a share link.', 'error');
  } finally {
    sharing = false;
  }
}

async function interceptShare(event) {
  const button = event.target?.closest?.('button');
  if (!button) return;
  const text = norm(button.textContent).toLowerCase();
  const isTopShare = button.id === 'createShareLinkBtn';
  const isDockMenuShare = button.classList.contains('groupPillMenuItem') && text === 'share';
  if (!isTopShare && !isDockMenuShare) return;

  event.preventDefault();
  event.stopImmediatePropagation();
  const groupId = await resolveGroupId(button);
  await createShortShare(groupId);
}

window.addEventListener('click', (event) => { interceptShare(event).catch(() => {}); }, true);
