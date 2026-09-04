import "./background-v2.js";

const api = (typeof browser !== "undefined" && browser?.runtime?.getURL) ? browser : chrome;

function isAllowedLauncherSender(sender) {
  const tabUrl = String(sender?.tab?.url || "");
  const documentUrl = String(sender?.url || "");
  const memoriesUrl = api.runtime.getURL("memories.html");
  const newTabUrl = api.runtime.getURL("newtab.html");

  if (/^https?:\/\//i.test(tabUrl) || /^https?:\/\//i.test(documentUrl)) return true;
  if (documentUrl === memoriesUrl || documentUrl === newTabUrl) return true;
  if (tabUrl === memoriesUrl || tabUrl === newTabUrl) return true;
  return false;
}

api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type !== "OPEN_DOCK_POPUP") return;

  (async () => {
    try {
      if (!isAllowedLauncherSender(sender)) {
        sendResponse({ ok: false, code: "LAUNCHER_SENDER_NOT_ALLOWED" });
        return;
      }
      if (!api.action?.openPopup) {
        sendResponse({ ok: false, code: "POPUP_API_UNAVAILABLE" });
        return;
      }

      const windowId = sender?.tab?.windowId;
      if (Number.isInteger(windowId)) {
        await api.action.openPopup({ windowId });
      } else {
        await api.action.openPopup();
      }
      sendResponse({ ok: true });
    } catch (error) {
      sendResponse({
        ok: false,
        code: "POPUP_OPEN_FAILED",
        error: String(error?.message || error || "")
      });
    }
  })();

  return true;
});
