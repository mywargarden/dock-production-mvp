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

async function openFreshNewTab(extensionId) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1100, height: 760 });
  await page.goto("chrome://newtab/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#dockLauncher", { timeout: 10000 });
  await page.waitForSelector("#searchInput", { timeout: 10000 });
  assert.match(page.url(), new RegExp(`^chrome-extension://${extensionId}/newtab\\.html`), "Chrome New Tab was not replaced by Dock");
  return page;
}

async function readThemeState(page) {
  return await page.evaluate(() => ({
    theme: document.body.dataset.theme || "",
    prepaintTheme: document.documentElement.dataset.dockNewtabPrepaintTheme || "",
    mirror: localStorage.getItem("dockThemeCurrent") || "",
    scene: getComputedStyle(document.documentElement).getPropertyValue("--dock-theme-scene").trim(),
    backgroundImage: getComputedStyle(document.body).backgroundImage,
    searchRect: document.getElementById("searchInput")?.getBoundingClientRect().toJSON() || null
  }));
}

try {
  const extensionId = await browser.installExtension(extensionPath);
  assert.match(extensionId, /^[a-p]{32}$/, "Chrome did not return a valid Dock extension id");

  const dock = (await browser.extensions()).get(extensionId);
  assert.ok(dock, "Dock was not registered in Chrome");
  assert.equal(dock.version, "0.3.15", `unexpected Dock version ${dock.version}`);

  // Safe Harbor is the theme authority. Wait for its module UI to be live, then use the actual controls.
  const safeHarbor = await browser.newPage();
  await safeHarbor.goto(`chrome-extension://${extensionId}/memories.html`, { waitUntil: "domcontentloaded" });
  await safeHarbor.waitForSelector('#themeMenuBtn', { timeout: 10000 });
  await safeHarbor.waitForFunction(() => !!document.body.dataset.theme, { timeout: 10000 });
  await safeHarbor.click('#themeMenuBtn');
  await safeHarbor.waitForSelector('.themeItem[data-theme="violet-harbor"]', { visible: true, timeout: 10000 });
  await safeHarbor.click('.themeItem[data-theme="violet-harbor"]');
  await safeHarbor.waitForFunction(async () => {
    const stored = await chrome.storage.local.get(["dockTheme"]);
    return document.body.dataset.theme === "violet-harbor" &&
      stored.dockTheme === "violet-harbor" &&
      localStorage.getItem("dockThemeCurrent") === "violet-harbor";
  }, { timeout: 10000 });

  // Every fresh New Tab must inherit the current Safe Harbor theme.
  const page = await openFreshNewTab(extensionId);
  await page.waitForFunction(() => document.body.dataset.theme === "violet-harbor", { timeout: 10000 });
  const newTabState = await page.evaluate(() => ({
    launcherCount: document.querySelectorAll("#dockLauncher").length,
    launcherRect: document.getElementById("dockLauncher")?.getBoundingClientRect().toJSON() || null,
    searchRect: document.getElementById("searchInput")?.getBoundingClientRect().toJSON() || null,
    searchPlaceholder: document.getElementById("searchInput")?.getAttribute("placeholder") || "",
    theme: document.body.dataset.theme || "",
    prepaintTheme: document.documentElement.dataset.dockNewtabPrepaintTheme || "",
    mirror: localStorage.getItem("dockThemeCurrent") || "",
    scene: getComputedStyle(document.documentElement).getPropertyValue("--dock-theme-scene").trim(),
    backgroundImage: getComputedStyle(document.body).backgroundImage
  }));

  assert.equal(newTabState.launcherCount, 1, "Dock New Tab does not contain exactly one launcher");
  assert.match(newTabState.searchPlaceholder, /search or enter address/i, "Dock New Tab search/navigation field missing");
  assert.ok(newTabState.launcherRect?.width >= 56 && newTabState.launcherRect?.height >= 56, "Dock New Tab launcher is unexpectedly tiny");
  assert.ok(newTabState.searchRect?.y >= 450, `Dock search bar is still crossing central theme focal art at y=${newTabState.searchRect?.y}`);
  assert.equal(newTabState.theme, "violet-harbor", "fresh Dock New Tab did not inherit Safe Harbor Grape Tide");
  assert.equal(newTabState.prepaintTheme, "violet-harbor", "Grape Tide was not known at New Tab prepaint");
  assert.equal(newTabState.mirror, "violet-harbor", "New Tab did not read Safe Harbor theme mirror");
  assert.match(newTabState.scene, /grape-tide\.webp/i, "Dock New Tab did not load the Grape Tide scene asset");
  assert.match(newTabState.backgroundImage, /grape-tide\.webp/i, "Dock New Tab did not render Grape Tide as its background");

  const secondFresh = await openFreshNewTab(extensionId);
  await secondFresh.waitForFunction(() => document.body.dataset.theme === "violet-harbor", { timeout: 10000 });
  const secondState = await readThemeState(secondFresh);
  assert.equal(secondState.theme, "violet-harbor", "second fresh New Tab lost the current Safe Harbor theme");
  assert.match(secondState.backgroundImage, /grape-tide\.webp/i, "second fresh New Tab lost Grape Tide background");

  // Change the actual Safe Harbor control to Dock Default. The next new page must use the actual Dock default artwork.
  await safeHarbor.bringToFront();
  await safeHarbor.click('#themeMenuBtn');
  await safeHarbor.waitForSelector('.themeItem[data-theme="dock-green"]', { visible: true, timeout: 5000 });
  await safeHarbor.click('.themeItem[data-theme="dock-green"]');
  await safeHarbor.waitForFunction(async () => {
    const stored = await chrome.storage.local.get(["dockTheme"]);
    return document.body.dataset.theme === "dock-green" &&
      stored.dockTheme === "dock-green" &&
      localStorage.getItem("dockThemeCurrent") === "dock-green";
  }, { timeout: 10000 });

  const defaultFresh = await openFreshNewTab(extensionId);
  await defaultFresh.waitForFunction(() => document.body.dataset.theme === "dock-green", { timeout: 10000 });
  const defaultState = await readThemeState(defaultFresh);
  assert.equal(defaultState.theme, "dock-green", "Dock Default Safe Harbor did not produce Dock Default New Tab");
  assert.equal(defaultState.prepaintTheme, "dock-green", "Dock Default was not present at New Tab prepaint");
  assert.equal(defaultState.mirror, "dock-green", "Dock Default mirror drifted");
  assert.match(defaultState.scene, /dock-default-theme-20260901\.png/i, "Dock Default New Tab did not load the real Dock default artwork");
  assert.match(defaultState.backgroundImage, /dock-default-theme-20260901\.png/i, "Dock Default New Tab did not render the real Dock default artwork");
  assert.ok(defaultState.searchRect?.y >= 450, "Dock Default search bar moved back across central focal art");

  // Restore Grape Tide and prove already-open New Tabs react live as well.
  await safeHarbor.bringToFront();
  await safeHarbor.click('#themeMenuBtn');
  await safeHarbor.waitForSelector('.themeItem[data-theme="violet-harbor"]', { visible: true, timeout: 5000 });
  await safeHarbor.click('.themeItem[data-theme="violet-harbor"]');
  await page.waitForFunction(() => document.body.dataset.theme === "violet-harbor", { timeout: 5000 });

  // Drag on the genuinely new tab using real pointer input.
  await page.bringToFront();
  const start = await page.$eval("#dockLauncher", (el) => el.getBoundingClientRect().toJSON());
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

  console.log("Dock 0.3.15 New Tab Chrome 8 PASS");
} finally {
  await browser.close().catch(() => {});
  await new Promise((resolve) => server.close(resolve));
}
