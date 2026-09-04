// Chrome adapter

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isPopupDocument() {
  try {
    return typeof document !== "undefined" && /\/popup\.html$/i.test(String(globalThis.location?.pathname || ""));
  } catch {
    return false;
  }
}

function makePopupSafeTabs(rawTabs) {
  if (!rawTabs?.captureVisibleTab) return rawTabs;

  return new Proxy(rawTabs, {
    get(target, prop) {
      if (prop === "captureVisibleTab") {
        return async (...args) => {
          let activeTabId = null;
          let hidden = false;
          try {
            const tabs = await target.query({ active: true, currentWindow: true });
            activeTabId = tabs?.[0]?.id ?? null;
            if (activeTabId != null) {
              const result = await target.sendMessage(activeTabId, {
                type: "SET_DOCK_LAUNCHER_CAPTURE_HIDDEN",
                hidden: true
              });
              hidden = !!result?.ok;
              if (hidden) await sleep(34);
            }
          } catch {}

          try {
            return await target.captureVisibleTab(...args);
          } finally {
            if (hidden && activeTabId != null) {
              try {
                await target.sendMessage(activeTabId, {
                  type: "SET_DOCK_LAUNCHER_CAPTURE_HIDDEN",
                  hidden: false
                });
              } catch {}
            }
          }
        };
      }

      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
}

export function getChromeApi() {
  const raw = globalThis.chrome;
  if (!raw || !isPopupDocument()) return raw;

  const safeTabs = makePopupSafeTabs(raw.tabs);
  return new Proxy(raw, {
    get(target, prop) {
      if (prop === "tabs") return safeTabs;
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
}
