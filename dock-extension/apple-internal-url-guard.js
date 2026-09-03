// Safari's extension pages use safari-web-extension://. The shared Chrome core
// predates that exact scheme in two background filters. Extend those mutable
// classic-script bindings without forking the shared bulk-save implementation.
(() => {
  const isSafariExtensionUrl = (value) => {
    const raw = String(value || "").trim().toLowerCase();
    return raw.startsWith("safari-web-extension://") || raw.startsWith("safari-extension://");
  };

  try {
    const sharedIsInternalUrl = isInternalUrl;
    isInternalUrl = function appleAwareInternalUrl(url) {
      return isSafariExtensionUrl(url) || sharedIsInternalUrl(url);
    };
  } catch {}

  try {
    const sharedShouldExcludeMemoryUrl = shouldExcludeMemoryUrl;
    shouldExcludeMemoryUrl = function appleAwareExcludedMemory(value) {
      const raw = value && typeof value === "object"
        ? String(value.url || value.local_id || value.id || "")
        : String(value || "");
      return isSafariExtensionUrl(raw) || sharedShouldExcludeMemoryUrl(value);
    };
  } catch {}
})();
