const DEBUG = false;
const api = (typeof browser !== "undefined" && browser?.runtime?.getURL) ? browser : chrome;

// Background service worker
// Bulk saving + per-tab screenshots runs here because the popup closes when tabs switch.
 

const PLAN_KEY = "dockPlanState";
const ORG_KEY = "dockOrg";
const MANAGED_WS_KEY = "dockManagedWorkspace";
const MANAGED_META_KEY = "dockManagedMeta";
const MANAGED_SYNC_ALARM = "dockManagedSync";

let backgroundManagedSyncPromise = null;
let backgroundBootstrapPromise = null;
let backgroundBootstrapPromiseKey = "";

const DEFAULT_API_BASE_URL = "https://dock-production-mvp.vercel.app";
const BACKGROUND_MANAGED_SYNC_TTL_MS = 3 * 60 * 60 * 1000;

const PERSONAL_MEMORIES_API = `${DEFAULT_API_BASE_URL}/api/user/memories`;

async function getDockAuthToken() {
  try {
    const res = await api.storage.local.get(["dockAuthSession"]);
    return String(res?.dockAuthSession?.access_token || "").trim();
  } catch {
    return "";
  }
}

async function getDockAuthUserEmail() {
  try {
    const res = await api.storage.local.get(["dockAuthUser"]);
    return String(res?.dockAuthUser?.email || "").trim().toLowerCase();
  } catch {
    return "";
  }
}

async function getDockAuthUser() {
  try {
    const res = await api.storage.local.get(["dockAuthUser"]);
    const user = res?.dockAuthUser;
    return user && typeof user === "object" ? user : null;
  } catch {
    return null;
  }
}

async function buildDockAuthHeaders(extra = {}) {
  const headers = { ...extra };
  const token = await getDockAuthToken();
  const user = token ? await getDockAuthUser() : null;
  if (token) headers.Authorization = `Bearer ${token}`;
  if (user?.id) {
    headers['X-Dock-User-Id'] = sanitizeText(user.id, 160);
    headers['X-User-Id'] = sanitizeText(user.id, 160);
  }
  if (user?.email) {
    headers['X-Dock-User-Email'] = sanitizeText(user.email, 160).toLowerCase();
    headers['X-User-Email'] = sanitizeText(user.email, 160).toLowerCase();
  }
  return headers;
}

function sanitizePersonalIconForSync(value) {
  const raw = norm(value);
  if (!raw || /^data:/i.test(raw)) return "";
  try {
    const parsed = new URL(raw);
    if (!["http:", "https:"].includes(parsed.protocol)) return "";
    parsed.hash = "";
    return parsed.toString().slice(0, 500);
  } catch {
    return "";
  }
}

function sanitizeScreenshotDataForSync(...values) {
  for (const value of values) {
    const raw = norm(value);
    if (!raw) continue;
    if (!/^data:image\/(?:png|jpeg|jpg|webp);base64,/i.test(raw)) continue;
    if (raw.length > 750000) continue;
    return raw;
  }
  return "";
}

function sanitizeScreenshotUrlForSync(...values) {
  for (const value of values) {
    const raw = norm(value);
    if (!raw || /^data:/i.test(raw)) continue;
    try {
      const parsed = new URL(raw);
      if (!["http:", "https:"].includes(parsed.protocol)) continue;
      parsed.hash = "";
      return parsed.toString().slice(0, 2000);
    } catch {}
  }
  return "";
}

function mapTabToMemoryPayload(tab) {
  return {
    title: norm(tab?.title).slice(0, 120),
    url: norm(tab?.url),
    icon_url: sanitizePersonalIconForSync(tab?.faviconUrl || tab?.icon_url || ""),
    screenshot_data_url: sanitizeScreenshotDataForSync(tab?.screenshot, tab?.screenshot_data_url),
    screenshot_url: sanitizeScreenshotUrlForSync(tab?.screenshot_url, tab?.screenshotUrl),
    screenshot_blocked: !!tab?.screenshotBlocked,
    reason: norm(tab?.reason).slice(0, 500),
    local_id: norm(tab?.local_id || tab?.url || "")
  };
}

function getMemoryCandidateUrl(value) {
  if (value && typeof value === 'object') {
    return norm(value.url || value.local_id || value.id || '');
  }
  return norm(value);
}

function isDockInternalPath(pathname = '') {
  const path = String(pathname || '/').toLowerCase();
  return (
    path === '/' ||
    path === '/admin' ||
    path.startsWith('/admin/') ||
    path === '/api/bootstrap' ||
    /^\/api\/org\/[^/]+\/workspace\/?$/i.test(path) ||
    /^\/api\/user\/memories\/?$/i.test(path)
  );
}

function isLogoutLikePath(pathname = '') {
  const path = String(pathname || '/').toLowerCase();
  return /(^|\/)(log(?:out|off)|sign(?:out|off))(\/|$)/i.test(path);
}

function shouldExcludeMemoryUrl(value) {
  const raw = getMemoryCandidateUrl(value);
  if (!raw) return true;
  if (/^(chrome|edge|about|file|blob|data|devtools):/i.test(raw)) return true;
  if (raw.startsWith('chrome-extension://') || raw.startsWith('safari-extension://')) return true;
  if (raw.includes('chromewebstore.google.com')) return true;
  if (/^https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d+)?(?:\/|$)/i.test(raw)) return true;

  try {
    const parsed = new URL(raw);
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname || '/';

    if (host === 'dock-production-mvp.vercel.app' && isDockInternalPath(path)) return true;
    if (isLogoutLikePath(path)) return true;

    if (
      raw === 'chrome://newtab' ||
      raw === 'chrome://newtab/' ||
      raw === 'about:blank' ||
      host === 'newtab' ||
      path === '/newtab'
    ) return true;
  } catch {
    return true;
  }

  return false;
}

function buildMemoryFingerprint(tab) {
  return JSON.stringify({
    title: norm(tab?.title).slice(0, 120),
    url: normalizeUrl(tab?.url),
    icon_url: sanitizePersonalIconForSync(tab?.faviconUrl || tab?.icon_url || ""),
    screenshot_data_url: sanitizeScreenshotDataForSync(tab?.screenshot, tab?.screenshot_data_url, tab?.screenshotThumb),
    screenshot_blocked: !!tab?.screenshotBlocked,
    reason: norm(tab?.reason).slice(0, 500),
    local_id: norm(tab?.local_id || tab?.url || "")
  });
}

async function syncSavedTabsToPersonalMemories(previousTabs = [], nextTabs = []) {
  const token = await getDockAuthToken();
  if (!token) return { ok: false, skipped: "not-signed-in" };

  const prevMap = new Map((previousTabs || []).filter((tab) => !shouldExcludeMemoryUrl(tab)).map((tab) => [normalizeUrl(tab?.url), tab]).filter(([k]) => !!k));
  const nextMap = new Map((nextTabs || []).filter((tab) => !shouldExcludeMemoryUrl(tab)).map((tab) => [normalizeUrl(tab?.url), tab]).filter(([k]) => !!k));

  const writes = [];

  for (const [url, tab] of nextMap.entries()) {
    const prev = prevMap.get(url);
    if (prev && buildMemoryFingerprint(prev) === buildMemoryFingerprint(tab)) continue;
    writes.push(
      buildDockAuthHeaders({ "Content-Type": "application/json" }).then((headers) => fetch(PERSONAL_MEMORIES_API, {
        method: "POST",
        headers,
        body: JSON.stringify(mapTabToMemoryPayload(tab))
      })).catch((err) => {
        DEBUG && console.error("Dock background POST sync failed", url, err);
      })
    );
  }

  if (!writes.length) return { ok: true, skipped: "no-diff" };
  await Promise.allSettled(writes);
  return { ok: true, writes: writes.length };
}
const LEGACY_FALLBACK_ORG = {
  orgId: 'local',
  orgName: 'Dock',
  orgCode: '',
  emailDomain: '',
  configUrl: '',
  apiBaseUrl: DEFAULT_API_BASE_URL,
  syncMode: 'local-only',
  joinedAt: Date.now(),
  lastSyncedAt: 0,
  lastSyncStatus: 'not-configured',
  lastError: ''
};

function deriveBootstrapUrl(apiBaseUrl) {
  const base = sanitizeHttpUrl(apiBaseUrl || DEFAULT_API_BASE_URL) || DEFAULT_API_BASE_URL;
  try {
    return new URL('/api/bootstrap', base).toString();
  } catch {
    return `${DEFAULT_API_BASE_URL}/api/bootstrap`;
  }
}

async function getManagedPolicy() {
  if (!api.storage?.managed?.get) return {};
  try {
    return await api.storage.managed.get(['orgCode', 'organizationName', 'emailDomain', 'apiBaseUrl', 'configUrl', 'forceManagedMode', 'allowLegacyFallback']);
  } catch {
    return {};
  }
}

async function shouldAllowLegacyFallback() {
  try {
    const managed = await getManagedPolicy();
    if (typeof managed?.allowLegacyFallback === 'boolean') return managed.allowLegacyFallback;
  } catch {}

  try {
    const local = await api.storage.local.get(['dockAllowLegacyFallback']);
    if (typeof local?.dockAllowLegacyFallback === 'boolean') return local.dockAllowLegacyFallback;
  } catch {}

  return false;
}

async function getProfileEmailDomain() {
  try {
    const signedInEmail = await getDockAuthUserEmail();
    if (signedInEmail.includes('@')) return signedInEmail.split('@')[1] || '';
  } catch {}
  if (!api.identity?.getProfileUserInfo) return '';
  try {
    const info = await api.identity.getProfileUserInfo();
    const email = sanitizeText(info?.email || '', 160).toLowerCase();
    if (!email.includes('@')) return '';
    return email.split('@')[1] || '';
  } catch {
    return '';
  }
}

function getBackgroundBootstrapKey({ domain = '', orgCode = '', apiBaseUrl = '', authIdentity = 'guest' } = {}) {
  return JSON.stringify({
    domain: sanitizeText(domain || '', 120).toLowerCase(),
    orgCode: sanitizeText(orgCode || '', 60),
    apiBaseUrl: sanitizeHttpUrl(apiBaseUrl || DEFAULT_API_BASE_URL) || DEFAULT_API_BASE_URL,
    authIdentity: sanitizeText(authIdentity || 'guest', 160).toLowerCase() || 'guest',
  });
}

async function fetchBootstrapOrg({ domain = '', orgCode = '', apiBaseUrl = '' } = {}) {
  const token = await getDockAuthToken();
  const currentUser = token ? await getDockAuthUser() : null;
  const authIdentity = sanitizeText(currentUser?.id || currentUser?.email || (token ? 'signed-in' : 'guest'), 160).toLowerCase() || 'guest';
  const cacheKey = getBackgroundBootstrapKey({ domain, orgCode, apiBaseUrl, authIdentity });
  if (backgroundBootstrapPromise && backgroundBootstrapPromiseKey === cacheKey) {
    return backgroundBootstrapPromise;
  }

  const runner = (async () => {
    const bootstrapUrl = deriveBootstrapUrl(apiBaseUrl);
    const url = new URL(bootstrapUrl);
    if (domain) url.searchParams.set('domain', domain.toLowerCase());
    if (orgCode) url.searchParams.set('orgCode', orgCode);
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (currentUser?.id) {
      headers['X-Dock-User-Id'] = sanitizeText(currentUser.id, 160);
      headers['X-User-Id'] = sanitizeText(currentUser.id, 160);
    }
    if (currentUser?.email) {
      headers['X-Dock-User-Email'] = sanitizeText(currentUser.email, 160).toLowerCase();
      headers['X-User-Email'] = sanitizeText(currentUser.email, 160).toLowerCase();
    }
    const response = await fetch(url.toString(), { cache: 'no-store', headers });
    if (!response.ok) throw new Error(`BOOTSTRAP_HTTP_${response.status}`);
    const data = await response.json();
    const resolvedOrgCode = sanitizeText(data?.organization?.orgCode || data?.orgCode || orgCode, 60);
    const resolvedBase = sanitizeHttpUrl(data?.apiBaseUrl || apiBaseUrl || DEFAULT_API_BASE_URL) || DEFAULT_API_BASE_URL;
    const resolvedConfigUrl = sanitizeHttpUrl(data?.configUrl || '') || `${resolvedBase}/api/org/${encodeURIComponent(resolvedOrgCode)}/workspace`;
    if (!resolvedOrgCode || !resolvedConfigUrl) throw new Error('BOOTSTRAP_INVALID');
    return {
      orgId: sanitizeText(data?.organization?.id || resolvedOrgCode, 60),
      orgName: sanitizeText(data?.organization?.name || data?.organizationName || data?.organization || resolvedOrgCode, 80),
      orgCode: resolvedOrgCode,
      emailDomain: sanitizeText(data?.organization?.emailDomain || data?.emailDomain || domain, 120).toLowerCase(),
      configUrl: resolvedConfigUrl,
      apiBaseUrl: resolvedBase,
      syncMode: sanitizeText(data?.syncMode || (orgCode ? 'org-code' : 'email-domain'), 40) || 'bootstrap'
    };
  })();

  backgroundBootstrapPromise = runner;
  backgroundBootstrapPromiseKey = cacheKey;
  try {
    return await runner;
  } finally {
    if (backgroundBootstrapPromiseKey === cacheKey) {
      backgroundBootstrapPromise = null;
      backgroundBootstrapPromiseKey = '';
    }
  }
}

async function resolveBootstrapOrgState() {
  const current = await getOrgState();
  const managed = await getManagedPolicy();
  const managedOrgCode = sanitizeText(managed?.orgCode || '', 60);
  const managedDomain = sanitizeText(managed?.emailDomain || '', 120).toLowerCase();
  const managedBase = sanitizeHttpUrl(managed?.apiBaseUrl || current?.apiBaseUrl || DEFAULT_API_BASE_URL) || DEFAULT_API_BASE_URL;
  const managedConfigUrl = sanitizeHttpUrl(managed?.configUrl || '');

  if (managedConfigUrl && managedOrgCode) {
    return {
      ...LEGACY_FALLBACK_ORG,
      orgId: managedOrgCode,
      orgName: sanitizeText(managed?.organizationName || current?.orgName || managedOrgCode, 80),
      orgCode: managedOrgCode,
      emailDomain: managedDomain,
      configUrl: managedConfigUrl,
      apiBaseUrl: managedBase,
      syncMode: 'managed-policy'
    };
  }

  if (managedOrgCode || managedDomain) {
    try {
      return await fetchBootstrapOrg({ orgCode: managedOrgCode, domain: managedDomain, apiBaseUrl: managedBase });
    } catch (err) {
      // District-managed installs should fail visibly when policy/bootstrap is wrong.
      // Do not fall through to cached/local state unless legacy fallback is explicitly enabled.
      if (!(await shouldAllowLegacyFallback())) return null;
    }
  }

  const profileDomain = await getProfileEmailDomain();
  if (profileDomain) {
    try {
      return await fetchBootstrapOrg({ domain: profileDomain, apiBaseUrl: managedBase });
    } catch {}
  }

  if (current?.orgCode && current?.configUrl) return current;

  if (await shouldAllowLegacyFallback()) {
    return { ...LEGACY_FALLBACK_ORG };
  }

  return null;
}

async function ensureBootstrapOrgState() {
  const current = await getOrgState();
  const resolved = await resolveBootstrapOrgState();

  if (!resolved?.orgCode || !resolved?.configUrl) {
    const unresolved = {
      ...(current || {}),
      orgId: current?.orgId || '',
      orgName: current?.orgName || '',
      orgCode: current?.orgCode || '',
      emailDomain: current?.emailDomain || '',
      configUrl: current?.configUrl || '',
      apiBaseUrl: current?.apiBaseUrl || DEFAULT_API_BASE_URL,
      syncMode: current?.syncMode || 'unresolved',
      lastSyncedAt: Date.now(),
      lastSyncStatus: 'unresolved',
      lastError: 'BOOTSTRAP_UNRESOLVED'
    };
    await api.storage.local.set({ [ORG_KEY]: unresolved });
    return unresolved;
  }

  const next = { ...(current || {}), ...(resolved || {}), lastError: '', lastSyncStatus: 'resolved' };
  await api.storage.local.set({
    [ORG_KEY]: next,
    [PLAN_KEY]: { plan: 'district', label: 'District', maxPersonalItems: Infinity, source: 'managed', maxUsers: 500 }
  });
  if (current?.orgCode && resolved?.orgCode && current.orgCode !== resolved.orgCode) {
    await api.storage.local.remove([MANAGED_WS_KEY, MANAGED_META_KEY]);
  }
  return next;
}

const PLAN_DEFAULTS = {
  free: { plan: "free", maxPersonalItems: 25 },
  pro: { plan: "pro", maxPersonalItems: Infinity },
  district: { plan: "district", maxPersonalItems: Infinity }
};

function normalizePlanState(raw) {
  const plan = String(raw?.plan || "free").trim().toLowerCase();
  const base = PLAN_DEFAULTS[plan] || PLAN_DEFAULTS.free;
  const maxPersonalItems = Number(raw?.maxPersonalItems);
  return {
    ...base,
    maxPersonalItems: Number.isFinite(maxPersonalItems) && maxPersonalItems > 0 ? maxPersonalItems : base.maxPersonalItems
  };
}

async function getPlanState() {
  const res = await api.storage.local.get([PLAN_KEY]);
  return normalizePlanState(res[PLAN_KEY] || PLAN_DEFAULTS.free);
}

async function getTotalPersonalMemoryCount() {
  const savedTabs = await getSavedTabs();
  const state = await getGroupState();
  const workspaceCount = Object.values(state.groupItems || {}).reduce((sum, items) => sum + (Array.isArray(items) ? items.length : 0), 0);
  return (Array.isArray(savedTabs) ? savedTabs.length : 0) + workspaceCount;
}

async function ensureCanSavePersonalMemory() {
  const plan = await getPlanState();
  if (!Number.isFinite(plan.maxPersonalItems)) return;
  const count = await getTotalPersonalMemoryCount();
  if (count >= plan.maxPersonalItems) throw "LIMIT_REACHED";
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function makeSavedTabsLite(tabs = []) {
  return (Array.isArray(tabs) ? tabs : []).map((tab) => {
    const next = { ...(tab || {}) };
    const thumb = String(next.screenshot_url || next.screenshotUrl || next.screenshotThumb || next.screenshot || next.screenshot_data_url || "").trim();
    if (thumb) next.screenshotThumb = thumb;
    delete next.screenshot;
    delete next.screenshot_data_url;
    return next;
  });
}

function sanitizeText(value, maxLen = 240) { return norm(value).slice(0, maxLen); }
function sanitizeHttpUrl(url) {
  const raw = norm(url);
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    if (!["http:", "https:"].includes(parsed.protocol)) return "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return "";
  }
}

function sanitizeIconUrl(url) {
  const raw = norm(url);
  if (!raw) return "";
  if (/^data:image\//i.test(raw)) return raw;
  return sanitizeHttpUrl(raw);
}
async function getOrgState() {
  const res = await api.storage.local.get([ORG_KEY]);
  return res[ORG_KEY] && typeof res[ORG_KEY] === "object" ? res[ORG_KEY] : null;
}
async function saveOrgState(patch) {
  const current = await getOrgState();
  const next = {
    ...(current || {}),
    ...(patch || {}),
    configUrl: sanitizeHttpUrl(patch?.configUrl || current?.configUrl || ""),
    apiBaseUrl: sanitizeHttpUrl(patch?.apiBaseUrl || current?.apiBaseUrl || ""),
    lastSyncStatus: sanitizeText(patch?.lastSyncStatus || current?.lastSyncStatus || "never", 80),
    lastError: sanitizeText(patch?.lastError || current?.lastError || "", 240),
    lastSyncedAt: Number(patch?.lastSyncedAt || current?.lastSyncedAt) || 0
  };
  await api.storage.local.set({ [ORG_KEY]: next });
  return next;
}
function validateManagedPayload(payload) {
  if (!payload || typeof payload !== "object") throw new Error("Missing payload");
  if (payload.type !== "dock-managed-config") throw new Error("Invalid config type");
  const org = payload.organization || {};
  const workspace = payload.workspace || {};
  const license = payload.license || {};
  if (!Array.isArray(workspace.tabs)) throw new Error("Workspace tabs missing");
  const tabs = workspace.tabs.slice(0, 50).map((tab) => ({
    title: sanitizeText(tab?.title, 80) || sanitizeText(tab?.url, 80) || "Untitled",
    url: sanitizeHttpUrl(tab?.url),
    customIcon: sanitizeIconUrl(tab?.customIcon) || "",
    faviconUrl: sanitizeHttpUrl(tab?.faviconUrl) || ""
  })).filter((tab) => tab.url);
  if (!tabs.length) throw new Error("Managed workspace has no valid tabs");
  const parsedUpdatedAt = Date.parse(workspace.updatedAt || "") || 0;
  const parsedPublishedAt = Date.parse(workspace.publishedAt || "") || 0;
  const parsedVersion = Number(workspace.version) || Number(payload.version) || 0;
  return {
    organization: {
      id: sanitizeText(org.id || org.orgCode || "district", 60),
      name: sanitizeText(org.name || "District", 80),
      orgCode: sanitizeText(org.orgCode || org.id || "district", 60),
      emailDomain: sanitizeText(org.emailDomain || "", 120)
    },
    workspace: {
      id: sanitizeText(workspace.id || "", 80),
      name: sanitizeText(workspace.name || "District Workspace", 80),
      locked: true,
      managed: true,
      version: parsedVersion,
      updatedAt: parsedUpdatedAt,
      publishedAt: parsedPublishedAt,
      tabs
    },
    license: normalizePlanState({ plan: license.plan || "district", maxUsers: license.maxUsers })
  };
}

async function backgroundSyncManagedWorkspace({ force = false } = {}) {
  if (backgroundManagedSyncPromise) return backgroundManagedSyncPromise;

  backgroundManagedSyncPromise = (async () => {
    const org = await getOrgState();
    if (!org?.configUrl) return { ok: false, reason: "NO_CONFIG_URL" };
    const meta = (await api.storage.local.get([MANAGED_META_KEY]))[MANAGED_META_KEY] || null;
    const current = (await api.storage.local.get([MANAGED_WS_KEY]))[MANAGED_WS_KEY] || null;
    const syncedAt = Number(meta?.syncedAt || 0);
    const hasFreshLocal = !force && current?.managed && syncedAt && ((Date.now() - syncedAt) < BACKGROUND_MANAGED_SYNC_TTL_MS);
    if (hasFreshLocal) {
      return { ok: true, skipped: true, reason: "LOCAL_FRESH" };
    }
    try {
      const headers = await buildDockAuthHeaders(org?.orgCode ? { 'X-Dock-Org-Code': sanitizeText(org.orgCode, 160) } : {});
      const response = await fetch(org.configUrl, { cache: "no-store", headers });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const raw = await response.json();
      const validated = validateManagedPayload(raw);
      const incomingVersion = Number(validated.workspace.version) || 0;
      const currentVersion = Number(current?.version) || 0;
      const parseTimestamp = (value) => {
        if (!value) return 0;
        const ms = Date.parse(value);
        return Number.isFinite(ms) ? ms : 0;
      };
      const buildManagedSignature = (ws) => JSON.stringify({
        id: String(ws?.id || ""),
        tabs: Array.isArray(ws?.tabs) ? ws.tabs.map((tab) => ({
          title: String(tab?.title || ""),
          url: String(tab?.url || ""),
          customIcon: String(tab?.customIcon || ""),
          faviconUrl: String(tab?.faviconUrl || "")
        })) : []
      });
      const incomingUpdatedAt = parseTimestamp(validated.workspace.updatedAt);
      const currentUpdatedAt = parseTimestamp(current?.updatedAt);
      const incomingSignature = buildManagedSignature(validated.workspace);
      const currentSignature = buildManagedSignature(current);
      const sameWorkspacePayload = incomingSignature === currentSignature;
      const sameOrOlderByVersion = incomingVersion && currentVersion && incomingVersion <= currentVersion && sameWorkspacePayload;
      const sameOrOlderByTime = !incomingVersion && incomingUpdatedAt && currentUpdatedAt && incomingUpdatedAt <= currentUpdatedAt && sameWorkspacePayload;
      if (current?.managed && (sameOrOlderByVersion || sameOrOlderByTime)) {
        await api.storage.local.set({ [PLAN_KEY]: validated.license });
        await saveOrgState({ configUrl: org.configUrl, lastSyncedAt: Date.now(), lastSyncStatus: "up-to-date", lastError: "" });
        return { ok: true, skipped: true };
      }
      await api.storage.local.set({
        [MANAGED_WS_KEY]: validated.workspace,
        [MANAGED_META_KEY]: {
          orgId: validated.organization.id,
          orgName: validated.organization.name,
          orgCode: validated.organization.orgCode,
          emailDomain: validated.organization.emailDomain,
          configUrl: org.configUrl,
          syncedAt: Date.now(),
          version: incomingVersion,
          updatedAt: incomingUpdatedAt,
          publishedAt: Number(validated.workspace.publishedAt) || 0
        },
        [PLAN_KEY]: validated.license
      });
      await saveOrgState({
        orgId: validated.organization.id,
        orgName: validated.organization.name,
        orgCode: validated.organization.orgCode,
        emailDomain: validated.organization.emailDomain,
        configUrl: org.configUrl,
        lastSyncedAt: Date.now(),
        lastSyncStatus: "ok",
        lastError: ""
      });
      return { ok: true };
    } catch (err) {
      try {
        await api.storage.local.set({
          dockLastManagedWorkspaceDebug: {
            at: new Date().toISOString(),
            configUrl: String(org?.configUrl || ''),
            orgCode: String(org?.orgCode || ''),
            error: sanitizeText(err?.message || String(err), 240)
          }
        });
      } catch {}
      await saveOrgState({ lastSyncedAt: Date.now(), lastSyncStatus: "error", lastError: sanitizeText(err?.message || String(err), 240) });
      return { ok: false, error: err?.message || String(err) };
    }
  })();

  try {
    return await backgroundManagedSyncPromise;
  } finally {
    backgroundManagedSyncPromise = null;
  }
}
async function ensureManagedSyncAlarm() {
  if (!api.alarms?.create) return;
  api.alarms.create(MANAGED_SYNC_ALARM, { periodInMinutes: 180 });
}

async function getSavedTabs() {
  const result = await api.storage.local.get(["savedTabs"]);
  return Array.isArray(result.savedTabs) ? result.savedTabs : [];
}

async function setSavedTabs(savedTabs) {
  const previous = await getSavedTabs();
  const nextTabs = Array.isArray(savedTabs) ? savedTabs : [];
  const nextLiteTabs = makeSavedTabsLite(nextTabs);
  if (JSON.stringify(previous || []) === JSON.stringify(nextTabs)) return;
  await api.storage.local.set({
    savedTabs: nextLiteTabs,
    savedTabsLite: nextLiteTabs
  });
  await syncSavedTabsToPersonalMemories(previous, nextTabs);
}

async function getGroupState() {
  const res = await api.storage.local.get(["dockGroups", "dockGroupItems", "dockActiveGroup"]);
  return {
    groups: Array.isArray(res.dockGroups) ? res.dockGroups : [],
    groupItems: (res.dockGroupItems && typeof res.dockGroupItems === "object") ? res.dockGroupItems : {},
    activeGroup: String(res.dockActiveGroup || "")
  };
}

async function saveGroupState({ groups, groupItems, activeGroup }) {
  await api.storage.local.set({
    dockGroups: groups,
    dockGroupItems: groupItems,
    dockActiveGroup: activeGroup || ""
  });
}

function norm(s) { return String(s || "").trim(); }

const JUNK_QUERY_PARAMS = new Set([
  "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
  "utm_id", "utm_name", "utm_cid", "utm_reader", "utm_viz_id",
  "fbclid", "gclid", "dclid", "gbraid", "wbraid", "igshid",
  "mc_cid", "mc_eid", "ref", "ref_src", "source"
]);

function normalizeUrl(url) {
  const raw = norm(url);
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    const protocol = parsed.protocol.toLowerCase();
    if (!["http:", "https:"].includes(protocol)) return raw.replace(/\/#$/, "").trim();

    parsed.protocol = protocol;
    parsed.hostname = parsed.hostname.toLowerCase();
    parsed.hash = "";

    if ((protocol === "http:" && parsed.port === "80") || (protocol === "https:" && parsed.port === "443")) {
      parsed.port = "";
    }

    const kept = [];
    for (const [key, value] of parsed.searchParams.entries()) {
      if (!JUNK_QUERY_PARAMS.has(String(key || "").toLowerCase())) kept.push([key, value]);
    }
    kept.sort(([aKey, aValue], [bKey, bValue]) => {
      const keyCompare = aKey.localeCompare(bKey);
      return keyCompare !== 0 ? keyCompare : aValue.localeCompare(bValue);
    });
    parsed.search = "";
    for (const [key, value] of kept) parsed.searchParams.append(key, value);

    if (parsed.pathname !== "/") parsed.pathname = parsed.pathname.replace(/\/+$/, "");

    let href = parsed.toString();
    if (href.endsWith("/") && parsed.pathname !== "/") href = href.slice(0, -1);
    return href;
  } catch {
    return raw.replace(/\/#$/, "").trim();
  }
}

function hasDuplicateUrl(payload, items) {
  const target = normalizeUrl(payload?.url);
  if (!target) return false;
  return (items || []).some((item) => normalizeUrl(item?.url) === target);
}


async function blobToDataUrl(blob) {
  return await new Promise((resolve) => {
    try {
      const reader = new FileReader();
      reader.onloadend = () => resolve(typeof reader.result === "string" ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    } catch {
      resolve(null);
    }
  });
}

async function compressScreenshotDataUrl(dataUrl) {
  try {
    if (!dataUrl || typeof OffscreenCanvas === "undefined" || typeof createImageBitmap === "undefined") return dataUrl;
    const response = await fetch(dataUrl);
    const sourceBlob = await response.blob();
    const bitmap = await createImageBitmap(sourceBlob);
    const maxWidth = 640;
    const maxHeight = 420;
    const scale = Math.min(1, maxWidth / bitmap.width, maxHeight / bitmap.height);
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return dataUrl;
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();
    const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.42 });
    return await blobToDataUrl(blob) || dataUrl;
  } catch {
    return dataUrl;
  }
}

function isInternalUrl(url) {
  const raw = norm(url).toLowerCase();
  if (!raw) return true;
  return (
    raw.startsWith("chrome://") ||
    raw.startsWith("chrome-extension://") ||
    raw.startsWith("edge://") ||
    raw.startsWith("about:") ||
    raw.startsWith("file:") ||
    raw.startsWith("javascript:") ||
    raw.startsWith("data:") ||
    raw.includes("chromewebstore.google.com")
  );
}

async function ensureWindowFocused(windowId) {
  try { await api.windows.update(windowId, { focused: true }); } catch {}
  await sleep(8); // minimal focus settle
}

// Chrome limits captureVisibleTab calls. Without a throttle, bulk capture can
// reliably lose the 3rd/4th tab because the service worker hits the capture
// rate limit before the page has a chance to paint. Keep this deliberately
// conservative for district deployments: slower is better than missing cards.
let lastVisibleCaptureAt = 0;
const MIN_CAPTURE_INTERVAL_MS = 650;

async function waitForCaptureBudget() {
  const now = Date.now();
  const waitMs = Math.max(0, MIN_CAPTURE_INTERVAL_MS - (now - lastVisibleCaptureAt));
  if (waitMs) await sleep(waitMs);
  lastVisibleCaptureAt = Date.now();
}

async function captureVisible(windowId) {
  await waitForCaptureBudget();
  try {
    const shot = await api.tabs.captureVisibleTab(windowId, { format: "jpeg", quality: 55 });
    return await compressScreenshotDataUrl(shot);
  } catch {
    return null;
  }
}

async function captureVisibleWithRetries(windowId, profile = "normal") {
  // Retries must respect Chrome's capture budget. A too-fast retry is what
  // made the next tab look like "Screenshot Unavailable."
  const delays =
    profile === "strong"
      ? [0, 700, 900]
      : [0, 700];

  for (const d of delays) {
    if (d) await sleep(d);
    const shot = await captureVisible(windowId);
    if (shot) return shot;
  }
  return null;
}

function waitForActivation(tabId, timeoutMs = 220) {
  return new Promise((resolve) => {
    let done = false;

    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      api.tabs.onActivated.removeListener(onActivated);
      resolve(false);
    }, timeoutMs);

    function onActivated(activeInfo) {
      if (activeInfo.tabId === tabId) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        api.tabs.onActivated.removeListener(onActivated);
        resolve(true);
      }
    }

    api.tabs.onActivated.addListener(onActivated);
  });
}

async function activateTabReliable(tabId) {
  try { await api.tabs.update(tabId, { active: true }); } catch {}
  await waitForActivation(tabId, 220);
  await sleep(10); // minimal paint settle
}

function orderTabsFromActive(tabs, activeTabId) {
  const sorted = [...tabs].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  const startIdx = Math.max(0, sorted.findIndex(t => t.id === activeTabId));
  if (startIdx <= 0) return sorted;
  return [...sorted.slice(startIdx), ...sorted.slice(0, startIdx)];
}


async function findOpenMemoriesTab() {
  const memoriesUrl = api.runtime.getURL("memories.html");
  const tabs = await api.tabs.query({});
  const matches = (Array.isArray(tabs) ? tabs : []).filter((t) => typeof t?.url === "string" && t.url.startsWith(memoriesUrl));
  if (!matches.length) return null;

  const currentWin = await api.windows.getCurrent({ populate: false }).catch(() => null);
  if (currentWin?.id != null) {
    const inCurrent = matches.find(t => t.windowId === currentWin.id);
    if (inCurrent) return inCurrent;
  }
  return matches[0] || null;
}

async function openOrRefreshMemoriesTab() {
  const memoriesUrl = api.runtime.getURL("memories.html");
  const tabs = await api.tabs.query({});
  const matches = (Array.isArray(tabs) ? tabs : [])
    .filter((t) => typeof t?.url === "string" && t.url.startsWith(memoriesUrl))
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0));

  let primary = null;
  if (matches.length) {
    const currentWin = await api.windows.getCurrent({ populate: false }).catch(() => null);
    primary = (currentWin?.id != null && matches.find(t => t.windowId === currentWin.id)) || matches[0];
    const duplicateIds = matches
      .filter((tab) => tab?.id != null && tab.id !== primary?.id)
      .map((tab) => tab.id);
    if (duplicateIds.length) {
      try { await api.tabs.remove(duplicateIds); } catch {}
    }
  }

  if (primary?.id != null) {
    try { await api.tabs.move(primary.id, { index: 0 }); } catch {}
    try { await api.windows.update(primary.windowId, { focused: true }); } catch {}
    try { await api.tabs.update(primary.id, { active: true }); } catch {}
    try { await api.tabs.highlight?.({ windowId: primary.windowId, tabs: 0 }); } catch {}
    try { await api.tabs.sendMessage?.(primary.id, { type: "DOCK_MEMORIES_REFRESH" }); } catch {}
    return primary;
  }

  try {
    return await api.tabs.create({ url: memoriesUrl, active: true, index: 0 });
  } catch {
    return null;
  }
}

async function closeAllOtherTabs() {
  const keepTab = await openOrRefreshMemoriesTab();
  if (keepTab?.id == null) return { ok: false, error: "DOCK_TAB_NOT_FOUND" };

  const tabs = await api.tabs.query({});
  const toClose = (Array.isArray(tabs) ? tabs : [])
    .filter((tab) => tab?.id != null && tab.id !== keepTab.id)
    .map((tab) => tab.id);

  if (toClose.length) {
    try {
      await api.tabs.remove(toClose);
    } catch (error) {
      const remaining = [];
      for (const tabId of toClose) {
        try {
          await api.tabs.remove(tabId);
        } catch {
          remaining.push(tabId);
        }
      }
      if (remaining.length) {
        return { ok: false, error: `FAILED_TO_CLOSE_${remaining.length}_TABS`, closedCount: toClose.length - remaining.length };
      }
    }
  }

  try { await api.windows.update(keepTab.windowId, { focused: true }); } catch {}
  try { await api.tabs.update(keepTab.id, { active: true }); } catch {}
  try { await api.tabs.sendMessage?.(keepTab.id, { type: "DOCK_MEMORIES_REFRESH" }); } catch {}
  return { ok: true, closedCount: toClose.length, keptTabId: keepTab.id };
}

async function saveAllOpenTabs({ reason, openMemories, targetGroupId, skipDuplicates = true }) {
  await ensureCanSavePersonalMemory();
  const win = await api.windows.getCurrent({ populate: false });
  const windowId = win.id;

  await ensureWindowFocused(windowId);

  // Current active tab at the moment bulk save starts
  const [activeTab] = await api.tabs.query({ active: true, currentWindow: true });
  const activeTabId = activeTab?.id;

  const tabsAll = await api.tabs.query({ currentWindow: true });
  const tabs = activeTabId ? orderTabsFromActive(tabsAll, activeTabId) : tabsAll;

  const savedTabs = await getSavedTabs();
  const groupState = await getGroupState();
  let targetItems = Array.isArray(groupState.groupItems[targetGroupId]) ? groupState.groupItems[targetGroupId] : [];
  let saved = 0;
  let attempted = 0;
  let duplicatesSkipped = 0;
  
  const now = Date.now();
  const total = tabs.length;

  // Always deep thumbnails now (toggle removed)
  let startingShot = null;
  let startingBlocked = false;

  if (activeTabId) {
    if (isInternalUrl(activeTab?.url)) {
      startingBlocked = true;
      startingShot = null;
    } else {
      // Capture starting tab IMMEDIATELY before switching
      startingShot = await captureVisibleWithRetries(windowId, "strong");
      if (!startingShot) startingBlocked = true;
    }
  }

  for (let i = 0; i < tabs.length; i++) {
    const t = tabs[i];
    attempted++;

    api.runtime.sendMessage({ type: "BULK_PROGRESS", current: i + 1, total }).catch(() => {}); 

    const retryProfile = "normal";

    let shot = null;
    let blocked = false;

    if (t.id === activeTabId) {
      shot = startingShot;
      blocked = startingBlocked;
      if (!shot && !isInternalUrl(t.url)) {
        shot = await captureVisibleWithRetries(windowId, "strong");
        blocked = !shot;
      }
    } else if (isInternalUrl(t.url)) {
      shot = null;
      blocked = true;
    } else {
      await activateTabReliable(t.id);
      shot = await captureVisibleWithRetries(windowId, retryProfile);
      blocked = !shot;

      if (!shot) {
        // Fast fallback only once; do not let stubborn tabs stall the whole run.
        await sleep(16);
        shot = await captureVisibleWithRetries(windowId, "strong");
        blocked = !shot;
      }
    }

    if (shouldExcludeMemoryUrl(t)) {
      continue;
    }

    const payload = {
      title: t.title,
      url: t.url,
      reason: (reason || "").trim(),
      savedAt: now,
      screenshot: shot,
      screenshotBlocked: blocked,
      faviconUrl: t.favIconUrl || null
    };

    const duplicate = skipDuplicates && hasDuplicateUrl(payload, targetGroupId ? targetItems : savedTabs);
    if (duplicate) {
      duplicatesSkipped++;
      continue;
    }

    if (targetGroupId) targetItems.push(payload);
    else savedTabs.push(payload);

    saved++;

    // Minimal yield between tabs; enough for stability without visible tail delay
    await sleep(2);
  }

  if (targetGroupId) {
    groupState.groupItems[targetGroupId] = targetItems;
    await saveGroupState(groupState);
  } else {
    await setSavedTabs(savedTabs);
  }

  if (openMemories) {
    await openOrRefreshMemoriesTab();
  } else if (activeTabId) {
    // Restore original active tab only when we are not showing the dashboard.
    try { await api.tabs.update(activeTabId, { active: true }); } catch {}
  }

  api.runtime.sendMessage({ type: "BULK_DONE", saved, attempted, duplicatesSkipped }).catch(() => {});
  return { saved, attempted, duplicatesSkipped };
}

api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "SAVE_ALL_OPEN_TABS") {
    (async () => {
      try {
        const result = await saveAllOpenTabs({
          reason: msg.reason || "",
          openMemories: !!msg.openMemories,
          targetGroupId: msg.targetGroupId || "",
          skipDuplicates: msg.skipDuplicates !== false
        });
        sendResponse({ ok: true, ...result });
      } catch (err) {
        if (err === "LIMIT_REACHED") return sendResponse({ ok: false, code: "LIMIT_REACHED" });
        sendResponse({ ok: false, code: "SAVE_ALL_FAILED", error: err?.message || String(err) });
      }
    })();
    return true;
  }

  if (msg?.type === "SYNC_MANAGED_WORKSPACE") {
    (async () => {
      const result = await backgroundSyncManagedWorkspace({ force: true });
      sendResponse(result?.ok ? { ok: true, ...result } : { ok: false, ...(result || {}) });
    })();
    return true;
  }

  if (msg?.type === "CLOSE_ALL_OTHER_TABS") {
    (async () => {
      const result = await closeAllOtherTabs();
      sendResponse(result?.ok ? result : { ok: false, ...(result || {}) });
    })();
    return true;
  }

  if (msg?.type === "SAVE_TAB_TO_WORKSPACE") {
    (async () => {
      const { payload, targetGroupId, skipDuplicates = true } = msg;
      if (!targetGroupId || !payload) return sendResponse({ ok: false });
      try {
        await ensureCanSavePersonalMemory();
        const state = await getGroupState();
        const cur = Array.isArray(state.groupItems[targetGroupId]) ? [...state.groupItems[targetGroupId]] : [];
        if (shouldExcludeMemoryUrl(payload)) return sendResponse({ ok: true, skippedExcluded: true });
        if (skipDuplicates && hasDuplicateUrl(payload, cur)) return sendResponse({ ok: true, skippedDuplicate: true });
        cur.push(payload);
        state.groupItems[targetGroupId] = cur;
        await saveGroupState(state);
        sendResponse({ ok: true, skippedDuplicate: false });
      } catch (err) {
        if (err === "LIMIT_REACHED") return sendResponse({ ok: false, code: "LIMIT_REACHED" });
        sendResponse({ ok: false, code: "SAVE_FAILED", error: err?.message || String(err) });
      }
    })();
    return true;
  }
});


api.runtime.onInstalled?.addListener(() => { ensureManagedSyncAlarm().catch(() => {}); ensureBootstrapOrgState().then(() => backgroundSyncManagedWorkspace({ force: true })).catch(() => {}); });
api.runtime.onStartup?.addListener(() => { ensureManagedSyncAlarm().catch(() => {}); ensureBootstrapOrgState().catch(() => {}); });
api.alarms?.onAlarm?.addListener((alarm) => { if (alarm?.name === MANAGED_SYNC_ALARM) ensureBootstrapOrgState().then(() => backgroundSyncManagedWorkspace()).catch(() => {}); });
