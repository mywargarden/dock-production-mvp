const api = (typeof browser !== "undefined" && browser?.storage?.local) ? browser : chrome;

const GLOBAL_THEME_KEY = "dockTheme";
const GROUPS_KEY = "dockGroups";
const ACTIVE_GROUP_KEY = "dockActiveGroup";
const THEME_MAP_KEY = "dockGroupThemes";
const DEFAULT_THEME = "dock-green";
const EFFECTIVE_THEME_MIRROR = "dockEffectiveThemeCurrent";
const EFFECTIVE_GROUP_MIRROR = "dockEffectiveThemeGroupId";

const THEMES = [
  ["dock-green", "Dock Default", "assets/dock-default-center.webp"],
  ["skipper-harbor", "Skipper", "assets/skipper-harbor.webp"],
  ["sunset", "Beach Sunset", "assets/dock-sunset.webp"],
  ["warm", "Sand Castle", "assets/sand-dunes.svg"],
  ["smiley-pop", "Smileys", "assets/smileys-3d.svg"],
  ["violet-harbor", "Grape Tide", "assets/grape-tide.webp"],
  ["tie-dye", "Tie Dye", "assets/tie-dye-bg.webp"],
  ["rubber-ducky", "Rubber Ducky", "assets/rubber-ducky-theme.webp"],
  ["crazy-ducky", "Cozy Quilt", "assets/cozy-quilt.webp"]
];

const THEME_IDS = new Set(THEMES.map(([id]) => id));
const SCENES = {
  sunset: "assets/dock-sunset-hd.png",
  "tie-dye": "assets/tie-dye-bg.webp",
  "rubber-ducky": "assets/rubber-ducky-theme.webp",
  "crazy-ducky": "assets/cozy-quilt.webp",
  "skipper-harbor": "assets/skipper-harbor-hd.png",
  "violet-harbor": "assets/grape-tide.webp",
  "smiley-pop": "assets/smileys-3d.webp",
  warm: "assets/sand-castle-theme.webp"
};

let picker = null;
let pickerGroupId = "";
let pickerAnchor = null;
let syncTimer = null;
let lastEffectiveState = null;
let repairQueued = false;

const norm = (value) => String(value == null ? "" : value).trim();
const normalizeTheme = (value) => THEME_IDS.has(norm(value)) ? norm(value) : DEFAULT_THEME;
const normalizeActiveGroup = (value) => norm(value) || "__all__";

async function readRawState() {
  const stored = await api.storage.local.get([GLOBAL_THEME_KEY, GROUPS_KEY, ACTIVE_GROUP_KEY, THEME_MAP_KEY]);
  return {
    groups: Array.isArray(stored?.[GROUPS_KEY]) ? stored[GROUPS_KEY] : [],
    groupThemes: stored?.[THEME_MAP_KEY] && typeof stored[THEME_MAP_KEY] === "object" && !Array.isArray(stored[THEME_MAP_KEY])
      ? stored[THEME_MAP_KEY]
      : {},
    globalTheme: normalizeTheme(stored?.[GLOBAL_THEME_KEY] || DEFAULT_THEME),
    activeGroup: normalizeActiveGroup(stored?.[ACTIVE_GROUP_KEY])
  };
}

function buildState(raw, requestedGroupId = raw.activeGroup) {
  const activeGroup = normalizeActiveGroup(requestedGroupId);
  const group = raw.groups.find((item) => norm(item?.id) === activeGroup) || null;
  const mappedTheme = norm(raw.groupThemes?.[activeGroup]);
  const explicitGroupTheme = group && THEME_IDS.has(mappedTheme) ? mappedTheme : "";

  const effectiveTheme = group
    ? (explicitGroupTheme || DEFAULT_THEME)
    : raw.globalTheme;

  return { ...raw, activeGroup, group, explicitGroupTheme, effectiveTheme };
}

function applyVisualTheme(theme, activeGroup) {
  const next = normalizeTheme(theme);
  if (!document.body) return;

  document.body.dataset.theme = next;
  document.body.dataset.dockThemeScope = normalizeActiveGroup(activeGroup);

  const scene = SCENES[next] || "";
  document.documentElement.style.setProperty("--dock-theme-scene", scene ? `url("${scene}")` : "none");
  document.documentElement.dataset.dockEffectiveTheme = next;

  try {
    localStorage.setItem(EFFECTIVE_THEME_MIRROR, next);
    localStorage.setItem(EFFECTIVE_GROUP_MIRROR, normalizeActiveGroup(activeGroup));
  } catch {}
}

async function applyEffectiveTheme(requestedGroupId = null) {
  try {
    const raw = await readRawState();
    const state = buildState(raw, requestedGroupId || raw.activeGroup);
    lastEffectiveState = state;
    applyVisualTheme(state.effectiveTheme, state.activeGroup);
    refreshPickerSelection(state);
    return state;
  } catch {
    return null;
  }
}

async function applyClickedDockTheme(groupId) {
  const raw = await readRawState();
  const state = buildState(raw, groupId);
  lastEffectiveState = state;
  applyVisualTheme(state.effectiveTheme, state.activeGroup);
  return state;
}

function scheduleThemeSync(delay = 0) {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    syncTimer = null;
    applyEffectiveTheme().catch(() => {});
  }, Math.max(0, delay));
}

function enforceOwnedDockTheme() {
  const state = lastEffectiveState;
  if (!state?.group || !document.body || repairQueued) return;
  if (document.body.dataset.theme === state.effectiveTheme) return;

  repairQueued = true;
  queueMicrotask(() => {
    repairQueued = false;
    const latest = lastEffectiveState;
    if (latest?.group && document.body?.dataset?.theme !== latest.effectiveTheme) {
      applyVisualTheme(latest.effectiveTheme, latest.activeGroup);
    }
  });
}

async function setDockTheme(groupId, themeValue) {
  const id = norm(groupId);
  if (!id || id === "__all__" || id === "__admin__") return false;

  const raw = await readRawState();
  if (!raw.groups.some((group) => norm(group?.id) === id)) return false;

  const next = { ...raw.groupThemes, [id]: normalizeTheme(themeValue) };
  await api.storage.local.set({ [THEME_MAP_KEY]: next });
  await applyClickedDockTheme(id);
  return true;
}

function injectStyles() {
  if (document.getElementById("dockGroupThemeStyles")) return;

  const style = document.createElement("style");
  style.id = "dockGroupThemeStyles";
  style.textContent = `
    .groupPillMenuItem.dockGroupThemeEntry{
      display:flex!important;align-items:center!important;justify-content:space-between!important;gap:14px!important
    }
    .dockThemeCaret{font-size:15px;opacity:.62;line-height:1}

    .dockGroupThemePopover{
      position:fixed;z-index:100300;width:min(390px,calc(100vw - 24px));padding:12px;
      border-radius:18px;border:1px solid rgba(255,255,255,.78);
      background:rgba(250,247,242,.985);box-shadow:0 24px 58px rgba(20,34,48,.24);
      color:#1f3445;box-sizing:border-box;backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px)
    }
    .dockGroupThemePopover.hidden{display:none!important}
    .dockGroupThemeHeader{
      display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin:0 2px 10px
    }
    .dockGroupThemeTitle{font-size:14px;line-height:1.15;font-weight:850;color:#17384a}
    .dockGroupThemeSub{
      margin-top:3px;font-size:11px;line-height:1.2;color:#6a7781;max-width:280px;
      overflow:hidden;text-overflow:ellipsis;white-space:nowrap
    }
    .dockGroupThemeClose{
      border:0;background:transparent;color:#687680;width:26px;height:26px;border-radius:999px;
      font-size:19px;line-height:1;cursor:pointer
    }
    .dockGroupThemeClose:hover{background:rgba(32,70,90,.08)}

    .dockGroupThemeGrid{
      display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px
    }
    .dockGroupThemeChoice{
      min-width:0;height:54px;display:flex;align-items:center;gap:9px;padding:6px 8px;
      border-radius:13px;border:1px solid rgba(40,71,88,.12);background:rgba(255,255,255,.94);
      color:#263d4d;font:inherit;font-size:12px;font-weight:800;text-align:left;cursor:pointer;
      box-shadow:inset 0 1px 0 rgba(255,255,255,.75);transition:border-color .12s ease,box-shadow .12s ease,transform .12s ease
    }
    .dockGroupThemeChoice:hover{
      border-color:rgba(40,116,148,.38);box-shadow:0 6px 16px rgba(26,65,86,.09);transform:translateY(-1px)
    }
    .dockGroupThemeChoice.isSelected{
      border-color:#2d8da8;box-shadow:0 0 0 2px rgba(45,141,168,.16),0 6px 16px rgba(26,65,86,.08);
      background:#f5fbfc
    }
    .dockGroupThemeThumb{
      width:58px;height:38px;flex:0 0 58px;border-radius:9px;border:1px solid rgba(15,32,45,.12);
      background-position:center;background-size:cover;background-repeat:no-repeat;
      box-shadow:inset 0 0 0 1px rgba(255,255,255,.28),0 2px 6px rgba(20,40,52,.10)
    }
    .dockGroupThemeChoiceText{
      min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;line-height:1.1
    }
    .dockGroupThemeCheck{
      width:18px;height:18px;flex:0 0 18px;display:grid;place-items:center;border-radius:999px;
      color:#fff;background:transparent;font-size:11px;font-weight:900
    }
    .dockGroupThemeChoice.isSelected .dockGroupThemeCheck{background:#2d8da8}

    @media(max-width:520px){
      .dockGroupThemePopover{width:min(342px,calc(100vw - 16px));padding:10px}
      .dockGroupThemeGrid{grid-template-columns:1fr}
      .dockGroupThemeChoice{height:50px}
      .dockGroupThemeThumb{width:64px;flex-basis:64px;height:36px}
    }
  `;
  document.head.appendChild(style);
}

function ensurePicker() {
  if (picker) return picker;

  picker = document.createElement("div");
  picker.className = "dockGroupThemePopover hidden";
  picker.setAttribute("role", "dialog");
  picker.setAttribute("aria-label", "Choose Dock theme");
  picker.innerHTML = `
    <div class="dockGroupThemeHeader">
      <div>
        <div class="dockGroupThemeTitle">Dock theme</div>
        <div class="dockGroupThemeSub" data-dock-theme-group-label></div>
      </div>
      <button class="dockGroupThemeClose" type="button" aria-label="Close theme picker">×</button>
    </div>
    <div class="dockGroupThemeGrid" data-dock-theme-grid></div>
  `;

  const grid = picker.querySelector("[data-dock-theme-grid]");
  for (const [id, label, thumbnail] of THEMES) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "dockGroupThemeChoice";
    btn.dataset.theme = id;
    btn.innerHTML = `
      <span class="dockGroupThemeThumb" aria-hidden="true"></span>
      <span class="dockGroupThemeChoiceText"></span>
      <span class="dockGroupThemeCheck"></span>
    `;
    btn.querySelector(".dockGroupThemeThumb").style.backgroundImage = `url("${thumbnail}")`;
    btn.querySelector(".dockGroupThemeChoiceText").textContent = label;
    grid.appendChild(btn);
  }

  picker.addEventListener("click", async (event) => {
    event.stopPropagation();
    if (event.target instanceof Element && event.target.closest(".dockGroupThemeClose")) {
      closePicker();
      return;
    }

    const choice = event.target instanceof Element
      ? event.target.closest(".dockGroupThemeChoice[data-theme]")
      : null;
    if (!choice || !pickerGroupId) return;

    choice.disabled = true;
    try {
      await setDockTheme(pickerGroupId, choice.dataset.theme || DEFAULT_THEME);
      closePicker();
      closeNativePillMenus();
    } finally {
      choice.disabled = false;
    }
  });

  document.body.appendChild(picker);
  return picker;
}

function closeNativePillMenus() {
  document.querySelectorAll(".groupPillMenu").forEach((menu) => {
    menu.classList.add("hidden");
    for (const prop of ["position","left","top","right","bottom","z-index","visibility"]) {
      menu.style.removeProperty(prop);
    }
    if (menu.__dockHome && menu.parentNode !== menu.__dockHome) menu.__dockHome.appendChild(menu);
  });
}

function closePicker() {
  if (!picker) return;
  picker.classList.add("hidden");
  pickerGroupId = "";
  pickerAnchor = null;
}

function positionPicker(anchor) {
  const panel = ensurePicker();
  if (!anchor || panel.classList.contains("hidden")) return;

  const pad = 12;
  const gap = 8;
  const a = anchor.getBoundingClientRect();
  const p = panel.getBoundingClientRect();

  let left = a.right + gap;
  if (left + p.width > innerWidth - pad) left = a.left - p.width - gap;
  left = Math.max(pad, Math.min(left, innerWidth - p.width - pad));

  let top = a.top;
  if (top + p.height > innerHeight - pad) top = Math.max(pad, innerHeight - p.height - pad);

  panel.style.left = `${Math.round(left)}px`;
  panel.style.top = `${Math.round(top)}px`;
}

async function refreshPickerSelection(preloadedState = null) {
  if (!picker || picker.classList.contains("hidden") || !pickerGroupId) return;

  const state = preloadedState || buildState(await readRawState(), pickerGroupId);
  const group = state.groups.find((item) => norm(item?.id) === pickerGroupId) || null;
  const selectedTheme = THEME_IDS.has(norm(state.groupThemes?.[pickerGroupId]))
    ? norm(state.groupThemes[pickerGroupId])
    : DEFAULT_THEME;

  const label = picker.querySelector("[data-dock-theme-group-label]");
  if (label) label.textContent = group?.name || "Dock";

  picker.querySelectorAll(".dockGroupThemeChoice[data-theme]").forEach((btn) => {
    const selected = btn.dataset.theme === selectedTheme;
    btn.classList.toggle("isSelected", selected);
    btn.setAttribute("aria-pressed", String(selected));
    const check = btn.querySelector(".dockGroupThemeCheck");
    if (check) check.textContent = selected ? "✓" : "";
  });
}

async function openPicker(groupId, anchor) {
  const id = norm(groupId);
  if (!id || id === "__all__" || id === "__admin__") return;

  pickerGroupId = id;
  pickerAnchor = anchor;
  ensurePicker().classList.remove("hidden");
  await refreshPickerSelection();
  positionPicker(anchor);
}

function addThemeEntryToMenu(wrap) {
  if (!(wrap instanceof Element)) return;
  const groupId = norm(wrap.dataset.groupId);
  if (!groupId || groupId === "__all__" || groupId === "__admin__") return;

  const menu = wrap.querySelector(".groupPillMenu");
  if (!menu || menu.querySelector("[data-dock-group-theme-entry]")) return;

  const entry = document.createElement("button");
  entry.type = "button";
  entry.className = "groupPillMenuItem dockGroupThemeEntry";
  entry.dataset.dockGroupThemeEntry = "1";
  entry.innerHTML = `<span>Theme</span><span class="dockThemeCaret">›</span>`;
  entry.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    await openPicker(groupId, entry);
  });

  const items = Array.from(menu.querySelectorAll(".groupPillMenuItem"));
  const share = items.find((item) => norm(item.textContent).toLowerCase() === "share");
  const danger = items.find((item) => item.classList.contains("dangerItem"));
  menu.insertBefore(entry, share || danger || null);
}

function enhancePillMenus() {
  document.querySelectorAll(".groupPillWrap.isDock").forEach(addThemeEntryToMenu);
}

function installObservers() {
  const rail = document.getElementById("groupPills");
  if (rail && typeof MutationObserver !== "undefined") {
    new MutationObserver(() => {
      enhancePillMenus();
      scheduleThemeSync(0);
    }).observe(rail, { childList: true, subtree: true });
  }

  if (document.body && typeof MutationObserver !== "undefined") {
    new MutationObserver(enforceOwnedDockTheme)
      .observe(document.body, { attributes: true, attributeFilter: ["data-theme"] });
  }

  document.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const pill = target?.closest(".groupPill");
    if (pill) {
      const id = norm(pill.closest(".groupPillWrap")?.dataset?.groupId);
      if (id) applyClickedDockTheme(id).catch(() => {});
      return;
    }

    if (picker && !picker.classList.contains("hidden") && !target?.closest(".dockGroupThemePopover")) {
      closePicker();
    }
  }, true);

  addEventListener("resize", () => {
    if (picker && !picker.classList.contains("hidden") && pickerAnchor) positionPicker(pickerAnchor);
  });
  addEventListener("scroll", () => {
    if (picker && !picker.classList.contains("hidden")) closePicker();
  }, true);

  if (api.storage?.onChanged?.addListener) {
    api.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== "local") return;
      if (changes?.[GLOBAL_THEME_KEY] || changes?.[GROUPS_KEY] || changes?.[ACTIVE_GROUP_KEY] || changes?.[THEME_MAP_KEY]) {
        scheduleThemeSync(0);
        if (changes?.[GROUPS_KEY]) setTimeout(enhancePillMenus, 0);
      }
    });
  }
}

function boot() {
  injectStyles();
  ensurePicker();
  enhancePillMenus();
  installObservers();
  scheduleThemeSync(0);
  requestAnimationFrame(() => scheduleThemeSync(0));
  setTimeout(() => {
    enhancePillMenus();
    scheduleThemeSync(0);
  }, 120);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
  boot();
}
