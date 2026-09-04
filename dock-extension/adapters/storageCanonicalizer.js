/* Dock 0.3.12 storage canonicalization.
   Readers remain backward-compatible with historical preview aliases, but new
   personal/local writes keep one canonical preview plus a distinct favicon.
   Managed district workspace payloads are deliberately untouched.
*/

const PERSONAL_TAB_KEYS = new Set(["savedTabs", "savedTabsLite"]);
const PERSONAL_GROUP_ITEMS_KEY = "dockGroupItems";

const PREVIEW_FIELDS = [
  "screenshot_url",
  "screenshotUrl",
  "screenshotThumb",
  "screenshot",
  "screenshot_data_url",
  "screenshotDataUrl",
  "screenshotDataURI",
  "previewImage",
  "previewUrl",
  "preview_url",
  "thumbnail",
  "thumbnailUrl",
  "thumbnail_url",
  "image",
  "imageUrl",
  "image_url",
  "uploadedImage",
  "uploadedImageUrl",
  "uploaded_image_url",
  "cardImage",
  "cardImageUrl",
  "card_image_url",
  "customImage",
  "customImageUrl",
  "custom_image_url",
  "customIcon"
];

function text(value) {
  return String(value || "").trim();
}

function isPlaceholder(value) {
  return /screenshot-unavailable/i.test(text(value));
}

function isFaviconLike(value) {
  const raw = text(value);
  return /google\.com\/s2\/favicons|favicon\.ico|apple-touch-icon|\/favicon(?:[/?#]|$)/i.test(raw);
}

function previewScore(value) {
  const raw = text(value);
  if (!raw || isPlaceholder(raw)) return -1;
  const dataImage = /^data:image\//i.test(raw);
  const remote = /^https?:\/\//i.test(raw);
  if (dataImage && raw.length > 30000) return 100000000 + raw.length;
  if (dataImage && raw.length > 1000) return 50000000 + raw.length;
  if (remote && !isFaviconLike(raw)) return 20000000 + raw.length;
  if (dataImage) return 1000000 + raw.length;
  if (remote) return 1000 + raw.length;
  return raw.length;
}

function bestPreview(item) {
  let winner = "";
  let score = -1;
  for (const field of PREVIEW_FIELDS) {
    const candidate = text(item?.[field]);
    const candidateScore = previewScore(candidate);
    if (candidateScore > score) {
      winner = candidate;
      score = candidateScore;
    }
  }
  return score > 0 ? winner : "";
}

function bestFavicon(item, chosenPreview) {
  const candidates = [item?.faviconUrl, item?.favIconUrl, item?.favicon, item?.icon_url, item?.iconUrl];
  for (const value of candidates) {
    const raw = text(value);
    if (!raw || raw === chosenPreview || /^data:/i.test(raw)) continue;
    if (/^https?:\/\//i.test(raw)) return raw;
  }
  return "";
}

export function canonicalizePersonalMemory(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return item;

  const next = { ...item };
  const preview = bestPreview(next);
  const favicon = bestFavicon(next, preview);

  for (const field of PREVIEW_FIELDS) delete next[field];
  delete next.favIconUrl;
  delete next.favicon;
  delete next.iconUrl;
  delete next.icon_url;

  if (preview) {
    if (/^data:image\//i.test(preview)) next.screenshotThumb = preview;
    else next.screenshot_url = preview;
    next.previewMissing = false;
    next.screenshotBlocked = false;
  }

  if (favicon) {
    next.faviconUrl = favicon;
    next.icon_url = favicon;
  } else if (next.faviconUrl && next.faviconUrl === preview) {
    delete next.faviconUrl;
  }

  return next;
}

function canonicalizeGroupItems(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const out = {};
  for (const [groupId, items] of Object.entries(value)) {
    out[groupId] = Array.isArray(items) ? items.map(canonicalizePersonalMemory) : items;
  }
  return out;
}

export function canonicalizeLocalWrite(items) {
  if (!items || typeof items !== "object" || Array.isArray(items)) return items;
  const next = { ...items };
  for (const key of PERSONAL_TAB_KEYS) {
    if (Array.isArray(next[key])) next[key] = next[key].map(canonicalizePersonalMemory);
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
