import { api } from "./adapters/index.js";
import { getAdminWorkspace, saveAdminWorkspace, loadGroupState, saveGroupState } from "./core/storage.js";

const workspaceName = document.getElementById("workspaceName");
const tabGrid = document.getElementById("tabGrid");
const saveBtn = document.getElementById("saveBtn");
const clearBtn = document.getElementById("clearBtn");
const backBtn = document.getElementById("backBtn");
const status = document.getElementById("status");

function escapeAttr(value) {
  return String(value || "").replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function makeRow(i, tab = {}) {
  const wrap = document.createElement("div");
  wrap.className = "tabCard";
  wrap.innerHTML = `
    <h3>Tab ${i + 1}</h3>
    <input data-kind="title" placeholder="Tab title (optional)" value="${escapeAttr(tab.title || "")}" />
    <input data-kind="url" placeholder="https://example.com" value="${escapeAttr(tab.url || "")}" />
    <div class="iconTools">
      <div class="iconPreviewWrap">
        <div class="iconPreview ${tab.customIcon ? "hasImage" : ""}" data-role="preview">
          ${tab.customIcon ? `<img src="${tab.customIcon}" alt="Custom icon preview" />` : `<img src="assets/dock_logo.png" alt="Dock logo preview" class="logoPlaceholder" />`}
        </div>
      </div>
      <div class="iconControls">
        <div class="buttonRow">
          <button type="button" class="uploadBtn" data-role="uploadBtn">Upload Icon</button>
          <button type="button" class="secondaryBtn clearIconBtn" data-role="clearBtn">Clear Icon</button>
        </div>
        <label class="dropZone" data-role="dropZone">
          <input type="file" accept="image/*" hidden data-role="fileInput" />
          <span class="dropZoneTitle">Drag & drop icon here</span>
          <span class="dropZoneSub">or click Upload Icon</span>
        </label>
        <p class="iconHint" data-role="iconHint">${tab.customIcon ? "Custom icon ready. Dock will use it for this district tab." : "No custom icon uploaded. Dock will use favicon, then clean fallback."}</p>
      </div>
    </div>
  `;
  wrap.dataset.customIcon = tab.customIcon || "";
  bindIconRow(wrap);
  return wrap;
}

function setPreview(card, dataUrl) {
  const preview = card.querySelector('[data-role="preview"]');
  const hint = card.querySelector('[data-role="iconHint"]');
  card.dataset.customIcon = dataUrl || "";

  if (dataUrl) {
    preview.classList.add("hasImage");
    preview.innerHTML = `<img src="${dataUrl}" alt="Custom icon preview" />`;
    hint.textContent = "Custom icon ready. Dock will use it for this district tab.";
  } else {
    preview.classList.remove("hasImage");
    preview.innerHTML = `<img src="assets/dock_logo.png" alt="Dock logo preview" class="logoPlaceholder" />`;
    hint.textContent = "No custom icon uploaded. Dock will use favicon, then clean fallback.";
  }
}

function handleFile(card, file) {
  if (!file || !file.type.startsWith("image/")) {
    status.textContent = "Please use a PNG, JPG, WEBP, or other image file for the icon.";
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    setPreview(card, String(reader.result || ""));
    status.textContent = "Icon loaded. Save Admin Workspace to apply changes.";
  };
  reader.readAsDataURL(file);
}

function bindIconRow(card) {
  const uploadBtn = card.querySelector('[data-role="uploadBtn"]');
  const clearBtn = card.querySelector('[data-role="clearBtn"]');
  const fileInput = card.querySelector('[data-role="fileInput"]');
  const dropZone = card.querySelector('[data-role="dropZone"]');

  uploadBtn?.addEventListener("click", () => fileInput?.click());

  fileInput?.addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (file) handleFile(card, file);
    e.target.value = "";
  });

  clearBtn?.addEventListener("click", () => {
    setPreview(card, "");
    status.textContent = "Custom icon cleared. Save Admin Workspace to apply changes.";
  });

  ["dragenter", "dragover"].forEach(evt => {
    dropZone?.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.add("isDragOver");
    });
  });

  ["dragleave", "dragend", "drop"].forEach(evt => {
    dropZone?.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (evt !== "drop") dropZone.classList.remove("isDragOver");
    });
  });

  dropZone?.addEventListener("drop", (e) => {
    dropZone.classList.remove("isDragOver");
    const file = e.dataTransfer?.files?.[0];
    if (file) handleFile(card, file);
  });
}

function renderTabs(tabs = []) {
  tabGrid.innerHTML = "";
  for (let i = 0; i < 10; i++) {
    tabGrid.appendChild(makeRow(i, tabs[i] || {}));
  }
}

function readTabs() {
  const cards = [...tabGrid.querySelectorAll(".tabCard")];
  return cards.map(card => {
    const title = card.querySelector('[data-kind="title"]').value.trim();
    const url = card.querySelector('[data-kind="url"]').value.trim();
    const customIcon = (card.dataset.customIcon || "").trim();
    return { title, url, customIcon };
  }).filter(t => t.url);
}

async function load() {
  const ws = await getAdminWorkspace();
  workspaceName.value = ws?.name || "District Workspace";
  renderTabs(ws?.tabs || []);
}

saveBtn?.addEventListener("click", async () => {
  const tabs = readTabs();
  if (!tabs.length) {
    status.textContent = "Add at least one tab URL.";
    return;
  }
  const normalized = tabs.map(t => ({
    title: t.title || t.url.replace(/^https?:\/\//, "").split("/")[0],
    url: t.url.startsWith("http://") || t.url.startsWith("https://") ? t.url : `https://${t.url}`,
    customIcon: t.customIcon || ""
  }));
  await saveAdminWorkspace({
    name: workspaceName.value.trim() || "District Workspace",
    locked: true,
    tabs: normalized,
    updatedAt: Date.now()
  });
  const st = await loadGroupState();
  await saveGroupState({ groups: st.groups, groupItems: st.groupItems, activeGroup: "__admin__" });
  status.textContent = `Saved admin workspace with ${normalized.length} tab${normalized.length === 1 ? "" : "s"}. Opening District Workspace…`;
  setTimeout(() => {
    window.location.href = api.runtime.getURL("memories.html");
  }, 250);
});

clearBtn?.addEventListener("click", async () => {
  const ok = confirm("Clear the admin workspace prototype?");
  if (!ok) return;
  await saveAdminWorkspace(null);
  await load();
  status.textContent = "Admin workspace cleared.";
});

backBtn?.addEventListener("click", () => {
  api.tabs.create({ url: api.runtime.getURL("memories.html") });
});

load();
