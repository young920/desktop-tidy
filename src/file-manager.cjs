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

async function validateFolder(rootPath, folderPath) {
  const root = await validateManagerRoot(rootPath);
  const current = await resolveInside(root, folderPath, { allowRoot: true });
  if (!(await fs.stat(current)).isDirectory()) throw new Error('目标必须是文件夹。');
  return current;
}

async function moveEntries(rootPath, sourcePaths, destinationPath) {
  if (!Array.isArray(sourcePaths) || sourcePaths.length === 0 || sourcePaths.length > 100) throw new Error('请选择 1 到 100 个项目再移动。');
  const root = await validateManagerRoot(rootPath);
  const destination = await resolveInside(root, destinationPath, { allowRoot: true });
  if (!(await fs.stat(destination)).isDirectory()) throw new Error('移动目标必须是文件夹。');
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
      await fs.rename(source, target);
      batch.items.push({ source, destination: target, name, type: metadata.isDirectory() ? 'directory' : 'file', status: 'moved' });
    } catch (error) {
      batch.items.push({ source: sourcePath, name: path.basename(sourcePath), status: 'failed', error: error.message || '移动失败。' });
    }
  }
  return { ...batch, moved: batch.items.filter(item => item.status === 'moved'), failed: batch.items.filter(item => item.status === 'failed') };
}

async function createFolder(rootPath, parentPath, name) {
  if (typeof name !== 'string' || !name.trim() || name.length > 100 || /[<>:"/\\|?*\u0000-\u001f]/.test(name) || /[. ]$/.test(name) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) {
    throw new Error('文件夹名称为空或包含 Windows 不允许的字符。');
  }
  const root = await validateManagerRoot(rootPath);
  const parent = await resolveInside(root, parentPath, { allowRoot: true });
  if (!(await fs.stat(parent)).isDirectory()) throw new Error('新文件夹的上级路径无效。');
  const destination = path.join(parent, name.trim());
  try { await fs.mkdir(destination); }
  catch (error) { if (error.code === 'EEXIST') throw new Error('这个位置已有同名文件或文件夹。'); throw error; }
  return destination;
}

async function undoMoveBatch(rootPath, batch) {
  const root = await validateManagerRoot(rootPath);
  const result = { ...batch, undoneAt: new Date().toISOString(), items: batch.items.map(item => ({ ...item })) };
  for (const item of [...result.items].reverse()) {
    if (item.status !== 'moved') continue;
    try {
      const movedPath = await resolveInside(root, item.destination);
      const originalPath = path.resolve(item.source);
      if (!isInside(root, originalPath)) throw new Error('原位置超出管理范围，无法撤销。');
      try { await fs.lstat(originalPath); throw new Error('原位置已有同名项目，未覆盖。'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      await fs.rename(movedPath, originalPath);
      item.status = 'undone'; item.error = null;
    } catch (error) { item.status = 'undo_failed'; item.error = error.message || '撤销失败。'; }
  }
  return { ...result, undone: result.items.filter(item => item.status === 'undone'), undoFailed: result.items.filter(item => item.status === 'undo_failed') };
}

module.exports = { validateManagerRoot, validateFolder, readFolder, moveEntries, createFolder, undoMoveBatch };
