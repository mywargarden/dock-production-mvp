(() => {
  "use strict";

  const PREWARM_LIMIT = 12;
  const PROMOTE_LIMIT = 10;
  const STORAGE_KEYS = ["savedTabs", "dockGroupItems"];
  const previewFields = [
    "previewMicro",
    "screenshotThumb",
    "screenshot_url",
    "screenshotUrl",
    "screenshot",
    "screenshot_data_url",
    "previewImage",
    "previewUrl",
    "thumbnail",
    "image"
  ];

  const keepAlive = [];

  function previewSource(item) {
    if (!item || typeof item !== "object") return "";
    for (const field of previewFields) {
      const value = String(item[field] || "").trim();
      if (/^(?:https?:\/\/|data:image\/)/i.test(value)) return value;
    }
    return "";
  }

  function collectSources(payload) {
    const out = [];
    const seen = new Set();
    const add = (item) => {
      const source = previewSource(item);
      if (!source || seen.has(source)) return;
      seen.add(source);
      out.push(source);
    };

    (Array.isArray(payload?.savedTabs) ? payload.savedTabs : []).forEach(add);
    const groups = payload?.dockGroupItems;
    if (groups && typeof groups === "object") {
      Object.values(groups).forEach((items) => {
        if (Array.isArray(items)) items.forEach(add);
      });
    }
    return out.slice(0, PREWARM_LIMIT);
  }

  function prewarmSource(source) {
    try {
      const image = new Image();
      image.loading = "eager";
      image.decoding = "async";
      image.fetchPriority = "high";
      image.referrerPolicy = "no-referrer";
      image.src = source;
      keepAlive.push(image);
      image.decode?.().catch(() => {});
    } catch {}
  }

  async function prewarmStoredPreviews() {
    try {
      const stored = await chrome.storage.local.get(STORAGE_KEYS);
      collectSources(stored).forEach(prewarmSource);
    } catch {}
  }

  function promoteImage(img, index) {
    if (!(img instanceof HTMLImageElement) || index >= PROMOTE_LIMIT) return;
    try {
      img.loading = "eager";
      img.decoding = "async";
      img.fetchPriority = "high";
    } catch {}
  }

  function installScopedPromoter(root) {
    if (!root) return;
    let promoted = 0;
    const scan = (node) => {
      if (promoted >= PROMOTE_LIMIT || !(node instanceof Element)) return;
      const images = node.matches("img") ? [node] : Array.from(node.querySelectorAll("img"));
      for (const img of images) {
        if (promoted >= PROMOTE_LIMIT) break;
        promoteImage(img, promoted++);
      }
    };

    scan(root);
    if (promoted >= PROMOTE_LIMIT) return;

    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) scan(node);
        if (promoted >= PROMOTE_LIMIT) break;
      }
      if (promoted >= PROMOTE_LIMIT) observer.disconnect();
    });
    observer.observe(root, { childList: true, subtree: true });
    setTimeout(() => observer.disconnect(), 5000);
  }

  function installPromoters() {
    installScopedPromoter(document.getElementById("tabList"));
    installScopedPromoter(document.getElementById("grid"));
  }

  prewarmStoredPreviews();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", installPromoters, { once: true });
  } else {
    installPromoters();
  }
})();
