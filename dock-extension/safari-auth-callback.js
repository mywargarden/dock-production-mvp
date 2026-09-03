(() => {
  const api = globalThis.browser;
  if (!api?.runtime?.sendMessage) return;

  function norm(value) {
    return String(value || "").trim();
  }

  const href = window.location.href;
  const hash = window.location.hash || "";
  const search = window.location.search || "";
  const authTransport = /(?:^|[#?&])access_token=/.test(hash + search) || /(?:^|[#?&])error(?:_description)?=/.test(hash + search);
  const shareTransport = new URLSearchParams(hash.replace(/^#/, "")).has("dock-share");

  // The Dock web root is a product/admin surface, not an OAuth transport UI.
  // Safari executes this at document_start. Hide transport pages before the
  // underlying web app can paint, preventing any Admin/Owner flash while the
  // background receives the callback and closes the auth tab.
  if (authTransport) {
    try {
      const root = document.documentElement;
      root.style.setProperty("visibility", "hidden", "important");
      root.style.setProperty("background", "#fbf7f2", "important");
      setTimeout(() => {
        // If the callback cannot complete for an unexpected reason, fail into a
        // neutral page instead of exposing the underlying HQ/Admin surface.
        if (!document.documentElement) return;
        document.documentElement.style.setProperty("visibility", "visible", "important");
        document.documentElement.innerHTML = '<head><title>Dock sign-in</title></head><body style="margin:0;background:#fbf7f2;color:#1c2a3a;font-family:-apple-system,BlinkMacSystemFont,sans-serif;display:grid;place-items:center;min-height:100vh"><div style="max-width:520px;padding:28px;text-align:center"><h1>Finishing Dock sign-in…</h1><p>You can close this tab and return to Dock if it does not close automatically.</p></div></body>';
      }, 5000);
    } catch {}
  }

  function decodeShareData(encoded) {
    const base64 = String(encoded || "").replace(/-/g, "+").replace(/_/g, "/");
    const pad = base64.length % 4 ? "=".repeat(4 - (base64.length % 4)) : "";
    const binary = atob(base64 + pad);
    const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  }

  function sanitizeUrl(value) {
    const raw = norm(value);
    if (!raw) return "";
    try {
      const url = new URL(raw);
      if (!["http:", "https:"].includes(url.protocol)) return "";
      if (url.hostname === "dock-production-mvp.vercel.app") return "";
      return url.toString();
    } catch {
      return "";
    }
  }

  function ensureColor(value) {
    return /^#[0-9a-f]{6}$/i.test(norm(value)) ? norm(value) : "#8fd8c6";
  }

  function pickPreview(tab) {
    return norm(
      tab?.screenshot_url ||
      tab?.screenshotUrl ||
      tab?.screenshotThumb ||
      tab?.screenshot ||
      tab?.screenshot_data_url ||
      ""
    );
  }

  function uniqueName(base, groups) {
    const existing = new Set((groups || []).map((g) => norm(g?.name).toLowerCase()).filter(Boolean));
    const root = norm(base) || "Imported Dock";
    if (!existing.has(root.toLowerCase())) return root;
    let i = 2;
    while (existing.has(`${root} (${i})`.toLowerCase())) i += 1;
    return `${root} (${i})`;
  }

  async function importPortableShare(encoded) {
    const payload = decodeShareData(encoded);
    const workspace = payload?.workspace;
    if (payload?.type !== "dock-workspace-share" || !workspace || !Array.isArray(workspace.tabs)) {
      throw new Error("Invalid Dock share payload.");
    }

    const res = await api.storage.local.get(["dockGroups", "dockGroupItems"]);
    const groups = Array.isArray(res?.dockGroups) ? [...res.dockGroups] : [];
    const groupItems = res?.dockGroupItems && typeof res.dockGroupItems === "object" ? { ...res.dockGroupItems } : {};

    const name = uniqueName(workspace.name, groups);
    const id = `g_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(2, 6)}`;
    const tabs = workspace.tabs.map((tab) => {
      const url = sanitizeUrl(tab?.url);
      if (!url) return null;
      const preview = pickPreview(tab);
      return {
        title: norm(tab?.title) || url,
        url,
        reason: norm(tab?.reason).slice(0, 500),
        faviconUrl: norm(tab?.faviconUrl) || null,
        savedAt: Number(tab?.savedAt || 0) || Date.now(),
        screenshot_url: preview || null,
        screenshotUrl: preview || null,
        screenshotThumb: preview || null,
        screenshot: null,
        screenshot_data_url: null,
        screenshotBlocked: preview ? false : !!tab?.screenshotBlocked
      };
    }).filter(Boolean);

    if (!tabs.length) throw new Error("This Dock share contains no regular website tabs.");

    groups.push({
      id,
      name,
      color: ensureColor(workspace.color),
      createdAt: Date.now(),
      importedAt: Date.now()
    });
    groupItems[id] = tabs;

    await api.storage.local.set({
      dockGroups: groups,
      dockGroupItems: groupItems,
      dockActiveGroup: id,
      dockSafariLastShareImport: {
        ok: true,
        groupId: id,
        name,
        count: tabs.length,
        at: Date.now()
      }
    });

    window.location.replace(api.runtime.getURL("memories.html"));
  }

  try {
    const shareParams = new URLSearchParams(hash.replace(/^#/, ""));
    const portableShare = shareParams.get("dock-share");
    if (portableShare) {
      importPortableShare(portableShare).catch(async (error) => {
        try {
          await api.storage.local.set({
            dockSafariLastShareImport: {
              ok: false,
              error: String(error?.message || error || "share-import-failed"),
              at: Date.now()
            }
          });
        } catch {}
        document.documentElement.innerHTML = `<head><title>Dock share</title></head><body style="margin:0;background:#fbf7f2;color:#1c2a3a;font-family:-apple-system,BlinkMacSystemFont,sans-serif;display:grid;place-items:center;min-height:100vh"><div style="max-width:520px;padding:28px;text-align:center"><h1>Dock share could not be imported.</h1><p>${String(error?.message || "Please open Dock and try again.").replace(/[<>]/g, "")}</p></div></body>`;
      });
      return;
    }

    if (!authTransport) return;
    api.runtime.sendMessage({
      type: "DOCK_SAFARI_AUTH_CALLBACK",
      url: href
    }).catch(() => {});
  } catch {}
})();
