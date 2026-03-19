export function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

export function isInternalUrl(url) {
  if (!url) return true;
  return (
    url.startsWith("chrome://") ||
    url.startsWith("chrome-extension://") ||
    url.startsWith("edge://") ||
    url.startsWith("about:") ||
    url.startsWith("safari-extension://") ||
    url.includes("chromewebstore.google.com")
  );
}
