const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { readFolder, moveEntries, undoMoveBatch } = require('../src/file-manager.cjs');

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
