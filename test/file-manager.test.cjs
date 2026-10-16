const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { readFolder, readTargetFolder, readFolderWithin, searchPaneFolder, validateTargetFolder, moveEntries, moveEntriesBetween, renameEntry, trashEntries, createFolder, createPaneFolder, undoMoveBatch } = require('../src/file-manager.cjs');

test('folder browser shows immediate folders and files with metadata', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'file-manager-view-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, '项目A'));
  await fs.writeFile(path.join(root, '计划.docx'), 'body');
  const listing = await readFolder(root, root);
  assert.deepEqual(listing.items.map(item => item.name).sort(), ['计划.docx', '项目A']);
  assert.equal(listing.items.find(item => item.name === '项目A').type, 'directory');
  assert.equal(listing.items.find(item => item.name === '计划.docx').type, 'file');
});

test('target pane can browse a different folder independently of the source root', async t => {
  const sourceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'file-manager-source-pane-'));
  const destinationRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'file-manager-target-pane-'));
  t.after(async () => { await fs.rm(sourceRoot, { recursive: true, force: true }); await fs.rm(destinationRoot, { recursive: true, force: true }); });
  await fs.mkdir(path.join(destinationRoot, '归档', '2026'), { recursive: true });
  await fs.writeFile(path.join(destinationRoot, '归档', '说明.txt'), 'destination content');
  const listing = await readTargetFolder(path.join(destinationRoot, '归档'));
  assert.equal(listing.current, await fs.realpath(path.join(destinationRoot, '归档')));
  assert.equal(listing.items.find(item => item.name === '2026').type, 'directory');
  assert.equal(listing.items.find(item => item.name === '说明.txt').type, 'file');
  await assert.rejects(() => readFolder(sourceRoot, path.join(destinationRoot, '归档')), /管理范围/);
});

test('each pane can search names recursively from its current folder without leaving its boundary', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'file-manager-pane-search-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, '项目A', '归档'), { recursive: true });
  await fs.mkdir(path.join(root, '项目B'), { recursive: true });
  await fs.writeFile(path.join(root, '项目A', '归档', '水源会议纪要.docx'), 'doc');
  await fs.writeFile(path.join(root, '项目B', '水源表格.xlsx'), 'sheet');
  const results = await searchPaneFolder(root, path.join(root, '项目A'), '水源');
  assert.deepEqual(results.items.map(item => item.name), ['水源会议纪要.docx']);
  assert.equal(results.items[0].relativePath, path.join('归档', '水源会议纪要.docx'));
  await assert.rejects(() => searchPaneFolder(root, path.join(root, '项目A'), ''), /输入搜索词/);
  await assert.rejects(() => searchPaneFolder(root, path.join(root, '外部'), '水源'), /ENOENT|no such file/i);
});

test('two panes can browse and move selections in either direction with undo', async t => {
  const leftRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'file-manager-pane-left-'));
  const rightRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'file-manager-pane-right-'));
  t.after(async () => { await fs.rm(leftRoot, { recursive: true, force: true }); await fs.rm(rightRoot, { recursive: true, force: true }); });
  const leftFolder = path.join(leftRoot, '桌面'); const rightFolder = path.join(rightRoot, '项目');
  await fs.mkdir(leftFolder); await fs.mkdir(rightFolder);
  const leftFile = path.join(leftFolder, '左侧.txt'); const rightFile = path.join(rightFolder, '右侧.txt');
  await fs.writeFile(leftFile, 'left'); await fs.writeFile(rightFile, 'right');
  assert.equal((await readFolderWithin(leftRoot, leftFolder)).items[0].name, '左侧.txt');
  await assert.rejects(() => readFolderWithin(leftFolder, leftRoot), /管理范围/);

  const toRight = await moveEntriesBetween(leftRoot, [leftFile], rightRoot, rightFolder);
  assert.equal(toRight.moved.length, 1);
  assert.equal(await fs.readFile(path.join(rightFolder, '左侧.txt'), 'utf8'), 'left');
  const rightToLeft = await moveEntriesBetween(rightRoot, [rightFile], leftRoot, leftFolder);
  assert.equal(rightToLeft.moved.length, 1);
  assert.equal(await fs.readFile(path.join(leftFolder, '右侧.txt'), 'utf8'), 'right');

  const undone = await undoMoveBatch(leftRoot, { ...toRight, root: leftRoot });
  assert.equal(undone.undone.length, 1);
  assert.equal(await fs.readFile(leftFile, 'utf8'), 'left');
});

test('two-pane moves reject invalid destinations, no-ops, descendants and collisions safely', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'file-manager-pane-validation-'));
  const other = await fs.mkdtemp(path.join(os.tmpdir(), 'file-manager-pane-validation-other-'));
  t.after(async () => { await fs.rm(root, { recursive: true, force: true }); await fs.rm(other, { recursive: true, force: true }); });
  const source = path.join(root, '来源'); const nested = path.join(source, '子目录'); const target = path.join(other, '目标');
  await fs.mkdir(nested, { recursive: true }); await fs.mkdir(target);
  const file = path.join(source, '同名.txt'); await fs.writeFile(file, 'source');
  await fs.writeFile(path.join(target, '同名.txt'), 'existing');
  await assert.rejects(() => moveEntriesBetween(root, [], other, target), /1 到 100/);
  await assert.rejects(() => moveEntriesBetween(root, [file], other, path.join(other, 'missing')), /ENOENT|no such file/i);
  const noOp = await moveEntriesBetween(root, [file], root, source);
  assert.match(noOp.failed[0].error, /已经位于目标/);
  const collision = await moveEntriesBetween(root, [file], other, target);
  assert.match(collision.failed[0].error, /同名/);
  const descendant = await moveEntriesBetween(root, [source], root, nested);
  assert.match(descendant.failed[0].error, /自身内部/);
  assert.equal(await fs.readFile(path.join(target, '同名.txt'), 'utf8'), 'existing');
  assert.equal(await fs.readFile(file, 'utf8'), 'source');
});

test('rename is validated, reversible, and does not overwrite an existing item', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'file-manager-rename-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const original = path.join(root, '原名.txt'); const occupied = path.join(root, '已存在.txt');
  await fs.writeFile(original, 'body'); await fs.writeFile(occupied, 'keep');
  const renamed = await renameEntry(root, original, '新名称.txt');
  assert.equal(renamed.destination, path.join(root, '新名称.txt'));
  assert.equal((await renameEntry(root, renamed.destination, '新名称.txt')).status, 'unchanged');
  await assert.rejects(() => renameEntry(root, renamed.destination, '已存在.txt'), /同名/);
  await assert.rejects(() => renameEntry(root, renamed.destination, '..'), /不允许/);
  const undo = await undoMoveBatch(root, { id: 'rename-test', createdAt: new Date().toISOString(), items: [{ ...renamed, status: 'moved' }] });
  assert.equal(undo.undone.length, 1);
  assert.equal(await fs.readFile(original, 'utf8'), 'body');
  assert.equal(await fs.readFile(occupied, 'utf8'), 'keep');
});

test('selected pane items can be moved to the recycle bin without touching outside paths', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'file-manager-trash-'));
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'file-manager-trash-outside-'));
  t.after(async () => { await fs.rm(root, { recursive: true, force: true }); await fs.rm(outside, { recursive: true, force: true }); });
  const file = path.join(root, '删除.txt'); const external = path.join(outside, '保留.txt'); const trashed = [];
  await fs.writeFile(file, 'recycle'); await fs.writeFile(external, 'keep');
  const result = await trashEntries(root, [file, external], async target => { trashed.push(target); await fs.rm(target); });
  assert.equal(result.trashed.length, 1);
  assert.equal(result.failed.length, 1);
  assert.deepEqual(trashed, [file]);
  assert.equal(await fs.readFile(external, 'utf8'), 'keep');
  const retry = path.join(root, '回收站错误.txt'); await fs.writeFile(retry, 'stay');
  const callbackFailure = await trashEntries(root, [retry], async () => { throw new Error('recycle bin unavailable'); });
  assert.match(callbackFailure.failed[0].error, /recycle bin unavailable/);
  assert.equal(await fs.readFile(retry, 'utf8'), 'stay');
});

test('pane folder creation validates names and undo skips unrelated history items', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'file-manager-pane-create-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const created = await createPaneFolder(root, root, '新建目录');
  assert.equal((await fs.stat(created)).isDirectory(), true);
  await assert.rejects(() => createPaneFolder(root, root, 'bad/name'), /Windows/);
  const batch = { id: 'empty-undo', createdAt: new Date().toISOString(), items: [{ source: 'unused', destination: 'unused', status: 'failed' }] };
  const result = await undoMoveBatch(root, batch);
  assert.equal(result.undone.length, 0);
});

test('move supports files and whole folders, with undo restoring their original locations', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'file-manager-move-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, '源'); const target = path.join(root, '归档');
  await fs.mkdir(path.join(source, '子目录'), { recursive: true }); await fs.mkdir(target);
  await fs.writeFile(path.join(source, '文档.txt'), 'doc'); await fs.writeFile(path.join(source, '子目录', '表格.xlsx'), 'sheet');
  const batch = await moveEntries(root, [path.join(source, '文档.txt'), path.join(source, '子目录')], target);
  assert.equal(batch.moved.length, 2);
  assert.equal(await fs.readFile(path.join(target, '子目录', '表格.xlsx'), 'utf8'), 'sheet');
  const undone = await undoMoveBatch(root, batch);
  assert.equal(undone.undone.length, 2);
  assert.equal(await fs.readFile(path.join(source, '子目录', '表格.xlsx'), 'utf8'), 'sheet');
});

test('move refuses overwrite and moving a folder into its descendant', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'file-manager-conflict-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, '源'), target = path.join(root, '目标');
  await fs.mkdir(path.join(source, '子'), { recursive: true }); await fs.mkdir(target);
  await fs.writeFile(path.join(source, '重复.txt'), 'original'); await fs.writeFile(path.join(target, '重复.txt'), 'target');
  const conflict = await moveEntries(root, [path.join(source, '重复.txt')], target);
  assert.match(conflict.failed[0].error, /同名/);
  const nested = await moveEntries(root, [source], path.join(source, '子'));
  assert.match(nested.failed[0].error, /内部/);
  assert.equal(await fs.readFile(path.join(target, '重复.txt'), 'utf8'), 'target');
});

test('move rejects paths outside the selected management root', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'file-manager-boundary-'));
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'file-manager-outside-'));
  t.after(async () => { await fs.rm(root, { recursive: true, force: true }); await fs.rm(outside, { recursive: true, force: true }); });
  await fs.writeFile(path.join(outside, 'private.txt'), 'keep');
  await assert.rejects(() => readFolder(root, outside), /管理范围/);
  const move = await moveEntries(root, [path.join(outside, 'private.txt')], root);
  assert.match(move.failed[0].error, /管理范围/);
});

test('move supports an external destination and verified copy moves with undo', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'file-manager-cross-root-'));
  const external = await fs.mkdtemp(path.join(os.tmpdir(), 'file-manager-cross-target-'));
  t.after(async () => { await fs.rm(root, { recursive: true, force: true }); await fs.rm(external, { recursive: true, force: true }); });
  const source = path.join(root, '桌面');
  const file = path.join(source, '报告.txt');
  const folder = path.join(source, '项目资料');
  await fs.mkdir(path.join(folder, '子目录'), { recursive: true });
  await fs.mkdir(source, { recursive: true });
  await fs.writeFile(file, 'cross-volume file');
  await fs.writeFile(path.join(folder, '子目录', '预算.xlsx'), 'cross-volume folder content');
  const newExternalFolder = await createFolder(root, external, '归档目标');
  assert.equal((await fs.stat(newExternalFolder)).isDirectory(), true);

  const batch = await moveEntries(root, [file, folder], newExternalFolder, { forceCopy: true });
  assert.equal(batch.moved.length, 2);
  assert.equal(await fs.readFile(path.join(newExternalFolder, '报告.txt'), 'utf8'), 'cross-volume file');
  assert.equal(await fs.readFile(path.join(newExternalFolder, '项目资料', '子目录', '预算.xlsx'), 'utf8'), 'cross-volume folder content');
  await assert.rejects(() => fs.stat(file), { code: 'ENOENT' });

  const undone = await undoMoveBatch(root, batch, { forceCopy: true });
  assert.equal(undone.undone.length, 2);
  assert.equal(await fs.readFile(file, 'utf8'), 'cross-volume file');
  assert.equal(await fs.readFile(path.join(folder, '子目录', '预算.xlsx'), 'utf8'), 'cross-volume folder content');
  await assert.rejects(() => fs.stat(path.join(newExternalFolder, '报告.txt')), { code: 'ENOENT' });
});

test('verified cross-volume copy retains its destination copy if source cleanup fails', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'file-manager-cleanup-source-'));
  const external = await fs.mkdtemp(path.join(os.tmpdir(), 'file-manager-cleanup-target-'));
  t.after(async () => { await fs.rm(root, { recursive: true, force: true }); await fs.rm(external, { recursive: true, force: true }); });
  const source = path.join(root, '保留原件.txt'); await fs.writeFile(source, 'verified copy');
  const originalRemove = fs.rm;
  fs.rm = async (target, options) => {
    if (path.resolve(target) === path.resolve(source)) throw new Error('source is locked');
    return originalRemove.call(fs, target, options);
  };
  let batch;
  try { batch = await moveEntriesBetween(root, [source], external, external, { forceCopy: true }); }
  finally { fs.rm = originalRemove; }
  assert.equal(batch.items[0].status, 'copied_source_retained');
  assert.equal(await fs.readFile(source, 'utf8'), 'verified copy');
  assert.equal(await fs.readFile(path.join(external, '保留原件.txt'), 'utf8'), 'verified copy');
});

test('external destinations and move requests are validated without widening source access', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'file-manager-validation-'));
  const external = await fs.mkdtemp(path.join(os.tmpdir(), 'file-manager-validation-target-'));
  t.after(async () => { await fs.rm(root, { recursive: true, force: true }); await fs.rm(external, { recursive: true, force: true }); });
  const file = path.join(root, '保留.txt');
  await fs.writeFile(file, 'keep');
  await assert.rejects(() => validateTargetFolder('relative-target'), /有效的移动目标/);
  await assert.rejects(() => validateTargetFolder(file), /必须是文件夹/);
  await assert.rejects(() => moveEntries(root, [], external), /1 到 100/);
  await assert.rejects(() => moveEntries(root, [file], file), /必须是文件夹/);
  const noOp = await moveEntries(root, [file], root);
  assert.match(noOp.failed[0].error, /已经位于目标/);
  assert.equal(await fs.readFile(file, 'utf8'), 'keep');
});

test('undo leaves both paths untouched when the original path has been reused', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'file-manager-undo-conflict-'));
  const external = await fs.mkdtemp(path.join(os.tmpdir(), 'file-manager-undo-target-'));
  t.after(async () => { await fs.rm(root, { recursive: true, force: true }); await fs.rm(external, { recursive: true, force: true }); });
  const source = path.join(root, '报告.txt');
  await fs.writeFile(source, 'moved original');
  const batch = await moveEntries(root, [source], external);
  await fs.writeFile(source, 'new file');
  const result = await undoMoveBatch(root, batch);
  assert.equal(result.undoFailed.length, 1);
  assert.equal(await fs.readFile(source, 'utf8'), 'new file');
  assert.equal(await fs.readFile(path.join(external, '报告.txt'), 'utf8'), 'moved original');
});

test('create folder adds a target beneath the chosen folder and prevents invalid names', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'file-manager-create-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const created = await createFolder(root, root, '项目资料');
  assert.equal((await fs.stat(created)).isDirectory(), true);
  await assert.rejects(() => createFolder(root, root, 'bad/name'), /Windows/);
  await assert.rejects(() => createFolder(root, root, '项目资料'), /同名/);
});
