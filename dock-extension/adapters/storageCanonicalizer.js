/* Dock 0.3.12 storage canonicalization.
   Readers remain backward-compatible with historical preview aliases, while
   new local writes persist one preview payload and keep the lite cache free of
   inline base64. Managed district workspace payloads are deliberately untouched.
*/

import { canonicalizeMemoryPreview, makeLiteMemoryPreview } from "../core/preview.js";

const PERSONAL_GROUP_ITEMS_KEY = "dockGroupItems";

function canonicalizeGroupItems(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const out = {};
  for (const [groupId, items] of Object.entries(value)) {
    out[groupId] = Array.isArray(items) ? items.map(canonicalizeMemoryPreview) : items;
  }
  return out;
}

export function canonicalizeLocalWrite(items) {
  if (!items || typeof items !== "object" || Array.isArray(items)) return items;
  const next = { ...items };

  if (Array.isArray(next.savedTabs)) {
    next.savedTabs = next.savedTabs.map(canonicalizeMemoryPreview);
  }
  if (Array.isArray(next.savedTabsLite)) {
    next.savedTabsLite = next.savedTabsLite.map(makeLiteMemoryPreview);
  }
  if (Object.prototype.hasOwnProperty.call(next, PERSONAL_GROUP_ITEMS_KEY)) {
    next[PERSONAL_GROUP_ITEMS_KEY] = canonicalizeGroupItems(next[PERSONAL_GROUP_ITEMS_KEY]);
  }

  return next;
}

export function wrapExtensionStorage(rawApi) {
  if (!rawApi?.storage?.local?.set) return rawApi;

  const rawStorage = rawApi.storage;
  const rawLocal = rawStorage.local;

  const local = new Proxy(rawLocal, {
    get(target, prop) {
      if (prop === "set") {
        return (items, ...rest) => target.set(canonicalizeLocalWrite(items), ...rest);
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    }
  });

  const storage = new Proxy(rawStorage, {
    get(target, prop) {
      if (prop === "local") return local;
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    }
  });

  return new Proxy(rawApi, {
    get(target, prop) {
      if (prop === "storage") return storage;
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
}
