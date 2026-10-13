const fs = require('node:fs/promises');
const path = require('node:path');

const excluded = new Set(['windows', 'program files', 'program files (x86)', 'programdata', 'appdata', '$recycle.bin', 'system volume information', 'node_modules', '.git']);
async function scanFiles(roots, options = {}) {
  const files = [], visited = new Set();
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
          files.push({ path: filePath, name: entry.name, extension: path.extname(entry.name).slice(1).toLowerCase(), size: metadata.size, createdAt: metadata.birthtime.toISOString(), modifiedAt: metadata.mtime.toISOString() });
        } catch { errors++; }
        if (files.length >= (options.maxFiles || 500000)) { limited = true; break; }
      }
    } catch { errors++; }
    options.onProgress?.({ files: files.length, directories, errors, currentPath: directory });
    if (limited) break;
  }
  return { files, roots, errors, directories, limited, cancelled: Boolean(options.isCancelled?.()), updatedAt: new Date().toISOString() };
}

function queryFiles(files, filters = {}, rules = []) {
  const words = String(filters.keywords || '').toLowerCase().split(/[,，;；\s]+/).filter(Boolean);
  const topic = String(filters.topic || '').trim().toLowerCase();
  const rule = rules.find(rule => rule.name.toLowerCase() === topic);
  const aliases = topic ? [topic, ...(rule?.keywords || []).filter(Boolean).map(word => String(word).toLowerCase())] : [];
  const formats = String(filters.formats || '').toLowerCase().split(/[,，;；\s]+/).map(word => word.replace(/^\./, '')).filter(Boolean);
  const field = filters.dateField === 'createdAt' ? 'createdAt' : 'modifiedAt';
  const from = filters.from ? new Date(`${filters.from}T00:00:00`).getTime() : -Infinity;
  const to = filters.to ? new Date(`${filters.to}T23:59:59.999`).getTime() : Infinity;
  if (Number.isNaN(from) || Number.isNaN(to) || from > to) throw new Error('请选择有效的起止日期，开始时间不能晚于结束时间。');
  const matches = files.filter(file => {
    const text = file.path.toLowerCase();
    const date = Date.parse(file[field]);
    return (!aliases.length || aliases.some(alias => text.includes(alias))) && words.every(word => text.includes(word)) && (!formats.length || formats.includes(file.extension)) && date >= from && date <= to;
  });
  matches.sort((a, b) => Date.parse(b[field]) - Date.parse(a[field]) || a.path.localeCompare(b.path));
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
module.exports = { scanFiles, queryFiles, trashIndexedFiles };
