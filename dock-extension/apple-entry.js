// Apple background entrypoint: preserve the proven managed-policy/OAuth bootstrap
// and layer only the Apple browser-authority adapters beside the shared core.
importScripts("apple-background.js");
importScripts("apple-internal-url-guard.js");
importScripts("apple-tab-anchor.js");
importScripts("apple-share-background.js");
