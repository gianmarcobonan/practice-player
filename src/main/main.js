'use strict';

const { app, BrowserWindow, ipcMain, dialog, utilityProcess } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const { decodeToPcm, hasVideoStream } = require('./services/decode');
const youtube = require('./services/youtube');
const separate = require('./services/separate');
const project = require('./services/project');
const updater = require('./services/updater');
const { dataDir, ffmpegPath } = require('./paths');

function cacheKeyFor(filePath) {
  const st = fs.statSync(filePath);
  return crypto.createHash('sha1')
    .update(`${filePath}|${st.size}|${Math.round(st.mtimeMs)}`)
    .digest('hex').slice(0, 16);
}

// Extract a real file path from an argv array (used for the .ppx file
// association, drag-onto-icon, and command-line auto-load/testing).
function fileArgFrom(argv, skip) {
  for (const a of argv.slice(skip)) {
    if (a && !a.startsWith('-') && fs.existsSync(a) && fs.statSync(a).isFile()) return a;
  }
  return null;
}

// This process's launch argument (exe is argv[0] when packaged, node+script in dev).
function fileArg() {
  return fileArgFrom(process.argv, app.isPackaged ? 1 : 2);
}

// --- Basic IPC ---
ipcMain.handle('app:ping', () => 'pong');
ipcMain.handle('app:version', () => ({
  app: app.getVersion(),
  electron: process.versions.electron,
  chrome: process.versions.chrome,
  node: process.versions.node
}));

// --- Audio loading ---
const AUDIO_EXTS = ['mp3', 'm4a', 'aac', 'wav', 'flac', 'ogg', 'opus', 'wma', 'aiff'];
const VIDEO_EXTS = ['mp4', 'webm', 'mkv', 'mov', 'avi', 'm4v'];
const MEDIA_EXTS = [...AUDIO_EXTS, ...VIDEO_EXTS];

ipcMain.handle('audio:openDialog', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Apri un brano o un video',
    properties: ['openFile'],
    filters: [
      { name: 'Audio e video', extensions: MEDIA_EXTS },
      { name: 'Tutti i file', extensions: ['*'] }
    ]
  });
  if (res.canceled || res.filePaths.length === 0) return null;
  return res.filePaths[0];
});

// Rubber Band wasm bytes for the AudioWorklet (avoids file:// fetch/CSP issues).
ipcMain.handle('engine:wasm', async () => {
  const p = path.join(__dirname, '..', 'renderer', 'dist', 'rubberband.wasm');
  return fs.readFileSync(p);
});

// --- Per-song settings ---
function settingsDir() {
  const d = path.join(dataDir(), 'settings');
  fs.mkdirSync(d, { recursive: true });
  return d;
}
ipcMain.handle('settings:get', (_e, filePath) => {
  try {
    const f = path.join(settingsDir(), cacheKeyFor(filePath) + '.json');
    return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
  } catch { return null; }
});
ipcMain.handle('settings:set', (_e, filePath, data) => {
  try {
    fs.writeFileSync(path.join(settingsDir(), cacheKeyFor(filePath) + '.json'), JSON.stringify(data));
    return true;
  } catch { return false; }
});

// Run the separation in a utilityProcess so the heavy ONNX inference never
// blocks the main process (UI and audio stay responsive). Resolves when the
// worker has written the disk cache; progress is forwarded to the renderer.
function runSeparationWorker(job, onProgress) {
  return new Promise((resolve, reject) => {
    const child = utilityProcess.fork(path.join(__dirname, 'separate-worker.js'));
    let settled = false;
    const finish = (fn, arg) => { if (settled) return; settled = true; try { child.kill(); } catch {} fn(arg); };

    child.on('message', (msg) => {
      if (!msg) return;
      if (msg.type === 'progress') onProgress(msg.payload);
      else if (msg.type === 'done') finish(resolve);
      else if (msg.type === 'error') finish(reject, new Error(msg.message || 'separazione fallita'));
    });
    child.on('exit', (code) => {
      if (!settled) finish(reject, new Error(`worker terminato (codice ${code})`));
    });
    child.postMessage(job);
  });
}

ipcMain.handle('stem:separate', async (evt, filePath) => {
  const modelDir = path.join(dataDir(), 'models');
  const key = cacheKeyFor(filePath);
  const cacheDir = path.join(dataDir(), 'cache', 'stems', key);

  if (!separate.readCache(cacheDir)) {
    await runSeparationWorker(
      { filePath, ffmpegPath: ffmpegPath(), modelDir, cacheDir },
      (p) => evt.sender.send('stem:progress', p)
    );
  }

  const cached = separate.readCache(cacheDir);
  return { sources: separate.SOURCES, total: cached.total, sampleRate: separate.SR, stems: cached.stems };
});

// --- Single-file project (.ppx): media + settings bundled together ---
ipcMain.handle('project:save', async (_evt, mediaPath, settings, suggestedName, targetPath) => {
  if (!mediaPath || !fs.existsSync(mediaPath)) throw new Error('Nessun brano da salvare.');
  // Overwrite the open project directly when a target path is given; otherwise
  // prompt for a location ("Salva con nome" / first save of a new project).
  let dest = targetPath;
  if (!dest) {
    const base = (suggestedName || 'progetto').replace(/[\\/:*?"<>|]+/g, '_');
    const res = await dialog.showSaveDialog(mainWindow, {
      title: 'Salva progetto',
      defaultPath: base + '.ppx',
      filters: [{ name: 'Progetto Practice Player', extensions: ['ppx'] }]
    });
    if (res.canceled || !res.filePath) return null;
    dest = res.filePath;
  }
  await project.save(mediaPath, settings, dest);
  return dest;
});

ipcMain.handle('project:open', async (_evt, ppxPath) => {
  let p = ppxPath;
  if (!p) {
    const res = await dialog.showOpenDialog(mainWindow, {
      title: 'Apri progetto',
      properties: ['openFile'],
      filters: [{ name: 'Progetto Practice Player', extensions: ['ppx'] }]
    });
    if (res.canceled || res.filePaths.length === 0) return null;
    p = res.filePaths[0];
  }
  const { mediaPath, settings } = await project.load(p, path.join(dataDir(), 'projects'));
  return { mediaPath, settings, projectPath: p };
});

// --- Export processed audio / audio+video ---
function runExportWorker(job, onProgress) {
  return new Promise((resolve, reject) => {
    const child = utilityProcess.fork(path.join(__dirname, 'export-worker.js'));
    let settled = false;
    const finish = (fn, arg) => { if (settled) return; settled = true; try { child.kill(); } catch {} fn(arg); };
    child.on('message', (msg) => {
      if (!msg) return;
      if (msg.type === 'progress') onProgress(msg.payload);
      else if (msg.type === 'done') finish(resolve, msg.outPath);
      else if (msg.type === 'error') finish(reject, new Error(msg.message || 'export fallito'));
    });
    child.on('exit', (code) => { if (!settled) finish(reject, new Error(`export terminato (codice ${code})`)); });
    child.postMessage(job);
  });
}

ipcMain.handle('export:render', async (evt, opts) => {
  const { filePath, mode, settings, useStems, suggestedName } = opts;
  if (!filePath || !fs.existsSync(filePath)) throw new Error('Nessun brano caricato.');
  const isVideo = mode === 'video';
  const ext = isVideo ? 'mp4' : 'mp3';
  const base = (suggestedName || 'export').replace(/[\\/:*?"<>|]+/g, '_');
  const res = await dialog.showSaveDialog(mainWindow, {
    title: isVideo ? 'Esporta audio + video' : 'Esporta audio (MP3)',
    defaultPath: `${base} (modificato).${ext}`,
    filters: [{ name: isVideo ? 'Video MP4' : 'Audio MP3', extensions: [ext] }]
  });
  if (res.canceled || !res.filePath) return null;

  const key = cacheKeyFor(filePath);
  await runExportWorker({
    filePath,
    ffmpegPath: ffmpegPath(),
    wasmPath: path.join(__dirname, '..', 'renderer', 'dist', 'rubberband.wasm'),
    cacheDir: path.join(dataDir(), 'cache', 'stems', key),
    useStems: !!useStems,
    settings,
    mode,
    outPath: res.filePath,
    tmpDir: path.join(dataDir(), 'tmp')
  }, (p) => evt.sender.send('export:progress', p));
  return res.filePath;
});

ipcMain.handle('youtube:search', async (_evt, query) => {
  if (!query || !query.trim()) return [];
  return youtube.search(query.trim(), 8);
});

ipcMain.handle('youtube:streamUrl', async (_evt, url) => youtube.streamUrl(url));

ipcMain.handle('youtube:download', async (evt, url, opts) => {
  const mode = opts && opts.video ? 'video' : 'audio';
  return youtube.download(url, mode, (p) => {
    evt.sender.send('youtube:progress', p);
  });
});

ipcMain.handle('audio:decode', async (_evt, filePath) => {
  const { sampleRate, channels, frames, interleaved } = await decodeToPcm(filePath);
  // Detect a real video stream (extension is unreliable: audio-only YouTube
  // downloads can be .webm with no video).
  const isVideo = await hasVideoStream(filePath);
  return {
    name: path.basename(filePath),
    filePath,
    // file:// URL for the <video> element (handles spaces/brackets in the name).
    fileUrl: pathToFileURL(filePath).href,
    isVideo,
    sampleRate,
    channels,
    frames,
    duration: frames / sampleRate,
    // Transfer the underlying buffer to avoid a structured-clone copy.
    interleaved
  };
});

// Keep a reference so the window isn't garbage collected.
let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 820,
    minWidth: 900,
    minHeight: 640,
    backgroundColor: '#16181d',
    title: 'Practice Player',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // AudioWorklet + WASM need these standard defaults; nothing extra required.
      sandbox: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  // Forward renderer console to the main stdout (useful for headless testing).
  mainWindow.webContents.on('console-message', (_e, level, message) => {
    process.stdout.write(`[renderer] ${message}\n`);
  });

  // Auto-load a file passed on the command line once the page is ready.
  mainWindow.webContents.on('did-finish-load', () => {
    const f = fileArg();
    if (f) mainWindow.webContents.send('app:autoload', {
      filePath: f,
      autoplay: !!process.env.PP_AUTOTEST,
      separate: !!process.env.PP_AUTOTEST_STEM,
      looptest: !!process.env.PP_AUTOTEST_LOOP,
      metrotest: !!process.env.PP_AUTOTEST_METRO
    });
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Single instance: double-clicking a .ppx while the app is already open should
// focus the existing window and load that file, not spawn a second copy.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
    const f = fileArgFrom(argv, 1); // second instance is always the packaged exe
    if (f) mainWindow.webContents.send('app:autoload', { filePath: f });
  });

  app.whenReady().then(() => {
    createWindow();
    updater.initAutoUpdate(() => mainWindow);

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

// Renderer asks to restart into the freshly downloaded update.
ipcMain.handle('update:install', () => updater.installUpdate());
// Update panel: current version + whether self-update is available in this build.
ipcMain.handle('update:info', () => ({
  version: app.getVersion(),
  supported: updater.isSupported(),
  portable: updater.isPortableBuild()
}));
// Manual "check for updates" trigger.
ipcMain.handle('update:check', () => updater.checkForUpdates());

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
