// Safari WebExtension adapter.
// Chrome remains Dock's behavior contract. Safari receives only the missing
// browser authority required to run that same shared core on macOS/iPadOS.

import "../apple-critical-store.js";

const DOCK_AUTH_CALLBACK = "https://dock-production-mvp.vercel.app/";
const AUTH_TIMEOUT_MS = 3 * 60 * 1000;
const NATIVE_HOST_ID = "dock.apple.host";
const MANAGED_POLICY_TTL_MS = 15 * 1000;

let managedPolicyCache = null;
let managedPolicyCachedAt = 0;

function isValidCallbackUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.origin === "https://dock-production-mvp.vercel.app" && url.pathname === "/";
  } catch {
    return false;
  }
}

function createIdentityShim(nativeApi) {
  return {
    getRedirectURL() {
      return DOCK_AUTH_CALLBACK;
    },

    async launchWebAuthFlow({ url, interactive = true } = {}) {
      if (!interactive) throw new Error("Safari Dock sign-in requires an interactive OAuth tab.");
      if (!url) throw new Error("Safari Dock sign-in URL is missing.");

      let authTabId = null;
      let timeoutId = null;

      return await new Promise(async (resolve, reject) => {
        const cleanup = () => {
          if (timeoutId) clearTimeout(timeoutId);
          try { nativeApi.tabs.onUpdated.removeListener(onUpdated); } catch {}
          try { nativeApi.tabs.onRemoved.removeListener(onRemoved); } catch {}
        };

        const finish = async (callbackUrl) => {
          cleanup();
          if (authTabId != null) {
            try { await nativeApi.tabs.remove(authTabId); } catch {}
          }
          resolve(callbackUrl);
        };

        const onUpdated = (tabId, changeInfo, tab) => {
          if (authTabId == null || tabId !== authTabId) return;
          const callbackUrl = String(changeInfo?.url || tab?.url || "");
          if (!isValidCallbackUrl(callbackUrl)) return;
          void finish(callbackUrl);
        };

        const onRemoved = (tabId) => {
          if (authTabId == null || tabId !== authTabId) return;
          cleanup();
          reject(new Error("Safari Dock sign-in was cancelled before the OAuth callback returned."));
        };

        try {
          nativeApi.tabs.onUpdated.addListener(onUpdated);
          nativeApi.tabs.onRemoved.addListener(onRemoved);
          timeoutId = setTimeout(() => {
            cleanup();
            reject(new Error("Safari Dock sign-in timed out before the OAuth callback returned."));
          }, AUTH_TIMEOUT_MS);

          const tab = await nativeApi.tabs.create({ url, active: true });
          authTabId = tab?.id ?? null;
          if (authTabId == null) throw new Error("Safari Dock could not open the OAuth tab.");
        } catch (error) {
          cleanup();
          reject(error);
        }
      });
    },

    async getProfileUserInfo() {
      try {
        const stored = await getSafariStorage(nativeApi).local.get(["dockAuthUser"]);
        const user = stored?.dockAuthUser || {};
        return {
          id: String(user?.id || ""),
          email: String(user?.email || "")
        };
      } catch {
        return { id: "", email: "" };
      }
    },

    async clearAllCachedAuthTokens() {
      // auth.js clears Dock's Supabase session directly. Safari has no separate
      // WebExtensions identity token cache to clear.
      return undefined;
    }
  };
}

function pickManagedValues(policy, keys) {
  const source = policy && typeof policy === "object" ? policy : {};
  if (keys == null) return { ...source };

  if (typeof keys === "string") {
    return Object.prototype.hasOwnProperty.call(source, keys) ? { [keys]: source[keys] } : {};
  }

  if (Array.isArray(keys)) {
    const result = {};
    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(source, key)) result[key] = source[key];
    }
    return result;
  }

  if (keys && typeof keys === "object") {
    const result = { ...keys };
    for (const key of Object.keys(keys)) {
      if (Object.prototype.hasOwnProperty.call(source, key)) result[key] = source[key];
    }
    return result;
  }

  return {};
}

async function readNativeManagedPolicy(nativeApi, { force = false } = {}) {
  const now = Date.now();
  if (!force && managedPolicyCache && (now - managedPolicyCachedAt) < MANAGED_POLICY_TTL_MS) {
    return managedPolicyCache;
  }

  try {
    if (!nativeApi.runtime?.sendNativeMessage) return {};
    const response = await nativeApi.runtime.sendNativeMessage(NATIVE_HOST_ID, {
      type: "DOCK_GET_MANAGED_POLICY"
    });
    const policy = response?.managedPolicy;
    managedPolicyCache = policy && typeof policy === "object" ? policy : {};
    managedPolicyCachedAt = now;
    return managedPolicyCache;
  } catch {
    managedPolicyCache = {};
    managedPolicyCachedAt = now;
    return managedPolicyCache;
  }
}

function createManagedStorageShim(nativeApi) {
  return {
    async get(keys = null) {
      const policy = await readNativeManagedPolicy(nativeApi);
      return pickManagedValues(policy, keys);
    },

    async getKeys() {
      const policy = await readNativeManagedPolicy(nativeApi);
      return Object.keys(policy);
    },

    async getBytesInUse(keys = null) {
      const selected = pickManagedValues(await readNativeManagedPolicy(nativeApi), keys);
      try {
        return new TextEncoder().encode(JSON.stringify(selected)).byteLength;
      } catch {
        return 0;
      }
    }
  };
}

let safariStorageCache = null;
function getSafariStorage(nativeApi) {
  if (safariStorageCache) return safariStorageCache;
  const nativeStorage = nativeApi.storage || {};
  const criticalStore = globalThis.DockAppleCriticalStore;
  const local = criticalStore?.createLocalShim
    ? criticalStore.createLocalShim(nativeStorage.local)
    : nativeStorage.local;
  const managed = nativeStorage.managed?.get
    ? nativeStorage.managed
    : createManagedStorageShim(nativeApi);

  safariStorageCache = new Proxy(nativeStorage, {
    get(target, property, receiver) {
      if (property === "local") return local;
      if (property === "managed") return managed;
      return Reflect.get(target, property, receiver);
    }
  });
  return safariStorageCache;
}

export function getSafariApi() {
  const nativeApi = globalThis.browser;
  if (!nativeApi) return undefined;

  const identity = nativeApi.identity?.launchWebAuthFlow && nativeApi.identity?.getRedirectURL
    ? nativeApi.identity
    : createIdentityShim(nativeApi);
  const storage = getSafariStorage(nativeApi);

  return new Proxy(nativeApi, {
    get(target, property, receiver) {
      if (property === "identity") return identity;
      if (property === "storage") return storage;
      return Reflect.get(target, property, receiver);
    }
  });
}
