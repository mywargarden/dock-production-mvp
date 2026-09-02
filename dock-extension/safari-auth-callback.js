(() => {
  const api = globalThis.browser;
  if (!api?.runtime?.sendMessage) return;

  function norm(value) {
    return String(value || "").trim();
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
      return ["http:", "https:"].includes(url.protocol) ? url.toString() : "";
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
    if (!workspace || !Array.isArray(workspace.tabs)) throw new Error("Invalid Dock share payload.");

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
        reason: norm(tab?.reason),
        faviconUrl: norm(tab?.faviconUrl) || null,
        savedAt: Number(tab?.savedAt || 0) || Date.now(),
        screenshot_url: preview || null,
        screenshotUrl: preview || null,
        screenshotThumb: preview || null,
        screenshot: preview || null,
        screenshot_data_url: preview.startsWith("data:image/") ? preview : null,
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

    try {
      window.location.replace(api.runtime.getURL("memories.html"));
    } catch {
      document.documentElement.innerHTML = `<head><title>Dock imported</title></head><body style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;padding:40px"><h1>Dock imported</h1><p>“${name.replace(/[<>]/g, "")}” is now in Safe Harbor. Open Dock to continue.</p></body>`;
    }
  }

  try {
    const href = window.location.href;
    const hash = window.location.hash || "";
    const search = window.location.search || "";

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
        alert(error?.message || "Dock share could not be imported.");
      });
      return;
    }

    if (!/(?:^|[#?&])access_token=/.test(hash + search) && !/(?:^|[#?&])error(?:_description)?=/.test(hash + search)) return;
    api.runtime.sendMessage({
      type: "DOCK_SAFARI_AUTH_CALLBACK",
      url: href
    }).catch(() => {});
  } catch {}
})();
