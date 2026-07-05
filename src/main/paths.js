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

// Writable data dir for per-song settings and stem cache.
// - Windows installed: next to the .exe (also handles the old portable build).
// - Linux (AppImage) / macOS: the app runs from a read-only mount, so we can't
//   write next to the exe — use the per-user data dir instead.
// - Dev: project root /data.
function dataDir() {
  let base;
  if (process.env.PORTABLE_EXECUTABLE_DIR) {
    base = process.env.PORTABLE_EXECUTABLE_DIR;
  } else if (app.isPackaged && process.platform === 'win32') {
    base = path.dirname(app.getPath('exe'));
  } else if (app.isPackaged) {
    base = app.getPath('userData');
  } else {
    base = path.join(__dirname, '..', '..');
  }
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
