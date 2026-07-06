import { api } from "../adapters/index.js";
import { getCurrentUser, getSession } from "./auth.js";

const ORG_KEY = "dockOrg";
const DEFAULT_API_BASE_URL = "https://dock-production-mvp.vercel.app";
const DEFAULT_BOOTSTRAP_URL = `${DEFAULT_API_BASE_URL}/api/bootstrap`;
const LEGACY_FALLBACK_ORG = {
  orgId: "local",
  orgName: "Dock",
  orgCode: "",
  emailDomain: "",
  configUrl: "",
  apiBaseUrl: DEFAULT_API_BASE_URL,
  syncMode: "local-only"
};

const BOOTSTRAP_CACHE_KEY = "dock_org";
const BOOTSTRAP_CACHE_TTL_MS = 10 * 60 * 1000;
let bootstrapPromise = null;
let bootstrapPromiseKey = "";

function norm(value) {
  return String(value || "").trim();
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

function deriveBootstrapUrl(apiBaseUrl) {
  const base = sanitizeHttpUrl(apiBaseUrl || DEFAULT_API_BASE_URL) || DEFAULT_API_BASE_URL;
  try {
    return new URL('/api/bootstrap', base).toString();
  } catch {
    return DEFAULT_BOOTSTRAP_URL;
  }
}

function getBootstrapCacheKey({ domain = "", orgCode = "", apiBaseUrl = "", authIdentity = "guest" } = {}) {
  return JSON.stringify({
    domain: norm(domain).toLowerCase(),
    orgCode: norm(orgCode),
    apiBaseUrl: sanitizeHttpUrl(apiBaseUrl || DEFAULT_API_BASE_URL) || DEFAULT_API_BASE_URL,
    authIdentity: norm(authIdentity).toLowerCase() || 'guest',
  });
}

function readBootstrapCache(cacheKey) {
  try {
    const raw = globalThis?.localStorage?.getItem(BOOTSTRAP_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.key !== cacheKey || !parsed.value) return null;
    if ((Date.now() - Number(parsed.ts || 0)) > BOOTSTRAP_CACHE_TTL_MS) return null;
    return parsed.value;
  } catch {
    return null;
  }
}

function writeBootstrapCache(cacheKey, value) {
  try {
    globalThis?.localStorage?.setItem(BOOTSTRAP_CACHE_KEY, JSON.stringify({
      key: cacheKey,
      ts: Date.now(),
      value,
    }));
  } catch {}
}

async function getCachedOrgState() {
  try {
    const res = await api.storage.local.get([ORG_KEY]);
    const org = res?.[ORG_KEY];
    return org && typeof org === 'object' ? org : null;
  } catch {
    return null;
  }
}

async function getManagedPolicy() {
  if (!api.storage?.managed?.get) return {};
  try {
    return await api.storage.managed.get(["orgCode", "emailDomain", "apiBaseUrl", "configUrl", "organizationName", "forceManagedMode", "allowLegacyFallback"]);
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

async function getStoredAuthToken() {
  try {
    const session = await getSession();
    return norm(session?.access_token);
  } catch {
    return "";
  }
}

async function getSignedInEmailDomain() {
  try {
    const user = await getCurrentUser();
    const email = norm(user?.email).toLowerCase();
    if (email.includes('@')) return email.split('@')[1] || "";
  } catch {}
  return "";
}

async function fetchBootstrap({ domain = "", orgCode = "", apiBaseUrl = "" } = {}) {
  const authToken = await getStoredAuthToken();
  const currentUser = authToken ? await getCurrentUser() : null;
  const authIdentity = norm(currentUser?.id || currentUser?.email || (authToken ? 'signed-in' : 'guest')).toLowerCase() || 'guest';
  const cacheKey = getBootstrapCacheKey({ domain, orgCode, apiBaseUrl, authIdentity });
  const cached = readBootstrapCache(cacheKey);
  if (cached && !authToken) return cached;

  if (bootstrapPromise && bootstrapPromiseKey === cacheKey) {
    return bootstrapPromise;
  }

  const runner = (async () => {
    const bootstrapUrl = deriveBootstrapUrl(apiBaseUrl);
    const url = new URL(bootstrapUrl);
    if (domain) url.searchParams.set('domain', domain.toLowerCase());
    if (orgCode) url.searchParams.set('orgCode', orgCode);

    const headers = {};
    if (authToken) headers.Authorization = `Bearer ${authToken}`;
    if (currentUser?.id) headers['X-Dock-User-Id'] = norm(currentUser.id);
    if (currentUser?.email) headers['X-Dock-User-Email'] = norm(currentUser.email).toLowerCase();
    url.searchParams.set('_dockDebugTs', String(Date.now()));
    const response = await fetch(url.toString(), { cache: 'no-store', headers });
    let data = null;
    try { data = await response.json(); } catch {}
    const responseFingerprint = response.headers.get('X-Dock-Build-Fingerprint') || '';
    const responseLiveRoute = response.headers.get('X-Dock-Live-Route') || '';
    try { globalThis?.localStorage?.setItem('dock_last_bootstrap_debug', JSON.stringify({ at: new Date().toISOString(), ok: response.ok, status: response.status, fingerprint: responseFingerprint || data?.buildFingerprint || null, liveRoute: responseLiveRoute || null, data })); } catch {}
    if (!response.ok) throw new Error(`BOOTSTRAP_HTTP_${response.status}`);
    const resolvedOrgCode = norm(data?.organization?.orgCode || data?.orgCode || orgCode);
    const apiBase = sanitizeHttpUrl(data?.apiBaseUrl || apiBaseUrl || DEFAULT_API_BASE_URL) || DEFAULT_API_BASE_URL;
    const configUrl = sanitizeHttpUrl(data?.configUrl) || (resolvedOrgCode ? `${apiBase}/api/org/${encodeURIComponent(resolvedOrgCode)}/workspace` : "");
    if (!resolvedOrgCode || !configUrl) throw new Error('BOOTSTRAP_INVALID');
    const resolved = {
      orgId: norm(data?.organization?.id || resolvedOrgCode),
      orgName: norm(data?.organization?.name || data?.organizationName || data?.organization || resolvedOrgCode),
      orgCode: resolvedOrgCode,
      emailDomain: norm(data?.organization?.emailDomain || data?.emailDomain || domain).toLowerCase(),
      configUrl,
      apiBaseUrl: apiBase,
      syncMode: norm(data?.syncMode || (orgCode ? 'org-code' : 'email-domain')) || 'bootstrap'
    };
    writeBootstrapCache(cacheKey, resolved);
    return resolved;
  })();

  bootstrapPromise = runner;
  bootstrapPromiseKey = cacheKey;
  try {
    return await runner;
  } finally {
    if (bootstrapPromiseKey === cacheKey) {
      bootstrapPromise = null;
      bootstrapPromiseKey = "";
    }
  }
}

async function getProfileEmailDomain() {
  const signedInDomain = await getSignedInEmailDomain();
  if (signedInDomain) return signedInDomain;
  if (!api.identity?.getProfileUserInfo) return "";
  try {
    const info = await api.identity.getProfileUserInfo();
    const email = norm(info?.email).toLowerCase();
    if (!email.includes('@')) return "";
    return email.split('@')[1] || "";
  } catch {
    return "";
  }
}

export async function resolveBootstrapOrg({ allowLegacyFallback = true } = {}) {
  const cached = await getCachedOrgState();
  const managed = await getManagedPolicy();
  const managedOrgCode = norm(managed?.orgCode);
  const managedDomain = norm(managed?.emailDomain).toLowerCase();
  const managedApiBaseUrl = sanitizeHttpUrl(managed?.apiBaseUrl || cached?.apiBaseUrl || DEFAULT_API_BASE_URL) || DEFAULT_API_BASE_URL;
  const managedConfigUrl = sanitizeHttpUrl(managed?.configUrl);

  if (managedConfigUrl && managedOrgCode) {
    return {
      orgId: managedOrgCode,
      orgName: norm(managed?.organizationName || cached?.orgName || managedOrgCode),
      orgCode: managedOrgCode,
      emailDomain: managedDomain,
      configUrl: managedConfigUrl,
      apiBaseUrl: managedApiBaseUrl,
      syncMode: 'managed-policy'
    };
  }

  if (managedOrgCode || managedDomain) {
    try {
      return await fetchBootstrap({
        orgCode: managedOrgCode,
        domain: managedDomain,
        apiBaseUrl: managedApiBaseUrl
      });
    } catch (err) {
      // District-managed installs should fail visibly when policy/bootstrap is wrong.
      // Do not fall through to cached/local state unless legacy fallback is explicitly enabled.
      if (!(await shouldAllowLegacyFallback())) return null;
    }
  }

  const profileDomain = await getProfileEmailDomain();
  if (profileDomain) {
    try {
      return await fetchBootstrap({ domain: profileDomain, apiBaseUrl: managedApiBaseUrl });
    } catch {}
  }

  if (cached?.orgCode && cached?.configUrl) {
    return {
      ...cached,
      syncMode: norm(cached.syncMode || 'cached-bootstrap') || 'cached-bootstrap'
    };
  }

  const canUseLegacyFallback = allowLegacyFallback && await shouldAllowLegacyFallback();
  if (canUseLegacyFallback) {
    return { ...LEGACY_FALLBACK_ORG };
  }

  return null;
}

export { LEGACY_FALLBACK_ORG };
