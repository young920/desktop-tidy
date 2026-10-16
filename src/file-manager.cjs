const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

function isInside(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function samePath(left, right) { return path.relative(left, right) === ''; }

async function validateManagerRoot(root) {
  if (typeof root !== 'string' || !path.isAbsolute(root)) throw new Error('请选择有效的管理文件夹。');
  const real = await fs.realpath(root);
  const stat = await fs.stat(real);
  if (!stat.isDirectory()) throw new Error('管理范围必须是文件夹。');
  const volumeRoot = path.parse(real).root;
  const isVolumeRoot = process.platform === 'win32' ? real.toLowerCase() === volumeRoot.toLowerCase() : real === volumeRoot;
  if (isVolumeRoot) throw new Error('请选一个具体的工作文件夹作为管理范围。');
  return real;
}

async function resolveInside(root, candidate, { allowRoot = false } = {}) {
  const absolute = path.resolve(candidate);
  if (!isInside(root, absolute)) throw new Error('目标超出已选择的管理范围。');
  if (samePath(absolute, root) && !allowRoot) throw new Error('不能移动管理范围根文件夹本身。');
  const relative = path.relative(root, absolute);
  let cursor = root;
  if (relative) for (const part of relative.split(path.sep)) {
    cursor = path.join(cursor, part);
    const info = await fs.lstat(cursor);
    if (info.isSymbolicLink()) throw new Error('出于安全考虑，不能通过符号链接管理文件。');
  }
  const real = await fs.realpath(absolute);
  if (!isInside(root, real)) throw new Error('目标解析后超出已选择的管理范围。');
  return real;
}

async function readFolder(rootPath, folderPath = rootPath) {
  const root = await validateManagerRoot(rootPath);
  const current = await validateFolder(root, folderPath);
  const entries = await fs.readdir(current, { withFileTypes: true });
  const items = [];
  let skipped = 0;
  for (const entry of entries) {
    const target = path.join(current, entry.name);
    try {
      const metadata = await fs.lstat(target);
      if (metadata.isSymbolicLink() || (!metadata.isDirectory() && !metadata.isFile())) { skipped++; continue; }
      items.push({ path: target, name: entry.name, type: metadata.isDirectory() ? 'directory' : 'file', size: metadata.isFile() ? metadata.size : null, modifiedAt: metadata.mtime.toISOString() });
    } catch { skipped++; }
  }
  items.sort((left, right) => Number(right.type === 'directory') - Number(left.type === 'directory') || left.name.localeCompare(right.name));
  return { root, current, parent: current === root ? null : path.dirname(current), items, skipped };
}

async function readTargetFolder(folderPath) {
  const current = await validateTargetFolder(folderPath);
  const entries = await fs.readdir(current, { withFileTypes: true });
  const items = [];
  let skipped = 0;
  for (const entry of entries) {
    const target = path.join(current, entry.name);
    try {
      const metadata = await fs.lstat(target);
      if (metadata.isSymbolicLink() || (!metadata.isDirectory() && !metadata.isFile())) { skipped++; continue; }
      items.push({ path: target, name: entry.name, type: metadata.isDirectory() ? 'directory' : 'file', size: metadata.isFile() ? metadata.size : null, modifiedAt: metadata.mtime.toISOString() });
    } catch { skipped++; }
  }
  items.sort((left, right) => Number(right.type === 'directory') - Number(left.type === 'directory') || left.name.localeCompare(right.name));
  const parent = path.dirname(current);
  return { current, parent: samePath(current, parent) ? null : parent, items, skipped };
}

async function readFolderWithin(rootPath, folderPath = rootPath) {
  const root = await validateTargetFolder(rootPath);
  const current = await resolveInside(root, folderPath, { allowRoot: true });
  if (!(await fs.stat(current)).isDirectory()) throw new Error('目标必须是文件夹。');
  const entries = await fs.readdir(current, { withFileTypes: true });
  const items = [];
  let skipped = 0;
  for (const entry of entries) {
    const target = path.join(current, entry.name);
    try {
      const metadata = await fs.lstat(target);
      if (metadata.isSymbolicLink() || (!metadata.isDirectory() && !metadata.isFile())) { skipped++; continue; }
      items.push({ path: target, name: entry.name, type: metadata.isDirectory() ? 'directory' : 'file', size: metadata.isFile() ? metadata.size : null, modifiedAt: metadata.mtime.toISOString() });
    } catch { skipped++; }
  }
  items.sort((left, right) => Number(right.type === 'directory') - Number(left.type === 'directory') || left.name.localeCompare(right.name));
  const parent = path.dirname(current);
  return { root, current, parent: samePath(current, root) || samePath(current, parent) ? null : parent, items, skipped };
}

async function searchPaneFolder(rootPath, folderPath, query) {
  const root = await validateTargetFolder(rootPath);
  if (typeof query !== 'string' || !query.trim() || query.trim().length > 100) throw new Error('请输入搜索词（最多 100 个字符）。');
  const current = await resolveInside(root, folderPath, { allowRoot: true });
  if (!(await fs.stat(current)).isDirectory()) throw new Error('搜索位置必须是文件夹。');
  const needle = query.trim().toLocaleLowerCase();
  const stack = [current], items = [];
  let visited = 0, skipped = 0, truncated = false;
  const maxVisited = 50000, maxResults = 500;
  while (stack.length && !truncated) {
    const folder = stack.pop();
    let entries;
    try { entries = await fs.readdir(folder, { withFileTypes: true }); }
    catch { skipped++; continue; }
    for (const entry of entries) {
      if (++visited > maxVisited) { truncated = true; break; }
      const targetPath = path.join(folder, entry.name);
      try {
        const metadata = await fs.lstat(targetPath);
        if (metadata.isSymbolicLink() || (!metadata.isDirectory() && !metadata.isFile())) { skipped++; continue; }
        if (entry.name.toLocaleLowerCase().includes(needle)) {
          items.push({ path: targetPath, name: entry.name, type: metadata.isDirectory() ? 'directory' : 'file', size: metadata.isFile() ? metadata.size : null, modifiedAt: metadata.mtime.toISOString(), relativePath: path.relative(current, targetPath) });
          if (items.length >= maxResults) { truncated = true; break; }
        }
        if (metadata.isDirectory()) stack.push(targetPath);
      } catch { skipped++; }
      if (visited % 500 === 0) await new Promise(resolve => setImmediate(resolve));
    }
  }
  items.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  return { root, current, items, visited, skipped, truncated };
}

async function validateFolder(rootPath, folderPath) {
  const root = await validateManagerRoot(rootPath);
  const current = await resolveInside(root, folderPath, { allowRoot: true });
  if (!(await fs.stat(current)).isDirectory()) throw new Error('目标必须是文件夹。');
  return current;
}

async function validateTargetFolder(folderPath) {
  if (typeof folderPath !== 'string' || !path.isAbsolute(folderPath)) throw new Error('请选择有效的移动目标文件夹。');
  const real = await fs.realpath(folderPath);
  if (!(await fs.stat(real)).isDirectory()) throw new Error('移动目标必须是文件夹。');
  return real;
}

async function inspectPaneEntry(rootPath, entryPath) {
  const root = await validateTargetFolder(rootPath);
  const target = await resolveInside(root, entryPath);
  const metadata = await fs.lstat(target);
  if (metadata.isSymbolicLink() || (!metadata.isFile() && !metadata.isDirectory())) throw new Error('只支持普通文件或文件夹。');
  return { path: target, metadata };
}

async function snapshotTree(target) {
  const info = await fs.lstat(target);
  if (info.isSymbolicLink()) throw new Error('跨磁盘移动暂不支持包含符号链接的文件夹；原文件保持不变。');
  if (info.isFile()) {
    const hash = crypto.createHash('sha256');
    for await (const chunk of require('node:fs').createReadStream(target)) hash.update(chunk);
    return [{ path: '', type: 'file', size: info.size, hash: hash.digest('hex') }];
  }
  if (!info.isDirectory()) throw new Error('只支持移动普通文件和文件夹。');
  const result = [{ path: '', type: 'directory' }];
  const entries = await fs.readdir(target, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const childPath = path.join(target, entry.name);
    const child = await snapshotTree(childPath);
    for (const item of child) result.push({ ...item, path: path.join(entry.name, item.path).replace(/[\\/]$/, '') });
  }
  return result;
}

async function transferPath(source, destination, { forceCopy = false } = {}) {
  if (!forceCopy) {
    try { await fs.rename(source, destination); return; }
    catch (error) { if (error.code !== 'EXDEV') throw error; }
  }

  const temporary = path.join(path.dirname(destination), `.${path.basename(destination)}.file-manager-${crypto.randomUUID()}.partial`);
  try {
    await fs.cp(source, temporary, { recursive: true, errorOnExist: true, force: false, preserveTimestamps: true, dereference: false });
    const [originalSnapshot, copiedSnapshot] = await Promise.all([snapshotTree(source), snapshotTree(temporary)]);
    if (JSON.stringify(originalSnapshot) !== JSON.stringify(copiedSnapshot)) throw new Error('复制校验未通过，原文件未删除。');
    await fs.rename(temporary, destination);
    try { await fs.rm(source, { recursive: true, force: false }); }
    catch (error) {
      error.copyRetainedAt = destination;
      error.message = `复制校验已通过，但无法删除原件；副本保留在“${destination}”。请检查后手动处理。`;
      throw error;
    }
  } catch (error) {
    await fs.rm(temporary, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

async function moveEntries(rootPath, sourcePaths, destinationPath, options = {}) {
  if (!Array.isArray(sourcePaths) || sourcePaths.length === 0 || sourcePaths.length > 100) throw new Error('请选择 1 到 100 个项目再移动。');
  const root = await validateManagerRoot(rootPath);
  const destination = await validateTargetFolder(destinationPath);
  const uniquePaths = [...new Set(sourcePaths)];
  const batch = { id: crypto.randomUUID(), createdAt: new Date().toISOString(), destination, items: [] };
  for (const sourcePath of uniquePaths) {
    try {
      const source = await resolveInside(root, sourcePath);
      const metadata = await fs.lstat(source);
      const name = path.basename(source);
      if (samePath(path.dirname(source), destination)) throw new Error('该项目已经位于目标文件夹中。');
      if (metadata.isDirectory() && isInside(source, destination)) throw new Error('不能把文件夹移动到自身内部。');
      const target = path.join(destination, name);
      try { await fs.lstat(target); throw new Error('目标文件夹中已存在同名项目，请先手动处理重名。'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      await transferPath(source, target, options);
      batch.items.push({ source, destination: target, name, type: metadata.isDirectory() ? 'directory' : 'file', status: 'moved' });
    } catch (error) {
      batch.items.push({ source: sourcePath, ...(error.copyRetainedAt ? { destination: error.copyRetainedAt, status: 'copied_source_retained' } : { status: 'failed' }), name: path.basename(sourcePath), error: error.message || '移动失败。' });
    }
  }
  return { ...batch, moved: batch.items.filter(item => item.status === 'moved'), failed: batch.items.filter(item => item.status !== 'moved') };
}

async function moveEntriesBetween(sourceRootPath, sourcePaths, destinationRootPath, destinationPath, options = {}) {
  if (!Array.isArray(sourcePaths) || sourcePaths.length === 0 || sourcePaths.length > 100) throw new Error('请选择 1 到 100 个项目再移动。');
  const sourceRoot = await validateTargetFolder(sourceRootPath);
  const destinationRoot = await validateTargetFolder(destinationRootPath);
  const destination = await resolveInside(destinationRoot, destinationPath, { allowRoot: true });
  if (!(await fs.stat(destination)).isDirectory()) throw new Error('移动目标必须是文件夹。');
  const batch = { id: crypto.randomUUID(), createdAt: new Date().toISOString(), destination, sourceRoot, destinationRoot, items: [] };
  for (const sourcePath of [...new Set(sourcePaths)]) {
    try {
      const source = await resolveInside(sourceRoot, sourcePath);
      const metadata = await fs.lstat(source);
      const name = path.basename(source);
      if (samePath(path.dirname(source), destination)) throw new Error('该项目已经位于目标文件夹中。');
      if (metadata.isDirectory() && isInside(source, destination)) throw new Error('不能把文件夹移动到自身内部。');
      const targetPath = path.join(destination, name);
      try { await fs.lstat(targetPath); throw new Error('目标文件夹中已存在同名项目，请先手动处理重名。'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      await transferPath(source, targetPath, options);
      batch.items.push({ source, destination: targetPath, name, type: metadata.isDirectory() ? 'directory' : 'file', status: 'moved' });
    } catch (error) {
      batch.items.push({ source: sourcePath, ...(error.copyRetainedAt ? { destination: error.copyRetainedAt, status: 'copied_source_retained' } : { status: 'failed' }), name: path.basename(sourcePath), error: error.message || '移动失败。' });
    }
  }
  return { ...batch, moved: batch.items.filter(item => item.status === 'moved'), failed: batch.items.filter(item => item.status !== 'moved') };
}

function validateItemName(name) {
  if (typeof name !== 'string' || !name || name.length > 255 || name !== name.trim() || /[<>:"/\\|?*\u0000-\u001f]/.test(name) || /[. ]$/.test(name) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) {
    throw new Error('名称为空、过长或包含 Windows 不允许的字符。');
  }
  return name;
}

async function renameEntry(rootPath, sourcePath, newName) {
  const root = await validateTargetFolder(rootPath);
  const name = validateItemName(newName);
  const source = await resolveInside(root, sourcePath);
  const metadata = await fs.lstat(source);
  if (!metadata.isFile() && !metadata.isDirectory()) throw new Error('只支持重命名普通文件或文件夹。');
  const destination = path.join(path.dirname(source), name);
  const caseInsensitiveSame = process.platform === 'win32' && source.toLowerCase() === destination.toLowerCase();
  if (samePath(source, destination) || caseInsensitiveSame) return { source, destination: source, name: path.basename(source), status: 'unchanged' };
  try { await fs.lstat(destination); throw new Error('同名文件或文件夹已存在，未覆盖。'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  await fs.rename(source, destination);
  return { source, destination, name: path.basename(source), type: metadata.isDirectory() ? 'directory' : 'file', status: 'moved' };
}

async function trashEntries(rootPath, sourcePaths, trashItem) {
  if (!Array.isArray(sourcePaths) || sourcePaths.length === 0 || sourcePaths.length > 100) throw new Error('请选择 1 到 100 个项目再删除。');
  const root = await validateTargetFolder(rootPath);
  const items = [];
  for (const sourcePath of [...new Set(sourcePaths)]) {
    try {
      const source = await resolveInside(root, sourcePath);
      const info = await fs.lstat(source);
      if (!info.isFile() && !info.isDirectory()) throw new Error('只支持删除普通文件或文件夹。');
      await trashItem(source);
      items.push({ source, name: path.basename(source), status: 'trashed' });
    } catch (error) { items.push({ source: sourcePath, name: path.basename(sourcePath), status: 'failed', error: error.message || '无法移入回收站。' }); }
  }
  return { items, trashed: items.filter(item => item.status === 'trashed'), failed: items.filter(item => item.status !== 'trashed') };
}

async function createFolder(rootPath, parentPath, name) {
  if (typeof name !== 'string' || !name.trim() || name.length > 100 || /[<>:"/\\|?*\u0000-\u001f]/.test(name) || /[. ]$/.test(name) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) {
    throw new Error('文件夹名称为空或包含 Windows 不允许的字符。');
  }
  await validateManagerRoot(rootPath);
  const parent = await validateTargetFolder(parentPath);
  const destination = path.join(parent, name.trim());
  try { await fs.mkdir(destination); }
  catch (error) { if (error.code === 'EEXIST') throw new Error('这个位置已有同名文件或文件夹。'); throw error; }
  return destination;
}

async function createPaneFolder(rootPath, parentPath, name) {
  const root = await validateTargetFolder(rootPath);
  const parent = await resolveInside(root, parentPath, { allowRoot: true });
  if (!(await fs.stat(parent)).isDirectory()) throw new Error('新文件夹的上级路径无效。');
  if (typeof name !== 'string' || !name.trim() || name.length > 100) throw new Error('文件夹名称为空或过长。');
  const safeName = validateItemName(name.trim());
  const destination = path.join(parent, safeName);
  try { await fs.mkdir(destination); }
  catch (error) { if (error.code === 'EEXIST') throw new Error('这个位置已有同名文件或文件夹。'); throw error; }
  return destination;
}

async function undoMoveBatch(rootPath, batch, options = {}) {
  const root = await validateTargetFolder(rootPath);
  const result = { ...batch, undoneAt: new Date().toISOString(), items: batch.items.map(item => ({ ...item })) };
  for (const item of [...result.items].reverse()) {
    if (item.status !== 'moved') continue;
    try {
      const movedPath = path.resolve(item.destination);
      if (!path.isAbsolute(movedPath)) throw new Error('移动后的位置无效。');
      const movedInfo = await fs.lstat(movedPath);
      if (movedInfo.isSymbolicLink()) throw new Error('移动后的位置是符号链接，无法安全撤销。');
      const originalPath = path.resolve(item.source);
      if (!isInside(root, originalPath)) throw new Error('原位置超出管理范围，无法撤销。');
      try { await fs.lstat(originalPath); throw new Error('原位置已有同名项目，未覆盖。'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      const originalParent = path.dirname(originalPath);
      const checkedParent = await resolveInside(root, originalParent, { allowRoot: true });
      if (!samePath(originalParent, checkedParent)) throw new Error('原位置路径解析不一致，无法撤销。');
      await transferPath(movedPath, originalPath, options);
      item.status = 'undone'; item.error = null;
    } catch (error) { item.status = 'undo_failed'; item.error = error.message || '撤销失败。'; }
  }
  return { ...result, undone: result.items.filter(item => item.status === 'undone'), undoFailed: result.items.filter(item => item.status === 'undo_failed') };
}

module.exports = { validateManagerRoot, validateFolder, validateTargetFolder, inspectPaneEntry, readFolder, readTargetFolder, readFolderWithin, searchPaneFolder, moveEntries, moveEntriesBetween, renameEntry, trashEntries, transferPath, createFolder, createPaneFolder, undoMoveBatch };
