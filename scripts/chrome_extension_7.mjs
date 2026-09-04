import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const extensionPath = path.join(root, "dock-extension");
let serverMode = "degraded";
const now = Date.now();

function managedPayload(version, title) {
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
    license: { plan: "district", status: "active", minExtensionVersion: "" }
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

serverMode = "degraded";
const degraded = await control.evaluate(() => chrome.runtime.sendMessage({ type: "SYNC_MANAGED_WORKSPACE" }));
assert.equal(degraded?.ok, false);
assert.equal(degraded?.preserved, true);
let state = await control.evaluate(() => chrome.storage.local.get(["dockManagedWorkspace"]));
assert.equal(state.dockManagedWorkspace?.version, 1, "degraded sync erased or replaced the valid managed Dock");

const page = await browser.newPage();
page.on("dialog", (dialog) => dialog.dismiss().catch(() => {}));
await page.evaluateOnNewDocument(() => {
  window.__dockVisibleBlankFrames = [];
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

serverMode = "revoked";
const revoked = await control.evaluate(() => chrome.runtime.sendMessage({ type: "SYNC_MANAGED_WORKSPACE" }));
assert.equal(revoked?.reason, "ACCESS_REVOKED");
state = await control.evaluate(() => chrome.storage.local.get(["dockManagedWorkspace"]));
assert.equal(state.dockManagedWorkspace, undefined, "hard revocation failed to remove managed workspace");

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

console.log("Chrome RC1 7: PASS");
await browser.close();
await new Promise((resolve) => server.close(resolve));
