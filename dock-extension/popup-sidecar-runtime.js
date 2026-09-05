const params = new URLSearchParams(location.search);
const sidecarMode = params.get("mode") === "sidecar";

if (sidecarMode) {
  document.documentElement.dataset.dockSurface = "sidecar";
  document.documentElement.dataset.sidecarAuth = "pending";
  const token = String(params.get("token") || "").trim();
  let authorized = false;
  try {
    const result = await chrome.runtime.sendMessage({ type: "VALIDATE_DOCK_SIDECAR_TOKEN", token });
    authorized = result?.ok === true;
  } catch {}

  if (!authorized) {
    document.documentElement.dataset.sidecarAuth = "denied";
    document.body.replaceChildren();
  } else {
    document.documentElement.dataset.sidecarAuth = "ready";

    let raf = 0;
    const reportSize = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (!document.body) return;
        const rect = document.body.getBoundingClientRect();
        let bottom = 0;
        for (const child of document.body.children) {
          const style = getComputedStyle(child);
          if (style.display === "none" || style.visibility === "hidden") continue;
          bottom = Math.max(bottom, child.getBoundingClientRect().bottom - rect.top);
        }
        const paddingBottom = Number.parseFloat(getComputedStyle(document.body).paddingBottom || "0") || 0;
        try { window.parent?.postMessage({ type: "DOCK_SIDECAR_SIZE", height: Math.max(1, Math.ceil(bottom + paddingBottom)) }, "*"); } catch {}
      });
    };

    const ready = () => {
      reportSize();
      try { window.parent?.postMessage({ type: "DOCK_SIDECAR_READY" }, "*"); } catch {}
      if (typeof ResizeObserver === "function") {
        const observer = new ResizeObserver(reportSize);
        observer.observe(document.body);
        for (const child of document.body.children) observer.observe(child);
      }
    };

    if (document.readyState === "loading") addEventListener("DOMContentLoaded", ready, { once: true });
    else queueMicrotask(ready);
  }
}
