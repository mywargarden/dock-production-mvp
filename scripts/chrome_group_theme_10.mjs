import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const extensionPath = path.join(root, 'dock-extension');

const browser = await puppeteer.launch({
  headless: false,
  enableExtensions: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check']
});

async function waitTheme(page, expected, label = '') {
  try {
    await page.waitForFunction((theme) => document.body?.dataset?.theme === theme, { timeout: 10000 }, expected);
  } catch (error) {
    const state = await readState(page).catch(() => null);
    console.error('Theme wait failed', { label, expected, state });
    throw error;
  }
}

async function readState(page) {
  return await page.evaluate(async () => {
    const stored = await chrome.storage.local.get(['dockTheme', 'dockGroups', 'dockGroupThemes', 'dockActiveGroup']);
    return {
      bodyTheme: document.body?.dataset?.theme || '',
      scope: document.body?.dataset?.dockThemeScope || '',
      activeGroup: stored.dockActiveGroup || '__all__',
      globalTheme: stored.dockTheme || '',
      groupThemes: stored.dockGroupThemes || {},
      groups: stored.dockGroups || []
    };
  });
}

async function waitActiveGroup(page, expected, label = '') {
  try {
    await page.waitForFunction(async (id) => {
      const stored = await chrome.storage.local.get(['dockActiveGroup']);
      return (stored.dockActiveGroup || '__all__') === id;
    }, { timeout: 10000 }, expected);
  } catch (error) {
    console.error('Active-group wait failed', { label, expected, state: await readState(page).catch(() => null) });
    throw error;
  }
}

async function openDockMenu(page, groupId) {
  const menuButton = `.groupPillWrap[data-group-id="${groupId}"] .groupPillMenuBtn`;
  await page.waitForSelector(menuButton, { visible: true, timeout: 10000 });
  await page.click(menuButton);
  await page.waitForFunction((id) => {
    const wrap = document.querySelector(`.groupPillWrap[data-group-id="${id}"]`);
    const menu = wrap?.querySelector('.groupPillMenu') || document.querySelector('.groupPillMenu:not(.hidden)');
    return !!menu && !menu.classList.contains('hidden') && !!menu.querySelector('[data-dock-group-theme-entry]');
  }, { timeout: 10000 }, groupId);
}

async function chooseDockTheme(page, groupId, theme) {
  await openDockMenu(page, groupId);
  await page.evaluate((id) => {
    const wrap = document.querySelector(`.groupPillWrap[data-group-id="${id}"]`);
    const menu = wrap?.querySelector('.groupPillMenu') || document.querySelector('.groupPillMenu:not(.hidden)');
    const entry = menu?.querySelector('[data-dock-group-theme-entry]');
    if (!entry) throw new Error('Theme entry missing');
    entry.click();
  }, groupId);
  await page.waitForSelector('.dockGroupThemePopover:not(.hidden)', { visible: true, timeout: 10000 });
  await page.click(`.dockGroupThemeChoice[data-theme="${theme}"]`);
}

async function clickDock(page, groupId, expectedTheme, label) {
  await page.click(`.groupPillWrap[data-group-id="${groupId}"] .groupPill`);
  await Promise.all([
    waitActiveGroup(page, groupId, label),
    waitTheme(page, expectedTheme, label)
  ]);
}

try {
  const extensionId = await browser.installExtension(extensionPath);
  assert.match(extensionId, /^[a-p]{32}$/);
  const dock = (await browser.extensions()).get(extensionId);
  assert.ok(dock);
  assert.equal(dock.version, '0.3.16');

  const page = await browser.newPage();
  await page.goto(`chrome-extension://${extensionId}/memories.html`, { waitUntil: 'domcontentloaded' });

  await page.evaluate(async () => {
    await chrome.storage.local.set({
      dockTheme: 'violet-harbor',
      dockGroupThemes: {},
      dockGroups: [
        { id: 'g_alpha', name: 'Alpha Dock', color: '#7bc9bc', createdAt: Date.now() - 1000 },
        { id: 'g_beta', name: 'Beta Dock', color: '#ef9c77', createdAt: Date.now() }
      ],
      dockGroupItems: {
        g_alpha: [{ title: 'Alpha', url: 'https://example.com/alpha', savedAt: Date.now(), position: 0, workspaceId: 'g_alpha' }],
        g_beta: [{ title: 'Beta', url: 'https://example.com/beta', savedAt: Date.now(), position: 0, workspaceId: 'g_beta' }]
      },
      dockActiveGroup: 'g_alpha'
    });
  });

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.groupPillWrap[data-group-id="g_alpha"]', { timeout: 10000 });
  await waitTheme(page, 'violet-harbor', 'alpha inherits global initially');

  await chooseDockTheme(page, 'g_alpha', 'sunset');
  await waitTheme(page, 'sunset', 'alpha set sunset');
  let state = await readState(page);
  assert.equal(state.globalTheme, 'violet-harbor', 'per-Dock choice mutated Safe Harbor theme');
  assert.equal(state.groupThemes.g_alpha, 'sunset');

  await clickDock(page, 'g_beta', 'violet-harbor', 'switch to beta inherited');

  await chooseDockTheme(page, 'g_beta', 'skipper-harbor');
  await waitTheme(page, 'skipper-harbor', 'beta set skipper');
  state = await readState(page);
  assert.equal(state.groupThemes.g_beta, 'skipper-harbor');
  assert.equal(state.groupThemes.g_alpha, 'sunset', 'switching/settings beta clobbered alpha theme');

  await clickDock(page, 'g_alpha', 'sunset', 'switch beta to alpha');
  await clickDock(page, 'g_beta', 'skipper-harbor', 'switch alpha to beta');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.groupPillWrap[data-group-id="g_beta"]', { timeout: 10000 });
  await waitTheme(page, 'skipper-harbor', 'beta reload persistence');
  state = await readState(page);
  assert.equal(state.groupThemes.g_alpha, 'sunset');
  assert.equal(state.groupThemes.g_beta, 'skipper-harbor');

  await chooseDockTheme(page, 'g_beta', '__inherit__');
  await waitTheme(page, 'violet-harbor', 'beta returns to inheritance');
  state = await readState(page);
  assert.equal(state.groupThemes.g_beta, undefined);
  assert.equal(state.groupThemes.g_alpha, 'sunset');

  await page.evaluate(async () => { await chrome.storage.local.set({ dockTheme: 'rubber-ducky' }); });
  await waitTheme(page, 'rubber-ducky', 'inherited beta follows changed global');

  await clickDock(page, 'g_alpha', 'sunset', 'explicit alpha ignores changed global');
  state = await readState(page);
  assert.equal(state.globalTheme, 'rubber-ducky');
  assert.equal(state.groupThemes.g_alpha, 'sunset');

  console.log('Dock 0.3.16 per-Dock theme Chrome 10 PASS', {
    alpha: 'sunset',
    beta: 'inherits rubber-ducky',
    global: state.globalTheme,
    sidecarIsolation: true,
    reloadPersistence: true,
    independentSwitching: true
  });
} finally {
  await browser.close();
}
