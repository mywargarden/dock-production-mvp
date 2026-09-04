from pathlib import Path

path = Path("dock-extension/memories.js")
src = path.read_text()

old_background = '''let dockManagedDistrictBackgroundTimerFinal = null;

function dockStartDistrictBackgroundFinal(){
  dockApplyDistrictBackgroundFinal();

  if (dockManagedDistrictBackgroundTimerFinal) return;

  dockManagedDistrictBackgroundTimerFinal = window.setInterval(() => {
    dockApplyDistrictBackgroundFinal();
  }, 250);

  document.addEventListener("visibilitychange", dockApplyDistrictBackgroundFinal);
  window.addEventListener("focus", dockApplyDistrictBackgroundFinal);
  window.addEventListener("pageshow", dockApplyDistrictBackgroundFinal);
  document.addEventListener("click", () => {
    window.setTimeout(dockApplyDistrictBackgroundFinal, 0);
    window.setTimeout(dockApplyDistrictBackgroundFinal, 120);
  }, true);
}

dockStartDistrictBackgroundFinal();
'''

new_background = '''function dockStartDistrictBackgroundFinal(){
  // Rendering paths already refresh the managed background. Recheck only when
  // the page itself becomes active again; continuous polling is unnecessary.
  dockApplyDistrictBackgroundFinal();
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) dockApplyDistrictBackgroundFinal();
  });
  window.addEventListener("focus", dockApplyDistrictBackgroundFinal);
  window.addEventListener("pageshow", dockApplyDistrictBackgroundFinal);
}

dockStartDistrictBackgroundFinal();
'''

old_watermark = '''/* === Hide centered Dock watermark on managed district dock === */
(function(){
  function isManagedDistrictDock(){
    return document.body && document.body.dataset.managedDock === "true";
  }

  function looksLikeCenterDockWatermark(el){
    if (!el || !el.getBoundingClientRect) return false;

    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth || document.documentElement.clientWidth || 0;
    const vh = window.innerHeight || document.documentElement.clientHeight || 0;

    if (!vw || !vh) return false;

    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;

    const isBigEnough = rect.width >= 160 && rect.height >= 90;
    const isCenteredX = cx > vw * 0.30 && cx < vw * 0.72;
    const isLowerThanHeader = cy > vh * 0.28;
    const isNotCard = !el.closest(".card,.memoryCard,.previewCard,.menuPanel,.dockModal,.dockModalBackdrop,.modal,.modalBackdrop,.workspaceModal,.workspaceModalBackdrop,.dockDrawer,.saveDrawer,#themeMenu,.themeMenuPanel,header,.header,.topBar,.groupBar,.groupPillWrap,.groupPillsRail,nav");

    const txt = String(el.textContent || "").trim().toLowerCase();
    const alt = String(el.getAttribute?.("alt") || "").toLowerCase();
    const src = String(el.getAttribute?.("src") || el.currentSrc || "").toLowerCase();
    const cls = String(el.className || "").toLowerCase();

    const looksDock =
      txt === "dock" ||
      alt.includes("dock") ||
      src.includes("dock") ||
      cls.includes("dock") ||
      cls.includes("logo") ||
      cls.includes("empty") ||
      cls.includes("watermark");

    return isBigEnough && isCenteredX && isLowerThanHeader && isNotCard && looksDock;
  }

  function hideCenterDockWatermark(){
    if (!isManagedDistrictDock()) return;

    const els = Array.from(document.querySelectorAll("img, svg, picture, canvas, div, section, main"));
    for (const el of els) {
      if (looksLikeCenterDockWatermark(el)) {
        el.style.setProperty("display", "none", "important");
        el.style.setProperty("visibility", "hidden", "important");
        el.style.setProperty("opacity", "0", "important");
        el.setAttribute("data-hidden-managed-dock-watermark", "true");
      }
    }
  }

  function start(){
    hideCenterDockWatermark();

    if (window.__dockHideCenterWatermarkTimer) return;

    window.__dockHideCenterWatermarkTimer = window.setInterval(() => {
      try { hideCenterDockWatermark(); } catch {}
    }, 350);

    try {
      const obs = new MutationObserver(() => {
        try { hideCenterDockWatermark(); } catch {}
      });
      obs.observe(document.body, { childList: true, subtree: true, attributes: true });
      window.__dockHideCenterWatermarkObserver = obs;
    } catch {}
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }

  window.dockHideCenterDockWatermark = hideCenterDockWatermark;
})();

'''

replacements = [
    ("background polling block", old_background, new_background),
    ("watermark scanner block", old_watermark, "/* Heuristic DOM watermark scanning removed; managed branding is explicit state. */\n\n"),
]

for label, old, new in replacements:
    count = src.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly 1 match, found {count}")
    src = src.replace(old, new)

if "setInterval(" in src:
    raise SystemExit("Unexpected setInterval remains in memories.js")
if "__dockHideCenterWatermarkObserver" in src or "looksLikeCenterDockWatermark" in src:
    raise SystemExit("Watermark scanner residue remains")

path.write_text(src)
print("memories.js legacy loop/scanner cleanup applied")
