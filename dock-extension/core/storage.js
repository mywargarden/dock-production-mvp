import { api } from "../adapters/index.js";
import { resolveBootstrapOrg } from "./orgResolver.js";
import { syncSavedTabsDiff, deleteRemoteMemoriesByUrls, getSession, getCurrentUser } from "./auth.js";
import { isInternalUrl } from "./logic.js";

const DEBUG = false;
const PLAN_KEY = "dockPlanState";
const ORG_KEY = "dockOrg";
const MANAGED_WS_KEY = "dockManagedWorkspace";
const MANAGED_META_KEY = "dockManagedMeta";
const SAVED_TABS_LITE_KEY = "savedTabsLite";
const DELETED_TOMBSTONES_KEY = "dockDeletedMemoryTombstones";
const DEFAULT_GROUP_COLOR = "#8fd8c6";

const PERSONAL_MEMORIES_API = "https://dock-production-mvp.vercel.app/api/user/memories";
const REMOTE_HYDRATION_TTL_MS = 10 * 60 * 1000;
const MANAGED_SYNC_TTL_MS = 15 * 60 * 1000;

// Workspace cache for any direct workspace fetch callers.
// This prevents repeated full workspace pulls during normal browsing.
let workspaceCache = null;
let workspaceLastFetch = 0;
let workspacePromise = null;
const WORKSPACE_TTL = 5 * 60 * 1000;


let remoteHydrationPromise = null;
let remoteHydrationFetchedAt = 0;
let managedWorkspaceCache = null;
let managedMetaCache = null;
let orgStateCache = null;

async function getSavedTabsLocal() {
  const result = await api.storage.local.get(["savedTabs", SAVED_TABS_LITE_KEY]);
  const rawTabs = Array.isArray(result.savedTabs)
    ? result.savedTabs
    : (Array.isArray(result[SAVED_TABS_LITE_KEY]) ? result[SAVED_TABS_LITE_KEY] : []);
  const filteredTabs = filterMemoryTabs(rawTabs);
  if (JSON.stringify(rawTabs) !== JSON.stringify(filteredTabs)) {
    await api.storage.local.set({ savedTabs: filteredTabs, [SAVED_TABS_LITE_KEY]: makeSavedTabsLite(filteredTabs) });
    return filteredTabs;
  }
  return rawTabs;
}

async function getDeletedTombstones() {
  const res = await api.storage.local.get([DELETED_TOMBSTONES_KEY]);
  const raw = res?.[DELETED_TOMBSTONES_KEY];
  return raw && typeof raw === "object" ? raw : {};
}

async function saveDeletedTombstones(next) {
  await api.storage.local.set({ [DELETED_TOMBSTONES_KEY]: next && typeof next === "object" ? next : {} });
}

async function addDeletedTombstonesForTabs(tabs = []) {
  const current = await getDeletedTombstones();
  const now = Date.now();
  for (const tab of (Array.isArray(tabs) ? tabs : [])) {
    const url = normalizeUrl(tab?.url || "");
    if (url) current[url] = now;
  }
  await saveDeletedTombstones(current);
}

async function clearDeletedTombstonesForTabs(tabs = []) {
  const current = await getDeletedTombstones();
  let changed = false;
  for (const tab of (Array.isArray(tabs) ? tabs : [])) {
    const url = normalizeUrl(tab?.url || "");
    if (url && Object.prototype.hasOwnProperty.call(current, url)) {
      delete current[url];
      changed = true;
    }
  }
  if (changed) await saveDeletedTombstones(current);
}

function filterOutDeletedTombstones(tabs = [], tombstones = {}) {
  const entries = Array.isArray(tabs) ? tabs : [];
  return entries.filter((tab) => {
    const url = normalizeUrl(tab?.url || "");
    return !(url && Object.prototype.hasOwnProperty.call(tombstones, url));
  });
}

function isHydratableUrl(value) {
  const url = normalizeUrl(value || "");
  return /^https?:\/\//i.test(url);
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
    /^\/api\/(?:org\/[^/]+\/workspace|workspace|user\/memories)(?:\/)?$/i.test(path)
  );
}

function isLogoutLikePath(pathname = '') {
  const path = String(pathname || '/').toLowerCase();
  return /(^|\/)(log(?:out|off)|sign(?:out|off))(\/|$)/i.test(path);
}

function shouldExcludeMemoryUrl(value) {
  const raw = getMemoryCandidateUrl(value);
  if (!raw) return true;
  if (isInternalUrl(raw)) return true;
  if (/^(chrome|edge|about|file|blob|data|devtools):/i.test(raw)) return true;
  if (/^https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d+)?(?:\/|$)/i.test(raw)) return true;

  try {
    const parsed = new URL(raw);
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname || '/';

    if (host === 'dock-production-mvp.vercel.app' && isDockInternalPath(path)) return true;
    if (isLogoutLikePath(path)) return true;
    if (host === 'newtab' || path === '/newtab' || raw === 'chrome://newtab/' || raw === 'chrome://newtab') return true;
  } catch {
    return true;
  }

  return false;
}

function filterMemoryTabs(tabs = []) {
  return (Array.isArray(tabs) ? tabs : []).filter((tab) => !shouldExcludeMemoryUrl(tab));
}

const PREVIEW_RETRY_AFTER_MS = 24 * 60 * 60 * 1000;

function shouldRetryPreviewHydration(tab) {
  if (!isHydratableUrl(tab?.url || "")) return false;
  if (tab?.screenshotBlocked) return false;
  if (hasMeaningfulPreview(tab)) return false;
  const lastCheckedAt = Number(tab?.previewCheckedAt || 0);
  const previewMissing = !!tab?.previewMissing;
  if (!previewMissing) return true;
  if (!lastCheckedAt) return true;
  return (Date.now() - lastCheckedAt) > PREVIEW_RETRY_AFTER_MS;
}

function stripHeavyFields(tab) {
  if (!tab || typeof tab !== "object") return tab;
  const next = { ...tab };
  delete next.screenshot;
  delete next.screenshot_data_url;
  return next;
}

function toPrunedLocalTab(tab) {
  if (!tab || typeof tab !== "object") return tab;
  const next = { ...tab };
  const thumb = String(next.screenshot_url || next.screenshotUrl || next.screenshotThumb || next.screenshot || next.screenshot_data_url || "").trim();
  if (thumb) {
    next.screenshotThumb = thumb;
    next.previewMissing = false;
    next.previewCheckedAt = Number(next.previewCheckedAt || 0) || Date.now();
  } else if (!isHydratableUrl(next.url || "") || next.screenshotBlocked) {
    next.previewMissing = true;
    next.previewCheckedAt = Number(next.previewCheckedAt || 0) || Date.now();
  }
  delete next.screenshot;
  delete next.screenshot_data_url;
  return next;
}

async function pruneSavedTabsLocalCache() {
  const current = await getSavedTabsLocal();
  const pruned = (Array.isArray(current) ? current : []).map(toPrunedLocalTab);
  if (JSON.stringify(current) !== JSON.stringify(pruned)) {
    await api.storage.local.set({ savedTabs: pruned, [SAVED_TABS_LITE_KEY]: makeSavedTabsLite(pruned) });
  }
}

function makeSavedTabsLite(tabs = []) {
  // Important: tabs may only have a full `screenshot` field on first save.
  // If we strip heavy fields before normalizing, the lite cache loses the preview
  // and the UI falls back to the placeholder until a remote hydrate runs.
  return (Array.isArray(tabs) ? tabs : []).map((tab) => toPrunedLocalTab(tab));
}

async function getSavedTabsLiteLocal() {
  const result = await api.storage.local.get([SAVED_TABS_LITE_KEY]);
  if (Array.isArray(result[SAVED_TABS_LITE_KEY])) return result[SAVED_TABS_LITE_KEY];
  const full = await getSavedTabsLocal();
  const lite = makeSavedTabsLite(full);
  if (lite.length) {
    await api.storage.local.set({ [SAVED_TABS_LITE_KEY]: lite });
  }
  return lite;
}

function shouldHydrateRemote(force = false) {
  if (force) return true;
  return Date.now() - remoteHydrationFetchedAt > REMOTE_HYDRATION_TTL_MS;
}

async function hydrateSavedTabsFromRemote({ force = false } = {}) {
  if (!shouldHydrateRemote(force)) return await getSavedTabsLocal();
  if (remoteHydrationPromise) return await remoteHydrationPromise;

  remoteHydrationPromise = (async () => {
    const localTabs = await getSavedTabsLocal();
    const tombstones = await getDeletedTombstones();
    const includeScreenshots = needsRemotePreviewHydration(localTabs);
    const remoteTabsRaw = await fetchRemoteSavedTabs({ includeScreenshots });
    remoteHydrationFetchedAt = Date.now();
    if (!remoteTabsRaw) return localTabs;
    const remoteTabs = filterOutDeletedTombstones(remoteTabsRaw, tombstones);
    const merged = mergeTabsByUrl(localTabs, remoteTabs);
    if (JSON.stringify(localTabs) !== JSON.stringify(merged)) {
      await api.storage.local.set({ savedTabs: merged, [SAVED_TABS_LITE_KEY]: makeSavedTabsLite(merged) });
    }
    return merged;
  })();

  try {
    return await remoteHydrationPromise;
  } finally {
    remoteHydrationPromise = null;
  }
}

function mapRemoteMemoryToTab(row, { includeScreenshots = false } = {}) {
  const screenshotUrl = String(row?.screenshot_url || row?.screenshotUrl || "").trim();
  const screenshotDataUrl = includeScreenshots ? String(row?.screenshot_data_url || "").trim() : "";
  const screenshotThumb = screenshotUrl || screenshotDataUrl;
  const previewCheckedAt = screenshotThumb ? Date.now() : (includeScreenshots ? Date.now() : Number(row?.previewCheckedAt || 0));
  const previewMissing = includeScreenshots
    ? (!screenshotThumb && !row?.screenshot_blocked && isHydratableUrl(row?.url || ""))
    : (!screenshotThumb && !!row?.previewMissing);
  return {
    id: row?.id || row?.memory_id || "",
    memory_id: row?.id || row?.memory_id || "",
    title: row?.title || "",
    url: row?.url || "",
    faviconUrl: row?.icon_url || "",
    icon_url: row?.icon_url || "",
    screenshot_url: screenshotUrl,
    screenshotThumb,
    screenshotBlocked: !!row?.screenshot_blocked,
    previewMissing,
    previewCheckedAt,
    reason: row?.reason || "",
    local_id: row?.local_id || row?.url || "",
    created_at: row?.created_at || "",
    updated_at: row?.updated_at || "",
    user_id: row?.user_id || "",
    synced: true,
    source: "supabase"
  };
}

function getBestScreenshot(tab) {
  return String(tab?.screenshot_url || tab?.screenshotUrl || tab?.screenshot || tab?.screenshotThumb || tab?.screenshot_data_url || "").trim();
}

function hasMeaningfulPreview(tab) {
  if (!tab || tab.screenshotBlocked) return false;
  return !!getBestScreenshot(tab);
}

function needsRemotePreviewHydration(tabs = []) {
  const entries = Array.isArray(tabs) ? tabs : [];
  if (!entries.length) return true;
  return entries.some((tab) => shouldRetryPreviewHydration(tab));
}

function mergeTabRecords(existing, incoming) {
  const base = { ...(existing || {}) };
  const next = { ...(incoming || {}) };
  const merged = { ...base, ...next };

  const existingShot = getBestScreenshot(base);
  const incomingShot = getBestScreenshot(next);
  const chosenShot = incomingShot || existingShot;
  if (chosenShot) {
    merged.screenshotThumb = chosenShot;
    merged.previewMissing = false;
    merged.previewCheckedAt = Number(next?.previewCheckedAt || base?.previewCheckedAt || 0) || Date.now();
  } else {
    delete merged.screenshotThumb;
    const nextChecked = Number(next?.previewCheckedAt || 0);
    const baseChecked = Number(base?.previewCheckedAt || 0);
    merged.previewCheckedAt = Math.max(nextChecked, baseChecked, 0) || 0;
    merged.previewMissing = !!(next?.previewMissing ?? base?.previewMissing ?? false);
  }
  delete merged.screenshot;
  delete merged.screenshot_data_url;

  if (base?.screenshotBlocked && !next?.screenshotBlocked && incomingShot) merged.screenshotBlocked = false;
  else merged.screenshotBlocked = !!(next?.screenshotBlocked ?? base?.screenshotBlocked);

  if (!String(next?.reason || '').trim() && String(base?.reason || '').trim()) merged.reason = base.reason;
  if (!String(next?.title || '').trim() && String(base?.title || '').trim()) merged.title = base.title;
  if (!String(next?.icon_url || next?.faviconUrl || '').trim()) {
    merged.icon_url = base?.icon_url || base?.faviconUrl || '';
    merged.faviconUrl = base?.faviconUrl || base?.icon_url || '';
  }

  return toPrunedLocalTab(merged);
}

function mergeTabsByUrl(localTabs = [], remoteTabs = []) {
  const mergedMap = new Map();
  for (const tab of [...localTabs, ...remoteTabs]) {
    const key = normalizeUrl(tab?.url || '') || String(tab?.local_id || '');
    if (!key) continue;
    const current = mergedMap.get(key);
    mergedMap.set(key, current ? mergeTabRecords(current, tab) : mergeTabRecords({}, tab));
  }
  return Array.from(mergedMap.values());
}

async function fetchRemoteSavedTabs({ includeScreenshots = false } = {}) {
  try {
    const session = await getSession();
    const token = norm(session?.access_token);
    if (!token) return null;

    let orgCode = '';
    try {
      const stored = await api.storage.local.get(['dockOrg']);
      orgCode = norm(stored?.dockOrg?.orgCode || '');
    } catch {}

    const user = await getCurrentUser();
    const headers = { "Authorization": `Bearer ${token}` };
    if (user?.id) {
      headers['X-Dock-User-Id'] = norm(user.id);
      headers['X-User-Id'] = norm(user.id);
    }
    if (user?.email) {
      headers['X-Dock-User-Email'] = norm(user.email).toLowerCase();
      headers['X-User-Email'] = norm(user.email).toLowerCase();
    }
    if (orgCode) headers['X-Dock-Org-Code'] = orgCode;

    const response = await fetch(`${PERSONAL_MEMORIES_API}?includeScreenshots=${includeScreenshots ? '1' : '0'}`, {
      headers,
      cache: "no-store"
    });

    if (!response.ok) {
      // Startup hydration can race auth/session readiness.
      // Treat 400/401/403 as "not ready yet" instead of noisy extension errors.
      if ([400, 401, 403].includes(response.status)) return null;
      DEBUG && console.error("Dock fetchRemoteSavedTabs failed", response.status);
      return null;
    }

    const payload = await response.json();
    const rows = Array.isArray(payload) ? payload : (Array.isArray(payload?.memories) ? payload.memories : []);
    return rows
      .map((row) => mapRemoteMemoryToTab(row, { includeScreenshots }))
      .filter((tab) => !shouldExcludeMemoryUrl(tab));
  } catch (err) {
    const message = String(err?.message || err || "");
    if (/401|403|400|auth|token/i.test(message)) return null;
    DEBUG && console.error("Dock fetchRemoteSavedTabs error", err);
    return null;
  }
}

let managedSyncPromise = null;
let managedSyncRequestId = 0;
let managedSyncCompletedId = 0;

export async function ensureManagedBootstrap() {
  const current = await getOrgState();
  const resolved = await resolveBootstrapOrg({ allowLegacyFallback: false });
  if (!resolved?.orgCode || !resolved?.configUrl) {
    if (current?.orgCode && current?.configUrl) return current;
    throw new Error("BOOTSTRAP_UNRESOLVED");
  }

  const currentUrl = sanitizeHttpUrl(current?.configUrl || "");
  const nextUrl = sanitizeHttpUrl(resolved.configUrl || "");
  const changed = current?.orgCode !== resolved.orgCode || currentUrl !== nextUrl || sanitizeHttpUrl(current?.apiBaseUrl || "") !== sanitizeHttpUrl(resolved.apiBaseUrl || "");

  const next = await saveOrgState({
    ...resolved,
    joinedAt: current?.joinedAt || Date.now(),
    syncMode: resolved.syncMode || current?.syncMode || "bootstrap"
  });

  const plan = await getPlanState();
  if (plan.plan !== "district") {
    await setPlanState({ plan: "district", label: "District", source: "managed", maxUsers: 500 });
  }

  if (changed && current?.orgCode && current.orgCode !== resolved.orgCode) {
    await api.storage.local.remove([MANAGED_WS_KEY, MANAGED_META_KEY]);
  }

  return next;
}

const PLAN_DEFAULTS = {
  free: { plan: "free", label: "Free", maxPersonalItems: 25, maxWorkspaces: 3, orgJoin: false },
  pro: { plan: "pro", label: "Pro", maxPersonalItems: Infinity, maxWorkspaces: Infinity, orgJoin: false },
  district: { plan: "district", label: "District", maxPersonalItems: Infinity, maxWorkspaces: Infinity, orgJoin: true, maxUsers: 500 }
};

function norm(s) {
  return String(s || "").trim();
}

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

function sanitizeText(value, maxLen = 280) {
  return norm(value).slice(0, maxLen);
}

function parseTimestamp(value) {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function ensureColor(value) {
  return /^#[0-9a-f]{6}$/i.test(norm(value)) ? norm(value) : DEFAULT_GROUP_COLOR;
}

function isDuplicateTab(tab, existingItems) {
  const normalized = normalizeUrl(tab?.url);
  if (!normalized) return false;
  return (existingItems || []).some((item) => normalizeUrl(item?.url) === normalized);
}

function normalizePlanState(raw) {
  const requested = norm(raw?.plan).toLowerCase();
  const base = PLAN_DEFAULTS[requested] || PLAN_DEFAULTS.free;
  const maxPersonalItems = Number(raw?.maxPersonalItems);
  const maxWorkspaces = Number(raw?.maxWorkspaces);
  const maxUsers = Number(raw?.maxUsers);
  return {
    ...base,
    label: sanitizeText(raw?.label || base.label, 40),
    source: sanitizeText(raw?.source || "local", 40),
    maxPersonalItems: Number.isFinite(maxPersonalItems) && maxPersonalItems > 0 ? maxPersonalItems : base.maxPersonalItems,
    maxWorkspaces: Number.isFinite(maxWorkspaces) && maxWorkspaces > 0 ? maxWorkspaces : base.maxWorkspaces,
    maxUsers: Number.isFinite(maxUsers) && maxUsers > 0 ? maxUsers : (base.maxUsers || null)
  };
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
  const updatedAt = parseTimestamp(workspace.updatedAt);
  const publishedAt = parseTimestamp(workspace.publishedAt);
  const version = Number(workspace.version) || Number(payload.version) || 0;
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
      version,
      updatedAt,
      publishedAt,
      sourceUrl: sanitizeHttpUrl(payload.sourceUrl || ""),
      branding: {
        districtLogoUrl: sanitizeIconUrl(workspace?.branding?.districtLogoUrl) || "",
        districtBackgroundUrl: sanitizeIconUrl(workspace?.branding?.districtBackgroundUrl) || "",
        districtAccentColor: sanitizeText(workspace?.branding?.districtAccentColor || "", 40)
      },
      tabs
    },
    license: normalizePlanState({
      plan: license.plan || "district",
      label: license.label || "District",
      maxUsers: license.maxUsers,
      source: "managed"
    })
  };
}


export async function getWorkspace({ force = false, forceRemote = false } = {}) {
  const managed = await getManagedWorkspace();
  const managedTabs = Array.isArray(managed?.tabs) ? managed.tabs : [];
  const now = Date.now();

  // Fresh-eye fix: normal UI callers must stay local-only.
  // This eliminates silent workspace fan-out fetches during page render and storage churn.
  if (!forceRemote) {
    if (managedTabs.length) {
      workspaceCache = managedTabs;
      workspaceLastFetch = now;
      return managedTabs;
    }
    if (workspaceCache && (now - workspaceLastFetch < WORKSPACE_TTL)) {
      return workspaceCache;
    }
    return workspaceCache || [];
  }

  if (workspacePromise) return workspacePromise;

  workspacePromise = (async () => {
    try {
      const org = await getOrgState();
      const configUrl = sanitizeHttpUrl(org?.configUrl || "");
      if (!configUrl) return workspaceCache || managedTabs || [];

      const session = await getSession();
      const headers = {};
      if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;

      const res = await fetch(configUrl, {
        headers,
        cache: "no-store"
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const workspace = validateManagedPayload(data).workspace;
      workspaceCache = Array.isArray(workspace?.tabs) ? workspace.tabs : [];
      workspaceLastFetch = Date.now();
      return workspaceCache;
    } catch (e) {
      DEBUG && console.error("Workspace fetch error:", e);
      return workspaceCache || managedTabs || [];
    } finally {
      workspacePromise = null;
    }
  })();

  return workspacePromise;
}

export async function recoverSavedTabsFromRemote() {
  return await hydrateSavedTabsFromRemote({ force: true });
}

export async function getSavedTabs(options = {}) {
  const localTabs = await getSavedTabsLocal();
  if (options.localOnly) return localTabs;
  const forceRemote = !!options.forceRemote;

  // Hard rule: normal UI reads must trust local state and NEVER fan out into
  // remote hydration. Remote reads are allowed only for explicit recovery or
  // diagnostics paths that opt in with forceRemote.
  if (!forceRemote) {
    return localTabs;
  }

  return await hydrateSavedTabsFromRemote({ force: true });
}

export async function getSavedTabsLite(options = {}) {
  const localTabs = await getSavedTabsLiteLocal();
  if (options.localOnly) return localTabs;
  const forceRemote = !!options.forceRemote;

  // Same hard rule as getSavedTabs(): lite reads stay local unless a caller
  // explicitly forces a remote recovery pass.
  if (!forceRemote) {
    return localTabs;
  }

  const full = await hydrateSavedTabsFromRemote({ force: true });
  return makeSavedTabsLite(full);
}

export async function setSavedTabs(savedTabs, options = {}) {
  const previous = await getSavedTabsLocal();
  const nextTabs = filterMemoryTabs(savedTabs);
  const nextLiteTabs = makeSavedTabsLite(nextTabs);
  if (JSON.stringify(previous || []) === JSON.stringify(nextTabs)) return;

  const explicitRemovedTabs = Array.isArray(options?.removedTabs)
    ? options.removedTabs.filter((tab) => normalizeUrl(tab?.url || ""))
    : [];
  const previousByUrl = new Map((previous || []).map((tab) => [normalizeUrl(tab?.url || ""), tab]).filter(([url]) => url));
  const nextByUrl = new Map((nextTabs || []).map((tab) => [normalizeUrl(tab?.url || ""), tab]).filter(([url]) => url));
  const addedTabs = [];
  for (const [url, tab] of nextByUrl.entries()) {
    if (!previousByUrl.has(url)) addedTabs.push(tab);
  }

  remoteHydrationFetchedAt = Date.now();
  if (explicitRemovedTabs.length) await addDeletedTombstonesForTabs(explicitRemovedTabs);
  if (addedTabs.length) await clearDeletedTombstonesForTabs(addedTabs);

  await api.storage.local.set({ savedTabs: nextLiteTabs, [SAVED_TABS_LITE_KEY]: nextLiteTabs });
  syncSavedTabsDiff(previous, nextTabs)
    .then(async () => {
      if (explicitRemovedTabs.length) {
        try {
          await deleteRemoteMemoriesByUrls(
            explicitRemovedTabs,
            { userInitiated: true }
          );
        } catch (err) {
          DEBUG && console.error("Dock explicit delete sync failed", err);
        }
      }
    })
    .catch((err) => {
      DEBUG && console.error("Dock setSavedTabs sync failed", err);
    });
}

export async function getPlanState() {
  const res = await api.storage.local.get([PLAN_KEY]);
  return normalizePlanState(res[PLAN_KEY] || PLAN_DEFAULTS.free);
}

export async function setPlanState(planState) {
  const next = normalizePlanState(planState);
  await api.storage.local.set({ [PLAN_KEY]: next });
  return next;
}

export async function getOrgState() {
  if (orgStateCache && typeof orgStateCache === "object") return orgStateCache;
  const res = await api.storage.local.get([ORG_KEY]);
  const org = res[ORG_KEY];
  orgStateCache = org && typeof org === "object" ? org : null;
  return orgStateCache;
}

export async function saveOrgState(orgState) {
  const current = await getOrgState();
  const next = {
    ...(current || {}),
    ...(orgState || {}),
    orgId: sanitizeText(orgState?.orgId || current?.orgId || "", 60),
    orgName: sanitizeText(orgState?.orgName || current?.orgName || "", 80),
    orgCode: sanitizeText(orgState?.orgCode || current?.orgCode || "", 60),
    email: sanitizeText(orgState?.email || current?.email || "", 120),
    emailDomain: sanitizeText(orgState?.emailDomain || current?.emailDomain || "", 120),
    configUrl: sanitizeHttpUrl(orgState?.configUrl || current?.configUrl || ""),
    apiBaseUrl: sanitizeHttpUrl(orgState?.apiBaseUrl || current?.apiBaseUrl || ""),
    joinedAt: Number(orgState?.joinedAt || current?.joinedAt) || Date.now(),
    syncMode: sanitizeText(orgState?.syncMode || current?.syncMode || "startup", 40),
    lastSyncedAt: Number(orgState?.lastSyncedAt || current?.lastSyncedAt) || 0,
    lastSyncStatus: sanitizeText(orgState?.lastSyncStatus || current?.lastSyncStatus || "never", 80),
    lastError: sanitizeText(orgState?.lastError || current?.lastError || "", 240)
  };
  if (JSON.stringify(current || null) === JSON.stringify(next)) {
    orgStateCache = next;
    return next;
  }
  await api.storage.local.set({ [ORG_KEY]: next });
  orgStateCache = next;
  return next;
}

export async function clearOrgState() {
  orgStateCache = null;
  managedWorkspaceCache = null;
  managedMetaCache = null;
  workspaceCache = null;
  workspaceLastFetch = 0;
  workspacePromise = null;
  await api.storage.local.remove([ORG_KEY, MANAGED_WS_KEY, MANAGED_META_KEY]);
}

export async function getManagedWorkspace() {
  if (managedWorkspaceCache && typeof managedWorkspaceCache === "object") return managedWorkspaceCache;
  const res = await api.storage.local.get([MANAGED_WS_KEY]);
  const ws = res[MANAGED_WS_KEY];
  managedWorkspaceCache = ws && typeof ws === "object" ? ws : null;
  return managedWorkspaceCache;
}

export async function getManagedMeta() {
  if (managedMetaCache && typeof managedMetaCache === "object") return managedMetaCache;
  const res = await api.storage.local.get([MANAGED_META_KEY]);
  const meta = res[MANAGED_META_KEY];
  managedMetaCache = meta && typeof meta === "object" ? meta : null;
  return managedMetaCache;
}

export async function getManagedSyncState({ ttlMs = MANAGED_SYNC_TTL_MS } = {}) {
  const [org, workspace, meta] = await Promise.all([
    getOrgState(),
    getManagedWorkspace(),
    getManagedMeta()
  ]);
  const syncedAt = Number(meta?.syncedAt || 0);
  const hasWorkspace = !!(workspace?.managed && Array.isArray(workspace?.tabs) && workspace.tabs.length);
  const hasConfig = !!sanitizeHttpUrl(org?.configUrl || "");
  const ageMs = syncedAt ? (Date.now() - syncedAt) : Infinity;
  const isFresh = hasWorkspace && syncedAt > 0 && ageMs < ttlMs;
  return {
    org,
    workspace,
    meta,
    hasConfig,
    hasWorkspace,
    syncedAt,
    ageMs,
    isFresh,
    shouldFetch: hasConfig && (!hasWorkspace || !isFresh)
  };
}

export async function shouldSyncManagedWorkspaceOnBoot({ ttlMs = MANAGED_SYNC_TTL_MS } = {}) {
  const state = await getManagedSyncState({ ttlMs });
  return state.shouldFetch;
}

export async function syncManagedWorkspace({ force = false } = {}) {
  if (managedSyncPromise) return managedSyncPromise;

  const requestId = ++managedSyncRequestId;
  managedSyncPromise = (async () => {
    const org = await getOrgState();
    if (!org?.configUrl) return { ok: false, reason: "NO_CONFIG_URL" };

    const currentManaged = await getManagedWorkspace();
    const currentMeta = await getManagedMeta();
    const recentSyncedAt = Number(currentMeta?.syncedAt || 0);
    const hasFreshManagedCache = !force && currentManaged?.managed && recentSyncedAt && ((Date.now() - recentSyncedAt) < MANAGED_SYNC_TTL_MS);
    if (hasFreshManagedCache) {
      return { ok: true, skipped: true, reason: "LOCAL_FRESH", workspace: currentManaged, organization: await getOrgState(), plan: await getPlanState() };
    }
    try {
      const session = await getSession();
      const headers = {};
      if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
      if (org?.orgCode) headers['X-Dock-Org-Code'] = org.orgCode;
      const response = await fetch(org.configUrl, { cache: "no-store", headers });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const raw = await response.json();
      raw.sourceUrl = org.configUrl;
      const validated = validateManagedPayload(raw);
      const workspace = validated.workspace;

      const incomingVersion = Number(workspace.version) || 0;
      const currentVersion = Number(currentManaged?.version) || 0;
      const incomingUpdatedAt = parseTimestamp(workspace.updatedAt);
      const currentUpdatedAt = parseTimestamp(currentManaged?.updatedAt);
      const buildManagedSignature = (ws) => JSON.stringify({
        id: String(ws?.id || ""),
        tabs: Array.isArray(ws?.tabs) ? ws.tabs.map((tab) => ({
          title: String(tab?.title || ""),
          url: String(tab?.url || ""),
          customIcon: String(tab?.customIcon || ""),
          faviconUrl: String(tab?.faviconUrl || "")
        })) : []
      });
      const incomingSignature = buildManagedSignature(workspace);
      const currentSignature = buildManagedSignature(currentManaged);
      const sameWorkspacePayload = incomingSignature === currentSignature;
      const sameOrOlderByVersion = incomingVersion && currentVersion && incomingVersion <= currentVersion && sameWorkspacePayload;
      const sameOrOlderByTime = !incomingVersion && incomingUpdatedAt && currentUpdatedAt && incomingUpdatedAt <= currentUpdatedAt && sameWorkspacePayload;

      if (requestId < managedSyncCompletedId) {
        return { ok: false, skipped: true, reason: "STALE_RESPONSE" };
      }

      if (currentManaged?.managed && (sameOrOlderByVersion || sameOrOlderByTime)) {
        managedSyncCompletedId = requestId;
        await api.storage.local.set({ [PLAN_KEY]: validated.license });
        await saveOrgState({
          orgId: validated.organization.id,
          orgName: validated.organization.name,
          orgCode: validated.organization.orgCode,
          emailDomain: validated.organization.emailDomain,
          configUrl: org.configUrl,
          lastSyncedAt: Date.now(),
          lastSyncStatus: force ? "up-to-date" : "cached",
          lastError: ""
        });
        return { ok: true, skipped: true, reason: "UP_TO_DATE", workspace: currentManaged, organization: validated.organization, plan: validated.license };
      }

      managedSyncCompletedId = requestId;
      const nextMeta = {
          orgId: validated.organization.id,
          orgName: validated.organization.name,
          orgCode: validated.organization.orgCode,
          emailDomain: validated.organization.emailDomain,
          syncedAt: Date.now(),
          configUrl: org.configUrl,
          version: incomingVersion,
          updatedAt: incomingUpdatedAt,
          publishedAt: parseTimestamp(workspace.publishedAt)
        };
      await api.storage.local.set({
        [MANAGED_WS_KEY]: workspace,
        [MANAGED_META_KEY]: nextMeta,
        [PLAN_KEY]: validated.license
      });
      managedWorkspaceCache = workspace;
      managedMetaCache = nextMeta;
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
      return { ok: true, workspace, organization: validated.organization, plan: validated.license };
    } catch (err) {
      await saveOrgState({ lastSyncedAt: Date.now(), lastSyncStatus: "error", lastError: sanitizeText(err?.message || String(err), 240) });
      return { ok: false, reason: "FETCH_FAILED", error: err?.message || String(err) };
    }
  })();

  try {
    return await managedSyncPromise;
  } finally {
    managedSyncPromise = null;
  }
}

export async function getTotalPersonalMemoryCount() {
  const [savedTabs, groupState] = await Promise.all([getSavedTabs({ localOnly: true }), loadGroupState()]);
  const workspaceCount = Object.values(groupState.groupItems || {}).reduce((sum, items) => sum + (Array.isArray(items) ? items.length : 0), 0);
  return (Array.isArray(savedTabs) ? savedTabs.length : 0) + workspaceCount;
}

export async function assertCanSavePersonalMemory() {
  const plan = await getPlanState();
  if (!Number.isFinite(plan.maxPersonalItems)) return { ok: true, plan };
  const count = await getTotalPersonalMemoryCount();
  if (count >= plan.maxPersonalItems) throw "LIMIT_REACHED";
  return { ok: true, plan, count };
}

export async function saveTab(tab, { skipDuplicates = true } = {}) {
  await assertCanSavePersonalMemory();
  const savedTabs = await getSavedTabs({ localOnly: true });
  if (shouldExcludeMemoryUrl(tab)) {
    return { ok: true, skippedExcluded: true };
  }
  if (skipDuplicates && isDuplicateTab(tab, savedTabs)) {
    return { ok: true, skippedDuplicate: true };
  }
  savedTabs.push(tab);
  await setSavedTabs(savedTabs);
  return { ok: true, skippedDuplicate: false };
}

export async function deleteTab(index) {
  const previousTabs = await getSavedTabs({ localOnly: true });
  const removed = previousTabs[index] ? [previousTabs[index]] : [];
  const savedTabs = [...previousTabs];
  savedTabs.splice(index, 1);
  await setSavedTabs(savedTabs, { removedTabs: removed });
}

// Grouping state used by memories.html
export async function loadGroupState() {
  const res = await api.storage.local.get(["dockGroups","dockActiveGroup","dockGroupItems"]);
  return {
    groups: Array.isArray(res.dockGroups) ? res.dockGroups : [],
    groupItems: (res.dockGroupItems && typeof res.dockGroupItems === "object") ? res.dockGroupItems : {},
    activeGroup: String(res.dockActiveGroup || "").trim() || "__all__"
  };
}

export async function saveGroupState({ groups, groupItems, activeGroup }) {
  await api.storage.local.set({
    dockGroups: groups,
    dockGroupItems: groupItems,
    dockActiveGroup: (activeGroup && activeGroup !== "__all__") ? activeGroup : ""
  });
}

export async function getLocalAdminWorkspace() {
  const res = await api.storage.local.get(["dockAdminWorkspace"]);
  const ws = res.dockAdminWorkspace;
  return (ws && typeof ws === "object") ? ws : null;
}

export async function getAdminWorkspace() {
  const managed = await getManagedWorkspace();
  if (managed?.managed && Array.isArray(managed.tabs) && managed.tabs.length) return managed;
  return null;
}

export async function saveAdminWorkspace(workspace) {
  if (!workspace) {
    await api.storage.local.remove(["dockAdminWorkspace"]);
    return;
  }
  await api.storage.local.set({ dockAdminWorkspace: workspace });
}

export async function clearAllDockData({ keepWorkspaces = true, keepAdminWorkspace = true } = {}) {
  const patch = { savedTabs: [] };
  if (!keepWorkspaces) {
    patch.dockGroups = [];
    patch.dockGroupItems = {};
  }
  patch.dockActiveGroup = "";
  if (!keepAdminWorkspace) patch.dockAdminWorkspace = null;
  await api.storage.local.set(patch);
}

export function buildManagedConfigExport({ organization = {}, workspace = {}, license = {} } = {}) {
  const normalizedTabs = Array.isArray(workspace.tabs) ? workspace.tabs.slice(0, 50).map((t) => ({
    title: sanitizeText(t?.title, 80) || sanitizeText(t?.url, 80) || "Untitled",
    url: sanitizeHttpUrl(t?.url),
    customIcon: sanitizeIconUrl(t?.customIcon) || "",
    faviconUrl: sanitizeHttpUrl(t?.faviconUrl) || ""
  })).filter((t) => t.url) : [];
  return {
    version: 1,
    type: "dock-managed-config",
    organization: {
      id: sanitizeText(organization.id || organization.orgCode || "district", 60),
      name: sanitizeText(organization.name || "District", 80),
      orgCode: sanitizeText(organization.orgCode || organization.id || "district", 60),
      emailDomain: sanitizeText(organization.emailDomain || "", 120)
    },
    license: {
      plan: normalizePlanState(license).plan,
      label: normalizePlanState(license).label,
      maxUsers: normalizePlanState(license).maxUsers || null
    },
    workspace: {
      name: sanitizeText(workspace.name || "District Workspace", 80),
      updatedAt: Date.now(),
      tabs: normalizedTabs
    }
  };
}

export { normalizeUrl, isDuplicateTab, sanitizeHttpUrl, sanitizeText, validateManagedPayload, ensureColor, PLAN_DEFAULTS };
