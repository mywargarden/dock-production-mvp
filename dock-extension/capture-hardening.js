const api = (typeof browser !== "undefined" && browser?.runtime?.getURL) ? browser : chrome;

const FLAG = "__dockCaptureHardeningInstalled";
const HIDE_CSS = `#dock-floating-launcher-host{visibility:hidden!important;opacity:0!important;pointer-events:none!important;transition:none!important}`;

async function activeHttpTab(windowId) {
  try {
    const query = { active: true };
    if (Number.isInteger(windowId)) query.windowId = windowId;
    else query.currentWindow = true;
    const [tab] = await api.tabs.query(query);
    if (!tab?.id || !/^https?:\/\//i.test(String(tab.url || ""))) return null;
    return tab;
  } catch {
    return null;
  }
}

async function installShield(tabId) {
  if (!Number.isInteger(tabId)) return false;
  if (!api.scripting?.insertCSS || !api.scripting?.executeScript) return false;
  try {
    await api.scripting.insertCSS({ target: { tabId }, css: HIDE_CSS });
    const result = await api.scripting.executeScript({
      target: { tabId },
      func: () => {
        const host = document.getElementById("dock-floating-launcher-host");
        if (!host) return true;
        const style = getComputedStyle(host);
        return style.visibility === "hidden" || Number(style.opacity || "1") === 0;
      }
    });
    return result?.[0]?.result === true;
  } catch {
    return false;
  }
}

async function removeShield(tabId) {
  if (!Number.isInteger(tabId) || !api.scripting?.removeCSS) return;
  try { await api.scripting.removeCSS({ target: { tabId }, css: HIDE_CSS }); } catch {}
}

if (!globalThis[FLAG] && api?.tabs?.captureVisibleTab) {
  globalThis[FLAG] = true;
  const originalCaptureVisibleTab = api.tabs.captureVisibleTab.bind(api.tabs);

  api.tabs.captureVisibleTab = async function dockCaptureVisibleTab(windowId, options) {
    const tab = await activeHttpTab(windowId);
    if (!tab) return originalCaptureVisibleTab(windowId, options);

    const clean = await installShield(tab.id);
    if (!clean) throw new Error("DOCK_CAPTURE_SHIELD_UNVERIFIED");

    try {
      return await originalCaptureVisibleTab(windowId, options);
    } finally {
      await removeShield(tab.id);
    }
  };
}

export { HIDE_CSS as LAUNCHER_CAPTURE_HIDE_CSS };
