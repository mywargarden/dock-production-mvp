const POSITION_KEY = "dockLauncherPosition";
const PIN_HINT_DISMISSED_KEY = "dockPinHintDismissed";
const DRAG_THRESHOLD = 5;
const EDGE_GAP = 12;

const launcher = document.getElementById("dockLauncher");
const pinHint = document.getElementById("dockLauncherHint");
const pinHintDismiss = document.getElementById("dockHintDismiss");
const pinHintOk = document.getElementById("dockHintOk");

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
  const left = clamp(position.left, EDGE_GAP, bounds.maxLeft);
  const top = clamp(position.top, EDGE_GAP, bounds.maxTop);
  launcher.style.left = `${left}px`;
  launcher.style.top = `${top}px`;
  launcher.style.right = "auto";
  launcher.style.bottom = "auto";
}

async function loadPosition() {
  if (!launcher) return;
  try {
    const stored = await chrome.storage.local.get([POSITION_KEY]);
    applyPosition(stored[POSITION_KEY]);
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

function showTemporaryError(message) {
  document.querySelector(".dockLauncherError")?.remove();
  const el = document.createElement("div");
  el.className = "dockLauncherError";
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}

async function openDockPopup() {
  if (!launcher) return;
  launcher.classList.add("isOpening");
  try {
    if (!chrome.action?.openPopup) throw new Error("POPUP_API_UNAVAILABLE");
    await chrome.action.openPopup();
  } catch {
    showTemporaryError("Dock could not open the popup here. Use the Dock toolbar icon instead.");
  } finally {
    launcher.classList.remove("isOpening");
  }
}

async function dismissPinHint() {
  pinHint?.classList.add("hidden");
  try { await chrome.storage.local.set({ [PIN_HINT_DISMISSED_KEY]: true }); } catch {}
}

async function maybeShowPinHint() {
  if (!pinHint || !chrome.action?.getUserSettings) return;
  try {
    const [stored, settings] = await Promise.all([
      chrome.storage.local.get([PIN_HINT_DISMISSED_KEY]),
      chrome.action.getUserSettings()
    ]);
    if (stored[PIN_HINT_DISMISSED_KEY] === true || settings?.isOnToolbar === true) return;
    pinHint.classList.remove("hidden");
  } catch {}
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
  const left = clamp(dragState.startLeft + dx, EDGE_GAP, bounds.maxLeft);
  const top = clamp(dragState.startTop + dy, EDGE_GAP, bounds.maxTop);
  launcher.style.left = `${left}px`;
  launcher.style.top = `${top}px`;
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

pinHintDismiss?.addEventListener("click", dismissPinHint);
pinHintOk?.addEventListener("click", dismissPinHint);

window.addEventListener("resize", () => {
  if (!launcher) return;
  const rect = launcher.getBoundingClientRect();
  applyPosition({ left: rect.left, top: rect.top });
});

await loadPosition();
await maybeShowPinHint();
