const imageCache = new Map();
const imageRefCounts = new Map();

function normalizeSource(source) {
  return String(source || '').trim();
}

function isDataUrl(raw) {
  return raw.startsWith('data:');
}

function createBlobUrlFromDataUrl(raw) {
  const [header, payload] = raw.split(',', 2);
  if (!header || !payload) return raw;

  const mimeMatch = header.match(/^data:([^;]+);base64$/i);
  if (!mimeMatch) return raw;

  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }

  const blob = new Blob([bytes], { type: mimeMatch[1] || 'image/jpeg' });
  return URL.createObjectURL(blob);
}

export function getCachedImage(source) {
  const raw = normalizeSource(source);
  if (!raw) return null;
  if (raw.startsWith('blob:')) return raw;
  if (!isDataUrl(raw)) return raw;

  const cached = imageCache.get(raw);
  if (cached) return cached;

  try {
    const url = createBlobUrlFromDataUrl(raw);
    imageCache.set(raw, url);
    return url;
  } catch {
    return raw;
  }
}

export function retainCachedImage(source) {
  const raw = normalizeSource(source);
  if (!raw || !isDataUrl(raw)) return getCachedImage(raw);

  const nextCount = Number(imageRefCounts.get(raw) || 0) + 1;
  imageRefCounts.set(raw, nextCount);
  return getCachedImage(raw);
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
