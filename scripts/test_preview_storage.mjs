import assert from "node:assert/strict";
import { canonicalizeMemoryPreview, makeLiteMemoryPreview } from "../dock-extension/core/preview.js";
import { canonicalizeLocalWrite } from "../dock-extension/adapters/storageCanonicalizer.js";

const dataUrl = `data:image/jpeg;base64,${"A".repeat(4096)}`;
const remoteUrl = "https://cdn.example.test/previews/page.jpg";

const legacy = {
  title: "Legacy",
  url: "https://example.test/page",
  screenshot: dataUrl,
  screenshot_data_url: dataUrl,
  screenshotUrl: dataUrl,
  screenshot_url: dataUrl,
  screenshotThumb: dataUrl,
  customIcon: "https://example.test/custom-icon.png",
  uploadedImage: "https://example.test/user-art.png",
  faviconUrl: "https://example.test/favicon.ico"
};

const canonical = canonicalizeMemoryPreview(legacy);
assert.equal(canonical.screenshotThumb, dataUrl, "inline preview should canonicalize to screenshotThumb");
for (const alias of ["screenshot", "screenshot_data_url", "screenshotUrl", "screenshot_url"]) {
  assert.equal(Object.hasOwn(canonical, alias), false, `${alias} should not survive canonicalization`);
}
assert.equal(canonical.customIcon, legacy.customIcon, "customIcon must survive preview compaction");
assert.equal(canonical.uploadedImage, legacy.uploadedImage, "uploadedImage must survive preview compaction");

const lite = makeLiteMemoryPreview(legacy);
assert.equal(Object.hasOwn(lite, "screenshotThumb"), false, "lite cache must not contain inline base64");
assert.equal(lite.customIcon, legacy.customIcon, "lite cache must preserve customIcon");

const remote = canonicalizeMemoryPreview({
  url: "https://remote.example.test",
  screenshotUrl: remoteUrl,
  screenshotThumb: "https://example.test/favicon.ico"
});
assert.equal(remote.screenshot_url, remoteUrl, "remote preview should canonicalize to screenshot_url");
assert.equal(Object.hasOwn(remote, "screenshotThumb"), false, "remote preview must not be duplicated into screenshotThumb");

const write = canonicalizeLocalWrite({
  savedTabs: [legacy],
  savedTabsLite: [legacy]
});
const serialized = JSON.stringify(write);
assert.equal(serialized.split(dataUrl).length - 1, 1, "full + lite write must persist inline preview bytes exactly once");
assert.equal(write.savedTabs[0].customIcon, legacy.customIcon);
assert.equal(write.savedTabsLite[0].customIcon, legacy.customIcon);

console.log("preview storage contract: PASS");
