/* Dock 0.3.12 hardening: complete legacy-loop containment.
   memories.js has now executed its one-shot visual setup. The two known hot
   setInterval callbacks were suppressed by legacy-loop-shield.js, so restore
   the browser's native timer functions and disconnect the legacy whole-page
   watermark observer. Event/storage-driven visual refresh remains intact.
*/
(() => {
  try {
    const observer = window.__dockHideCenterWatermarkObserver;
    if (observer && typeof observer.disconnect === "function") {
      observer.disconnect();
    }
    window.__dockHideCenterWatermarkObserver = null;
  } catch {}

  try {
    const shield = window.__dockLegacyLoopShield;
    if (!shield) return;
    if (typeof shield.nativeSetInterval === "function") {
      window.setInterval = shield.nativeSetInterval;
    }
    if (typeof shield.nativeClearInterval === "function") {
      window.clearInterval = shield.nativeClearInterval;
    }
    shield.active = false;
  } catch {}
})();
