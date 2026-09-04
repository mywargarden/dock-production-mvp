#!/usr/bin/env bash
set -euo pipefail

node --check dock-extension/core/preview.js
node --check dock-extension/adapters/storageCanonicalizer.js
node --check dock-extension/core/personalScope.js
node --check dock-extension/core/auth.js
node --check dock-extension/core/license.js
node --check dock-extension/core/storage.js
node --check dock-extension/background-v2.js
node --check dock-extension/popup.js
node --check dock-extension/import-v2.js
node --check dock-extension/memories.js
node --check dock-extension/continuity-prepaint.js
node --check dock-extension/continuity.js
node scripts/test_preview_storage.mjs

node <<'NODE'
const fs = require('fs');

const manifest = JSON.parse(fs.readFileSync('dock-extension/manifest.json', 'utf8'));
if (manifest.version !== '0.3.12') throw new Error(`unexpected manifest version ${manifest.version}`);
if (manifest.background?.service_worker !== 'background-v2.js' || manifest.background?.type !== 'module') {
  throw new Error('canonical background worker not active');
}
if (!manifest.permissions?.includes('unlimitedStorage')) throw new Error('unlimitedStorage missing');
const exposed = (manifest.web_accessible_resources || []).flatMap((entry) => entry.resources || []);
if (exposed.some((resource) => resource !== 'import.html')) {
  throw new Error(`unexpected web-accessible resource: ${exposed.join(',')}`);
}

const memoriesHtml = fs.readFileSync('dock-extension/memories.html', 'utf8');
if (memoriesHtml.includes('legacy-loop-shield')) {
  throw new Error('obsolete legacy loop shield is still wired into memories.html');
}
const memoriesJs = fs.readFileSync('dock-extension/memories.js', 'utf8');
if (memoriesJs.includes('setInterval(')) {
  throw new Error('memories.js reintroduced interval polling');
}
if (memoriesJs.includes('looksLikeCenterDockWatermark') || memoriesJs.includes('__dockHideCenterWatermarkObserver')) {
  throw new Error('heuristic watermark scanner reintroduced');
}

const worker = fs.readFileSync('dock-extension/background-v2.js', 'utf8');
if (!worker.includes('ensureDockMutationAllowed')) {
  throw new Error('canonical background worker is missing mutation enforcement');
}
const importer = fs.readFileSync('dock-extension/import-v2.js', 'utf8');
if (!importer.includes('await ensureDockMutationAllowed()')) {
  throw new Error('shared Dock import is missing mutation enforcement');
}
const adapter = fs.readFileSync('dock-extension/adapters/index.js', 'utf8');
if (!adapter.includes('wrapExtensionStorage')) {
  throw new Error('canonical storage adapter is not active');
}

const canonicalizer = fs.readFileSync('dock-extension/adapters/storageCanonicalizer.js', 'utf8');
if (!canonicalizer.includes('makeLiteMemoryPreview')) {
  throw new Error('lite memory writes are not using preview compaction');
}
const preview = fs.readFileSync('dock-extension/core/preview.js', 'utf8');
for (const protectedField of ['customIcon', 'uploadedImage', 'cardImage', 'customImage']) {
  if (preview.includes(`delete next.${protectedField}`)) {
    throw new Error(`preview canonicalizer must not destroy ${protectedField}`);
  }
}
NODE

./scripts/find_junk.sh
