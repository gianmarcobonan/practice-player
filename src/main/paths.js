'use strict';

const path = require('path');
const fs = require('fs');
const { app } = require('electron');

// Root that contains the `bin/` and `models/` folders.
// - packaged: extraResources puts them under process.resourcesPath
// - dev: they live at the project root (two levels up from src/main)
function resourceRoot() {
  return app.isPackaged ? process.resourcesPath : path.join(__dirname, '..', '..');
}

function binPath(name) {
  return path.join(resourceRoot(), 'bin', name);
}

function modelPath(name) {
  return path.join(resourceRoot(), 'models', name);
}

// Bundled tools are `ffmpeg.exe`/`yt-dlp.exe` on Windows, `ffmpeg`/`yt-dlp` elsewhere.
const EXE = process.platform === 'win32' ? '.exe' : '';
const ffmpegPath = () => binPath('ffmpeg' + EXE);
const ytDlpPath = () => binPath('yt-dlp' + EXE);

// Writable data dir for the AI model, stem cache and per-song settings.
// Packaged (Windows installer / Linux AppImage): a stable per-user dir
// (%APPDATA%\Practice Player on Windows, ~/.config/Practice Player on Linux).
// This SURVIVES auto-updates and reinstalls — previously data lived next to the
// .exe, inside the install folder, which the NSIS updater wipes on every update,
// forcing the ~136MB model to be re-downloaded. Now it's fetched only once, ever.
// Dev: the project root.
function dataDir() {
  const base = app.isPackaged
    ? app.getPath('userData')
    : path.join(__dirname, '..', '..');
  const dir = path.join(base, 'data');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function cacheDir(sub) {
  const dir = path.join(dataDir(), 'cache', sub || '');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

module.exports = {
  resourceRoot,
  binPath,
  modelPath,
  ffmpegPath,
  ytDlpPath,
  dataDir,
  cacheDir
};
