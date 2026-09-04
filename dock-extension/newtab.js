const POSITION_KEY = "dockLauncherPosition";
const DRAG_THRESHOLD = 5;
const EDGE_GAP = 12;

const launcher = document.getElementById("dockLauncher");
const searchForm = document.getElementById("searchForm");
const searchInput = document.getElementById("searchInput");

let dragState = null;
let suppressClick = false;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function viewportBounds() {
  const rect = launcher.getBoundingClientRect();
  return {
    maxLeft: Math.max(EDGE_GAP, window.innerWidth - rect.width - EDGE_GAP),
    maxTop: Math.max(EDGE_GAP, window.innerHeight - rect.height - EDGE_GAP)
  };
}

function applyPosition(position) {
  if (!launcher || !position || !Number.isFinite(position.left) || !Number.isFinite(position.top)) return;
  const bounds = viewportBounds();
  launcher.style.left = `${clamp(position.left, EDGE_GAP, bounds.maxLeft)}px`;
  launcher.style.top = `${clamp(position.top, EDGE_GAP, bounds.maxTop)}px`;
  launcher.style.right = "auto";
  launcher.style.bottom = "auto";
}

async function loadPosition() {
  try {
    const stored = await chrome.storage.local.get([POSITION_KEY]);
    applyPosition(stored?.[POSITION_KEY]);
  } catch {}
}

async function savePosition() {
  if (!launcher) return;
  const rect = launcher.getBoundingClientRect();
  try {
    await chrome.storage.local.set({
      [POSITION_KEY]: { left: Math.round(rect.left), top: Math.round(rect.top) }
    });
  } catch {}
}

async function openDockPopup() {
  if (!launcher) return;
  launcher.classList.add("isOpening");
  try {
    const result = await chrome.runtime.sendMessage({ type: "OPEN_DOCK_POPUP" });
    if (!result?.ok) throw new Error(result?.code || "POPUP_OPEN_FAILED");
  } catch {
    launcher.classList.remove("isOpening");
    return;
  }
  launcher.classList.remove("isOpening");
}

function beginDrag(event) {
  if (!launcher || event.button !== 0) return;
  const rect = launcher.getBoundingClientRect();
  dragState = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    startLeft: rect.left,
    startTop: rect.top,
    moved: false
  };
  launcher.setPointerCapture?.(event.pointerId);
}

function moveDrag(event) {
  if (!launcher || !dragState || event.pointerId !== dragState.pointerId) return;
  const dx = event.clientX - dragState.startX;
  const dy = event.clientY - dragState.startY;
  if (!dragState.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;

  dragState.moved = true;
  suppressClick = true;
  launcher.classList.add("isDragging");

  const bounds = viewportBounds();
  launcher.style.left = `${clamp(dragState.startLeft + dx, EDGE_GAP, bounds.maxLeft)}px`;
  launcher.style.top = `${clamp(dragState.startTop + dy, EDGE_GAP, bounds.maxTop)}px`;
  launcher.style.right = "auto";
  launcher.style.bottom = "auto";
}

async function endDrag(event) {
  if (!launcher || !dragState || event.pointerId !== dragState.pointerId) return;
  const moved = dragState.moved;
  try { launcher.releasePointerCapture?.(event.pointerId); } catch {}
  launcher.classList.remove("isDragging");
  dragState = null;
  if (moved) {
    await savePosition();
    setTimeout(() => { suppressClick = false; }, 0);
  }
}

function resolveNavigation(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) return raw;
  if (/^(localhost|\d{1,3}(?:\.\d{1,3}){3})(:\d+)?(?:\/|$)/i.test(raw)) return `http://${raw}`;
  if (/^[^\s]+\.[^\s]+(?:\/.*)?$/i.test(raw)) return `https://${raw}`;
  return `https://www.google.com/search?q=${encodeURIComponent(raw)}`;
}

launcher?.addEventListener("pointerdown", beginDrag);
launcher?.addEventListener("pointermove", moveDrag);
launcher?.addEventListener("pointerup", endDrag);
launcher?.addEventListener("pointercancel", endDrag);
launcher?.addEventListener("click", (event) => {
  if (suppressClick) {
    event.preventDefault();
    return;
  }
  openDockPopup();
});
launcher?.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    openDockPopup();
  }
});

searchForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  const target = resolveNavigation(searchInput?.value);
  if (target) window.location.href = target;
});

window.addEventListener("resize", () => {
  if (!launcher) return;
  const rect = launcher.getBoundingClientRect();
  applyPosition({ left: rect.left, top: rect.top });
});

await loadPosition();
searchInput?.focus();
