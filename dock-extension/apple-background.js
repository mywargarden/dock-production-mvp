// Apple-only bootstrap for the unchanged shared Dock background runtime.
// It fills Safari's missing storage.managed surface, then loads background.js.

(() => {
  const nativeBrowser = globalThis.browser;
  if (!nativeBrowser || nativeBrowser.storage?.managed?.get) return;

  const NATIVE_HOST_ID = "dock.apple.host";
  let cache = null;
  let cachedAt = 0;
  const TTL_MS = 15 * 1000;

  function pick(source, keys) {
    const policy = source && typeof source === "object" ? source : {};
    if (keys == null) return { ...policy };
    if (typeof keys === "string") {
      return Object.prototype.hasOwnProperty.call(policy, keys) ? { [keys]: policy[keys] } : {};
    }
    if (Array.isArray(keys)) {
      const out = {};
      for (const key of keys) if (Object.prototype.hasOwnProperty.call(policy, key)) out[key] = policy[key];
      return out;
    }
    if (keys && typeof keys === "object") {
      const out = { ...keys };
      for (const key of Object.keys(keys)) if (Object.prototype.hasOwnProperty.call(policy, key)) out[key] = policy[key];
      return out;
    }
    return {};
  }

  async function readPolicy() {
    const now = Date.now();
    if (cache && (now - cachedAt) < TTL_MS) return cache;
    try {
      const response = await nativeBrowser.runtime.sendNativeMessage(NATIVE_HOST_ID, {
        type: "DOCK_GET_MANAGED_POLICY"
      });
      cache = response?.managedPolicy && typeof response.managedPolicy === "object"
        ? response.managedPolicy
        : {};
    } catch {
      cache = {};
    }
    cachedAt = now;
    return cache;
  }

  const managed = {
    async get(keys = null) {
      return pick(await readPolicy(), keys);
    }
  };

  const storage = new Proxy(nativeBrowser.storage || {}, {
    get(target, property, receiver) {
      if (property === "managed") return managed;
      return Reflect.get(target, property, receiver);
    }
  });

  const patchedBrowser = new Proxy(nativeBrowser, {
    get(target, property, receiver) {
      if (property === "storage") return storage;
      return Reflect.get(target, property, receiver);
    }
  });

  try {
    Object.defineProperty(globalThis, "browser", {
      configurable: true,
      value: patchedBrowser
    });
  } catch {
    try { globalThis.browser = patchedBrowser; } catch {}
  }
})();

importScripts("background.js");

// Safari does not provide WebExtensions identity.launchWebAuthFlow. More
// importantly, an action popup can disappear as soon as Safari activates the
// OAuth tab. Keep the auth transaction and any continuation in the persistent
// background so the user intent survives popup teardown on macOS and iPadOS.
(() => {
  const api = globalThis.browser;
  if (!api?.runtime?.onMessage || !api?.tabs) return;

  const SUPABASE_URL = "https://mcqohghghfxtchxpaddj.supabase.co";
  // Public anon key. Keep this byte-for-byte aligned with core/auth.js.
  const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1jcW9oZ2hnaGZ4dGNoeHBhZGRqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM3NTkzNjcsImV4cCI6MjA4OTMzNTM2N30.-C_0R5-8iroOq_UoI1UBseDiuz-Auv6od1dLdAO6okQ";
  const CALLBACK_URL = "https://dock-production-mvp.vercel.app/";
  const PENDING_KEY = "dockSafariPendingAuthAction";
  const LAST_RESULT_KEY = "dockSafariLastAuthAction";
  const MAX_PENDING_AGE_MS = 5 * 60 * 1000;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function parseCallbackUrl(value) {
    try {
      const url = new URL(String(value || ""));
      if (url.origin !== "https://dock-production-mvp.vercel.app" || url.pathname !== "/") return null;
      const hash = new URLSearchParams((url.hash || "").replace(/^#/, ""));
      const search = url.searchParams;
      return {
        href: url.toString(),
        accessToken: hash.get("access_token") || search.get("access_token") || "",
        refreshToken: hash.get("refresh_token") || search.get("refresh_token") || "",
        tokenType: hash.get("token_type") || search.get("token_type") || "bearer",
        expiresIn: Number(hash.get("expires_in") || search.get("expires_in") || "3600") || 3600,
        error: hash.get("error_description") || search.get("error_description") || hash.get("error") || search.get("error") || ""
      };
    } catch {
      return null;
    }
  }

  function buildAuthUrl() {
    const url = new URL(`${SUPABASE_URL}/auth/v1/authorize`);
    url.searchParams.set("provider", "google");
    url.searchParams.set("redirect_to", CALLBACK_URL);
    url.searchParams.set("scopes", "openid email profile");
    url.searchParams.set("flow_type", "implicit");
    return url.toString();
  }

  async function fetchUser(accessToken) {
    const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        apikey: SUPABASE_ANON_KEY
      }
    });
    let data = null;
    try { data = await response.json(); } catch {}
    if (!response.ok || !data?.id) {
      throw new Error(data?.msg || data?.message || `AUTH_USER_HTTP_${response.status}`);
    }
    return data;
  }

  async function recordResult(result) {
    try {
      await api.storage.local.set({
        [LAST_RESULT_KEY]: {
          ...result,
          at: Date.now()
        }
      });
    } catch {}
  }

  async function beginAuthTransaction(message = {}) {
    const [originTab] = await api.tabs.query({ active: true, currentWindow: true }).catch(() => []);
    const originWindowId = originTab?.windowId ?? null;
    const originTabId = originTab?.id ?? null;

    const pending = {
      action: message.action === "save-all" ? "save-all" : "sign-in",
      reason: String(message.reason || "").slice(0, 500),
      openMemories: message.openMemories !== false,
      targetGroupId: String(message.targetGroupId || ""),
      originWindowId,
      originTabId,
      authTabId: null,
      startedAt: Date.now()
    };

    await api.storage.local.set({ [PENDING_KEY]: pending });

    const authTab = await api.tabs.create({ url: buildAuthUrl(), active: true });
    pending.authTabId = authTab?.id ?? null;
    await api.storage.local.set({ [PENDING_KEY]: pending });
    await recordResult({ ok: true, phase: "auth-started", action: pending.action, authTabId: pending.authTabId });
    return { ok: true, started: true, action: pending.action };
  }

  async function restoreOrigin(pending) {
    if (pending?.originTabId != null) {
      try { await api.tabs.update(pending.originTabId, { active: true }); } catch {}
    }
    if (pending?.originWindowId != null) {
      try { await api.windows?.update?.(pending.originWindowId, { focused: true }); } catch {}
    }
    await sleep(120);
  }

  async function completeAuthTransaction(callbackUrl, sender) {
    const stored = await api.storage.local.get([PENDING_KEY]);
    const pending = stored?.[PENDING_KEY];
    if (!pending || typeof pending !== "object") return { ok: false, error: "NO_PENDING_SAFARI_AUTH" };
    if ((Date.now() - Number(pending.startedAt || 0)) > MAX_PENDING_AGE_MS) {
      await api.storage.local.remove([PENDING_KEY]);
      return { ok: false, error: "SAFARI_AUTH_EXPIRED" };
    }

    if (pending.authTabId != null && sender?.tab?.id != null && sender.tab.id !== pending.authTabId) {
      return { ok: false, error: "SAFARI_AUTH_WRONG_TAB" };
    }

    const parsed = parseCallbackUrl(callbackUrl);
    if (!parsed) return { ok: false, error: "SAFARI_AUTH_BAD_CALLBACK" };
    if (parsed.error) {
      await api.storage.local.remove([PENDING_KEY]);
      await recordResult({ ok: false, phase: "auth-callback", error: parsed.error });
      return { ok: false, error: parsed.error };
    }
    if (!parsed.accessToken) return { ok: false, error: "SAFARI_AUTH_TOKEN_MISSING" };

    const user = await fetchUser(parsed.accessToken);
    const session = {
      access_token: parsed.accessToken,
      refresh_token: parsed.refreshToken,
      token_type: parsed.tokenType || "bearer",
      expires_at: Math.floor(Date.now() / 1000) + parsed.expiresIn
    };

    await api.storage.local.set({
      dockAuthSession: session,
      dockAuthUser: user,
      dockAuthState: {
        status: "signed-in",
        userEmail: String(user?.email || ""),
        updatedAt: Date.now()
      }
    });

    if (pending.authTabId != null) {
      try { await api.tabs.remove(pending.authTabId); } catch {}
    }
    await restoreOrigin(pending);

    let continuation = { ok: true, signedIn: true };
    if (pending.action === "save-all") {
      if (typeof saveAllOpenTabs !== "function") {
        continuation = { ok: false, error: "SAFARI_BULK_HANDLER_UNAVAILABLE" };
      } else {
        try {
          const result = await saveAllOpenTabs({
            reason: pending.reason || "",
            openMemories: pending.openMemories !== false,
            targetGroupId: pending.targetGroupId || "",
            skipDuplicates: true
          });
          continuation = { ok: true, signedIn: true, action: "save-all", ...result };
        } catch (error) {
          continuation = { ok: false, signedIn: true, action: "save-all", error: String(error?.message || error || "bulk-save-failed") };
        }
      }
    }

    await api.storage.local.remove([PENDING_KEY]);
    await recordResult({ ...continuation, phase: "complete", userEmail: String(user?.email || "") });
    return continuation;
  }

  api.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === "DOCK_SAFARI_BEGIN_AUTH") {
      beginAuthTransaction(message)
        .then(sendResponse)
        .catch(async (error) => {
          const result = { ok: false, error: String(error?.message || error || "safari-auth-start-failed") };
          await recordResult({ ...result, phase: "auth-start" });
          sendResponse(result);
        });
      return true;
    }

    if (message?.type === "DOCK_SAFARI_AUTH_CALLBACK") {
      completeAuthTransaction(message.url, sender)
        .then(sendResponse)
        .catch(async (error) => {
          const result = { ok: false, error: String(error?.message || error || "safari-auth-callback-failed") };
          await recordResult({ ...result, phase: "auth-callback" });
          sendResponse(result);
        });
      return true;
    }

    return undefined;
  });
})();
