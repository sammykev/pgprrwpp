'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('quill', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  run: (req) => ipcRenderer.invoke('ai:run', req),
  cancel: (id) => ipcRenderer.invoke('ai:cancel', id),
  onDelta: (cb) => ipcRenderer.on('ai:delta', (_e, msg) => cb(msg)),
  onStatus: (cb) => ipcRenderer.on('ai:status', (_e, msg) => cb(msg)),
  openFile: () => ipcRenderer.invoke('file:open'),
  saveFile: (text, suggestedName) => ipcRenderer.invoke('file:save', { text, suggestedName }),
});
