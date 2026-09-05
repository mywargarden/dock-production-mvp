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

async function waitTheme(page, expected) {
  await page.waitForFunction((theme) => document.body?.dataset?.theme === theme, { timeout: 10000 }, expected);
}

async function readState(page) {
  return await page.evaluate(async () => {
    const stored = await chrome.storage.local.get(['dockTheme', 'dockGroups', 'dockActiveGroup']);
    return {
      bodyTheme: document.body?.dataset?.theme || '',
      scope: document.body?.dataset?.dockThemeScope || '',
      activeGroup: stored.dockActiveGroup || '__all__',
      globalTheme: stored.dockTheme || '',
      groups: stored.dockGroups || []
    };
  });
}

async function openDockMenu(page, groupId) {
  const menuButton = `.groupPillWrap[data-group-id="${groupId}"] .groupPillMenuBtn`;
  await page.waitForSelector(menuButton, { visible: true, timeout: 10000 });
  await page.click(menuButton);
  await page.waitForFunction((id) => {
    const wrap = document.querySelector(`.groupPillWrap[data-group-id="${id}"]`);
    const menu = wrap?.querySelector('.groupPillMenu') || document.querySelector(`.groupPillMenu:not(.hidden)`);
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
  await waitTheme(page, 'violet-harbor');

  await chooseDockTheme(page, 'g_alpha', 'sunset');
  await waitTheme(page, 'sunset');
  let state = await readState(page);
  assert.equal(state.globalTheme, 'violet-harbor', 'per-Dock choice mutated Safe Harbor theme');
  assert.equal(state.groups.find((g) => g.id === 'g_alpha')?.theme, 'sunset');

  await page.click('.groupPillWrap[data-group-id="g_beta"] .groupPill');
  await waitTheme(page, 'violet-harbor');
  state = await readState(page);
  assert.equal(state.activeGroup, 'g_beta');

  await chooseDockTheme(page, 'g_beta', 'skipper-harbor');
  await waitTheme(page, 'skipper-harbor');
  state = await readState(page);
  assert.equal(state.groups.find((g) => g.id === 'g_beta')?.theme, 'skipper-harbor');

  await page.click('.groupPillWrap[data-group-id="g_alpha"] .groupPill');
  await waitTheme(page, 'sunset');
  await page.click('.groupPillWrap[data-group-id="g_beta"] .groupPill');
  await waitTheme(page, 'skipper-harbor');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.groupPillWrap[data-group-id="g_beta"]', { timeout: 10000 });
  await waitTheme(page, 'skipper-harbor');

  await chooseDockTheme(page, 'g_beta', '__inherit__');
  await waitTheme(page, 'violet-harbor');
  state = await readState(page);
  assert.equal(state.groups.find((g) => g.id === 'g_beta')?.theme, undefined);

  await page.evaluate(async () => {
    await chrome.storage.local.set({ dockTheme: 'rubber-ducky' });
  });
  await waitTheme(page, 'rubber-ducky');

  await page.click('.groupPillWrap[data-group-id="g_alpha"] .groupPill');
  await waitTheme(page, 'sunset');
  state = await readState(page);
  assert.equal(state.globalTheme, 'rubber-ducky');
  assert.equal(state.groups.find((g) => g.id === 'g_alpha')?.theme, 'sunset');

  console.log('Dock 0.3.16 per-Dock theme Chrome 10 PASS', {
    alpha: 'sunset',
    beta: 'inherits rubber-ducky',
    global: state.globalTheme,
    reloadPersistence: true,
    independentSwitching: true
  });
} finally {
  await browser.close();
}
