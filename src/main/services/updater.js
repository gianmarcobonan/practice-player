'use strict';

// Auto-update via electron-updater (GitHub Releases feed). Only active in an
// installed (NSIS) build: dev runs and the portable exe can't self-update, so we
// skip there. Update events are forwarded to the renderer for a small status UI;
// the actual install happens on quit (or immediately via update:install).

const { app } = require('electron');

let autoUpdater = null;
let supported = false;

// A portable build sets PORTABLE_EXECUTABLE_DIR and has no installer to update.
const isPortable = () => !!process.env.PORTABLE_EXECUTABLE_DIR;
// Updates only work in an installed (packaged, non-portable) build.
function isSupported() { return supported; }
function isPortableBuild() { return app.isPackaged && isPortable(); }

function initAutoUpdate(getWindow) {
  // Dev build: nothing to update.
  if (!app.isPackaged) return;
  if (isPortable()) return;

  try {
    ({ autoUpdater } = require('electron-updater'));
  } catch {
    return; // dependency missing — silently skip
  }
  supported = true;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  const send = (payload) => {
    const w = getWindow();
    if (w && !w.isDestroyed()) w.webContents.send('update:status', payload);
  };

  autoUpdater.on('checking-for-update', () => send({ state: 'checking' }));
  autoUpdater.on('update-available', (info) => send({ state: 'available', version: info.version }));
  autoUpdater.on('update-not-available', () => send({ state: 'none' }));
  autoUpdater.on('download-progress', (p) => send({ state: 'downloading', percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', (info) => send({ state: 'downloaded', version: info.version }));
  autoUpdater.on('error', (err) => send({ state: 'error', message: String((err && err.message) || err) }));

  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  check();
  // Re-check periodically while the app stays open.
  setInterval(check, 6 * 60 * 60 * 1000);
}

// Manual "check for updates" trigger from the UI. Returns { error } if the check
// couldn't even start; otherwise progress arrives via the update:status events.
function checkForUpdates() {
  if (!autoUpdater) return { error: 'unsupported' };
  return autoUpdater.checkForUpdates().then(() => ({ ok: true })).catch((e) => ({ error: String((e && e.message) || e) }));
}

function installUpdate() {
  if (autoUpdater) autoUpdater.quitAndInstall();
}

module.exports = { initAutoUpdate, installUpdate, checkForUpdates, isSupported, isPortableBuild };
