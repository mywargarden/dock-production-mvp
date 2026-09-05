import { api } from "./adapters/index.js";
import { previewStorageKey } from "./core/previewPayloadStore.js";

const PLACEHOLDER = "assets/screenshot-unavailable.webp";
const memoryByUrl = new Map();
let metadataLoaded = false;
let metadataPromise = null;
const inflightPayloads = new Map();

function norm(value) {
  return String(value == null ? "" : value).trim();
}

function normalizeUrl(value) {
  const raw = norm(value);
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    parsed.hash = "";
    if (parsed.pathname !== "/") parsed.pathname = parsed.pathname.replace(/\/+$/, "");
    return parsed.toString();
  } catch {
    return raw;
  }
}

function directPreview(item) {
  const fields = [
    "screenshot_url",
    "screenshotUrl",
    "screenshotThumb",
    "screenshot",
    "screenshot_data_url",
    "customIcon",
    "icon_url",
    "previewImage",
    "previewUrl",
    "thumbnail",
    "image"
  ];
  for (const field of fields) {
    const value = norm(item?.[field]);
    if (/^(?:https?:\/\/|data:image\/)/i.test(value)) return value;
  }
  return "";
}

function addMemory(item) {
  if (!item || typeof item !== "object") return;
  const key = normalizeUrl(item.url || item.local_id || "");
  if (key) memoryByUrl.set(key, item);
}

async function loadMetadata() {
  if (metadataLoaded) return;
  if (metadataPromise) return metadataPromise;
  metadataPromise = (async () => {
    const stored = await api.storage.local.get(["savedTabs", "dockGroupItems"]);
    (Array.isArray(stored.savedTabs) ? stored.savedTabs : []).forEach(addMemory);
    const groups = stored.dockGroupItems;
    if (groups && typeof groups === "object") {
      Object.values(groups).forEach((items) => {
        if (Array.isArray(items)) items.forEach(addMemory);
      });
    }
    metadataLoaded = true;
  })();
  try { await metadataPromise; }
  finally { metadataPromise = null; }
}

async function payloadForRef(ref) {
  const clean = norm(ref);
  if (!clean) return "";
  if (inflightPayloads.has(clean)) return inflightPayloads.get(clean);

  const promise = (async () => {
    const key = previewStorageKey(clean);
    if (!key) return "";
    const stored = await api.storage.local.get([key]);
    const value = norm(stored?.[key]);
    return /^data:image\//i.test(value) ? value : "";
  })();

  inflightPayloads.set(clean, promise);
  try { return await promise; }
  finally { inflightPayloads.delete(clean); }
}

function itemForCard(card) {
  const link = card.querySelector("a[href]");
  const href = normalizeUrl(link?.href || card.dataset?.url || "");
  return href ? memoryByUrl.get(href) || null : null;
}

async function hydrateCard(card) {
  if (!(card instanceof Element) || card.dataset.dockPreviewResolved === "1") return;
  const img = card.querySelector(".preview img, .thumb img, img");
  if (!(img instanceof HTMLImageElement)) return;

  await loadMetadata().catch(() => {});
  const item = itemForCard(card);
  if (!item) return;

  const direct = directPreview(item);
  if (direct) {
    img.loading = "eager";
    img.decoding = "async";
    img.src = direct;
    card.dataset.dockPreviewResolved = "1";
    return;
  }

  const ref = norm(item.previewRef);
  if (!ref) return;

  // Mark before awaiting so repeated mutations do not queue duplicate reads.
  card.dataset.dockPreviewResolved = "1";
  const payload = await payloadForRef(ref).catch(() => "");
  if (!payload) return;

  img.loading = "eager";
  img.decoding = "async";
  img.src = payload;
}

function visibleCards(root) {
  if (!root) return [];
  return Array.from(root.querySelectorAll(".card, .tabItem"));
}

function scheduleCards(root) {
  const cards = visibleCards(root);
  const immediate = cards.slice(0, 12);
  immediate.forEach((card) => hydrateCard(card).catch(() => {}));
  if (cards.length > immediate.length) {
    requestAnimationFrame(() => {
      cards.slice(immediate.length).forEach((card) => hydrateCard(card).catch(() => {}));
    });
  }
}

function install(root) {
  if (!root) return;
  scheduleCards(root);
  const observer = new MutationObserver(() => scheduleCards(root));
  observer.observe(root, { childList: true, subtree: true });
}

function boot() {
  loadMetadata().catch(() => {});
  install(document.getElementById("grid"));
  install(document.getElementById("tabList"));
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
  boot();
}

if (api.storage?.onChanged?.addListener) {
  api.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;
    if (changes?.savedTabs || changes?.dockGroupItems) {
      metadataLoaded = false;
      memoryByUrl.clear();
      loadMetadata().then(() => {
        scheduleCards(document.getElementById("grid"));
        scheduleCards(document.getElementById("tabList"));
      }).catch(() => {});
    }
  });
}
