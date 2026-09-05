const PREVIEW_PREFIX = "dockPreviewPayload:v1:";
export const PREVIEW_PAYLOAD_VERSION_KEY = "dockPreviewPayloadVersion";
export const PREVIEW_PAYLOAD_VERSION = 2;

const INLINE_PREVIEW_FIELDS = [
  "screenshotThumb",
  "screenshot",
  "screenshot_data_url",
  "screenshotDataUrl",
  "screenshotDataURI",
  "screenshotUrl",
  "previewImage",
  "previewUrl",
  "preview_url",
  "thumbnail",
  "thumbnailUrl",
  "thumbnail_url"
];

function norm(value) {
  return String(value == null ? "" : value).trim();
}

export function isInlinePreviewPayload(value) {
  return /^data:image\/[a-z0-9.+-]+;base64,/i.test(norm(value));
}

export function isRemotePreviewPayload(value) {
  const raw = norm(value);
  if (!raw || /^data:/i.test(raw)) return false;
  try {
    const parsed = new URL(raw);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function stableIdentity(item) {
  if (!item || typeof item !== "object") return "";
  return norm(item.local_id || item.id || item.url || item.title || "");
}

function normalizedUrl(item) {
  const raw = norm(item?.url);
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    parsed.hash = "";
    if (parsed.pathname !== "/") parsed.pathname = parsed.pathname.replace(/\/+$/, "");
    return parsed.toString();
  } catch {
    return raw;
  }
}

function hashText(value) {
  const text = String(value || "");
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    h1 ^= code;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= code + i;
    h2 = Math.imul(h2, 0x85ebca6b);
  }
  return `${(h1 >>> 0).toString(36)}${(h2 >>> 0).toString(36)}`;
}

export function previewRefForItem(item) {
  const existing = norm(item?.previewRef);
  if (/^pv1_[a-z0-9]+$/i.test(existing)) return existing;
  const identity = stableIdentity(item);
  if (!identity) return "";
  return `pv1_${hashText(identity)}`;
}

export function previewStorageKey(ref) {
  const clean = norm(ref);
  return clean ? `${PREVIEW_PREFIX}${clean}` : "";
}

function firstInlinePreview(item) {
  for (const field of INLINE_PREVIEW_FIELDS) {
    const value = norm(item?.[field]);
    if (isInlinePreviewPayload(value)) return value;
  }
  return "";
}

function externalizeItem(item, payloadWrites, refs = null) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return item;

  const next = { ...item };
  const inline = firstInlinePreview(next);
  const url = normalizedUrl(next);
  const identity = stableIdentity(next);

  const existingRef = /^pv1_[a-z0-9]+$/i.test(norm(next.previewRef)) ? norm(next.previewRef) : "";
  const sharedRef = url && refs?.byUrl?.get(url) ? refs.byUrl.get(url) : "";
  const identityRef = identity && refs?.byIdentity?.get(identity) ? refs.byIdentity.get(identity) : "";
  const ref = existingRef || sharedRef || identityRef || previewRefForItem(next);

  if (ref && (inline || sharedRef || identityRef || existingRef)) {
    next.previewRef = ref;
  }

  if (inline && ref) {
    payloadWrites[previewStorageKey(ref)] = inline;
    next.previewRef = ref;
  }

  for (const field of INLINE_PREVIEW_FIELDS) {
    if (isInlinePreviewPayload(next[field])) delete next[field];
  }

  if (next.previewRef && refs) {
    if (url) refs.byUrl.set(url, next.previewRef);
    if (identity) refs.byIdentity.set(identity, next.previewRef);
  }

  return next;
}

function externalizeArray(items, payloadWrites, refs = null) {
  return (Array.isArray(items) ? items : []).map((item) => externalizeItem(item, payloadWrites, refs));
}

function externalizeGroupItems(groupItems, payloadWrites, refs) {
  if (!groupItems || typeof groupItems !== "object" || Array.isArray(groupItems)) return groupItems;
  const out = {};
  for (const [groupId, items] of Object.entries(groupItems)) {
    out[groupId] = Array.isArray(items) ? externalizeArray(items, payloadWrites, refs) : items;
  }
  return out;
}

function propagatePreviewRefs(items, refs) {
  if (!Array.isArray(items)) return items;
  return items.map((item) => {
    if (!item || typeof item !== "object") return item;
    if (/^pv1_[a-z0-9]+$/i.test(norm(item.previewRef))) return item;

    const url = normalizedUrl(item);
    const identity = stableIdentity(item);
    const ref = (url && refs?.byUrl?.get(url)) || (identity && refs?.byIdentity?.get(identity)) || "";
    return ref ? { ...item, previewRef: ref } : item;
  });
}

export function externalizePreviewPayloadsFromWrite(items) {
  if (!items || typeof items !== "object" || Array.isArray(items)) {
    return { items, payloadWrites: {} };
  }

  const next = { ...items };
  const payloadWrites = {};
  const refs = { byUrl: new Map(), byIdentity: new Map() };

  if (Array.isArray(next.savedTabs)) {
    next.savedTabs = externalizeArray(next.savedTabs, payloadWrites, refs);
  }
  if (Array.isArray(next.savedTabsLite)) {
    next.savedTabsLite = propagatePreviewRefs(next.savedTabsLite, refs);
  }
  if (Object.prototype.hasOwnProperty.call(next, "dockGroupItems")) {
    next.dockGroupItems = externalizeGroupItems(next.dockGroupItems, payloadWrites, refs);
  }

  return { items: next, payloadWrites };
}

export async function writePreviewPayloads(storageLocal, payloadWrites) {
  const entries = Object.entries(payloadWrites || {});
  if (!entries.length || !storageLocal?.set) return 0;

  let written = 0;
  const batchSize = 6;
  for (let i = 0; i < entries.length; i += batchSize) {
    const patch = Object.fromEntries(entries.slice(i, i + batchSize));
    await storageLocal.set(patch);
    written += Object.keys(patch).length;
  }
  return written;
}

function changed(a, b) {
  try { return JSON.stringify(a) !== JSON.stringify(b); }
  catch { return true; }
}

export async function migrateLegacyPreviewPayloads(storageLocal = globalThis.chrome?.storage?.local) {
  if (!storageLocal?.get || !storageLocal?.set) return { ok: false, reason: "NO_STORAGE" };

  const current = await storageLocal.get([
    "savedTabs",
    "savedTabsLite",
    "dockGroupItems",
    PREVIEW_PAYLOAD_VERSION_KEY
  ]);

  const prepared = externalizePreviewPayloadsFromWrite(current);
  const patch = { [PREVIEW_PAYLOAD_VERSION_KEY]: PREVIEW_PAYLOAD_VERSION };

  for (const key of ["savedTabs", "savedTabsLite", "dockGroupItems"]) {
    if (Object.prototype.hasOwnProperty.call(prepared.items || {}, key) && changed(current?.[key], prepared.items[key])) {
      patch[key] = prepared.items[key];
    }
  }

  const payloadCount = await writePreviewPayloads(storageLocal, prepared.payloadWrites);
  if (Object.keys(patch).length > 1 || Number(current?.[PREVIEW_PAYLOAD_VERSION_KEY] || 0) !== PREVIEW_PAYLOAD_VERSION) {
    await storageLocal.set(patch);
  }

  return {
    ok: true,
    payloadCount,
    migratedAggregates: Object.keys(patch).filter((key) => key !== PREVIEW_PAYLOAD_VERSION_KEY)
  };
}
