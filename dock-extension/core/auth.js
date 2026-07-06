// Dock extension auth should return to extension callback, not the admin web app.

import { api } from "../adapters/index.js";

const DEBUG = false;
const AUTH_SESSION_KEY = "dockAuthSession";
const AUTH_USER_KEY = "dockAuthUser";
const AUTH_STATE_KEY = "dockAuthState";

const DEFAULT_API_BASE_URL = "https://dock-production-mvp.vercel.app";
const DEFAULT_SUPABASE_URL = "https://mcqohghghfxtchxpaddj.supabase.co";
const DEFAULT_SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1jcW9oZ2hnaGZ4dGNoeHBhZGRqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM3NTkzNjcsImV4cCI6MjA4OTMzNTM2N30.-C_0R5-8iroOq_UoI1UBseDiuz-Auv6od1dLdAO6okQ";
const WRITE_DEBOUNCE_MS = 350;
const DUPLICATE_WINDOW_MS = 1500;
const DELETE_STARTUP_GRACE_MS = 45000;
const DELETE_REPEAT_COOLDOWN_MS = 30000;

let pendingWriteTimer = null;
let pendingWriteQueue = null;
let lastWriteSignature = "";
let lastWriteAt = 0;
const inflightWriteSignatures = new Set();
const deleteCooldowns = new Map();
const moduleStartedAt = Date.now();

let cachedSession = null;
let cachedUser = null;
let sessionLoaded = false;
let userLoaded = false;
let inflightSessionPromise = null;
let inflightUserPromise = null;

const AUTH_CONFIG = {
  supabaseUrl: "https://mcqohghghfxtchxpaddj.supabase.co",
  supabaseAnonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1jcW9oZ2hnaGZ4dGNoeHBhZGRqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM3NTkzNjcsImV4cCI6MjA4OTMzNTM2N30.-C_0R5-8iroOq_UoI1UBseDiuz-Auv6od1dLdAO6okQ",
  apiBaseUrl: "https://dock-production-mvp.vercel.app"
};
let authConfigLoaded = false;

function norm(value) {
  return String(value || "").trim();
}


const JUNK_QUERY_PARAMS = new Set([
  "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
  "utm_id", "utm_name", "utm_cid", "utm_reader", "utm_viz_id",
  "fbclid", "gclid", "dclid", "gbraid", "wbraid", "igshid",
  "mc_cid", "mc_eid", "ref", "ref_src", "source"
]);

function normalizeMemoryUrl(url) {
  const raw = norm(url);
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    const protocol = parsed.protocol.toLowerCase();
    if (!["http:", "https:"].includes(protocol)) return "";

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
    return "";
  }
}

function shouldExcludeMemoryUrl(value) {
  const raw = normalizeMemoryUrl(value);
  if (!raw) return true;
  if (/^(chrome|edge|about|file|blob|data|devtools):/i.test(raw)) return true;
  if (raw.startsWith("chrome-extension://") || raw.startsWith("safari-extension://")) return true;
  if (raw.includes("chromewebstore.google.com")) return true;
  if (/^https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d+)?(?:\/|$)/i.test(raw)) return true;

  try {
    const parsed = new URL(raw);
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname || "/";
    if (host === "dock-production-mvp.vercel.app") return true;
    if (
      raw === "chrome://newtab" ||
      raw === "chrome://newtab/" ||
      raw === "about:blank" ||
      host === "newtab" ||
      path === "/newtab"
    ) return true;
  } catch {
    return true;
  }

  return false;
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function getRedirectUrl() {
  try {
    return api.identity.getRedirectURL("supabase-auth");
  } catch (e) {
    try {
      return api.identity.getRedirectURL();
    } catch (e2) {
      return "";
    }
  }
}


async function resetOrgBootstrapState() {
  try { globalThis?.localStorage?.removeItem('dock_org'); } catch {}
  try {
    await api.storage.local.remove(['dockOrg']);
  } catch {}
}

async function forceProfileBootstrapSync(user, token) {
  try {
    const email = norm(user?.email).toLowerCase();
    const domain = email.includes('@') ? (email.split('@')[1] || '') : '';
    if (!domain || !token) return;
    const apiBase = getApiBaseUrl();
    const bootstrapUrl = new URL(`${apiBase}/api/bootstrap`);
    bootstrapUrl.searchParams.set('domain', domain);
    bootstrapUrl.searchParams.set('_dockDebugTs', String(Date.now()));

    const bootstrapRes = await fetch(bootstrapUrl.toString(), {
      method: 'GET',
      cache: 'no-store',
      headers: buildBearerHeaders(token, user)
    });

    let bootstrapJson = null;
    try { bootstrapJson = await bootstrapRes.json(); } catch {}

    const configUrl = norm(bootstrapJson?.configUrl);
    let workspaceJson = null;
    if (configUrl) {
      const workspaceUrl = new URL(configUrl);
      workspaceUrl.searchParams.set('_dockDebugTs', String(Date.now()));
      const workspaceRes = await fetch(workspaceUrl.toString(), {
        method: 'GET',
        cache: 'no-store',
        headers: buildBearerHeaders(token, user)
      });
      try { workspaceJson = await workspaceRes.json(); } catch {}
    }

    await api.storage.local.set({
      dockLastProfileSyncDebug: {
        at: new Date().toISOString(),
        bootstrapOk: bootstrapRes.ok,
        bootstrapStatus: bootstrapRes.status,
        bootstrapJson,
        workspaceJson
      }
    });
  } catch (error) {
    try {
      await api.storage.local.set({
        dockLastProfileSyncDebug: {
          at: new Date().toISOString(),
          error: String(error?.message || error || 'unknown-error')
        }
      });
    } catch {}
  }
}

function getApiBaseUrl() {
  const raw = norm(AUTH_CONFIG.apiBaseUrl || DEFAULT_API_BASE_URL);
  return raw || DEFAULT_API_BASE_URL;
}

function buildBearerHeaders(token, user = null, extra = {}) {
  const headers = { ...extra };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (user?.id) {
    headers['X-Dock-User-Id'] = norm(user.id);
    headers['X-User-Id'] = norm(user.id);
  }
  if (user?.email) {
    headers['X-Dock-User-Email'] = norm(user.email).toLowerCase();
    headers['X-User-Email'] = norm(user.email).toLowerCase();
  }
  return headers;
}

function isRecentlyProcessed(signature) {
  return !!signature && signature === lastWriteSignature && (Date.now() - lastWriteAt) < DUPLICATE_WINDOW_MS;
}

function rememberProcessed(signature) {
  lastWriteSignature = signature || "";
  lastWriteAt = Date.now();
}

function shouldSkipDeleteSignature(signature) {
  const ts = deleteCooldowns.get(signature);
  if (!ts) return false;
  return (Date.now() - ts) < DELETE_REPEAT_COOLDOWN_MS;
}

function rememberDeleteSignature(signature) {
  deleteCooldowns.set(signature, Date.now());
  if (deleteCooldowns.size > 200) {
    for (const [key, ts] of deleteCooldowns.entries()) {
      if ((Date.now() - ts) >= DELETE_REPEAT_COOLDOWN_MS) {
        deleteCooldowns.delete(key);
      }
    }
  }
}

async function launchSupabaseAuthFlow(authUrl) {
  const finalUrl = await api.identity.launchWebAuthFlow({
    url: authUrl,
    interactive: true
  });
  if (!finalUrl) throw new Error("Authentication was cancelled.");
  return finalUrl;
}

async function ensureAuthConfigLoaded() {
  if (authConfigLoaded) return AUTH_CONFIG;
  authConfigLoaded = true;
  const keys = ["dockAuthConfig", "supabaseUrl", "supabaseAnonKey", "apiBaseUrl"];
  let managed = {};
  let local = {};
  try { managed = await api.storage.managed.get(keys); } catch {}
  try { local = await api.storage.local.get(keys); } catch {}
  const nested = (local?.dockAuthConfig && typeof local.dockAuthConfig === "object") ? local.dockAuthConfig : {};
  AUTH_CONFIG.supabaseUrl = norm(local?.supabaseUrl || nested?.supabaseUrl || managed?.supabaseUrl || AUTH_CONFIG.supabaseUrl || DEFAULT_SUPABASE_URL);
  AUTH_CONFIG.supabaseAnonKey = norm(local?.supabaseAnonKey || nested?.supabaseAnonKey || managed?.supabaseAnonKey || AUTH_CONFIG.supabaseAnonKey || DEFAULT_SUPABASE_ANON_KEY);
  AUTH_CONFIG.apiBaseUrl = norm(local?.apiBaseUrl || nested?.apiBaseUrl || managed?.apiBaseUrl || AUTH_CONFIG.apiBaseUrl || DEFAULT_API_BASE_URL);
  return AUTH_CONFIG;
}

function isConfigured() {
  return /^https:\/\/.+\.supabase\.co$/i.test(norm(AUTH_CONFIG.supabaseUrl)) && norm(AUTH_CONFIG.supabaseAnonKey) && !/YOUR_/i.test(norm(AUTH_CONFIG.supabaseAnonKey));
}

async function getStoredSession() {
  if (sessionLoaded) return cachedSession;
  const res = await api.storage.local.get([AUTH_SESSION_KEY]);
  const session = res?.[AUTH_SESSION_KEY];
  cachedSession = session && typeof session === "object" ? session : null;
  sessionLoaded = true;
  return cachedSession;
}

async function setStoredSession(session) {
  cachedSession = session && typeof session === "object" ? session : null;
  sessionLoaded = true;
  await api.storage.local.set({ [AUTH_SESSION_KEY]: cachedSession || null });
}

async function getStoredUser() {
  if (userLoaded) return cachedUser;
  const res = await api.storage.local.get([AUTH_USER_KEY]);
  const user = res?.[AUTH_USER_KEY];
  cachedUser = user && typeof user === "object" ? user : null;
  userLoaded = true;
  return cachedUser;
}

async function setStoredUser(user) {
  cachedUser = user && typeof user === "object" ? user : null;
  userLoaded = true;
  await api.storage.local.set({ [AUTH_USER_KEY]: cachedUser || null });
}

async function setAuthState(state) {
  await api.storage.local.set({ [AUTH_STATE_KEY]: state || null });
}

function parseUrlTokens(url) {
  try {
    const parsed = new URL(url);
    const hashParams = new URLSearchParams((parsed.hash || "").replace(/^#/, ""));
    const searchParams = parsed.searchParams;
    const token_type = hashParams.get("token_type") || searchParams.get("token_type") || "bearer";
    const access_token = hashParams.get("access_token") || searchParams.get("access_token") || "";
    const refresh_token = hashParams.get("refresh_token") || searchParams.get("refresh_token") || "";
    const expires_in = Number(hashParams.get("expires_in") || searchParams.get("expires_in") || "3600") || 3600;
    return { access_token, refresh_token, token_type, expires_in };
  } catch {
    return { access_token: "", refresh_token: "", token_type: "bearer", expires_in: 3600 };
  }
}

async function fetchJson(url, { method = "GET", headers = {}, body } = {}) {
  const response = await fetch(url, { method, headers, body });
  let data = null;
  try { data = await response.json(); } catch {}
  if (!response.ok) {
    throw new Error(data?.error_description || data?.msg || data?.message || `HTTP_${response.status}`);
  }
  return data;
}

async function fetchSupabaseUser(accessToken) {
  const url = `${norm(AUTH_CONFIG.supabaseUrl)}/auth/v1/user`;
  return await fetchJson(url, {
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "apikey": norm(AUTH_CONFIG.supabaseAnonKey)
    }
  });
}

async function refreshSession() {
  await ensureAuthConfigLoaded();
  const session = await getStoredSession();
  const refreshToken = norm(session?.refresh_token);
  if (!refreshToken || !isConfigured()) return null;
  const url = `${norm(AUTH_CONFIG.supabaseUrl)}/auth/v1/token?grant_type=refresh_token`;
  const data = await fetchJson(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": norm(AUTH_CONFIG.supabaseAnonKey)
    },
    body: JSON.stringify({ refresh_token: refreshToken })
  });
  const nextSession = {
    access_token: norm(data?.access_token),
    refresh_token: norm(data?.refresh_token || refreshToken),
    token_type: norm(data?.token_type || "bearer"),
    expires_at: nowSeconds() + (Number(data?.expires_in) || 3600)
  };
  await setStoredSession(nextSession);
  const user = data?.user || await fetchSupabaseUser(nextSession.access_token);
  await setStoredUser(user || null);
  await setAuthState({ status: "signed-in", userEmail: norm(user?.email), updatedAt: Date.now() });
  return nextSession;
}

export async function getSession() {
  if (inflightSessionPromise) return inflightSessionPromise;
  inflightSessionPromise = (async () => {
    const session = await getStoredSession();
    if (!session?.access_token) return null;
    if (Number(session.expires_at || 0) <= nowSeconds() + 60) {
      try {
        return await refreshSession();
      } catch {
        await signOut();
        return null;
      }
    }
    return session;
  })();
  try {
    return await inflightSessionPromise;
  } finally {
    inflightSessionPromise = null;
  }
}

export async function getCurrentUser() {
  if (inflightUserPromise) return inflightUserPromise;
  inflightUserPromise = (async () => {
    const session = await getSession();
    if (!session?.access_token) return null;
    const cached = await getStoredUser();
    if (cached && typeof cached === "object" && Object.keys(cached).length) return cached;
    try {
      const user = await fetchSupabaseUser(session.access_token);
      await setStoredUser(user || null);
      return user || null;
    } catch {
      return cached || null;
    }
  })();
  try {
    return await inflightUserPromise;
  } finally {
    inflightUserPromise = null;
  }
}

export async function isSignedIn() {
  const session = await getSession();
  return !!session?.access_token;
}

export async function signOut() {
  await setStoredSession(null);
  await setStoredUser(null);
  await setAuthState({ status: "signed-out", updatedAt: Date.now() });
  await resetOrgBootstrapState();
  try { await api.identity.clearAllCachedAuthTokens(); } catch {}
  return { ok: true };
}

export async function signInWithGoogleInteractive() {
  await ensureAuthConfigLoaded();
  if (!isConfigured()) {
    throw new Error("Dock personal sign-in is not configured yet. Paste your Supabase anon/public key into DEFAULT_SUPABASE_ANON_KEY at the top of dock-extension/core/auth.js, save, then reload the extension.");
  }
  const redirectTo = getRedirectUrl();
  const authUrl = new URL(`${norm(AUTH_CONFIG.supabaseUrl)}/auth/v1/authorize`);
  authUrl.searchParams.set("provider", "google");
  authUrl.searchParams.set("redirect_to", redirectTo);
  authUrl.searchParams.set("scopes", "openid email profile");
  authUrl.searchParams.set("flow_type", "implicit");

  const finalUrl = await api.identity.launchWebAuthFlow({
    url: authUrl.toString(),
    interactive: true
  });

  const parsed = parseUrlTokens(finalUrl || "");
  if (!parsed.access_token) {
    throw new Error("Google sign-in did not return an access token.");
  }

  const session = {
    access_token: parsed.access_token,
    refresh_token: parsed.refresh_token,
    token_type: parsed.token_type || "bearer",
    expires_at: nowSeconds() + (Number(parsed.expires_in) || 3600)
  };
  await setStoredSession(session);

  const user = await fetchSupabaseUser(session.access_token);
  await setStoredUser(user || null);
  await setAuthState({ status: "signed-in", userEmail: norm(user?.email), updatedAt: Date.now() });
  await resetOrgBootstrapState();
  await forceProfileBootstrapSync(user || null, session.access_token);

  return { session, user };
}

export async function ensureSignedInInteractive() {
  if (await isSignedIn()) {
    return { ok: true, alreadySignedIn: true, user: await getCurrentUser() };
  }
  const result = await signInWithGoogleInteractive();
  return { ok: true, alreadySignedIn: false, ...result };
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
    // Keep personal sync bounded. Full screenshots should be upload-only and compressed;
    // oversized blobs are skipped rather than making the extension expensive or brittle.
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

function normalizeMemoryRecord(tab) {
  const url = normalizeMemoryUrl(tab?.url);
  const screenshot = sanitizeScreenshotDataForSync(tab?.screenshot_data_url, tab?.screenshot, tab?.screenshotThumb);
  const screenshot_url = sanitizeScreenshotUrlForSync(tab?.screenshot_url, tab?.screenshotUrl);
  return {
    title: norm(tab?.title).slice(0, 120),
    url,
    icon_url: sanitizePersonalIconForSync(tab?.faviconUrl || tab?.icon_url || ""),
    screenshot_data_url: screenshot,
    screenshot_url,
    screenshot_blocked: !!tab?.screenshotBlocked,
    reason: norm(tab?.reason).slice(0, 500),
    local_id: norm(tab?.local_id || url)
  };
}

function buildMemoryFingerprint(tab) {
  return JSON.stringify(normalizeMemoryRecord(tab));
}

function queueSyncJob(signature, run) {
  if (isRecentlyProcessed(signature)) {
    return Promise.resolve({ ok: true, skipped: "duplicate" });
  }
  if (inflightWriteSignatures.has(signature)) {
    return Promise.resolve({ ok: true, skipped: "inflight" });
  }

  return new Promise((resolve) => {
    pendingWriteQueue = { signature, run, resolve };
    if (pendingWriteTimer) clearTimeout(pendingWriteTimer);
    pendingWriteTimer = setTimeout(async () => {
      const job = pendingWriteQueue;
      pendingWriteQueue = null;
      pendingWriteTimer = null;
      if (!job) return;
      if (isRecentlyProcessed(job.signature)) {
        job.resolve({ ok: true, skipped: "duplicate" });
        return;
      }
      if (inflightWriteSignatures.has(job.signature)) {
        job.resolve({ ok: true, skipped: "inflight" });
        return;
      }
      inflightWriteSignatures.add(job.signature);
      try {
        const result = await job.run();
        if (result?.ok !== false) rememberProcessed(job.signature);
        job.resolve(result);
      } catch {
        job.resolve({ ok: false });
      } finally {
        inflightWriteSignatures.delete(job.signature);
      }
    }, WRITE_DEBOUNCE_MS);
  });
}

async function getAccessToken() {
  const session = await getSession();
  return norm(session?.access_token);
}

export async function syncSavedTabsDiff(previousTabs = [], nextTabs = []) {
  await ensureAuthConfigLoaded();

  const previousByUrl = new Map((previousTabs || [])
    .map((tab) => [normalizeMemoryUrl(tab?.url), tab])
    .filter(([url]) => url));
  const changedEntries = (nextTabs || [])
    .map((tab) => normalizeMemoryRecord(tab))
    .filter((tab) => tab.url)
    .filter((tab) => !shouldExcludeMemoryUrl(tab.url))
    .filter((tab) => {
      const prev = previousByUrl.get(tab.url);
      return !prev || buildMemoryFingerprint(prev) !== JSON.stringify(tab);
    })
    .sort((a, b) => a.url.localeCompare(b.url));

  if (!changedEntries.length) {
    return { ok: true, skipped: "no-changes" };
  }

  const signature = `upsert:${JSON.stringify(changedEntries)}`;
  return queueSyncJob(signature, async () => {
    const token = await getAccessToken();
    if (!token) return { ok: false, skipped: "not-signed-in" };

    const apiBase = getApiBaseUrl();
    let orgCode = '';
    try {
      const stored = await api.storage.local.get(['dockOrg']);
      orgCode = norm(stored?.dockOrg?.orgCode);
    } catch {}
    let synced = 0;
    let failed = 0;
    for (const entry of changedEntries) {
      try {
        const user = await getCurrentUser();
        const headers = buildBearerHeaders(token, user, {
          "Content-Type": "application/json"
        });
        if (orgCode) headers['X-Dock-Org-Code'] = orgCode;
        await fetchJson(`${apiBase}/api/user/memories`, {
          method: "POST",
          headers,
          body: JSON.stringify(entry)
        });
        synced++;
      } catch (error) {
        failed++;
        DEBUG && console.error("Dock personal memory sync failed", entry?.url || "unknown-url", error);
      }
    }

    return failed ? { ok: false, synced, failed } : { ok: true, synced };
  });
}

export async function deleteRemoteMemoriesByUrls(items = [], options = {}) {
  await ensureAuthConfigLoaded();

  const rawItems = Array.isArray(items) ? items : [];
  const entries = rawItems
    .map((item) => {
      if (item && typeof item === "object") {
        const id = norm(item.id || item.memory_id || item.remote_id || "");
        const url = normalizeMemoryUrl(item.url || item.local_id || "");
        return { id, url, title: norm(item.title || "") };
      }
      return { id: "", url: normalizeMemoryUrl(item), title: "" };
    })
    .filter((entry) => entry.id || entry.url)
    .sort((a, b) => (a.id || a.url).localeCompare(b.id || b.url));

  if (!entries.length) return { ok: true, skipped: "no-memory-entries" };

  // Hard stop: remote deletes must come from an explicit user action.
  // This prevents startup/render hydration paths from wiping memories.
  if (options?.userInitiated !== true) {
    return { ok: true, skipped: "not-user-initiated" };
  }

  const signature = `delete:${JSON.stringify(entries.map((entry) => entry.id || entry.url))}`;
  if (shouldSkipDeleteSignature(signature)) {
    return { ok: true, skipped: "delete-cooldown" };
  }

  return queueSyncJob(signature, async () => {
    const token = await getAccessToken();
    if (!token) return { ok: false, skipped: "not-signed-in" };

    const apiBase = getApiBaseUrl();
    let orgCode = '';
    try {
      const stored = await api.storage.local.get(['dockOrg']);
      orgCode = norm(stored?.dockOrg?.orgCode);
    } catch {}
    const user = await getCurrentUser();

    const buildDeleteHeaders = () => {
      const headers = buildBearerHeaders(token, user, {
        "Content-Type": "application/json"
      });
      if (orgCode) headers['X-Dock-Org-Code'] = orgCode;
      return headers;
    };

    async function resolveRemoteMemoryIdByUrl(url) {
      const normalizedUrl = normalizeMemoryUrl(url);
      if (!normalizedUrl) return "";

      const headers = buildDeleteHeaders();
      const response = await fetchJson(`${apiBase}/api/user/memories?includeScreenshots=0`, {
        method: "GET",
        headers
      });
      const rows = Array.isArray(response) ? response : (Array.isArray(response?.memories) ? response.memories : []);
      const match = rows.find((row) => normalizeMemoryUrl(row?.url || "") === normalizedUrl);
      return norm(match?.id || match?.memory_id || "");
    }

    let deleted = 0;
    let failed = 0;

    await Promise.allSettled(entries.map(async (entry) => {
      const headers = buildDeleteHeaders();
      const url = entry.url;
      let id = norm(entry.id || "");

      try {
        if (!id && url) {
          id = await resolveRemoteMemoryIdByUrl(url);
        }

        DEBUG && console.log("Deleting memory:", { id, url, title: entry.title });

        const deleteEndpoint = id
          ? `${apiBase}/api/user/memories?id=${encodeURIComponent(id)}`
          : `${apiBase}/api/user/memories?url=${encodeURIComponent(url)}`;
        const deleteBody = id ? { id } : { url };
        await fetchJson(deleteEndpoint, {
          method: "DELETE",
          headers: {
            ...headers,
            ...(id ? { "x-memory-id": id, "x-dock-memory-id": id } : { "x-memory-url": url, "x-dock-memory-url": url })
          },
          body: JSON.stringify(deleteBody)
        });

        deleted++;
      } catch (error) {
        failed++;
        DEBUG && console.error("Dock personal memory remote delete failed", url || id || "unknown-memory", error);
      }
    }));

    if (!failed) rememberDeleteSignature(signature);
    return failed ? { ok: false, deleted, failed } : { ok: true, deleted };
  });
}
export async function getAuthSummary() {
  await ensureAuthConfigLoaded();
  const configured = isConfigured();
  const signedIn = await isSignedIn();
  const user = signedIn ? await getCurrentUser() : null;
  return {
    configured,
    signedIn,
    userId: norm(user?.id || ""),
    userEmail: norm(user?.email || "")
  };
}
