import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const extensionPath = path.join(root, "dock-extension");

const browser = await puppeteer.launch({
  headless: false,
  enableExtensions: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--no-first-run", "--no-default-browser-check"]
});

function elapsedMs(start) {
  return Number(process.hrtime.bigint() - start) / 1e6;
}

try {
  const extensionId = await browser.installExtension(extensionPath);
  assert.match(extensionId, /^[a-p]{32}$/, "Chrome did not return a valid Dock extension id");

  const seed = await browser.newPage();
  await seed.goto(`chrome-extension://${extensionId}/newtab.html`, { waitUntil: "domcontentloaded" });

  // Build a genuine image payload large enough to punish aggregate deserialization.
  const fixture = await seed.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 420;
    const ctx = canvas.getContext("2d", { alpha: false });
    const image = ctx.createImageData(canvas.width, canvas.height);
    let state = 0x12345678;
    for (let i = 0; i < image.data.length; i += 4) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      image.data[i] = state & 255;
      image.data[i + 1] = (state >>> 8) & 255;
      image.data[i + 2] = (state >>> 16) & 255;
      image.data[i + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
    const shot = canvas.toDataURL("image/jpeg", 0.42);

    const savedTabs = Array.from({ length: 24 }, (_, i) => ({
      id: `legacy_${i}`,
      local_id: `legacy_${i}`,
      title: `Heavy memory ${i + 1}`,
      url: `https://example.com/heavy-${i + 1}`,
      reason: "cold-start fixture",
      savedAt: Date.now() - i,
      screenshotThumb: shot,
      screenshotBlocked: false,
      position: i
    }));

    // Seed with raw chrome.storage, bypassing Dock's new write externalizer,
    // to simulate an upgraded real user whose old profile still embeds screenshots.
    await chrome.storage.local.clear();
    await chrome.storage.local.set({
      savedTabs,
      savedTabsLite: savedTabs.map(({ screenshotThumb, ...rest }) => rest),
      dockGroups: [{ id: "group_heavy", name: "Heavy Group", color: "#8fd8c6" }],
      dockActiveGroup: "",
      dockGroupItems: {
        group_heavy: savedTabs.slice(0, 12).map((item, index) => ({
          ...item,
          id: `group_${index}`,
          local_id: `group_${index}`,
          url: `https://example.org/group-${index + 1}`,
          position: index
        }))
      }
    });

    return {
      shotLength: shot.length,
      legacyBytes: JSON.stringify(savedTabs).length
    };
  });

  assert.ok(fixture.shotLength > 100000, `fixture screenshot unexpectedly small: ${fixture.shotLength}`);
  assert.ok(fixture.legacyBytes > 2400000, `legacy aggregate not heavy enough: ${fixture.legacyBytes}`);

  const migrationStart = process.hrtime.bigint();
  const migration = await seed.evaluate(async () => {
    return await chrome.runtime.sendMessage({ type: "MIGRATE_DOCK_PREVIEW_PAYLOADS" });
  });
  const migrationMs = elapsedMs(migrationStart);
  assert.equal(migration?.ok, true, `preview migration failed: ${JSON.stringify(migration)}`);

  const storageState = await seed.evaluate(async () => {
    const all = await chrome.storage.local.get(null);
    const aggregate = JSON.stringify({
      savedTabs: all.savedTabs,
      savedTabsLite: all.savedTabsLite,
      dockGroupItems: all.dockGroupItems
    });
    const previewKeys = Object.keys(all).filter((key) => key.startsWith("dockPreviewPayload:v1:"));
    return {
      aggregateLength: aggregate.length,
      aggregateHasInline: /data:image\//i.test(aggregate),
      previewKeyCount: previewKeys.length,
      savedRefCount: (all.savedTabs || []).filter((item) => /^pv1_/i.test(item.previewRef || "")).length,
      groupRefCount: Object.values(all.dockGroupItems || {}).flat().filter((item) => /^pv1_/i.test(item.previewRef || "")).length
    };
  });

  assert.equal(storageState.aggregateHasInline, false, "hot aggregate still contains inline screenshot bytes after migration");
  assert.equal(storageState.savedRefCount, 24, "not every saved memory received a previewRef");
  assert.equal(storageState.groupRefCount, 12, "not every group memory received a previewRef");
  assert.ok(storageState.previewKeyCount >= 36, `expected split preview payload keys, got ${storageState.previewKeyCount}`);
  assert.ok(storageState.aggregateLength < 120000, `hot aggregate still too large: ${storageState.aggregateLength}`);

  // Popup: metadata must surface quickly and the first screenshot must resolve
  // from the split payload store without waiting on network hydration.
  const popup = await browser.newPage();
  const popupStart = process.hrtime.bigint();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: "domcontentloaded" });
  await popup.waitForSelector("#tabList .tabItem", { timeout: 2500 });
  const popupMetadataMs = elapsedMs(popupStart);
  await popup.waitForFunction(() => {
    const img = document.querySelector("#tabList .tabItem .thumb img");
    return !!img && /^data:image\//i.test(img.src || "") && img.complete && img.naturalWidth > 0;
  }, { timeout: 2500 });
  const popupPreviewMs = elapsedMs(popupStart);

  // Safe Harbor: same contract, then repeat on a hard reload because that was
  // the user's persistent failure mode.
  const harbor = await browser.newPage();
  const harborStart = process.hrtime.bigint();
  await harbor.goto(`chrome-extension://${extensionId}/memories.html`, { waitUntil: "domcontentloaded" });
  await harbor.waitForSelector("#grid .card", { timeout: 2500 });
  const harborMetadataMs = elapsedMs(harborStart);
  await harbor.waitForFunction(() => {
    const img = document.querySelector("#grid .card .preview img");
    return !!img && /^data:image\//i.test(img.src || "") && img.complete && img.naturalWidth > 0;
  }, { timeout: 2500 });
  const harborPreviewMs = elapsedMs(harborStart);

  const reloadStart = process.hrtime.bigint();
  await harbor.reload({ waitUntil: "domcontentloaded" });
  await harbor.waitForSelector("#grid .card", { timeout: 2500 });
  const reloadMetadataMs = elapsedMs(reloadStart);
  await harbor.waitForFunction(() => {
    const img = document.querySelector("#grid .card .preview img");
    return !!img && /^data:image\//i.test(img.src || "") && img.complete && img.naturalWidth > 0;
  }, { timeout: 2500 });
  const reloadPreviewMs = elapsedMs(reloadStart);

  assert.ok(popupMetadataMs < 1800, `popup metadata too slow: ${popupMetadataMs.toFixed(0)}ms`);
  assert.ok(popupPreviewMs < 2500, `popup preview too slow: ${popupPreviewMs.toFixed(0)}ms`);
  assert.ok(harborMetadataMs < 1800, `Safe Harbor metadata too slow: ${harborMetadataMs.toFixed(0)}ms`);
  assert.ok(harborPreviewMs < 2500, `Safe Harbor preview too slow: ${harborPreviewMs.toFixed(0)}ms`);
  assert.ok(reloadMetadataMs < 1800, `Safe Harbor reload metadata too slow: ${reloadMetadataMs.toFixed(0)}ms`);
  assert.ok(reloadPreviewMs < 2500, `Safe Harbor reload preview too slow: ${reloadPreviewMs.toFixed(0)}ms`);

  console.log("Dock preview storage Chrome 9 PASS", {
    migrationMs: Math.round(migrationMs),
    legacyAggregateBytes: fixture.legacyBytes,
    hotAggregateBytes: storageState.aggregateLength,
    previewKeys: storageState.previewKeyCount,
    popupMetadataMs: Math.round(popupMetadataMs),
    popupPreviewMs: Math.round(popupPreviewMs),
    harborMetadataMs: Math.round(harborMetadataMs),
    harborPreviewMs: Math.round(harborPreviewMs),
    reloadMetadataMs: Math.round(reloadMetadataMs),
    reloadPreviewMs: Math.round(reloadPreviewMs)
  });
} finally {
  await browser.close().catch(() => {});
}
