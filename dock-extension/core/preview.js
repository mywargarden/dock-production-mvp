const PREVIEW_FIELDS = [
  "screenshotThumb",
  "screenshot",
  "screenshot_data_url",
  "screenshotDataUrl",
  "screenshotDataURI",
  "screenshot_url",
  "screenshotUrl",
  "previewImage",
  "previewUrl",
  "preview_url",
  "thumbnail",
  "thumbnailUrl",
  "thumbnail_url"
];

const LEGACY_ALIAS_FIELDS = PREVIEW_FIELDS.filter(
  (field) => field !== "screenshotThumb" && field !== "screenshot_url"
);

function norm(value) {
  return String(value == null ? "" : value).trim();
}

export function isInlineImagePreview(value) {
  return /^data:image\/(?:png|jpeg|jpg|webp);base64,/i.test(norm(value));
}

export function isRemoteImagePreview(value) {
  const raw = norm(value);
  if (!raw || /^data:/i.test(raw)) return false;
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function looksLikeFavicon(value) {
  const raw = norm(value).toLowerCase();
  return /google\.com\/s2\/favicons|favicon\.ico|apple-touch-icon|\/favicon(?:[/?#]|$)/i.test(raw);
}

function previewScore(value) {
  const raw = norm(value);
  if (!raw || /screenshot-unavailable/i.test(raw)) return -1;
  if (isInlineImagePreview(raw)) return 100000000 + raw.length;
  if (isRemoteImagePreview(raw) && !looksLikeFavicon(raw)) return 20000000 + raw.length;
  return -1;
}

export function getCanonicalPreview(tab) {
  let best = "";
  let bestScore = -1;
  for (const field of PREVIEW_FIELDS) {
    const value = norm(tab?.[field]);
    const score = previewScore(value);
    if (score > bestScore) {
      best = value;
      bestScore = score;
    }
  }
  return bestScore >= 0 ? best : "";
}

/**
 * Backward-compatible reader, canonical writer:
 *   - inline screenshot data -> screenshotThumb
 *   - remote screenshot URL -> screenshot_url
 * Exactly one preview payload survives. Icon/custom-image fields are untouched.
 */
export function canonicalizeMemoryPreview(tab) {
  if (!tab || typeof tab !== "object" || Array.isArray(tab)) return tab;
  const next = { ...tab };
  const preview = getCanonicalPreview(next);

  for (const field of LEGACY_ALIAS_FIELDS) delete next[field];
  delete next.screenshotThumb;
  delete next.screenshot_url;

  if (isInlineImagePreview(preview)) next.screenshotThumb = preview;
  else if (isRemoteImagePreview(preview)) next.screenshot_url = preview;

  if (preview) {
    next.screenshotBlocked = false;
    next.previewMissing = false;
    next.previewCheckedAt = Number(next.previewCheckedAt || 0) || Date.now();
  }

  return next;
}

/** Lite storage never duplicates base64 screenshot bytes. */
export function makeLiteMemoryPreview(tab) {
  const next = canonicalizeMemoryPreview(tab);
  if (!next || typeof next !== "object") return next;
  if (isInlineImagePreview(next.screenshotThumb)) {
    delete next.screenshotThumb;
    if (String(next.url || "").trim()) next.previewMissing = true;
  }
  return next;
}

export function previewForRemoteSync(tab) {
  const preview = getCanonicalPreview(tab);
  return {
    dataUrl: isInlineImagePreview(preview) ? preview : "",
    remoteUrl: isRemoteImagePreview(preview) ? preview : ""
  };
}
