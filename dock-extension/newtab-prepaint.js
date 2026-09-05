(() => {
  "use strict";

  const DEFAULT_THEME = "dock-green";
  const MIRROR_KEY = "dockThemeCurrent";
  const SCENES = {
    "dock-green": "assets/dock-default-theme-20260901.png",
    "skipper-harbor": "assets/skipper-harbor-hd.png",
    "smiley-pop": "assets/smileys-3d.webp",
    "warm": "assets/sand-castle-theme.webp",
    "sunset": "assets/dock-sunset-hd.png",
    "tie-dye": "assets/tie-dye-bg.webp",
    "rubber-ducky": "assets/rubber-ducky-theme.webp",
    "crazy-ducky": "assets/cozy-quilt.webp",
    "violet-harbor": "assets/grape-tide.webp"
  };
  const THEMES = new Set(Object.keys(SCENES));

  let theme = DEFAULT_THEME;
  try {
    const mirrored = String(localStorage.getItem(MIRROR_KEY) || "").trim();
    if (THEMES.has(mirrored)) theme = mirrored;
  } catch {}

  const root = document.documentElement;
  root.dataset.dockNewtabPrepaintTheme = theme;

  const scene = SCENES[theme] || SCENES[DEFAULT_THEME];
  root.style.setProperty("--dock-theme-scene", `url("${scene}")`);
  root.style.setProperty("--newtab-bg", `linear-gradient(rgba(18,18,28,.04), rgba(18,18,28,.10)), url("${scene}") center/cover fixed`);
})();
