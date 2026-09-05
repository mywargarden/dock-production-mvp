const imageCache = new Map();
const imageRefCounts = new Map();

function normalizeSource(source) {
  return String(source || '').trim();
}

function isDataUrl(raw) {
  return raw.startsWith('data:');
}

/*
  Dock first-paint rule:
  Do not synchronously atob() multi-megabyte screenshot data just to turn it
  into a Blob URL. That work blocked the popup cascade before lazy images could
  lazy-load. Returning the original data URL lets the browser schedule image
  decode itself and makes loading="lazy" meaningful.
*/
export function getCachedImage(source) {
  const raw = normalizeSource(source);
  if (!raw) return null;
  if (raw.startsWith('blob:')) return raw;
  if (isDataUrl(raw)) return raw;
  return raw;
}

export function retainCachedImage(source) {
  const raw = normalizeSource(source);
  if (!raw || !isDataUrl(raw)) return getCachedImage(raw);

  const nextCount = Number(imageRefCounts.get(raw) || 0) + 1;
  imageRefCounts.set(raw, nextCount);
  return raw;
}

export function releaseCachedImage(source) {
  const raw = normalizeSource(source);
  if (!raw || !isDataUrl(raw)) return;

  const currentCount = Number(imageRefCounts.get(raw) || 0);
  if (currentCount <= 1) {
    imageRefCounts.delete(raw);
    const cachedUrl = imageCache.get(raw);
    if (cachedUrl && cachedUrl.startsWith('blob:')) {
      try { URL.revokeObjectURL(cachedUrl); } catch {}
    }
    imageCache.delete(raw);
    return;
  }

  imageRefCounts.set(raw, currentCount - 1);
}

export function getPreviewIdentity(tab) {
  const raw = normalizeSource(tab?.screenshotThumb || tab?.screenshot || tab?.screenshot_data_url || '');
  if (!raw) return '';
  if (!isDataUrl(raw)) return raw;
  return `${raw.slice(0, 48)}:${raw.length}`;
}
