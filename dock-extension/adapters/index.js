import { getChromeApi } from "./chromeAdapter.js";
import { getSafariApi } from "./safariAdapter.js";
import { wrapExtensionStorage } from "./storageCanonicalizer.js";

// Prefer `browser` when present (Safari/Firefox style); fall back to `chrome` (Chrome/Edge).
const b = getSafariApi();
const rawApi = (b && b.runtime && b.runtime.getURL) ? b : getChromeApi();
export const api = wrapExtensionStorage(rawApi);

if (!api || !api.runtime || !api.runtime.getURL) {
  throw new Error("No WebExtension API namespace found (expected `browser` or `chrome`).");
}
