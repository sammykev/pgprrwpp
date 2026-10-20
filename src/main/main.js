'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell, safeStorage, Menu } = require('electron');
const fs = require('fs');
const path = require('path');
const { runTask, createClient, friendlyError, MODELS } = require('./ai');
const { runNvidiaTask, NVIDIA_MODELS } = require('./nvidia');
const { SettingsStore } = require('./settings');
const { TONES, DRAFT_TYPES, CITATION_STYLES, PARAPHRASE_MODES } = require('./prompts');

let settings;
let win;
const running = new Map(); // request id -> AbortController

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    title: 'Quillwise',
    backgroundColor: '#f7f7f5',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  // Links in results open in the default browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
}

ipcMain.handle('settings:get', () => ({
  ...settings.publicView(),
  options: { models: MODELS, nvidiaModels: NVIDIA_MODELS, tones: TONES, draftTypes: DRAFT_TYPES, citationStyles: CITATION_STYLES, paraphraseModes: Object.keys(PARAPHRASE_MODES) },
}));

ipcMain.handle('settings:set', (_e, patch) => settings.update(patch || {}));

ipcMain.handle('ai:run', async (event, { id, task, input, opts }) => {
  const controller = new AbortController();
  running.set(id, controller);
  try {
    const common = {
      task,
      input,
      opts,
      settings: settings.data,
      signal: controller.signal,
      onDelta: (text) => event.sender.send('ai:delta', { id, text }),
      onStatus: (text) => event.sender.send('ai:status', { id, text }),
    };
    const result = settings.data.provider === 'nvidia'
      ? await runNvidiaTask({
        ...common,
        apiKey: settings.getApiKey('nvidia'),
        model: settings.data.nvidiaModel,
        searchKeys: { tavily: settings.getApiKey('tavily'), openalex: settings.getApiKey('openalex') },
      })
      : await runTask({ ...common, client: createClient(settings.getApiKey('anthropic')) });
    return { ok: true, ...result };
  } catch (err) {
    return { ok: false, error: friendlyError(err) };
  } finally {
    running.delete(id);
  }
});

ipcMain.handle('ai:cancel', (_e, id) => {
  const c = running.get(id);
  if (c) c.abort();
});

ipcMain.handle('file:open', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
    filters: [{ name: 'Text', extensions: ['txt', 'md'] }],
  });
  if (canceled || !filePaths[0]) return null;
  return { path: filePaths[0], text: fs.readFileSync(filePaths[0], 'utf8') };
});

ipcMain.handle('file:save', async (_e, { text, suggestedName }) => {
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    defaultPath: suggestedName || 'document.txt',
    filters: [{ name: 'Text', extensions: ['txt'] }, { name: 'Markdown', extensions: ['md'] }],
  });
  if (canceled || !filePath) return null;
  fs.writeFileSync(filePath, text, 'utf8');
  return filePath;
});

app.whenReady().then(() => {
  settings = new SettingsStore(app.getPath('userData'), safeStorage);
  Menu.setApplicationMenu(null);
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
