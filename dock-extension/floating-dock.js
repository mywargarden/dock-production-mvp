(() => {
  if (window.top !== window) return;
  if (!/^https?:$/i.test(location.protocol)) return;
  if (document.getElementById("dock-floating-launcher-host")) return;

  const POSITION_KEY = "dockLauncherPosition";
  const DRAG_THRESHOLD = 5;
  const EDGE_GAP = 12;

  const host = document.createElement("div");
  host.id = "dock-floating-launcher-host";
  host.style.cssText = [
    "all:initial",
    "position:fixed",
    "right:24px",
    "bottom:24px",
    "width:60px",
    "height:60px",
    "z-index:2147483646",
    "pointer-events:auto"
  ].join(";");

  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `
    <style>
      :host { all: initial; }
      button {
        all: unset;
        box-sizing: border-box;
        width: 60px;
        height: 60px;
        border-radius: 999px;
        display: grid;
        place-items: center;
        padding: 0;
        cursor: grab;
        user-select: none;
        touch-action: none;
        background: rgba(238, 231, 219, .97);
        border: 1px solid rgba(92, 76, 58, .12);
        box-shadow: 0 12px 30px rgba(55, 45, 35, .18), inset 0 1px 0 rgba(255,255,255,.72);
        transition: transform .15s ease, box-shadow .15s ease, opacity .15s ease;
      }
      button:hover {
        transform: translateY(-2px) scale(1.025);
        box-shadow: 0 16px 34px rgba(55, 45, 35, .22), inset 0 1px 0 rgba(255,255,255,.78);
      }
      button:focus-visible {
        outline: 3px solid rgba(47, 111, 149, .72);
        outline-offset: 3px;
      }
      button.dragging {
        cursor: grabbing;
        transform: scale(1.035);
        transition: none;
      }
      button.opening {
        opacity: .68;
        pointer-events: none;
      }
      img {
        width: 47px;
        height: 47px;
        display: block;
        object-fit: contain;
        pointer-events: none;
        user-select: none;
      }
      .toast {
        position: absolute;
        right: 0;
        bottom: 72px;
        width: max-content;
        max-width: min(320px, calc(100vw - 32px));
        box-sizing: border-box;
        border-radius: 12px;
        padding: 9px 11px;
        background: rgba(46, 42, 37, .94);
        color: #fff;
        box-shadow: 0 12px 28px rgba(0,0,0,.22);
        font: 600 12px/1.35 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      @media (prefers-reduced-motion: reduce) {
        button { transition: none; }
      }
    </style>
    <button type="button" title="Open Dock — drag to move" aria-label="Open Dock popup. Drag to move.">
      <img alt="" />
    </button>
  `;

  const button = root.querySelector("button");
  const image = root.querySelector("img");
  image.src = chrome.runtime.getURL("assets/dock_logo_clean.png");

  let dragState = null;
  let suppressClick = false;
  let toastTimer = null;
  let captureHidden = false;
  let focusHidden = !document.hasFocus();

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), Math.max(min, max));
  }

  function bounds() {
    return {
      maxLeft: Math.max(EDGE_GAP, window.innerWidth - 60 - EDGE_GAP),
      maxTop: Math.max(EDGE_GAP, window.innerHeight - 60 - EDGE_GAP)
    };
  }

  function applyPosition(position) {
    if (!position || !Number.isFinite(position.left) || !Number.isFinite(position.top)) return;
    const limit = bounds();
    host.style.left = `${clamp(position.left, EDGE_GAP, limit.maxLeft)}px`;
    host.style.top = `${clamp(position.top, EDGE_GAP, limit.maxTop)}px`;
    host.style.right = "auto";
    host.style.bottom = "auto";
  }

  async function loadPosition() {
    try {
      const stored = await chrome.storage.local.get([POSITION_KEY]);
      applyPosition(stored?.[POSITION_KEY]);
    } catch {}
  }

  async function savePosition() {
    const rect = host.getBoundingClientRect();
    try {
      await chrome.storage.local.set({
        [POSITION_KEY]: { left: Math.round(rect.left), top: Math.round(rect.top) }
      });
    } catch {}
  }

  function renderVisibility() {
    const hidden = captureHidden || focusHidden;
    host.style.visibility = hidden ? "hidden" : "visible";
    host.style.pointerEvents = hidden ? "none" : "auto";
  }

  function setCaptureHidden(hidden) {
    captureHidden = !!hidden;
    renderVisibility();
  }

  function showError(message) {
    root.querySelector(".toast")?.remove();
    if (toastTimer) clearTimeout(toastTimer);
    const toast = document.createElement("div");
    toast.className = "toast";
    toast.textContent = message;
    root.appendChild(toast);
    toastTimer = setTimeout(() => toast.remove(), 2600);
  }

  async function openDock() {
    button.classList.add("opening");
    try {
      const result = await chrome.runtime.sendMessage({ type: "OPEN_DOCK_POPUP" });
      if (!result?.ok) throw new Error(result?.code || "POPUP_OPEN_FAILED");
    } catch {
      showError("Dock couldn’t open here. Use the Dock toolbar icon instead.");
    } finally {
      button.classList.remove("opening");
    }
  }

  function beginDrag(event) {
    if (event.button !== 0) return;
    const rect = host.getBoundingClientRect();
    dragState = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startLeft: rect.left,
      startTop: rect.top,
      moved: false
    };
    button.setPointerCapture?.(event.pointerId);
  }

  function moveDrag(event) {
    if (!dragState || event.pointerId !== dragState.pointerId) return;
    const dx = event.clientX - dragState.startX;
    const dy = event.clientY - dragState.startY;
    if (!dragState.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    dragState.moved = true;
    suppressClick = true;
    button.classList.add("dragging");
    const limit = bounds();
    host.style.left = `${clamp(dragState.startLeft + dx, EDGE_GAP, limit.maxLeft)}px`;
    host.style.top = `${clamp(dragState.startTop + dy, EDGE_GAP, limit.maxTop)}px`;
    host.style.right = "auto";
    host.style.bottom = "auto";
  }

  async function endDrag(event) {
    if (!dragState || event.pointerId !== dragState.pointerId) return;
    const moved = dragState.moved;
    try { button.releasePointerCapture?.(event.pointerId); } catch {}
    button.classList.remove("dragging");
    dragState = null;
    if (moved) {
      await savePosition();
      setTimeout(() => { suppressClick = false; }, 0);
    }
  }

  button.addEventListener("pointerdown", beginDrag);
  button.addEventListener("pointermove", moveDrag);
  button.addEventListener("pointerup", endDrag);
  button.addEventListener("pointercancel", endDrag);
  button.addEventListener("click", (event) => {
    if (suppressClick) {
      event.preventDefault();
      return;
    }
    openDock();
  });
  button.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openDock();
    }
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "SET_DOCK_LAUNCHER_CAPTURE_HIDDEN") return;
    const hidden = !!message.hidden;
    setCaptureHidden(hidden);
    sendResponse({ ok: true, hidden });
  });

  window.addEventListener("blur", () => {
    focusHidden = true;
    renderVisibility();
  });
  window.addEventListener("focus", () => {
    focusHidden = false;
    renderVisibility();
  });
  window.addEventListener("resize", () => {
    const rect = host.getBoundingClientRect();
    applyPosition({ left: rect.left, top: rect.top });
  });

  (document.documentElement || document.body).appendChild(host);
  renderVisibility();
  loadPosition();
})();
