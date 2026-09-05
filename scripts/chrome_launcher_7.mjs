import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const extensionPath = path.join(root, "dock-extension");

const server = http.createServer((req, res) => {
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.end(`<!doctype html><html><head><title>Dock Launcher Test</title></head><body style="min-height:2000px"><h1>Ordinary web page</h1><p>${req.url || "/"}</p></body></html>`);
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

  const extensions = await browser.extensions();
  const dock = extensions.get(extensionId);
  assert.ok(dock, "Dock was not registered in Chrome");
  assert.equal(dock.version, "0.3.27", `unexpected Dock version ${dock.version}`);

  const page = await browser.newPage();
  await page.setViewport({ width: 1100, height: 760 });
  await page.goto(`http://127.0.0.1:${port}/first`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#dock-floating-launcher-host", { timeout: 10000 });

  const launcherState = await page.evaluate(() => {
    const hosts = document.querySelectorAll("#dock-floating-launcher-host");
    const host = hosts[0];
    const button = host?.shadowRoot?.querySelector("button");
    const image = host?.shadowRoot?.querySelector("img");
    const style = host ? getComputedStyle(host) : null;
    return {
      hostCount: hosts.length,
      hasShadow: !!host?.shadowRoot,
      title: button?.getAttribute("title") || "",
      aria: button?.getAttribute("aria-label") || "",
      image: image?.src || "",
      visibility: style?.visibility || "",
      opacity: style?.opacity || "",
      rect: host ? host.getBoundingClientRect().toJSON() : null
    };
  });

  assert.equal(launcherState.hostCount, 1, "ordinary page received duplicate Dock launchers");
  assert.equal(launcherState.hasShadow, true, "Dock launcher is not isolated in Shadow DOM");
  assert.match(launcherState.title, /Toggle Dock/i, "Dock launcher is not presented as a toggle");
  assert.match(launcherState.aria, /Toggle Dock popup/i, "Dock launcher accessibility label regressed");
  assert.match(launcherState.image, /assets\/dock_boat_mark\.png$/, "Dock launcher is not using the boat+waves mark");
  assert.equal(launcherState.visibility, "visible", "Dock launcher is unexpectedly hidden on an active page");
  assert.notEqual(launcherState.opacity, "0", "Dock launcher is unexpectedly transparent on an active page");
  assert.ok(launcherState.rect?.width >= 56 && launcherState.rect?.height >= 56, "Dock launcher is unexpectedly tiny");

  const start = launcherState.rect;
  const fromX = start.x + start.width / 2;
  const fromY = start.y + start.height / 2;
  const toX = Math.max(100, fromX - 180);
  const toY = Math.max(100, fromY - 140);
  await page.mouse.move(fromX, fromY);
  await page.mouse.down();
  await page.mouse.move(toX, toY, { steps: 8 });
  await page.mouse.up();
  await new Promise((resolve) => setTimeout(resolve, 150));

  const moved = await page.$eval("#dock-floating-launcher-host", (host) => host.getBoundingClientRect().toJSON());
  assert.ok(Math.abs(moved.x - start.x) > 40 || Math.abs(moved.y - start.y) > 40, "real pointer drag did not move Dock launcher");

  const second = await browser.newPage();
  await second.setViewport({ width: 1100, height: 760 });
  await second.goto(`http://127.0.0.1:${port}/second`, { waitUntil: "domcontentloaded" });
  await second.waitForSelector("#dock-floating-launcher-host", { timeout: 10000 });
  const inherited = await second.$eval("#dock-floating-launcher-host", (host) => host.getBoundingClientRect().toJSON());
  assert.ok(Math.abs(inherited.x - moved.x) <= 3, `launcher x position did not follow tabs: ${moved.x} -> ${inherited.x}`);
  assert.ok(Math.abs(inherited.y - moved.y) <= 3, `launcher y position did not follow tabs: ${moved.y} -> ${inherited.y}`);

  const clickX = inherited.x + inherited.width / 2;
  const clickY = inherited.y + inherited.height / 2;
  await second.bringToFront();
  await second.mouse.click(clickX, clickY);

  const popupUrl = `chrome-extension://${extensionId}/popup.html`;
  let popupSeen = false;
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline && !popupSeen) {
    const pages = await browser.pages();
    popupSeen = pages.some((candidate) => candidate.url().startsWith(popupUrl));
    if (!popupSeen && typeof browser.targets === "function") {
      popupSeen = browser.targets().some((target) => String(target.url?.() || "").startsWith(popupUrl));
    }
    if (!popupSeen) await new Promise((resolve) => setTimeout(resolve, 75));
  }
  assert.equal(popupSeen, true, "clicking the ordinary-page Dock launcher did not open the real Dock popup");

  const visibleDuringPopup = await second.$eval("#dock-floating-launcher-host", (host) => {
    const style = getComputedStyle(host);
    return style.visibility === "visible" && style.opacity !== "0" && style.pointerEvents !== "none";
  });
  assert.equal(visibleDuringPopup, true, "Dock launcher disappeared while popup had focus");

  await second.reload({ waitUntil: "domcontentloaded" });
  await second.waitForSelector("#dock-floating-launcher-host", { timeout: 10000 });
  assert.equal(await second.$$eval("#dock-floating-launcher-host", (hosts) => hosts.length), 1, "reload multiplied Dock launcher hosts");

  console.log("Dock 0.3.27 launcher Chrome attack PASS");
} finally {
  await browser.close().catch(() => {});
  await new Promise((resolve) => server.close(resolve));
}
