import { api } from './adapters/index.js';
import { ensureSignedInInteractive, getCurrentUser, getSession } from './core/auth.js';

const SHARE_API = 'https://dock-production-mvp.vercel.app/api/share';
let sharing = false;
let shareToastTimer = null;

function norm(value){ return String(value || '').trim(); }
function sanitizeUrl(raw){
  const value = norm(raw);
  if (!value || /^(chrome|chrome-extension|edge|about|file|data|blob|devtools):/i.test(value)) return '';
  try {
    const parsed = new URL(value);
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.toString() : '';
  } catch { return ''; }
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

    const user = await getCurrentUser();
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` };
    if (user?.id) headers['X-Dock-User-Id'] = norm(user.id);
    if (user?.email) headers['X-Dock-User-Email'] = norm(user.email).toLowerCase();

    const response = await fetch(SHARE_API, {
      method: 'POST', cache: 'no-store', headers,
      body: JSON.stringify({ payload, extensionId: api.runtime.id }),
    });
    let result = null;
    try { result = await response.json(); } catch {}
    if (!response.ok || !result?.url) throw new Error(result?.error || `Share failed (HTTP ${response.status}).`);

    document.querySelectorAll('.groupPillMenu').forEach((menuEl) => menuEl.classList.add('hidden'));
    const copied = await copyTextSafe(result.url);
    if (copied) showShareToast('Dock link copied — paste it anywhere. Expires in 30 days.');
    else prompt('Copy and share this Dock link:', result.url);
  } catch (error) {
    showShareToast(error?.message || 'Dock could not create a share link.', 'error');
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
