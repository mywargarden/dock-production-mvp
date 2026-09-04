import "./background-v2.js";

const api = (typeof browser !== "undefined" && browser?.runtime?.getURL) ? browser : chrome;

function isAllowedLauncherSender(sender) {
  const senderUrl = String(sender?.tab?.url || sender?.url || "");
  if (/^https?:\/\//i.test(senderUrl)) return true;
  return senderUrl === api.runtime.getURL("memories.html");
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
