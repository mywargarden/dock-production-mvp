// Apple-only resilient persistence for Dock auth/session state.
//
// Safari runtime testing has independently established that WebExtension
// browser.storage.local can reject writes under real Dock load (quota and Disk
// I/O). Chrome remains the product/storage contract. Apple routes only the
// small keys whose loss would corrupt authentication/continuation through an
// IndexedDB-backed layer, while preserving the same storage.local API surface.
//
// This file intentionally contains no ES module syntax so it can be loaded both
// by importScripts() in the Safari service worker and as a side-effect module
// from safariAdapter.js.

(() => {
  if (globalThis.DockAppleCriticalStore) return;

  const DB_NAME = "dock-apple-critical-v1";
  const DB_VERSION = 1;
  const STORE_NAME = "kv";
  const CRITICAL_KEYS = new Set([
    "dockAuthSession",
    "dockAuthUser",
    "dockAuthState",
    "dockSafariPendingAuthAction",
    "dockSafariLastAuthAction",
    "dockAuthConfig",
    "supabaseUrl",
    "supabaseAnonKey",
    "apiBaseUrl"
  ]);

  let dbPromise = null;

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      try {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            db.createObjectStore(STORE_NAME);
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error("APPLE_CRITICAL_DB_OPEN_FAILED"));
        request.onblocked = () => reject(new Error("APPLE_CRITICAL_DB_BLOCKED"));
      } catch (error) {
        reject(error);
      }
    }).catch((error) => {
      dbPromise = null;
      throw error;
    });
    return dbPromise;
  }

  async function readCritical(keys) {
    const list = [...new Set((Array.isArray(keys) ? keys : []).filter((key) => CRITICAL_KEYS.has(key)))];
    if (!list.length) return {};
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const out = {};
      let pending = list.length;
      let settled = false;

      const finish = () => {
        if (!settled && pending === 0) {
          settled = true;
          resolve(out);
        }
      };

      for (const key of list) {
        const req = store.get(key);
        req.onsuccess = () => {
          if (req.result !== undefined) out[key] = req.result;
          pending -= 1;
          finish();
        };
        req.onerror = () => {
          if (settled) return;
          settled = true;
          reject(req.error || new Error("APPLE_CRITICAL_DB_READ_FAILED"));
        };
      }
      tx.onerror = () => {
        if (settled) return;
        settled = true;
        reject(tx.error || new Error("APPLE_CRITICAL_DB_READ_TX_FAILED"));
      };
    });
  }

  async function readAllCritical() {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const out = {};
      const req = store.openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) {
          resolve(out);
          return;
        }
        if (CRITICAL_KEYS.has(String(cursor.key))) out[String(cursor.key)] = cursor.value;
        cursor.continue();
      };
      req.onerror = () => reject(req.error || new Error("APPLE_CRITICAL_DB_CURSOR_FAILED"));
    });
  }

  async function writeCritical(items) {
    const entries = Object.entries(items || {}).filter(([key]) => CRITICAL_KEYS.has(key));
    if (!entries.length) return;
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      for (const [key, value] of entries) store.put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("APPLE_CRITICAL_DB_WRITE_FAILED"));
      tx.onabort = () => reject(tx.error || new Error("APPLE_CRITICAL_DB_WRITE_ABORTED"));
    });
  }

  async function removeCritical(keys) {
    const list = [...new Set((Array.isArray(keys) ? keys : [keys]).filter((key) => CRITICAL_KEYS.has(key)))];
    if (!list.length) return;
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      for (const key of list) store.delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("APPLE_CRITICAL_DB_REMOVE_FAILED"));
      tx.onabort = () => reject(tx.error || new Error("APPLE_CRITICAL_DB_REMOVE_ABORTED"));
    });
  }

  async function clearCritical() {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const req = tx.objectStore(STORE_NAME).clear();
      req.onerror = () => reject(req.error || new Error("APPLE_CRITICAL_DB_CLEAR_FAILED"));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("APPLE_CRITICAL_DB_CLEAR_TX_FAILED"));
    });
  }

  function requestedKeys(keys) {
    if (keys == null) return null;
    if (typeof keys === "string") return [keys];
    if (Array.isArray(keys)) return keys.map(String);
    if (keys && typeof keys === "object") return Object.keys(keys);
    return [];
  }

  function defaultsFor(keys) {
    return keys && typeof keys === "object" && !Array.isArray(keys)
      ? { ...keys }
      : {};
  }

  function splitItems(items) {
    const critical = {};
    const native = {};
    for (const [key, value] of Object.entries(items || {})) {
      if (CRITICAL_KEYS.has(key)) critical[key] = value;
      else native[key] = value;
    }
    return { critical, native };
  }

  function createLocalShim(nativeLocal) {
    if (!nativeLocal?.get || !nativeLocal?.set) return nativeLocal;

    const local = {
      async get(keys = null) {
        const requested = requestedKeys(keys);
        const defaults = defaultsFor(keys);
        const criticalRequested = requested == null
          ? [...CRITICAL_KEYS]
          : requested.filter((key) => CRITICAL_KEYS.has(key));
        const nativeRequested = requested == null
          ? null
          : requested.filter((key) => !CRITICAL_KEYS.has(key));

        let nativeResult = {};
        try {
          // For explicit critical reads, also ask native storage so an existing
          // pre-migration Safari session can be adopted into IndexedDB once.
          const nativeKeys = requested == null
            ? null
            : [...nativeRequested, ...criticalRequested];
          nativeResult = await nativeLocal.get(nativeKeys);
        } catch {}

        let criticalResult = {};
        try {
          criticalResult = requested == null
            ? await readAllCritical()
            : await readCritical(criticalRequested);
        } catch {}

        // One-way migration from a previously healthy browser.storage.local.
        const migrate = {};
        for (const key of criticalRequested) {
          if (!(key in criticalResult) && Object.prototype.hasOwnProperty.call(nativeResult, key)) {
            criticalResult[key] = nativeResult[key];
            migrate[key] = nativeResult[key];
          }
        }
        if (Object.keys(migrate).length) {
          try { await writeCritical(migrate); } catch {}
        }

        const out = { ...defaults, ...nativeResult, ...criticalResult };
        if (requested != null) {
          const filtered = { ...defaults };
          for (const key of requested) {
            if (Object.prototype.hasOwnProperty.call(out, key)) filtered[key] = out[key];
          }
          return filtered;
        }
        return out;
      },

      async set(items = {}) {
        const { critical, native } = splitItems(items);
        const criticalKeys = Object.keys(critical);
        if (criticalKeys.length) {
          // IndexedDB is authoritative for Apple critical state.
          await writeCritical(critical);
          // Mirror opportunistically to native storage for compatibility and
          // storage.onChanged when Safari's store is healthy. Mirror failure is
          // explicitly non-fatal because that is the defect this layer isolates.
          try { await nativeLocal.set(critical); } catch {}
        }
        if (Object.keys(native).length) {
          await nativeLocal.set(native);
        }
      },

      async remove(keys) {
        const list = requestedKeys(keys) || [];
        const critical = list.filter((key) => CRITICAL_KEYS.has(key));
        const native = list.filter((key) => !CRITICAL_KEYS.has(key));
        if (critical.length) {
          await removeCritical(critical);
          try { await nativeLocal.remove(critical); } catch {}
        }
        if (native.length) await nativeLocal.remove(native);
      },

      async clear() {
        await clearCritical();
        await nativeLocal.clear();
      },

      async getBytesInUse(keys = null) {
        let nativeBytes = 0;
        try { nativeBytes = Number(await nativeLocal.getBytesInUse?.(keys)) || 0; } catch {}
        let criticalBytes = 0;
        try {
          const requested = requestedKeys(keys);
          const values = requested == null
            ? await readAllCritical()
            : await readCritical(requested.filter((key) => CRITICAL_KEYS.has(key)));
          criticalBytes = new TextEncoder().encode(JSON.stringify(values)).byteLength;
        } catch {}
        return nativeBytes + criticalBytes;
      }
    };

    return new Proxy(nativeLocal, {
      get(target, property, receiver) {
        if (Object.prototype.hasOwnProperty.call(local, property)) return local[property];
        return Reflect.get(target, property, receiver);
      }
    });
  }

  globalThis.DockAppleCriticalStore = Object.freeze({
    CRITICAL_KEYS,
    createLocalShim,
    readCritical,
    writeCritical,
    removeCritical
  });
})();
