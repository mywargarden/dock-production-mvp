import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const extensionPath = path.join(root, "dock-extension");
let serverMode = "degraded";
const now = Date.now();
const INLINE_PREVIEW = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=";

function managedPayload(version, title, minExtensionVersion = "") {
  return {
    type: "dock-managed-config",
    organization: { id: "test-district", name: "Test District", orgCode: "TEST", emailDomain: "test.invalid" },
    workspace: {
      id: "district-live",
      name: "District Dock",
      version,
      updatedAt: now + version,
      publishedAt: now + version,
      branding: { districtAccentColor: "#183246" },
      tabs: [{ title, url: `https://example.com/v${version}` }]
    },
    license: { plan: "district", status: "active", minExtensionVersion }
  };
}

const server = http.createServer((req, res) => {
  if (req.url !== "/config") {
    res.writeHead(404).end();
    return;
  }
  res.setHeader("content-type", "application/json");
  if (serverMode === "degraded") {
    res.writeHead(500).end(JSON.stringify({ error: "temporary failure" }));
    return;
  }
  if (serverMode === "revoked") {
    res.writeHead(403).end(JSON.stringify({ code: "LICENSE_SUSPENDED", error: "suspended" }));
    return;
  }
  if (serverMode === "update-required") {
    res.writeHead(200).end(JSON.stringify(managedPayload(1, "Old District", "99.0.0")));
    return;
  }
  res.writeHead(200).end(JSON.stringify(managedPayload(2, "New District")));
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();
const configUrl = `http://127.0.0.1:${port}/config`;

const browser = await puppeteer.launch({
  headless: false,
  enableExtensions: true,
  args: [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--no-first-run",
    "--no-default-browser-check"
  ]
});

const extensionId = await browser.installExtension(extensionPath);
assert.match(extensionId, /^[a-p]{32}$/, "Chrome did not return a valid unpacked extension id");
const extensions = await browser.extensions();
const dockExtension = extensions.get(extensionId);
assert.ok(dockExtension, `Dock extension ${extensionId} was not registered after installExtension()`);
assert.equal(dockExtension.name, "Dock", "Chrome registered an unexpected extension");
assert.equal(dockExtension.version, "0.3.12", "Chrome loaded an unexpected Dock version");
console.log(`Dock runtime loaded: ${extensionId} v${dockExtension.version}`);

const extUrl = (file) => `chrome-extension://${extensionId}/${file}`;
const control = await browser.newPage();
await control.goto(extUrl("popup.html"), { waitUntil: "domcontentloaded" });

const oldWorkspace = {
  ...managedPayload(1, "Old District").workspace,
  managed: true,
  locked: true,
  sourceUrl: configUrl
};

await control.evaluate(async ({ configUrl, oldWorkspace, now }) => {
  await chrome.storage.local.clear();
  await chrome.storage.local.set({
    dockOrg: {
      orgId: "test-district",
      orgName: "Test District",
      orgCode: "TEST",
      emailDomain: "test.invalid",
      configUrl,
      lastSyncedAt: now - 3600000
    },
    dockManagedWorkspace: oldWorkspace,
    dockManagedMeta: { syncedAt: now - 3600000, version: 1, updatedAt: now + 1, publishedAt: now + 1 },
    dockPlanState: { plan: "district", label: "District", status: "active", source: "managed" },
    dockActiveGroup: "__admin__"
  });
}, { configUrl, oldWorkspace, now });

// 7a: transient failure preserves the last valid managed workspace.
serverMode = "degraded";
const degraded = await control.evaluate(() => chrome.runtime.sendMessage({ type: "SYNC_MANAGED_WORKSPACE" }));
assert.equal(degraded?.ok, false);
assert.equal(degraded?.preserved, true);
let state = await control.evaluate(() => chrome.storage.local.get(["dockManagedWorkspace"]));
assert.equal(state.dockManagedWorkspace?.version, 1, "degraded sync erased or replaced the valid managed Dock");

// Instrument Safe Harbor before any of its scripts execute.
const page = await browser.newPage();
page.on("dialog", (dialog) => dialog.dismiss().catch(() => {}));
await page.evaluateOnNewDocument(() => {
  window.__dockVisibleBlankFrames = [];
  window.__dockIntervalRegistrations = [];
  window.__dockObserverRegistrations = [];

  const nativeSetInterval = window.setInterval;
  window.setInterval = function(handler, delay, ...args) {
    window.__dockIntervalRegistrations.push(Number(delay));
    return nativeSetInterval.call(this, handler, delay, ...args);
  };

  const nativeObserve = MutationObserver.prototype.observe;
  MutationObserver.prototype.observe = function(target, options) {
    const opts = options || {};
    window.__dockObserverRegistrations.push({
      body: target === document.body,
      html: target === document.documentElement,
      childList: !!opts.childList,
      subtree: !!opts.subtree,
      attributes: !!opts.attributes
    });
    return nativeObserve.call(this, target, options);
  };

  const tick = () => {
    const html = document.documentElement;
    const body = document.body;
    const grid = document.querySelector("#grid");
    if (html && body && grid) {
      const hs = getComputedStyle(html);
      const bs = getComputedStyle(body);
      const bodyVisible = hs.visibility !== "hidden" && hs.display !== "none" && Number(hs.opacity || 1) > 0.01 &&
        bs.visibility !== "hidden" && bs.display !== "none" && Number(bs.opacity || 1) > 0.01;
      const continuityCover = html.classList.contains("dock-prepaint-loading") || html.classList.contains("dock-continuity-transition");
      if (bodyVisible && !continuityCover && grid.childElementCount === 0) {
        window.__dockVisibleBlankFrames.push({ t: performance.now(), htmlClass: html.className, bodyClass: body.className });
      }
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});

await page.goto(extUrl("memories.html"), { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => document.body.innerText.includes("Old District"), { timeout: 10000 });
let blanks = await page.evaluate(() => window.__dockVisibleBlankFrames || []);
assert.equal(blanks.length, 0, `visible blank frames during cached load: ${JSON.stringify(blanks.slice(0, 5))}`);

// 7b: newer publish applies atomically and repaints the already-open Safe Harbor.
await control.evaluate(() => {
  window.__managedWorkspaceTransitions = [];
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes.dockManagedWorkspace) return;
    const change = changes.dockManagedWorkspace;
    window.__managedWorkspaceTransitions.push({
      oldVersion: change.oldValue?.version ?? null,
      newVersion: change.newValue?.version ?? null,
      removed: !change.newValue
    });
  });
});
serverMode = "new";
const refreshed = await control.evaluate(() => chrome.runtime.sendMessage({ type: "SYNC_MANAGED_WORKSPACE" }));
assert.equal(refreshed?.ok, true, `managed sync did not report success: ${JSON.stringify(refreshed)}`);
state = await control.evaluate(() => chrome.storage.local.get(["dockManagedWorkspace", "dockManagedMeta"]));
assert.equal(state.dockManagedWorkspace?.version, 2, `managed sync reported success without applying version 2: response=${JSON.stringify(refreshed)} state=${JSON.stringify(state)}`);
const transitions = await control.evaluate(() => window.__managedWorkspaceTransitions || []);
assert.ok(transitions.some((entry) => entry.oldVersion === 1 && entry.newVersion === 2 && !entry.removed), `managed publish was not an atomic old->new storage replacement: ${JSON.stringify(transitions)}`);
assert.equal(transitions.some((entry) => entry.removed), false, "managed workspace was removed between valid versions");
await page.waitForFunction(() => document.body.innerText.includes("New District"), { timeout: 10000 });
blanks = await page.evaluate(() => window.__dockVisibleBlankFrames || []);
assert.equal(blanks.length, 0, `visible blank frames during managed replacement: ${JSON.stringify(blanks.slice(0, 5))}`);

// 7c: explicit hard revocation removes managed access.
serverMode = "revoked";
const revoked = await control.evaluate(() => chrome.runtime.sendMessage({ type: "SYNC_MANAGED_WORKSPACE" }));
assert.equal(revoked?.reason, "ACCESS_REVOKED");
state = await control.evaluate(() => chrome.storage.local.get(["dockManagedWorkspace"]));
assert.equal(state.dockManagedWorkspace, undefined, "hard revocation failed to remove managed workspace");

// 7d: update-required is a distinct active-license state: view survives, mutation stops.
serverMode = "update-required";
await control.evaluate(async ({ oldWorkspace }) => {
  await chrome.storage.local.set({
    dockManagedWorkspace: oldWorkspace,
    dockManagedMeta: { syncedAt: Date.now(), version: 1 },
    dockPlanState: {
      plan: "district",
      label: "District",
      status: "active",
      source: "managed",
      minExtensionVersion: "99.0.0"
    },
    dockActiveGroup: "__admin__"
  });
}, { oldWorkspace });

await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForFunction(() => document.body.innerText.includes("Old District"), { timeout: 10000 });
const licenseState = await page.evaluate(async () => {
  const module = await import("./core/license.js");
  return await module.getDockLicenseState();
});
assert.equal(licenseState.mode, "update-required", `canonical license engine did not compute update-required: ${JSON.stringify(licenseState)}`);
assert.equal(licenseState.mutationAllowed, false, "update-required unexpectedly allowed mutation");
await page.waitForFunction(() => document.body.classList.contains("dockUpdateRequired"), { timeout: 10000 });
assert.equal(await page.$eval("#createGroupBtn", (el) => el.disabled), true, "update-required did not disable Dock mutation action");
await page.evaluate(() => {
  const button = document.querySelector("#createGroupBtn");
  button.disabled = false;
  button.click();
});
await new Promise((resolve) => setTimeout(resolve, 200));
assert.equal(await page.$(".dockModalBackdrop"), null, "capture-phase mutation guard was bypassed after forced re-enable");
assert.ok(await page.$("#grid .card"), "update-required hid the last valid Dock instead of preserving view");

// 7e: no retired 250/350ms polling or whole-page watermark observer survives initialization.
const runtimeInstrumentation = await page.evaluate(() => ({
  intervals: window.__dockIntervalRegistrations || [],
  observers: window.__dockObserverRegistrations || []
}));
assert.equal(runtimeInstrumentation.intervals.includes(250), false, `retired 250ms interval registered: ${JSON.stringify(runtimeInstrumentation.intervals)}`);
assert.equal(runtimeInstrumentation.intervals.includes(350), false, `retired 350ms interval registered: ${JSON.stringify(runtimeInstrumentation.intervals)}`);
const watermarkLikeObservers = runtimeInstrumentation.observers.filter((entry) => entry.body && entry.childList && entry.subtree && entry.attributes);
assert.equal(watermarkLikeObservers.length, 0, `whole-page watermark-style observer registered: ${JSON.stringify(watermarkLikeObservers)}`);

// 7f: real production save -> reorder -> reload preserves exactly one inline preview payload.
serverMode = "degraded";
await control.evaluate(async ({ preview }) => {
  await chrome.storage.local.set({
    dockPlanState: { plan: "district", label: "District", status: "active", source: "managed" },
    dockActiveGroup: "__all__"
  });
  const storage = await import("./core/storage.js");
  await storage.setSavedTabs([
    {
      title: "Preview Test",
      url: "https://example.com/preview-test",
      screenshot: preview,
      screenshot_url: preview,
      screenshotUrl: preview,
      screenshotThumb: preview,
      customIcon: "https://example.com/custom-icon.png",
      savedAt: Date.now()
    },
    {
      title: "Second Card",
      url: "https://example.com/second-card",
      savedAt: Date.now() + 1
    }
  ]);
}, { preview: INLINE_PREVIEW });

let previewStorage = await control.evaluate(() => chrome.storage.local.get(["savedTabs", "savedTabsLite"]));
let previewTab = previewStorage.savedTabs.find((tab) => tab.title === "Preview Test");
assert.equal(previewTab?.screenshotThumb, INLINE_PREVIEW, "canonical full cache lost inline preview on save");
assert.equal(previewTab?.screenshot, undefined, "legacy screenshot alias survived canonical save");
assert.equal(previewTab?.screenshot_url, undefined, "inline preview was duplicated into screenshot_url");
assert.equal(previewTab?.screenshotUrl, undefined, "legacy screenshotUrl alias survived canonical save");
assert.equal(previewTab?.customIcon, "https://example.com/custom-icon.png", "canonical preview write destroyed custom imagery");
assert.equal(JSON.stringify(previewStorage.savedTabsLite || []).includes(INLINE_PREVIEW), false, "lite cache retained inline base64 preview");

await control.evaluate(async () => {
  const storage = await import("./core/storage.js");
  const tabs = await storage.getSavedTabs({ localOnly: true });
  await storage.setSavedTabs([...tabs].reverse());
});
previewStorage = await control.evaluate(() => chrome.storage.local.get(["savedTabs", "savedTabsLite"]));
previewTab = previewStorage.savedTabs.find((tab) => tab.title === "Preview Test");
assert.equal(previewTab?.screenshotThumb, INLINE_PREVIEW, "reorder lost canonical inline preview");
assert.equal((JSON.stringify(previewStorage.savedTabs).match(/data:image\/png;base64/g) || []).length, 1, "reorder multiplied inline preview payload");
assert.equal(JSON.stringify(previewStorage.savedTabsLite || []).includes(INLINE_PREVIEW), false, "reorder reintroduced base64 into lite cache");

await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForFunction(() => document.body.innerText.includes("Preview Test"), { timeout: 10000 });
const renderedPreview = await page.evaluate(() => {
  for (const card of document.querySelectorAll("#grid .card")) {
    if (card.innerText.includes("Preview Test")) return card.querySelector(".preview img")?.src || "";
  }
  return "";
});
assert.equal(renderedPreview, INLINE_PREVIEW, "saved preview did not survive reload into the rendered card image");

// 7g: the real legacy import surface preserves the shared preview through group storage and rendering.
await control.evaluate(async () => {
  await chrome.storage.local.set({
    dockPlanState: { plan: "district", label: "District", status: "active", source: "managed" }
  });
});
const legacyPayload = {
  workspace: {
    name: "Imported Preview Dock",
    color: "#6f4cff",
    tabs: [{
      title: "Imported Preview Card",
      url: "https://example.com/imported-preview",
      screenshotThumb: INLINE_PREVIEW,
      savedAt: Date.now()
    }]
  }
};
const encodedLegacy = Buffer.from(JSON.stringify(legacyPayload), "utf8").toString("base64url");
const importPage = await browser.newPage();
await importPage.goto(`${extUrl("import.html")}#data=${encodedLegacy}`, { waitUntil: "domcontentloaded" });
await importPage.waitForFunction(() => document.body.innerText.includes("ready to import"), { timeout: 10000 });
await importPage.click("#importBtn");
await importPage.waitForFunction(() => {
  const button = document.querySelector("#openLibraryBtn");
  return button && !button.classList.contains("hidden") && document.body.innerText.includes("Imported");
}, { timeout: 10000 });
const importedState = await importPage.evaluate(() => chrome.storage.local.get(["dockActiveGroup", "dockGroupItems"]));
const importedItems = importedState.dockGroupItems?.[importedState.dockActiveGroup] || [];
const importedTab = importedItems.find((tab) => tab.title === "Imported Preview Card");
assert.equal(importedTab?.screenshotThumb, INLINE_PREVIEW, "legacy import lost canonical preview in group storage");
assert.equal(importedTab?.screenshot, undefined, "legacy import persisted duplicate screenshot alias");
assert.equal(importedTab?.screenshotUrl, undefined, "legacy import persisted duplicate screenshotUrl alias");
await Promise.all([
  importPage.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 10000 }),
  importPage.click("#openLibraryBtn")
]);
await importPage.waitForFunction(() => document.body.innerText.includes("Imported Preview Card"), { timeout: 10000 });
const importedRenderedPreview = await importPage.evaluate(() => {
  for (const card of document.querySelectorAll("#grid .card")) {
    if (card.innerText.includes("Imported Preview Card")) return card.querySelector(".preview img")?.src || "";
  }
  return "";
});
assert.equal(importedRenderedPreview, INLINE_PREVIEW, "imported preview did not survive into the rendered card image");

console.log("Chrome RC1 7: PASS");
await browser.close();
await new Promise((resolve) => server.close(resolve));
