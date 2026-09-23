const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { buildPlan, executePlan, undoBatch } = require('./core.cjs');

let activePlan = null;
const dataFile = () => path.join(app.getPath('userData'), 'desktop-tidy.json');
function defaults() { return { archiveRoot: path.join(app.getPath('desktop'), '桌面整理'), rules: [], history: [] }; }
function readStore() { try { return { ...defaults(), ...JSON.parse(fs.readFileSync(dataFile(), 'utf8')) }; } catch { return defaults(); } }
function writeStore(store) { fs.mkdirSync(path.dirname(dataFile()), { recursive: true }); fs.writeFileSync(dataFile(), JSON.stringify(store, null, 2)); }
function sameVolume(a, b) { return path.parse(path.resolve(a)).root.toLowerCase() === path.parse(path.resolve(b)).root.toLowerCase(); }

function createWindow() {
  const win = new BrowserWindow({ width: 1320, height: 840, minWidth: 980, minHeight: 650, backgroundColor: '#f6f7f3', title: '桌面清洁助手', webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true } });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}
app.whenReady().then(() => { createWindow(); app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); }); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

ipcMain.handle('state', () => ({ ...readStore(), desktopPath: app.getPath('desktop') }));
ipcMain.handle('scan', () => {
  const store = readStore();
  activePlan = buildPlan(app.getPath('desktop'), store.archiveRoot, store.rules);
  return activePlan;
});
ipcMain.handle('execute', (_event, plan) => {
  const store = readStore();
  if (!sameVolume(app.getPath('desktop'), store.archiveRoot)) throw new Error('归档根目录必须与桌面位于同一磁盘分区；为保护撤销能力，本版本不执行跨磁盘移动。');
  const batch = executePlan(plan || activePlan);
  store.history.unshift(batch); store.history = store.history.slice(0, 30); writeStore(store); activePlan = null;
  return batch;
});
ipcMain.handle('undo', (_event, batchId) => {
  const store = readStore(); const found = store.history.find(batch => batch.id === batchId);
  if (!found) throw new Error('未找到本次整理记录');
  const restored = undoBatch(found); Object.assign(found, restored); writeStore(store); return restored;
});
ipcMain.handle('save-settings', (_event, settings) => {
  const store = readStore();
  if (!settings.archiveRoot || !sameVolume(app.getPath('desktop'), settings.archiveRoot)) throw new Error('归档根目录需与桌面在同一磁盘分区。');
  store.archiveRoot = settings.archiveRoot; store.rules = settings.rules || []; writeStore(store); return store;
});
ipcMain.handle('choose-root', async () => { const result = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] }); return result.canceled ? null : result.filePaths[0]; });
ipcMain.handle('open-path', (_event, target) => shell.openPath(target));
