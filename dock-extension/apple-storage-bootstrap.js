// Apple background storage bootstrap.
// Load after apple-critical-store.js and before apple-background.js so every
// background helper sees the same storage.local contract.

(() => {
  const nativeBrowser = globalThis.browser;
  const criticalStore = globalThis.DockAppleCriticalStore;
  if (!nativeBrowser?.storage?.local || !criticalStore?.createLocalShim) return;

  const local = criticalStore.createLocalShim(nativeBrowser.storage.local);
  const storage = new Proxy(nativeBrowser.storage || {}, {
    get(target, property, receiver) {
      if (property === "local") return local;
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
