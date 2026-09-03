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
// OAuth tab. Therefore auth continuation state is owned by the background and
// must be durably acknowledged before OAuth is permitted to open.
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

  async function readPending() {
    const stored = await api.storage.local.get([PENDING_KEY]);
    const pending = stored?.[PENDING_KEY];
    return pending && typeof pending === "object" ? pending : null;
  }

  async function stageAuthTransaction(message = {}) {
    let originWindowId = message.originWindowId ?? null;
    let originTabId = message.originTabId ?? null;

    if (originWindowId == null || originTabId == null) {
      const [originTab] = await api.tabs.query({ active: true, currentWindow: true }).catch(() => []);
      originWindowId = originWindowId ?? originTab?.windowId ?? null;
      originTabId = originTabId ?? originTab?.id ?? null;
    }

    const launchId = `auth_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const pending = {
      launchId,
      source: "background-staged",
      action: message.action === "save-all" ? "save-all" : "sign-in",
      reason: String(message.reason || "").slice(0, 500),
      openMemories: message.openMemories !== false,
      targetGroupId: String(message.targetGroupId || ""),
      originWindowId,
      originTabId,
      authTabId: null,
      startedAt: Date.now(),
      stagedAt: Date.now()
    };

    await api.storage.local.set({ [PENDING_KEY]: pending });

    // A successful set() is not enough for this boundary. Read it back and
    // verify identity before allowing the popup to open OAuth.
    const verified = await readPending();
    if (!verified || verified.launchId !== launchId) {
      await recordResult({
        ok: false,
        phase: "auth-stage-verify",
        launchId,
        error: "SAFARI_AUTH_STAGE_NOT_DURABLE"
      });
      return { ok: false, error: "SAFARI_AUTH_STAGE_NOT_DURABLE" };
    }

    await recordResult({
      ok: true,
      phase: "auth-staged",
      action: pending.action,
      launchId,
      originWindowId,
      originTabId
    });

    return {
      ok: true,
      staged: true,
      launchId,
      authUrl: buildAuthUrl(),
      action: pending.action
    };
  }

  async function attachAuthTab(message = {}) {
    const launchId = String(message.launchId || "");
    const authTabId = message.authTabId ?? null;
    const pending = await readPending();
    if (!pending || pending.launchId !== launchId) {
      return { ok: false, error: "SAFARI_AUTH_STAGE_MISMATCH" };
    }
    const next = { ...pending, authTabId, authTabAttachedAt: Date.now() };
    await api.storage.local.set({ [PENDING_KEY]: next });
    return { ok: true, attached: true, launchId, authTabId };
  }

  async function cancelAuthTransaction(message = {}) {
    const launchId = String(message.launchId || "");
    const pending = await readPending();
    if (!pending) return { ok: true, cancelled: false };
    if (launchId && pending.launchId !== launchId) {
      return { ok: false, error: "SAFARI_AUTH_STAGE_MISMATCH" };
    }
    await api.storage.local.remove([PENDING_KEY]);
    await recordResult({ ok: false, phase: "auth-cancelled", launchId: pending.launchId });
    return { ok: true, cancelled: true };
  }

  // Compatibility route for any older Apple popup still installed. It now uses
  // the same transactional stage before opening OAuth rather than the old race.
  async function beginAuthTransaction(message = {}) {
    const staged = await stageAuthTransaction(message);
    if (!staged?.ok) return staged;
    try {
      const authTab = await api.tabs.create({ url: staged.authUrl, active: true });
      const authTabId = authTab?.id ?? null;
      if (authTabId == null) throw new Error("Safari Dock could not open the OAuth tab.");
      await attachAuthTab({ launchId: staged.launchId, authTabId });
      return { ok: true, started: true, action: staged.action, launchId: staged.launchId, authTabId };
    } catch (error) {
      await cancelAuthTransaction({ launchId: staged.launchId });
      throw error;
    }
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
    const pending = await readPending();
    if (!pending) {
      await recordResult({ ok: false, phase: "auth-callback", error: "NO_PENDING_SAFARI_AUTH" });
      return { ok: false, error: "NO_PENDING_SAFARI_AUTH" };
    }

    if ((Date.now() - Number(pending.startedAt || 0)) > MAX_PENDING_AGE_MS) {
      await api.storage.local.remove([PENDING_KEY]);
      await recordResult({ ok: false, phase: "auth-callback", launchId: pending.launchId, error: "SAFARI_AUTH_EXPIRED" });
      return { ok: false, error: "SAFARI_AUTH_EXPIRED" };
    }

    // authTabId attachment is deliberately non-load-bearing. If the popup died
    // before attaching it, the callback sender becomes the authoritative auth
    // tab for this transaction.
    const senderTabId = sender?.tab?.id ?? null;
    const effectiveAuthTabId = pending.authTabId ?? senderTabId;
    if (pending.authTabId != null && senderTabId != null && senderTabId !== pending.authTabId) {
      return { ok: false, error: "SAFARI_AUTH_WRONG_TAB" };
    }

    const parsed = parseCallbackUrl(callbackUrl);
    if (!parsed) return { ok: false, error: "SAFARI_AUTH_BAD_CALLBACK" };
    if (parsed.error) {
      await api.storage.local.remove([PENDING_KEY]);
      await recordResult({ ok: false, phase: "auth-callback", launchId: pending.launchId, error: parsed.error });
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

    // Session persistence is complete before the transport tab is destroyed.
    if (effectiveAuthTabId != null) {
      try { await api.tabs.remove(effectiveAuthTabId); } catch {}
    }
    await restoreOrigin(pending);

    let continuation = { ok: true, signedIn: true };
    if (pending.action === "save-all") {
      if (typeof saveAllOpenTabs !== "function") {
        continuation = { ok: false, signedIn: true, action: "save-all", error: "SAFARI_BULK_HANDLER_UNAVAILABLE" };
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
          continuation = {
            ok: false,
            signedIn: true,
            action: "save-all",
            error: String(error?.message || error || "bulk-save-failed")
          };
        }
      }
    }

    await api.storage.local.remove([PENDING_KEY]);
    await recordResult({
      ...continuation,
      phase: "complete",
      launchId: pending.launchId,
      userEmail: String(user?.email || "")
    });
    return continuation;
  }

  // Promise-returning listeners are the Safari-native path. The shared Chrome
  // background keeps its own sendResponse listeners unchanged.
  api.runtime.onMessage.addListener((message, sender) => {
    if (message?.type === "DOCK_SAFARI_STAGE_AUTH") {
      return stageAuthTransaction(message).catch(async (error) => {
        const result = { ok: false, error: String(error?.message || error || "safari-auth-stage-failed") };
        await recordResult({ ...result, phase: "auth-stage" });
        return result;
      });
    }

    if (message?.type === "DOCK_SAFARI_ATTACH_AUTH_TAB") {
      return attachAuthTab(message).catch(async (error) => {
        const result = { ok: false, error: String(error?.message || error || "safari-auth-attach-failed") };
        await recordResult({ ...result, phase: "auth-attach" });
        return result;
      });
    }

    if (message?.type === "DOCK_SAFARI_CANCEL_AUTH") {
      return cancelAuthTransaction(message).catch(async (error) => ({
        ok: false,
        error: String(error?.message || error || "safari-auth-cancel-failed")
      }));
    }

    if (message?.type === "DOCK_SAFARI_BEGIN_AUTH") {
      return beginAuthTransaction(message).catch(async (error) => {
        const result = { ok: false, error: String(error?.message || error || "safari-auth-start-failed") };
        await recordResult({ ...result, phase: "auth-start" });
        return result;
      });
    }

    if (message?.type === "DOCK_SAFARI_AUTH_CALLBACK") {
      return completeAuthTransaction(message.url, sender).catch(async (error) => {
        const result = { ok: false, error: String(error?.message || error || "safari-auth-callback-failed") };
        await recordResult({ ...result, phase: "auth-callback" });
        return result;
      });
    }

    return undefined;
  });
})();
