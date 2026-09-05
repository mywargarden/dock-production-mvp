import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const extensionPath = path.join(root, "dock-extension");

const server = http.createServer((req, res) => {
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.end(`<!doctype html><html><head><title>Dock New Tab Destination</title></head><body><h1>Fresh destination</h1><p>${req.url || "/"}</p></body></html>`);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();

const browser = await puppeteer.launch({
  headless: false,
  enableExtensions: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--no-first-run", "--no-default-browser-check"]
});

try {
  const extensionId = await browser.installExtension(extensionPath);
  assert.match(extensionId, /^[a-p]{32}$/, "Chrome did not return a valid Dock extension id");

  const dock = (await browser.extensions()).get(extensionId);
  assert.ok(dock, "Dock was not registered in Chrome");
  assert.equal(dock.version, "0.3.15", `unexpected Dock version ${dock.version}`);

  const page = await browser.newPage();
  await page.setViewport({ width: 1100, height: 760 });

  // Seed Safe Harbor's real theme key before opening a genuinely fresh Chrome New Tab.
  await page.goto(`chrome-extension://${extensionId}/newtab.html`, { waitUntil: "domcontentloaded" });
  await page.evaluate(async () => {
    await chrome.storage.local.set({ dockTheme: "violet-harbor" });
  });

  await page.goto("chrome://newtab/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#dockLauncher", { timeout: 10000 });
  await page.waitForSelector("#searchInput", { timeout: 10000 });
  await page.waitForFunction(() => document.body.dataset.theme === "violet-harbor", { timeout: 10000 });

  const newTabState = await page.evaluate(() => ({
    url: location.href,
    launcherCount: document.querySelectorAll("#dockLauncher").length,
    launcherRect: document.getElementById("dockLauncher")?.getBoundingClientRect().toJSON() || null,
    searchPlaceholder: document.getElementById("searchInput")?.getAttribute("placeholder") || "",
    theme: document.body.dataset.theme || "",
    scene: getComputedStyle(document.documentElement).getPropertyValue("--dock-theme-scene").trim(),
    backgroundImage: getComputedStyle(document.body).backgroundImage
  }));

  assert.match(newTabState.url, new RegExp(`^chrome-extension://${extensionId}/newtab\\.html`), "Chrome New Tab was not replaced by Dock");
  assert.equal(newTabState.launcherCount, 1, "Dock New Tab does not contain exactly one launcher");
  assert.match(newTabState.searchPlaceholder, /search or enter address/i, "Dock New Tab search/navigation field missing");
  assert.ok(newTabState.launcherRect?.width >= 56 && newTabState.launcherRect?.height >= 56, "Dock New Tab launcher is unexpectedly tiny");
  assert.equal(newTabState.theme, "violet-harbor", "Dock New Tab did not inherit the saved Grape Tide theme");
  assert.match(newTabState.scene, /grape-tide\.webp/i, "Dock New Tab did not load the Grape Tide scene asset");
  assert.match(newTabState.backgroundImage, /grape-tide\.webp/i, "Dock New Tab did not render Grape Tide as its background");

  // Theme changes made through the shared storage authority must update an already-open New Tab live.
  await page.evaluate(async () => {
    await chrome.storage.local.set({ dockTheme: "sunset" });
  });
  await page.waitForFunction(() => document.body.dataset.theme === "sunset", { timeout: 5000 });
  const liveThemeState = await page.evaluate(() => ({
    theme: document.body.dataset.theme || "",
    scene: getComputedStyle(document.documentElement).getPropertyValue("--dock-theme-scene").trim(),
    backgroundImage: getComputedStyle(document.body).backgroundImage
  }));
  assert.equal(liveThemeState.theme, "sunset", "Dock New Tab did not react to a live theme change");
  assert.match(liveThemeState.scene, /dock-sunset-hd\.png/i, "Dock New Tab live theme change did not swap scene assets");
  assert.match(liveThemeState.backgroundImage, /dock-sunset-hd\.png/i, "Dock New Tab live theme change did not repaint the background");

  // Restore Grape Tide for the remainder of the continuity attack.
  await page.evaluate(async () => {
    await chrome.storage.local.set({ dockTheme: "violet-harbor" });
  });
  await page.waitForFunction(() => document.body.dataset.theme === "violet-harbor", { timeout: 5000 });

  // Drag on the genuinely new tab using real pointer input.
  const start = newTabState.launcherRect;
  const fromX = start.x + start.width / 2;
  const fromY = start.y + start.height / 2;
  const toX = Math.max(120, fromX - 210);
  const toY = Math.max(120, fromY - 160);
  await page.mouse.move(fromX, fromY);
  await page.mouse.down();
  await page.mouse.move(toX, toY, { steps: 8 });
  await page.mouse.up();
  await new Promise((resolve) => setTimeout(resolve, 150));

  const moved = await page.$eval("#dockLauncher", (el) => el.getBoundingClientRect().toJSON());
  assert.ok(Math.abs(moved.x - start.x) > 40 || Math.abs(moved.y - start.y) > 40, "Dock New Tab launcher did not drag");

  // Clicking the launcher on the Dock-owned new tab must open the real extension popup.
  await page.mouse.click(moved.x + moved.width / 2, moved.y + moved.height / 2);
  const popupUrl = `chrome-extension://${extensionId}/popup.html`;
  let popupSeen = false;
  const popupDeadline = Date.now() + 5000;
  while (Date.now() < popupDeadline && !popupSeen) {
    const pages = await browser.pages();
    popupSeen = pages.some((candidate) => candidate.url().startsWith(popupUrl));
    if (!popupSeen && typeof browser.targets === "function") {
      popupSeen = browser.targets().some((target) => String(target.url?.() || "").startsWith(popupUrl));
    }
    if (!popupSeen) await new Promise((resolve) => setTimeout(resolve, 75));
  }
  assert.equal(popupSeen, true, "Dock New Tab launcher did not open the real Dock popup");

  // Use the New Tab page itself to navigate somewhere genuinely new.
  await page.bringToFront();
  await page.click("#searchInput");
  await page.type("#searchInput", `http://127.0.0.1:${port}/from-new-tab`);
  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded" }),
    page.keyboard.press("Enter")
  ]);

  assert.match(page.url(), new RegExp(`^http://127\\.0\\.0\\.1:${port}/from-new-tab`), "Dock New Tab did not navigate to requested destination");
  await page.waitForSelector("#dock-floating-launcher-host", { timeout: 10000 });
  const inherited = await page.$eval("#dock-floating-launcher-host", (el) => el.getBoundingClientRect().toJSON());
  assert.ok(Math.abs(inherited.x - moved.x) <= 3, `launcher x position did not continue from New Tab to web page: ${moved.x} -> ${inherited.x}`);
  assert.ok(Math.abs(inherited.y - moved.y) <= 3, `launcher y position did not continue from New Tab to web page: ${moved.y} -> ${inherited.y}`);

  console.log("Dock 0.3.15 New Tab theme + continuity Chrome 7 PASS");
} finally {
  await browser.close().catch(() => {});
  await new Promise((resolve) => server.close(resolve));
}
