'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

// Minimal, explicit API surface exposed to the renderer.
// Channels are added in later phases (file open, decode, youtube, separate, settings).
contextBridge.exposeInMainWorld('api', {
  ping: () => ipcRenderer.invoke('app:ping'),
  version: () => ipcRenderer.invoke('app:version'),

  // Audio loading
  openFileDialog: () => ipcRenderer.invoke('audio:openDialog'),
  // Absolute path of a dropped File (contextIsolation-safe).
  getPathForFile: (file) => webUtils.getPathForFile(file),
  decodeFile: (filePath) => ipcRenderer.invoke('audio:decode', filePath),
  engineWasm: () => ipcRenderer.invoke('engine:wasm'),

  // Single-file project (media + settings)
  saveProject: (mediaPath, settings, name, targetPath, includeStems, modelId) => ipcRenderer.invoke('project:save', mediaPath, settings, name, targetPath, includeStems, modelId),
  openProject: (ppxPath) => ipcRenderer.invoke('project:open', ppxPath),

  // Export (processed audio / audio+video)
  exportMedia: (opts) => ipcRenderer.invoke('export:render', opts),
  onExportProgress: (cb) => ipcRenderer.on('export:progress', (_e, p) => cb(p)),

  // Auto-update
  onUpdateStatus: (cb) => ipcRenderer.on('update:status', (_e, s) => cb(s)),
  updateInfo: () => ipcRenderer.invoke('update:info'),
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  installUpdate: () => ipcRenderer.invoke('update:install'),

  // YouTube
  searchYoutube: (query) => ipcRenderer.invoke('youtube:search', query),
  youtubeStreamUrl: (url) => ipcRenderer.invoke('youtube:streamUrl', url),
  downloadYoutube: (url, opts) => ipcRenderer.invoke('youtube:download', url, opts),
  onYoutubeProgress: (cb) => ipcRenderer.on('youtube:progress', (_e, pct) => cb(pct)),

  // Stem separation
  listModels: () => ipcRenderer.invoke('models:list'),
  separateStems: (filePath, modelId) => ipcRenderer.invoke('stem:separate', filePath, modelId),
  onStemProgress: (cb) => ipcRenderer.on('stem:progress', (_e, p) => cb(p)),

  // Per-song settings
  getSettings: (filePath) => ipcRenderer.invoke('settings:get', filePath),
  saveSettings: (filePath, data) => ipcRenderer.invoke('settings:set', filePath, data),

  // Dev/test auto-load
  onAutoload: (cb) => ipcRenderer.on('app:autoload', (_e, payload) => cb(payload))
});
