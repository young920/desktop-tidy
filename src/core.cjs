const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function stamp(stat) {
  return { size: stat.size, modifiedMs: Math.trunc(stat.mtimeMs) };
}

function monthFor(stat) {
  return new Date(stat.mtimeMs).toISOString().slice(0, 7);
}

function isWithin(candidate, parent) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function safeDestination(directory, fileName) {
  const parsed = path.parse(fileName);
  let number = 1;
  let candidate = path.join(directory, fileName);
  while (fs.existsSync(candidate)) {
    number += 1;
    candidate = path.join(directory, `${parsed.name} (${number})${parsed.ext}`);
  }
  return candidate;
}

function resolveRules(name, rules) {
  const lowered = name.toLocaleLowerCase();
  const matches = rules
    .filter(rule => rule.enabled !== false)
    .map(rule => ({ ...rule, keyword: (rule.keywords || []).filter(keyword => lowered.includes(String(keyword).toLocaleLowerCase())).sort((a, b) => String(b).length - String(a).length)[0] }))
    .filter(rule => rule.keyword);
  if (!matches.length) return [];
  const longest = Math.max(...matches.map(rule => String(rule.keyword).length));
  const mostSpecific = matches.filter(rule => String(rule.keyword).length === longest);
  const highestPriority = Math.max(...mostSpecific.map(rule => Number(rule.priority) || 0));
  return mostSpecific.filter(rule => (Number(rule.priority) || 0) === highestPriority);
}

function buildPlan(desktopPath, archiveRoot, rules = []) {
  const plan = { id: crypto.randomUUID(), desktopPath, archiveRoot, createdAt: new Date().toISOString(), items: [], targets: [], skipped: [] };
  const root = path.resolve(archiveRoot);
  for (const entry of fs.readdirSync(desktopPath, { withFileTypes: true })) {
    const sourcePath = path.join(desktopPath, entry.name);
    if (isWithin(sourcePath, root)) {
      plan.skipped.push({ sourcePath, name: entry.name, reason: '已在归档根目录内' });
      continue;
    }
    if (entry.isSymbolicLink()) {
      plan.skipped.push({ sourcePath, name: entry.name, reason: '快捷方式或符号链接默认跳过' });
      continue;
    }
    if (!entry.isFile()) {
      plan.skipped.push({ sourcePath, name: entry.name, reason: '文件夹默认不移动' });
      continue;
    }
    if (entry.name.toLowerCase().endsWith('.lnk')) {
      plan.skipped.push({ sourcePath, name: entry.name, reason: 'Windows 快捷方式默认跳过' });
      continue;
    }
    const metadata = stamp(fs.statSync(sourcePath));
    const matches = resolveRules(entry.name, rules);
    let bucket;
    let reason;
    let candidates;
    let requiresChoice = false;
    if (matches.length === 1) {
      bucket = `${matches[0].kind === 'fixed' ? '固定事务' : '进行中'}/${matches[0].name}`;
      reason = `匹配规则“${matches[0].keyword}” → ${matches[0].name}`;
    } else if (matches.length > 1) {
      bucket = `待选择/${monthFor({ mtimeMs: metadata.modifiedMs })}`;
      reason = '同时命中同等优先级规则，请在预览中选择去向';
      requiresChoice = true;
      candidates = matches.map(rule => ({
        name: rule.name,
        keyword: rule.keyword,
        priority: Number(rule.priority) || 0,
        bucket: `${rule.kind === 'fixed' ? '固定事务' : '进行中'}/${rule.name}`,
        targetDir: path.join(root, rule.kind === 'fixed' ? '固定事务' : '进行中', rule.name)
      }));
    } else {
      bucket = `待确认/${monthFor({ mtimeMs: metadata.modifiedMs })}`;
      reason = '未识别项目，暂存待确认';
    }
    const targetDir = path.join(root, ...bucket.split('/'));
    plan.items.push({
      id: crypto.randomUUID(), name: entry.name, sourcePath, targetDir, destinationPath: safeDestination(targetDir, entry.name),
      bucket, reason, metadata, candidates, requiresChoice, selected: true, status: 'planned'
    });
  }
  return plan;
}

function verifyItem(item) {
  if (!fs.existsSync(item.sourcePath)) return '源文件已不存在，请重新扫描';
  const current = stamp(fs.statSync(item.sourcePath));
  if (current.size !== item.metadata.size || current.modifiedMs !== item.metadata.modifiedMs) return '扫描后文件已变化，请重新扫描';
  return null;
}

function executePlan(plan, onProgress = () => {}) {
  const batch = { ...plan, executedAt: new Date().toISOString(), items: plan.items.map(item => ({ ...item })) };
  for (const target of batch.targets || []) fs.mkdirSync(target.targetDir, { recursive: true });
  for (const item of batch.items) {
    if (!item.selected) { item.status = 'skipped'; item.error = '用户未选择'; continue; }
    if (item.requiresChoice) { item.status = 'skipped_requires_choice'; item.error = '请先选择整理目标'; continue; }
    const issue = verifyItem(item);
    if (issue) { item.status = 'skipped_changed'; item.error = issue; onProgress(item); continue; }
    try {
      fs.mkdirSync(item.targetDir, { recursive: true });
      item.destinationPath = safeDestination(item.targetDir, path.basename(item.destinationPath));
      item.status = 'moving'; onProgress(item);
      fs.renameSync(item.sourcePath, item.destinationPath);
      item.status = 'moved'; item.error = null;
    } catch (error) { item.status = 'failed'; item.error = error.message; }
    onProgress(item);
  }
  return batch;
}

function undoBatch(batch, onProgress = () => {}) {
  const result = { ...batch, undoneAt: new Date().toISOString(), items: batch.items.map(item => ({ ...item })) };
  for (const item of [...result.items].reverse()) {
    if (item.status !== 'moved') continue;
    try {
      if (!fs.existsSync(item.destinationPath)) throw new Error('目标文件已不存在，无法撤销');
      if (fs.existsSync(item.sourcePath)) throw new Error('原位置已有同名文件，未覆盖');
      item.status = 'undoing'; onProgress(item);
      fs.renameSync(item.destinationPath, item.sourcePath);
      item.status = 'undone'; item.error = null;
    } catch (error) { item.status = 'undo_failed'; item.error = error.message; }
    onProgress(item);
  }
  return result;
}

module.exports = { buildPlan, safeDestination, executePlan, undoBatch, isWithin };
