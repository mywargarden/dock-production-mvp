import { api } from "./adapters/index.js";
import { previewStorageKey } from "./core/previewPayloadStore.js";

const memoryByUrl = new Map();
const resolvedPayloads = new Map();
let savedTabsList = [];
let groupItemsById = {};
let metadataLoaded = false;
let metadataPromise = null;
let primedPayloads = false;
let primePromise = null;
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

function inlinePreview(item) {
  const fields = [
    "screenshotThumb",
    "screenshot",
    "screenshot_data_url",
    "screenshotDataUrl",
    "screenshotDataURI",
    "previewImage",
    "previewUrl",
    "thumbnail",
    "image"
  ];
  for (const field of fields) {
    const value = norm(item?.[field]);
    if (/^data:image\//i.test(value)) return value;
  }
  return "";
}

function remotePreview(item) {
  const fields = [
    "screenshot_url",
    "screenshotUrl",
    "previewImage",
    "previewUrl",
    "thumbnail",
    "image"
  ];
  for (const field of fields) {
    const value = norm(item?.[field]);
    if (/^https?:\/\//i.test(value)) return value;
  }
  return "";
}

function addMemory(item) {
  if (!item || typeof item !== "object") return;
  const key = normalizeUrl(item.url || item.local_id || "");
  if (key) memoryByUrl.set(key, item);
}

function allItems() {
  const out = [...savedTabsList];
  Object.values(groupItemsById).forEach((items) => {
    if (Array.isArray(items)) out.push(...items);
  });
  return out;
}

async function primePayloadCache() {
  if (primedPayloads) return;
  if (primePromise) return primePromise;

  primePromise = (async () => {
    const refs = [...new Set(allItems().map((item) => norm(item?.previewRef)).filter(Boolean))];
    const keys = refs.map(previewStorageKey).filter(Boolean);
    if (!keys.length) {
      primedPayloads = true;
      return;
    }

    const stored = await api.storage.local.get(keys);
    refs.forEach((ref) => {
      const key = previewStorageKey(ref);
      const value = norm(stored?.[key]);
      if (/^data:image\//i.test(value)) resolvedPayloads.set(ref, value);
    });
    primedPayloads = true;
  })();

  try { await primePromise; }
  finally { primePromise = null; }
}

async function loadMetadata() {
  if (metadataLoaded) {
    await primePayloadCache();
    return;
  }
  if (metadataPromise) return metadataPromise;

  metadataPromise = (async () => {
    const stored = await api.storage.local.get(["savedTabs", "dockGroupItems"]);
    savedTabsList = Array.isArray(stored.savedTabs) ? stored.savedTabs : [];
    groupItemsById = stored.dockGroupItems && typeof stored.dockGroupItems === "object"
      ? stored.dockGroupItems
      : {};

    memoryByUrl.clear();
    savedTabsList.forEach(addMemory);
    Object.values(groupItemsById).forEach((items) => {
      if (Array.isArray(items)) items.forEach(addMemory);
    });

    metadataLoaded = true;
    primedPayloads = false;
    await primePayloadCache();
  })();

  try { await metadataPromise; }
  finally { metadataPromise = null; }
}

async function payloadForRef(ref) {
  const clean = norm(ref);
  if (!clean) return "";
  if (resolvedPayloads.has(clean)) return resolvedPayloads.get(clean);
  if (inflightPayloads.has(clean)) return inflightPayloads.get(clean);

  const promise = (async () => {
    const key = previewStorageKey(clean);
    if (!key) return "";
    const stored = await api.storage.local.get([key]);
    const value = norm(stored?.[key]);
    const payload = /^data:image\//i.test(value) ? value : "";
    if (payload) resolvedPayloads.set(clean, payload);
    return payload;
  })();

  inflightPayloads.set(clean, promise);
  try { return await promise; }
  finally { inflightPayloads.delete(clean); }
}

function popupItemForCard(card) {
  if (!card?.classList?.contains("tabItem")) return null;
  const list = document.getElementById("tabList");
  if (!list) return null;
  const cards = Array.from(list.children).filter((node) => node instanceof Element && node.classList.contains("tabItem"));
  const index = cards.indexOf(card);
  if (index < 0) return null;

  const workspaceId = String(document.getElementById("workspaceSelect")?.value || "__all__");
  const source = !workspaceId || workspaceId === "__all__"
    ? savedTabsList
    : (Array.isArray(groupItemsById?.[workspaceId]) ? groupItemsById[workspaceId] : []);
  return source[index] || null;
}

function itemForCard(card) {
  const popupItem = popupItemForCard(card);
  if (popupItem) return popupItem;

  const link = card.querySelector("a[href]");
  const href = normalizeUrl(link?.href || card.dataset?.url || "");
  return href ? memoryByUrl.get(href) || null : null;
}

function paintLocal(img, payload) {
  img.loading = "eager";
  img.decoding = "async";
  try { img.fetchPriority = "high"; } catch {}
  img.src = payload;
}

async function hydrateCard(card) {
  if (!(card instanceof Element) || card.dataset.dockPreviewResolved === "1") return;
  const img = card.querySelector(".preview img, .thumb img, img");
  if (!(img instanceof HTMLImageElement)) return;

  await loadMetadata().catch(() => {});
  const item = itemForCard(card);
  if (!item) return;

  const ref = norm(item.previewRef);
  if (ref) {
    card.dataset.dockPreviewResolved = "1";
    const payload = resolvedPayloads.get(ref) || await payloadForRef(ref).catch(() => "");
    if (payload) {
      paintLocal(img, payload);
      return;
    }
    delete card.dataset.dockPreviewResolved;
  }

  const inline = inlinePreview(item);
  if (inline) {
    paintLocal(img, inline);
    card.dataset.dockPreviewResolved = "1";
    return;
  }

  const remote = remotePreview(item);
  if (remote) {
    img.loading = "lazy";
    img.decoding = "async";
    img.src = remote;
    card.dataset.dockPreviewResolved = "1";
  }
}

function visibleCards(root) {
  if (!root) return [];
  return Array.from(root.querySelectorAll(".card, .tabItem"));
}

function scheduleCards(root) {
  const cards = visibleCards(root);
  const immediate = cards.slice(0, 18);
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

function installWhenAvailable(id) {
  const existing = document.getElementById(id);
  if (existing) {
    install(existing);
    return;
  }

  const observer = new MutationObserver(() => {
    const root = document.getElementById(id);
    if (!root) return;
    observer.disconnect();
    install(root);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
}

function resetCards() {
  document.querySelectorAll("[data-dock-preview-resolved]").forEach((card) => {
    delete card.dataset.dockPreviewResolved;
  });
}

function boot() {
  api.runtime.sendMessage({ type: "MIGRATE_DOCK_PREVIEW_PAYLOADS" }).catch?.(() => {});
  loadMetadata().catch(() => {});
  installWhenAvailable("grid");
  installWhenAvailable("tabList");
}

boot();

if (api.storage?.onChanged?.addListener) {
  api.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;

    if (changes?.savedTabs || changes?.dockGroupItems) {
      metadataLoaded = false;
      primedPayloads = false;
      savedTabsList = [];
      groupItemsById = {};
      memoryByUrl.clear();
      resetCards();
      loadMetadata().then(() => {
        scheduleCards(document.getElementById("grid"));
        scheduleCards(document.getElementById("tabList"));
      }).catch(() => {});
      return;
    }

    for (const [key, change] of Object.entries(changes || {})) {
      if (!key.startsWith("dockPreviewPayload:v1:")) continue;
      const ref = key.slice("dockPreviewPayload:v1:".length);
      const value = norm(change?.newValue);
      if (/^data:image\//i.test(value)) resolvedPayloads.set(ref, value);
    }
  });
}
