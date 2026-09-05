/* Dock local storage canonicalization.
   Metadata used to open/render Dock stays in aggregate records. Heavy inline
   screenshot bytes are externalized to per-memory preview keys so reading
   savedTabs/groupItems never deserializes the entire screenshot pile.
*/

import { canonicalizeMemoryPreview, makeLiteMemoryPreview } from "../core/preview.js";
import {
  externalizePreviewPayloadsFromWrite,
  writePreviewPayloads
} from "../core/previewPayloadStore.js";

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
        return async (items, ...rest) => {
          const canonical = canonicalizeLocalWrite(items);
          const prepared = externalizePreviewPayloadsFromWrite(canonical);

          // Write screenshot payloads first. Aggregate metadata can then safely
          // reference them without ever embedding the base64 bytes again.
          await writePreviewPayloads(target, prepared.payloadWrites);
          return await target.set(prepared.items, ...rest);
        };
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
