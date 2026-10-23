const fs = require('node:fs/promises');
const path = require('node:path');

const excluded = new Set(['windows', 'program files', 'program files (x86)', 'programdata', 'appdata', '$recycle.bin', 'system volume information', 'node_modules', '.git']);
async function scanFiles(roots, options = {}) {
  const files = [], folders = [], visited = new Set();
  const pending = [...new Set(roots.map(root => path.resolve(root)))];
  let errors = 0, directories = 0, limited = false;
  while (pending.length && !options.isCancelled?.()) {
    const directory = pending.pop();
    const key = process.platform === 'win32' ? directory.toLowerCase() : directory;
    if (visited.has(key)) continue;
    visited.add(key);
    try {
      const stat = await fs.lstat(directory);
      if (stat.isSymbolicLink() || !stat.isDirectory()) continue;
      folders.push({ path: directory, name: path.basename(directory) || directory, type: 'directory', createdAt: stat.birthtime.toISOString(), modifiedAt: stat.mtime.toISOString(), mtimeMs: stat.mtimeMs });
      if (folders.length >= (options.maxFolders || 500000)) { limited = true; break; }
      const entries = await fs.readdir(directory, { withFileTypes: true });
      directories++;
      for (const entry of entries) {
        if (options.isCancelled?.()) break;
        const filePath = path.join(directory, entry.name);
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) { if (!excluded.has(entry.name.toLowerCase())) pending.push(filePath); continue; }
        if (!entry.isFile()) continue;
        try {
          const metadata = await fs.stat(filePath);
          files.push({ path: filePath, name: entry.name, extension: path.extname(entry.name).slice(1).toLowerCase(), size: metadata.size, createdAt: metadata.birthtime.toISOString(), modifiedAt: metadata.mtime.toISOString(), mtimeMs: metadata.mtimeMs });
        } catch { errors++; }
        if (files.length >= (options.maxFiles || 500000)) { limited = true; break; }
      }
    } catch { errors++; }
    options.onProgress?.({ files: files.length, folders: folders.length, directories, errors, currentPath: directory });
    if (limited) break;
  }
  return { files, folders, roots, errors, directories, limited, cancelled: Boolean(options.isCancelled?.()), incremental: false, updatedAt: new Date().toISOString() };
}

function normalizedPath(filePath) {
  const resolved = path.resolve(filePath);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function groupByParent(items) {
  const result = new Map();
  for (const item of items) {
    const parent = normalizedPath(path.dirname(item.path));
    if (normalizedPath(item.path) === parent) continue;
    if (!result.has(parent)) result.set(parent, []);
    result.get(parent).push(item);
  }
  return result;
}

function insidePath(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

async function scanFilesIncremental(roots, previousIndex, options = {}) {
  const resolvedRoots = [...new Set(roots.map(root => path.resolve(root)))];
  const priorFiles = previousIndex?.files || [], priorFolders = previousIndex?.folders || [];
  const sameRoots = Array.isArray(previousIndex?.roots) && previousIndex.roots.length === resolvedRoots.length && [...previousIndex.roots].map(normalizedPath).sort().join('\n') === resolvedRoots.map(normalizedPath).sort().join('\n');
  const hasDirectorySnapshot = priorFolders.length > 0 && priorFolders.every(folder => typeof folder.modifiedAt === 'string');
  const hasFileSnapshot = priorFiles.every(file => typeof file.modifiedAt === 'string');
  if (!sameRoots || !hasDirectorySnapshot || !hasFileSnapshot) {
    return { fullScanFallback: true, fallbackReason: !sameRoots ? 'scope-changed' : 'legacy-index' };
  }

  const files = new Map(priorFiles.map(file => [normalizedPath(file.path), file]));
  const folders = new Map(priorFolders.map(folder => [normalizedPath(folder.path), folder]));
  const oldFilesByParent = groupByParent(priorFiles), oldFoldersByParent = groupByParent(priorFolders);
  const pending = [...resolvedRoots], visited = new Set();
  let errors = 0, directories = 0, changedDirectories = 0, skippedDirectories = 0, fileStats = 0, skippedFileStats = 0, limited = false;
  const maxFiles = options.maxFiles || 500000, maxFolders = options.maxFolders || 500000;
  const removeSubtree = target => {
    for (const [key, item] of files) if (insidePath(target, item.path)) files.delete(key);
    for (const [key, item] of folders) if (insidePath(target, item.path)) folders.delete(key);
  };

  while (pending.length && !options.isCancelled?.()) {
    const directory = pending.pop(), directoryKey = normalizedPath(directory);
    if (visited.has(directoryKey)) continue;
    visited.add(directoryKey);
    let directoryStat;
    try {
      directoryStat = await fs.lstat(directory);
      if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) { removeSubtree(directory); continue; }
    } catch (error) {
      errors++;
      if (error.code === 'ENOENT') removeSubtree(directory);
      continue;
    }

    const oldFolder = folders.get(directoryKey);
    const directoryChanged = !oldFolder || oldFolder.modifiedAt !== directoryStat.mtime.toISOString();
    if (directoryChanged) changedDirectories++;
    folders.set(directoryKey, { path: directory, name: path.basename(directory) || directory, type: 'directory', createdAt: directoryStat.birthtime.toISOString(), modifiedAt: directoryStat.mtime.toISOString(), mtimeMs: directoryStat.mtimeMs });
    directories++;

    if (!directoryChanged) {
      skippedDirectories++;
      skippedFileStats += (oldFilesByParent.get(directoryKey) || []).length;
      for (const childFolder of oldFoldersByParent.get(directoryKey) || []) pending.push(childFolder.path);
      options.onProgress?.({ files: files.size, folders: folders.size, directories, errors, currentPath: directory, incremental: true, changedDirectories, skippedDirectories, fileStats, skippedFileStats });
      continue;
    }

    let entries;
    try { entries = await fs.readdir(directory, { withFileTypes: true }); }
    catch { errors++; continue; }
    const present = new Set(); let directoryIncomplete = false;
    for (const entry of entries) {
      if (options.isCancelled?.()) { directoryIncomplete = true; break; }
      const entryPath = path.join(directory, entry.name), entryKey = normalizedPath(entryPath);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (excluded.has(entry.name.toLowerCase())) continue;
        present.add(entryKey); pending.push(entryPath); continue;
      }
      if (!entry.isFile()) continue;
      present.add(entryKey);
      const oldFile = files.get(entryKey);
      if (oldFile && !directoryChanged) { skippedFileStats++; continue; }
      try {
        const metadata = await fs.stat(entryPath); fileStats++;
        if (!oldFile && files.size >= maxFiles) { limited = true; directoryIncomplete = true; break; }
        files.set(entryKey, { path: entryPath, name: entry.name, extension: path.extname(entry.name).slice(1).toLowerCase(), size: metadata.size, createdAt: metadata.birthtime.toISOString(), modifiedAt: metadata.mtime.toISOString(), mtimeMs: metadata.mtimeMs });
      } catch { errors++; }
    }

    if (!directoryIncomplete) {
      for (const oldFile of oldFilesByParent.get(directoryKey) || []) if (!present.has(normalizedPath(oldFile.path))) files.delete(normalizedPath(oldFile.path));
      for (const oldFolderChild of oldFoldersByParent.get(directoryKey) || []) if (!present.has(normalizedPath(oldFolderChild.path))) removeSubtree(oldFolderChild.path);
    }
    if (folders.size > maxFolders) { limited = true; break; }
    options.onProgress?.({ files: files.size, folders: folders.size, directories, errors, currentPath: directory, incremental: true, changedDirectories, fileStats, skippedFileStats });
    if (limited) break;
  }

  return {
    files: [...files.values()], folders: [...folders.values()], roots: resolvedRoots, errors, directories,
    limited, cancelled: Boolean(options.isCancelled?.()), incremental: true,
    incrementalStats: { changedDirectories, skippedDirectories, fileStats, skippedFileStats }, updatedAt: new Date().toISOString()
  };
}

function queryFiles(files, filters = {}, rules = [], folders = []) {
  const words = String(filters.keywords || '').toLowerCase().split(/[,，;；\s]+/).filter(Boolean);
  const topic = String(filters.topic || '').trim().toLowerCase();
  const rule = rules.find(rule => rule.name.toLowerCase() === topic);
  const aliases = topic ? [topic, ...(rule?.keywords || []).filter(Boolean).map(word => String(word).toLowerCase())] : [];
  const formats = String(filters.formats || '').toLowerCase().split(/[,，;；\s]+/).map(word => word.replace(/^\./, '')).filter(Boolean)
    .map(format => ['folder', 'folders', 'directory', 'directories', '文件夹'].includes(format) ? '__folder__' : format);
  const hasTypeFilter = formats.length > 0, includeFolders = formats.includes('__folder__');
  const fileFormats = formats.filter(format => format !== '__folder__');
  const field = filters.dateField === 'createdAt' ? 'createdAt' : 'modifiedAt';
  const from = filters.from ? new Date(`${filters.from}T00:00:00`).getTime() : -Infinity;
  const to = filters.to ? new Date(`${filters.to}T23:59:59.999`).getTime() : Infinity;
  if (Number.isNaN(from) || Number.isNaN(to) || from > to) throw new Error('请选择有效的起止日期，开始时间不能晚于结束时间。');
  const matchesText = item => {
    const text = item.path.toLowerCase();
    return (!aliases.length || aliases.some(alias => text.includes(alias))) && words.every(word => text.includes(word));
  };
  const matches = files.filter(file => {
    const date = Date.parse(file[field]);
    return matchesText(file) && (!hasTypeFilter || fileFormats.includes(file.extension)) && date >= from && date <= to;
  });
  if (includeFolders || ((aliases.length || words.length) && !hasTypeFilter)) {
    matches.push(...folders.filter(folder => matchesText(folder) && Date.parse(folder[field]) >= from && Date.parse(folder[field]) <= to));
  }
  const sort = filters.sort || 'modified-desc';
  const sortDate = {
    'modified-desc': ['modifiedAt', -1], 'modified-asc': ['modifiedAt', 1],
    'created-desc': ['createdAt', -1], 'created-asc': ['createdAt', 1]
  }[sort];
  matches.sort((a, b) => {
    if (sort === 'name-asc') return a.name.localeCompare(b.name, 'zh-CN', { numeric: true, sensitivity: 'base' }) || a.path.localeCompare(b.path, 'zh-CN');
    const [sortField, direction] = sortDate || ['modifiedAt', -1];
    return direction * (Date.parse(a[sortField]) - Date.parse(b[sortField])) || a.path.localeCompare(b.path, 'zh-CN');
  });
  const offset = Math.max(0, Number(filters.offset) || 0), limit = Math.min(200, Math.max(1, Number(filters.limit) || 100));
  return { total: matches.length, items: matches.slice(offset, offset + limit), offset, limit };
}

async function trashIndexedFiles(index, requestedPaths, moveToTrash) {
  if (!Array.isArray(requestedPaths) || requestedPaths.length > 100) throw new Error('一次最多只能将 100 个文件移入回收站。');
  const uniquePaths = [...new Set(requestedPaths)];
  const indexed = new Map((index.files || []).map(file => [file.path, file]));
  for (const filePath of uniquePaths) if (!indexed.has(filePath)) throw new Error('文件未包含在当前索引中，请更新索引后重试。');
  const moved = [], failed = [];
  for (const filePath of uniquePaths) {
    const record = indexed.get(filePath);
    try {
      const current = await fs.stat(filePath);
      if (current.size !== record.size || current.mtime.toISOString() !== record.modifiedAt) {
        failed.push({ path: filePath, reason: '文件在建立索引后发生变化，请更新索引后再操作。' });
        continue;
      }
      await moveToTrash(filePath);
      moved.push(filePath);
    } catch (error) {
      failed.push({ path: filePath, reason: error.code === 'ENOENT' ? '文件已不存在，请更新索引。' : '无法将文件移入回收站，请检查权限或文件占用。' });
    }
  }
  if (moved.length) index.files = index.files.filter(file => !moved.includes(file.path));
  return { moved, failed };
}
module.exports = { scanFiles, scanFilesIncremental, queryFiles, trashIndexedFiles };
