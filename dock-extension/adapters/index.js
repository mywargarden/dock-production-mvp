import { getChromeApi } from "./chromeAdapter.js";
import { getSafariApi } from "./safariAdapter.js";

// Prefer `browser` when present (Safari/Firefox style); fall back to `chrome` (Chrome/Edge).
const b = getSafariApi();
export const api = (b && b.runtime && b.runtime.getURL) ? b : getChromeApi();

if (!api || !api.runtime || !api.runtime.getURL) {
  throw new Error("No WebExtension API namespace found (expected `browser` or `chrome`).");
}
