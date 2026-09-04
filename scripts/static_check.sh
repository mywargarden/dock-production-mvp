#!/usr/bin/env bash
set -euo pipefail

node --check dock-extension/core/preview.js
node --check dock-extension/adapters/storageCanonicalizer.js
node --check dock-extension/core/personalScope.js
node --check dock-extension/core/auth.js
node --check dock-extension/core/license.js
node --check dock-extension/core/storage.js
node --check dock-extension/background-v2.js
node --check dock-extension/background-v3.js
node --check dock-extension/floating-dock.js
node --check dock-extension/launcher.js
node --check dock-extension/newtab.js
node --check dock-extension/popup.js
node --check dock-extension/import-v2.js
node --check dock-extension/memories.js
node --check dock-extension/continuity-prepaint.js
node --check dock-extension/continuity.js
node scripts/test_preview_storage.mjs

node <<'NODE'
const fs = require('fs');

const manifest = JSON.parse(fs.readFileSync('dock-extension/manifest.json', 'utf8'));
if (manifest.version !== '0.3.15') throw new Error(`unexpected manifest version ${manifest.version}`);
if (manifest.background?.service_worker !== 'background-v3.js' || manifest.background?.type !== 'module') {
  throw new Error('Dock 0.3.15 popup bridge worker not active');
}
if (manifest.chrome_url_overrides?.newtab !== 'newtab.html') {
  throw new Error('Dock 0.3.15 does not own the Chrome New Tab surface');
}

const expectedPermissions = ['activeTab','alarms','identity','identity.email','storage','tabs','unlimitedStorage'].sort();
const actualPermissions = [...(manifest.permissions || [])].sort();
if (JSON.stringify(actualPermissions) !== JSON.stringify(expectedPermissions)) {
  throw new Error(`unexpected permission drift: ${actualPermissions.join(',')}`);
}

const contentScripts = manifest.content_scripts || [];
if (contentScripts.length !== 1) throw new Error(`expected exactly one content script declaration, got ${contentScripts.length}`);
const launcherContent = contentScripts[0] || {};
if (JSON.stringify(launcherContent.js || []) !== JSON.stringify(['floating-dock.js'])) {
  throw new Error(`unexpected content-script files: ${JSON.stringify(launcherContent.js || [])}`);
}
const launcherMatches = [...(launcherContent.matches || [])].sort();
if (JSON.stringify(launcherMatches) !== JSON.stringify(['http://*/*','https://*/*'].sort())) {
  throw new Error(`floating launcher escaped ordinary web pages: ${launcherMatches.join(',')}`);
}

const exposed = (manifest.web_accessible_resources || []).flatMap((entry) => entry.resources || []).sort();
const expectedExposed = ['assets/dock_logo_clean.png','import.html'].sort();
if (JSON.stringify(exposed) !== JSON.stringify(expectedExposed)) {
  throw new Error(`unexpected web-accessible resources: ${exposed.join(',')}`);
}

const bridge = fs.readFileSync('dock-extension/background-v3.js', 'utf8');
if (!bridge.includes('import "./background-v2.js"')) throw new Error('background bridge no longer inherits canonical worker');
if (!bridge.includes('OPEN_DOCK_POPUP') || !bridge.includes('action.openPopup')) throw new Error('floating launcher popup bridge missing');
if (!bridge.includes('isAllowedLauncherSender')) throw new Error('floating launcher sender validation missing');
if (!bridge.includes('newtab.html')) throw new Error('Dock New Tab is not an allowed popup sender');

const floating = fs.readFileSync('dock-extension/floating-dock.js', 'utf8');
for (const required of ['window.top !== window', 'attachShadow', 'dockLauncherPosition', 'OPEN_DOCK_POPUP', 'dock_logo_clean.png', 'SET_DOCK_LAUNCHER_CAPTURE_HIDDEN', 'renderVisibility']) {
  if (!floating.includes(required)) throw new Error(`floating launcher invariant missing: ${required}`);
}
if (floating.includes('setInterval(') || floating.includes('MutationObserver')) {
  throw new Error('floating launcher introduced polling or page-wide observation');
}

const newtabHtml = fs.readFileSync('dock-extension/newtab.html', 'utf8');
const newtabJs = fs.readFileSync('dock-extension/newtab.js', 'utf8');
for (const required of ['dockLauncher', 'searchInput', 'dock_logo_clean.png']) {
  if (!newtabHtml.includes(required)) throw new Error(`Dock New Tab markup missing: ${required}`);
}
for (const required of ['dockLauncherPosition', 'OPEN_DOCK_POPUP', 'resolveNavigation']) {
  if (!newtabJs.includes(required)) throw new Error(`Dock New Tab behavior missing: ${required}`);
}
if (newtabJs.includes('setInterval(') || newtabJs.includes('MutationObserver')) {
  throw new Error('Dock New Tab introduced polling or page-wide observation');
}

const worker = fs.readFileSync('dock-extension/background-v2.js', 'utf8');
if (!worker.includes('ensureDockMutationAllowed')) throw new Error('canonical background worker is missing mutation enforcement');
if (!worker.includes('SET_DOCK_LAUNCHER_CAPTURE_HIDDEN') || !worker.includes('setLauncherCaptureHidden')) {
  throw new Error('bulk screenshot launcher exclusion missing');
}

const popup = fs.readFileSync('dock-extension/popup.js', 'utf8');
if (!popup.includes('SET_DOCK_LAUNCHER_CAPTURE_HIDDEN')) throw new Error('single-save screenshot launcher exclusion missing');

const memoriesHtml = fs.readFileSync('dock-extension/memories.html', 'utf8');
if (memoriesHtml.includes('legacy-loop-shield')) throw new Error('obsolete legacy loop shield is still wired into memories.html');
if (!memoriesHtml.includes('assets/dock_logo_clean.png')) throw new Error('Safe Harbor launcher is not using clean Dock mark');

const launcherJs = fs.readFileSync('dock-extension/launcher.js', 'utf8');
if (!launcherJs.includes('OPEN_DOCK_POPUP') || !launcherJs.includes('dockLauncherPosition')) {
  throw new Error('Safe Harbor launcher is not sharing the canonical popup/position path');
}

const memoriesJs = fs.readFileSync('dock-extension/memories.js', 'utf8');
if (memoriesJs.includes('setInterval(')) throw new Error('memories.js reintroduced interval polling');
if (memoriesJs.includes('looksLikeCenterDockWatermark') || memoriesJs.includes('__dockHideCenterWatermarkObserver')) {
  throw new Error('heuristic watermark scanner reintroduced');
}

const importer = fs.readFileSync('dock-extension/import-v2.js', 'utf8');
if (!importer.includes('await ensureDockMutationAllowed()')) throw new Error('shared Dock import is missing mutation enforcement');
const adapter = fs.readFileSync('dock-extension/adapters/index.js', 'utf8');
if (!adapter.includes('wrapExtensionStorage')) throw new Error('canonical storage adapter is not active');

const canonicalizer = fs.readFileSync('dock-extension/adapters/storageCanonicalizer.js', 'utf8');
if (!canonicalizer.includes('makeLiteMemoryPreview')) throw new Error('lite memory writes are not using preview compaction');
const preview = fs.readFileSync('dock-extension/core/preview.js', 'utf8');
for (const protectedField of ['customIcon', 'uploadedImage', 'cardImage', 'customImage']) {
  if (preview.includes(`delete next.${protectedField}`)) throw new Error(`preview canonicalizer must not destroy ${protectedField}`);
}
NODE

./scripts/find_junk.sh
