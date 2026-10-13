const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { buildPlan, executePlan, undoBatch } = require('./core.cjs');
const { scanFiles, queryFiles, trashIndexedFiles } = require('./search.cjs');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const runFile = promisify(execFile);
// Keep the existing user data path stable across the product rename.
app.setPath('userData', path.join(app.getPath('appData'), 'desktop-tidy'));
let searchIndex = { files: [], roots: [] }, searchRunning = false, searchCancelled = false;
const searchFile = () => path.join(app.getPath('userData'), 'file-search-index.json');
async function persistSearchIndex(index) {
  await fs.promises.mkdir(path.dirname(searchFile()), { recursive: true });
  const temporary = `${searchFile()}.tmp`;
  await fs.promises.writeFile(temporary, JSON.stringify(index));
  await fs.promises.rename(temporary, searchFile());
}

let activePlan = null;
const dataFile = () => path.join(app.getPath('userData'), 'desktop-tidy.json');
function defaults() { return { archiveRoot: path.join(app.getPath('desktop'), '桌面整理'), rules: [], history: [] }; }
function readStore() { try { return { ...defaults(), ...JSON.parse(fs.readFileSync(dataFile(), 'utf8')) }; } catch { return defaults(); } }
function writeStore(store) { fs.mkdirSync(path.dirname(dataFile()), { recursive: true }); fs.writeFileSync(dataFile(), JSON.stringify(store, null, 2)); }
function sameVolume(a, b) { return path.parse(path.resolve(a)).root.toLowerCase() === path.parse(path.resolve(b)).root.toLowerCase(); }

function createWindow() {
  const win = new BrowserWindow({ width: 1320, height: 840, minWidth: 980, minHeight: 650, backgroundColor: '#f6f7f3', title: '桌面文件管家', webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true } });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}
app.whenReady().then(async () => {
  try { searchIndex = JSON.parse(await fs.promises.readFile(searchFile(), 'utf8')); } catch { /* First launch has no index. */ }
  createWindow(); app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
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

ipcMain.handle('search-status', () => ({ ...searchIndex, files: searchIndex.files.length, running: searchRunning }));
ipcMain.handle('search-choose-folder', async () => {
  const result = await dialog.showOpenDialog({ title: '选择要搜索的文件夹', properties: ['openDirectory'] });
  return result.canceled ? null : result.filePaths[0];
});
ipcMain.handle('search-scan', async (event, folder) => {
  if (searchRunning) throw new Error('正在建立文件索引，请等待或停止本次扫描。');
  let roots;
  if (folder) {
    if (typeof folder !== 'string' || !path.isAbsolute(folder)) throw new Error('请选择有效的搜索文件夹。');
    roots = [folder];
  } else if (process.platform === 'win32') {
    const result = await runFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" | Select-Object -ExpandProperty DeviceID'], { windowsHide: true, timeout: 15000 });
    roots = result.stdout.trim().split(/\r?\n/).filter(Boolean).map(drive => `${drive.trim()}\\`);
    if (!roots.length) throw new Error('未识别到本机磁盘，请选择目标文件夹搜索。');
  } else { roots = [app.getPath('home')]; }
  searchRunning = true; searchCancelled = false;
  let lastUpdate = 0;
  try {
    const index = await scanFiles(roots, { isCancelled: () => searchCancelled, onProgress: progress => {
      if (Date.now() - lastUpdate > 250) {
        lastUpdate = Date.now();
        if (!event.sender.isDestroyed()) event.sender.send('search-progress', progress);
      }
    } });
    searchIndex = index;
    await persistSearchIndex(index);
    return { ...index, files: index.files.length };
  } finally { searchRunning = false; }
});
ipcMain.handle('search-cancel', () => { searchCancelled = true; });
ipcMain.handle('search-query', (_event, filters) => queryFiles(searchIndex.files, filters, readStore().rules));
ipcMain.handle('search-reveal', (_event, target) => {
  if (!searchIndex.files.some(file => file.path === target) || !fs.existsSync(target)) throw new Error('文件已移动或删除，请更新索引。');
  shell.showItemInFolder(target);
});
ipcMain.handle('search-open', async (_event, target) => {
  if (!searchIndex.files.some(file => file.path === target) || !fs.existsSync(target)) throw new Error('文件已移动或删除，请更新索引。');
  const error = await shell.openPath(target);
  if (error) throw new Error(error);
});
ipcMain.handle('search-trash', async (_event, paths) => {
  const result = await trashIndexedFiles(searchIndex, paths, filePath => shell.trashItem(filePath));
  await persistSearchIndex(searchIndex);
  return result;
});
