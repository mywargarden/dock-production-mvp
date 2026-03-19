const api = (typeof browser !== "undefined" && browser?.runtime?.getURL) ? browser : chrome;

// Background service worker
// Bulk saving + per-tab screenshots runs here because the popup closes when tabs switch.
 

const PLAN_KEY = "dockPlanState";
const ORG_KEY = "dockOrg";
const MANAGED_WS_KEY = "dockManagedWorkspace";
const MANAGED_META_KEY = "dockManagedMeta";
const MANAGED_SYNC_ALARM = "dockManagedSync";

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

async function ensureBootstrapOrgState() {
  const current = await getOrgState();
  if (current?.orgCode === HARDCODED_MVP_ORG.orgCode && current?.configUrl === HARDCODED_MVP_ORG.configUrl) return current;
  const next = { ...(current || {}), ...HARDCODED_MVP_ORG };
  await api.storage.local.set({ [ORG_KEY]: next, [PLAN_KEY]: { plan: 'district', label: 'District', maxPersonalItems: Infinity, source: 'managed', maxUsers: 500 } });
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
      tabs
    },
    license: normalizePlanState({ plan: license.plan || "district", maxUsers: license.maxUsers })
  };
}
async function backgroundSyncManagedWorkspace() {
  const org = await getOrgState();
  if (!org?.configUrl) return { ok: false, reason: "NO_CONFIG_URL" };
  try {
    const response = await fetch(org.configUrl, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const raw = await response.json();
    const validated = validateManagedPayload(raw);
    const current = (await api.storage.local.get([MANAGED_WS_KEY]))[MANAGED_WS_KEY] || null;
    const incomingVersion = Number(validated.workspace.updatedAt) || 0;
    const currentVersion = Number(current?.updatedAt) || 0;
    if (current?.managed && incomingVersion && currentVersion && incomingVersion <= currentVersion) {
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
    return { ok: true };
  } catch (err) {
    await saveOrgState({ lastSyncedAt: Date.now(), lastSyncStatus: "error", lastError: sanitizeText(err?.message || String(err), 240) });
    return { ok: false, error: err?.message || String(err) };
  }
}
async function ensureManagedSyncAlarm() {
  if (!api.alarms?.create) return;
  api.alarms.create(MANAGED_SYNC_ALARM, { periodInMinutes: 0.5 });
}

async function getSavedTabs() {
  const result = await api.storage.local.get(["savedTabs"]);
  return result.savedTabs || [];
}

async function setSavedTabs(savedTabs) {
  await api.storage.local.set({ savedTabs });
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

function hasDuplicateUrl(payload, items) {
  const target = normalizeUrl(payload?.url);
  if (!target) return false;
  return (items || []).some((item) => normalizeUrl(item?.url) === target);
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
  await sleep(40); // faster settle
}

async function captureVisible(windowId) {
  try {
    return await api.tabs.captureVisibleTab(windowId, { format: "jpeg", quality: 60 });
  } catch {
    return null;
  }
}

async function captureVisibleWithRetries(windowId, profile = "normal") {
  // Tuned for speed: quicker early retries; still has a strong profile for stubborn tabs.
  const delays =
    profile === "strong"
      ? [0, 60, 110, 180, 260]
      : [0, 40, 90, 150];

  for (const d of delays) {
    if (d) await sleep(d);
    const shot = await captureVisible(windowId);
    if (shot) return shot;
  }
  return null;
}

function waitForActivation(tabId, timeoutMs = 900) {
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
  await waitForActivation(tabId, 900);
  await sleep(55); // faster paint settle
}

function orderTabsFromActive(tabs, activeTabId) {
  const sorted = [...tabs].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  const startIdx = Math.max(0, sorted.findIndex(t => t.id === activeTabId));
  if (startIdx <= 0) return sorted;
  return [...sorted.slice(startIdx), ...sorted.slice(0, startIdx)];
}


async function findOpenMemoriesTab() {
  const memoriesUrl = api.runtime.getURL("memories.html");
  const tabs = await api.tabs.query({ url: memoriesUrl });
  if (!Array.isArray(tabs) || !tabs.length) return null;

  const currentWin = await api.windows.getCurrent({ populate: false }).catch(() => null);
  if (currentWin?.id != null) {
    const inCurrent = tabs.find(t => t.windowId === currentWin.id);
    if (inCurrent) return inCurrent;
  }
  return tabs[0] || null;
}

async function openOrRefreshMemoriesTab() {
  const memoriesUrl = api.runtime.getURL("memories.html");
  const existing = await findOpenMemoriesTab();

  if (existing?.id != null) {
    try { await api.windows.update(existing.windowId, { focused: true }); } catch {}
    try { await api.tabs.reload(existing.id); } catch {}
    try { await api.tabs.update(existing.id, { active: true, url: memoriesUrl }); } catch {
      try { await api.tabs.update(existing.id, { active: true }); } catch {}
    }
    return existing;
  }

  try {
    return await api.tabs.create({ url: memoriesUrl, active: true });
  } catch {
    return null;
  }
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

    // Slight reliability boost near the end (still fast)
    const nearEnd = i >= tabs.length - 2;
    const retryProfile = nearEnd ? "strong" : "normal";

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
      if (nearEnd) await sleep(40); // small end-of-loop settle

      shot = await captureVisibleWithRetries(windowId, retryProfile);
      blocked = !shot;

      if (!shot) {
        // One re-activate + strong retry (kept, but faster)
        await activateTabReliable(t.id);
        await sleep(85);
        shot = await captureVisibleWithRetries(windowId, "strong");
        blocked = !shot;
      }
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

    // Faster throttle between tabs; keeps Chrome from falling behind
    await sleep(45);
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
      const result = await backgroundSyncManagedWorkspace();
      sendResponse(result?.ok ? { ok: true, ...result } : { ok: false, ...(result || {}) });
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


api.runtime.onInstalled?.addListener(() => { ensureManagedSyncAlarm().catch(() => {}); ensureBootstrapOrgState().then(() => backgroundSyncManagedWorkspace()).catch(() => {}); });
api.runtime.onStartup?.addListener(() => { ensureManagedSyncAlarm().catch(() => {}); ensureBootstrapOrgState().then(() => backgroundSyncManagedWorkspace()).catch(() => {}); });
api.alarms?.onAlarm?.addListener((alarm) => { if (alarm?.name === MANAGED_SYNC_ALARM) ensureBootstrapOrgState().then(() => backgroundSyncManagedWorkspace()).catch(() => {}); });
