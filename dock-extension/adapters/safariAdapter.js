// Safari WebExtension adapter.
// Safari intentionally does not implement the WebExtensions identity API.
// Keep Chrome's proven identity path untouched and supply only the missing
// identity surface when Safari exposes `browser` without `browser.identity`.

// Reuse Dock's already-live production site as the OAuth return target instead
// of introducing a Safari-only backend route. The auth tab is the authority:
// we only accept the exact Dock production origin/root reached in that tab.
const DOCK_AUTH_CALLBACK = "https://dock-production-mvp.vercel.app/";
const AUTH_TIMEOUT_MS = 3 * 60 * 1000;

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
        const stored = await nativeApi.storage.local.get(["dockAuthUser"]);
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
      // Dock owns its Supabase session in extension local storage. auth.js clears
      // that state directly; Safari has no separate browser identity token cache.
      return undefined;
    }
  };
}

export function getSafariApi() {
  const nativeApi = globalThis.browser;
  if (!nativeApi) return undefined;
  if (nativeApi.identity?.launchWebAuthFlow && nativeApi.identity?.getRedirectURL) return nativeApi;

  const identity = createIdentityShim(nativeApi);
  return new Proxy(nativeApi, {
    get(target, property, receiver) {
      if (property === "identity") return identity;
      return Reflect.get(target, property, receiver);
    }
  });
}
