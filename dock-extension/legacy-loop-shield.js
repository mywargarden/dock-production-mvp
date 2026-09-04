/* Dock 0.3.12 hardening: contain two legacy hot loops without changing their
   one-shot behavior or the event/storage-driven refresh paths that replaced them.

   This shim is intentionally narrow. It only suppresses interval callbacks that
   identify themselves as the known managed-background or centered-watermark
   maintenance loops, and only at their historical 250ms/350ms cadences.
*/
(() => {
  const nativeSetInterval = window.setInterval.bind(window);
  const nativeClearInterval = window.clearInterval.bind(window);
  const suppressed = new Set();
  let nextSuppressedId = -1000;

  function callbackSource(callback) {
    try { return Function.prototype.toString.call(callback); } catch { return ""; }
  }

  function isLegacyDockHotLoop(callback, delay) {
    const ms = Number(delay || 0);
    if (ms !== 250 && ms !== 350) return false;
    const source = callbackSource(callback);
    if (ms === 250 && source.includes("dockApplyDistrictBackgroundFinal")) return true;
    if (ms === 350 && source.includes("hideCenterDockWatermark")) return true;
    return false;
  }

  window.setInterval = function dockHardenedSetInterval(callback, delay, ...args) {
    if (isLegacyDockHotLoop(callback, delay)) {
      const id = nextSuppressedId--;
      suppressed.add(id);
      return id;
    }
    return nativeSetInterval(callback, delay, ...args);
  };

  window.clearInterval = function dockHardenedClearInterval(id) {
    if (suppressed.has(id)) {
      suppressed.delete(id);
      return;
    }
    return nativeClearInterval(id);
  };

  window.__dockLegacyLoopShield = {
    active: true,
    nativeSetInterval,
    nativeClearInterval,
    suppressed
  };
})();
