(() => {
  const root = document.documentElement;
  root.classList.add("dock-prepaint-loading");

  const fallback = {
    backgroundColor: "#183246",
    backgroundImage: "linear-gradient(180deg, #183246 0%, #274f62 100%)",
    backgroundSize: "cover",
    backgroundPosition: "center center"
  };

  let visual = fallback;
  try {
    const parsed = JSON.parse(localStorage.getItem("dockContinuityVisual") || "null");
    if (parsed && typeof parsed === "object") {
      visual = { ...fallback, ...parsed };
    }
  } catch {}

  root.style.setProperty("--dock-continuity-bg-color", String(visual.backgroundColor || fallback.backgroundColor));
  root.style.setProperty("--dock-continuity-bg-image", String(visual.backgroundImage || fallback.backgroundImage));
  root.style.setProperty("--dock-continuity-bg-size", String(visual.backgroundSize || fallback.backgroundSize));
  root.style.setProperty("--dock-continuity-bg-position", String(visual.backgroundPosition || fallback.backgroundPosition));

  // Safety valve: never leave the page hidden if another script fails.
  window.setTimeout(() => root.classList.remove("dock-prepaint-loading"), 1800);
})();
