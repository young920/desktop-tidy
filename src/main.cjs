const { app, BrowserWindow, ipcMain, dialog, shell, screen } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { buildPlan, executePlan, undoBatch } = require('./core.cjs');
const { scanFiles, scanFilesIncremental, queryFiles, trashIndexedFiles } = require('./search.cjs');
const { validateManagerRoot, validateFolder, validateTargetFolder, inspectPaneEntry, readFolder, readTargetFolder, readFolderWithin, searchPaneFolder, moveEntries, moveEntriesBetween, renameEntry, trashEntries, createFolder, createPaneFolder, undoMoveBatch } = require('./file-manager.cjs');
const { conversionTargets, planConversion, nextAvailablePath, mergePdfFiles, imagesToPdf } = require('./converter.cjs');
const { pathToFileURL } = require('node:url');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const runFile = promisify(execFile);
// Keep the existing user data path stable across the product rename.
app.setPath('userData', process.env.FILE_MANAGER_TEST_USER_DATA || path.join(app.getPath('appData'), 'desktop-tidy'));
let searchIndex = { files: [], folders: [], roots: [], folderIndexReady: false }, searchRunning = false, searchCancelled = false;
const searchFile = () => path.join(app.getPath('userData'), 'file-search-index.json');
async function persistSearchIndex(index) {
  await fs.promises.mkdir(path.dirname(searchFile()), { recursive: true });
  const temporary = `${searchFile()}.tmp`;
  await fs.promises.writeFile(temporary, JSON.stringify(index));
  await fs.promises.rename(temporary, searchFile());
}

let activePlan = null;
const dataFile = () => path.join(app.getPath('userData'), 'desktop-tidy.json');
function defaults() { return { archiveRoot: path.join(app.getPath('desktop'), '桌面整理'), managementRoot: null, managerTarget: null, rules: [], history: [] }; }
function moveHistoryFile() { return path.join(app.getPath('userData'), 'file-manager-history.json'); }
function readMoveHistory() { try { return JSON.parse(fs.readFileSync(moveHistoryFile(), 'utf8')); } catch { return []; } }
function readStore() { try { return { ...defaults(), ...JSON.parse(fs.readFileSync(dataFile(), 'utf8')) }; } catch { return defaults(); } }
function writeStore(store) { fs.mkdirSync(path.dirname(dataFile()), { recursive: true }); fs.writeFileSync(dataFile(), JSON.stringify(store, null, 2)); }
function writeMoveHistory(history) { fs.mkdirSync(path.dirname(moveHistoryFile()), { recursive: true }); fs.writeFileSync(moveHistoryFile(), JSON.stringify(history, null, 2)); }
function sameVolume(a, b) { return path.parse(path.resolve(a)).root.toLowerCase() === path.parse(path.resolve(b)).root.toLowerCase(); }
const managerPaneRoots = { left: null, right: null };
let conversionRoot = null;
function paneSide(side) { if (side !== 'left' && side !== 'right') throw new Error('文件窗格无效。'); return side; }
function paneRoot(side) { const root = managerPaneRoots[paneSide(side)]; if (!root) throw new Error('请先为此窗格选择一个文件夹。'); return root; }
function volumeRoot(folder) { return path.parse(path.resolve(folder)).root; }
function rebaseTrashPaths(paths) {
  const isRemoved = itemPath => paths.some(removed => {
    const relative = path.relative(removed, itemPath);
    return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
  });
  searchIndex.files = searchIndex.files.filter(file => !isRemoved(file.path));
  searchIndex.folders = (searchIndex.folders || []).filter(folder => !isRemoved(folder.path));
}
function findLibreOffice() {
  const programFiles = [process.env.ProgramW6432, process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean);
  const candidates = programFiles.flatMap(folder => ['soffice.com', 'soffice.exe'].map(executable => path.join(folder, 'LibreOffice', 'program', executable)));
  for (const folder of (process.env.PATH || '').split(path.delimiter).filter(Boolean)) candidates.push(path.join(folder, 'soffice.com'), path.join(folder, 'soffice.exe'));
  return candidates.find(candidate => fs.existsSync(candidate)) || null;
}
const officeOutputFilters = { docx: 'Office Open XML Text', odt: 'writer8', xlsx: 'Calc MS Excel 2007 XML', ods: 'calc8', pptx: 'Impress MS PowerPoint 2007 XML', odp: 'impress8', pdf: null };
async function convertOfficeFile(file, targetFormat, executable) {
  const temporary = await fs.promises.mkdtemp(path.join(app.getPath('temp'), 'file-manager-convert-'));
  const outDirectory = path.join(temporary, 'out'), profile = path.join(temporary, 'profile');
  await fs.promises.mkdir(outDirectory, { recursive: true });
  try {
    const filter = officeOutputFilters[targetFormat];
    if (!(targetFormat in officeOutputFilters)) throw new Error('不支持这个 Office / ODF 输出格式。');
    const outputSpec = filter ? `${targetFormat}:${filter}` : 'pdf';
    const args = ['--headless', '--nologo', '--nodefault', `-env:UserInstallation=${pathToFileURL(profile).href}`];
    if (file.extension === 'pdf') args.push('--infilter=writer_pdf_import');
    args.push('--convert-to', outputSpec, '--outdir', outDirectory, file.path);
    await runFile(executable, args, { windowsHide: true, timeout: 120000, maxBuffer: 2 * 1024 * 1024 });
    const generated = path.join(outDirectory, `${path.basename(file.name, path.extname(file.name))}.${targetFormat}`);
    const info = await fs.promises.stat(generated).catch(() => null);
    if (!info?.isFile() || !info.size) throw new Error('转换引擎没有生成有效文件；请检查文件是否损坏或受密码保护。');
    let destination = nextAvailablePath(path.dirname(file.path), file.name, targetFormat);
    for (let attempt = 0; attempt < 100; attempt++) {
      try { await fs.promises.copyFile(generated, destination, fs.constants.COPYFILE_EXCL); return destination; }
      catch (error) { if (error.code !== 'EEXIST') throw error; destination = nextAvailablePath(path.dirname(file.path), `${path.basename(file.name, path.extname(file.name))} (${attempt + 2})`, targetFormat); }
    }
    throw new Error('无法为转换结果分配不重复的文件名。');
  } catch (error) {
    if (error.code === 'ENOENT' && error.path === executable) throw new Error('未找到 LibreOffice。请安装 LibreOffice 后重试。');
    throw error;
  } finally { await fs.promises.rm(temporary, { recursive: true, force: true }); }
}

function createWindow() {
  const display = screen.getPrimaryDisplay(), scale = Math.max(1, display.scaleFactor || 1);
  const width = Math.min(1320, Math.floor(display.workAreaSize.width / scale));
  const height = Math.min(840, Math.floor(display.workAreaSize.height / scale));
  const win = new BrowserWindow({ width, height, minWidth: Math.min(980, width), minHeight: Math.min(650, height), center: true, autoHideMenuBar: true, backgroundColor: '#fbfbfd', title: '文件管家', webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true } });
  win.on('enter-full-screen', () => win.webContents.send('window-fullscreen-changed', true));
  win.on('leave-full-screen', () => win.webContents.send('window-fullscreen-changed', false));
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}
ipcMain.handle('window-fullscreen-state', event => BrowserWindow.fromWebContents(event.sender)?.isFullScreen() || false);
ipcMain.handle('window-set-fullscreen', (event, enabled) => {
  if (typeof enabled !== 'boolean') throw new Error('全屏状态无效。');
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) throw new Error('窗口不可用。');
  win.setFullScreen(enabled);
  return win.isFullScreen();
});
app.whenReady().then(async () => {
  try {
    const savedIndex = JSON.parse(await fs.promises.readFile(searchFile(), 'utf8'));
    searchIndex = { folders: [], ...savedIndex, folderIndexReady: Array.isArray(savedIndex.folders) };
  } catch { /* First launch has no index. */ }
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

ipcMain.handle('search-status', () => ({ ...searchIndex, files: searchIndex.files.length, folders: (searchIndex.folders || []).length, running: searchRunning }));
ipcMain.handle('search-choose-folder', async () => {
  const result = await dialog.showOpenDialog({ title: '选择要搜索的文件夹', properties: ['openDirectory'] });
  return result.canceled ? null : result.filePaths[0];
});
ipcMain.handle('search-scan', async (event, folder, requestedMode = 'incremental') => {
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
    const scanOptions = { isCancelled: () => searchCancelled, onProgress: progress => {
      if (Date.now() - lastUpdate > 250) {
        lastUpdate = Date.now();
        if (!event.sender.isDestroyed()) event.sender.send('search-progress', progress);
      }
    } };
    let index;
    if (requestedMode !== 'full') {
      index = await scanFilesIncremental(roots, searchIndex, scanOptions);
      if (index.fullScanFallback) {
        const fallbackReason = index.fallbackReason;
        index = await scanFiles(roots, scanOptions);
        index.fullScanFallback = true; index.fullScanReason = fallbackReason;
      }
    } else index = await scanFiles(roots, scanOptions);
    searchIndex = index;
    searchIndex.folderIndexReady = true;
    await persistSearchIndex(index);
    return { ...index, files: index.files.length, folders: index.folders.length, folderIndexReady: true };
  } finally { searchRunning = false; }
});
ipcMain.handle('search-cancel', () => { searchCancelled = true; });
ipcMain.handle('search-query', (_event, filters) => queryFiles(searchIndex.files, filters, readStore().rules, searchIndex.folders || []));
ipcMain.handle('search-reveal', (_event, target) => {
  if (![...searchIndex.files, ...(searchIndex.folders || [])].some(item => item.path === target) || !fs.existsSync(target)) throw new Error('文件或文件夹已移动或删除，请更新索引。');
  shell.showItemInFolder(target);
});
ipcMain.handle('search-open', async (_event, target) => {
  if (![...searchIndex.files, ...(searchIndex.folders || [])].some(item => item.path === target) || !fs.existsSync(target)) throw new Error('文件或文件夹已移动或删除，请更新索引。');
  const error = await shell.openPath(target);
  if (error) throw new Error(error);
});
ipcMain.handle('search-trash', async (_event, paths) => {
  const result = await trashIndexedFiles(searchIndex, paths, filePath => shell.trashItem(filePath));
  await persistSearchIndex(searchIndex);
  return result;
});

ipcMain.handle('manager-state', () => { const store = readStore(); return { root: store.managementRoot || null, target: store.managerTarget || null, history: readMoveHistory().slice(0, 20) }; });
ipcMain.handle('manager-choose-root', async () => {
  const result = await dialog.showOpenDialog({ title: '选择文件管理范围', properties: ['openDirectory'] });
  if (result.canceled) return null;
  const root = await validateManagerRoot(result.filePaths[0]);
  const store = readStore(); store.managementRoot = root; writeStore(store);
  return root;
});
ipcMain.handle('manager-read-folder', async (_event, folderPath) => {
  const root = readStore().managementRoot;
  if (!root) throw new Error('请先选择文件管理范围。');
  return readFolder(root, folderPath || root);
});
ipcMain.handle('manager-read-target-folder', async (_event, folderPath) => readTargetFolder(folderPath));
ipcMain.handle('manager-pane-authorize', async (_event, side, folderPath) => {
  const key = paneSide(side); const current = await validateTargetFolder(folderPath); const root = volumeRoot(current);
  const store = readStore();
  const allowedRoots = key === 'left' ? [store.managementRoot] : [store.managerTarget, store.managementRoot];
  const authorized = [];
  for (const value of allowedRoots.filter(Boolean)) { try { authorized.push(await validateTargetFolder(value)); } catch {} }
  if (!authorized.some(allowed => {
    const relative = path.relative(allowed, current);
    return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
  })) throw new Error('请先通过文件夹选择器选择此窗格的位置。');
  managerPaneRoots[key] = await validateTargetFolder(root);
  return { root: managerPaneRoots[key], current };
});
ipcMain.handle('manager-pane-choose-folder', async (_event, side, startPath) => {
  const key = paneSide(side);
  const result = await dialog.showOpenDialog({ title: key === 'left' ? '选择左侧文件夹' : '选择右侧文件夹', ...(startPath ? { defaultPath: startPath } : {}), properties: ['openDirectory'] });
  if (result.canceled) return null;
  const current = await validateTargetFolder(result.filePaths[0]);
  managerPaneRoots[key] = await validateTargetFolder(volumeRoot(current));
  if (key === 'right') { const store = readStore(); store.managerTarget = current; writeStore(store); }
  return current;
});
ipcMain.handle('manager-pane-read-folder', async (_event, side, folderPath) => readFolderWithin(paneRoot(side), folderPath || paneRoot(side)));
ipcMain.handle('manager-pane-search', async (_event, side, folderPath, query) => searchPaneFolder(paneRoot(side), folderPath, query));
ipcMain.handle('manager-pane-create-folder', async (_event, side, parentPath, name) => createPaneFolder(paneRoot(side), parentPath, name));
ipcMain.handle('manager-pane-open', async (_event, side, itemPath) => {
  const item = await inspectPaneEntry(paneRoot(side), itemPath);
  const error = await shell.openPath(item.path);
  if (error) throw new Error(error);
  return true;
});
ipcMain.handle('manager-pane-rename', async (_event, side, itemPath, name) => {
  const root = paneRoot(side); const renamed = await renameEntry(root, itemPath, name);
  if (renamed.status !== 'moved') return renamed;
  const batch = { id: require('node:crypto').randomUUID(), createdAt: new Date().toISOString(), destination: path.dirname(renamed.destination), items: [renamed], root };
  rebaseSearchPaths(batch.items);
  const history = readMoveHistory(); history.unshift(batch); writeMoveHistory(history.slice(0, 50)); await persistSearchIndex(searchIndex);
  return renamed;
});
ipcMain.handle('manager-pane-trash', async (_event, side, itemPaths) => {
  const result = await trashEntries(paneRoot(side), itemPaths, itemPath => shell.trashItem(itemPath));
  if (result.trashed.length) { rebaseTrashPaths(result.trashed.map(item => item.source)); await persistSearchIndex(searchIndex); }
  return result;
});
ipcMain.handle('manager-choose-target', async (_event, startPath) => {
  const root = readStore().managementRoot;
  if (!root) throw new Error('请先选择文件管理范围。');
  const result = await dialog.showOpenDialog({ title: '选择目标文件夹', defaultPath: startPath || root, properties: ['openDirectory'] });
  if (result.canceled) return null;
  const target = await validateTargetFolder(result.filePaths[0]);
  const store = readStore(); store.managerTarget = target; writeStore(store);
  return target;
});
function rebaseSearchPaths(items, reverse = false) {
  let changed = false;
  for (const item of items) {
    if (item.status !== (reverse ? 'undone' : 'moved')) continue;
    const from = reverse ? item.destination : item.source;
    const to = reverse ? item.source : item.destination;
    for (const entry of [...searchIndex.files, ...(searchIndex.folders || [])]) {
      const relative = path.relative(from, entry.path);
      if (relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) {
        entry.path = relative ? path.join(to, relative) : to;
        entry.name = path.basename(entry.path) || entry.path;
        changed = true;
      }
    }
  }
  return changed;
}
ipcMain.handle('manager-move', async (_event, sourcePaths, destinationPath) => {
  const root = readStore().managementRoot;
  if (!root) throw new Error('请先选择文件管理范围。');
  const batch = await moveEntries(root, sourcePaths, destinationPath);
  if (batch.items.some(item => item.status === 'moved' || item.status === 'copied_source_retained')) {
    rebaseSearchPaths(batch.items);
    const history = readMoveHistory(); history.unshift({ ...batch, root }); writeMoveHistory(history.slice(0, 50));
    await persistSearchIndex(searchIndex);
  }
  return batch;
});
ipcMain.handle('manager-move-between', async (_event, sourcePaths, destinationPath, sourceSide, destinationSide) => {
  const from = paneSide(sourceSide), to = paneSide(destinationSide);
  if (from === to) throw new Error('请选择另一个文件窗格作为移动方向。');
  const sourceRoot = paneRoot(from), destinationRoot = paneRoot(to);
  const batch = await moveEntriesBetween(sourceRoot, sourcePaths, destinationRoot, destinationPath);
  if (batch.items.some(item => item.status === 'moved' || item.status === 'copied_source_retained')) {
    rebaseSearchPaths(batch.items);
    const history = readMoveHistory(); history.unshift({ ...batch, root: sourceRoot, sourceSide: from, destinationSide: to }); writeMoveHistory(history.slice(0, 50));
    await persistSearchIndex(searchIndex);
  }
  return batch;
});
ipcMain.handle('manager-create-folder', async (_event, parentPath, name) => {
  const root = readStore().managementRoot;
  if (!root) throw new Error('请先选择管理范围。');
  return createFolder(root, parentPath, name);
});
ipcMain.handle('manager-undo', async (_event, batchId) => {
  const history = readMoveHistory(); const batch = history.find(item => item.id === batchId);
  if (!batch) throw new Error('找不到这次移动记录。');
  const result = await undoMoveBatch(batch.root, batch);
  Object.assign(batch, result); rebaseSearchPaths(batch.items, true); writeMoveHistory(history);
  await persistSearchIndex(searchIndex);
  return result;
});
ipcMain.handle('conversion-choose-folder', async () => {
  const result = await dialog.showOpenDialog({ title: '选择文件转换文件夹', properties: ['openDirectory'] });
  if (result.canceled || !result.filePaths[0]) return null;
  conversionRoot = await validateManagerRoot(result.filePaths[0]);
  return readFolderWithin(conversionRoot, conversionRoot);
});
ipcMain.handle('conversion-read-folder', async (_event, folder) => {
  if (!conversionRoot) throw new Error('请先选择文件转换文件夹。');
  return readFolderWithin(conversionRoot, folder || conversionRoot);
});
ipcMain.handle('conversion-read-file', async (_event, filePath) => {
  if (!conversionRoot) throw new Error('请先选择文件转换文件夹。');
  const entry = await inspectPaneEntry(conversionRoot, filePath);
  if (!entry.metadata.isFile()) throw new Error('只能预览普通文件。');
  const extension = path.extname(filePath).toLowerCase();
  const allowed = { '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };
  if (!allowed[extension]) return { name: path.basename(filePath), size: entry.metadata.size, mime: null, data: null };
  const maxSize = extension === '.pdf' ? 50 * 1024 * 1024 : 30 * 1024 * 1024;
  if (entry.metadata.size > maxSize) throw new Error(`此文件超过预览限制（${Math.round(maxSize / 1024 / 1024)} MB），仍可选择它进行转换。`);
  const bytes = await fs.promises.readFile(entry.path);
  return { name: path.basename(filePath), size: bytes.length, mime: allowed[extension], data: bytes.toString('base64') };
});
ipcMain.handle('conversion-options', async (_event, filePaths) => {
  if (!conversionRoot) throw new Error('请先选择文件转换文件夹。');
  if (!Array.isArray(filePaths) || !filePaths.length || filePaths.length > 50) return [];
  const items = [];
  for (const filePath of filePaths) {
    const entry = await inspectPaneEntry(conversionRoot, filePath);
    if (!entry.metadata.isFile()) return [];
    items.push({ type: 'file', name: path.basename(entry.path), path: entry.path });
  }
  return conversionTargets(items);
});
ipcMain.handle('conversion-save-page', async (_event, filePath, pageNumber, format, data) => {
  if (!conversionRoot) throw new Error('请先选择文件转换文件夹。');
  const source = await inspectPaneEntry(conversionRoot, filePath);
  if (!source.metadata.isFile() || path.extname(filePath).toLowerCase() !== '.pdf') throw new Error('页面图片来源必须是已选择文件夹内的 PDF。');
  if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > 500 || !['png', 'jpg'].includes(format) || typeof data !== 'string' || data.length > 40 * 1024 * 1024) throw new Error('页面图片数据无效或超过处理上限。');
  const bytes = Buffer.from(data, 'base64');
  const signatureValid = format === 'png' ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) : bytes[0] === 0xff && bytes[1] === 0xd8;
  if (!bytes.length || !signatureValid) throw new Error('导出的图像数据格式不匹配。');
  const stem = path.basename(filePath, path.extname(filePath));
  const name = `${stem}-${String(pageNumber).padStart(3, '0')}.${format}`;
  let output = nextAvailablePath(path.dirname(filePath), name, format);
  for (let attempt = 0; attempt < 100; attempt++) {
    try { await fs.promises.writeFile(output, bytes, { flag: 'wx' }); return output; }
    catch (error) { if (error.code !== 'EEXIST') throw error; output = nextAvailablePath(path.dirname(filePath), name, format); }
  }
  throw new Error('无法为页面图片分配不重复的文件名。');
});
ipcMain.handle('conversion-run', async (_event, filePaths, targetFormat) => {
  if (!conversionRoot) throw new Error('请先选择文件转换文件夹。');
  if (!Array.isArray(filePaths) || filePaths.length === 0 || filePaths.length > 50) throw new Error('请选择 1–50 个文件进行转换。');
  const entries = [];
  for (const filePath of filePaths) {
    const entry = await inspectPaneEntry(conversionRoot, filePath);
    if (!entry.metadata.isFile()) throw new Error('转换仅支持普通文件，不支持文件夹。');
    if (entry.metadata.size > 100 * 1024 * 1024) throw new Error(`${path.basename(filePath)} 超过 100 MB 转换限制。`);
    entries.push({ type: 'file', path: entry.path, name: path.basename(entry.path), size: entry.metadata.size });
  }
  const plan = planConversion(entries, targetFormat);
  if (plan.operation === 'pdf-to-images') throw new Error('请使用页面预览中的导出操作转换 PDF 页面图片。');
  const total = entries.reduce((size, entry) => size + entry.size, 0);
  if (total > 300 * 1024 * 1024) throw new Error('所选文件总大小超过 300 MB。');
  if (plan.operation === 'merge-pdf') {
    const output = nextAvailablePath(plan.sourceFolder, `${path.basename(entries[0].name, path.extname(entries[0].name))}-合并.pdf`, 'pdf');
    return { outputs: [await mergePdfFiles(plan.files, output)], failed: [] };
  }
  if (plan.operation === 'images-to-pdf') {
    const sourceName = entries.length === 1 ? entries[0].name : '图片合并';
    const output = nextAvailablePath(plan.sourceFolder, sourceName, 'pdf');
    return { outputs: [await imagesToPdf(plan.files, output)], failed: [] };
  }
  const executable = findLibreOffice();
  if (!executable) throw new Error('此转换需要 LibreOffice。请先安装 LibreOffice 后再试；原文件没有被修改。');
  const outputs = [], failed = [];
  for (const file of plan.files) {
    try { outputs.push(await convertOfficeFile(file, plan.format, executable)); }
    catch (error) { failed.push({ name: file.name, reason: error.message }); }
  }
  return { outputs, failed };
});
ipcMain.handle('conversion-open', async (_event, filePath) => {
  if (!conversionRoot) throw new Error('请先选择文件转换文件夹。');
  const entry = await inspectPaneEntry(conversionRoot, filePath);
  if (!entry.metadata.isFile()) throw new Error('只能打开文件。');
  const result = await shell.openPath(entry.path);
  if (result) throw new Error(result);
  return true;
});
