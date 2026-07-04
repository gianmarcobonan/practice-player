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

const ffmpegPath = () => binPath('ffmpeg.exe');
const ytDlpPath = () => binPath('yt-dlp.exe');

// Writable data dir for per-song settings and stem cache.
// Portable build: sits next to the .exe (persists on a USB stick).
// Dev / fallback: project root /data, or userData if exe path is unknown.
function dataDir() {
  let base;
  if (process.env.PORTABLE_EXECUTABLE_DIR) {
    base = process.env.PORTABLE_EXECUTABLE_DIR;
  } else if (app.isPackaged) {
    base = path.dirname(app.getPath('exe'));
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
