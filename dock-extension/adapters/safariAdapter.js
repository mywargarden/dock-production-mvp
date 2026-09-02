// Safari WebExtension adapter.
// Safari intentionally does not implement the WebExtensions identity API.
// Keep Chrome's proven identity path untouched and supply only the missing
// identity surface when Safari exposes `browser` without `browser.identity`.

const DOCK_AUTH_CALLBACK = "https://dock-production-mvp.vercel.app/auth/extension/callback";
const AUTH_CALLBACK_MESSAGE = "dock-safari-auth-callback";
const AUTH_TIMEOUT_MS = 3 * 60 * 1000;

let pendingAuthState = "";

function randomState() {
  const bytes = new Uint8Array(24);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

function isValidCallbackUrl(value, expectedState) {
  try {
    const url = new URL(String(value || ""));
    if (url.origin !== "https://dock-production-mvp.vercel.app") return false;
    if (url.pathname !== "/auth/extension/callback") return false;
    return !!expectedState && url.searchParams.get("dock_state") === expectedState;
  } catch {
    return false;
  }
}

function createIdentityShim(nativeApi) {
  return {
    getRedirectURL() {
      pendingAuthState = randomState();
      const url = new URL(DOCK_AUTH_CALLBACK);
      url.searchParams.set("dock_source", "safari");
      url.searchParams.set("dock_state", pendingAuthState);
      return url.toString();
    },

    async launchWebAuthFlow({ url, interactive = true } = {}) {
      if (!interactive) throw new Error("Safari Dock sign-in requires an interactive OAuth tab.");
      if (!url) throw new Error("Safari Dock sign-in URL is missing.");

      const expectedState = pendingAuthState;
      if (!expectedState) throw new Error("Safari Dock sign-in state is missing.");

      let authTabId = null;
      let timeoutId = null;

      return await new Promise(async (resolve, reject) => {
        const cleanup = () => {
          if (timeoutId) clearTimeout(timeoutId);
          try { nativeApi.runtime.onMessage.removeListener(onMessage); } catch {}
          pendingAuthState = "";
        };

        const finish = async (callbackUrl) => {
          cleanup();
          if (authTabId != null) {
            try { await nativeApi.tabs.remove(authTabId); } catch {}
          }
          resolve(callbackUrl);
        };

        const onMessage = (message) => {
          if (message?.type !== AUTH_CALLBACK_MESSAGE) return undefined;
          const callbackUrl = String(message?.url || "");
          if (!isValidCallbackUrl(callbackUrl, expectedState)) return undefined;
          void finish(callbackUrl);
          return undefined;
        };

        try {
          nativeApi.runtime.onMessage.addListener(onMessage);
          timeoutId = setTimeout(() => {
            cleanup();
            reject(new Error("Safari Dock sign-in timed out before the OAuth callback returned."));
          }, AUTH_TIMEOUT_MS);

          const tab = await nativeApi.tabs.create({ url, active: true });
          authTabId = tab?.id ?? null;
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
