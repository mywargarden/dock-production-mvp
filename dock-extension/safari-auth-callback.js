(() => {
  try {
    const href = window.location.href;
    const hash = window.location.hash || "";
    const search = window.location.search || "";
    if (!/(?:^|[#?&])access_token=/.test(hash + search) && !/(?:^|[#?&])error(?:_description)?=/.test(hash + search)) return;
    if (!globalThis.browser?.runtime?.sendMessage) return;
    globalThis.browser.runtime.sendMessage({
      type: "DOCK_SAFARI_AUTH_CALLBACK",
      url: href
    }).catch(() => {});
  } catch {}
})();
