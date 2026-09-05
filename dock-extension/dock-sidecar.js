(() => {
  if (globalThis.DockSidecar) return;

  const PANEL_WIDTH = 384;
  const PANEL_DEFAULT_HEIGHT = 360;
  const PANEL_MAX_HEIGHT = 640;
  const PANEL_MIN_HEIGHT = 140;
  const GAP = 12;
  const EDGE = 12;
  const READY_TIMEOUT_MS = 1800;

  const CSS = `
    .dockSidecarShell {
      all: initial;
      position: fixed;
      box-sizing: border-box;
      z-index: 2147483647;
      border-radius: 18px;
      background: #fbf7f2;
      border: 1px solid rgba(75,183,201,.44);
      box-shadow: 0 22px 58px rgba(24,67,92,.26), 0 4px 16px rgba(24,67,92,.12);
      overflow: visible;
      opacity: 1;
      transform: translateY(0) scale(1);
      transform-origin: center center;
      transition: opacity 120ms ease, transform 120ms ease;
      pointer-events: auto;
    }
    .dockSidecarShell[hidden] { display: none !important; }
    .dockSidecarShell.isEntering { opacity: 0; transform: translateY(2px) scale(.985); }
    .dockSidecarShell.isBooting { visibility: hidden; opacity: 0; pointer-events: none; transition: none; }
    .dockSidecarFrame { all: initial; display: block; box-sizing: border-box; width: 100%; height: 100%; border: 0; border-radius: 17px; background: #fbf7f2; }
    .dockSidecarPointer { all: initial; position: absolute; width: 14px; height: 14px; background: #fbf7f2; transform: rotate(45deg); pointer-events: none; }
    .dockSidecarShell[data-side="right"] .dockSidecarPointer { left: -8px; border-left: 1px solid rgba(75,183,201,.44); border-bottom: 1px solid rgba(75,183,201,.44); }
    .dockSidecarShell[data-side="left"] .dockSidecarPointer { right: -8px; border-right: 1px solid rgba(75,183,201,.44); border-top: 1px solid rgba(75,183,201,.44); }
    @media (prefers-reduced-motion: reduce) { .dockSidecarShell { transition: none; } }
  `;

  function clamp(value, min, max) { return Math.min(Math.max(value, min), Math.max(min, max)); }

  function addStyle(root) {
    const target = root instanceof ShadowRoot ? root : document.head;
    if (!target || target.querySelector?.('[data-dock-sidecar-style="1"]')) return;
    const style = document.createElement("style");
    style.dataset.dockSidecarStyle = "1";
    style.textContent = CSS;
    target.appendChild(style);
  }

  function create({ launcher, root = null, onFallback = null, getPageZoom = null } = {}) {
    if (!launcher) return null;
    const mountRoot = root instanceof ShadowRoot ? root : document.body;
    if (!mountRoot) return null;
    addStyle(root instanceof ShadowRoot ? root : document);

    const shell = document.createElement("div");
    shell.className = "dockSidecarShell";
    shell.hidden = true;
    shell.dataset.side = "right";
    shell.setAttribute("role", "dialog");
    shell.setAttribute("aria-label", "Dock");

    const pointer = document.createElement("span");
    pointer.className = "dockSidecarPointer";
    const frame = document.createElement("iframe");
    frame.className = "dockSidecarFrame";
    frame.title = "Dock";
    frame.src = "about:blank";
    frame.setAttribute("loading", "eager");
    shell.append(pointer, frame);
    mountRoot.appendChild(shell);

    let open = false;
    let ready = false;
    let desiredHeight = 0;
    let readyTimer = null;
    let frameBootPromise = null;

    function pageZoom() {
      const value = typeof getPageZoom === "function" ? Number(getPageZoom()) : 1;
      return Number.isFinite(value) && value > 0 ? value : 1;
    }

    function panelSize() {
      const zoom = pageZoom();
      const viewportWidth = window.innerWidth * zoom;
      const viewportHeight = window.innerHeight * zoom;
      const width = Math.max(300, Math.min(PANEL_WIDTH, viewportWidth - EDGE * 2));
      const availableHeight = Math.max(1, viewportHeight - EDGE * 2);
      const requestedHeight = desiredHeight || PANEL_DEFAULT_HEIGHT;
      const height = Math.max(Math.min(PANEL_MIN_HEIGHT, availableHeight), Math.min(requestedHeight, PANEL_MAX_HEIGHT, availableHeight));
      return { width, height };
    }

    function reposition() {
      if (!open) return;
      const zoom = pageZoom();
      const cssRect = launcher.getBoundingClientRect();
      const rect = { left: cssRect.left * zoom, right: cssRect.right * zoom, top: cssRect.top * zoom, bottom: cssRect.bottom * zoom, width: cssRect.width * zoom, height: cssRect.height * zoom };
      const viewportWidth = window.innerWidth * zoom;
      const viewportHeight = window.innerHeight * zoom;
      const { width, height } = panelSize();
      const rightSpace = viewportWidth - rect.right - EDGE;
      const leftSpace = rect.left - EDGE;
      const putRight = rightSpace >= width + GAP || rightSpace >= leftSpace;
      let left = putRight ? rect.right + GAP : rect.left - width - GAP;
      left = clamp(left, EDGE, viewportWidth - width - EDGE);
      const anchorCenterY = rect.top + rect.height / 2;
      let top = anchorCenterY - height / 2;
      top = clamp(top, EDGE, viewportHeight - height - EDGE);
      shell.style.zoom = String(1 / zoom);
      shell.dataset.side = putRight ? "right" : "left";
      shell.style.left = `${Math.round(left)}px`;
      shell.style.top = `${Math.round(top)}px`;
      shell.style.width = `${Math.round(width)}px`;
      shell.style.height = `${Math.round(height)}px`;
      const pointerTop = clamp(anchorCenterY - top - 7, 18, height - 32);
      pointer.style.top = `${Math.round(pointerTop)}px`;
    }

    function clearReadyTimer() { if (readyTimer) { clearTimeout(readyTimer); readyTimer = null; } }

    function close({ restoreFocus = false } = {}) {
      if (!open) return;
      open = false;
      shell.hidden = true;
      shell.classList.remove("isEntering", "isBooting");
      launcher.classList?.remove("sidecarOpen");
      launcher.setAttribute?.("aria-expanded", "false");
      if (restoreFocus) launcher.focus?.({ preventScroll: true });
    }

    function fallbackIfNeeded() {
      if (!open || ready) return;
      close();
      frame.src = "about:blank";
      if (typeof onFallback === "function") onFallback();
    }

    async function ensureFrameBooted() {
      if (ready || frame.src.includes("popup.html")) return true;
      if (frameBootPromise) return frameBootPromise;
      frameBootPromise = (async () => {
        try {
          const bytes = new Uint32Array(4);
          crypto.getRandomValues(bytes);
          const token = Array.from(bytes, (value) => value.toString(16).padStart(8, "0")).join("");
          const registered = await chrome.runtime.sendMessage({ type: "REGISTER_DOCK_SIDECAR_TOKEN", token });
          if (!registered?.ok) return false;
          frame.src = `${chrome.runtime.getURL("popup.html")}?mode=sidecar&token=${encodeURIComponent(token)}`;
          return true;
        } catch { return false; }
      })();
      try { return await frameBootPromise; }
      finally { frameBootPromise = null; }
    }

    function revealIfSized() {
      if (!open || !ready || !desiredHeight) return;
      reposition();
      shell.classList.remove("isBooting");
      shell.classList.add("isEntering");
      requestAnimationFrame(() => requestAnimationFrame(() => shell.classList.remove("isEntering")));
    }

    async function show() {
      if (open) return;
      const booted = await ensureFrameBooted();
      if (!booted) { if (typeof onFallback === "function") onFallback(); return; }
      open = true;
      launcher.classList?.add("sidecarOpen");
      launcher.setAttribute?.("aria-expanded", "true");
      shell.hidden = false;
      shell.classList.add("isBooting");
      reposition();
      revealIfSized();
      if (!ready || !desiredHeight) {
        clearReadyTimer();
        readyTimer = setTimeout(fallbackIfNeeded, READY_TIMEOUT_MS);
      }
    }

    function toggle() { if (open) { close({ restoreFocus: true }); return; } return show(); }

    function onMessage(event) {
      if (event.source !== frame.contentWindow) return;
      if (event.data?.type === "DOCK_SIDECAR_READY") {
        ready = true;
        if (desiredHeight) clearReadyTimer();
        revealIfSized();
      } else if (event.data?.type === "DOCK_SIDECAR_SIZE") {
        const nextHeight = Number(event.data?.height || 0);
        if (Number.isFinite(nextHeight) && nextHeight > 0) {
          desiredHeight = Math.ceil(nextHeight);
          if (ready) clearReadyTimer();
          reposition();
          revealIfSized();
        }
      } else if (event.data?.type === "DOCK_SIDECAR_CLOSE") close();
    }

    function onDocumentPointerDown(event) {
      if (!open) return;
      const path = event.composedPath?.() || [];
      const shadowHost = root instanceof ShadowRoot ? root.host : null;
      if (path.includes(launcher) || path.includes(shell) || (shadowHost && path.includes(shadowHost))) return;
      close();
    }

    function onKeyDown(event) {
      if (open && event.key === "Escape") { event.preventDefault(); close({ restoreFocus: true }); }
    }

    window.addEventListener("message", onMessage);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    document.addEventListener("pointerdown", onDocumentPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    launcher.setAttribute?.("aria-haspopup", "dialog");
    launcher.setAttribute?.("aria-expanded", "false");

    return {
      toggle,
      open: show,
      close,
      reposition,
      isOpen: () => open,
      destroy() {
        clearReadyTimer();
        window.removeEventListener("message", onMessage);
        window.removeEventListener("resize", reposition);
        window.removeEventListener("scroll", reposition, true);
        document.removeEventListener("pointerdown", onDocumentPointerDown, true);
        document.removeEventListener("keydown", onKeyDown, true);
        shell.remove();
      }
    };
  }

  globalThis.DockSidecar = { create };
})();
