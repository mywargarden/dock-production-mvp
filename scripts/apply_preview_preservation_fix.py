from pathlib import Path

path = Path("dock-extension/core/storage.js")
text = path.read_text()

old_score = '''function dockPreviewScoreForSave20260721(value) {
  const s = String(value || "").trim();
  if (!s) return -1;
  if (/screenshot-unavailable/i.test(s)) return -1;

  const isDataImage = /^data:image\\//i.test(s);
  const isRemote = /^https?:\\/\\//i.test(s);
  const isFavicon = /google\\.com\\/s2\\/favicons|favicon\\.ico|apple-touch-icon|\\/favicon/i.test(s);

  if (isDataImage && s.length > 30000) return 100000000 + s.length;
  if (isDataImage && s.length > 1000) return 50000000 + s.length;
  if (isRemote && !isFavicon) return 20000000 + s.length;
  if (isDataImage) return 1000000 + s.length;
  if (isRemote && isFavicon) return 1000 + s.length;
  if (isRemote) return 500000 + s.length;
  return s.length;
}
'''

new_score = '''function dockPreviewScoreForSave20260721(value) {
  const s = String(value || "").trim();
  if (!s) return -1;
  if (/screenshot-unavailable/i.test(s)) return -1;

  const isDataImage = /^data:image\\//i.test(s);
  const isRemote = /^https?:\\/\\//i.test(s);
  const isFavicon = /google\\.com\\/s2\\/favicons|favicon\\.ico|apple-touch-icon|\\/favicon/i.test(s);

  // Match core/preview.js: any valid inline screenshot outranks remote
  // screenshot candidates. Small inline previews must not be displaced by icons.
  if (isDataImage) return 100000000 + s.length;
  if (isRemote && !isFavicon) return 20000000 + s.length;
  if (isRemote) return 1000 + s.length;
  return -1;
}
'''

old_fields = '''  const fields = [
    "screenshot_url",
    "screenshotUrl",
    "screenshotThumb",
    "screenshot",
    "screenshot_data_url",
    "screenshotDataUrl",
    "screenshotDataURI",
    "previewImage",
    "previewUrl",
    "preview_url",
    "thumbnail",
    "thumbnailUrl",
    "thumbnail_url",
    "image",
    "imageUrl",
    "image_url",
    "customIcon",
    "icon_url",
    "iconUrl",
    "faviconUrl",
    "favIconUrl",
    "favicon"
  ];
'''

new_fields = '''  const fields = [
    "screenshot_url",
    "screenshotUrl",
    "screenshotThumb",
    "screenshot",
    "screenshot_data_url",
    "screenshotDataUrl",
    "screenshotDataURI",
    "previewImage",
    "previewUrl",
    "preview_url",
    "thumbnail",
    "thumbnailUrl",
    "thumbnail_url"
  ];
'''

if text.count(old_score) != 1:
    raise SystemExit(f"expected one legacy save scorer, found {text.count(old_score)}")
if text.count(old_fields) != 1:
    raise SystemExit(f"expected one legacy save field list, found {text.count(old_fields)}")

text = text.replace(old_score, new_score, 1)
text = text.replace(old_fields, new_fields, 1)
path.write_text(text)
print("preview preservation convergence patch applied")
