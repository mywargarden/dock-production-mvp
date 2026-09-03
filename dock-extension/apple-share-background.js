// Safari/iPadOS handoff for first-party Dock short-share links.
// The public share page supplies consent; this bridge only translates the
// browser-neutral share id into this installed Apple extension's local import URL.
(() => {
  const api = globalThis.browser;
  if (!api?.runtime?.onMessage || !api?.runtime?.getURL || !api?.tabs) return;

  function cleanShareId(value) {
    const id = String(value || "").trim();
    return /^[A-Za-z0-9_-]{8,64}$/.test(id) ? id : "";
  }

  api.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== "DOCK_OPEN_SHARED_DOCK") return undefined;

    (async () => {
      const id = cleanShareId(message?.shareId);
      if (!id) throw new Error("Invalid Dock share link.");
      const importUrl = `${api.runtime.getURL("import.html")}#share=${encodeURIComponent(id)}`;

      const tabId = sender?.tab?.id;
      if (tabId != null) {
        try {
          await api.tabs.update(tabId, { url: importUrl, active: true });
          return { ok: true, mode: "same-tab" };
        } catch {}
      }

      await api.tabs.create({ url: importUrl, active: true });
      return { ok: true, mode: "new-tab" };
    })().then(sendResponse).catch((error) => {
      sendResponse({ ok: false, error: String(error?.message || error || "share-handoff-failed") });
    });
    return true;
  });
})();
