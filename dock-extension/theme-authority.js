(() => {
  "use strict";

  const STORAGE_KEY = "dockTheme";
  const MIRROR_KEY = "dockThemeCurrent";
  const DEFAULT_THEME = "dock-green";
  const THEMES = new Set([
    "dock-green",
    "skipper-harbor",
    "smiley-pop",
    "warm",
    "sunset",
    "tie-dye",
    "rubber-ducky",
    "crazy-ducky",
    "violet-harbor"
  ]);

  function normalizeTheme(value) {
    const theme = String(value || "").trim();
    return THEMES.has(theme) ? theme : DEFAULT_THEME;
  }

  function mirrorTheme(value) {
    const theme = normalizeTheme(value);
    try { localStorage.setItem(MIRROR_KEY, theme); } catch {}
    document.documentElement.dataset.dockThemeAuthority = theme;
    return theme;
  }

  // Capture Safe Harbor theme clicks before the async storage write completes.
  document.addEventListener("click", (event) => {
    const target = event.target instanceof Element
      ? event.target.closest(".themeItem[data-theme]")
      : null;
    if (target) mirrorTheme(target.dataset.theme);
  }, true);

  try {
    chrome.storage.local.get([STORAGE_KEY], (result) => {
      mirrorTheme(result?.[STORAGE_KEY] || DEFAULT_THEME);
    });
  } catch {
    mirrorTheme(DEFAULT_THEME);
  }

  try {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== "local" || !changes?.[STORAGE_KEY]) return;
      mirrorTheme(changes[STORAGE_KEY].newValue || DEFAULT_THEME);
    });
  } catch {}
})();
