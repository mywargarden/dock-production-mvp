import { api } from './adapters/index.js';
import { ensureSignedInInteractive, getCurrentUser, getSession } from './core/auth.js';

const SHARE_API = 'https://dock-production-mvp.vercel.app/api/share';
const MAX_SHAREABLE_IMAGE_CHARS = 90000;
let sharing = false;

function norm(value){ return String(value || '').trim(); }
function sanitizeUrl(raw){
  const value = norm(raw);
  if (!value || /^(chrome|chrome-extension|edge|about|file|data|blob|devtools):/i.test(value)) return '';
  try {
    const parsed = new URL(value);
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.toString() : '';
  } catch { return ''; }
}
function previewValue(tab){
  const candidates = [tab?.screenshot_url, tab?.screenshotUrl, tab?.screenshotThumb, tab?.screenshot, tab?.screenshot_data_url];
  for (const candidate of candidates) {
    const value = norm(candidate);
    if (!value || /screenshot-unavailable/i.test(value)) continue;
    if (value.startsWith('data:image/') && value.length > MAX_SHAREABLE_IMAGE_CHARS) continue;
    return value;
  }
  return '';
}
function buildPayload(group, items){
  const tabs = (Array.isArray(items) ? items : []).map((tab) => {
    const url = sanitizeUrl(tab?.url);
    if (!url) return null;
    const preview = previewValue(tab);
    return {
      title: norm(tab?.title) || url,
      url,
      reason: norm(tab?.reason),
      faviconUrl: sanitizeUrl(tab?.faviconUrl || tab?.icon_url) || null,
      screenshot_url: preview || null,
      screenshotBlocked: preview ? false : Boolean(tab?.screenshotBlocked),
      savedAt: tab?.savedAt || Date.now(),
    };
  }).filter(Boolean);
  return {
    version: 1,
    type: 'dock-workspace-share',
    workspace: {
      name: norm(group?.name) || 'Dock',
      color: /^#[0-9a-f]{6}$/i.test(norm(group?.color)) ? group.color : '#8fd8c6',
      exportedAt: Date.now(),
      tabs,
    },
  };
}
async function copyTextSafe(text){
  try { await navigator.clipboard.writeText(text); return true; } catch {}
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', 'readonly');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch { return false; }
}
async function resolveGroupId(button){
  const wrap = button?.closest?.('.groupPillWrap');
  if (wrap?.dataset?.groupId) return wrap.dataset.groupId;
  const state = await api.storage.local.get(['dockActiveGroup']);
  return norm(state?.dockActiveGroup);
}
async function createShortShare(groupId){
  if (sharing) return;
  sharing = true;
  try {
    if (!groupId || groupId === '__all__') return alert('Open a Dock first, then click Share.');
    if (groupId === '__admin__') return alert('Dock is locked and cannot be shared from this menu.');

    const state = await api.storage.local.get(['dockGroups', 'dockGroupItems']);
    const groups = Array.isArray(state?.dockGroups) ? state.dockGroups : [];
    const groupItems = state?.dockGroupItems && typeof state.dockGroupItems === 'object' ? state.dockGroupItems : {};
    const group = groups.find((item) => item?.id === groupId);
    if (!group) return alert('Dock not found.');

    const payload = buildPayload(group, groupItems[groupId]);
    if (!payload.workspace.tabs.length) {
      return alert('This Dock only contains browser or extension pages right now. Save at least one regular website tab to create a share link.');
    }

    let session = await getSession();
    if (!session?.access_token) {
      await ensureSignedInInteractive();
      session = await getSession();
    }
    if (!session?.access_token) throw new Error('Sign in with Google to share this Dock.');

    const user = await getCurrentUser();
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` };
    if (user?.id) headers['X-Dock-User-Id'] = norm(user.id);
    if (user?.email) headers['X-Dock-User-Email'] = norm(user.email).toLowerCase();

    const response = await fetch(SHARE_API, {
      method: 'POST',
      cache: 'no-store',
      headers,
      body: JSON.stringify({ payload, extensionId: api.runtime.id }),
    });
    let result = null;
    try { result = await response.json(); } catch {}
    if (!response.ok || !result?.url) throw new Error(result?.error || `Share failed (HTTP ${response.status}).`);

    document.querySelectorAll('.groupPillMenu').forEach((menu) => menu.classList.add('hidden'));
    const copied = await copyTextSafe(result.url);
    if (copied) {
      alert(`Dock link copied. Paste it into Gmail, Chat, Canvas, Teams, or anywhere you already communicate.\n\n${result.url}\n\nThis link expires in 30 days.`);
    } else {
      prompt('Copy and share this Dock link:', result.url);
    }
  } catch (error) {
    alert(error?.message || 'Dock could not create a share link.');
  } finally {
    sharing = false;
  }
}

document.addEventListener('click', async (event) => {
  const button = event.target?.closest?.('button');
  if (!button) return;
  const isTopShare = button.id === 'createShareLinkBtn';
  const isDockMenuShare = button.classList.contains('groupPillMenuItem') && norm(button.textContent).toLowerCase() === 'share';
  if (!isTopShare && !isDockMenuShare) return;

  event.preventDefault();
  event.stopImmediatePropagation();
  const groupId = await resolveGroupId(button);
  await createShortShare(groupId);
}, true);
