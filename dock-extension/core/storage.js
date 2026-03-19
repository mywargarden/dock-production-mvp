import { api } from "../adapters/index.js";

const PLAN_KEY = "dockPlanState";
const ORG_KEY = "dockOrg";
const MANAGED_WS_KEY = "dockManagedWorkspace";
const MANAGED_META_KEY = "dockManagedMeta";
const DEFAULT_GROUP_COLOR = "#6f4cff";

const HARDCODED_MVP_ORG = {
  orgId: 'henry-county',
  orgName: 'Henry County Public Schools',
  orgCode: 'henry-county',
  emailDomain: 'henry.k12.va.us',
  configUrl: 'https://dock-production-mvp.vercel.app/api/org/henry-county/workspace',
  syncMode: 'hardcoded-mvp',
  joinedAt: Date.now(),
  lastSyncedAt: 0,
  lastSyncStatus: 'never',
  lastError: ''
};

export async function ensureHardcodedManagedBootstrap() {
  const current = await getOrgState();
  const currentUrl = sanitizeHttpUrl(current?.configUrl || '');
  if (current?.orgCode === HARDCODED_MVP_ORG.orgCode && currentUrl === HARDCODED_MVP_ORG.configUrl) {
    const plan = await getPlanState();
    if (plan.plan !== 'district') await setPlanState({ plan: 'district', label: 'District', source: 'managed', maxUsers: 500 });
    return current;
  }
  const next = await saveOrgState({ ...HARDCODED_MVP_ORG });
  await setPlanState({ plan: 'district', label: 'District', source: 'managed', maxUsers: 500 });
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

function normalizeUrl(url) {
  const raw = norm(url);
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    parsed.hash = "";
    if ((parsed.protocol === "http:" && parsed.port === "80") || (parsed.protocol === "https:" && parsed.port === "443")) parsed.port = "";
    let href = parsed.toString();
    if (href.endsWith("/")) href = href.slice(0, -1);
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
  return {
    organization: {
      id: sanitizeText(org.id || org.orgCode || "district", 60),
      name: sanitizeText(org.name || "District", 80),
      orgCode: sanitizeText(org.orgCode || org.id || "district", 60),
      emailDomain: sanitizeText(org.emailDomain || "", 120)
    },
    workspace: {
      name: sanitizeText(workspace.name || "District Workspace", 80),
      locked: true,
      managed: true,
      updatedAt: Number(workspace.updatedAt) || Date.now(),
      sourceUrl: sanitizeHttpUrl(payload.sourceUrl || ""),
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

export async function getSavedTabs() {
  const result = await api.storage.local.get(["savedTabs"]);
  return result.savedTabs || [];
}

export async function setSavedTabs(savedTabs) {
  await api.storage.local.set({ savedTabs });
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
  const res = await api.storage.local.get([ORG_KEY]);
  const org = res[ORG_KEY];
  return org && typeof org === "object" ? org : null;
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
    joinedAt: Number(orgState?.joinedAt || current?.joinedAt) || Date.now(),
    syncMode: sanitizeText(orgState?.syncMode || current?.syncMode || "startup", 40),
    lastSyncedAt: Number(orgState?.lastSyncedAt || current?.lastSyncedAt) || 0,
    lastSyncStatus: sanitizeText(orgState?.lastSyncStatus || current?.lastSyncStatus || "never", 80),
    lastError: sanitizeText(orgState?.lastError || current?.lastError || "", 240)
  };
  await api.storage.local.set({ [ORG_KEY]: next });
  return next;
}

export async function clearOrgState() {
  await api.storage.local.remove([ORG_KEY, MANAGED_WS_KEY, MANAGED_META_KEY]);
}

export async function getManagedWorkspace() {
  const res = await api.storage.local.get([MANAGED_WS_KEY]);
  const ws = res[MANAGED_WS_KEY];
  return ws && typeof ws === "object" ? ws : null;
}

export async function getManagedMeta() {
  const res = await api.storage.local.get([MANAGED_META_KEY]);
  const meta = res[MANAGED_META_KEY];
  return meta && typeof meta === "object" ? meta : null;
}

export async function syncManagedWorkspace({ force = false } = {}) {
  const org = await getOrgState();
  if (!org?.configUrl) return { ok: false, reason: "NO_CONFIG_URL" };
  const currentManaged = await getManagedWorkspace();
  try {
    const response = await fetch(org.configUrl, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const raw = await response.json();
    raw.sourceUrl = org.configUrl;
    const validated = validateManagedPayload(raw);
    const workspace = validated.workspace;
    const incomingVersion = Number(workspace.updatedAt) || 0;
    const currentVersion = Number(currentManaged?.updatedAt) || 0;
    if (currentManaged?.managed && currentVersion && incomingVersion && incomingVersion <= currentVersion) {
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
    await api.storage.local.set({
      [MANAGED_WS_KEY]: workspace,
      [MANAGED_META_KEY]: {
        orgId: validated.organization.id,
        orgName: validated.organization.name,
        orgCode: validated.organization.orgCode,
        emailDomain: validated.organization.emailDomain,
        syncedAt: Date.now(),
        configUrl: org.configUrl,
        updatedAt: incomingVersion
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
    return { ok: true, workspace, organization: validated.organization, plan: validated.license };
  } catch (err) {
    await saveOrgState({ lastSyncedAt: Date.now(), lastSyncStatus: "error", lastError: sanitizeText(err?.message || String(err), 240) });
    return { ok: false, reason: "FETCH_FAILED", error: err?.message || String(err) };
  }
}

export async function getTotalPersonalMemoryCount() {
  const [savedTabs, groupState] = await Promise.all([getSavedTabs(), loadGroupState()]);
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
  const savedTabs = await getSavedTabs();
  if (skipDuplicates && isDuplicateTab(tab, savedTabs)) {
    return { ok: true, skippedDuplicate: true };
  }
  savedTabs.push(tab);
  await setSavedTabs(savedTabs);
  return { ok: true, skippedDuplicate: false };
}

export async function deleteTab(index) {
  const savedTabs = await getSavedTabs();
  savedTabs.splice(index, 1);
  await setSavedTabs(savedTabs);
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
