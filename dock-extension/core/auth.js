// Dock extension auth should return to extension callback, not the admin web app.

import { api } from "../adapters/index.js";
import { ensurePersonalIdentityScope, parkPersonalIdentity, getPersonalIdentity } from "./personalScope.js";

const DEBUG = false;
const AUTH_SESSION_KEY = "dockAuthSession";
const AUTH_USER_KEY = "dockAuthUser";
const AUTH_STATE_KEY = "dockAuthState";

const DEFAULT_API_BASE_URL = "https://dock-production-mvp.vercel.app";
const DEFAULT_SUPABASE_URL = "https://mcqohghghfxtchxpaddj.supabase.co";
const DEFAULT_SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1jcW9oZ2hnaGZ4dGNoeHBhZGRqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM3NTkzNjcsImV4cCI6MjA4OTMzNTM2N30.-C_0R5-8iroOq_UoI1UBseDiuz-Auv6od1dLdAO6okQ";
const WRITE_DEBOUNCE_MS = 350;
const DUPLICATE_WINDOW_MS = 1500;
const DELETE_REPEAT_COOLDOWN_MS = 30000;

let pendingWriteTimer = null;
const pendingWriteQueue = [];
let writeQueueRunning = false;
let lastWriteSignature = "";
let lastWriteAt = 0;
const inflightWriteSignatures = new Set();
const deleteCooldowns = new Map();

let cachedSession = null;
let cachedUser = null;
let sessionLoaded = false;
let userLoaded = false;
let inflightSessionPromise = null;
let inflightUserPromise = null;

const AUTH_CONFIG = {
  supabaseUrl: DEFAULT_SUPABASE_URL,
  supabaseAnonKey: DEFAULT_SUPABASE_ANON_KEY,
  apiBaseUrl: DEFAULT_API_BASE_URL
};
let authConfigLoaded = false;
let authConfigPromise = null;

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
      raw === "chrome://newtab" || raw === "chrome://newtab/" || raw === "about:blank" ||
      host === "newtab" || path === "/newtab"
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
  } catch {
    try { return api.identity.getRedirectURL(); } catch { return ""; }
  }
}

async function resetOrgBootstrapState({ clearManaged = false } = {}) {
  try { globalThis?.localStorage?.removeItem("dock_org"); } catch {}
  const keys = ["dockOrg"];
  if (clearManaged) keys.push("dockManagedWorkspace", "dockManagedMeta", "dockPlanState");
  try { await api.storage.local.remove(keys); } catch {}
}

function getApiBaseUrl() {
  return norm(AUTH_CONFIG.apiBaseUrl || DEFAULT_API_BASE_URL) || DEFAULT_API_BASE_URL;
}

function buildBearerHeaders(token, user = null, extra = {}) {
  const headers = { ...extra };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (user?.id) {
    headers["X-Dock-User-Id"] = norm(user.id);
    headers["X-User-Id"] = norm(user.id);
  }
  if (user?.email) {
    headers["X-Dock-User-Email"] = norm(user.email).toLowerCase();
    headers["X-User-Email"] = norm(user.email).toLowerCase();
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
  return !!ts && (Date.now() - ts) < DELETE_REPEAT_COOLDOWN_MS;
}

function rememberDeleteSignature(signature) {
  deleteCooldowns.set(signature, Date.now());
  if (deleteCooldowns.size <= 200) return;
  for (const [key, ts] of deleteCooldowns.entries()) {
    if ((Date.now() - ts) >= DELETE_REPEAT_COOLDOWN_MS) deleteCooldowns.delete(key);
  }
}

async function ensureAuthConfigLoaded() {
  if (authConfigLoaded) return AUTH_CONFIG;
  if (authConfigPromise) return authConfigPromise;

  authConfigPromise = (async () => {
    const keys = ["dockAuthConfig", "supabaseUrl", "supabaseAnonKey", "apiBaseUrl"];
    let managed = {};
    let local = {};
    try { managed = await api.storage.managed.get(keys); } catch {}
    try { local = await api.storage.local.get(keys); } catch {}
    const nested = local?.dockAuthConfig && typeof local.dockAuthConfig === "object" ? local.dockAuthConfig : {};
    AUTH_CONFIG.supabaseUrl = norm(local?.supabaseUrl || nested?.supabaseUrl || managed?.supabaseUrl || DEFAULT_SUPABASE_URL);
    AUTH_CONFIG.supabaseAnonKey = norm(local?.supabaseAnonKey || nested?.supabaseAnonKey || managed?.supabaseAnonKey || DEFAULT_SUPABASE_ANON_KEY);
    AUTH_CONFIG.apiBaseUrl = norm(local?.apiBaseUrl || nested?.apiBaseUrl || managed?.apiBaseUrl || DEFAULT_API_BASE_URL);
    authConfigLoaded = true;
    return AUTH_CONFIG;
  })();

  try { return await authConfigPromise; }
  finally { authConfigPromise = null; }
}

function isConfigured() {
  return /^https:\/\/.+\.supabase\.co$/i.test(norm(AUTH_CONFIG.supabaseUrl)) &&
    !!norm(AUTH_CONFIG.supabaseAnonKey) &&
    !/YOUR_/i.test(norm(AUTH_CONFIG.supabaseAnonKey));
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

if (api.storage?.onChanged?.addListener) {
  api.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" && areaName !== "managed") return;
    if (areaName === "local" && changes?.[AUTH_SESSION_KEY]) {
      cachedSession = null;
      sessionLoaded = false;
    }
    if (areaName === "local" && changes?.[AUTH_USER_KEY]) {
      cachedUser = null;
      userLoaded = false;
    }
    if (changes?.dockAuthConfig || changes?.supabaseUrl || changes?.supabaseAnonKey || changes?.apiBaseUrl) {
      authConfigLoaded = false;
      authConfigPromise = null;
    }
  });
}

function parseUrlTokens(url) {
  try {
    const parsed = new URL(url);
    const hashParams = new URLSearchParams((parsed.hash || "").replace(/^#/, ""));
    const searchParams = parsed.searchParams;
    return {
      token_type: hashParams.get("token_type") || searchParams.get("token_type") || "bearer",
      access_token: hashParams.get("access_token") || searchParams.get("access_token") || "",
      refresh_token: hashParams.get("refresh_token") || searchParams.get("refresh_token") || "",
      expires_in: Number(hashParams.get("expires_in") || searchParams.get("expires_in") || "3600") || 3600
    };
  } catch {
    return { access_token: "", refresh_token: "", token_type: "bearer", expires_in: 3600 };
  }
}

async function fetchJson(url, { method = "GET", headers = {}, body } = {}) {
  let response;
  try {
    response = await fetch(url, { method, headers, body });
  } catch (cause) {
    const err = new Error(String(cause?.message || cause || "NETWORK_ERROR"));
    err.code = "NETWORK_ERROR";
    err.status = 0;
    throw err;
  }

  let data = null;
  try { data = await response.json(); } catch {}
  if (!response.ok) {
    const err = new Error(data?.error_description || data?.msg || data?.message || data?.error || `HTTP_${response.status}`);
    err.status = Number(response.status) || 0;
    err.code = norm(data?.code || data?.error_code || data?.error || `HTTP_${response.status}`).toUpperCase();
    throw err;
  }
  return data;
}

async function fetchSupabaseUser(accessToken) {
  return fetchJson(`${norm(AUTH_CONFIG.supabaseUrl)}/auth/v1/user`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      apikey: norm(AUTH_CONFIG.supabaseAnonKey)
    }
  });
}

function isTerminalRefreshFailure(error) {
  const status = Number(error?.status) || 0;
  const code = norm(error?.code).toLowerCase();
  const message = norm(error?.message).toLowerCase();
  const text = `${code} ${message}`;
  if (/refresh[_ -]?token.*(invalid|not found|expired|revoked)|invalid[_ -]?refresh[_ -]?token|invalid[_ -]?grant/.test(text)) return true;
  if (/user.*(disabled|deleted)|account.*(disabled|deleted)/.test(text)) return true;
  return status === 400 && /(invalid|expired|revoked).*(refresh|grant)/.test(text);
}

async function refreshSession() {
  await ensureAuthConfigLoaded();
  const session = await getStoredSession();
  const refreshToken = norm(session?.refresh_token);
  if (!refreshToken || !isConfigured()) return null;

  const data = await fetchJson(`${norm(AUTH_CONFIG.supabaseUrl)}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: norm(AUTH_CONFIG.supabaseAnonKey) },
    body: JSON.stringify({ refresh_token: refreshToken })
  });

  const nextSession = {
    access_token: norm(data?.access_token),
    refresh_token: norm(data?.refresh_token || refreshToken),
    token_type: norm(data?.token_type || "bearer"),
    expires_at: nowSeconds() + (Number(data?.expires_in) || 3600)
  };
  const user = data?.user || await fetchSupabaseUser(nextSession.access_token);
  await ensurePersonalIdentityScope(user || null);
  await setStoredSession(nextSession);
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
      } catch (error) {
        if (isTerminalRefreshFailure(error)) {
          await signOut();
          return null;
        }
        const user = await getStoredUser();
        await setAuthState({
          status: "signed-in-degraded",
          userEmail: norm(user?.email),
          updatedAt: Date.now(),
          lastError: norm(error?.code || error?.message || "REFRESH_DEGRADED").slice(0, 120)
        });
        return session;
      }
    }
    return session;
  })();
  try { return await inflightSessionPromise; }
  finally { inflightSessionPromise = null; }
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
      await ensurePersonalIdentityScope(user || null);
      await setStoredUser(user || null);
      return user || null;
    } catch {
      return cached || null;
    }
  })();
  try { return await inflightUserPromise; }
  finally { inflightUserPromise = null; }
}

export async function isSignedIn() {
  const session = await getSession();
  return !!session?.access_token;
}

function cancelPendingWriteJobs(reason = "identity-changed") {
  if (pendingWriteTimer) {
    clearTimeout(pendingWriteTimer);
    pendingWriteTimer = null;
  }
  while (pendingWriteQueue.length) {
    const job = pendingWriteQueue.shift();
    try { job?.resolve?.({ ok: false, skipped: reason }); } catch {}
  }
  lastWriteSignature = "";
  lastWriteAt = 0;
  deleteCooldowns.clear();
}

export async function signOut() {
  const outgoingUser = await getStoredUser().catch(() => null);
  cancelPendingWriteJobs("signed-out");
  try { await parkPersonalIdentity(outgoingUser); } catch {}
  await setStoredSession(null);
  await setStoredUser(null);
  await setAuthState({ status: "signed-out", updatedAt: Date.now() });
  await resetOrgBootstrapState({ clearManaged: true });
  try { await api.identity.clearAllCachedAuthTokens(); } catch {}
  return { ok: true };
}

export async function signInWithGoogleInteractive() {
  await ensureAuthConfigLoaded();
  if (!isConfigured()) {
    throw new Error("Dock personal sign-in is not configured yet. Paste your Supabase anon/public key into DEFAULT_SUPABASE_ANON_KEY at the top of dock-extension/core/auth.js, save, then reload the extension.");
  }

  const authUrl = new URL(`${norm(AUTH_CONFIG.supabaseUrl)}/auth/v1/authorize`);
  authUrl.searchParams.set("provider", "google");
  authUrl.searchParams.set("redirect_to", getRedirectUrl());
  authUrl.searchParams.set("scopes", "openid email profile");
  authUrl.searchParams.set("flow_type", "implicit");

  const finalUrl = await api.identity.launchWebAuthFlow({ url: authUrl.toString(), interactive: true });
  const parsed = parseUrlTokens(finalUrl || "");
  if (!parsed.access_token) throw new Error("Google sign-in did not return an access token.");

  const session = {
    access_token: parsed.access_token,
    refresh_token: parsed.refresh_token,
    token_type: parsed.token_type || "bearer",
    expires_at: nowSeconds() + (Number(parsed.expires_in) || 3600)
  };
  const user = await fetchSupabaseUser(session.access_token);

  cancelPendingWriteJobs("identity-changed");
  await resetOrgBootstrapState({ clearManaged: true });
  await ensurePersonalIdentityScope(user || null);
  await setStoredSession(session);
  await setStoredUser(user || null);
  await setAuthState({ status: "signed-in", userEmail: norm(user?.email), updatedAt: Date.now() });
  return { session, user };
}

export async function ensureSignedInInteractive() {
  if (await isSignedIn()) {
    const user = await getCurrentUser();
    if (user) await ensurePersonalIdentityScope(user);
    return { ok: true, alreadySignedIn: true, user };
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
    if (!raw || !/^data:image\/(?:png|jpeg|jpg|webp);base64,/i.test(raw)) continue;
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
  const screenshot = sanitizeScreenshotDataForSync(tab?.screenshotThumb, tab?.screenshot_data_url, tab?.screenshot);
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

async function currentQueueIdentity() {
  const user = await getCurrentUser();
  return { user, identity: getPersonalIdentity(user) };
}

async function drainSyncQueue() {
  if (writeQueueRunning) return;
  writeQueueRunning = true;
  try {
    while (pendingWriteQueue.length) {
      const job = pendingWriteQueue.shift();
      if (!job) continue;
      if (isRecentlyProcessed(job.signature)) {
        job.resolve({ ok: true, skipped: "duplicate" });
        continue;
      }
      if (inflightWriteSignatures.has(job.signature)) {
        job.resolve({ ok: true, skipped: "inflight" });
        continue;
      }

      const { identity } = await currentQueueIdentity().catch(() => ({ identity: "" }));
      if (!identity || identity !== job.identity) {
        job.resolve({ ok: false, skipped: "identity-changed" });
        continue;
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
    }
  } finally {
    writeQueueRunning = false;
  }
}

function queueSyncJob(identity, signature, run) {
  if (!identity) return Promise.resolve({ ok: false, skipped: "not-signed-in" });
  const scopedSignature = `${identity}:${signature}`;
  if (isRecentlyProcessed(scopedSignature)) return Promise.resolve({ ok: true, skipped: "duplicate" });
  if (inflightWriteSignatures.has(scopedSignature)) return Promise.resolve({ ok: true, skipped: "inflight" });

  return new Promise((resolve) => {
    pendingWriteQueue.push({ identity, signature: scopedSignature, run, resolve });
    if (pendingWriteTimer) return;
    pendingWriteTimer = setTimeout(() => {
      pendingWriteTimer = null;
      drainSyncQueue().catch(() => {});
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
    });

  if (!changedEntries.length) return { ok: true, skipped: "no-changes" };
  const queued = await currentQueueIdentity().catch(() => ({ user: null, identity: "" }));
  if (!queued.identity) return { ok: false, skipped: "not-signed-in" };

  return queueSyncJob(queued.identity, `upsert:${JSON.stringify(changedEntries)}`, async () => {
    const user = await getCurrentUser();
    if (getPersonalIdentity(user) !== queued.identity) return { ok: false, skipped: "identity-changed" };
    const token = await getAccessToken();
    if (!token) return { ok: false, skipped: "not-signed-in" };

    let orgCode = "";
    try {
      const stored = await api.storage.local.get(["dockOrg"]);
      orgCode = norm(stored?.dockOrg?.orgCode);
    } catch {}

    const headers = buildBearerHeaders(token, user, { "Content-Type": "application/json" });
    if (orgCode) headers["X-Dock-Org-Code"] = orgCode;
    const apiBase = getApiBaseUrl();
    let synced = 0;
    let failed = 0;

    for (const entry of changedEntries) {
      try {
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

  const entries = (Array.isArray(items) ? items : [])
    .map((item) => {
      if (item && typeof item === "object") {
        return {
          id: norm(item.id || item.memory_id || item.remote_id || ""),
          url: normalizeMemoryUrl(item.url || item.local_id || ""),
          title: norm(item.title || "")
        };
      }
      return { id: "", url: normalizeMemoryUrl(item), title: "" };
    })
    .filter((entry) => entry.id || entry.url)
    .sort((a, b) => (a.id || a.url).localeCompare(b.id || b.url));

  if (!entries.length) return { ok: true, skipped: "no-memory-entries" };
  if (options?.userInitiated !== true) return { ok: true, skipped: "not-user-initiated" };

  const queued = await currentQueueIdentity().catch(() => ({ user: null, identity: "" }));
  if (!queued.identity) return { ok: false, skipped: "not-signed-in" };
  const deleteKey = JSON.stringify(entries.map((entry) => entry.id || entry.url));
  const cooldownSignature = `${queued.identity}:delete:${deleteKey}`;
  if (shouldSkipDeleteSignature(cooldownSignature)) return { ok: true, skipped: "delete-cooldown" };

  return queueSyncJob(queued.identity, `delete:${deleteKey}`, async () => {
    const user = await getCurrentUser();
    if (getPersonalIdentity(user) !== queued.identity) return { ok: false, skipped: "identity-changed" };
    const token = await getAccessToken();
    if (!token) return { ok: false, skipped: "not-signed-in" };

    let orgCode = "";
    try {
      const stored = await api.storage.local.get(["dockOrg"]);
      orgCode = norm(stored?.dockOrg?.orgCode);
    } catch {}
    const apiBase = getApiBaseUrl();

    const buildDeleteHeaders = () => {
      const headers = buildBearerHeaders(token, user, { "Content-Type": "application/json" });
      if (orgCode) headers["X-Dock-Org-Code"] = orgCode;
      return headers;
    };

    async function resolveRemoteMemoryIdByUrl(url) {
      const normalizedUrl = normalizeMemoryUrl(url);
      if (!normalizedUrl) return "";
      const response = await fetchJson(`${apiBase}/api/user/memories?includeScreenshots=0`, {
        method: "GET",
        headers: buildDeleteHeaders()
      });
      const rows = Array.isArray(response) ? response : (Array.isArray(response?.memories) ? response.memories : []);
      const match = rows.find((row) => normalizeMemoryUrl(row?.url || "") === normalizedUrl);
      return norm(match?.id || match?.memory_id || "");
    }

    let deleted = 0;
    let failed = 0;
    for (const entry of entries) {
      const url = entry.url;
      let id = norm(entry.id || "");
      try {
        if (!id && url) id = await resolveRemoteMemoryIdByUrl(url);
        await fetchJson(
          id ? `${apiBase}/api/user/memories?id=${encodeURIComponent(id)}` : `${apiBase}/api/user/memories?url=${encodeURIComponent(url)}`,
          {
            method: "DELETE",
            headers: {
              ...buildDeleteHeaders(),
              ...(id ? { "x-memory-id": id, "x-dock-memory-id": id } : { "x-memory-url": url, "x-dock-memory-url": url })
            },
            body: JSON.stringify(id ? { id } : { url })
          }
        );
        deleted++;
      } catch (error) {
        failed++;
        DEBUG && console.error("Dock personal memory remote delete failed", url || id || "unknown-memory", error);
      }
    }

    if (!failed) rememberDeleteSignature(cooldownSignature);
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
