from pathlib import Path

path = Path("scripts/chrome_extension_7.mjs")
text = path.read_text()

old = '''await Promise.all([
  importPage.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 10000 }),
  importPage.click("#importBtn")
]);
await importPage.waitForFunction(() => document.body.innerText.includes("Imported Preview Card"), { timeout: 10000 });
const importedState = await importPage.evaluate(() => chrome.storage.local.get(["dockActiveGroup", "dockGroupItems"]));
const importedItems = importedState.dockGroupItems?.[importedState.dockActiveGroup] || [];
const importedTab = importedItems.find((tab) => tab.title === "Imported Preview Card");
assert.equal(importedTab?.screenshotThumb, INLINE_PREVIEW, "legacy import lost canonical preview in group storage");
assert.equal(importedTab?.screenshot, undefined, "legacy import persisted duplicate screenshot alias");
assert.equal(importedTab?.screenshotUrl, undefined, "legacy import persisted duplicate screenshotUrl alias");
const importedRenderedPreview = await importPage.evaluate(() => {
'''

new = '''await importPage.click("#importBtn");
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
'''

count = text.count(old)
if count != 1:
    raise SystemExit(f"expected exactly one legacy import navigation block, found {count}")

path.write_text(text.replace(old, new, 1))
print("Chrome import harness corrected")
