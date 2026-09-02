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
